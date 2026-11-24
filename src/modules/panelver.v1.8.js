    //==================== v1.8 面板版本号动态化开始 ====================
    // 【解决什么】
    //   v1.7 装上后，面板大标题却还写着「超星学习通小助手 v1.6（AI 版）」——
    //   因为标题里的版本号是**写死在补丁里的字符串**，每次升版本都得手工改，
    //   漏改一次就会像这次一样「脚本已是 1.7、界面还写着 1.6」。
    //
    // 【怎么改】
    //   标题里只留一个占位 <span id="unrivalVer"></span>，
    //   版本号在运行时从 GM_info.script.version 取 —— 以后无论升到哪一版，
    //   界面自动跟着变，不需要再动补丁。
    //
    // 【注意】
    //   只处理脚本自己注入的主面板（靠 id=unrivalTitle 定位）；
    //   挂机小助手那个独立页面（unrivalxxtbackground）不碰。
    var panelVer = {
        //从 GM_info 取真实版本号，取不到就显示未知
        raw: function () {
            try {
                var v = (GM_info && GM_info.script && GM_info.script.version) || '';
                return String(v);
            } catch (e) {
                return '';
            }
        },
        //显示成「1.8」这样的短版本（1.8.0-AI → 1.8）
        short: function (v) {
            var m = String(v || '').match(/(\d+)\.(\d+)/);
            return m ? (m[1] + '.' + m[2]) : '';
        },
        apply: function () {
            try {
                var el = _d.getElementById('unrivalVer');
                if (!el) return false;
                var v = this.raw();
                var s = this.short(v);
                el.innerHTML = s ? ('v' + s) : 'v?';
                //浏览器标签页标题也跟着走
                try {
                    var t = _d.title || '';
                    if (t.indexOf('超星学习通小助手') >= 0) {
                        _d.title = '超星学习通小助手 v' + (s || '?') + '（AI 版）';
                    }
                } catch (e2) { }
                return true;
            } catch (e) {
                return false;
            }
        },
        start: function () {
            var self = this;
            var tries = 0;
            var wait = function () {
                tries++;
                if (self.apply()) return;
                if (tries < 30) setTimeout(wait, 500);
            };
            setTimeout(wait, 500);
        }
    };
    try {
        panelVer.start();
    } catch (e) {
        console.log(e);
    }
    //==================== v1.8 面板版本号动态化结束 ====================
