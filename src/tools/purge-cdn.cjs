// 清 jsDelivr 的分支缓存（发版后必须跑，否则 CDN 可能还在发旧文件）
//
// 用法：
//   node src/tools/purge-cdn.cjs
//   node src/tools/purge-cdn.cjs --ref main --file dist/chaoxing-helper.meta.js
//
// 为什么需要它：jsDelivr 读 `main` 分支时，**文件树**和**文件内容**是两套缓存。
//   - 树更新了（data.jsdelivr.com 能看到新文件树），
//   - 但内容存储仍可能返回旧 blob —— 表现是 user.js 已经是新版、meta.js 还是旧的。
// 官方 purge 接口能把两边都刷掉，实测对 user.js 立即生效。
//
// 接口：GET https://purge.jsdelivr.net/gh/<user>/<repo>@<ref>/<path>
//   注意必须用 GET（不是 PURGE 方法），带浏览器 UA，返回 JSON。
//   逐个文件刷；也可以刷目录（/dist）或仓库根（清得狠一点）。

const https = require('https');

const OWNER = 'qianbkk';
const REPO = 'chaoxing-helper';

function arg(name, dflt) {
    const i = process.argv.indexOf('--' + name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const ref = arg('ref', 'main');
const files = process.argv.includes('--file')
    ? [arg('file', '')]
    : ['dist/chaoxing-helper.meta.js', 'dist/chaoxing-helper.user.js'];

function purge(path) {
    const url = `https://purge.jsdelivr.net/gh/${OWNER}/${REPO}@${ref}/${path}`;
    return new Promise((resolve, reject) => {
        const req = https.request(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
                'Accept': 'application/json',
            },
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('error', reject);
        req.setTimeout(30000, () => req.destroy(new Error('timeout')));
        req.end();
    });
}

(async () => {
    let failed = 0;
    for (const f of files) {
        try {
            const r = await purge(f);
            let status = '?';
            try { status = JSON.parse(r.body).status; } catch (e) { /* 非 JSON 就原样打印 */ }
            console.log(`[${r.status}] ${f} -> ${status}`);
            if (r.status !== 200 || status !== 'finished') failed++;
        } catch (e) {
            console.log(`[ERR] ${f} -> ${e.message}`);
            failed++;
        }
    }
    console.log(failed ? `有 ${failed} 项未成功` : '全部清理成功');
    process.exit(failed ? 1 : 0);
})();
