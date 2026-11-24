// ==UserScript==
// @name          超星学习通小助手（AI 版）
// @namespace    unrival
// @version      1.11.1-AI
// @description  超星学习通小助手（AI 版）：自动刷视频与文档、自动做章节测验/作业。章节测验先用题库作答，查不到或被限流时自动降级到 AI（OpenAI 兼容接口）；超星的加密字体自动解密，题干与选项都能正常识别。题库 Token、正确率门槛、翻章模式、AI 接口地址与密钥都可在面板配置。
// @author       qianbkk
// @run-at       document-end
// @storageName  unrivalxxt
// @match        *://*.chaoxing.com/*
// @match        *://*.edu.cn/*
// @match        *://*.nbdlib.cn/*
// @match        *://*.hnsyu.net/*
// @match        *://*.ac.cn/*
// @icon         http://pan-yz.chaoxing.com/favicon.ico
// @updateURL    https://github.com/qianbkk/chaoxing-helper/releases/latest/download/chaoxing-helper.meta.js
// @downloadURL  https://github.com/qianbkk/chaoxing-helper/releases/latest/download/chaoxing-helper.user.js
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_info
// @grant        GM_openInTab
// @connect      mooc1-1.chaoxing.com
// @connect      mooc1.chaoxing.com
// @connect      mooc1-2.chaoxing.com
// @connect      passport2-api.chaoxing.com

// @connect      cx.icodef.com
// @connect      *
// @license      GPL-3.0-or-later
// @homepageURL  https://github.com/qianbkk/chaoxing-helper
// @original-script https://scriptcat.org/script-show-page/878/
// @original-author unrival
// @original-license GPL-3.0-or-later
//如果脚本提示添加安全网址，请将脚本提示内容填写到下方区域，一行一个，如果不会，请加群询问



//安全网址请填写在上方空白区域
// ==/UserScript==
