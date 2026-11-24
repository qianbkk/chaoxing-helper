# =============================================================================
# patch-v1.10.0.ps1 —— v1.9.0-AI → v1.10.0-AI 增量补丁
#
# 【v1.10.0 内容：面板重排 + 运行日志按标签页会话化】
#
#   ① 面板重排（用户需求：区块顺序、小块并排、去掉没必要的小字）
#      新顺序（自上而下）：
#        任务配置（含「开始/继续」「暂停」两个运行控制按钮）
#          → 答题设置·题库（不用 AI 也能答） │ 答题设置·AI 接口（可选）   ← 左右并排
#          → 章节测验 / 作业自动作答
#          → 运行日志
#          → 任务列表
#          → 附加功能（实验性）
#          → 调试模式（最下面）
#      · 「运行控制」不再是独立面板，按钮并进「任务配置」；
#        原来那个切换按钮拆成两个：「开始/继续」（绿）与「暂停」（红），互斥可用。
#      · 「AI 答题设置」拆成两块：题库块（题库 Token / 正确率门槛 / 翻章模式）
#        与 AI 块（Base URL / 模型 / API Key），各自一个保存按钮。
#        —— 之前「保存AI设置」一个按钮把两边的设置一起存了，拆开之后语义才清楚。
#      · 删掉各处「没必要的小字」（各面板顶端的灰色说明段落、逐条灰色注解）。
#      · 小块用 CSS flex 左右并排（.unrival-grid），主容器从 col-md-6 放宽到 col-md-8，
#        并排的两块才有足够宽度放输入框。
#
#   ② 运行日志改成「按标签页会话」
#      用户要的语义：关掉标签页再重新打开这个页面 → 新的日志；
#                    自动切下一节 / 手动点别的章节 → 日志保留。
#      实现：日志从 GM 永久存储挪到 sessionStorage（同标签页换页还在，关标签页就没了），
#      具体模块见 src/modules/loghist.v1.10.js。
#
# 【改产出文件前必须先改本脚本 —— dist/ 是构建出来的，不手改】
#
# 用法：
#   pwsh -File src/patches/patch-v1.10.0.ps1 -Mode official
#   pwsh -File src/patches/patch-v1.10.0.ps1 -Mode debug
# =============================================================================
param(
    [ValidateSet('official', 'debug')]
    [string]$Mode = 'official',
    [string]$InPath,
    [string]$OutPath
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # src/patches → src → 仓库根

if (-not $InPath) { throw "必须显式指定 -InPath（v1.10.0 接在 v1.9.0 之后）" }
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

# 把 here-string 的换行统一成 LF
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
#   $new  要包含起始标记本身（区间 [s, e) 是从起始标记开始的）
function Replace-Between([string]$t, [string]$startMark, [string]$endMark, [string]$new, [string]$label) {
    $sc = ([regex]::Matches($t, [regex]::Escape($startMark))).Count
    $ec = ([regex]::Matches($t, [regex]::Escape($endMark))).Count
    if ($sc -ne 1) { throw "起始锚点[$label] 命中 $sc 次（应为 1 次）" }
    if ($ec -ne 1) { throw "结束锚点[$label] 命中 $ec 次（应为 1 次）" }
    $s = $t.IndexOf($startMark)
    $e = $t.IndexOf($endMark)
    if ($e -le $s) { throw "结束锚点[$label] 出现在起始锚点之前" }
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
    if ($e -lt $s) { throw "结束锚点[$label] 出现在起始锚点之前" }
    return $t.Substring(0, $s) + (NL $new) + $t.Substring($e + $endMark.Length)
}

# ---------- 1) 版本号 ----------
$text = Replace-Once $text '// @version      1.9.0-AI' '// @version      1.10.0-AI' 'version'

# ---------- 2) 面板：主容器放宽（左右并排的两块才有宽度放输入框）----------
# 注意：同样的 col-md-6 容器在「挂机小助手」那一页还有一处，
# 所以锚点要带上紧随其后的 unrivalTitle 那一行，避免改错页面。
$oldContainer = @'
            <div class="col-md-6 col-md-offset-3">
                <div class="header clearfix">
                    <h3 id="unrivalTitle"
'@
$newContainer = @'
            <div class="col-md-8 col-md-offset-2">
                <div class="header clearfix">
                    <h3 id="unrivalTitle"
'@
$text = Replace-Once $text (NL $oldContainer) (NL $newContainer) '主容器宽度'

# ---------- 3) 面板样式：加紧凑栅格与表单样式 ----------
$oldCss = @'
            #joblist { max-height:220px; overflow-y:auto; }
        </style>
'@
$newCss = @'
            #joblist { max-height:220px; overflow-y:auto; }
            /* v1.10.0：小块左右并排的紧凑栅格 */
            .unrival-grid { display:flex; flex-wrap:wrap; margin:0 -6px; }
            .unrival-grid > .panel { flex:1 1 0; min-width:280px; margin:0 6px 12px; }
            .unrival-row { display:flex; flex-wrap:wrap; align-items:center; margin-bottom:8px; }
            .unrival-row > .unrival-label { flex:0 0 92px; font-size:18px; }
            .unrival-row > .unrival-ctl { flex:1 1 auto; }
            .unrival-field { margin-bottom:8px; }
            .unrival-field > span { display:block; font-size:12px; color:#888; margin-bottom:3px; }
            .unrival-field input, .unrival-field select { width:100%; box-sizing:border-box; }
        </style>
'@
$text = Replace-Once $text (NL $oldCss) (NL $newCss) '面板样式'

# ---------- 4) 面板 HTML 重排 ----------
# 替换区间：从「任务配置」到「章节测试」那个隐藏面板之前。
# 注意：原来的「学习进度 / 任务列表 / 运行日志」三个面板是排在中间的，
# 所以结尾锚点要用最后那个隐藏面板（章节测试），否则旧的「任务列表 / 运行日志」
# 会留在文件后面 → id 重复、面板重复显示。
$panelStart = '                <div class="panel panel-info" id="normalQuery">'
$panelEnd = '                <div class="panel panel-info" id=''workPanel'' style="display: none;height: 520px;">'
$newPanel = @'
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
                            <div class="unrival-label">运行控制：</div>
                            <div class="unrival-ctl">
                                <a id='pauseStartButton' class="btn btn-success disabled" aria-disabled="true">开始/继续</a>
                                &nbsp;
                                <a id='pauseToggleButton' class="btn btn-danger">暂停</a>
                                &nbsp;|&nbsp;<span id="pauseStatusText" style="font-size:13px;color:#666;">运行中</span>
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
                                <span style="color: red">[00:00:00]如果此提示不消失，说明页面出现了错误，请联系作者</span>
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
'@
$text = Replace-Between $text $panelStart $panelEnd $newPanel '面板 HTML'

# ---------- 5) 运行控制：拆成「开始/继续」+「暂停」两个按钮 ----------
# 5.1 状态同步函数（两个按钮的可用状态由它统一维护）
# 注意：`var logs = {...}, htmlHook = setInterval(...)` 是一整条声明列表，
# 所以这个函数要单独插在 `var logs = {` **之前**，不能插在 htmlHook 那一行前面。
$oldHook = '        var logs = {'
$newHook = @'
        //v1.10.0：运行控制两个按钮的状态统一在这里维护
        //  · 运行中：「开始/继续」置灰（脚本本身就在跑），「暂停」可点；
        //  · 已暂停：「开始/继续」可点，「暂停」置灰。
        var _syncPauseUI = function () {
            try {
                var paused = pauseCtl.isPaused();
                var btnStart = _d.getElementById('pauseStartButton');
                var btnPause = _d.getElementById('pauseToggleButton');
                var txt = _d.getElementById('pauseStatusText');
                if (btnStart) {
                    btnStart.setAttribute('class', paused ? 'btn btn-success' : 'btn btn-success disabled');
                    btnStart.setAttribute('aria-disabled', paused ? 'false' : 'true');
                }
                if (btnPause) {
                    btnPause.setAttribute('class', paused ? 'btn btn-danger disabled' : 'btn btn-danger');
                    btnPause.setAttribute('aria-disabled', paused ? 'true' : 'false');
                }
                if (txt) txt.innerHTML = paused ? '已暂停' : '运行中';
            } catch (e) { }
        };
        var logs = {
'@
$text = Replace-Once $text $oldHook (NL $newHook).TrimEnd("`n") '运行控制状态同步函数'

# 5.2 面板就绪检查：加上新增的按钮
$text = Replace-Once $text "_d.getElementById('saveAiButton') && _d.getElementById('testAiButton')) {" "_d.getElementById('saveCtButton') && _d.getElementById('saveAiButton') && _d.getElementById('pauseStartButton') && _d.getElementById('testAiButton')) {" '面板就绪检查'

# 5.3 初始化：三个赋值换成一次状态同步
$oldInit = @'
                    _d.getElementById('pauseToggleButton').innerHTML = pauseCtl.isPaused() ? '继续' : '暂停';
                    _d.getElementById('pauseToggleButton').setAttribute('class', pauseCtl.isPaused() ? 'btn btn-success' : 'btn btn-danger');
                    _d.getElementById('pauseStatusText').innerHTML = pauseCtl.isPaused() ? '已暂停' : '运行中';
'@
$newInit = @'
                    //v1.10.0：两个按钮的状态统一由 _syncPauseUI 维护
                    _syncPauseUI();
                    _d.getElementById('ctStatusText').innerHTML = '门槛 ' + accuracy + '%' + (token ? '，题库并发已提升' : '，未填题库 Token');
'@
$text = Replace-Once $text (NL $oldInit) (NL $newInit) '运行控制初始化'

# 5.4 两个按钮的点击处理
$oldPauseClick = @'
                    _d.getElementById('pauseToggleButton').onclick = function () {
                        var now = !pauseCtl.isPaused();
                        pauseCtl.set(now);
                        _d.getElementById('pauseToggleButton').innerHTML = now ? '继续' : '暂停';
                        _d.getElementById('pauseToggleButton').setAttribute('class', now ? 'btn btn-success' : 'btn btn-danger');
                        _d.getElementById('pauseStatusText').innerHTML = now ? '已暂停' : '运行中';
                        // 恢复时把「翻章模式」下拉框同步回存储里的真实设置
                        if (!now) {
                            try {
                                _d.getElementById('unrivalJumpType').value = jumpMode.get();
                            } catch (e) { }
                        }
                        logs.addLog(now ? '已暂停：不再自动翻章 / 作答 / 提交' : '已继续：恢复自动翻章 / 作答 / 提交', now ? 'orange' : 'green');
                    }
'@
$newPauseClick = @'
                    //v1.10.0：原「暂停/继续」切换按钮拆成两个 —— 「开始/继续」与「暂停」
                    _d.getElementById('pauseStartButton').onclick = function () {
                        if (!pauseCtl.isPaused()) {
                            logs.addLog('已在运行中，无需重复开始', 'gray');
                            return;
                        }
                        pauseCtl.set(false);
                        _syncPauseUI();
                        // 恢复时把「翻章模式」下拉框同步回存储里的真实设置
                        try {
                            _d.getElementById('unrivalJumpType').value = jumpMode.get();
                        } catch (e) { }
                        logs.addLog('已继续：恢复自动翻章 / 作答 / 提交', 'green');
                    };
                    _d.getElementById('pauseToggleButton').onclick = function () {
                        if (pauseCtl.isPaused()) {
                            logs.addLog('已处于暂停状态', 'gray');
                            return;
                        }
                        pauseCtl.set(true);
                        _syncPauseUI();
                        logs.addLog('已暂停：不再自动翻章 / 作答 / 提交', 'orange');
                    };
'@
$text = Replace-Once $text (NL $oldPauseClick) (NL $newPauseClick) '运行控制按钮绑定'

# ---------- 6) 题库设置与 AI 设置拆成两个保存按钮 ----------
$oldSaveAi = @'
                    _d.getElementById('saveAiButton').onclick = function () {
                        GM_setValue('unrivalAiBaseUrl', _d.getElementById('unrivalAiBaseUrl').value.trim());
                        GM_setValue('unrivalAiModel', _d.getElementById('unrivalAiModel').value.trim());
                        GM_setValue('unrivalAiKey', _d.getElementById('unrivalAiKey').value.trim());
                        token = _d.getElementById('unrivalCtToken').value.trim();
                        GM_setValue('tikutoken', token);
                        var newAccuracy = parseInt(_d.getElementById('unrivalAccuracy').value, 10);
                        if (isNaN(newAccuracy) || newAccuracy < 0) newAccuracy = 80;
                        if (newAccuracy > 100) newAccuracy = 100;
                        accuracy = newAccuracy;
                        GM_setValue('unrivalaccuracy', accuracy);
                        //v1.8：只写真实设置键；暂停中不改动运行时翻章模式（否则会把暂停"解掉"）
                        var _jtReal = jumpMode.set(_d.getElementById('unrivalJumpType').value);
                        jumpType = (pauseCtl.isPaused()) ? 2 : (_jtReal === '2' ? 2 : 1);
                        aiReload();
                        var aiOkCfg = (aiState.baseUrl && aiState.model && aiState.key);
                        logs.addLog(aiOkCfg ? ('AI设置已保存：' + aiState.model + ' @ ' + aiState.baseUrl) : 'AI设置已保存，但配置不完整（缺 Base URL / 模型 / API Key），将退回纯题库模式', aiOkCfg ? 'green' : 'orange');
                    }
'@
$newSaveAi = @'
                    //v1.10.0：题库设置与 AI 设置分成两个模块，各自一个保存按钮
                    //  题库块（不用 AI 也能答）：题库 Token / 正确率门槛 / 翻章模式
                    _d.getElementById('saveCtButton').onclick = function () {
                        token = _d.getElementById('unrivalCtToken').value.trim();
                        GM_setValue('tikutoken', token);
                        var newAccuracy = parseInt(_d.getElementById('unrivalAccuracy').value, 10);
                        if (isNaN(newAccuracy) || newAccuracy < 0) newAccuracy = 80;
                        if (newAccuracy > 100) newAccuracy = 100;
                        accuracy = newAccuracy;
                        GM_setValue('unrivalaccuracy', accuracy);
                        //v1.8：只写真实设置键；暂停中不改动运行时翻章模式（否则会把暂停"解掉"）
                        var _jtReal = jumpMode.set(_d.getElementById('unrivalJumpType').value);
                        jumpType = (pauseCtl.isPaused()) ? 2 : (_jtReal === '2' ? 2 : 1);
                        var _ctTxt = '门槛 ' + accuracy + '%' + (token ? '，题库并发已提升' : '，未填题库 Token');
                        _d.getElementById('ctStatusText').innerHTML = _ctTxt;
                        logs.addLog('题库设置已保存：' + _ctTxt, 'green');
                    }
                    //  AI 块：Base URL / 模型 / API Key（不填就退回纯题库模式）
                    _d.getElementById('saveAiButton').onclick = function () {
                        GM_setValue('unrivalAiBaseUrl', _d.getElementById('unrivalAiBaseUrl').value.trim());
                        GM_setValue('unrivalAiModel', _d.getElementById('unrivalAiModel').value.trim());
                        GM_setValue('unrivalAiKey', _d.getElementById('unrivalAiKey').value.trim());
                        aiReload();
                        var aiOkCfg = (aiState.baseUrl && aiState.model && aiState.key);
                        logs.addLog(aiOkCfg ? ('AI设置已保存：' + aiState.model + ' @ ' + aiState.baseUrl) : 'AI设置已保存，但配置不完整（缺 Base URL / 模型 / API Key），将退回纯题库模式', aiOkCfg ? 'green' : 'orange');
                    }
'@
$text = Replace-Once $text (NL $oldSaveAi) (NL $newSaveAi) '题库/AI 保存按钮拆分'

# ---------- 7) 提示文案：运行控制按钮挪进了任务配置 ----------
$text = Replace-N $text '点「运行控制 → 继续」恢复' '点「任务配置 → 开始/继续」恢复' 3 '暂停提示文案'

# ---------- 8) 运行日志：换成按标签页会话的版本 ----------
$logModulePath = Join-Path $root 'src\modules\loghist.v1.10.js'
if (-not (Test-Path -LiteralPath $logModulePath)) { throw "找不到日志模块源码: $logModulePath" }
$logModule = ([System.IO.File]::ReadAllText($logModulePath)) -replace "`r`n", "`n"
$text = Replace-Block $text `
    '    //==================== v1.8.1 运行日志持久化（跨翻章堆积）开始 ====================' `
    '    //==================== v1.8.1 运行日志持久化（跨翻章堆积）结束 ====================' `
    $logModule.TrimEnd("`n") '日志模块替换'

# ---------- 写回（LF） ----------
[System.IO.File]::WriteAllText($OutPath, $text, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("v1.10.0 [$Mode] 生成: {0}  ({1:N0} 字节)" -f $OutPath, $text.Length)
