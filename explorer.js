/* The Explorer: routes, the model page, figures, sweeps and the scenario
 * table. Everything is computed in the browser from data/<model>/:
 * catalogue.json, kpis.json and one file per scenario, fetched when first
 * needed.
 *
 * Routes (also how the Lab embeds a view):
 *   #/                                         home
 *   #/m/<model>?s=&c=&fig=&zone=&week=           the model page
 *   #/m/<model>/sweep?lever=&metric=&crossed=off
 *   #/m/<model>/table                          every scenario's numbers
 *   #/figure/<id>?m=&s=&c=&zone=&embed=1         one figure, alone
 *
 * The model page (RKB, 2026-10-15): one title, the Explorer's short summary
 * of the model ending on "About this model", then a panel on the left with
 * three sections, one open at a time (the scenario, what it is compared
 * with, the figure), and one figure on the right. The headline numbers are
 * one of the figures. Every figure compares, and only when the reader asks:
 * one that cannot hold two scenarios is drawn twice, on shared scales.
 *
 * What it may say (decided with RKB, 2026-10-12): what a number is, never
 * what it means. Titles, captions, units and encoding notes describe; the
 * reading is the student's, so there is no "what to look for" and no
 * verdict on a scenario. The Lab's questions depend on that.
 */
(function () {
  "use strict";
  var U = window.EXU, F = window.FIGURES;
  var main = document.getElementById("ex-main");
  var store = { cat: {}, kpis: {}, scen: {}, models: null };
  // What outlives a render: the panel's open section, how far each of its
  // lists was scrolled, the lever group on show, the view on screen, and
  // the window's scroll when a change should keep it.
  var ui = { open: null, scroll: {}, group: "", model: "", path: null, restoreY: null, toFigure: false };

  // -- data ------------------------------------------------------------------
  function getJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ": " + r.status);
      return r.json();
    });
  }
  function catalogue(m) {
    return store.cat[m] || (store.cat[m] = getJSON("data/" + m + "/catalogue.json"));
  }
  function kpis(m) {
    return store.kpis[m] || (store.kpis[m] = getJSON("data/" + m + "/kpis.json"));
  }
  function scenario(m, id) {
    var key = m + "/" + id;
    return store.scen[key] || (store.scen[key] = getJSON("data/" + m + "/s/" + id + ".json"));
  }

  // -- routing ---------------------------------------------------------------
  function route() {
    var h = (location.hash || "#/").slice(1), q = {}, path = h, k = h.indexOf("?");
    if (k >= 0) {
      path = h.slice(0, k);
      h.slice(k + 1).split("&").forEach(function (kv) {
        if (!kv) return;
        var p = kv.split("=");
        q[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || "").replace(/\+/g, " "));
      });
    }
    return { parts: path.split("/").filter(Boolean), q: q };
  }
  function href(parts, q) {
    var s = "#/" + parts.join("/"), keys = Object.keys(q || {}).filter(function (k) { return q[k] !== undefined && q[k] !== null && q[k] !== ""; });
    if (keys.length) s += "?" + keys.map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(q[k]); }).join("&");
    return s;
  }
  function go(parts, q, keepScroll) {
    ui.restoreY = keepScroll ? window.scrollY : null;
    var target = href(parts, q);
    if (location.hash === target) { render(); return; }
    location.hash = target;
  }
  function narrow() {
    return !!(window.matchMedia && window.matchMedia("(max-width: 900px)").matches);
  }

  function esc(s) {
    return String(s === undefined || s === null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "class") e.className = attrs[k]; else e.setAttribute(k, attrs[k]);
    });
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  // -- scenarios and levers ------------------------------------------------------
  function leverValue(sc, lever) {
    var v = sc.levers[lever.id];
    return v === undefined ? lever.reference : v;
  }
  function sameExcept(a, b, leverId, levers) {
    return levers.every(function (l) {
      return l.id === leverId || String(leverValue(a, l)) === String(leverValue(b, l));
    });
  }
  function findScenario(cat, current, leverId, value) {
    // The scenario that differs from the current one in this lever only;
    // failing that, the reference with this lever moved.
    var avail = cat.scenarios.filter(function (s) { return s.available; });
    var want = function (base) {
      return avail.find(function (s) {
        var l = cat.levers.find(function (x) { return x.id === leverId; });
        return String(leverValue(s, l)) === String(value) && sameExcept(s, base, leverId, cat.levers);
      });
    };
    var ref = cat.scenarios.find(function (s) { return s.id === cat.reference; });
    return want(current) || want(ref);
  }
  function leverOptions(cat, current, lever) {
    // Values of this lever for which a solved scenario exists from here.
    var seen = {}, out = [];
    cat.scenarios.forEach(function (s) {
      if (!s.available) return;
      var v = leverValue(s, lever);
      if (seen[String(v)]) return;
      if (findScenario(cat, current, lever.id, v)) { seen[String(v)] = 1; out.push(v); }
    });
    if (lever.kind === "sweep") out.sort(function (a, b) { return (+a) - (+b); });
    return out;
  }
  function fmtLever(lever, v) {
    if (lever.values && lever.values[v] !== undefined) return lever.values[v];
    if (lever.id === "budget" && +v === 100) return "none";
    if (v === "none" || v === "all" || v === "in" || v === "adapt" || v === "available" || v === "baseline") {
      return { none: "none", all: "all", in: "in", adapt: "adapt and invest", available: "available", baseline: "baseline" }[v];
    }
    if (lever.id === "interconnectors" && +v === 0) return "0 (autarky)";
    if (lever.kind === "sweep") {
      var u = lever.unit || "";
      if (u.indexOf("x") === 0) return "× " + v;
      if (u === "%" || u.indexOf("%") === 0) return v + " %";
      return v + " " + u;
    }
    return String(v);
  }
  function movedLevers(cat, s) {
    return cat.levers.filter(function (l) { return String(leverValue(s, l)) !== String(l.reference); });
  }
  // A comparison is only ever switched on by the reader (RKB, 2026-10-15):
  // a new scenario keeps the one chosen, and drops it rather than compare
  // the scenario with itself.
  function keepComparison(q, sId) {
    return q.c && q.c !== sId ? q.c : "";
  }

  function leverRow(cat, s, m, q, l, opts) {
    var cur = leverValue(s, l);
    var row = el("div", { class: "ex-lever" + (String(cur) !== String(l.reference) ? " is-moved" : "") });
    var id = "lever-" + l.id;
    row.appendChild(el("label", { for: id }, esc(l.label) + '<span class="ex-lever-value">' + esc(fmtLever(l, cur)) + "</span>"));
    var move = function (v) {
      var target = findScenario(cat, s, l.id, v);
      if (target) go(["m", m], Object.assign({}, q, { s: target.id, c: keepComparison(q, target.id) }), true);
    };
    var input;
    if (l.kind === "sweep") {
      var at = opts.findIndex(function (v) { return String(v) === String(cur); });
      input = el("input", { type: "range", id: id, min: 0, max: opts.length - 1, step: 1, value: Math.max(at, 0),
        "aria-valuetext": fmtLever(l, cur) });
      input.addEventListener("input", function () {
        row.querySelector(".ex-lever-value").textContent = fmtLever(l, opts[+input.value]);
      });
      input.addEventListener("change", function () { move(opts[+input.value]); });
      row.appendChild(input);
      row.appendChild(el("div", { class: "ex-lever-ticks" }, "<span>" + esc(fmtLever(l, opts[0])) + "</span><span>" +
        esc(fmtLever(l, opts[opts.length - 1])) + "</span>"));
    } else {
      input = el("select", { id: id });
      opts.forEach(function (v) {
        var o = el("option", { value: String(v) }, esc(fmtLever(l, v)));
        if (String(v) === String(cur)) o.selected = true;
        input.appendChild(o);
      });
      input.addEventListener("change", function () { move(opts.find(function (x) { return String(x) === input.value; })); });
      row.appendChild(input);
    }
    if (l.note) row.appendChild(el("div", { class: "ex-lever-note" }, esc(l.note)));
    return row;
  }

  // The group a scenario belongs to in a menu: that of the first lever it
  // moves, in the catalogue's order.
  function scenarioGroup(cat, x) {
    var moved = movedLevers(cat, x);
    return moved.length ? moved[0].group : "Reference";
  }

  // -- the model page ------------------------------------------------------------

  // One title, the Explorer's short summary of the model
  // (lab/models/<model>.summary.md), and its whole description one click away.
  function modelHeader(cat) {
    var head = el("header", { class: "ex-model" });
    head.appendChild(el("h1", {}, esc(cat.title)));
    var p = el("p", { class: "ex-intro" }, cat.intro_html || "");
    if (cat.about_html) {
      var dialog = aboutDialog(cat);
      var link = el("button", { type: "button", class: "ex-linkbtn ex-about-link", "aria-haspopup": "dialog" }, "About this model");
      link.addEventListener("click", function () {
        if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", "");
      });
      if (cat.intro_html) p.appendChild(document.createTextNode(" "));
      p.appendChild(link);
      head.appendChild(dialog);
    }
    head.appendChild(p);
    return head;
  }
  function aboutDialog(cat) {
    var d = el("dialog", { class: "ex-dialog", "aria-labelledby": "ex-about-title" });
    var head = el("div", { class: "ex-dialog-head" });
    head.appendChild(el("h2", { id: "ex-about-title" }, "About this model"));
    var close = el("button", { type: "button", class: "ex-dialog-close", "aria-label": "Close" }, "&times;");
    close.addEventListener("click", function () { d.close(); });
    head.appendChild(close);
    d.appendChild(head);
    d.appendChild(el("div", { class: "ex-dialog-body" }, cat.about_html));
    // A click outside the content lands on the dialog itself: close it.
    d.addEventListener("click", function (e) { if (e.target === d) d.close(); });
    return d;
  }

  // The panel on the left: three sections, one open at a time. A closed
  // section shows what is chosen in it, so the panel always says which
  // scenario, which comparison and which figure are on screen.
  function panel(sections) {
    var nav = el("nav", { class: "ex-panel-nav", "aria-label": "Scenario, comparison and figure" });
    var parts = sections.map(function (x) {
      var sec = el("section", { class: "ex-sec" });
      var head = el("button", { type: "button", class: "ex-sec-head", id: "sec-head-" + x.key, "aria-controls": "sec-" + x.key },
        '<span class="ex-sec-label">' + esc(x.label) + '</span><span class="ex-sec-value">' + esc(x.value) + "</span>");
      var body = el("div", { class: "ex-sec-body", id: "sec-" + x.key, role: "region", "aria-labelledby": "sec-head-" + x.key });
      body.appendChild(x.body);
      head.addEventListener("click", function () { open(ui.open === x.key ? "" : x.key); });
      sec.appendChild(head);
      sec.appendChild(body);
      nav.appendChild(sec);
      return { key: x.key, sec: sec, head: head, body: body };
    });
    function open(key) {
      ui.open = key;
      parts.forEach(function (p) {
        var on = p.key === key;
        p.sec.classList.toggle("is-open", on);
        p.head.setAttribute("aria-expanded", String(on));
        if (on) p.body.removeAttribute("hidden"); else p.body.setAttribute("hidden", "");
      });
    }
    open(ui.open === null ? (narrow() ? "" : "figure") : ui.open);
    return nav;
  }

  // The panel is as tall as the window below its top, so the headings of
  // all three sections are on screen before it sticks as well as after.
  function fitPanel() {
    var left = main.querySelector(".ex-left");
    if (!left) return;
    if (narrow()) { left.style.maxHeight = ""; return; }
    var top = Math.max(left.getBoundingClientRect().top, 0);
    left.style.maxHeight = Math.max(260, window.innerHeight - top - 16) + "px";
  }
  var fitQueued = false;
  function queueFit() {
    if (fitQueued) return;
    fitQueued = true;
    window.requestAnimationFrame(function () { fitQueued = false; fitPanel(); });
  }
  window.addEventListener("scroll", queueFit, { passive: true });
  window.addEventListener("resize", queueFit);

  // Scroll a list so that one of its items is in view, leaving the window
  // where it is.
  function reveal(node, box) {
    var top = node.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    var bottom = top + node.offsetHeight;
    if (top < box.scrollTop) box.scrollTop = top - 8;
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight + 8;
  }

  // The scenario: what it is, what it changes, and the levers that move it,
  // one group at a time.
  function scenarioSection(cat, s, m, q) {
    var box = el("div", {});
    if (s.description) box.appendChild(el("p", { class: "ex-sec-desc" }, esc(s.description)));
    var moved = movedLevers(cat, s);
    if (moved.length) {
      var changed = el("div", { class: "ex-changed" });
      changed.appendChild(el("span", { class: "ex-muted" }, "Changed from the reference:"));
      moved.forEach(function (l) {
        changed.appendChild(el("span", { class: "ex-chip" }, esc(l.label) + ": <strong>" + esc(fmtLever(l, leverValue(s, l))) + "</strong>"));
      });
      var back = el("button", { type: "button", class: "ex-linkbtn" }, "Back to the reference");
      back.addEventListener("click", function () {
        go(["m", m], Object.assign({}, q, { s: cat.reference, c: keepComparison(q, cat.reference) }), true);
      });
      changed.appendChild(back);
      box.appendChild(changed);
    }
    var groups = [], byGroup = {};
    cat.levers.forEach(function (l) {
      var opts = leverOptions(cat, s, l);
      if (opts.length < 2) return;
      if (!byGroup[l.group]) { byGroup[l.group] = []; groups.push(l.group); }
      byGroup[l.group].push({ lever: l, opts: opts });
    });
    if (!groups.length) return box;
    box.appendChild(el("h3", { class: "ex-sub" }, "Change one assumption"));
    var chips = el("div", { class: "ex-groups" }), shown = {};
    groups.forEach(function (g) {
      var isMoved = byGroup[g].some(function (x) { return String(leverValue(s, x.lever)) !== String(x.lever.reference); });
      var chip = el("button", { type: "button", class: "ex-group" + (isMoved ? " is-moved" : "") }, esc(g));
      var drawer = el("div", { class: "ex-drawer" });
      byGroup[g].forEach(function (x) { drawer.appendChild(leverRow(cat, s, m, q, x.lever, x.opts)); });
      chip.addEventListener("click", function () { show(g); });
      chips.appendChild(chip);
      shown[g] = { chip: chip, drawer: drawer };
    });
    function show(g) {
      ui.group = g;
      groups.forEach(function (k) {
        var on = k === g;
        shown[k].chip.classList.toggle("is-open", on);
        shown[k].chip.setAttribute("aria-pressed", String(on));
        if (on) shown[k].drawer.removeAttribute("hidden"); else shown[k].drawer.setAttribute("hidden", "");
      });
    }
    box.appendChild(chips);
    groups.forEach(function (g) { box.appendChild(shown[g].drawer); });
    // The group last opened; else the one this scenario moves; else the first.
    var first = moved.length && byGroup[moved[0].group] ? moved[0].group : groups[0];
    show(byGroup[q.group] ? q.group : byGroup[ui.group] ? ui.group : first);
    box.appendChild(el("p", { class: "ex-hint" }, "Every setting is a solved scenario. Moving one lever keeps the others where they are."));
    return box;
  }

  // Compare with nothing, the reference, or one other scenario from a menu
  // grouped by what it changes.
  function compareSection(cat, s, cId, m, q) {
    var box = el("div", {});
    var row = el("div", { class: "ex-seg" });
    var options = [["", "Nothing"]];
    if (s.id !== cat.reference) options.push([cat.reference, "The reference"]);
    options.forEach(function (o) {
      var b = el("button", { type: "button", class: "ex-seg-btn" + (cId === o[0] ? " is-on" : ""), "aria-pressed": String(cId === o[0]) }, o[1]);
      b.addEventListener("click", function () { go(["m", m], Object.assign({}, q, { s: s.id, c: o[0] }), true); });
      row.appendChild(b);
    });
    box.appendChild(row);
    var other = cId && cId !== cat.reference;
    var sel = el("select", { id: "compare-other", class: "ex-seg-select" + (other ? " is-on" : ""), "aria-label": "Another scenario to compare with" });
    sel.appendChild(el("option", { value: "" }, "Another scenario…"));
    var groups = {}, order = [];
    cat.scenarios.forEach(function (x) {
      if (!x.available || x.id === s.id || x.id === cat.reference) return;
      var g = scenarioGroup(cat, x);
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(x);
    });
    order.forEach(function (g) {
      var og = el("optgroup", { label: g });
      groups[g].forEach(function (x) {
        var o = el("option", { value: x.id }, esc(x.label));
        if (x.id === cId) o.selected = true;
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    sel.addEventListener("change", function () { if (sel.value) go(["m", m], Object.assign({}, q, { s: s.id, c: sel.value }), true); });
    box.appendChild(sel);
    box.appendChild(el("p", { class: "ex-hint" },
      "A figure that can hold both scenarios draws the comparison faded or dashed. Any other is drawn twice, this scenario first, on the same scales."));
    return box;
  }

  // The figures as a short list, grouped as the model's view groups them.
  function navTitle(id, ctx) {
    var f = F[id], params = Object.assign({}, ctx.params);
    if (!params.zone) params.zone = defaultZone(f, ctx);
    var t = typeof f.title === "function" ? f.title(Object.assign({}, ctx, { params: params })) : f.title;
    return t.split(":")[0];
  }
  function figureSection(view, ctx, figId, m, q) {
    var box = el("div", { class: "ex-fignav" });
    view.tabs.forEach(function (t) {
      var ids = t[2].filter(function (id) { return F[id]; });
      if (!ids.length) return;
      box.appendChild(el("h3", {}, esc(t[1])));
      var ul = el("ul", {});
      ids.forEach(function (id) {
        var attrs = { href: href(["m", m], Object.assign({}, q, { fig: id })) };
        if (id === figId) { attrs.class = "is-current"; attrs["aria-current"] = "page"; }
        var a = el("a", attrs, esc(navTitle(id, ctx)));
        // On a narrow screen the figure is below the panel: close the panel
        // and go to the figure.
        a.addEventListener("click", function (e) {
          if (!narrow()) return;
          e.preventDefault();
          ui.open = "";
          ui.toFigure = true;
          go(["m", m], Object.assign({}, q, { fig: id }));
        });
        var li = el("li", {});
        li.appendChild(a);
        ul.appendChild(li);
      });
      box.appendChild(ul);
    });
    return box;
  }

  // -- figures -----------------------------------------------------------------
  function controlsFor(fig, ctx, onChange) {
    var box = el("div", { class: "ex-fig-controls" });
    (fig.controls || []).forEach(function (c) {
      var lab = el("label", {}), sel;
      if (c === "zone") {
        lab.innerHTML = "Zone ";
        sel = el("select", {});
        var choices = (window.FIGURE_CHOICES.zones[ctx.model] || window.FIGURE_CHOICES.zone).filter(function (z) {
          if (fig.zones) return fig.zones.indexOf(z[0]) >= 0;      // a figure for some zones only
          return !fig.singleZone || U.zonesFor(z[0]).length === 1;
        });
        choices.forEach(function (z) {
          var o = el("option", { value: z[0] }, esc(z[1]));
          if (z[0] === (ctx.params.zone || defaultZone(fig, ctx))) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener("change", function () { onChange({ zone: sel.value }); });
      } else if (c === "week") {
        lab.innerHTML = "Week ";
        sel = el("select", {});
        window.FIGURE_CHOICES.week.forEach(function (w) {
          var o = el("option", { value: w[0] }, esc(w[1]));
          if (w[0] === (ctx.params.week || "dear")) o.selected = true;
          sel.appendChild(o);
        });
        for (var k = 1; k <= 52; k++) {
          var o2 = el("option", { value: String(k) }, "Week " + k);
          if (String(k) === ctx.params.week) o2.selected = true;
          sel.appendChild(o2);
        }
        sel.addEventListener("change", function () { onChange({ week: sel.value }); });
      } else if (c === "yscale") {
        lab.innerHTML = "Prices ";
        sel = el("select", {});
        [["body", "up to 300 EUR/MWh"], ["log", "all, on a log scale"]].forEach(function (y) {
          var o = el("option", { value: y[0] }, y[1]);
          if (y[0] === (ctx.params.yscale || "body")) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener("change", function () { onChange({ yscale: sel.value }); });
      } else if (c === "snap") {
        lab.innerHTML = "Segment ";
        sel = el("select", {});
        [["dear", "with the year's highest price"], ["cheap", "with the year's lowest price"]].forEach(function (y) {
          var o = el("option", { value: y[0] }, y[1]);
          if (y[0] === (ctx.params.snap || "dear")) o.selected = true;
          sel.appendChild(o);
        });
        var num = el("input", { type: "number", min: 0, max: U.n(ctx.s) - 1, step: 1, value: /^\d+$/.test(ctx.params.snap || "") ? ctx.params.snap : "",
          placeholder: "or a number", style: "width:7rem", "aria-label": "Segment number" });
        num.addEventListener("change", function () { onChange({ snap: num.value }); });
        sel.addEventListener("change", function () { onChange({ snap: sel.value }); });
        lab.appendChild(sel); lab.appendChild(document.createTextNode(" ")); lab.appendChild(num);
        box.appendChild(lab);
        return;
      }
      lab.appendChild(sel);
      box.appendChild(lab);
    });
    return box;
  }
  function defaultZone(fig, ctx) {
    // Prices are read zone by zone; quantities default to the model's focus
    // (Denmark in section 7, all twelve zones in section 8).
    if (fig.zones) return fig.zones[0];
    var priced = fig === F["price-duration"] || fig === F.heatmap || fig === F.inspector || fig === F.electrolyser;
    if (ctx && ctx.zone === "ALL") return priced ? "DE" : "ALL";
    return (fig === F["price-duration"] || fig === F.heatmap) ? "DK1" : (fig === F.inspector ? "DK2" : "DK");
  }

  // A figure on its own card. With a comparison, a figure that draws the
  // comparison itself (compare: "overlay") is drawn once; any other is drawn
  // twice, one drawing per scenario, side by side or, for a wide figure,
  // one above the other, on shared scales.
  function figureCard(id, ctx, opts) {
    var fig = F[id], card = el("section", { class: "ex-fig", id: "fig-" + id });
    var params = Object.assign({}, ctx.params);
    if (!params.zone) params.zone = defaultZone(fig, ctx);
    var local = Object.assign({}, ctx, { params: params });
    var title = typeof fig.title === "function" ? fig.title(local) : fig.title;
    var head = el("div", { class: "ex-fig-head" });
    head.appendChild(el("h2", {}, esc(title)));
    var tools = el("div", { class: "ex-fig-tools" });
    var tableBtn = el("button", { type: "button", "aria-pressed": "false" }, "Table");
    tools.appendChild(tableBtn);
    if (!opts.embed) {
      tools.appendChild(el("a", { href: href(["figure", id], Object.assign({ m: ctx.model, s: ctx.sId, c: ctx.cId || "" }, ctx.params)),
        title: "This figure alone, with its address" }, "Link"));
    } else {
      tools.appendChild(el("a", { href: href(["m", ctx.model], Object.assign({ s: ctx.sId, c: ctx.cId || "", fig: id }, ctx.params)),
        target: "_blank", rel: "noopener" }, "Open in the Explorer"));
    }
    head.appendChild(tools);
    card.appendChild(head);
    card.appendChild(el("p", { class: "ex-fig-shows" }, esc(typeof fig.shows === "function" ? fig.shows(local) : fig.shows)));
    card.appendChild(controlsFor(fig, local, function (change) { opts.onParams(change); }));

    var pair = !!(local.c && fig.compare !== "overlay");
    var runs = pair ? pairContexts(fig, local) : [local];
    var outs = runs.map(function (r) { return drawSafely(fig, r); });
    if (pair) harmonise(outs);
    var holder = card;
    if (pair) {
      holder = el("div", { class: "ex-pair" + (fig.wide ? " is-stacked" : "") });
      card.appendChild(holder);
    }
    var panels = runs.map(function (r, i) {
      var into = holder;
      if (pair) {
        into = el("div", { class: "ex-pane" + (i ? " is-comparison" : "") });
        into.appendChild(el("p", { class: "ex-pane-head" },
          '<span class="ex-pane-tag">' + (i ? "Compared with" : "This scenario") + "</span> " + esc(r.sLabel)));
        holder.appendChild(into);
      }
      return mount(into, outs[i], title, id + "-" + r.sId);
    });
    // A note that says the same under both drawings is said once, below them.
    if (pair && outs[0].note && outs[0].note === outs[1].note && !outs[0].error && !outs[1].error) {
      panels.forEach(function (p) { p.note.setAttribute("hidden", ""); });
      card.appendChild(el("p", { class: "ex-muted ex-note" }, esc(outs[0].note)));
    }
    setTimeout(function () {
      Promise.all(panels.map(function (p) { return p.plot(); })).then(function (gds) {
        if (pair) shareRanges(gds.filter(Boolean));
      });
    }, 0);
    tableBtn.addEventListener("click", function () {
      var show = tableBtn.getAttribute("aria-pressed") !== "true";
      panels.forEach(function (p) {
        if (show) { p.table.innerHTML = tableHTML(p.out.table); p.table.removeAttribute("hidden"); }
        else p.table.setAttribute("hidden", "");
      });
      tableBtn.setAttribute("aria-pressed", String(show));
      tableBtn.textContent = show ? "Hide table" : "Table";
    });
    return card;
  }
  function drawSafely(fig, ctx) {
    try { return fig.draw(ctx); }
    catch (e) { return { error: e.message, traces: [], layout: {}, table: null }; }
  }
  // The two drawings of a compared figure: each scenario on its own, and
  // whatever the figure says they must share (the week, the hour).
  function pairContexts(fig, ctx) {
    var mine = Object.assign({}, ctx, { c: null, cId: "", cLabel: "", kpiC: null });
    var shared = {};
    try { shared = fig.pairParams ? fig.pairParams(mine) : {}; } catch (e) { shared = {}; }
    mine.params = Object.assign({}, ctx.params, shared);
    var theirs = Object.assign({}, ctx, { s: ctx.c, sId: ctx.cId, sLabel: ctx.cLabel, kpiS: ctx.kpiC,
      c: null, cId: "", cLabel: "", kpiC: null, params: Object.assign({}, ctx.params, shared) });
    return [mine, theirs];
  }
  // Before drawing: the same height, colour scale and order of categories in
  // both drawings, so that a bar, a cell or a row means the same in each.
  function harmonise(outs) {
    var ok = outs.filter(function (o) { return !o.error && o.traces.length; });
    if (ok.length < 2) return;
    var h = Math.max.apply(null, ok.map(function (o) { return o.layout.height || 0; }));
    if (h) ok.forEach(function (o) { o.layout.height = h; });
    var z = [Infinity, -Infinity], c = [Infinity, -Infinity];
    var each = function (f) { ok.forEach(function (o) { o.traces.forEach(f); }); };
    each(function (t) {
      if (t.type === "heatmap" && isFinite(t.zmin) && isFinite(t.zmax)) { z[0] = Math.min(z[0], t.zmin); z[1] = Math.max(z[1], t.zmax); }
      if (t.marker && isFinite(t.marker.cmin) && isFinite(t.marker.cmax)) { c[0] = Math.min(c[0], t.marker.cmin); c[1] = Math.max(c[1], t.marker.cmax); }
    });
    each(function (t) {
      if (t.type === "heatmap" && isFinite(t.zmin) && isFinite(z[0])) { t.zmin = z[0]; t.zmax = z[1]; }
      if (t.marker && isFinite(t.marker.cmin) && isFinite(c[0])) { t.marker.cmin = c[0]; t.marker.cmax = c[1]; }
    });
    ["x", "y"].forEach(function (a) {
      var order = [], seen = {}, text = true;
      each(function (t) {
        if (t.type === "heatmap" || (t[a + "axis"] || a) !== a) return;
        (t[a] || []).forEach(function (v) {
          if (v === null || v === undefined) return;
          if (typeof v !== "string") { text = false; return; }
          if (!seen[v]) { seen[v] = 1; order.push(v); }
        });
      });
      if (!text || !order.length) return;
      ok.forEach(function (o) {
        o.layout[a + "axis"] = Object.assign({}, o.layout[a + "axis"] || {}, { categoryorder: "array", categoryarray: order });
        // An invisible trace holding every category, so a row that only one
        // scenario has is an empty row in the other, and the rows line up.
        var none = order.map(function () { return null; });
        o.traces.push({ type: "scatter", mode: "markers", x: a === "x" ? order : none, y: a === "y" ? order : none,
          showlegend: false, hoverinfo: "skip", marker: { opacity: 0 } });
      });
    });
  }
  // After drawing: every numeric axis on the range that holds both.
  function shareRanges(gds) {
    if (gds.length < 2 || gds.some(function (g) { return !g._fullLayout; })) return;
    var updates = gds.map(function () { return {}; });
    Object.keys(gds[0]._fullLayout).forEach(function (k) {
      if (!/^[xy]axis\d*$/.test(k)) return;
      var axes = gds.map(function (g) { return g._fullLayout[k]; });
      if (axes.some(function (ax) {
        return !ax || !ax.range || ax.visible === false || ax.type === "category" || ax.type === "date" || ax.type === "multicategory";
      })) return;
      var lo = Infinity, hi = -Infinity, reversed = false;
      axes.forEach(function (ax) {
        lo = Math.min(lo, ax.range[0], ax.range[1]); hi = Math.max(hi, ax.range[0], ax.range[1]);
        if (ax.range[0] > ax.range[1]) reversed = true;
      });
      if (!isFinite(lo) || !isFinite(hi)) return;
      var range = reversed ? [hi, lo] : [lo, hi];
      axes.forEach(function (ax, i) {
        if (ax.range[0] !== range[0] || ax.range[1] !== range[1]) updates[i][k + ".range"] = range;
      });
    });
    gds.forEach(function (g, i) { if (Object.keys(updates[i]).length) window.Plotly.relayout(g, updates[i]); });
  }
  // One drawing: the plot (or the figure's own HTML), its note, its table.
  function mount(parent, out, title, filename) {
    var plot = el("div", { class: "ex-plot", role: "img", "aria-label": title });
    var note = el("p", { class: "ex-muted ex-note" });
    var table = el("div", { class: "ex-table-wrap", hidden: "" });
    parent.appendChild(plot);
    parent.appendChild(note);
    parent.appendChild(table);
    var pane = { out: out, note: note, table: table, plot: function () { return Promise.resolve(null); } };
    if (out.error) {
      plot.className = "ex-plot is-empty";
      plot.innerHTML = '<p class="ex-muted">This figure could not be drawn for this scenario (' + esc(out.error) + ").</p>";
      return pane;
    }
    note.textContent = out.note || "";
    if (!out.note) note.setAttribute("hidden", "");
    if (out.html !== undefined) {
      plot.className = "ex-plot is-html";
      plot.removeAttribute("role");
      plot.innerHTML = out.html;
      return pane;
    }
    if (!out.traces.length) { plot.className = "ex-plot is-empty"; return pane; }
    // The plot keeps the figure's own height. Plotly's responsive resize
    // re-measures the div, and an embed resized while its plot was being
    // drawn came out squeezed to the div's min-height.
    if (typeof out.layout.height === "number") plot.style.height = out.layout.height + "px";
    pane.plot = function () {
      return window.Plotly.react(plot, out.traces, out.layout, { displaylogo: false, responsive: true,
        modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d"], toImageButtonOptions: { filename: filename } });
    };
    return pane;
  }
  function tableHTML(t) {
    if (!t || !t.columns || !t.columns.length) return '<p class="ex-muted">No table for this figure.</p>';
    var num = function (v) { return /^[–−\-+]?[\d,.\s]+%?$/.test(String(v)); };
    return '<table class="ex-table"><thead><tr>' + t.columns.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") +
      "</tr></thead><tbody>" + t.rows.map(function (r) {
        return "<tr>" + r.map(function (v) { return '<td class="' + (num(v) ? "num" : "") + '">' + esc(v) + "</td>"; }).join("") + "</tr>";
      }).join("") + "</tbody></table>";
  }

  // -- what each model shows ------------------------------------------------------
  // The headline numbers, the figures in groups (the first figure shown when
  // none is asked for), the default zone and the columns of the scenario
  // table. Section 7 is about Denmark inside a fixed neighbourhood; section
  // 8 about the whole system under one budget.
  var VIEWS = {
    greenfield: {
      zone: "DK",
      first: "capacity",
      tiles: [
        ["dk_net_cost", "Danish net cost", 1e9, 2, "bn EUR"],
        ["emissions_t", "Danish emissions", 1e6, 2, "Mt"],
        ["emissions_abroad_t", "Emissions abroad", 1e6, 1, "Mt"],
        ["dk_price", "Danish price", 1, 1, "EUR/MWh"],
        ["cap_wind_offshore_mw", "Offshore wind", 1e3, 1, "GW"],
        ["cap_battery_mw", "Batteries", 1e3, 1, "GW"],
        ["cap_ocgt_mw", "Gas peakers", 1e3, 2, "GW"],
        ["dk_net_import_mwh", "Net imports", 1e6, 1, "TWh"],
      ],
      tabs: [
        ["overview", "Overview", ["numbers", "capacity", "energy", "price-duration", "bill"]],
        ["operation", "Operation", ["dispatch", "setter", "heatmap", "storage", "inspector"]],
        ["money", "Money", ["recovery", "value", "bands", "screening", "levels"]],
        ["network", "Trade and emissions", ["map", "trade", "emissions", "abroad"]],
      ],
      table: ["dk_net_cost", "emissions_t", "emissions_total_t", "dk_price", "cap_solar_mw", "cap_wind_onshore_mw",
        "cap_wind_offshore_mw", "cap_ocgt_mw", "cap_ocgt_biogas_mw", "cap_battery_mw", "dk_net_import_mwh", "dk_curtailment_share", "dk_shed_voll_mwh"],
    },
    expansion: {
      zone: "ALL",
      first: "capacity",
      tiles: [
        ["carbon_price", "Carbon price", 1, 0, "EUR/t"],
        ["system_cost", "System cost", 1e9, 1, "bn EUR"],
        ["emissions_total_t", "Emissions", 1e6, 1, "Mt"],
        ["all_cap_battery_mw", "Batteries", 1e3, 1, "GW"],
        ["all_cap_electrolyser_mw", "Electrolysers", 1e3, 1, "GW"],
        ["h2_store_mwh", "Hydrogen store", 1e6, 1, "TWh"],
        ["all_cap_h2_turbine_mw", "Hydrogen turbines", 1e3, 1, "GW"],
        ["grid_built_mw", "Interconnectors bought", 1e3, 1, "GW"],
      ],
      tabs: [
        ["overview", "Overview", ["numbers", "capacity", "built-by-zone", "energy", "price-duration"]],
        ["hydrogen", "Hydrogen", ["h2-balance", "h2-store", "electrolyser"]],
        ["operation", "Operation", ["dispatch", "storage", "heatmap", "inspector"]],
        ["network", "Grid, emissions and money", ["map", "grid", "emissions", "recovery"]],
      ],
      table: ["carbon_price", "system_cost", "emissions_total_t", "all_cap_solar_mw", "all_cap_wind_onshore_mw",
        "all_cap_wind_offshore_mw", "all_cap_battery_mw", "all_cap_ocgt_biogas_mw", "all_cap_electrolyser_mw",
        "h2_store_mwh", "electrolyser_flh", "grid_built_mw"],
    },
  };
  function viewOf(m) { return VIEWS[m] || VIEWS.greenfield; }
  function figureIds(view) {
    return [].concat.apply([], view.tabs.map(function (t) { return t[2]; })).filter(function (id) { return F[id]; });
  }

  // -- views --------------------------------------------------------------------
  function ctxFor(m, cat, sId, cId, sData, cData, q, rows) {
    var label = function (id) { var x = cat.scenarios.find(function (s) { return s.id === id; }); return x ? x.label : id; };
    var row = function (id) { return (rows || []).find(function (x) { return x.id === id; }) || null; };
    var params = {};
    ["zone", "week", "yscale", "snap"].forEach(function (k) { if (q[k]) params[k] = q[k]; });
    U.allZones = cat.zones.map(function (z) { return z.id; });
    var view = viewOf(m);
    return { model: m, cat: cat, s: sData, c: cData, sId: sId, cId: cId, sLabel: label(sId), cLabel: cId ? label(cId) : "", params: params,
             zone: view.zone, tiles: view.tiles, kpiS: row(sId), kpiC: cId ? row(cId) : null };
  }

  function viewBoard(m, q) {
    return Promise.all([catalogue(m), kpis(m)]).then(function (r) {
      var cat = r[0], rows = r[1];
      var sId = q.s || cat.reference, cId = q.c || "";
      var s = cat.scenarios.find(function (x) { return x.id === sId && x.available; });
      if (!s) { sId = cat.reference; s = cat.scenarios.find(function (x) { return x.id === sId; }); }
      if (cId === sId || !cat.scenarios.some(function (x) { return x.id === cId && x.available; })) cId = "";
      return Promise.all([scenario(m, sId), cId ? scenario(m, cId) : null]).then(function (data) {
        var view = viewOf(m);
        var ctx = ctxFor(m, cat, sId, cId, data[0], data[1], q, rows);
        var all = figureIds(view);
        var figId = all.indexOf(q.fig) >= 0 ? q.fig : (all.indexOf(view.first) >= 0 ? view.first : all[0]);
        // Keep what the reader had: the lists' scroll and the control in focus.
        if (ui.model !== m) { ui.scroll = {}; ui.model = m; }
        Array.prototype.forEach.call(main.querySelectorAll(".ex-sec-body"), function (b) { ui.scroll[b.id] = b.scrollTop; });
        var focus = document.activeElement && document.activeElement.id;
        main.innerHTML = "";
        var page = el("div", { class: "ex-page" });
        page.appendChild(modelHeader(cat));
        var board = el("div", { class: "ex-split" });
        var left = el("aside", { class: "ex-left" });
        left.appendChild(panel([
          { key: "scenario", label: "Scenario", value: s.label, body: scenarioSection(cat, s, m, q) },
          { key: "compare", label: "Compare with", value: cId ? ctx.cLabel : "Nothing", body: compareSection(cat, s, cId, m, q) },
          { key: "figure", label: "Figure", value: navTitle(figId, ctx), body: figureSection(view, ctx, figId, m, q) },
        ]));
        board.appendChild(left);
        var right = el("section", { class: "ex-right", "aria-label": "Figure" });
        var card = figureCard(figId, ctx, { onParams: function (change) { go(["m", m], Object.assign({}, q, change), true); } });
        right.appendChild(card);
        board.appendChild(right);
        page.appendChild(board);
        main.appendChild(page);
        fitPanel();
        Array.prototype.forEach.call(left.querySelectorAll(".ex-sec-body"), function (b) {
          if (ui.scroll[b.id] !== undefined) b.scrollTop = ui.scroll[b.id];
          else { var cur = b.querySelector(".is-current"); if (cur) reveal(cur, b); }   // the figure on screen
        });
        if (focus) {                                     // the lever just moved, still in hand and in view
          var f = document.getElementById(focus);
          if (f && f !== document.activeElement) {
            f.focus({ preventScroll: true });
            var box = f.closest(".ex-sec-body");
            if (box) reveal(f.closest(".ex-lever") || f, box);
          }
        }
        if (ui.toFigure) { ui.toFigure = false; card.scrollIntoView({ block: "start" }); }
      });
    });
  }

  function viewFigure(id, q) {
    var m = q.m || "greenfield";
    if (!F[id]) { main.innerHTML = "<p>No figure called " + esc(id) + ".</p>"; return Promise.resolve(); }
    if (q.embed) document.body.classList.add("is-embed");
    return Promise.all([catalogue(m), F[id].usesKpis ? kpis(m) : null]).then(function (r) {
      var cat = r[0], rows = r[1];
      var sId = q.s || cat.reference, cId = q.c || "";
      if (cId === sId) cId = "";
      return Promise.all([scenario(m, sId), cId ? scenario(m, cId) : null]).then(function (data) {
        var ctx = ctxFor(m, cat, sId, cId, data[0], data[1], q, rows);
        main.innerHTML = "";
        var card = figureCard(id, ctx, { embed: !!q.embed, onParams: function (change) {
          go(["figure", id], Object.assign({}, q, change), true); } });
        if (!q.embed) {
          main.appendChild(el("p", { class: "ex-muted" }, esc(ctx.sLabel) + (cId ? " against " + esc(ctx.cLabel) : "") +
            '. <a href="' + href(["m", m], Object.assign({ s: sId, c: cId, fig: id }, ctx.params)) + '">All figures for this scenario</a>'));
        }
        main.appendChild(card);
      });
    });
  }

  function viewSweep(m, q) {
    return Promise.all([catalogue(m), kpis(m)]).then(function (r) {
      var cat = r[0], rows = r[1];
      var byId = {}; rows.forEach(function (x) { byId[x.id] = x; });
      var sweeps = cat.levers.filter(function (l) { return l.kind === "sweep"; });
      var leverId = q.lever || "carbon_price", metric = q.metric || "cap_battery_mw";
      var lever = cat.levers.find(function (l) { return l.id === leverId; }) || sweeps[0];
      var met = cat.metrics.find(function (x) { return x.id === metric; }) || cat.metrics[0];
      // Families: the one-at-a-time sweep from the reference, plus every
      // crossed variant that moves this lever with one or two others (the
      // tax-against-cap years move the rung and the instrument together).
      var families = {};
      cat.scenarios.forEach(function (s) {
        if (!s.available || !byId[s.id]) return;
        var others = cat.levers.filter(function (l) { return l.id !== lever.id && String(leverValue(s, l)) !== String(l.reference); });
        if (others.length > 2) return;
        var key = others.map(function (l) { return l.id + "=" + leverValue(s, l); }).join("&");
        var name = others.length ? others.map(function (l) { return l.label + ": " + fmtLever(l, leverValue(s, l)); }).join("; ")
          : "Everything else at the reference";
        (families[key] = families[key] || { name: name, pts: [] }).pts.push({ x: +leverValue(s, lever), y: byId[s.id][met.id], id: s.id });
      });
      var famKeys = Object.keys(families).filter(function (k) { return families[k].pts.length >= 2 || k === ""; });
      main.innerHTML = "";
      if (!q.embed) {
        main.appendChild(el("h1", {}, "Sweeps"));
        main.appendChild(el("p", { class: "ex-desc" }, "One quantity against one lever, across every solved scenario that moves only that lever, and the crossed ones that move one other with it."));
      }
      var controls = el("div", { class: "ex-sweep-controls" });
      var lsel = el("select", {}), msel = el("select", {});
      sweeps.forEach(function (l) {
        var o = el("option", { value: l.id }, esc(l.label)); if (l.id === lever.id) o.selected = true; lsel.appendChild(o);
      });
      cat.metrics.forEach(function (x) {
        var o = el("option", { value: x.id }, esc(x.label + (x.unit ? " (" + x.unit + ")" : ""))); if (x.id === met.id) o.selected = true; msel.appendChild(o);
      });
      var l1 = el("label", {}, "Lever"); l1.appendChild(lsel);
      var l2 = el("label", {}, "Quantity"); l2.appendChild(msel);
      controls.appendChild(l1); controls.appendChild(l2);
      lsel.addEventListener("change", function () { go(["m", m, "sweep"], { lever: lsel.value, metric: met.id, crossed: q.crossed, embed: q.embed }, true); });
      msel.addEventListener("change", function () { go(["m", m, "sweep"], { lever: lever.id, metric: msel.value, crossed: q.crossed, embed: q.embed }, true); });
      main.appendChild(controls);
      var card = el("section", { class: "ex-fig" });
      var plot = el("div", { class: "ex-plot", role: "img", "aria-label": met.label + " against " + lever.label });
      card.appendChild(plot);
      main.appendChild(card);
      var palette = ["--ink", "--accent", "--critical", "--muted", "--stop"];
      // crossed=off opens on the one-at-a-time sweep alone, for a question
      // about that one curve (RKB, 2026-10-14); the crossed variants wait in
      // the legend and the table, a click away.
      var traces = famKeys.map(function (k, i) {
        var pts = families[k].pts.slice().sort(function (a, b) { return a.x - b.x; });
        return { type: "scatter", mode: "lines+markers", name: families[k].name, x: pts.map(function (p) { return p.x; }),
          visible: q.crossed === "off" && k !== "" ? "legendonly" : true,
          y: pts.map(function (p) { return p.y === null || p.y === undefined ? null : p.y / (met.scale || 1); }),
          customdata: pts.map(function (p) { return p.id; }),
          line: { width: k === "" ? 2.4 : 1.8, color: U.css(palette[i % palette.length]), dash: k === "" ? "solid" : ["dash", "dot", "dashdot", "longdash"][i % 4] },
          marker: { size: 8, line: { width: 2, color: U.css("--card") } },
          hovertemplate: "%{x}: %{y:.3g}<extra>" + esc(families[k].name) + "</extra>" };
      });
      var refX = +lever.reference, logX = lever.axis === "log";
      plot.style.height = "460px";    // as a figure's: see mount
      window.Plotly.react(plot, traces, U.layout({ height: 460,
        xaxis: { title: U.axisTitle(lever.label + (lever.unit ? " (" + lever.unit + ")" : "") + (logX ? ", log scale" : "")),
                 type: logX ? "log" : "linear" },
        yaxis: { title: U.axisTitle(met.label + (met.unit ? " (" + met.unit + ")" : "")) },
        shapes: isFinite(refX) ? [{ type: "line", x0: refX, x1: refX, yref: "paper", y0: 0, y1: 1, line: { color: U.css("--axis"), width: 1 } }] : [],
        // An annotation on a log axis takes the log of its position; a shape does not.
        annotations: isFinite(refX) ? [{ x: logX ? Math.log10(refX) : refX, yref: "paper", y: 1, text: "reference", showarrow: false, yanchor: "bottom", font: { size: 11, color: U.css("--ink-2") } }] : [] }),
        { displaylogo: false, responsive: true });
      plot.on("plotly_click", function (ev) {
        var id = ev.points[0].customdata;
        if (!id) return;
        if (q.embed) window.open(href(["m", m], { s: id }), "_blank", "noopener");
        else go(["m", m], { s: id });
      });
      card.appendChild(el("p", { class: "ex-muted" }, "Click a point to open that scenario."));
      var tbl = { columns: [lever.label].concat(famKeys.map(function (k) { return families[k].name; })), rows: [] };
      var xs = {};
      famKeys.forEach(function (k) { families[k].pts.forEach(function (p) { xs[p.x] = 1; }); });
      Object.keys(xs).map(Number).sort(function (a, b) { return a - b; }).forEach(function (x) {
        tbl.rows.push([fmtLever(lever, x)].concat(famKeys.map(function (k) {
          var p = families[k].pts.find(function (pp) { return pp.x === x; });
          return p && p.y !== null && p.y !== undefined ? U.fmt(p.y / (met.scale || 1), 3) : "";
        })));
      });
      var tw = el("div", { class: "ex-table-wrap" }, tableHTML(tbl));
      card.appendChild(tw);
    });
  }

  function viewTable(m, q) {
    return Promise.all([catalogue(m), kpis(m)]).then(function (r) {
      var cat = r[0], rows = r[1];
      var cols = viewOf(m).table;
      var mets = cols.map(function (c) { return cat.metrics.find(function (x) { return x.id === c; }); }).filter(Boolean);
      main.innerHTML = "";
      main.appendChild(el("h1", {}, "Every scenario"));
      main.appendChild(el("p", { class: "ex-desc" }, "One row per solved scenario. Click a name to open it. The download gives every quantity the sweeps offer, as a CSV file for a spreadsheet."));
      var dl = el("button", { class: "btn-ex", type: "button" }, "Download as CSV");
      dl.addEventListener("click", function () {
        var all = cat.metrics;
        var lines = [["scenario", "label"].concat(all.map(function (x) { return x.id; })).join(",")];
        rows.forEach(function (rw) {
          var sc = cat.scenarios.find(function (s) { return s.id === rw.id; });
          lines.push([rw.id, '"' + (sc ? sc.label : "").replace(/"/g, "'") + '"'].concat(all.map(function (x) {
            var v = rw[x.id]; return v === null || v === undefined ? "" : v; })).join(","));
        });
        var blob = new Blob([lines.join("\n")], { type: "text/csv" });
        var a = el("a", { href: URL.createObjectURL(blob), download: m + "-scenarios.csv" });
        document.body.appendChild(a); a.click(); a.remove();
      });
      main.appendChild(dl);
      var html = '<div class="ex-table-wrap" style="margin-top:0.8rem"><table class="ex-table"><thead><tr><th>Scenario</th>' +
        mets.map(function (x) { return '<th class="num">' + esc(x.label) + "<br><small>" + esc(x.unit) + "</small></th>"; }).join("") + "</tr></thead><tbody>";
      cat.scenarios.forEach(function (s) {
        var rw = rows.find(function (x) { return x.id === s.id; });
        if (!rw) return;
        html += '<tr class="' + (s.id === cat.reference ? "is-current" : "") + '"><td><a href="' + href(["m", m], { s: s.id }) + '">' + esc(s.label) + "</a></td>" +
          mets.map(function (x) { var v = rw[x.id]; return '<td class="num">' + (v === null || v === undefined ? "–" : U.fmt(v / (x.scale || 1), x.scale === 0.01 ? 1 : 2)) + "</td>"; }).join("") + "</tr>";
      });
      html += "</tbody></table></div>";
      main.appendChild(el("div", {}, html));
    });
  }

  function viewHome() {
    var p = store.models || (store.models = getJSON("data/models.json"));
    return p.then(function (models) {
      main.innerHTML = "";
      main.appendChild(el("h1", {}, "Model Explorer"));
      main.appendChild(el("p", { class: "ex-desc" }, "The models of the lecture notes, solved in advance under many shocks. Move a lever, compare two worlds, sweep a parameter, and read what the model does, figure by figure. Nothing here needs code."));
      var cards = el("div", { class: "ex-home-cards" });
      models.forEach(function (x) {
        cards.appendChild(el("article", { class: "ex-card" }, "<h2>" + esc(x.title) + "</h2><p class=\"ex-muted\">" + esc(x.note) + ", " + x.scenarios +
          ' solved scenarios.</p><p><a class="btn-ex" href="#/m/' + esc(x.id) + '">Open</a> <a href="#/m/' + esc(x.id) + '/sweep">Sweeps</a> · <a href="#/m/' + esc(x.id) + '/table">All scenarios</a></p>'));
      });
      main.appendChild(cards);
    });
  }

  // The top bar follows the model on screen: its scenarios, sweeps and table.
  function setNav(model) {
    var nav = document.querySelector(".ex-nav");
    if (!nav) return;
    var links = ['<a href="#/">Models</a>'];
    if (model) {
      links.push('<a href="#/m/' + esc(model) + '">Scenarios</a>', '<a href="#/m/' + esc(model) + '/sweep">Sweeps</a>',
                 '<a href="#/m/' + esc(model) + '/table">All scenarios</a>');
    }
    nav.innerHTML = links.join("");
  }

  // A new view starts at the top; a change within a view keeps the window
  // where it is.
  function render() {
    var r = route(), p = r.parts, job, path = p.join("/");
    var samePage = path === ui.path;
    ui.path = path;
    document.body.classList.toggle("is-embed", !!r.q.embed);
    setNav(p[0] === "m" ? p[1] : p[0] === "figure" ? (r.q.m || "greenfield") : null);
    if (!p.length) job = viewHome();
    else if (p[0] === "figure" && p[1]) job = viewFigure(p[1], r.q);
    else if (p[0] === "m" && p[1] && p[2] === "sweep") job = viewSweep(p[1], r.q);
    else if (p[0] === "m" && p[1] && p[2] === "table") job = viewTable(p[1], r.q);
    else if (p[0] === "m" && p[1]) job = viewBoard(p[1], r.q);
    else job = viewHome();
    Promise.resolve(job).then(function () {
      if (!samePage) window.scrollTo(0, 0);
      else if (ui.restoreY !== null) window.scrollTo(0, ui.restoreY);
      ui.restoreY = null;
    }).catch(function (e) {
      main.innerHTML = '<p>Something went wrong loading this view: ' + esc(e.message) + "</p>";
    });
  }

  // Embedded in the Lab, tell the page around us how tall we are, so the
  // frame fits the figure instead of scrolling inside it. Only a number is
  // sent, and the Lab accepts only a number.
  if (window.parent !== window && window.ResizeObserver) {
    new ResizeObserver(function () {
      if (!document.body.classList.contains("is-embed")) return;
      window.parent.postMessage({ explorerHeight: Math.ceil(document.documentElement.scrollHeight) }, "*");
    }).observe(document.body);
  }

  window.addEventListener("hashchange", render);
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
  }
  render();
})();
