// =============================================================================
// serve-dist.test.js —— 本机发布件服务（serve-dist.cjs）单测
//   ① 产出脚本里的结构断言（元数据声明了 @updateURL/@downloadURL）
//   ② 服务行为：任意历史版本名的 .user.js 与 .meta.js 都能拉到当前发布件
//   ③ 关键回归点：删掉 dist/ 里的旧发布件后，「检查更新」不能因此失败
//   运行：node tests/serve-dist.test.js
// =============================================================================
//
// 【为什么要单独测这个】
//   ScriptCat 把脚本的「来源地址」记成安装时那个带版本号的 URL
//   （如 …-v1.8.1.user.js）。点「检查更新」时它会：
//     ① 把来源地址的 user.js 换成 meta.js 去拉元数据；
//     ② 若失败，回退到原始来源地址再拉一次。
//   所以 dist/ 里只留当前发布件（项目规矩）时，服务必须能回答
//   「任意历史版本名」的这两个地址 —— 否则旧版本名一律 404，
//   界面就显示「检查更新失败」。
//   这是一条**极易被目录清理破坏**的链路，所以专门固化测试。
// =============================================================================
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const file = path.join(root, 'dist', 'chaoxing-helper.user.js');
const serveFile = path.join(root, 'src', 'tools', 'serve-dist.cjs');

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
t('服务脚本存在', fs.existsSync(serveFile), true);
const check = spawnSync('node', ['--check', serveFile], { encoding: 'utf8' });
t('服务脚本语法校验通过', check.status, 0);

t('脚本声明了 @updateURL', src.includes('// @updateURL    https://cdn.jsdelivr.net/gh/qianbkk/chaoxing-helper@main/dist/chaoxing-helper.meta.js'), true);
t('脚本声明了 @downloadURL', src.includes('// @downloadURL  https://cdn.jsdelivr.net/gh/qianbkk/chaoxing-helper@main/dist/chaoxing-helper.user.js'), true);

// =============================================================================
console.log('\n=== 2) 服务行为 ===');

function req(port, path_) {
    return new Promise((resolve, reject) => {
        const r = http.request({ host: '127.0.0.1', port: port, path: path_, method: 'GET' }, (res) => {
            let buf = '';
            res.on('data', c => buf += c);
            res.on('end', () => resolve({ status: res.statusCode, body: buf, headers: res.headers }));
        });
        r.on('error', reject);
        r.end();
    });
}

(async function () {
    const child = spawn('node', [serveFile, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const port = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('服务启动超时: ' + out)), 8000);
        child.stdout.on('data', d => {
            out += d.toString();
            const m = out.match(/LISTEN (\d+)/);
            if (m) { clearTimeout(timer); resolve(parseInt(m[1], 10)); }
        });
        child.on('error', reject);
    });
    t('服务启动', port > 0, true);

    const curVer = (src.match(/@version\s+(\S+)/) || [])[1];

    // ---- 2.1 稳定地址 ----
    const latestUser = await req(port, '/latest.user.js');
    t('GET /latest.user.js 返回 200', latestUser.status, 200);
    t('/latest.user.js 是完整脚本', latestUser.body.includes('// ==/UserScript==') && latestUser.body.length > 10000, true);
    t('/latest.user.js 的 Content-Type 是 JS', String(latestUser.headers['content-type']).includes('javascript'), true);

    const latestMeta = await req(port, '/latest.meta.js');
    t('GET /latest.meta.js 返回 200', latestMeta.status, 200);
    t('/latest.meta.js 含 ==UserScript== 块', latestMeta.body.includes('// ==UserScript=='), true);
    t('/latest.meta.js 能被 ScriptCat 的 HEADER_BLOCK 规则匹配',
        /\/\/[ \t]*==User(Script|Subscribe)==([\s\S]+?)\/\/[ \t]*==\/User\1==/.test(latestMeta.body), true);
    t('/latest.meta.js 的 @version 是当前版本', (latestMeta.body.match(/@version\s+(\S+)/) || [])[1], curVer);

    // ---- 2.2 回归点：任意历史版本名都要能拉到 ----
    // 这是「dist 只留当前发布件」与「原生更新器」共存的前提
    const historic = [
        '超星学习通小助手-AI版-v1.8.1.user.js',
        '超星学习通小助手-AI版-v1.8.1.meta.js',
        '超星学习通小助手-AI版-v1.8.0.user.js',
        '超星学习通小助手-AI版-v1.8.0.meta.js',
        '超星学习通小助手-AI版-v1.7.0.user.js',
        '超星学习通小助手-AI版-v1.7.0.meta.js',
        '完全无关的名字.user.js',
        '完全无关的名字.meta.js'
    ];
    for (const h of historic) {
        const r = await req(port, '/' + encodeURIComponent(h));
        t('历史版本名可用: ' + h, r.status, 200);
        t('  └ 返回的是当前版本: ' + h, (r.body.match(/@version\s+(\S+)/) || [])[1], curVer);
    }

    // ---- 2.3 其它路径 ----
    const rootPage = await req(port, '/');
    t('GET / 返回状态页', rootPage.status, 200);
    t('状态页列出当前发布件', rootPage.body.includes(curVer), true);
    const readme = await req(port, '/README.md');
    t('GET /README.md 返回 200（真实文件照常提供）', readme.status, 200);
    const notFound = await req(port, '/' + encodeURIComponent('不存在.txt'));
    t('不存在的非脚本文件返回 404', notFound.status, 404);

    child.kill();

    console.log('\n----------------------------------------');
    console.log(`结果: 通过 ${pass} 项，失败 ${fail} 项`);
    console.log('----------------------------------------');
    process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
    console.error('\n测试异常：' + (err && err.stack || err));
    process.exit(1);
});
