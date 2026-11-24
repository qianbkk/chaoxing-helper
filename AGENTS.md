# chaoxing-helper —— 工作约定

这个文件是**改文件前必读**的约定。跟仓库相关的自动化工具、AI 助手都按它行事。

## 1. 项目定位

超星学习通 ScriptCat 用户脚本（AI 版）的开发与发布工程。

- 发布件：`dist/chaoxing-helper.user.js`（+ `dist/chaoxing-helper.meta.js`）
- 起点基线：`src/baseline/chaoxing-helper.base.js`（脱敏后的 v1.8.2 发布件）
- 补丁链：`src/patches/patch-vX.Y.Z.ps1`，每个负责一次版本跃迁
- v1.1~v1.8.2 那条「上游原版 → 逐版打补丁」的链在私有存档仓库
  `qianbkk/scriptcat-chaoxing-helper` 里，本仓库从 v1.9.0 起独立演进。

## 2. 目录结构

```
chaoxing-helper/
├── README.md              ← 仓库总入口（唯一入口）
├── AGENTS.md              ← 本文件
├── CHANGELOG.md           ← 版本演进记录（改了什么/为什么/怎么验证的）
├── NOTICE.md              ← 第三方组件、许可与致谢
├── LICENSE                ← GPL-3.0
├── src/
│   ├── README.md          ← 构建链说明 + 如何新增一个版本
│   ├── build.ps1          ← 一键重建
│   ├── baseline/          ← 本仓库基线（补丁链起点）
│   ├── patches/           ← 增量补丁脚本
│   ├── modules/           ← 整块注入脚本的独立模块源码
│   ├── assets/            ← 被内联进脚本的第三方资产
│   └── tools/             ← 构建期工具 + 本机调试通道
├── dist/                  ← 发布件（提交进版本库，也是 Release 资产源）
├── build/                 ← 中间产物 + 调试变体（gitignore，可随时删）
├── tests/                 ← 十一套测试，改完必跑
├── docs/                  ← 结论与取证，入口是 docs/INDEX.md
└── reference/             ← 上游参考来源（只放链接与改动说明）
```

## 3. 硬性约定

1. **所有产出写入本目录**，不要写到父目录、桌面或其他磁盘位置。
2. **改产出文件前必须先改生成脚本**：`src/patches/*.ps1`、`src/modules/*.js`、`src/build.ps1`。
   直接手改 `dist/` 里的发布件 = 脚本与产出会失同步，下次重建就白改。
   - 字符串锚点替换：每处替换前**断言锚点恰好命中指定次数**（`Replace-Once`）；
   - 整段替换：按「起始标记 / 结束标记」区间定位（模块内部被改过时不能全文匹配）。
3. **改完必须跑全部测试 + 语法校验**：
   ```powershell
   pwsh -File src\build.ps1
   node tests\ai-module.test.js ; node tests\ai-integration.test.js ; node tests\extras-module.test.js
   node tests\workauto-module.test.js ; node tests\debuglog.test.js ; node tests\pause-module.test.js
   node tests\v16-module.test.js ; node tests\debugcmd.test.js ; node tests\v18-module.test.js
   node tests\serve-dist.test.js ; node tests\release-meta.test.js
   node --check dist\chaoxing-helper.user.js
   ```
4. **API Key / 题库 Token 绝不写进源码**，也不进任何文档示例。由使用者自己在面板里填，
   存在 ScriptCat 存储（`unrivalAiKey` / `tikutoken`）。
5. **公开仓库红线**（发布件部分由 `tests/release-meta.test.js` 自动复查，人也别破）：
   - **发布件**（`dist/`）里不得出现：挖矿载荷（域名 / 账号 / 启动调用）、
     他人的邮箱等个人信息、硬编码密钥、上游第三方服务器地址（`getEnc.php` / `getAnswer.php`）；
   - 正式版的 `@updateURL` / `@downloadURL` 不得指向 `127.0.0.1`；
   - **基线与历史文档**里可以保留上游的取证原文（挖矿域名、上游服务器地址等）——
     那是「改动过程可审计」的证据，不是发布件；但**不要把它们抄进发布件**。
6. **文档纪律**：结论必须带依据（行号 / 实测命令与输出）；未验证就写「未验证」；
   改代码要同步改文档；发现旧结论错了用「⚠️ 更正」标注，不静默抹掉。
7. **新增目录 / 文档前先问**：动既有目录结构（新增子目录、改索引）之前先确认。
8. **Git 约定**：默认分支 `main`，提交信息用中文写清「改了什么 + 为什么」；
   提交前先跑测试。`build/`、`logs/`、`temp/` 已在 `.gitignore` 里排除。
9. **不要打断用户正在运行的东西**：本机有两个常驻服务
   （8123 发布件服务、8124 调试接收端），动它们之前先确认；
   端口映射、客户端开关之类属于破坏性操作，必须先拿到明确授权。
10. **脚本管理器是 ScriptCat**：在 Tampermonkey 下会持续打橙色告警，且
    `@storageName`、跨标签页同步等能力不保证。报告问题前先确认用户用的是哪个管理器。
11. **提交门槛有上游的坑**：上游 `Math.floor((total - questionNum) / total) * 100 >= accuracy`
    是**先除后取整**，比例 < 1 一律算 0%。改这块之前先想清楚，见
    [docs/v1.4章节测验与字体解密说明.md](docs/v1.4章节测验与字体解密说明.md)。
12. **推理型模型（MiniMax 等）思考 token 计入 `max_tokens`**：思考一长就把额度吃光，
    返回 `finish_reason=length` + 空 `content`。脚本里 `max_tokens` 已放宽到 8000，
    且对 `minimax` 端点额外下发 `reasoning_effort: 'low'`。
    以后再加 provider，**不要**把 `reasoning_effort` 无条件发给不认这个字段的服务。
13. **调试功能默认关闭**：`unrivalDbgEnabled` 默认 `'0'`。公开版保留调试代码，
    但装了脚本不会往任何地址发请求。改这个默认值前先想清楚是不是想给所有人开。

## 4. 本机调试通道（维护者自用）

```powershell
# 调试接收端（日志落盘 + 远程操控 + 版本自检），端口 8124
node src\tools\log-sink.cjs

# 发布件服务（安装/更新用），端口 8123
pwsh -File src\tools\serve-dist.ps1

# 投递命令 / 看日志
curl -X POST http://127.0.0.1:8124/__cmd -H 'Content-Type: application/json' -d '{"cmd":"status"}'
curl 'http://127.0.0.1:8124/__log?tail=100'
```

调试变体（`build/chaoxing-helper.debug.user.js`）的更新地址指向本机接收端，
正式版（`dist/chaoxing-helper.user.js`）的更新地址指向 GitHub Releases。
接收端优先返回调试变体，所以本机自用时「接收端发现新版本 → 脚本自动弹安装页」这条闭环成立。
