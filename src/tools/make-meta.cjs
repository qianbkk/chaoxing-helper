#!/usr/bin/env node
// =============================================================================
// make-meta.cjs —— 从发布件里抽出「==UserScript== 元数据块」
// =============================================================================
// 为什么需要它：
//   ScriptCat 检查更新时会抓 @updateURL 声明的地址，拿返回内容去 parseMetadata()，
//   要求返回的是**元数据块**（能解析出 @version 等字段），而不是 Greasy Fork 的 JSON，
//   也不是整份脚本。我们把元数据块单独存成 .meta.js，作为 GitHub Release 的资产，
//   这样 @updateURL 与 @downloadURL 指向的是一对同名文件：
//       chaoxing-helper.meta.js   ← @updateURL（检查更新）
//       chaoxing-helper.user.js   ← @downloadURL（下载安装）
//
// 用法：
//   node src/tools/make-meta.cjs <输入.user.js> <输出.meta.js>
// 退出码：0 = 成功；1 = 找不到元数据块或参数不对。
// =============================================================================
'use strict';

const fs = require('fs');
const path = require('path');

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
    console.error('用法: node src/tools/make-meta.cjs <输入.user.js> <输出.meta.js>');
    process.exit(1);
}
if (!fs.existsSync(inPath)) {
    console.error('找不到输入文件: ' + inPath);
    process.exit(1);
}

const txt = fs.readFileSync(inPath, 'utf8');
const m = txt.match(/\/\/[ \t]*==UserScript==[\s\S]*?\/\/[ \t]*==\/UserScript==/);
if (!m) {
    console.error('输入文件里找不到 ==UserScript== 元数据块: ' + inPath);
    process.exit(1);
}

const ver = m[0].match(/@version\s+([0-9][^\r\n]*)/);
if (!ver) {
    console.error('元数据块里没有 @version: ' + inPath);
    process.exit(1);
}

fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, m[0] + '\n', 'utf8');
console.log('元数据块已写出: %s（@version %s，%d 字节）', outPath, ver[1].trim(), Buffer.byteLength(m[0]) + 1);
