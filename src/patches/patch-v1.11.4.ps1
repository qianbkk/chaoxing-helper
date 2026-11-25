# =============================================================================
# patch-v1.11.4.ps1 —— v1.11.3-AI → v1.11.4-AI 增量补丁（补丁版本号：只改最后一段）
#
# 【v1.11.4 内容：运行控制回到「任务配置的右方」 + 去掉强调式否定文案】
#
#   ① 布局修复：右栏不再被挤到页面最下面
#      【为什么】v1.11.2 把面板改成左右两栏时，容器用的是
#        .unrival-mainrow { display:flex; flex-wrap:wrap; }
#        .unrival-maincol { flex:1 1 620px; }
#        .unrival-sidecol { flex:0 0 250px; }
#      两栏的基准宽度合计 620 + 250 + 32（左右 margin）= 902px，
#      而主容器是 col-md-10（视口宽的 10/12）。**视口窄于约 1082px 时**
#      （1024 笔记本、浏览器放大 110%、侧边 DevTools 等），
#      flex 换行会把右栏整块推到左栏下面 —— 也就是「开始/继续」跑到了页面最下面。
#      【怎么改】桌面端改成 flex-wrap:nowrap（两栏永不换行，左栏可压缩）；
#      只有窄屏（≤991px）才允许换行，并把右栏 order:-1 顶到最上面。
#      结果：≥992px 时「开始/继续 + 暂停」始终在「任务配置」的右方一块。
#
#   ② 去掉强调式否定文案（用户要求：不要把「不用什么」强调成标题）
#      · 「答题设置 · 题库（不用 AI 也能答）」→ 「答题设置 · 题库」
#      · 「答题设置 · AI 接口（可选）」→ 「答题设置 · AI 接口」
#      · 「全程托管：遇到直播/阅读等做不了的任务自动跳过，一路推进到最后一节」
#        →「全程托管：自动跳过无法处理的任务，一路推进到最后一节」
#      · 「题库 Token（选填：实测不填也能查题，填了能提高并发）」→「题库 Token（选填）」
#      · 题库说明去掉括号枚举与「单选只取最像的那一个」的细节
#      · 运行控制说明缩短成一句话
#      （事实性标注如「未验证」「默认关闭」保留 —— 那是状态，不是强调）
#
# 【改产出文件前必须先改本脚本 —— dist/ 是构建出来的，不手改】
#
# 用法：
#   pwsh -File src/patches/patch-v1.11.4.ps1 -Mode official
#   pwsh -File src/patches/patch-v1.11.4.ps1 -Mode debug
# =============================================================================
param(
    [ValidateSet('official', 'debug')]
    [string]$Mode = 'official',
    [string]$InPath,
    [string]$OutPath
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # src/patches → src → 仓库根

if (-not $InPath) { throw "必须显式指定 -InPath（v1.11.4 接在 v1.11.3 之后）" }
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

# ---------- 1) 版本号（补丁版本：只改最后一段）----------
$text = Replace-Once $text '// @version      1.11.3-AI' '// @version      1.11.4-AI' 'version'

# ---------- 2) 布局：两栏不换行，右栏不再被挤到页面最下面 ----------
$oldCss = @'
            /* v1.11.2：左右两栏 —— 左边配置区，右边运行控制 */
            .unrival-mainrow { display:flex; flex-wrap:wrap; align-items:flex-start; margin:0 -8px; }
            .unrival-maincol { flex:1 1 620px; min-width:0; margin:0 8px; }
            .unrival-sidecol { flex:0 0 250px; margin:0 8px; position:sticky; top:12px; }
            @media (max-width: 991px) {
                /* 窄屏：运行控制顶到最上面，主操作不用往下滚 */
                .unrival-sidecol { order:-1; flex:1 1 100%; position:static; margin-bottom:12px; }
            }
'@
$newCss = @'
            /* v1.11.4：左右两栏 —— 左边配置区，右边运行控制（紧挨「任务配置」的右方） */
            /* v1.11.2 用的是 flex-wrap:wrap：两栏基准宽合计 902px，视口窄于约 1082px 时 */
            /* 右栏会整块换行掉到页面最下面。桌面端改成 nowrap，右栏位置就固定住了。 */
            .unrival-mainrow { display:flex; flex-wrap:nowrap; align-items:flex-start; margin:0 -8px; }
            .unrival-maincol { flex:1 1 520px; min-width:0; margin:0 8px; }
            .unrival-sidecol { flex:0 0 250px; margin:0 8px; position:sticky; top:12px; }
            @media (max-width: 991px) {
                /* 窄屏：运行控制顶到最上面，主操作不用往下滚 */
                .unrival-mainrow { flex-wrap:wrap; }
                .unrival-sidecol { order:-1; flex:1 1 100%; position:static; margin-bottom:12px; }
            }
'@
$text = Replace-Once $text (NL $oldCss) (NL $newCss) '两栏栅格样式'

# ---------- 3) 文案：去掉强调式否定（面板标题 / 说明 / 标签）----------
$text = Replace-Once $text `
    '<div class="panel-heading">答题设置 · 题库（不用 AI 也能答）</div>' `
    '<div class="panel-heading">答题设置 · 题库</div>' '题库面板标题'

$text = Replace-Once $text `
    '<div class="panel-heading">答题设置 · AI 接口（可选）</div>' `
    '<div class="panel-heading">答题设置 · AI 接口</div>' 'AI 面板标题'

$text = Replace-Once $text `
    '全程托管：遇到直播/阅读等做不了的任务自动跳过，一路推进到最后一节' `
    '全程托管：自动跳过无法处理的任务，一路推进到最后一节' '托管模式标签'

$text = Replace-Once $text `
    '<span>题库 Token（选填：实测不填也能查题，填了能提高并发）</span>' `
    '<span>题库 Token（选填）</span>' '题库 Token 标签'

$text = Replace-Once $text `
    '三个免费源同时查（icodef、百度不挂科、icodef 备用源）；按选项文字打分匹配，单选只取最像的那一个；查不到才转 AI。' `
    '三个免费源同时查，按选项文字相似度匹配；查不到才转 AI。' '题库面板说明'

$text = Replace-Once $text `
    '「开始/继续」恢复自动翻章与自动作答；「暂停」立即挂起所有自动操作。' `
    '「开始/继续」恢复自动运行，「暂停」立即挂起。' '运行控制说明'

# ---------- 4) 写出 ----------
[System.IO.File]::WriteAllText($OutPath, $text)
Write-Output ("patch-v1.11.4 完成: {0} -> {1}" -f $InPath, $OutPath)
