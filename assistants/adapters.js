// Adapters: one per assistant backend. Each turns its API into the same shape for chat.js:
//
//   filters(base)                       -> Promise<[{ key, label, options: [{ value, label }] }]>
//   ask(base, request, on)              -> Promise; request = { question, history, filters, assistant, signal } (assistant = its config entry)
//        on.status(text) · on.token(text) · on.reset() · on.sources([source]) · on.data(html) · on.done(answer)
//   cite(text, sources)                 -> answer text with citations as [1], [2] … matching `sources`
//   feedback(base, { rating, question, answer }) -> Promise
//
// A source is { title, meta, url, linkLabel, flag: { kind, label } | null, excerpts: [{ where, text }] }.
(function () {
  var esc = window.AnswerText.esc;
  var fmt = function (n) { return Number(n || 0).toLocaleString("en-IE"); };

  // Read a streamed response body and hand each complete record to `onRecord`.
  async function readStream(res, separator, onRecord) {
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";
    for (;;) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      var parts = buffer.split(separator);
      buffer = parts.pop();
      parts.forEach(function (p) { if (p.trim()) onRecord(p); });
    }
    if (buffer.trim()) onRecord(buffer);
  }

  async function post(url, body, signal) {
    var res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: signal
    });
    if (!res.ok || !res.body) throw new Error("The assistant returned an error (" + res.status + ").");
    return res;
  }

  // Both backends take the same thumbs up/down payload at api/feedback.
  function feedback(base, payload) {
    return fetch(base + "api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: payload.rating, question: payload.question, answer_length: payload.answer.length })
    });
  }

  // ------------------------------------------------------------------ Research (NDJSON, [P12] citations)
  var FLAGS = {
    abstract_only: { kind: "partial", label: "Abstract only" },
    metadata_only: { kind: "missing", label: "Title only" }
  };

  function researchOrder(text, sources) {
    var order = sources.map(function (s) { return s.id; });
    var re = /P(\d+)/g, m;
    while ((m = re.exec(text))) { var id = +m[1]; if (order.indexOf(id) === -1) order.push(id); }
    return order;
  }

  function bars(rows, label, value) {
    var max = Math.max.apply(null, [1].concat(rows.map(value)));
    return '<div class="bars">' + rows.map(function (r) {
      return '<div class="bar-row"><span class="bar-label" title="' + esc(label(r)) + '">' + esc(label(r)) + "</span>" +
        '<span class="bar-track"><span class="bar-fill" style="width:' + (100 * value(r) / max).toFixed(1) + '%"></span></span>' +
        '<span class="bar-value">' + fmt(value(r)) + "</span></div>";
    }).join("") + "</div>";
  }

  function columns(rows) {
    rows = rows.filter(function (r) { return r.y != null && r.y !== "" && r.y !== "None"; })
      .map(function (r) { return { y: +r.y, n: +r.n }; })
      .filter(function (r) { return r.y > 1950; })
      .sort(function (a, b) { return a.y - b.y; });
    if (!rows.length) return "";
    var max = Math.max.apply(null, [1].concat(rows.map(function (r) { return r.n; })));
    return '<div class="columns">' + rows.map(function (r) {
      return '<span class="col" style="height:' + Math.max(2, 100 * r.n / max) + '%" data-tip="' + r.y + ": " + fmt(r.n) + '"></span>';
    }).join("") + '</div><div class="col-axis"><span>' + rows[0].y + "</span><span>" + rows[rows.length - 1].y + "</span></div>";
  }

  function researchPanel(ev) {
    var r = ev.result || {}, a = ev.args || {};
    if (r.error) return "";
    if (ev.tool === "count_papers" && r.groups && r.groups.length) {
      var g = a.group_by || "group";
      var body = g === "year"
        ? columns(r.groups.map(function (x) { return { y: x.key, n: x.n }; }))
        : bars(r.groups.slice(0, 12), function (x) { return x.key == null ? "Not recorded" : x.key; }, function (x) { return x.n; });
      return '<div class="data-panel"><h4>Papers by ' + esc(g.replace(/_/g, " ")) + (a.keyword ? " · " + esc(a.keyword) : "") +
        '</h4><p class="data-sub">' + fmt(r.total_papers) + " papers</p>" + body + "</div>";
    }
    if (ev.tool === "author_profile" && r.author) {
      return '<div class="data-panel"><h4>' + esc(r.author) + "</h4>" +
        '<div class="stat-tiles"><div class="stat-tile"><span>Papers</span><strong>' + fmt(r.total_papers) + "</strong></div>" +
        '<div class="stat-tile"><span>Active</span><strong>' + esc(r.first_year == null ? "–" : r.first_year) + "–" + esc(r.last_year == null ? "–" : r.last_year) + "</strong></div></div>" +
        columns(r.per_year || []) +
        ((r.top_subfields || []).length ? bars(r.top_subfields.slice(0, 6), function (x) { return x.subfield || "Unclassified"; }, function (x) { return x.n; }) : "") +
        "</div>";
    }
    if (ev.tool === "gap_analysis" && r.commodity_x_sustainability) {
      var grid = r.commodity_x_sustainability;
      var rowsK = Object.keys(grid).filter(function (k) { return k !== "not applicable"; });
      var cols = Array.from(new Set([].concat.apply([], rowsK.map(function (k) { return Object.keys(grid[k]); })))).sort();
      var max = Math.max.apply(null, [1].concat([].concat.apply([], rowsK.map(function (k) { return Object.values(grid[k]); }))));
      var cell = function (n) {
        return n ? '<td style="background:color-mix(in srgb, var(--primary-strong) ' + Math.round(12 + 70 * Math.sqrt(n / max)) + '%, transparent)">' + fmt(n) + "</td>" : '<td class="zero">0</td>';
      };
      if (!rowsK.length || !cols.length) return "";
      return '<div class="data-panel"><h4>Evidence map</h4><p class="data-sub">Papers per commodity and theme. Red cells have none.</p>' +
        '<div class="heatmap"><table><thead><tr><th></th>' + cols.map(function (c) { return "<th><span>" + esc(c) + "</span></th>"; }).join("") +
        "</tr></thead><tbody>" + rowsK.map(function (k) {
          return "<tr><th>" + esc(k) + "</th>" + cols.map(function (c) { return cell(grid[k][c] || 0); }).join("") + "</tr>";
        }).join("") + "</tbody></table></div></div>";
    }
    return "";
  }

  // Deep research (broad questions): the plan is shown before the agents start, and stays with the answer.
  // Each step shows waiting / running (with its search count) / done, updated live by "step" events.
  var STEP_LABELS = { pending: "Waiting", running: "Working", done: "Done", failed: "Didn't finish" };
  var TICK = '<svg class="plan-tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8.5l2.6 2.6L12 5.6"/></svg>';

  function planPanel(ev, id) {
    return '<div class="data-panel plan-panel"><h4>Research plan</h4><p>' + esc(ev.summary || "") + '</p><ol id="' + id + '">' +
      (ev.steps || []).map(function (s, i) {
        return '<li data-i="' + i + '" data-state="pending"><span class="plan-icon">' + TICK + "</span>" +
          '<span class="plan-step">' + esc(s) + '</span><span class="plan-count"></span>' +
          '<span class="visually-hidden plan-state">' + STEP_LABELS.pending + "</span></li>";
      }).join("") + "</ol></div>";
  }

  function markStep(id, ev) {
    var li = id && document.querySelector("#" + id + ' li[data-i="' + ev.index + '"]');
    if (!li || li.dataset.state === "done") return;
    li.dataset.state = ev.state;
    li.querySelector(".plan-state").textContent = STEP_LABELS[ev.state] || "";
    if (ev.searches) li.querySelector(".plan-count").textContent = ev.searches + (ev.searches === 1 ? " search" : " searches");
  }

  // The answer ended (finished, stopped or failed): any step still open didn't finish.
  function settlePlan(id) {
    if (!id) return;
    document.querySelectorAll("#" + id + ' li:not([data-state="done"])').forEach(function (li) {
      markStep(id, { index: li.dataset.i, state: "failed" });
    });
  }

  var research = {
    filters: async function (base) {
      var res = await fetch(base + "api/meta");
      if (!res.ok) return [];
      var m = await res.json();
      // "Food Science (4,549)": the number of papers the filter selects.
      var withCount = function (name, n) { return n == null ? name : name + " (" + fmt(n) + ")"; };
      var programmeN = {};
      (m.programme_counts || []).forEach(function (p) { programmeN[p.programme] = p.papers; });
      return [
        { key: "subfield", label: "All topics", options: (m.topics || []).map(function (t) { return { value: t.subfield, label: withCount(t.subfield, t.papers) }; }) },
        { key: "programme", label: "All programmes", options: (m.programmes || []).map(function (p) { return { value: p, label: withCount(p, programmeN[p]) }; }) }
      ];
    },

    ask: async function (base, req, on) {
      var res = await post(base + "api/chat/stream", {
        question: req.question,
        history: req.history.slice(-8),
        subfield: req.filters.subfield || null,
        programme: req.filters.programme || null
      }, req.signal);
      var raw = [];
      var finished = false;
      var planId = null;
      try {
        await readStream(res, "\n", function (line) {
          var ev = JSON.parse(line);
          if (ev.type === "status" || ev.type === "tool") on.status(ev.label);
          else if (ev.type === "token") on.token(ev.text);
          else if (ev.type === "reset") on.reset();
          else if (ev.type === "plan") { planId = "plan-" + Math.random().toString(36).slice(2); on.data(planPanel(ev, planId)); }
          else if (ev.type === "step") markStep(planId, ev);
          else if (ev.type === "data") { var html = researchPanel(ev); if (html) on.data(html); }
          else if (ev.type === "sources") { raw = ev.sources || []; on.sources(raw.map(researchSource)); }
          else if (ev.type === "complete") { finished = true; on.done(ev.answer); }
          else if (ev.type === "error") throw new Error(ev.message || "The assistant couldn't answer.");
        });
      } finally {
        settlePlan(planId);
      }
      if (!finished) throw new Error("The answer stopped before it finished.");
    },

    // [P12] / [P12, P34] -> [1][2], numbered in the order of the sources list.
    cite: function (text, sources) {
      var order = researchOrder(text, sources.map(function (s) { return s._raw; }));
      return text.replace(/\[((?:P\d+\s*[,;]?\s*)+)\]/g, function (_, ids) {
        return ids.match(/\d+/g).map(function (id) { return "[" + (order.indexOf(+id) + 1) + "]"; }).join("");
      });
    },

    feedback: feedback
  };

  function researchSource(s) {
    return {
      _raw: s,
      title: s.title,
      meta: [s.authors, s.publication_year, s.venue].filter(Boolean).join(" · "),
      url: s.landing_url,
      linkLabel: "Open paper",
      flag: FLAGS[s.fulltext_status] || null,
      excerpts: s.excerpt ? [{ text: s.excerpt.slice(0, 320) + "…" }] : []
    };
  }

  // ------------------------------------------------------------------ Policy (SSE, [1] citations)
  var policy = {
    filters: async function (base) {
      var res = await fetch(base + "api/departments");
      if (!res.ok) return [];
      var depts = await res.json();
      return [{ key: "dept", label: "All departments", options: depts.map(function (d) { return { value: d, label: d }; }) }];
    },

    ask: async function (base, req, on) {
      var res = await post(base + "api/chat", {
        question: req.question,
        history: req.history.slice(-6),
        dept: req.filters.dept || null
      }, req.signal);
      var finished = false;
      on.status(req.assistant.searching || "Searching");
      await readStream(res, "\n\n", function (chunk) {
        if (chunk.indexOf("data: ") !== 0) return;
        var ev = JSON.parse(chunk.slice(6));
        if (ev.type === "sources") { on.sources((ev.sources || []).map(policySource)); on.status(req.assistant.reading || "Reading the sources"); }
        else if (ev.type === "delta") on.token(ev.text);
        else if (ev.type === "done") { finished = true; on.done(ev.answer); }
        else if (ev.type === "error") throw new Error(ev.message || "The assistant couldn't answer.");
      });
      if (!finished) throw new Error("The answer stopped before it finished.");
    },

    cite: function (text) { return text; },

    feedback: feedback
  };

  function policySource(s) {
    return {
      title: s.title,
      meta: s.policy_owners && s.policy_owners.length ? "Owner: " + s.policy_owners.join(", ") : "",
      url: /^https:\/\/[a-z0-9-]+\.sharepoint\.com\//i.test(s.url || "") ? s.url : "",
      linkLabel: "Open in SharePoint",
      flag: null,
      excerpts: (s.excerpts || []).map(function (e) { return { where: e.where, text: e.text }; })
    };
  }

  window.AssistantAdapters = { research: research, policy: policy };
})();
