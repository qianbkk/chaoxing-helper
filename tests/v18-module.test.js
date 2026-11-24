// =============================================================================
// v18-module.test.js —— v1.8 五项反馈改动的单测
//   ① 翻章模式存储隔离（脚本「卡住不动」的根因修复）
//   ② 暂停导致的停止提示单独成句
//   ③ 章节测试提交后回报真实成绩
//   ④ 运行日志跨章节堆积持久化
//   ⑤ 折叠重做 + 面板版本号动态化 + 去掉版本流水账
// 运行：node tests/v18-module.test.js
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
section('1) 翻章模式存储隔离：结构断言');
t('存在翻章模式模块起始标记', src.includes('//==================== v1.8 翻章模式存储隔离开始 ===================='), true);
t('存在翻章模式模块结束标记', src.includes('//==================== v1.8 翻章模式存储隔离结束 ===================='), true);
t('使用独立存储键 unrivalJumpTypeReal', src.includes("REAL_KEY: 'unrivalJumpTypeReal'"), true);
t('老键保留为镜像 unrivaljumpType', src.includes("LEGACY_KEY: 'unrivaljumpType'"), true);
t('初始化改读 jumpMode.get()', src.includes("jumpType = (jumpMode.get() === '2' ? 2 : 1)"), true);
t('面板回填改读 jumpMode.get()', src.includes("_d.getElementById('unrivalJumpType').value = jumpMode.get();"), true);
t('暂停恢复时同步下拉框读 jumpMode.get()', src.includes("_d.getElementById('unrivalJumpType').value = jumpMode.get();"), true);
t('保存设置改写 jumpMode.set()', src.includes("var _jtReal = jumpMode.set(_d.getElementById('unrivalJumpType').value);"), true);
t('远程命令 set jumpType 改写 jumpMode.set()', src.includes("var _jtCmd = jumpMode.set(val);"), true);
t('保存设置时暂停中不改动运行时翻章模式', src.includes("jumpType = (pauseCtl.isPaused()) ? 2 : (_jtReal === '2' ? 2 : 1);"), true);
t('远程命令时暂停中不改动运行时翻章模式', src.includes("jumpType = (pauseCtl.isPaused()) ? 2 : (_jtCmd === '2' ? 2 : 1);"), true);
t('旧的「把运行时值写回存储」写法已消失', src.includes("GM_setValue('unrivaljumpType', jumpType);"), false);
t('翻章模式模块排在 jumpType 初始化之前', src.indexOf('v1.8 翻章模式存储隔离开始') < src.indexOf("jumpType = (jumpMode.get() === '2' ? 2 : 1)"), true);

// =============================================================================
section('2) 翻章模式存储隔离：沙箱行为');
const jumpMod = sliceModule(
    '//==================== v1.8 翻章模式存储隔离开始 ====================',
    '//==================== v1.8 翻章模式存储隔离结束 ===================='
);

function makeJumpMode(stored) {
    const st = Object.assign({}, stored || {});
    const setCalls = [];
    const GM_getValue = (k, d) => (k in st ? st[k] : d);
    const GM_setValue = (k, v) => { st[k] = v; setCalls.push([k, v]); };
    const logsObj = { logArry: [], addLog: function (m) { this.logArry.push(m); } };
    const factory = new Function(
        'GM_getValue', 'GM_setValue', 'logs', 'console', 'setTimeout', 'clearTimeout',
        jumpMod + '\nreturn { m: jumpMode };'
    );
    const r = factory(GM_getValue, GM_setValue, logsObj, console, setTimeout, clearTimeout);
    return { m: r.m, st: st, setCalls: setCalls, logsObj: logsObj };
}

// 2.1 全新安装：默认遍历模式(1)，并把真实键写出来
{
    const h = makeJumpMode();
    t('默认返回遍历模式 1', h.m.get(), '1');
    t('真实键已写入', h.st.unrivalJumpTypeReal, '1');
    t('老键同步为镜像', h.st.unrivaljumpType, '1');
}

// 2.2 老键被暂停功能污染成 '2' → 自动修复回遍历，并留下提示
{
    const h = makeJumpMode({ unrivaljumpType: '2' });
    t('被污染的老键 2 被修复为遍历 1', h.m.get(), '1');
    t('修复后真实键为 1', h.st.unrivalJumpTypeReal, '1');
    t('修复后老键也被改回 1', h.st.unrivaljumpType, '1');
    t('留下了修复提示', h.m._note.length > 0, true);
    t('提示说明了原因', h.m._note.indexOf('误写') >= 0, true);
}

// 2.3 老键是 '1'：正常迁移，不产生修复提示
{
    const h = makeJumpMode({ unrivaljumpType: '1' });
    t('正常老键迁移为 1', h.m.get(), '1');
    t('正常老键不产生提示', h.m._note, '');
}

// 2.4 真实键已是 '2'（用户自己选的不跳转）→ 尊重用户设置，不覆盖
{
    const h = makeJumpMode({ unrivalJumpTypeReal: '2', unrivaljumpType: '2' });
    t('真实键为 2 时保持 2', h.m.get(), '2');
    t('真实键为 2 时不产生提示', h.m._note, '');
}

// 2.5 迁移只做一次：重复调用不会反复改写存储
{
    const h = makeJumpMode({ unrivaljumpType: '2' });
    h.m.get(); h.m.get(); h.m.get();
    const writes = h.setCalls.filter(c => c[0] === 'unrivalJumpTypeReal').length;
    t('真实键只写了一次', writes, 1);
}

// 2.6 set()：真实键 + 老键同时写入，且归一化非法值
{
    const h = makeJumpMode();
    t('set("2") 返回 2', h.m.set('2'), '2');
    t('set("2") 写真实键', h.st.unrivalJumpTypeReal, '2');
    t('set("2") 写老键镜像', h.st.unrivaljumpType, '2');
    t('set("abc") 归一化为 1', h.m.set('abc'), '1');
    t('set("abc") 后真实键为 1', h.st.unrivalJumpTypeReal, '1');
}

// 2.7 关键回归：暂停期间保存设置，不再污染真实设置
//     （模拟旧版的 bug：暂停中点「保存AI设置」→ 存储被写成 2 → 继续后仍不跳转）
{
    const h = makeJumpMode({ unrivalJumpTypeReal: '1', unrivaljumpType: '1' });
    h.m.set('1');
    t('暂停中保存后真实键仍是 1', h.st.unrivalJumpTypeReal, '1');
    t('暂停中保存后老键仍是 1', h.st.unrivaljumpType, '1');
}

// =============================================================================
section('3) 暂停导致的停止提示单独成句');
t('「所有任务处理完毕」有暂停分支', src.includes('所有任务处理完毕，已暂停：不跳转下一章，点「运行控制 → 继续」恢复'), true);
t('「此页无任务」有暂停分支', src.includes('此页无任务，已暂停：不跳转下一章，点「运行控制 → 继续」恢复'), true);
t('两个「此页无任务」分支都改了', (src.match(/此页无任务，已暂停：不跳转下一章/g) || []).length, 2);
t('非暂停时仍保留原提示', src.includes('用户设置为不跳转，脚本已结束运行'), true);

// =============================================================================
section('4) 章节测试提交后回报真实成绩');
t('存在提交结果模块起始标记', src.includes('//==================== v1.8.1 章节测试提交结果回报开始 ===================='), true);
t('存在提交结果模块结束标记', src.includes('//==================== v1.8.1 章节测试提交结果回报结束 ===================='), true);
t('旧的 v1.8 提交结果模块已替换', src.includes('//==================== v1.8 章节测试提交结果回报开始 ===================='), false);
t('调用点存在', src.includes("workResult.report('章节测试'"), true);
t('iframe 的清空推迟到读完之后（回调里）', src.includes("workResult.report('章节测试', function () {"), true);
t('清空动作在回调里', src.includes("try { _d.getElementById('frame_content').src = ''; } catch (e2) { }"), true);
t('关键词包含正确率', src.includes("'正确率'"), true);
t('关键词包含成绩', src.includes("'成绩'"), true);
t('读不到会重试', src.includes('MAX_TRY: 7'), true);
t('重试间隔 400ms', src.includes('INTERVAL: 400'), true);
t('区分跨域/无 body/异常', src.includes('跨域，读不到 iframe 文档'), true);
t('有正文但没命中关键词时给首段文字', src.includes('页面正文里没找到成绩文字，首段是'), true);
t('只读取 DOM，不点按钮', src.includes('workResult.report'), true);

// =============================================================================
section('5) 运行日志跨章节堆积持久化');
t('存在日志持久化模块起始标记', src.includes('//==================== v1.8.1 运行日志持久化（跨翻章堆积）开始 ===================='), true);
t('存在日志持久化模块结束标记', src.includes('//==================== v1.8.1 运行日志持久化（跨翻章堆积）结束 ===================='), true);
t('旧的 v1.8 日志模块已替换', src.includes('//==================== v1.8 运行日志持久化（跨翻章堆积）开始 ===================='), false);
t('存储键为 unrivalLogHistory', src.includes("KEY: 'unrivalLogHistory'"), true);
t('上限 500 条', src.includes('MAX: 500'), true);
t('包装 logs.addLog', src.includes('logs.addLog = function (str, color) {'), true);
t('面板有清空日志按钮', src.includes("id='clearLogButton'"), true);
t('清空按钮绑定存在', src.includes("_d.getElementById('clearLogButton')"), true);
t('v1.8.1：日志倒序渲染（最新在最上）', src.includes('for (var i = this._lines.length - 1; i >= 0; i--)'), true);
t('v1.8.1：滚动停在顶部', src.includes('el.scrollTop = 0;'), true);
t('v1.8.1：不再滚到底部', src.includes('el.scrollTop = el.scrollHeight;'), false);

// —— 沙箱行为：包装 addLog 后日志进存储 ——
// =============================================================================
section('6) 运行日志持久化：沙箱行为');
const logMod = sliceModule(
    '//==================== v1.8.1 运行日志持久化（跨翻章堆积）开始 ====================',
    '//==================== v1.8.1 运行日志持久化（跨翻章堆积）结束 ===================='
);

{
    const st = {};
    const setCalls = [];
    const GM_getValue = (k, d) => (k in st ? st[k] : d);
    const GM_setValue = (k, v) => { st[k] = v; setCalls.push([k, v]); };
    const logsObj = { logArry: [], addLog: function (s) { this.logArry.push(s); } };
    const fakeLog = { innerHTML: '', scrollTop: 0, scrollHeight: 0 };
    const _d = { getElementById: (id) => (id === 'log' ? fakeLog : null) };
    // 立即执行的 setTimeout：让模块里带防抖的 save() 同步落库，测试结果可确定
    const fakeSetTimeout = (fn) => { fn(); return 0; };
    const factory = new Function(
        'GM_getValue', 'GM_setValue', 'logs', '_d', 'console', 'setTimeout', 'clearTimeout',
        logMod + '\nreturn { h: logHist };'
    );
    const r = factory(GM_getValue, GM_setValue, logsObj, _d, console, fakeSetTimeout, clearTimeout);

    logsObj.addLog('第一条', 'red');
    t('日志进了历史', r.h._lines.length, 1);
    t('历史记下了内容', r.h._lines[0].s, '第一条');
    t('历史记下了颜色', r.h._lines[0].c, 'red');
    t('面板已重绘', fakeLog.innerHTML.indexOf('第一条') >= 0, true);

    // 上限：超过 MAX 的丢最旧的
    for (let i = 0; i < 505; i++) logsObj.addLog('第' + i + '条', 'black');
    t('历史长度不超过上限', r.h._lines.length <= 500, true);
    t('最新一条还在', r.h._lines[r.h._lines.length - 1].s, '第504条');

    // 存储确实写了
    const wrote = setCalls.some(c => c[0] === 'unrivalLogHistory');
    t('写入了 GM 存储', wrote, true);

    // 清空
    r.h.clear();
    t('清空后历史为空', r.h._lines.length, 0);
    t('清空后存储被写空数组', st.unrivalLogHistory, '[]');

    // 合并写入：别的标签页先写进去的行，本页保存时不能被冲掉
    GM_setValue('unrivalLogHistory', JSON.stringify([{ t: '00:00:01', c: 'black', s: '另一个标签页的日志' }]));
    logsObj.addLog('本页的日志', 'black');
    const merged = JSON.parse(st.unrivalLogHistory);
    t('合并写入后保留对方标签页的日志', merged.some(l => l.s === '另一个标签页的日志'), true);
    t('合并写入后保留本页的日志', merged.some(l => l.s === '本页的日志'), true);
    t('合并写入不会产生重复行', merged.length, new Set(merged.map(l => l.t + '|' + l.c + '|' + l.s)).size);

    // v1.8.1：面板上最新的那条排在最上面
    r.h.clear();
    logsObj.addLog('第一条', 'black');
    logsObj.addLog('第二条', 'black');
    logsObj.addLog('第三条', 'black');
    const pos1 = fakeLog.innerHTML.indexOf('第一条');
    const pos2 = fakeLog.innerHTML.indexOf('第二条');
    const pos3 = fakeLog.innerHTML.indexOf('第三条');
    t('最新的那条排在最上面', pos3 < pos2 && pos2 < pos1, true);
}

// =============================================================================
section('7) 面板版本号动态化');
t('存在面板版本号模块起始标记', src.includes('//==================== v1.8 面板版本号动态化开始 ===================='), true);
t('存在面板版本号模块结束标记', src.includes('//==================== v1.8 面板版本号动态化结束 ===================='), true);
t('运行时从 GM_info 取版本', src.includes('GM_info.script.version'), true);
t('标题里有版本号占位', src.includes('<span id="unrivalVer">v?</span>'), true);
t('面板标题不再写死 v1.6', src.includes('<h3 id="unrivalTitle"'), true);
const h3Line = (src.split('\n').find(l => l.includes('id="unrivalTitle"')) || '');
t('大标题里不再写死版本号', h3Line.includes('v1.6'), false);
t('大标题里有版本号占位', h3Line.includes('id="unrivalVer"'), true);

// =============================================================================
section('8) 折叠 UI 重做 + 任务配置不折叠');
t('存在 v1.8 布局模块起始标记', src.includes('//==================== v1.8 面板布局整理开始 ===================='), true);
t('存在 v1.8 布局模块结束标记', src.includes('//==================== v1.8 面板布局整理结束 ===================='), true);
t('旧的 v1.6 布局模块已移除', src.includes('//==================== v1.6 面板布局整理开始 ===================='), false);
t('任务配置区块跳过折叠', src.includes("if (headText.indexOf('任务配置') >= 0) continue;"), true);
t('标题整行可点（加 cursor 类）', src.includes("unrival-clickable"), true);
t('箭头带底色', src.includes('background:#e4ebf1'), true);
t('箭头 hover 变色', src.includes('.unrival-arrow:hover'), true);
t('日志区限高 260px 保留', src.includes("logWrap.style.maxHeight = '260px'"), true);
t('任务列表限高 220px 保留', src.includes("joblist.style.maxHeight = '220px'"), true);
t('自检日志说明任务配置除外', src.includes('个（任务配置除外）'), true);

// =============================================================================
section('9) 去掉对普通用户无用的版本流水账');
const descLine = (src.split('\n').find(l => l.startsWith('// @description')) || '');
t('@description 存在', descLine.length > 0, true);
t('@description 不含 v1.4.2', descLine.includes('v1.4.2'), false);
t('@description 不含 v1.5', descLine.includes('v1.5'), false);
t('@description 不含 v1.6', descLine.includes('v1.6'), false);
t('@description 不含 v1.7', descLine.includes('v1.7'), false);
// v1.9.0：公开版描述里不再点名题库服务商（只说「题库」），机制本身没变
t('@description 仍说明题库+AI降级', descLine.includes('题库'), true);
t('@description 仍说明字体解密', descLine.includes('加密字体'), true);
t('面板标题不再带「（v1.4.2 · 已在真实超星页跑通全链路）」', src.includes('（v1.4.2 · 已在真实超星页跑通全链路）'), false);
t('面板标题不再带「（v1.5 · 暂停 / 继续）」', src.includes('（v1.5 · 暂停 / 继续）'), false);
t('面板标题不再带「（v1.5 · 日志实时落盘）」', src.includes('（v1.5 · 日志实时落盘）'), false);
t('面板标题保留「章节测验 / 作业自动作答」', src.includes('章节测验 / 作业自动作答'), true);
t('面板标题保留「运行控制」', src.includes('>运行控制<'), true);
t('面板标题保留「调试模式」', src.includes('>调试模式<'), true);

// =============================================================================
section('10) v1.8.1：章节测试「提交/保存」判定修正（3.2 没完成任务的根因）');
t('存在 DOM 作答统计函数', src.includes('var _workAnswerStat = function () {'), true);
t('存在兜底补齐函数', src.includes('var _workFillFallback = function (missing) {'), true);
t('以选项 class 含 cur 判定已作答', src.includes("indexOf('cur') >= 0"), true);
t('busyThread 判断放宽为 > 0', src.includes('if (busyThread > 0) {'), true);
t('旧的 != 0 判断已移除', src.includes('if (busyThread != 0) {'), false);
t('完成率以 DOM 实况计算', src.includes('Math.floor(_st.done * 100 / _st.total)'), true);
t('提交条件改用完成率', src.includes('_rate >= accuracy'), true);
t('旧的假正确率公式（提交分支）已移除', src.includes('Math.floor((totalQuestionNum - questionNum) / autoQuestionNum) * 100 >= accuracy && _w.top'), false);
t('旧的假正确率公式（保存分支）已移除', src.includes('Math.floor((totalQuestionNum - questionNum) / autoQuestionNum) * 100 > 0'), false);
t('没答完会继续等', src.includes('等答完再提交'), true);
t('等待上限 60 次', src.includes('_workWaitTicks <= 60'), true);
t('等待期间不清定时器、不跳走', src.includes('return;   //继续等，不清定时器、不跳走'), true);
t('等待超时用兜底补齐空题', src.includes('_workFillFallback(_st.missing);'), true);
t('补齐后重新统计', src.includes('_st = _workAnswerStat();'), true);
t('保存分支：跳走挪到保存之后', src.includes("setTimeout(function () { try { _w.top.jump = true; } catch (e) { } }, 1500);"), true);
t('保存分支：旧的先跳走写法已移除', src.includes("    _w.top.jump = true;\n    if (autoQuestionNum > 0 && Math.floor"), false);
t('旧的「正确率不符合标准…」文案已移除', src.includes('正确率不符合标准或未设置自动提交，已自动保存答案'), false);
t('新的保存文案带完成度', src.includes('章节测试已答完（完成度'), true);
t('提交文案带完成度', src.includes('正确率符合标准，已提交答案（完成度'), true);

// =============================================================================
section('11) v1.8.2：自主跟随更新 + dump 探针');
t('存在命令通道起始标记', src.includes('//==================== v1.8.2 调试命令通道开始 ===================='), true);
t('存在命令通道结束标记', src.includes('//==================== v1.8.2 调试命令通道结束 ===================='), true);
t('旧的 v1.7 命令通道已整体替换', src.includes('//==================== v1.7 调试命令通道开始 ===================='), false);
// —— 跟随更新：元数据 ——
t('声明了 @updateURL', src.includes('// @updateURL    https://github.com/qianbkk/chaoxing-helper/releases/latest/download/chaoxing-helper.meta.js'), true);
t('声明了 @downloadURL', src.includes('// @downloadURL  https://github.com/qianbkk/chaoxing-helper/releases/latest/download/chaoxing-helper.user.js'), true);
t('授权了 GM_openInTab', src.includes('// @grant        GM_openInTab'), true);
// —— 跟随更新：脚本侧 ——
t('newversion 命令兼容对象字段', src.includes('var _v = arg[0] || (c && c.version) || \'?\';'), true);
t('newversion 命令兼容对象字段（地址）', src.includes('var _u = arg[1] || (c && c.url) || \'\';'), true);
t('发现新版本后自动打开安装页', src.includes('GM_openInTab(_u, { active: true, insert: true });'), true);
t('打开失败时给出手动提示', src.includes('自动打开安装页失败'), true);
// —— 跟随更新：接收端（log-sink.cjs）——
const sinkSrc = fs.readFileSync(path.join(root, 'src', 'tools', 'log-sink.cjs'), 'utf8');
t('接收端发的是字符串命令', sinkSrc.includes("cmd: 'newversion ' + d.version + ' ' + downloadUrl"), true);
t('接收端不再发对象字段', sinkSrc.includes("cmd: 'newversion',"), false);
t('接收端用实际监听端口算更新地址', sinkSrc.includes("updateUrl = 'http://127.0.0.1:' + port + '/latest.meta.js'"), true);
t('接收端下载地址用实际端口', sinkSrc.includes("downloadUrl = 'http://127.0.0.1:' + port + '/latest.user.js'"), true);
t('接收端提供 /latest.meta.js', sinkSrc.includes("'/latest.meta.js'"), true);
t('接收端提供 /latest.user.js', sinkSrc.includes("'/latest.user.js'"), true);
t('接收端提取 ==UserScript== 元数据块', sinkSrc.includes('==UserScript==['), true);
// —— dump 探针 ——
t('支持 dump 命令', src.includes("case 'dump':"), true);
t('dump 有任务清单探针', src.includes('_probeTasks: function ()'), true);
t('dump 有链接探针', src.includes('_probeLinks: function ()'), true);
t('dump 有 iframe 探针', src.includes('_probeFrames: function ()'), true);
t('dump 有 missionList 探针', src.includes('_probeMissions: function ()'), true);
t('dump 输出任务类型与名字', src.includes("' type=' + it['type']"), true);
t('dump 输出 property 键名', src.includes("' prop=[' + keys.join(',') + ']'"), true);
t('help 里列出 dump', src.includes('/ dump / help'), true);
// —— 不倒退：远程命令 set jumpType 必须走独立键 ——
t('set jumpType 写独立键 jumpMode', src.includes('var _jtCmd = jumpMode.set(val);'), true);
t('set jumpType 不再直接写老键', src.includes("GM_setValue('unrivaljumpType', jumpType)"), false);
// —— 发布件服务：历史版本名必须可用（否则「检查更新」会失败）——
const serveSrc = fs.readFileSync(path.join(root, 'src', 'tools', 'serve-dist.cjs'), 'utf8');
t('发布件服务存在', fs.existsSync(path.join(root, 'src', 'tools', 'serve-dist.cjs')), true);
t('发布件服务把任意 .meta.js 指向当前发布件', serveSrc.includes('/\\.meta\\.js$/i.test(pathname)'), true);
t('发布件服务把任意 .user.js 指向当前发布件', serveSrc.includes('/\\.user\\.js$/i.test(pathname)'), true);
t('发布件服务用实际监听端口', serveSrc.includes('server.address().port'), true);

console.log('\n----------------------------------------');
console.log(`结果: 通过 ${pass} 项，失败 ${fail} 项`);
console.log('----------------------------------------');
process.exit(fail === 0 ? 0 : 1);