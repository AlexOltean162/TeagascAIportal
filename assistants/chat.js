// The chat panel every assistant uses. One instance per assistant, kept alive while the tab is open.
//
//   new AssistantChat(assistant, { transcribeUrl, popover }) -> .el
//
// assistant comes from config.js; its `adapter` names an entry in adapters.js.
(function () {
  var T = window.AnswerText;
  var ICON = {
    mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></g></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M12 19V5M6 11l6-6 6 6"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 5v14M5 12h14"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/></g></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.2 4.2L19 7"/></svg>',
    up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M7 11v9H4.5A1.5 1.5 0 0 1 3 18.5v-6A1.5 1.5 0 0 1 4.5 11H7zm0 0l4-7a2 2 0 0 1 3.7 1.3L14 10h5a2 2 0 0 1 2 2.3l-1.2 6.5A2 2 0 0 1 17.8 20H7"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M17 13V4h2.5A1.5 1.5 0 0 1 21 5.5v6a1.5 1.5 0 0 1-1.5 1.5H17zm0 0l-4 7a2 2 0 0 1-3.7-1.3L10 14H5a2 2 0 0 1-2-2.3l1.2-6.5A2 2 0 0 1 6.2 4H17"/></svg>'
  };

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  // A random id per chat (new on "New chat"): lets the analytics log group a conversation's turns
  // without identifying anyone.
  function newConversationId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Array.from({ length: 4 }, function () { return Math.random().toString(16).slice(2, 10); }).join("-");
  }

  function AssistantChat(a, opts) {
    this.a = a;
    this.conversationId = newConversationId();
    this.adapter = window.AssistantAdapters[a.adapter];
    this.base = a.url;
    this.opts = opts;
    this.history = [];
    this.filters = {};
    this.busy = false;
    this.controller = null;
    this.build();
    this.loadFilters();
  }

  AssistantChat.prototype.build = function () {
    var self = this;
    var root = this.el = el("section", "chat is-empty");

    var top = el("div", "chat-top");
    this.newButton = el("button", "chat-new", ICON.plus + "<span>New chat</span>");
    this.newButton.type = "button";
    this.newButton.addEventListener("click", function () { self.reset(); });
    top.appendChild(this.newButton);

    this.scroller = el("div", "chat-scroll");
    var welcome = el("div", "chat-welcome");
    welcome.appendChild(window.AssistantCharacter.create(this.a.look, { animated: true }));
    var title = el("h1");
    title.textContent = this.a.name;
    var summary = el("p");
    summary.textContent = this.a.summary;
    welcome.append(title, summary);
    this.thread = el("div", "chat-thread");
    this.thread.setAttribute("aria-live", "polite");
    this.scroller.append(welcome, this.thread);

    var form = this.form = el("form", "composer");
    var box = el("div", "composer-box");
    var input = this.input = el("textarea");
    input.rows = 1;
    input.maxLength = 2000;
    input.placeholder = "Ask the " + this.a.name + "…";
    input.setAttribute("aria-label", "Your question");
    this.mic = el("button", "composer-icon mic", ICON.mic + '<span class="rec-time"></span>');
    this.mic.type = "button";
    this.mic.setAttribute("aria-label", "Speak your question");
    this.sendButton = el("button", "composer-send", ICON.send);
    this.sendButton.type = "submit";
    this.sendButton.setAttribute("aria-label", "Ask");
    box.append(input, this.mic, this.sendButton);
    this.filterRow = el("div", "composer-filters");
    form.append(box, this.filterRow);

    var note = el("p", "chat-note");
    note.textContent = "Answers can be wrong. Check the sources.";

    root.append(top, this.scroller, form, note);

    input.addEventListener("input", function () { self.grow(); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (self.busy) { self.stop(); return; }
      var q = input.value.trim();
      if (q) self.ask(q);
    });

    this.setupMic();
    this.opts.popover.watch(this.thread);
  };

  AssistantChat.prototype.grow = function () {
    this.input.style.height = "auto";
    this.input.style.height = Math.min(this.input.scrollHeight, 180) + "px";
  };

  AssistantChat.prototype.focus = function () { this.input.focus(); };

  AssistantChat.prototype.loadFilters = function () {
    var self = this;
    if (this.a.filters === false) return;
    this.adapter.filters(this.base).then(function (list) {
      // A filter with a single option (e.g. one folder of documents) has nothing to narrow down.
      list.filter(function (f) { return f.options.length > 1; }).forEach(function (f) {
        var select = el("select");
        select.setAttribute("aria-label", f.label);
        select.add(new Option(f.label, ""));
        f.options.forEach(function (o) { select.add(new Option(o.label, o.value)); });
        select.addEventListener("change", function () {
          self.filters[f.key] = select.value;
          select.classList.toggle("is-set", !!select.value);
        });
        self.filterRow.appendChild(select);
      });
    }).catch(function () { /* filters are optional */ });
  };

  AssistantChat.prototype.setBusy = function (busy) {
    this.busy = busy;
    this.sendButton.innerHTML = busy ? ICON.stop : ICON.send;
    this.sendButton.setAttribute("aria-label", busy ? "Stop" : "Ask");
    this.sendButton.classList.toggle("is-stop", busy);
  };

  AssistantChat.prototype.stop = function () {
    if (this.controller) this.controller.abort();
  };

  AssistantChat.prototype.reset = function () {
    this.stop();
    this.history = [];
    this.conversationId = newConversationId();
    this.thread.innerHTML = "";
    this.el.classList.add("is-empty");
    this.input.value = "";
    this.grow();
    this.input.focus();
  };

  AssistantChat.prototype.scrollToEnd = function () {
    this.scroller.scrollTop = this.scroller.scrollHeight;
  };

  AssistantChat.prototype.ask = async function (question) {
    var self = this, adapter = this.adapter;
    this.el.classList.remove("is-empty");
    this.input.value = "";
    this.grow();

    var user = el("div", "msg user");
    user.appendChild(el("p")).textContent = question;
    var msg = el("div", "msg assistant is-working");
    var status = el("p", "msg-status", '<span class="dot"></span><span class="label">Thinking</span>');
    var panels = el("div", "msg-panels");
    var answer = el("div", "msg-answer");
    msg.append(status, panels, answer);
    this.thread.append(user, msg);
    this.scrollToEnd();

    var text = "", sources = [], frame = 0, finished = false, interactionId = null;
    var draw = function () {
      frame = 0;
      msg._sources = sources;
      answer.innerHTML = T.render(adapter.cite(text, sources), sources);
    };
    var schedule = function () { if (!frame) frame = requestAnimationFrame(draw); };

    this.setBusy(true);
    this.controller = new AbortController();
    try {
      await adapter.ask(this.base, {
        question: question,
        history: this.history,
        filters: this.filters,
        assistant: this.a,
        conversationId: this.conversationId,
        signal: this.controller.signal
      }, {
        status: function (label) { if (label) status.querySelector(".label").textContent = label; },
        token: function (t) { text += t; msg.classList.add("is-writing"); schedule(); },
        reset: function () { text = ""; answer.innerHTML = ""; },
        sources: function (list) { sources = list; },
        data: function (html) { if (panels.children.length < 3) panels.insertAdjacentHTML("beforeend", html); },
        done: function (final, meta) { finished = true; if (final) text = final; interactionId = meta && meta.interactionId; }
      });
      cancelAnimationFrame(frame);
      draw();
      this.finish(msg, question, adapter.cite(text, sources), sources, interactionId);
      this.history.push({ role: "user", content: question }, { role: "assistant", content: text });
    } catch (err) {
      cancelAnimationFrame(frame);
      if (text) draw();
      var stopped = err.name === "AbortError";
      var note = el("p", "msg-error");
      note.textContent = stopped ? "Stopped." : (err.message || "Something went wrong.") + " Try again.";
      msg.appendChild(note);
    } finally {
      msg.classList.remove("is-working", "is-writing");
      status.remove();
      this.controller = null;
      this.setBusy(false);
      if (!finished) this.input.value = this.input.value || question;
      this.scrollToEnd();
    }
  };

  // Sources the answer cites, then copy and feedback.
  AssistantChat.prototype.finish = function (msg, question, cited, sources, interactionId) {
    var self = this;
    var used = [];
    var re = /\[(\d{1,3})\]/g, m;
    while ((m = re.exec(cited))) { var n = +m[1]; if (sources[n - 1] && used.indexOf(n) === -1) used.push(n); }
    used.sort(function (x, y) { return x - y; });

    if (used.length) {
      var list = el("div", "msg-sources");
      used.forEach(function (n) {
        var s = sources[n - 1];
        var chip = el("a", "source");
        chip.dataset.n = n;
        chip.href = T.safeUrl(s.url);
        chip.target = "_blank";
        chip.rel = "noopener";
        chip.innerHTML = '<span class="n">' + n + '</span><span class="t"></span>' + (s.flag ? '<span class="flag ' + s.flag.kind + '"></span>' : "");
        chip.querySelector(".t").textContent = s.title;
        if (s.flag) chip.querySelector(".flag").textContent = s.flag.label;
        list.appendChild(chip);
      });
      msg.appendChild(list);
    }

    var actions = el("div", "msg-actions");
    var copy = el("button", "msg-action", ICON.copy);
    copy.type = "button";
    copy.setAttribute("aria-label", "Copy answer");
    copy.addEventListener("click", function () {
      navigator.clipboard.writeText(T.plain(cited)).then(function () {
        copy.innerHTML = ICON.check;
        setTimeout(function () { copy.innerHTML = ICON.copy; }, 1500);
      });
    });
    actions.appendChild(copy);

    ["up", "down"].forEach(function (rating) {
      var b = el("button", "msg-action", ICON[rating]);
      b.type = "button";
      b.setAttribute("aria-label", rating === "up" ? "Good answer" : "Bad answer");
      b.addEventListener("click", function () {
        actions.querySelectorAll(".msg-action.is-chosen").forEach(function (x) { x.classList.remove("is-chosen"); });
        b.classList.add("is-chosen");
        self.adapter.feedback(self.base, { rating: rating, question: question, answer: cited, interactionId: interactionId,
                                           conversationId: self.conversationId }).catch(function () {});
      });
      actions.appendChild(b);
    });
    msg.appendChild(actions);
  };

  // Voice: record in the browser, transcribe on the server, put the text in the box to check.
  AssistantChat.prototype.setupMic = function () {
    var self = this, mic = this.mic, url = this.opts.transcribeUrl;
    if (!url || !navigator.mediaDevices || !window.MediaRecorder) { mic.hidden = true; return; }
    var recorder = null, chunks = [], timer = null;
    var time = mic.querySelector(".rec-time");

    mic.addEventListener("click", async function () {
      if (mic.classList.contains("is-busy")) return;
      if (recorder && recorder.state === "recording") { recorder.stop(); return; }
      try {
        var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recorder = new MediaRecorder(stream);
        chunks = [];
        recorder.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
        recorder.onstop = function () {
          stream.getTracks().forEach(function (t) { t.stop(); });
          clearInterval(timer);
          time.textContent = "";
          mic.classList.remove("is-recording");
          mic.setAttribute("aria-label", "Speak your question");
          send(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
        };
        recorder.start();
        mic.classList.add("is-recording");
        mic.setAttribute("aria-label", "Stop recording");
        var started = Date.now();
        timer = setInterval(function () {
          var s = Math.floor((Date.now() - started) / 1000);
          time.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
          if (s >= 120) recorder.stop();
        }, 250);
      } catch (e) {
        self.input.placeholder = "Microphone blocked. Allow it in your browser to speak.";
      }
    });

    async function send(blob) {
      if (blob.size < 1000) return;
      mic.classList.add("is-busy");
      try {
        var type = (blob.type || "audio/webm").split(";")[0];
        var body = new FormData();
        body.append("audio", new File([blob], "question." + (type.split("/")[1] || "webm"), { type: type }));
        var res = await fetch(url, { method: "POST", body: body });
        var data = await res.json().catch(function () { return {}; });
        if (res.ok && data.text) {
          self.input.value = self.input.value.trim() ? self.input.value.trim() + " " + data.text : data.text;
          self.grow();
          self.input.focus();
        }
      } finally {
        mic.classList.remove("is-busy");
      }
    }
  };

  window.AssistantChat = AssistantChat;
})();
