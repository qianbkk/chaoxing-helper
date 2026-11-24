    //==================== v1.4 章节测验 / 作业自动作答（新版超星作业页）====================
    // 【为什么单独写一个模块】
    //   上游（2024 版）的答题分支只认 work/phone/doHomeWork 这类旧地址，
    //   题目结构也写死在 .Py-mian1 / .answerList / li[id-param] 上。
    //   2026-11-24 实测当前超星（西安航空学院 形势与政策 2026秋）章节测验页真实结构是：
    //     地址：/mooc-ans/work/doHomeWorkNew?courseId=...&workId=...
    //     题目：div.TiMu > div.Zy_TItle > div.clearfix.font-cxsecret.fontLabel  ← 题干（加密字体）
    //     选项：ul.Zy_ulTop > li > input[name=answerXXXXX][type=radio|checkbox][value=字母]
    //                            + a.after                                            ← 选项文字（加密字体）
    //     题型：input[name^=answertype][value=0单选/1多选/3判断]
    //     提交：a.Btn_blue_1.workBtnIndex
    //   上游的分支与选择器在这套结构上**一个都不匹配**，等于章节测验自动答题完全失效。
    //
    // 【关键坑：选项乱序】
    //   页面 hidden input randomOptions=true —— 超星会把选项顺序随机打乱，
    //   于是「显示的字母」与「input[value]（原始字母）」不是一回事：
    //     显示：A=猎狐  B=打虎  C=拍蝇  D=天网行动
    //     真实：input.value 分别是 C / B / D / A
    //   而题库(icodef)返回的是**选项文字**（多选用 # 分隔），不是字母，
    //   所以本模块一律「按文字匹配选项」，天然不受乱序影响；
    //   万一题库只返回字母，则按 input.value（原始字母）匹配，与题库存储口径一致。
    //
    // 【答题链路】题库(icodef) → AI(OpenAI兼容) → 随机兜底；与学习端一致。
    // 【提交策略】只有「每道题都拿到题库或 AI 的答案」时才点提交，
    //              有兜底随机题就不提交，避免把错误答案交上去。
    var workAuto = {
        cfg: {
            enable: GM_getValue('unrivalWorkAuto', '1') == '1', //章节测验/作业自动作答（默认开）
            submit: GM_getValue('unrivalWorkSubmit', '1') == '1' //全部题目有依据时自动提交（默认开）
        },
        //===== 页面识别（纯函数，可单测）=====
        matchPage: function (pathname) {
            pathname = String(pathname || '').replace(/\/+$/, '');
            if (/\/work\/doHomeWork(New)?$/.test(pathname)) return 'work';
            if (/\/mooc2\/work\/dowork$/.test(pathname)) return 'work';
            return '';
        },
        //===== 文本归一化（去空白/字母前缀/标点，可单测）=====
        norm: function (s) {
            if (!s) return '';
            return String(s)
                .replace(/\s+/g, '')
                .replace(/^[A-Ha-h][.、．)）:：]?/, '')
                .replace(/[“”‘’"'「」『』《》〈〉【】（）()\[\]{}，。！？；：、,.!?;:\-—_·…]/g, '')
                .toLowerCase();
        },
        //===== 单个答案文字 → 选项下标（纯函数，可单测）=====
        matchOne: function (answerText, options) {
            if (!answerText || !options || !options.length) return -1;
            var i, o;
            //【字母回退要先于归一化】norm() 会把开头的单个字母当成"选项序号前缀"剥掉，
            //  题库只返回字母（如 "C"）时若先归一化就变成空串，匹配必然失败。
            var raw = String(answerText).trim();
            if (/^[A-Ha-h][.、．)）:：]?$/.test(raw)) {
                for (i = 0; i < options.length; i++) {
                    if (String(options[i].letter || '').toUpperCase() === raw.charAt(0).toUpperCase()) return i;
                }
            }
            var t = this.norm(answerText);
            if (!t) return -1;
            for (i = 0; i < options.length; i++) {
                o = this.norm(options[i].text);
                if (o && o === t) return i;
            }
            for (i = 0; i < options.length; i++) {
                o = this.norm(options[i].text);
                if (!o) continue;
                if (o.indexOf(t) >= 0 || t.indexOf(o) >= 0) return i;
            }
            //归一化后仍是单字母（如 "AB" 被剥成 "b"）时，再按原始字母匹配一次
            if (/^[A-Ha-h]$/.test(t)) {
                for (i = 0; i < options.length; i++) {
                    if (String(options[i].letter || '').toUpperCase() === t.toUpperCase()) return i;
                }
            }
            return -1;
        },
        //===== 题库答案（多选用 # 分隔）→ 选项下标数组（纯函数，可单测）=====
        matchAnswer: function (answerText, options) {
            var parts = String(answerText || '').split('#');
            var idxs = [];
            for (var i = 0; i < parts.length; i++) {
                if (!parts[i] || !parts[i].trim()) continue;
                var hit = this.matchOne(parts[i], options);
                if (hit >= 0 && idxs.indexOf(hit) < 0) idxs.push(hit);
            }
            return idxs;
        },
        //===== 收集题目 =====
        collect: function () {
            var out = [];
            var roots;
            try {
                roots = _d.querySelectorAll('.TiMu');
            } catch (e) {
                return out;
            }
            for (var i = 0; i < roots.length; i++) {
                var root = roots[i];
                var titleEl = null;
                try {
                    titleEl = root.querySelector('.Zy_TItle .clearfix') || root.querySelector('.Zy_TItle');
                } catch (e) { }
                if (!titleEl) continue;
                var raw = (titleEl.textContent || '').replace(/\s+/g, ' ').trim();
                var question = cxDecrypt.decryptText(raw).replace(/^【[^】]*】\s*/, '').trim();
                if (!question) continue;
                var options = [];
                var lis = [];
                try {
                    lis = root.querySelectorAll('ul.Zy_ulTop li');
                } catch (e) { }
                var qid = '';
                for (var k = 0; k < lis.length; k++) {
                    var li = lis[k];
                    var input = null;
                    try {
                        input = li.querySelector('input[type=radio],input[type=checkbox]');
                    } catch (e) { }
                    if (!input) continue;
                    var txtEl = null;
                    try {
                        txtEl = li.querySelector('a.after');
                    } catch (e) { }
                    var rawOpt = txtEl ? (txtEl.textContent || '') : (li.textContent || '');
                    var text = cxDecrypt.decryptText(rawOpt).replace(/\s+/g, ' ').trim();
                    //原始字母：input[value]（超星 randomOptions 会打乱显示顺序，value 才是原始字母）
                    var letter = String(input.value || (input.getAttribute ? (input.getAttribute('value') || '') : '') || '').trim();
                    if (!qid) {
                        var nm = String(input.getAttribute('name') || '');
                        var idm = nm.match(/\d+/);
                        if (idm) qid = idm[0];
                    }
                    options.push({ 'input': input, 'li': li, 'letter': letter, 'text': text });
                }
                if (!options.length) continue;
                //题型：正常在 .TiMu 内部（input[name=answertype<题号>][value=0单选/1多选/3判断]），
                //      兜底再按完整 name 到整篇文档里找一次
                var typeEl = null;
                try {
                    typeEl = root.querySelector('input[name^=answertype]');
                } catch (e) { }
                if (!typeEl && qid) {
                    try {
                        typeEl = _d.querySelector('input[name="answertype' + qid + '"]');
                    } catch (e) { }
                }
                var typeVal = typeEl ? String(typeEl.value || '').trim() : '';
                var type = { '0': '单选题', '1': '多选题', '3': '判断题' }[typeVal] || '';
                if (!type) continue; //填空/简答暂不支持
                out.push({ 'qid': qid, 'question': question, 'type': type, 'options': options });
            }
            return out;
        },
        //===== 勾选选项 =====
        //  radio（单选/判断）：浏览器本身互斥，但只有"点击另一个 radio"才会取消上一个；
        //          为了保证结果确定（且与超星可能存在的自定义脚本无关），
        //          这里显式把同题其它 radio 置为未选中，再点当前项。
        //  checkbox（多选）：用 click() 勾选/取消，会正常触发 change 事件。
        clickOptions: function (q, idxs) {
            var done = 0;
            if (!q || !q.options) return 0;
            var isRadio = (q.type === '单选题' || q.type === '判断题');
            for (var i = 0; i < q.options.length; i++) {
                var opt = q.options[i];
                var want = idxs.indexOf(i) >= 0;
                try {
                    if (want) {
                        if (isRadio) {
                            for (var j = 0; j < q.options.length; j++) {
                                if (j !== i && q.options[j].input.checked) {
                                    q.options[j].input.checked = false; //radio:点击不会取消自己，只能直接置 false
                                }
                            }
                        }
                        if (!opt.input.checked) opt.input.click();
                        done++;
                    } else if (opt.input.checked) {
                        if (isRadio) opt.input.checked = false;
                        else opt.input.click(); //多选：点击取消，会触发 change
                    }
                } catch (e) { }
            }
            return done;
        },
        //===== 题库查询（icodef，与学习端同接口）=====
        ctAsk: function (question, typeName, cb) {
            var typeCode = { '单选题': '0', '多选题': '1', '判断题': '3' }[typeName];
            var param = 'question=' + encodeURIComponent(question);
            if (typeCode) param += '&type=' + typeCode + '&id=1';
            try {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: ctUrl,
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': token || '' },
                    data: param,
                    timeout: 8000,
                    onload: function (res) {
                        var obj = null;
                        try {
                            obj = JSON.parse(res.responseText);
                        } catch (e) { }
                        if (obj && obj.code === 1 && obj.data) {
                            cb(String(obj.data));
                            return;
                        }
                        if (obj && obj.code === -2) {
                            aiLog('题库触发并发限制，本题改用 AI', 'orange');
                        }
                        cb(null);
                    },
                    onerror: function () { cb(null); },
                    ontimeout: function () { cb(null); }
                });
            } catch (e) {
                cb(null);
            }
        },
        //===== AI 作答（复用 v1.1 的 aiAsk，返回的序号与选项顺序一致）=====
        aiAnswer: function (q, cb) {
            var self = this;
            var qu = { 'question': q.question, 'type': q.type, 'questionid': 'answer' + q.qid };
            try {
                aiAsk(qu, function (idxs, err) {
                    if (!idxs || !idxs.length) {
                        cb(false, err || 'AI未给出答案');
                        return;
                    }
                    var zero = [];
                    for (var i = 0; i < idxs.length; i++) zero.push(idxs[i] - 1);
                    var done = self.clickOptions(q, zero);
                    cb(done > 0, 'AI');
                });
            } catch (e) {
                cb(false, 'AI调用异常');
            }
        },
        //===== 单题作答：题库 → AI → 随机兜底 =====
        answerOne: function (q, cb) {
            var self = this;
            var ct = function () {
                self.ctAsk(q.question, q.type, function (ans) {
                    if (ans) {
                        var idxs = self.matchAnswer(ans, q.options);
                        if (idxs.length) {
                            self.clickOptions(q, idxs);
                            aiLog('题库命中：' + q.question.slice(0, 24) + ' → ' + idxs.map(function (i) {
                                return (i + 1) + '.' + q.options[i].text;
                            }).join(' / '), 'green');
                            cb(true, 'ct');
                            return;
                        }
                        aiLog('题库答案无法匹配选项：' + ans.slice(0, 30), 'orange');
                    }
                    self.aiAnswer(q, function (ok, src) {
                        if (ok) {
                            aiLog('AI作答：' + q.question.slice(0, 24) + ' → ' + src, 'green');
                            cb(true, 'ai');
                            return;
                        }
                        //随机兜底：单选选第一个，多选全选
                        var all = [];
                        for (var i = 0; i < q.options.length; i++) all.push(i);
                        var pick = (q.type === '多选题') ? all : [0];
                        self.clickOptions(q, pick);
                        aiLog('题库与AI都没结果，随机兜底：' + q.question.slice(0, 24), 'orange');
                        cb(true, 'random');
                    });
                });
            };
            ct();
        },
        //===== 全部答完后处理提交 =====
        finish: function (list, realCount) {
            //v1.5：暂停时不自动提交
            if (typeof pauseCtl != 'undefined' && pauseCtl.isPaused()) {
                aiLog('已暂停：不自动提交', 'orange');
                return;
            }
            if (!this.cfg.submit) {
                aiLog('已作答 ' + realCount + '/' + list.length + ' 题（未开启自动提交）', 'orange');
                return;
            }
            if (realCount < list.length) {
                aiLog('有 ' + (list.length - realCount) + ' 题只做了随机兜底，为避免交错答案，本次不自动提交', 'orange');
                return;
            }
            var btn = null;
            try {
                btn = _d.querySelector('a.Btn_blue_1.workBtnIndex') || _d.querySelector('.Btn_blue_1');
            } catch (e) { }
            if (!btn) {
                aiLog('未找到提交按钮，请手动提交', 'orange');
                return;
            }
            aiLog('全部题目已作答，正在提交…', 'green');
            var self = this;
            setTimeout(function () {
                try {
                    btn.click();
                    aiLog('已点击提交', 'green');
                } catch (e) {
                    aiLog('提交失败：' + e.message, 'red');
                }
            }, 600);
        },
        //===== 主流程 =====
        start: function () {
            var self = this;
            cxDecrypt.decrypt(0);
            var list = this.collect();
            if (!list.length) {
                aiLog('当前页面没有识别到可自动作答的题目', 'orange');
                return;
            }
            aiLog('识别到 ' + list.length + ' 道题，开始自动作答', 'green');
            var i = 0;
            var realCount = 0;
            var step = function () {
                //v1.5：暂停时停下，不再往下作答（已作答的题目保留）
                if (typeof pauseCtl != 'undefined' && pauseCtl.isPaused()) {
                    aiLog('已暂停：停止自动作答（已作答的题目保留）', 'orange');
                    return;
                }
                if (i >= list.length) {
                    self.finish(list, realCount);
                    return;
                }
                var q = list[i++];
                self.answerOne(q, function (ok, src) {
                    if (ok && src !== 'random') realCount++;
                    setTimeout(step, 1200);
                });
            };
            step();
        },
        //===== 入口 =====
        init: function () {
            try {
                if (!this.cfg.enable) return;
                //v1.5：暂停时连开都不开
                if (typeof pauseCtl != 'undefined' && pauseCtl.isPaused()) {
                    aiLog('已暂停：本次不自动作答', 'orange');
                    return;
                }
                if (!this.matchPage(_l.pathname)) return;
                var self = this;
                var tries = 0;
                var wait = function () {
                    tries++;
                    var n = 0;
                    try {
                        n = _d.querySelectorAll('.TiMu').length;
                    } catch (e) { }
                    if (n > 0) {
                        self.start();
                        return;
                    }
                    if (tries < 10) {
                        setTimeout(wait, 1000);
                    } else {
                        aiLog('等待超时：页面里始终没有找到题目', 'orange');
                    }
                };
                setTimeout(wait, 1000);
            } catch (e) {
                console.log(e);
            }
        }
    };
