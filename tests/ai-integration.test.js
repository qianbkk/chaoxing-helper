// 端到端集成测试：本地 mock 一个 OpenAI 兼容服务，验证 AI 答题链路的请求格式与响应解析
// 运行：node tests/ai-integration.test.js
const fs = require('fs');
const path = require('path');
const http = require('http');

const root = path.join(__dirname, '..');
const file = path.join(root, 'dist', 'chaoxing-helper.user.js');
const src = fs.readFileSync(file, 'utf8');

const s = src.indexOf('//==================== v1.1 AI 答题模块');
const e = src.indexOf('//==================== AI 答题模块结束');
const mod = src.slice(s, e);

// ---------- fake 超星答题页 DOM ----------
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
  mkLi('1', null, 'B', 'B. 村民委员会'),
  mkLi('1', null, 'C', 'C. 居民委员会')
];
const fakeDoc = { getElementsByTagName: (t) => (t === 'li' ? liList : []), getElementById: () => null };

// ---------- mock OpenAI 兼容服务 ----------
let received = null;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    received = { method: req.method, url: req.url, headers: req.headers, body: JSON.parse(body || '{}') };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-test', object: 'chat.completion', model: received.body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: '{"answers":[2],"confidence":0.95}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
    }));
  });
});

let port = 0;
let pass = 0, fail = 0;
function t(name, actual, expect) {
  const a = JSON.stringify(actual), b = JSON.stringify(expect);
  if (a === b) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + '\n         期望 ' + b + '\n         实际 ' + a); }
}

server.listen(0, '127.0.0.1', async () => {
  port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/v1`;

  // GM_xmlhttpRequest 用 fetch 实现
  const gmRequest = (o) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeout || 30000);
    fetch(o.url, {
      method: o.method || 'GET',
      headers: o.headers || {},
      body: o.data,
      signal: ctrl.signal
    }).then(async (r) => {
      clearTimeout(timer);
      const text = await r.text();
      if (o.onload) o.onload({ status: r.status, responseText: text, finalUrl: o.url });
    }).catch((err) => {
      clearTimeout(timer);
      if (err.name === 'AbortError') { if (o.ontimeout) o.ontimeout(err); }
      else if (o.onerror) o.onerror(err);
    });
  };

  const factory = new Function(
    'GM_getValue', 'GM_setValue', 'GM_xmlhttpRequest', 'unsafeWindow', 'document',
    '_d', '_w', 'aiEnable', 'aiBaseUrl', 'aiModel', 'aiKey', 'aiTimeout',
    'ctFailLimit', 'ctFailCooldown', 'ctFallbackEnable', 'questionNum', 'randomDo', 'accuracy',
    mod + `
    return { aiAsk, applyByIndex, aiState, collectOptions };`
  );
  const M = factory(
    (k, d) => d, () => {}, gmRequest, { document: fakeDoc, top: { document: fakeDoc } }, fakeDoc,
    fakeDoc, { document: fakeDoc, top: { document: fakeDoc } },
    1, baseUrl, 'test-model', 'sk-test-123', 30000, 3, 600000, 0, 3, 1, 80
  );

  console.log('\n=== 端到端：脚本 → OpenAI兼容mock → 点击选项 ===');
  const qu = { questionid: 'answer1', type: '单选题', question: '我国的根本政治制度是什么？' };

  const idxs = await new Promise((resolve) => {
    M.aiAsk(qu, (idx, err) => resolve({ idx, err }));
  });

  console.log('\n--- 服务端收到的请求 ---');
  console.log('  ' + received.method + ' ' + received.url);
  console.log('  Authorization: ' + received.headers['authorization']);
  console.log('  Content-Type: ' + received.headers['content-type']);
  console.log('  model: ' + received.body.model);
  console.log('  system: ' + received.body.messages[0].content.slice(0, 60) + '…');
  console.log('  user:\n    ' + received.body.messages[1].content.split('\n').join('\n    '));
  console.log('---------------------------\n');

  t('请求路径为 baseUrl + /chat/completions', received.url, '/v1/chat/completions');
  t('请求方法 POST', received.method, 'POST');
  t('Authorization 为 Bearer 形式', received.headers['authorization'], 'Bearer sk-test-123');
  t('Content-Type 为 application/json', received.headers['content-type'], 'application/json');
  t('模型名正确', received.body.model, 'test-model');
  t('temperature 为 0', received.body.temperature, 0);
  t('system 提示要求只输出JSON', received.body.messages[0].content.includes('JSON'), true);
  t('user 消息含题干', received.body.messages[1].content.includes('我国的根本政治制度是什么？'), true);
  t('user 消息含选项序号', received.body.messages[1].content.includes('1. 人民代表大会制度'), true);
  t('选项已剥离字母前缀(只用序号,不让模型回字母)', received.body.messages[1].content.includes('1. A.'), false);
  t('解析出的选项序号', idxs.idx, [2]);

  // 点击验证
  liList.forEach(li => { li._cls = ''; li.clicked = 0; });
  const ok = M.applyByIndex(qu, idxs.idx);
  t('点击成功', ok, true);
  t('点击的是第2个选项(B)', liList[1].clicked, 1);
  t('其他选项未被点击', liList[0].clicked + liList[2].clicked, 0);

  server.close();
  console.log('\n----------------------------------------');
  console.log(`结果: 通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail === 0 ? 0 : 1);
});
