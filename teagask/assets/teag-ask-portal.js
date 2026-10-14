// Portal additions to the Teag-Ask UI, copied in by deploy/sync_teagask.py: a link back to the AI Portal.
// The header is rendered by React, so the link is re-added whenever the header is replaced.
(function () {
  var ARROW = '<svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">' +
    '<path d="M228 128a12 12 0 0 1-12 12H69l51.5 51.5a12 12 0 0 1-17 17l-72-72a12 12 0 0 1 0-17l72-72a12 12 0 0 1 17 17L69 116h147a12 12 0 0 1 12 12z"/></svg>';

  function addLink() {
    var bar = document.querySelector(".topbar");
    if (!bar || bar.querySelector(".portal-back")) return;
    var link = document.createElement("a");
    link.className = "portal-back";
    link.href = "../";
    link.innerHTML = ARROW + "<span>AI Portal</span>";
    bar.appendChild(link);
  }

  new MutationObserver(addLink).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", addLink);
})();
