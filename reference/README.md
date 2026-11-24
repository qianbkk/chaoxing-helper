# reference/ —— 上游参考来源

本目录**不存上游源码**，只记「这份脚本从哪来、我们改了什么」。
需要看上游原始代码时，按下面的链接自己去取。

## 上游坐标

| 项目 | 链接 | 版本 / 日期 | 许可 |
|---|---|---|---|
| ScriptCat 官方原版 | <https://scriptcat.org/script-show-page/878/>《❤【超星学习通小助手】【正则修改版】【完全免费】视频-章节测试_自动挂机_防清进度_不占资源》 | v1.0 / 2023-12 | GPL-3.0-or-later |
| Greasy Fork 484657 | <https://greasyfork.org/zh-CN/scripts/484657>《🥇【学习通助手】【free】 全自动刷课脚本》 | v5.0 / 2024-05-15（已停更） | GPL-3.0-or-later |
| Greasy Fork 530068 | <https://greasyfork.org/zh-CN/scripts/530068>《🫧404小站 — 学习通助手》 | v5.5.9.9.6 / 2026-07-23 | 同上 |

- 作者：`unrival`（Greasy Fork 用户 `yyy.404`），ScriptCat 主页 <https://scriptcat.org/zh-CN/script-show-page/3321>
- 上面几份脚本的 `@storageName` 都是 `unrivalxxt`，即**共用同一份 ScriptCat 存储**。
- 本项目基线来自 ScriptCat 878 号脚本（`@version 1.0`）；它属于 Greasy Fork 484657 v5.0 的衍生分支。
  比对结论见 [`../docs/上游版本溯源.md`](../docs/上游版本溯源.md)。

## 我们改了什么

| 方向 | 说明 | 详情 |
|---|---|---|
| 挖矿脚本 | 上游的第三方二次打包版本会注入浏览器挖矿脚本，**本项目 v1.1 起已删除**，并在发布件里留了说明注释 | [docs/上游挖矿溯源.md](../docs/上游挖矿溯源.md) |
| 答题链路 | 题库优先 + AI 兜底、流控识别、按下标点击、正确率口径修正、提交判定以 DOM 实况为准 | [docs/AI答题改造方案.md](../docs/AI答题改造方案.md) |
| 字体解密 | 把上游的「死代码」补成自包含可用的实现（内联 Typr/md5/字形映射表） | [docs/v1.4章节测验与字体解密说明.md](../docs/v1.4章节测验与字体解密说明.md) |
| 交互 | 面板折叠与限高、日志持久化与倒序、暂停/继续、版本号动态化 | [docs/INDEX.md](../docs/INDEX.md) |
| 第三方外发 | 上游刷视频时会把 classId / UID / 学习进度**明文 HTTP** 发到一个第三方服务器去取签名令牌，查题失败还会把题干发去另一个地址。**v1.9.0 已移除**：签名改由脚本本地计算，发布件只联系超星自己的域名、你配置的 AI 接口与题库接口 | [CHANGELOG](../CHANGELOG.md) |
| 工程 | 补丁链构建、十一套测试、发布件服务、调试命令通道、发布卫生闸门 | [docs/开发与构建.md](../docs/开发与构建.md) |

## 重新获取上游源码（仅供比对，不进本仓库）

```powershell
# 需要经本机代理（7897），直连 update.greasyfork.org 不通
$env:HTTPS_PROXY='http://127.0.0.1:7897'
curl.exe -s -L -A "Mozilla/5.0" "https://update.greasyfork.org/scripts/530068.user.js" -o 上游-GF530068.user.js
curl.exe -s -L -A "Mozilla/5.0" "https://update.greasyfork.org/scripts/484657/<slug>.user.js" -o 上游-GF484657.user.js
```

取到之后**不要提交进仓库**：上游源码里含有作者的个人信息（邮箱、手机号），
本仓库不收录任何他人个人信息。比对结论请写进 `docs/`，不要贴源码。

## 许可

上游均为 **GPL-3.0-or-later**，本项目是同许可的衍生作品，许可声明见 [`../NOTICE.md`](../NOTICE.md)。
