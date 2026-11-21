/*
 * AppKit.h, AppKit.copyText and AppKit.pop: small DOM helpers.
 *
 *   AppKit.h('div', { class: 'x', onclick: fn }, child, 'text')
 *     Builds an element. Text is always a text node, never parsed as HTML.
 *     attrs: class sets className. on* adds a listener (onclick is "click").
 *     value, checked, disabled and textContent are set as properties.
 *     true gives an empty attribute. false, null and undefined are skipped.
 *     Children: null, undefined and false are skipped, arrays are flattened,
 *     nodes are appended as they are, anything else becomes text.
 *
 *   AppKit.copyText(text)
 *     Tries navigator.clipboard.writeText. If that is missing or rejects, it
 *     falls back to a hidden textarea and document.execCommand('copy').
 *     Returns a Promise of true or false when Promise exists. In a browser
 *     with no Promise it returns the fallback result as a plain boolean.
 *     It never throws.
 *
 *   AppKit.pop.in(el) / AppKit.pop.out(el)
 *     A short pop for a popup (a menu, a toast, your own). Needs
 *     ak-components.css and its .ak-pop classes.
 *     in: removes hidden, adds .ak-pop. If it is already on, the pop plays again.
 *     out: adds .ak-pop-out, waits for animationend on the element itself (not
 *     one that bubbles from a child), or 140ms (--ak-pop-duration) if none comes.
 *     Then an element that has hidden, or is an .ak-card-menu, gets hidden and
 *     loses the out class and stays in the DOM. Any other element is removed.
 *     Returns a Promise that resolves after that, or undefined without Promise.
 *     With reduced motion the CSS only fades, it does not scale. The helper
 *     still waits for the fade. in(null) and out(null) do nothing. Never throws.
 *
 * Plain ES5. The only global it adds is window.AppKit.
 */
(function () {
  'use strict';

  var AppKit = window.AppKit = window.AppKit || {};
  if (AppKit.h) {
    return;
  }

  function isNode(value) {
    return !!value && typeof value === 'object' && typeof value.nodeType === 'number';
  }

  function addChildren(el, children) {
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (Array.isArray(child)) {
        addChildren(el, child);
      } else if (child === null || child === undefined || child === false) {
        continue;
      } else if (isNode(child)) {
        el.appendChild(child);
      } else {
        el.appendChild(document.createTextNode(String(child)));
      }
    }
  }

  function h(tag, attrs) {
    var el = document.createElement(tag);
    var map = attrs || {};
    var keys = Object.keys(map);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var value = map[key];
      if (value === false || value === null || value === undefined) {
        continue;
      }
      if (key === 'class') {
        el.className = value;
      } else if (key.indexOf('on') === 0 && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'textContent') {
        el[key] = value;
      } else {
        el.setAttribute(key, value === true ? '' : String(value));
      }
    }
    addChildren(el, Array.prototype.slice.call(arguments, 2));
    return el;
  }

  // The old way: select a hidden textarea and ask the document to copy it.
  function copyWithTextarea(text) {
    var done = false;
    var area = null;
    try {
      area = document.createElement('textarea');
      area.setAttribute('aria-hidden', 'true');
      area.setAttribute('readonly', '');
      area.value = text;
      if (area.style) {
        area.style.position = 'fixed';
        area.style.opacity = '0';
      }
      document.body.appendChild(area);
      if (area.select) {
        area.select();
      }
      done = !!document.execCommand('copy');
    } catch (e) {
      done = false;
    }
    try {
      if (area && area.parentNode) {
        area.parentNode.removeChild(area);
      }
    } catch (e2) {
      // Nothing to clean up.
    }
    return done;
  }

  function copyText(text) {
    var value = String(text);
    var hasPromise = typeof Promise === 'function';
    var clip = typeof navigator !== 'undefined' && navigator && navigator.clipboard;
    if (clip && typeof clip.writeText === 'function' && hasPromise) {
      try {
        return Promise.resolve(clip.writeText(value)).then(
          function () { return true; },
          function () { return copyWithTextarea(value); }
        );
      } catch (e) {
        // Fall through to the textarea.
      }
    }
    var ok = copyWithTextarea(value);
    return hasPromise ? Promise.resolve(ok) : ok;
  }

  AppKit.h = h;
  AppKit.copyText = copyText;

  // ---------- AppKit.pop ----------

  var POP_MS = 140;

  function hasClass(el, name) {
    return (' ' + (el.className || '') + ' ').indexOf(' ' + name + ' ') >= 0;
  }

  function addClass(el, name) {
    if (!hasClass(el, name)) {
      el.className = el.className ? el.className + ' ' + name : name;
    }
  }

  function removeClass(el, name) {
    el.className = (' ' + (el.className || '') + ' ').replace(' ' + name + ' ', ' ').replace(/^\s+|\s+$/g, '');
  }

  // Remove the class, read layout, add the class: the animation plays again.
  function replay(el, name) {
    if (hasClass(el, name)) {
      removeClass(el, name);
      void el.offsetWidth;
    }
    addClass(el, name);
  }

  function popIn(el) {
    if (!el) {
      return;
    }
    try {
      if (el.removeAttribute) {
        el.removeAttribute('hidden');
      }
      removeClass(el, 'ak-pop-out');
      replay(el, 'ak-pop');
    } catch (e) {
      // A popup that cannot animate still shows.
    }
  }

  function popOut(el) {
    var hasPromise = typeof Promise === 'function';
    function run(done) {
      if (!el) {
        done();
        return;
      }
      var finished = false;
      function finish() {
        if (finished) {
          return;
        }
        finished = true;
        try {
          el.removeEventListener('animationend', onEnd);
          if (el.hasAttribute('hidden') || hasClass(el, 'ak-card-menu')) {
            el.setAttribute('hidden', '');
            removeClass(el, 'ak-pop-out');
          } else if (el.parentNode) {
            el.parentNode.removeChild(el);
          }
        } catch (e) {
          // Nothing left to clean up.
        }
        done();
      }
      // An animationend that bubbles up from a child is not ours.
      function onEnd(event) {
        if (!event || !event.target || event.target === el) {
          finish();
        }
      }
      try {
        addClass(el, 'ak-pop');
        replay(el, 'ak-pop-out');
        el.addEventListener('animationend', onEnd);
      } catch (e) {
        // The timeout below still finishes the job.
      }
      setTimeout(finish, POP_MS);
    }
    if (hasPromise) {
      return new Promise(function (resolve) { run(resolve); });
    }
    run(function () {});
    return undefined;
  }

  AppKit.pop = { 'in': popIn, out: popOut };
})();
