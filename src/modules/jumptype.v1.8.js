    //==================== v1.8 翻章模式存储隔离开始 ====================
    // 【解决什么 —— 脚本「卡住不动」的根因】
    //   v1.5 的「暂停」功能是借上游的 jumpType=2（不跳转）实现的：
    //   暂停时把**运行时变量** jumpType 压成 2，恢复时再读回存储。
    //   问题出在面板「保存AI设置」那一步 —— 它把**运行时变量** jumpType
    //   直接写回了存储。于是：
    //     暂停中点一次「保存AI设置」 → 存储被写成 2
    //     → 之后点「继续」读回的也是 2 → 脚本永远停在当前章节
    //     → 日志一直打「所有任务处理完毕，用户设置为不跳转，脚本已结束运行」
    //   现场日志已坐实这条链：21:33:48 已处于暂停状态 → 21:33:55 已继续
    //   → 21:34:05 / 21:34:29 仍在打「用户设置为不跳转」。
    //
    // 【怎么改】
    //   把「用户真实设置」和「运行时状态」彻底分开：
    //     · 用户真实设置 → 独立存储键 unrivalJumpTypeReal
    //     · 运行时 jumpType → 只存在于内存，暂停时才被压成 2，永远不写回存储
    //   面板回填 / 保存设置 / 远程命令三处，一律读写 unrivalJumpTypeReal。
    //   老键 unrivaljumpType 保留为「镜像」：写入真实设置时同步一份，
    //   这样 v1.5 暂停模块里「读回 unrivaljumpType 恢复翻章模式」那条路径
    //   不用改也能拿到正确值（暂停模块是 v1.5 时期落的代码，不动它更安全）。
    //
    // 【一次性迁移】
    //   老键为 '2' 时无法区分「用户主动选的不跳转」与「被暂停功能污染」。
    //   按「遍历」恢复并打一条日志说明原因；用户若确实想要不跳转，
    //   在「AI答题设置」里改回即可 —— v1.8 之后改了就一定存得住。
    var jumpMode = {
        REAL_KEY: 'unrivalJumpTypeReal',
        LEGACY_KEY: 'unrivaljumpType',
        _note: '',
        //读用户真实设置（首次调用时做一次性迁移并修复被污染的旧值）
        get: function () {
            try {
                var v = String(GM_getValue(this.REAL_KEY, ''));
                if (v === '1' || v === '2') return v;
                // 迁移：老键只读一次
                var legacy = String(GM_getValue(this.LEGACY_KEY, '1'));
                var real = '1';
                if (legacy === '2') {
                    this._note = '翻章模式存储已修复：旧版本的暂停功能把模式误写成「不跳转」，已恢复为「遍历」。若确实需要不跳转，在「AI答题设置」里改回即可（现在改了就存得住）。';
                }
                GM_setValue(this.REAL_KEY, real);
                try { GM_setValue(this.LEGACY_KEY, real); } catch (e2) { }
                return real;
            } catch (e) {
                return '1';
            }
        },
        //写用户真实设置：只碰存储，不动运行时变量（由调用方决定要不要同步运行时）
        set: function (v) {
            var real = (String(v) === '2') ? '2' : '1';
            try {
                GM_setValue(this.REAL_KEY, real);
                GM_setValue(this.LEGACY_KEY, real);
            } catch (e) { }
            return real;
        },
        //迁移提示延后到 logs 可用时再打（脚本刚启动那会儿 logs 还没建好）
        flushNote: function () {
            try {
                if (!this._note) return false;
                if (typeof logs == 'undefined' || !logs || !logs.addLog) return false;
                logs.addLog(this._note, 'orange');
                this._note = '';
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
                if (self.flushNote()) return;
                if (tries < 30) setTimeout(wait, 500);
            };
            setTimeout(wait, 500);
        }
    };
    try {
        jumpMode.start();
    } catch (e) {
        console.log(e);
    }
    //==================== v1.8 翻章模式存储隔离结束 ====================
