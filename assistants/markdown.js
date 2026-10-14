// Safe markdown for answers: escapes everything first, then allows headings, lists, tables,
// bold, italics, inline code, links and numbered citations [1] (rendered as source links).
(function () {
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  function safeUrl(url) {
    return /^https?:\/\//i.test(url || "") ? url : "#";
  }

  function inline(s, sources) {
    return s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\[(\d{1,3})\]/g, function (m, n) {
        var s = sources[Number(n) - 1];
        if (!s) return "";
        return '<a class="cite" data-n="' + n + '" href="' + esc(safeUrl(s.url)) + '" target="_blank" rel="noopener" aria-label="Source ' + n + ": " + esc(s.title) + '">' + n + "</a>";
      });
  }

  var LIST = /^\s*([-*•]|\d+[.)])\s+/;

  function render(src, sources) {
    sources = sources || [];
    var lines = esc(src).split("\n");
    var out = [];
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        var cells = function (l) {
          return l.trim().replace(/^\||\|$/g, "").split("|").map(function (c) { return inline(c.trim(), sources); });
        };
        var head = cells(line);
        var rows = [];
        i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
        out.push(
          '<div class="table-wrap"><table><thead><tr>' + head.map(function (h) { return "<th>" + h + "</th>"; }).join("") +
          "</tr></thead><tbody>" + rows.map(function (r) {
            return "<tr>" + r.map(function (c) { return "<td>" + c + "</td>"; }).join("") + "</tr>";
          }).join("") + "</tbody></table></div>"
        );
        continue;
      }
      var h = line.match(/^#{1,4}\s+(.*)$/);
      if (h) { out.push("<h4>" + inline(h[1], sources) + "</h4>"); i++; continue; }
      if (LIST.test(line)) {
        var ordered = /^\s*\d+[.)]\s+/.test(line);
        var items = [];
        while (i < lines.length && LIST.test(lines[i])) items.push(inline(lines[i++].replace(LIST, ""), sources));
        var tag = ordered ? "ol" : "ul";
        out.push("<" + tag + ">" + items.map(function (t) { return "<li>" + t + "</li>"; }).join("") + "</" + tag + ">");
        continue;
      }
      if (!line.trim()) { i++; continue; }
      var para = [];
      while (i < lines.length && lines[i].trim() && !/^#{1,4}\s|^\s*\|/.test(lines[i]) && !LIST.test(lines[i])) para.push(lines[i++]);
      if (!para.length) para.push(lines[i++]);
      out.push("<p>" + inline(para.join(" "), sources) + "</p>");
    }
    return out.join("");
  }

  // Plain text for copying: drop markdown symbols and citation marks.
  function plain(src) {
    return String(src || "")
      .replace(/\[(\d{1,3})\]/g, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/^#{1,4}\s+/gm, "")
      .trim();
  }

  window.AnswerText = { render: render, plain: plain, esc: esc, safeUrl: safeUrl };
})();
