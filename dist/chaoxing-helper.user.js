// ==UserScript==
// @name          超星学习通小助手（AI 版）
// @namespace    unrival
// @version      1.11.3-AI
// @description  超星学习通小助手（AI 版）：自动刷视频与文档、自动做章节测验/作业。章节测验先用免费题库作答（多源并发 + 打分匹配），查不到时才自动降级到 AI（OpenAI 兼容接口）；超星的加密字体自动解密，题干与选项都能正常识别。题库 Token、正确率门槛、翻章模式、AI 接口地址与密钥都可在面板配置。
// @author       qianbkk
// @run-at       document-end
// @storageName  unrivalxxt
// @match        *://*.chaoxing.com/*
// @match        *://*.edu.cn/*
// @match        *://*.nbdlib.cn/*
// @match        *://*.hnsyu.net/*
// @match        *://*.ac.cn/*
// @icon         http://pan-yz.chaoxing.com/favicon.ico
// @updateURL    https://github.com/qianbkk/chaoxing-helper/releases/latest/download/chaoxing-helper.meta.js
// @downloadURL  https://github.com/qianbkk/chaoxing-helper/releases/latest/download/chaoxing-helper.user.js
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_info
// @grant        GM_openInTab
// @connect      mooc1-1.chaoxing.com
// @connect      mooc1.chaoxing.com
// @connect      mooc1-2.chaoxing.com
// @connect      passport2-api.chaoxing.com

// @connect      cx.icodef.com
// @connect      q.icodef.com
// @connect      easylearn.baidu.com
// @connect      *
// @license      GPL-3.0-or-later
// @homepageURL  https://github.com/qianbkk/chaoxing-helper
// @original-script https://scriptcat.org/script-show-page/878/
// @original-author unrival
// @original-license GPL-3.0-or-later
//如果脚本提示添加安全网址，请将脚本提示内容填写到下方区域，一行一个，如果不会，请加群询问



//安全网址请填写在上方空白区域
// ==/UserScript==
(() => {
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
    //==================== v1.8 翻章模式存储隔离开始 ====================
    // 【解决什么 —— 脚本「卡住不动」的根因】
    //   v1.5 的「暂停」功能是借上游的 jumpType=2（不跳转）实现的：
    //   暂停时把**运行时变量** jumpType 压成 2，恢复时再读回存储。
    //   问题出在面板「保存AI设置」那一步 —— 它把**运行时变量** jumpType
    //   直接写回了存储。于是：
    //     暂停中点一次「保存AI设置」 → 存储被写成 2
    //     → 之后点「继续」读回的也是 2 → 脚本永远停在当前章节
    //     → 日志一直打「所有任务处理完毕，用户设置为不跳转，脚本已结束运行」
    //   现场日志已坐实这条链：21:33:48 已处于暂停状态 → 21:33:55 已继续
    //   → 21:34:05 / 21:34:29 仍在打「用户设置为不跳转」。
    //
    // 【怎么改】
    //   把「用户真实设置」和「运行时状态」彻底分开：
    //     · 用户真实设置 → 独立存储键 unrivalJumpTypeReal
    //     · 运行时 jumpType → 只存在于内存，暂停时才被压成 2，永远不写回存储
    //   面板回填 / 保存设置 / 远程命令三处，一律读写 unrivalJumpTypeReal。
    //   老键 unrivaljumpType 保留为「镜像」：写入真实设置时同步一份，
    //   这样 v1.5 暂停模块里「读回 unrivaljumpType 恢复翻章模式」那条路径
    //   不用改也能拿到正确值（暂停模块是 v1.5 时期落的代码，不动它更安全）。
    //
    // 【一次性迁移】
    //   老键为 '2' 时无法区分「用户主动选的不跳转」与「被暂停功能污染」。
    //   按「遍历」恢复并打一条日志说明原因；用户若确实想要不跳转，
    //   在「AI答题设置」里改回即可 —— v1.8 之后改了就一定存得住。
    var jumpMode = {
        REAL_KEY: 'unrivalJumpTypeReal',
        LEGACY_KEY: 'unrivaljumpType',
        _note: '',
        //读用户真实设置（首次调用时做一次性迁移并修复被污染的旧值）
        get: function () {
            try {
                var v = String(GM_getValue(this.REAL_KEY, ''));
                if (v === '1' || v === '2') return v;
                // 迁移：老键只读一次
                var legacy = String(GM_getValue(this.LEGACY_KEY, '1'));
                var real = '1';
                if (legacy === '2') {
                    this._note = '[设置] 翻章模式存储已修复：旧版本的暂停功能把模式误写成「不跳转」，已恢复为「遍历」。若确实需要不跳转，在「答题设置」里改回即可（现在改了就存得住）。';
                }
                GM_setValue(this.REAL_KEY, real);
                try { GM_setValue(this.LEGACY_KEY, real); } catch (e2) { }
                return real;
            } catch (e) {
                return '1';
            }
        },
        //写用户真实设置：只碰存储，不动运行时变量（由调用方决定要不要同步运行时）
        set: function (v) {
            var real = (String(v) === '2') ? '2' : '1';
            try {
                GM_setValue(this.REAL_KEY, real);
                GM_setValue(this.LEGACY_KEY, real);
            } catch (e) { }
            return real;
        },
        //迁移提示延后到 logs 可用时再打（脚本刚启动那会儿 logs 还没建好）
        flushNote: function () {
            try {
                if (!this._note) return false;
                if (typeof logs == 'undefined' || !logs || !logs.addLog) return false;
                logs.addLog(this._note, 'orange');
                this._note = '';
                return true;
            } catch (e) {
                return false;
            }
        },
        start: function () {
            var self = this;
            var tries = 0;
            var wait = function () {
                tries++;
                if (self.flushNote()) return;
                if (tries < 30) setTimeout(wait, 500);
            };
            setTimeout(wait, 500);
        }
    };
    try {
        jumpMode.start();
    } catch (e) {
        console.log(e);
    }
    //==================== v1.8 翻章模式存储隔离结束 ====================
    var token = GM_getValue('tikutoken', ''), //v1.2：题库token改为在「AI答题设置」面板填写并存入ScriptCat存储（沿用上游5.0做法），只影响题库并发，不填也能答题
        jumpType = (jumpMode.get() === '2' ? 2 : 1), //v1.8：翻章模式改读独立键 unrivalJumpTypeReal（与运行时变量分离，暂停不再污染用户设置）；默认遍历模式(1)，并归一化掉旧版"智能模式(0)"——上游最新版已废弃智能模式（存在无限跳转/不跳转问题）
        disableMonitor = 0, // 0:无操作，1:解除多端学习监控，开启此功能后可以多端学习，不会被强制下线。
        accuracy = parseInt(GM_getValue('unrivalaccuracy', 80), 10), //v1.2：章节测试正确率百分比，可在面板配置（默认80；100意味着必须全对才提交，与自动答题的目标自相矛盾）
        randomDo = 1, //将0改为1，找不到答案的单选、多选、判断就会自动选【B、ABCD、错】，只在规定正确率不为100%时才生效
        backGround = 0, //是否对接超星挂机小助手，需要先安装对应脚本
        //-----------------------------------------------------------------------------------------------------
        autoLogin = 0, //掉线是否自动登录，1为自动登录，需要配置登录信息（仅支持手机号+密码登陆）
        phoneNumber = '', //自动登录的手机号，填写在单引号之间。
        password = '', //自动登录的密码，填写在单引号之间。
        //===== v1.1 AI 答题配置 =====
        aiEnable = 1, //0=只用题库，1=题库失败时降级到AI
        aiBaseUrl = '', //OpenAI兼容接口根地址，例如 https://api.deepseek.com/v1 （不要带 /chat/completions）
        aiModel = '', //模型名，例如 deepseek-chat
        aiKey = '', //API Key（也可在页面「AI答题设置」面板填写，面板保存的值优先）
        aiTimeout = 60000, //单次AI请求超时(毫秒)
        ctFailLimit = 3, //题库连续失败多少次后，本轮不再请求题库
        ctFailCooldown = 10 * 60 * 1000; //题库熔断时长(毫秒)，默认10分钟
    //-----------------------------------------------------------------------------------------------------
    var rate = GM_getValue('unrivalrate', '1'),
        ctUrl = 'https://cx.icodef.com/wyn-nb?v=4',
        getQueryVariable = (variable) => {
            let q = _l.search.substring(1),
                v = q.split("&"),
                r = false;
            for (let i = 0, l = v.length; i < l; i++) {
                let p = v[i].split("=");
                p[0] == variable && (r = p[1]);
            }
            return r;
        },
        getCookie = name => `; ${document.cookie}`.split(`; ${name}=`).pop().split(';').shift(),
        isCat = GM_info.scriptHandler == 'ScriptCat',
        _w = unsafeWindow,
        _d = _w.document,
        _l = _w.location,
        _p = _l.protocol,
        _h = _l.host,
        //isEdge = _w.navigator.userAgent.includes("Edg/"),
        isFf = _w.navigator.userAgent.includes("Firefox"),
        isMobile = _w.navigator.userAgent.includes("Android"),
        stop = false,
        handleImgs = (s) => {
            imgEs = s.match(/(<img([^>]*)>)/);
            if (imgEs) {
                for (let j = 0, k = imgEs.length; j < k; j++) {
                    let urls = imgEs[j].match(
                        /http[s]?:\/\/(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\(\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+/),
                        url;
                    if (urls) {
                        url = urls[0].replace(/http[s]?:\/\//, '');
                        s = s.replaceAll(imgEs[j], url);
                    }
                }
            }
            return s;
        },
        trim = (s) => {
            return handleImgs(s).replaceAll('javascript:void(0);', '').replaceAll("&nbsp;", '').replaceAll("，", ',').replaceAll(
                "。", '.').replaceAll("：", ':').replaceAll("；",
                    ';').replaceAll("？", '?').replaceAll("（", '(').replaceAll("）", ')').replaceAll("“", '"')
                .replaceAll("”", '"').replaceAll("！", '!').replaceAll("-", ' ').replace(/(<([^>]+)>)/ig, '')
                .replace(/^\s+/ig, '').replace(/\s+$/ig, '');
        },
        cVersion = 999,
        classId = getQueryVariable('clazzid') || getQueryVariable('clazzId') || getQueryVariable('classid') ||
            getQueryVariable('classId'),
        courseId = getQueryVariable('courseid') || getQueryVariable('courseId'),
        UID = getCookie('_uid') || getCookie('UID'),
        FID = getCookie('fid'),
        jq = _w.top.$ || _w.top.jQuery;
    //==================== v1.1 AI 答题模块 ====================
    var aiState = {
        enable: (aiEnable == 1) && (GM_getValue('unrivalAiEnable', '1') == '1'),
        baseUrl: (GM_getValue('unrivalAiBaseUrl', '') || aiBaseUrl || '').toString().trim(),
        model: (GM_getValue('unrivalAiModel', '') || aiModel || '').toString().trim(),
        key: (GM_getValue('unrivalAiKey', '') || aiKey || '').toString().trim(),
        timeout: aiTimeout,
        ctFail: 0, //题库连续失败次数
        ctOffUntil: 0, //题库熔断截止时间戳
        ctOk: 0, //题库成功次数
        aiOk: 0, //AI成功次数
        aiFail: 0 //AI失败次数
    };
    var aiReload = function () {
        aiState.enable = (aiEnable == 1) && (GM_getValue('unrivalAiEnable', '1') == '1');
        aiState.baseUrl = (GM_getValue('unrivalAiBaseUrl', '') || aiBaseUrl || '').toString().trim();
        aiState.model = (GM_getValue('unrivalAiModel', '') || aiModel || '').toString().trim();
        aiState.key = (GM_getValue('unrivalAiKey', '') || aiKey || '').toString().trim();
        try {
            var st = _d.getElementById('aiStatusText');
            if (st) {
                st.innerHTML = (aiState.baseUrl && aiState.model && aiState.key) ? ('已配置：' + aiState.model + ' @ ' + aiState.baseUrl) : '未配置（退回纯题库模式）';
            }
        } catch (e) { }
    }
    //日志：章节页有logs；答题页运行在iframe里没有logs，改用 top.unrivalWorkInfo 传给章节页面板
    var aiLog = function (msg, color) {
        var hasLog = false;
        try {
            if (typeof logs != 'undefined' && logs && logs.addLog) {
                logs.addLog(msg, color || 'black');
                hasLog = true;
            }
        } catch (e) { }
        if (!hasLog) {
            try {
                _w.top.unrivalWorkInfo = msg;
            } catch (e) { }
        }
    }
    //===== 题库熔断（v1.6：状态持久化，跨翻章/刷新保持）=====
    //  以前 aiState.ctFail / aiState.ctOffUntil 只在内存里，脚本每翻一章就 reload 一次，
    //  状态清零 ⇒ 明明已经熔断，下一章又去请求题库、白跑三次。
    var ctLoadState = function () {
        try {
            aiState.ctFail = parseInt(GM_getValue('unrivalCtFail', '0'), 10) || 0;
            aiState.ctOffUntil = parseInt(GM_getValue('unrivalCtOffUntil', '0'), 10) || 0;
        } catch (e) { }
    }
    var ctSaveState = function () {
        try {
            GM_setValue('unrivalCtFail', String(aiState.ctFail));
            GM_setValue('unrivalCtOffUntil', String(aiState.ctOffUntil));
        } catch (e) { }
    }
    var ctDisabled = function () {
        return Date.now() < aiState.ctOffUntil;
    }
    var ctFail = function (reason) {
        aiState.ctFail++;
        ctSaveState();
        aiLog('[题库] 查题失败：' + reason + '，已连续失败 ' + aiState.ctFail + '/' + ctFailLimit + ' 次', 'orange');
        if (aiState.ctFail >= ctFailLimit && !ctDisabled()) {
            aiState.ctOffUntil = Date.now() + ctFailCooldown;
            ctSaveState();
            aiLog('[题库] 连续失败 ' + aiState.ctFail + ' 次，已熔断：接下来 ' + Math.round(ctFailCooldown / 60000) + ' 分钟内不再请求题库，直接改用 AI（熔断状态跨翻章保持）', 'red');
        }
    }
    var ctSuccess = function () {
        aiState.ctFail = 0;
        ctSaveState();
        aiState.ctOk++;
    }
    ctLoadState();
    //===== 按 DOM 顺序收集本题可点击选项（不依赖选项字母，也不依赖选项文字）=====
    var collectOptions = function (qu) {
        var out = [];
        try {
            var qid = (qu['questionid'] || '').replace('answer', '');
            var lis = _d.getElementsByTagName('li');
            for (var i = 0; i < lis.length; i++) {
                var ip = lis[i].getAttribute('id-param');
                if (ip == null || ip == '') continue;
                if (String(ip).replace('answer', '') != qid) continue;
                var em = lis[i].getElementsByTagName('em');
                var letter = '';
                if (em.length > 0 && em[0].getAttribute('id-param')) {
                    letter = em[0].getAttribute('id-param');
                }
                var val = lis[i].getAttribute('val-param') || '';
                var txt = (lis[i].innerText || lis[i].textContent || '').replace(/\s+/g, ' ').trim();
                out.push({ 'li': lis[i], 'letter': letter, 'val': val, 'text': txt });
            }
            //v1.4：旧结构没命中时，按新版超星作业页结构收集（.TiMu > ul.Zy_ulTop > li）
            if (out.length == 0 && qid) {
                var roots = _d.querySelectorAll('.TiMu');
                for (var r = 0; r < roots.length; r++) {
                    var rinputs = roots[r].querySelectorAll('input[name^=answer]');
                    var rhit = false;
                    for (var a = 0; a < rinputs.length; a++) {
                        var rnm = String(rinputs[a].getAttribute('name') || '');
                        if (rnm.replace(/^answer(check)?/, '') == qid) { rhit = true; break; }
                    }
                    if (!rhit) continue;
                    var nlis = roots[r].querySelectorAll('ul.Zy_ulTop li');
                    for (var n = 0; n < nlis.length; n++) {
                        var ninput = nlis[n].querySelector('input[type=radio],input[type=checkbox]');
                        var ntxtEl = nlis[n].querySelector('a.after');
                        var nraw = ntxtEl ? (ntxtEl.textContent || '') : (nlis[n].textContent || '');
                        var ntext = cxDecrypt.decryptText(nraw).replace(/\s+/g, ' ').trim();
                        out.push({ 'li': nlis[n], 'input': ninput, 'letter': ninput ? String(ninput.value || '') : '', 'val': '', 'text': ntext });
                    }
                    break;
                }
            }
        } catch (e) {
            console.log(e);
        }
        return out;
    }
    //===== 解析AI返回的选项序号 =====
    var parseAnswerIndex = function (text, max) {
        var out = [];
        if (!text) return out;
        var seg = text;
        var obj = null;
        try {
            var m = text.match(/\{[\s\S]*\}/);
            if (m) seg = m[0];
            obj = JSON.parse(seg);
        } catch (e) { obj = null; }
        var arr = null;
        if (obj) {
            arr = obj['answers'] != null ? obj['answers'] : (obj['answer'] != null ? obj['answer'] : (obj['options'] != null ? obj['options'] : null));
        }
        if (arr == null) {
            var m2 = text.match(/"(?:answers|answer)"\s*:\s*(\[[^\]]*\]|[0-9]+)/);
            if (m2) arr = m2[1];
        }
        if (arr == null) {
            var m3 = text.match(/\[([0-9\s,，]+)\]/);
            if (m3) arr = '[' + m3[1] + ']';
        }
        var nums = [];
        if (arr != null) {
            var raw = (typeof arr === 'string') ? arr : JSON.stringify(arr);
            raw = raw.replace(/^\s*\[/, '').replace(/\]\s*$/, '');
            var parts = raw.split(/[,，]/);
            for (var p = 0; p < parts.length; p++) {
                var one = parts[p].replace(/[^0-9\-]/g, '');
                if (one === '' || one === '-') continue;
                var v = parseInt(one, 10);
                if (!isNaN(v)) nums.push(v);
            }
        } else {
            //兜底：模型只回了一个裸序号（如 "2" 或 "答案是2"）
            var solo = text.trim().match(/^[^0-9]{0,6}([0-9]{1,2})[^0-9]{0,6}$/);
            if (solo) {
                var sv = parseInt(solo[1], 10);
                if (!isNaN(sv)) nums.push(sv);
            }
        }
        for (var i = 0; i < nums.length; i++) {
            if (nums[i] >= 1 && nums[i] <= max && out.indexOf(nums[i]) < 0) {
                out.push(nums[i]);
            }
        }
        return out;
    }
    //===== 调用AI（OpenAI兼容接口）=====
    var aiAsk = function (qu, cb) {
        if (!aiState.enable) {
            cb(null, 'AI未启用');
            return;
        }
        if (!aiState.baseUrl || !aiState.model || !aiState.key) {
            cb(null, 'AI接口未配置');
            return;
        }
        var opts = collectOptions(qu);
        if (opts.length == 0) {
            cb(null, '未能获取到本题选项');
            return;
        }
        var lines = [];
        for (var i = 0; i < opts.length; i++) {
            var t = (opts[i].text || '').replace(/^\s*[A-Ha-h]\s*[.、．)）:：]?\s*/, '');
            if (opts[i].val == 'true') t = '正确';
            else if (opts[i].val == 'false') t = '错误';
            lines.push((i + 1) + '. ' + t);
        }
        var payload = {
            'model': aiState.model,
            'temperature': 0,
            //v1.4.1：max_tokens 是"输出上限"而不是"预留额度"。
            //推理型模型（MiniMax-M3 / M3.1-Flash 的思考强制开启）会把思考token计入max_tokens，
            //300 会被思考吃光、content 返回空字符串（2026-11-24 实测 5 题里偶发 1 题失败）。
            //上限放大不增加开销（模型答完即停），只是不再被思考挤掉。
            'max_tokens': 8000,
            'messages': [{
                'role': 'system',
                'content': '你是一个严谨的考试答题助手。只输出一个JSON对象，不要解释，不要markdown代码块。格式：{"answers":[序号],"confidence":0.9}。answers是正确选项的序号数组（从1开始，按题目给出的选项顺序编号）；单选题和判断题只给一个序号，多选题可给多个；必须且只能使用给出的选项序号。'
            }, {
                'role': 'user',
                'content': '题型：' + qu['type'] + '\n题目：' + qu['question'] + '\n选项：\n' + lines.join('\n')
            }]
        };
        //v1.4.2：MiniMax M3 系列的思考无法关闭，且思考token计入max_tokens；
        //省略 reasoning_effort 时官方默认 max，思考可能直接吃满输出上限（finish_reason=length → content 为空）。
        //官方给的办法是"降低思考深度"而不是关闭思考，其 OpenAI 兼容协议用 reasoning_effort(low/medium/high/xhigh/max)控制。
        //其他厂商的 OpenAI 兼容层不认这个字段，所以只在 baseUrl 命中 minimax 时才带上。
        if (/minimax/i.test(aiState.baseUrl)) payload['reasoning_effort'] = 'low';
        GM_xmlhttpRequest({
            'method': 'POST',
            'headers': { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + aiState.key },
            'url': aiState.baseUrl.replace(/\/+$/, '') + '/chat/completions',
            'timeout': aiState.timeout,
            'data': JSON.stringify(payload),
            'onload': function (res) {
                var body = (res && res.responseText) ? res.responseText : '';
                var text = '';
                var fin = '';
                try {
                    var data = JSON.parse(body);
                    text = data.choices[0].message.content || '';
                    fin = data.choices[0].finish_reason || '';
                } catch (e) { }
                if (!text) {
                    try {
                        var cm = body.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                        if (cm) text = JSON.parse('"' + cm[1] + '"');
                    } catch (e) { }
                }
                if (!text) {
                    cb(null, 'AI返回内容为空' + (fin ? '（finish_reason=' + fin + '：推理型模型的思考token可能占满了输出上限）' : ''));
                    return;
                }
                var idx = parseAnswerIndex(text, opts.length);
                if (idx.length == 0) {
                    cb(null, 'AI返回无法解析出选项序号');
                    return;
                }
                cb(idx, 'AI');
            },
            'onerror': function () {
                cb(null, 'AI请求失败');
            },
            'ontimeout': function () {
                cb(null, 'AI请求超时');
            }
        });
    }
    //===== 按序号点击选项 =====
    var applyByIndex = function (qu, idxs) {
        var opts = collectOptions(qu);
        if (opts.length == 0) return false;
        var clicked = 0;
        for (var i = 0; i < idxs.length; i++) {
            var k = idxs[i] - 1;
            if (k < 0 || k >= opts.length) continue;
            try {
                var el = opts[k].li;
                if (((el.getAttribute('class') || '').indexOf('cur')) < 0) {
                    el.click();
                }
                clicked++;
            } catch (e) { }
        }
        if (clicked > 0) {
            questionNum -= 1;
        }
        return clicked > 0;
    }
    //===== 随机兜底（沿用原脚本 randomDo 规则：randomDo==1 且 accuracy<100 时生效；不计入已作答题数）=====
    var randomFallback = function (qu) {
        if (randomDo != 1 || accuracy >= 100) return false;
        var opts = collectOptions(qu);
        if (opts.length == 0) return false;
        var pick = [];
        if (qu['type'] == '单选题') {
            pick = [Math.min(2, opts.length)];
        } else if (qu['type'] == '多选题') {
            for (var i = 0; i < opts.length; i++) pick.push(i + 1);
        } else {
            pick = [opts.length];
        }
        for (var j = 0; j < pick.length; j++) {
            try {
                var el = opts[pick[j] - 1].li;
                if (((el.getAttribute('class') || '').indexOf('cur')) < 0) el.click();
            } catch (e) { }
        }
        return true;
    }
    //===== AI 作答入口（alreadyCounted=true 表示 busyThread 已由调用方扣减）=====
    var aiDoWork = function (qu, alreadyCounted) {
        aiAsk(qu, function (idxs, err) {
            if (!idxs || idxs.length == 0) {
                aiState.aiFail++;
                aiLog('[AI] 答题失败：' + (err || '未知原因') + ' ｜题目：' + qu['question'], 'red');
                randomFallback(qu);
                if (!alreadyCounted) busyThread -= 1;
                return;
            }
            aiState.aiOk++;
            var ok = applyByIndex(qu, idxs);
            aiLog('[AI] 作答完成：' + qu['question'] + ' → 选 [' + idxs.join(',') + ']' + (ok ? '' : '（选项点击失败）'), 'green');
            if (!alreadyCounted) busyThread -= 1;
        });
    }
    //===== AI 连通性测试 =====
    var aiTest = function (cb) {
        if (!aiState.baseUrl || !aiState.model || !aiState.key) {
            cb(false, '配置不完整');
            return;
        }
        GM_xmlhttpRequest({
            'method': 'POST',
            'headers': { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + aiState.key },
            'url': aiState.baseUrl.replace(/\/+$/, '') + '/chat/completions',
            'timeout': aiState.timeout,
            'data': JSON.stringify({ 'model': aiState.model, 'temperature': 0, 'max_tokens': 512, 'messages': [{ 'role': 'user', 'content': '只回复两个字：正常' }] }),
            'onload': function (res) {
                cb(res.status >= 200 && res.status < 300, 'HTTP ' + res.status);
            },
            'onerror': function () {
                cb(false, '网络错误（检查Base URL与Key）');
            },
            'ontimeout': function () {
                cb(false, '请求超时');
            }
        });
    }
    //==================== v1.4 超星加密字体解密（自包含实现）====================
    // 【为什么必须解密】
    //   超星把题干/选项用自定义字体（@font-face font-cxsecret）加密显示：
    //   DOM 里的文字是乱码，例如 "蒝栗腐败问题慁慃挑战" 实际是 "面对腐败问题严峻挑战"。
    //   不还原就既查不到题库、也让 AI 读不懂题目 —— 这是"题库命中率低"的隐藏主因。
    // 【v1.2 的问题】
    //   v1.2 只移植了"调用逻辑"，却没带上 Typr(字体解析)/md5/字形映射表这三样依赖，
    //   于是 decrypt() 永远在 "TyprRef 或 md5Ref 不存在" 处返回 false —— 字体解密是死代码。
    // 【v1.4 的做法】
    //   全部依赖内联进脚本：
    //     · Typr + md5（上游 @require 的同款库，见 src/assets/typr-md5.min.js）
    //     · 字形映射表（上游 @resource 的 table 2.0，打包成 base64，见 src/assets/font-table-2.0.json）
    //   算法与上游一致：md5(JSON.stringify(glyphPath)).slice(24) → 查表 → 标准 Unicode 码点。
    //   2026-11-24 在真实超星作业页（/mooc-ans/work/doHomeWorkNew）实测：
    //   本页 40 个加密字符全部命中，题干与选项还原正确。
    //
    // 注意：解密只在"读取文本"时按需进行，**不改写页面 DOM** ——
    //   选项 <li> 里含有 input，改 innerHTML 会把选项控件一起删掉。
        //---- 内联 Typr(字体解析) + md5（上游 @require 同款库，MIT）----
    var Typr={parse:function(r){var e=function(r,e,a,t){Typr.B;var n=Typr.T,o={cmap:n.cmap,head:n.head,hhea:n.hhea,maxp:n.maxp,hmtx:n.hmtx,name:n.name,"OS/2":n.OS2,post:n.post,loca:n.loca,kern:n.kern,glyf:n.glyf,"CFF ":n.CFF,"SVG ":n.SVG},i={_data:r,_index:e,_offset:a};for(var s in o){var d=Typr.findTable(r,s,a);if(d){var u=d[0],h=t[u];null==h&&(h=o[s].parseTab(r,u,d[1],i)),i[s]=t[u]=h}}return i},a=Typr.B,t=new Uint8Array(r),n={};if("ttcf"==a.readASCII(t,0,4)){var o=4;a.readUshort(t,o);o+=2;a.readUshort(t,o);o+=2;var i=a.readUint(t,o);o+=4;for(var s=[],d=0;d<i;d++){var u=a.readUint(t,o);o+=4,s.push(e(t,d,u,n))}return s}return[e(t,0,0,n)]},findTable:function(r,e,a){for(var t=Typr.B,n=t.readUshort(r,a+4),o=a+12,i=0;i<n;i++){var s=t.readASCII(r,o,4),d=(t.readUint(r,o+4),t.readUint(r,o+8)),u=t.readUint(r,o+12);if(s==e)return[d,u];o+=16}return null},T:{}};Typr.B={readFixed:function(r,e){return(r[e]<<8|r[e+1])+(r[e+2]<<8|r[e+3])/65540},readF2dot14:function(r,e){return Typr.B.readShort(r,e)/16384},readInt:function(r,e){var a=Typr.B.t.uint8;return a[0]=r[e+3],a[1]=r[e+2],a[2]=r[e+1],a[3]=r[e],Typr.B.t.int32[0]},readInt8:function(r,e){return Typr.B.t.uint8[0]=r[e],Typr.B.t.int8[0]},readShort:function(r,e){var a=Typr.B.t.uint8;return a[1]=r[e],a[0]=r[e+1],Typr.B.t.int16[0]},readUshort:function(r,e){return r[e]<<8|r[e+1]},writeUshort:function(r,e,a){r[e]=a>>8&255,r[e+1]=255&a},readUshorts:function(r,e,a){for(var t=[],n=0;n<a;n++){var o=Typr.B.readUshort(r,e+2*n);t.push(o)}return t},readUint:function(r,e){var a=Typr.B.t.uint8;return a[3]=r[e],a[2]=r[e+1],a[1]=r[e+2],a[0]=r[e+3],Typr.B.t.uint32[0]},writeUint:function(r,e,a){r[e]=a>>24&255,r[e+1]=a>>16&255,r[e+2]=a>>8&255,r[e+3]=a>>0&255},readUint64:function(r,e){return 4294967296*Typr.B.readUint(r,e)+Typr.B.readUint(r,e+4)},readASCII:function(r,e,a){for(var t="",n=0;n<a;n++)t+=String.fromCharCode(r[e+n]);return t},writeASCII:function(r,e,a){for(var t=0;t<a.length;t++)r[e+t]=a.charCodeAt(t)},readUnicode:function(r,e,a){for(var t="",n=0;n<a;n++){var o=r[e++]<<8|r[e++];t+=String.fromCharCode(o)}return t},_tdec:(typeof window!=="undefined"&&window.TextDecoder?new window.TextDecoder:(typeof TextDecoder!=="undefined"?new TextDecoder:null)),readUTF8:function(r,e,a){var t=Typr.B._tdec;return t&&0==e&&a==r.length?t.decode(r):Typr.B.readASCII(r,e,a)},readBytes:function(r,e,a){for(var t=[],n=0;n<a;n++)t.push(r[e+n]);return t},readASCIIArray:function(r,e,a){for(var t=[],n=0;n<a;n++)t.push(String.fromCharCode(r[e+n]));return t},t:function(){var r=new ArrayBuffer(8);return{buff:r,int8:new Int8Array(r),uint8:new Uint8Array(r),int16:new Int16Array(r),uint16:new Uint16Array(r),int32:new Int32Array(r),uint32:new Uint32Array(r)}}()},Typr.T.CFF={parseTab:function(r,e,a){var t=Typr.B,n=Typr.T.CFF;(r=new Uint8Array(r.buffer,e,a))[e=0],r[++e],r[++e],r[++e];e++;var o=[];e=n.readIndex(r,e,o);for(var i=[],s=0;s<o.length-1;s++)i.push(t.readASCII(r,e+o[s],o[s+1]-o[s]));e+=o[o.length-1];var d=[];e=n.readIndex(r,e,d);var u=[];for(s=0;s<d.length-1;s++)u.push(n.readDict(r,e+d[s],e+d[s+1]));e+=d[d.length-1];var h=u[0],p=[];e=n.readIndex(r,e,p);var f=[];for(s=0;s<p.length-1;s++)f.push(t.readASCII(r,e+p[s],p[s+1]-p[s]));if(e+=p[p.length-1],n.readSubrs(r,e,h),h.CharStrings&&(h.CharStrings=n.readBytes(r,h.CharStrings)),h.ROS){e=h.FDArray;var l=[];e=n.readIndex(r,e,l),h.FDArray=[];for(s=0;s<l.length-1;s++){var v=n.readDict(r,e+l[s],e+l[s+1]);n._readFDict(r,v,f),h.FDArray.push(v)}e+=l[l.length-1],e=h.FDSelect,h.FDSelect=[];var y=r[e];if(e++,3!=y)throw y;var c=t.readUshort(r,e);e+=2;for(s=0;s<c+1;s++)h.FDSelect.push(t.readUshort(r,e),r[e+2]),e+=3}return h.charset&&(h.charset=n.readCharset(r,h.charset,h.CharStrings.length)),n._readFDict(r,h,f),h},_readFDict:function(r,e,a){var t,n=Typr.T.CFF;for(var o in e.Private&&(t=e.Private[1],e.Private=n.readDict(r,t,t+e.Private[0]),e.Private.Subrs&&n.readSubrs(r,t+e.Private.Subrs,e.Private)),e)-1!=["FamilyName","FontName","FullName","Notice","version","Copyright"].indexOf(o)&&(e[o]=a[e[o]-426+35])},readSubrs:function(r,e,a){a.Subrs=Typr.T.CFF.readBytes(r,e);var t,n=a.Subrs.length+1;t=n<1240?107:n<33900?1131:32768,a.Bias=t},readBytes:function(r,e){Typr.B;var a=[];e=Typr.T.CFF.readIndex(r,e,a);for(var t=[],n=a.length-1,o=r.byteOffset+e,i=0;i<n;i++){var s=a[i];t.push(new Uint8Array(r.buffer,o+s,a[i+1]-s))}return t},tableSE:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,0,111,112,113,114,0,115,116,117,118,119,120,121,122,0,123,0,124,125,126,127,128,129,130,131,0,132,133,0,134,135,136,137,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,138,0,139,0,0,0,0,140,141,142,143,0,0,0,0,0,144,0,0,0,145,0,0,146,147,148,149,0,0,0,0],glyphByUnicode:function(r,e){for(var a=0;a<r.charset.length;a++)if(r.charset[a]==e)return a;return-1},glyphBySE:function(r,e){return e<0||e>255?-1:Typr.T.CFF.glyphByUnicode(r,Typr.T.CFF.tableSE[e])},readCharset:function(r,e,a){var t=Typr.B,n=[".notdef"],o=r[e];if(e++,0==o)for(var i=0;i<a;i++){var s=t.readUshort(r,e);e+=2,n.push(s)}else{if(1!=o&&2!=o)throw"error: format: "+o;for(;n.length<a;){s=t.readUshort(r,e);e+=2;var d=0;1==o?(d=r[e],e++):(d=t.readUshort(r,e),e+=2);for(i=0;i<=d;i++)n.push(s),s++}}return n},readIndex:function(r,e,a){var t=Typr.B,n=t.readUshort(r,e)+1,o=r[e+=2];if(e++,1==o)for(var i=0;i<n;i++)a.push(r[e+i]);else if(2==o)for(i=0;i<n;i++)a.push(t.readUshort(r,e+2*i));else if(3==o)for(i=0;i<n;i++)a.push(16777215&t.readUint(r,e+3*i-1));else if(4==o)for(i=0;i<n;i++)a.push(t.readUint(r,e+4*i));else if(1!=n)throw"unsupported offset size: "+o+", count: "+n;return(e+=n*o)-1},getCharString:function(r,e,a){var t=Typr.B,n=r[e],o=r[e+1],i=(r[e+2],r[e+3],r[e+4],1),s=null,d=null;n<=20&&(s=n,i=1),12==n&&(s=100*n+o,i=2),21<=n&&n<=27&&(s=n,i=1),28==n&&(d=t.readShort(r,e+1),i=3),29<=n&&n<=31&&(s=n,i=1),32<=n&&n<=246&&(d=n-139,i=1),247<=n&&n<=250&&(d=256*(n-247)+o+108,i=2),251<=n&&n<=254&&(d=256*-(n-251)-o-108,i=2),255==n&&(d=t.readInt(r,e+1)/65535,i=5),a.val=null!=d?d:"o"+s,a.size=i},readCharString:function(r,e,a){for(var t=e+a,n=Typr.B,o=[];e<t;){var i=r[e],s=r[e+1],d=(r[e+2],r[e+3],r[e+4],1),u=null,h=null;i<=20&&(u=i,d=1),12==i&&(u=100*i+s,d=2),19!=i&&20!=i||(u=i,d=2),21<=i&&i<=27&&(u=i,d=1),28==i&&(h=n.readShort(r,e+1),d=3),29<=i&&i<=31&&(u=i,d=1),32<=i&&i<=246&&(h=i-139,d=1),247<=i&&i<=250&&(h=256*(i-247)+s+108,d=2),251<=i&&i<=254&&(h=256*-(i-251)-s-108,d=2),255==i&&(h=n.readInt(r,e+1)/65535,d=5),o.push(null!=h?h:"o"+u),e+=d}return o},readDict:function(r,e,a){for(var t=Typr.B,n={},o=[];e<a;){var i=r[e],s=r[e+1],d=(r[e+2],r[e+3],r[e+4],1),u=null,h=null;if(28==i&&(h=t.readShort(r,e+1),d=3),29==i&&(h=t.readInt(r,e+1),d=5),32<=i&&i<=246&&(h=i-139,d=1),247<=i&&i<=250&&(h=256*(i-247)+s+108,d=2),251<=i&&i<=254&&(h=256*-(i-251)-s-108,d=2),255==i)throw h=t.readInt(r,e+1)/65535,d=5,"unknown number";if(30==i){var p=[];for(d=1;;){var f=r[e+d];d++;var l=f>>4,v=15&f;if(15!=l&&p.push(l),15!=v&&p.push(v),15==v)break}for(var y="",c=[0,1,2,3,4,5,6,7,8,9,".","e","e-","reserved","-","endOfNumber"],S=0;S<p.length;S++)y+=c[p[S]];h=parseFloat(y)}if(i<=21)if(u=["version","Notice","FullName","FamilyName","Weight","FontBBox","BlueValues","OtherBlues","FamilyBlues","FamilyOtherBlues","StdHW","StdVW","escape","UniqueID","XUID","charset","Encoding","CharStrings","Private","Subrs","defaultWidthX","nominalWidthX"][i],d=1,12==i)u=["Copyright","isFixedPitch","ItalicAngle","UnderlinePosition","UnderlineThickness","PaintType","CharstringType","FontMatrix","StrokeWidth","BlueScale","BlueShift","BlueFuzz","StemSnapH","StemSnapV","ForceBold","","","LanguageGroup","ExpansionFactor","initialRandomSeed","SyntheticBase","PostScript","BaseFontName","BaseFontBlend","","","","","","","ROS","CIDFontVersion","CIDFontRevision","CIDFontType","CIDCount","UIDBase","FDArray","FDSelect","FontName"][s],d=2;null!=u?(n[u]=1==o.length?o[0]:o,o=[]):o.push(h),e+=d}return n}},Typr.T.cmap={parseTab:function(r,e,a){var t={tables:[],ids:{},off:e};r=new Uint8Array(r.buffer,e,a);e=0;var n=Typr.B,o=n.readUshort,i=Typr.T.cmap,s=(o(r,e),o(r,e+=2));e+=2;for(var d=[],u=0;u<s;u++){var h=o(r,e),p=o(r,e+=2);e+=2;var f=n.readUint(r,e);e+=4;var l="p"+h+"e"+p,v=d.indexOf(f);if(-1==v){v=t.tables.length;var y={};d.push(f);var c=y.format=o(r,f);0==c?y=i.parse0(r,f,y):4==c?y=i.parse4(r,f,y):6==c?y=i.parse6(r,f,y):12==c&&(y=i.parse12(r,f,y)),t.tables.push(y)}if(null!=t.ids[l])throw"multiple tables for one platform+encoding";t.ids[l]=v}return t},parse0:function(r,e,a){var t=Typr.B;e+=2;var n=t.readUshort(r,e);e+=2;t.readUshort(r,e);e+=2,a.map=[];for(var o=0;o<n-6;o++)a.map.push(r[e+o]);return a},parse4:function(r,e,a){var t=Typr.B,n=t.readUshort,o=t.readUshorts,i=e,s=n(r,e+=2),d=(n(r,e+=2),n(r,e+=2));e+=2;var u=d>>>1;a.searchRange=n(r,e),e+=2,a.entrySelector=n(r,e),e+=2,a.rangeShift=n(r,e),e+=2,a.endCount=o(r,e,u),e+=2*u,e+=2,a.startCount=o(r,e,u),e+=2*u,a.idDelta=[];for(var h=0;h<u;h++)a.idDelta.push(t.readShort(r,e)),e+=2;return a.idRangeOffset=o(r,e,u),e+=2*u,a.glyphIdArray=o(r,e,i+s-e>>>1),a},parse6:function(r,e,a){var t=Typr.B;e+=2;t.readUshort(r,e);e+=2;t.readUshort(r,e);e+=2,a.firstCode=t.readUshort(r,e),e+=2;var n=t.readUshort(r,e);e+=2,a.glyphIdArray=[];for(var o=0;o<n;o++)a.glyphIdArray.push(t.readUshort(r,e)),e+=2;return a},parse12:function(r,e,a){var t=Typr.B.readUint,n=(t(r,e+=4),t(r,e+=4),3*t(r,e+=4));e+=4;for(var o=a.groups=new Uint32Array(n),i=0;i<n;i+=3)o[i]=t(r,e+(i<<2)),o[i+1]=t(r,e+(i<<2)+4),o[i+2]=t(r,e+(i<<2)+8);return a}},Typr.T.glyf={parseTab:function(r,e,a,t){for(var n=[],o=t.maxp.numGlyphs,i=0;i<o;i++)n.push(null);return n},_parseGlyf:function(r,e){var a=Typr.B,t=r._data,n=r.loca;if(n[e]==n[e+1])return null;var o=Typr.findTable(t,"glyf",r._offset)[0]+n[e],i={};if(i.noc=a.readShort(t,o),o+=2,i.xMin=a.readShort(t,o),o+=2,i.yMin=a.readShort(t,o),o+=2,i.xMax=a.readShort(t,o),o+=2,i.yMax=a.readShort(t,o),o+=2,i.xMin>=i.xMax||i.yMin>=i.yMax)return null;if(i.noc>0){i.endPts=[];for(var s=0;s<i.noc;s++)i.endPts.push(a.readUshort(t,o)),o+=2;var d=a.readUshort(t,o);if(o+=2,t.length-o<d)return null;i.instructions=a.readBytes(t,o,d),o+=d;var u=i.endPts[i.noc-1]+1;i.flags=[];for(s=0;s<u;s++){var h=t[o];if(o++,i.flags.push(h),0!=(8&h)){var p=t[o];o++;for(var f=0;f<p;f++)i.flags.push(h),s++}}i.xs=[];for(s=0;s<u;s++){var l=0!=(2&i.flags[s]),v=0!=(16&i.flags[s]);l?(i.xs.push(v?t[o]:-t[o]),o++):v?i.xs.push(0):(i.xs.push(a.readShort(t,o)),o+=2)}i.ys=[];for(s=0;s<u;s++){l=0!=(4&i.flags[s]),v=0!=(32&i.flags[s]);l?(i.ys.push(v?t[o]:-t[o]),o++):v?i.ys.push(0):(i.ys.push(a.readShort(t,o)),o+=2)}var y=0,c=0;for(s=0;s<u;s++)y+=i.xs[s],c+=i.ys[s],i.xs[s]=y,i.ys[s]=c}else{var S;i.parts=[];do{S=a.readUshort(t,o),o+=2;var T={m:{a:1,b:0,c:0,d:1,tx:0,ty:0},p1:-1,p2:-1};if(i.parts.push(T),T.glyphIndex=a.readUshort(t,o),o+=2,1&S){var U=a.readShort(t,o);o+=2;var g=a.readShort(t,o);o+=2}else{U=a.readInt8(t,o);o++;g=a.readInt8(t,o);o++}2&S?(T.m.tx=U,T.m.ty=g):(T.p1=U,T.p2=g),8&S?(T.m.a=T.m.d=a.readF2dot14(t,o),o+=2):64&S?(T.m.a=a.readF2dot14(t,o),o+=2,T.m.d=a.readF2dot14(t,o),o+=2):128&S&&(T.m.a=a.readF2dot14(t,o),o+=2,T.m.b=a.readF2dot14(t,o),o+=2,T.m.c=a.readF2dot14(t,o),o+=2,T.m.d=a.readF2dot14(t,o),o+=2)}while(32&S);if(256&S){var m=a.readUshort(t,o);o+=2,i.instr=[];for(s=0;s<m;s++)i.instr.push(t[o]),o++}}return i}},Typr.T.head={parseTab:function(r,e,a){var t=Typr.B,n={};t.readFixed(r,e);e+=4,n.fontRevision=t.readFixed(r,e),e+=4;t.readUint(r,e);e+=4;t.readUint(r,e);return e+=4,n.flags=t.readUshort(r,e),e+=2,n.unitsPerEm=t.readUshort(r,e),e+=2,n.created=t.readUint64(r,e),e+=8,n.modified=t.readUint64(r,e),e+=8,n.xMin=t.readShort(r,e),e+=2,n.yMin=t.readShort(r,e),e+=2,n.xMax=t.readShort(r,e),e+=2,n.yMax=t.readShort(r,e),e+=2,n.macStyle=t.readUshort(r,e),e+=2,n.lowestRecPPEM=t.readUshort(r,e),e+=2,n.fontDirectionHint=t.readShort(r,e),e+=2,n.indexToLocFormat=t.readShort(r,e),e+=2,n.glyphDataFormat=t.readShort(r,e),e+=2,n}},Typr.T.hhea={parseTab:function(r,e,a){var t=Typr.B,n={};t.readFixed(r,e);e+=4;for(var o=["ascender","descender","lineGap","advanceWidthMax","minLeftSideBearing","minRightSideBearing","xMaxExtent","caretSlopeRise","caretSlopeRun","caretOffset","res0","res1","res2","res3","metricDataFormat","numberOfHMetrics"],i=0;i<o.length;i++){var s=o[i],d="advanceWidthMax"==s||"numberOfHMetrics"==s?t.readUshort:t.readShort;n[s]=d(r,e+2*i)}return n}},Typr.T.hmtx={parseTab:function(r,e,a,t){for(var n=Typr.B,o=[],i=[],s=t.maxp.numGlyphs,d=t.hhea.numberOfHMetrics,u=0,h=0,p=0;p<d;)u=n.readUshort(r,e+(p<<2)),h=n.readShort(r,e+(p<<2)+2),o.push(u),i.push(h),p++;for(;p<s;)o.push(u),i.push(h),p++;return{aWidth:o,lsBearing:i}}},Typr.T.kern={parseTab:function(r,e,a,t){var n=Typr.B,o=Typr.T.kern;if(1==n.readUshort(r,e))return o.parseV1(r,e,a,t);var i=n.readUshort(r,e+2);e+=4;for(var s={glyph1:[],rval:[]},d=0;d<i;d++){e+=2;a=n.readUshort(r,e);e+=2;var u=n.readUshort(r,e);e+=2;var h=u>>>8;0==(h&=15)&&(e=o.readFormat0(r,e,s))}return s},parseV1:function(r,e,a,t){var n=Typr.B,o=Typr.T.kern,i=(n.readFixed(r,e),n.readUint(r,e+4));e+=8;for(var s={glyph1:[],rval:[]},d=0;d<i;d++){n.readUint(r,e);e+=4;var u=n.readUshort(r,e);e+=2;n.readUshort(r,e);e+=2,0==(255&u)&&(e=o.readFormat0(r,e,s))}return s},readFormat0:function(r,e,a){var t=Typr.B,n=t.readUshort,o=-1,i=n(r,e);n(r,e+2),n(r,e+4),n(r,e+6);e+=8;for(var s=0;s<i;s++){var d=n(r,e),u=n(r,e+=2);e+=2;var h=t.readShort(r,e);e+=2,d!=o&&(a.glyph1.push(d),a.rval.push({glyph2:[],vals:[]}));var p=a.rval[a.rval.length-1];p.glyph2.push(u),p.vals.push(h),o=d}return e}},Typr.T.loca={parseTab:function(r,e,a,t){var n=Typr.B,o=[],i=t.head.indexToLocFormat,s=t.maxp.numGlyphs+1;if(0==i)for(var d=0;d<s;d++)o.push(n.readUshort(r,e+(d<<1))<<1);if(1==i)for(d=0;d<s;d++)o.push(n.readUint(r,e+(d<<2)));return o}},Typr.T.maxp={parseTab:function(r,e,a){var t=Typr.B,n=t.readUshort,o={};t.readUint(r,e);return e+=4,o.numGlyphs=n(r,e),e+=2,o}},Typr.T.name={parseTab:function(r,e,a){var t=Typr.B,n={};t.readUshort(r,e);e+=2;var o=t.readUshort(r,e);e+=2;t.readUshort(r,e);for(var i=["copyright","fontFamily","fontSubfamily","ID","fullName","version","postScriptName","trademark","manufacturer","designer","description","urlVendor","urlDesigner","licence","licenceURL","---","typoFamilyName","typoSubfamilyName","compatibleFull","sampleText","postScriptCID","wwsFamilyName","wwsSubfamilyName","lightPalette","darkPalette"],s=e+=2,d=t.readUshort,u=0;u<o;u++){var h=d(r,e),p=d(r,e+=2),f=d(r,e+=2),l=d(r,e+=2),v=d(r,e+=2),y=d(r,e+=2);e+=2;var c,S=s+12*o+y;0==h||3==h&&0==p?c=t.readUnicode(r,S,v/2):0==p?c=t.readASCII(r,S,v):1==p||3==p||4==p||10==p?c=t.readUnicode(r,S,v/2):1==h?(c=t.readASCII(r,S,v),console.log("reading unknown MAC encoding "+p+" as ASCII")):(console.log("unknown encoding "+p+", platformID: "+h),c=t.readASCII(r,S,v));var T="p"+h+","+f.toString(16);null==n[T]&&(n[T]={}),n[T][i[l]]=c,n[T]._lang=f}var U,g="postScriptName";for(var m in n)if(null!=n[m][g]&&1033==n[m]._lang)return n[m];for(var m in n)if(null!=n[m][g]&&0==n[m]._lang)return n[m];for(var m in n)if(null!=n[m][g]&&3084==n[m]._lang)return n[m];for(var m in n)if(null!=n[m][g])return n[m];for(var m in n){U=n[m];break}return console.log("returning name table with languageID "+U._lang),null==U[g]&&null!=U.ID&&(U[g]=U.ID),U}},Typr.T.OS2={parseTab:function(r,e,a){var t=Typr.B.readUshort(r,e);e+=2;var n=Typr.T.OS2,o={};if(0==t)n.version0(r,e,o);else if(1==t)n.version1(r,e,o);else if(2==t||3==t||4==t)n.version2(r,e,o);else{if(5!=t)throw"unknown OS/2 table version: "+t;n.version5(r,e,o)}return o},version0:function(r,e,a){var t=Typr.B;return a.xAvgCharWidth=t.readShort(r,e),e+=2,a.usWeightClass=t.readUshort(r,e),e+=2,a.usWidthClass=t.readUshort(r,e),e+=2,a.fsType=t.readUshort(r,e),e+=2,a.ySubscriptXSize=t.readShort(r,e),e+=2,a.ySubscriptYSize=t.readShort(r,e),e+=2,a.ySubscriptXOffset=t.readShort(r,e),e+=2,a.ySubscriptYOffset=t.readShort(r,e),e+=2,a.ySuperscriptXSize=t.readShort(r,e),e+=2,a.ySuperscriptYSize=t.readShort(r,e),e+=2,a.ySuperscriptXOffset=t.readShort(r,e),e+=2,a.ySuperscriptYOffset=t.readShort(r,e),e+=2,a.yStrikeoutSize=t.readShort(r,e),e+=2,a.yStrikeoutPosition=t.readShort(r,e),e+=2,a.sFamilyClass=t.readShort(r,e),e+=2,a.panose=t.readBytes(r,e,10),e+=10,a.ulUnicodeRange1=t.readUint(r,e),e+=4,a.ulUnicodeRange2=t.readUint(r,e),e+=4,a.ulUnicodeRange3=t.readUint(r,e),e+=4,a.ulUnicodeRange4=t.readUint(r,e),e+=4,a.achVendID=t.readASCII(r,e,4),e+=4,a.fsSelection=t.readUshort(r,e),e+=2,a.usFirstCharIndex=t.readUshort(r,e),e+=2,a.usLastCharIndex=t.readUshort(r,e),e+=2,a.sTypoAscender=t.readShort(r,e),e+=2,a.sTypoDescender=t.readShort(r,e),e+=2,a.sTypoLineGap=t.readShort(r,e),e+=2,a.usWinAscent=t.readUshort(r,e),e+=2,a.usWinDescent=t.readUshort(r,e),e+=2},version1:function(r,e,a){var t=Typr.B;return e=Typr.T.OS2.version0(r,e,a),a.ulCodePageRange1=t.readUint(r,e),e+=4,a.ulCodePageRange2=t.readUint(r,e),e+=4},version2:function(r,e,a){var t=Typr.B,n=t.readUshort;return e=Typr.T.OS2.version1(r,e,a),a.sxHeight=t.readShort(r,e),e+=2,a.sCapHeight=t.readShort(r,e),e+=2,a.usDefault=n(r,e),e+=2,a.usBreak=n(r,e),e+=2,a.usMaxContext=n(r,e),e+=2},version5:function(r,e,a){var t=Typr.B.readUshort;return e=Typr.T.OS2.version2(r,e,a),a.usLowerOpticalPointSize=t(r,e),e+=2,a.usUpperOpticalPointSize=t(r,e),e+=2}},Typr.T.post={parseTab:function(r,e,a){var t=Typr.B,n={};return n.version=t.readFixed(r,e),e+=4,n.italicAngle=t.readFixed(r,e),e+=4,n.underlinePosition=t.readShort(r,e),e+=2,n.underlineThickness=t.readShort(r,e),e+=2,n}},Typr.T.SVG={parseTab:function(r,e,a){var t=Typr.B,n={entries:[]},o=e;t.readUshort(r,e);e+=2;var i=t.readUint(r,e);e+=4;t.readUint(r,e);e+=4,e=i+o;var s=t.readUshort(r,e);e+=2;for(var d=0;d<s;d++){var u=t.readUshort(r,e);e+=2;var h=t.readUshort(r,e);e+=2;var p=t.readUint(r,e);e+=4;var f=t.readUint(r,e);e+=4;for(var l=new Uint8Array(r.buffer,o+p+i,f),v=t.readUTF8(l,0,l.length),y=u;y<=h;y++)n.entries[y]=v}return n}};
;

/**
 * Minified by jsDelivr using Terser v5.10.0.
 * Original file: /gh/photopea/Typr.js@f4fcdeb8014edc75ab7296bd85ac9cde8cb30489/src/Typr.U.js
 *
 * Do NOT use SRI with dynamically generated files! More information: https://www.jsdelivr.com/using-sri-with-dynamic-files
 */
Typr.U={shape:function(t,e,r){for(var s=function(t,e,r,s){var n=e[r],a=e[r+1],h=t.kern;if(h){var o=h.glyph1.indexOf(n);if(-1!=o){var f=h.rval[o].glyph2.indexOf(a);if(-1!=f)return[0,0,h.rval[o].vals[f],0]}}return[0,0,0,0]},n=[],a=0;a<e.length;a++){var h=e.codePointAt(a);h>65535&&a++,n.push(Typr.U.codeToGlyph(t,h))}var o=[];for(a=0;a<n.length;a++){var f=s(t,n,a),i=n[a],l=t.hmtx.aWidth[i]+f[2];o.push({g:i,cl:a,dx:0,dy:0,ax:l,ay:0}),l}return o},shapeToPath:function(t,e,r){for(var s={cmds:[],crds:[]},n=0,a=0,h=0;h<e.length;h++){for(var o=e[h],f=Typr.U.glyphToPath(t,o.g),i=f.crds,l=0;l<i.length;l+=2)s.crds.push(i[l]+n+o.dx),s.crds.push(i[l+1]+a+o.dy);r&&s.cmds.push(r);for(l=0;l<f.cmds.length;l++)s.cmds.push(f.cmds[l]);var c=s.cmds.length;r&&0!=c&&"X"!=s.cmds[c-1]&&s.cmds.push("X"),n+=o.ax,a+=o.ay}return{cmds:s.cmds,crds:s.crds}},codeToGlyph:function(t,e){for(var r=t.cmap,s=-1,n=["p3e10","p0e4","p3e1","p1e0","p0e3","p0e1"],a=0;a<n.length;a++)if(null!=r.ids[n[a]]){s=r.ids[n[a]];break}if(-1==s)throw"no familiar platform and encoding!";var h=function(t,e,r){for(var s=0,n=Math.floor(t.length/e);s+1!=n;){var a=s+(n-s>>>1);t[a*e]<=r?s=a:n=a}return s*e},o=r.tables[s],f=o.format,i=-1;if(0==f)i=e>=o.map.length?0:o.map[e];else if(4==f){var l=-1,c=o.endCount;if(e>c[c.length-1]?l=-1:c[l=h(c,1,e)]<e&&l++,-1==l)i=0;else if(e<o.startCount[l])i=0;else{i=65535&(0!=o.idRangeOffset[l]?o.glyphIdArray[e-o.startCount[l]+(o.idRangeOffset[l]>>1)-(o.idRangeOffset.length-l)]:e+o.idDelta[l])}}else if(6==f){var u=e-o.firstCode,d=o.glyphIdArray;i=u<0||u>=d.length?0:d[u]}else{if(12!=f)throw"unknown cmap table format "+o.format;var v=o.groups;e>v[v.length-2]?i=0:(v[a=h(v,3,e)]<=e&&e<=v[a+1]&&(i=v[a+2]+(e-v[a])),-1==i&&(i=0))}var p=t["SVG "],g=t.loca;return 0==i||null!=t["CFF "]||null!=p&&null!=p.entries[i]||g[i]!=g[i+1]||-1!=[9,10,11,12,13,32,133,160,5760,8232,8233,8239,12288,6158,8203,8204,8205,8288,65279].indexOf(e)||8192<=e&&e<=8202||(i=0),i},glyphToPath:function(t,e){var r={cmds:[],crds:[]},s=t["SVG "],n=t["CFF "],a=Typr.U;if(s&&s.entries[e]){var h=s.entries[e];null!=h&&("string"==typeof h&&(h=a.SVG.toPath(h),s.entries[e]=h),r=h)}else if(n){var o=n.Private,f={x:0,y:0,stack:[],nStems:0,haveWidth:!1,width:o?o.defaultWidthX:0,open:!1};if(n.ROS){for(var i=0;n.FDSelect[i+2]<=e;)i+=2;o=n.FDArray[n.FDSelect[i+1]].Private}a._drawCFF(n.CharStrings[e],f,n,o,r)}else t.glyf&&a._drawGlyf(e,t,r);return{cmds:r.cmds,crds:r.crds}},_drawGlyf:function(t,e,r){var s=e.glyf[t];null==s&&(s=e.glyf[t]=Typr.T.glyf._parseGlyf(e,t)),null!=s&&(s.noc>-1?Typr.U._simpleGlyph(s,r):Typr.U._compoGlyph(s,e,r))},_simpleGlyph:function(t,e){for(var r=Typr.U.P,s=0;s<t.noc;s++){for(var n=0==s?0:t.endPts[s-1]+1,a=t.endPts[s],h=n;h<=a;h++){var o=h==n?a:h-1,f=h==a?n:h+1,i=1&t.flags[h],l=1&t.flags[o],c=1&t.flags[f],u=t.xs[h],d=t.ys[h];if(h==n)if(i){if(!l){r.MoveTo(e,u,d);continue}r.MoveTo(e,t.xs[o],t.ys[o])}else l?r.MoveTo(e,t.xs[o],t.ys[o]):r.MoveTo(e,Math.floor(.5*(t.xs[o]+u)),Math.floor(.5*(t.ys[o]+d)));i?l&&r.LineTo(e,u,d):c?r.qCurveTo(e,u,d,t.xs[f],t.ys[f]):r.qCurveTo(e,u,d,Math.floor(.5*(u+t.xs[f])),Math.floor(.5*(d+t.ys[f])))}r.ClosePath(e)}},_compoGlyph:function(t,e,r){for(var s=0;s<t.parts.length;s++){var n={cmds:[],crds:[]},a=t.parts[s];Typr.U._drawGlyf(a.glyphIndex,e,n);for(var h=a.m,o=0;o<n.crds.length;o+=2){var f=n.crds[o],i=n.crds[o+1];r.crds.push(f*h.a+i*h.b+h.tx),r.crds.push(f*h.c+i*h.d+h.ty)}for(o=0;o<n.cmds.length;o++)r.cmds.push(n.cmds[o])}},pathToSVG:function(t,e){var r=t.cmds,s=t.crds;null==e&&(e=5);for(var n=[],a=0,h={M:2,L:2,Q:4,C:6},o=0;o<r.length;o++){var f=r[o],i=a+(h[f]?h[f]:0);for(n.push(f);a<i;){var l=s[a++];n.push(parseFloat(l.toFixed(e))+(a==i?"":" "))}}return n.join("")},SVGToPath:function(t){var e={cmds:[],crds:[]};return Typr.U.SVG.svgToPath(t,e),{cmds:e.cmds,crds:e.crds}},pathToContext:function(t,e){for(var r=0,s=t.cmds,n=t.crds,a=0;a<s.length;a++){var h=s[a];"M"==h?(e.moveTo(n[r],n[r+1]),r+=2):"L"==h?(e.lineTo(n[r],n[r+1]),r+=2):"C"==h?(e.bezierCurveTo(n[r],n[r+1],n[r+2],n[r+3],n[r+4],n[r+5]),r+=6):"Q"==h?(e.quadraticCurveTo(n[r],n[r+1],n[r+2],n[r+3]),r+=4):"#"==h.charAt(0)?(e.beginPath(),e.fillStyle=h):"Z"==h?e.closePath():"X"==h&&e.fill()}},P:{MoveTo:function(t,e,r){t.cmds.push("M"),t.crds.push(e,r)},LineTo:function(t,e,r){t.cmds.push("L"),t.crds.push(e,r)},CurveTo:function(t,e,r,s,n,a,h){t.cmds.push("C"),t.crds.push(e,r,s,n,a,h)},qCurveTo:function(t,e,r,s,n){t.cmds.push("Q"),t.crds.push(e,r,s,n)},ClosePath:function(t){t.cmds.push("Z")}},_drawCFF:function(t,e,r,s,n){for(var a=e.stack,h=e.nStems,o=e.haveWidth,f=e.width,i=e.open,l=0,c=e.x,u=e.y,d=0,v=0,p=0,g=0,m=0,y=0,T=0,C=0,b=0,_=0,M=Typr.T.CFF,x=Typr.U.P,P=s.nominalWidthX,w={val:0,size:0};l<t.length;){M.getCharString(t,l,w);var S=w.val;if(l+=w.size,"o1"==S||"o18"==S)a.length%2!=0&&!o&&(f=a.shift()+P),h+=a.length>>1,a.length=0,o=!0;else if("o3"==S||"o23"==S){a.length%2!=0&&!o&&(f=a.shift()+P),h+=a.length>>1,a.length=0,o=!0}else if("o4"==S)a.length>1&&!o&&(f=a.shift()+P,o=!0),i&&x.ClosePath(n),u+=a.pop(),x.MoveTo(n,c,u),i=!0;else if("o5"==S)for(;a.length>0;)c+=a.shift(),u+=a.shift(),x.LineTo(n,c,u);else if("o6"==S||"o7"==S)for(var F=a.length,A="o6"==S,U=0;U<F;U++){var G=a.shift();A?c+=G:u+=G,A=!A,x.LineTo(n,c,u)}else if("o8"==S||"o24"==S){F=a.length;for(var L=0;L+6<=F;)d=c+a.shift(),v=u+a.shift(),p=d+a.shift(),g=v+a.shift(),c=p+a.shift(),u=g+a.shift(),x.CurveTo(n,d,v,p,g,c,u),L+=6;"o24"==S&&(c+=a.shift(),u+=a.shift(),x.LineTo(n,c,u))}else{if("o11"==S)break;if("o1234"==S||"o1235"==S||"o1236"==S||"o1237"==S)"o1234"==S&&(v=u,p=(d=c+a.shift())+a.shift(),_=g=v+a.shift(),y=g,C=u,c=(T=(m=(b=p+a.shift())+a.shift())+a.shift())+a.shift(),x.CurveTo(n,d,v,p,g,b,_),x.CurveTo(n,m,y,T,C,c,u)),"o1235"==S&&(d=c+a.shift(),v=u+a.shift(),p=d+a.shift(),g=v+a.shift(),b=p+a.shift(),_=g+a.shift(),m=b+a.shift(),y=_+a.shift(),T=m+a.shift(),C=y+a.shift(),c=T+a.shift(),u=C+a.shift(),a.shift(),x.CurveTo(n,d,v,p,g,b,_),x.CurveTo(n,m,y,T,C,c,u)),"o1236"==S&&(d=c+a.shift(),v=u+a.shift(),p=d+a.shift(),_=g=v+a.shift(),y=g,T=(m=(b=p+a.shift())+a.shift())+a.shift(),C=y+a.shift(),c=T+a.shift(),x.CurveTo(n,d,v,p,g,b,_),x.CurveTo(n,m,y,T,C,c,u)),"o1237"==S&&(d=c+a.shift(),v=u+a.shift(),p=d+a.shift(),g=v+a.shift(),b=p+a.shift(),_=g+a.shift(),m=b+a.shift(),y=_+a.shift(),T=m+a.shift(),C=y+a.shift(),Math.abs(T-c)>Math.abs(C-u)?c=T+a.shift():u=C+a.shift(),x.CurveTo(n,d,v,p,g,b,_),x.CurveTo(n,m,y,T,C,c,u));else if("o14"==S){if(a.length>0&&!o&&(f=a.shift()+r.nominalWidthX,o=!0),4==a.length){var k=a.shift(),O=a.shift(),V=a.shift(),W=a.shift(),B=M.glyphBySE(r,V),I=M.glyphBySE(r,W);Typr.U._drawCFF(r.CharStrings[B],e,r,s,n),e.x=k,e.y=O,Typr.U._drawCFF(r.CharStrings[I],e,r,s,n)}i&&(x.ClosePath(n),i=!1)}else if("o19"==S||"o20"==S){a.length%2!=0&&!o&&(f=a.shift()+P),h+=a.length>>1,a.length=0,o=!0,l+=h+7>>3}else if("o21"==S)a.length>2&&!o&&(f=a.shift()+P,o=!0),u+=a.pop(),c+=a.pop(),i&&x.ClosePath(n),x.MoveTo(n,c,u),i=!0;else if("o22"==S)a.length>1&&!o&&(f=a.shift()+P,o=!0),c+=a.pop(),i&&x.ClosePath(n),x.MoveTo(n,c,u),i=!0;else if("o25"==S){for(;a.length>6;)c+=a.shift(),u+=a.shift(),x.LineTo(n,c,u);d=c+a.shift(),v=u+a.shift(),p=d+a.shift(),g=v+a.shift(),c=p+a.shift(),u=g+a.shift(),x.CurveTo(n,d,v,p,g,c,u)}else if("o26"==S)for(a.length%2&&(c+=a.shift());a.length>0;)d=c,v=u+a.shift(),c=p=d+a.shift(),u=(g=v+a.shift())+a.shift(),x.CurveTo(n,d,v,p,g,c,u);else if("o27"==S)for(a.length%2&&(u+=a.shift());a.length>0;)v=u,p=(d=c+a.shift())+a.shift(),g=v+a.shift(),c=p+a.shift(),u=g,x.CurveTo(n,d,v,p,g,c,u);else if("o10"==S||"o29"==S){var q="o10"==S?s:r;if(0==a.length)console.log("error: empty stack");else{var Q=a.pop(),X=q.Subrs[Q+q.Bias];e.x=c,e.y=u,e.nStems=h,e.haveWidth=o,e.width=f,e.open=i,Typr.U._drawCFF(X,e,r,s,n),c=e.x,u=e.y,h=e.nStems,o=e.haveWidth,f=e.width,i=e.open}}else if("o30"==S||"o31"==S){var D=a.length,E=(L=0,"o31"==S);for(L+=D-(F=-3&D);L<F;)E?(v=u,p=(d=c+a.shift())+a.shift(),u=(g=v+a.shift())+a.shift(),F-L==5?(c=p+a.shift(),L++):c=p,E=!1):(d=c,v=u+a.shift(),p=d+a.shift(),g=v+a.shift(),c=p+a.shift(),F-L==5?(u=g+a.shift(),L++):u=g,E=!0),x.CurveTo(n,d,v,p,g,c,u),L+=4}else{if("o"==(S+"").charAt(0))throw console.log("Unknown operation: "+S,t),S;a.push(S)}}}e.x=c,e.y=u,e.nStems=h,e.haveWidth=o,e.width=f,e.open=i},SVG:function(){var t={getScale:function(t){return Math.sqrt(Math.abs(t[0]*t[3]-t[1]*t[2]))},translate:function(e,r,s){t.concat(e,[1,0,0,1,r,s])},rotate:function(e,r){t.concat(e,[Math.cos(r),-Math.sin(r),Math.sin(r),Math.cos(r),0,0])},scale:function(e,r,s){t.concat(e,[r,0,0,s,0,0])},concat:function(t,e){var r=t[0],s=t[1],n=t[2],a=t[3],h=t[4],o=t[5];t[0]=r*e[0]+s*e[2],t[1]=r*e[1]+s*e[3],t[2]=n*e[0]+a*e[2],t[3]=n*e[1]+a*e[3],t[4]=h*e[0]+o*e[2]+e[4],t[5]=h*e[1]+o*e[3]+e[5]},invert:function(t){var e=t[0],r=t[1],s=t[2],n=t[3],a=t[4],h=t[5],o=e*n-r*s;t[0]=n/o,t[1]=-r/o,t[2]=-s/o,t[3]=e/o,t[4]=(s*h-n*a)/o,t[5]=(r*a-e*h)/o},multPoint:function(t,e){var r=e[0],s=e[1];return[r*t[0]+s*t[2]+t[4],r*t[1]+s*t[3]+t[5]]},multArray:function(t,e){for(var r=0;r<e.length;r+=2){var s=e[r],n=e[r+1];e[r]=s*t[0]+n*t[2]+t[4],e[r+1]=s*t[1]+n*t[3]+t[5]}}};function e(t,e,r){for(var s=[],n=0,a=0,h=0;;){var o=t.indexOf(e,a),f=t.indexOf(r,a);if(-1==o&&-1==f)break;-1==f||-1!=o&&o<f?(0==h&&(s.push(t.slice(n,o).trim()),n=o+1),h++,a=o+1):(-1==o||-1!=f&&f<o)&&(0==--h&&(s.push(t.slice(n,f).trim()),n=f+1),a=f+1)}return s}function r(r){for(var n=e(r,"(",")"),a=[1,0,0,1,0,0],h=0;h<n.length;h+=2){var o=a;a=s(n[h],n[h+1]),t.concat(a,o)}return a}function s(e,r){for(var s=[1,0,0,1,0,0],n=!0,a=0;a<r.length;a++){var h=r.charAt(a);","==h||" "==h?n=!0:"."==h?(n||(r=r.slice(0,a)+","+r.slice(a),a++),n=!1):"-"==h&&a>0&&"e"!=r[a-1]&&(r=r.slice(0,a)+" "+r.slice(a),a++,n=!0)}if(r=r.split(/\s*[\s,]\s*/).map(parseFloat),"translate"==e)1==r.length?t.translate(s,r[0],0):t.translate(s,r[0],r[1]);else if("scale"==e)1==r.length?t.scale(s,r[0],r[0]):t.scale(s,r[0],r[1]);else if("rotate"==e){var o=0,f=0;1!=r.length&&(o=r[1],f=r[2]),t.translate(s,-o,-f),t.rotate(s,-Math.PI*r[0]/180),t.translate(s,o,f)}else"matrix"==e?s=r:console.log("unknown transform: ",e);return s}function n(e,s,a){for(var o=0;o<e.length;o++){var f=e[o],i=f.tagName,l=f.getAttribute("fill");if(null==l&&(l=a),"g"==i){var c={crds:[],cmds:[]};n(f.children,c,l);var u=f.getAttribute("transform");if(u){var d=r(u);t.multArray(d,c.crds)}s.crds=s.crds.concat(c.crds),s.cmds=s.cmds.concat(c.cmds)}else if("path"==i||"circle"==i||"ellipse"==i){var v;if(s.cmds.push(l||"#000000"),"path"==i&&(v=f.getAttribute("d")),"circle"==i||"ellipse"==i){for(var p=[0,0,0,0],g=["cx","cy","rx","ry","r"],m=0;m<5;m++){var y=f.getAttribute(g[m]);y&&(y=parseFloat(y),m<4?p[m]=y:p[2]=p[3]=y)}var T=p[0],C=p[1],b=p[2],_=p[3];v=["M",T-b,C,"a",b,_,0,1,0,2*b,0,"a",b,_,0,1,0,2*-b,0].join(" ")}h(v,s),s.cmds.push("X")}else"defs"==i||console.log(i,f)}}function a(t,e,r){for(var s=e;s<t.length&&"string"!=typeof t[s];)s+=r;return(s-e)/r}function h(t,e){for(var r=function(t){for(var e=[],r=0,s=!1,n="",a="";r<t.length;){var h=t.charCodeAt(r),o=t.charAt(r);r++;var f=48<=h&&h<=57||"."==o||"-"==o||"e"==o||"E"==o;s?"-"==o&&"e"!=a||"."==o&&-1!=n.indexOf(".")?(e.push(parseFloat(n)),n=o):f?n+=o:(e.push(parseFloat(n)),","!=o&&" "!=o&&e.push(o),s=!1):f?(n=o,s=!0):","!=o&&" "!=o&&e.push(o),a=o}return s&&e.push(parseFloat(n)),e}(t),s=0,n=0,h=0,o=0,f=0,i=e.crds.length,l={M:2,L:2,H:1,V:1,T:2,S:4,A:7,Q:4,C:6},c=e.cmds,u=e.crds;s<r.length;){var d=r[s];s++;var v=d.toUpperCase();if("Z"==v)c.push("Z"),n=o,h=f;else for(var p=a(r,s,l[v]),g=0;g<p;g++){1==g&&"M"==v&&(d=d==v?"L":"l",v="L");var m=0,y=0;if(d!=v&&(m=n,y=h),"M"==v)n=m+r[s++],h=y+r[s++],c.push("M"),u.push(n,h),o=n,f=h;else if("L"==v)n=m+r[s++],h=y+r[s++],c.push("L"),u.push(n,h);else if("H"==v)n=m+r[s++],c.push("L"),u.push(n,h);else if("V"==v)h=y+r[s++],c.push("L"),u.push(n,h);else if("Q"==v){var T=m+r[s++],C=y+r[s++],b=m+r[s++],_=y+r[s++];c.push("Q"),u.push(T,C,b,_),n=b,h=_}else if("T"==v){T=n+n-u[P=Math.max(u.length-2,i)],C=h+h-u[P+1],b=m+r[s++],_=y+r[s++];c.push("Q"),u.push(T,C,b,_),n=b,h=_}else if("C"==v){T=m+r[s++],C=y+r[s++],b=m+r[s++],_=y+r[s++];var M=m+r[s++],x=y+r[s++];c.push("C"),u.push(T,C,b,_,M,x),n=M,h=x}else if("S"==v){var P;T=n+n-u[P=Math.max(u.length-("C"==c[c.length-1]?4:2),i)],C=h+h-u[P+1],b=m+r[s++],_=y+r[s++],M=m+r[s++],x=y+r[s++];c.push("C"),u.push(T,C,b,_,M,x),n=M,h=x}else if("A"==v){T=n,C=h;var w=r[s++],S=r[s++],F=r[s++]*(Math.PI/180),A=r[s++],U=r[s++];b=m+r[s++],_=y+r[s++];if(b==n&&_==h&&0==w&&0==S)continue;var G=(T-b)/2,L=(C-_)/2,k=Math.cos(F),O=Math.sin(F),V=k*G+O*L,W=-O*G+k*L,B=w*w,I=S*S,q=V*V,Q=W*W,X=(B*I-B*Q-I*q)/(B*Q+I*q),D=(A!=U?1:-1)*Math.sqrt(Math.max(X,0)),E=D*(w*W)/S,H=S*V*-D/w,R=k*E-O*H+(T+b)/2,Z=O*E+k*H+(C+_)/2,z=function(t,e,r,s){var n=(t*r+e*s)/(Math.sqrt(t*t+e*e)*Math.sqrt(r*r+s*s));return(t*s-e*r>=0?1:-1)*Math.acos(Math.max(-1,Math.min(1,n)))},N=(V-E)/w,j=(W-H)/S,J=z(1,0,N,j),K=z(N,j,(-V-E)/w,(-W-H)/S);!function(t,e,r,s,n,a,h){var o=function(t,e){var r=Math.sin(e),s=Math.cos(e),n=(e=t[0],t[1]),a=t[2],h=t[3];t[0]=e*s+n*r,t[1]=-e*r+n*s,t[2]=a*s+h*r,t[3]=-a*r+h*s},f=function(t,e){for(var r=0;r<e.length;r+=2){var s=e[r],n=e[r+1];e[r]=t[0]*s+t[2]*n+t[4],e[r+1]=t[1]*s+t[3]*n+t[5]}},i=function(t,e){for(var r=0;r<e.length;r++)t.push(e[r])};if(h)for(;a>n;)a-=2*Math.PI;else for(;a<n;)a+=2*Math.PI;var l=(a-n)/4,c=Math.cos(l/2),u=-Math.sin(l/2),d=(4-c)/3,v=0==u?u:(1-c)*(3-c)/(3*u),p=[d,v,d,-v,c,-u],g={cmds:["C","C","C","C"],crds:p.slice(0)},m=[1,0,0,1,0,0];o(m,-l);for(var y=0;y<3;y++)f(m,p),i(g.crds,p);o(m,l/2-n),m[0]*=s,m[1]*=s,m[2]*=s,m[3]*=s,m[4]=e,m[5]=r,f(m,g.crds),f(t.ctm,g.crds),function(t,e){i(t.cmds,e.cmds),i(t.crds,e.crds)}(t.pth,g)}({pth:e,ctm:[w*k,w*O,-S*O,S*k,R,Z]},0,0,1,J,J+(K%=2*Math.PI),0==U),n=b,h=_}else console.log("Unknown SVG command "+d)}}}return{cssMap:function(t){for(var r=e(t,"{","}"),s={},n=0;n<r.length;n+=2)for(var a=r[n].split(","),h=0;h<a.length;h++){var o=a[h].trim();null==s[o]&&(s[o]=""),s[o]+=r[n+1]}return s},readTrnf:r,svgToPath:h,toPath:function(t){var e={cmds:[],crds:[]};if(null==t)return e;var r=(new DOMParser).parseFromString(t,"image/svg+xml").getElementsByTagName("svg")[0],s=r.getAttribute("viewBox");s=s?s.trim().split(" ").map(parseFloat):[0,0,1e3,1e3],n(r.children,e);for(var a=0;a<e.crds.length;a+=2){var h=e.crds[a],o=e.crds[a+1];h-=s[0],o=-(o-=s[1]),e.crds[a]=h,e.crds[a+1]=o}return e}}}(),initHB:function(t,e){var r=function(t){var e=0;return 0==(4294967168&t)?e=1:0==(4294965248&t)?e=2:0==(4294901760&t)?e=3:0==(4292870144&t)&&(e=4),e},s=new window.TextEncoder("utf8");fetch(t).then((function(t){return t.arrayBuffer()})).then((function(t){return WebAssembly.instantiate(t)})).then((function(t){console.log("HB ready");var n=t.instance.exports,a=n.memory;a.grow(700);var h,o,f,i,l,c=new Uint8Array(a.buffer),u=new Uint32Array(a.buffer),d=new Int32Array(a.buffer);Typr.U.shapeHB=function(t,e,a){var v=t._data,p=t.name.postScriptName;h!=p&&(null!=o&&(n.hb_blob_destroy(o),n.free(f),n.hb_face_destroy(i),n.hb_font_destroy(l)),f=n.malloc(v.byteLength),c.set(v,f),o=n.hb_blob_create(f,v.byteLength,2,0,0),i=n.hb_face_create(o,0),l=n.hb_font_create(i),h=p);var g=n.hb_buffer_create(),m=s.encode(e),y=m.length,T=n.malloc(y);c.set(m,T),n.hb_buffer_add_utf8(g,T,y,0,y),n.free(T),n.hb_buffer_set_direction(g,a?4:5),n.hb_buffer_guess_segment_properties(g),n.hb_shape(l,g,0,0);var C=function(t){for(var e=n.hb_buffer_get_length(t),r=[],s=n.hb_buffer_get_glyph_infos(t,0)>>>2,a=n.hb_buffer_get_glyph_positions(t,0)>>>2,h=0;h<e;++h){var o=s+5*h,f=a+5*h;r.push({g:u[o+0],cl:u[o+2],ax:d[f+0],ay:d[f+1],dx:d[f+2],dy:d[f+3]})}return r}(g);n.hb_buffer_destroy(g);var b=C.slice(0);a||b.reverse();for(var _=0,M=0,x=1;x<b.length;x++){for(var P=b[x],w=P.cl;;){var S=e.codePointAt(_),F=r(S);if(!(M+F<=w))break;M+=F,_+=S<=65535?1:2}P.cl=_}return C},e()}))}};
;

!function(n){"use strict";function d(n,t){var r=(65535&n)+(65535&t);return(n>>16)+(t>>16)+(r>>16)<<16|65535&r}function f(n,t,r,e,o,u){return d((u=d(d(t,n),d(e,u)))<<o|u>>>32-o,r)}function l(n,t,r,e,o,u,c){return f(t&r|~t&e,n,t,o,u,c)}function g(n,t,r,e,o,u,c){return f(t&e|r&~e,n,t,o,u,c)}function v(n,t,r,e,o,u,c){return f(t^r^e,n,t,o,u,c)}function m(n,t,r,e,o,u,c){return f(r^(t|~e),n,t,o,u,c)}function c(n,t){var r,e,o,u;n[t>>5]|=128<<t%32,n[14+(t+64>>>9<<4)]=t;for(var c=1732584193,f=-271733879,i=-1732584194,a=271733878,h=0;h<n.length;h+=16)c=l(r=c,e=f,o=i,u=a,n[h],7,-680876936),a=l(a,c,f,i,n[h+1],12,-389564586),i=l(i,a,c,f,n[h+2],17,606105819),f=l(f,i,a,c,n[h+3],22,-1044525330),c=l(c,f,i,a,n[h+4],7,-176418897),a=l(a,c,f,i,n[h+5],12,1200080426),i=l(i,a,c,f,n[h+6],17,-1473231341),f=l(f,i,a,c,n[h+7],22,-45705983),c=l(c,f,i,a,n[h+8],7,1770035416),a=l(a,c,f,i,n[h+9],12,-1958414417),i=l(i,a,c,f,n[h+10],17,-42063),f=l(f,i,a,c,n[h+11],22,-1990404162),c=l(c,f,i,a,n[h+12],7,1804603682),a=l(a,c,f,i,n[h+13],12,-40341101),i=l(i,a,c,f,n[h+14],17,-1502002290),c=g(c,f=l(f,i,a,c,n[h+15],22,1236535329),i,a,n[h+1],5,-165796510),a=g(a,c,f,i,n[h+6],9,-1069501632),i=g(i,a,c,f,n[h+11],14,643717713),f=g(f,i,a,c,n[h],20,-373897302),c=g(c,f,i,a,n[h+5],5,-701558691),a=g(a,c,f,i,n[h+10],9,38016083),i=g(i,a,c,f,n[h+15],14,-660478335),f=g(f,i,a,c,n[h+4],20,-405537848),c=g(c,f,i,a,n[h+9],5,568446438),a=g(a,c,f,i,n[h+14],9,-1019803690),i=g(i,a,c,f,n[h+3],14,-187363961),f=g(f,i,a,c,n[h+8],20,1163531501),c=g(c,f,i,a,n[h+13],5,-1444681467),a=g(a,c,f,i,n[h+2],9,-51403784),i=g(i,a,c,f,n[h+7],14,1735328473),c=v(c,f=g(f,i,a,c,n[h+12],20,-1926607734),i,a,n[h+5],4,-378558),a=v(a,c,f,i,n[h+8],11,-2022574463),i=v(i,a,c,f,n[h+11],16,1839030562),f=v(f,i,a,c,n[h+14],23,-35309556),c=v(c,f,i,a,n[h+1],4,-1530992060),a=v(a,c,f,i,n[h+4],11,1272893353),i=v(i,a,c,f,n[h+7],16,-155497632),f=v(f,i,a,c,n[h+10],23,-1094730640),c=v(c,f,i,a,n[h+13],4,681279174),a=v(a,c,f,i,n[h],11,-358537222),i=v(i,a,c,f,n[h+3],16,-722521979),f=v(f,i,a,c,n[h+6],23,76029189),c=v(c,f,i,a,n[h+9],4,-640364487),a=v(a,c,f,i,n[h+12],11,-421815835),i=v(i,a,c,f,n[h+15],16,530742520),c=m(c,f=v(f,i,a,c,n[h+2],23,-995338651),i,a,n[h],6,-198630844),a=m(a,c,f,i,n[h+7],10,1126891415),i=m(i,a,c,f,n[h+14],15,-1416354905),f=m(f,i,a,c,n[h+5],21,-57434055),c=m(c,f,i,a,n[h+12],6,1700485571),a=m(a,c,f,i,n[h+3],10,-1894986606),i=m(i,a,c,f,n[h+10],15,-1051523),f=m(f,i,a,c,n[h+1],21,-2054922799),c=m(c,f,i,a,n[h+8],6,1873313359),a=m(a,c,f,i,n[h+15],10,-30611744),i=m(i,a,c,f,n[h+6],15,-1560198380),f=m(f,i,a,c,n[h+13],21,1309151649),c=m(c,f,i,a,n[h+4],6,-145523070),a=m(a,c,f,i,n[h+11],10,-1120210379),i=m(i,a,c,f,n[h+2],15,718787259),f=m(f,i,a,c,n[h+9],21,-343485551),c=d(c,r),f=d(f,e),i=d(i,o),a=d(a,u);return[c,f,i,a]}function i(n){for(var t="",r=32*n.length,e=0;e<r;e+=8)t+=String.fromCharCode(n[e>>5]>>>e%32&255);return t}function a(n){var t=[];for(t[(n.length>>2)-1]=void 0,e=0;e<t.length;e+=1)t[e]=0;for(var r=8*n.length,e=0;e<r;e+=8)t[e>>5]|=(255&n.charCodeAt(e/8))<<e%32;return t}function e(n){for(var t,r="0123456789abcdef",e="",o=0;o<n.length;o+=1)t=n.charCodeAt(o),e+=r.charAt(t>>>4&15)+r.charAt(15&t);return e}function r(n){return unescape(encodeURIComponent(n))}function o(n){return i(c(a(n=r(n)),8*n.length))}function u(n,t){return function(n,t){var r,e=a(n),o=[],u=[];for(o[15]=u[15]=void 0,16<e.length&&(e=c(e,8*n.length)),r=0;r<16;r+=1)o[r]=909522486^e[r],u[r]=1549556828^e[r];return t=c(o.concat(a(t)),512+8*t.length),i(c(u.concat(t),640))}(r(n),r(t))}function t(n,t,r){return t?r?u(t,n):e(u(t,n)):r?o(n):e(o(n))}"function"==typeof define&&define.amd?define(function(){return t}):"object"==typeof module&&module.exports?module.exports=t:n.md5=t}(typeof globalThis!=="undefined"?globalThis:(typeof window!=="undefined"?window:this));
//# sourceMappingURL=/sm/80046a4ce1003ba43879a6794e58ce353468dc09ccff36d7890160a28c47efa8.map


        //---- 内联字形映射表（上游 @resource table 2.0，6字节/条压成 base64）----
    var CX_FONT_TABLE_B64 = "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8Xid84lPAfbhqYlQZex/OolRpDMlRolSGLtNvIlTKNtU74lUp4a/IolVAAJSNYlWaBTMlIlXoXMT44lYB7CET4lZIbG73Ila+Zsri4lbfk+PEYlcX+Idbold2tvL3IleuO/qH4lfJLWyYIlgHYvojYlhqcAYxIliTAadQYljV+B0h4lki9/h3oll2BG6DolmJl6b3Ilncqw+kYloZnelsYlpG3+HhIlqmQzx/4lryoW+eolsg9CL9Yltetn7VYluQ/QWf4lvwHKZRIlw/P1WEIlxWArK+4lyx1F+fYlz+FXKQol0wHntS4l1jGDIQYl2eMnCa4l3p6TiHIl4r556kYl5sVE44Yl6aMiQzYl7PZYAbol8x3Fc74l9qwKbZol+/JSGxYl/bT7NdImAGyPbjomB+PF3NImC2o91aYmD2/7Wg4mE/9KOhImFfJT8FImGZ+C8pImHnNMs+4mICbSBL4mJYzWjfYmK6p8rs4mLanjKZYmMRMG4/YmNiuPWbomO8hgAoImPndORs4mQaZ/KKImRqHOiRomTBBUMEImU6voQrImVgYRjXYmWGELnhomXH5NF74mYnuN1zImZrGYU4omapbhoZombTVHbYomcbc3uSomdfH9IfYme45OCcYmfS2L1mImgU6VgMomh3ZT5Vomi02uT3omjxavs/Imk0xSTcYml8TYLcYmmGwaN7Ymnayly+4moPJZxKompvv+8WYmqd6y744mrFCl8UImsewu8AYmtMwBdaomu/bTBXImv658Z5ImwVFmtH4mxtHKt/ImyRKlwKImzduX4xIm0sf14d4m1dkjSfom2sSszxom3OLpWTYm4QIcmGom5u1y+34m6drkx+4m7y6B/jom8FypOK4m9dzoxvYm+4F5W94m/MFt/8InACWZnrYnBvEZvG4nC2ELtTYnDzqPogInEzRzTgYnF4M3cGonGUir0Q4nHwrgLp4nIpbqM1InJoUOTP4nKKfJmuYnL9lLk5YnMKfT0e4nNrXdC2YnOCUigiInPSYpN4onQ8ozcXInRzs0v34nSRl1GlInTpS+94onUkdfLSonViWPMH4nWUx/ZyYnXcngHbonYO7hqU4nZU4DfQInaQZ1Td4nbLcwVq4nc2+X1kYndnXR/74neXMwRI4nf7KxHOYngtVbDrInhXt7aVIni+8rdionjFgycU4nkozSKqYnl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";
    var cxDecrypt = {
        charMap: null, // {加密字: 真实字} 缓存
        font: null, // 解析后的字体对象
        table: null, // {字形哈希后8位: 标准码点}
        busy: false,
        done: false,
        //===== 解包映射表（6字节/条：4字节key + 2字节码点，大端）=====
        loadTable: function () {
            if (this.table) return this.table;
            var map = {};
            try {
                var raw = atob(CX_FONT_TABLE_B64);
                var len = raw.length;
                var bytes = new Uint8Array(len);
                for (var i = 0; i < len; i++) {
                    bytes[i] = raw.charCodeAt(i);
                }
                for (var o = 0; o + 5 < bytes.length; o += 6) {
                    var key = (bytes[o] * 16777216 + (bytes[o + 1] << 16) + (bytes[o + 2] << 8) + bytes[o + 3]) >>> 0;
                    var hex = ('00000000' + key.toString(16)).slice(-8);
                    map[hex] = (bytes[o + 4] << 8) + bytes[o + 5];
                }
            } catch (e) {
                console.log(e);
            }
            this.table = map;
            return map;
        },
        //===== 解析页面里的加密字体 =====
        parseFont: function () {
            if (this.font) return this.font;
            try {
                var styles = _d.getElementsByTagName('style');
                for (var i = 0; i < styles.length; i++) {
                    var t = styles[i].textContent || '';
                    if (t.indexOf('font-cxsecret') < 0) continue;
                    var m = t.match(/base64,([\w\W]+?)["']/);
                    if (!m) continue;
                    var raw = atob(m[1]);
                    var bytes = new Uint8Array(raw.length);
                    for (var k = 0; k < raw.length; k++) {
                        bytes[k] = raw.charCodeAt(k);
                    }
                    this.font = Typr.parse(bytes)[0];
                    return this.font;
                }
            } catch (e) {
                console.log(e);
            }
            return null;
        },
        //===== 单字解密（带缓存）=====
        decodeChar: function (ch) {
            if (!this.charMap) this.charMap = {};
            if (this.charMap[ch] != null) return this.charMap[ch];
            var code = ch.charCodeAt(0);
            if (code < 19968 || code > 40869) { // 非 CJK 区，原样返回
                this.charMap[ch] = ch;
                return ch;
            }
            var out = ch;
            try {
                var font = this.parseFont();
                if (font) {
                    var g = Typr.U.codeToGlyph(font, code);
                    if (g) {
                        var path = Typr.U.glyphToPath(font, g);
                        var h = md5(JSON.stringify(path)).slice(24);
                        var real = this.loadTable()[h];
                        if (real != null) out = String.fromCharCode(real);
                    }
                }
            } catch (e) {
                console.log(e);
            }
            this.charMap[ch] = out;
            return out;
        },
        //===== 文本解密 =====
        decryptText: function (text) {
            if (!text) return text || '';
            var out = '';
            for (var i = 0; i < text.length; i++) {
                out += this.decodeChar(text.charAt(i));
            }
            return out;
        },
        //===== 预热：把页面上出现过的加密字先解出来（不改动 DOM）=====
        warmup: function () {
            try {
                if (!this.parseFont()) return false;
                this.loadTable();
                var chars = {};
                var els = _d.getElementsByClassName('font-cxsecret');
                for (var i = 0; i < els.length; i++) {
                    var t = els[i].textContent || '';
                    for (var k = 0; k < t.length; k++) {
                        var c = t.charAt(k);
                        var code = c.charCodeAt(0);
                        if (code >= 19968 && code <= 40869) chars[c] = 1;
                    }
                }
                for (var c2 in chars) {
                    this.decodeChar(c2);
                }
                this.done = true;
                return true;
            } catch (e) {
                console.log(e);
                return false;
            }
        },
        //===== 兼容 v1.2 的调用方式（上游在答题分支里调 decrypt(0)）=====
        decrypt: function (retry) {
            if (this.done) return true;
            if (this.busy) return false;
            retry = retry || 0;
            if (!this.warmup()) {
                if (retry < 5) {
                    var self0 = this;
                    setTimeout(function () {
                        self0.decrypt(retry + 1);
                    }, 500);
                }
                return false;
            }
            aiLog('[系统] 字体解密完成，已还原 ' + Object.keys(this.charMap).length + ' 个字符', 'green');
            return true;
        },
        getCharMap: function () {
            return this.charMap;
        },
        applyMapToText: function (text, map) {
            if (!text || !map) return text;
            var out = '';
            for (var i = 0; i < text.length; i++) {
                var ch = text.charAt(i);
                out += (map[ch] != null) ? map[ch] : ch;
            }
            return out;
        }
    };

    //==================== 字体解密模块结束 ====================    //==================== 字体解密模块结束 ====================
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
        //===== 单个答案文字 → 选项下标（v1.11.3：打分制，纯函数，可单测）=====
        //  不再「首个包含即命中」：每个选项按「完全相等 / 包含长度占比 / 字符相似度」打分，
        //  低于置信度阈值不算命中；单选题只取最高分那一个（修掉「一句话勾多个」）。
        matchOne: function (answerText, options) {
            var m = ctBank.matchText(answerText, options, '');
            return (m && m.idxs && m.idxs.length) ? m.idxs[0] : -1;
        },
        //===== 题库答案 → 选项下标数组（v1.11.3：打分制 + 题型感知，纯函数，可单测）=====
        //  typeName 决定单选/多选：
        //  · 单选题只返回一个下标（最高分那个）；
        //  · 多选题把 '#' 分隔的**多条答案陈述**分别映射后取并集
        //    （'#' 是「多条答案」，不是「全部正确选项」）。
        matchAnswer: function (answerText, options, typeName) {
            var m = ctBank.matchText(answerText, options, typeName || '');
            return (m && m.idxs) ? m.idxs : [];
        },        //===== 收集题目 =====
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
        //===== 题库查询（v1.11.3：多源免费题库，与学习端共用同一个客户端）=====
        //  · 主源并行：icodef（cx.icodef.com）+ 百度不挂科（easylearn.baidu.com）；
        //  · 备用源兜底：icodef（q.icodef.com，与主源共享额度，只在全败后才试）；
        //  · 客户端内部已处理：每源节流（≥2 秒）、流控退避重试、命中缓存、失败分类；
        //  · 题库 Token 选填（实测匿名可用），token 只影响并发额度。
        ctAsk: function (question, typeName, cb) {
            try {
                ctBank.ask(question, typeName, function (r) {
                    if (r && r.ok) { cb(String(r.data)); return; }
                    cb(null);
                });
            } catch (e) {
                cb(null);
            }
        },        //===== AI 作答（复用 v1.1 的 aiAsk，返回的序号与选项顺序一致）=====
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
                        var idxs = self.matchAnswer(ans, q.options, q.type);
                        if (idxs.length) {
                            self.clickOptions(q, idxs);
                            aiLog('[题库] 命中：' + q.question.slice(0, 24) + ' → ' + idxs.map(function (i) {
                                return (i + 1) + '.' + q.options[i].text;
                            }).join(' / '), 'green');
                            cb(true, 'ct');
                            return;
                        }
                        aiLog('[题库] 答案无法匹配选项：' + ans.slice(0, 30), 'orange');
                    }
                    self.aiAnswer(q, function (ok, src) {
                        if (ok) {
                            aiLog('[AI] 作答：' + q.question.slice(0, 24) + ' → ' + src, 'green');
                            cb(true, 'ai');
                            return;
                        }
                        //随机兜底：单选选第一个，多选全选
                        var all = [];
                        for (var i = 0; i < q.options.length; i++) all.push(i);
                        var pick = (q.type === '多选题') ? all : [0];
                        self.clickOptions(q, pick);
                        aiLog('[答题] 题库与 AI 都没结果，随机兜底：' + q.question.slice(0, 24), 'orange');
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
                aiLog('[运行] 已暂停：本次不自动提交', 'orange');
                return;
            }
            if (!this.cfg.submit) {
                aiLog('[答题] 已作答 ' + realCount + '/' + list.length + ' 题（未开启自动提交）', 'orange');
                return;
            }
            if (realCount < list.length) {
                aiLog('[答题] 有 ' + (list.length - realCount) + ' 题只做了随机兜底，为避免交错答案，本次不自动提交', 'orange');
                return;
            }
            var btn = null;
            try {
                btn = _d.querySelector('a.Btn_blue_1.workBtnIndex') || _d.querySelector('.Btn_blue_1');
            } catch (e) { }
            if (!btn) {
                aiLog('[测验] 未找到提交按钮，请手动提交', 'orange');
                return;
            }
            aiLog('[测验] 全部题目已作答，正在提交…', 'green');
            var self = this;
            setTimeout(function () {
                try {
                    btn.click();
                    aiLog('[测验] 已点击提交', 'green');
                } catch (e) {
                    aiLog('[测验] 提交失败：' + e.message, 'red');
                }
            }, 600);
        },
        //===== 主流程 =====
        start: function () {
            var self = this;
            cxDecrypt.decrypt(0);
            var list = this.collect();
            if (!list.length) {
                aiLog('[答题] 当前页面没有识别到可自动作答的题目', 'orange');
                return;
            }
            aiLog('[答题] 识别到 ' + list.length + ' 道题，开始自动作答', 'green');
            var i = 0;
            var realCount = 0;
            var step = function () {
                //v1.5：暂停时停下，不再往下作答（已作答的题目保留）
                if (typeof pauseCtl != 'undefined' && pauseCtl.isPaused()) {
                    aiLog('[运行] 已暂停：已停止自动作答（已作答的题目保留）', 'orange');
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
                    aiLog('[运行] 已暂停：本次不自动作答', 'orange');
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
                        aiLog('[答题] 等待超时：页面里始终没有找到题目', 'orange');
                    }
                };
                setTimeout(wait, 1000);
            } catch (e) {
                console.log(e);
            }
        }
    };

    //==================== v1.3 附加模块开始 ====================
    // 【重要】以下三个功能来自上游整理，**尚未在真实超星页面上验证过**，默认全部关闭，
    //   需要在「附加功能（实验性）」面板里手动勾选开启。
    //   ① 强制复制粘贴：解除 paste/contextmenu/selectstart/copy/cut 限制 + user-select:text。
    //   ② 考试/作业端自动作答：题库 → AI → 随机兜底；只作答+翻页，不自动交卷。
    //   ③ 阅读/图书任务保活 + 自定义任务页（直播等）保活。
    var extras = {
        cfg: {
            paste: GM_getValue('unrivalExPaste', '0') == '1', //强制启用复制粘贴
            exam: GM_getValue('unrivalExExam', '0') == '1', //考试/作业端自动作答（未验证）
            keep: GM_getValue('unrivalExKeep', '0') == '1', //阅读/图书/自定义任务页保活（未验证）
            keepKeys: GM_getValue('unrivalExKeepKeys', '') || '', //自定义任务页关键词（逗号分隔）
            scrollSec: parseInt(GM_getValue('unrivalExScrollSec', 8), 10) || 8 //阅读滚动间隔（秒）
        },
        //===== 考试/作业页面识别（纯函数，可单测）=====
        matchExamPage: function (pathname, href) {
            pathname = pathname || '';
            href = href || '';
            var newMooc = href.indexOf('newMooc=true') >= 0;
            if (pathname === '/exam/test/reVersionTestStartNew' ||
                pathname === '/exam-ans/exam/test/reVersionTestStartNew' ||
                pathname === '/mooc-ans/exam/test/reVersionTestStartNew') {
                return newMooc ? 'examNew' : 'examOld';
            }
            if (pathname === '/mooc2/exam/preview' ||
                pathname === '/exam-ans/mooc2/exam/preview' ||
                pathname === '/mooc-ans/mooc2/exam/preview') {
                return 'examNew';
            }
            if (pathname === '/mooc2/work/dowork' || pathname === '/mooc-ans/mooc2/work/dowork') {
                return 'workNew';
            }
            if (pathname === '/work/doHomeWorkNew' || pathname === '/mooc-ans/work/doHomeWorkNew') {
                return 'workOld';
            }
            return '';
        },
        //===== 各页面的 DOM 规则（移植自上游 5.5.9.9.6，改写成原生选择器）=====
        examProfile: function (kind) {
            var map = {
                examOld: {
                    root: '.TiMu',
                    question: '.Cy_TItle .clearfix',
                    optInput: 'input[type=radio],input[type=checkbox]',
                    typeInput: 'input[name^=type]'
                },
                examNew: {
                    root: '.questionLi',
                    question: 'h3 div',
                    optInput: 'input[type=radio],input[type=checkbox]',
                    typeInput: 'input[name^=type]'
                },
                workNew: {
                    root: '.questionLi',
                    question: 'h3 div',
                    optInput: 'input[type=radio],input[type=checkbox]',
                    typeInput: 'input[name^=type]'
                },
                workOld: {
                    root: '.clearfix .TiMu',
                    question: '.Zy_TItle .clearfix',
                    optInput: 'input[type=radio],input[type=checkbox]',
                    typeInput: 'input[name^=answertype]'
                }
            };
            return map[kind] || null;
        },
        //===== 文本规范化（去空白/去选项字母前缀/去标点，可单测）=====
        normText: function (s) {
            if (!s) return '';
            return String(s)
                .replace(/\s+/g, '')
                .replace(/^[A-Ha-h][.、．)）:：]?/, '')
                .replace(/[，。！？；：、,.!?;:'"“”‘’（）()\[\]【】<>《》\-—_·]/g, '')
                .toLowerCase();
        },
        //===== 题库返回的是答案文字，按文字打分匹配选项（v1.11.3，可单测）=====
        //  单选题只返回一个下标（最高分那个），多选题返回多个；判断题走同义表。
        matchAnswerText: function (text, opts, typeName) {
            var m = ctBank.matchText(text, opts, typeName || '');
            return (m && m.idxs) ? m.idxs : [];
        },        //===== 收集考试/作业页的题目（可单测）=====
        collectExamQuestions: function (kind) {
            var p = this.examProfile(kind);
            var out = [];
            if (!p) return out;
            var roots = [], globalTypes = [];
            try { roots = _d.querySelectorAll(p.root); } catch (e) { return out; }
            try { globalTypes = _d.querySelectorAll(p.typeInput); } catch (e) { }
            for (var i = 0; i < roots.length; i++) {
                var root = roots[i];
                var qEl = null, tEl = null, inputs = [];
                try { qEl = root.querySelector(p.question); } catch (e) { }
                if (!qEl) continue;
                var question = String(qEl.innerText || qEl.textContent || '').replace(/\s+/g, ' ').trim();
                if (!question) continue;
                try { tEl = root.querySelector(p.typeInput); } catch (e) { }
                if (!tEl && globalTypes.length) tEl = globalTypes[i] || globalTypes[0];
                var typeVal = tEl ? String(tEl.value || '').trim() : '';
                var type = { '0': '单选题', '1': '多选题', '3': '判断题' }[typeVal] || '';
                if (!type) continue; //填空/简答(UEditor)暂不支持
                try { inputs = root.querySelectorAll(p.optInput); } catch (e) { }
                if (!inputs.length) continue;
                var opts = [];
                for (var k = 0; k < inputs.length; k++) {
                    var inp = inputs[k];
                    var txt = '', el = inp;
                    for (var up = 0; up < 4 && el; up++) {
                        var tt = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                        if (tt && tt.length > 1) { txt = tt; break; }
                        el = el.parentElement;
                    }
                    opts.push({ 'input': inp, 'text': txt });
                }
                out.push({ 'question': question, 'type': type, 'options': opts });
            }
            return out;
        },
        //===== 勾选选项 =====
        clickOption: function (input, force) {
            try {
                //force=true 用于「取消勾选」：已勾选时也要点一次，否则多选题取消不掉
                if (input.checked && !force) return true;
                input.click();
                return true;
            } catch (e) { }
            try {
                var lab = input.closest ? input.closest('label') : null;
                if (lab) { lab.click(); return true; }
            } catch (e) { }
            try { if (input.parentElement) input.parentElement.click(); } catch (e) { }
            return false;
        },
        applyExamAnswer: function (q, idxs) {
            if (!q || !q.options || !q.options.length || !idxs || !idxs.length) return false;
            var multi = (q.type === '多选题');
            var done = 0;
            for (var i = 0; i < q.options.length; i++) {
                var want = idxs.indexOf(i) >= 0;
                var input = q.options[i].input;
                try {
                    if (want) {
                        if (!input.checked) this.clickOption(input);
                        done++;
                    } else if (multi && input.checked) {
                        this.clickOption(input, true); //多选：取消没选中的
                    }
                } catch (e) { }
            }
            return done > 0;
        },
        //===== 题库查询（v1.11.3：多源免费题库，与学习端共用同一个客户端）=====
        ctAsk: function (question, typeName, cb) {
            try {
                ctBank.ask(question, typeName, function (r) {
                    if (r && r.ok) { cb(String(r.data)); return; }
                    cb(null);
                }, { id: (typeof wid !== 'undefined' ? wid : 1) });
            } catch (e) {
                cb(null);
            }
        },        //===== AI 作答（复用 AI 模块的 aiState / parseAnswerIndex）=====
        examAiAsk: function (q, cb) {
            if (!aiState.enable || !aiState.baseUrl || !aiState.model || !aiState.key) { cb(null, 'AI未配置'); return; }
            var lines = [];
            for (var i = 0; i < q.options.length; i++) {
                var t = String(q.options[i].text || '').replace(/^\s*[A-Ha-h]\s*[.、．)）:：]?\s*/, '').trim();
                lines.push((i + 1) + '. ' + t);
            }
            var payload = {
                'model': aiState.model,
                'temperature': 0,
                //v1.4.1：与 v1.1 主 AI 模块同步放宽输出上限（推理型模型的思考token计入max_tokens）
                'max_tokens': 8000,
                'messages': [{
                    'role': 'system',
                    'content': '你是一个严谨的考试答题助手。只输出一个JSON对象，不要解释，不要markdown代码块。格式：{"answers":[序号],"confidence":0.9}。answers是正确选项的序号数组（从1开始，按题目给出的选项顺序编号）；单选题和判断题只给一个序号，多选题可给多个；必须且只能使用给出的选项序号。'
                }, {
                    'role': 'user',
                    'content': '题型：' + q.type + '\n题目：' + q.question + '\n选项：\n' + lines.join('\n')
                }]
            };
            //v1.4.2：与 v1.1 主 AI 模块一致，MiniMax 推理型模型降思考深度，避免思考吃满输出上限
            if (/minimax/i.test(aiState.baseUrl)) payload['reasoning_effort'] = 'low';
            try {
                GM_xmlhttpRequest({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + aiState.key },
                    url: aiState.baseUrl.replace(/\/+$/, '') + '/chat/completions',
                    timeout: aiState.timeout,
                    data: JSON.stringify(payload),
                    onload: function (res) {
                        var body = (res && res.responseText) ? res.responseText : '';
                        var text = '';
                        var fin = '';
                        try {
                            var data = JSON.parse(body);
                            text = data.choices[0].message.content || '';
                            fin = data.choices[0].finish_reason || '';
                        } catch (e) { }
                        if (!text) { cb(null, 'AI返回为空' + (fin ? '（finish_reason=' + fin + '）' : '')); return; }
                        var idx = parseAnswerIndex(text, q.options.length);
                        if (!idx.length) { cb(null, 'AI返回无法解析'); return; }
                        cb(idx, 'AI');
                    },
                    onerror: function () { cb(null, 'AI请求失败'); },
                    ontimeout: function () { cb(null, 'AI请求超时'); }
                });
            } catch (e) { cb(null, 'AI请求异常'); }
        },
        //===== 单题作答：题库 → AI → 随机兜底 =====
        answerExamQuestion: function (q, cb) {
            var self = this;
            this.ctAsk(q.question, q.type, function (text) {
                if (text) {
                    var hit = self.matchAnswerText(text, q.options, q.type);
                    if (hit.length) {
                        self.applyExamAnswer(q, hit);
                        cb(true, '题库');
                        return;
                    }
                }
                self.examAiAsk(q, function (idxs) {
                    if (idxs && idxs.length) {
                        var zero = [];
                        for (var i = 0; i < idxs.length; i++) zero.push(idxs[i] - 1);
                        self.applyExamAnswer(q, zero);
                        cb(true, 'AI');
                        return;
                    }
                    var pick = [];
                    if (q.type === '多选题') {
                        for (var j = 0; j < q.options.length; j++) pick.push(j);
                    } else {
                        pick = [Math.min(1, q.options.length - 1)];
                    }
                    self.applyExamAnswer(q, pick);
                    cb(false, '兜底');
                });
            });
        },
        //===== 整页作答 =====
        answerExamPage: function (kind) {
            var self = this;
            this._examPages = (this._examPages || 0) + 1;
            if (this._examPages > 100) { aiLog('[答题] 考试端：翻页次数超过上限，已停止', 'orange'); return; }
            var qs = this.collectExamQuestions(kind);
            if (!qs.length) { aiLog('[答题] 考试端：未识别到题目（' + kind + '），页面结构可能不同', 'orange'); return; }
            aiLog('[答题] 考试端：识别到 ' + qs.length + ' 道题（' + kind + '）', 'green');
            var i = 0;
            var step = function () {
                if (i >= qs.length) { self.examNextPage(kind); return; }
                var q = qs[i++];
                self.answerExamQuestion(q, function (ok, src) {
                    aiLog('[答题] 考试端：' + (ok ? ('已作答(' + src + ') ') : '兜底作答 ') + String(q.question).substring(0, 30), ok ? 'green' : 'orange');
                    setTimeout(step, 1200);
                });
            };
            step();
        },
        //===== 翻到下一题（只在找到唯一按钮时才点，不自动交卷）=====
        examNextPage: function (kind) {
            var self = this;
            var cands = [];
            try {
                var els = _d.querySelectorAll('a, button, .jb_btn, .saveYl');
                for (var i = 0; i < els.length; i++) {
                    var t = String(els[i].innerText || els[i].textContent || '').replace(/\s+/g, '');
                    if (t.indexOf('下一题') >= 0) cands.push(els[i]);
                }
            } catch (e) { }
            if (cands.length !== 1) { aiLog('[答题] 考试端：未找到唯一的「下一题」按钮，已停止自动翻页', 'orange'); return; }
            try {
                cands[0].click();
                aiLog('[答题] 考试端：已翻到下一题', 'green');
                setTimeout(function () { self.answerExamPage(kind); }, 2500);
            } catch (e) { }
        },
        //===== 强制复制粘贴（移植自上游 pasteEnabler，ES5 改写）=====
        paste: {
            init: function () {
                this.removeGlobalRestrictions();
                this.injectGlobalStyles();
                this.enableExistingElements();
                this.startMutationObserver();
            },
            removeGlobalRestrictions: function () {
                var evts = ['paste', 'contextmenu', 'selectstart', 'dragstart', 'copy', 'cut'];
                for (var i = 0; i < evts.length; i++) {
                    try { _d['on' + evts[i]] = null; } catch (e) { }
                }
                //允许右键菜单（部分页面用 addEventListener 阻止右键）
                try {
                    _d.addEventListener('contextmenu', function (e) { e.stopPropagation(); }, true);
                } catch (e) { }
                try { this.removeElementRestrictions(_d.body); } catch (e) { }
            },
            injectGlobalStyles: function () {
                try {
                    var style = _d.createElement('style');
                    style.textContent = '*{-webkit-user-select:text!important;-moz-user-select:text!important;-ms-user-select:text!important;user-select:text!important;} input,textarea,[contenteditable]{user-select:text!important;pointer-events:auto!important;}';
                    (_d.head || _d.documentElement).appendChild(style);
                } catch (e) { }
            },
            removeElementRestrictions: function (el) {
                if (!el) return;
                var evts = ['paste', 'contextmenu', 'keydown', 'selectstart', 'dragstart', 'copy', 'cut'];
                for (var i = 0; i < evts.length; i++) {
                    try {
                        el['on' + evts[i]] = null;
                        el.removeAttribute('on' + evts[i]);
                    } catch (e) { }
                }
                try { el.removeAttribute('readonly'); } catch (e) { }
                try { el.removeAttribute('disabled'); } catch (e) { }
                try {
                    el.style.userSelect = 'text';
                    el.style.webkitUserSelect = 'text';
                    el.style.pointerEvents = 'auto';
                } catch (e) { }
            },
            enableExistingElements: function () {
                try {
                    var els = _d.querySelectorAll('input, textarea, [contenteditable]');
                    for (var i = 0; i < els.length; i++) this.removeElementRestrictions(els[i]);
                } catch (e) { }
            },
            startMutationObserver: function () {
                var self = this;
                try {
                    var obs = new MutationObserver(function (muts) {
                        for (var m = 0; m < muts.length; m++) {
                            var nodes = muts[m].addedNodes;
                            for (var n = 0; n < nodes.length; n++) {
                                var node = nodes[n];
                                if (!node || node.nodeType !== 1) continue;
                                try {
                                    if (node.matches && node.matches('input, textarea, [contenteditable]')) self.removeElementRestrictions(node);
                                    var sub = node.querySelectorAll ? node.querySelectorAll('input, textarea, [contenteditable]') : [];
                                    for (var s = 0; s < sub.length; s++) self.removeElementRestrictions(sub[s]);
                                } catch (e) { }
                            }
                        }
                    });
                    obs.observe(_d.body || _d.documentElement, { childList: true, subtree: true });
                } catch (e) { }
            }
        },
        //===== 任务页识别（阅读/图书 + 自定义关键词：直播等）=====
        matchTaskPage: function (href, extraKeys) {
            href = href || '';
            if (href.indexOf('/ztnodedetailcontroller/visitnodedetail') >= 0) return 'reading';
            if (href.indexOf('/mooc-ans/zt/portal/') >= 0) return 'readingCatalog';
            if (/\/course\/\d+\.html/i.test(href)) return 'readingCatalog';
            var keys = String(extraKeys || '').split(/[,，\s]+/);
            for (var i = 0; i < keys.length; i++) {
                var k = keys[i];
                if (k && href.toLowerCase().indexOf(k.toLowerCase()) >= 0) return 'custom';
            }
            return '';
        },
        //===== 任务页保活 =====
        keep: {
            start: function (kind) {
                var self = this;
                this.kind = kind;
                this.elapsed = parseInt(GM_getValue('unrivalExKeepSec', '0'), 10) || 0;
                if (kind === 'reading') this.autoScroll();
                this.timer = setInterval(function () {
                    self.elapsed += 1;
                    GM_setValue('unrivalExKeepSec', String(self.elapsed));
                    if (self.elapsed % 60 === 0) {
                        aiLog('[运行] 任务页保活：已停留 ' + Math.floor(self.elapsed / 60) + ' 分钟（本地计时，超星侧是否计入未验证）', 'blue');
                    }
                }, 1000);
            },
            autoScroll: function () {
                var self = this;
                var roots = ['.read_content', '.article', '.content', '#content', '.node-content', '.chapter-content', '.ans-cc', 'main'];
                var step = function () {
                    var target = null;
                    for (var i = 0; i < roots.length; i++) {
                        try { target = _d.querySelector(roots[i]); } catch (e) { target = null; }
                        if (target) break;
                    }
                    if (target) {
                        try {
                            var ps = target.querySelectorAll('p, .para, [class*=para]');
                            if (ps && ps.length) {
                                var idx = self._paraIdx || 0;
                                if (idx >= ps.length) idx = 0;
                                ps[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
                                self._paraIdx = idx + 1;
                            } else {
                                try { _w.scrollBy(0, 400); } catch (e) {
                                    try { _d.documentElement.scrollTop += 400; _d.body.scrollTop += 400; } catch (e2) { }
                                }
                            }
                        } catch (e) { }
                    }
                    setTimeout(step, Math.max(3, self.cfg.scrollSec) * 1000);
                };
                setTimeout(step, 1500);
            }
        },
        //===== 入口 =====
        init: function () {
            try {
                if (this.cfg.paste) {
                    this.paste.init();
                    aiLog('[设置] 附加功能：已启用强制复制粘贴', 'green');
                }
                if (this.cfg.exam) {
                    var kind = this.matchExamPage(_l.pathname, _l.href);
                    if (kind) this.answerExamPage(kind);
                }
                if (this.cfg.keep) {
                    var tk = this.matchTaskPage(_l.href, this.cfg.keepKeys);
                    if (tk) this.keep.start(tk);
                }
            } catch (e) {
                console.log(e);
            }
        }
    };
    //==================== v1.3 附加模块结束 ====================
    //==================== AI 答题模块结束 ====================
    //==================== v1.8 面板布局整理开始 ====================
    // 【v1.8 相比 v1.6 改了什么】
    //   ① 折叠按钮重做：v1.6 只是在标题右边浮一个灰色 ▾ 字符 —— 又小又灰、看不出是能点的，
    //      还得瞄准那个字符点。v1.8 改成「点标题文字即可折叠」，箭头做成带底色的小按钮、
    //      hover 变色、鼠标手型，一眼能看出可点。
    //   ② 「任务配置」区块不再折叠（用户反馈：这个区块本来就短，折叠反而多一步操作）。
    //   ③ 保留 v1.6 的限高滚动条（运行日志 260px / 任务列表 220px / 章节测试 iframe 520px）。
    //
    // 【只动脚本自己的面板】
    //   靠标题 id=unrivalTitle 所在的 col-md-6 容器定位，不碰超星页面本身的 DOM。
    var layoutFix = {
        findRoot: function () {
            try {
                var t = _d.getElementById('unrivalTitle');
                if (!t) return null;
                var p = t;
                while (p && p.parentNode) {
                    if (p.className && String(p.className).indexOf('col-md-6') >= 0) return p;
                    p = p.parentNode;
                }
                return (t.parentNode && t.parentNode.parentNode) ? t.parentNode.parentNode : null;
            } catch (e) {
                return null;
            }
        },
        //===== 折叠开关（点标题或箭头都生效）=====
        toggle: function (panel, head, arrow) {
            try {
                var collapsed = String(panel.className || '').indexOf('unrival-collapsed') >= 0;
                if (collapsed) {
                    panel.className = String(panel.className || '').replace(/\s*unrival-collapsed\s*/, ' ').replace(/\s+$/, '');
                    arrow.innerHTML = '▾';
                    if (head) head.setAttribute('title', '点击收起');
                } else {
                    panel.className = (String(panel.className || '') + ' unrival-collapsed').replace(/\s+/g, ' ');
                    arrow.innerHTML = '▸';
                    if (head) head.setAttribute('title', '点击展开');
                }
            } catch (e) { }
        },
        init: function () {
            try {
                var root = this.findRoot();
                if (!root) return false;
                var panels = root.getElementsByClassName('panel');
                var arrows = 0;
                for (var i = 0; i < panels.length; i++) {
                    var panel = panels[i];
                    if (panel.getAttribute('data-unrival-toggle') == '1') continue;
                    var head = null, body = null;
                    for (var j = 0; j < panel.children.length; j++) {
                        var c = panel.children[j];
                        var cn = String(c.className || '');
                        if (!head && cn.indexOf('panel-heading') >= 0) head = c;
                        if (!body && cn.indexOf('panel-body') >= 0) body = c;
                    }
                    if (!head || !body) continue;
                    //v1.8：「任务配置」不折叠
                    var headText = String(head.textContent || '');
                    if (headText.indexOf('任务配置') >= 0) continue;
                    panel.setAttribute('data-unrival-toggle', '1');
                    var arrow = _d.createElement('span');
                    arrow.className = 'unrival-arrow';
                    arrow.innerHTML = '▾';
                    head.appendChild(arrow);
                    head.className = (String(head.className || '') + ' unrival-clickable').replace(/\s+/g, ' ');
                    head.setAttribute('title', '点击收起');
                    arrows++;
                    //v1.8：点标题整行都能折叠（箭头自身 pointer-events:none，避免触发两次）
                    var self = this;
                    head.onclick = function (ev) {
                        try { if (ev && ev.stopPropagation) ev.stopPropagation(); } catch (e) { }
                        var p = this.parentNode;
                        var a = this.getElementsByClassName('unrival-arrow')[0];
                        if (p && a) self.toggle(p, this, a);
                    };
                }
                // 日志区 / 任务列表：限高 + 滚动条
                try {
                    var logWrap = root.querySelector('#result');
                    if (logWrap) {
                        logWrap.style.maxHeight = '260px';
                        logWrap.style.overflowY = 'auto';
                    }
                    var joblist = root.querySelector('#joblist');
                    if (joblist) {
                        joblist.style.maxHeight = '220px';
                        joblist.style.overflowY = 'auto';
                    }
                } catch (e) { }
                // 自检：折叠箭头加了多少个（配合调试模式落到日志里，便于核对渲染结果）
                try {
                    if (typeof dbg != 'undefined') {
                        dbg.log('info', '面板整理：已加折叠箭头 ' + arrows + ' 个（任务配置除外）；日志区/任务列表已限高');
                    }
                } catch (e2) { }
                return true;
            } catch (e) {
                console.log(e);
                return false;
            }
        },
        start: function () {
            var self = this;
            var tries = 0;
            var wait = function () {
                tries++;
                if (self.init()) return;
                if (tries < 30) setTimeout(wait, 500);
            };
            setTimeout(wait, 500);
        }
    };
    try {
        layoutFix.start();
    } catch (e) {
        console.log(e);
    }
    //==================== v1.8 面板布局整理结束 ====================
    //==================== v1.8 面板版本号动态化开始 ====================
    // 【解决什么】
    //   v1.7 装上后，面板大标题却还写着「超星学习通小助手 v1.6（AI 版）」——
    //   因为标题里的版本号是**写死在补丁里的字符串**，每次升版本都得手工改，
    //   漏改一次就会像这次一样「脚本已是 1.7、界面还写着 1.6」。
    //
    // 【怎么改】
    //   标题里只留一个占位 <span id="unrivalVer"></span>，
    //   版本号在运行时从 GM_info.script.version 取 —— 以后无论升到哪一版，
    //   界面自动跟着变，不需要再动补丁。
    //
    // 【注意】
    //   只处理脚本自己注入的主面板（靠 id=unrivalTitle 定位）；
    //   挂机小助手那个独立页面（unrivalxxtbackground）不碰。
    var panelVer = {
        //从 GM_info 取真实版本号，取不到就显示未知
        raw: function () {
            try {
                var v = (GM_info && GM_info.script && GM_info.script.version) || '';
                return String(v);
            } catch (e) {
                return '';
            }
        },
        //显示成「1.8」这样的短版本（1.8.0-AI → 1.8）
        short: function (v) {
            var m = String(v || '').match(/(\d+)\.(\d+)/);
            return m ? (m[1] + '.' + m[2]) : '';
        },
        apply: function () {
            try {
                var el = _d.getElementById('unrivalVer');
                if (!el) return false;
                var v = this.raw();
                var s = this.short(v);
                el.innerHTML = s ? ('v' + s) : 'v?';
                //浏览器标签页标题也跟着走
                try {
                    var t = _d.title || '';
                    if (t.indexOf('超星学习通小助手') >= 0) {
                        _d.title = '超星学习通小助手 v' + (s || '?') + '（AI 版）';
                    }
                } catch (e2) { }
                return true;
            } catch (e) {
                return false;
            }
        },
        start: function () {
            var self = this;
            var tries = 0;
            var wait = function () {
                tries++;
                if (self.apply()) return;
                if (tries < 30) setTimeout(wait, 500);
            };
            setTimeout(wait, 500);
        }
    };
    try {
        panelVer.start();
    } catch (e) {
        console.log(e);
    }
    //==================== v1.8 面板版本号动态化结束 ====================


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
    //==================== v1.11.2 日志规范开始 ====================
    // 【v1.11.2 给「运行日志」立的规矩】
    //   ① 行格式统一为：  [时间] [标签] 句子
    //      标签让用户一眼看出这条属于哪一类（视频 / 文档 / 测验 / 阅读 / 托管 / 运行 …）。
    //   ② 标签集固定 12 个，见 TAGS；不在集合里的不算标签。
    //   ③ 句式统一为「动作 + 对象 + 结果（+ 原因）」，标点用中文全角，不用感叹号叠用。
    //   ④ 开发自检类信息（页面就绪、面板整理、调试命令回显）只走调试通道，不进用户日志。
    //   ⑤ 连续重复的同一条消息合并计数（显示成「原文（×N）」），不刷屏。
    //
    // 【为什么分成「源码改写」和「运行时兜底」两半】
    //   · 绝大多数文案是在 src/patches/patch-v1.11.2.ps1 里**逐条改写**的：
    //     改写点都有命中次数断言，能审、能测、能回溯。
    //   · 这个模块只负责「改不到的那部分」：
    //       · 动态拼出来的消息（题目文本、超星原文告警等）补标签；
    //       · 空白折叠、空消息丢弃；
    //       · 万一有漏网的无标签消息，兜底补一个 [系统] 标签，不让格式乱掉。
    //
    // 【不做什么】
    //   · 不做「关键词自动分类」—— 那类规则既不可测也不可审，漏一条就悄悄变形；
    //   · 不改日志的存储语义（仍是按标签页会话，见 loghist.v1.11.2.js）。
    var logSpec = {
        //标签集：用户日志里每一行的标签只能是这 12 个之一
        TAGS: ['视频', '文档', '测验', '答题', '题库', 'AI', '阅读', '托管', '翻章', '运行', '设置', '系统'],
        //行首标签的写法：[标签] 后面跟一个空格
        TAG_RE: /^\[([^\]\s]{1,8})\]\s*/,
        //清理：换行/制表符/不换行空格压成空格，连续空格压成一个，首尾去空白
        clean: function (text) {
            var s = (text == null ? '' : String(text));
            s = s.replace(/[\r\n\t]+/g, ' ');
            s = s.replace(/\u00a0/g, ' ');
            s = s.replace(/ {2,}/g, ' ');
            return s.replace(/^\s+|\s+$/g, '');
        },
        //是不是已经带了合法标签
        hasTag: function (text) {
            var m = this.TAG_RE.exec(this.clean(text));
            return !!(m && this.TAGS.indexOf(m[1]) >= 0);
        },
        //补标签（已经有合法标签就原样返回；标签不在集合里算「系统」）
        tag: function (text, tag) {
            var s = this.clean(text);
            if (!s) return '';
            if (this.hasTag(s)) return s;
            var t = (tag && this.TAGS.indexOf(tag) >= 0) ? tag : '系统';
            return '[' + t + '] ' + s;
        },
        //兜底规范化：没标签的补 [系统]
        normalize: function (text) {
            var s = this.clean(text);
            if (!s) return '';
            if (this.hasTag(s)) return s;
            return '[系统] ' + s;
        }
    };
    //==================== v1.11.2 日志规范结束 ====================
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
    //==================== v1.11.2 全程托管模式开始 ====================
    // 【要解决的问题】
    //   原脚本遇到「不支持的任务类型」（直播/阅读等）会**主动停下等人**：
    //   v1.6 的设计是「绝不能悄悄把还有任务点的章节跳过去」，
    //   所以脚本会打一行红字、然后 pauseCtl.set(true) 自己停住，等人工处理完再点「继续」。
    //   对「想让它自己从头刷到尾」的用户来说，这就等于刷一半不刷了 —— 进度卡住还得守着。
    //
    // 【全程托管模式换一个取舍】
    //   遇到做不了的任务（直播/阅读/自定义任务）就**跳过并记账**，继续往下推进，
    //   直到没有下一节为止。被跳过的任务会写进日志和任务列表，不会静默吞掉。
    //
    // 【开启后行为差异（三处）】
    //   ① 不支持的任务类型：不再暂停，改为跳过并继续；
    //   ② 超星说「章节未开放」（闯关锁定）时：不再直接退出脚本，改为记录后继续；
    //   ③ 本章任务做完后超星没放行（没有下一节 / 上一节有未完成的任务点）：
    //      每 20 秒重试一次跳转，日志限频，不会静默卡住不动。
    //
    // 【边界（别误以为能全自动刷完所有任务点）】
    //   · 跳过的章节，其任务点不会被点亮 —— 闯关模式下超星可能不放行到下一节；
    //     这时脚本会持续重试并写日志，需要人工把那一节的任务点补上才能继续往下。
    //   · 直播类任务即使跳过，也要超星那边自己到期才算完成，脚本替代不了。
    //   · 默认关闭（unrivalAutoRun = '0'），不改变原来的行为。
    //
    // 【v1.11.2 改了什么】
    //   只改了日志文案：按 v1.11.2 的日志规范统一加 [托管] 标签、统一句式。
    //   行为一个字没动。
    var autoRun = {
        KEY: 'unrivalAutoRun',
        INTERVAL: 20000,      // 重试间隔：20 秒
        LOG_EVERY: 60000,     // 日志限频：最多每分钟一条
        LOG_EVERY_LATE: 300000, // 重试多了以后，日志放宽到每 5 分钟一条
        _timer: null,
        _lastLog: 0,
        _tries: 0,
        enabled: function () {
            try { return GM_getValue(this.KEY, '0') == '1'; } catch (e) { return false; }
        },
        setEnabled: function (on) {
            try { GM_setValue(this.KEY, on ? '1' : '0'); } catch (e) { }
            //让顶层窗口也知道（调试状态里要能看到）
            try { _w.top.unrivalAutoRun = on ? '1' : '0'; } catch (e1) { }
        },
        //写日志：面板还没建好时（logs 未定义）就跳过，不能因此抛错
        log: function (msg, color) {
            try {
                if (typeof logs != 'undefined' && logs && logs.addLog) {
                    logs.addLog(msg, color || 'black');
                }
            } catch (e) { }
        },
        //本章的任务是不是都做完了（做完了才谈得上「推进下一节」）
        chapterDone: function () {
            try {
                if (typeof busyThread != 'undefined' && busyThread > 0) return false;
                if (typeof missionList == 'undefined' || !missionList) return false;
                for (var k in missionList) {
                    if (!missionList[k]['done']) return false;
                }
                return true;
            } catch (e) { return false; }
        },
        //看门狗：本章做完了但超星没把我们带到下一节 → 定期重试
        _watchTick: function () {
            try {
                if (!this.enabled()) return;
                if (typeof pauseCtl != 'undefined' && pauseCtl.isPaused()) return;   // 用户暂停了就不催
                if (typeof jumpType != 'undefined' && jumpType == 2) return;          // 「不跳转」模式不催
                if (!this.chapterDone()) return;                                     // 本章还没做完
                this._tries++;
                //再要一次跳转（跟脚本平时用的同一套机制）
                try { _w.top.jump = true; } catch (e1) { }
                var now = Date.now();
                var gap = (this._tries > 5) ? this.LOG_EVERY_LATE : this.LOG_EVERY;
                if (now - this._lastLog < gap) return;
                this._lastLog = now;
                var msg = '[托管] 这一节的任务已做完，但超星没有跳到下一节（第 ' + this._tries + ' 次重试）';
                if (this._tries > 5) {
                    msg += '。可能已经到最后一节，也可能上一节还有没完成的任务点（脚本做不了的那种），需要人工补上才会继续';
                }
                this.log(msg, 'orange');
            } catch (e) { }
        },
        start: function () {
            var self = this;
            if (this._timer) return;
            //只有超星的章节列表页才需要看门狗（别的页面没有任务循环）
            try {
                if (typeof _l == 'undefined' || !_l || _l.href.indexOf('knowledge/cards') < 0) return;
            } catch (e) { return; }
            this._timer = setInterval(function () {
                try { self._watchTick(); } catch (e2) { }
            }, this.INTERVAL);
        }
    };
    try {
        autoRun.start();
    } catch (e) {
        console.log(e);
    }
    //==================== v1.11.2 全程托管模式结束 ====================
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
            try { s.push('全程托管=' + (autoRun.enabled() ? '开' : '关')); } catch (e1) { }
            try { s.push('阅读助手=' + (readAssist.enabled() ? '开' : '关')); } catch (e2) { }
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
    //==================== v1.8.1 章节测试提交结果回报开始 ====================
    // 【v1.8.1 相比 v1.8 改了什么】
    //   v1.8 的第一版读不到成绩，日志打的是「没读到成绩文字（可能跨域或页面无提示）」。
    //   但同一行里的页面路径**已经读到了**：`ans/work/phone/selectWorkQuestionYiPiYue`
    //   —— 说明**不是跨域**（同源，location.href 读得到），而是**读得太早**：
    //   父页面板每 500ms 轮询一次，作业 iframe 刚跳到成绩页、页面正文还没渲染出来，
    //   此刻 body 里是空的。v1.8 读一次就放弃了。
    //
    // 【v1.8.1 怎么改】
    //   ① 读不到就重试（最多 7 次、每次隔 400ms，约 3 秒）；
    //   ② 为了给重试留时间，iframe 的清空推迟到读完之后再执行（由 done 回调完成）；
    //   ③ 报告分级，不再含糊：
    //      · 命中成绩关键词 → 直接给成绩文字；
    //      · 没命中但有正文 → 给页面首段文字（看得出这是哪个页面、显示了什么）；
    //      · 连正文都读不到 → 明确说是跨域、还是文档没 body、还是读取异常。
    //
    // 【为什么要留这个模块】
    //   v1.8 实跑已经证明：iframe 提交后确实跳到了成绩页 selectWorkQuestionYiPiYue
    //   ⇒ **提交动作是成功的**，任务点也确实完成了。
    //   这个模块的作用从「查提交有没有成功」变成「把成绩读出来」，
    //   顺带留下一条可复核的证据链。
    //
    // 【边界】
    //   · 只读 iframe 的 DOM，不点任何按钮、不改任何数据；
    //   · 全程 try/catch，读不到就跳过，绝不影响正常刷课流程；
    //   · 重试期间作业 iframe 会多停留几秒（任务标记 done 仍是 +5s，不受影响）。
    var workResult = {
        KEYWORDS: ['正确率', '分数', '成绩', '得分', '通过', '未通过', '不合格', '及格', '次数', '排名', '答对', '答错'],
        MAX_TRY: 7,
        INTERVAL: 400,
        SNIPPET: 90,
        //读一次作业 iframe 的当前页面
        read: function () {
            try {
                var fr = _d.getElementById('frame_content');
                if (!fr) return { ok: false, why: '找不到作业 iframe', url: '', text: '', len: 0 };
                var win = null;
                try { win = fr.contentWindow; } catch (e0) { }
                if (!win) return { ok: false, why: '拿不到 iframe 的窗口对象', url: '', text: '', len: 0 };
                var url = '';
                try { url = String(win.location.href || ''); } catch (e1) { }
                var doc = null;
                try { doc = win.document; } catch (e2) { }
                if (!doc) return { ok: false, why: '跨域，读不到 iframe 文档', url: url, text: '', len: 0 };
                var body = null;
                try { body = doc.body; } catch (e3) { }
                if (!body) return { ok: false, why: 'iframe 文档还没有 body（页面没渲染完）', url: url, text: '', len: 0 };
                var txt = '';
                try { txt = String(body.innerText || ''); } catch (e4) { }
                if (!txt) { try { txt = String(body.textContent || ''); } catch (e5) { } }
                txt = txt.replace(/\s+/g, ' ').trim();
                return { ok: true, why: '', url: url, text: txt, len: txt.length };
            } catch (e) {
                return { ok: false, why: '读取异常：' + (e && e.message ? e.message : e), url: '', text: '', len: 0 };
            }
        },
        //从正文里挑出与成绩有关的句子
        pick: function (text) {
            try {
                var segs = String(text || '').split(/[。；;！!？?\n]/);
                var out = [];
                for (var i = 0; i < segs.length && out.length < 5; i++) {
                    var s = segs[i].trim();
                    if (!s || s.length > 60) continue;
                    for (var k = 0; k < this.KEYWORDS.length; k++) {
                        if (s.indexOf(this.KEYWORDS[k]) >= 0) { out.push(s); break; }
                    }
                }
                return out.join(' / ');
            } catch (e) { return ''; }
        },
        shortUrl: function (u) {
            try {
                var s = String(u || '');
                if (!s) return '未知';
                s = s.replace(/^https?:\/\//, '').split('?')[0];
                return s.slice(-46);
            } catch (e) { return '未知'; }
        },
        say: function (msg) {
            try { logs.addLog(logSpec.tag(msg, '测验'), 'blue'); } catch (e) { }
        },
        //where：前缀；done：读完之后要执行的收尾（清空 iframe）
        report: function (where, done) {
            var self = this;
            var tries = 0;
            var best = null;
            var last = null;
            var finish = function () { try { if (done) done(); } catch (e) { } };
            var once = function () {
                var g = self.read();
                last = g;
                if (g.ok && g.len > 0) {
                    if (!best || g.len > best.len) best = g;
                    var hits = self.pick(g.text);
                    if (hits) {
                        self.say((where || '章节测试') + '提交后：超星页面显示「' + hits + '」（页面 ' + self.shortUrl(g.url) + '）');
                        finish();
                        return;
                    }
                }
                tries++;
                if (tries < self.MAX_TRY) { setTimeout(once, self.INTERVAL); return; }
                // 读不到有用的文字：把能拿到的原样报出来
                if (best && best.len > 0) {
                    var snip = best.text.slice(0, self.SNIPPET);
                    self.say((where || '章节测试') + '提交后：页面正文里没找到成绩文字，首段是「' + snip + '」（页面 ' + self.shortUrl(best.url) + '）');
                } else {
                    var why = (last && last.why) ? last.why : '没读到正文';
                    self.say((where || '章节测试') + '提交后：' + why + '（页面 ' + self.shortUrl(last && last.url) + '）');
                }
                finish();
            };
            try { once(); } catch (e) { finish(); }
        }
    };
    //==================== v1.8.1 章节测试提交结果回报结束 ====================



    //==================== v1.5 暂停控制模块开始 ====================
    // 【为什么加这个】
    //   「遍历」翻章模式下脚本会自己跑个不停：答完 → 5秒后自动下一章 → 再答 → 再跳 …
    //   循环下去停不下来，想停只能关扩展或刷新页面（会丢掉当前章的进度）。
    //   上游唯一的出口是 jumpType=2「不跳转」，但它会把「翻章模式」这个设置本身改掉，
    //   语义混在一起，用完还得手动改回来。
    //   这里加一个独立的「暂停」开关：
    //     · 状态存 GM 存储 —— 翻章 reload 后仍然是暂停的（不会一翻页就复活）
    //     · 运行时把 jumpType 压成 2，并拦掉上游写 `_w.jump = true` 的动作（双保险）
    //     · 同时让 workAuto 停下：不再自动作答、不再自动提交
    //     · 点「继续」恢复原来的翻章模式（读回存储里的 unrivaljumpType）
    var pauseCtl = {
        KEY: 'unrivalPaused',
        _guardInstalled: false,
        isPaused: function () {
            try {
                return GM_getValue(this.KEY, '0') == '1';
            } catch (e) {
                return false;
            }
        },
        apply: function (paused) {
            try {
                if (paused) {
                    jumpType = 2;                                  // 上游的「不跳转」模式
                    try { _w.jump = false; } catch (e) { }
                    try { _w.top.jump = false; } catch (e) { }
                } else {
                    var m = String(GM_getValue('unrivaljumpType', '1'));
                    jumpType = (m === '2') ? 2 : ((m === '0') ? 0 : 1);
                }
            } catch (e) { }
        },
        set: function (paused) {
            try {
                GM_setValue(this.KEY, paused ? '1' : '0');
                this.apply(paused);
            } catch (e) { }
        },
        installGuard: function () {
            // 拦掉上游的 `_w.jump = true`：暂停时不允许再触发自动翻章
            // （上游在 3 个地方写它：任务做完 / 本页无任务 / 正确率不达标已保存）
            try {
                if (this._guardInstalled) return;
                var self = this;
                var val = false;
                try { val = _w.jump; } catch (e) { }
                Object.defineProperty(_w, 'jump', {
                    configurable: true,
                    enumerable: true,
                    get: function () {
                        return val;
                    },
                    set: function (v) {
                        if (v === true && self.isPaused()) {
                            val = false;
                            return;
                        }
                        val = v;
                    }
                });
                this._guardInstalled = true;
            } catch (e) { }
        },
        init: function () {
            try {
                this.installGuard();
                if (this.isPaused()) {
                    this.apply(true);
                    setTimeout(function () {
                        try {
                            logs.addLog('[运行] 已处于暂停状态：不会自动翻到下一章，也不会自动作答或提交', 'orange');
                        } catch (e) { }
                    }, 500);
                }
            } catch (e) { }
        }
    };
    try {
        pauseCtl.init();
    } catch (e) {
        console.log(e);
    }
    //==================== v1.5 暂停控制模块结束 ====================

    try {
        extras.init();
    } catch (e) {
        console.log(e);
    }
    try {
        workAuto.init();
    } catch (e) {
        console.log(e);
    }
    _w.confirm = (msg) => {
        return true;
    }
    setInterval(function () {
        _w.confirm = (msg) => {
            return true;
        }
    }, 2000);
    if (parseFloat(rate) == parseInt(rate)) {
        rate = parseInt(rate);
    } else {
        rate = parseFloat(rate);
    }
    try {
        _w.top.unrivalReviewMode = GM_getValue('unrivalreview', '0') || '0';
        _w.top.unrivalDoWork = GM_getValue('unrivaldowork', '1') || '1';
        _w.top.unrivalAutoSubmit = GM_getValue('unrivalautosubmit', '1') || '1';
        _w.top.unrivalAutoSave = GM_getValue('unrivalautosave', '0') || '0';
    } catch (e) { }
    if (_l.href.indexOf("knowledge/cards") > 0) {
        let allowBackground = false,
            spans = _d.getElementsByTagName('span');
        for (let i = 0, l = spans.length; i < l; i++) {
            if (spans[i].innerHTML.indexOf('章节未开放') != -1) {
                if (_l.href.indexOf("ut=s") != -1) {
                    _l.href = _l.href.replace("ut=s", "ut=t").replace(/&cpi=[0-9]{1,10}/, '');
                } else if (_l.href.indexOf("ut=t") != -1) {
                    spans[i].innerHTML = '此课程为闯关模式，请回到上一章节完成学习任务！'
                    //v1.11：全程托管模式下不退出脚本 —— 记录后继续往下走，
                    //      让脚本有机会把这一节做完并继续推进（默认行为仍是直接退出）
                    if (typeof autoRun != 'undefined' && autoRun.enabled()) {
                        try {
                            if (typeof logs != 'undefined' && logs && logs.addLog) {
                                logs.addLog('[托管] 超星提示本章未开放（闯关模式，上一节可能有未完成的任务点），脚本继续尝试推进', 'orange');
                            }
                        } catch (e0) { }
                    } else {
                        return;
                    }
                }
                break;
            }
        }
        _w.top.unrivalPageRd = String(Math.random());
        if (!isFf) {
            try {
                cVersion = parseInt(navigator.userAgent.match(/Chrome\/[0-9]{2,3}./)[0].replace('Chrome/', '')
                    .replace('.', ''));
            } catch (e) { }
        }
        var busyThread = 0,
            getStr = (str, start, end) => {
                let res = str.substring(str.indexOf(start), str.indexOf(end)).replace(start, '');
                return res;
            },
            scripts = _d.getElementsByTagName('script'),
            param = null;
        for (let i = 0, l = scripts.length; i < l; i++) {
            if (scripts[i].innerHTML.indexOf('mArg = "";') != -1 && scripts[i].innerHTML.indexOf(
                '==UserScript==') == -1) {
                param = getStr(scripts[i].innerHTML, 'try{\n    mArg = ', ';\n}catch(e){');
            }
        }
        if (param == null) {
            return;
        }
        try {
            vrefer = _d.getElementsByClassName('ans-attach-online ans-insertvideo-online')[0].src;
        } catch (e) {
            vrefer = _p + '//' + _h + '/ananas/modules/video/index.html?v=2022-1118-1729';
        }
        GM_setValue('vrefer', vrefer);
        GM_setValue('host', _h);
        _d.getElementsByTagName("html")[0].innerHTML = `
<!DOCTYPE html>
<html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>超星学习通小助手（AI 版）</title>
        <style id="unrivalPanelStyle">
            .unrival-arrow { float:right; cursor:pointer; color:#555; font-weight:bold; font-size:12px; line-height:1.7; padding:0 9px; margin-left:10px; background:#e4ebf1; border-radius:4px; }
            .unrival-arrow:hover { background:#c9dcf0; color:#12456f; }
            .unrival-clickable { cursor:pointer; -webkit-user-select:none; user-select:none; }
            .unrival-clickable:hover { background:#f1f6fb; }
            .unrival-collapsed > .panel-body { display:none; }
            #result { max-height:260px; overflow-y:auto; }
            #joblist { max-height:220px; overflow-y:auto; }
            /* v1.10.0：小块左右并排的紧凑栅格 */
            .unrival-grid { display:flex; flex-wrap:wrap; margin:0 -6px; }
            .unrival-grid > .panel { flex:1 1 0; min-width:280px; margin:0 6px 12px; }
            .unrival-row { display:flex; flex-wrap:wrap; align-items:center; margin-bottom:8px; }
            .unrival-row > .unrival-label { flex:0 0 92px; font-size:18px; }
            .unrival-row > .unrival-ctl { flex:1 1 auto; }
            .unrival-field { margin-bottom:8px; }
            .unrival-field > span { display:block; font-size:12px; color:#888; margin-bottom:3px; }
            .unrival-field input, .unrival-field select { width:100%; box-sizing:border-box; }
            /* v1.11.2：左右两栏 —— 左边配置区，右边运行控制 */
            .unrival-mainrow { display:flex; flex-wrap:wrap; align-items:flex-start; margin:0 -8px; }
            .unrival-maincol { flex:1 1 620px; min-width:0; margin:0 8px; }
            .unrival-sidecol { flex:0 0 250px; margin:0 8px; position:sticky; top:12px; }
            @media (max-width: 991px) {
                /* 窄屏：运行控制顶到最上面，主操作不用往下滚 */
                .unrival-sidecol { order:-1; flex:1 1 100%; position:static; margin-bottom:12px; }
            }
        </style>
        <meta content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0" name="viewport">
        <link href="https://z.chaoxing.com/yanshi/css/bootstrap.min.css" rel="stylesheet">
    </head>
    <body>
        <div class="row" style="margin: 10px;">
            <div class="col-md-10 col-md-offset-1">
                <div class="header clearfix">
                    <h3 id="unrivalTitle" class="text-muted" style="margin-top: 20px;margin-bottom: 0;float: left;">超星学习通小助手 <span id="unrivalVer">v?</span>（AI 版）&ensp;<span style="font-size:12px;font-weight:normal;">qianbkk</span></h3><div id="onlineNum"></div>
                </div>
                <hr style="margin-top: 10px;margin-bottom: 20px;">
                <div class="unrival-mainrow">
                    <div class="unrival-maincol">
                        <div class="panel panel-info" id="normalQuery">
                            <div class="panel-heading">任务配置</div>
                            <div class="panel-body">
                                <div class="unrival-row">
                                    <div class="unrival-label">视频倍速：</div>
                                    <div class="unrival-ctl">
                                        <input type="number" id="unrivalRate" style="width: 80px;">
                                        &ensp;
                                        <a id='updateRateButton' class="btn btn-default">保存</a>
                                        &nbsp;|&nbsp;
                                        <a id='reviewModeButton' class="btn btn-default">复习模式</a>
                                        &nbsp;|&nbsp;
                                        <a id='videoTimeButton' class="btn btn-default">查看学习进度</a>
                                        &nbsp;|&nbsp;
                                        <a id='fuckMeModeButton' class="btn btn-default" href="https://scriptcat.org/script-show-page/379" target="view_window">后台挂机</a>
                                        &nbsp;
                                        <a id='backGround' class="btn btn-default" target="view_window">激活挂机</a>
                                    </div>
                                </div>
                                <div class="unrival-row">
                                    <div class="unrival-label">章节测试：</div>
                                    <div class="unrival-ctl">
                                        <a id='autoDoWorkButton' class="btn btn-default">自动答题</a>&nbsp;|&nbsp;
                                        <a id='autoSubmitButton' class="btn btn-default">自动提交</a>&nbsp;|&nbsp;
                                        <a id='autoSaveButton' class="btn btn-default">自动保存</a>
                                    </div>
                                </div>
                                <div class="unrival-row">
                                    <div class="unrival-label">托管模式：</div>
                                    <div class="unrival-ctl">
                                        <label><input type="checkbox" id="unrivalAutoRun"> 全程托管：遇到直播/阅读等做不了的任务自动跳过，一路推进到最后一节</label>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="unrival-grid">
                            <div class="panel panel-info" id="ctPanel">
                                <div class="panel-heading">答题设置 · 题库（不用 AI 也能答）</div>
                                <div class="panel-body">
                                    <div style="font-size:12px;color:#888;margin-bottom:8px;">
                                        三个免费源同时查（icodef、百度不挂科、icodef 备用源）；按选项文字打分匹配，单选只取最像的那一个；查不到才转 AI。
                                    </div>
                                    <div class="unrival-field">
                                        <span>题库 Token（选填：实测不填也能查题，填了能提高并发）</span>
                                        <input type="password" id="unrivalCtToken" placeholder="选填">
                                    </div>
                                    <div class="unrival-field">
                                        <span>正确率门槛（%，自动提交门槛）</span>
                                        <input type="number" id="unrivalAccuracy" min="0" max="100">
                                    </div>
                                    <div class="unrival-field">
                                        <span>翻章模式</span>
                                        <select id="unrivalJumpType">
                                            <option value="1">遍历</option>
                                            <option value="2">不跳转</option>
                                        </select>
                                    </div>
                                    <div>
                                        <a id='saveCtButton' class="btn btn-default">保存题库设置</a>
                                        &nbsp;|&nbsp;<span id="ctStatusText" style="font-size:13px;color:#666;">已保存</span>
                                    </div>
                                </div>
                            </div>
                            <div class="panel panel-info" id="aiPanel">
                                <div class="panel-heading">答题设置 · AI 接口（可选）</div>
                                <div class="panel-body">
                                    <div class="unrival-field">
                                        <span>Base URL（接口根地址，不带 /chat/completions）</span>
                                        <input type="text" id="unrivalAiBaseUrl" placeholder="https://api.deepseek.com/v1">
                                    </div>
                                    <div class="unrival-field">
                                        <span>模型</span>
                                        <input type="text" id="unrivalAiModel" placeholder="deepseek-chat">
                                    </div>
                                    <div class="unrival-field">
                                        <span>API Key</span>
                                        <input type="password" id="unrivalAiKey" placeholder="sk-...">
                                    </div>
                                    <div>
                                        <a id='saveAiButton' class="btn btn-default">保存AI设置</a>
                                        &nbsp;|&nbsp;<a id='testAiButton' class="btn btn-default">测试连通性</a>
                                        &nbsp;|&nbsp;<span id="aiStatusText" style="font-size:13px;color:#666;">未配置</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="panel panel-info" id="workAutoPanel">
                            <div class="panel-heading">章节测验 / 作业自动作答</div>
                            <div class="panel-body">
                                <div class="unrival-grid" style="margin:0;">
                                    <label style="flex:1 1 0;min-width:230px;">
                                        <input type="checkbox" id="unrivalWorkAuto"> 章节测验/作业自动作答
                                    </label>
                                    <label style="flex:1 1 0;min-width:230px;">
                                        <input type="checkbox" id="unrivalWorkSubmit"> 全部题目有依据时自动提交
                                    </label>
                                </div>
                                <div style="margin-top:8px;">
                                    <a id='saveWorkAutoButton' class="btn btn-default">保存自动作答设置</a>
                                    &nbsp;|&nbsp;<span id="workAutoStatusText" style="font-size:13px;color:#666;">已开启</span>
                                </div>
                            </div>
                        </div>
                        <div class="panel panel-info" id="logPanel">
                            <div class="panel-heading">运行日志</div>
                            <div class="panel-body">
                                <div style="text-align:right;margin-bottom:6px;">
                                    <a id='clearLogButton' class='btn btn-default btn-xs'>清空运行日志</a>
                                </div>
                                <div id="result" style="overflow:auto;line-height: 30px;">
                                    <div id="log">
                                        <span style="color: red">[00:00:00] [系统] 如果这条提示还在，说明页面出错了，请联系作者</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="panel panel-info" id="jobPanel">
                            <div class="panel-heading">任务列表</div>
                            <div class="panel-body" id='joblist'>
                            </div>
                        </div>
                        <div class="panel panel-info" id="extrasPanel">
                            <div class="panel-heading">附加功能（实验性 · 未验证）</div>
                            <div class="panel-body">
                                <div class="unrival-grid" style="margin:0;">
                                    <label style="flex:1 1 0;min-width:230px;">
                                        <input type="checkbox" id="unrivalExPaste"> 强制启用复制粘贴
                                    </label>
                                    <label style="flex:1 1 0;min-width:230px;">
                                        <input type="checkbox" id="unrivalExExam"> 考试/作业端自动作答（只作答，不自动交卷）
                                    </label>
                                </div>
                                <div style="margin-top:6px;">
                                    <label><input type="checkbox" id="unrivalReadAssist"> 阅读助手（自动逐段滚到底，把整篇读完）</label>
                                    &ensp;<span style="font-size:13px;color:#666;">每段停留 <input type="number" id="unrivalReadSpeed" min="0.3" max="10" step="0.1" style="width:64px;"> 秒（默认 10）</span>
                                </div>
                                <div style="margin-top:4px;font-size:12px;color:#999;">
                                    往下滚会加载出后续内容，助手会一直读到加载不出来为止；全程只滚动，不发任何完成上报请求。
                                </div>
                                <div style="margin-top:8px;">
                                    <a id='saveExButton' class="btn btn-default">保存附加功能设置</a>
                                    &nbsp;|&nbsp;<span id="exStatusText" style="font-size:13px;color:#666;">全部关闭</span>
                                </div>
                            </div>
                        </div>
                        <div class="panel panel-warning" id="debugPanel">
                            <div class="panel-heading">调试模式</div>
                            <div class="panel-body">
                                <div style="font-size:12px;color:#999;margin-bottom:8px;">
                                    仅开发时使用：需先在本机运行 log-sink（端口 8124）。开启后面板日志实时落盘，并可用 POST /__cmd 远程操控脚本。
                                </div>
                                <div style="font-size:14px;">
                                    <label><input type="checkbox" id="unrivalDbgEnabled"> 调试模式（发送日志到本机）</label>
                                </div>
                                <div style="font-size:14px;margin-top:6px;">
                                    接收端地址：<input type="text" id="unrivalDbgSink" style="width:300px;">
                                </div>
                                <div style="margin-top:8px;">
                                    <a id='saveDbgButton' class="btn btn-default">保存调试设置</a>
                                    &nbsp;|&nbsp;<span id="dbgStatusText" style="font-size:13px;color:#666;">已关闭</span>
                                </div>
                            </div>
                        </div>
                        <div class="panel panel-info" id='videoTime' style="display: none;height: 300px;">
                            <div class="panel-heading">学习进度</div>
                            <div class="panel-body" style="height: 100%;">
                                <iframe id="videoTimeContent" src="" frameborder="0" scrolling="auto"
                                    style="width: 100%;height: 85%;"></iframe>
                            </div>
                        </div>
                    </div>
                    <div class="unrival-sidecol">
                        <div class="panel panel-primary" id="runCtlPanel">
                            <div class="panel-heading">运行控制</div>
                            <div class="panel-body">
                                <a id='pauseStartButton' class="btn btn-success btn-lg btn-block" aria-disabled="true">开始/继续</a>
                                <a id='pauseToggleButton' class="btn btn-danger btn-sm btn-block" style="margin-top:8px;">暂停</a>
                                <div style="margin-top:12px;text-align:center;font-size:13px;color:#666;">
                                    当前状态：<span id="pauseStatusText">运行中</span>
                                </div>
                                <div style="margin-top:10px;font-size:12px;color:#999;line-height:1.8;">
                                    「开始/继续」恢复自动翻章与自动作答；「暂停」立即挂起所有自动操作。
                                </div>
                            </div>
                        </div>
                    </div>
                </div>                <div class="panel panel-info" id='workPanel' style="display: none;height: 520px;">
                    <div class="panel-heading">章节测试</div>
                    <div class="panel-body" id='workWindow' style="height: 100%;">
                        <iframe id="frame_content" name="frame_content" src="" frameborder="0" scrolling="auto"
                            style="width: 100%;height: 95%;"></iframe>
                    </div>
                </div>
            </div>
        </div>
    </body>
</html>
`;
        //v1.10.0：运行控制两个按钮的状态统一在这里维护
        //  · 运行中：「开始/继续」置灰（脚本本身就在跑），「暂停」可点；
        //  · 已暂停：「开始/继续」可点，「暂停」置灰。
        var _syncPauseUI = function () {
            try {
                var paused = pauseCtl.isPaused();
                var btnStart = _d.getElementById('pauseStartButton');
                var btnPause = _d.getElementById('pauseToggleButton');
                var txt = _d.getElementById('pauseStatusText');
                if (btnStart) {
                    //v1.11.2：主按钮大号（btn-lg btn-block），次按钮小号（btn-sm btn-block）
                    btnStart.setAttribute('class', paused ? 'btn btn-success btn-lg btn-block' : 'btn btn-success btn-lg btn-block disabled');
                    btnStart.setAttribute('aria-disabled', paused ? 'false' : 'true');
                }
                if (btnPause) {
                    btnPause.setAttribute('class', paused ? 'btn btn-danger btn-sm btn-block disabled' : 'btn btn-danger btn-sm btn-block');
                    btnPause.setAttribute('aria-disabled', paused ? 'true' : 'false');
                }
                if (txt) txt.innerHTML = paused ? '已暂停' : '运行中';
            } catch (e) { }
        };
        var logs = {
            "logArry": [],
            "addLog": function (str, color = "black") {
                if (this.logArry.length >= 50) {
                    this.logArry.splice(0, 1);
                }
                var nowTime = new Date();
                var nowHour = (Array(2).join(0) + nowTime.getHours()).slice(-2);
                var nowMin = (Array(2).join(0) + nowTime.getMinutes()).slice(-2);
                var nowSec = (Array(2).join(0) + nowTime.getSeconds()).slice(-2);
                this.logArry.push("<span style='color: " + color + "'>[" + nowHour + ":" + nowMin + ":" +
                    nowSec + "] " + str + "</span>");
                let logStr = "";
                for (let logI = 0, logLen = this.logArry.length; logI < logLen; logI++) {
                    logStr += this.logArry[logI] + "<br>";
                }
                _d.getElementById('log').innerHTML = logStr;
                var logElement = _d.getElementById('log');
                logElement.scrollTop = logElement.scrollHeight;
            }
        },
            htmlHook = setInterval(function () {
                if (_d.getElementById('unrivalRate') && _d.getElementById('updateRateButton') && _d
                    .getElementById('reviewModeButton') && _d.getElementById('autoDoWorkButton') && _d
                        .getElementById('autoSubmitButton') && _d.getElementById('autoSaveButton') && _d.getElementById('saveCtButton') && _d.getElementById('saveAiButton') && _d.getElementById('pauseStartButton') && _d.getElementById('unrivalAutoRun') && _d.getElementById('unrivalReadAssist') && _d.getElementById('testAiButton')) {
                    if (!backGround) {
                        _d.getElementById('fuckMeModeButton').style.display = "none";
                    }
                    allowBackground = Math.round(new Date() / 1000) - parseInt(GM_getValue(
                        'unrivalBackgroundVideoEnable',
                        '6')) < 15;
                    if (allowBackground) {
                        _d.getElementById('fuckMeModeButton').setAttribute('href', 'unrivalxxtbackground/');
                    }
                    clearInterval(htmlHook);
                    if (cVersion < 86) {
                        logs.addLog(
                            '[系统] 您的浏览器内核过老，请更新版本或使用主流浏览器（推荐 Edge / Chrome）',
                            'red');
                        stop = true;
                        return;
                    }
                    if (isMobile) {
                        logs.addLog('[系统] 手机浏览器不保证能正常运行此脚本', 'orange');
                    }
                    _d.addEventListener('visibilitychange', function () {
                        let isH = _d.hidden;
                        if (!isH) {
                            logs.addLog('[系统] 挂机功能不稳定，不建议长时间最小化窗口', 'orange');
                        }
                    });
                    _d.getElementById('unrivalRate').value = rate;
                    _d.getElementById('unrivalAiBaseUrl').value = aiState.baseUrl;
                    _d.getElementById('unrivalAiModel').value = aiState.model;
                    _d.getElementById('unrivalAiKey').value = aiState.key;
                    _d.getElementById('unrivalCtToken').value = token || '';
                    _d.getElementById('unrivalAccuracy').value = accuracy;
                    _d.getElementById('unrivalJumpType').value = jumpMode.get();
                    _d.getElementById('unrivalExPaste').checked = extras.cfg.paste;
                    _d.getElementById('unrivalExExam').checked = extras.cfg.exam;
                    //v1.11.1：阅读助手开关与每段停留秒数
                    _d.getElementById('unrivalReadAssist').checked = readAssist.enabled();
                    _d.getElementById('unrivalReadSpeed').value = readAssist.speed();
                    //v1.6：「阅读/图书任务页保活」选项已移除（实测对超星任务状态无效），这里做空值保护
                    var _exKeepEl = _d.getElementById('unrivalExKeep');
                    if (_exKeepEl) _exKeepEl.checked = extras.cfg.keep;
                    var _exKeysEl = _d.getElementById('unrivalExKeepKeys');
                    if (_exKeysEl) _exKeysEl.value = extras.cfg.keepKeys;
                    var _exSecEl = _d.getElementById('unrivalExScrollSec');
                    if (_exSecEl) _exSecEl.value = extras.cfg.scrollSec;
                    _d.getElementById('unrivalWorkAuto').checked = workAuto.cfg.enable;
                    _d.getElementById('unrivalWorkSubmit').checked = workAuto.cfg.submit;
                    //v1.10.0：两个按钮的状态统一由 _syncPauseUI 维护
                    _syncPauseUI();
                    _d.getElementById('ctStatusText').innerHTML = '门槛 ' + accuracy + '%' + (token ? '，题库并发已提升' : '，未填题库 Token');
                    //v1.11：全程托管开关（默认关闭）
                    _d.getElementById('unrivalAutoRun').checked = autoRun.enabled();
                    _d.getElementById('unrivalAutoRun').onchange = function () {
                        var _on = !!this.checked;
                        autoRun.setEnabled(_on);
                        logs.addLog(_on ? '[设置] 全程托管已开启：做不了的任务（直播/阅读等）会跳过，脚本一路推进到最后一节' : '[设置] 全程托管已关闭：遇到做不了的任务会停下等你处理', _on ? 'green' : 'orange');
                    };
                    _d.getElementById('unrivalDbgEnabled').checked = dbg.cfg.enabled;
                    _d.getElementById('unrivalDbgSink').value = dbg.cfg.sink;
                    aiReload();
                    //v1.10.0：题库设置与 AI 设置分成两个模块，各自一个保存按钮
                    //  题库块（不用 AI 也能答）：题库 Token / 正确率门槛 / 翻章模式
                    _d.getElementById('saveCtButton').onclick = function () {
                        token = _d.getElementById('unrivalCtToken').value.trim();
                        GM_setValue('tikutoken', token);
                        var newAccuracy = parseInt(_d.getElementById('unrivalAccuracy').value, 10);
                        if (isNaN(newAccuracy) || newAccuracy < 0) newAccuracy = 80;
                        if (newAccuracy > 100) newAccuracy = 100;
                        accuracy = newAccuracy;
                        GM_setValue('unrivalaccuracy', accuracy);
                        //v1.8：只写真实设置键；暂停中不改动运行时翻章模式（否则会把暂停"解掉"）
                        var _jtReal = jumpMode.set(_d.getElementById('unrivalJumpType').value);
                        jumpType = (pauseCtl.isPaused()) ? 2 : (_jtReal === '2' ? 2 : 1);
                        var _ctTxt = '门槛 ' + accuracy + '%' + (token ? '，题库并发已提升' : '，未填题库 Token');
                        _d.getElementById('ctStatusText').innerHTML = _ctTxt;
                        logs.addLog('[设置] 题库设置已保存：' + _ctTxt, 'green');
                    }
                    //  AI 块：Base URL / 模型 / API Key（不填就退回纯题库模式）
                    _d.getElementById('saveAiButton').onclick = function () {
                        GM_setValue('unrivalAiBaseUrl', _d.getElementById('unrivalAiBaseUrl').value.trim());
                        GM_setValue('unrivalAiModel', _d.getElementById('unrivalAiModel').value.trim());
                        GM_setValue('unrivalAiKey', _d.getElementById('unrivalAiKey').value.trim());
                        aiReload();
                        var aiOkCfg = (aiState.baseUrl && aiState.model && aiState.key);
                        logs.addLog(aiOkCfg ? ('[设置] AI 设置已保存：' + aiState.model + ' @ ' + aiState.baseUrl) : '[设置] AI 设置已保存，但配置不完整（缺 Base URL / 模型 / API Key），将退回纯题库模式', aiOkCfg ? 'green' : 'orange');
                    }
                    _d.getElementById('saveExButton').onclick = function () {
                        extras.cfg.paste = _d.getElementById('unrivalExPaste').checked;
                        extras.cfg.exam = _d.getElementById('unrivalExExam').checked;
                        //v1.11.1：阅读助手一起存（默认关闭）
                        var _readOn = !!_d.getElementById('unrivalReadAssist').checked;
                        GM_setValue('unrivalReadAssist', _readOn ? '1' : '0');
                        var _readSpeed = parseFloat(_d.getElementById('unrivalReadSpeed').value);
                        //v1.11.2：每段停留秒数的默认值从 1 秒改成 10 秒
                        if (isNaN(_readSpeed) || _readSpeed <= 0) _readSpeed = 10;
                        if (_readSpeed < 0.3) _readSpeed = 0.3;
                        if (_readSpeed > 10) _readSpeed = 10;
                        GM_setValue('unrivalReadSpeed', String(_readSpeed));
                        var _exKeepEl2 = _d.getElementById('unrivalExKeep');
                        var _exKeysEl2 = _d.getElementById('unrivalExKeepKeys');
                        var _exSecEl2 = _d.getElementById('unrivalExScrollSec');
                        extras.cfg.keep = _exKeepEl2 ? _exKeepEl2.checked : false;
                        extras.cfg.keepKeys = _exKeysEl2 ? _exKeysEl2.value.trim() : '';
                        var sec = _exSecEl2 ? parseInt(_exSecEl2.value, 10) : 8;
                        if (isNaN(sec) || sec < 3) sec = 8;
                        if (sec > 120) sec = 120;
                        extras.cfg.scrollSec = sec;
                        GM_setValue('unrivalExPaste', extras.cfg.paste ? '1' : '0');
                        GM_setValue('unrivalExExam', extras.cfg.exam ? '1' : '0');
                        GM_setValue('unrivalExKeep', extras.cfg.keep ? '1' : '0');
                        GM_setValue('unrivalExKeepKeys', extras.cfg.keepKeys);
                        GM_setValue('unrivalExScrollSec', String(extras.cfg.scrollSec));
                        var on = [];
                        if (extras.cfg.paste) on.push('复制粘贴');
                        if (extras.cfg.exam) on.push('考试端');
                        if (_readOn) on.push('阅读助手');
                        if (extras.cfg.keep) on.push('任务页保活');
                        _d.getElementById('exStatusText').innerHTML = on.length ? ('已开启：' + on.join('、')) : '全部关闭';
                        logs.addLog('[设置] 附加功能设置已保存（' + (on.length ? on.join('、') : '全部关闭') + '），部分功能尚未在真实页面验证', on.length ? 'orange' : 'green');
                    }
                    //v1.10.0：原「暂停/继续」切换按钮拆成两个 —— 「开始/继续」与「暂停」
                    _d.getElementById('pauseStartButton').onclick = function () {
                        if (!pauseCtl.isPaused()) {
                            logs.addLog('[运行] 已在运行中，无需重复开始', 'gray');
                            return;
                        }
                        pauseCtl.set(false);
                        _syncPauseUI();
                        // 恢复时把「翻章模式」下拉框同步回存储里的真实设置
                        try {
                            _d.getElementById('unrivalJumpType').value = jumpMode.get();
                        } catch (e) { }
                        logs.addLog('[运行] 已继续：恢复自动翻章 / 作答 / 提交', 'green');
                    };
                    _d.getElementById('pauseToggleButton').onclick = function () {
                        if (pauseCtl.isPaused()) {
                            logs.addLog('[运行] 已处于暂停状态，无需重复暂停', 'gray');
                            return;
                        }
                        pauseCtl.set(true);
                        _syncPauseUI();
                        logs.addLog('[运行] 已暂停：不再自动翻章 / 作答 / 提交', 'orange');
                    };
                    _d.getElementById('saveDbgButton').onclick = function () {
                        dbg.cfg.enabled = _d.getElementById('unrivalDbgEnabled').checked;
                        dbg.cfg.sink = _d.getElementById('unrivalDbgSink').value.trim() || 'http://127.0.0.1:8124';
                        GM_setValue('unrivalDbgEnabled', dbg.cfg.enabled ? '1' : '0');
                        GM_setValue('unrivalDbgSink', dbg.cfg.sink);
                        _d.getElementById('dbgStatusText').innerHTML = dbg.cfg.enabled
                            ? ('已开启 → ' + dbg.cfg.sink)
                            : '已关闭';
                        dbg.attach();
                        dbg.log('info', '调试设置已保存：enabled=' + dbg.cfg.enabled + ' sink=' + dbg.cfg.sink);
                        logs.addLog('[设置] 调试设置已保存（' + (dbg.cfg.enabled ? '已开启 → ' + dbg.cfg.sink : '已关闭') + '）', 'green');
                    }
                    _d.getElementById('saveWorkAutoButton').onclick = function () {
                        workAuto.cfg.enable = _d.getElementById('unrivalWorkAuto').checked;
                        workAuto.cfg.submit = _d.getElementById('unrivalWorkSubmit').checked;
                        GM_setValue('unrivalWorkAuto', workAuto.cfg.enable ? '1' : '0');
                        GM_setValue('unrivalWorkSubmit', workAuto.cfg.submit ? '1' : '0');
                        var won = [];
                        if (workAuto.cfg.enable) won.push('自动作答');
                        if (workAuto.cfg.submit) won.push('自动提交');
                        _d.getElementById('workAutoStatusText').innerHTML = won.length ? ('已开启：' + won.join('、')) : '已关闭';
                        logs.addLog('[设置] 自动作答设置已保存（' + (won.length ? won.join('、') : '已关闭') + '）', 'green');
                    }
                    _d.getElementById('testAiButton').onclick = function () {
                        aiReload();
                        if (!aiState.baseUrl || !aiState.model || !aiState.key) {
                            logs.addLog('[AI] 配置不完整，请先填写 Base URL / 模型 / API Key', 'red');
                            return;
                        }
                        logs.addLog('[AI] 正在测试连通性…', 'black');
                        aiTest(function (aiTestOk, aiTestMsg) {
                            logs.addLog(aiTestOk ? ('[AI] 连通性正常（' + aiTestMsg + '）') : ('[AI] 连通性测试失败：' + aiTestMsg), aiTestOk ? 'green' : 'red');
                        });
                    }
                    _d.getElementById('updateRateButton').onclick = function () {
                        let urate = _d.getElementById('unrivalRate').value;
                        if (parseFloat(urate) == parseInt(urate)) {
                            urate = parseInt(urate);
                        } else {
                            urate = parseFloat(urate);
                        }
                        GM_setValue('unrivalrate', urate);
                        rate = urate;
                        if (urate > 0) {
                            logs.addLog('[设置] 视频倍速已更新为 ' + urate + ' 倍，将在 3 秒内生效', 'green');
                        } else {
                            logs.addLog('[视频] 倍速数值异常（不在允许区间），该视频将自动跳过', 'orange');
                        }
                    }
                    _d.getElementById('backGround').onclick = function () {
                        logs.addLog('[系统] 挂机激活成功，现在可以最小化页面了', 'green');
                        _w.top.backNow = 1;
                    }
                    _d.getElementById('reviewModeButton').onclick = function () {
                        let reviewButton = _d.getElementById('reviewModeButton');
                        if (reviewButton.getAttribute('class') == 'btn btn-default') {
                            _d.getElementById('reviewModeButton').setAttribute('class', 'btn btn-success');
                            logs.addLog('[设置] 复习模式已开启：遇到已完成的视频任务不会跳过', 'green');
                            GM_setValue('unrivalreview', '1');
                            _w.top.unrivalReviewMode = '1';
                        } else {
                            _d.getElementById('reviewModeButton').setAttribute('class', 'btn btn-default');
                            logs.addLog('[设置] 复习模式已关闭：遇到已完成的视频任务会自动跳过', 'green');
                            GM_setValue('unrivalreview', '0');
                            _w.top.unrivalReviewMode = '0';
                        }
                    }
                    _d.getElementById('autoDoWorkButton').onclick = function () {
                        let autoDoWorkButton = _d.getElementById('autoDoWorkButton');
                        if (autoDoWorkButton.getAttribute('class') == 'btn btn-default') {
                            _d.getElementById('autoDoWorkButton').setAttribute('class', 'btn btn-success');
                            logs.addLog('[设置] 章节测试自动作答已开启', 'green');
                            GM_setValue('unrivaldowork', '1');
                            _w.top.unrivalDoWork = '1';
                        } else {
                            _d.getElementById('autoDoWorkButton').setAttribute('class', 'btn btn-default');
                            logs.addLog('[设置] 章节测试自动作答已关闭', 'green');
                            GM_setValue('unrivaldowork', '0');
                            _w.top.unrivalDoWork = '0';
                        }
                    }
                    _d.getElementById('autoSubmitButton').onclick = function () {
                        let autoSubmitButton = _d.getElementById('autoSubmitButton');
                        if (autoSubmitButton.getAttribute('class') == 'btn btn-default') {
                            _d.getElementById('autoSubmitButton').setAttribute('class', 'btn btn-success');
                            logs.addLog('[设置] 符合提交标准的章节测试将自动提交', 'green');
                            GM_setValue('unrivalautosubmit', '1');
                            _w.top.unrivalAutoSubmit = '1';
                        } else {
                            _d.getElementById('autoSubmitButton').setAttribute('class', 'btn btn-default');
                            logs.addLog('[设置] 章节测试不自动提交', 'green');
                            GM_setValue('unrivalautosubmit', '0');
                            _w.top.unrivalAutoSubmit = '0';
                        }
                    }
                    _d.getElementById('autoSaveButton').onclick = function () {
                        let autoSaveButton = _d.getElementById('autoSaveButton');
                        if (autoSaveButton.getAttribute('class') == 'btn btn-default') {
                            _d.getElementById('autoSaveButton').setAttribute('class', 'btn btn-success');
                            logs.addLog('[设置] 不符合提交标准的章节测试将自动保存', 'green');
                            GM_setValue('unrivalautosave', '1');
                            _w.top.unrivalAutoSave = '1';
                        } else {
                            _d.getElementById('autoSaveButton').setAttribute('class', 'btn btn-default');
                            logs.addLog('[设置] 不符合提交标准的章节测试不自动保存，请自行操作', 'green');
                            GM_setValue('unrivalautosave', '0');
                            _w.top.unrivalAutoSave = '0'; //v1.1修复：原为'1'，导致关闭自动保存后依然生效
                        }
                    }
                    _d.getElementById('videoTimeButton').onclick = function () {
                        _d.getElementById('videoTime').style.display = 'block';
                        _d.getElementById('videoTimeContent').src = _p +
                            '//stat2-ans.chaoxing.com/task/s/index?courseid=' + courseId + '&clazzid=' +
                            classId;
                    }
                }
            }, 100),
            loopjob = () => {
                if (_w.top.unrivalScriptList.length > 1) {
                    logs.addLog('[系统] 检测到同时开启了多个刷课脚本，可能导致进度异常（挂科）', 'red');
                }
                if (cVersion < 8.6 * 10) {
                    logs.addLog(
                        '[系统] 您的浏览器内核过老，请更新版本或使用主流浏览器（推荐 Edge / Chrome）',
                        'red');
                    stop = true;
                    return;
                }
                if (stop) {
                    return;
                }
                let missionli = missionList;
                if (missionli == []) {
                    setTimeout(loopjob, 500);
                    return;
                }
                for (let itemName in missionli) {
                    if (missionli[itemName]['running']) {
                        setTimeout(loopjob, 500);
                        return;
                    }
                }
                for (let itemName in missionli) {
                    if (!missionli[itemName]['done']) {
                        switch (missionli[itemName]['type']) {
                            case 'video':
                                doVideo(missionli[itemName]);
                                break;
                            case 'document':
                                doDocument(missionli[itemName]);
                                break;
                            case 'work':
                                doWork(missionli[itemName]);
                                break;
                        }
                        setTimeout(loopjob, 500);
                        return;
                    }
                }
                if (busyThread <= 0) {
                    if (jumpType != 2) {
                        _w.top.jump = true;
                        logs.addLog('[翻章] 所有任务处理完毕，5 秒后自动跳到下一章', 'green');
                    } else if (pauseCtl.isPaused()) {
                        logs.addLog('[翻章] 所有任务处理完毕，已暂停：不跳转下一章，点右侧「开始/继续」恢复', 'orange');
                    } else {
                        logs.addLog('[翻章] 所有任务处理完毕，翻章模式设为「不跳转」，脚本已结束运行；如需自动跳转请在面板改回「遍历」', 'green');
                    }
                    clearInterval(loopjob);
                } else {
                    setTimeout(loopjob, 500);
                }
            },
            readyCheck = () => {
                setTimeout(function () {
                    try {
                        if (!isCat) {
                            logs.addLog(
                                '[系统] 推荐使用 <a href="https://docs.scriptcat.org/use/#%E5%AE%89%E8%A3%85%E6%89%A9%E5%B1%95" target="view_window">脚本猫</a> 运行此脚本，其他脚本管理器不保证能正常运行',
                                'orange');
                        }
                        if (_w.top.unrivalReviewMode == '1') {
                            //v1.11.2：原来这里还会再打一遍「复习模式已开启」，与按钮点击处重复 → 去掉
                            _d.getElementById('reviewModeButton').setAttribute('class', ['btn btn-default',
                                'btn btn-success'
                            ][_w.top.unrivalReviewMode]);
                        }
                        if (_w.top.unrivalDoWork == '1') {
                            //v1.11.2：原来这里还会再打一遍「自动做章节测试已开启」，与按钮点击处重复 → 去掉
                            _d.getElementById('autoDoWorkButton').setAttribute('class', ['btn btn-default',
                                'btn btn-success'
                            ][_w.top.unrivalDoWork]);
                        }
                        _d.getElementById('autoSubmitButton').setAttribute('class', ['btn btn-default',
                            'btn btn-success'
                        ][_w.top.unrivalAutoSubmit]);
                        _d.getElementById('autoSaveButton').setAttribute('class', ['btn btn-default',
                            'btn btn-success'
                        ][_w.top.unrivalAutoSave]);
                    } catch (e) {
                        console.log(e);
                        readyCheck();
                        return;
                    }
                }, 500);
            }
        readyCheck();
        try {
            var pageData = JSON.parse(param);
        } catch (e) {
            if (jumpType != 2) {
                _w.top.jump = true;
                logs.addLog('[翻章] 本页没有任务（页面数据没解析出来），5 秒后自动跳到下一章', 'green');
            } else if (pauseCtl.isPaused()) {
                logs.addLog('[翻章] 本页没有任务（页面数据没解析出来），已暂停：不跳转下一章，点右侧「开始/继续」恢复', 'orange');
            } else {
                logs.addLog('[翻章] 本页没有任务（页面数据没解析出来），翻章模式设为「不跳转」，脚本已结束运行；如需自动跳转请在面板改回「遍历」', 'green');
            }
            return;
        }
        var data = pageData['defaults'],
            jobList = [],
            classId = data['clazzId'],
            chapterId = data['knowledgeid'],
            reportUrl = data['reportUrl'],
            ktoken = data['ktoken'];
        UID = UID || data['userid'];
        FID = FID || data['fid'];
        for (let i = 0, l = pageData['attachments'].length; i < l; i++) {
            let item = pageData['attachments'][i];
            if (item['job'] != true || item['isPassed'] == true) {
                if (_w.top.unrivalReviewMode == '1' && item['type'] == 'video') {
                    jobList.push(item);
                }
                continue;
            } else {
                jobList.push(item);
            }
        }
        var video_getReady = (item) => {
            let statusUrl = _p + '//' + _h + '/ananas/status/' + item['property']['objectid'] + '?k=' +
                FID + '&flag=normal&_dc=' + String(Math.round(new Date())),
                doubleSpeed = item['property']['doublespeed'];
            busyThread += 1;
            GM_xmlhttpRequest({
                method: "get",
                headers: {
                    'Host': _h,
                    'Referer': vrefer,
                    'Sec-Fetch-Site': 'same-origin'
                },
                url: statusUrl,
                onload: function (res) {
                    try {
                        busyThread -= 1;
                        let videoInfo = JSON.parse(res.responseText),
                            duration = videoInfo['duration'],
                            dtoken = videoInfo['dtoken'];
                        if (duration == undefined) {
                            _d.getElementById('joblist').innerHTML += `
                            <div class="panel panel-default">
                                <div class="panel-body">
                                    ` + '[无效视频]' + item['property']['name'] + `
                                </div>
                            </div>`
                            return;
                        }
                        missionList['m' + item['jobid']] = {
                            'module': item['property']['module'],
                            'type': 'video',
                            'dtoken': dtoken,
                            'duration': duration,
                            'objectId': item['property']['objectid'],
                            'rt': item['property']['rt'] || '0.9',
                            'otherInfo': item['otherInfo'],
                            'doublespeed': doubleSpeed,
                            'jobid': item['jobid'],
                            'name': item['property']['name'],
                            'done': false,
                            'running': false
                        };
                        var base222 = `data:image/png;base64,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`
                        _d.getElementById('joblist').innerHTML += `
                            
                            <div class="panel panel-default">
                                <div class="panel-body">
                                    ` + '<img src="' + base222 + '" alt="Smiley face" width="120" height="120">' + `
                                </div>
                                <div class="panel-body">
                                    ` + '[视频]' + item['property']['name'] + `
                                </div>
                            </div>`
                    } catch (e) { }
                },
                onerror: function (err) {
                    console.log(err);
                    if (err.error.indexOf('@connect list') >= 0) {
                        logs.addLog('[系统] 请添加安全网址：把 【 //@connect      ' + _h + ' 】方括号里的内容（不含方括号）加到脚本代码里指定位置，否则脚本无法正常运行。示例图：<img src="https://pan-yz.chaoxing.com/thumbnail/0,0,0/609a8b79cbd6a91d10c207cf2b5f368d">', 'red');
                        stop = true;
                    } else {
                        logs.addLog('[系统] 获取任务详情失败', 'red');
                        logs.addLog('[系统] 错误原因：' + err.error, 'red');
                    }
                }
            });
        },
            doVideo = (item) => {
                if (rate <= 0) {
                    missionList['m' + item['jobid']]['running'] = true;
                    logs.addLog('[视频] 倍速设置无效，该视频已自动跳过', 'orange');
                    setTimeout(function () {
                        missionList['m' + item['jobid']]['running'] = false;
                        missionList['m' + item['jobid']]['done'] = true;
                    }, 5000);
                    return;
                }
                if (allowBackground && backGround) {
                    if (_w.top.document.getElementsByClassName('catalog_points_sa').length > 0 || _w.top.document
                        .getElementsByClassName('lock').length > 0) {
                        logs.addLog('[系统] 本课程为闯关模式，不支持后台挂机，改为在线运行', 'blue');
                    } else {
                        item['userid'] = UID;
                        item['classId'] = classId;
                        item['review'] = [false, true][_w.top.unrivalReviewMode];
                        item['reportUrl'] = reportUrl;
                        item['rt'] = missionList['m' + item['jobid']]['rt'];
                        GM_setValue('unrivalBackgroundVideo', item);
                        _d.cookie = "videojs_id=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
                        logs.addLog(
                            '[系统] 已添加至后台任务，<a href="unrivalxxtbackground/" target="view_window">点我查看后台</a>',
                            'green');
                        missionList['m' + item['jobid']]['running'] = true;
                        setTimeout(function () {
                            missionList['m' + item['jobid']]['running'] = false;
                            missionList['m' + item['jobid']]['done'] = true;
                        }, 5000);
                        return;
                    }
                }
                let videojs_id = String(parseInt(Math.random() * 9999999));
                _d.cookie = 'videojs_id=' + videojs_id + ';path=/'
                logs.addLog('[视频] 开始刷视频：' + item['name'] + '，倍速：' + String(rate) + '倍');
                logs.addLog('[视频] 观看进度每 60 秒上报一次，请耐心等待', 'green');
                logs.addLog('[系统] 如遇异常，请确认脚本为最新版本：<a href="https://scriptcat.org/script-show-page/949" target="_blank">点此检查</a>', 'orange');
                if (disableMonitor) {
                    logs.addLog('[系统] 解除多端学习监控有清除进度的风险，请谨慎使用', 'orange');
                }
                let dtype = 'Video';
                if (item['module'].includes('audio')) {
                    dtype = 'Audio';
                    rt = '';
                }
                let playTime = 0,
                    playsTime = 0,
                    isdrag = '3',
                    times = 0,

                    first = true,
                    loop = setInterval(function () {
                        if (rate <= 0) {
                            clearInterval(loop);
                            logs.addLog('[视频] 倍速在播放中失效，该视频已自动跳过', 'orange');
                            setTimeout(function () {
                                missionList['m' + item['jobid']]['running'] = false;
                                missionList['m' + item['jobid']]['done'] = true;
                            }, 5000);
                            return;
                        } else if (item['doublespeed'] == 0 && rate > 1 && _w.top.unrivalReviewMode == '0') {
                            rate = 1;
                            logs.addLog('[视频] 该视频不允许倍速播放，已恢复为一倍速；高倍速可能导致进度被清空', 'red');
                        }
                        rt = missionList['m' + item['jobid']]['rt'];
                        playsTime += rate;
                        playTime = Math.ceil(playsTime);
                        if (times == 0 || times % 60 == 0 || playTime >= item['duration']) {
                            if (first) {
                                playTime = 0;
                            }
                            if (playTime >= item['duration']) {
                                clearInterval(loop);
                                playTime = item['duration'];
                                isdrag = '4';
                            } else if (playTime > 0) {
                                isdrag = '0';
                            }

                            busyThread += 1;
                            var _bold_playTime = playTime;
                            function ecOnload(res) {
                                let enc = '';
                                if (res && res.status == 200) {
                                    enc = res.responseText;
                                    if (enc.includes('--#')) {
                                        let warnInfo = enc.match(new RegExp('--#(.*?)--#', "ig"))[0]
                                            .replace(/--#/ig, '');
                                        logs.addLog(logSpec.tag(warnInfo, '视频'), 'red');
                                        enc = enc.replace(/--#(.*?)--#/ig, '');
                                    }
                                    if (enc.indexOf('.stop') >= 0) {
                                        clearInterval(loop);
                                        stop = true;
                                        return;
                                    }
                                } else {
                                    strEc = `[${classId}][${UID}][${item['jobid']}][${item['objectId']}][${playTime * 1000}][d_yHJ!$pdA~5][${item['duration'] * 1000}][0_${item['duration']}]`,
                                        enc = jq.md5(strEc);
                                }
                                if (enc.length != 32) {
                                    clearInterval(loop);
                                    stop = true;
                                    return;
                                }
                                let reportsUrl = reportUrl + '/' + item['dtoken'] +
                                    '?clazzId=' + classId + '&playingTime=' + playTime +
                                    '&duration=' + item['duration'] + '&clipTime=0_' + item[
                                    'duration'] + '&objectId=' + item['objectId'] +
                                    '&otherInfo=' + item['otherInfo'] + '&jobid=' + item[
                                    'jobid'] + '&userid=' + UID + '&isdrag=' + isdrag +
                                    '&view=pc&enc=' + enc + '&rt=' + rt + '&dtype=' + dtype +
                                    '&_t=' + String(Math.round(new Date()));
                                GM_xmlhttpRequest({
                                    method: "get",
                                    headers: {
                                        'Host': _h,
                                        'Referer': vrefer,
                                        'Sec-Fetch-Site': 'same-origin',
                                        'Content-Type': 'application/json'
                                    },
                                    url: reportsUrl,
                                    onload: function (res) {
                                        try {
                                            let today = new Date(),
                                                todayStr = today.getFullYear() +
                                                    'd' + today.getMonth() + 'd' + today
                                                        .getDate(),
                                                timelong = GM_getValue(
                                                    'unrivaltimelong', {});
                                            if (timelong[UID] == undefined ||
                                                timelong[UID]['today'] != todayStr
                                            ) {
                                                timelong[UID] = {
                                                    'time': 0,
                                                    'today': todayStr
                                                };
                                            } else {
                                                timelong[UID]['time']++;
                                            }
                                            GM_setValue('unrivaltimelong',
                                                timelong);
                                            busyThread -= 1;
                                            if (timelong[UID]['time'] / 60 > 22 &&
                                                item['doublespeed'] == 0 && _w.top
                                                    .unrivalReviewMode == '0') {
                                                clearInterval(loop);
                                                logs.addLog(
                                                    '[系统] 今日学习时间过长，继续学习会导致进度被清空，请明天再来',
                                                    'red');
                                                setTimeout(function () {
                                                    missionList['m' + item[
                                                        'jobid']][
                                                        'running'
                                                    ] = false;
                                                    missionList['m' + item[
                                                        'jobid']][
                                                        'done'
                                                    ] = true;
                                                }, 5000);
                                                return;
                                            }
                                            let ispass = JSON.parse(res
                                                .responseText);
                                            first = false;
                                            if (ispass['isPassed'] && _w.top
                                                .unrivalReviewMode == '0') {
                                                logs.addLog('[视频] 视频任务已完成', 'green');
                                                missionList['m' + item['jobid']]['running'] = false;
                                                missionList['m' + item['jobid']]['done'] = true;
                                                clearInterval(loop);
                                                return;
                                            } else if (isdrag == '4') {
                                                if (_w.top.unrivalReviewMode ==
                                                    '1') {
                                                    logs.addLog('[视频] 视频已观看完毕', 'green');
                                                } else {
                                                    logs.addLog('[视频] 视频已观看完毕，但任务点未完成',
                                                        'red');
                                                }
                                                missionList['m' + item['jobid']][
                                                    'running'
                                                ] = false;
                                                missionList['m' + item['jobid']][
                                                    'done'
                                                ] = true;
                                                try {
                                                    clearInterval(loop);
                                                } catch (e) {

                                                }
                                            } else {
                                                logs.addLog('[视频] ' + item['name'] + ' 已观看 ' +
                                                    _bold_playTime + '秒，剩余大约' +
                                                    String(item['duration'] -
                                                        _bold_playTime) + '秒');
                                            }
                                        } catch (e) {
                                            console.log(e);
                                            if (res.responseText.indexOf('验证码') >=
                                                0) {
                                                logs.addLog('[系统] 已被超星风控，请 <a href="' +
                                                    reportsUrl +
                                                    '" target="_blank">点我处理</a>，60秒后自动刷新页面',
                                                    'red');
                                                missionList['m' + item['jobid']][
                                                    'running'
                                                ] = false;
                                                clearInterval(loop);
                                                stop = true;
                                                setTimeout(function () {
                                                    _l.reload();
                                                }, 60000);
                                                return;
                                            }
                                            logs.addLog('[系统] 超星返回错误信息，10 秒后重试', 'red');
                                            times = -10;
                                            return;
                                        }
                                    },
                                    onerror: function (err) {
                                        console.log(err);
                                        if (err.error.indexOf('@connect list') >=
                                            0) {
                                            logs.addLog('[系统] 请添加安全网址：把 【 //@connect      ' + _h + ' 】方括号里的内容（不含方括号）加到脚本代码里指定位置，否则脚本无法正常运行。示例图：<img src="https://pan-yz.chaoxing.com/thumbnail/0,0,0/609a8b79cbd6a91d10c207cf2b5f368d">', 'red');
                                            stop = true;
                                        } else {
                                            logs.addLog('[视频] 观看视频失败', 'red');
                                            logs.addLog('[系统] 错误原因：' + err.error, 'red');
                                        }
                                        missionList['m' + item['jobid']][
                                            'running'
                                        ] = false;
                                        clearInterval(loop);
                                    }
                                });
                            };
                            //v1.9.0：不再向第三方地址取签名令牌（原版请求里带着 classId / UID / 学习进度，明文 HTTP）。
                            //那个服务器早已下线，脚本实际一直走的是 ecOnload(false) 的本地 md5 分支，两者等价。
                            ecOnload(false);
                        }
                        times += 1;
                    }, 1000);
                missionList['m' + item['jobid']]['running'] = true;
            },
            doDocument = (item) => {
                missionList['m' + item['jobid']]['running'] = true;
                logs.addLog('[文档] 开始刷文档：' + item['name']);
                setTimeout(function () {
                    busyThread += 1;
                    GM_xmlhttpRequest({
                        method: "get",
                        url: _p + '//' + _h + '/ananas/job/document?jobid=' + item['jobid'] +
                            '&knowledgeid=' + chapterId + '&courseid=' + courseId + '&clazzid=' +
                            classId + '&jtoken=' + item['jtoken'],
                        onload: function (res) {
                            try {
                                busyThread -= 1;
                                let ispass = JSON.parse(res.responseText);
                                if (ispass['status']) {
                                    logs.addLog('[文档] 文档任务已完成', 'green');
                                } else {
                                    logs.addLog('[文档] 文档已读完，但任务点未完成', 'red');
                                }

                            } catch (err) {
                                console.log(err);
                                console.log(res.responseText);
                                logs.addLog('[文档] 解析文档内容失败', 'red');
                            }
                            missionList['m' + item['jobid']]['running'] = false;
                            missionList['m' + item['jobid']]['done'] = true;
                        },
                        onerror: function (err) {
                            console.log(err);
                            if (err.error.indexOf('@connect list') >= 0) {
                                logs.addLog('[系统] 请添加安全网址：把 【 //@connect      ' + _h + ' 】方括号里的内容（不含方括号）加到脚本代码里指定位置，否则脚本无法正常运行。示例图：<img src="https://pan-yz.chaoxing.com/thumbnail/0,0,0/609a8b79cbd6a91d10c207cf2b5f368d">', 'red');
                                stop = true;
                            } else {
                                logs.addLog('[文档] 阅读文档失败', 'red');
                                logs.addLog('[系统] 错误原因：' + err.error, 'red');
                            }
                            missionList['m' + item['jobid']]['running'] = false;
                            missionList['m' + item['jobid']]['done'] = true;
                        }
                    });
                }, parseInt(Math.random() * 2000 + 9000, 10))
            },
            doWork = (item) => {
                missionList['m' + item['jobid']]['running'] = true;
                logs.addLog('[测验] 开始刷章节测试：' + item['name']);
                logs.addLog('[测验] 答题正确率门槛为 ' + String(accuracy) + '%，高于该值才自动提交测试', 'blue');
                _d.getElementById('workPanel').style.display = 'block';
                _d.getElementById('frame_content').src = _p + '//' + _h + '/work/phone/work?workId=' + item['jobid']
                    .replace('work-', '') + '&courseId=' + courseId + '&clazzId=' + classId + '&knowledgeId=' +
                    chapterId + '&jobId=' + item['jobid'] + '&enc=' + item['enc'];
                _w.top.unrivalWorkInfo = '';
                _w.top.unrivalDoneWorkId = '';
                setInterval(function () {
                    if (_w.top.unrivalWorkInfo != '') {
                        logs.addLog(logSpec.tag(_w.top.unrivalWorkInfo, '答题'));
                        _w.top.unrivalWorkInfo = '';
                    }
                }, 100);
                let checkcross = setInterval(function () {
                    if (_w.top.unrivalWorkDone == false) {
                        clearInterval(checkcross);
                        return;
                    }
                    let ifW = _d.getElementById('frame_content').contentWindow;
                    try {
                        ifW.location.href;
                    } catch (e) {
                        console.log(e);
                        if (e.message.indexOf('cross-origin') != -1) {
                            clearInterval(checkcross);
                            _w.top.unrivalWorkDone = true;
                            return;
                        }
                    }
                }, 2000);
                let workDoneInterval = setInterval(function () {
                    if (_w.top.unrivalWorkDone) {
                        _w.top.unrivalWorkDone = false;
                        clearInterval(workDoneInterval);
                        _w.top.unrivalDoneWorkId = '';
                        //v1.8.1：趁 iframe 还没被清空，把提交结果页上的成绩读出来；
                        //读不到会重试几次，所以 iframe 的清空推迟到读完（done 回调）再执行
                        try {
                            workResult.report('章节测试', function () {
                                try { _d.getElementById('frame_content').src = ''; } catch (e2) { }
                            });
                        } catch (e) { }
                        _d.getElementById('workPanel').style.display = 'none';
                        setTimeout(function () {
                            missionList['m' + item['jobid']]['running'] = false;
                            missionList['m' + item['jobid']]['done'] = true;
                        }, 5000);
                    }
                }, 500);
            },
            missionList = [];
        if (jobList.length <= 0) {
            if (jumpType != 2) {
                _w.top.jump = true;
                logs.addLog('[翻章] 本页没有任务，5 秒后自动跳到下一章', 'green');
            } else if (pauseCtl.isPaused()) {
                logs.addLog('[翻章] 本页没有任务，已暂停：不跳转下一章，点右侧「开始/继续」恢复', 'orange');
            } else {
                logs.addLog('[翻章] 本页没有任务，翻章模式设为「不跳转」，脚本已结束运行；如需自动跳转请在面板改回「遍历」', 'green');
            }
            return;
        }
        for (let i = 0, l = jobList.length; i < l; i++) {
            let item = jobList[i];
            if (item['type'] == 'video') {
                video_getReady(item);
            } else if (item['type'] == 'document') {
                missionList['m' + item['jobid']] = {
                    'type': 'document',
                    'jtoken': item['jtoken'],
                    'jobid': item['jobid'],
                    'name': item['property']['name'],
                    'done': false,
                    'running': false
                };
                _d.getElementById('joblist').innerHTML += `
                            <div class="panel panel-default">
                                <div class="panel-body">
                                    ` + '[文档]' + item['property']['name'] + `
                                </div>
                            </div>`
            } else if (item['type'] == 'workid' && _w.top.unrivalDoWork == '1') {
                missionList['m' + item['jobid']] = {
                    'type': 'work',
                    'workid': item['property']['workid'],
                    'jobid': item['jobid'],
                    'name': item['property']['title'],
                    'enc': item['enc'],
                    'done': false,
                    'running': false
                };
                _d.getElementById('joblist').innerHTML += `
                            <div class="panel panel-default">
                                <div class="panel-body">
                                    ` + '[章节测试]' + item['property']['title'] + `
                                </div>
                            </div>`
            } else {
                //v1.6：未支持的任务类型（直播/阅读等）——把类型打出来，并停下等人工处理，
                //      绝不能悄悄把还有任务点的章节跳过去。
                try {
                    let jobName = item['property']['name'];
                    if (jobName == undefined) {
                        jobName = item['property']['title'];
                    }
                    let jobType = String(item['type'] || 'unknown');
                    if (typeof autoRun != 'undefined' && autoRun.enabled()) {
                        //v1.11：全程托管 —— 跳过做不了的任务，继续往下推进（跳过的会记账，不静默吞掉）
                        _d.getElementById('joblist').innerHTML += `
                            <div class="panel panel-default">
                                <div class="panel-body">
                                    ` + '已跳过（' + jobType + '）：' + jobName + `
                                </div>
                            </div>`
                        logs.addLog('[托管] 跳过不支持的任务类型 [' + jobType + ']：' + jobName + ' —— 这类任务脚本做不了（直播要人工看、阅读要人工读），已跳过并继续', 'orange');
                        //v1.11.1：如果是阅读类任务，给一句能照做的提示
                        try {
                            if (/read|book|zt|node/i.test(String(jobType)) || /阅读|图书|材料/i.test(String(jobName))) {
                                logs.addLog('[阅读] 提示：这像是阅读任务 —— 在「附加功能」里开启「阅读助手」后，打开阅读正文页即可自动逐段滚读完', 'blue');
                            }
                        } catch (e3) { }
                    } else {
                        //v1.6：默认停下等人工处理，绝不能悄悄把还有任务点的章节跳过去
                        _d.getElementById('joblist').innerHTML += `
                            <div class="panel panel-default">
                                <div class="panel-body">
                                    ` + '未支持的任务（' + jobType + '）：' + jobName + `
                                </div>
                            </div>`
                        logs.addLog('[运行] 未支持的任务类型 [' + jobType + ']：' + jobName + ' —— 脚本无法自动完成（直播要人工看、阅读要人工读）', 'red');
                        logs.addLog('[运行] 已停止自动翻章：请人工处理完这一章后，点右侧「开始/继续」恢复', 'orange');
                        try {
                            if (typeof pauseCtl != 'undefined') pauseCtl.set(true);
                        } catch (e2) { }
                    }
                } catch (e) { }
            }
        }
        loopjob();
    } else if (_l.href.includes("mycourse/studentstudy")) {
        var audiofile =
            'data:audio/ogg;base64,T2dnUwACAAAAAAAAAABwRPFFAAAAAGFtEqwBHgF2b3JiaXMAAAAAAUAfAAAAAAAAUHgAAAAAAACZAU9nZ1MAAAAAAAAAAAAAcETxRQEAAAA7J4IBDP8F////////////tQN2b3JiaXMvAAAAWGlwaC5PcmcgbGliVm9yYmlzIEkgMjAxNDAxMjIgKFR1cnBha8OkcsOkamlpbikGAAAAJQAAAEVOQ09ERVI9U291bmQgU3R1ZGlvLCBsaWJWb3JiaXMgMS4zLjEbAAAAQUxCVU0gQVJUSVNUPUFkdmVudHVyZSBMYW5kFAAAAEFMQlVNPUFkdmVudHVyZSBMYW5kIQAAAEVOQ09ESU5HIEFQUExJQ0FUSU9OPVNvdW5kIFN0dWRpbxUAAABBUlRJU1Q9QWR2ZW50dXJlIExhbmQjAAAAVElUTEU9RW1wdHkgTG9vcCBGb3IgSlMgUGVyZm9ybWFuY2UBBXZvcmJpcxJCQ1YBAAABAAxSFCElGVNKYwiVUlIpBR1jUFtHHWPUOUYhZBBTiEkZpXtPKpVYSsgRUlgpRR1TTFNJlVKWKUUdYxRTSCFT1jFloXMUS4ZJCSVsTa50FkvomWOWMUYdY85aSp1j1jFFHWNSUkmhcxg6ZiVkFDpGxehifDA6laJCKL7H3lLpLYWKW4q91xpT6y2EGEtpwQhhc+211dxKasUYY4wxxsXiUyiC0JBVAAABAABABAFCQ1YBAAoAAMJQDEVRgNCQVQBABgCAABRFcRTHcRxHkiTLAkJDVgEAQAAAAgAAKI7hKJIjSZJkWZZlWZameZaouaov+64u667t6roOhIasBADIAAAYhiGH3knMkFOQSSYpVcw5CKH1DjnlFGTSUsaYYoxRzpBTDDEFMYbQKYUQ1E45pQwiCENInWTOIEs96OBi5zgQGrIiAIgCAACMQYwhxpBzDEoGIXKOScggRM45KZ2UTEoorbSWSQktldYi55yUTkompbQWUsuklNZCKwUAAAQ4AAAEWAiFhqwIAKIAABCDkFJIKcSUYk4xh5RSjinHkFLMOcWYcowx6CBUzDHIHIRIKcUYc0455iBkDCrmHIQMMgEAAAEOAAABFkKhISsCgDgBAIMkaZqlaaJoaZooeqaoqqIoqqrleabpmaaqeqKpqqaquq6pqq5seZ5peqaoqp4pqqqpqq5rqqrriqpqy6ar2rbpqrbsyrJuu7Ks256qyrapurJuqq5tu7Js664s27rkearqmabreqbpuqrr2rLqurLtmabriqor26bryrLryratyrKua6bpuqKr2q6purLtyq5tu7Ks+6br6rbqyrquyrLu27au+7KtC7vourauyq6uq7Ks67It67Zs20LJ81TVM03X9UzTdVXXtW3VdW1bM03XNV1XlkXVdWXVlXVddWVb90zTdU1XlWXTVWVZlWXddmVXl0XXtW1Vln1ddWVfl23d92VZ133TdXVblWXbV2VZ92Vd94VZt33dU1VbN11X103X1X1b131htm3fF11X11XZ1oVVlnXf1n1lmHWdMLqurqu27OuqLOu+ruvGMOu6MKy6bfyurQvDq+vGseu+rty+j2rbvvDqtjG8um4cu7Abv+37xrGpqm2brqvrpivrumzrvm/runGMrqvrqiz7uurKvm/ruvDrvi8Mo+vquirLurDasq/Lui4Mu64bw2rbwu7aunDMsi4Mt+8rx68LQ9W2heHVdaOr28ZvC8PSN3a+AACAAQcAgAATykChISsCgDgBAAYhCBVjECrGIIQQUgohpFQxBiFjDkrGHJQQSkkhlNIqxiBkjknIHJMQSmiplNBKKKWlUEpLoZTWUmotptRaDKG0FEpprZTSWmopttRSbBVjEDLnpGSOSSiltFZKaSlzTErGoKQOQiqlpNJKSa1lzknJoKPSOUippNJSSam1UEproZTWSkqxpdJKba3FGkppLaTSWkmptdRSba21WiPGIGSMQcmck1JKSamU0lrmnJQOOiqZg5JKKamVklKsmJPSQSglg4xKSaW1kkoroZTWSkqxhVJaa63VmFJLNZSSWkmpxVBKa621GlMrNYVQUgultBZKaa21VmtqLbZQQmuhpBZLKjG1FmNtrcUYSmmtpBJbKanFFluNrbVYU0s1lpJibK3V2EotOdZaa0ot1tJSjK21mFtMucVYaw0ltBZKaa2U0lpKrcXWWq2hlNZKKrGVklpsrdXYWow1lNJiKSm1kEpsrbVYW2w1ppZibLHVWFKLMcZYc0u11ZRai621WEsrNcYYa2415VIAAMCAAwBAgAlloNCQlQBAFAAAYAxjjEFoFHLMOSmNUs45JyVzDkIIKWXOQQghpc45CKW01DkHoZSUQikppRRbKCWl1losAACgwAEAIMAGTYnFAQoNWQkARAEAIMYoxRiExiClGIPQGKMUYxAqpRhzDkKlFGPOQcgYc85BKRljzkEnJYQQQimlhBBCKKWUAgAAChwAAAJs0JRYHKDQkBUBQBQAAGAMYgwxhiB0UjopEYRMSielkRJaCylllkqKJcbMWomtxNhICa2F1jJrJcbSYkatxFhiKgAA7MABAOzAQig0ZCUAkAcAQBijFGPOOWcQYsw5CCE0CDHmHIQQKsaccw5CCBVjzjkHIYTOOecghBBC55xzEEIIoYMQQgillNJBCCGEUkrpIIQQQimldBBCCKGUUgoAACpwAAAIsFFkc4KRoEJDVgIAeQAAgDFKOSclpUYpxiCkFFujFGMQUmqtYgxCSq3FWDEGIaXWYuwgpNRajLV2EFJqLcZaQ0qtxVhrziGl1mKsNdfUWoy15tx7ai3GWnPOuQAA3AUHALADG0U2JxgJKjRkJQCQBwBAIKQUY4w5h5RijDHnnENKMcaYc84pxhhzzjnnFGOMOeecc4wx55xzzjnGmHPOOeecc84556CDkDnnnHPQQeicc845CCF0zjnnHIQQCgAAKnAAAAiwUWRzgpGgQkNWAgDhAACAMZRSSimllFJKqKOUUkoppZRSAiGllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimVUkoppZRSSimllFJKKaUAIN8KBwD/BxtnWEk6KxwNLjRkJQAQDgAAGMMYhIw5JyWlhjEIpXROSkklNYxBKKVzElJKKYPQWmqlpNJSShmElGILIZWUWgqltFZrKam1lFIoKcUaS0qppdYy5ySkklpLrbaYOQelpNZaaq3FEEJKsbXWUmuxdVJSSa211lptLaSUWmstxtZibCWlllprqcXWWkyptRZbSy3G1mJLrcXYYosxxhoLAOBucACASLBxhpWks8LR4EJDVgIAIQEABDJKOeecgxBCCCFSijHnoIMQQgghREox5pyDEEIIIYSMMecghBBCCKGUkDHmHIQQQgghhFI65yCEUEoJpZRSSucchBBCCKWUUkoJIYQQQiillFJKKSGEEEoppZRSSiklhBBCKKWUUkoppYQQQiillFJKKaWUEEIopZRSSimllBJC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',
            audioPlayer = new Audio(audiofile);
        _w.top.backNow = 0;
        audioPlayer.loop = true;
        _w.audioPlayer = audioPlayer;
        setInterval(function () {
            try {
                _w.jQuery.fn.viewer.Constructor.prototype.show = () => { };
            } catch (e) {
            }
        }, 1000);
        try {
            _w.unrivalScriptList.push('Fuck me please');
        } catch (e) {
            _w.unrivalScriptList = ['Fuck me please'];
        }
         function include_js(file, target) {
            var js;
            if (target == undefined) {
                target = self;
            }
            var html_doc = target.document.getElementsByTagName('head')[0];
            js = target.document.createElement('script');
            js.setAttribute('type', 'text/javascript');
            js.setAttribute('src', file);
            html_doc.appendChild(js);
        }
        //v1.1 已移除早期版本注入的第三方浏览器挖矿脚本（该版本会加载外部挖矿脚本并以多线程挖矿，与"不占资源"相悖且存在安全风险）
        function checkOffline() {
            let dleft = _d.getElementsByClassName('left');
            if (dleft.length == 1) {
                let img = dleft[0].getElementsByTagName('img');
                if (img.length == 1) {
                    if (img[0].src.indexOf('loading.gif') != -1) {
                        return true;
                    }
                }
            }
            return false;
        }
        setInterval(function () {
            if (checkOffline()) {
                setTimeout(function () {
                    if (checkOffline()) {
                        _l.reload();
                    }
                }, 10000)
            }
        }, 3000);
        _d.addEventListener('visibilitychange', function () {
            var c = 0;
            if (_w.top.backNow == 0) {
                _d.title = '⚠️请先激活挂机';
                return
            } else {
                _d.title = '学生学习页面';
            }
            if (_d.hidden) {
                audioPlayer.play();
                var timer = setInterval(function () {
                    if (c) {
                        _d.title = '🙈挂机中';
                        c = 0;
                    } else {
                        _d.title = '🙉挂机中';
                        c = 1;
                    }
                    if (!_d.hidden) {
                        clearInterval(timer);
                        _d.title = '学生学习页面';
                    }
                }, 1300);
            } else {
                audioPlayer.pause();
            }
        });
        _w.unrivalgetTeacherAjax = _w.getTeacherAjax;
        _w.getTeacherAjax = (courseid, classid, cid) => {
            if (cid == getQueryVariable('chapterId')) {
                return;
            }
            _w.top.unrivalPageRd = '';
            _w.unrivalgetTeacherAjax(courseid, classid, cid);
        }
        if (disableMonitor == 1) {
            _w.appendChild = _w.Element.prototype.appendChild;
            _w.Element.prototype.appendChild = function () {
                try {
                    if (arguments[0].src.indexOf('detect.chaoxing.com') > 0) {
                        return;
                    }
                } catch (e) { }
                _w.appendChild.apply(this, arguments);
            };
        }

        _w.jump = false;
        setInterval(function () {
            if (getQueryVariable('mooc2') == '1') {
                let tabs = _d.getElementsByClassName('posCatalog_select');
                for (let i = 0, l = tabs.length; i < l; i++) {
                    let tabId = tabs[i].getAttribute('id');
                    if (tabId.indexOf('cur') >= 0 && tabs[i].getAttribute('class') == 'posCatalog_select') {
                        tabs[i].setAttribute('onclick', "getTeacherAjax('" + courseId + "','" + classId +
                            "','" + tabId.replace('cur', '') + "');");
                    }
                }
            } else {
                let h4s = _d.getElementsByTagName('h4'),
                    h5s = _d.getElementsByTagName('h5');
                for (let i = 0, l = h4s.length; i < l; i++) {
                    if (h4s[i].getAttribute('id').indexOf('cur') >= 0) {
                        h4s[i].setAttribute('onclick', "getTeacherAjax('" + courseId + "','" + classId +
                            "','" + h4s[i].getAttribute('id').replace('cur', '') + "');");
                    }
                }
                for (let i = 0, l = h5s.length; i < l; i++) {
                    if (h5s[i].getAttribute('id').indexOf('cur') >= 0) {
                        h5s[i].setAttribute('onclick', "getTeacherAjax('" + courseId + "','" + classId +
                            "','" + h5s[i].getAttribute('id').replace('cur', '') + "');");
                    }
                }
            }
        }, 1000);
        setInterval(function () {
            let but = null;
            if (_w.jump) {
                _w.jump = false;
                _w.top.unrivalDoneWorkId = '';
                _w.jjump = (rd) => {
                    if (rd != _w.top.unrivalPageRd) {
                        return;
                    }
                    try {
                        setTimeout(function () {
                            if (jumpType == 1) {
                                if (getQueryVariable('mooc2') == '1') {
                                    but = _d.getElementsByClassName(
                                        'jb_btn jb_btn_92 fs14 prev_next next');
                                } else {
                                    but = _d.getElementsByClassName('orientationright');
                                }
                                try {
                                    setTimeout(function () {
                                        if (rd != _w.top.unrivalPageRd) {
                                            return;
                                        }
                                        but[0].click();
                                    }, 2000);
                                } catch (e) { }
                                return;
                            }
                            if (getQueryVariable('mooc2') == '1') {
                                let ul = _d.getElementsByClassName('prev_ul')[0],
                                    lis = ul.getElementsByTagName('li');
                                for (let i = 0, l = lis.length; i < l; i++) {
                                    if (lis[i].getAttribute('class') == 'active') {
                                        if (i + 1 >= l) {
                                            break;
                                        } else {
                                            try {
                                                lis[i + 1].click();
                                            } catch (e) { }
                                            return;
                                        }
                                    }
                                }
                                let tabs = _d.getElementsByClassName('posCatalog_select');
                                for (let i = 0, l = tabs.length; i < l; i++) {
                                    if (tabs[i].getAttribute('class') ==
                                        'posCatalog_select posCatalog_active') {
                                        while (i + 1 < tabs.length) {
                                            let nextTab = tabs[i + 1];
                                            if ((nextTab.innerHTML.includes(
                                                'icon_Completed prevTips') && _w.top
                                                    .unrivalReviewMode == '0') || nextTab
                                                        .innerHTML.includes(
                                                            'catalog_points_er prevTips')) {
                                                i++;
                                                continue;
                                            }
                                            if (nextTab.id.indexOf('cur') < 0) {
                                                i++;
                                                continue;
                                            }
                                            let clickF = setInterval(function () {
                                                if (rd != _w.top.unrivalPageRd) {
                                                    clearInterval(clickF);
                                                    return;
                                                }
                                                nextTab.click();
                                            }, 2000);
                                            break;
                                        }
                                        break;
                                    }
                                }
                            } else {
                                let div = _d.getElementsByClassName('tabtags')[0],
                                    spans = div.getElementsByTagName('span');
                                for (let i = 0, l = spans.length; i < l; i++) {
                                    if (spans[i].getAttribute('class').indexOf('currents') >=
                                        0) {
                                        if (i + 1 == l) {
                                            break;
                                        } else {
                                            try {
                                                spans[i + 1].click();
                                            } catch (e) { }
                                            return;
                                        }
                                    }
                                }
                                let tabs = _d.getElementsByTagName('span'),
                                    newTabs = [];
                                for (let i = 0, l = tabs.length; i < l; i++) {
                                    if (tabs[i].getAttribute('style') != null && tabs[i]
                                        .getAttribute('style').indexOf(
                                            'cursor:pointer;height:18px;') >= 0) {
                                        newTabs.push(tabs[i]);
                                    }
                                }
                                tabs = newTabs;
                                for (let i = 0, l = tabs.length; i < l; i++) {
                                    if (tabs[i].parentNode.getAttribute('class') ==
                                        'currents') {
                                        while (i + 1 < tabs.length) {
                                            let nextTab = tabs[i + 1].parentNode;
                                            if ((nextTab.innerHTML.includes(
                                                'roundpoint  blue') && _w.top
                                                    .unrivalReviewMode == '0') || nextTab
                                                        .innerHTML.includes('roundpointStudent  lock')
                                            ) {
                                                i++;
                                                continue;
                                            }
                                            if (nextTab.id.indexOf('cur') < 0) {
                                                i++;
                                                continue;
                                            }
                                            let clickF = setInterval(function () {
                                                if (rd != _w.top.unrivalPageRd) {
                                                    clearInterval(clickF);
                                                    return;
                                                }
                                                nextTab.click();
                                            }, 2000);
                                            break;
                                        }
                                        break;
                                    }
                                }
                            }
                        }, 2000);
                    } catch (e) { }
                }
                _w.onReadComplete1();
                setTimeout('jjump("' + _w.top.unrivalPageRd + '")', 2856);
            }
        }, 200);
    } else if (_l.href.indexOf("work/phone/doHomeWork") > 0) {
        var wIdE = _d.getElementById('workLibraryId') || _d.getElementById('oldWorkId'),
            wid = wIdE.value;
        _w.top.unrivalWorkDone = false;
        _w.aalert = _w.alert;
        _w.alert = (msg) => {
            if (msg == '保存成功') {
                _w.top.unrivalDoneWorkId = getQueryVariable('workId');
                return;
            }
            aalert(msg);
        }
        if (_w.top.unrivalDoneWorkId == getQueryVariable('workId')) {
            _w.top.unrivalWorkDone = true;
            return;
        }
        _w.confirm = (msg) => {
            return true;
        }
        //v1.2：先还原超星加密字体，否则题干是乱码，题库与AI都答不了
        try {
            cxDecrypt.decrypt(0);
        } catch (e) {
            console.log(e);
        }
        var questionList = [],
            questionsElement = _d.getElementsByClassName('Py-mian1'),
            questionNum = questionsElement.length,
            totalQuestionNum = questionNum;
        for (let i = 0; i < questionNum; i++) {
            let questionElement = questionsElement[i],
                idElements = questionElement.getElementsByTagName('input'),
                questionId = '0',
                question = questionElement.getElementsByClassName('Py-m1-title fs16')[0].innerHTML;
                question = cxDecrypt.applyMapToText(question, cxDecrypt.getCharMap());
            question = handleImgs(question).replace(/(<([^>]+)>)/ig, '').replace(/[0-9]{1,3}.\[(.*?)\]/ig, '').replaceAll('\n',
                '').replace(/^\s+/ig, '').replace(/\s+$/ig, '');
            for (let z = 0, k = idElements.length; z < k; z++) {
                try {
                    if (idElements[z].getAttribute('name').indexOf('answer') >= 0) {
                        questionId = idElements[z].getAttribute('name').replace('type', '');
                        break;
                    }
                } catch (e) {
                    console.log(e);
                    continue;
                }
            }
            if (questionId == '0' || question == '') {
                continue;
            }
            typeE = questionElement.getElementsByTagName('input');
            if (typeE == null || typeE == []) {
                continue;
            }
            let typeN = 'fuckme';
            for (let g = 0, h = typeE.length; g < h; g++) {
                if (typeE[g].id == 'answertype' + questionId.replace('answer', '').replace('check', '')) {
                    typeN = typeE[g].value;
                    break;
                }
            }
            if (['0', '1', '3'].indexOf(typeN) < 0) {
                continue;
            }
            type = {
                '0': '单选题',
                '1': '多选题',
                '3': '判断题'
            }[typeN];
            let optionList = {
                length: 0
            };
            if (['单选题', '多选题'].indexOf(type) >= 0) {
                let answersElements = questionElement.getElementsByClassName('answerList')[0].getElementsByTagName(
                    'li');
                for (let x = 0, j = answersElements.length; x < j; x++) {
                    let optionE = answersElements[x],
                        optionTextE = trim(cxDecrypt.applyMapToText(optionE.innerHTML, cxDecrypt.getCharMap()).replace(/(^\s*)|(\s*$)/g, "")),
                        optionText = optionTextE.slice(1).replace(/(^\s*)|(\s*$)/g, ""),
                        optionValue = optionTextE.slice(0, 1),
                        optionId = optionE.getAttribute('id-param');
                    if (optionText == '') {
                        break;
                    }
                    optionList[optionText] = {
                        'id': optionId,
                        'value': optionValue
                    }
                    optionList.length++;
                }
                if (answersElements.length != optionList.length) {
                    continue;
                }
            }
            questionList.push({
                'question': question,
                'type': type,
                'questionid': questionId,
                'options': optionList
            });
        }
        var qu = null,
            nowTime = -2000,
            busyThread = questionList.length,
            autoQuestionNum = questionList.length, //v1.1：可自动作答(单选/多选/判断)的题目数，作为正确率分母，避免填空题等撑大分母导致永远达不到门槛
            ctOnload = function (res, quu) {
                busyThread -= 1;
                var ctResult = {
                    'code': -1,
                    'finalUrl': '',
                    'data': '未找到答案'
                };
                if (res) {
                    try {
                        var responseText = res.responseText,
                            ctResult = JSON.parse(responseText);
                    } catch (e) {
                        console.log(e);

                    }
                }
                try {
                    let choiceEs = _d.getElementsByTagName('li');
var ctCode = parseInt(ctResult['code'], 10);
                    if (isNaN(ctCode) || ctCode < 0) {
                        try {
                            if (ctResult['msg'] !== undefined) {
                                _w.top.unrivalWorkInfo = ctResult['msg'];
                            }
                        } catch (e) { }
                        //v1.1：负数码一律视为题库失败(-1=未收录，-2=接口流控)。原代码只判断-1，导致-2时把"触发流控限制"这句提示当成答案文本去匹配选项
                        //v1.11.3：失败分类 —— 只有「网络错误/超时」才计入熔断；
                        //   「未收录」是题库的正常结果（题库里就是没有这道题），不计失败；
                        //   「流控」由题库客户端内部退避重试，这里不再判失败。
                        var _v113msg = String(ctResult['msg'] || '');
                        if (_v113msg == '网络错误' || _v113msg == '请求超时') {
                            ctFail(_v113msg);
                        } else if (ctCode == -2) {
                            aiLog('[题库] 触发流控，已自动退避重试，仍未拿到答案', 'orange');
                        } else if (isNaN(ctCode)) {
                            ctFail('返回格式异常');
                        } else {
                            aiLog('[题库] 未收录该题（不计失败），转交 AI', 'orange');
                        }
                        //v1.9.0：删掉不可达的「备用题库」分支（开关硬编码为 0、面板无入口、服务器早已下线）。
                        //查题失败时直接降级到 AI。
                        aiDoWork(quu, true); //busyThread 已在 ctOnload 开头扣减过
                        return;
                    }
                    ctSuccess();
                    try {
                        var result = ctResult['data'];
                    } catch (e) {
                        _w.top.unrivalWorkInfo = '答案解析失败';
                        return;
                    }
                    _w.top.unrivalWorkInfo = '题目：' + quu['question'] + '：' + result;
                    //v1.11.3：题库答案 → 选项改成「打分制」（ctBank 统一处理）
                    //   · 单选题只取最高分那一个（修掉「一句话勾多个」）；
                    //   · 多选题按 '#' 分隔的多条答案陈述分别映射；
                    //   · 判断题走同义表（正确/对/√ ↔ 错误/错/×）；
                    //   · 匹配不上就走原来的随机兜底（【B】/【错】/全选）。
                    var _v113 = (typeof ctBank !== 'undefined' && ctBank) ?
                        ctBank.applyLearning(quu, result, { d: _d, log: aiLog }) : null;
                    if (_v113 && _v113.ok) {
                        questionNum -= 1;
                    } else if (quu['type'] === '判断题') {
                        if (randomDo == 1 && accuracy < 100) {
                            _w.top.unrivalWorkInfo = quu['question'] + '：未找到正确答案，自动选【错】';
                            for (let u = 0, k = choiceEs.length; u < k; u++) {
                                if (choiceEs[u].getElementsByTagName('em').length < 1) {
                                    continue;
                                }
                                if (choiceEs[u].getAttribute('val-param') ==
                                    'false' && choiceEs[u].getAttribute(
                                        'id-param') == quu['questionid'].replace(
                                            'answer', '')) {
                                    choiceEs[u].click();
                                    break;
                                }
                            }
                        }
                    } else if (quu['type'] === '多选题') {
                        if (randomDo == 1 && accuracy < 100) {
                            _w.top.unrivalWorkInfo = quu['question'] +
                                '：未找到正确答案，自动全选';
                            for (let y = 0, j = choiceEs.length; y <
                                j; y++) {
                                if (choiceEs[y].getAttribute('id-param') ==
                                    quu['questionid'].replace('answer',
                                        '')) {
                                    if (!choiceEs[y].getAttribute('class')
                                        .includes('cur')) {
                                        choiceEs[y].click();
                                    }
                                }
                            }
                        }
                    } else {
                        if (randomDo == 1 && accuracy < 100) {
                            _w.top.unrivalWorkInfo = quu['question'] +
                                '：未找到正确答案，自动选【B】';
                            for (let y = 0, j = choiceEs.length; y <
                                j; y++) {
                                if (choiceEs[y].getElementsByTagName(
                                    'em').length < 1) {
                                    continue;
                                }
                                if (choiceEs[y].getElementsByTagName(
                                    'em')[0].getAttribute('id-param') ==
                                    'B' && choiceEs[y]
                                        .getAttribute('id-param') == quu[
                                            'questionid'].replace('answer',
                                                '')) {
                                    if (!choiceEs[y].getAttribute('class')
                                        .includes('cur')) {
                                        choiceEs[y].click();
                                    }
                                    break;
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.log(e);
                }
            }
        for (let i = 0, l = questionList.length; i < l; i++) {
            nowTime += parseInt(Math.random() * 2000 + 2500, 10);
            setTimeout(function () {
                //v1.1：用块级变量保存当前题，避免异步回调读到被后续题目覆盖的共享 qu
                let quItem = questionList[i];
                qu = quItem;
                //v1.1：题库熔断中，直接交给AI，不再请求题库
                if (ctDisabled()) {
                    aiDoWork(quItem, false);
                    return;
                }
                //v1.11.3：改走多源免费题库客户端（icodef 主源 + 百度不挂科 + icodef 备用源）
                //   · 未收录不再算「失败」，只有网络错误/超时才计入熔断；
                //   · 流控由客户端内部退避重试，不再直接降级 AI；
                //   · 命中过的题目走缓存，同一题不再重复请求。
                try {
                    ctBank.ask(quItem['question'], quItem['type'], function (r) {
                        if (r && r.ok) {
                            ctOnload({ responseText: JSON.stringify({ code: 1, data: String(r.data) }) }, quItem);
                            return;
                        }
                        var _v113r = r || {};
                        var _v113msg = (_v113r.reason == 'error' || _v113r.reason == 'timeout') ? '网络错误' : '题库未收录';
                        ctOnload({ responseText: JSON.stringify({ code: -1, msg: _v113msg, data: '' }) }, quItem);
                    }, { id: (typeof wid !== 'undefined' ? wid : 1) });
                } catch (e) {
                    ctFail('题库客户端异常');
                    aiDoWork(quItem, false);
                }            }, nowTime);
        }
        //===== v1.8.1：章节测试「提交/保存」判定修正 =====
        // 【为什么要改】
        //   上游用「先取整再乘 100」的假正确率决定提交还是保存：
        //     Math.floor((totalQuestionNum - questionNum) / autoQuestionNum) * 100 >= accuracy
        //   · 它衡量的是「自动题答完了没有」，不是「答对了多少」（v1.1 改分母时留下的坑）；
        //   · Math.floor 把任何未完成状态压成 0 —— 只要还有自动题没答上，必然判成「不达标」；
        //   · 而「不达标」分支无条件 _w.top.jump = true 直接跳走，
        //     保存答案（_w.noSubmit()）又被同一个假判定的 > 0 挡掉
        //     ⇒ 既没保存也没提交，章节被直接丢过去，任务点永远不亮（3.2 实测）。
        //   触发时机是 busyThread 归零那一刻，而 busyThread 的记账与 questionNum 口径不一致，
        //   归零可能早于「最后一题点完」（3.2：第 2 题的 AI 答案 0.8 秒后才到，
        //   脚本却在这一秒判定结束并跳走了）。
        // 【怎么改】
        //   · 判定以 DOM 实况为准：选项 li 的 class 含 'cur' 才算这题答上了；
        //   · 还有题没答上 → 继续等（最多 60 秒，每 10 秒报一次进度），绝不提前跳走；
        //   · 等满 60 秒仍未答上的题，用兜底选项补齐，保证提交时没有空题；
        //   · 提交条件由假正确率换成「DOM 完成率 ≥ 正确率门槛」。
        var _workWaitTicks = 0;
        var _workAnswerStat = function () {
            var total = 0, done = 0, missing = [];
            try {
                var lis = _d.getElementsByTagName('li');
                for (var i = 0; i < questionList.length; i++) {
                    var qid = String(questionList[i]['questionid'] || '').replace('answer', '');
                    total++;
                    var hit = false;
                    for (var j = 0; j < lis.length; j++) {
                        if (String(lis[j].getAttribute('id-param') || '') == qid &&
                            String(lis[j].getAttribute('class') || '').indexOf('cur') >= 0) {
                            hit = true;
                            break;
                        }
                    }
                    if (hit) done++; else missing.push(questionList[i]);
                }
            } catch (e) { }
            return { total: total, done: done, missing: missing };
        };
        var _workFillFallback = function (missing) {
            try {
                var lis = _d.getElementsByTagName('li');
                for (var i = 0; i < missing.length; i++) {
                    var qid = String(missing[i]['questionid'] || '').replace('answer', '');
                    for (var j = 0; j < lis.length; j++) {
                        if (String(lis[j].getAttribute('id-param') || '') == qid &&
                            String(lis[j].getAttribute('class') || '').indexOf('cur') < 0) {
                            try { lis[j].click(); } catch (e1) { }
                            break;
                        }
                    }
                }
            } catch (e) { }
        };
        var workInterval = setInterval(function () {
            //v1.8.1：放宽成 > 0 —— 万一 busyThread 被重复扣成负数，不会永久卡住
            if (busyThread > 0) {
                return;
            }
            var _st = _workAnswerStat();
            if (_st.total > 0 && _st.done < _st.total) {
                _workWaitTicks++;
                if (_workWaitTicks <= 60) {
                    if (_workWaitTicks == 1 || _workWaitTicks % 10 == 0) {
                        _w.top.unrivalWorkInfo = '章节测试：还有 ' + (_st.total - _st.done) + ' 道题没作答（已答 ' + _st.done + '/' + _st.total + '），等答完再提交';
                    }
                    return;   //继续等，不清定时器、不跳走
                }
                //等太久了：兜底补齐空题，保证提交时没有空题
                _workFillFallback(_st.missing);
                _st = _workAnswerStat();
                _w.top.unrivalWorkInfo = '章节测试：有 ' + _st.missing.length + ' 道题迟迟没作答，已用兜底选项补齐后提交';
            }
            clearInterval(workInterval);
            //v1.8.1：完成率以 DOM 实况为准，不再用上游那套「先取整再乘100」的假正确率
            var _rate = (_st.total > 0) ? Math.floor(_st.done * 100 / _st.total) : 100;
            if (autoQuestionNum > 0 && _rate >= accuracy && _w.top
                .unrivalAutoSubmit == '1') {
                _w.top.unrivalDoneWorkId = getQueryVariable('workId');
                _w.top.unrivalWorkInfo = '正确率符合标准，已提交答案（完成度 ' + _rate + '%）';
                  setTimeout(function() {
                    submitCheckTimes();
                    escapeBlank()
                    submitAction()
                    //	setTimeout(function() {
                    //          document.querySelector(".cx_alert-blue").click()
                    //	}, parseInt(1000));
                }, parseInt(Math.random() * 2000 + 3000, 10));

} else if (_w.top.unrivalAutoSave == 1) {
    //v1.8.1：文案说清楚是「已答完但没到门槛 / 没开自动提交」；
    //  并把「跳走」挪到保存之后 —— 上游是「先 jump=true、2 秒后才保存」，
    //  两者抢跑，翻页常常把保存动作打断（章节就算答了也不会亮）。
    _w.top.unrivalWorkInfo = '章节测试已答完（完成度 ' + _rate + '%），未设置自动提交，已自动保存答案';
    if (autoQuestionNum > 0) {
        setTimeout(function () {
            _w.top.unrivalDoneWorkId = getQueryVariable('workId');
            _w.noSubmit();
            setTimeout(function () { try { _w.top.jump = true; } catch (e) { } }, 1500);
        }, 2000);
    } else {
        _w.top.jump = true;
    }
} else {
    _w.top.unrivalWorkInfo = '用户设置为不自动保存答案，请手动提交或保存作业';
}
		}, 1000);
	} else if (_l.href.includes('work/phone/selectWorkQuestionYiPiYue')) {
    _w.top.unrivalWorkDone = true;
    _w.top.unrivalDoneWorkId = getQueryVariable('workId');
} else if (_l.href.includes('stat2-ans.chaoxing.com/task/s/index')) {
    if (_w.top == _w) {
        return;
    }
    _d.getElementsByClassName('page-container studentStatistic')[0].setAttribute('class', 'studentStatistic');
    _d.getElementsByClassName('page-item item-task-list minHeight390')[0].remove();
    _d.getElementsByClassName('subNav clearfix')[0].remove();
    setInterval(function () {
        _l.reload();
    }, 90000);
} else if (_l.href.includes('passport2.') && _l.href.includes('login?refer=http') && autoLogin == 1) {
    if (!(/^1[3456789]\d{9}$/.test(phoneNumber))) {
        alert('自动登录的手机号填写错误，无法登陆')
        return;
    }
    if (password == '') {
        alert('未填写登录密码，无法登陆')
        return;
    }
    GM_xmlhttpRequest({
        method: "get",
        url: 'https://passport2-api.chaoxing.com/v11/loginregister?cx_xxt_passport=json&uname=' +
            phoneNumber + '&code=' + encodeURIComponent(password),
        onload: function (res) {
            try {
                let ispass = JSON.parse(res.responseText);
                if (ispass['status']) {
                    _l.href = decodeURIComponent(getQueryVariable('refer'));
                } else {
                    alert(ispass['mes']);
                }
            } catch (err) {
                console.log(res.responseText);
                alert('登陆失败');
            }
        },
        onerror: function (err) {
            alert('登陆错误');
        }
    });
} else if (_l.href.includes('unrivalxxtbackground')) {
    _d.getElementsByTagName("html")[0].innerHTML = `
    <!DOCTYPE html>
<html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>学习通挂机小助手</title>
        <meta content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0" name="viewport">
        <link href="https://z.chaoxing.com/yanshi/css/bootstrap.min.css" rel="stylesheet">
    </head>
    <body>
        <div class="row" style="margin: 10px;">
            <div class="col-md-6 col-md-offset-3">
                <div class="header clearfix">
                    <h3 class="text-muted" style="margin-top: 20px;margin-bottom: 0;float: left;">学习通挂机小助手&ensp;</h3>
                </div>
                <hr style="margin-top: 10px;margin-bottom: 20px;">
                <div class="panel panel-info">
                    <div class="panel-heading">任务列表</div>
                    <div class="panel-body" id='joblist'>
                    </div>
                </div>
                <div class="panel panel-info">
                    <div class="panel-heading">运行日志</div>
                    <div class="panel-body">
                        <div id="result" style="overflow:auto;line-height: 30px;">
                            <div id="log">
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </body>
</html>
    `;
    var logs = {
        "logArry": [],
        "addLog": function (str, color = "black") {
            if (this.logArry.length >= 50) {
                this.logArry.splice(0, 1);
            }
            var nowTime = new Date(),
                nowHour = (Array(2).join(0) + nowTime.getHours()).slice(-2),
                nowMin = (Array(2).join(0) + nowTime.getMinutes()).slice(-2),
                nowSec = (Array(2).join(0) + nowTime.getSeconds()).slice(-2),
                logElement = _d.getElementById('log'),
                logStr = "";
            this.logArry.push("<span style='color: " + color + "'>[" + nowHour + ":" + nowMin + ":" +
                nowSec + "] " + str + "</span>");
            for (let logI = 0, logLen = this.logArry.length; logI < logLen; logI++) {
                logStr += this.logArry[logI] + "<br>";
            }
            _d.getElementById('log').innerHTML = logStr;
            logElement.scrollTop = logElement.scrollHeight;
        }
    };
    logs.addLog('[系统] 本页面不必保持在最前端，后台会自动进行任务', 'green');
    setInterval(function () {
        //v1.11.2：原来每 2 分钟重复一次「此页面不必保持在最前端」→ 只保留开头那一条
        logs.addLog('[系统] 如想禁用后台刷视频功能，请关闭脚本并重启浏览器', 'blue');
    }, 120000)
    GM_addValueChangeListener('unrivalxxtbackgroundinfo', function (name, old_value, new_value, remote) {
        if (old_value != new_value) {
            logs.addLog(logSpec.tag(new_value, '系统'));
        }
    });
    setInterval(function () {
        if (Math.round(new Date() / 1000) - parseInt(GM_getValue('unrivalBackgroundVideoEnable', '6')) >
            15) {
            logs.addLog('[系统] 脚本可能运行异常：如页面无反应，请尝试重启脚本猫或重启浏览器');
        }
    }, 10000);
    var loopShow = () => {
        let jobList = GM_getValue('unrivalBackgroundList', '1');
        if (jobList == '1') {
            _d.getElementById('joblist').innerHTML = '请将“超星挂机小助手”升级到最新版并重启浏览器';
        } else {
            try {
                let jobHtml = '';
                for (let i = 0, l = jobList.length; i < l; i++) {
                    let status = '';
                    if (jobList[i]['done']) {
                        status = '已完成';
                    } else if (parseInt(jobList[i]['playTime']) > 0) {
                        status = '进行中';
                    } else {
                        status = '等待中';
                    }
                    if (jobList[i]['review']) {
                        status += '：复习模式';
                    }
                    jobHtml += `
                            <div class="panel panel-default">
                                <div class="panel-body">
                                    ` + '[' + status + ']' + jobList[i]['name'] + `
                                </div>
                            </div>`
                }
                _d.getElementById('joblist').innerHTML = jobHtml;
            } catch (e) {
                _d.getElementById('joblist').innerHTML = '请将“超星挂机小助手”升级到最新版并重启浏览器！';
            }
        }
    }
    loopShow();
    setInterval(loopShow, 10000);
}
}) ();