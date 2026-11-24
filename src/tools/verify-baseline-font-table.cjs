#!/usr/bin/env node
// =============================================================================
// verify-baseline-font-table.cjs —— 构建期闸门：基线里内联的字体表必须与源表一致
// =============================================================================
// 【为什么需要它】
//   脚本里查字体映射用的是**内联**的一张 base64 表（常量 CX_FONT_TABLE_B64），
//   源表是 src/assets/font-table-2.0.json。两份一旦不同步，
//   查表会**静默失配** —— 表现是「字体解密不命中」，
//   题干和选项全是乱码，AI 自然看不懂题，而构建过程一声不吭。
//   旧仓库用「打包表 vs 源表」来防这个坑；本仓库的表是随基线冻结的，
//   所以改成直接核对**基线里真正内联的那一份**。
//
// 用法：node src/tools/verify-baseline-font-table.cjs
// 退出码：0 = 完全一致；1 = 不一致或文件缺失。
// =============================================================================
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const jsonFile = path.join(root, 'src', 'assets', 'font-table-2.0.json');
const baseFile = path.join(root, 'src', 'baseline', 'chaoxing-helper.base.js');

if (!fs.existsSync(jsonFile)) { console.error('缺少源映射表: ' + jsonFile); process.exit(1); }
if (!fs.existsSync(baseFile)) { console.error('缺少基线: ' + baseFile); process.exit(1); }

const table = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
const base = fs.readFileSync(baseFile, 'utf8');
const m = base.match(/CX_FONT_TABLE_B64\s*=\s*"([A-Za-z0-9+/=]+)"/);
if (!m) { console.error('基线里找不到 CX_FONT_TABLE_B64 常量'); process.exit(1); }

const buf = Buffer.from(m[1], 'base64');
if (buf.length % 6 !== 0) {
    console.error('内联表长度不是 6 的整数倍: ' + buf.length);
    process.exit(1);
}

let ok = 0, bad = 0;
const badKeys = [];
for (let i = 0; i < buf.length; i += 6) {
    const key = buf.readUInt32BE(i).toString(16).padStart(8, '0');
    const val = buf.readUInt16BE(i + 4);
    if (table[key] === val) {
        ok++;
    } else {
        bad++;
        if (badKeys.length < 5) badKeys.push(key + ' 内联=' + val + ' 源表=' + table[key]);
    }
}

const srcCount = Object.keys(table).filter(k => /^[0-9a-f]{8}$/i.test(k)).length;
console.log('源表条目 %d | 内联条目 %d | 一致 %d | 不一致 %d', srcCount, buf.length / 6, ok, bad);

if (bad > 0 || srcCount !== buf.length / 6) {
    console.error('基线内联的字体表与源表不一致：');
    badKeys.forEach(k => console.error('  ' + k));
    process.exit(1);
}
console.log('字体映射表完整性校验通过');
