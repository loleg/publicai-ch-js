'use strict';
/* SPDX-License-Identifier: Apache-2.0 */
/* Apertus chat widget — embeddable launcher for third-party websites.
 *
 * Adds a floating launcher button to the host page and opens the chat in a
 * pop-up browser window (default) or an in-page panel with an embedded
 * iframe. Self-contained by design: styles are injected with namespaced
 * selectors (no external CSS, no clash with host stylesheets), there are no
 * dependencies, and no secrets — the chat inside the pop-up talks to the
 * /api proxy of the deployment that serves this file.
 *
 * Usage (paste before </body>):
 *
 *   <script src="https://chat.example.com/assets/widget.js" defer></script>
 *
 * When widget.js is mirrored to another origin (e.g. a CDN), point it at the
 * deployment that runs the proxy:
 *
 *   <script src="https://cdn.example.com/widget.js"
 *           data-url="https://chat.example.com" defer></script>
 *
 * Configuration — data-* attributes on the script tag win over the
 * window.ApertusChatWidget object, which wins over the defaults:
 *
 *   data-url       url        Deployment base (pop-up loads <url>/popup.html)
 *   data-mode      mode       "window" (default) or "panel" (in-page iframe)
 *   data-label     label      Accessible name / title (default "Chat with Apertus")
 *   data-position  position   "right" (default) or "left"
 *   data-width     width      Pop-up width in px (default 420)
 *   data-height    height     Pop-up height in px (default 640)
 *
 * Programmatic API: window.ApertusChat.open() / close() / toggle()
 * Include the script once per page; a second include is a no-op.
 */

(function () {
  if (window.ApertusChat) return; // Already included.

  /* --- Configuration ------------------------------------------------------ */

  var WINDOW_NAME = 'apertus-chat';
  var DEFAULTS = {
    mode: 'window',
    label: 'Chat with Apertus',
    position: 'right',
    width: 420,
    height: 640,
  };
  var OPTION_KEYS = ['url', 'mode', 'label', 'position', 'width', 'height'];

  function scriptTag() {
    if (document.currentScript) return document.currentScript;
    var marked = document.querySelector('script[data-apertus]');
    if (marked) return marked;
    return document.scripts[document.scripts.length - 1] || null;
  }

  function optionFromAttributes(tag) {
    var options = {};
    if (!tag || !tag.getAttribute) return options;
    OPTION_KEYS.forEach(function (key) {
      var value = tag.getAttribute('data-' + key);
      if (value !== null && value !== '') options[key] = value;
    });
    return options;
  }

  function firstDefined() {
    for (var i = 0; i < arguments.length; i += 1) {
      var value = arguments[i];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return undefined;
  }

  function numberOr(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  // Default deployment: the origin of the script URL. There is no fallback —
  // widget.js must be served by the deployment itself, and file:// pages are
  // not supported (see the README).
  function deploymentUrl(tag) {
    // tag.src is the resolved absolute URL of the script tag.
    return new URL(tag && tag.src ? tag.src : location.href).origin;
  }

  var hostConfig = window.ApertusChatWidget || {};
  var tagConfig = optionFromAttributes(scriptTag());

  var config = {
    url: String(firstDefined(tagConfig.url, hostConfig.url, deploymentUrl(scriptTag()))),
    mode: firstDefined(tagConfig.mode, hostConfig.mode, DEFAULTS.mode) === 'panel' ? 'panel' : 'window',
    label: String(firstDefined(tagConfig.label, hostConfig.label, DEFAULTS.label)),
    position: firstDefined(tagConfig.position, hostConfig.position, DEFAULTS.position) === 'left' ? 'left' : 'right',
    width: numberOr(firstDefined(tagConfig.width, hostConfig.width), DEFAULTS.width),
    height: numberOr(firstDefined(tagConfig.height, hostConfig.height), DEFAULTS.height),
  };

  function chatUrl() {
    return config.url.replace(/\/+$/, '') + '/popup.html';
  }

  /* --- Styles ---------------------------------------------------------------
   * Every value is a CSS custom property with a design-system fallback, so a
   * host site can re-theme the widget by setting the variables anywhere above
   * it (e.g. on :root) without editing the widget. The widget does not load
   * web fonts itself — it picks up Inter / Geist Mono when the host page
   * provides them and falls back to system fonts.
   * ------------------------------------------------------------------------ */

  var FONT_STACK = "'Inter','Helvetica Neue',Arial,system-ui,sans-serif";

  var STYLE = [
    '#apertus-chat-launcher{position:fixed;bottom:var(--apertus-launcher-offset,24px);right:var(--apertus-launcher-offset,24px);z-index:var(--apertus-z-index,2147483000);display:flex;align-items:center;justify-content:center;width:56px;height:56px;padding:0;margin:0;font:inherit;box-sizing:border-box;background-color:var(--apertus-launcher-bg,#2E2F31);color:var(--apertus-launcher-fg,#FFFFFF);border:1px solid var(--apertus-launcher-border,transparent);border-radius:9999px;box-shadow:var(--apertus-launcher-shadow,0 6px 18px rgba(46,47,49,0.24));cursor:pointer;transition:background-color 150ms cubic-bezier(0.2,0,0,1),transform 150ms cubic-bezier(0.2,0,0,1)}',
    '#apertus-chat-launcher.apertus-chat-launcher--left{right:auto;left:var(--apertus-launcher-offset,24px)}',
    '#apertus-chat-launcher:hover{background-color:var(--apertus-launcher-hover,#43464A)}',
    '#apertus-chat-launcher:active{transform:translateY(1px)}',
    '#apertus-chat-launcher:focus-visible{outline:3px solid var(--apertus-focus-ring,#FF0000);outline-offset:2px}',
    '#apertus-chat-launcher .apertus-chat-launcher-icon{display:flex}',
    '#apertus-chat-launcher .apertus-chat-launcher-icon svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
    '#apertus-chat-launcher .apertus-chat-launcher-icon--close{display:none}',
    '#apertus-chat-launcher.apertus-chat-launcher--panel[aria-expanded="true"] .apertus-chat-launcher-icon--open{display:none}',
    '#apertus-chat-launcher.apertus-chat-launcher--panel[aria-expanded="true"] .apertus-chat-launcher-icon--close{display:flex}',
    '#apertus-chat-panel{position:fixed;bottom:var(--apertus-panel-offset,96px);right:var(--apertus-launcher-offset,24px);z-index:var(--apertus-z-index,2147483000);display:flex;flex-direction:column;width:min(var(--apertus-panel-width,400px),calc(100vw - 32px));height:min(var(--apertus-panel-height,640px),calc(100vh - 136px));padding:0;margin:0;box-sizing:border-box;background-color:var(--apertus-panel-bg,#FFFFFF);border:1px solid var(--apertus-border,rgba(46,47,49,0.16));border-radius:var(--apertus-panel-radius,6px);box-shadow:var(--apertus-panel-shadow,0 8px 24px rgba(46,47,49,0.18));overflow:hidden}',
    '#apertus-chat-panel.apertus-chat-panel--left{right:auto;left:var(--apertus-launcher-offset,24px)}',
    '#apertus-chat-panel[hidden]{display:none}',
    '#apertus-chat-panel .apertus-chat-panel-header{display:flex;align-items:center;justify-content:space-between;gap:var(--space-8,8px);padding:4px 4px 4px 16px;box-sizing:border-box;background-color:var(--apertus-panel-header-bg,#EAF5F8);border-bottom:1px solid var(--apertus-border,rgba(46,47,49,0.16))}',
    '#apertus-chat-panel .apertus-chat-panel-title{margin:0;font-family:var(--apertus-font-brand,' + FONT_STACK + ');font-weight:900;font-size:13px;line-height:1.2;letter-spacing:0.28em;color:var(--apertus-panel-header-fg,#2E2F31)}',
    '#apertus-chat-panel .apertus-chat-panel-close{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;padding:0;margin:0;background:none;border:0;border-radius:4px;color:var(--apertus-panel-header-fg,#2E2F31);cursor:pointer;transition:background-color 150ms cubic-bezier(0.2,0,0,1)}',
    '#apertus-chat-panel .apertus-chat-panel-close:hover{background-color:rgba(46,47,49,0.08)}',
    '#apertus-chat-panel .apertus-chat-panel-close:focus-visible{outline:3px solid var(--apertus-focus-ring,#FF0000);outline-offset:-1px}',
    '#apertus-chat-panel .apertus-chat-panel-close svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}',
    '#apertus-chat-panel-frame{flex:1;width:100%;border:0;background-color:#FFFFFF}',
    '#apertus-chat-toast{position:fixed;bottom:var(--apertus-panel-offset,96px);right:var(--apertus-launcher-offset,24px);z-index:var(--apertus-z-index,2147483000);display:flex;align-items:flex-start;gap:4px;max-width:min(320px,calc(100vw - 32px));padding:10px 4px 10px 16px;box-sizing:border-box;background-color:var(--apertus-toast-bg,#F9DEDC);border:1px solid var(--apertus-toast-border,rgba(179,38,30,0.45));border-radius:var(--apertus-panel-radius,4px);box-shadow:var(--apertus-panel-shadow,0 8px 24px rgba(46,47,49,0.18));color:var(--apertus-toast-fg,#410E0B);font-family:var(--apertus-font-plain,' + FONT_STACK + ');font-size:14px;line-height:1.5}',
    '#apertus-chat-toast.apertus-chat-toast--left{right:auto;left:var(--apertus-launcher-offset,24px)}',
    '#apertus-chat-toast[hidden]{display:none}',
    '#apertus-chat-toast .apertus-chat-toast-text{margin:0}',
    '#apertus-chat-toast .apertus-chat-toast-text a{color:inherit;font-weight:600;text-decoration:underline;text-underline-offset:2px}',
    '#apertus-chat-toast .apertus-chat-toast-dismiss{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;padding:0;margin:0;background:none;border:0;border-radius:4px;color:inherit;cursor:pointer;flex-shrink:0}',
    '#apertus-chat-toast .apertus-chat-toast-dismiss:hover{background-color:rgba(46,47,49,0.08)}',
    '#apertus-chat-toast .apertus-chat-toast-dismiss svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}',
    '@media (max-width:480px){#apertus-chat-panel{right:8px;left:8px;bottom:88px;width:auto;height:calc(100vh - 112px)}#apertus-chat-toast{right:8px;left:8px;bottom:88px;max-width:none}}',
    '@media (prefers-reduced-motion:reduce){#apertus-chat-launcher,#apertus-chat-panel,#apertus-chat-panel .apertus-chat-panel-close{transition:none !important}}',
  ].join('\n');

  var ICON_CHAT =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.5-8.5h.5a8.48 8.48 0 0 1 8 8Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_CLOSE =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  function injectStyles() {
    var style = document.createElement('style');
    style.id = 'apertus-chat-widget-styles';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  /* --- Launcher --------------------------------------------------------------- */

  var launcher = document.createElement('button');
  launcher.id = 'apertus-chat-launcher';
  launcher.type = 'button';
  launcher.className =
    'apertus-chat-launcher--' + config.position +
    (config.mode === 'panel' ? ' apertus-chat-launcher--panel' : '');
  launcher.setAttribute('aria-haspopup', 'dialog');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.setAttribute('aria-label', config.label);
  launcher.title = config.label;
  launcher.innerHTML =
    '<span class="apertus-chat-launcher-icon apertus-chat-launcher-icon--open">' + ICON_CHAT + '</span>' +
    '<span class="apertus-chat-launcher-icon apertus-chat-launcher-icon--close">' + ICON_CLOSE + '</span>';

  /* --- Pop-up window ------------------------------------------------------------ */

  var popupWindow = null;
  var popupWatch = null;

  function focusOrOpenWindow() {
    if (popupWindow && !popupWindow.closed) {
      popupWindow.focus();
      return;
    }
    openWindow();
  }

  function openWindow() {
    var availWidth = screen.availWidth || window.innerWidth;
    var availHeight = screen.availHeight || window.innerHeight;
    var width = clamp(Math.round(config.width), 300, availWidth);
    var height = clamp(Math.round(config.height), 360, availHeight);
    var left = Math.max(0, Math.round((availWidth - width) / 2));
    var top = Math.max(0, Math.round((availHeight - height) / 2));
    var features =
      'popup=yes,width=' + width + ',height=' + height + ',left=' + left + ',top=' + top;

    var win = null;
    try {
      win = window.open(chatUrl(), WINDOW_NAME, features);
    } catch (error) {
      win = null;
    }

    if (!win) {
      // The browser blocked the pop-up — surface a fallback instead of failing
      // silently. The link opens on the user's own click, which is allowed.
      showToast();
      return;
    }

    popupWindow = win;
    win.focus();
    launcher.setAttribute('aria-expanded', 'true');
    watchPopupWindow();
  }

  function watchPopupWindow() {
    if (popupWatch) clearInterval(popupWatch);
    popupWatch = setInterval(function () {
      if (popupWindow && !popupWindow.closed) return;
      clearInterval(popupWatch);
      popupWatch = null;
      popupWindow = null;
      launcher.setAttribute('aria-expanded', 'false');
    }, 500);
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  /* --- In-page panel (iframe) ------------------------------------------------------ */

  var panel = null;

  function buildPanel() {
    var root = document.createElement('div');
    root.id = 'apertus-chat-panel';
    root.className = 'apertus-chat-panel--' + config.position;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'false');
    root.setAttribute('aria-label', config.label);
    root.hidden = true;

    var header = document.createElement('div');
    header.className = 'apertus-chat-panel-header';

    var title = document.createElement('p');
    title.className = 'apertus-chat-panel-title';
    title.textContent = 'APERTUS';

    var closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'apertus-chat-panel-close';
    closeButton.setAttribute('aria-label', 'Close chat');
    closeButton.innerHTML = ICON_CLOSE;

    header.append(title, closeButton);

    var frame = document.createElement('iframe');
    frame.id = 'apertus-chat-panel-frame';
    frame.title = config.label;

    root.append(header, frame);

    closeButton.addEventListener('click', close);
    root.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') close();
    });

    document.body.appendChild(root);
    return { root: root, frame: frame };
  }

  function openPanel() {
    if (!panel) {
      // The chat is loaded lazily on first open, and the iframe is kept
      // across close/open so the conversation survives.
      panel = buildPanel();
      panel.frame.src = chatUrl();
    }
    panel.root.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    panel.frame.focus();
  }

  function closePanel() {
    if (!panel) return;
    panel.root.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
  }

  /* --- Blocked pop-up notice ------------------------------------------------------- */

  var toast = null;
  var toastTimer = null;

  function showToast() {
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'apertus-chat-toast';
      toast.className = 'apertus-chat-toast--' + config.position;
      toast.setAttribute('role', 'status');

      var text = document.createElement('p');
      text.className = 'apertus-chat-toast-text';
      text.append('Pop-ups are blocked. Allow them for this site, or ');

      var link = document.createElement('a');
      link.href = chatUrl();
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'open the chat in a new tab';

      text.append(link, '.');

      var dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'apertus-chat-toast-dismiss';
      dismiss.setAttribute('aria-label', 'Dismiss notification');
      dismiss.innerHTML = ICON_CLOSE;
      dismiss.addEventListener('click', hideToast);

      toast.append(text, dismiss);
      document.body.appendChild(toast);
    }

    toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 12000);
  }

  function hideToast() {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (toast) toast.hidden = true;
  }

  /* --- Public API ------------------------------------------------------------------- */

  function open() {
    if (config.mode === 'panel') {
      openPanel();
    } else {
      focusOrOpenWindow();
    }
  }

  function close() {
    if (config.mode === 'panel') {
      closePanel();
    } else if (popupWindow && !popupWindow.closed) {
      popupWindow.close();
    }
  }

  function toggle() {
    if (config.mode === 'panel' && panel && !panel.root.hidden) {
      closePanel();
    } else if (config.mode !== 'panel' && popupWindow && !popupWindow.closed) {
      popupWindow.focus();
    } else {
      open();
    }
  }

  window.ApertusChat = { open: open, close: close, toggle: toggle };

  launcher.addEventListener('click', toggle);

  /* --- Mount -------------------------------------------------------------------------- */

  function mount() {
    injectStyles();
    document.body.appendChild(launcher);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
