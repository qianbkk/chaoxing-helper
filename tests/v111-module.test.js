// =============================================================================
// v111-module.test.js —— 「阅读助手」单测（模块在 v1.11.2 里升级为 v1.11.2 版）
//   ① 结构断言（模块标记、面板开关、默认关闭、提示文案）
//   ② 沙箱行为（页面判定、参数夹取、正文收集、滚动与停止）
// 运行：node tests/v111-module.test.js
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
section('1) 结构断言');
t('存在阅读助手模块起始标记', src.includes('//==================== v1.11.2 阅读助手开始 ===================='), true);
t('存在阅读助手模块结束标记', src.includes('//==================== v1.11.2 阅读助手结束 ===================='), true);
t('@version 为 1.11.4-AI', src.includes('// @version      1.11.4-AI'), true);
t('旧的 1.11.0 版本号已不存在', src.includes('// @version      1.11.0-AI'), false);
t('默认关闭', src.includes("GM_getValue(this.KEY, '0') == '1'"), true);
t('存储键为 unrivalReadAssist', src.includes("KEY: 'unrivalReadAssist'"), true);
t('每段停留秒数键为 unrivalReadSpeed', src.includes("SPEED_KEY: 'unrivalReadSpeed'"), true);
t('滚动模式键为 unrivalReadMode', src.includes("MODE_KEY: 'unrivalReadMode'"), true);
t('面板有阅读助手勾选框', src.includes('id="unrivalReadAssist"'), true);
t('面板有每段停留秒数输入', src.includes('id="unrivalReadSpeed"'), true);
t('面板就绪检查含新控件', src.includes("_d.getElementById('unrivalReadAssist') && _d.getElementById('testAiButton')"), true);
t('初始化回填开关', src.includes("_d.getElementById('unrivalReadAssist').checked = readAssist.enabled();"), true);
t('初始化回填秒数', src.includes("_d.getElementById('unrivalReadSpeed').value = readAssist.speed();"), true);
t('保存时写开关', src.includes("GM_setValue('unrivalReadAssist', _readOn ? '1' : '0');"), true);
t('保存时写秒数', src.includes("GM_setValue('unrivalReadSpeed', String(_readSpeed));"), true);
t('附加功能状态文字含阅读助手', src.includes("if (_readOn) on.push('阅读助手');"), true);
t('调试状态里有阅读助手', src.includes("s.push('阅读助手=' + (readAssist.enabled() ? '开' : '关'));"), true);
t('跳过阅读类任务时给提示', src.includes('这像是阅读任务'), true);
// 关键：不得出现任何完成上报请求（阅读只能真读）
t('阅读模块不发任何请求', sliceModule(
    '//==================== v1.11.2 阅读助手开始 ====================',
    '//==================== v1.11.2 阅读助手结束 ===================='
).includes('GM_xmlhttpRequest'), false);
t('阅读模块明确说明不秒过', src.includes('超星按真实浏览时长判定'), true);

// =============================================================================
section('2) 沙箱行为');
const readMod = sliceModule(
    '//==================== v1.11.2 阅读助手开始 ====================',
    '//==================== v1.11.2 阅读助手结束 ===================='
);

// 造一个假 DOM
function makeNode(tag, text, h, w, top) {
    return {
        tagName: tag,
        textContent: text || '',
        offsetHeight: h || 0,
        offsetWidth: w || 0,
        _top: top || 0,
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
        body: bodyEl,
        documentElement: { scrollHeight: 1000 },
        querySelector: function (sel) { return (sel === 'main') ? rootEl : null; },
        querySelectorAll: function () { return []; },
        getElementById: function () { return null; }
    };
    const win = { innerHeight: 800, scrollTo: function () { }, top: null, location: { href: o.href || '' } };
    win.top = win;
    const timers = [];
    const fakeSetTimeout = (fn, ms) => { timers.push({ fn: fn, ms: ms }); return timers.length; };
    const factory = new Function(
        'GM_getValue', 'GM_setValue', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'MutationObserver',
        '_d', '_w', 'logs', 'dbg',
        readMod + '\nreturn { a: readAssist };'
    );
    const r = factory(
        GM_getValue, GM_setValue, console, fakeSetTimeout, clearTimeout, setInterval, function (fn) { this.fn = fn; this.observe = function () { }; this.disconnect = function () { }; },
        _d, win, { addLog: function () { } }, { log: function () { } }
    );
    return { a: r.a, st: st, timers: timers, win: win, nodes: nodes, _d: _d };
}

// 2.1 开关：默认关闭
{
    const h = makeReadSandbox({});
    t('默认不开启阅读助手', h.a.enabled(), false);
}
{
    const h = makeReadSandbox({ stored: { unrivalReadAssist: '1' } });
    t('存储里有 1 时开启', h.a.enabled(), true);
}

// 2.2 页面判定（纯函数）
{
    const h = makeReadSandbox({});
    t('识别阅读正文页', h.a.isReadingPage('https://x.chaoxing.com/ztnodedetailcontroller/visitnodedetail?cardid=1'), true);
    t('普通页面不是阅读正文页', h.a.isReadingPage('https://x.chaoxing.com/mooc-ans/knowledge/cards?courseid=1'), false);
    t('识别阅读任务目录页（zt/portal）', h.a.isReadingTaskPage('https://x.chaoxing.com/mooc-ans/zt/portal/index'), true);
    t('识别阅读任务目录页（course/*.html）', h.a.isReadingTaskPage('https://x.chaoxing.com/mooc-ans/course/12345.html'), true);
    t('识别旧式阅读目录页', h.a.isReadingTaskPage('https://x.chaoxing.com/course/998.html?x=1'), true);
    t('章节列表页不是阅读目录页', h.a.isReadingTaskPage('https://x.chaoxing.com/mooc-ans/knowledge/cards?courseid=1'), false);
}

// 2.3 参数夹取
{
    const h = makeReadSandbox({});
    t('每段秒数默认 10', h.a.speed(), 10);
    t('默认是逐段模式', h.a.mode(), 'paragraph');
}
{
    const h = makeReadSandbox({ stored: { unrivalReadSpeed: '0.05' } });
    t('秒数下限夹到 0.3', h.a.speed(), 0.3);
}
{
    const h = makeReadSandbox({ stored: { unrivalReadSpeed: '999' } });
    t('秒数上限夹到 10', h.a.speed(), 10);
}
{
    const h = makeReadSandbox({ stored: { unrivalReadSpeed: 'abc' } });
    t('非法秒数回落到默认', h.a.speed(), 10);
}
{
    const h = makeReadSandbox({ stored: { unrivalReadMode: 'page' } });
    t('整页模式可配置', h.a.mode(), 'page');
}

// 2.4 正文收集：过滤小元素与太短的段落，并按位置排序
{
    const p1 = makeNode('p', '这是一段足够长的正文内容，用来验证收集逻辑', 100, 500, 10);
    const p2 = makeNode('p', '短', 100, 500, 20);
    const h1 = makeNode('h1', '标题', 60, 300, 5);
    const img = makeNode('img', '', 10, 10, 30);
    const h = makeReadSandbox({ nodes: [p1, p2, h1, img], stored: { unrivalReadAssist: '1' } });
    const n = h.a.collectContent();
    t('收集到 2 个内容元素', n, 2);
    t('按页面位置排序（h1 在 p 前面）', h.a._elements[0].tagName, 'h1');
    t('太短的段落被过滤', h.a._elements.map(e => e.tagName).join(','), 'h1,p');
}

// 2.5 没打开开关时什么都不做
{
    const h = makeReadSandbox({ href: 'https://x.chaoxing.com/ztnodedetailcontroller/visitnodedetail?cardid=1' });
    h.a.start();
    t('关闭时不启动（没有定时器）', h.timers.length, 0);
}

// 2.6 不是阅读页也不启动
{
    const h = makeReadSandbox({ href: 'https://x.chaoxing.com/mooc-ans/knowledge/cards?courseid=1', stored: { unrivalReadAssist: '1' } });
    h.a.start();
    t('非阅读页不启动', h.timers.length, 0);
}

// 2.7 阅读目录页：挂上监听等阅读入口
{
    const h = makeReadSandbox({ href: 'https://x.chaoxing.com/mooc-ans/zt/portal/index', stored: { unrivalReadAssist: '1' } });
    h.a.start();
    t('阅读目录页挂了 MutationObserver', !!h.a._observer, true);
    t('阅读目录页有 60 秒超时', h.timers.length, 1);
    t('超时是 60000ms', h.timers[0].ms, 60000);
}

// 2.8 阅读正文页：开滚动；中途关掉开关就停
{
    const p1 = makeNode('p', '这是一段足够长的正文内容，用来验证收集逻辑', 100, 500, 10);
    const h = makeReadSandbox({ nodes: [p1], href: 'https://x.chaoxing.com/ztnodedetailcontroller/visitnodedetail?cardid=1', stored: { unrivalReadAssist: '1' } });
    h.a.start();
    t('正文页会先延迟再试收集', h.timers.length >= 1, true);
    // 手动触发收集 + 滚动
    h.a.collectContent();
    h.a.scrollToNext();
    t('滚动前把元素滚到视口中间', p1.scrolled, true);
    t('滚动后安排了下一段', h.timers.length >= 1, true);
    // 关掉开关 → 再走一步就应该停
    h.st.unrivalReadAssist = '0';
    h.a.scrollToNext();
    t('关掉开关后不再滚元素', h.a._running, false);
}

// 2.9 读完：通知顶层 + 找「下一章」按钮
{
    const h = makeReadSandbox({ stored: { unrivalReadAssist: '1' } });
    let clicked = 0;
    h._d.querySelector = function (sel) {
        if (sel === '.next_btn') return { click: function () { clicked++; } };
        return null;
    };
    h.a.complete();
    t('读完会通知顶层', h.win.unrivalReadDone, 1);
    t('读完会点「下一章」按钮', h.timers.length >= 1, true);
}

console.log('\n----------------------------------------');
console.log(`结果: 通过 ${pass} 项，失败 ${fail} 项`);
console.log('----------------------------------------');
process.exit(fail === 0 ? 0 : 1);
