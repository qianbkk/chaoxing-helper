    //==================== v1.5 暂停控制模块开始 ====================
    // 【为什么加这个】
    //   「遍历」翻章模式下脚本会自己跑个不停：答完 → 5秒后自动下一章 → 再答 → 再跳 …
    //   循环下去停不下来，想停只能关扩展或刷新页面（会丢掉当前章的进度）。
    //   上游唯一的出口是 jumpType=2「不跳转」，但它会把「翻章模式」这个设置本身改掉，
    //   语义混在一起，用完还得手动改回来。
    //   这里加一个独立的「暂停」开关：
    //     · 状态存 GM 存储 —— 翻章 reload 后仍然是暂停的（不会一翻页就复活）
    //     · 运行时把 jumpType 压成 2，并拦掉上游写 `_w.jump = true` 的动作（双保险）
    //     · 同时让 workAuto 停下：不再自动作答、不再自动提交
    //     · 点「继续」恢复原来的翻章模式（读回存储里的 unrivaljumpType）
    var pauseCtl = {
        KEY: 'unrivalPaused',
        _guardInstalled: false,
        isPaused: function () {
            try {
                return GM_getValue(this.KEY, '0') == '1';
            } catch (e) {
                return false;
            }
        },
        apply: function (paused) {
            try {
                if (paused) {
                    jumpType = 2;                                  // 上游的「不跳转」模式
                    try { _w.jump = false; } catch (e) { }
                    try { _w.top.jump = false; } catch (e) { }
                } else {
                    var m = String(GM_getValue('unrivaljumpType', '1'));
                    jumpType = (m === '2') ? 2 : ((m === '0') ? 0 : 1);
                }
            } catch (e) { }
        },
        set: function (paused) {
            try {
                GM_setValue(this.KEY, paused ? '1' : '0');
                this.apply(paused);
            } catch (e) { }
        },
        installGuard: function () {
            // 拦掉上游的 `_w.jump = true`：暂停时不允许再触发自动翻章
            // （上游在 3 个地方写它：任务做完 / 本页无任务 / 正确率不达标已保存）
            try {
                if (this._guardInstalled) return;
                var self = this;
                var val = false;
                try { val = _w.jump; } catch (e) { }
                Object.defineProperty(_w, 'jump', {
                    configurable: true,
                    enumerable: true,
                    get: function () {
                        return val;
                    },
                    set: function (v) {
                        if (v === true && self.isPaused()) {
                            val = false;
                            return;
                        }
                        val = v;
                    }
                });
                this._guardInstalled = true;
            } catch (e) { }
        },
        init: function () {
            try {
                this.installGuard();
                if (this.isPaused()) {
                    this.apply(true);
                    setTimeout(function () {
                        try {
                            logs.addLog('已处于暂停状态：不会自动翻到下一章，也不会自动作答/提交', 'orange');
                        } catch (e) { }
                    }, 500);
                }
            } catch (e) { }
        }
    };
    try {
        pauseCtl.init();
    } catch (e) {
        console.log(e);
    }
    //==================== v1.5 暂停控制模块结束 ====================
