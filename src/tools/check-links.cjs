// 自检：检查仓库里所有 .md 的相对链接是否指向真实存在的文件
//
// 用法：
//   node src/tools/check-links.cjs
//
// 退出码：0 = 全部可达；1 = 有缺失（缺失清单打印在标准输出）
//
// 为什么需要它：docs/ 与根 README 之间互相引用，改名/挪目录后链接会静默失效，
// 而这种失效在 GitHub 上只是渲染成一个坏掉的链接，不会有任何报错。

const fs = require('fs');
const path = require('path');

// 仓库根 = 本文件所在目录的上一级（src/tools → src → 仓库根）
const ROOT = path.resolve(__dirname, '..', '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'build', 'temp', 'tmp', 'logs']);

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === '.git' || SKIP_DIRS.has(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (e.name.endsWith('.md')) out.push(p);
    }
    return out;
}

let total = 0;
const missing = [];

for (const f of walk(ROOT)) {
    const txt = fs.readFileSync(f, 'utf8');
    const re = /\[[^\]]*\]\(([^)]+)\)/g;
    let m;
    while ((m = re.exec(txt))) {
        let t = m[1].trim();
        // 外链、页内锚点、mailto 一律跳过
        if (/^(https?:|mailto:|#)/i.test(t)) continue;
        t = t.split('#')[0].trim();
        if (!t) continue;
        total++;
        const target = path.resolve(path.dirname(f), decodeURIComponent(t));
        if (!fs.existsSync(target)) {
            missing.push(path.relative(ROOT, f) + ' → ' + t);
        }
    }
}

console.log('扫描根目录: ' + ROOT);
console.log('相对链接总数: ' + total);
console.log('缺失: ' + missing.length);
missing.forEach((x) => console.log('  缺失 ' + x));
process.exit(missing.length ? 1 : 0);
