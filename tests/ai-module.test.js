// 临时测试：对 v1.1 AI 模块做隔离单测（fake DOM，不依赖超星页面）
// 运行：node tmp/test-ai-module.test.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const file = path.join(root, 'dist', 'chaoxing-helper.user.js');
const src = fs.readFileSync(file, 'utf8');

const s = src.indexOf('//==================== v1.1 AI 答题模块');
const e = src.indexOf('//==================== AI 答题模块结束');
if (s < 0 || e < 0) throw new Error('未找到 AI 模块标记');
const mod = src.slice(s, e);

// ---- fake DOM ----
function mkLi(idParam, valParam, emLetter, text) {
  return {
    _cls: '',
    getAttribute(n) {
      if (n === 'id-param') return idParam;
      if (n === 'val-param') return valParam;
      if (n === 'class') return this._cls;
      return null;
    },
    getElementsByTagName(t) {
      if (t === 'em') return emLetter ? [{ getAttribute: (n) => (n === 'id-param' ? emLetter : null) }] : [];
      return [];
    },
    get innerText() { return text; },
    click() { this._cls = 'cur'; this.clicked = (this.clicked || 0) + 1; }
  };
}
const liList = [
  mkLi('1', null, 'A', 'A. 人民代表大会制度'),
  mkLi('1', null, 'B', 'B. 人民代表大会大会'),
  mkLi('1', null, 'C', 'C. 政协会议'),
  mkLi('2', 'true', 'true', '正确'),
  mkLi('2', 'false', 'false', '错误')
];
const fakeDoc = {
  getElementsByTagName: (t) => (t === 'li' ? liList : []),
  getElementById: () => null
};
const fakeTop = { document: fakeDoc, location: { href: '' } };

let stored = {};
const sandbox = {
  GM_getValue: (k, d) => (k in stored ? stored[k] : d),
  GM_setValue: (k, v) => { stored[k] = v; },
  GM_xmlhttpRequest: () => {},
  unsafeWindow: { document: fakeDoc, top: fakeTop, location: { href: '' } },
  document: fakeDoc,
  aiEnable: 1, aiBaseUrl: '', aiModel: '', aiKey: '', aiTimeout: 60000,
  ctFailLimit: 3, ctFailCooldown: 600000, ctFallbackEnable: 0,
  questionNum: 5
};

const factory = new Function(
  'GM_getValue', 'GM_setValue', 'GM_xmlhttpRequest', 'unsafeWindow', 'document',
  '_d', '_w', 'aiEnable', 'aiBaseUrl', 'aiModel', 'aiKey', 'aiTimeout',
  'ctFailLimit', 'ctFailCooldown', 'ctFallbackEnable', 'questionNum',
  'randomDo', 'accuracy',
  mod + `
  return { parseAnswerIndex, collectOptions, applyByIndex, randomFallback, ctFail, ctDisabled, ctSuccess, aiState, cxDecrypt, getQ: () => questionNum };`
);
const M = factory(
  sandbox.GM_getValue, sandbox.GM_setValue, sandbox.GM_xmlhttpRequest, sandbox.unsafeWindow, sandbox.document,
  fakeDoc, sandbox.unsafeWindow,
  1, '', '', '', 60000, 3, 600000, 0, 5, 1, 80
);

let pass = 0, fail = 0;
function t(name, actual, expect) {
  const a = JSON.stringify(actual), b = JSON.stringify(expect);
  if (a === b) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + '\n         期望 ' + b + '\n         实际 ' + a); }
}

console.log('\n=== 1) parseAnswerIndex：解析 AI 返回的选项序号 ===');
t('标准 JSON', M.parseAnswerIndex('{"answers":[2],"confidence":0.9}', 4), [2]);
t('markdown 代码块包裹', M.parseAnswerIndex('```json\n{"answers":[1,3]}\n```', 4), [1, 3]);
t('单引号JSON容错(退化为数组匹配)', M.parseAnswerIndex("'answers': [4]", 4), [4]);
t('带解释文字的JSON', M.parseAnswerIndex('分析如下：{"answers":[3],"confidence":0.8} 完毕', 4), [3]);
t('序号越界被过滤', M.parseAnswerIndex('{"answers":[9]}', 4), []);
t('负数被过滤', M.parseAnswerIndex('{"answers":[-1]}', 4), []);
t('去重', M.parseAnswerIndex('{"answers":[2,2,2]}', 4), [2]);
t('空输入', M.parseAnswerIndex('', 4), []);
t('非JSON纯文本', M.parseAnswerIndex('我认为答案是B', 4), []);

console.log('\n=== 2) collectOptions：按 DOM 顺序收集本题选项 ===');
const q1 = { questionid: 'answer1', type: '单选题', question: 'Q1' };
const q2 = { questionid: 'answer2', type: '判断题', question: 'Q2' };
const o1 = M.collectOptions(q1);
t('单选题选项数', o1.length, 3);
t('单选题第一项文字', o1[0].text, 'A. 人民代表大会制度');
t('单选题第一项字母', o1[0].letter, 'A');
t('单选题不含别题选项', o1.every(o => o.li.getAttribute('id-param') === '1'), true);
const o2 = M.collectOptions(q2);
t('判断题选项数', o2.length, 2);
t('判断题 val-param true', o2[0].val, 'true');
t('判断题 val-param false', o2[1].val, 'false');

console.log('\n=== 3) applyByIndex：按下标点击 ===');
liList.forEach(li => { li._cls = ''; li.clicked = 0; });
const ok = M.applyByIndex(q1, [2]);
t('点击成功返回true', ok, true);
t('目标选项被点击', liList[1].clicked, 1);
t('非目标选项未被点击', liList[0].clicked + liList[2].clicked, 0);
t('选中态 class 含 cur', liList[1].getAttribute('class').includes('cur'), true);
t('越界序号不误点', M.applyByIndex(q1, [99]), false);

console.log('\n=== 4) 题库熔断状态机 ===');
t('初始未熔断', M.ctDisabled(), false);
M.ctFail('未收录');
t('失败1次不熔断', M.ctDisabled(), false);
M.ctFail('未收录');
t('失败2次不熔断', M.ctDisabled(), false);
M.ctFail('未收录');
t('失败3次熔断', M.ctDisabled(), true);
M.ctSuccess();
t('成功后计数清零但仍在熔断窗口', M.ctDisabled(), true);

console.log('\n=== 5) randomFallback 随机兜底 ===');
liList.forEach(li => { li._cls = ''; li.clicked = 0; });
M.randomFallback(q1);
t('单选兜底选第2项', liList[1].clicked, 1);
liList.forEach(li => { li._cls = ''; li.clicked = 0; });
M.randomFallback(q2);
t('判断题兜底选最后一项(错)', liList[4].clicked, 1);

console.log('\n=== 6) AI 未配置时的行为 ===');
t('aiState.enable 默认开', M.aiState.enable, true);
t('aiState.baseUrl 默认空', M.aiState.baseUrl, '');
t('aiState.key 默认空(不存明文密钥)', M.aiState.key, '');

console.log('\n=== 7) v1.2 字体解密：字符映射替换 ===');
const map = { '囗': '中', '龘': '文', '測': '试' };
t('单字替换', M.cxDecrypt.applyMapToText('囗龘測', map), '中文试');
t('未映射字符原样保留', M.cxDecrypt.applyMapToText('abc囗123', map), 'abc中123');
t('空映射返回原文', M.cxDecrypt.applyMapToText('原文', null), '原文');
t('空文本返回空', M.cxDecrypt.applyMapToText('', map), '');
t('默认字符映射为空(未解密时不影响题干)', M.cxDecrypt.getCharMap(), null);
t('解密未启用时安全返回(无字体页面)', M.cxDecrypt.decrypt(0), false);

console.log('\n=== 8) AI 输出上限 max_tokens：推理型模型(MiniMax等)思考token计入上限，过小会返回空内容 ===');
const allMt = (src.match(/'max_tokens'\s*:\s*(\d+)/g) || []).map(x => parseInt(x.replace(/\D+/g, ''), 10));
t('脚本内存在 max_tokens 配置', allMt.length >= 3, true);
t('没有任何小于 512 的输出上限(会被思考token吃光)', allMt.every(n => n >= 512), true);
t('AI 作答请求上限为 8000', allMt.includes(8000), true);
t('空内容报错带 finish_reason 便于定位', src.includes('finish_reason='), true);
t('推理型模型降思考深度(reasoning_effort)', src.includes("reasoning_effort"), true);
t('只在 minimax 端点下发 reasoning_effort', /\/minimax\/i\.test\(aiState\.baseUrl\)/.test(src), true);

console.log('\n----------------------------------------');
console.log(`结果: 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
