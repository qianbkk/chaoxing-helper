#!/usr/bin/env node
// =============================================================================
// log-sink.cjs —— 本机调试通道（日志 + 远程控制）
// =============================================================================
// 配合脚本的「调试模式」使用：
//   ① 日志：脚本用 GM_xmlhttpRequest 把面板里的每一行运行日志 POST 到 /__log，这里落盘成文件；
//   ② 控制：我（维护者）在命令行往 /__cmd 投递命令，脚本轮询取回并执行，结果写回日志 ——
//            于是**除了更新脚本本体，完全不需要截图或操控浏览器**；
//   ③ 版本自检：接收端盯着发布件的 @version，发现比脚本上报的版本新时，
//            自动往命令队列塞一条 newversion 通知（只有开了调试模式的实例会收到）。
//
// 【/latest.* 返回哪个文件】
//   优先返回**调试变体** build/chaoxing-helper.debug.user.js ——
//   它的 @updateURL/@downloadURL 指向本机接收端，于是本机自用时
//   「装了脚本 → 接收端发现新版本 → 脚本自动弹安装页 → 点重新安装」这条闭环成立；
//   没有调试变体时退回 dist/ 里的正式发布件。
//
// 用法：
//   node src/tools/log-sink.cjs                 # 默认 127.0.0.1:8124，日志写到 <仓库根>/logs/
//   node src/tools/log-sink.cjs --port 8125     # 换端口
//   node src/tools/log-sink.cjs --dir temp/logs # 换落盘目录
//
// 接口：
//   POST /__log    脚本上报日志      {type:'lines', v:<脚本版本>, url, lines:[{t,lv,ch,msg}]}
//   POST /__cmd    投递命令          {"cmd":"pause"} 或 {"cmd":"status"}
//   GET  /__cmd?since=<seq>         脚本取命令（返回 seq + cmds 数组）
//   GET  /__log?tail=100            取最近 N 行日志（纯文本）
//   GET  /__status                  接收端状态：落盘文件、字节数、待执行命令数、版本对比
//   GET  /latest.meta.js            当前发布件的元数据块（ScriptCat 检查更新用）
//   GET  /latest.user.js            当前发布件的完整脚本（ScriptCat 下载用）
//   GET  /                          状态页
//
// 约束：只监听 127.0.0.1，不对外暴露；无第三方依赖；单进程即可。
// =============================================================================
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const out = { port: 8124, dir: 'logs' };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--port' || a === '-p') out.port = parseInt(argv[++i], 10);
        else if (a === '--dir' || a === '-d') out.dir = argv[++i];
    }
    if (!Number.isInteger(out.port) || out.port < 0 || out.port > 65535) out.port = 8124;
    if (!out.dir) out.dir = 'logs';
    return out;
}

const args = parseArgs(process.argv);
const repoRoot = path.resolve(__dirname, '..', '..');     // src/tools → src → 仓库根
const logDir = path.isAbsolute(args.dir) ? args.dir : path.join(repoRoot, args.dir);
const distDir = path.join(repoRoot, 'dist');
const buildDir = path.join(repoRoot, 'build');
// 本机自用的调试变体：@updateURL/@downloadURL 指向本机接收端
const debugReleaseFile = 'chaoxing-helper.debug.user.js';
fs.mkdirSync(logDir, { recursive: true });

function stamp() {
    const d = new Date();
    const p = (n, w) => String(n).padStart(w || 2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const logFile = path.join(logDir, `debug-${stamp()}.log`);
const cmdLogFile = path.join(logDir, `commands-${stamp()}.log`);

// ---- 命令队列（内存）+ 序号 ----
let cmdSeq = 0;
const cmdQueue = [];
const notifiedVersions = {};      // 避免同一版本重复通知

function formatLine(rec) {
    const t = rec && rec.t ? rec.t : new Date().toISOString();
    const lv = String((rec && rec.lv) || 'info').toUpperCase();
    const ch = rec && rec.ch ? ` ${rec.ch}` : '';
    const msg = String((rec && rec.msg) || '').replace(/[\r\n]+/g, ' ');
    return `${t} [${lv.padEnd(5)}]${ch} ${msg}`;
}

let scriptVersion = '';

// ---- 待检查的发布件：调试变体优先，再看 dist/ 里的正式发布件 ----
function releaseFiles() {
    const out = [];
    if (fs.existsSync(path.join(buildDir, debugReleaseFile))) {
        out.push({ dir: buildDir, file: debugReleaseFile });
    }
    try {
        for (const f of fs.readdirSync(distDir)) {
            if (/\.user\.js$/.test(f)) out.push({ dir: distDir, file: f });
        }
    } catch (e) { }
    return out;
}

function verOfFile(rel) {
    try {
        const txt = fs.readFileSync(path.join(rel.dir, rel.file), 'utf8');
        const m = txt.match(/@version\s+([0-9][^\r\n]*)/);
        return m ? m[1].trim() : '0';
    } catch (e) { return '0'; }
}

// ---- 版本自检：扫发布件里的 @version ----
function readDistVersions() {
    const out = [];
    for (const r of releaseFiles()) {
        const v = verOfFile(r);
        if (v !== '0') out.push({ file: r.file, version: v });
    }
    return out;
}

// 找出版本号最高的发布件 —— 「当前发布件」
// 版本相同时保留先出现的那一个（调试变体排在前面），
// 于是 /latest.* 默认返回调试变体，正式发布件只在没有调试变体时兜底。
function currentRelease() {
    const rels = releaseFiles();
    if (!rels.length) return null;
    let best = rels[0];
    let bestVer = verOfFile(best);
    for (const r of rels) {
        const v = verOfFile(r);
        if (verGreater(v, bestVer)) { best = r; bestVer = v; }
    }
    return best;
}

// 取出发布件里的「==UserScript== 元数据块」
// ScriptCat 抓 @updateURL 时会拿返回内容去 parseMetadata()，
// 要求是能解析出 @version 的元数据块（不是 Greasy Fork 的 JSON）。
function metaBlockOf(rel) {
    const txt = fs.readFileSync(path.join(rel.dir, rel.file), 'utf8');
    const m = txt.match(/\/\/[ \t]*==UserScript==[\s\S]*?\/\/[ \t]*==\/UserScript==/);
    return m ? m[0] : null;
}

function verParts(v) {
    const m = String(v || '').match(/([0-9]+)\.([0-9]+)\.([0-9]+)/);
    if (!m) return [0, 0, 0];
    return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

function verGreater(a, b) {
    const A = verParts(a), B = verParts(b);
    for (let i = 0; i < 3; i++) {
        if (A[i] > B[i]) return true;
        if (A[i] < B[i]) return false;
    }
    return false;
}

// 脚本元数据里声明的更新地址（须与 patch-v1.8.2.ps1 写入的保持一致）
// 注意：用实际监听端口（--port 0 时是随机端口），不是 args.port
let updateUrl = '';
let downloadUrl = '';

function checkNewVersion() {
    if (!scriptVersion) return;
    const dists = readDistVersions();
    for (const d of dists) {
        if (!verGreater(d.version, scriptVersion)) continue;
        const key = scriptVersion + '->' + d.version;
        if (notifiedVersions[key]) continue;
        notifiedVersions[key] = true;
        cmdSeq++;
        //v1.8.2：改成**字符串命令**。
        //  原先发的是对象字段 {cmd:'newversion', version, url}，
        //  而脚本侧按字符串解析命令（cmd + 空格分隔参数），
        //  于是 arg[0]/arg[1] 全是 undefined，日志打出「发现新版本 ?：」。
        //  这里直接拼成 "newversion <版本> <地址>"，脚本就能正常解析。
        cmdQueue.push({
            seq: cmdSeq,
            ts: new Date().toISOString(),
            cmd: 'newversion ' + d.version + ' ' + downloadUrl
        });
        console.log(`[log-sink] 发现新版本 ${d.version}（脚本当前 ${scriptVersion}）→ 已排入通知`);
    }
}

function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

const server = http.createServer((req, res) => {
    cors(res);
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    const url = new URL(req.url, 'http://127.0.0.1');

    // ---------- 日志上报 ----------
    if (req.method === 'POST' && url.pathname === '/__log') {
        let body = '';
        let tooBig = false;
        req.on('data', (c) => {
            if (tooBig) return;
            body += c;
            if (body.length > 4 * 1024 * 1024) { tooBig = true; req.destroy(); }
        });
        req.on('end', () => {
            let payload = {};
            try {
                payload = JSON.parse(body || '{}');
            } catch (e) {
                payload = { lines: [{ lv: 'raw', msg: String(body).slice(0, 2000) }] };
            }
            if (payload.v) scriptVersion = String(payload.v);
            const lines = Array.isArray(payload.lines) ? payload.lines : [];
            if (lines.length) {
                const text = lines.map(formatLine).join('\n') + '\n';
                fs.appendFileSync(logFile, text, 'utf8');
                process.stdout.write(text);
            }
            checkNewVersion();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: true, count: lines.length, file: logFile }));
        });
        req.on('error', () => { });
        return;
    }

    // ---------- 投递命令 ----------
    if (req.method === 'POST' && url.pathname === '/__cmd') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
            let payload = {};
            try {
                payload = JSON.parse(body || '{}');
            } catch (e) {
                payload = { cmd: String(body || '') };
            }
            const cmd = String(payload.cmd || '').trim();
            if (!cmd) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ ok: false, error: '缺少 cmd' }));
            }
            cmdSeq++;
            const rec = { seq: cmdSeq, ts: new Date().toISOString(), cmd: cmd };
            if (payload.args) rec.args = payload.args;
            cmdQueue.push(rec);
            const line = `${rec.ts} #${rec.seq} ${cmd}\n`;
            fs.appendFileSync(cmdLogFile, line, 'utf8');
            console.log(`[log-sink] 收到命令 #${rec.seq}: ${cmd}`);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: true, seq: rec.seq }));
        });
        return;
    }

    // ---------- 取命令 ----------
    if (req.method === 'GET' && url.pathname === '/__cmd') {
        const since = parseInt(url.searchParams.get('since') || '0', 10) || 0;
        const cmds = cmdQueue.filter(c => c.seq > since);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ seq: cmdSeq, cmds: cmds }));
    }

    // ---------- ScriptCat 原生更新器用的两个固定地址 ----------
    // 脚本元数据里声明了：
    //   @updateURL   http://127.0.0.1:8124/latest.meta.js
    //   @downloadURL http://127.0.0.1:8124/latest.user.js
    // ScriptCat 抓 updateURL 时用 parseMetadata() 解析，所以这里必须返回
    // 「==UserScript== 元数据块」，而不是 Greasy Fork 的 JSON。
    if (req.method === 'GET' && (url.pathname === '/latest.meta.js' || url.pathname === '/latest.user.js')) {
        const rel = currentRelease();
        if (!rel) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('dist/ 里没有发布件\n');
        }
        let body;
        try {
            if (url.pathname === '/latest.meta.js') {
                body = metaBlockOf(rel);
                if (!body) throw new Error('发布件里找不到 ==UserScript== 元数据块');
            } else {
                body = fs.readFileSync(path.join(rel.dir, rel.file), 'utf8');
            }
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('读取发布件失败：' + e.message + '\n');
        }
        res.writeHead(200, {
            'Content-Type': 'text/javascript; charset=utf-8',
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*'
        });
        return res.end(body);
    }

    // ---------- 状态 ----------
    if (req.method === 'GET' && url.pathname === '/__status') {
        let size = 0;
        try { size = fs.statSync(logFile).size; } catch (e) { }
        const dists = readDistVersions();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({
            ok: true,
            file: logFile,
            bytes: size,
            scriptVersion: scriptVersion,
            pendingCmds: cmdQueue.length,
            lastSeq: cmdSeq,
            dist: dists,
            updateUrl: updateUrl,
            downloadUrl: downloadUrl
        }));
    }

    if (req.method === 'GET') {
        if (url.pathname === '/__log') {
            const tail = parseInt(url.searchParams.get('tail') || '100', 10) || 100;
            let all = [];
            try {
                all = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
            } catch (e) { }
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end(all.slice(-tail).join('\n'));
        }
        let size = 0;
        try { size = fs.statSync(logFile).size; } catch (e) { }
        const rel = currentRelease();
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end([
            '调试通道运行中（日志 + 远程控制）',
            `落盘文件: ${logFile}`,
            `已写入: ${size} 字节`,
            `脚本版本: ${scriptVersion || '未知'}`,
            `待执行命令: ${cmdQueue.length} 条（命令日志: ${cmdLogFile}）`,
            `当前发布件: ${rel ? rel.file + '（' + rel.version + '）' : '（无）'}`,
            `检查更新地址: ${updateUrl}`,
            `下载地址: ${downloadUrl}`,
            '投递命令: POST /__cmd  {"cmd":"status"}',
            '查看日志: GET /__log?tail=100',
            ''
        ].join('\n'));
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found\n');
});

server.on('error', (err) => {
    console.error(`[log-sink] 启动失败: ${err.message}`);
    process.exit(1);
});

server.listen(args.port, '127.0.0.1', () => {
    const port = server.address().port;
    // 用实际监听端口算更新地址（--port 0 时是随机端口）
    updateUrl = 'http://127.0.0.1:' + port + '/latest.meta.js';
    downloadUrl = 'http://127.0.0.1:' + port + '/latest.user.js';
    console.log(`[log-sink] LISTEN ${port}`);
    console.log(`[log-sink] 接收地址: http://127.0.0.1:${port}/__log`);
    console.log(`[log-sink] 命令投递: POST http://127.0.0.1:${port}/__cmd  {"cmd":"status"}`);
    console.log(`[log-sink] 检查更新: ${updateUrl}`);
    console.log(`[log-sink] 日志文件: ${logFile}`);
});

process.on('SIGINT', () => {
    console.log('\n[log-sink] 已停止');
    server.close(() => process.exit(0));
});
