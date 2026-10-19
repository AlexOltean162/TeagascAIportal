// Portal additions to the Teag-Ask UI, copied in by deploy/sync_teagask.py:
//  - a link back to the AI Portal (the header is rendered by React, so it is re-added whenever it is replaced);
//  - analytics context for the anonymised usage log (analytics.py in the Teag-Ask app). The UI's own requests
//    can't be given headers, so these go in cookies scoped to this folder: a random id per chat (new on
//    "New chat"), that the request came from the portal, and which answer a thumbs up/down rates.
(function () {
  var ARROW = '<svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">' +
    '<path d="M228 128a12 12 0 0 1-12 12H69l51.5 51.5a12 12 0 0 1-17 17l-72-72a12 12 0 0 1 0-17l72-72a12 12 0 0 1 17 17L69 116h147a12 12 0 0 1 12 12z"/></svg>';
  var COOKIE_PATH = location.pathname.replace(/[^/]*$/, "");   // e.g. /aiportal/teagask/

  function addLink() {
    var bar = document.querySelector(".topbar");
    if (!bar || bar.querySelector(".portal-back")) return;
    var link = document.createElement("a");
    link.className = "portal-back";
    link.href = "../";
    link.innerHTML = ARROW + "<span>AI Portal</span>";
    bar.appendChild(link);
  }

  function setCookie(name, value) {
    document.cookie = name + "=" + value + "; path=" + COOKIE_PATH + "; SameSite=Strict";
  }

  function newConversation() {
    var id = window.crypto && crypto.randomUUID ? crypto.randomUUID()
      : Array.from({ length: 4 }, function () { return Math.random().toString(16).slice(2, 10); }).join("-");
    setCookie("aiportal_conversation", id);
  }

  setCookie("aiportal_client", "ai-portal");
  newConversation();

  // Capture phase: runs before the UI's own handlers, so the cookies are set before its request goes out.
  document.addEventListener("click", function (e) {
    if (e.target.closest(".new-chat-button")) { newConversation(); return; }
    var rate = e.target.closest('.teagask-action[data-act="up"], .teagask-action[data-act="down"]');
    if (!rate) return;
    var answers = Array.prototype.filter.call(document.querySelectorAll(".message-row.assistant"), function (row) {
      return row.querySelector(".teagask-actions");
    });
    var turn = answers.indexOf(rate.closest(".message-row"));
    if (turn >= 0) setCookie("aiportal_rated_turn", String(turn));
  }, true);

  new MutationObserver(addLink).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", addLink);
})();
