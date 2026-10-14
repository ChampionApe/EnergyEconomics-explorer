/* The Explorer: routes, the lever panel, the board of figures, sweeps and
 * the scenario table. Everything is computed in the
 * browser from data/<model>/: catalogue.json, kpis.json and one file per
 * scenario, fetched when first needed.
 *
 * Routes (also how the Lab embeds a view):
 *   #/                                  home
 *   #/m/<model>?s=&c=&tab=&zone=&week=  the board
 *   #/m/<model>/sweep?lever=&metric=&crossed=off
 *   #/m/<model>/table                   every scenario's numbers
 *   #/figure/<id>?m=&s=&c=&zone=&embed=1  one figure, alone
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
    var y = window.scrollY;
    var target = href(parts, q);
    if (location.hash === target) { render(); return; }
    location.hash = target;
    if (keepScroll) setTimeout(function () { window.scrollTo(0, y); }, 0);
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

  // -- changing the scenario (RKB, 2026-10-13: less on the page at once) --------
  // The levers come in groups; one group is open at a time, chosen from a row
  // of chips, instead of every lever of the model in one long panel.

  function leverRow(cat, s, m, q, l, opts) {
    var cur = leverValue(s, l);
    var row = el("div", { class: "ex-lever" + (String(cur) !== String(l.reference) ? " is-moved" : "") });
    var id = "lever-" + l.id;
    row.appendChild(el("label", { for: id }, esc(l.label) + '<span class="ex-lever-value">' + esc(fmtLever(l, cur)) + "</span>"));
    var move = function (v) {
      var target = findScenario(cat, s, l.id, v);
      if (target) go(["m", m], Object.assign({}, q, { s: target.id, c: q.c || (target.id !== cat.reference ? s.id : "") }), true);
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

  function leverControls(cat, s, m, q) {
    var groups = [], byGroup = {};
    cat.levers.forEach(function (l) {
      var opts = leverOptions(cat, s, l);
      if (opts.length < 2) return;
      if (!byGroup[l.group]) { byGroup[l.group] = []; groups.push(l.group); }
      byGroup[l.group].push({ lever: l, opts: opts });
    });
    var box = el("section", { class: "ex-ctl" });
    box.appendChild(el("h2", { class: "ex-ctl-label" }, "Change one assumption"));
    var open = byGroup[q.group] ? q.group : "";
    var chips = el("div", { class: "ex-groups" });
    groups.forEach(function (g) {
      var moved = byGroup[g].some(function (x) { return String(leverValue(s, x.lever)) !== String(x.lever.reference); });
      var b = el("button", { type: "button", class: "ex-group" + (g === open ? " is-open" : "") + (moved ? " is-moved" : ""),
        "aria-expanded": String(g === open) }, esc(g));
      b.addEventListener("click", function () { go(["m", m], Object.assign({}, q, { s: s.id, group: g === open ? "" : g }), true); });
      chips.appendChild(b);
    });
    box.appendChild(chips);
    if (open) {
      var drawer = el("div", { class: "ex-drawer" });
      byGroup[open].forEach(function (x) { drawer.appendChild(leverRow(cat, s, m, q, x.lever, x.opts)); });
      box.appendChild(drawer);
    } else {
      box.appendChild(el("p", { class: "ex-muted ex-ctl-hint" },
        "Open a group to see its levers. Every setting is a solved scenario; moving one lever keeps the others where they are."));
    }
    return box;
  }

  // What this scenario changed, against the reference, as chips.
  function changedChips(cat, s, m, q) {
    var moved = cat.levers.filter(function (l) { return String(leverValue(s, l)) !== String(l.reference); });
    var box = el("div", { class: "ex-changed" });
    if (!moved.length) {
      box.appendChild(el("span", { class: "ex-muted" }, "The reference case: every assumption as the note sets it."));
      return box;
    }
    box.appendChild(el("span", { class: "ex-muted" }, "Changed from the reference:"));
    moved.forEach(function (l) {
      box.appendChild(el("span", { class: "ex-chip" }, esc(l.label) + ": <strong>" + esc(fmtLever(l, leverValue(s, l))) + "</strong>"));
    });
    var back = el("button", { type: "button", class: "ex-linkbtn" }, "Back to the reference");
    back.addEventListener("click", function () { go(["m", m], Object.assign({}, q, { s: cat.reference, c: "", group: q.group })); });
    box.appendChild(back);
    return box;
  }

  // The group a scenario belongs to in a menu: that of the first lever it
  // moves, in the catalogue's order.
  function scenarioGroup(cat, x) {
    var moved = cat.levers.filter(function (l) { return String(leverValue(x, l)) !== String(l.reference); });
    return moved.length ? moved[0].group : "Reference";
  }

  // Compare with nothing, the reference, or one other scenario from a menu
  // grouped by what it changes: three choices, not one long list.
  function compareControl(cat, s, cId, m, q) {
    var box = el("section", { class: "ex-ctl" });
    box.appendChild(el("h2", { class: "ex-ctl-label" }, "Compare with"));
    var row = el("div", { class: "ex-seg" });
    var options = [["", "Nothing"]];
    if (s.id !== cat.reference) options.push([cat.reference, "The reference"]);
    options.forEach(function (o) {
      var b = el("button", { type: "button", class: "ex-seg-btn" + (cId === o[0] ? " is-on" : ""), "aria-pressed": String(cId === o[0]) }, o[1]);
      b.addEventListener("click", function () { go(["m", m], Object.assign({}, q, { s: s.id, c: o[0] }), true); });
      row.appendChild(b);
    });
    var other = cId && cId !== cat.reference;
    var sel = el("select", { class: "ex-seg-select" + (other ? " is-on" : ""), "aria-label": "Another scenario to compare with" });
    sel.appendChild(el("option", { value: "" }, other ? "Another scenario" : "Another scenario…"));
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
    row.appendChild(sel);
    box.appendChild(row);
    if (cId) box.appendChild(el("p", { class: "ex-muted ex-ctl-hint" }, "Figures draw the comparison faded or dashed; the numbers show the difference."));
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

  function figureCard(id, ctx, opts) {
    var fig = F[id], card = el("section", { class: "ex-fig" + (fig.wide ? " is-wide" : ""), id: "fig-" + id });
    var params = Object.assign({}, ctx.params);
    if (!params.zone) params.zone = defaultZone(fig, ctx);
    var local = Object.assign({}, ctx, { params: params });
    var title = typeof fig.title === "function" ? fig.title(local) : fig.title;
    var head = el("div", { class: "ex-fig-head" });
    head.appendChild(el("h3", {}, esc(title)));
    var tools = el("div", { class: "ex-fig-tools" });
    var tableBtn = el("button", { type: "button" }, "Table");
    tools.appendChild(tableBtn);
    if (!opts.embed) {
      var link = el("a", { href: href(["figure", id], Object.assign({ m: ctx.model, s: ctx.sId, c: ctx.cId || "" }, ctx.params)), title: "This figure alone, with its address" }, "Link");
      tools.appendChild(link);
    } else {
      var open = el("a", { href: href(["m", ctx.model], Object.assign({ s: ctx.sId, c: ctx.cId || "" }, ctx.params)), target: "_blank", rel: "noopener" }, "Open in the Explorer");
      tools.appendChild(open);
    }
    head.appendChild(tools);
    card.appendChild(head);
    card.appendChild(el("p", { class: "ex-fig-shows" }, esc(typeof fig.shows === "function" ? fig.shows(local) : fig.shows)));
    card.appendChild(controlsFor(fig, local, function (change) { opts.onParams(change); }));
    var plot = el("div", { class: "ex-plot", role: "img", "aria-label": title });
    card.appendChild(plot);
    var note = el("p", { class: "ex-muted" });
    card.appendChild(note);
    var tableWrap = el("div", { class: "ex-table-wrap", hidden: "" });
    card.appendChild(tableWrap);
    var out;
    try {
      out = fig.draw(local);
    } catch (e) {
      plot.innerHTML = '<p class="ex-muted">This figure could not be drawn for this scenario (' + esc(e.message) + ").</p>";
      return card;
    }
    note.textContent = out.note || "";
    if (!out.traces.length) plot.style.minHeight = "0";
    // The plot keeps the figure's own height. Plotly's responsive resize
    // re-measures the div, and an embed resized while its plot was being
    // drawn came out squeezed to the div's min-height.
    else if (typeof out.layout.height === "number") plot.style.height = out.layout.height + "px";
    setTimeout(function () {
      if (out.traces.length) window.Plotly.react(plot, out.traces, out.layout, { displaylogo: false, responsive: true,
        modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d"], toImageButtonOptions: { filename: id + "-" + ctx.sId } });
    }, 0);
    tableBtn.addEventListener("click", function () {
      if (tableWrap.hasAttribute("hidden")) {
        tableWrap.innerHTML = tableHTML(out.table);
        tableWrap.removeAttribute("hidden");
        tableBtn.textContent = "Hide table";
      } else {
        tableWrap.setAttribute("hidden", "");
        tableBtn.textContent = "Table";
      }
    });
    return card;
  }
  function tableHTML(t) {
    if (!t || !t.columns || !t.columns.length) return '<p class="ex-muted">No table for this figure.</p>';
    var num = function (v) { return /^[–\-+]?[\d,.\s]+%?$/.test(String(v)); };
    return '<table class="ex-table"><thead><tr>' + t.columns.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") +
      "</tr></thead><tbody>" + t.rows.map(function (r) {
        return "<tr>" + r.map(function (v) { return '<td class="' + (num(v) ? "num" : "") + '">' + esc(v) + "</td>"; }).join("") + "</tr>";
      }).join("") + "</tbody></table>";
  }

  // -- what each model shows ------------------------------------------------------
  // The tiles above the figures, the tabs, the default zone and the columns
  // of the scenario table. Section 7 is about Denmark inside a fixed
  // neighbourhood; section 8 about the whole system under one budget.
  var VIEWS = {
    greenfield: {
      zone: "DK",
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
        ["overview", "Overview", ["capacity", "energy", "price-duration", "bill"]],
        ["operation", "Operation", ["dispatch", "setter", "heatmap", "storage", "inspector"]],
        ["money", "Money", ["recovery", "value", "bands", "screening", "levels"]],
        ["network", "Trade and emissions", ["map", "trade", "emissions", "abroad"]],
      ],
      table: ["dk_net_cost", "emissions_t", "emissions_total_t", "dk_price", "cap_solar_mw", "cap_wind_onshore_mw",
        "cap_wind_offshore_mw", "cap_ocgt_mw", "cap_ocgt_biogas_mw", "cap_battery_mw", "dk_net_import_mwh", "dk_curtailment_share", "dk_shed_voll_mwh"],
    },
    expansion: {
      zone: "ALL",
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
        ["overview", "Overview", ["capacity", "built-by-zone", "energy", "price-duration"]],
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

  // -- KPI tiles ----------------------------------------------------------------
  function tiles(list, rowS, rowC, cLabel) {
    // The first four numbers, and the rest one click away. A comparison's
    // name is said once, under the numbers, not in every tile.
    var wrap = el("div", { class: "ex-numbers" });
    var first = el("dl", { class: "ex-tiles" }), more = el("dl", { class: "ex-tiles" });
    var shown = 0;
    list.forEach(function (t) {
      var v = rowS ? rowS[t[0]] : null;
      if (v === null || v === undefined) return;
      var html = "<dt>" + esc(t[1]) + "</dt><dd>" + U.fmt(v / t[2], t[3]) + ' <small class="ex-muted">' + t[4] + "</small>";
      if (rowC && rowC[t[0]] !== null && rowC[t[0]] !== undefined) {
        var dlt = (v - rowC[t[0]]) / t[2];
        html += '<span class="ex-delta">' + (dlt >= 0 ? "+" : "−") + U.fmt(Math.abs(dlt), t[3]) + "</span>";
      }
      html += "</dd>";
      (shown < 4 ? first : more).appendChild(el("div", { class: "ex-tile" }, html));
      shown++;
    });
    wrap.appendChild(first);
    if (rowC) wrap.appendChild(el("p", { class: "ex-muted ex-delta-note" }, "Under each number, the difference from " + esc(cLabel) + "."));
    if (more.children.length) {
      var d = el("details", { class: "ex-more" });
      d.appendChild(el("summary", {}, "More numbers"));
      d.appendChild(more);
      wrap.appendChild(d);
    }
    return wrap;
  }

  // -- views --------------------------------------------------------------------
  function ctxFor(m, cat, sId, cId, sData, cData, q) {
    var label = function (id) { var x = cat.scenarios.find(function (s) { return s.id === id; }); return x ? x.label : id; };
    var params = {};
    ["zone", "week", "yscale", "snap"].forEach(function (k) { if (q[k]) params[k] = q[k]; });
    U.allZones = cat.zones.map(function (z) { return z.id; });
    return { model: m, cat: cat, s: sData, c: cData, sId: sId, cId: cId, sLabel: label(sId), cLabel: cId ? label(cId) : "", params: params,
             zone: viewOf(m).zone };
  }

  // The figures as a short list, grouped as the model's view groups them;
  // one figure on screen at a time.
  function navTitle(id, ctx) {
    var f = F[id], params = Object.assign({}, ctx.params);
    if (!params.zone) params.zone = defaultZone(f, ctx);
    var t = typeof f.title === "function" ? f.title(Object.assign({}, ctx, { params: params })) : f.title;
    return t.split(":")[0];
  }
  function figureNav(view, ctx, figId, m, q) {
    var nav = el("nav", { class: "ex-fignav", "aria-label": "Figures" });
    view.tabs.forEach(function (t) {
      var ids = t[2].filter(function (id) { return F[id]; });
      if (!ids.length) return;
      nav.appendChild(el("h3", {}, esc(t[1])));
      var ul = el("ul", {});
      ids.forEach(function (id) {
        var attrs = { href: href(["m", m], Object.assign({}, q, { fig: id })) };
        if (id === figId) { attrs.class = "is-current"; attrs["aria-current"] = "page"; }
        var li = el("li", {});
        li.appendChild(el("a", attrs, esc(navTitle(id, ctx))));
        ul.appendChild(li);
      });
      nav.appendChild(ul);
    });
    return nav;
  }

  function viewBoard(m, q) {
    return Promise.all([catalogue(m), kpis(m)]).then(function (r) {
      var cat = r[0], rows = r[1];
      var sId = q.s || cat.reference, cId = q.c || "";
      var s = cat.scenarios.find(function (x) { return x.id === sId && x.available; });
      if (!s) { sId = cat.reference; s = cat.scenarios.find(function (x) { return x.id === sId; }); }
      if (cId === sId) cId = "";
      return Promise.all([scenario(m, sId), cId ? scenario(m, cId) : null]).then(function (data) {
        var ctx = ctxFor(m, cat, sId, cId, data[0], data[1], q);
        var view = viewOf(m);
        var all = [].concat.apply([], view.tabs.map(function (t) { return t[2]; }));
        var figId = q.fig && F[q.fig] && all.indexOf(q.fig) >= 0 ? q.fig : all[0];
        // The scenario across the top; below it, the controls on the left
        // and what they do on the right (RKB, 2026-10-13: the figure beside
        // the controls, not under them).
        main.innerHTML = "";
        var page = el("div", { class: "ex-page" });
        var head = el("header", { class: "ex-scen" });
        head.appendChild(el("p", { class: "ex-eyebrow" }, esc(cat.title)));
        head.appendChild(el("h1", {}, esc(s.label)));
        head.appendChild(el("p", { class: "ex-desc" }, esc(s.description)));
        head.appendChild(changedChips(cat, s, m, q));
        page.appendChild(head);
        var board = el("div", { class: "ex-split" });
        var left = el("aside", { class: "ex-left" });
        left.appendChild(leverControls(cat, s, m, q));
        left.appendChild(compareControl(cat, s, cId, m, q));
        var figs = el("section", { class: "ex-ctl" });
        figs.appendChild(el("h2", { class: "ex-ctl-label" }, "Figures"));
        figs.appendChild(figureNav(view, ctx, figId, m, q));
        left.appendChild(figs);
        if (cat.about_html) {
          var about = el("details", { class: "ex-about" });
          about.appendChild(el("summary", {}, "About this model"));
          about.appendChild(el("div", { class: "ex-about-body" }, cat.about_html));
          left.appendChild(about);
        }
        board.appendChild(left);
        var right = el("section", { class: "ex-right" });
        var rowS = rows.find(function (x) { return x.id === sId; }), rowC = cId ? rows.find(function (x) { return x.id === cId; }) : null;
        right.appendChild(tiles(view.tiles, rowS, rowC, ctx.cLabel));
        var card = figureCard(figId, ctx, { onParams: function (change) { go(["m", m], Object.assign({}, q, change), true); } });
        card.classList.add("is-wide");
        right.appendChild(card);
        board.appendChild(right);
        page.appendChild(board);
        main.appendChild(page);
      });
    });
  }

  function viewFigure(id, q) {
    var m = q.m || "greenfield";
    if (!F[id]) { main.innerHTML = "<p>No figure called " + esc(id) + ".</p>"; return Promise.resolve(); }
    if (q.embed) document.body.classList.add("is-embed");
    return catalogue(m).then(function (cat) {
      var sId = q.s || cat.reference, cId = q.c || "";
      return Promise.all([scenario(m, sId), cId ? scenario(m, cId) : null]).then(function (data) {
        var ctx = ctxFor(m, cat, sId, cId, data[0], data[1], q);
        main.innerHTML = "";
        var card = figureCard(id, ctx, { embed: !!q.embed, onParams: function (change) {
          go(["figure", id], Object.assign({}, q, change), true); } });
        card.classList.add("is-wide");
        if (!q.embed) {
          main.appendChild(el("p", { class: "ex-muted" }, esc(ctx.sLabel) + (cId ? " against " + esc(ctx.cLabel) : "") +
            '. <a href="' + href(["m", m], { s: sId, c: cId }) + '">All figures for this scenario</a>'));
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
      lsel.addEventListener("change", function () { go(["m", m, "sweep"], { lever: lsel.value, metric: met.id, crossed: q.crossed, embed: q.embed }); });
      msel.addEventListener("change", function () { go(["m", m, "sweep"], { lever: lever.id, metric: msel.value, crossed: q.crossed, embed: q.embed }); });
      main.appendChild(controls);
      var card = el("section", { class: "ex-fig is-wide" });
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
      plot.style.height = "460px";    // as a figure's: see figureCard
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
        if (q.embed) window.open(href(["m", m], { s: id, c: cat.reference }), "_blank", "noopener");
        else go(["m", m], { s: id, c: cat.reference });
      });
      card.appendChild(el("p", { class: "ex-muted" }, "Click a point to open that scenario, compared with the reference."));
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
        html += '<tr class="' + (s.id === cat.reference ? "is-current" : "") + '"><td><a href="' + href(["m", m], { s: s.id, c: s.id === cat.reference ? "" : cat.reference }) + '">' + esc(s.label) + "</a></td>" +
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

  function render() {
    var r = route(), p = r.parts, job;
    document.body.classList.toggle("is-embed", !!r.q.embed);
    setNav(p[0] === "m" ? p[1] : p[0] === "figure" ? (r.q.m || "greenfield") : null);
    if (!p.length) job = viewHome();
    else if (p[0] === "figure" && p[1]) job = viewFigure(p[1], r.q);
    else if (p[0] === "m" && p[1] && p[2] === "sweep") job = viewSweep(p[1], r.q);
    else if (p[0] === "m" && p[1] && p[2] === "table") job = viewTable(p[1], r.q);
    else if (p[0] === "m" && p[1]) job = viewBoard(p[1], r.q);
    else job = viewHome();
    Promise.resolve(job).catch(function (e) {
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
