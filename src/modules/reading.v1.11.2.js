    //==================== v1.11.2 阅读助手开始 ====================
    // 【v1.11.2 相比 v1.11.1 改了什么】
    //   ① 每段停留秒数的**默认值从 1 秒改成 10 秒**；
    //      老用户如果还停在 v1.11.1 的默认值 1 秒上，升级时自动改成 10 秒，
    //      自己设过别的值的一律不动（见 migrate）。
    //   ② **把整篇读完**：超星的正文页是往下滚才加载出后面的内容，
    //      v1.11.1 只在开头收集一次元素，读完那一批就结束 ——
    //      后半篇根本没读到。现在读完一批之后会去页面底部触发懒加载，
    //      等新内容出来就接着读，**一直读到再也加载不出新内容为止**。
    //   ③ 日志按 v1.11.2 的规范统一成「[阅读] …」。
    //
    // 【它做什么】
    //   · 在「阅读正文页」（/ztnodedetailcontroller/visitnodedetail）：
    //     收集正文元素（段落/标题/图/视频），逐个滚过去，直到读完（含懒加载出来的）；
    //   · 在「阅读任务目录页」（/mooc-ans/zt/portal/ 等）：自动找到目录里的阅读入口并点进去；
    //   · 读完：写日志；页面里有「下一章」按钮时点它（与参考实现一致）。
    //
    // 【重要边界 —— 写清楚，别让人误以为能秒过】
    //   全程**不发任何完成上报请求**（与参考实现一致）：
    //   超星是按**真实浏览时长**判定阅读任务完成的，脚本只能把内容真的滚过去 ——
    //   读多久就是多久，不能加速、不能秒过。
    //   任务点已经亮过（这一节之前读过了）也一样照读 —— 这是用户要的效果：
    //   按面板上的「每段 N 秒」把整篇再滚一遍，把阅读时长拉满。
    //
    // 【默认关闭】
    //   开关 unrivalReadAssist（面板「附加功能」里），默认 '0'。
    //   关掉开关会立刻停止正在进行的滚动（每一步都会检查开关）。
    var readAssist = {
        KEY: 'unrivalReadAssist',
        SPEED_KEY: 'unrivalReadSpeed',     // 每个段落停留多少秒（默认 10）
        SPEED_VER_KEY: 'unrivalReadSpeedVer', // 迁移标记：只为一次性把旧默认值改成 10
        MODE_KEY: 'unrivalReadMode',       // 'paragraph'（逐段，默认）| 'page'（整页）
        OLD_DEFAULT_SPEED: 1,              // v1.11.1 的默认值
        DEFAULT_SPEED: 10,                 // v1.11.2 起：默认每段 10 秒
        MIN_SPEED: 0.3,
        MAX_SPEED: 10,
        EXTEND_TRIES: 6,                    // 最多连续尝试 6 次拉新内容（每次等 1.5 秒）
        EXTEND_WAIT: 1500,                  // 每次等待懒加载的时间（毫秒）
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
        _seen: [],
        _index: 0,
        _extendTries: 0,
        _timer: null,
        _jumpTimer: null,
        _observer: null,
        _running: false,
        //===== 开关与参数 =====
        enabled: function () {
            try { return GM_getValue(this.KEY, '0') == '1'; } catch (e) { return false; }
        },
        //一次性迁移：只有「还停在 v1.11.1 的默认值 1 秒」时才改成 10 秒，
        //用户自己设过的值（5 秒、0.5 秒…）一律不动。
        migrate: function () {
            try {
                if (GM_getValue(this.SPEED_VER_KEY, '') === '1.11.2') return false;
                var raw = GM_getValue(this.SPEED_KEY, '');
                var v = parseFloat(raw);
                if (!raw || isNaN(v) || v === this.OLD_DEFAULT_SPEED) {
                    GM_setValue(this.SPEED_KEY, String(this.DEFAULT_SPEED));
                }
                GM_setValue(this.SPEED_VER_KEY, '1.11.2');
                return true;
            } catch (e) { return false; }
        },
        speed: function () {
            try {
                this.migrate();
                var v = parseFloat(GM_getValue(this.SPEED_KEY, String(this.DEFAULT_SPEED)));
                if (isNaN(v) || v <= 0) v = this.DEFAULT_SPEED;
                if (v < this.MIN_SPEED) v = this.MIN_SPEED;
                if (v > this.MAX_SPEED) v = this.MAX_SPEED;
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
                if (typeof dbg != 'undefined' && dbg && dbg.log) dbg.log('info', msg);
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
        //===== 扫一遍正文元素（过滤 + 按位置排序）=====
        scanElements: function () {
            var root = this.contentRoot();
            if (!root) return [];
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
            return list;
        },
        //===== 收集正文元素（开头用，整篇重来一次）=====
        collectContent: function () {
            try {
                var list = this.scanElements();
                this._elements = list;
                this._seen = list.slice(0);
                this._index = 0;
                this._extendTries = 0;
                return list.length;
            } catch (e) {
                return 0;
            }
        },
        //===== 增量收集：把「之前没见过的新元素」接到队尾 =====
        //  超星正文页往下滚会懒加载出之前没有的段落，
        //  只在开头收集一次会漏掉后半篇，所以每读完一批就再扫一遍。
        refreshContent: function () {
            try {
                var list = this.scanElements();
                var added = 0;
                for (var i = 0; i < list.length; i++) {
                    var el = list[i];
                    if (this._seen.indexOf(el) >= 0) continue;
                    this._seen.push(el);
                    this._elements.push(el);
                    added++;
                }
                return added;
            } catch (e) {
                return 0;
            }
        },
        //每个段落的停留时间加一点随机（避免节奏太机械，上下浮动 10%）
        jitter: function (baseMs) {
            return Math.max(200, Math.round(baseMs * (0.9 + Math.random() * 0.2)));
        },
        //===== 逐段阅读 =====
        scrollToNext: function () {
            var self = this;
            try {
                if (!this.enabled()) { this.stop(); return; }
                if (this._index >= this._elements.length) { this.extend(); return; }
                var el = this._elements[this._index];
                try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { }
                this._index++;
                this._timer = setTimeout(function () { self.scrollToNext(); }, this.jitter(this.speed() * 1000));
            } catch (e1) {
                this.complete();
            }
        },
        //===== 读到加载不出来为止 =====
        //  读完当前这一批之后：滚到页面底部触发懒加载 → 等一会儿 → 再扫一遍。
        //  扫出新内容就接着读；连着几次都扫不出新内容，才算真的读到底了。
        extend: function () {
            var self = this;
            try {
                if (!this.enabled()) { this.stop(); return; }
                if (this._extendTries >= this.EXTEND_TRIES) {
                    this.log('已经读到底：连续 ' + this.EXTEND_TRIES + ' 次尝试都没有再加载出新内容', 'green');
                    this.complete();
                    return;
                }
                this._extendTries++;
                //滚到页面底部，触发懒加载
                try {
                    var h = _d.documentElement ? _d.documentElement.scrollHeight : 0;
                    if (h) _w.scrollTo({ top: h, behavior: 'smooth' });
                } catch (e) { }
                this._timer = setTimeout(function () {
                    try {
                        if (!self.enabled()) { self.stop(); return; }
                        var added = self.refreshContent();
                        if (added > 0) {
                            self._extendTries = 0;
                            self.log('页面又加载出 ' + added + ' 段新内容，继续往下读', 'blue');
                            self.scrollToNext();
                            return;
                        }
                        //还没加载出来：再等一轮
                        self.extend();
                    } catch (e1) { self.complete(); }
                }, self.EXTEND_WAIT);
            } catch (e) {
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
            this.log('正文已读完（超星按真实浏览时长判定，脚本不发任何完成上报请求）', 'green');
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
                        self.log('开始阅读：共 ' + n + ' 个内容元素，每段停留 ' + self.speed() + ' 秒', 'blue');
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
    //==================== v1.11.2 阅读助手结束 ====================
