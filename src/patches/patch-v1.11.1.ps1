# =============================================================================
# patch-v1.11.1.ps1 —— v1.11.0-AI → v1.11.1-AI 增量补丁（补丁版本号：只改最后一段）
#
# 【v1.11.1 内容：阅读助手】
#
#   【为什么加】
#     「阅读任务」是这条技术线上唯一有成熟参考实现、而我们一直空缺的能力。
#     参考实现 = 上游 GF530068 v5.5.9.9.6 的「阅读助手」模块（该技术线上唯一成型的阅读实现）。
#     桌面那份 v4.0 没有阅读能力；本模块是按参考实现**重写**后接到本项目骨架上的。
#
#   【它做什么】
#     · 阅读正文页（/ztnodedetailcontroller/visitnodedetail）：
#       收集正文元素（段落/标题/图/视频），逐个滚过去，直到读完；
#     · 阅读任务目录页（/mooc-ans/zt/portal/ 等）：自动找到目录里的阅读入口并点进去；
#     · 读完：写日志；页面里有「下一章」按钮时点它（与参考实现一致）。
#
#   【重要边界 —— 必须写清楚】
#     全程**不发任何完成上报请求**（与参考实现一致）：
#     超星是按**真实浏览时长**判定阅读任务完成的，脚本只能把内容真的滚过去，
#     读多久就是多久 —— 不能加速、不能秒过。
#
#   【默认关闭】
#     开关 unrivalReadAssist，默认 '0'，在面板「附加功能」里勾选。
#     关掉开关会立刻停止正在进行的滚动。
#
#   模块源码：src/modules/reading.v1.11.1.js（由本脚本读入并注入）
#
# 用法：
#   pwsh -File src/patches/patch-v1.11.1.ps1 -Mode official
#   pwsh -File src/patches/patch-v1.11.1.ps1 -Mode debug
# =============================================================================
param(
    [ValidateSet('official', 'debug')]
    [string]$Mode = 'official',
    [string]$InPath,
    [string]$OutPath
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # src/patches → src → 仓库根

if (-not $InPath) { throw "必须显式指定 -InPath（v1.11.1 接在 v1.11.0 之后）" }
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

function Replace-N([string]$t, [string]$old, [string]$new, [int]$n, [string]$label) {
    $count = ([regex]::Matches($t, [regex]::Escape($old))).Count
    if ($count -ne $n) { throw "锚点[$label] 命中 $count 次（应为 $n 次）" }
    return $t.Replace($old, $new)
}

function Replace-Once([string]$t, [string]$old, [string]$new, [string]$label) {
    return Replace-N $t $old $new 1 $label
}

# ---------- 1) 版本号（补丁版本：只改最后一段）----------
$text = Replace-Once $text '// @version      1.11.0-AI' '// @version      1.11.1-AI' 'version'

# ---------- 2) 注入「阅读助手」模块（放在托管模式模块之后）----------
$readModulePath = Join-Path $root 'src\modules\reading.v1.11.1.js'
if (-not (Test-Path -LiteralPath $readModulePath)) { throw "找不到阅读助手模块源码: $readModulePath" }
$readModule = ([System.IO.File]::ReadAllText($readModulePath)) -replace "`r`n", "`n"
$autoRunEnd = '    //==================== v1.11 全程托管模式结束 ===================='
$text = Replace-Once $text $autoRunEnd ($autoRunEnd + "`n" + $readModule.TrimEnd("`n")) '注入阅读助手模块'

# ---------- 3) 面板：附加功能里加「阅读助手」开关 + 每段停留秒数 ----------
$oldExtras = @'
                        <div class="unrival-grid" style="margin:0;">
                            <label style="flex:1 1 0;min-width:230px;">
                                <input type="checkbox" id="unrivalExPaste"> 强制启用复制粘贴
                            </label>
                            <label style="flex:1 1 0;min-width:230px;">
                                <input type="checkbox" id="unrivalExExam"> 考试/作业端自动作答（只作答，不自动交卷）
                            </label>
                        </div>
'@
$newExtras = @'
                        <div class="unrival-grid" style="margin:0;">
                            <label style="flex:1 1 0;min-width:230px;">
                                <input type="checkbox" id="unrivalExPaste"> 强制启用复制粘贴
                            </label>
                            <label style="flex:1 1 0;min-width:230px;">
                                <input type="checkbox" id="unrivalExExam"> 考试/作业端自动作答（只作答，不自动交卷）
                            </label>
                        </div>
                        <div style="margin-top:6px;">
                            <label><input type="checkbox" id="unrivalReadAssist"> 阅读助手（打开阅读正文页后自动逐段滚读完）</label>
                            &ensp;<span style="font-size:13px;color:#666;">每段停留 <input type="number" id="unrivalReadSpeed" min="0.3" max="10" step="0.1" style="width:64px;"> 秒</span>
                        </div>
'@
$text = Replace-Once $text (NL $oldExtras) (NL $newExtras) '面板加阅读助手开关'

# 3.1 面板就绪检查加上新控件
$text = Replace-Once $text "_d.getElementById('unrivalAutoRun') && _d.getElementById('testAiButton')) {" "_d.getElementById('unrivalAutoRun') && _d.getElementById('unrivalReadAssist') && _d.getElementById('testAiButton')) {" '面板就绪检查'

# 3.2 初始化回填
$oldInit = @'
                    _d.getElementById('unrivalExExam').checked = extras.cfg.exam;
'@
$newInit = @'
                    _d.getElementById('unrivalExExam').checked = extras.cfg.exam;
                    //v1.11.1：阅读助手开关与每段停留秒数
                    _d.getElementById('unrivalReadAssist').checked = readAssist.enabled();
                    _d.getElementById('unrivalReadSpeed').value = readAssist.speed();
'@
$text = Replace-Once $text (NL $oldInit) (NL $newInit) '阅读助手初始化回填'

# 3.3 存进「保存附加功能设置」
$oldSaveEx = @'
                        extras.cfg.exam = _d.getElementById('unrivalExExam').checked;
'@
$newSaveEx = @'
                        extras.cfg.exam = _d.getElementById('unrivalExExam').checked;
                        //v1.11.1：阅读助手一起存（默认关闭）
                        var _readOn = !!_d.getElementById('unrivalReadAssist').checked;
                        GM_setValue('unrivalReadAssist', _readOn ? '1' : '0');
                        var _readSpeed = parseFloat(_d.getElementById('unrivalReadSpeed').value);
                        if (isNaN(_readSpeed) || _readSpeed <= 0) _readSpeed = 1.0;
                        if (_readSpeed < 0.3) _readSpeed = 0.3;
                        if (_readSpeed > 10) _readSpeed = 10;
                        GM_setValue('unrivalReadSpeed', String(_readSpeed));
'@
$text = Replace-Once $text (NL $oldSaveEx) (NL $newSaveEx) '阅读助手保存'

$oldStatusList = @'
                        if (extras.cfg.exam) on.push('考试端');
'@
$newStatusList = @'
                        if (extras.cfg.exam) on.push('考试端');
                        if (_readOn) on.push('阅读助手');
'@
$text = Replace-Once $text (NL $oldStatusList) (NL $newStatusList) '附加功能状态文字'

# ---------- 4) 章节列表页：跳过阅读类任务时给出可用提示 ----------
$oldSkipLog = @'
                        logs.addLog('全程托管：跳过不支持的任务类型 [' + jobType + ']：' + jobName + ' —— 这类任务脚本做不了（直播要人工看、阅读要人工读），已跳过并继续', 'orange');
'@
$newSkipLog = @'
                        logs.addLog('全程托管：跳过不支持的任务类型 [' + jobType + ']：' + jobName + ' —— 这类任务脚本做不了（直播要人工看、阅读要人工读），已跳过并继续', 'orange');
                        //v1.11.1：如果是阅读类任务，给一句能照做的提示
                        try {
                            if (/read|book|zt|node/i.test(String(jobType)) || /阅读|图书|材料/i.test(String(jobName))) {
                                logs.addLog('提示：这像是阅读任务 —— 在「附加功能」里开启「阅读助手」后，打开阅读正文页即可自动逐段滚读完', 'blue');
                            }
                        } catch (e3) { }
'@
$text = Replace-Once $text (NL $oldSkipLog) (NL $newSkipLog) '跳过阅读类任务的提示'

# ---------- 5) 调试状态里能看到阅读助手 ----------
$oldStatus = @'
            try { s.push('全程托管=' + (autoRun.enabled() ? '开' : '关')); } catch (e1) { }
'@
$newStatus = @'
            try { s.push('全程托管=' + (autoRun.enabled() ? '开' : '关')); } catch (e1) { }
            try { s.push('阅读助手=' + (readAssist.enabled() ? '开' : '关')); } catch (e2) { }
'@
$text = Replace-Once $text (NL $oldStatus) (NL $newStatus) '调试状态加阅读助手'

# ---------- 写回（LF） ----------
[System.IO.File]::WriteAllText($OutPath, $text, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("v1.11.1 [$Mode] 生成: {0}  ({1:N0} 字节)" -f $OutPath, $text.Length)
