// 探针：实测百度不挂科（easylearn）题库接口 + XOR 解密
// 用法：node src/tools/probe-baidu.cjs "题干1" "题干2" ...
// 说明：本脚本是 v1.11.3 引入该题库源时的调研留档，发布件不依赖它。
//       设 RAW=1 可打印解密后的完整 JSON。
const https = require('https');
const http = require('http');
const querystring = require('querystring');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

function get(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method: 'GET', headers: { 'User-Agent': UA, 'Accept': 'application/json, text/plain, */*' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

// ==== 与 tikuAdapter internal/search/buguake.go 的 decrypt() 逐字等价 ====
function decrypt(b64, actk) {
  const key = '34cab29ef956d78afd' + (actk || '');
  const t = Buffer.from(b64, 'base64');
  const i = Buffer.alloc(t.length);
  let o = 0;
  for (let c = 0; c < t.length; c++) {
    o = o % key.length;
    i[c] = t[c] ^ key.charCodeAt(o);
    o++;
  }
  // 成对异或：Go 里 for p:=0; p<len(i)-1; p++ { d := i[p]^i[p+1]; l += rune(d); p++ }
  let l = '';
  for (let p = 0; p < i.length - 1; p++) {
    l += String.fromCharCode(i[p] ^ i[p + 1]);
    p++;
  }
  try { l = decodeURIComponent(l.replace(/\+/g, ' ')); } catch (e) { l = l.replace(/\+/g, ' '); }
  return l;
}

// Dice 系数相似度（对应 Go antlabs/strsim.Compare 的口径）
function similarity(a, b) {
  const s1 = String(a || '').replace(/\s+/g, '');
  const s2 = String(b || '').replace(/\s+/g, '');
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  const bigrams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.substr(i, 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const A = bigrams(s1), B = bigrams(s2);
  let inter = 0, total = 0;
  A.forEach((v, k) => { total += v; inter += Math.min(v, B.get(k) || 0); });
  B.forEach((v) => { total += v; });
  return (2 * inter) / total;
}

// 从解密后的 JSON 里提取题干 / 选项(yes) / 答案
function parseDecrypted(dec, query) {
  let obj;
  try { obj = JSON.parse(dec); } catch (e) { return { err: 'JSON 解析失败: ' + e.message + ' | 原文前80: ' + dec.slice(0, 80) }; }
  const stem = (((obj.que_stem || [])[0] || {}).c || []).map((x) => x.c).join('');
  const opts = (obj.que_options || []).map((o) => ({
    yes: !!o.yes,
    text: (((o.ret || [])[0] || {}).c || []).map((x) => x.c).join(''),
  }));
  const ansObj = (obj.que_answer || [])[0];
  const answers = [];
  if (ansObj && Array.isArray(ansObj.c)) ansObj.c.forEach((x) => answers.push(x.c));
  return { stem, opts, answers, sim: similarity(query, stem), raw: obj };
}

(async () => {
  const queries = process.argv.slice(2);
  if (!queries.length) { console.log('用法: node src/tools/probe-baidu.cjs "题干1" "题干2" ...'); return; }
  for (const q of queries) {
    console.log('\n================ 题干: ' + q + ' ================');
    const url = 'https://easylearn.baidu.com/edu-web-go/bgk/searchlist?' + querystring.stringify({ query: q, rn: 10, pn: 0 });
    let res;
    try { res = await get(url); } catch (e) { console.log('请求失败:', e.message); continue; }
    console.log('HTTP', res.status, 'len=', res.body.length);
    let json;
    try { json = JSON.parse(res.body); } catch (e) { console.log('外层 JSON 解析失败:', e.message, res.body.slice(0, 200)); continue; }
    const list = (json.data && json.data.list) || [];
    console.log('候选条数:', list.length);
    let picked = 0;
    list.forEach((it, idx) => {
      const dec = decrypt(it.bdjson || '', it.actk || '');
      const p = parseDecrypted(dec, q);
      if (p.err) { console.log(`  #${idx} 解密/解析失败: ${p.err}`); return; }
      const yes = p.opts.filter((o) => o.yes).map((o) => o.text);
      if (process.env.RAW === '1') {
        console.log(`  #${idx} sim=${p.sim.toFixed(3)} RAW=` + JSON.stringify(p.raw).slice(0, 1600));
      } else {
        console.log(`  #${idx} sim=${p.sim.toFixed(3)} 题干=[${p.stem.slice(0, 40)}]`);
        console.log(`       选项(${p.opts.length}): ${JSON.stringify(p.opts.map((o) => o.text.slice(0, 24)))}`);
        console.log(`       yes=true: ${JSON.stringify(yes)}  que_answer: ${JSON.stringify(p.answers)}`);
      }
      if (p.sim >= 0.8 && (yes.length || p.answers.length)) picked++;
    });
    console.log('→ 可用候选数(sim>=0.8 且有答案):', picked);
  }
})();
