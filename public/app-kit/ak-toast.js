/*
 * AppKit.toast: a short message at the bottom of the screen.
 *
 *   AppKit.toast('Saved');
 *   AppKit.toast('Could not save', { kind: 'error' });
 *   AppKit.toast('Copied', { ms: 1500 });
 *
 * opts.kind is 'info' (default), 'error' (or 'danger'), 'success' or 'warning'.
 * Errors get role="alert", the rest role="status". opts.ms is how long it
 * stays: 5000 for an error, 2800 otherwise. After that the toast pops out
 * (.ak-pop-out, 140ms) and is removed when that ends. With AppKit.pop (ak-dom.js)
 * loaded it uses AppKit.pop.out, without it the toast does the same itself.
 * It pops in by itself, from the CSS.
 *
 * Toasts go into #ak-toasts. It is created on <body> if missing. When there is
 * no document or body yet, the call does nothing and returns null.
 *
 * Needs ak-components.css. Plain ES5. The only global it adds is window.AppKit.
 */
(function () {
  'use strict';

  var AppKit = window.AppKit = window.AppKit || {};
  if (AppKit.toast) {
    return;
  }

  var POP_MS = 140;

  function container() {
    var box = document.getElementById('ak-toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'ak-toasts';
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    return box;
  }

  function toast(message, opts) {
    if (typeof document === 'undefined' || !document.body) {
      return null;
    }
    var o = opts || {};
    var kind = o.kind || 'info';
    var isError = kind === 'error' || kind === 'danger';
    var el = document.createElement('div');
    el.className = 'ak-toast ak-toast-' + kind;
    el.setAttribute('role', isError ? 'alert' : 'status');
    el.appendChild(document.createTextNode(String(message)));
    container().appendChild(el);
    var ms = typeof o.ms === 'number' ? o.ms : (isError ? 5000 : 2800);
    setTimeout(function () {
      dismiss(el);
    }, ms);
    return el;
  }

  // Plays the pop-out, then removes the toast. The stay time does not include it.
  function dismiss(el) {
    if (AppKit.pop && typeof AppKit.pop.out === 'function') {
      AppKit.pop.out(el);
      return;
    }
    var done = false;
    function finish() {
      if (done) {
        return;
      }
      done = true;
      el.removeEventListener('animationend', onEnd);
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }
    function onEnd(event) {
      if (!event || !event.target || event.target === el) {
        finish();
      }
    }
    el.className = el.className + ' ak-pop-out';
    el.addEventListener('animationend', onEnd);
    setTimeout(finish, POP_MS);
  }

  AppKit.toast = toast;
})();
