# dist/ —— 发布件

这里放**当前发布版**，也是 GitHub Release 的资产源。整个目录只有两个固定名文件：

| 文件 | 作用 | 对应元数据 |
|---|---|---|
| `chaoxing-helper.user.js` | 完整脚本，别人装的就是它 | `@downloadURL` |
| `chaoxing-helper.meta.js` | 只有 `==UserScript==` 元数据块 | `@updateURL` |

（外加本说明文件 `README.md`。）

## 为什么不带版本号

ScriptCat 会把「安装时的来源地址」记成脚本的来源，之后点「检查更新」时
把地址里的 `user.js` 换成 `meta.js` 去拉元数据（`deriveMetaUrl = url.replace("user.js","meta.js")`）。
如果文件名带版本号（`…-v1.8.2.user.js`），升级后那个旧地址就失效了 ⇒ 检查更新报失败。

所以这里用**固定文件名**，发布新版时原地覆盖；更新地址永远是
`https://github.com/qianbkk/chaoxing-helper/releases/latest/download/chaoxing-helper.{meta,user}.js`。

## 发版步骤

```powershell
pwsh -File src\build.ps1            # 重建 dist/（含元数据块）
node tests\release-meta.test.js     # 发布卫生闸门：地址、版本、脱敏逐项复查
gh release create v1.9.0 --title "v1.9.0" --notes "……" `
    dist\chaoxing-helper.user.js dist\chaoxing-helper.meta.js
```

发完之后，别人点「检查更新」就会拿到新版本 —— 因为 `releases/latest` 指向最新 Release，
而元数据块里的 `@version` 更高。

发新版时把**同名资产**挂到新的 Release 上即可，脚本里的更新地址一个字都不用改。

## 本机调试变体不在这里

调试变体（`build/chaoxing-helper.debug.user.js`）的更新地址指向本机接收端
`127.0.0.1:8124`，只在维护者自己机器上用，**不进版本库、也不发 Release**。

本机安装 / 更新地址：

- 安装与更新（调试变体）：`http://127.0.0.1:8124/latest.user.js`
- 本机调试通道（命令与日志）：`http://127.0.0.1:8124/`
