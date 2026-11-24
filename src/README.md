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
| `../build/` | 中间产物 + 调试变体（gitignore，可随时删） |
| `../dist/` | 发布件：脚本 + 它的元数据块，两个固定名文件 |

## 链条

```
src/baseline/chaoxing-helper.base.js
   │
   ├─ patch-v1.9.0.ps1  -Mode official ─→ build/chaoxing-helper.v1.9.0.js
   │   └─ patch-v1.10.0.ps1 -Mode official ─→ build/chaoxing-helper.v1.10.0.js
   │       └─ patch-v1.11.0.ps1 -Mode official ─→ build/chaoxing-helper.v1.11.0.js
   │           └─ patch-v1.11.1.ps1 -Mode official ─→ build/chaoxing-helper.user.js  ─→ dist/chaoxing-helper.user.js
   │                                                          ─→ build/chaoxing-helper.meta.js  ─→ dist/chaoxing-helper.meta.js
   └─ patch-v1.9.0.ps1  -Mode debug   ─→ …（同一条链，每步再跑一次）─→ build/chaoxing-helper.debug.user.js
                                                                        build/chaoxing-helper.debug.meta.js
```

补丁链是**逐版递进**的：每一步都作用在上一步的产物上，中间产物落在 `build/`（gitignore）。
新增一版 = 新增一个 `patch-vX.Y.Z.ps1`，并在 `src/build.ps1` 里挂进链条。

**两种变体只差两行元数据**（`@updateURL` / `@downloadURL`）：

- **正式版** → GitHub Releases 的固定资产名，别人装的就是它；
- **调试变体** → 本机接收端 `127.0.0.1:8124`，维护者自用，
  能被 AI agent 通过命令通道远程操控（`pause` / `resume` / `status` / `reload` / `goto` / `set` / `dump`）。

## 基线是什么

基线 = **脱敏后的 v1.8.2 发布件**，也就是「本项目改造到 v1.8.2 时的样子」的真实快照，
是本仓库补丁链的起点。

公开仓库没有以最早的来源脚本原件作为起点（那个原件不适合随包分发，来源与安全结论见
[docs/来源与安全说明.md](../docs/来源与安全说明.md)），而是用自己的产物做基线：
从 v1.9.0 起，补丁链只作用在「自己的产物」上。基线的来历与它保留了什么，见
[baseline/README.md](baseline/README.md)。

早期版本（v1.1~v1.8.2）那条逐版打补丁的完整演进链保存在私有存档仓库
`qianbkk/scriptcat-chaoxing-helper` 里，结论部分整理在 `docs/`。

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
   而元数据块里的 `@version` 更高）。发布件用**固定文件名**，所以发新版是往新 Release 上挂同名资产，
   不改任何地址。

## 构建期闸门

`src/build.ps1` 第一步就跑 `tools/verify-baseline-font-table.cjs`：
把**基线里真正内联的那张字形映射表**与 `src/assets/font-table-2.0.json` 逐条比对。
两者一旦失配，脚本里的查表会**静默失配** —— 表现为「字体解密不命中」，
题干和选项全是乱码，AI 自然看不懂题，而构建过程一声不吭。

构建最后还会对两个产物做 `node --check` 语法校验。

## 工具

| 工具 | 作用 |
|---|---|
| `tools/verify-baseline-font-table.cjs` | 构建期闸门：基线内联表 vs 源表逐条一致 |
| `tools/make-meta.cjs` | 从发布件里抽出 `==UserScript== 元数据块`，供 `@updateURL` 使用 |
| `tools/serve-dist.cjs` | 本机发布件服务：安装/更新用，动态提供任意历史版本名的别名 |
| `tools/serve-dist.ps1` | 启动上面的服务（包装脚本） |
| `tools/log-sink.cjs` | 本机调试通道：日志落盘 + 远程操控 + 版本自检 + 提供 `/latest.*` |
