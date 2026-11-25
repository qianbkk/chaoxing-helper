# =============================================================================
# patch-v1.11.3.ps1 —— v1.11.2-AI → v1.11.3-AI 增量补丁（补丁版本号：只改最后一段）
#
# 【v1.11.3 内容：多源免费题库 + 打分匹配 + 失败分类与节流】
#
#   ① 多源免费题库（新增模块 src/modules/ctbank.v1.11.3.js）
#      · 主源并行：icodef（cx.icodef.com）+ 百度不挂科（easylearn.baidu.com，零密钥）
#      · 备用源兜底：icodef（q.icodef.com，与主源共享 IP 额度，只在全败后才试）
#      · 题库 Token 保持选填（实测匿名可用，token 只影响并发额度）
#
#   ② 答案 → 选项改成打分制
#      · 不再「首个包含即命中」：每个选项打分（相等 1.0 / 包含长度占比 / 字符相似度）
#      · 低于置信度阈值（0.62）不算命中
#      · 单选题只取最高分那一个（修掉「一句话勾多个」）
#      · 多选题把 '#' 分隔的**多条答案陈述**分别映射后取并集
#        （'#' 是「多条答案」，不是「全部正确选项」）
#      · 判断题走同义表（正确/对/√/是/true ↔ 错误/错/×/否/false），带否定词防护
#
#   ③ 失败分类（学习端章节测验）
#      · 未收录(-1) 不再计入熔断（题库里没有这道题是正常结果，不是故障）
#      · 流控(-2) 由题库客户端内部退避重试，不再直接降级 AI、也不再熔断
#      · 只有网络错误/超时才计入熔断（连续 3 次 → 熔断 10 分钟）
#
#   ④ 节流与缓存
#      · 每源最小请求间隔 2 秒（实测 icodef 限流窗口 ~1.5 秒，1.0 秒必被限流）
#      · 命中缓存（题干+题型 → 答案，GM 存储上限 400 条），同题不再重复请求
#
#   ⑤ 三处调用点统一走同一个题库客户端
#      · 作业/章节测验页（workAuto）、考试页（extras）、学习页章节测验（内联链路）
#
#   模块源码：
#     src/modules/ctbank.v1.11.3.js —— 多源题库客户端 + 打分匹配 + 缓存 + 节流
#
# 【改产出文件前必须先改本脚本 —— dist/ 是构建出来的，不手改】
#
# 用法：
#   pwsh -File src/patches/patch-v1.11.3.ps1 -Mode official
#   pwsh -File src/patches/patch-v1.11.3.ps1 -Mode debug
# =============================================================================
param(
    [ValidateSet('official', 'debug')]
    [string]$Mode = 'official',
    [string]$InPath,
    [string]$OutPath
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # src/patches → src → 仓库根

if (-not $InPath) { throw "必须显式指定 -InPath（v1.11.3 接在 v1.11.2 之后）" }
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
$text = Replace-Once $text '// @version      1.11.2-AI' '// @version      1.11.3-AI' 'version'

# ---------- 2) @description：说清楚现在是「多源免费题库」 ----------
$oldDesc = '// @description  超星学习通小助手（AI 版）：自动刷视频与文档、自动做章节测验/作业。章节测验先用题库作答，查不到或被限流时自动降级到 AI（OpenAI 兼容接口）；超星的加密字体自动解密，题干与选项都能正常识别。题库 Token、正确率门槛、翻章模式、AI 接口地址与密钥都可在面板配置。'
$newDesc = '// @description  超星学习通小助手（AI 版）：自动刷视频与文档、自动做章节测验/作业。章节测验先用免费题库作答（多源并发 + 打分匹配），查不到时才自动降级到 AI（OpenAI 兼容接口）；超星的加密字体自动解密，题干与选项都能正常识别。题库 Token、正确率门槛、翻章模式、AI 接口地址与密钥都可在面板配置。'
$text = Replace-Once $text $oldDesc $newDesc 'description'

# ---------- 3) @connect：补两个新源 ----------
$oldConnect = @'
// @connect      cx.icodef.com
'@
$newConnect = @'
// @connect      cx.icodef.com
// @connect      q.icodef.com
// @connect      easylearn.baidu.com
'@
$text = Replace-Once $text (NL $oldConnect) (NL $newConnect) 'connect'

# ---------- 4) 注入「多源免费题库」模块 ----------
$ctBankPath = Join-Path $root 'src\modules\ctbank.v1.11.3.js'
if (-not (Test-Path -LiteralPath $ctBankPath)) { throw "找不到题库模块源码: $ctBankPath" }
$ctBank = ([System.IO.File]::ReadAllText($ctBankPath)) -replace "`r`n", "`n"
$injectAnchor = '    //==================== v1.8 翻章模式存储隔离开始 ===================='
$text = Replace-Once $text $injectAnchor ($ctBank.TrimEnd("`n") + "`n" + $injectAnchor) '注入题库模块'

# ---------- 5) 作业/章节测验页：ctAsk 改走多源客户端 ----------
$oldWorkCt = @'
        //===== 题库查询（icodef，与学习端同接口）=====
        ctAsk: function (question, typeName, cb) {
            var typeCode = { '单选题': '0', '多选题': '1', '判断题': '3' }[typeName];
            var param = 'question=' + encodeURIComponent(question);
            if (typeCode) param += '&type=' + typeCode + '&id=1';
'@
$newWorkCt = @'
        //===== 题库查询（v1.11.3：多源免费题库，与学习端共用同一个客户端）=====
        //  · 主源并行：icodef（cx.icodef.com）+ 百度不挂科（easylearn.baidu.com）；
        //  · 备用源兜底：icodef（q.icodef.com，与主源共享额度，只在全败后才试）；
        //  · 客户端内部已处理：每源节流（≥2 秒）、流控退避重试、命中缓存、失败分类；
        //  · 题库 Token 选填（实测匿名可用），token 只影响并发额度。
        ctAsk: function (question, typeName, cb) {
            try {
                ctBank.ask(question, typeName, function (r) {
                    if (r && r.ok) { cb(String(r.data)); return; }
                    cb(null);
                });
            } catch (e) {
                cb(null);
            }
        },
'@
$text = Replace-Between $text (NL $oldWorkCt) `
    '        //===== AI 作答（复用 v1.1 的 aiAsk，返回的序号与选项顺序一致）=====' `
    (NL $newWorkCt) '作业端 ctAsk'

# ---------- 6) 作业/章节测验页：答案匹配改成打分制 ----------
$oldWorkMatch = @'
        //===== 单个答案文字 → 选项下标（纯函数，可单测）=====
'@
$newWorkMatch = @'
        //===== 单个答案文字 → 选项下标（v1.11.3：打分制，纯函数，可单测）=====
        //  不再「首个包含即命中」：每个选项按「完全相等 / 包含长度占比 / 字符相似度」打分，
        //  低于置信度阈值不算命中；单选题只取最高分那一个（修掉「一句话勾多个」）。
        matchOne: function (answerText, options) {
            var m = ctBank.matchText(answerText, options, '');
            return (m && m.idxs && m.idxs.length) ? m.idxs[0] : -1;
        },
        //===== 题库答案 → 选项下标数组（v1.11.3：打分制 + 题型感知，纯函数，可单测）=====
        //  typeName 决定单选/多选：
        //  · 单选题只返回一个下标（最高分那个）；
        //  · 多选题把 '#' 分隔的**多条答案陈述**分别映射后取并集
        //    （'#' 是「多条答案」，不是「全部正确选项」）。
        matchAnswer: function (answerText, options, typeName) {
            var m = ctBank.matchText(answerText, options, typeName || '');
            return (m && m.idxs) ? m.idxs : [];
        },
'@
$text = Replace-Between $text (NL $oldWorkMatch) `
    '        //===== 收集题目 =====' `
    (NL $newWorkMatch) '作业端答案匹配'

# 6.1 调用点补上题型（单选/多选要分开处理）
$text = Replace-Once $text `
    '                        var idxs = self.matchAnswer(ans, q.options);' `
    '                        var idxs = self.matchAnswer(ans, q.options, q.type);' `
    '作业端 matchAnswer 调用点'

# ---------- 7) 考试页：ctAsk 改走多源客户端 ----------
$oldExamCt = @'
        //===== 题库查询（icodef，与学习端同接口）=====
        ctAsk: function (question, typeName, cb) {
            var typeCode = { '单选题': '0', '多选题': '1', '判断题': '3' }[typeName];
            var param = 'question=' + encodeURIComponent(question);
            if (typeCode) param += '&type=' + typeCode + '&id=' + (typeof wid !== 'undefined' ? wid : 1);
'@
$newExamCt = @'
        //===== 题库查询（v1.11.3：多源免费题库，与学习端共用同一个客户端）=====
        ctAsk: function (question, typeName, cb) {
            try {
                ctBank.ask(question, typeName, function (r) {
                    if (r && r.ok) { cb(String(r.data)); return; }
                    cb(null);
                }, { id: (typeof wid !== 'undefined' ? wid : 1) });
            } catch (e) {
                cb(null);
            }
        },
'@
$text = Replace-Between $text (NL $oldExamCt) `
    '        //===== AI 作答（复用 AI 模块的 aiState / parseAnswerIndex）=====' `
    (NL $newExamCt) '考试端 ctAsk'

# ---------- 8) 考试页：答案匹配改成打分制 ----------
$oldExamMatch = @'
        //===== 题库返回的是答案文字，按文字匹配选项（可单测）=====
'@
$newExamMatch = @'
        //===== 题库返回的是答案文字，按文字打分匹配选项（v1.11.3，可单测）=====
        //  单选题只返回一个下标（最高分那个），多选题返回多个；判断题走同义表。
        matchAnswerText: function (text, opts, typeName) {
            var m = ctBank.matchText(text, opts, typeName || '');
            return (m && m.idxs) ? m.idxs : [];
        },
'@
$text = Replace-Between $text (NL $oldExamMatch) `
    '        //===== 收集考试/作业页的题目（可单测）=====' `
    (NL $newExamMatch) '考试端答案匹配'

# 8.1 调用点补上题型
$text = Replace-Once $text `
    '                    var hit = self.matchAnswerText(text, q.options);' `
    '                    var hit = self.matchAnswerText(text, q.options, q.type);' `
    '考试端 matchAnswerText 调用点'

# ---------- 9) 学习页章节测验：失败分类（未收录不再计入熔断）----------
$oldFail = @'
                        ctFail(ctCode == -2 ? '触发流控' : (isNaN(ctCode) ? '返回格式异常' : '题库未收录'));
'@
$newFail = @'
                        //v1.11.3：失败分类 —— 只有「网络错误/超时」才计入熔断；
                        //   「未收录」是题库的正常结果（题库里就是没有这道题），不计失败；
                        //   「流控」由题库客户端内部退避重试，这里不再判失败。
                        var _v113msg = String(ctResult['msg'] || '');
                        if (_v113msg == '网络错误' || _v113msg == '请求超时') {
                            ctFail(_v113msg);
                        } else if (ctCode == -2) {
                            aiLog('[题库] 触发流控，已自动退避重试，仍未拿到答案', 'orange');
                        } else if (isNaN(ctCode)) {
                            ctFail('返回格式异常');
                        } else {
                            aiLog('[题库] 未收录该题（不计失败），转交 AI', 'orange');
                        }
'@
$text = Replace-Once $text (NL $oldFail) (NL $newFail) '学习端失败分类'

# ---------- 10) 学习页章节测验：答案 → 选项改成打分制 ----------
$newLearnMatch = @'
                    //v1.11.3：题库答案 → 选项改成「打分制」（ctBank 统一处理）
                    //   · 单选题只取最高分那一个（修掉「一句话勾多个」）；
                    //   · 多选题按 '#' 分隔的多条答案陈述分别映射；
                    //   · 判断题走同义表（正确/对/√ ↔ 错误/错/×）；
                    //   · 匹配不上就走原来的随机兜底（【B】/【错】/全选）。
                    var _v113 = (typeof ctBank !== 'undefined' && ctBank) ?
                        ctBank.applyLearning(quu, result, { d: _d, log: aiLog }) : null;
                    if (_v113 && _v113.ok) {
                        questionNum -= 1;
                    } else if (quu['type'] === '判断题') {
                        if (randomDo == 1 && accuracy < 100) {
                            _w.top.unrivalWorkInfo = quu['question'] + '：未找到正确答案，自动选【错】';
                            for (let u = 0, k = choiceEs.length; u < k; u++) {
                                if (choiceEs[u].getElementsByTagName('em').length < 1) {
                                    continue;
                                }
                                if (choiceEs[u].getAttribute('val-param') ==
                                    'false' && choiceEs[u].getAttribute(
                                        'id-param') == quu['questionid'].replace(
                                            'answer', '')) {
                                    choiceEs[u].click();
                                    break;
                                }
                            }
                        }
                    } else if (quu['type'] === '多选题') {
                        if (randomDo == 1 && accuracy < 100) {
                            _w.top.unrivalWorkInfo = quu['question'] +
                                '：未找到正确答案，自动全选';
                            for (let y = 0, j = choiceEs.length; y <
                                j; y++) {
                                if (choiceEs[y].getAttribute('id-param') ==
                                    quu['questionid'].replace('answer',
                                        '')) {
                                    if (!choiceEs[y].getAttribute('class')
                                        .includes('cur')) {
                                        choiceEs[y].click();
                                    }
                                }
                            }
                        }
                    } else {
                        if (randomDo == 1 && accuracy < 100) {
                            _w.top.unrivalWorkInfo = quu['question'] +
                                '：未找到正确答案，自动选【B】';
                            for (let y = 0, j = choiceEs.length; y <
                                j; y++) {
                                if (choiceEs[y].getElementsByTagName(
                                    'em').length < 1) {
                                    continue;
                                }
                                if (choiceEs[y].getElementsByTagName(
                                    'em')[0].getAttribute('id-param') ==
                                    'B' && choiceEs[y]
                                        .getAttribute('id-param') == quu[
                                            'questionid'].replace('answer',
                                                '')) {
                                    if (!choiceEs[y].getAttribute('class')
                                        .includes('cur')) {
                                        choiceEs[y].click();
                                    }
                                    break;
                                }
                            }
                        }
                    }
'@
$text = Replace-Block $text `
    "                    switch (quu['type']) {" `
    "                            })();`n                            break;`n                    }" `
    (NL $newLearnMatch) '学习端答案匹配'

# ---------- 11) 学习页章节测验：请求改走多源客户端 ----------
$newLearnReq = @'
                //v1.11.3：改走多源免费题库客户端（icodef 主源 + 百度不挂科 + icodef 备用源）
                //   · 未收录不再算「失败」，只有网络错误/超时才计入熔断；
                //   · 流控由客户端内部退避重试，不再直接降级 AI；
                //   · 命中过的题目走缓存，同一题不再重复请求。
                try {
                    ctBank.ask(quItem['question'], quItem['type'], function (r) {
                        if (r && r.ok) {
                            ctOnload({ responseText: JSON.stringify({ code: 1, data: String(r.data) }) }, quItem);
                            return;
                        }
                        var _v113r = r || {};
                        var _v113msg = (_v113r.reason == 'error' || _v113r.reason == 'timeout') ? '网络错误' : '题库未收录';
                        ctOnload({ responseText: JSON.stringify({ code: -1, msg: _v113msg, data: '' }) }, quItem);
                    }, { id: (typeof wid !== 'undefined' ? wid : 1) });
                } catch (e) {
                    ctFail('题库客户端异常');
                    aiDoWork(quItem, false);
                }
'@
$text = Replace-Between $text `
    "                let param = 'question=' + encodeURIComponent(" `
    '            }, nowTime);' `
    (NL $newLearnReq) '学习端请求链路'

# ---------- 12) 面板：题库设置块补说明（多源 + token 选填）----------
$oldPanel = @'
                                    <div class="unrival-field">
                                        <span>题库 Token（选填，填了能提高题库并发）</span>
                                        <input type="password" id="unrivalCtToken" placeholder="选填">
                                    </div>
'@
$newPanel = @'
                                    <div style="font-size:12px;color:#888;margin-bottom:8px;">
                                        三个免费源同时查（icodef、百度不挂科、icodef 备用源）；按选项文字打分匹配，单选只取最像的那一个；查不到才转 AI。
                                    </div>
                                    <div class="unrival-field">
                                        <span>题库 Token（选填：实测不填也能查题，填了能提高并发）</span>
                                        <input type="password" id="unrivalCtToken" placeholder="选填">
                                    </div>
'@
$text = Replace-Once $text (NL $oldPanel) (NL $newPanel) '题库面板说明'

# ---------- 13) 写出 ----------
$outDir = Split-Path -Parent $OutPath
if (-not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
[System.IO.File]::WriteAllText($OutPath, $text, (New-Object System.Text.UTF8Encoding($false)))
Write-Output ("patch-v1.11.3 完成: {0} -> {1}" -f $InPath, $OutPath)
