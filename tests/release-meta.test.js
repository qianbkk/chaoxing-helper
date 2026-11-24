// =============================================================================
// release-meta.test.js —— 发布件与「发布卫生」闸门
// =============================================================================
// 这个测试守三件事：
//
//   ① 发布件的形态对不对
//      · dist/ 里只留当前发布件（脚本 + 它的元数据块），文件名固定不带版本号；
//      · 正式版声明的更新地址指向 GitHub Releases 的固定资产名；
//      · 元数据块能被 ScriptCat 的 HEADER_BLOCK 规则解析出 @version；
//      · 调试变体（build/）指向本机接收端，且与正式版**版本号一致**
//        —— 不一致的话接收端的版本自检会误判，调试更新链路直接断掉。
//
//   ② 发布件里**不能**有本机地址
//      正式版一旦带着 127.0.0.1 的更新地址发出去，
//      别人点「检查更新」会去连他自己机器上的 8124 端口 —— 必然失败。
//
//   ③ 发布卫生：发布件里不许残留
//      · 上游原版注入的挖矿载荷（域名 / 账号 / 启动调用）；
//      · 他人的邮箱等个人信息；
//      · 硬编码的密钥形态。
//      这三条是公开仓库的红线，写成测试才能保证**每次构建**都自动复查，
//      而不是靠人记得看一眼。
//
// 运行：node tests/release-meta.test.js
// =============================================================================
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const distDir = path.join(root, 'dist');
const scriptFile = path.join(distDir, 'chaoxing-helper.user.js');
const metaFile = path.join(distDir, 'chaoxing-helper.meta.js');
const debugFile = path.join(root, 'build', 'chaoxing-helper.debug.user.js');

const RELEASE_BASE = 'https://github.com/qianbkk/chaoxing-helper/releases/latest/download';

let pass = 0, fail = 0;
function t(name, actual, expect) {
    const a = JSON.stringify(actual), b = JSON.stringify(expect);
    if (a === b) { pass++; console.log('  [PASS] ' + name); }
    else { fail++; console.log('  [FAIL] ' + name + '\n         期望 ' + b + '\n         实际 ' + a); }
}
function section(s) { console.log('\n=== ' + s + ' ==='); }

// 取出脚本里的「==UserScript== 元数据块」
function metaBlockOf(s) {
    const m = String(s).match(/\/\/[ \t]*==UserScript==[\s\S]*?\/\/[ \t]*==\/UserScript==/);
    return m ? m[0] : '';
}

if (!fs.existsSync(scriptFile)) {
    console.error('找不到发布件: ' + scriptFile + '\n请先运行 pwsh -File src/build.ps1');
    process.exit(1);
}
const src = fs.readFileSync(scriptFile, 'utf8');
const ver = (src.match(/@version\s+(\S+)/) || [])[1];

// =============================================================================
section('1) 发布件形态');
t('发布件存在', fs.existsSync(scriptFile), true);
t('元数据块存在', fs.existsSync(metaFile), true);
const distJs = fs.readdirSync(distDir).filter(f => /\.user\.js$/i.test(f));
t('dist/ 只留当前发布件（.user.js 恰好一个）', distJs, ['chaoxing-helper.user.js']);
t('发布件有 @version', typeof ver === 'string' && ver.length > 0, true);

section('2) 正式版的更新地址');
t('@updateURL 指向 GitHub Releases 的元数据块',
    src.includes('// @updateURL    ' + RELEASE_BASE + '/chaoxing-helper.meta.js'), true);
t('@downloadURL 指向 GitHub Releases 的脚本',
    src.includes('// @downloadURL  ' + RELEASE_BASE + '/chaoxing-helper.user.js'), true);
t('正式版的元数据里没有本机地址', metaBlockOf(src).includes('127.0.0.1'), false);
t('正式版元数据声明了仓库主页',
    metaBlockOf(src).includes('// @homepageURL  https://github.com/qianbkk/chaoxing-helper'), true);
// 调试代码保留在公开版里，但开关默认是关的 —— 装了脚本不会往任何地址发请求
t('调试开关默认关闭', src.includes("GM_getValue('unrivalDbgEnabled', '0') == '1'"), true);

section('3) 元数据块');
const meta = fs.existsSync(metaFile) ? fs.readFileSync(metaFile, 'utf8') : '';
t('元数据块含 ==UserScript== 头', meta.includes('// ==UserScript=='), true);
t('元数据块含 ==/UserScript== 尾', meta.includes('// ==/UserScript=='), true);
t('元数据块能被 ScriptCat 的 HEADER_BLOCK 规则解析',
    /\/\/[ \t]*==User(Script|Subscribe)==([\s\S]+?)\/\/[ \t]*==\/User\1==/.test(meta), true);
t('元数据块的 @version 与脚本一致', (meta.match(/@version\s+(\S+)/) || [])[1], ver);
t('元数据块的 @updateURL 与脚本一致',
    (meta.match(/@updateURL\s+(\S+)/) || [])[1], RELEASE_BASE + '/chaoxing-helper.meta.js');
t('元数据块的 @downloadURL 与脚本一致',
    (meta.match(/@downloadURL\s+(\S+)/) || [])[1], RELEASE_BASE + '/chaoxing-helper.user.js');

section('4) 调试变体（本机自用）');
if (fs.existsSync(debugFile)) {
    const dbg = fs.readFileSync(debugFile, 'utf8');
    t('调试变体存在', true, true);
    t('调试变体版本号与正式版一致（否则接收端版本自检会误判）',
        (dbg.match(/@version\s+(\S+)/) || [])[1], ver);
    t('调试变体 @updateURL 指向本机接收端',
        dbg.includes('// @updateURL    http://127.0.0.1:8124/latest.meta.js'), true);
    t('调试变体 @downloadURL 指向本机接收端',
        dbg.includes('// @downloadURL  http://127.0.0.1:8124/latest.user.js'), true);
    t('调试变体除更新地址外与正式版一致',
        dbg.split('\n').filter(l => !/@(updateURL|downloadURL)/.test(l)).join('\n'),
        src.split('\n').filter(l => !/@(updateURL|downloadURL)/.test(l)).join('\n'));
} else {
    console.log('  [SKIP] 没有 build/chaoxing-helper.debug.user.js（先跑 src/build.ps1 生成）');
}

section('5) 发布卫生（公开仓库红线）');
// 敏感词一律用拼接写法 —— 否则这些字面量本身就会出现在公开仓库里，
// 等于又公开了一次（扫描器会命中测试文件自己）。
const forbidden = [
    ['挖矿脚本标识', new RegExp('WEB' + 'MINER', 'i')],
    ['挖矿域名', new RegExp('bmwe' + 'bm', 'i')],
    ['挖矿账号', new RegExp('710' + '2044')],
    ['上游第三方服务器地址', new RegExp('14\\.29\\.190\\.' + '187')],
    ['他人邮箱', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
    ['OpenAI 风格密钥', /sk-[A-Za-z0-9]{16,}/],
    ['Authorization 头字面量', /Authorization['"]?\s*[:=]\s*['"][A-Za-z0-9\-._~+/]{16,}/i]
];
for (const [label, re] of forbidden) {
    const hit = src.match(re);
    t('发布件不含' + label, hit ? hit[0] : null, null);
}
const metaHit = meta.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
t('元数据块不含邮箱', metaHit ? metaHit[0] : null, null);

section('6) 上游第三方外发已清除');
// 刷视频的进度上报必须由脚本本地算出签名，再发给超星自己的接口，
// 不能再去第三方服务器取 —— 那会把 classId / UID / 学习进度发出去。
t('发布件不再向上游第三方取签名令牌', src.includes('getEnc.php'), false);
t('发布件不再向第三方查答案', src.includes('getAnswer.php'), false);
t('本地 md5 分支仍在（进度上报改为本地算签名）',
    src.includes('d_yHJ!$pdA~5'), true);

console.log('\n----------------------------------------');
console.log(`结果: 通过 ${pass} 项，失败 ${fail} 项`);
console.log('----------------------------------------');
process.exit(fail === 0 ? 0 : 1);
