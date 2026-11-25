# =============================================================================
# build.ps1 —— 一键重建发布件
# =============================================================================
# 目录约定：
#   src/baseline/   本仓库的基线（脱敏后的 v1.8.2 发布件），补丁链的起点
#   src/patches/    增量补丁脚本，每个负责一个版本跃迁
#   src/modules/    整块注入脚本的独立模块源码
#   src/assets/     被内联进脚本的第三方资产（字形映射表等）
#   src/tools/      构建期工具 + 本机调试工具
#   build/          中间产物（已 gitignore，可随时删）
#   dist/           发布件（提交进版本库，也是 GitHub Release 的资产源）
#
# 链条：
#   src/baseline/chaoxing-helper.base.js
#     ├─ patch-v1.9.0 (official) ─→ build/chaoxing-helper.v1.9.0.js
#     │   └─ patch-v1.10.0 ─→ build/chaoxing-helper.v1.10.0.js
#     │       └─ patch-v1.11.0 ─→ build/chaoxing-helper.v1.11.0.js
#     │           └─ patch-v1.11.1 ─→ build/chaoxing-helper.v1.11.1.js
#     │               └─ patch-v1.11.2 ─→ build/chaoxing-helper.v1.11.2.js
#     │                   └─ patch-v1.11.3 ─→ build/chaoxing-helper.user.js  ─→ dist/chaoxing-helper.user.js
#     │                                                              ─→ dist/chaoxing-helper.meta.js
#     └─ patch-v1.9.0 (debug)   ─→ build/chaoxing-helper.debug.user.js
#                                  build/chaoxing-helper.debug.meta.js
#
# 【两种变体只差两行元数据】
#   正式版：@updateURL/@downloadURL 指向 GitHub Releases 的固定资产名
#           → 别人装上之后，点「检查更新」就能随仓库的新 Release 自动升级；
#   调试版：@updateURL/@downloadURL 指向本机接收端 127.0.0.1:8124
#           → 本机自用：接收端发现新版本 → 脚本自动弹出安装页 → 点「重新安装」；
#              配合脚本里的调试命令通道（默认关闭），AI agent 无需截图即可操控脚本。
#
# 用法：pwsh -File src/build.ps1
# 约定：改代码时改「生成脚本」，不要直接手改产出文件。
# =============================================================================
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot          # src → 仓库根
$buildDir = Join-Path $root 'build'
$distDir = Join-Path $root 'dist'

New-Item -ItemType Directory -Force -Path $buildDir, $distDir | Out-Null

# ---- 0) 完整性闸门：基线里内联的字体映射表必须与 src/assets/ 源表逐条一致 ----
# 两者一旦失配，脚本里的查表会静默失配（表现为「字体解密不命中」，题干全是乱码）。
Write-Output '==> 校验基线内联的字体映射表'
& node (Join-Path $PSScriptRoot 'tools\verify-baseline-font-table.cjs')
if ($LASTEXITCODE -ne 0) { throw '字体映射表完整性校验失败（基线内联表与源表不一致）' }

# ---- 1) 正式版（更新地址 = GitHub Releases）----
# 补丁链是逐版递进的：基线 → v1.9.0 → v1.10.0 → …
# 每一步都作用在上一步的产物上，中间产物落在 build/（gitignore）。
Write-Output '==> 构建 v1.9.0 中间产物'
& (Join-Path $PSScriptRoot 'patches\patch-v1.9.0.ps1') -Mode official -OutPath (Join-Path $buildDir 'chaoxing-helper.v1.9.0.js')

Write-Output '==> 构建正式版（更新地址 = GitHub Releases）'
& (Join-Path $PSScriptRoot 'patches\patch-v1.10.0.ps1') -Mode official -InPath (Join-Path $buildDir 'chaoxing-helper.v1.9.0.js') -OutPath (Join-Path $buildDir 'chaoxing-helper.v1.10.0.js')
& (Join-Path $PSScriptRoot 'patches\patch-v1.11.0.ps1') -Mode official -InPath (Join-Path $buildDir 'chaoxing-helper.v1.10.0.js') -OutPath (Join-Path $buildDir 'chaoxing-helper.v1.11.0.js')
& (Join-Path $PSScriptRoot 'patches\patch-v1.11.1.ps1') -Mode official -InPath (Join-Path $buildDir 'chaoxing-helper.v1.11.0.js') -OutPath (Join-Path $buildDir 'chaoxing-helper.v1.11.1.js')
& (Join-Path $PSScriptRoot 'patches\patch-v1.11.2.ps1') -Mode official -InPath (Join-Path $buildDir 'chaoxing-helper.v1.11.1.js') -OutPath (Join-Path $buildDir 'chaoxing-helper.v1.11.2.js')
& (Join-Path $PSScriptRoot 'patches\patch-v1.11.3.ps1') -Mode official -InPath (Join-Path $buildDir 'chaoxing-helper.v1.11.2.js')
$official = Join-Path $buildDir 'chaoxing-helper.user.js'
if (-not (Test-Path -LiteralPath $official)) { throw "构建产物缺失: $official" }
Copy-Item -LiteralPath $official -Destination (Join-Path $distDir 'chaoxing-helper.user.js') -Force

Write-Output '==> 生成正式版元数据块'
& node (Join-Path $PSScriptRoot 'tools\make-meta.cjs') (Join-Path $distDir 'chaoxing-helper.user.js') (Join-Path $distDir 'chaoxing-helper.meta.js')
if ($LASTEXITCODE -ne 0) { throw '元数据块生成失败' }

# ---- 2) 调试变体（更新地址 = 本机接收端）----
Write-Output '==> 构建调试变体（更新地址 = 本机接收端 127.0.0.1:8124）'
& (Join-Path $PSScriptRoot 'patches\patch-v1.9.0.ps1') -Mode debug -OutPath (Join-Path $buildDir 'chaoxing-helper.debug.v1.9.0.js')
& (Join-Path $PSScriptRoot 'patches\patch-v1.10.0.ps1') -Mode debug -InPath (Join-Path $buildDir 'chaoxing-helper.debug.v1.9.0.js') -OutPath (Join-Path $buildDir 'chaoxing-helper.debug.v1.10.0.js')
& (Join-Path $PSScriptRoot 'patches\patch-v1.11.0.ps1') -Mode debug -InPath (Join-Path $buildDir 'chaoxing-helper.debug.v1.10.0.js') -OutPath (Join-Path $buildDir 'chaoxing-helper.debug.v1.11.0.js')
& (Join-Path $PSScriptRoot 'patches\patch-v1.11.1.ps1') -Mode debug -InPath (Join-Path $buildDir 'chaoxing-helper.debug.v1.11.0.js') -OutPath (Join-Path $buildDir 'chaoxing-helper.debug.v1.11.1.js')
& (Join-Path $PSScriptRoot 'patches\patch-v1.11.2.ps1') -Mode debug -InPath (Join-Path $buildDir 'chaoxing-helper.debug.v1.11.1.js') -OutPath (Join-Path $buildDir 'chaoxing-helper.debug.v1.11.2.js')
& (Join-Path $PSScriptRoot 'patches\patch-v1.11.3.ps1') -Mode debug -InPath (Join-Path $buildDir 'chaoxing-helper.debug.v1.11.2.js')
$debug = Join-Path $buildDir 'chaoxing-helper.debug.user.js'
if (-not (Test-Path -LiteralPath $debug)) { throw "调试变体缺失: $debug" }
& node (Join-Path $PSScriptRoot 'tools\make-meta.cjs') $debug (Join-Path $buildDir 'chaoxing-helper.debug.meta.js')
if ($LASTEXITCODE -ne 0) { throw '调试变体元数据块生成失败' }

# ---- 3) 语法校验（对两个产物都做）----
Write-Output '==> 语法校验'
node --check (Join-Path $distDir 'chaoxing-helper.user.js')
if ($LASTEXITCODE -ne 0) { throw '正式版语法校验失败' }
node --check $debug
if ($LASTEXITCODE -ne 0) { throw '调试变体语法校验失败' }
Write-Output '    node --check 两个产物均通过'

Write-Output ("==> 完成: {0}" -f (Join-Path $distDir 'chaoxing-helper.user.js'))
Write-Output ("    发布件同时也是 GitHub Release 的资产：chaoxing-helper.user.js + chaoxing-helper.meta.js")
