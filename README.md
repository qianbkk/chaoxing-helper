# 超星学习通小助手（AI 版）

> ScriptCat 用户脚本：超星学习通**自动刷课 + 自动答题**。
> 本仓库是该脚本的**开发与发布**工程，发布件在 [Releases](https://github.com/qianbkk/chaoxing-helper/releases/latest)。

| | |
|---|---|
| 当前版本 | **v1.9.0-AI** |
| 安装地址 | https://github.com/qianbkk/chaoxing-helper/releases/latest/download/chaoxing-helper.user.js |
| 检查更新 | 脚本已声明 `@updateURL` / `@downloadURL`，在 ScriptCat 里点「检查更新」即可 |
| 脚本管理器 | **ScriptCat（脚本猫）**，见下方说明 |
| 许可 | GPL-3.0-or-later（衍生自上游同名脚本，见 [NOTICE.md](NOTICE.md)） |

---

## 1. 它能做什么

- **自动刷视频与文档**：进课程章节页即自动学习、记录进度、按设定方式翻到下一章。
- **章节测验 / 作业自动作答**：优先走题库，查不到或被限流时自动降级到 **AI**（任何 OpenAI 兼容接口）。
- **超星加密字体自动解密**：超星把题干和选项用自定义字体加密显示，不解密就是一堆乱码，题库和 AI 都答不了。本脚本自带映射表，**不依赖外部 CDN**。
- **运行控制**：一键暂停/继续，状态跨翻章保持。
- **调试模式**（**默认关闭**）：面板日志实时落盘到本机文件，并支持从命令行远程操控脚本。

### 改造了什么（相对上游原版）

上游脚本的典型症状是「刷视频正常、做题目不行」。经静态分析 + 接口实测，根因是三件事叠加：

1. 上游的备用题库服务器已下线（实测 TCP 不通）；
2. 接口流控返回码未被识别为失败，把「触发流控限制」的提示当成了答案文本；
3. 正确率默认 100%，而填空题被跳过却仍算进分母 ⇒ 正确率结构性到不了 100% ⇒ **永远只保存不提交**。

本项目逐条修掉，并补齐了字体解密、提交判定、日志持久化、面板交互等一整套工程细节。
完整脉络见 [docs/AI答题改造方案.md](docs/AI答题改造方案.md)。

### ⚠️ 已知未验证 / 未实现

写在这里是为了不让人误以为「什么都能干」：

| 项 | 状态 |
|---|---|
| 直播任务点 | **未实现**。脚本会打出任务类型并停下提示人工处理，不会自动刷直播 |
| 阅读任务点 | **未实现**（上游新版的阅读助手只是滚动计时，不上报完成） |
| 填空题 | **未实现**，会被跳过（也就意味着它算在正确率分母里） |
| v1.3 的三个实验性模块（强制复制粘贴 / 考试端作答 / 任务页保活） | 代码与单测都在，但**真实超星页面未验证**，默认全部关闭 |
| 视觉兜底（截图交视觉模型） | 未实现 |

---

## 2. 安装

### 2.1 先装 ScriptCat（脚本猫）

脚本是给 **ScriptCat** 写的。上游原版里有一行自检：

```js
isCat = GM_info.scriptHandler == 'ScriptCat';
```

在 Tampermonkey（篡改猴）里运行会持续打橙色告警，且 `@storageName`、跨标签页状态同步等能力不保证。
请在 Chrome 应用商店搜「脚本猫」安装，扩展 ID `ndcooeababalnlpkfedmmbgkljhpjf`；
装完记得在扩展详情页打开「**允许运行用户脚本**」。

> ⚠️ 两个脚本管理器同时装同一个脚本会互相抢 `.user.js` 的接管，先关掉旧的再导。

### 2.2 装脚本

在浏览器打开下面这个地址，ScriptCat 会接管并弹出安装页，点「安装」：

```
https://github.com/qianbkk/chaoxing-helper/releases/latest/download/chaoxing-helper.user.js
```

> 必须通过 http(s) 打开 `.user.js` 才会触发安装；用 `file://` 打开只会被当成纯文本渲染。

### 2.3 首次配置

1. 打开超星课程章节页（`knowledge/cards`），页面会被替换成脚本面板；
2. 在「**AI 答题设置**」面板里填：
   - **Base URL**：OpenAI 兼容接口根地址，例 `https://api.deepseek.com/v1`
     （**不要带** `/chat/completions`，脚本会自动拼）；
   - **模型**：例 `deepseek-chat`；
   - **API Key**：你的 key（只存在你浏览器的 ScriptCat 存储里，脚本文件本身不含任何密钥）；
   - **题库 Token**（选填）：只影响题库并发，不填也能答；
   - **正确率门槛**（默认 80%）：达到该比例才自动提交；
   - **翻章模式**：遍历（推荐）/ 不跳转。
3. 点「保存AI设置」→「测试AI连通性」，看到 **AI连通性正常** 即可；
4. 章节测试处打开「自动答题」+「自动提交」。

> 任何 OpenAI 兼容的 `/chat/completions` 服务都行：DeepSeek、Kimi、智谱、MiniMax、通义、
> OpenRouter、Ollama、本机 CLIProxyAPI 等。

### 2.4 自动更新

脚本元数据里声明了：

```
// @updateURL    https://github.com/qianbkk/chaoxing-helper/releases/latest/download/chaoxing-helper.meta.js
// @downloadURL  https://github.com/qianbkk/chaoxing-helper/releases/latest/download/chaoxing-helper.user.js
```

发新版时只要把同名资产挂到新的 Release 上，**已安装的用户点「检查更新」就能拿到新版**，
元数据不用改。之所以走 Release 而不是 `main` 分支的 raw 地址：`main` 上可能是实验性改动，
推上去就会影响所有用户的更新；发 Release 才是「这一版是稳定版」的明确动作。

更详细的说明见 [docs/安装与自动更新.md](docs/安装与自动更新.md)。

---

## 3. 目录结构

```
chaoxing-helper/
├── README.md                        ← 本文件，仓库总入口
├── AGENTS.md                        ← 开发者工作约定（改文件前必读）
├── CHANGELOG.md                     ← 版本演进记录（改了什么/为什么/怎么验证的）
├── NOTICE.md                        ← 第三方组件与许可声明
├── LICENSE                          ← GPL-3.0
├── src/                             ← 源码与构建链
│   ├── README.md                    ← 构建链说明 + 如何新增一个版本
│   ├── build.ps1                    ← 一键重建（基线 → 补丁 → dist/ + 元数据块 + 调试变体）
│   ├── baseline/                    ← 本仓库基线（脱敏后的 v1.8.2 发布件），补丁链的起点
│   │   └── chaoxing-helper.base.js
│   ├── patches/                     ← 增量补丁脚本（每个负责一次版本跃迁）
│   │   └── patch-v1.9.0.ps1         ← v1.9.0：更新地址切到 GitHub Releases + 元数据整理
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
│   │   ├── workresult.v1.8.js / workresult.v1.8.1.js  ← 提交后读成绩（重试 + 分级报告）
│   │   └── debugcmd.v1.8.2.js       ← 调试命令通道：newversion 自动开安装页 + dump 探针
│   ├── assets/                      ← 被内联进脚本的第三方资产（MIT）
│   │   ├── typr-md5.min.js          ← 字体解析 Typr + md5
│   │   └── font-table-2.0.json      ← 字形映射表（20902 条）
│   └── tools/                       ← 构建期工具 + 本机调试通道
│       ├── make-meta.cjs            ← 从发布件抽出 ==UserScript== 元数据块
│       ├── verify-baseline-font-table.cjs ← 构建期闸门：基线内联表 vs 源表逐条一致
│       ├── serve-dist.cjs           ← 本机发布件服务（安装/更新用，动态提供历史版本名别名）
│       ├── serve-dist.ps1           ← 启动上面的服务（包装脚本）
│       └── log-sink.cjs             ← 本机调试通道：日志落盘 + 远程操控 + 版本自检
├── dist/                            ← 发布件（提交进版本库，也是 Release 的资产源）
│   ├── README.md
│   ├── chaoxing-helper.user.js      ← ★当前发布版
│   └── chaoxing-helper.meta.js      ← ★它的元数据块（@updateURL 指向的资产）
├── build/                           ← 构建中间产物 + 调试变体，已 gitignore，可随时删
├── tests/                           ← 十一套测试，改完必跑（共 549 项断言）
│   ├── ai-module.test.js            ← AI 模块单元测试（fake DOM，43 断言）
│   ├── ai-integration.test.js       ← 端到端集成测试（mock OpenAI 服务，14 断言）
│   ├── debugcmd.test.js             ← 调试命令通道 + 接收端往返（71 断言）
│   ├── debuglog.test.js             ← 调试日志模块（42 断言）
│   ├── extras-module.test.js        ← v1.3 附加模块单测（56 断言）
│   ├── pause-module.test.js         ← 暂停/继续模块（27 断言）
│   ├── release-meta.test.js         ← 发布件形态 + 发布卫生红线（27 断言）
│   ├── serve-dist.test.js           ← 发布件服务：历史版本名可用（32 断言）
│   ├── v16-module.test.js           ← v1.6 题库熔断 + 面板（42 断言）
│   ├── v18-module.test.js           ← v1.8/v1.8.1/v1.8.2 全部改动（154 断言）
│   ├── workauto-module.test.js      ← v1.4 字体解密 + 自动作答（41 断言）
│   └── fixtures/
│       ├── font-cxsecret.b64        ← 真实页面抓下来的加密字体（可复现证据）
│       └── font-decrypt-evidence.txt← 真实页 168 字符的逐字命中记录（40/40 证据）
├── docs/                            ← 结论与取证，入口是 docs/INDEX.md
└── reference/                       ← 上游参考来源（只放链接与改动说明，不放上游源码）
```

> 📌 **目录约定**：`src/` 放「怎么造出脚本」，`dist/` 放「能直接用的脚本」，`docs/` 放「结论与依据」，
> `tests/` 放「怎么证明没改坏」，`reference/` 放「上游是谁、我们改了什么」。
> 历史版本不进 `dist/`，需要时从 git 历史取。

> 📌 **基线说明**：`src/baseline/chaoxing-helper.base.js` 是脱敏后的 v1.8.2 发布件，
> 是本仓库补丁链的起点。v1.1~v1.8.2 那条「上游原版 → 逐版打补丁」的链留在私有存档仓库里，
> 本仓库从 v1.9.0 起独立演进。

### 旧路径对照表

公开之前，本项目是「以上游原版为基线、逐版打补丁」的私有工程。v1.9.0 起结构变了，
下面这张表把老路径映射到新位置，避免文档里的引用失效：

| 旧路径 | 现在在哪 |
|---|---|
| `src/original/❤【超星学习通小助手】…user.js`（上游原版） | **公开仓库不含**（上游原件带挖矿载荷）；存档仓库 `qianbkk/scriptcat-chaoxing-helper` 的同名路径 |
| `src/patches/patch-v1.1.ps1` … `patch-v1.8.2.ps1` | 存档仓库同名路径；本仓库的补丁链从 `patch-v1.9.0.ps1` 起 |
| `build/超星学习通小助手-AI版-v1.X.Y.user.js` | `build/`（中间产物，随时可重建） |
| `dist/超星学习通小助手-AI版-v1.8.2.user.js` | `dist/chaoxing-helper.user.js`（**固定文件名**，不带版本号） |
| `dist/…-v1.8.2.user.js` 的元数据块 | `dist/chaoxing-helper.meta.js`（Release 资产，与脚本同名成对） |
| `reference/上游-GF484657-v5.0.user.js`<br>`reference/上游-GF530068-v5.5.9.9.6.user.js` | **不再随包分发**（上游源码含他人个人信息）；在线地址见 [reference/README.md](reference/README.md) |
| `src/tools/pack-font-table.cjs`<br>`src/tools/verify-font-table.cjs` | `src/tools/verify-baseline-font-table.cjs`（改为直接核对基线里内联的那张表） |
| `src/tools/serve-dist.ps1` / `serve-dist.cjs` | 保留，行为不变 |
| `src/tools/log-sink.cjs` | 保留，新增「调试变体优先」逻辑 |

---

## 4. 开发（维护者视角）

```powershell
# 1. 改生成脚本，而不是直接改产出文件
notepad src\patches\patch-v1.9.0.ps1   # 版本跃迁脚本
notepad src\modules\*.js               # 整块模块源码
notepad src\build.ps1

# 2. 一键重建（基线 → 补丁 → dist/ + 元数据块 + 调试变体，并做语法校验）
pwsh -File src\build.ps1

# 3. 跑测试（改完必跑，十一套都指向 dist/ 里的当前发布件，合计 549 项断言）
node tests\ai-module.test.js        # 单元：AI 返回解析 / 选项收集 / 点击 / 熔断 / 字体解密
node tests\ai-integration.test.js   # 端到端：本地 mock OpenAI 服务
node tests\extras-module.test.js    # v1.3 附加模块
node tests\workauto-module.test.js  # v1.4：字体解密 / 自动作答
node tests\debuglog.test.js         # v1.5：调试日志模块 + 本机接收端往返
node tests\pause-module.test.js     # v1.5：暂停/继续
node tests\v16-module.test.js       # v1.6：熔断持久化 / 面板 / 折叠限高
node tests\debugcmd.test.js         # v1.7/v1.8.2：调试命令通道 + /__cmd 往返
node tests\v18-module.test.js       # v1.8/v1.8.1/v1.8.2：存储隔离 / 日志 / 提交判定 / 跟随更新
node tests\serve-dist.test.js       # 发布件服务：历史版本名可用
node tests\release-meta.test.js     # 发布件形态 + 发布卫生红线

# 4. 单独语法校验
node --check dist\chaoxing-helper.user.js

# 5. 发版（先跑发布卫生闸门，再挂 Release 资产）
node tests\release-meta.test.js
gh release create v1.9.0 --title "v1.9.0" --notes "……" `
    dist\chaoxing-helper.user.js dist\chaoxing-helper.meta.js
```

更多细节见 [docs/开发与构建.md](docs/开发与构建.md) 与 [src/README.md](src/README.md)。

---

## 5. 文档索引

| 文档 | 内容 |
|---|---|
| [docs/INDEX.md](docs/INDEX.md) | **文档总索引**：推荐阅读顺序 + 「问题→答案在哪」速查表 |
| [docs/安装与自动更新.md](docs/安装与自动更新.md) | 安装、配置、自动更新机制、排错 |
| [docs/开发与构建.md](docs/开发与构建.md) | 构建链、补丁链约定、测试、发布流程 |
| [docs/脚本代码分析报告.md](docs/脚本代码分析报告.md) | 上游原版全量静态分析：模块行号表、核心函数表、定时器/请求清单、风险项；**§10 为查题链路实测** |
| [docs/AI答题改造方案.md](docs/AI答题改造方案.md) | 改造脉络：总体架构、配置模型、P0/P1/P2 范围、关键设计决策与取舍、失败模式兜底、验证方法 |
| [docs/上游版本溯源.md](docs/上游版本溯源.md) | 上游的版本坐标、六个关键结论、v1.2/v1.3 采纳与不采纳清单、能力对照表 |
| [docs/上游挖矿溯源.md](docs/上游挖矿溯源.md) | 挖矿取证：上游各版本逐个核对的结果、触发条件与自查方法 |
| [docs/v1.3附加模块说明.md](docs/v1.3附加模块说明.md) | 三个实验性模块的实现、支持的页面清单、**未验证清单** |
| [docs/v1.4章节测验与字体解密说明.md](docs/v1.4章节测验与字体解密说明.md) | v1.4 起各版本的排查过程、实测证据、**未验证清单** |
| [src/README.md](src/README.md) | 构建链说明与**如何新增一个版本**的标准流程 |
| [dist/README.md](dist/README.md) | 发布件目录说明与发版步骤 |
| [NOTICE.md](NOTICE.md) | 第三方组件、许可与致谢 |
| [CHANGELOG.md](CHANGELOG.md) | 每个版本的「改了什么 / 为什么 / 怎么验证的」详细记录 |
| [AGENTS.md](AGENTS.md) | 目录约定、生成脚本优先、测试要求、密钥不落盘、Git 约定 |

---

## 6. 版本历史

| 版本 | 日期 | 内容 |
|---|---|---|
| v1.1.0-AI | 2026-11-23 | AI 答题链路（配置化端点 / 题库熔断降级 / 按下标点击 / 正确率口径修正 / 提交修复）、移除上游原版注入的挖矿脚本、修复自动保存竞态、正确率默认 100→80 |
| v1.2.0-AI | 2026-11-23 | 采纳上游最新版：加密字体解密、题库 Token 面板化、正确率门槛与翻章模式可视化配置 |
| v1.3.0-AI | 2026-11-23 | 新增「附加功能（实验性 · 未验证）」面板与三个默认关闭的模块 |
| v1.4.0-AI | 2026-11-24 | 字体解密可用化（v1.2 那版是死代码，实测 40/40 加密字符命中）；新增章节测验 / 作业自动作答模块 |
| v1.4.1/v1.4.2-AI | 2026-11-24 | 修复推理型模型答不出题（`max_tokens` 放宽到 8000、MiniMax 端点降思考深度） |
| v1.5.0-AI | 2026-11-24 | 调试模式（面板日志实时落盘）；运行控制（暂停/继续，跨翻章保持） |
| v1.6.0-AI | 2026-11-24 | 题库熔断持久化；未支持任务类型不再静默跳过；面板标题与元数据说清楚；面板折叠 + 限高滚动条 |
| v1.7.0-AI | 2026-11-24 | 调试模式升级为「可远程操控」；接收端版本自检 |
| v1.8.0-AI | 2026-11-25 | 修脚本卡住不动的根因（翻章模式存储污染）；日志跨章节堆积；折叠 UI 重做；面板版本号动态化 |
| v1.8.1-AI | 2026-11-25 | 日志改成「最新的在最上面」；提交结果读取重试；修「章节既没保存也没提交」 |
| v1.8.2-AI | 2026-11-25 | 自主跟随更新（自动打开安装页 + 声明更新地址）；新增 `dump` 调试命令 |
| v1.8.2-hotfix | 2026-11-25 | 修「检查更新」失败：由服务动态提供历史版本名别名 |
| **v1.9.0-AI** | **2026-11-26** | **公开版**：更新地址切到 GitHub Releases（正式版）/ 本机接收端（调试变体）；仓库脱敏并开源；新增发布卫生闸门 |

> 详细记录见 [CHANGELOG.md](CHANGELOG.md)。

---

## 7. 声明与致谢

- 本项目是上游同名脚本的**衍生作品**，许可沿用上游的 **GPL-3.0-or-later**。
  上游作者与出处见 [NOTICE.md](NOTICE.md) 与 [reference/README.md](reference/README.md)。
- v1.4 起内联的第三方资产：字体解析库 Typr + md5、字形映射表 table 2.0（**MIT**）。
- **本仓库不含任何挖矿代码**，也不含他人的个人信息；这两条由
  `tests/release-meta.test.js` 在每次构建时自动复查。
- **发布件只联系三类地址**：超星自己的域名、你自己配置的 AI 接口、你自己配置的题库接口。
  上游那两处第三方外发（刷视频取签名令牌 / 查题兜底）已在 v1.9.0 移除。
- API Key 与题库 Token 均由使用者自行提供、仅保存在本机 ScriptCat 存储中，仓库内不含任何密钥。
