    //==================== v1.8 章节测试提交结果回报开始 ====================
    // 【解决什么】
    //   用户反馈：日志打出「正确率符合标准，已提交答案」，但超星那边
    //   章节测试的**任务点还是没亮**，脚本自己也停在那里。
    //
    //   「已提交答案」这句话是上游的**乐观日志** —— 它在真正提交之前
    //   就先把这句话写给父页面板（提交动作在 3~5 秒后才真正发出）。
    //   所以这句话既不能证明提交成功，也解释不了任务点为什么没亮。
    //
    // 【怎么查】
    //   提交完成后，上游的作业 iframe 会跳到「成绩/提交结果」页面。
    //   趁父页面板把 iframe 清空之前，把那个页面上的成绩文字读出来，
    //   打进运行日志。这样「任务点没亮」就有据可查：
    //     · 页面上写着「正确率 60% / 通过」→ 提交成功，任务点不亮是超星侧刷新问题
    //     · 页面上写着「未通过 / 正确率 33%」→ 答错了，任务点本来就不会亮
    //     · 读不到文字 → 跨域或页面无提示，再另行排查
    //
    // 【边界】
    //   · 只读 iframe 的 DOM，不点任何按钮、不改任何数据；
    //   · 全程 try/catch，读不到就跳过，绝不影响正常刷课流程；
    //   · 同源才读得到（超星成绩页与父页同域），跨域时静默跳过。
    var workResult = {
        KEYWORDS: ['正确率', '分数', '成绩', '通过', '未通过', '次数', '不合格', '及格', '排名'],
        //从作业 iframe 里抠出成绩相关的文字
        grab: function () {
            try {
                var fr = _d.getElementById('frame_content');
                if (!fr) return { text: '', url: '' };
                var win = fr.contentWindow;
                var url = '';
                try { url = String(win.location.href || ''); } catch (e0) { }
                var doc = null;
                try { doc = win ? win.document : null; } catch (e1) { }
                if (!doc || !doc.body) return { text: '', url: url };
                var txt = String(doc.body.innerText || doc.body.textContent || '').replace(/\s+/g, ' ');
                if (!txt) return { text: '', url: url };
                var segs = txt.split(/[。；;！!？?\n]/);
                var out = [];
                for (var i = 0; i < segs.length && out.length < 5; i++) {
                    var s = segs[i].trim();
                    if (!s || s.length > 60) continue;
                    for (var k = 0; k < this.KEYWORDS.length; k++) {
                        if (s.indexOf(this.KEYWORDS[k]) >= 0) {
                            out.push(s);
                            break;
                        }
                    }
                }
                return { text: out.join(' / '), url: url };
            } catch (e) {
                return { text: '', url: '' };
            }
        },
        report: function (where) {
            try {
                var g = this.grab();
                var tail = '';
                if (g.url) {
                    try {
                        tail = '（页面 ' + g.url.split('?')[0].replace(/^https?:\/\//, '').slice(-40) + '）';
                    } catch (e1) { }
                }
                var msg = (where || '章节测试') + '提交后：' +
                    (g.text ? ('超星页面显示「' + g.text + '」') : '没读到成绩文字（可能跨域或页面无提示）') + tail;
                logs.addLog(msg, 'blue');
            } catch (e) { }
        }
    };
    //==================== v1.8 章节测试提交结果回报结束 ====================
