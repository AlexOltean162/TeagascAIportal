// Theme handling shared by the portal and the Assistants hub.
// Loaded in <head> so the saved theme applies before first paint.
(function () {
  var KEY = "teagasc-ai-theme";
  var root = document.documentElement;

  function saved() {
    try { return localStorage.getItem(KEY) === "dark" ? "dark" : "light"; } catch (e) { return "light"; }
  }

  function apply(theme) {
    root.dataset.theme = theme;
    document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
      var label = btn.querySelector("[data-theme-label]");
      if (label) label.textContent = theme === "dark" ? "Light mode" : "Dark mode";
      btn.setAttribute("aria-pressed", String(theme === "dark"));
    });
    document.dispatchEvent(new CustomEvent("themechange", { detail: theme }));
  }

  root.dataset.theme = saved();

  window.TeagascTheme = {
    get: function () { return root.dataset.theme === "dark" ? "dark" : "light"; },
    toggle: function () {
      var next = this.get() === "dark" ? "light" : "dark";
      try { localStorage.setItem(KEY, next); } catch (e) { /* private mode: theme just won't persist */ }
      apply(next);
    }
  };

  document.addEventListener("DOMContentLoaded", function () {
    apply(saved());
    document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
      btn.addEventListener("click", function () { window.TeagascTheme.toggle(); });
    });
  });
})();
