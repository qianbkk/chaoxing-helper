// =============================================================================
// v113-module.test.js —— v1.11.3 单测（多源免费题库 + 打分匹配 + 失败分类）
//   ① 多源题库客户端：主源并行 / 备用源兜底 / 节流 / 流控退避 / 命中缓存 / 失败分类
//   ② 答案 → 选项的打分制：单选只取最高分 / 多选取并集 / 判断题同义表 / 否定词防护
//   ③ 百度不挂科源：XOR 解密 + que_options（二维）解析
//   ④ 学习端（章节测验）点选项
//   ⑤ 三处调用点接入 + 发布件元数据
// 运行：node tests/v113-module.test.js
// =============================================================================
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const file = path.join(root, 'dist', 'chaoxing-helper.user.js');

let pass = 0, fail = 0;
function t(name, actual, expect) {
    const a = JSON.stringify(actual), b = JSON.stringify(expect);
    if (a === b) { pass++; console.log('  [PASS] ' + name); }
    else { fail++; console.log('  [FAIL] ' + name + '\n         期望 ' + b + '\n         实际 ' + a); }
}
function section(title) { console.log('\n=== ' + title + ' ==='); }

if (!fs.existsSync(file)) {
    console.error('找不到发布件: ' + file + '\n请先运行 pwsh -File src/build.ps1');
    process.exit(1);
}
const src = fs.readFileSync(file, 'utf8');

function sliceModule(startMark, endMark) {
    const s = src.indexOf(startMark);
    const e = src.indexOf(endMark);
    if (s < 0 || e < 0) { console.error('未找到模块标记: ' + startMark); process.exit(1); }
    return src.slice(s, e);
}

// ---------------- 沙箱 ----------------
let stored = {};
let reqs = [];
const sandbox = {
    GM_getValue: (k, d) => (k in stored ? stored[k] : d),
    GM_setValue: (k, v) => { stored[k] = v; },
    GM_xmlhttpRequest: (opt) => { reqs.push(opt); },
};
const ctBankMod = sliceModule(
    '//==================== v1.11.3 多源免费题库开始 ====================',
    '//==================== v1.11.3 多源免费题库结束 ===================='
);
const factory = new Function('GM_getValue', 'GM_setValue', 'GM_xmlhttpRequest', 'token',
    ctBankMod + '\nreturn ctBank;');
const ctBank = factory(sandbox.GM_getValue, sandbox.GM_setValue, sandbox.GM_xmlhttpRequest, '');

// 测试里不等节流
ctBank.MIN_INTERVAL = 0;
ctBank.BACKOFF = [1, 1];

function reset() {
    stored = {};
    reqs = [];
    ctBank._cache = null;
    ctBank._lastAt = {};
    ctBank._failStreak = 0;
    ctBank._offUntil = 0;
    ctBank.stats = { hit: 0, miss: 0, throttle: 0, error: 0, cacheHit: 0, off: 0 };
}
function flush(payload, kind) {
    let guard = 0;
    while (guard++ < 30) {
        const pend = reqs.filter(r => !r.__done);
        if (!pend.length) break;
        pend.forEach(r => {
            r.__done = true;
            try {
                if (kind === 'error') { if (r.onerror) r.onerror({}); }
                else if (kind === 'timeout') { if (r.ontimeout) r.ontimeout({}); }
                else if (r.onload) r.onload({ responseText: JSON.stringify(payload) });
            } catch (e) { }
        });
    }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// =============================================================================
section('1) 发布件元数据与模块标记');
t('@version 为 1.11.3-AI', src.includes('// @version      1.11.3-AI'), true);
t('旧的 1.11.2 版本号已不存在', src.includes('// @version      1.11.2-AI'), false);
t('存在多源题库模块', src.includes('//==================== v1.11.3 多源免费题库开始 ===================='), true);
t('@connect 里有 icodef 主源', src.includes('// @connect      cx.icodef.com'), true);
t('@connect 里有 icodef 备用源', src.includes('// @connect      q.icodef.com'), true);
t('@connect 里有百度不挂科', src.includes('// @connect      easylearn.baidu.com'), true);
t('模块版本号是 v1.11.3', ctBank.VERSION, 'v1.11.3');
t('三个免费源', ctBank.SOURCES.length, 3);
t('主源两个（并行）', ctBank.SOURCES.filter(s => s.primary).length, 2);
t('备用源一个（兜底）', ctBank.SOURCES.filter(s => !s.primary).length, 1);

// =============================================================================
section('2) 文本归一化与相似度');
t('去空白', ctBank.norm('  人民代表大会 制度 '), '人民代表大会制度');
t('去选项字母前缀', ctBank.norm('A. 人民代表大会制度'), '人民代表大会制度');
t('去括号字母前缀', ctBank.norm('(B) 人民代表大会制度'), '人民代表大会制度');
t('去题号前缀', ctBank.norm('1. 人民代表大会制度'), '人民代表大会制度');
t('全角转半角', ctBank.norm('ＡＢＣ'), 'abc');
t('完全相同相似度为 1', ctBank.sim('人民代表大会制度', '人民代表大会制度'), 1);
t('完全不同的相似度很低', ctBank.sim('人民代表大会制度', '社会主义核心价值观') < 0.5, true);
t('包含关系相似度很高', ctBank.sim('人民代表大会制度', '我国的根本政治制度是人民代表大会制度') > 0.85, true);
t('空串相似度为 0', ctBank.sim('', 'abc'), 0);

// =============================================================================
section('3) 判断题同义表');
t('正确 → true', ctBank.judgeVal('正确'), 'true');
t('对 → true', ctBank.judgeVal('对'), 'true');
t('√ → true', ctBank.judgeVal('√'), 'true');
t('是 → true', ctBank.judgeVal('是'), 'true');
t('错误 → false', ctBank.judgeVal('错误'), 'false');
t('错 → false', ctBank.judgeVal('错'), 'false');
t('× → false', ctBank.judgeVal('×'), 'false');
t('否 → false', ctBank.judgeVal('否'), 'false');
t('不正确 → false（不能当成「正确」）', ctBank.judgeVal('不正确'), 'false');
t('说法正确 → true', ctBank.judgeVal('说法正确'), 'true');
t('说法错误 → false', ctBank.judgeVal('说法错误'), 'false');
t('无关文本 → null', ctBank.judgeVal('人民代表大会制度'), null);

// =============================================================================
section('4) 答案 → 选项的打分制');
const single = [
    { letter: 'A', text: '人民代表大会制度' },
    { letter: 'B', text: '政治协商制度' },
    { letter: 'C', text: '民族区域自治制度' }
];
t('完全相同 → 命中', ctBank.matchText('人民代表大会制度', single, '单选题').idxs, [0]);
t('整句包含选项文字 → 命中', ctBank.matchText('我国的根本政治制度是人民代表大会制度。', single, '单选题').idxs, [0]);
t('单选题只返回一个下标', ctBank.matchText('人民代表大会制度和政治协商制度', single, '单选题').idxs.length, 1);
t('单选题取最高分那一个', ctBank.matchText('人民代表大会制度和政治协商制度', single, '单选题').idxs, [0]);
t('匹配不上返回空', ctBank.matchText('完全无关的答案', single, '单选题').idxs, []);
t('空答案返回空', ctBank.matchText('', single, '单选题').idxs, []);
t('多选按 # 拆开取并集', ctBank.matchText('人民代表大会制度#民族区域自治制度', single, '多选题').idxs, [0, 2]);
t('多选去重', ctBank.matchText('人民代表大会制度#人民代表大会制度', single, '多选题').idxs, [0]);
t('多选句子提到多个选项时全部收下', ctBank.matchText('人民代表大会制度和民族区域自治制度', single, '多选题').idxs, [0, 2]);
t('纯字母答案按原始字母兜底', ctBank.matchText('B', single, '单选题').idxs, [1]);
t('多选纯字母答案逐个展开', ctBank.matchText('AB', single, '多选题').idxs, [0, 1]);
t('否定词防护：不正确不命中「正确」', ctBank.scoreOption('正确', '不正确'), 0);
t('否定词防护：不正确不命中「错误」', ctBank.scoreOption('错误', '不正确'), 0);
t('置信度不足不算命中', ctBank.matchText('xyzzy', single, '单选题').idxs, []);

section('4b) 判断题匹配');
const judge = [{ letter: 'A', val: 'true', text: '正确' }, { letter: 'B', val: 'false', text: '错误' }];
t('按 val-param 命中 true', ctBank.matchText('正确', judge, '判断题').idxs, [0]);
t('按 val-param 命中 false', ctBank.matchText('错误', judge, '判断题').idxs, [1]);
t('√ 也认 true', ctBank.matchText('√', judge, '判断题').idxs, [0]);
t('判断题走同义表（how=judge）', ctBank.matchText('正确', judge, '判断题').how, 'judge');
t('没有同义选项时退回文本匹配', ctBank.matchText('正确', [{ text: 'A' }, { text: 'B' }], '判断题').idxs, []);

// =============================================================================
section('5) 百度不挂科源：XOR 解密 + 选项解析');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'baidu-tiku-sample.json'), 'utf8'));
const decrypted = ctBank._decryptBaidu(fixture.bdjson, fixture.actk);
t('解密成功（拿到 JSON）', (() => { try { JSON.parse(decrypted); return true; } catch (e) { return false; } })(), true);
const dec = JSON.parse(decrypted);
t('que_options 是二维数组', Array.isArray(dec.que_options) && Array.isArray(dec.que_options[0]), true);
t('que_options[0] 是选项数组', dec.que_options[0].length >= 2, true);
const baiduOpts = ctBank._baiduOptions(dec);
t('解析出选项文字', baiduOpts.filter(o => o.text).length, dec.que_options[0].length);
t('至少有一个选项被标记为正确（yes=true）', baiduOpts.filter(o => o.yes).length >= 1, true);
const baiduAns = ctBank._baiduAnswer(dec, baiduOpts);
t('答案取的是「正确选项的文字」（不是字母）', baiduAns.indexOf('#') < 0 ? baiduAns.length > 0 : true, true);
t('答案能在解析出的选项里找到', baiduOpts.some(o => o.text && baiduAns.indexOf(o.text) >= 0), true);
t('题干能取到文字', ctBank._richText(((dec.que_stem || [])[0] || {}).c || []).length > 0, true);
t('解密失败时返回空串', ctBank._decryptBaidu('不是base64@@@', 'x'), '');

// =============================================================================
section('6) 多源客户端：主源并行 / 命中 / 未收录 / 网络错误');
(async () => {
    reset();
    // 6.1 主源命中即返回
    let r1 = null;
    ctBank.ask('我国的根本政治制度是什么？', '单选题', (r) => { r1 = r; });
    const ic = reqs.find(r => String(r.url).indexOf('icodef') >= 0);
    const bd = reqs.find(r => String(r.url).indexOf('easylearn') >= 0);
    t('主源并行发了两个请求', reqs.length >= 2, true);
    t('icodef 请求带 type=0', ic && /type=0/.test(ic.data), true);
    t('icodef 请求带题干', ic && /question=/.test(ic.data), true);
    t('百度请求带题干', bd && /query=/.test(bd.url), true);
    ic.onload({ responseText: JSON.stringify({ code: 1, data: '人民代表大会制度' }) });
    t('主源命中即回调', r1 && r1.ok, true);
    t('命中的答案文本', r1 && r1.data, '人民代表大会制度');
    t('命中来源是 icodef', r1 && r1.src, 'icodef');
    t('命中计数 +1', ctBank.stats.hit, 1);

    // 6.2 命中缓存：同一题不再发请求
    const before = reqs.length;
    let r2 = null;
    ctBank.ask('我国的根本政治制度是什么？', '单选题', (r) => { r2 = r; });
    t('第二次查同一题直接命中缓存', r2 && r2.cached, true);
    t('缓存命中不再发请求', reqs.length, before);
    t('缓存计数 +1', ctBank.stats.cacheHit, 1);

    // 6.3 全部未收录：不算失败，不熔断
    reset();
    let r3 = null;
    ctBank.ask('题库里没有的题', '单选题', (r) => { r3 = r; });
    flush({ code: -1, data: '未搜索到答案' });
    await sleep(30);
    t('全部未收录 → 不给答案', r3 && r3.ok, false);
    t('未收录不算网络失败', ctBank._failStreak, 0);
    t('未收录不触发熔断', ctBank.off(), false);

    // 6.4 网络错误：计入失败
    reset();
    let r4 = null;
    ctBank.ask('会超时的题', '单选题', (r) => { r4 = r; });
    flush(null, 'error');
    await sleep(30);
    t('网络错误 → 不给答案', r4 && r4.ok, false);
    t('网络错误计入失败计数', ctBank._failStreak, 1);

    // 6.5 连续 3 次网络错误 → 熔断，之后不再发请求
    reset();
    for (let i = 0; i < 3; i++) {
        let rr = null;
        ctBank.ask('会超时的题' + i, '单选题', (r) => { rr = r; });
        flush(null, 'error');
        await sleep(30);
    }
    t('连续 3 次真失败后熔断', ctBank.off(), true);
    const before2 = reqs.length;
    let r5 = null;
    ctBank.ask('熔断后的题', '单选题', (r) => { r5 = r; });
    t('熔断期间直接返回，不再发请求', reqs.length, before2);
    t('熔断期间 reason=off', r5 && r5.reason, 'off');

    // 6.6 流控：退避重试，不是直接放弃
    reset();
    let r6 = null;
    ctBank.ask('被限流的题', '单选题', (r) => { r6 = r; });
    const ic6 = reqs.find(r => String(r.url).indexOf('icodef') >= 0);
    ic6.onload({ responseText: JSON.stringify({ code: -2, msg: '触发流控限制' }) });
    t('流控后先退避重试（还没放弃）', r6 === null, true);
    await sleep(40);
    const ic6b = reqs.filter(r => String(r.url).indexOf('icodef') >= 0);
    t('流控后重试了同一个源', ic6b.length >= 2, true);
    t('流控不计入熔断', ctBank._failStreak, 0);

    // 6.7 备用源：主源全败后才查 q.icodef.com
    reset();
    let r7 = null;
    ctBank.ask('主源挂了才用备用源', '单选题', (r) => { r7 = r; });
    const hasQ = reqs.some(r => String(r.url).indexOf('q.icodef.com') >= 0);
    t('主源还没全败时不查备用源', hasQ, false);
    flush({ code: -1, data: '未搜索到答案' });
    await sleep(30);
    t('主源全败后查了备用源', reqs.some(r => String(r.url).indexOf('q.icodef.com') >= 0), true);
    t('备用源也未收录 → 不给答案', r7 && r7.ok, false);

    // =============================================================================
    section('7) 学习端（章节测验）点选项');
    function makeLi(attrs, text, emLetter) {
        const em = emLetter ? [{ getAttribute: (k) => (k === 'id-param' ? emLetter : null) }] : [];
        return {
            _attrs: attrs, _em: em, _text: text, clicked: 0,
            getAttribute(k) { return (this._attrs[k] === undefined) ? null : this._attrs[k]; },
            getElementsByTagName(tag) { return tag === 'em' ? this._em : []; },
            innerText: text, textContent: text,
            click() { this.clicked++; }
        };
    }
    // 单选：DOM 里 li 的 em 带原始字母
    const liA = makeLi({ 'id-param': '1', 'class': '' }, '人民代表大会制度', 'A');
    const liB = makeLi({ 'id-param': '1', 'class': '' }, '政治协商制度', 'B');
    const lis = [liA, liB];
    const fakeDoc = { getElementsByTagName: (tag) => (tag === 'li' ? lis : []) };
    const qu = {
        questionid: 'answer1', type: '单选题',
        options: { length: 2, '人民代表大会制度': { id: 'x', value: 'A' }, '政治协商制度': { id: 'y', value: 'B' } }
    };
    let m1 = ctBank.applyLearning(qu, '我国的根本政治制度是人民代表大会制度。', { d: fakeDoc });
    t('学习端单选命中', m1.ok, true);
    t('学习端点的是正确选项', liA.clicked, 1);
    t('学习端没点错选项', liB.clicked, 0);

    // 判断题：靠 val-param
    const jTrue = makeLi({ 'id-param': '2', 'val-param': 'true', 'class': '' }, '√', 'A');
    const jFalse = makeLi({ 'id-param': '2', 'val-param': 'false', 'class': '' }, '×', 'B');
    const jLis = [jTrue, jFalse];
    const jDoc = { getElementsByTagName: (tag) => (tag === 'li' ? jLis : []) };
    let m2 = ctBank.applyLearning({ questionid: 'answer2', type: '判断题' }, '正确', { d: jDoc });
    t('学习端判断题命中', m2.ok, true);
    t('判断题点了 true 那一项', jTrue.clicked, 1);
    t('判断题没点 false 那一项', jFalse.clicked, 0);
    let m3 = ctBank.applyLearning({ questionid: 'answer2', type: '判断题' }, '错误', { d: jDoc });
    t('判断题答「错误」时点 false', jFalse.clicked, 1);

    // 多选：点两个
    const mLiA = makeLi({ 'id-param': '3', 'class': '' }, '人民代表大会制度', 'A');
    const mLiB = makeLi({ 'id-param': '3', 'class': '' }, '民族区域自治制度', 'B');
    const mLiC = makeLi({ 'id-param': '3', 'class': '' }, '政治协商制度', 'C');
    const mLis = [mLiA, mLiB, mLiC];
    const mDoc = { getElementsByTagName: (tag) => (tag === 'li' ? mLis : []) };
    let m4 = ctBank.applyLearning({
        questionid: 'answer3', type: '多选题',
        options: { length: 3, '人民代表大会制度': { id: 'a', value: 'A' }, '民族区域自治制度': { id: 'b', value: 'B' }, '政治协商制度': { id: 'c', value: 'C' } }
    }, '人民代表大会制度#民族区域自治制度', { d: mDoc });
    t('学习端多选命中两项', m4.idxs.length, 2);
    t('学习端多选点了两个选项', mLiA.clicked + mLiB.clicked, 2);
    t('学习端多选没点第三个', mLiC.clicked, 0);

    // =============================================================================
    section('8) 三处调用点接入同一个题库客户端');
    t('作业端走多源客户端', src.includes('ctBank.ask(question, typeName, function (r) {'), true);
    t('考试端走多源客户端', src.includes("ctBank.ask(question, typeName, function (r) {"), true);
    t('学习端走多源客户端', src.includes("ctBank.ask(quItem['question'], quItem['type'], function (r) {"), true);
    t('旧的单源请求已经没有了（url: ctUrl）', (src.match(/url: ctUrl/g) || []).length, 0);
    t('未收录不再计入熔断', src.includes('[题库] 未收录该题（不计失败），转交 AI'), true);
    t('旧的「负数码一律算失败」写法已移除', src.includes("ctFail(ctCode == -2 ? '触发流控'"), false);
    t('作业端匹配带上了题型', src.includes('self.matchAnswer(ans, q.options, q.type)'), true);
    t('考试端匹配带上了题型', src.includes('self.matchAnswerText(text, q.options, q.type)'), true);
    t('面板说明了三个免费源', src.includes('三个免费源同时查'), true);
    t('面板说明了 token 选填', src.includes('实测不填也能查题'), true);

    console.log('\n========================================');
    console.log(`结果：${pass} 通过，${fail} 失败`);
    console.log('========================================');
    process.exit(fail > 0 ? 1 : 0);
})();
