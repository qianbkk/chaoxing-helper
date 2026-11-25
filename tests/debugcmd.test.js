// =============================================================================
// debugcmd.test.js —— v1.7「调试命令通道」单测
//   ① 产出脚本里的结构断言
//   ② 命令执行器行为（沙箱跑真实模块代码）
//   ③ 接收端 /__cmd 往返：投递命令 → 取命令 → 取不到重复命令
// 运行：node tests/debugcmd.test.js
// =============================================================================
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const file = path.join(root, 'dist', 'chaoxing-helper.user.js');
const sinkFile = path.join(root, 'src', 'tools', 'log-sink.cjs');
const tmpDir = path.join(root, 'temp', 'logs-cmd-test');

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
t('@version 为 1.11.4-AI', src.includes('// @version      1.11.4-AI'), true);
t('存在命令通道起始标记', src.includes('//==================== v1.8.2 调试命令通道开始 ===================='), true);
t('存在命令通道结束标记', src.includes('//==================== v1.8.2 调试命令通道结束 ===================='), true);
t('轮询地址带 since 序号', src.includes("'/__cmd?since=' + this._seq"), true);
t('已执行序号持久化', src.includes("GM_setValue('unrivalDbgCmdSeq', String(self._seq))"), true);
t('支持 pause', src.includes("case 'pause':"), true);
t('支持 resume', src.includes("case 'resume':"), true);
t('支持 status', src.includes("case 'status':"), true);
t('支持 reload', src.includes("case 'reload':"), true);
t('支持 goto', src.includes("case 'goto':"), true);
t('支持 set', src.includes("case 'set':"), true);
t('支持 log', src.includes("case 'log':"), true);
t('支持 help', src.includes("case 'help':"), true);
t('支持 newversion 通知', src.includes("case 'newversion':"), true);
t('未开启调试模式不轮询', src.includes('if (!this.enabled() || this._busy) return;'), true);
t('面板说明提到远程操控', src.includes('并可用 POST /__cmd 远程操控脚本'), true);
t('调试日志章节上下文三路兜底', src.includes("if (!href) { try { href = String(_l && _l.href || ''); }"), true);
t('布局模块有折叠箭头自检日志', src.includes("dbg.log('info', '面板整理：已加折叠箭头 '"), true);

// =============================================================================
console.log('\n=== 2) 命令执行器行为（沙箱跑真实模块代码）===');
const s = src.indexOf('//==================== v1.8.2 调试命令通道开始 ====================');
const e = src.indexOf('//==================== v1.8.2 调试命令通道结束 ====================');
if (s < 0 || e < 0) { console.error('未找到命令通道标记'); process.exit(1); }
const mod = src.slice(s, e);

function makeCmd() {
    const stored = {};
    const st = { paused: false, jumped: null, reloaded: false, logs: [], requests: [], opened: [] };
    const GM_getValue = (k, d) => (k in stored ? stored[k] : d);
    const GM_setValue = (k, v) => { stored[k] = v; };
    const GM_xmlhttpRequest = (o) => { st.requests.push(o); };
    const factory = new Function(
        'GM_getValue', 'GM_setValue', 'GM_xmlhttpRequest', 'GM_info', 'console', 'setTimeout', 'clearTimeout',
        [
            'var __st = __STATE__;',
            //v1.8.2：GM_openInTab 定义在沙箱内，才能和断言读到的是同一个 __st
            'var GM_openInTab = function (u, o) { __st.opened.push(u); return {}; };',
            'var jumpType = 1, accuracy = 80, ctFailLimit = 3, ctFailCooldown = 600000;',
            "var courseId = '268157391', classId = '158789611';",
            "var aiState = { model: 'MiniMax-M3.1-Flash', baseUrl: 'https://api.minimaxi.cn/v1', key: 'k', ctFail: 2, ctOffUntil: Date.now() + 60000 };",
            'var workAuto = { cfg: { enable: true, submit: true } };',
            'var pauseCtl = { isPaused: function () { return __st.paused; }, set: function (v) { __st.paused = v; } };',
            //v1.8：调试命令的 set jumpType 改走独立的翻章模式模块（真实实现见 src/modules/jumptype.v1.8.js）
            'var jumpMode = { get: function () { return "1"; }, set: function (v) { return (String(v) === "2") ? "2" : "1"; } };',
            "var dbg = { cfg: { enabled: true }, log: function (lv, m) { __st.logs.push(lv + ':' + m); } };",
            "var _w = { getTeacherAjax: function (c, cl, cid) { __st.jumped = cid; }, location: { href: 'http://x/' } };",
            "var location = { href: 'https://mooc1-2.chaoxing.com/mooc-ans/mycourse/studentstudy?chapterId=1266095428', reload: function () { __st.reloaded = true; } };",
            //v1.8.2：dump 探针要读页面数据，这里给一份最小的超星页数据结构
            'var param = JSON.stringify({ attachments: [{ type: "live", job: true, isPassed: false, jobid: "m1", property: { name: "形势与政策 第一次直播", objectid: "o1" } }] });',
            "var _d = { title: '课程标题', getElementsByTagName: function (t) { return []; } };",
            'var missionList = { m1: { type: "video", name: "某个视频", done: false, running: true } };',
            mod,
            'return { c: dbgCmd, st: __st, get: function () { return { jumpType: jumpType, accuracy: accuracy, ctFailLimit: ctFailLimit }; } };'
        ].join('\n').replace('__STATE__', JSON.stringify({ paused: false, jumped: null, reloaded: false, logs: [], requests: [], opened: [] }))
    );
    const r = factory(GM_getValue, GM_setValue, GM_xmlhttpRequest, { script: { version: '1.11.2-AI' } }, console, setTimeout, clearTimeout);
    // 把沙箱里的状态对象换回来（JSON 序列化会丢函数）
    r.c.__st = st;
    return r;
}

// 2.1 status：把状态写进日志
{
    const r = makeCmd();
    r.c.exec({ cmd: 'status' });
    const line = r.st.logs.join('\n');
    t('status 写入日志', r.st.logs.length > 0, true);
    t('status 含版本', line.includes('版本=1.11.2-AI'), true);
    t('status 含 chapterId', line.includes('chapterId=1266095428'), true);
    t('status 含暂停状态', line.includes('暂停=否'), true);
    t('status 含题库熔断计数', line.includes('题库熔断=2/3'), true);
    t('status 含正确率门槛', line.includes('正确率门槛=80'), true);
}

// 2.2 pause / resume
{
    const r = makeCmd();
    r.c.exec({ cmd: 'pause' });
    t('pause 置位暂停', r.st.paused, true);
    r.c.exec({ cmd: 'resume' });
    t('resume 解除暂停', r.st.paused, false);
}

// 2.3 set accuracy / jumpType
{
    const r = makeCmd();
    r.c.exec({ cmd: 'set accuracy 90' });
    t('set accuracy 生效', r.get().accuracy, 90);
    r.c.exec({ cmd: 'set jumpType 2' });
    t('set jumpType 生效', r.get().jumpType, 2);
    r.c.exec({ cmd: 'set unknownKey 1' });
    t('未知键给提示', r.st.logs.join('\n').includes('未知键 unknownKey'), true);
}

// 2.4 goto：走超星自己的 getTeacherAjax
{
    const r = makeCmd();
    r.c.exec({ cmd: 'goto 1266095428' });
    t('goto 调到目标章节', r.st.jumped, '1266095428');
    r.c.exec({ cmd: 'goto cur1266095429' });
    t('goto 会去掉 cur 前缀', r.st.jumped, '1266095429');
}

// 2.5 log / help / newversion
{
    const r = makeCmd();
    r.c.exec({ cmd: 'log 打个标记' });
    t('log 写进日志', r.st.logs.join('\n').includes('打个标记'), true);
    r.c.exec({ cmd: 'help' });
    t('help 列出命令', r.st.logs.join('\n').includes('可用命令'), true);
    r.c.exec({ cmd: 'newversion 1.8.0-AI http://127.0.0.1:8123/x.user.js' });
    t('newversion 给出升级提示', r.st.logs.join('\n').includes('发现新版本 1.8.0-AI'), true);
}

// 2.5.1 v1.8.2：newversion 兼容两种传参，并自动打开安装页
{
    const r = makeCmd();
    r.c.exec({ cmd: 'newversion 1.11.2-AI http://127.0.0.1:8124/latest.user.js' });
    let line = r.st.logs.join('\n');
    t('v1.8.2 字符串命令能解析出版本号', line.includes('发现新版本 1.11.2-AI'), true);
    t('v1.8.2 字符串命令能解析出安装地址', line.includes('http://127.0.0.1:8124/latest.user.js'), true);
    t('v1.8.2 自动打开安装页', r.st.opened.length >= 1, true);
    t('v1.8.2 打开的正是那个地址', r.st.opened[0], 'http://127.0.0.1:8124/latest.user.js');
}
{
    // 对象字段传参（v1.7 接收端的老格式）也要能解析
    const r = makeCmd();
    r.c.exec({ cmd: 'newversion', version: '1.8.3-AI', url: 'http://127.0.0.1:8124/other.user.js' });
    const line = r.st.logs.join('\n');
    t('v1.8.2 兼容对象字段传参（版本）', line.includes('发现新版本 1.8.3-AI'), true);
    t('v1.8.2 兼容对象字段传参（地址）', line.includes('http://127.0.0.1:8124/other.user.js'), true);
    t('v1.8.2 对象字段也自动打开安装页', r.st.opened.length >= 1, true);
}
{
    // 没有地址时只记日志，不去开空标签页
    const r = makeCmd();
    r.c.exec({ cmd: 'newversion' });
    t('v1.8.2 无地址时不打开安装页', r.st.opened.length, 0);
}

// 2.5.2 v1.8.2：dump 探针
{
    const r = makeCmd();
    r.c.exec({ cmd: 'dump' });
    const line = r.st.logs.join('\n');
    t('dump 有输出', line.includes('命令 dump'), true);
    t('dump 含 URL', line.includes('URL='), true);
    t('dump 含标题', line.includes('TITLE='), true);
    t('dump 含任务清单', line.includes('attachments='), true);
    t('dump 含阅读/直播链接', line.includes('阅读/直播链接='), true);
    t('dump 含 iframe', line.includes('iframe='), true);
    t('dump 含 missionList', line.includes('missionList='), true);
}

// 2.6 未知命令不炸
{
    const r = makeCmd();
    r.c.exec({ cmd: '不存在的命令' });
    t('未知命令给提示而不是抛异常', r.st.logs.join('\n').includes('不认识'), true);
}

// =============================================================================
console.log('\n=== 3) 接收端 /__cmd 往返 ===');
const check = spawnSync('node', ['--check', sinkFile], { encoding: 'utf8' });
t('接收端语法校验通过', check.status, 0);

function req(method, path_, port, body) {
    return new Promise((resolve, reject) => {
        const data = body == null ? null : JSON.stringify(body);
        const r = http.request({
            host: '127.0.0.1', port: port, path: path_, method: method,
            headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
        }, (res) => {
            let buf = '';
            res.on('data', c => buf += c);
            res.on('end', () => resolve({ status: res.statusCode, body: buf }));
        });
        r.on('error', reject);
        if (data) r.write(data);
        r.end();
    });
}

(async function () {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    const child = spawn('node', [sinkFile, '--port', '0', '--dir', tmpDir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const port = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('接收端启动超时: ' + out)), 8000);
        child.stdout.on('data', d => {
            out += d.toString();
            const m = out.match(/LISTEN (\d+)/);
            if (m) { clearTimeout(timer); resolve(parseInt(m[1], 10)); }
        });
        child.on('error', reject);
    });
    t('接收端启动', port > 0, true);

    const post = await req('POST', '/__cmd', port, { cmd: 'status' });
    t('POST /__cmd 返回 200', post.status, 200);
    const seq = JSON.parse(post.body).seq;
    t('返回命令序号', seq > 0, true);

    const got = await req('GET', '/__cmd?since=0', port);
    const obj = JSON.parse(got.body);
    t('GET /__cmd 返回 200', got.status, 200);
    t('取到刚投递的命令', obj.cmds.length >= 1 && obj.cmds[obj.cmds.length - 1].cmd === 'status', true);

    const got2 = await req('GET', '/__cmd?since=' + seq, port);
    t('按序号取不到重复命令', JSON.parse(got2.body).cmds.length, 0);

    const st = await req('GET', '/__status', port);
    const stObj = JSON.parse(st.body);
    t('GET /__status 返回 200', st.status, 200);
    t('状态里能看到发布件版本', Array.isArray(stObj.dist) && stObj.dist.length >= 1, true);
    t('状态里带检查更新地址', typeof stObj.updateUrl === 'string' && stObj.updateUrl.endsWith('/latest.meta.js'), true);
    t('状态里带下载地址', typeof stObj.downloadUrl === 'string' && stObj.downloadUrl.endsWith('/latest.user.js'), true);

    // ---- 3.1 ScriptCat 原生更新器用的两个固定地址 ----
    // v1.8.2：脚本元数据声明了 @updateURL / @downloadURL 指向这两个地址，
    // ScriptCat 抓 updateURL 时会拿返回内容去 parseMetadata()，
    // 所以必须返回「==UserScript== 元数据块」，不是 Greasy Fork 的 JSON。
    const metaRes = await req('GET', '/latest.meta.js', port);
    t('GET /latest.meta.js 返回 200', metaRes.status, 200);
    t('latest.meta.js 含 ==UserScript== 块', metaRes.body.includes('// ==UserScript=='), true);
    t('latest.meta.js 含 @version', /@version\s+\S+/.test(metaRes.body), true);
    t('latest.meta.js 能被 ScriptCat 的 HEADER_BLOCK 规则匹配',
        /\/\/[ \t]*==User(Script|Subscribe)==([\s\S]+?)\/\/[ \t]*==\/User\1==/.test(metaRes.body), true);

    const userRes = await req('GET', '/latest.user.js', port);
    t('GET /latest.user.js 返回 200', userRes.status, 200);
    t('latest.user.js 是完整脚本', userRes.body.includes('// ==/UserScript==') && userRes.body.length > 10000, true);

    // ---- 3.2 版本自检：脚本版本低于 dist/ 时应排入 newversion **字符串命令** ----
    // 这是 v1.7 的 bug 所在：原先发的是对象字段，脚本按字符串解析 → 参数全空。
    const oldVer = '0.0.1-AI';
    await req('POST', '/__log', port, { type: 'lines', v: oldVer, lines: [{ t: new Date().toISOString(), lv: 'info', msg: '版本自检触发' }] });
    const cmdsRes = await req('GET', '/__cmd?since=0', port);
    const cmds = JSON.parse(cmdsRes.body).cmds;
    const nv = cmds.find(c => String(c.cmd).startsWith('newversion'));
    t('版本低于发布件时会排入 newversion 命令', !!nv, true);
    t('newversion 是字符串命令（不是对象字段）', typeof nv.cmd, 'string');
    t('newversion 命令带版本号', /newversion\s+\d+\.\d+\.\d+/.test(nv.cmd), true);
    t('newversion 命令带安装地址', nv.cmd.includes('/latest.user.js'), true);

    child.kill();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    // 顺手把空的 temp/ 父目录也清掉，避免每次跑测试都在工作区留一个空壳
    try {
        const tempRoot = path.join(root, 'temp');
        if (fs.existsSync(tempRoot) && fs.readdirSync(tempRoot).length === 0) {
            fs.rmdirSync(tempRoot);
        }
    } catch (e) { /* 清理失败不影响测试结果 */ }

    console.log('\n----------------------------------------');
    console.log(`结果: 通过 ${pass} 项，失败 ${fail} 项`);
    console.log('----------------------------------------');
    process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
    console.error('\n测试异常：' + (err && err.stack || err));
    process.exit(1);
});
