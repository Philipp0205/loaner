/*
 * AppKit.chat: a small chat pane. Plain text bubbles, a composer, a send queue
 * and a poller. The app owns the routes, the login and who may read a chat.
 *
 *   var chat = AppKit.chat.mount(el, {
 *     meId: user.id,
 *     load: function () { return fetch('/api/groups/1/chat').then(function (r) { return r.json(); }); },
 *     send: function (text) { return post('/api/groups/1/chat', { text: text }); },
 *     markRead: function () { return post('/api/groups/1/chat/read'); }
 *   });
 *   chat.destroy();
 *
 * mount(el, opts) builds .ak-chat inside el and returns
 * { refresh, setMessages, send, destroy }. The parent gives it a height.
 *
 *   meId        string, required. Messages with this userId are "me".
 *   load()      required. A Promise of { messages: [...] } or of an array. A
 *               message is { id, userId, userName, body, createdAt }, oldest first.
 *   send(text)  required. A Promise of the saved message. A rejection marks the
 *               bubble as failed and a tap on it tries again.
 *   markRead()  optional. Called after a load that brought new messages from
 *               others, and only while the page is visible. If the page is
 *               hidden, it waits for the next load once the page is visible.
 *   pollMs      default 3000. poll: false turns polling off.
 *   maxLength   default 1000 (code points). Over that, Send is disabled.
 *   placeholder default 'Message'.
 *   labels      { send, sending, failed, empty }.
 *   formatTime(ms)  default HH:MM in the phone's locale.
 *
 * Text always goes in with textContent, never as HTML. Enter sends and
 * Shift+Enter breaks the line. Sends go out one at a time, in order.
 * A list at the bottom stays there when the pane gets shorter (keyboard).
 *
 * AppKit.chat.poll(fn, { ms }) returns { start, stop, running }. It calls fn
 * every ms, never twice at once (it waits for a returned Promise), pauses while
 * the page is hidden and runs fn at once when it is visible again.
 *
 * Needs ak-chat.css. Plain ES5. The only global it adds is window.AppKit.
 */
(function () {
  'use strict';

  var AppKit = window.AppKit = window.AppKit || {};
  if (AppKit.chat) {
    return;
  }

  var DEFAULT_POLL_MS = 3000;
  var DEFAULT_MAX = 1000;
  var NEAR_BOTTOM_PX = 80;
  var INPUT_MAX_PX = 132;
  var DEFAULT_LABELS = { send: 'Send', sending: 'Sending\u2026', failed: 'Not sent. Tap to retry.', empty: 'No messages yet.' };

  function isHidden() {
    return !!document.hidden;
  }

  function codePoints(text) {
    return text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '_').length;
  }

  function defaultTime(ms) {
    try {
      return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text) {
      node.textContent = text;
    }
    return node;
  }

  // ---------- poll ----------

  function poll(fn, opts) {
    var ms = opts && typeof opts.ms === 'number' && opts.ms > 0 ? opts.ms : DEFAULT_POLL_MS;
    var on = false;
    var busy = false;
    var generation = 0;

    function arm() {
      var mine = generation;
      setTimeout(function () {
        if (on && mine === generation && !isHidden()) {
          run();
        }
      }, ms);
    }

    function run() {
      if (busy) {
        return;
      }
      busy = true;
      var result;
      try {
        result = fn();
      } catch (e) {
        result = null;
      }
      var done = function () {
        busy = false;
        if (on && !isHidden()) {
          arm();
        }
      };
      Promise.resolve(result).then(done, done);
    }

    function onVisibility() {
      if (!on) {
        return;
      }
      generation += 1;
      if (!isHidden()) {
        run();
      }
    }

    return {
      start: function () {
        if (on) {
          return;
        }
        on = true;
        document.addEventListener('visibilitychange', onVisibility);
        if (!isHidden() && !busy) {
          arm();
        }
      },
      stop: function () {
        if (!on) {
          return;
        }
        on = false;
        generation += 1;
        document.removeEventListener('visibilitychange', onVisibility);
      },
      running: function () {
        return on;
      }
    };
  }

  // ---------- mount ----------

  function mount(host, opts) {
    if (!host || typeof host.appendChild !== 'function') {
      throw new TypeError('AppKit.chat.mount: an element is required');
    }
    if (!opts || typeof opts.meId !== 'string' || opts.meId === '') {
      throw new TypeError('AppKit.chat.mount: meId is required');
    }
    if (typeof opts.load !== 'function') {
      throw new TypeError('AppKit.chat.mount: load is required');
    }
    if (typeof opts.send !== 'function') {
      throw new TypeError('AppKit.chat.mount: send is required');
    }

    var meId = opts.meId;
    var maxLength = typeof opts.maxLength === 'number' && opts.maxLength > 0 ? opts.maxLength : DEFAULT_MAX;
    var formatTime = typeof opts.formatTime === 'function' ? opts.formatTime : defaultTime;
    var labels = {};
    var key;
    for (key in DEFAULT_LABELS) {
      labels[key] = opts.labels && typeof opts.labels[key] === 'string' ? opts.labels[key] : DEFAULT_LABELS[key];
    }
    var placeholder = typeof opts.placeholder === 'string' ? opts.placeholder : 'Message';

    var server = [];     // what load() last returned
    var confirmed = [];  // saved by send(), not in the polled data yet
    var local = [];      // pending and failed messages of this device
    var serverIds = {};
    var needsRead = false;
    var firstLoad = true;
    var loadId = 0;
    var localSeq = 0;
    var chain = Promise.resolve();
    var lastSignature = null;
    var destroyed = false;

    // DOM
    var root = element('div', 'ak-chat');
    var list = element('div', 'ak-chat-list');
    list.setAttribute('role', 'log');
    list.setAttribute('aria-live', 'polite');
    var form = element('form', 'ak-chat-composer');
    var input = element('textarea', 'ak-chat-input');
    input.setAttribute('rows', '1');
    input.setAttribute('placeholder', placeholder);
    input.setAttribute('aria-label', placeholder);
    var sendButton = element('button', 'ak-chat-send', labels.send);
    sendButton.setAttribute('type', 'submit');
    sendButton.disabled = true;
    form.appendChild(input);
    form.appendChild(sendButton);
    root.appendChild(list);
    root.appendChild(form);
    host.appendChild(root);

    function nearBottom() {
      return list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM_PX;
    }

    // When the keyboard opens the pane gets shorter. Keep the newest message in
    // view if the list was at the bottom before.
    var pinned = true;
    function onScroll() {
      pinned = nearBottom();
    }
    function onResize() {
      if (pinned) {
        list.scrollTop = list.scrollHeight;
      }
    }
    var viewport = window.visualViewport;
    list.addEventListener('scroll', onScroll);
    window.addEventListener('resize', onResize);
    if (viewport && viewport.addEventListener) {
      viewport.addEventListener('resize', onResize);
    }

    function items() {
      return server.concat(confirmed, local);
    }

    function signature(all) {
      var parts = [];
      for (var i = 0; i < all.length; i++) {
        parts.push(all[i].id + (all[i].state ? ':' + all[i].state : ''));
      }
      return parts.join('|');
    }

    function bubble(message, first) {
      var mine = message.userId === meId;
      var state = message.state || '';
      var cls = 'ak-chat-msg ' + (mine ? 'is-me' : 'is-them');
      if (state) {
        cls += ' is-' + state;
      }
      var node = element('div', cls);
      if (!mine && first && message.userName) {
        node.appendChild(element('div', 'ak-chat-name', String(message.userName)));
      }
      node.appendChild(element('div', 'ak-chat-body', String(message.body)));
      if (state === 'pending') {
        node.appendChild(element('div', 'ak-chat-note', labels.sending));
      } else if (state === 'failed') {
        node.appendChild(element('div', 'ak-chat-note', labels.failed));
        node.setAttribute('role', 'button');
        node.setAttribute('tabindex', '0');
        node.addEventListener('click', function () {
          retry(message);
        });
        node.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
            if (event.preventDefault) {
              event.preventDefault();
            }
            retry(message);
          }
        });
      } else {
        var time = typeof message.createdAt === 'number' ? formatTime(message.createdAt) : '';
        if (time) {
          node.appendChild(element('div', 'ak-chat-time', time));
        }
      }
      return node;
    }

    function render(stick) {
      if (destroyed) {
        return;
      }
      var all = items();
      var sig = signature(all);
      if (sig === lastSignature && !stick) {
        return;
      }
      lastSignature = sig;
      var wasNear = nearBottom();
      var top = list.scrollTop;
      list.textContent = '';
      if (all.length === 0) {
        list.appendChild(element('div', 'ak-chat-empty', labels.empty));
      }
      var previous = null;
      for (var i = 0; i < all.length; i++) {
        var message = all[i];
        var first = !previous || previous.userId !== message.userId;
        list.appendChild(bubble(message, first));
        previous = message;
      }
      list.scrollTop = stick || wasNear ? list.scrollHeight : top;
      pinned = nearBottom();
    }

    // ---------- loading ----------

    function messagesOf(result) {
      var found = Array.isArray(result) ? result : (result && result.messages);
      if (!Array.isArray(found)) {
        return null;
      }
      var out = [];
      for (var i = 0; i < found.length; i++) {
        if (found[i] && typeof found[i].id === 'string') {
          out.push(found[i]);
        }
      }
      return out;
    }

    function setMessages(next) {
      var fresh = Array.isArray(next) ? next : [];
      var ids = {};
      var arrived = false;
      for (var i = 0; i < fresh.length; i++) {
        ids[fresh[i].id] = true;
        if (fresh[i].userId !== meId && !serverIds[fresh[i].id]) {
          arrived = true;
        }
      }
      server = fresh;
      serverIds = ids;
      var rest = [];
      for (var j = 0; j < confirmed.length; j++) {
        if (!ids[confirmed[j].id]) {
          rest.push(confirmed[j]);
        }
      }
      confirmed = rest;
      render(firstLoad);
      firstLoad = false;
      if (arrived) {
        needsRead = true;
      }
      if (needsRead && !isHidden() && typeof opts.markRead === 'function') {
        needsRead = false;
        try {
          Promise.resolve(opts.markRead()).then(null, function () {});
        } catch (e) {
          // markRead is the app's; a throw there must not stop the chat.
        }
      }
    }

    function refresh() {
      if (destroyed) {
        return Promise.resolve();
      }
      loadId += 1;
      var mine = loadId;
      var result;
      try {
        result = opts.load();
      } catch (e) {
        return Promise.resolve();
      }
      return Promise.resolve(result).then(function (value) {
        var found = messagesOf(value);
        if (!destroyed && mine === loadId && found) {
          setMessages(found);
        }
      }, function () {
        // The app's load shows its own errors. The poller tries again.
      });
    }

    // ---------- sending ----------

    function run(entry) {
      if (destroyed || local.indexOf(entry) < 0) {
        return undefined;
      }
      var result;
      try {
        result = opts.send(entry.body);
      } catch (e) {
        result = Promise.reject(e);
      }
      return Promise.resolve(result).then(function (saved) {
        if (destroyed) {
          return;
        }
        local.splice(local.indexOf(entry), 1);
        if (saved && typeof saved.id === 'string' && !serverIds[saved.id]) {
          var known = false;
          for (var i = 0; i < confirmed.length; i++) {
            known = known || confirmed[i].id === saved.id;
          }
          if (!known) {
            confirmed.push(saved);
          }
        }
        render(false);
      }, function () {
        if (destroyed) {
          return;
        }
        entry.state = 'failed';
        render(false);
      });
    }

    function enqueue(entry) {
      chain = chain.then(function () {
        return run(entry);
      });
      return chain;
    }

    function retry(entry) {
      if (destroyed || entry.state !== 'failed') {
        return;
      }
      entry.state = 'pending';
      render(false);
      enqueue(entry);
    }

    function sendText(raw) {
      var text = typeof raw === 'string' ? raw.replace(/^\s+|\s+$/g, '') : '';
      if (destroyed || text === '' || codePoints(text) > maxLength) {
        return Promise.resolve();
      }
      localSeq += 1;
      var entry = {
        id: 'local-' + localSeq,
        state: 'pending',
        userId: meId,
        userName: '',
        body: text,
        createdAt: Date.now()
      };
      local.push(entry);
      render(true);
      return enqueue(entry);
    }

    // ---------- composer ----------

    function fit() {
      input.style.height = 'auto';
      var height = input.scrollHeight;
      if (height) {
        input.style.height = Math.min(height, INPUT_MAX_PX) + 'px';
      }
    }

    function canSend() {
      var text = String(input.value || '').replace(/^\s+|\s+$/g, '');
      return text !== '' && codePoints(text) <= maxLength;
    }

    function syncButton() {
      sendButton.disabled = !canSend();
    }

    function submit() {
      if (!canSend()) {
        return;
      }
      var text = input.value;
      input.value = '';
      fit();
      syncButton();
      sendText(text);
    }

    function onInput() {
      fit();
      syncButton();
    }

    function onKeydown(event) {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
        if (event.preventDefault) {
          event.preventDefault();
        }
        submit();
      }
    }

    function onSubmit(event) {
      if (event && event.preventDefault) {
        event.preventDefault();
      }
      submit();
    }

    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKeydown);
    form.addEventListener('submit', onSubmit);

    render(false);

    var poller = null;
    if (opts.poll !== false) {
      poller = poll(refresh, { ms: typeof opts.pollMs === 'number' ? opts.pollMs : DEFAULT_POLL_MS });
    }
    var first = refresh();
    if (poller) {
      first.then(function () {
        if (!destroyed) {
          poller.start();
        }
      });
    }

    return {
      refresh: refresh,
      setMessages: function (next) {
        if (destroyed) {
          return;
        }
        loadId += 1;
        setMessages(messagesOf(next) || []);
      },
      send: sendText,
      destroy: function () {
        if (destroyed) {
          return;
        }
        destroyed = true;
        if (poller) {
          poller.stop();
        }
        list.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onResize);
        if (viewport && viewport.removeEventListener) {
          viewport.removeEventListener('resize', onResize);
        }
        input.removeEventListener('input', onInput);
        input.removeEventListener('keydown', onKeydown);
        form.removeEventListener('submit', onSubmit);
        if (root.parentNode) {
          root.parentNode.removeChild(root);
        }
      }
    };
  }

  AppKit.chat = { mount: mount, poll: poll };
})();
