/**
 * xxgg-web-preload.js
 * ---------------------------------------------------------------
 * 浏览器端的 “preload 桥接层”。
 *
 * 原 Electron 应用通过 preload 注入 4 个全局对象：
 *   - __APP_CONFIG__ : 后端地址配置
 *   - xxggApp        : 应用元信息
 *   - xxggShell      : 窗口/菜单/微信登录/本地资源包/凭证上传
 *   - xxggUpdater    : 自动更新
 *
 * 本脚本在渲染层 bundle 之前同步执行，用浏览器等价实现补齐这些对象，
 * 使未经修改的渲染层代码可以直接在浏览器中运行。
 */
(function () {
  'use strict';

  var cfg = window.__XXGG_WEB_CONFIG__ || {};
  var APP_NAME = cfg.appName || '九分学长考雅机考平台';
  var APP_VERSION = cfg.appVersion || '0.9.16-rc.3';

  /* --------------------------------------------------------------
   * 跨域媒体回源：原应用会 fetch() 预加载 CDN 上的音频。
   * 把已知上游域名的绝对地址改写到同源代理，规避 CORS。
   * ------------------------------------------------------------ */
  if (cfg.enableMediaProxy !== false && Array.isArray(cfg.mediaHosts) && cfg.mediaHosts.length) {
    var hosts = cfg.mediaHosts;
    var nativeFetch = window.fetch ? window.fetch.bind(window) : null;

    function isProxiedHost(hostname) {
      for (var i = 0; i < hosts.length; i++) {
        var h = hosts[i];
        if (hostname === h) return true;
        if (hostname.length > h.length && hostname.slice(-(h.length + 1)) === '.' + h) return true;
      }
      return false;
    }

    if (nativeFetch) {
      window.fetch = function (input, init) {
        try {
          var raw = typeof input === 'string' ? input : (input && input.url) || '';
          if (/^https?:\/\//i.test(raw)) {
            var u = new URL(raw);
            if (u.origin !== window.location.origin && isProxiedHost(u.hostname)) {
              var proxied = '/__xxgg_proxy?url=' + encodeURIComponent(raw);
              if (typeof input === 'string') {
                return nativeFetch(proxied, init);
              }
            }
          }
        } catch (e) {
          /* 回落到原始请求 */
        }
        return nativeFetch(input, init);
      };
    }
  }

  /* --------------------------------------------------------------
   * __APP_CONFIG__ —— 渲染层在模块初始化时同步读取，必须最先就绪
   * ------------------------------------------------------------ */
  window.__APP_CONFIG__ = {
    apiBaseUrl: cfg.apiBaseUrl || '/api/listen',
    practiceApiBaseUrl: cfg.practiceApiBaseUrl || '/api',
    userAuthApiBaseUrl: cfg.userAuthApiBaseUrl || '/api',
    apiMode: cfg.apiMode || 'web',
    env: 'production'
  };

  /* --------------------------------------------------------------
   * xxggApp —— 应用元信息
   * ------------------------------------------------------------ */
  window.xxggApp = {
    name: APP_NAME,
    productName: APP_NAME,
    packageName: 'xxgg-ielts',
    version: APP_VERSION
  };

  /* --------------------------------------------------------------
   * xxggShell —— 窗口 / 菜单 / 微信登录 / 本地资源包
   *
   * 注意：刻意 *不* 暴露 inspectResourcePack / listInstalledResourcePacks /
   * checkResourcePackCoverage。渲染层用这三个方法是否存在来判断是否启用
   * “本地资源包”离线模式；网页版没有本地 sqlite 加密包，走在线接口即可。
   * ------------------------------------------------------------ */
  var menuHandlers = [];
  var wechatHandlers = [];

  function detectPlatform() {
    var ua = navigator.userAgent || '';
    if (/Mac|iPhone|iPad|iPod/i.test(ua)) return 'darwin';
    return 'web';
  }

  function applyOverlayColor(payload) {
    try {
      var color = payload && payload.color;
      if (!color) return;
      var meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'theme-color');
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', color);
      document.documentElement.style.backgroundColor = color;
    } catch (e) { /* noop */ }
  }

  window.xxggShell = {
    platform: detectPlatform(),
    isDev: false,

    /** 原 Electron 窗口控制；浏览器中降级为可用的等价行为 */
    windowAction: function (action) {
      try {
        switch (action) {
          case 'close':
            window.close();
            break;
          case 'fullscreen':
          case 'toggle-fullscreen':
            if (document.fullscreenElement) document.exitFullscreen();
            else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
            break;
          default:
            break; /* minimize / maximize 在网页中无意义 */
        }
      } catch (e) { /* noop */ }
      return Promise.resolve({ ok: true, action: action, mode: 'web' });
    },

    setOverlayColor: function (payload) {
      applyOverlayColor(payload);
      return Promise.resolve({ ok: true });
    },

    /** 桌面菜单命令在网页版不存在，返回取消订阅函数 */
    onMenuCommand: function (cb) {
      if (typeof cb === 'function') menuHandlers.push(cb);
      return function () {
        var i = menuHandlers.indexOf(cb);
        if (i >= 0) menuHandlers.splice(i, 1);
      };
    },

    /** 微信登录：网页版由服务端 OAuth 重定向回带 code/state 的地址 */
    onWechatLoginCallback: function (cb) {
      if (typeof cb !== 'function') return function () {};
      wechatHandlers.push(cb);
      var pending = readWechatCallbackFromUrl();
      if (pending) {
        try { cb(pending); } catch (e) { /* noop */ }
      }
      return function () {
        var i = wechatHandlers.indexOf(cb);
        if (i >= 0) wechatHandlers.splice(i, 1);
      };
    },

    getPendingWechatLoginUrl: function () {
      return Promise.resolve(null);
    }
  };

  function readWechatCallbackFromUrl() {
    try {
      var params = new URLSearchParams(window.location.search);
      var code = params.get('code');
      var state = params.get('state');
      if (!code || !state) return null;
      var expected = null;
      try { expected = sessionStorage.getItem('xxgg.wechatLogin.state'); } catch (e) { /* noop */ }
      if (expected && state !== expected) return null;
      return { code: code, state: state };
    } catch (e) {
      return null;
    }
  }

  /* --------------------------------------------------------------
   * xxggUpdater —— 网页版没有自更新，返回静态“已是最新”状态
   * ------------------------------------------------------------ */
  var updaterState = {
    status: 'idle',
    version: APP_VERSION,
    availableVersion: null,
    downloadedVersion: null,
    progress: null,
    message: '网页版始终加载最新版本，无需更新',
    checkedAt: null,
    isPackaged: false,
    feedUrl: '',
    canCheck: false,
    canDownload: false,
    canInstall: false,
    diagnostic: null
  };

  function snapshotUpdater() {
    return {
      status: updaterState.status,
      version: updaterState.version,
      availableVersion: updaterState.availableVersion,
      downloadedVersion: updaterState.downloadedVersion,
      progress: updaterState.progress,
      message: updaterState.message,
      checkedAt: updaterState.checkedAt,
      isPackaged: updaterState.isPackaged,
      feedUrl: updaterState.feedUrl,
      canCheck: updaterState.canCheck,
      canDownload: updaterState.canDownload,
      canInstall: updaterState.canInstall,
      diagnostic: updaterState.diagnostic
    };
  }

  window.xxggUpdater = {
    getState: function () {
      return Promise.resolve(snapshotUpdater());
    },
    onEvent: function (cb) {
      if (typeof cb === 'function') {
        try { cb(snapshotUpdater()); } catch (e) { /* noop */ }
      }
      return function () {};
    },
    check: function () {
      updaterState.checkedAt = new Date().toISOString();
      updaterState.status = 'idle';
      return Promise.resolve(snapshotUpdater());
    },
    download: function () {
      return Promise.resolve(snapshotUpdater());
    },
    installAndRestart: function () {
      window.location.reload();
      return Promise.resolve();
    },
    copyDiagnostic: function () {
      return Promise.resolve('xxgg-ielts web ' + APP_VERSION + ' @ ' + window.location.origin);
    }
  };

  /* --------------------------------------------------------------
   * 兼容：把 xxggShell 与桌面端窗口语义的差异打点到控制台，便于排查
   * ------------------------------------------------------------ */
  if (cfg.debug) {
    console.info('[xxgg-web] bridge ready', {
      app: APP_NAME,
      version: APP_VERSION,
      config: window.__APP_CONFIG__
    });
  }
})();
