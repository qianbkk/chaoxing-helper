    //==================== v1.8 面板布局整理开始 ====================
    // 【v1.8 相比 v1.6 改了什么】
    //   ① 折叠按钮重做：v1.6 只是在标题右边浮一个灰色 ▾ 字符 —— 又小又灰、看不出是能点的，
    //      还得瞄准那个字符点。v1.8 改成「点标题文字即可折叠」，箭头做成带底色的小按钮、
    //      hover 变色、鼠标手型，一眼能看出可点。
    //   ② 「任务配置」区块不再折叠（用户反馈：这个区块本来就短，折叠反而多一步操作）。
    //   ③ 保留 v1.6 的限高滚动条（运行日志 260px / 任务列表 220px / 章节测试 iframe 520px）。
    //
    // 【只动脚本自己的面板】
    //   靠标题 id=unrivalTitle 所在的 col-md-6 容器定位，不碰超星页面本身的 DOM。
    var layoutFix = {
        findRoot: function () {
            try {
                var t = _d.getElementById('unrivalTitle');
                if (!t) return null;
                var p = t;
                while (p && p.parentNode) {
                    if (p.className && String(p.className).indexOf('col-md-6') >= 0) return p;
                    p = p.parentNode;
                }
                return (t.parentNode && t.parentNode.parentNode) ? t.parentNode.parentNode : null;
            } catch (e) {
                return null;
            }
        },
        //===== 折叠开关（点标题或箭头都生效）=====
        toggle: function (panel, head, arrow) {
            try {
                var collapsed = String(panel.className || '').indexOf('unrival-collapsed') >= 0;
                if (collapsed) {
                    panel.className = String(panel.className || '').replace(/\s*unrival-collapsed\s*/, ' ').replace(/\s+$/, '');
                    arrow.innerHTML = '▾';
                    if (head) head.setAttribute('title', '点击收起');
                } else {
                    panel.className = (String(panel.className || '') + ' unrival-collapsed').replace(/\s+/g, ' ');
                    arrow.innerHTML = '▸';
                    if (head) head.setAttribute('title', '点击展开');
                }
            } catch (e) { }
        },
        init: function () {
            try {
                var root = this.findRoot();
                if (!root) return false;
                var panels = root.getElementsByClassName('panel');
                var arrows = 0;
                for (var i = 0; i < panels.length; i++) {
                    var panel = panels[i];
                    if (panel.getAttribute('data-unrival-toggle') == '1') continue;
                    var head = null, body = null;
                    for (var j = 0; j < panel.children.length; j++) {
                        var c = panel.children[j];
                        var cn = String(c.className || '');
                        if (!head && cn.indexOf('panel-heading') >= 0) head = c;
                        if (!body && cn.indexOf('panel-body') >= 0) body = c;
                    }
                    if (!head || !body) continue;
                    //v1.8：「任务配置」不折叠
                    var headText = String(head.textContent || '');
                    if (headText.indexOf('任务配置') >= 0) continue;
                    panel.setAttribute('data-unrival-toggle', '1');
                    var arrow = _d.createElement('span');
                    arrow.className = 'unrival-arrow';
                    arrow.innerHTML = '▾';
                    head.appendChild(arrow);
                    head.className = (String(head.className || '') + ' unrival-clickable').replace(/\s+/g, ' ');
                    head.setAttribute('title', '点击收起');
                    arrows++;
                    //v1.8：点标题整行都能折叠（箭头自身 pointer-events:none，避免触发两次）
                    var self = this;
                    head.onclick = function (ev) {
                        try { if (ev && ev.stopPropagation) ev.stopPropagation(); } catch (e) { }
                        var p = this.parentNode;
                        var a = this.getElementsByClassName('unrival-arrow')[0];
                        if (p && a) self.toggle(p, this, a);
                    };
                }
                // 日志区 / 任务列表：限高 + 滚动条
                try {
                    var logWrap = root.querySelector('#result');
                    if (logWrap) {
                        logWrap.style.maxHeight = '260px';
                        logWrap.style.overflowY = 'auto';
                    }
                    var joblist = root.querySelector('#joblist');
                    if (joblist) {
                        joblist.style.maxHeight = '220px';
                        joblist.style.overflowY = 'auto';
                    }
                } catch (e) { }
                // 自检：折叠箭头加了多少个（配合调试模式落到日志里，便于核对渲染结果）
                try {
                    if (typeof dbg != 'undefined') {
                        dbg.log('info', '面板整理：已加折叠箭头 ' + arrows + ' 个（任务配置除外）；日志区/任务列表已限高');
                    }
                } catch (e2) { }
                return true;
            } catch (e) {
                console.log(e);
                return false;
            }
        },
        start: function () {
            var self = this;
            var tries = 0;
            var wait = function () {
                tries++;
                if (self.init()) return;
                if (tries < 30) setTimeout(wait, 500);
            };
            setTimeout(wait, 500);
        }
    };
    try {
        layoutFix.start();
    } catch (e) {
        console.log(e);
    }
    //==================== v1.8 面板布局整理结束 ====================
