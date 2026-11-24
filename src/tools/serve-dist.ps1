# 启动本地发布件服务，供篡改猴(ScriptCat) 安装 / 更新用户脚本。
#
# 为什么需要它：
#   用户脚本管理器只在通过 http(s) 打开 .user.js 时才会接管并弹出安装页；
#   直接用 file:// 打开只会被当成纯文本渲染（不会触发安装）。
#   篡改猴会把这个 URL 记为脚本的「来源」，之后「检查更新」也走这个地址，
#   所以服务必须能长期可达 —— 用这个脚本启动即可。
#
# 【为什么不是普通的静态服务器】
#   篡改猴记下的来源地址带**当时的版本号**（如 …-v1.8.1.user.js），
#   点「检查更新」时它会：
#     ① 把来源地址的 user.js 换成 meta.js 去拉元数据；
#     ② 若失败，回退到原始来源地址再拉一次。
#   所以服务必须能回答「任意历史版本文件名」的 .user.js 与 .meta.js，
#   否则旧版本名一律 404 ⇒ 界面显示「检查更新失败」。
#   实际服务由 src/tools/serve-dist.cjs 提供这些别名，
#   **不需要**往 dist/ 里塞副本（dist/ 只留当前发布件这条规矩不变）。
#
# 用法：
#   pwsh -File src\tools\serve-dist.ps1          # 前台启动，Ctrl+C 停止
#   pwsh -File src\tools\serve-dist.ps1 -Port 8123
#
# 启动后浏览器打开（注意中文文件名要 URL 编码）：
#   http://127.0.0.1:8123/latest.user.js
param(
    [int]$Port = 8123
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # src/tools → src → 仓库根
$dist = Join-Path $root 'dist'

if (-not (Test-Path -LiteralPath $dist)) { throw "找不到发布件目录: $dist" }

$release = Get-ChildItem -LiteralPath $dist -Filter '*.user.js' -File | Select-Object -First 1
if (-not $release) { throw "dist/ 里没有 .user.js 发布件，先跑 pwsh -File src\build.ps1" }

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw '未找到 node，无法启动发布件服务' }

Write-Host ''
Write-Host "发布件: $($release.Name)  ($([math]::Round($release.Length/1KB,1)) KB)"
Write-Host "安装/更新地址: http://127.0.0.1:$Port/latest.user.js"
Write-Host "检查更新地址:   http://127.0.0.1:$Port/latest.meta.js"
Write-Host '在浏览器里打开上面的 .user.js 地址 → 脚本管理器会弹出安装页 → 点「重新安装」即可更新。'
Write-Host '（Ctrl+C 停止服务；服务停了以后，脚本管理器里的「检查更新」会失败，但脚本本身照常运行）'
Write-Host ''

& $node.Source (Join-Path $PSScriptRoot 'serve-dist.cjs') --port $Port
