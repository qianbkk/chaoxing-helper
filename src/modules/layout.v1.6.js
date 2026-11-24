    //==================== v1.6 面板布局整理开始 ====================
    // 【解决什么】
    //   上游面板是十来个 panel 竖着堆下来的，「运行日志」还会随行数无限变长，
    //   「章节测试」那块更是 1000px 高 —— 整个面板比超星正文还长，翻起来很费劲。
    //   这里做四件事：
    //   ① 每个 panel 标题右侧加折叠箭头（▾ / ▸），点标题右侧箭头即收/展
    //   ② 「运行日志」「任务列表」限高 + 滚动条，不再无限往下长
    //   ③ 「章节测试」那块从 1000px 降到 520px
    //   ④ 只处理脚本自己注入的面板（定位到标题 id=unrivalTitle 所在的容器），
    //      不碰超星页面本身的 DOM
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
        init: function () {
            try {
                var root = this.findRoot();
                if (!root) return false;
                var panels = root.getElementsByClassName('panel');
                var arrows = 0;
                for (var i = 0; i < panels.length; i++) {
                    var panel = panels[i];
                    if (panel.getAttribute('data-unrival-toggle') == '1') continue;
                    panel.setAttribute('data-unrival-toggle', '1');
                    var head = null, body = null;
                    for (var j = 0; j < panel.children.length; j++) {
                        var c = panel.children[j];
                        var cn = String(c.className || '');
                        if (!head && cn.indexOf('panel-heading') >= 0) head = c;
                        if (!body && cn.indexOf('panel-body') >= 0) body = c;
                    }
                    if (!head || !body) continue;
                    var arrow = _d.createElement('span');
                    arrow.className = 'unrival-arrow';
                    arrow.innerHTML = '▾';
                    head.appendChild(arrow);
                    arrows++;
                    arrow.onclick = function (ev) {
                        try { if (ev && ev.stopPropagation) ev.stopPropagation(); } catch (e) { }
                        var p = this.parentNode ? this.parentNode.parentNode : null;
                        if (!p) return;
                        var collapsed = String(p.className || '').indexOf('unrival-collapsed') >= 0;
                        if (collapsed) {
                            p.className = String(p.className || '').replace('unrival-collapsed', '');
                            this.innerHTML = '▾';
                        } else {
                            p.className = String(p.className || '') + ' unrival-collapsed';
                            this.innerHTML = '▸';
                        }
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
                        dbg.log('info', '面板整理：已加折叠箭头 ' + arrows + ' 个；日志区/任务列表已限高');
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
    //==================== v1.6 面板布局整理结束 ====================
