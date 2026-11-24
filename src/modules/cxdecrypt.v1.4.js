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
    /*__TYPR_MD5__*/
    /*__FONT_TABLE__*/
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
            aiLog('字体解密完成，已还原 ' + Object.keys(this.charMap).length + ' 个字符', 'green');
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
