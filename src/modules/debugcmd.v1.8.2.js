    //==================== v1.8.2 调试命令通道开始 ====================
    // 【v1.8.2 相比 v1.7 改了什么】
    //   ① 修「版本自检通知」的空参数 bug
    //      v1.7 的接收端把版本号和安装地址放在命令对象的**独立字段**里
    //      （{cmd:'newversion', version:'…', url:'…'}），
    //      而脚本这边是按**字符串**解析命令的（cmd + 空格分隔的参数），
    //      于是 arg[0]/arg[1] 全是 undefined ⇒ 日志里打出来是
    //      「★ 发现新版本 ?： —— 在脚本猫里打开该地址点「安装」即可升级」。
    //      现在两边都改成字符串命令，并且脚本端额外兼容对象字段。
    //   ② 发现新版本后**自动打开安装页**（GM_openInTab）
    //      ⇒ 不用再手动找地址，脚本自己把安装页顶出来，用户点一下「重新安装」即可。
    //   ③ 新增 `dump` 命令：把当前章节的任务清单、附件属性、目录里的
    //      阅读/直播链接全部打出来 —— 这是研究「直播/阅读任务」的基本探针。
    //   ④ 远程命令 `set jumpType` 改走独立键 unrivalJumpTypeReal
    //      （v1.7 那版直接写老键，会把 v1.8 修掉的「暂停污染用户设置」又请回来）。
    //
    // 【v1.7 的设计回顾】
    //   调试模式从「只读日志」升级成「可远程操控」：
    //   脚本每 2 秒轮询本机接收端的 /__cmd?since=<已执行序号>，
    //   拿到命令后执行并把结果写回日志文件；
    //   支持 pause / resume / status / reload / goto <chapterId> /
    //         set <key> <val> / log <text> / help。
    //   接收端（src/tools/log-sink.cjs）同步升级：
    //   POST /__cmd 投递命令、GET /__cmd 取命令、GET /__status 看状态。
    //
    // 【边界】
    //   只有勾选「调试模式」的实例才轮询；普通用户零影响。
    //   已执行序号存 GM 存储（unrivalDbgCmdSeq），翻章 reload 不会重复执行旧命令。
    //
    // 【可用命令】
    //   pause             暂停（自动翻章 / 自动作答 / 自动提交 全停）
    //   resume            继续
    //   status            把当前状态写进日志（版本/章节/暂停/翻章模式/AI配置/题库熔断/正确率门槛）
    //   reload            刷新当前页面
    //   goto <chapterId>  跳到指定章节（走超星自己的 getTeacherAjax）
    //   set <key> <val>   改设置：accuracy / jumpType / ctFailLimit / ctFailCooldown / aiModel / aiBaseUrl
    //   log <text>        往日志里插一行（打标记用）
    //   dump              导出当前章节的任务清单与阅读/直播链接（研究用）
    //   help              列出命令
    //   newversion <v> <url>   接收端自动排入的版本提示：记日志 + 自动打开安装页
    var dbgCmd = {
        cfg: {
            sink: GM_getValue('unrivalDbgSink', 'http://127.0.0.1:8124'),
            pollMs: 2000
        },
        _timer: null,
        _busy: false,
        _seq: 0,
        base: function () {
            return String(this.cfg.sink || '').replace(/\/+$/, '');
        },
        say: function (msg) {
            try {
                dbg.log('cmd', msg);
            } catch (e) { }
        },
        enabled: function () {
            try {
                return typeof dbg != 'undefined' && dbg.cfg && dbg.cfg.enabled;
            } catch (e) {
                return false;
            }
        },
        status: function () {
            var s = [];
            try { s.push('版本=' + ((GM_info && GM_info.script && GM_info.script.version) || '?')); } catch (e) { }
            var href = '';
            try { href = String(location.href || ''); } catch (e) { }
            try { var m = href.match(/chapterId=(\d+)/); s.push('chapterId=' + (m ? m[1] : '?')); } catch (e) { }
            try { s.push('暂停=' + (pauseCtl.isPaused() ? '是' : '否')); } catch (e) { }
            try { s.push('翻章模式=' + (jumpType == 2 ? '不跳转' : (jumpType == 0 ? '智能' : '遍历'))); } catch (e) { }
            try { s.push('AI=' + aiState.model + '@' + aiState.baseUrl + ' key=' + (aiState.key ? '已填' : '空')); } catch (e) { }
            try { s.push('题库熔断=' + aiState.ctFail + '/' + ctFailLimit + ' 剩余' + Math.max(0, Math.round((aiState.ctOffUntil - Date.now()) / 1000)) + '秒'); } catch (e) { }
            try { s.push('正确率门槛=' + accuracy); } catch (e) { }
            try { s.push('自动作答=' + (workAuto.cfg.enable ? '开' : '关') + ' 自动提交=' + (workAuto.cfg.submit ? '开' : '关')); } catch (e) { }
            return s.join(' | ');
        },
        //===== 研究用探针：把当前章节的任务结构打出来 =====
        // 【设计】每个探针是一个独立的小方法，返回一段文本；
        //         dump() 按顺序拼起来。以后要查新的东西，
        //         加一个 _probeXxx 方法、再往 dump 的列表里加一行即可，
        //         不用改动已有探针。
        // 探针 1：超星下发的任务附件清单（每个任务的类型/名字/关键属性）
        _probeTasks: function () {
            var out = [];
            try {
                var pd = JSON.parse(param);
                var atts = pd['attachments'] || [];
                out.push('attachments=' + atts.length);
                for (var i = 0; i < atts.length && i < 20; i++) {
                    var it = atts[i] || {};
                    var p = it['property'] || {};
                    var keys = [];
                    for (var k in p) { keys.push(k); }
                    out.push('#' + i + ' type=' + it['type'] +
                        ' job=' + it['job'] +
                        ' passed=' + it['isPassed'] +
                        ' name=' + String(p['name'] || p['title'] || '') +
                        ' jobid=' + it['jobid'] +
                        ' objectid=' + (p['objectid'] || it['objectid'] || '') +
                        ' workid=' + (p['workid'] || '') +
                        ' prop=[' + keys.join(',') + ']');
                }
            } catch (e) {
                out.push('attachments 解析失败：' + (e && e.message ? e.message : e));
            }
            return out.join('\n');
        },
        // 探针 2：目录里的阅读 / 直播入口链接
        _probeLinks: function () {
            var out = [];
            try {
                var links = _d.getElementsByTagName('a');
                var hits = [];
                for (var j = 0; j < links.length && hits.length < 12; j++) {
                    var h = String(links[j].getAttribute('href') || '');
                    if (h.indexOf('ztnodedetail') >= 0 || h.indexOf('visitnodedetail') >= 0 ||
                        h.indexOf('live') >= 0 || h.indexOf('/live/') >= 0) {
                        hits.push(String(links[j].textContent || '').trim().slice(0, 24) + '→' + h.slice(0, 110));
                    }
                }
                out.push('阅读/直播链接=' + (hits.length ? hits.join(' | ') : '（本页没找到）'));
            } catch (e) { }
            return out.join('\n');
        },
        // 探针 3：iframe（超星把直播/阅读塞在 iframe 里的情况）
        _probeFrames: function () {
            var out = [];
            try {
                var ifr = _d.getElementsByTagName('iframe');
                var fs = [];
                for (var m2 = 0; m2 < ifr.length && fs.length < 8; m2++) {
                    fs.push(String(ifr[m2].getAttribute('id') || '') + '=' + String(ifr[m2].getAttribute('src') || '').slice(0, 110));
                }
                out.push('iframe=' + (fs.length ? fs.join(' | ') : '（无）'));
            } catch (e) { }
            return out.join('\n');
        },
        // 探针 4：脚本自己认出来的任务（missionList）——能对上就是脚本已在处理的任务
        _probeMissions: function () {
            var out = [];
            try {
                var ml = [];
                for (var mid in missionList) {
                    var mi = missionList[mid] || {};
                    ml.push(mid + ':' + mi['type'] + ':' + String(mi['name'] || '').slice(0, 20) +
                        ':done=' + (mi['done'] ? 1 : 0) + ':running=' + (mi['running'] ? 1 : 0));
                }
                out.push('missionList=' + (ml.length ? ml.join(' | ') : '（空）'));
            } catch (e) { }
            return out.join('\n');
        },
        dump: function () {
            var out = [];
            try { out.push('URL=' + String(location.href).slice(0, 180)); } catch (e) { }
            try { out.push('TITLE=' + String(_d.title || '')); } catch (e) { }
            out.push(this._probeTasks());
            out.push(this._probeLinks());
            out.push(this._probeFrames());
            out.push(this._probeMissions());
            return out.join('\n');
        },
        exec: function (c) {
            var parts = String((c && c.cmd) || '').trim().split(/\s+/);
            var cmd = parts[0] || '';
            var arg = parts.slice(1);
            try {
                switch (cmd) {
                    case 'pause':
                        pauseCtl.set(true);
                        this.say('命令 pause：已暂停');
                        break;
                    case 'resume':
                        pauseCtl.set(false);
                        this.say('命令 resume：已继续');
                        break;
                    case 'status':
                        this.say('命令 status：' + this.status());
                        break;
                    case 'reload':
                        this.say('命令 reload：刷新页面');
                        setTimeout(function () { location.reload(); }, 300);
                        break;
                    case 'goto':
                        if (!arg[0]) { this.say('命令 goto：缺少 chapterId'); break; }
                        try {
                            var cid = String(arg[0]).replace(/^cur/, '');
                            _w.getTeacherAjax(courseId, classId, cid);
                            this.say('命令 goto：已请求跳到 ' + cid);
                        } catch (e) {
                            this.say('命令 goto 失败：' + e.message);
                        }
                        break;
                    case 'set':
                        this.setOpt(arg[0], arg[1]);
                        break;
                    case 'log':
                        this.say('命令 log：' + arg.join(' '));
                        break;
                    case 'dump':
                        this.say('命令 dump：\n' + this.dump());
                        break;
                    case 'help':
                        this.say('可用命令：pause / resume / status / reload / goto <chapterId> / set <key> <val> / log <text> / dump / help');
                        break;
                    case 'newversion':
                        //v1.8.2：兼容两种传参（字符串命令 / 对象字段），并自动打开安装页
                        var _v = arg[0] || (c && c.version) || '?';
                        var _u = arg[1] || (c && c.url) || '';
                        this.say('★ 发现新版本 ' + _v + '：' + _u);
                        if (_u) {
                            try {
                                GM_openInTab(_u, { active: true, insert: true });
                                this.say('已自动打开安装页，在脚本猫里点「重新安装」即可升级');
                            } catch (e2) {
                                this.say('自动打开安装页失败（' + e2.message + '），请手动打开：' + _u);
                            }
                        }
                        break;
                    default:
                        this.say('命令 ' + cmd + '：不认识，输入 help 看列表');
                }
            } catch (e) {
                this.say('命令 ' + cmd + ' 执行异常：' + e.message);
            }
        },
        setOpt: function (k, v) {
            if (!k) { this.say('命令 set：缺少键'); return; }
            var val = parseInt(v, 10);
            switch (k) {
                case 'accuracy':
                    if (isNaN(val) || val < 0) val = 80;
                    if (val > 100) val = 100;
                    accuracy = val;
                    GM_setValue('unrivalaccuracy', accuracy);
                    this.say('命令 set accuracy = ' + accuracy);
                    break;
                case 'jumpType':
                    //v1.8.2：写独立键 unrivalJumpTypeReal；暂停中不改动运行时翻章模式
                    //（v1.7 那版直接写老键 unrivaljumpType，会把 v1.8 修掉的「暂停污染用户设置」又请回来）
                    var _jtCmd = jumpMode.set(val);
                    jumpType = (pauseCtl.isPaused()) ? 2 : (_jtCmd === '2' ? 2 : 1);
                    this.say('命令 set jumpType = ' + jumpType);
                    break;
                case 'ctFailLimit':
                    if (isNaN(val) || val < 1) val = 3;
                    ctFailLimit = val;
                    GM_setValue('unrivalCtFailLimit', ctFailLimit);
                    this.say('命令 set ctFailLimit = ' + ctFailLimit);
                    break;
                case 'ctFailCooldown':
                    if (isNaN(val) || val < 1000) val = 600000;
                    ctFailCooldown = val;
                    GM_setValue('unrivalCtFailCooldown', ctFailCooldown);
                    this.say('命令 set ctFailCooldown = ' + ctFailCooldown + 'ms');
                    break;
                case 'aiModel':
                    aiState.model = String(v || '');
                    GM_setValue('unrivalAiModel', aiState.model);
                    this.say('命令 set aiModel = ' + aiState.model);
                    break;
                case 'aiBaseUrl':
                    aiState.baseUrl = String(v || '');
                    GM_setValue('unrivalAiBaseUrl', aiState.baseUrl);
                    this.say('命令 set aiBaseUrl = ' + aiState.baseUrl);
                    break;
                default:
                    this.say('命令 set：未知键 ' + k + '（可用：accuracy / jumpType / ctFailLimit / ctFailCooldown / aiModel / aiBaseUrl）');
            }
        },
        poll: function () {
            if (!this.enabled() || this._busy) return;
            this._busy = true;
            var self = this;
            try {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: this.base() + '/__cmd?since=' + this._seq,
                    timeout: 5000,
                    onload: function (res) {
                        self._busy = false;
                        try {
                            var obj = JSON.parse(res.responseText || '{}');
                            var cmds = obj.cmds || [];
                            for (var i = 0; i < cmds.length; i++) {
                                self._seq = Math.max(self._seq, cmds[i].seq || 0);
                                GM_setValue('unrivalDbgCmdSeq', String(self._seq));
                                self.exec(cmds[i]);
                            }
                        } catch (e) { }
                    },
                    onerror: function () { self._busy = false; },
                    ontimeout: function () { self._busy = false; }
                });
            } catch (e) {
                this._busy = false;
            }
        },
        start: function () {
            var self = this;
            try {
                this._seq = parseInt(GM_getValue('unrivalDbgCmdSeq', '0'), 10) || 0;
            } catch (e) { this._seq = 0; }
            if (this._timer) return;
            this._timer = setInterval(function () { self.poll(); }, this.cfg.pollMs);
            setTimeout(function () { self.poll(); }, 800);
        }
    };
    try {
        dbgCmd.start();
    } catch (e) {
        console.log(e);
    }
    //==================== v1.8.2 调试命令通道结束 ====================
