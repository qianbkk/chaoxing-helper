    //==================== v1.11.2 运行日志（按标签页会话）开始 ====================
    // 【v1.11.2 相比 v1.10 改了什么】
    //   存储语义一个字没动（还是「按标签页会话」：翻章保留、关标签页清空），
    //   改的是**写进去之前**和**画出来之后**这两头：
    //     ① 写进去之前：统一规范化（logSpec.normalize）——
    //        空白折叠、空消息丢弃、没标签的补 [系统]；
    //     ② 写进去的时候：连续重复的同一条消息**合并计数**，
    //        只加一条不再加行，渲染成「原文（×N）」，不刷屏；
    //     ③ 合并写入（父子页并发写）时按「时间+颜色+正文」去重，
    //        计数取大的那个，避免并发把次数写乱。
    //
    // 【为什么合并计数只认「连续」的两条】
    //   隔了几条之后再出现同一句话，多半是新的一次事件（比如换了一章又遇到同样的提示），
    //   那是两件事，不该并成一条。只有紧挨着的重复才是刷屏。
    //
    // 【v1.10 保留的语义（一个字没改）】
    //   · 日志的「存活范围」：同一标签页里换页/翻章还在，关掉标签页就没了；
    //   · 用 sessionStorage，隐私模式下不可用时退回 GM 存储（永久保留），日志功能不挂；
    //   · 面板上最新的那条排在最上面（倒序渲染）。
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
                        if (seen[k]) {
                            //同一条被两个来源各写了一份：计数取大的那个
                            var ex = seen[k];
                            if ((l.n || 1) > (ex.n || 1)) ex.n = l.n;
                            return;
                        }
                        seen[k] = l;
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
        //写进历史之前统一规范化（标签、空白、空消息）
        normalize: function (str) {
            try {
                if (typeof logSpec != 'undefined' && logSpec && logSpec.normalize) return logSpec.normalize(str);
            } catch (e) { }
            return String(str == null ? '' : str);
        },
        push: function (str, color) {
            try {
                this.load();
                var text = this.normalize(str);
                if (!text) return;                 // 空消息直接丢掉，不占一行
                var last = this._lines.length ? this._lines[this._lines.length - 1] : null;
                if (last && last.s === text) {
                    //紧挨着的同一句：只加计数，不再加行
                    last.n = (last.n || 1) + 1;
                    while (this._lines.length > this.MAX) this._lines.shift();
                    this.save();
                    return;
                }
                this._lines.push({
                    t: this.stamp(),
                    c: String(color || 'black'),
                    s: text,
                    n: 1
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
                    //重复过的消息后面带一个计数
                    var cnt = (l.n && l.n > 1) ? ('（×' + l.n + '）') : '';
                    html += "<span style='color: " + l.c + "'>[" + l.t + "] " + this.escape(l.s) + cnt + '</span><br>';
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
                    try { logs.addLog('[系统] 运行日志已清空', 'gray'); } catch (e) { }
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
    //==================== v1.11.2 运行日志（按标签页会话）结束 ====================
