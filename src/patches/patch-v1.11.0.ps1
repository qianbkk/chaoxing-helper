# =============================================================================
# patch-v1.11.0.ps1 —— v1.10.0-AI → v1.11.0-AI 增量补丁
#
# 【v1.11.0 内容：全程托管模式（遇到做不了的任务不停机，一路推进到最后一节）】
#
#   【为什么加】
#     原脚本遇到「不支持的任务类型」（直播/阅读/自定义任务）会**主动停下等人**：
#     v1.6 的设计是「绝不能悄悄把还有任务点的章节跳过去」，
#     所以脚本打一行红字、然后 pauseCtl.set(true) 自己停住，等人工处理完再点「继续」。
#     对「想让它自己从头刷到尾」的用户来说这就是刷一半不刷了 —— 进度卡住还得守着。
#
#   【开启后的行为差异（三处）】
#     ① 不支持的任务类型：不再暂停，改为**跳过并记账**，继续往下推进；
#     ② 超星说「章节未开放」（闯关锁定）时：不再直接退出脚本，改为记录后继续；
#     ③ 本章任务做完后超星没放行：每 20 秒重试一次跳转（日志限频），不会静默卡住。
#
#   【边界（必须说清楚，不能让用户误以为能全自动刷完所有任务点）】
#     · 跳过的章节，其任务点不会被点亮 —— 闯关模式下超星可能不放行到下一节；
#       这时脚本会持续重试并写日志，需要人工把那一节的任务点补上才能继续往下。
#     · 直播类任务即使跳过，也要超星那边自己到期才算完成，脚本替代不了。
#     · 默认关闭（unrivalAutoRun = '0'），不改变原来的行为。
#
#   模块源码：src/modules/autorun.v1.11.js（由本脚本读入并注入）
#
# 用法：
#   pwsh -File src/patches/patch-v1.11.0.ps1 -Mode official
#   pwsh -File src/patches/patch-v1.11.0.ps1 -Mode debug
# =============================================================================
param(
    [ValidateSet('official', 'debug')]
    [string]$Mode = 'official',
    [string]$InPath,
    [string]$OutPath
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # src/patches → src → 仓库根

if (-not $InPath) { throw "必须显式指定 -InPath（v1.11.0 接在 v1.10.0 之后）" }
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

# 整段替换（含结束标记本身）
function Replace-Block([string]$t, [string]$startMark, [string]$endMark, [string]$new, [string]$label) {
    $sc = ([regex]::Matches($t, [regex]::Escape($startMark))).Count
    $ec = ([regex]::Matches($t, [regex]::Escape($endMark))).Count
    if ($sc -ne 1) { throw "起始锚点[$label] 命中 $sc 次（应为 1 次）" }
    if ($ec -ne 1) { throw "结束锚点[$label] 命中 $ec 次（应为 1 次）" }
    $s = $t.IndexOf($startMark)
    $e = $t.IndexOf($endMark)
    if ($e -lt $s) { throw "结束锚点[$label] 出现在起始锚点之前" }
    return $t.Substring(0, $s) + (NL $new) + $t.Substring($e + $endMark.Length)
}

# ---------- 1) 版本号 ----------
$text = Replace-Once $text '// @version      1.10.0-AI' '// @version      1.11.0-AI' 'version'

# ---------- 2) 注入「全程托管」模块（放在日志模块之后、章节列表页逻辑之前）----------
$autoRunPath = Join-Path $root 'src\modules\autorun.v1.11.js'
if (-not (Test-Path -LiteralPath $autoRunPath)) { throw "找不到托管模式模块源码: $autoRunPath" }
$autoRunModule = ([System.IO.File]::ReadAllText($autoRunPath)) -replace "`r`n", "`n"
$logEndMark = '    //==================== v1.10 运行日志（按标签页会话）结束 ===================='
$text = Replace-Once $text $logEndMark ($logEndMark + "`n" + $autoRunModule.TrimEnd("`n")) '注入托管模式模块'

# ---------- 3) 任务分派：托管模式下跳过做不了的任务，而不是停下来 ----------
$oldDispatch = @'
                    let jobType = String(item['type'] || 'unknown');
                    _d.getElementById('joblist').innerHTML += `
                            <div class="panel panel-default">
                                <div class="panel-body">
                                    ` + '未支持的任务（' + jobType + '）：' + jobName + `
                                </div>
                            </div>`
                    logs.addLog('未支持的任务类型 [' + jobType + ']：' + jobName + ' —— 脚本无法自动完成（直播要人工看、阅读要人工读）', 'red');
                    logs.addLog('已停止自动翻章：请人工处理完这一章后，在「运行控制」点「继续」', 'orange');
                    try {
                        if (typeof pauseCtl != 'undefined') pauseCtl.set(true);
                    } catch (e2) { }
'@
$newDispatch = @'
                    let jobType = String(item['type'] || 'unknown');
                    if (typeof autoRun != 'undefined' && autoRun.enabled()) {
                        //v1.11：全程托管 —— 跳过做不了的任务，继续往下推进（跳过的会记账，不静默吞掉）
                        _d.getElementById('joblist').innerHTML += `
                            <div class="panel panel-default">
                                <div class="panel-body">
                                    ` + '已跳过（' + jobType + '）：' + jobName + `
                                </div>
                            </div>`
                        logs.addLog('全程托管：跳过不支持的任务类型 [' + jobType + ']：' + jobName + ' —— 这类任务脚本做不了（直播要人工看、阅读要人工读），已跳过并继续', 'orange');
                    } else {
                        //v1.6：默认停下等人工处理，绝不能悄悄把还有任务点的章节跳过去
                        _d.getElementById('joblist').innerHTML += `
                            <div class="panel panel-default">
                                <div class="panel-body">
                                    ` + '未支持的任务（' + jobType + '）：' + jobName + `
                                </div>
                            </div>`
                        logs.addLog('未支持的任务类型 [' + jobType + ']：' + jobName + ' —— 脚本无法自动完成（直播要人工看、阅读要人工读）', 'red');
                        logs.addLog('已停止自动翻章：请人工处理完这一章后，在「任务配置」点「开始/继续」', 'orange');
                        try {
                            if (typeof pauseCtl != 'undefined') pauseCtl.set(true);
                        } catch (e2) { }
                    }
'@
$text = Replace-Once $text (NL $oldDispatch) (NL $newDispatch) '任务分派：跳过不支持的任务'

# ---------- 4) 闯关锁定：托管模式下不退出脚本 ----------
$oldGate = @'
                } else if (_l.href.indexOf("ut=t") != -1) {
                    spans[i].innerHTML = '此课程为闯关模式，请回到上一章节完成学习任务！'
                    return;
                }
'@
$newGate = @'
                } else if (_l.href.indexOf("ut=t") != -1) {
                    spans[i].innerHTML = '此课程为闯关模式，请回到上一章节完成学习任务！'
                    //v1.11：全程托管模式下不退出脚本 —— 记录后继续往下走，
                    //      让脚本有机会把这一节做完并继续推进（默认行为仍是直接退出）
                    if (typeof autoRun != 'undefined' && autoRun.enabled()) {
                        try {
                            if (typeof logs != 'undefined' && logs && logs.addLog) {
                                logs.addLog('全程托管：超星提示本章未开放（闯关模式，上一节可能有未完成的任务点），脚本继续尝试推进', 'orange');
                            }
                        } catch (e0) { }
                    } else {
                        return;
                    }
                }
'@
$text = Replace-Once $text (NL $oldGate) (NL $newGate) '闯关锁定处理'

# ---------- 5) 面板：任务配置里加「托管模式」一行 ----------
$oldRow = @'
                                &nbsp;|&nbsp;<span id="pauseStatusText" style="font-size:13px;color:#666;">运行中</span>
                            </div>
                        </div>
'@
$newRow = @'
                                &nbsp;|&nbsp;<span id="pauseStatusText" style="font-size:13px;color:#666;">运行中</span>
                            </div>
                        </div>
                        <div class="unrival-row">
                            <div class="unrival-label">托管模式：</div>
                            <div class="unrival-ctl">
                                <label><input type="checkbox" id="unrivalAutoRun"> 全程托管：遇到直播/阅读等做不了的任务自动跳过，一路推进到最后一节</label>
                            </div>
                        </div>
'@
$text = Replace-Once $text (NL $oldRow) (NL $newRow) '面板加托管模式一行'

# 5.1 面板就绪检查加上新控件
$text = Replace-Once $text "_d.getElementById('pauseStartButton') && _d.getElementById('testAiButton')) {" "_d.getElementById('pauseStartButton') && _d.getElementById('unrivalAutoRun') && _d.getElementById('testAiButton')) {" '面板就绪检查'

# 5.2 勾选框的初始化与绑定
$oldBind = @'
                    _d.getElementById('ctStatusText').innerHTML = '门槛 ' + accuracy + '%' + (token ? '，题库并发已提升' : '，未填题库 Token');
'@
$newBind = @'
                    _d.getElementById('ctStatusText').innerHTML = '门槛 ' + accuracy + '%' + (token ? '，题库并发已提升' : '，未填题库 Token');
                    //v1.11：全程托管开关（默认关闭）
                    _d.getElementById('unrivalAutoRun').checked = autoRun.enabled();
                    _d.getElementById('unrivalAutoRun').onchange = function () {
                        var _on = !!this.checked;
                        autoRun.setEnabled(_on);
                        logs.addLog(_on ? '全程托管已开启：做不了的任务（直播/阅读等）会跳过，脚本一路推进到最后一节' : '全程托管已关闭：遇到做不了的任务会停下等你处理', _on ? 'green' : 'orange');
                    };
'@
$text = Replace-Once $text (NL $oldBind) (NL $newBind) '托管模式开关绑定'

# ---------- 6) 调试状态里能看到托管模式 ----------
$oldStatus = @'
            try { s.push('自动作答=' + (workAuto.cfg.enable ? '开' : '关') + ' 自动提交=' + (workAuto.cfg.submit ? '开' : '关')); } catch (e) { }
'@
$newStatus = @'
            try { s.push('自动作答=' + (workAuto.cfg.enable ? '开' : '关') + ' 自动提交=' + (workAuto.cfg.submit ? '开' : '关')); } catch (e) { }
            try { s.push('全程托管=' + (autoRun.enabled() ? '开' : '关')); } catch (e1) { }
'@
$text = Replace-Once $text (NL $oldStatus) (NL $newStatus) '调试状态加托管模式'

# ---------- 写回（LF） ----------
[System.IO.File]::WriteAllText($OutPath, $text, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("v1.11.0 [$Mode] 生成: {0}  ({1:N0} 字节)" -f $OutPath, $text.Length)
