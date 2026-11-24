# 超星学习通小助手（AI 版）

> 超星学习通课程**自动刷课 + 自动答题**的 ScriptCat 用户脚本。
> 本仓库是它的开发与发布工程，发布件在 [Releases](https://github.com/qianbkk/chaoxing-helper/releases/latest)。

| | |
|---|---|
| 当前版本 | **v1.11.0-AI** |
| 安装地址 | https://github.com/qianbkk/chaoxing-helper/releases/latest/download/chaoxing-helper.user.js |
| 更新方式 | 脚本已声明更新地址，在脚本管理器里点「检查更新」即可 |
| 脚本管理器 | **ScriptCat（脚本猫）**，见 [§2](#2-安装) |
| 许可 | GPL-3.0-or-later |

---

## 1. 它做什么

进入超星课程章节页，脚本接管并开始自动学习：

- **自动刷视频与文档**：按课程目录逐个处理任务，记录播放进度，按设定的翻章模式进入下一章。
- **章节测验 / 作业自动作答**：解析题目与选项，**先查题库**，查不到、超时或被限流时**自动降级到 AI**（任何 OpenAI 兼容接口）。
- **超星加密字体自动解密**：超星把题干和选项用自定义字体加密显示，不解密就是一堆乱码 —— 题库和 AI 都答不了。脚本自带映射表，**不依赖任何外部 CDN**。
- **运行控制**：面板「任务配置」里两个按钮 ——「**开始/继续**」与「**暂停**」，自动翻章、自动作答、自动提交全停，状态跨翻章保持。
- **全程托管模式**（**默认关闭**）：遇到直播 / 阅读这类脚本做不了的任务时**跳过并记账**，继续往下推进，直到没有下一节为止 —— 不用守着看它停下来。
- **调试模式**（**默认关闭**）：面板日志实时落盘到本机文件，并支持从命令行远程操控脚本。
- **面板**：所有配置都在页面上的一个面板里，不用改脚本文件。小块左右并排，调试相关的东西在最下面。

### 三条主线之外的能力边界

写清楚是为了不让人误以为「装上就什么都能干」：

| 能力 | 状态 |
|---|---|
| 章节测验 / 作业自动作答 | ✅ 完整链路已在真实超星页跑通（题库 → AI → 自动提交 → 任务点亮） |
| 加密字体解密 | ✅ 已在真实页实测（168 字符逐字命中 40/40） |
| 直播任务点 | ❌ **未实现**。默认会打出任务类型并停下提示人工处理；开「全程托管」则**跳过继续**（该节任务点不会亮） |
| 阅读任务点 | ❌ **未实现**（这类任务没有可供脚本调用的完成上报接口）。同上：默认停下，全托管则跳过继续 |
| 全程托管模式 | ⚠️ v1.11.0 新增，代码与单测都在，**未在真实超星页复验**；默认关闭 |
| 填空题 | ❌ **未实现**，会被跳过 |
| 复制粘贴 / 考试端作答 / 任务页保活 | ⚠️ 代码与单测都在，但**真实页面未验证**，默认全部关闭 |
| 截图交视觉模型兜底 | ❌ 未实现 |

> 为什么直播和阅读做不了、查过哪些线索，见 [docs/来源与安全说明.md](docs/来源与安全说明.md) 与
> [docs/v1.4章节测验与字体解密说明.md](docs/v1.4章节测验与字体解密说明.md)。

---

## 2. 安装

### 2.1 先装 ScriptCat（脚本猫）

脚本是给 **ScriptCat** 写的，里面有一行自检：

```js
isCat = GM_info.scriptHandler == 'ScriptCat';
```

在 Tampermonkey（篡改猴）里运行会持续打橙色告警，而且 `@storageName`、跨标签页状态同步这些 ScriptCat 专有能力不保证。

- Chrome 应用商店搜「脚本猫」；扩展 ID `ndcooeababalnlpkfedmmbgkljhpjf`
- 装完**在扩展详情页打开「允许运行用户脚本」**
- ⚠️ 两个管理器同时装同一个脚本会互相抢 `.user.js` 的接管，先关掉旧的再导

### 2.2 装脚本

浏览器打开下面这个地址，脚本猫会接管 `.user.js` 并弹出安装页，点「安装」：

```
https://github.com/qianbkk/chaoxing-helper/releases/latest/download/chaoxing-helper.user.js
```

> 必须通过 http(s) 打开才会触发安装；用 `file://` 打开只会被当成纯文本渲染。

### 2.3 首次配置

1. 打开超星课程章节页（`knowledge/cards`），页面会被替换成脚本面板；
2. 填两块设置（面板里左右并排）：

   | 区块 | 项 | 说明 |
   |---|---|---|
   | 答题设置 · 题库（不用 AI 也能答） | 题库 Token | 选填，只影响题库并发，不填也能答 |
   | | 正确率门槛 | 默认 80%，自动提交门槛（按答完题的比例算） |
   | | 翻章模式 | 遍历（推荐）/ 不跳转 |
   | 答题设置 · AI 接口（可选） | Base URL | OpenAI 兼容接口根地址，例 `https://api.deepseek.com/v1`。**不要带** `/chat/completions`，脚本会自动拼 |
   | | 模型 | 例 `deepseek-chat` |
   | | API Key | 你的 key。**只存在你浏览器的脚本管理器存储里**，脚本文件本身不含任何密钥 |

   填完分别点「**保存题库设置**」和「**保存AI设置**」（两块各存各的）。

3. 点「测试AI连通性」，看到 **AI连通性正常** 即可；
4. 在章节测试处打开「自动答题」+「自动提交」。
5. 想让它一路自己刷到底（遇直播/阅读不停机），在「任务配置 → 托管模式」里勾选「全程托管」。

### 2.4 用什么接口都行

任何 OpenAI 兼容的 `/chat/completions` 服务：DeepSeek、Kimi、智谱、MiniMax、通义、OpenRouter、
Ollama、本机 CLIProxyAPI 等。

> ⚠️ 推理型模型（MiniMax 等）会把**思考 token 计入 `max_tokens`**，额度给小了会返回空内容。
> 脚本已把上限放宽到 8000，并对 MiniMax 端点额外下发 `reasoning_effort: 'low'` 降思考深度。

### 2.5 调试模式（默认关闭）

需要排查问题时再开：勾选后，面板日志会**实时写到本机文件**，并且可以**从命令行远程操控脚本**。

```powershell
node src/tools/log-sink.cjs      # 接收端，默认端口 8124，日志落到 logs/

curl -X POST http://127.0.0.1:8124/__cmd -H 'Content-Type: application/json' -d '{"cmd":"status"}'
curl 'http://127.0.0.1:8124/__log?tail=50'
```

可用命令：`pause` / `resume` / `status` / `reload` / `goto <chapterId>` / `set <key> <val>` /
`log <text>` / `dump` / `help`。

> 公开版保留了这套代码，但**开关默认是关的** —— 装了脚本不会往任何地址发请求。

更详细的安装与排错见 [docs/安装与自动更新.md](docs/安装与自动更新.md)。

---

## 3. 自动更新怎么工作

脚本元数据里声明了：

```
// @updateURL    https://github.com/qianbkk/chaoxing-helper/releases/latest/download/chaoxing-helper.meta.js
// @downloadURL  https://github.com/qianbkk/chaoxing-helper/releases/latest/download/chaoxing-helper.user.js
```

发新版时把**同名资产**挂到新的 Release 上，**已安装的用户点「检查更新」就能拿到新版，元数据不用改**。

为什么走 Release 而不是 `main` 分支的 raw 地址：`main` 上可能是实验性改动，推上去就会影响所有用户的更新；
发 Release 才是「这一版是稳定版」的明确动作，`releases/latest` 永远指向最新的正式版（预发布版不算）。

两个必须知道的实现细节（读脚本管理器源码 + 本机实测确认）：

1. `@updateURL` 与 `@downloadURL` **必须同时声明**，只声明一个不生效；
2. `@updateURL` 返回的内容会被当作元数据块解析，所以它必须是 `==UserScript==` 元数据块
   （`.meta.js`），不是 Greasy Fork 的 JSON —— 这就是 Release 上要挂两个资产的原因。

---

## 4. 目录结构

```
chaoxing-helper/
├── README.md                        ← 本文件，仓库总入口
├── AGENTS.md                        ← 开发者工作约定（改文件前必读）
├── CHANGELOG.md                     ← 版本演进记录（改了什么/为什么/怎么验证的）
├── NOTICE.md                        ← 许可、第三方组件与致谢
├── LICENSE                          ← GPL-3.0
├── src/                             ← 源码与构建链
│   ├── README.md                    ← 构建链说明 + 如何新增一个版本
│   ├── build.ps1                    ← 一键重建（基线 → 补丁 → dist/ + 元数据块 + 调试变体）
│   ├── baseline/                    ← 本仓库基线（脱敏后的 v1.8.2 发布件），补丁链的起点
│   │   ├── README.md
│   │   └── chaoxing-helper.base.js
│   ├── patches/                     ← 增量补丁脚本（每个负责一次版本跃迁）
│   │   ├── patch-v1.9.0.ps1         ← v1.9.0：更新地址切到 GitHub Releases + 元数据整理
│   │   ├── patch-v1.10.0.ps1        ← v1.10.0：面板重排 + 运行日志按标签页会话化
│   │   └── patch-v1.11.0.ps1        ← v1.11.0：全程托管模式
│   ├── modules/                     ← 整块注入脚本的独立模块源码
│   │   ├── cxdecrypt.v1.4.js        ← 自包含字体解密
│   │   ├── workauto.v1.4.js         ← 章节测验 / 作业自动作答
│   │   ├── debuglog.v1.5.js         ← 调试日志：面板日志实时落盘
│   │   ├── pause.v1.5.js            ← 暂停 / 继续
│   │   ├── layout.v1.6.js / layout.v1.8.js   ← 面板折叠与限高
│   │   ├── debugcmd.v1.7.js         ← 调试命令通道（旧版，被 v1.8.2 整体替换）
│   │   ├── jumptype.v1.8.js         ← 翻章模式存储隔离（独立键 unrivalJumpTypeReal）
│   │   ├── panelver.v1.8.js         ← 面板版本号运行时动态取
│   │   ├── loghist.v1.8.js / loghist.v1.8.1.js        ← 运行日志持久化（倒序渲染）
│   │   ├── loghist.v1.10.js         ← 运行日志按标签页会话化（关标签清空、翻章保留）
│   │   ├── autorun.v1.11.js         ← 全程托管模式：跳过做不了的任务 + 卡住自动重试
│   │   ├── workresult.v1.8.js / workresult.v1.8.1.js  ← 提交后读成绩（重试 + 分级报告）
│   │   └── debugcmd.v1.8.2.js       ← 调试命令通道：版本通知自动开安装页 + dump 探针
│   ├── assets/                      ← 被内联进脚本的第三方资产（MIT）
│   │   ├── typr-md5.min.js          ← 字体解析 Typr + md5
│   │   └── font-table-2.0.json      ← 字形映射表（20902 条）
│   └── tools/                       ← 构建期工具 + 本机调试通道
│       ├── make-meta.cjs            ← 从发布件抽出 ==UserScript== 元数据块
│       ├── verify-baseline-font-table.cjs ← 构建期闸门：基线内联表 vs 源表逐条一致
│       ├── serve-dist.cjs / .ps1    ← 本机发布件服务（安装/更新用）
│       └── log-sink.cjs             ← 本机调试通道：日志落盘 + 远程操控 + 版本自检
├── dist/                            ← 发布件（提交进版本库，也是 Release 的资产源）
│   ├── README.md
│   ├── chaoxing-helper.user.js      ← ★当前发布版
│   └── chaoxing-helper.meta.js      ← ★它的元数据块（@updateURL 指向的资产）
├── build/                           ← 构建中间产物 + 调试变体，已 gitignore，可随时删
├── tests/                           ← 十二套测试，改完必跑（共 671 项断言）
│   ├── ai-module.test.js            ← AI 模块单元测试（fake DOM，43 断言）
│   ├── ai-integration.test.js       ← 端到端集成测试（mock OpenAI 服务，14 断言）
│   ├── debugcmd.test.js             ← 调试命令通道 + 接收端往返（71 断言）
│   ├── debuglog.test.js             ← 调试日志模块（42 断言）
│   ├── extras-module.test.js        ← 附加模块单测（56 断言）
│   ├── pause-module.test.js         ← 暂停/继续模块（27 断言）
│   ├── release-meta.test.js         ← 发布件形态 + 发布卫生红线（31 断言）
│   ├── serve-dist.test.js           ← 发布件服务：历史版本名可用（32 断言）
│   ├── v16-module.test.js           ← 题库熔断 + 面板（42 断言）
│   ├── v18-module.test.js           ← 存储隔离 / 日志 / 提交判定 / 跟随更新（163 断言）
│   ├── v110-module.test.js          ← 面板重排 / 日志会话语义 / 全程托管模式（107 断言）
│   ├── workauto-module.test.js      ← 字体解密 + 自动作答（41 断言）
│   └── fixtures/
│       ├── font-cxsecret.b64        ← 真实页面抓下来的加密字体（可复现证据）
│       └── font-decrypt-evidence.txt← 真实页 168 字符的逐字命中记录（40/40 证据）
└── docs/                            ← 结论与依据，入口是 docs/INDEX.md
    ├── INDEX.md                     ← 文档索引（阅读顺序 + 速查表）
    ├── 安装与自动更新.md              ← 安装、配置、更新机制、排错
    ├── 开发与构建.md                  ← 构建链、补丁链约定、测试、发布流程
    ├── 来源与安全说明.md              ← 项目来历、改造原因、安全现状与自查方法
    ├── AI答题改造方案.md              ← 改造脉络：架构、配置模型、范围划分、设计决策
    ├── v1.3附加模块说明.md            ← 三个实验性模块的实现、开关、未验证清单
    └── v1.4章节测验与字体解密说明.md    ← 字体解密可用化 + 章节测验自动作答的排查与实测
```

> 📌 **目录约定**：`src/` 放「怎么造出脚本」，`dist/` 放「能直接用的脚本」，`docs/` 放「结论与依据」，
> `tests/` 放「怎么证明没改坏」。历史版本不进 `dist/`，需要时从 git 历史取。

> 📌 **基线是什么**：`src/baseline/chaoxing-helper.base.js` 是脱敏后的 v1.8.2 发布件，
> 本仓库补丁链的起点。本仓库从 v1.9.0 起独立演进，早期那条逐版打补丁的链在存档仓库里，
> 详见 [src/baseline/README.md](src/baseline/README.md)。

---

## 5. 开发（维护者视角）

```powershell
# 1. 改生成脚本，而不是直接改产出文件
notepad src\patches\patch-vX.Y.Z.ps1   # 版本跃迁脚本
notepad src\modules\*.js               # 整块模块源码
notepad src\build.ps1

# 2. 一键重建（完整性闸门 + 两个产物的语法校验）
pwsh -File src\build.ps1

# 3. 跑测试（改完必跑，十二套都指向 dist/ 里的当前发布件，合计 671 项断言）
Get-ChildItem tests\*.test.js | ForEach-Object { node $_.FullName }

# 4. 单独语法校验
node --check dist\chaoxing-helper.user.js

# 5. 发版（先跑发布卫生闸门，再挂 Release 资产）
node tests\release-meta.test.js
gh release create vX.Y.Z --title "vX.Y.Z" --notes "……" `
    dist\chaoxing-helper.user.js dist\chaoxing-helper.meta.js
```

更多细节见 [docs/开发与构建.md](docs/开发与构建.md) 与 [src/README.md](src/README.md)。

---

## 6. 文档索引

| 文档 | 内容 |
|---|---|
| [docs/INDEX.md](docs/INDEX.md) | **文档总索引**：按角色的阅读顺序 + 「问题→答案在哪」速查表 |
| [docs/安装与自动更新.md](docs/安装与自动更新.md) | 安装、配置、自动更新机制、排错 |
| [docs/开发与构建.md](docs/开发与构建.md) | 构建链、补丁链约定、测试、发布流程 |
| [docs/来源与安全说明.md](docs/来源与安全说明.md) | 项目来历、为什么做这个项目、已经移除的行为、安全现状与自查方法 |
| [docs/AI答题改造方案.md](docs/AI答题改造方案.md) | 改造脉络：总体架构、配置模型、范围划分、关键设计决策与取舍、失败模式兜底 |
| [docs/v1.3附加模块说明.md](docs/v1.3附加模块说明.md) | 三个实验性模块的实现、支持的页面清单、**未验证清单** |
| [docs/v1.4章节测验与字体解密说明.md](docs/v1.4章节测验与字体解密说明.md) | 字体解密从死代码到可用、章节测验自动作答模块、**未验证清单** |
| [src/README.md](src/README.md) | 构建链说明与**如何新增一个版本**的标准流程 |
| [src/baseline/README.md](src/baseline/README.md) | 基线的来历、里面还保留了什么、之后怎么改 |
| [dist/README.md](dist/README.md) | 发布件目录说明与发版步骤 |
| [NOTICE.md](NOTICE.md) | 许可、第三方组件与致谢 |
| [CHANGELOG.md](CHANGELOG.md) | 每个版本的「改了什么 / 为什么 / 怎么验证的」详细记录 |
| [AGENTS.md](AGENTS.md) | 目录约定、生成脚本优先、测试要求、密钥不落盘、Git 约定 |

---

## 7. 版本历史

| 版本 | 日期 | 内容 |
|---|---|---|
| v1.1.0-AI | 2026-11-23 | AI 答题链路（配置化端点 / 题库熔断降级 / 按下标点击 / 正确率口径修正 / 提交修复）、移除注入的挖矿脚本、修复自动保存竞态、正确率默认 100→80 |
| v1.2.0-AI | 2026-11-23 | 加密字体解密、题库 Token 面板化、正确率门槛与翻章模式可视化配置 |
| v1.3.0-AI | 2026-11-23 | 新增「附加功能（实验性 · 未验证）」面板与三个默认关闭的模块 |
| v1.4.0-AI | 2026-11-24 | 字体解密可用化（此前是死代码，实测 40/40 加密字符命中）；新增章节测验 / 作业自动作答模块 |
| v1.4.1/v1.4.2-AI | 2026-11-24 | 修复推理型模型答不出题（`max_tokens` 放宽到 8000、MiniMax 端点降思考深度） |
| v1.5.0-AI | 2026-11-24 | 调试模式（面板日志实时落盘）；运行控制（暂停/继续，跨翻章保持） |
| v1.6.0-AI | 2026-11-24 | 题库熔断持久化；未支持任务类型不再静默跳过；面板标题与元数据说清楚；面板折叠 + 限高滚动条 |
| v1.7.0-AI | 2026-11-24 | 调试模式升级为「可远程操控」；接收端版本自检 |
| v1.8.0-AI | 2026-11-25 | 修脚本卡住不动的根因（翻章模式存储污染）；日志跨章节堆积；折叠 UI 重做；面板版本号动态化 |
| v1.8.1-AI | 2026-11-25 | 日志改成「最新的在最上面」；提交结果读取重试；修「章节既没保存也没提交」 |
| v1.8.2-AI | 2026-11-25 | 自主跟随更新（自动打开安装页 + 声明更新地址）；新增 `dump` 调试命令 |
| v1.8.2-hotfix | 2026-11-25 | 修「检查更新」失败：由服务动态提供历史版本名别名 |
| **v1.9.0-AI** | **2026-11-26** | **公开版**：独立干净仓库开源；更新地址切到 GitHub Releases；移除两处第三方外发；新增发布卫生闸门 |
| v1.10.0-AI | 2026-11-26 | 面板重排（题库与 AI 拆成两块、左右并排、去掉没必要的小字）；运行控制并入任务配置，拆成「开始/继续」+「暂停」两个按钮；运行日志按标签页会话化 |
| **v1.11.0-AI** | **2026-11-26** | **全程托管模式**（默认关闭）：遇直播/阅读等做不了的任务跳过继续、超星不放行时自动重试、日志按标签页会话化 |

> 详细记录见 [CHANGELOG.md](CHANGELOG.md)。

---

## 8. 许可与致谢

- 本项目基于几个公开的超星学习通脚本重做而成，是 **GPL-3.0-or-later** 的衍生作品；
  来源、作者与致谢见 [NOTICE.md](NOTICE.md)。
- 内联的第三方资产（字体解析 Typr + md5、字形映射表）为 **MIT**。
- **发布件只联系三类地址**：超星自己的域名、你自己配置的 AI 接口、你自己配置的题库接口。
- 仓库与发布件**不含任何挖矿代码、不含他人的个人信息、不含任何密钥**；
  这几条由 `tests/release-meta.test.js` 在每次构建时自动复查。
