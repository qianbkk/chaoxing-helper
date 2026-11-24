    //==================== v1.7 调试命令通道开始 ====================
    // 【目的】把「调试模式」从「只读日志」升级成**可远程操控**：
    //   维护者在命令行 POST /__cmd 投递命令 → 脚本在页面里执行 → 结果写回日志文件。
    //   于是除了「更新脚本本体」，全程不需要截图、不需要操控浏览器。
    // 【边界】只有勾选了「调试模式」的实例才会轮询；普通用户完全不受影响。
    //
    // 可用命令：
    //   pause             暂停（自动翻章 / 自动作答 / 自动提交 全停）
    //   resume            继续
    //   status            把当前状态写进日志（版本/章节/暂停/翻章模式/AI配置/题库熔断/正确率门槛）
    //   reload            刷新当前页面
    //   goto <chapterId>  跳到指定章节（走超星自己的 getTeacherAjax）
    //   set <key> <val>   改设置：accuracy / jumpType / ctFailLimit / ctFailCooldown / aiModel / aiBaseUrl
    //   log <text>        往日志里插一行（打标记用）
    //   help              列出命令
    //   newversion <v> <url>   接收端自动排入的版本提示，只记日志不自动操作
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
                    case 'help':
                        this.say('可用命令：pause / resume / status / reload / goto <chapterId> / set <key> <val> / log <text> / help');
                        break;
                    case 'newversion':
                        this.say('★ 发现新版本 ' + (arg[0] || '?') + '：' + (arg[1] || '') + ' —— 在脚本猫里打开该地址点「安装」即可升级');
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
                    jumpType = (val === 2) ? 2 : 1;
                    GM_setValue('unrivaljumpType', jumpType);
                    this.say('命令 set jumpType = ' + jumpType);
                    break;
                case 'ctFailLimit':
                    if (isNaN(val) || val < 1) val = 3;
                    ctFailLimit = val;
                    this.say('命令 set ctFailLimit = ' + ctFailLimit);
                    break;
                case 'ctFailCooldown':
                    if (isNaN(val) || val < 1000) val = 600000;
                    ctFailCooldown = val;
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
    //==================== v1.7 调试命令通道结束 ====================
