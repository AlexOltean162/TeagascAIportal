// Assistants hub: renders the sidebar from config.js and shows the chosen assistant's chat.
// Each assistant gets one chat panel, created on first visit and kept alive, so switching
// between assistants keeps each conversation until the tab is closed.
(function () {
  var config = window.TEAGASC_ASSISTANTS;
  var Character = window.AssistantCharacter;
  var T = window.AnswerText;
  var nav = document.getElementById("rail-nav");
  var stage = document.getElementById("stage");
  var rail = document.getElementById("rail");
  var menuButton = document.getElementById("menu-button");
  var mobileTitle = document.getElementById("mobile-title");
  var panels = {};
  var chats = {};
  var all = [];

  document.getElementById("back-link").href = config.portalUrl;

  // The character in the main area changes outfit, with an animation, when you switch assistant.
  var currentLook = null;

  function dressUp(panel) {
    var svg = panel.querySelector(".assistant-character.is-animated");
    var from = panel.dataset.from;
    if (!svg || !from || from === svg.dataset.look) return;
    var look = svg.dataset.look;
    svg.dataset.look = from;           // start in the previous assistant's outfit
    void svg.getBoundingClientRect();  // apply it before switching, so the change animates
    Character.setLook(svg, look);
    delete panel.dataset.from;
  }

  config.groups.forEach(function (group) {
    var section = document.createElement("section");
    section.className = "rail-group";
    var heading = document.createElement("h2");
    heading.textContent = group.label;
    section.appendChild(heading);

    group.assistants.forEach(function (a) {
      all.push(a);
      var link = document.createElement("a");
      link.className = "rail-item";
      link.href = "#" + a.id;
      link.dataset.id = a.id;
      link.innerHTML = '<span class="rail-item-icon"></span><span class="rail-item-name"></span>';
      link.querySelector(".rail-item-icon").appendChild(Character.create(a.look));
      link.querySelector(".rail-item-name").textContent = a.name;
      section.appendChild(link);
    });
    nav.appendChild(section);
  });

  // ------------------------------------------------------------ source preview (hover or focus)
  var popover = (function () {
    var box = document.getElementById("popover");
    var hideTimer = null, anchor = null;

    function show(a) {
      var msg = a.closest(".msg");
      var s = msg && msg._sources && msg._sources[Number(a.dataset.n) - 1];
      if (!s) return;
      clearTimeout(hideTimer);
      if (anchor === a && !box.hidden) return;
      anchor = a;
      box.innerHTML =
        '<p class="pop-title"></p>' +
        (s.meta ? '<p class="pop-meta"></p>' : "") +
        (s.flag ? '<span class="flag ' + s.flag.kind + '"></span>' : "") +
        s.excerpts.map(function () { return '<div class="pop-excerpt"><p class="pop-where"></p><p class="pop-text"></p></div>'; }).join("") +
        (s.url ? '<a class="pop-open" target="_blank" rel="noopener"></a>' : "");
      box.querySelector(".pop-title").textContent = s.title;
      if (s.meta) box.querySelector(".pop-meta").textContent = s.meta;
      if (s.flag) box.querySelector(".flag").textContent = s.flag.label;
      box.querySelectorAll(".pop-excerpt").forEach(function (ex, i) {
        var e = s.excerpts[i];
        if (e.where) ex.querySelector(".pop-where").textContent = e.where;
        else ex.querySelector(".pop-where").remove();
        ex.querySelector(".pop-text").textContent = e.text;
      });
      if (s.url) {
        var open = box.querySelector(".pop-open");
        open.href = T.safeUrl(s.url);
        open.textContent = s.linkLabel + " ↗";
      }
      box.hidden = false;
      var r = a.getBoundingClientRect();
      var left = Math.max(12, Math.min(r.left, window.innerWidth - box.offsetWidth - 12));
      var below = r.bottom + 8;
      box.style.left = left + "px";
      box.style.top = (below + box.offsetHeight <= window.innerHeight - 8 ? below : Math.max(8, r.top - box.offsetHeight - 8)) + "px";
    }

    function hideSoon() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function () { box.hidden = true; anchor = null; }, 180);
    }

    box.addEventListener("mouseenter", function () { clearTimeout(hideTimer); });
    box.addEventListener("mouseleave", hideSoon);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") box.hidden = true; });

    return {
      watch: function (container) {
        container.addEventListener("mouseover", function (e) { var a = e.target.closest("[data-n]"); if (a) show(a); });
        container.addEventListener("mouseout", function (e) {
          var a = e.target.closest("[data-n]");
          if (a && !a.contains(e.relatedTarget)) hideSoon();
        });
        container.addEventListener("focusin", function (e) { var a = e.target.closest("[data-n]"); if (a) show(a); });
        container.addEventListener("focusout", function (e) { if (e.target.closest("[data-n]")) hideSoon(); });
        container.closest(".chat").querySelector(".chat-scroll").addEventListener("scroll", function () { box.hidden = true; anchor = null; });
      }
    };
  })();

  // ------------------------------------------------------------ panels
  function showChat(panel, a) {
    var chat = chats[a.id] = new window.AssistantChat(a, { transcribeUrl: config.transcribeUrl, popover: popover });
    panel.replaceChildren(chat.el);
    if (!panel.hidden) { dressUp(panel); chat.focus(); }
  }

  function showOffline(panel, a) {
    var card = document.createElement("div");
    card.className = "offline-card";
    card.appendChild(Character.create(a.look, { animated: true }));
    var title = document.createElement("h1");
    title.textContent = a.name + " isn't available right now";
    var retry = document.createElement("button");
    retry.type = "button";
    retry.className = "offline-button";
    retry.textContent = "Try again";
    retry.addEventListener("click", function () { load(panel, a); });
    card.append(title, retry);
    panel.replaceChildren(card);
    if (!panel.hidden) dressUp(panel);
  }

  // Check the assistant answers before showing its chat, so a stopped app shows a clear message.
  function load(panel, a) {
    panel.replaceChildren();
    fetch(a.url + (a.health || ""), { cache: "no-store" })
      .then(function (res) { if (res.ok) showChat(panel, a); else showOffline(panel, a); })
      .catch(function () { showOffline(panel, a); });
  }

  function buildPanel(a) {
    var panel = document.createElement("div");
    panel.className = "panel";
    panel.hidden = true;
    stage.appendChild(panel);
    load(panel, a);
    return panel;
  }

  function show(id) {
    var a = all.find(function (x) { return x.id === id; }) || all[0];
    if (!panels[a.id]) panels[a.id] = buildPanel(a);
    Object.keys(panels).forEach(function (key) { panels[key].hidden = key !== a.id; });
    nav.querySelectorAll(".rail-item").forEach(function (link) {
      if (link.dataset.id === a.id) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    if (currentLook) panels[a.id].dataset.from = currentLook;
    currentLook = a.look;
    dressUp(panels[a.id]);
    document.title = a.name + " · Teagasc Assistants";
    mobileTitle.textContent = a.name;
    if (chats[a.id]) chats[a.id].focus();
    setMenu(false);
  }

  function setMenu(open) {
    rail.classList.toggle("is-open", open);
    menuButton.setAttribute("aria-expanded", String(open));
  }

  menuButton.addEventListener("click", function () {
    setMenu(!rail.classList.contains("is-open"));
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && rail.classList.contains("is-open")) {
      setMenu(false);
      menuButton.focus();
    }
  });

  window.addEventListener("hashchange", function () { show(location.hash.slice(1)); });
  show(location.hash.slice(1));
})();
