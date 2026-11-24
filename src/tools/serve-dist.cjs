#!/usr/bin/env node
// =============================================================================
// serve-dist.cjs —— 本机发布件静态服务（供 ScriptCat 安装 / 更新用户脚本）
// =============================================================================
// 为什么需要它：
//   用户脚本管理器只在通过 http(s) 打开 .user.js 时才会接管并弹出安装页；
//   直接用 file:// 打开只会被当成纯文本渲染（不触发安装）。
//   脚本管理器会把这个 URL 记为脚本的「来源」，之后「检查更新」也走这个地址。
//
// 【为什么不能用普通静态服务器】
//   脚本管理器记下的来源地址里带着**当时的版本号**，例如：
//     http://127.0.0.1:8123/超星学习通小助手-AI版-v1.8.1.user.js
//   点「检查更新」时它会做两件事（读 scriptcat 源码确认）：
//     ① 把来源地址的 user.js 换成 meta.js 去拉元数据
//        （deriveMetaUrl = url.replace("user.js", "meta.js")）；
//     ② 若 ① 失败，回退到**原始来源地址**再拉一次
//        （scriptscat/scriptcat#1840 的修复）。
//   所以要让「检查更新」长期可用，服务必须能回答：
//     · 任意历史版本文件名的 .user.js  → 当前发布件
//     · 任意历史版本文件名的 .meta.js  → 当前发布件的元数据块
//   否则旧版本名一律 404 ⇒ 界面显示「检查更新失败」。
//   —— 这也是「dist/ 只留当前发布件」与「原生更新器」能共存的前提：
//      别名由**服务**动态提供，不往 dist/ 里塞副本。
//
// 【提供哪些地址】
//   /<任意名字>.user.js   → 当前发布件（完整脚本）
//   /<任意名字>.meta.js   → 当前发布件的 ==UserScript== 元数据块
//   /latest.user.js       → 同上（脚本元数据里 @downloadURL 用的稳定地址）
//   /latest.meta.js       → 同上（脚本元数据里 @updateURL 用的稳定地址）
//   /                     → 状态页（列出当前发布件与上面几个地址）
//   其余路径              → 按 dist/ 里的真实文件返回（README.md 等）
//
// 用法：
//   node src/tools/serve-dist.cjs                # 默认 127.0.0.1:8123
//   node src/tools/serve-dist.cjs --port 8123
//
// 约束：只监听 127.0.0.1；无第三方依赖。
// =============================================================================
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const out = { port: 8123 };
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === '--port' || argv[i] === '-p') out.port = parseInt(argv[++i], 10);
    }
    if (!Number.isInteger(out.port) || out.port < 0 || out.port > 65535) out.port = 8123;
    return out;
}

const args = parseArgs(process.argv);
const repoRoot = path.resolve(__dirname, '..', '..');     // src/tools → src → 仓库根
const distDir = path.join(repoRoot, 'dist');

// ---- 当前发布件：dist/ 里唯一的 .user.js ----
function currentRelease() {
    try {
        const files = fs.readdirSync(distDir).filter(f => /\.user\.js$/i.test(f));
        if (!files.length) return null;
        // 多个时取版本号最大的那个
        const verOf = f => {
            try {
                const m = fs.readFileSync(path.join(distDir, f), 'utf8').match(/@version\s+([0-9][^\r\n]*)/);
                return m ? m[1].trim() : '0';
            } catch (e) { return '0'; }
        };
        let best = files[0];
        for (const f of files) {
            const a = verOf(f).split(/[.\-]/).map(x => parseInt(x, 10) || 0);
            const b = verOf(best).split(/[.\-]/).map(x => parseInt(x, 10) || 0);
            for (let i = 0; i < Math.max(a.length, b.length); i++) {
                const x = a[i] || 0, y = b[i] || 0;
                if (x !== y) { if (x > y) best = f; break; }
            }
        }
        const file = path.join(distDir, best);
        const code = fs.readFileSync(file, 'utf8');
        const vm = code.match(/@version\s+([0-9][^\r\n]*)/);
        const meta = code.match(/\/\/[ \t]*==UserScript==[\s\S]*?\/\/[ \t]*==\/UserScript==/);
        return {
            file: best,
            code: code,
            meta: meta ? meta[0] : null,
            version: vm ? vm[1].trim() : '?',
            size: Buffer.byteLength(code)
        };
    } catch (e) {
        return null;
    }
}

function send(res, status, type, body) {
    res.writeHead(status, {
        'Content-Type': type,
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
    });
    res.end(body);
}

const server = http.createServer((req, res) => {
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    } catch (e) {
        pathname = '/';
    }
    if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
        return res.end();
    }

    const rel = currentRelease();

    // ---- 任意 *.meta.js → 当前发布件的元数据块 ----
    // 这是「检查更新」真正用的地址（把来源地址的 user.js 换成 meta.js）
    if (/\.meta\.js$/i.test(pathname)) {
        if (!rel) return send(res, 503, 'text/plain; charset=utf-8', 'dist/ 里没有发布件\n');
        if (!rel.meta) return send(res, 500, 'text/plain; charset=utf-8', '发布件里找不到 ==UserScript== 元数据块\n');
        return send(res, 200, 'text/javascript; charset=utf-8', rel.meta);
    }

    // ---- 任意 *.user.js → 当前发布件 ----
    // 既覆盖「回退到原始来源地址」那条路径，也让「任意历史版本名」的安装地址一直可用
    if (/\.user\.js$/i.test(pathname)) {
        if (!rel) return send(res, 503, 'text/plain; charset=utf-8', 'dist/ 里没有发布件\n');
        return send(res, 200, 'text/javascript; charset=utf-8', rel.code);
    }

    // ---- 状态页 ----
    if (pathname === '/' || pathname === '/__status') {
        const lines = [
            '本机发布件服务（供 ScriptCat 安装 / 更新用户脚本）',
            rel ? `当前发布件: ${rel.file}（${rel.version}，${Math.round(rel.size / 1024)} KB）` : '当前发布件: （无，先跑 src/build.ps1）',
            '',
            '以下地址都返回当前发布件：',
            '  安装 / 下载:  /latest.user.js',
            '  检查更新:    /latest.meta.js',
            '  任意历史版本文件名同样可用，例如：',
            rel ? `    /${rel.file.replace(/\.user\.js$/i, '.user.js')}` : '    /xxx.user.js',
            '',
            '在浏览器里打开 .user.js 地址 → 脚本管理器会弹出安装页 → 点「重新安装」即可。',
            '脚本管理器记下的来源地址带版本号也没关系：同名 .meta.js 与同名 .user.js 都能查到当前发布件。',
            ''
        ];
        return send(res, 200, 'text/plain; charset=utf-8', lines.join('\n'));
    }

    // ---- 其余路径：按 dist/ 里的真实文件返回 ----
    const safe = path.normalize(pathname).replace(/^([/\\])+/, '');
    const target = path.join(distDir, safe);
    if (!target.startsWith(distDir)) {
        return send(res, 403, 'text/plain; charset=utf-8', 'forbidden\n');
    }
    fs.readFile(target, (err, buf) => {
        if (err) return send(res, 404, 'text/plain; charset=utf-8', 'not found\n');
        const ext = path.extname(target).toLowerCase();
        const type = ext === '.js' ? 'text/javascript; charset=utf-8'
            : ext === '.md' ? 'text/markdown; charset=utf-8'
                : 'application/octet-stream';
        send(res, 200, type, buf);
    });
});

server.on('error', (err) => {
    console.error(`[serve-dist] 启动失败: ${err.message}`);
    process.exit(1);
});

server.listen(args.port, '127.0.0.1', () => {
    // 用实际监听端口（--port 0 时是随机端口），否则打印出来的地址是错的
    const port = server.address().port;
    const rel = currentRelease();
    const base = `http://127.0.0.1:${port}`;
    console.log(`[serve-dist] LISTEN ${port}`);
    console.log(`[serve-dist] 当前发布件: ${rel ? rel.file + '（' + rel.version + '）' : '（无）'}`);
    console.log(`[serve-dist] 安装地址: ${base}/latest.user.js`);
    console.log(`[serve-dist] 检查更新: ${base}/latest.meta.js`);
    if (rel) {
        console.log(`[serve-dist] 当前文件名地址: ${base}/` + encodeURIComponent(rel.file));
    }
});

process.on('SIGINT', () => {
    console.log('\n[serve-dist] 已停止');
    server.close(() => process.exit(0));
});
