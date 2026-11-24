// =============================================================================
// pause-module.test.js —— v1.5「运行控制（暂停/继续）」单测
//   ① 产出脚本里的结构断言（面板、按钮、workAuto 的暂停判断）
//   ② 暂停控制模块的行为断言（沙箱里跑真实模块代码）
// 运行：node tests/pause-module.test.js
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

if (!fs.existsSync(file)) {
    console.error('找不到发布件: ' + file + '\n请先运行 pwsh -File src/build.ps1');
    process.exit(1);
}
const src = fs.readFileSync(file, 'utf8');

// =============================================================================
console.log('\n=== 1) 结构断言 ===');
t('存在暂停模块起始标记', src.includes('//==================== v1.5 暂停控制模块开始 ===================='), true);
t('存在暂停模块结束标记', src.includes('//==================== v1.5 暂停控制模块结束 ===================='), true);
t('面板含暂停按钮 pauseToggleButton', src.includes("id='pauseToggleButton'"), true);
t('面板含状态文本 pauseStatusText', src.includes('id="pauseStatusText"'), true);
//v1.10.0：运行控制不再单独成块，按钮并进「任务配置」
t('运行控制不再单独成块（pausePanel 已移除）', src.includes('id="pausePanel"'), false);
t('任务配置里有「开始/继续」按钮 pauseStartButton', src.includes("id='pauseStartButton'"), true);
t('两个按钮的绑定都存在', src.includes("_d.getElementById('pauseStartButton').onclick = function () {") && src.includes("_d.getElementById('pauseToggleButton').onclick = function () {"), true);
t('暂停按钮写持久化状态', src.includes('pauseCtl.set(true);'), true);
t('继续按钮写持久化状态', src.includes('pauseCtl.set(false);'), true);
t('持久化键为 unrivalPaused', src.includes("KEY: 'unrivalPaused'"), true);
t('暂停时把 jumpType 压成 2', src.includes('jumpType = 2;'), true);
t('拦截上游写 _w.jump = true', src.includes("Object.defineProperty(_w, 'jump'"), true);
t('workAuto 开局判断暂停', src.includes("aiLog('已暂停：本次不自动作答', 'orange');"), true);
t('workAuto 逐题之间判断暂停', src.includes("aiLog('已暂停：停止自动作答（已作答的题目保留）', 'orange');"), true);
t('workAuto 提交前判断暂停', src.includes("aiLog('已暂停：不自动提交', 'orange');"), true);
t('workAuto 里的暂停判断共 3 处', (src.match(/pauseCtl\.isPaused\(\)/g) || []).length >= 3, true);

// =============================================================================
console.log('\n=== 2) 暂停控制模块行为（沙箱跑真实模块代码）===');
const s = src.indexOf('//==================== v1.5 暂停控制模块开始 ====================');
const e = src.indexOf('//==================== v1.5 暂停控制模块结束 ====================');
if (s < 0 || e < 0) { console.error('未找到暂停模块标记'); process.exit(1); }
const mod = src.slice(s, e);

function makeCtl(stored) {
    const st = Object.assign({ unrivaljumpType: '1' }, stored || {});
    const setCalls = [];
    const GM_getValue = (k, d) => (k in st ? st[k] : d);
    const GM_setValue = (k, v) => { st[k] = v; setCalls.push([k, v]); };
    const logsObj = { logArry: [], addLog: function () { this.logArry.push('log'); } };
    const win = { jump: false, top: null };
    win.top = win;
    const factory = new Function(
        'GM_getValue', 'GM_setValue', 'logs', '_w', 'console', 'setTimeout', 'clearTimeout',
        'var jumpType = 1;\n' + mod + '\nreturn { ctl: pauseCtl, getJumpType: function () { return jumpType; } };'
    );
    const r = factory(GM_getValue, GM_setValue, logsObj, win, console, setTimeout, clearTimeout);
    return { ctl: r.ctl, getJumpType: r.getJumpType, win: win, st: st, setCalls: setCalls };
}

// 2.1 默认不暂停
{
    const h = makeCtl();
    t('默认不处于暂停', h.ctl.isPaused(), false);
    t('默认 jumpType 保持原值', h.getJumpType(), 1);
}

// 2.2 点「暂停」：持久化 + jumpType 压成 2
{
    const h = makeCtl();
    h.ctl.set(true);
    t('暂停后 isPaused 为真', h.ctl.isPaused(), true);
    t('暂停状态已持久化', h.st.unrivalPaused, '1');
    t('暂停后 jumpType 被压成 2', h.getJumpType(), 2);
}

// 2.3 暂停后上游写 _w.jump = true 会被拦掉（自动翻章停住）
{
    const h = makeCtl();
    h.ctl.set(true);
    h.win.jump = true;
    t('暂停时 _w.jump = true 被忽略', h.win.jump, false);
}

// 2.4 点「继续」：恢复原翻章模式，且允许再跳章
{
    const h = makeCtl({ unrivaljumpType: '1' });
    h.ctl.set(true);
    h.ctl.set(false);
    t('继续后 isPaused 为假', h.ctl.isPaused(), false);
    t('继续后恢复为遍历模式(1)', h.getJumpType(), 1);
    h.win.jump = true;
    t('继续后 _w.jump = true 生效', h.win.jump, true);
}

// 2.5 继续时尊重用户原本选的「不跳转」
{
    const h = makeCtl({ unrivaljumpType: '2' });
    h.ctl.set(true);
    h.ctl.set(false);
    t('原本是不跳转模式时恢复为 2', h.getJumpType(), 2);
}

// 2.6 刷新页面后仍是暂停（状态从存储恢复）
{
    const h = makeCtl({ unrivalPaused: '1' });
    t('加载即识别为暂停', h.ctl.isPaused(), true);
    t('加载即把 jumpType 压成 2', h.getJumpType(), 2);
    h.win.jump = true;
    t('加载后仍拦掉 _w.jump = true', h.win.jump, false);
}

console.log('\n----------------------------------------');
console.log(`结果: 通过 ${pass} 项，失败 ${fail} 项`);
console.log('----------------------------------------');
process.exit(fail === 0 ? 0 : 1);
