// =============================================================================
// probe-ctbank.cjs —— 题库链路端到端探针（维护者自用）
//
// 直接加载 **dist 发布件里** 的「多源免费题库」模块去打**真实接口**，
// 不改一行发布件代码 —— 验证的是真要发出去的那份。
//
// 用法：
//   node src\tools\probe-ctbank.cjs                # 三个源都开（主源并行 + 备用源兜底）
//   $env:ONLY='baidu'; node src\tools\probe-ctbank.cjs    # 只留百度不挂科
//   $env:ONLY='icodef'; node src\tools\probe-ctbank.cjs  # 只留 icodef 主源
//
// 内网/墙外访问需要代理时，先设：
//   $env:HTTPS_PROXY='http://127.0.0.1:7897'; $env:HTTP_PROXY='http://127.0.0.1:7897'
//
// 说明：百度源解密算法来自 MIT 协议的 DokiDoki1103/tikuAdapter（internal/search/buguake.go）。
// =============================================================================
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const root = path.join(__dirname, '..', '..');
const src = fs.readFileSync(path.join(root, 'dist', 'chaoxing-helper.user.js'), 'utf8');
const s = src.indexOf('//==================== v1.11.3 多源免费题库开始 ====================');
const e = src.indexOf('//==================== v1.11.3 多源免费题库结束 ====================');
if (s < 0 || e < 0) throw new Error('未找到题库模块');
const mod = src.slice(s, e);

const stored = {};
const GM_getValue = (k, d) => (k in stored ? stored[k] : d);
const GM_setValue = (k, v) => { stored[k] = v; };
function GM_xmlhttpRequest(opt) {
    const u = new URL(opt.url);
    const lib = u.protocol === 'https:' ? https : http;
    const body = opt.data ? Buffer.from(opt.data, 'utf8') : null;
    const req = lib.request(u, {
        method: opt.method || 'GET',
        headers: Object.assign({ 'User-Agent': 'Mozilla/5.0' }, opt.headers || {})
    }, (res) => {
        const c = [];
        res.on('data', d => c.push(d));
        res.on('end', () => {
            const text = Buffer.concat(c).toString('utf8');
            if (opt.onload) opt.onload({ status: res.statusCode, responseText: text });
        });
    });
    req.on('error', (err) => { if (opt.onerror) opt.onerror(err); });
    req.setTimeout(opt.timeout || 8000, () => { req.destroy(new Error('timeout')); if (opt.ontimeout) opt.ontimeout({}); });
    if (body) req.write(body);
    req.end();
}

const ctBank = new Function('GM_getValue', 'GM_setValue', 'GM_xmlhttpRequest', 'token', mod + '\nreturn ctBank;')(
    GM_getValue, GM_setValue, GM_xmlhttpRequest, ''
);
ctBank.MIN_INTERVAL = 2000;   // 保持与线上一致（icodef 实测 <1.5s 会限流）
// ONLY=baidu / ONLY=icodef：只留某一个源，单独验证这条链路
if (process.env.ONLY) {
    const keep = process.env.ONLY;
    ctBank.SOURCES = ctBank.SOURCES.filter(s => s.kind === keep || (keep === 'icodef' && s.id === 'icodef-cx'));
    ctBank.SOURCES.forEach(s => { s.primary = true; });
}

const CASES = [
    {
        q: '我国的根本政治制度是', type: '单选题',
        options: ['人民代表大会制度', '政治协商制度', '民族区域自治制度', '基层群众自治制度'],
        expect: 0
    },
    {
        q: '中国共产党第一次全国代表大会召开的时间是', type: '单选题',
        options: ['1921年', '1922年', '1919年', '1920年'],
        expect: 0
    },
    {
        q: '新民主主义革命的总路线是', type: '单选题',
        options: ['无产阶级领导的，人民大众的，反对帝国主义、封建主义和官僚资本主义的革命', '推翻三座大山，建立社会主义', '建设有中国特色社会主义', '实现共产主义'],
        expect: 0
    },
    {
        q: '我国的基本经济制度是公有制为主体、多种所有制经济共同发展', type: '判断题',
        options: ['正确', '错误'],
        expect: 0
    },
    {
        q: '马克思主义哲学的直接理论来源是', type: '单选题',
        options: ['德国古典哲学、英国古典政治经济学和英法空想社会主义', '古希腊哲学', '德国古典哲学', '古希腊朴素唯物主义'],
        expect: 0
    }
];

function ask(q, type) {
    return new Promise((resolve) => {
        ctBank.ask(q, type, (r) => resolve(r));
    });
}

(async () => {
    console.log('=== 真实接口端到端（发布件里的模块，未改一行）===');
    let ok = 0, bad = 0;
    for (const c of CASES) {
        const t0 = Date.now();
        const r = await ask(c.q, c.type);
        const ms = Date.now() - t0;
        if (!r || !r.ok) {
            console.log(`\n[未命中] ${c.q}\n         reason=${r && r.reason}  用时 ${ms}ms`);
            bad++;
            continue;
        }
        const opts = c.options.map((text, i) => ({ letter: 'ABCDEFGH'[i], text }));
        const m = ctBank.matchText(r.data, opts, c.type);
        const hit = m.idxs[0];
        const good = hit === c.expect;
        if (good) ok++; else bad++;
        console.log(`\n[${good ? '答对' : '答错'}] ${c.q}`);
        console.log(`         源=${r.src} 耗时=${ms}ms 置信度=${m.score.toFixed(2)} 方式=${m.how}`);
        console.log(`         题库原话：${String(r.data).slice(0, 90)}`);
        console.log(`         选中：${hit >= 0 ? c.options[hit] : '（无）'}（期望：${c.options[c.expect]}）`);
    }
    console.log(`\n结果：${ok} 答对，${bad} 未答对/未命中`);
    console.log('统计：', JSON.stringify(ctBank.stats));
    process.exit(0);
})();
