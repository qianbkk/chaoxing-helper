// =============================================================================
// debuglog.test.js —— v1.5「调试模式」单测
//   ① 产出脚本里调试模块与面板的结构断言
//   ② 调试模块的行为断言（沙箱里跑真实模块代码）
//   ③ 本机接收端 log-sink.cjs 的端到端往返测试（起进程 → POST → 落盘 → 读回）
// 运行：node tests/debuglog.test.js
// =============================================================================
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const file = path.join(root, 'dist', 'chaoxing-helper.user.js');
const sinkFile = path.join(root, 'src', 'tools', 'log-sink.cjs');
const tmpDir = path.join(root, 'temp', 'logs-test');

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
console.log('\n=== 1) 产出脚本的结构断言 ===');
t('@version 为 1.11.0-AI', src.includes('// @version      1.11.0-AI'), true);
t('存在调试模块起始标记', src.includes('//==================== v1.5 调试日志模块开始 ===================='), true);
t('存在调试模块结束标记', src.includes('//==================== v1.5 调试日志模块结束 ===================='), true);
t('元数据含 @connect *（本机接收端无需额外授权）', src.includes('// @connect      *'), true);
t('面板含调试开关 unrivalDbgEnabled', src.includes("id=\"unrivalDbgEnabled\""), true);
t('面板含接收端地址输入框 unrivalDbgSink', src.includes("id=\"unrivalDbgSink\""), true);
t('面板含保存按钮 saveDbgButton', src.includes("id='saveDbgButton'"), true);
t('面板含状态文本 dbgStatusText', src.includes("id=\"dbgStatusText\""), true);
t('保存按钮写 unrivalDbgEnabled', src.includes("GM_setValue('unrivalDbgEnabled'"), true);
t('保存按钮写 unrivalDbgSink', src.includes("GM_setValue('unrivalDbgSink'"), true);
t('面板回填调试开关', src.includes("_d.getElementById('unrivalDbgEnabled').checked = dbg.cfg.enabled;"), true);
t('面板回填接收端地址', src.includes("_d.getElementById('unrivalDbgSink').value = dbg.cfg.sink;"), true);

// =============================================================================
console.log('\n=== 2) 调试模块行为（沙箱跑真实模块代码）===');
const s = src.indexOf('//==================== v1.5 调试日志模块开始 ====================');
const e = src.indexOf('//==================== v1.5 调试日志模块结束 ====================');
if (s < 0 || e < 0) { console.error('未找到调试模块标记'); process.exit(1); }
const mod = src.slice(s, e);

function makeDbg(opt) {
    opt = opt || {};
    const stored = {
        unrivalDbgEnabled: opt.enabled ? '1' : '0',
        unrivalDbgSink: opt.sink || 'http://127.0.0.1:8124'
    };
    const sent = [];
    const logsObj = {
        logArry: (opt.prefill || []).slice(),
        addLog: function (str, color) {
            this.logArry.push("<span style='color: " + (color || 'black') + "'>[00:00:00] " + str + '</span>');
        }
    };
    const GM_getValue = (k, d) => (k in stored ? stored[k] : d);
    const GM_setValue = (k, v) => { stored[k] = v; };
    const GM_xmlhttpRequest = (o) => {
        sent.push(o);
        if (o.onload) o.onload({ status: 200 });
    };
    const factory = new Function(
        'GM_getValue', 'GM_setValue', 'GM_xmlhttpRequest', 'GM_info', 'logs', '_d', '_w', '_l',
        'console', 'setTimeout', 'clearTimeout',
        mod + '\nreturn dbg;'
    );
    const dbg = factory(
        GM_getValue, GM_setValue, GM_xmlhttpRequest,
        { script: { version: '1.5.0-AI' } },
        logsObj,
        { title: '阅读 - 超星学习通' },
        { addEventListener: function () { } },
        { href: 'https://mooc1-2.chaoxing.com/mooc-ans/mycourse/studentstudy?chapterId=1266095428&courseId=268157391' },
        console, setTimeout, clearTimeout
    );
    return { dbg, logsObj, sent, stored };
}

// 2.1 默认关闭：什么都不发
{
    const h = makeDbg({ enabled: false });
    h.dbg.log('info', '不该发出去');
    h.dbg.flush();
    t('关闭时不发送任何请求', h.sent.length, 0);
    t('关闭时队列为空', h.dbg._queue.length, 0);
}

// 2.2 开启后：日志 → POST /__log
{
    const h = makeDbg({ enabled: true });
    h.dbg.log('info', '测试一行');
    h.dbg.flush();
    t('开启后发出 1 个请求', h.sent.length, 1);
    t('请求方法为 POST', h.sent[0].method, 'POST');
    t('请求地址为接收端 /__log', h.sent[0].url, 'http://127.0.0.1:8124/__log');
    const payload = JSON.parse(h.sent[0].data);
    t('负载类型为 lines', payload.type, 'lines');
    t('负载带脚本版本', payload.v, '1.5.0-AI');
    t('负载带页面 URL', payload.url.includes('chapterId=1266095428'), true);
    t('队列含目标消息', payload.lines.map(x => x.msg).includes('测试一行'), true);
    t('首行是页面就绪标记', payload.lines[0].msg.startsWith('页面就绪：脚本 1.5.0-AI'), true);
    t('行时间戳为 ISO 格式', payload.lines.every(x => /^\d{4}-\d{2}-\d{2}T/.test(x.t)), true);
}

// 2.3 包装 logs.addLog：面板日志也会被抓走
{
    const h = makeDbg({ enabled: true });
    h.logsObj.addLog('来自面板的日志', 'green');
    h.dbg.flush();
    const payload = JSON.parse(h.sent[h.sent.length - 1].data);
    const msgs = payload.lines.map(x => x.msg);
    t('面板日志被抓到', msgs.includes('来自面板的日志'), true);
    t('面板日志等级被保留', payload.lines.find(x => x.msg === '来自面板的日志').lv, 'green');
    t('原有 addLog 行为未被破坏（logArry 仍在增长）', h.logsObj.logArry.some(x => String(x).includes('来自面板的日志')), true);
}

// 2.4 回填：挂载前已经产生的日志也要补发
{
    const h = makeDbg({ enabled: true, prefill: ["<span style='color: black'>[00:00:01] 早先的一条日志</span>"] });
    h.dbg.flush();
    const payload = JSON.parse(h.sent[0].data);
    const msgs = payload.lines.map(x => x.msg);
    t('回填的历史日志被补发', msgs.includes('[00:00:01] 早先的一条日志'), true);
    t('回填条目标记为 backfill', payload.lines.find(x => x.msg.includes('早先的一条日志')).lv, 'backfill');
}

// 2.5 上下文带 chapterId
{
    const h = makeDbg({ enabled: true });
    t('上下文含 chapterId', h.dbg._ctx.includes('chapter=1266095428'), true);
}

// 2.6 接收端地址可改
{
    const h = makeDbg({ enabled: true, sink: 'http://127.0.0.1:19099' });
    h.dbg.log('info', 'x');
    h.dbg.flush();
    t('自定义接收端地址生效', h.sent[0].url, 'http://127.0.0.1:19099/__log');
}

// =============================================================================
console.log('\n=== 3) 本机接收端 log-sink.cjs 端到端 ===');
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
    t('接收端启动并监听随机端口', port > 0, true);

    const payload = {
        type: 'lines', v: '1.5.0-AI',
        url: 'https://mooc1-2.chaoxing.com/mooc-ans/mycourse/studentstudy?chapterId=1266095428',
        lines: [{ t: '2026-11-24T13:30:12.345Z', lv: 'info', ch: 'chapter=1266095428 | 阅读', msg: '正确率符合标准，已提交答案' }]
    };
    const post = await req('POST', '/__log', port, payload);
    t('POST /__log 返回 200', post.status, 200);
    t('POST 回应包含条数', JSON.parse(post.body).count, 1);

    const tail = await req('GET', '/__log?tail=10', port);
    t('GET /__log 返回 200', tail.status, 200);
    t('落盘内容含消息正文', tail.body.includes('正确率符合标准，已提交答案'), true);
    t('落盘内容含等级', tail.body.includes('[INFO ]'), true);
    t('落盘内容含章节上下文', tail.body.includes('chapter=1266095428'), true);

    const files = fs.readdirSync(tmpDir).filter(f => f.startsWith('debug-') && f.endsWith('.log'));
    t('落盘文件已生成', files.length, 1);
    const disk = fs.readFileSync(path.join(tmpDir, files[0]), 'utf8');
    t('文件内容含消息正文', disk.includes('正确率符合标准，已提交答案'), true);

    const status = await req('GET', '/', port);
    t('状态页返回 200', status.status, 200);
    t('状态页含落盘文件路径', status.body.includes('debug-'), true);

    child.kill();
    fs.rmSync(tmpDir, { recursive: true, force: true });

    console.log('\n----------------------------------------');
    console.log(`结果: 通过 ${pass} 项，失败 ${fail} 项`);
    console.log('----------------------------------------');
    process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
    console.error('\n测试异常：' + (err && err.stack || err));
    process.exit(1);
});
