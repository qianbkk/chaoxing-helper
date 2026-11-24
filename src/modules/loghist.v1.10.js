    //==================== v1.10 运行日志（按标签页会话）开始 ====================
    // 【v1.10 相比 v1.8.1 改了什么】
    //   日志的「存活范围」从「浏览器永久存储」改成「当前标签页的会话」：
    //     · 自动切下一节 / 手动点别的章节 = 同一个标签页里换页  → 日志保留；
    //     · 关掉标签页再重新打开这个页面 = 新的标签页          → 新的日志。
    //   实现用 sessionStorage —— 它的语义正好就是「同一标签页内换页/刷新还在，
    //   关掉标签页就没了」；而 v1.8.1 用的 GM 存储是永久的，关浏览器再开也还在。
    //
    // 【为什么换得掉：写日志的只有同源的两处】
    //   面板只出现在超星的章节列表页（knowledge/cards），写日志的地方只有：
    //     ① 章节列表页本身；
    //     ② 章节测验 iframe —— 它的 src 用的是当前页的 host（_p + '//' + _h + ...），
    //        与章节列表页**同源**，同源同标签页共享同一份 sessionStorage，
    //        所以两边写的日志能合到一起（父子页并发写仍然走合并写入，见下）。
    //   考试端/作业端是别的页面（别的源），那边的日志走的是 top.unrivalWorkInfo，
    //   从来不写进这份历史 —— 所以换存储不会丢任何本来能看到的日志。
    //
    // 【兜底】
    //   某些浏览器/隐私模式下 sessionStorage 可能不可用 —— 这时退回 GM 存储，
    //   行为退回 v1.8.1（永久保留），保证日志功能本身不挂。
    //
    // 【顺带清理】
    //   切到会话存储后，v1.8.1 留在 GM 存储里的那份历史是「永远看不到的旧数据」，
    //   首次进入会话模式时直接删掉，免得白占空间。
    var logHist = {
        KEY: 'unrivalLogHistory',
        MAX: 500,
        _lines: [],
        _loaded: false,
        _attached: false,
        _saveTimer: null,
        _store: null,          // 'session' = sessionStorage；'gm' = 退回 GM 存储
        _legacyCleared: false,
        // 取当前标签页的 sessionStorage（拿不到就返回 null，走 GM 兜底）
        _ss: function () {
            try {
                if (typeof sessionStorage != 'undefined' && sessionStorage) return sessionStorage;
                if (typeof _w != 'undefined' && _w && _w.sessionStorage) return _w.sessionStorage;
            } catch (e) { }
            return null;
        },
        load: function () {
            if (this._loaded) return;
            this._loaded = true;
            var ss = this._ss();
            if (ss) {
                this._store = 'session';
                try {
                    var raw = ss.getItem(this.KEY);
                    if (raw) {
                        var arr = JSON.parse(raw);
                        if (arr && arr.length) this._lines = arr;
                    }
                } catch (e) { }
                //清掉 v1.8.1 留在 GM 存储里的旧历史（会话模式下已经看不到了）
                if (!this._legacyCleared) {
                    this._legacyCleared = true;
                    try {
                        if (GM_getValue(this.KEY, '')) GM_setValue(this.KEY, '[]');
                    } catch (e1) { }
                }
                return;
            }
            this._store = 'gm';
            try {
                var rawG = GM_getValue(this.KEY, '');
                if (rawG) {
                    var arrG = JSON.parse(rawG);
                    if (arrG && arrG.length) this._lines = arrG;
                }
            } catch (e2) { }
        },
        save: function () {
            var self = this;
            if (this._saveTimer) return;
            this._saveTimer = setTimeout(function () {
                self._saveTimer = null;
                try {
                    //合并写入，而不是整份覆盖：
                    //  · 章节测验 iframe 与父页面可能同时在写同一份历史，
                    //    直接覆盖会把对方的行冲掉。
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
                        var raw = '';
                        var ss = self._ss();
                        if (self._store == 'session' && ss) {
                            raw = ss.getItem(self.KEY) || '';
                        } else {
                            raw = GM_getValue(self.KEY, '');
                        }
                        if (raw) {
                            var a = JSON.parse(raw);
                            if (a && a.length) stored = a;
                        }
                    } catch (e0) { }
                    for (var i = 0; i < stored.length; i++) push(stored[i]);
                    for (var j = 0; j < self._lines.length; j++) push(self._lines[j]);
                    while (merged.length > self.MAX) merged.shift();
                    self._lines = merged;
                    var payload = JSON.stringify(merged);
                    if (self._store == 'session' && self._ss()) {
                        try { self._ss().setItem(self.KEY, payload); } catch (e1) { }
                    } else {
                        try { GM_setValue(self.KEY, payload); } catch (e2) { }
                    }
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
                //倒序渲染 —— 最上面一条永远是最新的
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
            try {
                var ss = this._ss();
                if (this._store == 'session' && ss) {
                    ss.removeItem(this.KEY);
                } else {
                    GM_setValue(this.KEY, '[]');
                }
            } catch (e) { }
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
    //==================== v1.10 运行日志（按标签页会话）结束 ====================
