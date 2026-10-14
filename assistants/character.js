// The Assistants character: one friendly speech-bubble body in the Teag-Ask style that changes
// accessories per assistant. Switching runs a hop, a blink and an accessory swap (see hub.css).
//
//   AssistantCharacter.create(look, { animated })  -> <svg> element
//   AssistantCharacter.setLook(svg, look)           -> swap accessories with animation
//
// Looks: "goggles" (Research), "tie" (Policy), "badge" (Staff Handbook).
(function () {
  var NS = "http://www.w3.org/2000/svg";

  function markup() {
    return (
      '<g class="ac-body">' +
        // Body: rounded bubble with the square bottom-left tail Teag-Ask uses.
        '<path fill="#008752" d="M70 30h60a50 50 0 0 1 50 50v20a50 50 0 0 1-50 50H28a8 8 0 0 1-8-8V80a50 50 0 0 1 50-50z"/>' +
        '<path fill="#fff" d="M70 42h60a38 38 0 0 1 38 38v20a38 38 0 0 1-38 38H36a4 4 0 0 1-4-4V80a38 38 0 0 1 38-38z"/>' +
        '<path fill="none" stroke="#c2cd23" stroke-width="3" d="M70 45h60a35 35 0 0 1 35 35v20a35 35 0 0 1-35 35H37a2 2 0 0 1-2-2V80a35 35 0 0 1 35-35z" opacity=".9"/>' +
        '<g class="ac-eyes"><circle fill="#008752" cx="78" cy="84" r="9.5"/><circle fill="#008752" cx="122" cy="84" r="9.5"/></g>' +
        '<path class="ac-mouth" fill="none" stroke="#008752" stroke-width="5" stroke-linecap="round" d="M90 106q10 9 20 0"/>' +

        // Research: lab goggles. Solid lenses hide the strap; the eyes are redrawn on top of them
        // and share the blink animation.
        '<g class="ac-acc" data-look="goggles">' +
          '<path fill="#c2cd23" d="M20 77h160v13H20z"/>' +
          '<rect x="91" y="78" width="18" height="10" rx="3" fill="#1d5c3a"/>' +
          '<rect x="54" y="65" width="44" height="38" rx="16" fill="#e6f5fa"/>' +
          '<rect x="102" y="65" width="44" height="38" rx="16" fill="#e6f5fa"/>' +
          '<g class="ac-eyes"><circle fill="#008752" cx="78" cy="84" r="7.5"/><circle fill="#008752" cx="122" cy="84" r="7.5"/></g>' +
          '<rect x="54" y="65" width="44" height="38" rx="16" fill="none" stroke="#1d5c3a" stroke-width="5"/>' +
          '<rect x="102" y="65" width="44" height="38" rx="16" fill="none" stroke="#1d5c3a" stroke-width="5"/>' +
          '<path fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" d="M62 74q3-3 8-3M110 74q3-3 8-3"/>' +
        "</g>" +

        // Policy: a tie.
        '<g class="ac-acc" data-look="tie">' +
          '<path fill="#c2cd23" stroke="#c2cd23" stroke-width="3" stroke-linejoin="round" d="M95.5 160h9l7 26-11.5 10-11.5-10z"/>' +
          '<path fill="none" stroke="#9aa31a" stroke-width="3.5" stroke-linecap="round" d="M93 174l13-6M91 184l17-8"/>' +
          '<path fill="#9aa31a" stroke="#9aa31a" stroke-width="3" stroke-linejoin="round" d="M92 148h16l-3 12h-10z"/>' +
        "</g>" +

        // Staff Handbook: lanyard with a staff ID badge.
        '<g class="ac-acc" data-look="badge">' +
          '<path fill="none" stroke="#49aa42" stroke-width="5" stroke-linecap="round" d="M84 146l15 24M116 146l-15 24"/>' +
          '<g class="ac-card">' +
            '<rect x="83" y="170" width="34" height="27" rx="4.5" fill="#fff" stroke="#008752" stroke-width="3"/>' +
            '<path fill="#008752" d="M87.5 170h25a4.5 4.5 0 0 1 4.5 4.5v3.5H83v-3.5a4.5 4.5 0 0 1 4.5-4.5z"/>' +
            '<circle cx="100" cy="184" r="3.6" fill="#49aa42"/>' +
            '<path fill="#49aa42" d="M93 194a7 6 0 0 1 14 0z"/>' +
          "</g>" +
        "</g>" +
      "</g>"
    );
  }

  function create(look, opts) {
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 200 200");
    svg.setAttribute("class", "assistant-character" + (opts && opts.animated ? " is-animated" : ""));
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = markup();
    svg.dataset.look = look;
    return svg;
  }

  function setLook(svg, look) {
    if (svg.dataset.look === look) return;
    svg.dataset.look = look;
    // Restart the hop and blink: drop the class, force a reflow, add it back.
    svg.classList.remove("is-switching");
    void svg.getBoundingClientRect();
    svg.classList.add("is-switching");
  }

  window.AssistantCharacter = { create: create, setLook: setLook };
})();
