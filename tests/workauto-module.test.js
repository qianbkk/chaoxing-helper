// v1.4 章节测验/作业自动作答 + 字体解密 隔离单测
// 运行：node tests/workauto-module.test.js
//
// 测的是 **dist/ 里真正要发布的那份脚本**：
//   · 内联的 Typr+md5+字形映射表能否把超星加密字体还原成明文
//   · 新版作业页 DOM（.TiMu / .Zy_TItle / ul.Zy_ulTop li）能否被正确解析
//   · 题库返回"选项文字"时能否正确匹配（兼容超星的选项乱序）
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const file = path.join(root, 'dist', 'chaoxing-helper.user.js');
const src = fs.readFileSync(file, 'utf8');

// ---------------- 提取模块 ----------------
function sliceBetween(startMark, endMark) {
    const s = src.indexOf(startMark);
    const e = src.indexOf(endMark);
    if (s < 0 || e < 0) throw new Error('未找到模块标记: ' + startMark);
    return src.slice(s, e);
}
const cxMod = sliceBetween('//==================== v1.4 超星加密字体解密', '//==================== 字体解密模块结束');
const workMod = sliceBetween('//==================== v1.4 章节测验 / 作业自动作答', '//==================== v1.3 附加模块开始');
// v1.11.3：作业端的答案匹配改成打分制，实现落在「多源免费题库」模块里
const ctBankMod = sliceBetween('//==================== v1.11.3 多源免费题库开始 ====================', '//==================== v1.11.3 多源免费题库结束 ====================');

// ---------------- 极简 fake DOM ----------------
function matchSimple(el, sel) {
    sel = String(sel || '').trim();
    const m = /^([a-zA-Z][a-zA-Z0-9]*)?((?:[.#][\w-]+|\[[^\]]+\])*)$/.exec(sel);
    if (!m) return false;
    if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
    const rest = m[2] || '';
    const re = /([.#])([\w-]+)|\[([\w-]+)(?:([~^$*|]?=)"?([^\]"]*)"?)?\]/g;
    let x;
    while ((x = re.exec(rest))) {
        if (x[1] === '.') {
            if (!String(el._cls || '').split(/\s+/).includes(x[2])) return false;
        } else if (x[1] === '#') {
            if (el.getAttribute('id') !== x[2]) return false;
        } else {
            const attr = x[3], op = x[4], val = x[5];
            const cur = el.getAttribute(attr);
            if (cur === null || cur === undefined) return false;
            if (op === '=') { if (String(cur) !== String(val)) return false; }
            else if (op === '^=') { if (String(cur).indexOf(String(val)) !== 0) return false; }
            else if (op === '*=') { if (String(cur).indexOf(String(val)) < 0) return false; }
        }
    }
    return true;
}
function descendants(root) {
    const out = [];
    (function walk(node) {
        (node._children || []).forEach(c => { out.push(c); walk(c); });
    })(root);
    return out;
}
function queryAll(root, sel) {
    const res = [];
    String(sel).split(',').map(x => x.trim()).filter(Boolean).forEach(part => {
        const chain = part.split(/\s+/);
        const last = chain[chain.length - 1];
        const anc = chain.slice(0, -1);
        descendants(root).forEach(el => {
            if (!matchSimple(el, last)) return;
            let ok = true, cur = el.parentElement;
            for (let i = anc.length - 1; i >= 0; i--) {
                let found = false;
                while (cur) {
                    if (matchSimple(cur, anc[i])) { found = true; cur = cur.parentElement; break; }
                    cur = cur.parentElement;
                }
                if (!found) { ok = false; break; }
            }
            if (ok && res.indexOf(el) < 0) res.push(el);
        });
    });
    return res;
}
function makeEl(tag, opts) {
    opts = opts || {};
    const e = {
        tagName: String(tag || 'div').toUpperCase(),
        _cls: opts.cls || '',
        _attrs: Object.assign({}, opts.attrs || {}),
        _text: opts.text || '',
        _value: opts.value,
        _children: [],
        parentElement: null,
        checked: !!opts.checked,
        style: {},
        nodeType: 1,
        get innerText() { return this._text; },
        get textContent() { return this._text; },
        // 真实 DOM 里 input.value 是 value 属性的反射；这里照此实现，
        // 否则夹具会把 input[value=字母] 读成空串（原话：属性在 _attrs 里）
        get value() {
            if (this._value !== undefined && this._value !== null) return this._value;
            if (Object.prototype.hasOwnProperty.call(this._attrs, 'value')) return this._attrs.value;
            return '';
        },
        getAttribute(n) { return Object.prototype.hasOwnProperty.call(this._attrs, n) ? this._attrs[n] : null; },
        setAttribute(n, v) { this._attrs[n] = v; },
        removeAttribute(n) { delete this._attrs[n]; },
        appendChild(c) { this._children.push(c); c.parentElement = this; return c; },
        matches(sel) { return matchSimple(this, sel); },
        querySelector(sel) { const r = queryAll(this, sel); return r.length ? r[0] : null; },
        querySelectorAll(sel) { return queryAll(this, sel); },
        getElementsByTagName(t) { return descendants(this).filter(x => x.tagName === String(t).toUpperCase()); },
        click() { this.clicked = (this.clicked || 0) + 1; this.checked = !this.checked; }
    };
    (opts.children || []).forEach(c => e.appendChild(c));
    return e;
}

// ---------------- 真实页面夹具（2026-11-24 取自西安航空学院 形势与政策 2026秋 章节测验）----------------
const FONT_B64 = fs.readFileSync(path.join(root, 'tests', 'fixtures', 'font-cxsecret.b64'), 'utf8').trim();

function buildWorkDom() {
    // 题干：div.TiMu > div.Zy_TItle > div.clearfix.font-cxsecret.fontLabel
    const title = makeEl('div', { cls: 'clearfix font-cxsecret fontLabel', text: '【单选题】蒝栗腐败问题慁慃挑战，（）直抵基层，聚焦民生领域微腐败，切实维护慀慂利愽。' });
    const zyTitle = makeEl('div', { cls: 'Zy_TItle clearfix', children: [makeEl('i', { cls: 'fl', text: '1' }), title] });

    // 选项：ul.Zy_ulTop > li > label>input[name=answer405984393][value=字母] + a.after（选项文字）
    // 注意：超星 randomOptions=true，DOM 顺序被打乱，input.value 才是原始字母
    function opt(value, letter, text) {
        const input = makeEl('input', { attrs: { type: 'radio', name: 'answer405984393', value: value } });
        const label = makeEl('label', { cls: 'fl before', text: letter, children: [input] });
        const after = makeEl('a', { cls: 'fl after', text: text });
        return makeEl('li', { cls: 'font-cxsecret before-after', children: [label, after] });
    }
    const ul = makeEl('ul', { cls: 'Zy_ulTop w-top fl', children: [
        opt('C', 'A', '“猎慉”'),   // 猎狐
        opt('B', 'B', '“打濨”'),   // 打虎
        opt('D', 'C', '“拍慊”'),   // 拍蝇
        opt('A', 'D', '“慆殷慅动”') // 天网行动
    ] });
    const typeInput = makeEl('input', { attrs: { name: 'answertype405984393' }, value: '0' });
    const tiMu = makeEl('div', { cls: 'TiMu singleQuesId', attrs: { data: '405984393' }, children: [zyTitle, makeEl('div', { cls: 'clearfix', children: [ul] }), typeInput] });

    // 页面里的加密字体 @font-face
    const style = makeEl('style', { text: "@font-face{font-family:'font-cxsecret';src:url('data:application/font-ttf;charset=utf-8;base64," + FONT_B64 + "')}" });

    return makeEl('body', { children: [style, tiMu, typeInput] });
}

const doc = makeEl('body', { children: [] });
(function useBody() {
    const b = buildWorkDom();
    doc._children = [];
    (b._children || []).forEach(c => doc.appendChild(c));
})();

const fakeTop = { document: doc, location: { href: '' } };
const fakeWin = { document: doc, top: fakeTop, location: { href: '', pathname: '/mooc-ans/work/doHomeWorkNew' }, scrollBy() { } };

const logs = [];
const sandbox = {
    GM_getValue: () => undefined,
    GM_setValue: () => { },
    GM_xmlhttpRequest: () => { },
    unsafeWindow: fakeWin,
    document: doc
};

const factory = new Function(
    'GM_getValue', 'GM_setValue', 'GM_xmlhttpRequest', 'unsafeWindow', 'document',
    '_d', '_w', '_l', 'aiLog', 'aiAsk', 'ctUrl', 'token',
    cxMod + '\n' + ctBankMod + '\n' + workMod + `
    return { cxDecrypt: cxDecrypt, workAuto: workAuto, ctBank: ctBank, Typr: Typr, md5: md5, tableB64: CX_FONT_TABLE_B64 };`
);
const M = factory(
    sandbox.GM_getValue, sandbox.GM_setValue, sandbox.GM_xmlhttpRequest, sandbox.unsafeWindow, sandbox.document,
    doc, fakeWin, fakeWin.location,
    (msg) => { logs.push(msg); },
    () => { },
    'https://cx.icodef.com/wyn-nb?v=4', ''
);
const CX = M.cxDecrypt;
const WA = M.workAuto;

let pass = 0, fail = 0;
function t(name, actual, expect) {
    const a = JSON.stringify(actual), b = JSON.stringify(expect);
    if (a === b) { pass++; console.log('  [PASS] ' + name); }
    else { fail++; console.log('  [FAIL] ' + name + '\n         期望 ' + b + '\n         实际 ' + a); }
}

console.log('\n=== 1) 内联资产：Typr / md5 / 字形映射表 ===');
t('Typr 已内联', typeof M.Typr, 'object');
t('Typr.U 可用', typeof M.Typr.U.codeToGlyph, 'function');
t('md5 已内联', typeof M.md5, 'function');
t('映射表常量存在', typeof M.tableB64, 'string');
const table = CX.loadTable();
t('映射表条目数', Object.keys(table).length, 20902);
t('抽查 蒝(7b688f1c)', String.fromCharCode(table['7b688f1c']), '面');
t('抽查 栗(8bfebc3b)', String.fromCharCode(table['8bfebc3b']), '对');

console.log('\n=== 2) 字体解密：真实页面的加密字还原 ===');
t('蒝栗腐败问题慁慃挑战', CX.decryptText('蒝栗腐败问题慁慃挑战'), '面对腐败问题严峻挑战');
t('选项文字 猎慉', CX.decryptText('“猎慉”'), '“猎狐”');
t('选项文字 慆殷慅动', CX.decryptText('“慆殷慅动”'), '“天网行动”');
t('明文原样返回', CX.decryptText('ABC abc 123'), 'ABC abc 123');
t('空串', CX.decryptText(''), '');

console.log('\n=== 3) matchPage：页面识别 ===');
t('新版作业页', WA.matchPage('/mooc-ans/work/doHomeWorkNew'), 'work');
t('旧版作业页', WA.matchPage('/work/doHomeWork'), 'work');
t('新版作业页(带尾斜杠)', WA.matchPage('/mooc-ans/work/doHomeWorkNew/'), 'work');
t('mooc2 作业页', WA.matchPage('/mooc2/work/dowork'), 'work');
t('章节页不误判', WA.matchPage('/mooc-ans/mycourse/studentstudy'), '');
t('课程首页不误判', WA.matchPage('/mooc-ans/mycourse/studentcourse'), '');
t('空输入', WA.matchPage(''), '');

console.log('\n=== 4) 收集题目：新版作业页 DOM ===');
const list = WA.collect();
t('识别到题目数', list.length, 1);
if (list.length) {
    const q = list[0];
    t('题型', q.type, '单选题');
    t('题干(已解密, 去题型前缀)', q.question, '面对腐败问题严峻挑战，（）直抵基层，聚焦民生领域微腐败，切实维护群众利益。');
    t('题目 id', q.qid, '405984393');
    t('选项数', q.options.length, 4);
    t('选项文字(已解密)', q.options.map(o => o.text).join('|'), '“猎狐”|“打虎”|“拍蝇”|“天网行动”');
    t('选项字母=原始字母(乱序)', q.options.map(o => o.letter).join(''), 'CBDA');
}

console.log('\n=== 5) 题库答案匹配（按文字打分，兼容选项乱序）===');
const opts = list.length ? list[0].options : [];
t('文字精确匹配', WA.matchOne('打虎', opts), 1);
t('文字带引号匹配', WA.matchOne('“拍蝇”', opts), 2);
t('包含匹配', WA.matchOne('天网行动', opts), 3);
t('不匹配返回 -1', WA.matchOne('完全不存在的选项', opts), -1);
t('字母回退按原始字母', WA.matchOne('C', opts), 0); // 原始字母 C = 猎狐
t('多选 # 分隔', WA.matchAnswer('“猎狐”#“拍蝇”', opts, '多选题'), [0, 2]);
t('多选 混合写法', WA.matchAnswer('打虎#天网行动', opts, '多选题'), [1, 3]);
t('空答案', WA.matchAnswer('', opts, '多选题'), []);
t('无匹配答案', WA.matchAnswer('不存在#也不存在', opts, '多选题'), []);
t('单选只取最高分那一个', WA.matchAnswer('“猎狐”#“拍蝇”', opts, '单选题'), [0]);
t('单选一句话提到多个选项时也只取一个', WA.matchAnswer('“猎狐”或“拍蝇”', opts, '单选题'), [0]);
t('多选按 # 拆开后取并集', WA.matchAnswer('打虎#“拍蝇”', opts, '多选题'), [1, 2]);

console.log('\n=== 6) 勾选选项 ===');
if (list.length) {
    const q = list[0];
    WA.clickOptions(q, [1]);
    t('单选只勾中一个', q.options.map(o => o.input.checked ? 1 : 0).join(''), '0100');
    WA.clickOptions(q, [0, 2]);
    t('单选改选后只剩一个', q.options.map(o => o.input.checked ? 1 : 0).join(''), '0010');
}
const multi = (function () {
    // 造一道多选题：answercheck405984395，值 C/A/B/D
    const mk = (v, l, txt) => {
        const input = makeEl('input', { attrs: { type: 'checkbox', name: 'answercheck405984395', value: v } });
        return makeEl('li', { cls: 'font-cxsecret before-after', children: [makeEl('label', { cls: 'fl before', text: l, children: [input] }), makeEl('a', { cls: 'fl after', text: txt })] });
    };
    const ul = makeEl('ul', { cls: 'Zy_ulTop w-top fl', children: [mk('C', 'A', '自我净化'), mk('A', 'B', '自我完善'), mk('B', 'C', '自我革新'), mk('D', 'D', '自我提高')] });
    const title = makeEl('div', { cls: 'clearfix font-cxsecret fontLabel', text: '【多选题】持续推进（），保持清醒与坚定。' });
    const typeInput = makeEl('input', { attrs: { name: 'answertype405984395' }, value: '1' });
    const tiMu = makeEl('div', { cls: 'TiMu singleQuesId', children: [makeEl('div', { cls: 'Zy_TItle clearfix', children: [title] }), makeEl('div', { cls: 'clearfix', children: [ul] }), typeInput] });
    doc._children = [];
    doc.appendChild(tiMu);
    return WA.collect()[0];
})();
t('多选题被识别', multi && multi.type, '多选题');
if (multi) {
    t('多选题选项文字', multi.options.map(o => o.text).join('|'), '自我净化|自我完善|自我革新|自我提高');
    WA.clickOptions(multi, [0, 1, 2]);
    t('多选勾中三个', multi.options.map(o => o.input.checked ? 1 : 0).join(''), '1110');
    WA.clickOptions(multi, [3]);
    t('多选改选后取消其余', multi.options.map(o => o.input.checked ? 1 : 0).join(''), '0001');
}

console.log('\n---------------------------------------');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) process.exit(1);
