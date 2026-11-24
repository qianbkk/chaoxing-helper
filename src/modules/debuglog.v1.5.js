    //==================== v1.5 调试日志模块开始 ====================
    // 【为什么加这个】
    //   脚本的「运行日志」面板只存在于超星页面里，而脚本每翻一章就 reload 一次页面，
    //   日志随之被清空 —— 想抓某一章的日志只能靠截图抢那一帧，经常抓不到。
    //   这个模块把面板里的每一行日志**实时发到本机 HTTP 接收端**，
    //   由 node src/tools/log-sink.cjs 落盘成文件，命令行里 tail 一下就有完整记录。
    //
    // 【怎么用】
    //   1) 在项目根目录起接收端：node src/tools/log-sink.cjs
    //      （默认 http://127.0.0.1:8124，日志写到 logs/debug-<时间戳>.log）
    //   2) 面板「调试模式」区块勾选「调试模式」并保存（默认关闭）
    //   3) 之后脚本每一条日志都会实时落盘；换页/翻章不会丢
    //
    // 【边界】
    //   · 走 GM_xmlhttpRequest（扩展特权通道），不受 https 页面→http 本机的混合内容限制；
    //     脚本元数据里已有 `// @connect *`，无需再改 connect 列表。
    //   · 只往外发日志文本，不发 AI Key / 题库 Token —— 发送前统一不过滤，
    //     但面板里的日志本来就不含这些敏感值（Key 只存在输入框里，不进日志）。
    //   · 接收端不可达时静默重试，不影响脚本本身运行。
    var dbg = {
        cfg: {
            enabled: GM_getValue('unrivalDbgEnabled', '0') == '1',
            sink: GM_getValue('unrivalDbgSink', 'http://127.0.0.1:8124'),
            flushMs: 1200,
            maxBatch: 60
        },
        _queue: [],
        _pending: null,
        _timer: null,
        _attached: false,
        _failCount: 0,
        _ctx: '',
        _url: '',
        _ver: (GM_info && GM_info.script && GM_info.script.version) || 'unknown',
        setCtx: function (s) {
            this._ctx = String(s || '');
        },
        _now: function () {
            return new Date().toISOString();
        },
        log: function (level, msg) {
            if (!this.cfg.enabled) return;
            try {
                this._queue.push({
                    t: this._now(),
                    lv: String(level || 'info'),
                    ch: this._ctx,
                    msg: String(msg == null ? '' : msg).replace(/\s+/g, ' ').trim()
                });
                if (this._queue.length >= this.cfg.maxBatch) {
                    this.flush();
                } else {
                    this._schedule();
                }
            } catch (e) { }
        },
        _schedule: function () {
            if (this._timer) return;
            var self = this;
            this._timer = setTimeout(function () {
                self._timer = null;
                self.flush();
            }, this.cfg.flushMs);
        },
        flush: function () {
            if (!this.cfg.enabled) return;
            try {
                if (!this._pending && this._queue.length) {
                    this._pending = this._queue.splice(0, this._queue.length);
                }
                if (!this._pending || !this._pending.length) return;
                var batch = this._pending;
                var self = this;
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: String(this.cfg.sink || '').replace(/\/+$/, '') + '/__log',
                    headers: { 'Content-Type': 'application/json' },
                    data: JSON.stringify({
                        type: 'lines',
                        v: this._ver,
                        url: this._url,
                        lines: batch
                    }),
                    timeout: 5000,
                    onload: function () {
                        self._failCount = 0;
                        self._pending = null;
                        if (self._queue.length) self._schedule();
                    },
                    onerror: function (err) {
                        self._fail(err && err.error ? err.error : 'error');
                    },
                    ontimeout: function () {
                        self._fail('timeout');
                    }
                });
            } catch (e) {
                this._fail(String(e));
            }
        },
        _fail: function (err) {
            this._failCount++;
            try {
                if (this._failCount == 1) console.warn('[调试日志] 接收端不可达：' + err);
            } catch (e) { }
            // 连续失败 3 次就丢掉这一批，避免无限堆积占内存
            if (this._failCount > 3) {
                this._pending = null;
                this._failCount = 0;
            }
        },
        attach: function () {
            if (this._attached) return;
            try {
                var orig = logs.addLog;
                if (typeof orig != 'function') return;   // logs 还没定义好，等下一轮再挂
                var self = this;
                logs.addLog = function (str, color) {
                    try { self.log(color || 'info', str); } catch (e) { }
                    return orig.apply(this, arguments);
                };
                this._attached = true;
                this.log('info', '页面就绪：脚本 ' + this._ver + ' | ' + this._url);
                // 回填：挂上之前已经产生的日志（上游最多留 50 条在 logArry 里）
                var arr = logs.logArry || [];
                for (var i = 0; i < arr.length; i++) {
                    try {
                        var txt = String(arr[i])
                            .replace(/<br\s*\/?>/gi, ' ')
                            .replace(/<[^>]*>/g, '')
                            .replace(/&nbsp;/g, ' ')
                            .trim();
                        if (txt) this.log('backfill', txt);
                    } catch (e) { }
                }
            } catch (e) { }
        },
        init: function () {
            try {
                // _l 有时取不到 href（不同分支里定义不同），这里多路兜底
                var href = '';
                try { if (typeof location != 'undefined') href = String(location.href || ''); } catch (e) { }
                if (!href) { try { href = String(_l && _l.href || ''); } catch (e2) { } }
                if (!href) { try { href = String(_w && _w.location && _w.location.href || ''); } catch (e3) { } }
                this._url = href;
                var m = href.match(/chapterId=(\d+)/);
                var title = '';
                try { title = String(_d.title || ''); } catch (e4) { }
                this.setCtx('chapter=' + (m ? m[1] : '?') + ' | ' + title);
            } catch (e) { }
            this.attach();
            var self = this;
            // logs 在脚本体内较后面才赋值，这里补两次挂载
            setTimeout(function () { self.attach(); }, 0);
            setTimeout(function () { self.attach(); }, 400);
            try {
                _w.addEventListener('error', function (e) {
                    dbg.log('jserror', (e.message || 'error') + ' @ ' + (e.filename || '') + ':' + (e.lineno || ''));
                });
            } catch (e) { }
        }
    };
    try {
        dbg.init();
    } catch (e) {
        console.log(e);
    }
    //==================== v1.5 调试日志模块结束 ====================
