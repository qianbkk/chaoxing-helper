# =============================================================================
# patch-v1.9.0.ps1 —— 新基线（v1.8.2-AI）→ v1.9.0-AI 增量补丁
#
# 【本仓库的补丁链从 v1.9.0 开始】
#   旧仓库（qianbkk/scriptcat-chaoxing-helper，私有存档）的补丁链是
#   「上游原版 v1.0 → v1.1 → … → v1.8.2」，每一步都作用在上游原件上。
#   公开仓库不再随包分发上游原件（只在 reference/README.md 里留链接与致谢），
#   因此这里的起点是本项目自己的产物：
#       src/baseline/chaoxing-helper.base.js  ==  脱敏后的 v1.8.2 发布件
#   之后的每个版本在这里加一个 patch-vX.Y.Z.ps1。
#
# 【v1.9.0 内容（一件大事：换更新地址）】
#
#   ① @updateURL / @downloadURL 切到 GitHub Releases 的固定资产名
#      【为什么用 Releases 而不是 main 分支的 raw 地址】
#        main 分支上的东西可能是实验性改动，推上去就会影响所有用户的更新；
#        发 Release 才是「这一版是稳定版」的明确动作。
#        Releases 的 /releases/latest/download/<资产名> 是稳定地址：
#        发新版时只要把同名资产挂到新 Release 上，所有已安装的用户
#        点「检查更新」就能拿到新版，元数据不用改。
#      【地址】
#        正式版：https://github.com/qianbkk/chaoxing-helper/releases/latest/download/
#                chaoxing-helper.meta.js   ← 检查更新用（只有 ==UserScript== 元数据块）
#                chaoxing-helper.user.js   ← 下载用（完整脚本）
#        调试版：http://127.0.0.1:8124/latest.meta.js / latest.user.js
#                （本机自用：接收端能检测到新版本并让脚本自动弹出安装页）
#      【ScriptCat 对这两个地址的要求】（读 scriptcat 源码 + 本机实测）
#        · 两个必须**同时声明**，只声明一个不生效；
#        · @updateURL 返回的内容要被 parseMetadata() 解析出 @version，
#          即必须是 meta.js 那种「==UserScript== 元数据块」，不是 Greasy Fork 的 JSON；
#        · 不声明时 ScriptCat 会把下载地址里的 user.js 换成 meta.js 去查更新 ——
#          资产名必须成对（xxx.user.js / xxx.meta.js），否则 404。
#
#   ② @description 精简（去掉只面向维护者的措辞）
#   ③ @homepageURL 指向本仓库
#
# 【调试功能的边界】
#   调试通道与日志落盘的开关是 GM 存储键 unrivalDbgEnabled，**默认 '0'（关闭）**，
#   所以公开发布件里虽然保留了调试代码，别人装上也不会往任何地址发请求。
#   本机自用的调试变体同样不强制开启，由面板上的「调试模式」勾选决定。
#
# 用法：
#   pwsh -File src/patches/patch-v1.9.0.ps1 -Mode official
#   pwsh -File src/patches/patch-v1.9.0.ps1 -Mode debug
# =============================================================================
param(
    [ValidateSet('official', 'debug')]
    [string]$Mode = 'official',
    [string]$InPath,
    [string]$OutPath
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # src/patches → src → 仓库根
$baseline = Join-Path $root 'src\baseline\chaoxing-helper.base.js'

if (-not $InPath) { $InPath = $baseline }
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

function Replace-Once([string]$t, [string]$old, [string]$new, [string]$label) {
    $count = ([regex]::Matches($t, [regex]::Escape($old))).Count
    if ($count -ne 1) { throw "锚点[$label] 命中 $count 次（应为 1 次）" }
    return $t.Replace($old, $new)
}

# 把 here-string 的换行统一成 LF
# （补丁脚本文件本身可能是 LF 也可能是 CRLF —— .gitattributes 规定 *.ps1 用 CRLF ——
#   而被替换的脚本内容统一按 LF 处理，所以锚点必须先归一化，否则跨机器会匹配不上）
function NL([string]$s) { return ($s -replace "`r`n", "`n") }

# ---------- 1) 版本号 ----------
$text = Replace-Once $text '// @version      1.8.2-AI' '// @version      1.9.0-AI' 'version'

# ---------- 2) 描述精简 ----------
$oldDesc = '// @description  超星学习通小助手（AI 版）：自动刷视频与文档、自动做章节测验/作业。章节测验先用题库(icodef)作答，查不到、超时或被限流时自动降级到 AI（OpenAI 兼容接口）；超星的加密字体自动解密，题干与选项都能正常识别，AI 才看得懂题。题库 Token、正确率门槛、翻章模式、AI 接口地址与密钥都可在面板配置。支持运行控制（暂停/继续）、调试模式（日志实时落盘 + 远程操控）与若干实验性附加功能。'
$newDesc = '// @description  超星学习通小助手（AI 版）：自动刷视频与文档、自动做章节测验/作业。章节测验先用题库作答，查不到或被限流时自动降级到 AI（OpenAI 兼容接口）；超星的加密字体自动解密，题干与选项都能正常识别。题库 Token、正确率门槛、翻章模式、AI 接口地址与密钥都可在面板配置。'
$text = Replace-Once $text $oldDesc $newDesc 'description'

# ---------- 3) 更新地址（正式版 = GitHub Releases；调试版 = 本机接收端） ----------
$oldUpdate = '// @updateURL    http://127.0.0.1:8124/latest.meta.js'
$oldDownload = '// @downloadURL  http://127.0.0.1:8124/latest.user.js'
if ($Mode -eq 'official') {
    $base = 'https://github.com/qianbkk/chaoxing-helper/releases/latest/download'
    $newUpdate = "// @updateURL    $base/chaoxing-helper.meta.js"
    $newDownload = "// @downloadURL  $base/chaoxing-helper.user.js"
} else {
    $newUpdate = '// @updateURL    http://127.0.0.1:8124/latest.meta.js'
    $newDownload = '// @downloadURL  http://127.0.0.1:8124/latest.user.js'
}
$text = Replace-Once $text $oldUpdate $newUpdate 'updateURL'
$text = Replace-Once $text $oldDownload $newDownload 'downloadURL'

# ---------- 4) 仓库主页 ----------
$oldLicense = '// @license      GPL-3.0-or-later'
$newLicense = @'
// @license      GPL-3.0-or-later
// @homepageURL  https://github.com/qianbkk/chaoxing-helper
'@
$text = Replace-Once $text $oldLicense $newLicense.TrimEnd("`n") 'homepageURL'

# ---------- 5) 去掉上游的第三方外发（与 v1.1 移除挖矿注入同一原则） ----------
#
# 【为什么要删】
#   上游原版有两处会联系一个**与超星无关的第三方服务器**：
#     ① 刷视频时去取「签名令牌 enc」——请求里带着 classId / UID / 学习进度 / 章节时长，
#        走的是明文 HTTP；
#     ② 题库查不到时兜底去另一个地址查答案（把题干发过去）。
#   这两处的服务器**早已下线**（实测 TCP 不通），而脚本实际一直走的是它的
#   **本地 md5 兜底分支**（`ecOnload(false)`）——
#   也就是说：留着它 = 每章白等 2 秒超时 + 把 UID 和学习进度发给第三方；
#   删掉它 = 行为完全一致（本地分支本来就是今天实际生效的那条路），而且干净。
#   与 v1.1 删除上游注入的挖矿脚本是同一处理原则：**上游不请自来的外发行为一律移除**。
#
#   依据：v1.4 之后「题库→AI→自动提交」链路已在真实超星页跑通，
#   当时的证据正是服务器不可达（本地 md5 分支生效），视频进度同样能正常累计。
#
# ⚠️ 本次改动**未在真实超星页复验**（改动只发生在「向第三方取令牌」这条支路上，
#    主路径——本地算 md5 后向超星上报进度——一行未动）。

# ---- 5.1 元数据：去掉指向该第三方地址的 @connect ----
$text = Replace-Once $text '// @connect      14.29.190.187' '' 'connect 第三方地址'

# ---- 5.2 变量声明：删掉 host，删掉备用题库开关 ----
$oldDecl = @'
        ctFailCooldown = 10 * 60 * 1000, //题库熔断时长(毫秒)，默认10分钟
        ctFallbackEnable = 0; //1=启用备用题库服务器(实测已下线，默认关闭)
'@
$newDecl = @'
        ctFailCooldown = 10 * 60 * 1000; //题库熔断时长(毫秒)，默认10分钟
'@
$text = Replace-Once $text (NL $oldDecl) (NL $newDecl) 'ctFallbackEnable 声明'

$oldHost = @'
    var host = 'http://14.29.190.187:54223/',
        rate = GM_getValue('unrivalrate', '1'),
'@
$newHost = @'
    var rate = GM_getValue('unrivalrate', '1'),
'@
$text = Replace-Once $text (NL $oldHost) (NL $newHost) 'host 变量声明'

# ---- 5.3 刷视频：不再去第三方取签名令牌，直接走本地 md5 分支 ----
$oldEncDecl = @'
                    encUrl = '',
'@
$text = Replace-Once $text (NL $oldEncDecl) '' 'encUrl 声明'

$oldEncAssign = @'
                            encUrl = host + 'chaoXing/v3/getEnc.php?classid=' + classId +
                                '&playtime=' + playTime + '&duration=' + item['duration'] + '&objectid=' + item[
                                'objectId'] + '&jobid=' + item['jobid'] + '&uid=' + UID;
'@
$text = Replace-Once $text (NL $oldEncAssign) '' 'encUrl 赋值'

$oldEncReq = @'
                            GM_xmlhttpRequest({
                                method: "get",
                                url: encUrl,
                                timeout: 2000,
                                onload: ecOnload,
                                onerror: function (err) {
                                    console.log(err);
                                    ecOnload(false);
                                },
                                ontimeout: function (err) {
                                    console.log(err);
                                    ecOnload(false);
                                }
                            });
'@
$newEncReq = @'
                            //v1.9.0：不再向第三方地址取签名令牌（原版请求里带着 classId / UID / 学习进度，明文 HTTP）。
                            //那个服务器早已下线，脚本实际一直走的是 ecOnload(false) 的本地 md5 分支，两者等价。
                            ecOnload(false);
'@
$text = Replace-Once $text (NL $oldEncReq) (NL $newEncReq) 'encUrl 请求'

# ---- 5.4 题库：删掉不可达的「备用题库」分支（开关硬编码为 0、面板无入口、服务器早已下线）----
$oldCtFallback = @'
                        if (ctFallbackEnable == 1) {
                            busyThread += 1;
                            GM_xmlhttpRequest({
                                method: "GET",
                                timeout: 3000,
                                url: host + 'chaoXing/v3/getAnswer.php?tm=' + encodeURIComponent(quu['question']
                                    .replace(/(^\s*)|(\s*$)/g, '')) + '&type=' + {
                                        '单选题': '0',
                                        '多选题': '1',
                                        '判断题': '3'
                                    }[quu['type']] + '&wid=' + wid + '&courseid=' + courseId,
                                onload: function (res) {
                                    ctOnload(res, quu);
                                },
                                onerror: function (err) {
                                    _w.top.unrivalWorkInfo = '查题错误，服务器连接失败';
                                    console.log(err);
                                    busyThread -= 1;
                                },
                                ontimeout: function (err) {
                                    _w.top.unrivalWorkInfo = '查题错误，服务器连接失败';
                                    console.log(err);
                                    busyThread -= 1;
                                }
                            });
                            return;
                        }
                        //v1.1：备用题库服务器 14.29.190.187:54223 实测已下线(TCP不通)，默认不再走，直接降级到AI
'@
$newCtFallback = @'
                        //v1.9.0：删掉不可达的「备用题库」分支（开关硬编码为 0、面板无入口、服务器早已下线）。
                        //查题失败时直接降级到 AI。
'@
$text = Replace-Once $text (NL $oldCtFallback) (NL $newCtFallback) '备用题库分支'

# ---- 5.5 题库响应处理：删掉针对已移除的备用题库路径的判断（已成死代码）----
$oldCtDead = @'
                        if (res.finalUrl.includes('getAnswer.php')) {
                            _w.top.unrivalWorkInfo = '查题错误，服务器连接失败';
                            return;
                        }
'@
$text = Replace-Once $text (NL $oldCtDead) '' '备用题库死代码'

# ---------- 写回（LF） ----------
[System.IO.File]::WriteAllText($OutPath, $text, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("v1.9.0 [$Mode] 生成: {0}  ({1:N0} 字节)" -f $OutPath, $text.Length)
