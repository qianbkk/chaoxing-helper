// v1.3 附加模块隔离单测（fake DOM，不依赖超星页面）
// 运行：node tests/extras-module.test.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const file = path.join(root, 'dist', 'chaoxing-helper.user.js');
const src = fs.readFileSync(file, 'utf8');

// AI 模块 + v1.3 附加模块都在这段区间内
const s = src.indexOf('//==================== v1.1 AI 答题模块');
const e = src.indexOf('//==================== AI 答题模块结束');
if (s < 0 || e < 0) throw new Error('未找到模块标记');
const mod = src.slice(s, e);

// v1.11.3：考试端的查题与答案匹配都走「多源免费题库」模块
const cbS = src.indexOf('//==================== v1.11.3 多源免费题库开始 ====================');
const cbE = src.indexOf('//==================== v1.11.3 多源免费题库结束 ====================');
if (cbS < 0 || cbE < 0) throw new Error('未找到题库模块标记');
const ctBankMod = src.slice(cbS, cbE);

// ---------------- 极简 fake DOM（支持 tag/.class/#id/[attr] / [attr=v] / [attr^=v] 与后代链） ----------------
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
    get value() { return this._value; },
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this._attrs, n) ? this._attrs[n] : null; },
    setAttribute(n, v) { this._attrs[n] = v; },
    removeAttribute(n) { delete this._attrs[n]; },
    appendChild(c) { this._children.push(c); c.parentElement = this; return c; },
    matches(sel) { return matchSimple(this, sel); },
    querySelector(sel) { const r = queryAll(this, sel); return r.length ? r[0] : null; },
    querySelectorAll(sel) { return queryAll(this, sel); },
    getElementsByTagName(t) {
      return descendants(this).filter(x => x.tagName === String(t).toUpperCase());
    },
    click() { this.clicked = (this.clicked || 0) + 1; this.checked = !this.checked; },
    scrollIntoView() { this.scrolled = (this.scrolled || 0) + 1; }
  };
  (opts.children || []).forEach(c => e.appendChild(c));
  return e;
}

// ---------------- 页面夹具 ----------------
function buildOldExamDom() {
  // 旧版考试：.TiMu > .Cy_TItle > .clearfix(题干)，.Cy_ulTop > li > label + input[type=radio]
  const q = makeEl('div', { cls: 'Cy_TItle', children: [makeEl('div', { cls: 'clearfix', text: '下列关于人民代表大会制度的说法正确的是' })] });
  const optA = makeEl('li', { text: 'A. 人民代表大会制度是根本政治制度', children: [makeEl('input', { attrs: { type: 'radio', name: 'answer1', value: 'A' } })] });
  const optB = makeEl('li', { text: 'B. 人民代表大会大会是最高国家权力机关', children: [makeEl('input', { attrs: { type: 'radio', name: 'answer1', value: 'B' } })] });
  const ul = makeEl('div', { cls: 'Cy_ulTop', children: [optA, optB] });
  const tiMu = makeEl('div', { cls: 'TiMu', children: [q, ul] });
  const typeInput = makeEl('input', { attrs: { name: 'type1' }, value: '0' });
  return makeEl('body', { children: [tiMu, typeInput] });
}

function buildNewExamDom() {
  // 新版考试：.questionLi > h3 > div(题干)，.answerBg 内含 radio
  const q = makeEl('h3', { children: [makeEl('div', { text: '中国的根本政治制度是' })] });
  const a1 = makeEl('div', { cls: 'answerBg', children: [makeEl('input', { attrs: { type: 'radio', name: 'q1' } })] });
  const a2 = makeEl('div', { cls: 'answerBg', children: [makeEl('input', { attrs: { type: 'checkbox', name: 'q1' } })] });
  const li = makeEl('div', { cls: 'questionLi', children: [q, a1, a2] });
  const typeInput = makeEl('input', { attrs: { name: 'type0' }, value: '1' });
  return makeEl('body', { children: [li, typeInput] });
}

// ---------------- 页面夹具 ----------------
// 共享同一个 body 根节点：模块里的 _d 在工厂创建时就绑定了，必须始终指向同一个对象
const doc = makeEl('body', { children: [] });
function useBody(bodyEl) {
  doc._children = [];
  (bodyEl._children || []).forEach(c => doc.appendChild(c));
}
useBody(buildOldExamDom());
const fakeTop = { document: doc, location: { href: '' } };
const fakeWin = { document: doc, top: fakeTop, location: { href: '', pathname: '/' }, scrollBy() { } };

let stored = {};
let lastReq = null;
const reqs = [];
const sandbox = {
  GM_getValue: (k, d) => (k in stored ? stored[k] : d),
  GM_setValue: (k, v) => { stored[k] = v; },
  GM_xmlhttpRequest: (opt) => { reqs.push(opt); lastReq = opt; },
  unsafeWindow: fakeWin,
  document: doc
};

const factory = new Function(
  'GM_getValue', 'GM_setValue', 'GM_xmlhttpRequest', 'unsafeWindow', 'document',
  '_d', '_w', 'aiEnable', 'aiBaseUrl', 'aiModel', 'aiKey', 'aiTimeout',
  'ctFailLimit', 'ctFailCooldown', 'ctFallbackEnable', 'questionNum',
  'randomDo', 'accuracy', 'ctUrl', 'token',
  ctBankMod + '\n' + mod + `
  return { extras, parseAnswerIndex, aiState, ctBank };`
);
const M = factory(
  sandbox.GM_getValue, sandbox.GM_setValue, sandbox.GM_xmlhttpRequest, sandbox.unsafeWindow, sandbox.document,
  doc, fakeWin,
  1, '', '', '', 60000, 3, 600000, 0, 5, 1, 80, 'https://cx.icodef.com/wyn-nb?v=4', ''
);
const X = M.extras;

let pass = 0, fail = 0;
function t(name, actual, expect) {
  const a = JSON.stringify(actual), b = JSON.stringify(expect);
  if (a === b) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + '\n         期望 ' + b + '\n         实际 ' + a); }
}

console.log('\n=== 1) matchExamPage：考试/作业页面识别 ===');
t('旧版考试', X.matchExamPage('/exam/test/reVersionTestStartNew', 'https://mooc1-1.chaoxing.com/exam/test/reVersionTestStartNew'), 'examOld');
t('旧版考试(带newMooc→新版)', X.matchExamPage('/exam/test/reVersionTestStartNew', 'https://x/exam/test/reVersionTestStartNew?newMooc=true'), 'examNew');
t('exam-ans 旧版考试', X.matchExamPage('/exam-ans/exam/test/reVersionTestStartNew', 'https://x/exam-ans/exam/test/reVersionTestStartNew'), 'examOld');
t('mooc-ans 新版考试', X.matchExamPage('/mooc-ans/exam/test/reVersionTestStartNew', 'https://x/mooc-ans/exam/test/reVersionTestStartNew?newMooc=true'), 'examNew');
t('新版考试 preview', X.matchExamPage('/mooc2/exam/preview', 'https://x/mooc2/exam/preview'), 'examNew');
t('新版作业', X.matchExamPage('/mooc2/work/dowork', 'https://x/mooc2/work/dowork'), 'workNew');
t('mooc-ans 新版作业', X.matchExamPage('/mooc-ans/mooc2/work/dowork', 'https://x/mooc-ans/mooc2/work/dowork'), 'workNew');
t('旧版作业', X.matchExamPage('/work/doHomeWorkNew', 'https://x/work/doHomeWorkNew'), 'workOld');
t('mooc-ans 旧版作业', X.matchExamPage('/mooc-ans/work/doHomeWorkNew', 'https://x/mooc-ans/work/doHomeWorkNew'), 'workOld');
t('学习页不误判', X.matchExamPage('/mycourse/studentstudy', 'https://x/mycourse/studentstudy'), '');
t('空输入', X.matchExamPage('', ''), '');

console.log('\n=== 2) examProfile：各页面 DOM 规则 ===');
t('旧版考试 root', X.examProfile('examOld').root, '.TiMu');
t('旧版考试 题干选择器', X.examProfile('examOld').question, '.Cy_TItle .clearfix');
t('新版考试 root', X.examProfile('examNew').root, '.questionLi');
t('新版作业 root', X.examProfile('workNew').root, '.questionLi');
t('旧版作业 root', X.examProfile('workOld').root, '.clearfix .TiMu');
t('未知类型返回 null', X.examProfile('nope'), null);

console.log('\n=== 3) normText / matchAnswerText：题库答案文字匹配 ===');
t('去掉选项字母与空格', X.normText('A. 人民代表大会制度'), '人民代表大会制度');
t('去掉首尾空白', X.normText('  正确  '), '正确');
t('空串', X.normText(''), '');
t('全等匹配', X.matchAnswerText('人民代表大会制度', [{ text: 'A. 人民代表大会制度' }, { text: 'B. 政协' }]), [0]);
t('判断题正确', X.matchAnswerText('正确', [{ text: '正确' }, { text: '错误' }]), [0]);
t('判断题错误', X.matchAnswerText('错误', [{ text: '正确' }, { text: '错误' }]), [1]);
t('无匹配返回空', X.matchAnswerText('完全不存在的答案', [{ text: 'A' }, { text: 'B' }]), []);
t('空答案返回空', X.matchAnswerText('', [{ text: 'A' }]), []);

console.log('\n=== 4) collectExamQuestions：旧版考试页题目收集 ===');
let qs = X.collectExamQuestions('examOld');
t('识别到 1 道题', qs.length, 1);
t('题干', qs[0].question, '下列关于人民代表大会制度的说法正确的是');
t('题型（全局 type 输入框）', qs[0].type, '单选题');
t('选项数', qs[0].options.length, 2);
t('选项1文字', qs[0].options[0].text, 'A. 人民代表大会制度是根本政治制度');
t('选项2文字', qs[0].options[1].text, 'B. 人民代表大会大会是最高国家权力机关');

console.log('\n=== 5) collectExamQuestions：新版考试页题目收集 ===');
useBody(buildNewExamDom());
qs = X.collectExamQuestions('examNew');
t('识别到 1 道题', qs.length, 1);
t('题干', qs[0].question, '中国的根本政治制度是');
t('题型（多选）', qs[0].type, '多选题');
t('选项数', qs[0].options.length, 2);

console.log('\n=== 6) applyExamAnswer：勾选行为 ===');
useBody(buildOldExamDom());
qs = X.collectExamQuestions('examOld');
let ok = X.applyExamAnswer(qs[0], [1]);
t('单选：返回成功', ok, true);
t('单选：只点了目标项', qs[0].options[1].input.clicked, 1);
t('单选：没点其它项', qs[0].options[0].input.clicked || 0, 0);
// 多选：取消没选中的
useBody(buildNewExamDom());
qs = X.collectExamQuestions('examNew');
qs[0].options[0].input.checked = true; // 模拟原本已勾选
X.applyExamAnswer(qs[0], [1]);
t('多选：目标项被勾选', qs[0].options[1].input.checked, true);
t('多选：未选项被取消', qs[0].options[0].input.checked, false);

console.log('\n=== 7) matchTaskPage：任务页识别 ===');
t('阅读正文页', X.matchTaskPage('https://mooc1-1.chaoxing.com/ztnodedetailcontroller/visitnodedetail?courseId=1', ''), 'reading');
t('阅读任务目录页', X.matchTaskPage('https://mooc1-1.chaoxing.com/mooc-ans/zt/portal/xxx', ''), 'readingCatalog');
t('课程 html 页', X.matchTaskPage('https://mooc1-1.chaoxing.com/course/12345.html', ''), 'readingCatalog');
t('自定义关键词命中', X.matchTaskPage('https://x/live/room/1', 'live,ztactivity'), 'custom');
t('关键词不命中', X.matchTaskPage('https://x/mycourse/studentstudy', 'live,ztactivity'), '');
t('无关键词', X.matchTaskPage('https://x/mycourse/studentstudy', ''), '');

console.log('\n=== 8) paste：解除元素限制 ===');
const inp = makeEl('input', { attrs: { onpaste: 'return false', readonly: 'readonly' } });
X.paste.removeElementRestrictions(inp);
t('onpaste 属性被移除', inp.getAttribute('onpaste'), null);
t('readonly 被移除', inp.getAttribute('readonly'), null);
t('user-select 恢复为 text', inp.style.userSelect, 'text');

console.log('\n=== 9) ctAsk：多源免费题库（v1.11.3）===');
// 测试里不等节流、不吃缓存，方便断言请求本身
M.ctBank.MIN_INTERVAL = 0;
M.ctBank.cacheClear();
function flushReqs(payload) {
    let guard = 0;
    while (guard++ < 20) {
        const pend = reqs.filter(r => !r.__flushed);
        if (!pend.length) break;
        pend.forEach(r => { r.__flushed = true; try { if (r.onload) r.onload(payload); } catch (e) { } });
    }
}
let cbResult = 'NOTCALLED';
reqs.length = 0;
X.ctAsk('人民代表大会制度', '单选题', (v) => { cbResult = v; });
const icodefReq = reqs.find(r => String(r.url).indexOf('icodef') >= 0);
const baiduReq = reqs.find(r => String(r.url).indexOf('easylearn') >= 0);
t('主源里有 icodef', !!icodefReq, true);
t('icodef 指向 cx.icodef.com', icodefReq && icodefReq.url, 'https://cx.icodef.com/wyn-nb?v=4');
t('icodef 请求带 type=0', icodefReq && /type=0/.test(icodefReq.data), true);
t('主源里有百度不挂科（零密钥）', !!baiduReq, true);
t('百度请求是 GET', baiduReq && baiduReq.method, 'GET');
t('百度请求带题干', baiduReq && /query=/.test(baiduReq.url), true);
t('主源命中即回调答案', (icodefReq.onload({ responseText: JSON.stringify({ code: 1, data: '人民代表大会制度' }) }), cbResult), '人民代表大会制度');

console.log('\n=== 9b) 全部未收录 → 不给答案（交给 AI）===');
cbResult = 'NOTCALLED';
reqs.length = 0;
M.ctBank.cacheClear();
X.ctAsk('题库里没有的题', '单选题', (v) => { cbResult = v; });
flushReqs({ responseText: JSON.stringify({ code: -1, data: '未搜索到答案' }) });
t('全部源未收录返回 null', cbResult, null);

console.log('\n=== 9c) 流控(-2) 会退避重试，不直接放弃===');
cbResult = 'NOTCALLED';
reqs.length = 0;
M.ctBank.cacheClear();
X.ctAsk('被限流的题', '单选题', (v) => { cbResult = v; });
const icodef2 = reqs.find(r => String(r.url).indexOf('icodef') >= 0);
t('icodef 主源已发出', !!icodef2, true);
t('流控先不算失败（退避重试中）', cbResult, 'NOTCALLED');
t('未收录不计入熔断计数', M.ctBank._failStreak, 0);

console.log('\n=== 10) 默认开关状态（未开启即不生效） ===');
t('复制粘贴默认关闭', X.cfg.paste, false);
t('考试端默认关闭', X.cfg.exam, false);
t('任务页保活默认关闭', X.cfg.keep, false);

console.log('\n========================================');
console.log(`结果：${pass} 通过，${fail} 失败`);
console.log('========================================');
process.exit(fail > 0 ? 1 : 0);
