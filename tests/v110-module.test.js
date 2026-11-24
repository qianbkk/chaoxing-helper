// =============================================================================
// v110-module.test.js —— v1.10.0 / v1.11.0 的单测
//   ① v1.10.0 面板重排：区块顺序、题库与 AI 拆成两块、运行控制并入任务配置、
//              「开始/继续」+「暂停」两个按钮、各面板的小字清理
//   ② v1.10.0 运行日志按标签页会话化（结构断言；行为断言见 v18-module.test.js）
//   ③ v1.11.0 全程托管模式：默认关闭、跳过做不了的任务、闯关不退出、看门狗重试
// 运行：node tests/v110-module.test.js
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
section('1) 面板区块顺序（用户指定：任务配置 → 题库 → AI → 章节测验 → 运行日志 → 任务列表 → 附加功能 → 调试模式）');
// 只取「章节列表页」这一块面板 HTML —— 脚本里还有另一个独立页面（挂机小助手页），
// 它也有自己的任务列表/运行日志，整文件计数会误判。
const pm = src.match(/_d\.getElementsByTagName\("html"\)\[0\]\.innerHTML = `([\s\S]*?)`;/);
t('能定位到面板 HTML', !!pm, true);
const panelHtml = pm ? pm[1] : '';
const order = [
    ['任务配置', '<div class="panel-heading">任务配置</div>'],
    ['题库设置', '<div class="panel-heading">答题设置 · 题库（不用 AI 也能答）</div>'],
    ['AI 设置', '<div class="panel-heading">答题设置 · AI 接口（可选）</div>'],
    ['章节测验自动作答', '<div class="panel-heading">章节测验 / 作业自动作答</div>'],
    ['运行日志', '<div class="panel-heading">运行日志</div>'],
    ['任务列表', '<div class="panel-heading">任务列表</div>'],
    ['附加功能', '<div class="panel-heading">附加功能（实验性 · 未验证）</div>'],
    ['调试模式', '<div class="panel-heading">调试模式</div>']
];
const idx = order.map(o => panelHtml.indexOf(o[1]));
order.forEach((o, i) => t('存在区块：' + o[0], idx[i] > 0, true));
for (let i = 1; i < idx.length; i++) {
    t('顺序正确：' + order[i - 1][0] + ' 在 ' + order[i][0] + ' 之前', idx[i - 1] < idx[i], true);
}
t('调试模式是最后一个可见面板（后面只剩两个默认隐藏的：学习进度 / 章节测试）', idx[7] < panelHtml.indexOf('<div class="panel-heading">学习进度</div>'), true);
t('学习进度面板保留在调试模式之后', panelHtml.indexOf('<div class="panel-heading">学习进度</div>') > idx[7], true);
t('章节测试面板保留在最后', panelHtml.indexOf('<div class="panel-heading">章节测试</div>') > panelHtml.indexOf('<div class="panel-heading">学习进度</div>'), true);
t('附加功能紧挨在调试模式上面', panelHtml.indexOf('id="extrasPanel"') < panelHtml.indexOf('id="debugPanel"'), true);
// 旧面板必须被整块替换掉，不能留在文件后面造成 id 重复
const inPanel = (s) => (panelHtml.match(new RegExp(s, 'g')) || []).length;
t('「运行日志」面板只有一个', inPanel('<div class="panel-heading">运行日志</div>'), 1);
t('「任务列表」面板只有一个', inPanel('<div class="panel-heading">任务列表</div>'), 1);
t('#log 容器只有一个', inPanel('id="log"'), 1);
t('#result 容器只有一个', inPanel('id="result"'), 1);
t('#joblist 容器只有一个', inPanel("id='joblist'"), 1);
t('面板 HTML 标签闭合平衡', (panelHtml.match(/<div\b/g) || []).length, (panelHtml.match(/<\/div>/g) || []).length);
t('面板 HTML 里没有会破坏模板串的 ${ 或反引号', /\$\{|\`/.test(panelHtml), false);

// =============================================================================
section('2) 运行控制并入任务配置 + 两个按钮');
t('不再有独立的运行控制面板', src.includes('id="pausePanel"'), false);
t('任务配置里有运行控制这一行', src.includes('运行控制：'), true);
t('有「开始/继续」按钮', src.includes("id='pauseStartButton'"), true);
t('有「暂停」按钮', src.includes("id='pauseToggleButton'"), true);
t('按钮文案是「开始/继续」', src.includes('>开始/继续</a>'), true);
t('按钮文案是「暂停」', src.includes('>暂停</a>'), true);
t('状态同步函数存在', src.includes('var _syncPauseUI = function () {'), true);
t('运行中时「开始/继续」置灰', src.includes("paused ? 'btn btn-success' : 'btn btn-success disabled'"), true);
t('暂停时「暂停」置灰', src.includes("paused ? 'btn btn-danger disabled' : 'btn btn-danger'"), true);
t('初始化调用状态同步', src.includes('_syncPauseUI();'), true);
t('开始按钮绑定存在', src.includes("_d.getElementById('pauseStartButton').onclick = function () {"), true);
t('继续动作写持久化状态', src.includes('pauseCtl.set(false);'), true);
t('暂停动作写持久化状态', src.includes('pauseCtl.set(true);'), true);
t('提示文案指向新位置', src.includes('点「任务配置 → 开始/继续」恢复'), true);
t('旧的「运行控制 → 继续」文案已消失', src.includes('点「运行控制 → 继续」恢复'), false);

// =============================================================================
section('3) 题库与 AI 拆成两块，各有各的保存按钮');
t('有题库面板 ctPanel', src.includes('id="ctPanel"'), true);
t('有 AI 面板 aiPanel', src.includes('id="aiPanel"'), true);
t('题库面板里有题库 Token', src.includes('id="unrivalCtToken"'), true);
t('题库面板里有正确率门槛', src.includes('id="unrivalAccuracy"'), true);
t('题库面板里有翻章模式', src.includes('id="unrivalJumpType"'), true);
t('AI 面板里有 Base URL', src.includes('id="unrivalAiBaseUrl"'), true);
t('AI 面板里有模型', src.includes('id="unrivalAiModel"'), true);
t('AI 面板里有 API Key', src.includes('id="unrivalAiKey"'), true);
t('题库块有独立的保存按钮', src.includes("id='saveCtButton'"), true);
t('AI 块保留自己的保存按钮', src.includes("id='saveAiButton'"), true);
t('题库保存按钮只存题库相关设置', src.includes("_d.getElementById('saveCtButton').onclick = function () {"), true);
t('AI 保存按钮只存 AI 相关设置', src.includes("_d.getElementById('saveAiButton').onclick = function () {"), true);
t('题库块的状态文字存在', src.includes('id="ctStatusText"'), true);
t('保存题库设置会写 tikutoken', src.includes("GM_setValue('tikutoken', token);"), true);
t('保存题库设置会写正确率门槛', src.includes("GM_setValue('unrivalaccuracy', accuracy);"), true);
t('保存题库设置会写翻章模式', src.includes("var _jtReal = jumpMode.set(_d.getElementById('unrivalJumpType').value);"), true);
t('保存 AI 设置会写接口地址', src.includes("GM_setValue('unrivalAiBaseUrl',"), true);
t('面板就绪检查包含新控件', src.includes("_d.getElementById('unrivalAutoRun') && _d.getElementById('testAiButton')"), true);

// =============================================================================
section('4) 小块左右并排 + 去掉没必要的小字');
t('有栅格样式', src.includes('.unrival-grid {'), true);
t('栅格里的面板并排', src.includes('.unrival-grid > .panel { flex:1 1 0;'), true);
t('有表单行样式', src.includes('.unrival-row {'), true);
t('有字段样式（标签在上、输入框在下）', src.includes('.unrival-field {'), true);
t('主容器放宽到 col-md-8', src.includes('<div class="col-md-8 col-md-offset-2">'), true);
t('挂机小助手那一页的容器没被改', (src.match(/col-md-6 col-md-offset-3/g) || []).length, 1);
t('AI 面板的长说明段落已去掉', src.includes('题库优先，查不到时自动降级到AI'), false);
t('章节测验面板的链路说明已去掉', src.includes('链路：题库 → AI → 随机兜底'), false);
t('运行控制的说明段落已去掉', src.includes('一键停掉自动翻章 / 作答 / 提交'), false);
t('附加功能的「由上游整理而来」说明已去掉', src.includes('由上游整理而来'), false);
t('调试模式保留一行必要说明', src.includes('仅开发时使用：需先在本机运行 log-sink（端口 8124）'), true);

// =============================================================================
section('5) v1.10.0 运行日志按标签页会话化（结构）');
t('存在日志会话模块', src.includes('//==================== v1.10 运行日志（按标签页会话）开始 ===================='), true);
t('旧的 v1.8.1 日志模块已不存在', src.includes('//==================== v1.8.1 运行日志持久化（跨翻章堆积）开始 ===================='), false);
t('优先用 sessionStorage', src.includes("if (typeof sessionStorage != 'undefined' && sessionStorage) return sessionStorage;"), true);
t('不可用时退回 GM 存储', src.includes("this._store = 'gm';"), true);

// =============================================================================
section('6) v1.11.0 全程托管模式：结构');
t('存在托管模式模块起始标记', src.includes('//==================== v1.11 全程托管模式开始 ===================='), true);
t('存在托管模式模块结束标记', src.includes('//==================== v1.11 全程托管模式结束 ===================='), true);
t('存储键为 unrivalAutoRun', src.includes("KEY: 'unrivalAutoRun'"), true);
t('默认关闭', src.includes("GM_getValue(this.KEY, '0') == '1'"), true);
t('面板有托管模式勾选框', src.includes('id="unrivalAutoRun"'), true);
t('勾选框有绑定', src.includes("_d.getElementById('unrivalAutoRun').onchange = function () {"), true);
t('调试状态里有托管模式', src.includes("s.push('全程托管=' + (autoRun.enabled() ? '开' : '关'));"), true);
t('托管模式下跳过不支持的任务', src.includes("'已跳过（' + jobType + '）：' + jobName + `"), true);
t('默认仍保留「停下等人工」的行为', src.includes("if (typeof pauseCtl != 'undefined') pauseCtl.set(true);"), true);
t('闯关锁定在托管模式下不退出脚本', src.includes("if (typeof autoRun != 'undefined' && autoRun.enabled()) {"), true);
t('看门狗有重试间隔', src.includes('INTERVAL: 20000'), true);
t('看门狗有日志限频', src.includes('LOG_EVERY: 60000'), true);

// =============================================================================
section('7) v1.11.0 全程托管模式：沙箱行为');
const autoMod = sliceModule(
    '//==================== v1.11 全程托管模式开始 ====================',
    '//==================== v1.11 全程托管模式结束 ===================='
);

function makeAutoRun(opts) {
    const o = opts || {};
    const st = Object.assign({}, o.stored || {});
    const setCalls = [];
    const GM_getValue = (k, d) => (k in st ? st[k] : d);
    const GM_setValue = (k, v) => { st[k] = v; setCalls.push([k, v]); };
    const win = { jump: false, top: null };
    win.top = win;
    const logLines = [];
    const logsObj = { logArry: [], addLog: function (m, c) { this.logArry.push(m); logLines.push([m, c]); } };
    const intervals = [];
    const fakeSetInterval = (fn, ms) => { intervals.push({ fn: fn, ms: ms }); return intervals.length; };
    const factory = new Function(
        'GM_getValue', 'GM_setValue', 'console', 'setTimeout', 'clearTimeout', 'setInterval',
        '_w', '_l', 'missionList', 'busyThread', 'logs', 'pauseCtl', 'jumpType',
        autoMod + '\nreturn { a: autoRun };'
    );
    const r = factory(
        GM_getValue, GM_setValue, console, setTimeout, clearTimeout, fakeSetInterval,
        win, o.loc || { href: 'https://x.chaoxing.com/knowledge/cards?courseid=1' },
        o.missionList || {}, o.busyThread === undefined ? 0 : o.busyThread,
        logsObj, o.pauseCtl || { isPaused: function () { return false; } },
        o.jumpType === undefined ? 1 : o.jumpType
    );
    return {
        a: r.a, st: st, setCalls: setCalls, win: win, logsObj: logsObj,
        logLines: logLines, intervals: intervals
    };
}

// 7.1 默认关闭
{
    const h = makeAutoRun();
    t('默认不开启托管模式', h.a.enabled(), false);
}

// 7.2 开启后 enabled 为真，开关会写存储
{
    const h = makeAutoRun({ stored: { unrivalAutoRun: '1' } });
    t('存储里有 1 时托管模式开启', h.a.enabled(), true);
    h.a.setEnabled(false);
    t('关闭后存储写 0', h.st.unrivalAutoRun, '0');
    t('关闭后 enabled 为假', h.a.enabled(), false);
}

// 7.3 chapterDone：任务没做完就不算做完
{
    const h = makeAutoRun({
        missionList: { m1: { done: true }, m2: { done: false } }
    });
    t('还有任务没做完时不算完成', h.a.chapterDone(), false);
}
{
    const h = makeAutoRun({ stored: { unrivalAutoRun: '1' }, missionList: { m1: { done: true } } });
    t('任务都做完时算完成', h.a.chapterDone(), true);
}
{
    const h = makeAutoRun({ missionList: { m1: { done: true } }, busyThread: 1 });
    t('busyThread 不为 0 时不算完成', h.a.chapterDone(), false);
}

// 7.4 看门狗：只在章节列表页启动
{
    const h = makeAutoRun({});
    t('章节列表页启动了看门狗', h.intervals.length, 1);
    t('看门狗间隔 20 秒', h.intervals[0].ms, 20000);
}
{
    const h = makeAutoRun({ loc: { href: 'https://x.chaoxing.com/mooc-ans/work/doHomeWorkNew' } });
    t('非章节列表页不启动看门狗', h.intervals.length, 0);
}

// 7.5 看门狗行为：本章做完 → 请求跳章；没做完 → 不动
{
    const h = makeAutoRun({ stored: { unrivalAutoRun: '1' }, missionList: { m1: { done: true } } });
    h.a._watchTick();
    t('本章做完后会请求跳到下一节', h.win.jump, true);
    t('重试计数加一', h.a._tries, 1);
}
{
    const h = makeAutoRun({ missionList: { m1: { done: false } } });
    h.a._watchTick();
    t('本章没做完时不请求跳章', h.win.jump, false);
    t('没做完时不算重试', h.a._tries, 0);
}
{
    const h = makeAutoRun({ stored: { unrivalAutoRun: '1' }, missionList: { m1: { done: true } }, pauseCtl: { isPaused: function () { return true; } } });
    h.a._watchTick();
    t('用户暂停时不催', h.win.jump, false);
}
{
    const h = makeAutoRun({ stored: { unrivalAutoRun: '1' }, missionList: { m1: { done: true } }, jumpType: 2 });
    h.a._watchTick();
    t('「不跳转」模式下不催', h.win.jump, false);
}
{
    const h = makeAutoRun({ stored: { unrivalAutoRun: '1' }, missionList: { m1: { done: true } } });
    h.a._watchTick();
    t('重试会写日志说明原因', h.logLines.length >= 1, true);
    t('日志里点明是托管模式', h.logLines[0][0].indexOf('全程托管') >= 0, true);
}
{
    // 限频：连续重试时不该刷屏
    const h = makeAutoRun({ stored: { unrivalAutoRun: '1' }, missionList: { m1: { done: true } } });
    h.a._watchTick();
    h.a._watchTick();
    h.a._watchTick();
    t('连续重试时日志被限频', h.logLines.length, 1);
}

// 7.6 托管模式关闭时看门狗不动
{
    const h = makeAutoRun({ stored: { unrivalAutoRun: '0' }, missionList: { m1: { done: true } } });
    h.a._watchTick();
    t('托管模式关闭时看门狗不动', h.win.jump, false);
}

console.log('\n----------------------------------------');
console.log(`结果: 通过 ${pass} 项，失败 ${fail} 项`);
console.log('----------------------------------------');
process.exit(fail === 0 ? 0 : 1);
