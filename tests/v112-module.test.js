// =============================================================================
// v112-module.test.js —— v1.11.2 单测
//   ① 面板右栏：开始/继续、暂停 挪到右侧单独一栏并做显眼
//   ② 日志规范：统一标签前缀 / 统一句式 / 去掉开发噪声 / 合并重复
//   ③ 阅读助手：每段秒数默认 10 秒
//   ④ 阅读助手：按每段秒数把整篇读完（含懒加载出来的后续内容）
// 运行：node tests/v112-module.test.js
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

// =============================================================================
section('1) 版本与模块标记');
t('@version 为 1.11.4-AI', src.includes('// @version      1.11.4-AI'), true);
t('旧的 1.11.1 版本号已不存在', src.includes('// @version      1.11.1-AI'), false);
t('存在日志规范模块', src.includes('//==================== v1.11.2 日志规范开始 ===================='), true);
t('存在 v1.11.2 会话日志模块', src.includes('//==================== v1.11.2 运行日志（按标签页会话）开始 ===================='), true);
t('存在 v1.11.2 全程托管模块', src.includes('//==================== v1.11.2 全程托管模式开始 ===================='), true);
t('存在 v1.11.2 阅读助手模块', src.includes('//==================== v1.11.2 阅读助手开始 ===================='), true);
t('旧的 v1.10 会话日志模块已替换', src.includes('//==================== v1.10 运行日志（按标签页会话）开始 ===================='), false);
t('旧的 v1.11.1 阅读助手模块已替换', src.includes('//==================== v1.11.1 阅读助手开始 ===================='), false);

// =============================================================================
section('2) 面板右栏：开始/继续 + 暂停 挪到右边单独一栏');
t('主容器放宽到 col-md-10', src.includes('<div class="col-md-10 col-md-offset-1">'), true);
t('挂机小助手那一页的容器没被改', (src.match(/col-md-6 col-md-offset-3/g) || []).length, 1);
t('有两栏栅格 .unrival-mainrow', src.includes('.unrival-mainrow {'), true);
t('左栏 .unrival-maincol', src.includes('.unrival-maincol {'), true);
t('右栏 .unrival-sidecol', src.includes('.unrival-sidecol {'), true);
t('右栏桌面端吸顶', src.includes('position:sticky'), true);
t('窄屏时右栏顶到最上面', src.includes('.unrival-sidecol { order:-1;'), true);
t('桌面端两栏不换行（右栏不会被挤到页面最下面）', src.includes('.unrival-mainrow { display:flex; flex-wrap:nowrap;'), true);
t('旧的换行版栅格已不存在', src.includes('.unrival-mainrow { display:flex; flex-wrap:wrap;'), false);
t('右栏有独立的运行控制面板', src.includes('id="runCtlPanel"'), true);
t('运行控制面板用醒目标题栏', src.includes('class="panel panel-primary" id="runCtlPanel"'), true);

// 主按钮在右栏里（大号），暂停是小号
const sideColStart = src.indexOf('<div class="unrival-sidecol">');
const sideColEnd = src.indexOf('</div>', src.indexOf('id="runCtlPanel"')) ;
const sideCol = src.slice(sideColStart, sideColStart + 2000);
t('右栏里能拿到「开始/继续」按钮', sideCol.includes("id='pauseStartButton'"), true);
t('右栏里能拿到「暂停」按钮', sideCol.includes("id='pauseToggleButton'"), true);
t('「开始/继续」是大号主按钮', sideCol.includes("btn btn-success btn-lg btn-block"), true);
t('「暂停」是小号次按钮', sideCol.includes("btn btn-danger btn-sm btn-block"), true);
t('「开始/继续」文案没变', sideCol.includes('>开始/继续<'), true);
t('运行状态文字还在（右栏里）', sideCol.includes('id="pauseStatusText"'), true);

// 「任务配置」里不再有「运行控制」那一行
const normalQuery = sliceModule(
    '                <div class="panel panel-info" id="normalQuery">',
    '                <div class="unrival-grid">'
);
t('任务配置里没有「运行控制：」这一行', normalQuery.includes('运行控制：'), false);
t('任务配置里没有开始/继续按钮', normalQuery.includes('pauseStartButton'), false);
t('任务配置里没有暂停按钮', normalQuery.includes('pauseToggleButton'), false);
t('任务配置里托管模式还在', normalQuery.includes('unrivalAutoRun'), true);

// 状态同步函数要保留主/次按钮的尺寸
t('状态同步保留主按钮大号', src.includes("paused ? 'btn btn-success btn-lg btn-block' : 'btn btn-success btn-lg btn-block disabled'"), true);
t('状态同步保留次按钮小号', src.includes("paused ? 'btn btn-danger btn-sm btn-block disabled' : 'btn btn-danger btn-sm btn-block'"), true);

// =============================================================================
section('3) 日志规范：标签 / 句式 / 降噪 / 合并');
const specMod = sliceModule(
    '//==================== v1.11.2 日志规范开始 ====================',
    '//==================== v1.11.2 日志规范结束 ===================='
);
t('标签集正好 12 个', (specMod.match(/TAGS: \[([^\]]*)\]/) || ['', ''])[1].split(',').length, 12);
t('标签集含「阅读」', specMod.includes("'阅读'"), true);
t('标签集含「托管」', specMod.includes("'托管'"), true);
t('标签集含「翻章」', specMod.includes("'翻章'"), true);
t('规范里写了句式约定', specMod.includes('动作 + 对象 + 结果'), true);

// —— 逐条扫描产物：每一条日志消息都必须带合法标签 ——
const TAGS = ['视频', '文档', '测验', '答题', '题库', 'AI', '阅读', '托管', '翻章', '运行', '设置', '系统'];
function scanLogCalls(text) {
    const re = /(logs\.addLog|aiLog)\s*\(/g;
    const out = [];
    let m;
    while ((m = re.exec(text))) {
        const start = m.index + m[0].length;
        let depth = 1, i = start, inStr = null;
        while (i < text.length && depth > 0) {
            const c = text[i];
            if (inStr) {
                if (c === '\\') { i += 2; continue; }
                if (c === inStr) inStr = null;
                i++; continue;
            }
            if (c === "'" || c === '"' || c === '`') { inStr = c; i++; continue; }
            if (c === '(') depth++;
            else if (c === ')') depth--;
            i++;
        }
        const body = text.slice(start, i - 1);
        const line = text.slice(0, m.index).split('\n').length;
        const lm = /^[\s]*('|")/.exec(body);
        let lit = null;
        if (lm) {
            const q = lm[1];
            let k = lm[0].length; lit = '';
            while (k < body.length && body[k] !== q) {
                if (body[k] === '\\') { lit += body[k] + (body[k + 1] || ''); k += 2; continue; }
                lit += body[k]; k++;
            }
        }
        out.push({ line: line, lit: lit, body: body.replace(/\s+/g, ' ') });
    }
    return out;
}
const calls = scanLogCalls(src);
const untagged = calls.filter(c => {
    if (c.lit === null) return false;               // 动态表达式另有断言
    const tm = /^\[([^\]\s]{1,8})\]\s/.exec(c.lit);
    return !(tm && TAGS.indexOf(tm[1]) >= 0);
});
t('所有字面量日志消息都带合法标签前缀', untagged.map(u => 'L' + u.line + ':' + u.lit), []);

// 动态消息：必须显式补标签
t('提交结果回报补了标签', src.includes("logs.addLog(logSpec.tag(msg, '测验'), 'blue');"), true);
t('超星原文告警补了标签', src.includes("logs.addLog(logSpec.tag(warnInfo, '视频'), 'red');"), true);
t('考试端消息补了标签', src.includes("logs.addLog(logSpec.tag(_w.top.unrivalWorkInfo, '答题'));"), true);
t('后台消息补了标签', src.includes("logs.addLog(logSpec.tag(new_value, '系统'));"), true);

// —— 重复消息 ——
const litCount = new Map();
for (const c of calls) {
    if (c.lit === null) continue;
    litCount.set(c.lit, (litCount.get(c.lit) || 0) + 1);
}
// 允许重复的：同一句话分布在不同错误分支里（不是重复输出）
const DUP_ALLOWED = [
    '请添加安全网址',          // 视频 / 文档 / 测验 三个请求分支各一份
    '错误原因：',              // 三个错误分支各一份
    '浏览器内核过老'           // 两个入口各一份
];
const unexpectedDup = [...litCount.entries()].filter(([k, n]) => n > 1 && !DUP_ALLOWED.some(w => k.includes(w)));
t('没有意料之外的重复日志文案', unexpectedDup.map(d => d[0]), []);
t('「复习模式已开启」只出现一次', (src.match(/'\[设置\] 复习模式已开启/g) || []).length, 1);
t('「自动做章节测试已开启」只出现一次', (src.match(/'\[设置\] 章节测试自动作答已开启/g) || []).length, 1);
t('「此页面不必保持在最前端」只出现一次', (src.match(/'\[系统\] 本页面不必保持在最前端/g) || []).length, 1);

// —— 开发自检噪声不进用户日志 ——
// 「页面就绪：脚本 vX | URL」只在调试通道里
t('「页面就绪」只在调试通道', (src.match(/页面就绪：脚本/g) || []).length, 1);
t('「页面就绪」不是用户日志消息', src.includes("logs.addLog('页面就绪"), false);
t('调试命令回显走调试通道', src.includes("dbg.log('cmd', msg);"), true);

// —— 统一句式抽查 ——
t('不再有「会挂科，会挂科」叠写', src.includes('会挂科，会挂科'), false);
t('日志里不再有「5秒后自动下一章」', calls.filter(c => c.lit && c.lit.includes('5秒后自动下一章')).length, 0);
t('不再有「奇怪的倍速」', src.includes('奇怪的倍速'), false);
t('不再有「您已安装超星挂机小助手」', src.includes('您已安装超星挂机小助手'), false);
t('不再有「请添加安全网址，将」', src.includes('请添加安全网址，将'), false);
t('提示语指向右侧的「开始/继续」', src.includes('点右侧「开始/继续」恢复'), true);
t('没有残留「点「任务配置 → 开始/继续」恢复」', src.includes('点「任务配置 → 开始/继续」恢复'), false);

// —— 合并计数（运行层）——
const logHistMod = sliceModule(
    '//==================== v1.11.2 运行日志（按标签页会话）开始 ====================',
    '//==================== v1.11.2 运行日志（按标签页会话）结束 ===================='
);
t('会话日志模块有合并计数', logHistMod.includes('last.n = (last.n || 1) + 1;'), true);
t('渲染时显示重复次数', logHistMod.includes("'（×' + l.n + '）'"), true);
t('落库前会做规范化', logHistMod.includes('logSpec.normalize(str)'), true);
t('空消息会被丢掉', logHistMod.includes('if (!text) return;'), true);
t('存储语义没变（仍是 sessionStorage）', logHistMod.includes("this._store = 'session';"), true);
t('存储语义没变（仍可退回 GM 存储）', logHistMod.includes("this._store = 'gm';"), true);

// =============================================================================
section('4) 阅读助手：默认 10 秒');
const readMod = sliceModule(
    '//==================== v1.11.2 阅读助手开始 ====================',
    '//==================== v1.11.2 阅读助手结束 ===================='
);
t('默认值是 10 秒', readMod.includes('DEFAULT_SPEED: 10,'), true);
t('还留着 v1.11.1 的默认值 1（用来做迁移）', readMod.includes('OLD_DEFAULT_SPEED: 1,'), true);
t('有一次性迁移逻辑', readMod.includes('SPEED_VER_KEY'), true);
t('迁移标记是 1.11.2', readMod.includes("SPEED_VER_KEY, '') === '1.11.2'"), true);
t('面板保存时的兜底值也是 10', src.includes('if (isNaN(_readSpeed) || _readSpeed <= 0) _readSpeed = 10;'), true);
t('面板上标注了默认 10 秒', src.includes('秒（默认 10）'), true);
t('面板文案说明会读到加载不出来为止', src.includes('一直读到加载不出来为止'), true);

// 关键：不得出现任何完成上报请求（阅读只能真读）
t('阅读模块不发任何请求', readMod.includes('GM_xmlhttpRequest'), false);
t('阅读模块明确说明不秒过', readMod.includes('超星按真实浏览时长判定'), true);

// =============================================================================
section('5) 阅读助手：读完整篇（含懒加载出来的后续内容）');
t('有增量收集（refreshContent）', readMod.includes('refreshContent: function ()'), true);
t('增量收集按元素身份去重', readMod.includes('this._seen.indexOf(el) >= 0'), true);
t('新元素接到队尾（继续往下读）', readMod.includes('this._elements.push(el);'), true);
t('有续读流程（extend）', readMod.includes('extend: function ()'), true);
t('续读会滚到页面底部触发懒加载', readMod.includes('_w.scrollTo({ top: h, behavior: \'smooth\' })'), true);
t('续读会等页面加载', readMod.includes('EXTEND_WAIT: 1500'), true);
t('连续多次没有新内容才判定读完', readMod.includes('EXTEND_TRIES: 6'), true);
t('读到加载不出来为止有明确日志', readMod.includes('已经读到底'), true);
t('加载出新内容会接着读', readMod.includes('继续往下读'), true);
t('默认仍关闭', readMod.includes("GM_getValue(this.KEY, '0') == '1'"), true);

// —— 沙箱行为 ——
function makeNode(tag, text, h, w, top) {
    return {
        tagName: tag, textContent: text || '', offsetHeight: h || 0, offsetWidth: w || 0, _top: top || 0,
        getBoundingClientRect: function () { return { top: this._top }; },
        closest: function () { return null; },
        scrollIntoView: function () { this.scrolled = true; }
    };
}
function makeReadSandbox(opts) {
    const o = opts || {};
    const st = Object.assign({}, o.stored || {});
    const GM_getValue = (k, d) => (k in st ? st[k] : d);
    const GM_setValue = (k, v) => { st[k] = v; };
    const nodes = o.nodes || [];
    const rootEl = {
        querySelectorAll: function (sel) { return nodes.filter(n => n.tagName === sel); },
        querySelector: function (sel) {
            const s = String(sel).split(',')[0].trim();
            for (const n of nodes) if (n.tagName === s) return n;
            return null;
        }
    };
    const bodyEl = {
        querySelectorAll: function (sel) { return nodes.filter(n => n.tagName === sel); },
        querySelector: function () { return null; },
        scrollIntoView: function () { }
    };
    const _d = {
        body: bodyEl, documentElement: { scrollHeight: 1000 },
        querySelector: function (sel) { return (sel === 'main') ? rootEl : null; },
        querySelectorAll: function () { return []; },
        getElementById: function () { return null; }
    };
    const win = { innerHeight: 800, scrollTo: function () { win.scrolled = (win.scrolled || 0) + 1; }, top: null, location: { href: o.href || '' } };
    win.top = win;
    const timers = [];
    const fakeSetTimeout = (fn, ms) => { timers.push({ fn: fn, ms: ms }); return timers.length; };
    const factory = new Function(
        'GM_getValue', 'GM_setValue', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'MutationObserver',
        '_d', '_w', 'logs', 'dbg',
        readMod + '\nreturn { a: readAssist };'
    );
    const r = factory(
        GM_getValue, GM_setValue, console, fakeSetTimeout, clearTimeout, setInterval,
        function (fn) { this.fn = fn; this.observe = function () { }; this.disconnect = function () { }; },
        _d, win, { addLog: function () { } }, { log: function () { } }
    );
    return { a: r.a, st: st, timers: timers, win: win, nodes: nodes, _d: _d };
}

// 5.1 默认 10 秒
{
    const h = makeReadSandbox({});
    t('默认每段 10 秒', h.a.speed(), 10);
}
{
    const h = makeReadSandbox({ stored: { unrivalReadSpeed: '5' } });
    t('用户自己设的 5 秒不动', h.a.speed(), 5);
}
{
    const h = makeReadSandbox({ stored: { unrivalReadSpeed: '1' } });
    t('旧默认值 1 秒被迁移成 10 秒', h.a.speed(), 10);
    t('迁移后存储里是 10', h.st.unrivalReadSpeed, '10');
}
{
    const h = makeReadSandbox({ stored: { unrivalReadSpeed: '1', unrivalReadSpeedVer: '1.11.2' } });
    t('迁移过就不再动（用户自己改回 1 秒也保留）', h.a.speed(), 1);
}
{
    const h = makeReadSandbox({ stored: { unrivalReadSpeed: '999' } });
    t('秒数上限夹到 10', h.a.speed(), 10);
}
{
    const h = makeReadSandbox({ stored: { unrivalReadSpeed: 'abc' } });
    t('非法秒数回落到默认 10', h.a.speed(), 10);
}

// 5.2 增量收集：懒加载出来的新内容能接到队尾
{
    const p1 = makeNode('p', '第一段足够长的正文内容，用来验证收集逻辑', 100, 500, 10);
    const h = makeReadSandbox({ nodes: [p1], stored: { unrivalReadAssist: '1' } });
    t('初次收集到 1 个元素', h.a.collectContent(), 1);
    // 页面往下滚后又加载出来两段
    const p2 = makeNode('p', '第二段足够长的正文内容，是懒加载出来的', 100, 500, 900);
    const p3 = makeNode('p', '第三段足够长的正文内容，也是懒加载出来的', 100, 500, 1800);
    h.nodes.push(p2, p3);
    t('增量收集发现 2 段新内容', h.a.refreshContent(), 2);
    t('新内容接在队尾（不会打乱顺序）', h.a._elements.map(e => e._top).join(','), '10,900,1800');
    t('再扫一次没有新内容', h.a.refreshContent(), 0);
}

// 5.3 续读：读到加载不出来为止
{
    const p1 = makeNode('p', '第一段足够长的正文内容，用来验证收集逻辑', 100, 500, 10);
    const h = makeReadSandbox({ nodes: [p1], stored: { unrivalReadAssist: '1' } });
    h.a.collectContent();
    h.a.scrollToNext();               // 读第 1 段
    t('读完第 1 段后进入续读', h.a._extendTries, 0);
    h.a.scrollToNext();               // 已到队尾 → 触发 extend
    t('到队尾会触发续读（会滚到底部）', h.win.scrolled >= 1, true);
    t('续读安排了等待', h.timers.length >= 1, true);
    // 触发等待回调：没有新内容 → 再等一轮
    const cb = h.timers[h.timers.length - 1].fn;
    cb();
    t('没新内容会继续尝试（计数 +1）', h.a._extendTries, 2);
    // 连续尝试到上限 → 判定读完
    for (let i = 0; i < 8; i++) {
        const c = h.timers[h.timers.length - 1];
        if (!c) break;
        c.fn();
    }
    t('连续读不出新内容就判定读完', h.a._running, false);
}

// =============================================================================
console.log('\n----------------------------------------');
console.log(`结果: 通过 ${pass} 项，失败 ${fail} 项`);
console.log('----------------------------------------');
process.exit(fail === 0 ? 0 : 1);
