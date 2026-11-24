    //==================== v1.8.1 章节测试提交结果回报开始 ====================
    // 【v1.8.1 相比 v1.8 改了什么】
    //   v1.8 的第一版读不到成绩，日志打的是「没读到成绩文字（可能跨域或页面无提示）」。
    //   但同一行里的页面路径**已经读到了**：`ans/work/phone/selectWorkQuestionYiPiYue`
    //   —— 说明**不是跨域**（同源，location.href 读得到），而是**读得太早**：
    //   父页面板每 500ms 轮询一次，作业 iframe 刚跳到成绩页、页面正文还没渲染出来，
    //   此刻 body 里是空的。v1.8 读一次就放弃了。
    //
    // 【v1.8.1 怎么改】
    //   ① 读不到就重试（最多 7 次、每次隔 400ms，约 3 秒）；
    //   ② 为了给重试留时间，iframe 的清空推迟到读完之后再执行（由 done 回调完成）；
    //   ③ 报告分级，不再含糊：
    //      · 命中成绩关键词 → 直接给成绩文字；
    //      · 没命中但有正文 → 给页面首段文字（看得出这是哪个页面、显示了什么）；
    //      · 连正文都读不到 → 明确说是跨域、还是文档没 body、还是读取异常。
    //
    // 【为什么要留这个模块】
    //   v1.8 实跑已经证明：iframe 提交后确实跳到了成绩页 selectWorkQuestionYiPiYue
    //   ⇒ **提交动作是成功的**，任务点也确实完成了。
    //   这个模块的作用从「查提交有没有成功」变成「把成绩读出来」，
    //   顺带留下一条可复核的证据链。
    //
    // 【边界】
    //   · 只读 iframe 的 DOM，不点任何按钮、不改任何数据；
    //   · 全程 try/catch，读不到就跳过，绝不影响正常刷课流程；
    //   · 重试期间作业 iframe 会多停留几秒（任务标记 done 仍是 +5s，不受影响）。
    var workResult = {
        KEYWORDS: ['正确率', '分数', '成绩', '得分', '通过', '未通过', '不合格', '及格', '次数', '排名', '答对', '答错'],
        MAX_TRY: 7,
        INTERVAL: 400,
        SNIPPET: 90,
        //读一次作业 iframe 的当前页面
        read: function () {
            try {
                var fr = _d.getElementById('frame_content');
                if (!fr) return { ok: false, why: '找不到作业 iframe', url: '', text: '', len: 0 };
                var win = null;
                try { win = fr.contentWindow; } catch (e0) { }
                if (!win) return { ok: false, why: '拿不到 iframe 的窗口对象', url: '', text: '', len: 0 };
                var url = '';
                try { url = String(win.location.href || ''); } catch (e1) { }
                var doc = null;
                try { doc = win.document; } catch (e2) { }
                if (!doc) return { ok: false, why: '跨域，读不到 iframe 文档', url: url, text: '', len: 0 };
                var body = null;
                try { body = doc.body; } catch (e3) { }
                if (!body) return { ok: false, why: 'iframe 文档还没有 body（页面没渲染完）', url: url, text: '', len: 0 };
                var txt = '';
                try { txt = String(body.innerText || ''); } catch (e4) { }
                if (!txt) { try { txt = String(body.textContent || ''); } catch (e5) { } }
                txt = txt.replace(/\s+/g, ' ').trim();
                return { ok: true, why: '', url: url, text: txt, len: txt.length };
            } catch (e) {
                return { ok: false, why: '读取异常：' + (e && e.message ? e.message : e), url: '', text: '', len: 0 };
            }
        },
        //从正文里挑出与成绩有关的句子
        pick: function (text) {
            try {
                var segs = String(text || '').split(/[。；;！!？?\n]/);
                var out = [];
                for (var i = 0; i < segs.length && out.length < 5; i++) {
                    var s = segs[i].trim();
                    if (!s || s.length > 60) continue;
                    for (var k = 0; k < this.KEYWORDS.length; k++) {
                        if (s.indexOf(this.KEYWORDS[k]) >= 0) { out.push(s); break; }
                    }
                }
                return out.join(' / ');
            } catch (e) { return ''; }
        },
        shortUrl: function (u) {
            try {
                var s = String(u || '');
                if (!s) return '未知';
                s = s.replace(/^https?:\/\//, '').split('?')[0];
                return s.slice(-46);
            } catch (e) { return '未知'; }
        },
        say: function (msg) {
            try { logs.addLog(msg, 'blue'); } catch (e) { }
        },
        //where：前缀；done：读完之后要执行的收尾（清空 iframe）
        report: function (where, done) {
            var self = this;
            var tries = 0;
            var best = null;
            var last = null;
            var finish = function () { try { if (done) done(); } catch (e) { } };
            var once = function () {
                var g = self.read();
                last = g;
                if (g.ok && g.len > 0) {
                    if (!best || g.len > best.len) best = g;
                    var hits = self.pick(g.text);
                    if (hits) {
                        self.say((where || '章节测试') + '提交后：超星页面显示「' + hits + '」（页面 ' + self.shortUrl(g.url) + '）');
                        finish();
                        return;
                    }
                }
                tries++;
                if (tries < self.MAX_TRY) { setTimeout(once, self.INTERVAL); return; }
                // 读不到有用的文字：把能拿到的原样报出来
                if (best && best.len > 0) {
                    var snip = best.text.slice(0, self.SNIPPET);
                    self.say((where || '章节测试') + '提交后：页面正文里没找到成绩文字，首段是「' + snip + '」（页面 ' + self.shortUrl(best.url) + '）');
                } else {
                    var why = (last && last.why) ? last.why : '没读到正文';
                    self.say((where || '章节测试') + '提交后：' + why + '（页面 ' + self.shortUrl(last && last.url) + '）');
                }
                finish();
            };
            try { once(); } catch (e) { finish(); }
        }
    };
    //==================== v1.8.1 章节测试提交结果回报结束 ====================
