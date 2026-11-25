# =============================================================================
# patch-v1.11.5.ps1 —— v1.11.4-AI → v1.11.5-AI 增量补丁（补丁版本号：只改最后一段）
#
# 【v1.11.5 内容：删掉上游赞赏码 + 更新通道切到 jsDelivr】
#
#   ① 删掉上游作者的赞赏码（用户要求）
#      【为什么】上游脚本在任务列表里给每个「视频」任务插一张内联 base64 的
#        微信小程序码（上游作者的赞赏/打赏码）。本仓库是公开版，
#        别人的打赏码不该出现在我们的发布件里 —— 扫了打赏进的是上游作者的账户，
#        却让用户以为是给我们打赏，属于误导。
#      【怎么删】base222 那一行是 169KB 的单行 base64，不能用字面锚点匹配，
#        所以用「区间替换」：从 `var base222 = \`data:image/png;base64,`
#        到 `'<img src="' + base222 + '" alt="Smiley face" width="120" height="120">' + \``
#        整段换掉，保留后面的「[视频] 任务名」那一个面板。
#      【为什么改行为不变】这个图只是插在任务列表里的一张图片，
#        删掉它不影响任何功能 —— 原本它就在「无效视频」分支之外，
#        有图无图都不参与作答/翻章逻辑。
#
#   ② @updateURL / @downloadURL 切到 jsDelivr（GitHub 留作备用）
#      【为什么】已装的用户点「检查更新」是浏览器直接请求 @updateURL。
#      国内访问 GitHub 时快慢极不稳定（实测：同一个地址，直连 461–1068 B/s，
#      大文件 715KB 有三轮里两轮 30 秒超时下载不全），
#      于是「不挂梯子就更新不了 / 更新很慢」。
#      jsDelivr 是国内可直连的 CDN（实测 cdn.jsdelivr.net 三轮全 200），
#      读的就是本仓库 dist/ 里的同一份文件。
#      【怎么切】正式版的两个地址换成 jsDelivr；调试版仍指向本机接收端
#      （本机自用，必须走 127.0.0.1）。
#      【GitHub 备用在哪】GitHub Releases 继续正常发版、地址不变，
#        写进面板说明与文档：jsDelivr 走不通时从 GitHub Releases 手动装。
#      【已知代价】jsDelivr 走 main 分支有缓存延迟（通常几分钟到几十分钟），
#        不是发布即到；这一点在文档里写明。
#
# 【改产出文件前必须先改本脚本 —— dist/ 是构建出来的，不手改】
#
# 用法：
#   pwsh -File src/patches/patch-v1.11.5.ps1 -Mode official
#   pwsh -File src/patches/patch-v1.11.5.ps1 -Mode debug
# =============================================================================
param(
    [ValidateSet('official', 'debug')]
    [string]$Mode = 'official',
    [string]$InPath,
    [string]$OutPath
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # src/patches → src → 仓库根

if (-not $InPath) { throw "必须显式指定 -InPath（v1.11.5 接在 v1.11.4 之后）" }
if (-not $OutPath) {
    $OutPath = if ($Mode -eq 'debug') {
        Join-Path $root 'build\chaoxing-helper.debug.user.js'
    } else {
        Join-Path $root 'build\chaoxing-helper.user.js'
    }
}
if (-not (Test-Path -LiteralPath $InPath)) { throw "找不到输入文件: $InPath" }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutPath) | Out-Null

$text = ([System.IO.File]::ReadAllText($InPath)) -replace "`r`n", "`n"

function NL([string]$s) { return ($s -replace "`r`n", "`n") }

# 命中次数必须恰好等于 $n
function Replace-N([string]$t, [string]$old, [string]$new, [int]$n, [string]$label) {
    $count = ([regex]::Matches($t, [regex]::Escape($old))).Count
    if ($count -ne $n) { throw "锚点[$label] 命中 $count 次（应为 $n 次）" }
    return $t.Replace($old, $new)
}

# 命中次数必须恰好是 1
function Replace-Once([string]$t, [string]$old, [string]$new, [string]$label) {
    return Replace-N $t $old $new 1 $label
}

# 整段替换（含结束标记本身）
function Replace-Block([string]$t, [string]$startMark, [string]$endMark, [string]$new, [string]$label) {
    $sc = ([regex]::Matches($t, [regex]::Escape($startMark))).Count
    $ec = ([regex]::Matches($t, [regex]::Escape($endMark))).Count
    if ($sc -ne 1) { throw "起始锚点[$label] 命中 $sc 次（应为 1 次）" }
    if ($ec -ne 1) { throw "结束锚点[$label] 命中 $ec 次（应为 1 次）" }
    $s = $t.IndexOf($startMark)
    $e = $t.IndexOf($endMark)
    if ($e -lt $s) { throw "结束锚点[$label] 出现在起始标记之前" }
    return $t.Substring(0, $s) + (NL $new) + $t.Substring($e + $endMark.Length)
}

# ---------- 1) 版本号（补丁版本：只改最后一段）----------
# 幂等：重跑构建时版本号可能已经是 1.11.5-AI
if ($text.Contains('// @version      1.11.4-AI')) {
    $text = Replace-Once $text '// @version      1.11.4-AI' '// @version      1.11.5-AI' 'version'
} elseif (-not $text.Contains('// @version      1.11.5-AI')) {
    throw '版本号既不是 1.11.4-AI 也不是 1.11.5-AI'
}

# ---------- 2) 删掉上游赞赏码 ----------
# base222 那一行是 169KB 的单行 base64，字面锚点没法匹配 —— 按行定位，
# 并对相邻行做内容断言（保证删的正是「图 + 它的两个 div」，不多不少）。
# 幂等：补丁链原地链式，重跑构建时这段可能已经删掉了。
$lines = $text -split "`n"
$defIdx = -1
$imgIdx = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i].Contains('var base222 = `data:image/png;base64,')) {
        if ($defIdx -ge 0) { throw '赞赏码定义出现多次，无法定位' }
        $defIdx = $i
    }
    if ($lines[$i].Contains('<img src=') -and $lines[$i].Contains('base222')) {
        if ($imgIdx -ge 0) { throw '赞赏码 <img> 出现多次，无法定位' }
        $imgIdx = $i
    }
}
if ($defIdx -lt 0 -and $imgIdx -lt 0) {
    Write-Output '    （赞赏码已不存在，跳过删除）'
} else {
    if ($defIdx -lt 0) { throw '找不到赞赏码定义（var base222）' }
    if ($imgIdx -lt 0) { throw '找不到赞赏码 <img> 标签' }
    if ($imgIdx -lt $defIdx) { throw '赞赏码 <img> 出现在定义之前' }

    # 断言被删的四行就是「定义 / <div class=panel-body> / <img> / </div>」
    if ($lines[$imgIdx - 1].Trim() -ne '<div class="panel-body">') {
        throw "赞赏码 <img> 上面一行不是 <div class=`"panel-body`">（实际: $($lines[$imgIdx - 1].Trim())）"
    }
    if ($lines[$imgIdx + 1].Trim() -ne '</div>') {
        throw "赞赏码 <img> 下面一行不是 </div>（实际: $($lines[$imgIdx + 1].Trim())）"
    }
    if (-not $lines[$imgIdx].Contains('alt="Smiley face" width="120" height="120"')) {
        throw "赞赏码 <img> 行内容与预期不符: $($lines[$imgIdx].Trim())"
    }

    # 从后往前删，避免行号位移
    $remove = @($defIdx, ($imgIdx - 1), $imgIdx, ($imgIdx + 1)) | Sort-Object -Descending -Unique
    foreach ($i in $remove) {
        $lines = $lines[0..($i - 1)] + $lines[($i + 1)..($lines.Count - 1)]
    }
    $text = ($lines -join "`n")
}

# ---------- 3) 更新通道：正式版切 jsDelivr，调试版仍指本机接收端 ----------
if ($Mode -eq 'official') {
    $newUpdate = '// @updateURL    https://cdn.jsdelivr.net/gh/qianbkk/chaoxing-helper@main/dist/chaoxing-helper.meta.js'
    $newDownload = '// @downloadURL  https://cdn.jsdelivr.net/gh/qianbkk/chaoxing-helper@main/dist/chaoxing-helper.user.js'
    $oldUpdate = '// @updateURL    https://github.com/qianbkk/chaoxing-helper/releases/latest/download/chaoxing-helper.meta.js'
    $oldDownload = '// @downloadURL  https://github.com/qianbkk/chaoxing-helper/releases/latest/download/chaoxing-helper.user.js'
} else {
    $newUpdate = '// @updateURL    http://127.0.0.1:8124/latest.meta.js'
    $newDownload = '// @downloadURL  http://127.0.0.1:8124/latest.user.js'
    $oldUpdate = $null
    $oldDownload = $null
}
# 幂等：补丁链是原地链式（v1.11.4 与 v1.11.5 共用同一个中间产物文件），
# 重跑构建时地址可能已经是目标值 —— 那就不要再替换一次。
if ($oldUpdate) {
    if ($text.Contains($oldUpdate)) {
        $text = Replace-Once $text $oldUpdate $newUpdate 'updateURL'
    } elseif (-not $text.Contains($newUpdate)) {
        throw '更新地址既不是旧的 GitHub Releases 地址，也不是新的 jsDelivr 地址'
    }
    if ($text.Contains($oldDownload)) {
        $text = Replace-Once $text $oldDownload $newDownload 'downloadURL'
    } elseif (-not $text.Contains($newDownload)) {
        throw '下载地址既不是旧的 GitHub Releases 地址，也不是新的 jsDelivr 地址'
    }
} else {
    # 调试版：地址本来就该指向本机接收端，只在不对时纠正
    if (-not $text.Contains($newUpdate)) {
        $text = Replace-Once $text '// @updateURL    http://127.0.0.1:8124/latest.meta.js' $newUpdate 'updateURL'
    }
    if (-not $text.Contains($newDownload)) {
        $text = Replace-Once $text '// @downloadURL  http://127.0.0.1:8124/latest.user.js' $newDownload 'downloadURL'
    }
}

# ---------- 4) 写出 ----------
[System.IO.File]::WriteAllText($OutPath, $text)
Write-Output ("patch-v1.11.5 完成: {0} -> {1}" -f $InPath, $OutPath)
