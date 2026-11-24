    //==================== v1.8.1 运行日志持久化（跨翻章堆积）开始 ====================
    // 【v1.8.1 相比 v1.8 改了什么】
    //   日志的显示顺序反过来：**最新的在最上面**，往下依次变旧。
    //   v1.8 是「最旧在上、最新在下 + 滚到底」，翻章后新日志追加在末尾，
    //   用户想看刚才那条得往下翻；反过来之后，最上面一条永远是最新的，
    //   打开面板第一眼就是刚才发生的事。
    //   存储里的顺序不变（仍是按时间正序），只是渲染时倒序输出，
    //   这样多标签页/父子帧的合并写入逻辑不受影响。
    //
    // 【其余说明同 v1.8】
    //   · 上游的 logs.logArry 只在内存里（上限 50 条），脚本每翻一章就 reload 一次，
    //     面板里的「运行日志」随之清空 —— 想回看上一章发生了什么，只能靠截图或落盘文件。
    //   · 用户要求：「每次打开运行的日志不能堆积吗，只要没关闭或者超过某个限制就保持日志持续」。
    //   · 包装 logs.addLog：每条日志写进 GM 存储（unrivalLogHistory），
    //     面板渲染时把「存储里的历史 + 本次新增」一起显示；
    //     超过 MAX 条就丢最旧的，MAX 以内一条不丢。
    //   · 存储跨浏览器会话也在 ⇒ 关掉浏览器再打开，仍能看到上一轮跑到哪了。
    //   · 只改脚本自己注入的面板（按 id=log 定位），不碰超星页面 DOM。
    //   · 存储里存的是「纯文本 + 颜色 + 时间」，渲染时自己拼 HTML，不直接存 HTML。
    //   · 与 v1.5 的调试落盘模块互不影响（那个发到本机接收端，这个存浏览器存储）。
    var logHist = {
        KEY: 'unrivalLogHistory',
        MAX: 500,
        _lines: [],
        _loaded: false,
        _attached: false,
        _saveTimer: null,
        load: function () {
            if (this._loaded) return;
            this._loaded = true;
            try {
                var raw = GM_getValue(this.KEY, '');
                if (raw) {
                    var arr = JSON.parse(raw);
                    if (arr && arr.length) this._lines = arr;
                }
            } catch (e) { }
        },
        save: function () {
            var self = this;
            if (this._saveTimer) return;
            this._saveTimer = setTimeout(function () {
                self._saveTimer = null;
                try {
                    //合并写入，而不是整份覆盖：
                    //  · 作业 iframe 与父页面、多个课程标签页可能同时在写同一份历史；
                    //    直接覆盖会把对方的行冲掉。
                    //  · 合并后本页的视图也跟着长齐（历史本来就是给回看用的）。
                    var merged = [], seen = {};
                    var push = function (l) {
                        if (!l || typeof l != 'object') return;
                        var k = (l.t || '') + '|' + (l.c || '') + '|' + (l.s || '');
                        if (seen[k]) return;
                        seen[k] = 1;
                        merged.push(l);
                    };
                    var stored = [];
                    try {
                        var raw = GM_getValue(self.KEY, '');
                        if (raw) {
                            var a = JSON.parse(raw);
                            if (a && a.length) stored = a;
                        }
                    } catch (e0) { }
                    for (var i = 0; i < stored.length; i++) push(stored[i]);
                    for (var j = 0; j < self._lines.length; j++) push(self._lines[j]);
                    while (merged.length > self.MAX) merged.shift();
                    self._lines = merged;
                    GM_setValue(self.KEY, JSON.stringify(merged));
                } catch (e) { }
            }, 400);
        },
        stamp: function () {
            var d = new Date();
            var p = function (n) { return (n < 10 ? '0' : '') + n; };
            return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
        },
        escape: function (s) {
            return String(s == null ? '' : s)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        },
        push: function (str, color) {
            try {
                this.load();
                this._lines.push({
                    t: this.stamp(),
                    c: String(color || 'black'),
                    s: String(str == null ? '' : str)
                });
                while (this._lines.length > this.MAX) this._lines.shift();
                this.save();
            } catch (e) { }
        },
        render: function () {
            try {
                var el = _d.getElementById('log');
                if (!el) return false;
                var html = '';
                //v1.8.1：倒序渲染 —— 最上面一条永远是最新的
                for (var i = this._lines.length - 1; i >= 0; i--) {
                    var l = this._lines[i];
                    html += "<span style='color: " + l.c + "'>[" + l.t + "] " + this.escape(l.s) + '</span><br>';
                }
                el.innerHTML = html;
                el.scrollTop = 0;   // 停在顶部，最新的一条一直可见
                return true;
            } catch (e) {
                return false;
            }
        },
        clear: function () {
            this._lines = [];
            this._loaded = true;
            //先撤掉待写入的防抖定时器，避免清空后又被旧内容写回去
            try {
                if (this._saveTimer) {
                    clearTimeout(this._saveTimer);
                    this._saveTimer = null;
                }
            } catch (e0) { }
            try { GM_setValue(this.KEY, '[]'); } catch (e) { }
            this.render();
        },
        attach: function () {
            try {
                if (this._attached) return;
                var orig = logs.addLog;
                if (typeof orig != 'function') return;   // logs 还没定义好，等下一轮再挂
                var self = this;
                logs.addLog = function (str, color) {
                    var r;
                    try { r = orig.apply(this, arguments); } catch (e) { }
                    try { self.push(str, color); } catch (e2) { }
                    try { self.render(); } catch (e3) { }
                    return r;
                };
                this._attached = true;
            } catch (e) { }
        },
        //「清空运行日志」按钮（日志持久化之后必须留一个手动清理的入口）
        bindClear: function () {
            try {
                var btn = _d.getElementById('clearLogButton');
                if (!btn) return false;
                if (btn.getAttribute('data-unrival-bound') == '1') return true;
                btn.setAttribute('data-unrival-bound', '1');
                var self = this;
                btn.onclick = function () {
                    self.clear();
                    try { logs.addLog('运行日志已清空', 'gray'); } catch (e) { }
                };
                return true;
            } catch (e) {
                return false;
            }
        },
        init: function () {
            try { this.load(); } catch (e) { }
            this.attach();
            var self = this;
            // logs 在脚本体内较后面才赋值，这里补两次挂载
            setTimeout(function () { try { self.attach(); } catch (e) { } }, 0);
            setTimeout(function () { try { self.attach(); } catch (e) { } }, 400);
            // 面板注入后回填一次历史（面板是 setInterval 轮询注入的，可能晚于脚本）
            setTimeout(function () { try { self.attach(); self.render(); self.bindClear(); } catch (e) { } }, 1200);
            setTimeout(function () { try { self.attach(); self.render(); self.bindClear(); } catch (e) { } }, 3000);
            setTimeout(function () { try { self.attach(); self.render(); self.bindClear(); } catch (e) { } }, 6000);
        }
    };
    try {
        logHist.init();
    } catch (e) {
        console.log(e);
    }
    //==================== v1.8.1 运行日志持久化（跨翻章堆积）结束 ====================
