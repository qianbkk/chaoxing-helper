# chaoxing-helper —— 工作约定

这个文件是**改文件前必读**的约定。跟仓库相关的自动化工具、AI 助手都按它行事。

## 1. 项目定位

超星学习通 ScriptCat 用户脚本（AI 版）的开发与发布工程。

- 发布件：`dist/chaoxing-helper.user.js`（+ `dist/chaoxing-helper.meta.js`）
- 起点基线：`src/baseline/chaoxing-helper.base.js`（脱敏后的 v1.8.2 发布件）
- 补丁链：`src/patches/patch-vX.Y.Z.ps1`，每个负责一次版本跃迁
- 早期版本（v1.1~v1.8.2）那条「来源脚本原件 → 逐版打补丁」的链在**私有存档仓库**
  `qianbkk/scriptcat-chaoxing-helper` 里，本仓库从 v1.9.0 起独立演进。

## 2. 目录结构

```
chaoxing-helper/
├── README.md              ← 仓库总入口（唯一入口）
├── AGENTS.md              ← 本文件
├── CHANGELOG.md           ← 版本演进记录（改了什么/为什么/怎么验证的）
├── NOTICE.md              ← 来源、许可与致谢
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
│   ├── chaoxing-helper.user.js   ← 完整脚本，别人装的就是它
│   ├── chaoxing-helper.meta.js   ← 只有 ==UserScript== 元数据块
│   └── README.md
├── build/                 ← 中间产物 + 调试变体（gitignore，可随时删）
├── tests/                 ← 十二套测试，改完必跑
├── logs/                  ← 本机调试日志（gitignore）
└── docs/                  ← 结论与取证，入口是 docs/INDEX.md
    ├── INDEX.md                    ← 文档索引（按角色给出阅读顺序）
    ├── 安装与自动更新.md            ← 装脚本、配 AI 接口、自动更新与排错
    ├── 开发与构建.md                ← 构建链、发布件、测试、调试通道
    ├── 来源与安全说明.md            ← 来源溯源、许可与安全自查（NOTICE 的详细版）
    ├── AI答题改造方案.md            ← 答题链路的设计与取舍
    ├── v1.3附加模块说明.md           ← 实验性功能与未验证清单
    └── v1.4章节测验与字体解密说明.md  ← 字体解密、章节测验与提交判定
```

目录约定要点：

- **没有 `reference/` 目录**。来源信息（脚本坐标、作者、许可）统一放在 `NOTICE.md`
  与 `docs/来源与安全说明.md` 里，不单独建目录放链接。
- `src/baseline/` 存在，是补丁链的起点；不要绕过它直接改 `dist/`。
- `dist/` 里**只有两个固定名文件**（脚本 + 它的元数据块），文件名不带版本号，理由见
  [dist/README.md](dist/README.md)。

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
     他人的邮箱等个人信息、硬编码密钥、第三方服务器地址（早期版本里取签名令牌与
     兜底查答案那两处地址）；
   - 正式版的 `@updateURL` / `@downloadURL` 不得指向 `127.0.0.1`；
   - **基线（`src/baseline/`）与历史文档**里可以保留取证原文（早期版本里的第三方地址、
     挖矿痕迹等）——那是「改动过程可审计」的证据，不是发布件；但**不要把它们抄进发布件**。
6. **文档纪律**：结论必须带依据（行号 / 实测命令与输出）；未验证就写「未验证」；
   改代码要同步改文档；发现旧结论错了用「⚠️ 更正」标注，不静默抹掉。
   引用文件时只引当前存在的文件名，已废弃的文档不留链接。
7. **新增目录 / 文档前先问**：动既有目录结构（新增子目录、改索引）之前先确认。
8. **Git 约定**：默认分支 `main`，提交信息用中文写清「改了什么 + 为什么」；
   提交前先跑测试。`build/`、`logs/`、`tmp/`、`temp/` 已在 `.gitignore` 里排除。
9. **不要打断用户正在运行的东西**：本机有两个常驻服务
   （8123 发布件服务、8124 调试接收端），动它们之前先确认；
   端口映射、客户端开关之类属于破坏性操作，必须先拿到明确授权。
10. **脚本管理器是 ScriptCat**：在 Tampermonkey 下会持续打橙色告警，且
    `@storageName`、跨标签页同步等能力不保证。报告问题前先确认用户用的是哪个管理器。
11. **提交门槛有个历史坑**：早期版本沿用的
    `Math.floor((total - questionNum) / total) * 100 >= accuracy`
    是**先除后取整**，比例 < 1 一律算 0%，会把「没答完」压成 0% 达标。
    改这块之前先想清楚，见
    [docs/v1.4章节测验与字体解密说明.md](docs/v1.4章节测验与字体解密说明.md)。
12. **推理型模型（MiniMax 等）思考 token 计入 `max_tokens`**：思考一长就把额度吃光，
    返回 `finish_reason=length` + 空 `content`。脚本里 `max_tokens` 已放宽到 8000，
    且对 `minimax` 端点额外下发 `reasoning_effort: 'low'`。
    以后再加 provider，**不要**把 `reasoning_effort` 无条件发给不认这个字段的服务。
13. **调试功能默认关闭**：`unrivalDbgEnabled` 默认 `'0'`。公开版保留调试代码，
    但装了脚本不会往任何地址发请求。改这个默认值前先想清楚是不是想给所有人开。
14. **面板区块顺序是约定，不要随手调**（v1.10.0 起）：
    任务配置（含运行控制）→ 答题设置·题库 │ 答题设置·AI 接口（左右并排）
    → 章节测验/作业自动作答 → 运行日志 → 任务列表 → 附加功能 → 调试模式（最下面）。
    - 调试相关的东西永远在最下面；运行日志和任务列表是主要部分，不塞到末尾；
    - 题库与 AI 的设置必须**分成两块、各存各的**（`saveCtButton` / `saveAiButton`），
      别再合并成一个「保存AI设置」；
    - 小块用 `.unrival-grid` 左右并排，主容器是 `col-md-8`；
    - 改面板 HTML 时，**整块替换**（起始标记 → 结束标记），
      旧的「任务列表 / 运行日志」面板必须一并被换掉，否则会留下重复 id。
15. **运行日志按标签页会话保存**（v1.10.0 起）：日志存 `sessionStorage`，
    语义是「关掉标签页再打开 = 新日志；翻章 = 日志保留」。
    `sessionStorage` 不可用时才退回 GM 存储。改这块别把会话语义改回永久保存。
16. **全程托管模式默认关闭**：`unrivalAutoRun` 默认 `'0'`。
    开启后遇到直播/阅读等做不了的任务会**跳过并继续**，而不是停下等人工 ——
    这是用户明确要的取舍，但**跳过 ≠ 完成**（那一节的任务点不会亮），
    相关说明与边界要在文档里写清楚。

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
