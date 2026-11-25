//==================== v1.11.3 多源免费题库开始 ====================
    // 【这一版为什么做】
    //   v1.11.2 之前，题库只有一条路：POST https://cx.icodef.com/wyn-nb?v=4。
    //   2026-11-25 把这条链路逐条量了一遍，量出五个硬伤：
    //
    //   ① **限流被当成失败**。icodef 是「1 并发」限制（实测：间隔 1.0 秒连发，
    //      第二次就返回 code:-2「触发流控限制」；间隔 1.5 秒以上稳定）。
    //      而老代码把 code:-2（流控）**和** code:-1（题库没收录）都算进
    //      「题库查题失败」→ 连续 3 次就熔断 10 分钟。
    //      结果：题库里没有这道题（很正常）也算失败，3 道没收录的题
    //      就能把题库整个关掉 10 分钟，后面全靠 AI 或随机兜底。
    //   ② **答不全**。icodef 返回的常常是**整句**（如「我国的根本政治制度是
    //      人民代表大会制度。」），老代码按「首个包含匹配」选；单选题一旦句子里
    //      出现多个选项文字就会勾错，多选还把 `#` 分隔的**多条答案陈述**
    //      当成「全部正确选项」一起勾上。
    //   ③ **判断题同义没覆盖**。返回「正确/错/√/×/对/否」，而选项写「错误」时
    //      就失配，掉进随机兜底。
    //   ④ **只有一个源**。源挂了、限流了、没收录，就只能等 AI；没有 AI 时
    //      整条链路基本废掉。
    //   ⑤ **查过的题还反复查**。同一个知识点在多章、多套卷子里重复出现，
    //      每一次都重新走一遍网络，还把限流额度一次次耗掉。
    //
    // 【这一版怎么做】
    //   · **三个免费源一起查**，主源并行、备用源兜底：
    //       - icodef（cx.icodef.com）—— 主源，实测**匿名可用，不需要 token**；
    //       - 百度不挂科（easylearn.baidu.com）—— **零密钥**，覆盖全学科；
    //       - icodef（q.icodef.com）—— 同一服务的另一个 host，
    //         **只在主源全败后才试**（实测它与主源共享 IP 每日限额，
    //         并行去查会白白吃掉主源的额度，所以降级成备用）。
    //   · **答案 → 选项改成打分制**：不再「首个包含就算命中」，而是给每个选项
    //     打分（完全相等 1.0 / 包含按长度占比 / 相似度按字符重合），
    //     低于阈值不算命中；单选题只取最高分那一个（修掉「勾多个」）；
    //   · **判断题走同义表**（正确/对/√/是/true ↔ 错误/错/×/否/false）；
    //   · **失败分类**：未收录(-1) 不算失败、流控(-2) 退避重试而不是熔断、
    //     只有网络错误/超时才计入熔断；
    //   · **每源限流节流**（默认 2 秒，实测 1.5 秒以上才稳）与**命中缓存**
    //     （同题不重复问，跨章节/重做都复用，GM 存储 400 条）。
    //
    // 【边界】
    //   · 这三个源都是**第三方搜题服务**，不是超星官方题库，也不提供任何
    //     「完成上报」—— 本模块只负责把答案**找回来**，对不上的题照样交给
    //     AI 或随机兜底。
    //   · 题库 Token 现在是**选填**：实测不带 token 也能查到（token 只影响
    //     并发额度），面板里也照旧可以填。
    //   · 只读查询：不写超星任何数据，不替用户提交。
    var ctBank = {
        VERSION: 'v1.11.3',
        //===== 三个免费源（都不需要付费凭证）=====
        //primary=true 的并行查；primary=false 的只在主源全败后兜底
        SOURCES: [
            { id: 'icodef-cx', name: 'icodef', kind: 'icodef', url: 'https://cx.icodef.com/wyn-nb?v=4', primary: true },
            { id: 'baidu', name: '百度不挂科', kind: 'baidu', url: 'https://easylearn.baidu.com/edu-web-go/bgk/searchlist', primary: true },
            { id: 'icodef-q', name: 'icodef备用', kind: 'icodef', url: 'https://q.icodef.com/wyn-nb?v=4', primary: false }
        ],
        //===== 节流与超时 =====
        MIN_INTERVAL: 2000,      // 单源最小请求间隔（毫秒）—— 实测 <1.5s 会撞 1 并发限制
        TIMEOUT: 8000,           // 单次请求超时（毫秒）
        THROTTLE_RETRY: 2,       // 流控后的重试次数
        BACKOFF: [2500, 6000],   // 流控重试的退避间隔（毫秒）
        //===== 熔断（只有网络错误/超时才触发，未收录不触发）=====
        BRK_LIMIT: 3,            // 连续真失败次数
        BRK_COOLDOWN: 600000,    // 熔断时长（毫秒）
        //===== 匹配阈值 =====
        MATCH_MIN: 0.62,         // 选项匹配置信度下限，低于它算「没匹配上」
        STEM_MIN: 0.70,          // 题干相似度初筛下限（百度源噪声大，靠这个先挡一轮）
        //===== 缓存 =====
        CACHE_KEY: 'unrivalCtCache',
        CACHE_MAX: 400,
        FAIL_KEY: 'unrivalCtBankFail',
        OFF_KEY: 'unrivalCtBankOffUntil',
        _cache: null,
        _lastAt: {},             // 每源上次请求时间
        _failStreak: 0,          // 连续网络失败次数
        _offUntil: 0,            // 熔断截止时间
        lastSource: '',          // 最近一次命中的源名（日志用）
        //===== 统计（调试状态用）=====
        stats: { hit: 0, miss: 0, throttle: 0, error: 0, cacheHit: 0, off: 0 },
        //==================== 初始化（熔断状态持久化）====================
        init: function () {
            try {
                this._failStreak = parseInt(GM_getValue(this.FAIL_KEY, '0'), 10) || 0;
                this._offUntil = parseInt(GM_getValue(this.OFF_KEY, '0'), 10) || 0;
            } catch (e) { }
            return this;
        },
        //==================== 文本工具（纯函数，可单测）====================
        //全角转半角
        toHalf: function (s) {
            return String(s == null ? '' : s).replace(/[\uFF01-\uFF5E]/g, function (ch) {
                return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
            }).replace(/\u3000/g, ' ');
        },
        //归一化：去空白、去题型前缀、去序号前缀、去标点、小写
        norm: function (s) {
            if (s == null) return '';
            var t = this.toHalf(s);
            t = String(t).replace(/\s+/g, '');
            t = t.replace(/^【[^】]*】/, '');            // 【单选题】
            t = t.replace(/^[A-Ha-h][.、．)）:：]\s*/, '');  // A. / B、 / C)
            t = t.replace(/^[（(]\s*[A-Ha-h]\s*[)）]\s*/, ''); // (A)
            t = t.replace(/^[0-9]{1,2}[.、．)）]\s*/, '');      // 1. / 2、
            t = t.replace(/[“”‘’"'「」『』《》〈〉【】（）()\[\]{}，。！？；：、,.!?;:\-—_·…]/g, '');
            return t.toLowerCase();
        },
        //相似度 0~1：包含关系给高分，否则用二元组 Dice 与长度比
        sim: function (a, b) {
            var x = this.norm(a), y = this.norm(b);
            if (!x || !y) return 0;
            if (x === y) return 1;
            if (x.indexOf(y) >= 0 || y.indexOf(x) >= 0) {
                return 0.90 + 0.10 * (Math.min(x.length, y.length) / Math.max(x.length, y.length));
            }
            //二元组 Dice：common = 两个串都出现过的相邻字符对数量（按出现次数配对）
            var cnt = {}, i, g, inter = 0;
            for (i = 0; i < x.length - 1; i++) { g = x.substr(i, 2); cnt[g] = (cnt[g] || 0) + 1; }
            for (i = 0; i < y.length - 1; i++) {
                g = y.substr(i, 2);
                if (cnt[g] > 0) { inter++; cnt[g]--; }
            }
            var total = Math.max(1, (x.length - 1) + (y.length - 1));
            var dice = (2 * inter) / total;
            var lenRatio = Math.min(x.length, y.length) / Math.max(x.length, y.length);
            return Math.max(dice * 0.9, dice * lenRatio);
        },
        //极性词：true / false / null（「正确」与「错误」不能互相命中）
        polarity: function (t) {
            if (/^(不正确|不对|不是|错误|错|否|×|x|false|no|f|n)$/.test(t)) return 'false';
            if (/^(正确|对|是|√|true|yes|t|y)$/.test(t)) return 'true';
            return null;
        },
        //否定词前缀：{neg:是否带否定, core:去掉否定词后的核心文字}
        negCore: function (t) {
            var m = /^(不|非|无|没|未)/.exec(t);
            if (!m) return { neg: false, core: t };
            return { neg: true, core: t.slice(m[0].length) };
        },
        //选项文本 vs 答案文本的置信度（0~1）
        scoreOption: function (optText, ansText) {
            var o = this.norm(optText), a = this.norm(ansText);
            if (!o || !a) return 0;
            if (o === a) return 1;
            //极性冲突：一个说「对」一个说「错」 → 一律不算命中
            var pA = this.polarity(a), pO = this.polarity(o);
            if (pA && pO && pA !== pO) return 0;
            //否定词防护：核心文字相同、一个带否定一个不带 → 不算命中
            var nA = this.negCore(a), nO = this.negCore(o);
            if (nA.neg !== nO.neg && nA.core && nO.core &&
                (nA.core === nO.core || nA.core.indexOf(nO.core) >= 0 || nO.core.indexOf(nA.core) >= 0)) return 0;
            if (a.indexOf(o) >= 0) {
                //答案句里包含选项文字：选项越长占比越高越可信
                return 0.70 + 0.25 * (o.length / a.length);
            }
            if (o.indexOf(a) >= 0) {
                //选项比答案长（如答案"1921"、选项"1921年"）
                return 0.62 + 0.20 * (a.length / o.length);
            }
            return this.sim(o, a) * 0.80;
        },
        //判断题：答案文本 → 'true' / 'false' / null
        judgeVal: function (ansText) {
            var t = this.norm(ansText);
            if (!t) return null;
            //完整同义词（先判「错」再判「对」，避免「不正确」被当成「正确」）
            if (/^(错误|错|否|不正确|不对|不是|×|x|false|no|f|n)$/.test(t)) return 'false';
            if (/^(正确|对|是|√|true|yes|t|y)$/.test(t)) return 'true';
            //含关键词（"说法正确" / "说法错误"）
            if (/不正确|不对|不是|错误|错|×/.test(t)) return 'false';
            if (/正确|说法对/.test(t)) return 'true';
            return null;
        },
        //把题库返回的多段答案拆开（# 是「多条答案陈述」，不是「全部正确选项」）
        splitAnswers: function (data) {
            var parts = String(data == null ? '' : data).split('#');
            var out = [];
            for (var i = 0; i < parts.length; i++) {
                var p = String(parts[i] || '').trim();
                if (p) out.push(p);
            }
            return out;
        },
        //==================== 答案 → 选项（打分制，纯函数，可单测）====================
        //返回 {idxs:[下标], score:最高分, how:'text'|'judge'}
        matchText: function (ansText, options, typeName) {
            var res = { idxs: [], score: 0, how: '' };
            if (!ansText || !options || !options.length) return res;
            //判断题：先走同义表
            if (typeName === '判断题') {
                var jv = this.judgeVal(ansText);
                if (jv) {
                    var hitJ = -1;
                    for (var i = 0; i < options.length; i++) {
                        var o = options[i] || {};
                        var ot = this.norm(o.text || '');
                        var val = this.norm(o.val || '');      // val-param：true/false
                        if (val && val === jv) { hitJ = i; break; }
                        if (jv === 'true' && /^(正确|对|是|√|true|yes|t|y)$/.test(ot)) { hitJ = i; break; }
                        if (jv === 'false' && /^(错误|错|否|×|false|no|f|n)$/.test(ot)) { hitJ = i; break; }
                    }
                    if (hitJ >= 0) { res.idxs = [hitJ]; res.score = 1; res.how = 'judge'; return res; }
                    //没有同义选项就退回文本匹配
                }
            }
            return this._matchByText(ansText, options, typeName);
        },
        //按文本打分匹配（多段答案分别映射；单选只取最高分那一个）
        _matchByText: function (ansText, options, typeName) {
            var res = { idxs: [], score: 0, how: 'text' };
            var parts = this.splitAnswers(ansText);
            if (!parts.length) parts = [String(ansText)];
            var isMulti = (typeName === '多选题');
            var picked = [], bestScore = 0, bestIdx = -1;
            for (var p = 0; p < parts.length; p++) {
                var part = String(parts[p]).trim();
                if (!part) continue;
                //整段只有字母（题库只给了选项字母）时走字母兜底
                if (/^[A-Ha-h]$/.test(part) || (isMulti && /^[A-Ha-h\s,、.．;；]+$/.test(part))) {
                    var letters = part.replace(/[^A-Ha-h]/g, '').toUpperCase();
                    for (var q = 0; q < letters.length; q++) {
                        var li = -1;
                        for (var k = 0; k < options.length; k++) {
                            if (String((options[k] || {}).letter || '').toUpperCase() === letters.charAt(q)) { li = k; break; }
                        }
                        if (li >= 0) {
                            picked.push(li);
                            if (0.60 > bestScore) { bestScore = 0.60; bestIdx = li; }
                        }
                    }
                    continue;
                }
                //逐选项打分
                var scored = [];
                for (var i = 0; i < options.length; i++) {
                    var sc = this.scoreOption((options[i] || {}).text || '', part);
                    if (sc >= this.MATCH_MIN) scored.push({ i: i, s: sc });
                }
                if (!scored.length) continue;
                scored.sort(function (a, b) { return b.s - a.s; });
                if (isMulti) {
                    //多选：一段答案里可能同时提到多个正确选项，全部收下
                    for (var m = 0; m < scored.length; m++) {
                        picked.push(scored[m].i);
                        if (scored[m].s > bestScore) { bestScore = scored[m].s; bestIdx = scored[m].i; }
                    }
                } else {
                    //单选/判断：只取最高分那一个（修掉「一句话勾多个」）
                    picked.push(scored[0].i);
                    if (scored[0].s > bestScore) { bestScore = scored[0].s; bestIdx = scored[0].i; }
                }
            }
            if (!picked.length) return res;
            var uniq = [];
            for (var u = 0; u < picked.length; u++) if (uniq.indexOf(picked[u]) < 0) uniq.push(picked[u]);
            res.score = bestScore;
            res.how = 'text';
            //单选/判断题永远只出一个选项（最高分那个）
            res.idxs = isMulti ? uniq : (bestIdx >= 0 ? [bestIdx] : [uniq[0]]);
            return res;
        },
        //==================== 缓存 =====
        cacheLoad: function () {
            if (this._cache) return this._cache;
            this._cache = {};
            try {
                var raw = GM_getValue(this.CACHE_KEY, '');
                if (raw) {
                    var o = JSON.parse(raw);
                    if (o && typeof o === 'object') this._cache = o;
                }
            } catch (e) { this._cache = {}; }
            return this._cache;
        },
        cacheKey: function (question, typeName) {
            return (typeName || '') + '|' + this.norm(question);
        },
        cacheGet: function (question, typeName) {
            var c = this.cacheLoad();
            var hit = c[this.cacheKey(question, typeName)];
            if (hit && hit.data) { this.stats.cacheHit++; return hit; }
            return null;
        },
        cacheSet: function (question, typeName, data, src) {
            try {
                var c = this.cacheLoad();
                c[this.cacheKey(question, typeName)] = { data: String(data), src: String(src || ''), t: Date.now() };
                var keys = Object.keys(c);
                if (keys.length > this.CACHE_MAX) {
                    //按时间丢掉最旧的
                    keys.sort(function (a, b) { return (c[a].t || 0) - (c[b].t || 0); });
                    for (var i = 0; i < keys.length - this.CACHE_MAX; i++) { delete c[keys[i]]; }
                }
                GM_setValue(this.CACHE_KEY, JSON.stringify(c));
            } catch (e) { }
        },
        cacheClear: function () {
            try { GM_setValue(this.CACHE_KEY, ''); } catch (e) { }
            this._cache = {};
        },
        //==================== 熔断（只有网络错误/超时才触发）====================
        off: function () {
            return Date.now() < this._offUntil;
        },
        _noteError: function () {
            this._failStreak++;
            try { GM_setValue(this.FAIL_KEY, String(this._failStreak)); } catch (e) { }
            if (this._failStreak >= this.BRK_LIMIT) {
                this._offUntil = Date.now() + this.BRK_COOLDOWN;
                try { GM_setValue(this.OFF_KEY, String(this._offUntil)); } catch (e) { }
                this._failStreak = 0;
                this.stats.off++;
            }
        },
        _noteOk: function () {
            if (this._failStreak) {
                this._failStreak = 0;
                try { GM_setValue(this.FAIL_KEY, '0'); } catch (e) { }
            }
        },
        //==================== 请求（多源）====================
        //cb({ok:true, data:答案文本, src:源名} | {ok:false, reason:'miss'|'throttle'|'error'|'timeout'|'off'})
        ask: function (question, typeName, cb, opt) {
            var self = this;
            opt = opt || {};
            if (this.off()) {
                this.stats.miss++;
                cb({ ok: false, reason: 'off' });
                return;
            }
            var cached = this.cacheGet(question, typeName);
            if (cached) {
                this.lastSource = cached.src || '缓存';
                cb({ ok: true, data: cached.data, src: this.lastSource, cached: true });
                return;
            }
            var done = false;
            var finish = function (r) {
                if (done) return;
                done = true;
                if (r && r.ok) {
                    self.stats.hit++;
                    self.lastSource = r.src || '';
                    self._noteOk();
                    self.cacheSet(question, typeName, r.data, r.src);
                } else {
                    self.stats.miss++;
                    //熔断按「题」计：一道题整体失败才算一次失败
                    if (r && r.reason === 'error') self._noteError();
                }
                cb(r);
            };
            var primary = [], backup = [];
            for (var i = 0; i < this.SOURCES.length; i++) {
                (this.SOURCES[i].primary ? primary : backup).push(this.SOURCES[i]);
            }
            this._askSources(primary, question, typeName, opt, function (r) {
                if (r && r.ok) { finish(r); return; }
                if (!backup.length) { finish(r); return; }
                //主源全败 → 才去试备用源（实测备用源与主源共享额度，不能并行查）
                self._askSources(backup, question, typeName, opt, function (r2) {
                    if (r2 && r2.ok) { finish(r2); return; }
                    var err = (r && (r.reason === 'error' || r.reason === 'timeout')) ||
                        (r2 && (r2.reason === 'error' || r2.reason === 'timeout'));
                    finish({ ok: false, reason: err ? 'error' : 'miss' });
                });
            });
        },
        //一组源并行查：谁先命中用谁；全败时按「有没有真错误」给结论
        _askSources: function (list, question, typeName, opt, cb) {
            var self = this;
            if (!list || !list.length) { cb({ ok: false, reason: 'miss' }); return; }
            var pending = list.length, finished = false, hadError = false;
            for (var i = 0; i < list.length; i++) {
                (function (src) {
                    var attempt = 0;
                    var tryOnce = function () {
                        self._throttle(src, question, typeName, opt, function (r) {
                            if (finished) return;
                            if (r && r.ok) { finished = true; cb(r); return; }
                            if (r && r.reason === 'throttle') {
                                //流控：退避重试，不算失败、不熔断
                                self.stats.throttle++;
                                attempt++;
                                if (attempt <= self.THROTTLE_RETRY) {
                                    var wait = self.BACKOFF[Math.min(attempt - 1, self.BACKOFF.length - 1)];
                                    setTimeout(tryOnce, wait);
                                    return;
                                }
                            }
                            if (r && (r.reason === 'error' || r.reason === 'timeout')) { hadError = true; self.stats.error++; }
                            pending--;
                            if (pending <= 0 && !finished) {
                                finished = true;
                                cb({ ok: false, reason: hadError ? 'error' : 'miss' });
                            }
                        });
                    };
                    tryOnce();
                })(list[i]);
            }
        },
        //每个源的最小间隔（实测 icodef 限流窗口 ~1.5s，这里留 2s 余量）
        _throttle: function (src, question, typeName, opt, cb) {
            var self = this;
            var last = this._lastAt[src.id] || 0;
            var wait = this.MIN_INTERVAL - (Date.now() - last);
            if (wait > 0) {
                setTimeout(function () { self._fire(src, question, typeName, opt, cb); }, wait);
            } else {
                this._fire(src, question, typeName, opt, cb);
            }
        },
        _fire: function (src, question, typeName, opt, cb) {
            this._lastAt[src.id] = Date.now();
            if (src.kind === 'icodef') this._askIcodef(src, question, typeName, opt, cb);
            else if (src.kind === 'baidu') this._askBaidu(src, question, cb);
            else cb({ ok: false, reason: 'error', src: src.name });
        },
        //---- icodef：POST 表单，Authorization 头带用户自己的 token（选填）----
        _askIcodef: function (src, question, typeName, opt, cb) {
            var typeCode = { '单选题': '0', '多选题': '1', '判断题': '3' };
            var param = 'question=' + encodeURIComponent(String(question || ''));
            if (typeCode[typeName]) param += '&type=' + typeCode[typeName] + '&id=' + (opt && opt.id ? opt.id : 1);
            var hdr = { 'Content-Type': 'application/x-www-form-urlencoded' };
            try { hdr['Authorization'] = (typeof token != 'undefined' && token) ? token : ''; } catch (e) { }
            try {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: src.url,
                    headers: hdr,
                    data: param,
                    timeout: this.TIMEOUT,
                    onload: function (res) {
                        var obj = null;
                        try { obj = JSON.parse(res.responseText); } catch (e) { }
                        var code = obj ? parseInt(obj.code, 10) : NaN;
                        if (code === 1 && obj.data) { cb({ ok: true, data: String(obj.data), src: src.name }); return; }
                        if (code === -2) { cb({ ok: false, reason: 'throttle', src: src.name }); return; }
                        if (code === -1) { cb({ ok: false, reason: 'miss', src: src.name }); return; }
                        cb({ ok: false, reason: 'error', src: src.name });
                    },
                    onerror: function () { cb({ ok: false, reason: 'error', src: src.name }); },
                    ontimeout: function () { cb({ ok: false, reason: 'timeout', src: src.name }); }
                });
            } catch (e) {
                cb({ ok: false, reason: 'error', src: src.name });
            }
        },
        //---- 百度不挂科：GET + XOR 解密（算法见 tikuAdapter 的 buguake.go，MIT）----
        _askBaidu: function (src, question, cb) {
            var self = this;
            var url = src.url + '?query=' + encodeURIComponent(String(question || '')) + '&rn=10&pn=0';
            try {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    timeout: this.TIMEOUT,
                    onload: function (res) {
                        var out = self._parseBaidu(res.responseText, question || '');
                        if (out) { cb({ ok: true, data: out, src: src.name }); return; }
                        cb({ ok: false, reason: 'miss', src: src.name });
                    },
                    onerror: function () { cb({ ok: false, reason: 'error', src: src.name }); },
                    ontimeout: function () { cb({ ok: false, reason: 'timeout', src: src.name }); }
                });
            } catch (e) {
                cb({ ok: false, reason: 'error', src: src.name });
            }
        },
        //百度返回体解密：base64 → 与 key 循环 XOR → 相邻字节成对 XOR → URI 反转义
        _decryptBaidu: function (b64, actk) {
            try {
                var key = '34cab29ef956d78afd' + (actk || '');
                var bin = atob(String(b64 || ''));
                var i, o = 0, buf = [];
                for (i = 0; i < bin.length; i++) {
                    o = o % key.length;
                    buf[i] = bin.charCodeAt(i) ^ key.charCodeAt(o);
                    o++;
                }
                var out = '';
                for (i = 0; i < buf.length - 1; i++) {
                    out += String.fromCharCode(buf[i] ^ buf[i + 1]);
                    i++;
                }
                try { out = decodeURIComponent(out.replace(/\+/g, ' ')); } catch (e) { out = out.replace(/\+/g, ' '); }
                return out;
            } catch (e) { return ''; }
        },
        //取富文本节点数组里的文字
        _richText: function (nodes) {
            var out = '';
            if (!nodes || !nodes.length) return out;
            for (var i = 0; i < nodes.length; i++) {
                var n = nodes[i];
                if (typeof n === 'string') { out += n; continue; }
                if (!n || typeof n !== 'object') continue;
                if (typeof n.c === 'string') out += n.c;
                else if (Array.isArray(n.c)) out += this._richText(n.c);
            }
            return out;
        },
        //取百度的选项数组（que_options 是二维数组：que_options[0] 才是选项）
        _baiduOptions: function (dec) {
            var out = [];
            var qo = dec.que_options || [];
            var arr = null;
            if (Array.isArray(qo) && qo.length) {
                if (Array.isArray(qo[0])) arr = qo[0];
                else if (qo[0] && typeof qo[0] === 'object') arr = qo;
            }
            if (!arr) return out;
            for (var i = 0; i < arr.length; i++) {
                var o = arr[i] || {};
                var ret = Array.isArray(o.ret) ? o.ret : [];
                var text = this._richText((ret[0] || {}).c || []);
                out.push({ text: String(text || '').trim(), yes: !!o.yes });
            }
            return out;
        },
        //取百度的答案文本（que_answer 可能是 [[...]] 或 [{...}] 两种形态）
        _baiduAnswerText: function (dec) {
            var qa = dec.que_answer || [];
            if (!qa.length) return '';
            var node = qa[0];
            if (Array.isArray(node)) node = node[0];
            if (!node) return '';
            return String(this._richText(node.c || []) || '').trim();
        },
        //百度的答案：优先用「正确选项的文字」（yes=true），这样与超星选项按文字对齐，
        //不受两边选项顺序不同的影响（超星会打乱选项顺序，返回字母会答错）
        _baiduAnswer: function (dec, opts) {
            var yesList = [];
            for (var i = 0; i < opts.length; i++) if (opts[i].yes && opts[i].text) yesList.push(opts[i].text);
            if (yesList.length) return yesList.join('#');
            var at = this._baiduAnswerText(dec);
            if (!at) return '';
            //答案只有字母时，按百度的选项顺序还原成选项文字
            var m = at.match(/^([A-Ha-h])\s*[.、．)）:：]?\s*(.*)$/);
            if (m && opts.length) {
                var idx = m[1].toUpperCase().charCodeAt(0) - 65;
                if (idx >= 0 && idx < opts.length && opts[idx].text) return opts[idx].text;
            }
            return at;
        },
        //解析百度的返回，挑出最像的一道题并取出答案文本
        _parseBaidu: function (text, question) {
            var obj = null;
            try { obj = JSON.parse(text); } catch (e) { return ''; }
            var list = (obj && obj.data && obj.data.list) || [];
            var bestScore = 0, bestAns = '';
            for (var i = 0; i < list.length; i++) {
                var it = list[i] || {};
                var dec = null;
                try { dec = JSON.parse(this._decryptBaidu(it.bdjson || '', it.actk || '')); } catch (e) { continue; }
                if (!dec || typeof dec !== 'object') continue;
                var stem = this._richText(((dec.que_stem || [])[0] || {}).c || []);
                if (!stem) continue;
                var sc = this.sim(question, stem);
                if (sc < this.STEM_MIN) continue;
                var opts = this._baiduOptions(dec);
                var ans = this._baiduAnswer(dec, opts);
                if (!ans) continue;
                //带正确选项标记（选择题）的候选比「问答型」更可靠，同分时优先
                var hasYes = false;
                for (var k = 0; k < opts.length; k++) if (opts[k].yes) { hasYes = true; break; }
                if (hasYes) sc = Math.min(1, sc + 0.05);
                if (sc <= bestScore) continue;
                bestScore = sc;
                bestAns = ans;
            }
            return bestAns || '';
        },
        //==================== 学习端（章节测验）点选项 =====
        //判断题：选项从 DOM 里取（靠 val-param 的 true/false）
        //单选/多选：选项文字取自 quu['options']（已去掉字母前缀），再按字母回 DOM 找
        _sameQ: function (idParam, qid) {
            if (idParam == null || idParam === '') return false;
            if (idParam === qid) return true;
            return String(idParam).replace('answer', '') === qid;
        },
        applyLearning: function (quu, result, env) {
            var d = (env && env.d) ? env.d : null;
            if (!d || !quu) return { ok: false, idxs: [], score: 0, how: '' };
            var type = String(quu['type'] || '');
            var qid = String(quu['questionid'] || '').replace('answer', '');
            var isJudge = (type === '判断题');
            var opts = [];
            var lis = [];
            try { lis = d.getElementsByTagName('li'); } catch (e) { lis = []; }
            if (isJudge) {
                for (var i = 0; i < lis.length; i++) {
                    var ip = lis[i].getAttribute('id-param');
                    if (!this._sameQ(ip, qid)) continue;
                    opts.push({
                        li: lis[i],
                        letter: '',
                        val: String(lis[i].getAttribute('val-param') || ''),
                        text: String(lis[i].innerText || lis[i].textContent || '').replace(/\s+/g, ' ').trim()
                    });
                }
            } else {
                var om = quu['options'] || {};
                for (var k in om) {
                    if (k === 'length' || !Object.prototype.hasOwnProperty.call(om, k)) continue;
                    var v = om[k] || {};
                    opts.push({ li: null, letter: String(v['value'] || ''), val: '', text: String(k), id: String(v['id'] || '') });
                }
            }
            if (!opts.length) return { ok: false, idxs: [], score: 0, how: '' };
            var m = this.matchText(result, opts, type);
            if (!m.idxs.length) return { ok: false, idxs: [], score: m.score, how: m.how };
            var clicked = 0;
            for (var c = 0; c < m.idxs.length; c++) {
                var o = opts[m.idxs[c]];
                var target = o.li;
                if (!target) {
                    for (var t = 0; t < lis.length; t++) {
                        if (!this._sameQ(lis[t].getAttribute('id-param'), qid)) continue;
                        var em = lis[t].getElementsByTagName('em');
                        if (em.length > 0 && em[0].getAttribute('id-param') === o.letter) { target = lis[t]; break; }
                    }
                }
                if (!target) continue;
                try {
                    if (String(target.getAttribute('class') || '').indexOf('cur') < 0) target.click();
                    clicked++;
                } catch (e) { }
            }
            return { ok: clicked > 0, idxs: m.idxs, score: m.score, how: m.how, clicked: clicked };
        }
    };
    //启动时读回熔断状态（跨翻章/刷新保持，与主脚本的题库熔断同一思路）
    try { ctBank.init(); } catch (e) { }
    //==================== v1.11.3 多源免费题库结束 ====================
