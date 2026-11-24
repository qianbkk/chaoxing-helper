# =============================================================================
# patch-v1.11.2.ps1 —— v1.11.1-AI → v1.11.2-AI 增量补丁（补丁版本号：只改最后一段）
#
# 【v1.11.2 内容：面板右栏 + 日志规范 + 阅读助手两项增强】
#
#   ① 面板右栏（用户需求：开始/继续、暂停 挪到右边单独一栏并做显眼）
#      · 面板从「一列到底」改成左右两栏：
#        左栏 = 任务配置、答题设置、章节测验、运行日志、任务列表、附加功能、调试模式；
#        右栏 = 运行控制（单独一个面板，蓝色标题栏，主按钮大号、次按钮小号）；
#      · 「开始/继续」= 绿色 btn-lg btn-block（占满右栏宽度，一眼能看到）；
#        「暂停」= 红色 btn-sm btn-block（小一号，不跟主按钮抢注意力）；
#      · 右栏在桌面端 sticky（滚动时一直挂在右上角）；
#        窄屏（<992px）用 order:-1 把右栏顶到最上面，主操作不用滚到底；
#      · 「任务配置」里原来的「运行控制」那一行删掉（按钮已经搬走了）；
#      · 主容器从 col-md-8 放宽到 col-md-10（两栏才放得下）。
#
#   ② 日志规范（用户需求：统一标签/句式、去掉开发噪声、合并重复）
#      · 行格式统一成： [时间] [标签] 句子
#        标签集固定 12 个：视频/文档/测验/答题/题库/AI/阅读/托管/翻章/运行/设置/系统；
#      · 绝大多数文案在这里**逐条改写**（每条都有命中次数断言，可审、可测）；
#      · 开发自检类信息（页面就绪、面板整理、调试命令回显）只走调试通道，不进用户日志；
#      · 重复消息合并：
#          · 源码层：同一句话出现在两处 → 删掉多余的那处（复习模式/自动做章节测试/
#            「此页面不必保持在最前端」）；
#          · 运行层：紧挨着的同一句 → 合并成「原文（×N）」（loghist.v1.11.2.js）。
#
#   ③ 阅读助手：每段停留秒数默认 1 秒 → 10 秒
#      · 老的 1 秒默认值会被一次性迁移成 10 秒；用户自己设过的值不动。
#
#   ④ 阅读助手：按「每段 N 秒」把整篇读完（含往下滚才加载出来的后续内容）
#      · 读完当前这一批之后滚到页面底部触发懒加载，等新内容出来就接着读，
#        一直读到再也加载不出新内容为止（reading.v1.11.2.js）。
#      · 仍然只滚动、不发任何完成上报请求（超星按真实浏览时长判定）。
#
#   模块源码：
#     src/modules/logging.v1.11.2.js   —— 日志规范（标签集、句式、兜底规范化）
#     src/modules/loghist.v1.11.2.js   —— 会话日志（规范化 + 合并计数）
#     src/modules/autorun.v1.11.2.js   —— 全程托管（只改日志文案）
#     src/modules/reading.v1.11.2.js   —— 阅读助手（默认 10 秒 + 懒加载续读）
#
# 【改产出文件前必须先改本脚本 —— dist/ 是构建出来的，不手改】
#
# 用法：
#   pwsh -File src/patches/patch-v1.11.2.ps1 -Mode official
#   pwsh -File src/patches/patch-v1.11.2.ps1 -Mode debug
# =============================================================================
param(
    [ValidateSet('official', 'debug')]
    [string]$Mode = 'official',
    [string]$InPath,
    [string]$OutPath
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # src/patches → src → 仓库根

if (-not $InPath) { throw "必须显式指定 -InPath（v1.11.2 接在 v1.11.1 之后）" }
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

# 整段替换：按「起始标记 → 结束标记」区间定位（区间内的旧内容以后还会变，不能全文匹配）
function Replace-Between([string]$t, [string]$startMark, [string]$endMark, [string]$new, [string]$label) {
    $sc = ([regex]::Matches($t, [regex]::Escape($startMark))).Count
    $ec = ([regex]::Matches($t, [regex]::Escape($endMark))).Count
    if ($sc -ne 1) { throw "起始锚点[$label] 命中 $sc 次（应为 1 次）" }
    if ($ec -ne 1) { throw "结束锚点[$label] 命中 $ec 次（应为 1 次）" }
    $s = $t.IndexOf($startMark)
    $e = $t.IndexOf($endMark)
    if ($e -le $s) { throw "结束锚点[$label] 出现在起始标记之前" }
    return $t.Substring(0, $s) + (NL $new) + $t.Substring($e)
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
$text = Replace-Once $text '// @version      1.11.1-AI' '// @version      1.11.2-AI' 'version'

# ---------- 2) 模块替换 ----------
# 2.1 注入「日志规范」模块（放在会话日志模块之前，logHist 会用到 logSpec）
$logSpecPath = Join-Path $root 'src\modules\logging.v1.11.2.js'
if (-not (Test-Path -LiteralPath $logSpecPath)) { throw "找不到日志规范模块源码: $logSpecPath" }
$logSpec = ([System.IO.File]::ReadAllText($logSpecPath)) -replace "`r`n", "`n"
$logHistStart = '    //==================== v1.10 运行日志（按标签页会话）开始 ===================='
$text = Replace-Once $text $logHistStart ($logSpec.TrimEnd("`n") + "`n" + $logHistStart) '注入日志规范模块'

# 2.2 会话日志模块 v1.10 → v1.11.2（规范化 + 合并计数）
$logHistPath = Join-Path $root 'src\modules\loghist.v1.11.2.js'
if (-not (Test-Path -LiteralPath $logHistPath)) { throw "找不到会话日志模块源码: $logHistPath" }
$logHist = ([System.IO.File]::ReadAllText($logHistPath)) -replace "`r`n", "`n"
$text = Replace-Block $text `
    '    //==================== v1.10 运行日志（按标签页会话）开始 ====================' `
    '    //==================== v1.10 运行日志（按标签页会话）结束 ====================' `
    $logHist.TrimEnd("`n") '会话日志模块替换'

# 2.3 全程托管模块 v1.11 → v1.11.2（只改日志文案）
$autoRunPath = Join-Path $root 'src\modules\autorun.v1.11.2.js'
if (-not (Test-Path -LiteralPath $autoRunPath)) { throw "找不到全程托管模块源码: $autoRunPath" }
$autoRun = ([System.IO.File]::ReadAllText($autoRunPath)) -replace "`r`n", "`n"
$text = Replace-Block $text `
    '    //==================== v1.11 全程托管模式开始 ====================' `
    '    //==================== v1.11 全程托管模式结束 ====================' `
    $autoRun.TrimEnd("`n") '全程托管模块替换'

# 2.4 阅读助手模块 v1.11.1 → v1.11.2（默认 10 秒 + 懒加载续读）
$readPath = Join-Path $root 'src\modules\reading.v1.11.2.js'
if (-not (Test-Path -LiteralPath $readPath)) { throw "找不到阅读助手模块源码: $readPath" }
$readMod = ([System.IO.File]::ReadAllText($readPath)) -replace "`r`n", "`n"
$text = Replace-Block $text `
    '    //==================== v1.11.1 阅读助手开始 ====================' `
    '    //==================== v1.11.1 阅读助手结束 ====================' `
    $readMod.TrimEnd("`n") '阅读助手模块替换'

# ---------- 3) 面板：主容器放宽 ----------
$oldContainer = @'
            <div class="col-md-8 col-md-offset-2">
                <div class="header clearfix">
                    <h3 id="unrivalTitle"
'@
$newContainer = @'
            <div class="col-md-10 col-md-offset-1">
                <div class="header clearfix">
                    <h3 id="unrivalTitle"
'@
$text = Replace-Once $text (NL $oldContainer) (NL $newContainer) '主容器宽度'

# ---------- 4) 面板样式：加左右两栏的栅格 ----------
$oldCss = @'
            .unrival-field input, .unrival-field select { width:100%; box-sizing:border-box; }
        </style>
'@
$newCss = @'
            .unrival-field input, .unrival-field select { width:100%; box-sizing:border-box; }
            /* v1.11.2：左右两栏 —— 左边配置区，右边运行控制 */
            .unrival-mainrow { display:flex; flex-wrap:wrap; align-items:flex-start; margin:0 -8px; }
            .unrival-maincol { flex:1 1 620px; min-width:0; margin:0 8px; }
            .unrival-sidecol { flex:0 0 250px; margin:0 8px; position:sticky; top:12px; }
            @media (max-width: 991px) {
                /* 窄屏：运行控制顶到最上面，主操作不用往下滚 */
                .unrival-sidecol { order:-1; flex:1 1 100%; position:static; margin-bottom:12px; }
            }
        </style>
'@
$text = Replace-Once $text (NL $oldCss) (NL $newCss) '面板两栏样式'

# ---------- 5) 面板 HTML：左右两栏 + 运行控制右栏 ----------
$panelStart = '                <div class="panel panel-info" id="normalQuery">'
$panelEnd = '                <div class="panel panel-info" id=''workPanel'' style="display: none;height: 520px;">'
$newPanel = @'
                <div class="unrival-mainrow">
                    <div class="unrival-maincol">
                        <div class="panel panel-info" id="normalQuery">
                            <div class="panel-heading">任务配置</div>
                            <div class="panel-body">
                                <div class="unrival-row">
                                    <div class="unrival-label">视频倍速：</div>
                                    <div class="unrival-ctl">
                                        <input type="number" id="unrivalRate" style="width: 80px;">
                                        &ensp;
                                        <a id='updateRateButton' class="btn btn-default">保存</a>
                                        &nbsp;|&nbsp;
                                        <a id='reviewModeButton' class="btn btn-default">复习模式</a>
                                        &nbsp;|&nbsp;
                                        <a id='videoTimeButton' class="btn btn-default">查看学习进度</a>
                                        &nbsp;|&nbsp;
                                        <a id='fuckMeModeButton' class="btn btn-default" href="https://scriptcat.org/script-show-page/379" target="view_window">后台挂机</a>
                                        &nbsp;
                                        <a id='backGround' class="btn btn-default" target="view_window">激活挂机</a>
                                    </div>
                                </div>
                                <div class="unrival-row">
                                    <div class="unrival-label">章节测试：</div>
                                    <div class="unrival-ctl">
                                        <a id='autoDoWorkButton' class="btn btn-default">自动答题</a>&nbsp;|&nbsp;
                                        <a id='autoSubmitButton' class="btn btn-default">自动提交</a>&nbsp;|&nbsp;
                                        <a id='autoSaveButton' class="btn btn-default">自动保存</a>
                                    </div>
                                </div>
                                <div class="unrival-row">
                                    <div class="unrival-label">托管模式：</div>
                                    <div class="unrival-ctl">
                                        <label><input type="checkbox" id="unrivalAutoRun"> 全程托管：遇到直播/阅读等做不了的任务自动跳过，一路推进到最后一节</label>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="unrival-grid">
                            <div class="panel panel-info" id="ctPanel">
                                <div class="panel-heading">答题设置 · 题库（不用 AI 也能答）</div>
                                <div class="panel-body">
                                    <div class="unrival-field">
                                        <span>题库 Token（选填，填了能提高题库并发）</span>
                                        <input type="password" id="unrivalCtToken" placeholder="选填">
                                    </div>
                                    <div class="unrival-field">
                                        <span>正确率门槛（%，自动提交门槛）</span>
                                        <input type="number" id="unrivalAccuracy" min="0" max="100">
                                    </div>
                                    <div class="unrival-field">
                                        <span>翻章模式</span>
                                        <select id="unrivalJumpType">
                                            <option value="1">遍历</option>
                                            <option value="2">不跳转</option>
                                        </select>
                                    </div>
                                    <div>
                                        <a id='saveCtButton' class="btn btn-default">保存题库设置</a>
                                        &nbsp;|&nbsp;<span id="ctStatusText" style="font-size:13px;color:#666;">已保存</span>
                                    </div>
                                </div>
                            </div>
                            <div class="panel panel-info" id="aiPanel">
                                <div class="panel-heading">答题设置 · AI 接口（可选）</div>
                                <div class="panel-body">
                                    <div class="unrival-field">
                                        <span>Base URL（接口根地址，不带 /chat/completions）</span>
                                        <input type="text" id="unrivalAiBaseUrl" placeholder="https://api.deepseek.com/v1">
                                    </div>
                                    <div class="unrival-field">
                                        <span>模型</span>
                                        <input type="text" id="unrivalAiModel" placeholder="deepseek-chat">
                                    </div>
                                    <div class="unrival-field">
                                        <span>API Key</span>
                                        <input type="password" id="unrivalAiKey" placeholder="sk-...">
                                    </div>
                                    <div>
                                        <a id='saveAiButton' class="btn btn-default">保存AI设置</a>
                                        &nbsp;|&nbsp;<a id='testAiButton' class="btn btn-default">测试连通性</a>
                                        &nbsp;|&nbsp;<span id="aiStatusText" style="font-size:13px;color:#666;">未配置</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="panel panel-info" id="workAutoPanel">
                            <div class="panel-heading">章节测验 / 作业自动作答</div>
                            <div class="panel-body">
                                <div class="unrival-grid" style="margin:0;">
                                    <label style="flex:1 1 0;min-width:230px;">
                                        <input type="checkbox" id="unrivalWorkAuto"> 章节测验/作业自动作答
                                    </label>
                                    <label style="flex:1 1 0;min-width:230px;">
                                        <input type="checkbox" id="unrivalWorkSubmit"> 全部题目有依据时自动提交
                                    </label>
                                </div>
                                <div style="margin-top:8px;">
                                    <a id='saveWorkAutoButton' class="btn btn-default">保存自动作答设置</a>
                                    &nbsp;|&nbsp;<span id="workAutoStatusText" style="font-size:13px;color:#666;">已开启</span>
                                </div>
                            </div>
                        </div>
                        <div class="panel panel-info" id="logPanel">
                            <div class="panel-heading">运行日志</div>
                            <div class="panel-body">
                                <div style="text-align:right;margin-bottom:6px;">
                                    <a id='clearLogButton' class='btn btn-default btn-xs'>清空运行日志</a>
                                </div>
                                <div id="result" style="overflow:auto;line-height: 30px;">
                                    <div id="log">
                                        <span style="color: red">[00:00:00] [系统] 如果这条提示还在，说明页面出错了，请联系作者</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="panel panel-info" id="jobPanel">
                            <div class="panel-heading">任务列表</div>
                            <div class="panel-body" id='joblist'>
                            </div>
                        </div>
                        <div class="panel panel-info" id="extrasPanel">
                            <div class="panel-heading">附加功能（实验性 · 未验证）</div>
                            <div class="panel-body">
                                <div class="unrival-grid" style="margin:0;">
                                    <label style="flex:1 1 0;min-width:230px;">
                                        <input type="checkbox" id="unrivalExPaste"> 强制启用复制粘贴
                                    </label>
                                    <label style="flex:1 1 0;min-width:230px;">
                                        <input type="checkbox" id="unrivalExExam"> 考试/作业端自动作答（只作答，不自动交卷）
                                    </label>
                                </div>
                                <div style="margin-top:6px;">
                                    <label><input type="checkbox" id="unrivalReadAssist"> 阅读助手（自动逐段滚到底，把整篇读完）</label>
                                    &ensp;<span style="font-size:13px;color:#666;">每段停留 <input type="number" id="unrivalReadSpeed" min="0.3" max="10" step="0.1" style="width:64px;"> 秒（默认 10）</span>
                                </div>
                                <div style="margin-top:4px;font-size:12px;color:#999;">
                                    往下滚会加载出后续内容，助手会一直读到加载不出来为止；全程只滚动，不发任何完成上报请求。
                                </div>
                                <div style="margin-top:8px;">
                                    <a id='saveExButton' class="btn btn-default">保存附加功能设置</a>
                                    &nbsp;|&nbsp;<span id="exStatusText" style="font-size:13px;color:#666;">全部关闭</span>
                                </div>
                            </div>
                        </div>
                        <div class="panel panel-warning" id="debugPanel">
                            <div class="panel-heading">调试模式</div>
                            <div class="panel-body">
                                <div style="font-size:12px;color:#999;margin-bottom:8px;">
                                    仅开发时使用：需先在本机运行 log-sink（端口 8124）。开启后面板日志实时落盘，并可用 POST /__cmd 远程操控脚本。
                                </div>
                                <div style="font-size:14px;">
                                    <label><input type="checkbox" id="unrivalDbgEnabled"> 调试模式（发送日志到本机）</label>
                                </div>
                                <div style="font-size:14px;margin-top:6px;">
                                    接收端地址：<input type="text" id="unrivalDbgSink" style="width:300px;">
                                </div>
                                <div style="margin-top:8px;">
                                    <a id='saveDbgButton' class="btn btn-default">保存调试设置</a>
                                    &nbsp;|&nbsp;<span id="dbgStatusText" style="font-size:13px;color:#666;">已关闭</span>
                                </div>
                            </div>
                        </div>
                        <div class="panel panel-info" id='videoTime' style="display: none;height: 300px;">
                            <div class="panel-heading">学习进度</div>
                            <div class="panel-body" style="height: 100%;">
                                <iframe id="videoTimeContent" src="" frameborder="0" scrolling="auto"
                                    style="width: 100%;height: 85%;"></iframe>
                            </div>
                        </div>
                    </div>
                    <div class="unrival-sidecol">
                        <div class="panel panel-primary" id="runCtlPanel">
                            <div class="panel-heading">运行控制</div>
                            <div class="panel-body">
                                <a id='pauseStartButton' class="btn btn-success btn-lg btn-block" aria-disabled="true">开始/继续</a>
                                <a id='pauseToggleButton' class="btn btn-danger btn-sm btn-block" style="margin-top:8px;">暂停</a>
                                <div style="margin-top:12px;text-align:center;font-size:13px;color:#666;">
                                    当前状态：<span id="pauseStatusText">运行中</span>
                                </div>
                                <div style="margin-top:10px;font-size:12px;color:#999;line-height:1.8;">
                                    「开始/继续」恢复自动翻章与自动作答；「暂停」立即挂起所有自动操作。
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
'@
$text = Replace-Between $text $panelStart $panelEnd $newPanel '面板 HTML'

# ---------- 6) 运行控制按钮的状态同步：保留主/次按钮的尺寸 ----------
$oldSync = @'
                if (btnStart) {
                    btnStart.setAttribute('class', paused ? 'btn btn-success' : 'btn btn-success disabled');
                    btnStart.setAttribute('aria-disabled', paused ? 'false' : 'true');
                }
                if (btnPause) {
                    btnPause.setAttribute('class', paused ? 'btn btn-danger disabled' : 'btn btn-danger');
                    btnPause.setAttribute('aria-disabled', paused ? 'true' : 'false');
                }
'@
$newSync = @'
                if (btnStart) {
                    //v1.11.2：主按钮大号（btn-lg btn-block），次按钮小号（btn-sm btn-block）
                    btnStart.setAttribute('class', paused ? 'btn btn-success btn-lg btn-block' : 'btn btn-success btn-lg btn-block disabled');
                    btnStart.setAttribute('aria-disabled', paused ? 'false' : 'true');
                }
                if (btnPause) {
                    btnPause.setAttribute('class', paused ? 'btn btn-danger btn-sm btn-block disabled' : 'btn btn-danger btn-sm btn-block');
                    btnPause.setAttribute('aria-disabled', paused ? 'true' : 'false');
                }
'@
$text = Replace-Once $text (NL $oldSync) (NL $newSync) '运行控制按钮样式'

# ---------- 7) 阅读助手：保存时的默认值从 1 秒改成 10 秒 ----------
$oldSpeedSave = @'
                        var _readSpeed = parseFloat(_d.getElementById('unrivalReadSpeed').value);
                        if (isNaN(_readSpeed) || _readSpeed <= 0) _readSpeed = 1.0;
'@
$newSpeedSave = @'
                        var _readSpeed = parseFloat(_d.getElementById('unrivalReadSpeed').value);
                        //v1.11.2：每段停留秒数的默认值从 1 秒改成 10 秒
                        if (isNaN(_readSpeed) || _readSpeed <= 0) _readSpeed = 10;
'@
$text = Replace-Once $text (NL $oldSpeedSave) (NL $newSpeedSave) '阅读助手默认秒数'

# ---------- 8) 日志：先删重复（源码层）----------
# 8.1 「复习模式已开启」在两处重复（按钮点击处 + 页面初始化处）→ 删掉初始化处那句
$oldDup1 = @'
                        if (_w.top.unrivalReviewMode == '1') {
                            logs.addLog('复习模式已开启，遇到已完成的视频任务不会跳过', 'green');
'@
$newDup1 = @'
                        if (_w.top.unrivalReviewMode == '1') {
                            //v1.11.2：原来这里还会再打一遍「复习模式已开启」，与按钮点击处重复 → 去掉
'@
$text = Replace-Once $text (NL $oldDup1) (NL $newDup1) '删除重复的复习模式提示'

# 8.2 「自动做章节测试已开启」同样重复 → 删掉初始化处那句
$oldDup2 = @'
                        if (_w.top.unrivalDoWork == '1') {
                            logs.addLog('自动做章节测试已开启，将会自动做章节测试', 'green');
'@
$newDup2 = @'
                        if (_w.top.unrivalDoWork == '1') {
                            //v1.11.2：原来这里还会再打一遍「自动做章节测试已开启」，与按钮点击处重复 → 去掉
'@
$text = Replace-Once $text (NL $oldDup2) (NL $newDup2) '删除重复的自动做章节测试提示'

# 8.3 「此页面不必保持在最前端」每 2 分钟重复一次 → 只保留开头那一条
$oldDup3 = @'
    setInterval(function () {
        logs.addLog('此页面不必保持在最前端，后台会自动进行任务', 'green');
'@
$newDup3 = @'
    setInterval(function () {
        //v1.11.2：原来每 2 分钟重复一次「此页面不必保持在最前端」→ 只保留开头那一条
'@
$text = Replace-Once $text (NL $oldDup3) (NL $newDup3) '删除重复的后台提示'

# ---------- 9) 日志：逐条改写（表驱动，每条都断言命中次数）----------
# 表格式：标签|应命中次数|原消息|新消息（第四段可省略，省略时只加标签前缀）
# 规则：把 '原消息' 改成 '[标签] 新消息'
$tagRules = @'
AI|1|AI答题失败：|答题失败：
AI|1|AI答题：|作答完成：
系统|1|字体解密完成，已还原 |字体解密完成，已还原 
题库|1|题库触发并发限制，本题改用 AI|触发并发限制，本题改用 AI
题库|1|题库命中：|命中：
题库|1|题库答案无法匹配选项：|答案无法匹配选项：
AI|1|AI作答：|作答：
答题|1|题库与AI都没结果，随机兜底：|题库与 AI 都没结果，随机兜底：
运行|1|已暂停：不自动提交|已暂停：本次不自动提交
答题|1|已作答 |已作答 
答题|1|有 |有 
测验|1|未找到提交按钮，请手动提交|未找到提交按钮，请手动提交
测验|1|全部题目已作答，正在提交…|全部题目已作答，正在提交…
测验|1|已点击提交|已点击提交
测验|1|提交失败：|提交失败：
答题|1|当前页面没有识别到可自动作答的题目|当前页面没有识别到可自动作答的题目
答题|1|识别到 |识别到 
运行|1|已暂停：停止自动作答（已作答的题目保留）|已暂停：已停止自动作答（已作答的题目保留）
运行|1|已暂停：本次不自动作答|已暂停：本次不自动作答
答题|1|等待超时：页面里始终没有找到题目|等待超时：页面里始终没有找到题目
答题|1|考试端：翻页次数超过上限，停止|考试端：翻页次数超过上限，已停止
答题|1|考试端：未识别到题目（|考试端：未识别到题目（
答题|1|考试端：识别到 |考试端：识别到 
答题|1|考试端：|考试端：
答题|1|考试端：未找到唯一的「下一题」按钮，停止自动翻页|考试端：未找到唯一的「下一题」按钮，已停止自动翻页
答题|1|考试端：已翻到下一题|考试端：已翻到下一题
运行|1|任务页保活：已停留 |任务页保活：已停留 
设置|1|附加功能：已启用强制复制粘贴|附加功能：已启用强制复制粘贴
运行|1|已处于暂停状态：不会自动翻到下一章，也不会自动作答/提交|已处于暂停状态：不会自动翻到下一章，也不会自动作答或提交
托管|1|全程托管：超星提示本章未开放（闯关模式，上一节可能有未完成的任务点），脚本继续尝试推进|超星提示本章未开放（闯关模式，上一节可能有未完成的任务点），脚本继续尝试推进
系统|1|手机浏览器不保证能正常运行此脚本|手机浏览器不保证能正常运行此脚本
系统|1|挂机功能不稳定，不建议长时间最小化窗口|挂机功能不稳定，不建议长时间最小化窗口
设置|1|题库设置已保存：|题库设置已保存：
设置|1|附加功能设置已保存（|附加功能设置已保存（
运行|1|已在运行中，无需重复开始|已在运行中，无需重复开始
运行|1|已继续：恢复自动翻章 / 作答 / 提交|已继续：恢复自动翻章 / 作答 / 提交
运行|1|已处于暂停状态|已处于暂停状态，无需重复暂停
运行|1|已暂停：不再自动翻章 / 作答 / 提交|已暂停：不再自动翻章 / 作答 / 提交
设置|1|调试设置已保存（|调试设置已保存（
设置|1|自动作答设置已保存（|自动作答设置已保存（
AI|1|AI配置不完整，请先填写 Base URL / 模型 / API Key|配置不完整，请先填写 Base URL / 模型 / API Key
AI|1|正在测试AI连通性...|正在测试连通性…
视频|1|奇怪的倍速，将会自动跳过视频任务|倍速数值异常（不在允许区间），该视频将自动跳过
系统|1|挂机激活成功，您现在可以最小化页面了|挂机激活成功，现在可以最小化页面了
设置|1|复习模式已开启，遇到已完成的视频任务不会跳过|复习模式已开启：遇到已完成的视频任务不会跳过
设置|1|复习模式已关闭，遇到已完成的视频任务会自动跳过|复习模式已关闭：遇到已完成的视频任务会自动跳过
设置|1|自动做章节测试已开启，将会自动做章节测试|章节测试自动作答已开启
设置|1|自动做章节测试已关闭，将不会自动做章节测试|章节测试自动作答已关闭
设置|1|符合提交标准的章节测试将会自动提交|符合提交标准的章节测试将自动提交
设置|1|章节测试将不会自动提交|章节测试不自动提交
设置|1|不符合提交标准的章节测试将会自动保存|不符合提交标准的章节测试将自动保存
设置|1|不符合提交标准的章节测试将不会自动保存，等待用户自己操作|不符合提交标准的章节测试不自动保存，请自行操作
系统|1|您同时开启了多个刷课脚本，会挂科，会挂科，会挂科，会挂科，会挂科，会挂科，会挂科，会挂科|检测到同时开启了多个刷课脚本，可能导致进度异常（挂科）
翻章|1|所有任务处理完毕，5秒后自动下一章|所有任务处理完毕，5 秒后自动跳到下一章
翻章|1|所有任务处理完毕，已暂停：不跳转下一章，点「任务配置 → 开始/继续」恢复|所有任务处理完毕，已暂停：不跳转下一章，点右侧「开始/继续」恢复
翻章|1|所有任务处理完毕，用户设置为不跳转，脚本已结束运行，如需自动跳转，请编辑脚本代码参数|所有任务处理完毕，翻章模式设为「不跳转」，脚本已结束运行；如需自动跳转请在面板改回「遍历」
系统|1|推荐使用<a href="https://docs.scriptcat.org/use/#%E5%AE%89%E8%A3%85%E6%89%A9%E5%B1%95" target="view_window">脚本猫</a>运行此脚本，使用其他脚本管理器不保证能正常运行|推荐使用 <a href="https://docs.scriptcat.org/use/#%E5%AE%89%E8%A3%85%E6%89%A9%E5%B1%95" target="view_window">脚本猫</a> 运行此脚本，其他脚本管理器不保证能正常运行
系统|1|此页面不必保持在最前端，后台会自动进行任务|本页面不必保持在最前端，后台会自动进行任务
翻章|2|此页无任务，5秒后自动下一章|本页没有任务，5 秒后自动跳到下一章
翻章|2|此页无任务，已暂停：不跳转下一章，点「任务配置 → 开始/继续」恢复|本页没有任务，已暂停：不跳转下一章，点右侧「开始/继续」恢复
翻章|2|此页无任务，用户设置为不跳转，脚本已结束运行，如需自动跳转，请编辑脚本代码参数|本页没有任务，翻章模式设为「不跳转」，脚本已结束运行；如需自动跳转请在面板改回「遍历」
系统|1|获取任务详情失败|获取任务详情失败
系统|3|错误原因：|错误原因：
视频|2|奇怪的倍速，视频已自动跳过|倍速数值异常，该视频已自动跳过
系统|1|您已安装超星挂机小助手，但此课程可能为闯关模式，不支持后台挂机，将为您在线完成|本课程为闯关模式，不支持后台挂机，改为在线运行
系统|1|您已安装超星挂机小助手，已添加至后台任务，<a href="unrivalxxtbackground/" target="view_window">点我查看后台</a>|已添加至后台任务，<a href="unrivalxxtbackground/" target="view_window">点我查看后台</a>
视频|1|开始刷视频：|开始刷视频：
视频|1|视频观看信息每60秒上报一次，请耐心等待|观看进度每 60 秒上报一次，请耐心等待
系统|1|如遇脚本使用异常情况，请检查脚本版本是否为最新版，<a href="https://scriptcat.org/script-show-page/949">点我</a>检查|如遇异常，请确认脚本为最新版本：<a href="https://scriptcat.org/script-show-page/949" target="_blank">点此检查</a>
系统|1|解除多端学习监控有清除进度风险，请谨慎使用|解除多端学习监控有清除进度的风险，请谨慎使用
视频|1|该视频不允许倍速播放，已恢复至一倍速，高倍速会被清空进度挂科，勿存侥幸|该视频不允许倍速播放，已恢复为一倍速；高倍速可能导致进度被清空
系统|1|今日学习时间过长，继续学习会导致清空进度，请明天再来|今日学习时间过长，继续学习会导致进度被清空，请明天再来
视频|1|视频任务已完成|视频任务已完成
视频|1|视频已观看完毕|视频已观看完毕
视频|1|视频已观看完毕，但视频任务未完成|视频已观看完毕，但任务点未完成
系统|1|已被超星风控，请<a href="|已被超星风控，请 <a href="
系统|1|超星返回错误信息，十秒后重试|超星返回错误信息，10 秒后重试
视频|1|观看视频失败|观看视频失败
文档|1|开始刷文档：|开始刷文档：
文档|1|文档任务已完成|文档任务已完成
文档|1|文档已阅读完成，但任务点未完成|文档已读完，但任务点未完成
文档|1|解析文档内容失败|解析文档内容失败
文档|1|阅读文档失败|阅读文档失败
测验|1|开始刷章节测试：|开始刷章节测试：
托管|1|全程托管：跳过不支持的任务类型 [|跳过不支持的任务类型 [
阅读|1|提示：这像是阅读任务 —— 在「附加功能」里开启「阅读助手」后，打开阅读正文页即可自动逐段滚读完|提示：这像是阅读任务 —— 在「附加功能」里开启「阅读助手」后，打开阅读正文页即可自动逐段滚读完
运行|1|未支持的任务类型 [|未支持的任务类型 [
运行|1|已停止自动翻章：请人工处理完这一章后，在「任务配置」点「开始/继续」|已停止自动翻章：请人工处理完这一章后，点右侧「开始/继续」恢复
系统|1|如想禁用后台刷视频功能，请关闭脚本并重启浏览器|如想禁用后台刷视频功能，请关闭脚本并重启浏览器
系统|1|超星挂机小助手可能运行异常，如页面无反应，请尝试重启脚本猫或重启浏览器(脚本猫0.9.0版本有此问题)|脚本可能运行异常：如页面无反应，请尝试重启脚本猫或重启浏览器
设置|1|翻章模式存储已修复：旧版本的暂停功能把模式误写成「不跳转」，已恢复为「遍历」。若确实需要不跳转，在「AI答题设置」里改回即可（现在改了就存得住）。|翻章模式存储已修复：旧版本的暂停功能把模式误写成「不跳转」，已恢复为「遍历」。若确实需要不跳转，在「答题设置」里改回即可（现在改了就存得住）。
'@
foreach ($rule in ($tagRules -split "`n")) {
    $rule = $rule.TrimEnd("`r")
    if (-not $rule.Trim()) { continue }
    $parts = $rule -split '\|', 4
    if ($parts.Count -lt 3) { throw "日志改写表格式不对: $rule" }
    $tag = $parts[0].Trim()
    $n = [int]$parts[1].Trim()
    $msg = $parts[2]
    $newMsg = $msg
    if ($parts.Count -ge 4) { $newMsg = $parts[3] }
    $old = "'" + $msg + "'"
    $new = "'[" + $tag + "] " + $newMsg + "'"
    $text = Replace-N $text $old $new $n ("日志改写[" + $tag + "] " + $msg)
}

# ---------- 10) 日志：句式统一（需要连着上下句一起改的几处）----------
# 10.1 题库查题失败：括号改成冒号，补「已」字
$oldQ1 = @'
        aiLog('题库查题失败(' + reason + ')，连续 ' + aiState.ctFail + '/' + ctFailLimit + ' 次', 'orange');
'@
$newQ1 = @'
        aiLog('[题库] 查题失败：' + reason + '，已连续失败 ' + aiState.ctFail + '/' + ctFailLimit + ' 次', 'orange');
'@
$text = Replace-Once $text (NL $oldQ1) (NL $newQ1) '题库查题失败句式'

# 10.2 题库熔断
$oldQ2 = @'
        aiLog('题库连续失败 ' + aiState.ctFail + ' 次，接下来 ' + Math.round(ctFailCooldown / 60000) + ' 分钟内不再请求题库，直接交给AI（该状态跨翻章保持）', 'red');
'@
$newQ2 = @'
        aiLog('[题库] 连续失败 ' + aiState.ctFail + ' 次，已熔断：接下来 ' + Math.round(ctFailCooldown / 60000) + ' 分钟内不再请求题库，直接改用 AI（熔断状态跨翻章保持）', 'red');
'@
$text = Replace-Once $text (NL $oldQ2) (NL $newQ2) '题库熔断句式'

# 10.3 托管开关状态
$oldQ3 = @'
        logs.addLog(_on ? '全程托管已开启：做不了的任务（直播/阅读等）会跳过，脚本一路推进到最后一节' : '全程托管已关闭：遇到做不了的任务会停下等你处理', _on ? 'green' : 'orange');
'@
$newQ3 = @'
        logs.addLog(_on ? '[设置] 全程托管已开启：做不了的任务（直播/阅读等）会跳过，脚本一路推进到最后一节' : '[设置] 全程托管已关闭：遇到做不了的任务会停下等你处理', _on ? 'green' : 'orange');
'@
$text = Replace-Once $text (NL $oldQ3) (NL $newQ3) '托管开关句式'

# 10.4 AI 设置保存
$oldQ4 = @'
        logs.addLog(aiOkCfg ? ('AI设置已保存：' + aiState.model + ' @ ' + aiState.baseUrl) : 'AI设置已保存，但配置不完整（缺 Base URL / 模型 / API Key），将退回纯题库模式', aiOkCfg ? 'green' : 'orange');
'@
$newQ4 = @'
        logs.addLog(aiOkCfg ? ('[设置] AI 设置已保存：' + aiState.model + ' @ ' + aiState.baseUrl) : '[设置] AI 设置已保存，但配置不完整（缺 Base URL / 模型 / API Key），将退回纯题库模式', aiOkCfg ? 'green' : 'orange');
'@
$text = Replace-Once $text (NL $oldQ4) (NL $newQ4) 'AI 设置保存句式'

# 10.5 AI 连通性测试
$oldQ5 = @'
        logs.addLog(aiTestOk ? ('AI连通性正常（' + aiTestMsg + '）') : ('AI连通性测试失败：' + aiTestMsg), aiTestOk ? 'green' : 'red');
'@
$newQ5 = @'
        logs.addLog(aiTestOk ? ('[AI] 连通性正常（' + aiTestMsg + '）') : ('[AI] 连通性测试失败：' + aiTestMsg), aiTestOk ? 'green' : 'red');
'@
$text = Replace-Once $text (NL $oldQ5) (NL $newQ5) 'AI 连通性句式'

# 10.6 视频倍速
$oldQ6 = @'
                            logs.addLog('视频倍速已更新为' + urate + '倍，将在3秒内生效', 'green');
'@
$newQ6 = @'
                            logs.addLog('[设置] 视频倍速已更新为 ' + urate + ' 倍，将在 3 秒内生效', 'green');
'@
$text = Replace-Once $text (NL $oldQ6) (NL $newQ6) '视频倍速句式'

# 10.7 观看进度
$oldQ7 = @'
            logs.addLog(item['name'] + '已观看' +
'@
$newQ7 = @'
            logs.addLog('[视频] ' + item['name'] + ' 已观看 ' +
'@
$text = Replace-Once $text (NL $oldQ7) (NL $newQ7) '观看进度句式'

# 10.8 章节测试正确率门槛
$oldQ8 = @'
        logs.addLog('您设置的答题正确率为：' + String(accuracy) + '%，只有在高于此正确率时才会提交测试', 'blue');
'@
$newQ8 = @'
        logs.addLog('[测验] 答题正确率门槛为 ' + String(accuracy) + '%，高于该值才自动提交测试', 'blue');
'@
$text = Replace-Once $text (NL $oldQ8) (NL $newQ8) '正确率门槛句式'

# 10.9 「请添加安全网址」+ 示例图：合并成一条（原本是两条，一句一图）
$oldQ9 = @'
                        logs.addLog('请添加安全网址，将 【 //@connect      ' + _h +
                            ' 】方括号里的内容(不包括方括号)添加到脚本代码内指定位置，否则脚本无法正常运行，如图所示：', 'red');
                        logs.addLog(
                            '<img src="https://pan-yz.chaoxing.com/thumbnail/0,0,0/609a8b79cbd6a91d10c207cf2b5f368d">'
                        );
'@
$newQ9 = @'
                        logs.addLog('[系统] 请添加安全网址：把 【 //@connect      ' + _h + ' 】方括号里的内容（不含方括号）加到脚本代码里指定位置，否则脚本无法正常运行。示例图：<img src="https://pan-yz.chaoxing.com/thumbnail/0,0,0/609a8b79cbd6a91d10c207cf2b5f368d">', 'red');
'@
$text = Replace-Once $text (NL $oldQ9) (NL $newQ9) '安全网址提示合并（一）'

$oldQ10 = @'
                                            logs.addLog(
                                                '请添加安全网址，将 【 //@connect      ' +
                                                _h +
                                                ' 】方括号里的内容(不包括方括号)添加到脚本代码内指定位置，否则脚本无法正常运行，如图所示：',
                                                'red');
                                            logs.addLog(
                                                '<img src="https://pan-yz.chaoxing.com/thumbnail/0,0,0/609a8b79cbd6a91d10c207cf2b5f368d">'
                                            );
'@
$newQ10 = @'
                                            logs.addLog('[系统] 请添加安全网址：把 【 //@connect      ' + _h + ' 】方括号里的内容（不含方括号）加到脚本代码里指定位置，否则脚本无法正常运行。示例图：<img src="https://pan-yz.chaoxing.com/thumbnail/0,0,0/609a8b79cbd6a91d10c207cf2b5f368d">', 'red');
'@
$text = Replace-Once $text (NL $oldQ10) (NL $newQ10) '安全网址提示合并（二）'

$oldQ11 = @'
                                logs.addLog('请添加安全网址，将 【 //@connect      ' + _h +
                                    ' 】方括号里的内容(不包括方括号)添加到脚本代码内指定位置，否则脚本无法正常运行，如图所示：', 'red');
                                logs.addLog(
                                    '<img src="https://pan-yz.chaoxing.com/thumbnail/0,0,0/609a8b79cbd6a91d10c207cf2b5f368d">'
                                );
'@
$newQ11 = @'
                                logs.addLog('[系统] 请添加安全网址：把 【 //@connect      ' + _h + ' 】方括号里的内容（不含方括号）加到脚本代码里指定位置，否则脚本无法正常运行。示例图：<img src="https://pan-yz.chaoxing.com/thumbnail/0,0,0/609a8b79cbd6a91d10c207cf2b5f368d">', 'red');
'@
$text = Replace-Once $text (NL $oldQ11) (NL $newQ11) '安全网址提示合并（三）'

# 10.12 「浏览器内核过老」是转义写法的老文案（两处），
#      直接改写成正常中文 + [系统] 标签（原文里的 <edg浏览器> 是个上游留下的怪标签）
#      这里不能用 here-string：字面量后面还接着同一行的转义序列，带换行就匹配不上。
$oldQ12 = "'\u60a8\u7684\u6d4f\u89c8\u5668\u5185\u6838\u8fc7\u8001\uff0c\u8bf7\u66f4\u65b0\u7248\u672c\u6216\u4f7f\u7528\u4e3b\u6d41\u6d4f\u89c8\u5668\uff0c\u63a8\u8350\u003c\u0061\u0020\u0068\u0072\u0065\u0066\u003d\u0022\u0068\u0074\u0074\u0070\u0073\u003a\u002f\u002f\u0077\u0077\u0077\u002e\u006d\u0069\u0063\u0072\u006f\u0073\u006f\u0066\u0074\u002e\u0063\u006f\u006d\u002f\u007a\u0068\u002d\u0063\u006e\u002f\u0065\u0064\u0067\u0065\u0022\u0020\u0074\u0061\u0072\u0067\u0065\u0074\u003d\u0022\u0076\u0069\u0065\u0077\u005f\u0077\u0069\u006e\u0064\u006f\u0077\u0022\u003e\u0065\u0064\u0067\u0065\u6d4f\u89c8\u5668\u003c\u002f\u0061\u003e'"
$newQ12 = "'[系统] 您的浏览器内核过老，请更新版本或使用主流浏览器（推荐 Edge / Chrome）'"
$text = Replace-N $text $oldQ12 $newQ12 2 '浏览器内核过老提示改写'

# 10.13 两处「本页没有任务」其实是两种情况（页面数据没解析出来 / 任务列表为空），
#      区分开，免得两处文案一模一样、看不出是哪一种
$oldQ13 = @'
        try {
            var pageData = JSON.parse(param);
        } catch (e) {
            if (jumpType != 2) {
                _w.top.jump = true;
                logs.addLog('[翻章] 本页没有任务，5 秒后自动跳到下一章', 'green');
            } else if (pauseCtl.isPaused()) {
                logs.addLog('[翻章] 本页没有任务，已暂停：不跳转下一章，点右侧「开始/继续」恢复', 'orange');
            } else {
                logs.addLog('[翻章] 本页没有任务，翻章模式设为「不跳转」，脚本已结束运行；如需自动跳转请在面板改回「遍历」', 'green');
            }
'@
$newQ13 = @'
        try {
            var pageData = JSON.parse(param);
        } catch (e) {
            if (jumpType != 2) {
                _w.top.jump = true;
                logs.addLog('[翻章] 本页没有任务（页面数据没解析出来），5 秒后自动跳到下一章', 'green');
            } else if (pauseCtl.isPaused()) {
                logs.addLog('[翻章] 本页没有任务（页面数据没解析出来），已暂停：不跳转下一章，点右侧「开始/继续」恢复', 'orange');
            } else {
                logs.addLog('[翻章] 本页没有任务（页面数据没解析出来），翻章模式设为「不跳转」，脚本已结束运行；如需自动跳转请在面板改回「遍历」', 'green');
            }
'@
$text = Replace-Once $text (NL $oldQ13) (NL $newQ13) '本页无任务（两种情况区分）'

# 10.14 「倍速数值异常」出现在两处：开播前就发现倍速无效 / 播放中倍速变成无效。
#      区分开，用户才知道是哪一种。
$oldQ14 = @'
            doVideo = (item) => {
                if (rate <= 0) {
                    missionList['m' + item['jobid']]['running'] = true;
                    logs.addLog('[视频] 倍速数值异常，该视频已自动跳过', 'orange');
'@
$newQ14 = @'
            doVideo = (item) => {
                if (rate <= 0) {
                    missionList['m' + item['jobid']]['running'] = true;
                    logs.addLog('[视频] 倍速设置无效，该视频已自动跳过', 'orange');
'@
$text = Replace-Once $text (NL $oldQ14) (NL $newQ14) '倍速异常（开播前）'

$oldQ15 = @'
                    loop = setInterval(function () {
                        if (rate <= 0) {
                            clearInterval(loop);
                            logs.addLog('[视频] 倍速数值异常，该视频已自动跳过', 'orange');
'@
$newQ15 = @'
                    loop = setInterval(function () {
                        if (rate <= 0) {
                            clearInterval(loop);
                            logs.addLog('[视频] 倍速在播放中失效，该视频已自动跳过', 'orange');
'@
$text = Replace-Once $text (NL $oldQ15) (NL $newQ15) '倍速异常（播放中）'

# ---------- 11) 动态消息：显式补标签 ----------
# 11.1 章节测试提交结果回报（workResult.say）
$text = Replace-Once $text "try { logs.addLog(msg, 'blue'); } catch (e) { }" "try { logs.addLog(logSpec.tag(msg, '测验'), 'blue'); } catch (e) { }" '提交结果回报补标签'

# 11.2 超星返回的原文告警（视频流程里）
$text = Replace-Once $text "logs.addLog(warnInfo, 'red');" "logs.addLog(logSpec.tag(warnInfo, '视频'), 'red');" '超星告警补标签'

# 11.3 考试端传回来的消息
$text = Replace-Once $text 'logs.addLog(_w.top.unrivalWorkInfo);' 'logs.addLog(logSpec.tag(_w.top.unrivalWorkInfo, ''答题''));' '考试端消息补标签'

# 11.4 后台挂机小助手传回来的消息
$text = Replace-Once $text 'logs.addLog(new_value);' 'logs.addLog(logSpec.tag(new_value, ''系统''));' '后台消息补标签'

# ---------- 12) 写回（LF） ----------
[System.IO.File]::WriteAllText($OutPath, $text, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("v1.11.2 [$Mode] 生成: {0}  ({1:N0} 字节)" -f $OutPath, $text.Length)
