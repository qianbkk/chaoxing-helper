    //==================== v1.11.1 阅读助手开始 ====================
    // 【来由】
    //   参考实现：上游 GF530068 v5.5.9.9.6 的「阅读助手」模块 —— 这条技术线上唯一成型的阅读实现。
    //   （桌面那份 v4.0 没有阅读能力；本模块按参考实现重写，接到本项目的骨架上。）
    //
    // 【它做什么】
    //   · 在「阅读正文页」（/ztnodedetailcontroller/visitnodedetail）：
    //     收集正文元素（段落/标题/图/视频），逐个滚过去，直到读完；
    //   · 在「阅读任务目录页」（/mooc-ans/zt/portal/ 等）：
    //     自动找到目录里的阅读入口并点进去；
    //   · 读完：写日志；页面里有「下一章」按钮时点它（与参考实现一致）。
    //
    // 【重要边界 —— 写清楚，别让人误以为能秒过】
    //   全程**不发任何完成上报请求**（与参考实现一致）：
    //   超星是按**真实浏览时长**判定阅读任务完成的，脚本只能把内容真的滚过去 ——
    //   读多久就是多久，不能加速、不能秒过。
    //
    // 【默认关闭】
    //   开关 unrivalReadAssist（面板「附加功能」里），默认 '0'。
    //   关掉开关会立刻停止正在进行的滚动（每一步都会检查开关）。
    var readAssist = {
        KEY: 'unrivalReadAssist',
        SPEED_KEY: 'unrivalReadSpeed',     // 每个段落停留多少秒（默认 1.0）
        MODE_KEY: 'unrivalReadMode',       // 'paragraph'（逐段，默认）| 'page'（整页）
        DEFAULT_SPEED: 1.0,
        //正文容器候选（取第一个「里面确实有段落」的）
        CONTENT_ROOT_SELECTORS: ['.read_content', '.article', '.content', '#content', '.node-content', '.chapter-content', '.ans-cc', 'main'],
        //这些区域里的东西不算正文（导航栏、悬浮控件等）
        CONTENT_EXCLUDE_SELECTOR: '.ztop,.zt_center,.zt_user,.zt_u_abs,header,nav,.header,.nav',
        //「下一章」按钮的候选选择器
        NEXT_SELECTORS: ['.nodeItem.r a', '.nodeItem.r i', 'a[title="下一章"]', 'a[title="下一节"]',
            '.next_btn', '.nextBtn', 'a.next', '.pager_next a', '.next_chapter a'],
        //目录页里的阅读入口候选
        LINK_SELECTORS: 'a[href*="/ztnodedetailcontroller/visitnodedetail"],.catalog_detail a,.chapter_item a,.nodeItem a,.posCatalog_name a',
        _elements: [],
        _index: 0,
        _timer: null,
        _jumpTimer: null,
        _observer: null,
        _running: false,
        //===== 开关与参数 =====
        enabled: function () {
            try { return GM_getValue(this.KEY, '0') == '1'; } catch (e) { return false; }
        },
        speed: function () {
            try {
                var v = parseFloat(GM_getValue(this.SPEED_KEY, String(this.DEFAULT_SPEED)));
                if (isNaN(v) || v <= 0) v = this.DEFAULT_SPEED;
                if (v < 0.3) v = 0.3;
                if (v > 10) v = 10;
                return v;
            } catch (e) { return this.DEFAULT_SPEED; }
        },
        mode: function () {
            try { return String(GM_getValue(this.MODE_KEY, 'paragraph')) == 'page' ? 'page' : 'paragraph'; } catch (e) { return 'paragraph'; }
        },
        //===== 页面判定（纯函数，可单测）=====
        isReadingPage: function (href) {
            return String(href || '').indexOf('/ztnodedetailcontroller/visitnodedetail') >= 0;
        },
        isReadingTaskPage: function (href) {
            href = String(href || '');
            if (href.indexOf('/mooc-ans/zt/portal/') >= 0) return true;
            if (href.indexOf('/mooc-ans/course/') >= 0 && href.indexOf('.html') >= 0) return true;
            var path = href.split('?')[0].split('#')[0];
            return /\/course\/\d+\.html/i.test(path);
        },
        //===== 日志：面板有 logs 就写面板，没有就写调试通道/控制台 =====
        log: function (msg, color) {
            try {
                if (typeof logs != 'undefined' && logs && logs.addLog) logs.addLog(msg, color || 'black');
            } catch (e) { }
            try {
                if (typeof dbg != 'undefined' && dbg && dbg.log) dbg.log('info', '阅读助手：' + msg);
            } catch (e1) { }
            try { console.log('[阅读助手] ' + msg); } catch (e2) { }
        },
        //===== 正文容器 =====
        contentRoot: function () {
            try {
                for (var i = 0; i < this.CONTENT_ROOT_SELECTORS.length; i++) {
                    var el = _d.querySelector(this.CONTENT_ROOT_SELECTORS[i]);
                    if (el && el.querySelector('p, h1, h2, h3, h4, h5, h6')) return el;
                }
                return _d.body;
            } catch (e) {
                return null;
            }
        },
        //===== 收集正文元素 =====
        collectContent: function () {
            try {
                var root = this.contentRoot();
                if (!root) return 0;
                var selectors = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'video'];
                var list = [];
                for (var s = 0; s < selectors.length; s++) {
                    var nodes = root.querySelectorAll(selectors[s]);
                    for (var i = 0; i < nodes.length; i++) {
                        var el = nodes[i];
                        if (el.closest && el.closest(this.CONTENT_EXCLUDE_SELECTOR)) continue;
                        if (!el.offsetHeight || !el.offsetWidth) continue;
                        if (el.offsetHeight <= 20 || el.offsetWidth <= 20) continue;
                        if (selectors[s] == 'p') {
                            var txt = String(el.textContent || '').trim();
                            if (txt.length < 4) continue;
                        }
                        list.push(el);
                    }
                }
                list.sort(function (a, b) {
                    return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
                });
                this._elements = list;
                this._index = 0;
                return list.length;
            } catch (e) {
                return 0;
            }
        },
        //每个段落的停留时间加一点随机（避免节奏太机械）
        jitter: function (baseMs) {
            return Math.max(200, Math.round(baseMs * (0.75 + Math.random() * 0.5)));
        },
        //===== 逐段阅读 =====
        scrollToNext: function () {
            var self = this;
            try {
                if (!this.enabled()) { this.stop(); return; }
                if (this._index >= this._elements.length) { this.complete(); return; }
                var el = this._elements[this._index];
                try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { }
                this._index++;
                this._timer = setTimeout(function () { self.scrollToNext(); }, this.jitter(this.speed() * 1000));
            } catch (e1) {
                this.complete();
            }
        },
        //===== 整页阅读 =====
        pageScroll: function () {
            var self = this;
            try {
                if (!this.enabled()) { this.stop(); return; }
                var total = _d.documentElement.scrollHeight - _w.innerHeight - 50;
                if (total <= 0) { this.complete(); return; }
                var step = total / (this.speed() * 10);
                if (!this._scrollTop) this._scrollTop = 0;
                var scroll = function () {
                    try {
                        if (!self.enabled()) { self.stop(); return; }
                        self._scrollTop += step;
                        if (self._scrollTop >= total) {
                            self.complete();
                        } else {
                            _w.scrollTo({ top: self._scrollTop, behavior: 'smooth' });
                            self._timer = setTimeout(scroll, self.jitter(100));
                        }
                    } catch (e) { self.complete(); }
                };
                scroll();
            } catch (e1) {
                this.complete();
            }
        },
        //===== 读完 =====
        complete: function () {
            var self = this;
            try { this.stop(); } catch (e) { }
            this._running = false;
            this.log('正文已读完（超星按真实浏览时长判定，脚本不发任何完成上报）', 'green');
            //通知顶层（同一标签页里的其它页面可以据此继续）
            try { _w.top.unrivalReadDone = 1; } catch (e1) { }
            //页面里有「下一章」按钮就点它（与参考实现一致）
            try {
                setTimeout(function () {
                    try {
                        for (var i = 0; i < self.NEXT_SELECTORS.length; i++) {
                            var btn = _d.querySelector(self.NEXT_SELECTORS[i]);
                            if (btn) {
                                self.log('找到「下一章」按钮，正在跳转', 'green');
                                btn.click();
                                return;
                            }
                        }
                        self.log('没有找到「下一章」按钮，阅读结束', 'gray');
                    } catch (e2) { }
                }, 2000);
            } catch (e3) { }
        },
        stop: function () {
            try { if (this._timer) { clearTimeout(this._timer); this._timer = null; } } catch (e) { }
            this._running = false;
        },
        //===== 目录页：自动找到阅读入口并点进去 =====
        autoJump: function () {
            var self = this;
            try {
                if (this._observer) return;
                this.log('检测到阅读任务目录页，准备进入正文', 'blue');
                this._observer = new MutationObserver(function () {
                    try {
                        var link = _d.querySelector(self.LINK_SELECTORS);
                        if (link) {
                            self.log('找到阅读入口，正在进入', 'green');
                            try { self._observer.disconnect(); } catch (e) { }
                            self._observer = null;
                            link.click();
                        }
                    } catch (e1) { }
                });
                this._observer.observe(_d.body, { childList: true, subtree: true });
                this._jumpTimer = setTimeout(function () {
                    try { if (self._observer) { self._observer.disconnect(); self._observer = null; } } catch (e) { }
                    self.log('目录页等待阅读入口超时，停止监听', 'orange');
                }, 60000);
            } catch (e) { }
        },
        //===== 启动 =====
        start: function () {
            var self = this;
            try {
                if (!this.enabled()) return;             // 默认关闭
                var href = '';
                try { href = String(_w.location.href || ''); } catch (e0) { href = ''; }
                if (this.isReadingTaskPage(href)) { this.autoJump(); return; }
                if (!this.isReadingPage(href)) return;
                //正文可能异步加载：多试几次，拿到内容再开始
                var tries = 0;
                var tryStart = function () {
                    tries++;
                    var n = self.collectContent();
                    if (n > 0) {
                        self._running = true;
                        self.log('开始阅读：共 ' + n + ' 个内容元素', 'blue');
                        if (self.mode() == 'page') self.pageScroll(); else self.scrollToNext();
                        return;
                    }
                    if (tries < 6) { setTimeout(tryStart, 1500); return; }
                    self.log('没找到正文内容，放弃（这页可能不是阅读正文页）', 'orange');
                };
                setTimeout(tryStart, 800);
            } catch (e) {
                console.log(e);
            }
        }
    };
    try {
        readAssist.start();
    } catch (e) {
        console.log(e);
    }
    //==================== v1.11.1 阅读助手结束 ====================
