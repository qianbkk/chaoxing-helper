    //==================== v1.11 全程托管模式开始 ====================
    // 【要解决的问题】
    //   原脚本遇到「不支持的任务类型」（直播/阅读等）会**主动停下等人**：
    //   v1.6 的设计是「绝不能悄悄把还有任务点的章节跳过去」，
    //   所以脚本会打一行红字、然后 pauseCtl.set(true) 自己停住，等人工处理完再点「继续」。
    //   对「想让它自己从头刷到尾」的用户来说，这就等于刷一半不刷了 —— 进度卡住还得守着。
    //
    // 【全程托管模式换一个取舍】
    //   遇到做不了的任务（直播/阅读/自定义任务）就**跳过并记账**，继续往下推进，
    //   直到没有下一节为止。被跳过的任务会写进日志和任务列表，不会静默吞掉。
    //
    // 【开启后行为差异（三处）】
    //   ① 不支持的任务类型：不再暂停，改为跳过并继续；
    //   ② 超星说「章节未开放」（闯关锁定）时：不再直接退出脚本，改为记录后继续；
    //   ③ 本章任务做完后超星没放行（没有下一节 / 上一节有未完成的任务点）：
    //      每 20 秒重试一次跳转，日志限频，不会静默卡住不动。
    //
    // 【边界（别误以为能全自动刷完所有任务点）】
    //   · 跳过的章节，其任务点不会被点亮 —— 闯关模式下超星可能不放行到下一节；
    //     这时脚本会持续重试并写日志，需要人工把那一节的任务点补上才能继续往下。
    //   · 直播类任务即使跳过，也要超星那边自己到期才算完成，脚本替代不了。
    //   · 默认关闭（unrivalAutoRun = '0'），不改变原来的行为。
    var autoRun = {
        KEY: 'unrivalAutoRun',
        INTERVAL: 20000,      // 重试间隔：20 秒
        LOG_EVERY: 60000,     // 日志限频：最多每分钟一条
        LOG_EVERY_LATE: 300000, // 重试多了以后，日志放宽到每 5 分钟一条
        _timer: null,
        _lastLog: 0,
        _tries: 0,
        enabled: function () {
            try { return GM_getValue(this.KEY, '0') == '1'; } catch (e) { return false; }
        },
        setEnabled: function (on) {
            try { GM_setValue(this.KEY, on ? '1' : '0'); } catch (e) { }
            //让顶层窗口也知道（调试状态里要能看到）
            try { _w.top.unrivalAutoRun = on ? '1' : '0'; } catch (e1) { }
        },
        //写日志：面板还没建好时（logs 未定义）就跳过，不能因此抛错
        log: function (msg, color) {
            try {
                if (typeof logs != 'undefined' && logs && logs.addLog) {
                    logs.addLog(msg, color || 'black');
                }
            } catch (e) { }
        },
        //本章的任务是不是都做完了（做完了才谈得上「推进下一节」）
        chapterDone: function () {
            try {
                if (typeof busyThread != 'undefined' && busyThread > 0) return false;
                if (typeof missionList == 'undefined' || !missionList) return false;
                for (var k in missionList) {
                    if (!missionList[k]['done']) return false;
                }
                return true;
            } catch (e) { return false; }
        },
        //看门狗：本章做完了但超星没把我们带到下一节 → 定期重试
        _watchTick: function () {
            try {
                if (!this.enabled()) return;
                if (typeof pauseCtl != 'undefined' && pauseCtl.isPaused()) return;   // 用户暂停了就不催
                if (typeof jumpType != 'undefined' && jumpType == 2) return;          // 「不跳转」模式不催
                if (!this.chapterDone()) return;                                     // 本章还没做完
                this._tries++;
                //再要一次跳转（跟脚本平时用的同一套机制）
                try { _w.top.jump = true; } catch (e1) { }
                var now = Date.now();
                var gap = (this._tries > 5) ? this.LOG_EVERY_LATE : this.LOG_EVERY;
                if (now - this._lastLog < gap) return;
                this._lastLog = now;
                var msg = '全程托管：这一节的任务已做完，但超星没有跳到下一节（第 ' + this._tries + ' 次重试）';
                if (this._tries > 5) {
                    msg += '。可能已经到最后一节，也可能上一节还有没完成的任务点（脚本做不了的那种），需要人工补上才会继续';
                }
                this.log(msg, 'orange');
            } catch (e) { }
        },
        start: function () {
            var self = this;
            if (this._timer) return;
            //只有超星的章节列表页才需要看门狗（别的页面没有任务循环）
            try {
                if (typeof _l == 'undefined' || !_l || _l.href.indexOf('knowledge/cards') < 0) return;
            } catch (e) { return; }
            this._timer = setInterval(function () {
                try { self._watchTick(); } catch (e2) { }
            }, this.INTERVAL);
        }
    };
    try {
        autoRun.start();
    } catch (e) {
        console.log(e);
    }
    //==================== v1.11 全程托管模式结束 ====================
