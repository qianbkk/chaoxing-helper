// =============================================================================
// v16-module.test.js —— v1.6 四项改动的单测
//   ① 题库熔断状态持久化
//   ② 未支持任务类型不再静默跳过（打出类型 + 自动暂停）
//   ③ 面板标题 / 元数据说清楚 + 冗余说明精简 + 移除无效的阅读保活选项
//   ④ 面板折叠 + 限高滚动条
// 运行：node tests/v16-module.test.js
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
console.log('\n=== 1) 题库熔断：状态持久化，跨翻章保持 ===');
t('存在 ctLoadState', src.includes('var ctLoadState = function ()'), true);
t('存在 ctSaveState', src.includes('var ctSaveState = function ()'), true);
t('失败计数写入存储 unrivalCtFail', src.includes("GM_setValue('unrivalCtFail', String(aiState.ctFail))"), true);
t('熔断截止时间写入存储 unrivalCtOffUntil', src.includes("GM_setValue('unrivalCtOffUntil', String(aiState.ctOffUntil))"), true);
t('加载时读回失败计数', src.includes("aiState.ctFail = parseInt(GM_getValue('unrivalCtFail', '0'), 10) || 0;"), true);
t('加载时读回熔断截止时间', src.includes("aiState.ctOffUntil = parseInt(GM_getValue('unrivalCtOffUntil', '0'), 10) || 0;"), true);
t('模块加载即恢复状态', src.includes('ctLoadState();'), true);
t('成功后清零失败计数', src.includes('aiState.ctFail = 0;'), true);
t('成功后持久化状态', /ctSuccess = function \(\) \{[\s\S]{0,200}ctSaveState\(\);/.test(src), true);
t('提示语说明跨翻章保持', src.includes('该状态跨翻章保持'), true);
t('旧的「本轮」措辞已移除', src.includes("' 次，本轮("), false);

// =============================================================================
console.log('\n=== 2) 未支持的任务类型不再静默跳过 ===');
t('打出任务类型', src.includes("'未支持的任务（' + jobType + '）：' + jobName"), true);
t('日志含任务类型', src.includes("'未支持的任务类型 [' + jobType + ']：'"), true);
t('日志说明脚本无法自动完成', src.includes('脚本无法自动完成（直播要人工看、阅读要人工读）'), true);
t('日志说明已停止自动翻章', src.includes('已停止自动翻章：请人工处理完这一章后，在「任务配置」点「开始/继续」'), true);
t('自动调用 pauseCtl.set(true)', src.includes("if (typeof pauseCtl != 'undefined') pauseCtl.set(true);"), true);
//v1.11：「已跳过」文案只出现在「全程托管」分支里，默认行为仍是停下等人工
t('跳过文案只在托管分支出现一次', (src.match(/'已跳过（'/g) || []).length, 1);

// =============================================================================
console.log('\n=== 3) 面板标题 / 元数据 / 说明精简 ===');
t('@name 改为超星学习通小助手（AI 版）', src.includes('// @name          超星学习通小助手（AI 版）'), true);
t('@author 标注 qianbkk', src.includes('// @author       qianbkk'), true);
t('@version 为 1.11.1-AI', src.includes('// @version      1.11.1-AI'), true);
t('旧的 v1.0 标题已移除', src.includes('学习通小助手v1.0(不能答题填token)'), false);
t('页面标题不再写死版本号（v1.8 改为运行时动态填）', src.includes('<title>超星学习通小助手（AI 版）</title>'), true);
t('大标题带 id=unrivalTitle（布局模块靠它定位面板）', src.includes('id="unrivalTitle"'), true);
t('大标题标注作者 qianbkk', src.includes('>qianbkk</span>'), true);
t('移除「阅读/图书任务页保活」勾选框', src.includes('id="unrivalExKeep"'), false);
t('回填代码对已移除控件做空值保护', src.includes("var _exKeepEl = _d.getElementById('unrivalExKeep');"), true);
t('保存代码对已移除控件做空值保护', src.includes("var _exKeepEl2 = _d.getElementById('unrivalExKeep');"), true);
//v1.10.0：面板重排后，各面板顶端的灰色说明段落全部去掉（只保留调试面板一行必要的用法说明）
t('章节测验面板的说明段落已去掉', src.includes('链路：题库 → AI → 随机兜底'), false);
t('运行控制不再单独成块（说明段落与面板一起并入任务配置）', src.includes('一键停掉自动翻章 / 作答 / 提交'), false);
t('调试面板保留一行必要的用法说明', src.includes('仅开发时使用：需先在本机运行 log-sink（端口 8124）'), true);
t('不再出现「这三项由上游整理而来」', src.includes('这三项由上游整理而来'), false);

// =============================================================================
console.log('\n=== 4) 面板折叠 + 限高滚动条 ===');
t('存在布局模块起始标记（v1.8 已替换 v1.6 版）', src.includes('//==================== v1.8 面板布局整理开始 ===================='), true);
t('存在布局模块结束标记', src.includes('//==================== v1.8 面板布局整理结束 ===================='), true);
t('旧的 v1.6 布局模块已移除', src.includes('//==================== v1.6 面板布局整理开始 ===================='), false);
t('注入折叠样式 .unrival-collapsed', src.includes('.unrival-collapsed > .panel-body { display:none; }'), true);
t('注入折叠箭头样式', src.includes('.unrival-arrow'), true);
t('日志区限高 260px', src.includes('#result { max-height:260px; overflow-y:auto; }'), true);
t('任务列表限高 220px', src.includes('#joblist { max-height:220px; overflow-y:auto; }'), true);
t('布局模块给标题加折叠箭头', src.includes("arrow.className = 'unrival-arrow';"), true);
t('布局模块只处理自己注入的面板', src.includes("_d.getElementById('unrivalTitle')"), true);
t('章节测试面板高度 1000 → 520', src.includes("id='workPanel' style=\"display: none;height: 520px;\""), true);
t('章节测试面板不再 1000px', src.includes('height: 1000px;'), false);

console.log('\n----------------------------------------');
console.log(`结果: 通过 ${pass} 项，失败 ${fail} 项`);
console.log('----------------------------------------');
process.exit(fail === 0 ? 0 : 1);
