# src/ —— 构建链说明

## 目录

| 路径 | 作用 |
|---|---|
| `baseline/chaoxing-helper.base.js` | **本仓库的基线**，补丁链的起点（脱敏后的 v1.8.2 发布件） |
| `patches/patch-vX.Y.Z.ps1` | 增量补丁脚本，每个负责一次版本跃迁 |
| `modules/*.vX.Y.js` | 整块注入脚本的**独立模块源码**（调试命令、日志、暂停、字体解密……） |
| `assets/` | 被内联进脚本的第三方资产（Typr/md5、字形映射表） |
| `tools/` | 构建期工具 + 本机调试通道 |
| `build.ps1` | 一键重建 |

## 链条

```
src/baseline/chaoxing-helper.base.js
   │
   ├─ patch-v1.9.0.ps1 -Mode official ─→ build/chaoxing-helper.user.js      ─→ dist/chaoxing-helper.user.js
   │                                    ─→ build/chaoxing-helper.meta.js      ─→ dist/chaoxing-helper.meta.js
   └─ patch-v1.9.0.ps1 -Mode debug   ─→ build/chaoxing-helper.debug.user.js
                                        build/chaoxing-helper.debug.meta.js
```

**两种变体只差两行元数据**（`@updateURL` / `@downloadURL`）：

- **正式版** → GitHub Releases 的固定资产名，别人装的就是它；
- **调试变体** → 本机接收端 `127.0.0.1:8124`，维护者自用，
  能被 AI agent 通过命令通道远程操控（`pause` / `resume` / `status` / `reload` / `goto` / `set` / `dump`）。

## 为什么基线是一个 600 KB 的发布件

上游是 GPL 脚本，本项目是它的衍生作品。早期版本用「上游原版 + 一串补丁」的方式演进，
但那条链的起点是上游原件 —— 里面带着上游自己注入的挖矿脚本，
**不适合放进一个要公开的仓库**。

所以本仓库换了个起点：**基线 = 已经做完改造、并且脱敏干净的 v1.8.2 发布件**。
从 v1.9.0 起，补丁链只作用在「自己的产物」上。

上游那条完整的溯源链（v1.1~v1.8.2 每个版本改了什么、为什么）留在私有存档仓库
`qianbkk/scriptcat-chaoxing-helper` 里，结论部分已经整理进 `docs/`。

## 怎么新增一个版本

1. **写补丁脚本** `src/patches/patch-vX.Y.Z.ps1`：
   - 用**字符串锚点**替换，每处替换前断言锚点恰好命中 1 次；
   - 整块替换用「起始标记 / 结束标记」区间定位（模块内部被改过时不能全文匹配）；
   - 元数据里的 `@version` 一并改掉。
2. **如果是新模块**：把代码写到 `src/modules/xxx.vX.Y.js`，
   在补丁里用区间替换把它整段注入脚本；模块里不要带版本号字样以外的状态。
3. **更新构建脚本** `src/build.ps1`：把新补丁挂进链条。
4. **更新测试**：`tests/` 里的断言跟着改（版本号、产物路径、新增行为）。
5. **重建 + 全测**：
   ```powershell
   pwsh -File src\build.ps1
   node tests\release-meta.test.js
   ```
6. **更新文档**：`CHANGELOG.md`（改了什么/为什么/怎么验证的）、`README.md`（版本历史表）、
   必要时 `docs/`（结论与依据）。**未验证的必须写未验证。**
7. **发版**：
   ```powershell
   gh release create vX.Y.Z --title "vX.Y.Z" --notes "……" `
       dist\chaoxing-helper.user.js dist\chaoxing-helper.meta.js
   ```
   发完新 Release，已安装的用户点「检查更新」就能拿到（`releases/latest` 指向最新 Release，
   而元数据块里的 `@version` 更高）。

## 构建期闸门

`src/build.ps1` 第一步就跑 `tools/verify-baseline-font-table.cjs`：
把**基线里真正内联的那张字形映射表**与 `src/assets/font-table-2.0.json` 逐条比对。
两者一旦失配，脚本里的查表会**静默失配** —— 表现为「字体解密不命中」，
题干和选项全是乱码，AI 自然看不懂题，而构建过程一声不吭。

## 工具

| 工具 | 作用 |
|---|---|
| `tools/verify-baseline-font-table.cjs` | 构建期闸门：基线内联表 vs 源表逐条一致 |
| `tools/make-meta.cjs` | 从发布件里抽出 `==UserScript== 元数据块`，供 `@updateURL` 使用 |
| `tools/serve-dist.cjs` | 本机发布件服务：安装/更新用，动态提供任意历史版本名的别名 |
| `tools/serve-dist.ps1` | 启动上面的服务（包装脚本） |
| `tools/log-sink.cjs` | 本机调试通道：日志落盘 + 远程操控 + 版本自检 + 提供 `/latest.*` |
