/* The Explorer's figures. One entry per figure, each a function of the
 * scenario (and the comparison, when there is one) that returns Plotly
 * traces, a layout and a table: every figure has a table view, so no value
 * is readable only by hovering or only by colour.
 *
 * Conventions (the dataviz method): colour follows the technology group,
 * in the fixed order of lab/pipeline/carriers.py, never the rank; text is
 * ink, never a series colour; one y-axis per panel, so a figure with two
 * measures stacks two panels on a shared time axis; the comparison
 * scenario is drawn dashed or faded, the scenario itself solid.
 *
 * Comparing (RKB, 2026-10-15: every figure compares). A figure that draws
 * the comparison itself says `compare: "overlay"`. Any other is drawn twice
 * by explorer.js, once per scenario, with the same scales, colours and
 * order of rows; `pairParams` names what the two drawings must share (the
 * week of a dispatch, the hour inspected).
 *
 * A key line `  "id": { // figure` is how build.py finds the figure ids, to
 * check the Lab's embeds against them. Keep that form.
 */
(function () {
  "use strict";

  // -- utilities ---------------------------------------------------------------
  var U = {};
  U.css = function (name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  };
  U.dark = function () {
    var t = document.documentElement.getAttribute("data-theme");
    if (t) return t === "dark";
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  };
  U.byId = function (list) {
    var out = {};
    (list || []).forEach(function (x) { out[x.id] = x; });
    return out;
  };
  U.groupColor = function (cat, g) {
    var x = U.byId(cat.groups)[g] || U.byId(cat.groups).other;
    return U.dark() ? x.dark : x.light;
  };
  U.techGroup = function (cat, t) {
    if (t === "battery") return "battery";
    var x = U.byId(cat.technologies)[t];
    return x ? x.group : "other";
  };
  U.techColor = function (cat, t) { return U.groupColor(cat, U.techGroup(cat, t)); };
  U.techLabel = function (cat, t) {
    if (t === "battery") return "Batteries";
    var x = U.byId(cat.technologies)[t];
    return x ? x.label : t;
  };
  U.groupLabel = function (cat, g) { var x = U.byId(cat.groups)[g]; return x ? x.label : g; };
  U.zoneLabel = function (cat, z) { var x = U.byId(cat.zones)[z]; return x ? x.label : z; };
  U.techOrder = function (cat) { return cat.technologies.map(function (t) { return t.id; }); };
  U.groupOrder = function (cat) { return cat.groups.map(function (g) { return g.id; }); };

  U.n = function (d) { return d.offset_hours.length; };
  U.times = function (d) {
    if (!d._times) {
      var t0 = Date.parse(d.start + (d.start.length <= 19 ? "Z" : ""));
      d._times = d.offset_hours.map(function (h) { return new Date(t0 + h * 3600e3); });
    }
    return d._times;
  };
  U.col = function (d, key) { return d.series[key] || null; };
  U.zeros = function (n) { var a = new Array(n); for (var i = 0; i < n; i++) a[i] = 0; return a; };
  U.add = function (a, b) {
    if (!b) return a;
    var out = a.slice();
    for (var i = 0; i < out.length; i++) out[i] += b[i];
    return out;
  };
  U.sumKeys = function (d, keys) {
    var out = U.zeros(U.n(d));
    keys.forEach(function (k) { out = U.add(out, U.col(d, k)); });
    return out;
  };
  U.keys = function (d, prefix) {
    return Object.keys(d.series).filter(function (k) { return k.indexOf(prefix) === 0; });
  };
  U.wsum = function (v, w) { var s = 0; for (var i = 0; i < v.length; i++) s += v[i] * w[i]; return s; };
  U.hours = function (d) { return d.series.hours; };
  // "DK", "NO" and "SE" are a country's zones together, "ALL" every zone of
  // the model.
  U.allZones = ["DK1", "DK2", "DE", "NO1", "NO2", "NO3", "NO4", "NO5", "SE1", "SE2", "SE3", "SE4"];
  U.countries = { DK: ["DK1", "DK2"], NO: ["NO1", "NO2", "NO3", "NO4", "NO5"], SE: ["SE1", "SE2", "SE3", "SE4"] };
  U.zonesFor = function (zone) { return zone === "ALL" ? U.allZones : U.countries[zone] || [zone]; };
  U.zoneName = function (cat, zone) {
    var whole = { DK: "Denmark", NO: "Norway", SE: "Sweden", ALL: "all twelve zones" }[zone];
    return whole || zone + ", " + U.zoneLabel(cat, zone);
  };
  U.zoneSum = function (d, family, zone, tech) {
    var keys = [];
    U.zonesFor(zone).forEach(function (z) {
      var k = family + "|" + z + (tech ? "|" + tech : "");
      if (d.series[k]) keys.push(k);
    });
    return U.sumKeys(d, keys);
  };
  U.price = function (d, zone) {
    // A country, or every zone, as one: the load-weighted mean of its zones.
    if (U.zonesFor(zone).length === 1) return U.col(d, "price|" + zone) || U.zeros(U.n(d));
    var num = U.zeros(U.n(d)), den = U.zeros(U.n(d));
    U.zonesFor(zone).forEach(function (z) {
      var p = U.col(d, "price|" + z), l = U.col(d, "load|" + z);
      if (!p || !l) return;
      for (var i = 0; i < num.length; i++) { num[i] += p[i] * l[i]; den[i] += l[i]; }
    });
    return num.map(function (v, i) { return v / Math.max(den[i], 1e-9); });
  };
  U.duration = function (values, hours) {
    var idx = values.map(function (_, i) { return i; });
    idx.sort(function (a, b) { return values[b] - values[a]; });
    var x = [0], y = [values[idx[0]]], cum = 0;
    idx.forEach(function (i) { cum += hours[i]; x.push(cum); y.push(values[i]); });
    return { x: x, y: y };
  };
  U.fmt = function (x, digits) {
    if (x === null || x === undefined || !isFinite(x)) return "–";
    return Number(x).toLocaleString("en-GB", { minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0 });
  };
  // A number with the decimals its size calls for: 928, 53.3, 2.35.
  U.sig = function (x) {
    if (x === null || x === undefined || !isFinite(x)) return "–";
    var a = Math.abs(x);
    return U.fmt(x, a >= 100 ? 0 : a >= 10 ? 1 : 2);
  };
  U.esc = function (s) {
    return String(s === undefined || s === null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };
  U.tableRows = function (rows) { return rows; };
  U.weekRange = function (d, week) {
    var t = U.times(d), start = t[0].getTime() + (week - 1) * 7 * 24 * 3600e3, end = start + 7 * 24 * 3600e3;
    var ix = [];
    for (var i = 0; i < t.length; i++) if (t[i].getTime() >= start && t[i].getTime() < end) ix.push(i);
    if (ix.length) ix.push(Math.min(ix[ix.length - 1] + 1, t.length - 1));
    return ix;
  };
  U.pick = function (arr, ix) { return ix.map(function (i) { return arr[i]; }); };
  U.hourly = function (d, values) {
    var w = U.hours(d), out = [];
    for (var i = 0; i < values.length; i++) for (var k = 0; k < Math.round(w[i]); k++) out.push(values[i]);
    return out;
  };

  U.layout = function (extra) {
    var ink = U.css("--ink"), muted = U.css("--muted"), grid = U.css("--grid"), axis = U.css("--axis");
    var base = {
      font: { family: U.css("--font") || "system-ui, sans-serif", size: 12.5, color: ink },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      margin: { l: 58, r: 16, t: 10, b: 44 },
      hoverlabel: { font: { family: U.css("--font"), size: 12 } },
      legend: { orientation: "h", y: 1.02, yanchor: "bottom", x: 0, font: { size: 11.5 } },
      xaxis: { gridcolor: grid, linecolor: axis, zeroline: false, tickfont: { color: muted }, automargin: true },
      yaxis: { gridcolor: grid, linecolor: axis, zeroline: false, tickfont: { color: muted }, automargin: true },
      bargap: 0.25,
    };
    return U.merge(base, extra || {});
  };
  // A scenario's own costs per candidate in the model's first focus zone,
  // from its capacity table: annual fixed cost per MW, and running cost per
  // MWh with the scenario's carbon price in it.
  function ownCosts(ctx) {
    var zone = (ctx.cat.focus_zones || ["DK1"])[0], own = {};
    (ctx.s.tables.capacity || []).forEach(function (r) {
      if (r.zone === zone && r.capital_cost !== null && r.capital_cost !== undefined &&
          r.marginal_cost !== null && r.marginal_cost !== undefined) own[r.tech] = r;
    });
    return own;
  }
  U.merge = function (a, b) {
    var out = {};
    Object.keys(a).forEach(function (k) { out[k] = a[k]; });
    Object.keys(b).forEach(function (k) {
      if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a[k] && typeof a[k] === "object")
        out[k] = U.merge(a[k], b[k]);
      else out[k] = b[k];
    });
    return out;
  };
  U.axisTitle = function (text) { return { text: text, font: { size: 12, color: U.css("--ink-2") } }; };

  // Runs over both scenarios: the scenario solid, the comparison faded.
  U.runs = function (ctx) {
    var out = [{ d: ctx.s, label: ctx.sLabel, main: true }];
    if (ctx.c) out.push({ d: ctx.c, label: ctx.cLabel, main: false });
    return out;
  };

  // Bars coloured by technology cannot carry a legend of their own: the key
  // says which run is solid and which faded, in ink.
  U.runLegend = function (ctx) {
    if (!ctx.c) return [];
    return [{ type: "bar", orientation: "h", x: [null], y: [null], name: ctx.sLabel, marker: { color: U.css("--ink-2") }, hoverinfo: "skip" },
            { type: "bar", orientation: "h", x: [null], y: [null], name: ctx.cLabel + " (faded)", marker: { color: U.css("--ink-2"), opacity: 0.35 }, hoverinfo: "skip" }];
  };

  window.EXU = U;

  // -- shared pieces -------------------------------------------------------------
  var DK = ["DK1", "DK2"];
  var DK_TECHS = ["wind_offshore", "wind_onshore", "solar", "ccgt", "ocgt", "ocgt_biogas", "nuclear",
                  "battery_2h", "battery_4h", "battery_8h"];

  // Capacity by technology over `zones`. Its running cost, `mc`, is the
  // capacity-weighted mean of the zones' own (a zone's is the mean over its
  // plants of the technology).
  function capTable(d, zones) {
    var out = {};
    d.tables.capacity.forEach(function (r) {
      if (zones.indexOf(r.zone) < 0) return;
      var e = out[r.tech] || (out[r.tech] = { built: 0, existing: 0, max: 0, hasMax: false, mwh: 0, mc: r.marginal_cost, mw: 0 });
      e.built += r.built_mw; e.existing += r.existing_mw;
      if (r.max_mw !== null && r.max_mw !== undefined) { e.max += r.max_mw; e.hasMax = true; }
      e.mwh += r.energy_mwh || 0;
      var mw = r.built_mw + r.existing_mw;
      if (mw > 0 && r.marginal_cost !== null && r.marginal_cost !== undefined) {
        e.mw += mw;
        e.mc = e.mw === mw ? r.marginal_cost : e.mc + (r.marginal_cost - e.mc) * mw / e.mw;
      }
    });
    return out;
  }
  function genByTech(d, zone) {
    var w = U.hours(d), out = {};
    U.zonesFor(zone).forEach(function (z) {
      U.keys(d, "gen|" + z + "|").forEach(function (k) {
        var t = k.split("|")[2];
        out[t] = (out[t] || 0) + U.wsum(d.series[k], w);
      });
    });
    return out;
  }
  function blockLines(ctx) {
    // The running costs and valuations a price can settle at: those of the
    // gas plants in the chosen zones, built or already there. For a Danish
    // zone, Denmark's, since either Danish zone's price can be set across
    // the Great Belt.
    var zone = ctx.params.zone || (ctx.zone === "ALL" ? "ALL" : "DK1");
    var cap = capTable(ctx.s, DK.indexOf(zone) >= 0 ? DK : U.zonesFor(zone));
    var lines = [];
    [["ocgt", "Gas peaker's running cost"], ["ocgt_biogas", "Biomethane peaker's running cost"],
     ["ccgt", "Combined cycle's running cost"]].forEach(function (x) {
      var c = cap[x[0]];
      if (c && c.built + c.existing > 1) lines.push({ y: c.mc, label: x[1] });
    });
    (ctx.cat.constants.demand_blocks || []).forEach(function (b) {
      lines.push({ y: b[2], label: b[0] === "shed_flex" ? "Flexible demand's valuation" : "Interruptible industry's valuation" });
    });
    return lines;
  }
  function weekOf(ctx) {
    var p = ctx.params.week;
    if (p && /^\d+$/.test(p)) return Math.min(Math.max(+p, 1), 52);
    var d = ctx.s, w = U.hours(d), t = U.times(d), zone = ctx.params.zone || "DK";
    var price = U.price(d, zone), score = new Array(53).fill(0), count = new Array(53).fill(0);
    var wind = U.add(U.zoneSum(d, "avail", zone, "wind_offshore"), U.zoneSum(d, "avail", zone, "wind_onshore"));
    for (var i = 0; i < t.length; i++) {
      var wk = Math.min(52, Math.floor((t[i] - t[0]) / (7 * 24 * 3600e3)) + 1);
      var v = p === "lowwind" ? -wind[i] : p === "highwind" ? wind[i] : p === "cheap" ? -price[i] : price[i];
      score[wk] += v * w[i]; count[wk] += w[i];
    }
    if (p === "summer") return 27;
    if (p === "winter") return 3;
    var best = 1;
    for (var k = 1; k <= 52; k++) if (count[k] > 0 && score[k] / count[k] > score[best] / count[best]) best = k;
    return best;
  }
  var WEEKS = [["dear", "Week with the highest prices"], ["cheap", "Week with the lowest prices"],
               ["lowwind", "Week with the least wind"], ["highwind", "Week with the most wind"],
               ["winter", "A winter week (week 3)"], ["summer", "A summer week (week 27)"]];
  // Every zone, and each country's zones together. Section 7 lists Denmark
  // first, section 8 the whole system.
  var DK_CHOICES = [["DK", "Denmark (DK1 + DK2)"], ["DK1", "DK1, Western Denmark"], ["DK2", "DK2, Eastern Denmark"]];
  var ABROAD_CHOICES = [["DE", "Germany"],
    ["NO", "Norway (NO1 to NO5)"], ["NO1", "NO1, Southeast Norway"], ["NO2", "NO2, Southwest Norway"],
    ["NO3", "NO3, Central Norway"], ["NO4", "NO4, Northern Norway"], ["NO5", "NO5, Western Norway"],
    ["SE", "Sweden (SE1 to SE4)"], ["SE1", "SE1, Northern Sweden"], ["SE2", "SE2, North-central Sweden"],
    ["SE3", "SE3, South-central Sweden"], ["SE4", "SE4, Southern Sweden"]];
  var ZONE_CHOICES = DK_CHOICES.concat(ABROAD_CHOICES, [["ALL", "All twelve zones"]]);
  var ZONE_CHOICES_ALL = [["ALL", "All twelve zones"], ["DE", "Germany"]].concat(DK_CHOICES, ABROAD_CHOICES.slice(1));
  // Technologies that turn electricity into something else: drawn as
  // consumption, never in a generation stack or an inspector's merit order.
  var CONVERSION = ["electrolyser", "ev_charger", "ev_battery", "h2_store_cavern", "h2_store_tank", "smr", "h2_import"];

  // A series spread over the hours its segments cover, then gathered by
  // month (rows) and hour of the day (columns): each cell's median or mean.
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DAY_HOURS = Array.from({ length: 24 }, function (_, i) { return i; });
  function monthHour(d, values, stat) {
    var hourly = U.hourly(d, values), t0 = U.times(d)[0].getTime(), cells = [];
    for (var m = 0; m < 12; m++) { cells.push([]); for (var h = 0; h < 24; h++) cells[m].push([]); }
    for (var k = 0; k < hourly.length; k++) {
      var t = new Date(t0 + k * 3600e3);
      cells[t.getUTCMonth()][t.getUTCHours()].push(hourly[k]);
    }
    return cells.map(function (row) {
      return row.map(function (v) {
        if (!v.length) return null;
        if (stat === "mean") return v.reduce(function (a, b) { return a + b; }, 0) / v.length;
        var s = v.slice().sort(function (a, b) { return a - b; }), i = Math.floor(s.length / 2);
        return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
      });
    });
  }

  // What is at the margin for a Danish zone's price, segment by segment,
  // from what the results hold. A price of 2 EUR/MWh or less is wind and
  // solar in surplus; otherwise the first that holds: a Danish gas plant
  // running part-loaded, flexible demand partly curtailed, power flowing on
  // an interconnector below its capacity, a battery part-loaded; else every
  // option is at a limit. The two Danish zones count as one while power
  // flows on the Great Belt below its capacity.
  var MARGINAL = [
    { id: "surplus", label: "Wind and solar in surplus", color: function (cat) { return U.groupColor(cat, "onshore"); } },
    { id: "trade", label: "Trade with a neighbour", color: function () { return U.css("--muted"); } },
    { id: "battery", label: "Batteries", color: function (cat) { return U.groupColor(cat, "battery"); } },
    { id: "plant", label: "A Danish gas plant", color: function (cat) { return U.groupColor(cat, "gas"); } },
    { id: "flex", label: "Flexible demand", color: function () { return U.css("--critical"); } },
    { id: "other", label: "Every option at a limit", color: function () { return U.css("--ink"); } },
  ];
  function marginal(d, cat, zone) {
    var n = U.n(d), price = U.price(d, zone), cap = {}, out = [];
    d.tables.capacity.forEach(function (r) { cap[r.zone + "|" + r.tech] = r.built_mw + r.existing_mw; });
    var share = ((cat.constants.demand_blocks || []).filter(function (b) { return b[0] === "shed_flex"; })[0] || [0, 0])[1];
    var col = function (k) { return U.col(d, k) || U.zeros(n); };
    var flowing = function (c, i) {
      var f = U.col(d, "flow|" + c.a + ">" + c.b);
      return !!f && Math.abs(f[i]) > 1 && f[i] < 0.995 * c.cap_ab_mw - 1 && f[i] > -0.995 * c.cap_ba_mw + 1;
    };
    var part = function (z, techs, family, i, avail) {
      return techs.some(function (t) {
        var mw = cap[z + "|" + t] || 0, x = col(family + "|" + z + "|" + t)[i];
        return mw >= 1 && x > 1 && x < avail * mw - 1;
      });
    };
    var corridors = d.tables.corridors || [];
    var belt = corridors.filter(function (c) { return DK.indexOf(c.a) >= 0 && DK.indexOf(c.b) >= 0; });
    var abroad = corridors.filter(function (c) { return (DK.indexOf(c.a) >= 0) !== (DK.indexOf(c.b) >= 0); });
    var other = zone === "DK1" ? "DK2" : "DK1", batteries = ["battery_2h", "battery_4h", "battery_8h"];
    for (var i = 0; i < n; i++) {
      var zones = belt.some(function (c) { return flowing(c, i); }) ? [zone, other] : [zone];
      var is = "other";
      if (price[i] <= 2) is = "surplus";
      else if (zones.some(function (z) { return part(z, ["ocgt", "ocgt_biogas", "ccgt"], "gen", i, 0.95); })) is = "plant";
      else if (zones.some(function (z) {
        var shed = col("shed|" + z + "|shed_flex")[i];
        return shed > 0.5 && shed < share * col("load|" + z)[i] - 1;
      })) is = "flex";
      else if (abroad.some(function (c) { return (zones.indexOf(c.a) >= 0 || zones.indexOf(c.b) >= 0) && flowing(c, i); })) is = "trade";
      else if (zones.some(function (z) { return part(z, batteries, "gen", i, 1) || part(z, batteries, "charge", i, 1); })) is = "battery";
      out.push(is);
    }
    return out;
  }

  // The zone and segment the inspector shows: by the snap control, or, in
  // a comparison, the segment that holds the moment `at`. The segments of
  // two scenarios differ when their weather or time resolution does; every
  // scenario's year starts on the same date.
  function inspected(ctx) {
    var d = ctx.s, zone = ctx.params.zone;
    if (!zone || U.zonesFor(zone).length > 1) zone = ctx.zone === "ALL" ? "DE" : "DK2";
    var n = U.n(d), price = U.price(d, zone), i = ctx.params.snap;
    if (ctx.params.at) {
      var at = Date.parse(ctx.params.at), times = U.times(d);
      i = 0;
      for (var k = 0; k < n; k++) if (times[k].getTime() <= at) i = k;
    }
    else if (i === "dear" || i === undefined || i === "") i = price.indexOf(Math.max.apply(null, price));
    else if (i === "cheap") i = price.indexOf(Math.min.apply(null, price));
    else i = Math.min(Math.max(+i || 0, 0), n - 1);
    return { zone: zone, price: price, i: i };
  }

  // -- the figures ---------------------------------------------------------------
  var F = {

  // The headline numbers, as one of the figures rather than above them all
  // (RKB, 2026-10-15). The page passes the scenario's row of kpis.json
  // (ctx.kpiS, ctx.kpiC) and the model's choice of numbers (ctx.tiles).
  "numbers": { // figure
    title: "Headline numbers",
    shows: "The scenario's main results. The table lists every quantity the sweeps offer.",
    controls: [],
    compare: "overlay",
    usesKpis: true,
    draw: function (ctx) {
      var rowS = ctx.kpiS || {}, rowC = ctx.c ? ctx.kpiC : null;
      var has = function (row, k) { return !!row && row[k] !== null && row[k] !== undefined; };
      var sign = function (x) { return x < 0 ? "−" : "+"; };
      var tiles = (ctx.tiles || []).filter(function (t) { return has(rowS, t[0]); }).map(function (t) {
        var v = rowS[t[0]] / t[2];
        var html = '<div class="ex-tile"><dt>' + U.esc(t[1]) + '</dt><dd><span class="ex-tile-value">' + U.fmt(v, t[3]) +
          '</span> <span class="ex-tile-unit">' + U.esc(t[4]) + "</span>";
        if (has(rowC, t[0])) {
          var w = rowC[t[0]] / t[2];
          html += '<span class="ex-delta">' + sign(v - w) + U.fmt(Math.abs(v - w), t[3]) + " from " + U.fmt(w, t[3]) + "</span>";
        }
        return html + "</dd></div>";
      });
      var rows = (ctx.cat.metrics || []).filter(function (x) { return has(rowS, x.id) || has(rowC, x.id); }).map(function (x) {
        var a = has(rowS, x.id) ? rowS[x.id] / (x.scale || 1) : null, b = has(rowC, x.id) ? rowC[x.id] / (x.scale || 1) : null;
        var row = [x.label, x.unit, U.sig(a)];
        if (rowC) row.push(U.sig(b), a !== null && b !== null ? sign(a - b) + U.sig(Math.abs(a - b)) : "–");
        return row;
      });
      return { html: '<dl class="ex-tiles">' + tiles.join("") + "</dl>",
        table: { columns: ["Quantity", "Unit", ctx.sLabel].concat(rowC ? [ctx.cLabel, "Difference"] : []), rows: rows },
        note: rowC ? "Under each number, the change from " + ctx.cLabel + "." : "" };
    },
  },

  "capacity": { // figure
    title: function (ctx) {
      return ctx.params.zone === "DK" ? "What Denmark builds" : "What is built: " + U.zoneName(ctx.cat, ctx.params.zone);
    },
    shows: function (ctx) {
      return "New capacity by technology, against the potential each may use." +
        (ctx.zone === "ALL" ? " Electrolysers in MW of electricity drawn, reformers in MW of hydrogen made." : "");
    },
    controls: ["zone"],
    compare: "overlay",
    draw: function (ctx) {
      var zones = U.zonesFor(ctx.params.zone || "DK");
      var cat = ctx.cat, runs = U.runs(ctx), traces = [], rows = [];
      // The candidates always (a zero is an answer); batteries and the
      // hydrogen chain where they are built.
      var techs = DK_TECHS.concat(["h2_turbine", "electrolyser", "smr"]).filter(function (t) {
        return runs.some(function (r) {
          var c = capTable(r.d, zones)[t];
          return c && (c.built > 1 || (DK_TECHS.indexOf(t) >= 0 && t.indexOf("battery") < 0));
        });
      });
      var labels = techs.map(function (t) { return U.techLabel(cat, t); });
      runs.slice().reverse().forEach(function (r) {
        var cap = capTable(r.d, zones);
        traces.push({
          type: "bar", orientation: "h", name: r.label, y: labels,
          x: techs.map(function (t) { return cap[t] ? cap[t].built / 1e3 : 0; }),
          marker: { color: techs.map(function (t) { return U.techColor(cat, t); }), opacity: r.main ? 1 : 0.35,
                    line: { width: r.main ? 0 : 1.5, color: techs.map(function (t) { return U.techColor(cat, t); }) } },
          hovertemplate: "%{y}: %{x:.2f} GW<extra>" + r.label + "</extra>", showlegend: false,
        });
      });
      traces = traces.concat(U.runLegend(ctx));
      var capS = capTable(ctx.s, zones);
      traces.push({
        type: "scatter", mode: "markers", name: "Potential", y: labels,
        x: techs.map(function (t) { return capS[t] && capS[t].hasMax ? capS[t].max / 1e3 : null; }),
        marker: { symbol: "line-ns-open", size: 18, color: U.css("--ink"), line: { width: 2 } },
        hovertemplate: "%{y}: potential %{x:.1f} GW<extra></extra>",
      });
      techs.forEach(function (t) {
        var a = capS[t] || { built: 0 }, row = [U.techLabel(cat, t), U.fmt(a.built / 1e3, 2),
          a.hasMax ? U.fmt(a.max / 1e3, 1) : "–", a.mwh ? U.fmt(a.mwh / 1e3, 1) : "–"];
        if (ctx.c) { var b = capTable(ctx.c, zones)[t] || { built: 0 }; row.push(U.fmt(b.built / 1e3, 2)); }
        rows.push(row);
      });
      var cols = ["Technology", "Built, GW", "Potential, GW", "Energy, GWh"];
      if (ctx.c) cols.push("Built in " + ctx.cLabel + ", GW");
      return {
        traces: traces,
        layout: U.layout({ barmode: "group", height: 60 + 34 * techs.length * (ctx.c ? 1.6 : 1),
          yaxis: { autorange: "reversed" }, xaxis: { title: U.axisTitle("GW"), rangemode: "tozero" } }),
        table: { columns: cols, rows: rows },
      };
    },
  },

  "energy": { // figure
    title: function (ctx) {
      return ctx.params.zone === "DK" ? "Danish energy balance" : "Energy balance: " + U.zoneName(ctx.cat, ctx.params.zone);
    },
    shows: function (ctx) {
      return ctx.zone === "ALL"
        ? "A year's generation by technology, against demand served, demand left unserved, electricity turned into hydrogen or charged into vehicles when the model chooses, and net trade."
        : "A year's generation by technology, against demand served, demand left unserved and net trade.";
    },
    controls: ["zone"],
    compare: "overlay",
    draw: function (ctx) {
      var zone = ctx.params.zone || "DK";
      var cat = ctx.cat, runs = U.runs(ctx), traces = [], rows = [];
      var order = U.techOrder(cat);
      var gen = runs.map(function (r) { return genByTech(r.d, zone); });
      var techs = order.filter(function (t) { return gen.some(function (g) { return (g[t] || 0) > 1e3; }); });
      function sideRows(d) {
        var z = d.tables.zones.filter(function (x) { return U.zonesFor(zone).indexOf(x.zone) >= 0; });
        var dem = d.tables.demand.filter(function (x) { return U.zonesFor(zone).indexOf(x.zone) >= 0; });
        var en = d.tables.energy.filter(function (x) { return U.zonesFor(zone).indexOf(x.zone) >= 0; });
        var sum = function (f, arr) { return arr.reduce(function (s, x) { return s + (x[f] || 0); }, 0); };
        return { served: sum("served_mwh", z), shed: sum("shed_mwh", dem), netimp: sum("net_import_mwh", z),
                 curt: sum("curtailed_mwh", en),
                 h2: sum("consumption_mwh", en.filter(function (x) { return x.tech === "electrolyser"; })),
                 ev: sum("consumption_mwh", en.filter(function (x) { return x.tech === "ev_charger"; })) };
      }
      var sides = runs.map(function (r) { return sideRows(r.d); });
      var useH2 = sides.some(function (s) { return s.h2 > 1e3; }), useEV = sides.some(function (s) { return s.ev > 1e3; });
      var cats = techs.map(function (t) { return U.techLabel(cat, t); }).concat(["Demand served"],
        useEV ? ["Vehicle charging, timed by the model"] : [], useH2 ? ["Electricity to electrolysers"] : [], ["Demand not served", "Net exports"]);
      runs.slice().reverse().forEach(function (r, k) {
        var g = genByTech(r.d, zone), s = sideRows(r.d);
        var vals = techs.map(function (t) { return (g[t] || 0) / 1e6; }).concat([s.served / 1e6],
          useEV ? [s.ev / 1e6] : [], useH2 ? [s.h2 / 1e6] : [], [s.shed / 1e6, -s.netimp / 1e6]);
        var colors = techs.map(function (t) { return U.techColor(cat, t); }).concat([U.css("--ink-2")],
          useEV ? [U.techColor(cat, "ev_charger")] : [], useH2 ? [U.techColor(cat, "electrolyser")] : [], [U.css("--critical"), U.css("--muted")]);
        traces.push({ type: "bar", orientation: "h", name: r.label, y: cats, x: vals,
          marker: { color: colors, opacity: r.main ? 1 : 0.35, line: { width: r.main ? 0 : 1.5, color: colors } },
          hovertemplate: "%{y}: %{x:.2f} TWh<extra>" + r.label + "</extra>", showlegend: false });
      });
      traces = traces.concat(U.runLegend(ctx));
      var s0 = sideRows(ctx.s), g0 = genByTech(ctx.s, zone);
      techs.forEach(function (t) { rows.push([U.techLabel(cat, t), U.fmt((g0[t] || 0) / 1e6, 2)]); });
      rows.push(["Demand served", U.fmt(s0.served / 1e6, 2)]);
      if (useEV) rows.push(["Vehicle charging, timed by the model", U.fmt(s0.ev / 1e6, 2)]);
      if (useH2) rows.push(["Electricity to electrolysers", U.fmt(s0.h2 / 1e6, 2)]);
      rows.push(["Demand not served", U.fmt(s0.shed / 1e6, 3)],
                ["Net exports", U.fmt(-s0.netimp / 1e6, 2)], ["Wind and solar curtailed", U.fmt(s0.curt / 1e6, 2)]);
      return { traces: traces,
        layout: U.layout({ barmode: "group", height: 70 + 30 * cats.length * (ctx.c ? 1.5 : 1), yaxis: { autorange: "reversed" },
          xaxis: { title: U.axisTitle("TWh a year") } }),
        table: { columns: ["", "TWh a year"], rows: rows } };
    },
  },

  "price-duration": { // figure
    title: "The price-duration curve",
    shows: "Every hour of the year, sorted from the highest price to the lowest.",
    controls: ["zone", "yscale"],
    compare: "overlay",
    wide: false,
    draw: function (ctx) {
      var zone = ctx.params.zone || "DK1";
      var runs = U.runs(ctx), traces = [], ink = U.css("--ink"), accent = U.css("--accent");
      runs.slice().reverse().forEach(function (r) {
        var dc = U.duration(U.price(r.d, zone), U.hours(r.d));
        traces.push({ type: "scatter", mode: "lines", name: r.label, x: dc.x, y: dc.y,
          line: { shape: "hv", width: r.main ? 2.2 : 2, color: r.main ? ink : accent, dash: r.main ? "solid" : "dash" },
          hovertemplate: "%{x:.0f} hours at or above %{y:.1f} EUR/MWh<extra>" + r.label + "</extra>" });
      });
      var log = ctx.params.yscale === "log";
      var top = log ? null : 300;
      var shapes = [], ann = [];
      blockLines(ctx).forEach(function (b) {
        if (!log && b.y > top) return;
        shapes.push({ type: "line", xref: "paper", x0: 0, x1: 1, y0: b.y, y1: b.y,
          line: { color: U.css("--muted"), width: 1 } });
        ann.push({ xref: "paper", x: 1, y: log ? Math.log10(b.y) : b.y, text: b.label + " " + U.fmt(b.y, 0),
          showarrow: false, xanchor: "right", yanchor: "bottom", font: { size: 11, color: U.css("--ink-2") } });
      });
      var dc0 = U.duration(U.price(ctx.s, zone), U.hours(ctx.s)), rows = [];
      [1, 10, 50, 100, 500, 1000, 2000, 4000, 6000, 8000, 8700].forEach(function (h) {
        var i = dc0.x.findIndex(function (x) { return x >= h; });
        if (i >= 0) rows.push([U.fmt(h), U.fmt(dc0.y[i], 1)]);
      });
      return { traces: traces, layout: U.layout({ height: 380, shapes: shapes, annotations: ann,
          xaxis: { title: U.axisTitle("Hours of the year at or above the price"), range: [0, 8760] },
          yaxis: log ? { type: "log", title: U.axisTitle("EUR/MWh (log scale)") }
                     : { title: U.axisTitle("EUR/MWh"), range: [0, top] },
          showlegend: !!ctx.c }),
        table: { columns: ["Hours at or above", "Price, EUR/MWh"], rows: rows },
        note: log ? "" : "Prices above 300 EUR/MWh run off the top; the log scale shows them all." };
    },
  },

  "dispatch": { // figure
    title: "A week of operation",
    shows: "What ran, hour by hour, against demand; net imports below; the price at the bottom.",
    controls: ["zone", "week"],
    wide: true,
    // Compared, both drawings show the same week: the one chosen for this scenario.
    pairParams: function (ctx) { return { week: String(weekOf(ctx)) }; },
    draw: function (ctx) {
      var d = ctx.s, cat = ctx.cat, zone = ctx.params.zone || "DK";
      var week = weekOf(ctx), ix = U.weekRange(d, week);
      var t = U.pick(U.times(d), ix), traces = [];
      var groups = {};
      U.zonesFor(zone).forEach(function (z) {
        U.keys(d, "gen|" + z + "|").forEach(function (k) {
          var g = U.techGroup(cat, k.split("|")[2]);
          groups[g] = U.add(groups[g] || U.zeros(U.n(d)), d.series[k]);
        });
      });
      U.groupOrder(cat).forEach(function (g) {
        if (!groups[g]) return;
        var y = U.pick(groups[g], ix);
        if (Math.max.apply(null, y) < 1) return;
        traces.push({ type: "scatter", mode: "lines", stackgroup: "gen", name: U.groupLabel(cat, g),
          x: t, y: y.map(function (v) { return v / 1e3; }), line: { shape: "hv", width: 0.5, color: U.css("--card") },
          fillcolor: U.groupColor(cat, g), yaxis: "y", hovertemplate: "%{y:.2f} GW<extra>" + U.groupLabel(cat, g) + "</extra>" });
      });
      var chg = U.zeros(U.n(d));
      U.zonesFor(zone).forEach(function (z) { U.keys(d, "charge|" + z + "|").forEach(function (k) { chg = U.add(chg, d.series[k]); }); });
      var charge = U.pick(chg, ix);
      if (Math.max.apply(null, charge) > 1) {
        traces.push({ type: "scatter", mode: "lines", stackgroup: "charge", name: "Batteries charging",
          x: t, y: charge.map(function (v) { return -v / 1e3; }), line: { shape: "hv", width: 0.5, color: U.css("--card") },
          fillcolor: U.groupColor(cat, "battery"), opacity: 0.6, yaxis: "y",
          hovertemplate: "%{y:.2f} GW<extra>Batteries charging</extra>" });
      }
      // Electricity turned into something else (section 8): electrolysers,
      // and vehicles charging when the model chooses. Drawn below zero with
      // the charging.
      var uses = {};
      U.zonesFor(zone).forEach(function (z) {
        U.keys(d, "use|" + z + "|").forEach(function (k) {
          var tech = k.split("|")[2];
          uses[tech] = U.add(uses[tech] || U.zeros(U.n(d)), d.series[k]);
        });
      });
      Object.keys(uses).forEach(function (tech) {
        var y = U.pick(uses[tech], ix);
        if (Math.max.apply(null, y) < 1) return;
        var name = tech === "electrolyser" ? "Electrolysers" : tech === "ev_charger" ? "Vehicles charging" : U.techLabel(cat, tech);
        traces.push({ type: "scatter", mode: "lines", stackgroup: "charge", name: name,
          x: t, y: y.map(function (v) { return -v / 1e3; }), line: { shape: "hv", width: 0.5, color: U.css("--card") },
          fillcolor: U.techColor(cat, tech), yaxis: "y",
          hovertemplate: "%{y:.2f} GW<extra>" + name + "</extra>" });
      });
      var load = U.pick(U.zoneSum(d, "load", zone), ix);
      var shed = U.zeros(U.n(d));
      U.zonesFor(zone).forEach(function (z) { U.keys(d, "shed|" + z + "|").forEach(function (k) { shed = U.add(shed, d.series[k]); }); });
      shed = U.pick(shed, ix);
      traces.push({ type: "scatter", mode: "lines", name: "Demand", x: t, y: load.map(function (v) { return v / 1e3; }),
        line: { shape: "hv", width: 1.4, color: U.css("--ink"), dash: "dot" }, yaxis: "y",
        hovertemplate: "%{y:.2f} GW<extra>Demand before response</extra>" });
      traces.push({ type: "scatter", mode: "lines", name: "Demand served", x: t,
        y: load.map(function (v, i) { return (v - shed[i]) / 1e3; }),
        line: { shape: "hv", width: 2, color: U.css("--ink") }, yaxis: "y",
        hovertemplate: "%{y:.2f} GW<extra>Demand served</extra>" });
      var netimp = U.pick(U.zoneSum(d, "netimp", zone), ix);
      traces.push({ type: "bar", name: "Net imports", x: t, y: netimp.map(function (v) { return v / 1e3; }),
        marker: { color: U.css("--muted") }, yaxis: "y2", showlegend: false,
        hovertemplate: "%{y:.2f} GW<extra>Net imports (exports below zero)</extra>" });
      traces.push({ type: "scatter", mode: "lines", name: "Price", x: t, y: U.pick(U.price(d, zone), ix),
        line: { shape: "hv", width: 2, color: U.css("--ink") }, yaxis: "y3", showlegend: false,
        hovertemplate: "%{y:.1f} EUR/MWh<extra>Price</extra>" });
      var rows = ix.map(function (i) {
        return [U.times(d)[i].toISOString().slice(0, 16).replace("T", " "), U.fmt(U.price(d, zone)[i], 1),
                U.fmt(U.zoneSum(d, "load", zone)[i]), U.fmt(U.zoneSum(d, "netimp", zone)[i])];
      });
      return { traces: traces,
        layout: U.layout({ height: 620, hovermode: "x unified",
          yaxis: { domain: [0.47, 1], title: U.axisTitle("GW") },
          yaxis2: { domain: [0.27, 0.42], title: U.axisTitle("Imports, GW"), zeroline: true, zerolinecolor: U.css("--axis") },
          yaxis3: { domain: [0, 0.22], title: U.axisTitle("EUR/MWh") },
          xaxis: { anchor: "y3" }, margin: { t: 30 } }),
        table: { columns: ["Segment starts", "Price, EUR/MWh", "Demand, MW", "Net imports, MW"], rows: rows },
        note: "Week " + week + ". Segments are of varying length: the model cuts the year into 1095 chronological pieces, short where things change fast." };
    },
  },

  "setter": { // figure
    title: "What is at the margin, month by month",
    shows: "The hours of each month in a Danish zone, by what is at the margin of its price.",
    controls: ["zone"],
    zones: ["DK2", "DK1"],
    wide: true,
    draw: function (ctx) {
      var d = ctx.s, zone = ctx.params.zone === "DK1" ? "DK1" : "DK2";
      var is = marginal(d, ctx.cat, zone), w = U.hours(d), t = U.times(d), price = U.price(d, zone), by = {};
      MARGINAL.forEach(function (c) { by[c.id] = { months: U.zeros(12), hours: 0, euros: 0 }; });
      for (var i = 0; i < is.length; i++) {
        var b = by[is[i]];
        b.months[t[i].getUTCMonth()] += w[i]; b.hours += w[i]; b.euros += w[i] * price[i];
      }
      var shown = MARGINAL.filter(function (c) { return by[c.id].hours > 0; });
      var traces = shown.map(function (c) {
        return { type: "bar", name: c.label, x: MONTHS, y: by[c.id].months,
          marker: { color: c.color(ctx.cat), line: { width: 1, color: U.css("--card") } },
          hovertemplate: "%{x}: %{y:.0f} hours<extra>" + c.label + "</extra>" };
      });
      var rows = shown.map(function (c) {
        var b = by[c.id];
        return [c.label, U.fmt(b.hours, 0), U.fmt(b.euros / b.hours, 0)].concat(b.months.map(function (v) { return U.fmt(v, 0); }));
      });
      return { traces: traces,
        layout: U.layout({ barmode: "stack", height: 400, bargap: 0.15,
          yaxis: { title: U.axisTitle("Hours"), rangemode: "tozero" }, xaxis: { title: U.axisTitle("") } }),
        table: { columns: ["At the margin", "Hours a year", "Average price, EUR/MWh"].concat(MONTHS), rows: rows },
        note: "A price of 2 EUR/MWh or less counts as wind and solar in surplus. Otherwise the first that holds: " +
          "a Danish gas plant runs part-loaded; flexible demand is partly curtailed; power flows on an " +
          "interconnector to a neighbour below its capacity; a battery charges or discharges part-loaded. " +
          "Otherwise every option is at a limit. The two Danish zones count as one while power flows on the " +
          "Great Belt below its capacity." };
    },
  },

  "heatmap": { // figure
    title: "The price through the day, month by month",
    shows: "The median price in each hour of the day, month by month: on half the days of the month the price at that hour was higher.",
    controls: ["zone"],
    wide: true,
    draw: function (ctx) {
      var d = ctx.s, zone = ctx.params.zone || "DK1", price = U.price(d, zone);
      var med = monthHour(d, price, "median"), mean = monthHour(d, price, "mean"), top = 100;
      med.forEach(function (r) { r.forEach(function (v) { if (v !== null && v > top) top = v; }); });
      top = Math.min(top, 300);
      var blues = U.dark() ? [[0, "#0d366b"], [0.5, "#3987e5"], [1, "#cde2fb"]] : [[0, "#cde2fb"], [0.5, "#5598e7"], [1, "#0d366b"]];
      return { traces: [{ type: "heatmap", x: DAY_HOURS, y: MONTHS, z: med, customdata: mean,
          colorscale: blues, zmin: 0, zmax: top, xgap: 2, ygap: 2,
          colorbar: { title: { text: "EUR/MWh", side: "right" }, thickness: 12, outlinewidth: 0 },
          hovertemplate: "%{y}, %{x}:00: median %{z:.0f} EUR/MWh, mean %{customdata:.0f}<extra></extra>" }],
        layout: U.layout({ height: 420, yaxis: { autorange: "reversed" },
          xaxis: { title: U.axisTitle("Hour of the day"), dtick: 3 } }),
        table: { columns: ["Hour of the day"].concat(MONTHS),
          rows: DAY_HOURS.map(function (h) { return [h + ":00"].concat(med.map(function (r) { return U.fmt(r[h], 0); })); }) },
        note: "Medians over the days of each month" + (top >= 300 ? "; colours capped at 300 EUR/MWh" : "") +
          ". A segment counts in every hour it covers." };
    },
  },

  "storage": { // figure
    title: "What the batteries do through the day, month by month",
    shows: "The batteries' average output in each hour of the day, month by month: discharging above zero, charging below.",
    controls: ["zone"],
    wide: true,
    draw: function (ctx) {
      var d = ctx.s, cat = ctx.cat, zone = ctx.params.zone || "DK", net = U.zeros(U.n(d));
      ["battery_2h", "battery_4h", "battery_8h"].forEach(function (b) {
        net = U.add(net, U.zoneSum(d, "gen", zone, b));
        net = U.add(net, U.zoneSum(d, "charge", zone, b).map(function (v) { return -v; }));
      });
      var grid = monthHour(d, net, "mean").map(function (r) { return r.map(function (v) { return v === null ? null : v / 1e3; }); });
      var top = 1e-3;
      grid.forEach(function (r) { r.forEach(function (v) { if (v !== null) top = Math.max(top, Math.abs(v)); }); });
      var cap = capTable(d, U.zonesFor(zone)), fleet = [];
      ["battery_2h", "battery_4h", "battery_8h"].forEach(function (b) {
        var c = cap[b]; if (!c || c.built < 1) return;
        var out = U.wsum(U.zoneSum(d, "gen", zone, b), U.hours(d));
        fleet.push(U.techLabel(cat, b) + ": " + U.fmt(c.built / 1e3, 2) + " GW, " + U.fmt(c.mwh / 1e3, 1) + " GWh, " +
                   U.fmt(out / Math.max(c.mwh, 1), 0) + " full cycles a year");
      });
      // Diverging: charging and discharging in the course's blue and orange,
      // nothing at all in the card's own colour.
      var scale = [[0, U.dark() ? "#56b4e9" : "#0072b2"], [0.5, U.css("--card") || "#ffffff"], [1, U.dark() ? "#f0b429" : "#e69f00"]];
      return { traces: [{ type: "heatmap", x: DAY_HOURS, y: MONTHS, z: grid, colorscale: scale, zmin: -top, zmax: top,
          xgap: 2, ygap: 2, colorbar: { title: { text: "GW", side: "right" }, thickness: 12, outlinewidth: 0 },
          hovertemplate: "%{y}, %{x}:00: %{z:+.2f} GW<extra>above zero discharging, below charging</extra>" }],
        layout: U.layout({ height: 420, yaxis: { autorange: "reversed" },
          xaxis: { title: U.axisTitle("Hour of the day"), dtick: 3 } }),
        table: { columns: ["Hour of the day"].concat(MONTHS),
          rows: DAY_HOURS.map(function (h) { return [h + ":00"].concat(grid.map(function (r) { return U.fmt(r[h], 2); })); }) },
        note: fleet.length ? "Averages over the days of each month, in GW. " + fleet.join("; ") + "."
                           : "No batteries are built in this scenario." };
    },
  },

  "recovery": { // figure
    title: "Rent per MW against annual fixed cost",
    shows: "What a MW of each candidate earns in the scenario's prices, as a share of its annual fixed cost.",
    controls: [],
    draw: function (ctx) {
      var cat = ctx.cat, rows = [], traces = [];
      var rec = ctx.s.tables.recovery.slice().sort(function (a, b) { return b.rent_over_fixed - a.rent_over_fixed; });
      var y = rec.map(function (r) { return U.techLabel(cat, r.tech) + ", " + r.zone; });
      traces.push({ type: "bar", orientation: "h", y: y, x: rec.map(function (r) { return Math.min(r.rent_over_fixed, 3); }),
        marker: { color: rec.map(function (r) { return U.techColor(cat, r.tech); }),
                  opacity: rec.map(function (r) { return r.built ? 1 : 0.35; }) },
        hovertemplate: "%{y}: earns %{x:.2f} x its fixed cost<extra></extra>", showlegend: false });
      rec.forEach(function (r) {
        rows.push([U.techLabel(cat, r.tech), r.zone, U.fmt(r.capacity_mw / 1e3, 2), U.fmt(r.fixed_eur_mw_yr / 1e3, 1), U.fmt(r.rent_eur_mw_yr / 1e3, 1), U.fmt(r.rent_over_fixed, 2)]);
      });
      return { traces: traces,
        layout: U.layout({ height: 70 + 24 * y.length, yaxis: { autorange: "reversed" },
          xaxis: { title: U.axisTitle("Rent earned / annual fixed cost"), range: [0, 3.2] },
          shapes: [{ type: "line", x0: 1, x1: 1, yref: "paper", y0: 0, y1: 1, line: { color: U.css("--ink"), width: 1.5 } }],
          margin: { r: 70 } }),
        table: { columns: ["Technology", "Zone", "Built, GW", "Fixed cost, kEUR/MW", "Rent, kEUR/MW", "Ratio"], rows: rows },
        note: "Faded bars: candidates with nothing built. Ratios above 3 are drawn at 3; the table has them all." };
    },
  },

  "value": { // figure
    title: "Levelised cost and capture price",
    shows: "For each technology Denmark builds: its levelised cost and its capture price, the average price its own output fetches.",
    controls: [],
    draw: function (ctx) {
      var cat = ctx.cat, v = ctx.s.tables.value || [], traces = [], rows = [];
      var y = v.map(function (r) { return U.techLabel(cat, r.tech); });
      traces.push({ type: "scatter", mode: "markers", name: "Levelised cost, carbon included", y: y,
        x: v.map(function (r) { return r.lcoe_eur_mwh + r.carbon_cost_eur_mwh; }),
        marker: { symbol: "line-ns-open", size: 22, color: U.css("--ink"), line: { width: 2.5 } },
        hovertemplate: "%{y}: levelised cost %{x:.1f} EUR/MWh<extra></extra>" });
      traces.push({ type: "scatter", mode: "markers", name: "Capture price", y: y,
        x: v.map(function (r) { return r.capture_price_eur_mwh; }),
        marker: { size: 12, color: v.map(function (r) { return U.techColor(cat, r.tech); }), line: { width: 2, color: U.css("--card") } },
        hovertemplate: "%{y}: capture price %{x:.1f} EUR/MWh<extra></extra>" });
      v.forEach(function (r) {
        rows.push([U.techLabel(cat, r.tech), U.fmt(r.full_load_hours, 0), U.fmt(r.lcoe_eur_mwh + r.carbon_cost_eur_mwh, 1),
                   U.fmt(r.capture_price_eur_mwh, 1), U.fmt(r.value_factor, 2)]);
      });
      return { traces: traces,
        layout: U.layout({ height: 90 + 40 * y.length, yaxis: { autorange: "reversed" },
          xaxis: { title: U.axisTitle("EUR/MWh"), rangemode: "tozero" } }),
        table: { columns: ["Technology", "Full-load hours", "Levelised cost, EUR/MWh", "Capture price, EUR/MWh", "Value factor"], rows: rows } };
    },
  },

  "bands": { // figure
    title: "Peakers' margin by price band",
    shows: "The year's hours sorted into price bands, against the share of the peakers' operating margin earned in each.",
    controls: [],
    draw: function (ctx) {
      var b = ctx.s.tables.bands || [];
      if (!b.length) return { traces: [], layout: U.layout({ height: 120 }), table: { columns: [], rows: [] },
        note: "No peaker is built in this scenario, so there is nothing to divide." };
      var label = function (r) {
        var lo = r.lower_eur_mwh, hi = r.upper_eur_mwh;
        if (lo === null || lo < -1e9) return "below " + U.fmt(hi, 0);
        if (hi === null || hi > 1e9) return "above " + U.fmt(lo, 0);
        return U.fmt(lo, 0) + " to " + U.fmt(hi, 0);
      };
      var x = b.map(label);
      return { traces: [
          { type: "bar", name: "Share of the year's hours", x: x, y: b.map(function (r) { return r.hours_share * 100; }),
            marker: { color: U.css("--muted") }, hovertemplate: "%{x} EUR/MWh: %{y:.1f} % of hours<extra></extra>" },
          { type: "bar", name: "Share of the peakers' margin", x: x, y: b.map(function (r) { return r.margin_share * 100; }),
            marker: { color: U.groupColor(ctx.cat, "gas") }, hovertemplate: "%{x} EUR/MWh: %{y:.1f} % of margin<extra></extra>" }],
        layout: U.layout({ barmode: "group", height: 330, xaxis: { title: U.axisTitle("Price band, EUR/MWh") },
          yaxis: { title: U.axisTitle("%"), range: [0, 100] } }),
        table: { columns: ["Band, EUR/MWh", "Hours", "% of hours", "% of margin"],
          rows: b.map(function (r) { return [label(r), U.fmt(r.hours), U.fmt(r.hours_share * 100, 1), U.fmt(r.margin_share * 100, 1)]; }) } };
    },
  },

  "bill": { // figure
    title: "What Denmark's system costs",
    shows: "The year's capital and operating cost of what Denmark builds, by technology, less what it earns abroad.",
    controls: [],
    compare: "overlay",
    draw: function (ctx) {
      var cat = ctx.cat, traces = [], rows = [];
      var runs = U.runs(ctx);
      var techs = [];
      runs.forEach(function (r) { (r.d.tables.breakdown || []).forEach(function (b) {
        if (techs.indexOf(b.tech) < 0 && (b.capex_eur + b.opex_eur) > 1e5) techs.push(b.tech); }); });
      var names = runs.map(function (r) { return r.label; });
      techs.forEach(function (t) {
        traces.push({ type: "bar", name: U.techLabel(cat, t), x: names,
          y: runs.map(function (r) { var b = (r.d.tables.breakdown || []).find(function (x) { return x.tech === t; });
            return b ? (b.capex_eur + b.opex_eur) / 1e9 : 0; }),
          marker: { color: U.techColor(cat, t), line: { width: 2, color: U.css("--card") } },
          hovertemplate: "%{y:.3f} bn EUR<extra>" + U.techLabel(cat, t) + "</extra>" });
      });
      traces.push({ type: "scatter", mode: "markers", name: "Net cost after trade", x: names,
        y: runs.map(function (r) { return r.d.tables.kpis.dk_net_cost / 1e9; }),
        marker: { symbol: "diamond", size: 13, color: U.css("--ink") },
        hovertemplate: "Net of trade: %{y:.2f} bn EUR<extra></extra>" });
      runs.forEach(function (r) {
        var k = r.d.tables.kpis;
        (r.d.tables.breakdown || []).forEach(function (b) {
          if (b.capex_eur + b.opex_eur < 1e5) return;
          rows.push([r.label, U.techLabel(cat, b.tech), U.fmt(b.capex_eur / 1e6, 0), U.fmt(b.opex_eur / 1e6, 0), ""]);
        });
        rows.push([r.label, "Total", U.fmt(k.dk_system_cost / 1e6 - sumOpex(r.d) / 1e6, 0), U.fmt(sumOpex(r.d) / 1e6, 0), ""]);
        rows.push([r.label, "Less trade revenue", "", "", U.fmt(-k.dk_trade_revenue / 1e6, 0)]);
        rows.push([r.label, "Net cost", "", "", U.fmt(k.dk_net_cost / 1e6, 0)]);
      });
      function sumOpex(d) { return (d.tables.breakdown || []).reduce(function (s, b) { return s + (b.opex_eur || 0); }, 0); }
      return { traces: traces, layout: U.layout({ barmode: "stack", height: 380, yaxis: { title: U.axisTitle("bn EUR a year") } }),
        table: { columns: ["Scenario", "Technology", "Capital, m EUR", "Operating, m EUR", "m EUR"], rows: rows } };
    },
  },

  "screening": { // figure
    title: "Screening curves, and where each technology landed",
    shows: "Each candidate's annual cost per MW against the hours it runs, with a marker at the hours it actually ran.",
    controls: [],
    draw: function (ctx) {
      var cat = ctx.cat, scr = ctx.cat.screening || [], traces = [], rows = [];
      var own = ownCosts(ctx), tau = ctx.s.tables.meta ? ctx.s.tables.meta.carbon_price || 0 : 85;
      // This scenario's own costs (its carbon price, fuel prices and discount
      // rate), from its capacity table; the catalogue's reference costs only
      // where the table has none.
      function costs(r) {
        var o = own[r.tech];
        return o ? { fixed: o.capital_cost, run: o.marginal_cost }
                 : { fixed: r.fixed_eur_mw_yr, run: r.marginal_cost + tau * r.emission_rate };
      }
      var hours = [0, 8760];
      scr.forEach(function (r) {
        var k = costs(r);
        rows.push([U.techLabel(cat, r.tech), U.fmt(k.fixed / 1e3, 1), U.fmt(k.run, 1)]);
        if (r.tech === "nuclear") return;          // in the table, off the chart
        traces.push({ type: "scatter", mode: "lines", name: U.techLabel(cat, r.tech), x: hours,
          y: hours.map(function (h) { return (k.fixed + k.run * h) / 1e3; }),
          line: { width: 2, color: U.techColor(cat, r.tech) },
          hovertemplate: "%{x:.0f} hours: %{y:.0f} kEUR/MW<extra>" + U.techLabel(cat, r.tech) + "</extra>" });
      });
      (ctx.s.tables.duty || []).forEach(function (r) {
        if (!r.full_load_hours) return;
        var s = scr.find(function (x) { return x.tech === r.tech; });
        if (!s) return;
        var k = costs(s);
        traces.push({ type: "scatter", mode: "markers", showlegend: false, x: [r.full_load_hours],
          y: [(k.fixed + k.run * r.full_load_hours) / 1e3],
          marker: { size: 11, color: U.techColor(cat, r.tech), line: { width: 2, color: U.css("--card") } },
          hovertemplate: U.techLabel(cat, r.tech) + " ran %{x:.0f} full-load hours<extra></extra>" });
      });
      return { traces: traces, layout: U.layout({ height: 380, xaxis: { title: U.axisTitle("Full-load hours a year"), range: [0, 8760] },
          yaxis: { title: U.axisTitle("Annual cost, kEUR per MW"), rangemode: "tozero" } }),
        table: { columns: ["Technology", "Fixed cost, kEUR/MW/yr", "Running cost incl. carbon, EUR/MWh"], rows: rows },
        note: "This scenario's costs: its carbon price, fuel prices and discount rate. Nuclear is in the table but off the chart, whose scale it would otherwise set." };
    },
  },

  "levels": { // figure
    title: "Running costs, and demand's willingness to pay",
    shows: "What a MWh costs each Danish candidate to produce in this scenario, carbon shown apart, against the willingness to pay of each block of demand.",
    controls: [],
    draw: function (ctx) {
      var cat = ctx.cat, t = ctx.s.tables, zone = (cat.focus_zones || ["DK1"])[0];
      var tau = t.meta && t.meta.carbon_price ? t.meta.carbon_price : 0;
      var rate = {};
      (cat.screening || []).forEach(function (r) { rate[r.tech] = r.emission_rate; });
      var own = ownCosts(ctx);
      var techs = Object.keys(rate).filter(function (k) { return own[k]; })
        .sort(function (a, b) { return own[a].marginal_cost - own[b].marginal_cost; });
      var y = techs.map(function (k) { return U.techLabel(cat, k); });
      var carbon = techs.map(function (k) { return tau * (rate[k] || 0); });
      var before = techs.map(function (k, i) { return own[k].marginal_cost - carbon[i]; });
      var traces = [
        { type: "bar", orientation: "h", name: "Fuel and operation", showlegend: false, y: y, x: before,
          marker: { color: techs.map(function (k) { return U.techColor(cat, k); }), line: { width: 0 } },
          hovertemplate: "%{y}: %{x:.1f} EUR/MWh before carbon<extra></extra>" }];
      if (tau > 0) traces.push(
        { type: "bar", orientation: "h", name: "Carbon at " + U.fmt(tau, 0) + " EUR/t", y: y, x: carbon,
          marker: { color: U.css("--muted"), line: { width: 0 } },
          hovertemplate: "%{y}: %{x:.1f} EUR/MWh of carbon<extra></extra>" });
      var label = {};
      (cat.demand_blocks || []).forEach(function (b) { label[b.id] = b.label; });
      var blocks = (t.demand || []).filter(function (b) { return b.zone === zone && b.size_mw > 0; })
        .sort(function (a, b) { return a.wtp - b.wtp; });
      var top = Math.max.apply(null, techs.map(function (k) { return own[k].marginal_cost; }).concat([100]));
      var xmax = top * 1.15, shapes = [], ann = [], off = [];
      blocks.forEach(function (b) {
        var name = label[b.block] || b.block;
        if (b.wtp > xmax) { off.push(name + " at " + U.fmt(b.wtp, 0) + " EUR/MWh"); return; }
        shapes.push({ type: "line", xref: "x", yref: "paper", x0: b.wtp, x1: b.wtp, y0: 0, y1: 1,
          line: { color: U.css("--ink"), width: 1.5, dash: "dash" } });
        ann.push({ x: b.wtp, y: 1, xref: "x", yref: "paper", xanchor: "left", yanchor: "top", xshift: 4,
          showarrow: false, align: "left", text: name + "<br>willingness to pay " + U.fmt(b.wtp, 0),
          font: { size: 11, color: U.css("--ink") } });
      });
      var rows = techs.map(function (k, i) {
        return [U.techLabel(cat, k), U.fmt(before[i], 1), U.fmt(carbon[i], 1), U.fmt(own[k].marginal_cost, 1)]; });
      blocks.forEach(function (b) {
        rows.push([(label[b.block] || b.block) + " (demand, " + U.fmt(b.size_mw, 0) + " MW)", "", "",
                   "willingness to pay " + U.fmt(b.wtp, 0)]); });
      return { traces: traces,
        layout: U.layout({ barmode: "stack", height: 120 + 34 * y.length, shapes: shapes, annotations: ann,
          yaxis: { autorange: "reversed" }, xaxis: { title: U.axisTitle("EUR/MWh"), range: [0, xmax] } }),
        table: { columns: ["", "Before carbon, EUR/MWh", "Carbon, EUR/MWh", "Running cost, EUR/MWh"], rows: rows },
        note: "This scenario's running costs, in " + zone + (t.meta && t.meta.co2_dual ? ", where a CO2 budget, not a price, limits emissions" : "") +
          "." + (off.length ? " Further up, off this scale: " + off.join("; ") + "." : "") };
    },
  },

  "trade": { // figure
    title: "Trade and congestion",
    shows: "For each corridor touching Denmark: the hours it runs full in each direction, and the rent it collects.",
    controls: [],
    draw: function (ctx) {
      var c = ctx.s.tables.corridors.filter(function (r) { return DK.indexOf(r.a) >= 0 || DK.indexOf(r.b) >= 0; });
      var y = c.map(function (r) { return r.a + " – " + r.b; });
      return { traces: [
          { type: "bar", orientation: "h", name: "Full towards the second zone", y: y, x: c.map(function (r) { return r.hours_congested_ab; }),
            marker: { color: U.css("--accent") }, hovertemplate: "%{y}: full towards the second zone %{x:.0f} h<extra></extra>" },
          { type: "bar", orientation: "h", name: "Full towards the first zone", y: y, x: c.map(function (r) { return -r.hours_congested_ba; }),
            marker: { color: U.css("--muted") }, hovertemplate: "%{y}: full towards the first zone %{customdata:.0f} h<extra></extra>",
            customdata: c.map(function (r) { return r.hours_congested_ba; }) }],
        layout: U.layout({ barmode: "relative", height: 90 + 34 * y.length, yaxis: { autorange: "reversed" },
          xaxis: { title: U.axisTitle("Hours a year at full capacity (left: towards the first zone)"), zeroline: true, zerolinecolor: U.css("--axis") } }),
        table: { columns: ["Corridor", "Capacity, MW", "Hours full →", "Hours full ←", "Net flow →, TWh", "Rent, m EUR"],
          rows: c.map(function (r) { return [r.a + " – " + r.b, U.fmt(r.cap_ab_mw), U.fmt(r.hours_congested_ab), U.fmt(r.hours_congested_ba),
            U.fmt((r.flow_ab_mwh - r.flow_ba_mwh) / 1e6, 2), U.fmt(r.rent_eur / 1e6, 0)]; }) } };
    },
  },

  "map": { // figure
    title: "The system at a glance",
    shows: "The twelve zones: colour is the average price, size the demand; lines are corridors, darker when more often full.",
    controls: [],
    wide: false,
    draw: function (ctx) {
      var POS = { DK1: [9.2, 56.2], DK2: [12.1, 55.5], DE: [10.4, 51.8], NO1: [10.8, 60.2], NO2: [7.6, 59.0],
        NO3: [10.5, 63.4], NO4: [16.5, 67.6], NO5: [6.0, 61.0], SE1: [21.0, 66.6], SE2: [16.5, 63.5],
        SE3: [15.0, 59.4], SE4: [14.0, 56.3] };
      var z = ctx.s.tables.zones, traces = [];
      ctx.s.tables.corridors.forEach(function (r) {
        var a = POS[r.a], b = POS[r.b]; if (!a || !b) return;
        var share = Math.max(r.hours_congested_ab, r.hours_congested_ba) / 8760;
        traces.push({ type: "scatter", mode: "lines", x: [a[0], b[0]], y: [a[1], b[1]], showlegend: false, hoverinfo: "skip",
          line: { width: 1.5 + 6 * share, color: share > 0.3 ? U.css("--ink") : U.css("--axis") } });
      });
      var prices = z.map(function (r) { return r.avg_price; });
      var lo = Math.min.apply(null, prices), hi = Math.max.apply(null, prices);
      traces.push({ type: "scatter", mode: "markers+text", showlegend: false,
        x: z.map(function (r) { return POS[r.zone] ? POS[r.zone][0] : null; }),
        y: z.map(function (r) { return POS[r.zone] ? POS[r.zone][1] : null; }),
        text: z.map(function (r) { return r.zone + " " + U.fmt(r.avg_price, 0); }), textposition: "top center",
        textfont: { size: 11, color: U.css("--ink") },
        marker: { size: z.map(function (r) { return 10 + 18 * Math.sqrt(r.demand_mwh / 1e9); }), color: prices,
          colorscale: U.dark() ? [[0, "#0d366b"], [1, "#cde2fb"]] : [[0, "#cde2fb"], [1, "#0d366b"]],
          cmin: lo, cmax: hi, line: { width: 1.5, color: U.css("--card") },
          colorbar: { title: { text: "EUR/MWh", side: "right" }, thickness: 10, outlinewidth: 0, len: 0.6 } },
        hovertemplate: "%{text} EUR/MWh average<extra></extra>" });
      return { traces: traces, layout: U.layout({ height: 520, xaxis: { visible: false, range: [3.5, 23] },
          yaxis: { visible: false, range: [50.5, 69], scaleanchor: "x", scaleratio: 1.8 }, margin: { l: 10, r: 10, t: 10, b: 10 } }),
        table: { columns: ["Zone", "Average price, EUR/MWh", "Demand, TWh", "Net imports, TWh", "Emissions, Mt"],
          rows: z.map(function (r) { return [r.zone, U.fmt(r.avg_price, 1), U.fmt(r.demand_mwh / 1e6, 1), U.fmt(r.net_import_mwh / 1e6, 1), U.fmt(r.emissions_t / 1e6, 2)]; }) },
        note: "Positions are schematic." };
    },
  },

  "emissions": { // figure
    title: "Where the emissions are",
    shows: "Annual CO2 by zone; with a comparison, the change in each zone.",
    controls: [],
    compare: "overlay",
    draw: function (ctx) {
      var z = ctx.s.tables.zones, y = z.map(function (r) { return r.zone; }), traces = [], rows = [];
      if (ctx.c) {
        var cz = {}; ctx.c.tables.zones.forEach(function (r) { cz[r.zone] = r; });
        var diff = z.map(function (r) { return (r.emissions_t - (cz[r.zone] ? cz[r.zone].emissions_t : 0)) / 1e6; });
        traces.push({ type: "bar", orientation: "h", y: y, x: diff, showlegend: false,
          marker: { color: diff.map(function (v) { return v > 0 ? U.css("--critical") : U.css("--accent"); }) },
          hovertemplate: "%{y}: %{x:+.2f} Mt against " + ctx.cLabel + "<extra></extra>" });
        var dk = diff[0] + diff[1], abroad = diff.slice(2).reduce(function (a, b) { return a + b; }, 0);
        z.forEach(function (r, i) { rows.push([r.zone, U.fmt(r.emissions_t / 1e6, 2), U.fmt(diff[i], 2)]); });
        return { traces: traces, layout: U.layout({ height: 420, yaxis: { autorange: "reversed" },
            xaxis: { title: U.axisTitle("Change in Mt CO2 a year, against " + ctx.cLabel), zeroline: true, zerolinecolor: U.css("--axis") } }),
          table: { columns: ["Zone", "Mt CO2", "Change, Mt"], rows: rows },
          note: "Denmark " + (dk >= 0 ? "+" : "") + U.fmt(dk, 2) + " Mt; abroad " + (abroad >= 0 ? "+" : "") + U.fmt(abroad, 2) + " Mt." };
      }
      traces.push({ type: "bar", orientation: "h", y: y, x: z.map(function (r) { return r.emissions_t / 1e6; }), showlegend: false,
        marker: { color: z.map(function (r) { return DK.indexOf(r.zone) >= 0 ? U.css("--ink") : U.css("--muted"); }) },
        hovertemplate: "%{y}: %{x:.2f} Mt<extra></extra>" });
      z.forEach(function (r) { rows.push([r.zone, U.fmt(r.emissions_t / 1e6, 2)]); });
      return { traces: traces, layout: U.layout({ height: 420, yaxis: { autorange: "reversed" }, xaxis: { title: U.axisTitle("Mt CO2 a year") } }),
        table: { columns: ["Zone", "Mt CO2"], rows: rows } };
    },
  },

  "abroad": { // figure
    title: "What the neighbours add",
    shows: "New capacity built outside Denmark, by zone and technology group.",
    controls: [],
    draw: function (ctx) {
      var cat = ctx.cat, zones = cat.zones.map(function (z) { return z.id; }).filter(function (z) { return DK.indexOf(z) < 0; });
      var traces = [], rows = [];
      U.groupOrder(cat).forEach(function (g) {
        var x = zones.map(function (z) {
          return ctx.s.tables.capacity.filter(function (r) { return r.zone === z && U.techGroup(cat, r.tech) === g; })
            .reduce(function (s, r) { return s + r.built_mw; }, 0) / 1e3;
        });
        if (Math.max.apply(null, x) < 0.05) return;
        traces.push({ type: "bar", orientation: "h", name: U.groupLabel(cat, g), y: zones, x: x,
          marker: { color: U.groupColor(cat, g), line: { width: 1.5, color: U.css("--card") } },
          hovertemplate: "%{y}: %{x:.1f} GW<extra>" + U.groupLabel(cat, g) + "</extra>" });
      });
      zones.forEach(function (z) {
        var tot = ctx.s.tables.capacity.filter(function (r) { return r.zone === z; }).reduce(function (s, r) { return s + r.built_mw; }, 0);
        rows.push([z, U.fmt(tot / 1e3, 1)]);
      });
      return { traces: traces, layout: U.layout({ barmode: "stack", height: 420, yaxis: { autorange: "reversed" },
          xaxis: { title: U.axisTitle("GW built") } }),
        table: { columns: ["Zone", "GW built"], rows: rows },
        note: traces.length ? "" : "Nothing is built outside Denmark in this scenario." };
    },
  },

  "inspector": { // figure
    title: "One hour, inspected",
    shows: "Everything that could run in one zone in one segment of the year, sorted by running cost, with what did run and the price.",
    controls: ["zone", "snap"],
    singleZone: true,
    wide: true,
    // Compared, both drawings show the same moment of the year: the
    // segment chosen in this scenario, and the one holding its start in the other.
    pairParams: function (ctx) { return { at: U.times(ctx.s)[inspected(ctx).i].toISOString() }; },
    draw: function (ctx) {
      var d = ctx.s, cat = ctx.cat, n = U.n(d), at = inspected(ctx), zone = at.zone, price = at.price, i = at.i;
      var cap = capTable(d, [zone]), items = [];
      Object.keys(cap).forEach(function (t) {
        // Storage, conversion and the hydrogen turbine have no running cost
        // of their own to sort by: what they cost is the price of what they
        // draw on.
        if (t.indexOf("battery") === 0 || CONVERSION.indexOf(t) >= 0 || t === "h2_turbine" ||
            cap[t].built + cap[t].existing < 1) return;
        var avail = d.series["avail|" + zone + "|" + t] ? d.series["avail|" + zone + "|" + t][i] : cap[t].built + cap[t].existing;
        var gen = d.series["gen|" + zone + "|" + t] ? d.series["gen|" + zone + "|" + t][i] : 0;
        items.push({ t: t, mc: cap[t].mc, avail: avail, gen: gen });
      });
      var bat = 0, batAvail = 0;
      ["battery_2h", "battery_4h", "battery_8h"].forEach(function (b) {
        if (d.series["gen|" + zone + "|" + b]) bat += d.series["gen|" + zone + "|" + b][i];
        if (cap[b]) batAvail += cap[b].built;
      });
      if (batAvail > 1) items.push({ t: "battery_8h", mc: null, avail: batAvail, gen: bat, label: "Batteries (discharge)" });
      if (cap.h2_turbine && cap.h2_turbine.built > 1) {
        var h2g = d.series["gen|" + zone + "|h2_turbine"];
        items.push({ t: "h2_turbine", mc: null, avail: cap.h2_turbine.built, gen: h2g ? h2g[i] : 0, label: "Hydrogen turbine (burns stored hydrogen)" });
      }
      items.sort(function (a, b) { return (a.mc === null ? 1e4 : a.mc) - (b.mc === null ? 1e4 : b.mc); });
      var y = items.map(function (it) { return it.label || U.techLabel(cat, it.t); });
      var traces = [
        { type: "bar", orientation: "h", name: "Could have run", y: y, x: items.map(function (it) { return it.avail / 1e3; }),
          marker: { color: items.map(function (it) { return U.techColor(cat, it.t); }), opacity: 0.3 },
          hovertemplate: "%{y}: %{x:.2f} GW available<extra></extra>" },
        { type: "bar", orientation: "h", name: "Ran", y: y, x: items.map(function (it) { return it.gen / 1e3; }),
          marker: { color: items.map(function (it) { return U.techColor(cat, it.t); }) },
          hovertemplate: "%{y}: %{x:.2f} GW ran<extra></extra>" }];
      var t = U.times(d)[i], rows = [];
      ctx.cat.zones.forEach(function (z) {
        var p = d.series["price|" + z.id]; if (p) rows.push([z.id, U.fmt(p[i], 1)]);
      });
      return { traces: traces,
        layout: U.layout({ barmode: "overlay", height: 100 + 34 * y.length, yaxis: { autorange: "reversed" },
          xaxis: { title: U.axisTitle("GW") } }),
        table: { columns: ["Zone", "Price in this segment, EUR/MWh"], rows: rows },
        note: zone + ", segment " + (i + 1) + " of " + n + ", starting " + t.toISOString().slice(0, 16).replace("T", " ") +
          " (" + U.fmt(U.hours(d)[i]) + " h). Price " + U.fmt(price[i], 1) + " EUR/MWh." };
    },
  },

  // -- section 8: the whole system, hydrogen and the grid ------------------------

  "built-by-zone": { // figure
    title: "Capacity built, by zone",
    shows: "New capacity in each zone, by technology group. Electrolysers count the electricity they can draw; stores and reformers are left out.",
    controls: [],
    compare: "overlay",
    draw: function (ctx) {
      var cat = ctx.cat, traces = [], rows = [];
      var zones = U.allZones.filter(function (z) { return ctx.s.tables.zones.some(function (r) { return r.zone === z; }); });
      var counted = function (r) { return CONVERSION.indexOf(r.tech) < 0 || r.tech === "electrolyser"; };
      function built(d, z, g) {
        return d.tables.capacity.filter(function (r) {
          return r.zone === z && counted(r) && (g === null || U.techGroup(cat, r.tech) === g);
        }).reduce(function (s, r) { return s + r.built_mw; }, 0);
      }
      U.groupOrder(cat).forEach(function (g) {
        var x = zones.map(function (z) { return built(ctx.s, z, g) / 1e3; });
        if (Math.max.apply(null, x) < 0.05) return;
        traces.push({ type: "bar", orientation: "h", name: U.groupLabel(cat, g), y: zones, x: x,
          marker: { color: U.groupColor(cat, g), line: { width: 1.5, color: U.css("--card") } },
          hovertemplate: "%{y}: %{x:.1f} GW<extra>" + U.groupLabel(cat, g) + "</extra>" });
      });
      if (ctx.c) {
        traces.push({ type: "scatter", mode: "markers", name: "Total in " + ctx.cLabel, y: zones,
          x: zones.map(function (z) { return built(ctx.c, z, null) / 1e3; }),
          marker: { symbol: "line-ns-open", size: 18, color: U.css("--ink"), line: { width: 2 } },
          hovertemplate: "%{y}: %{x:.1f} GW<extra>" + ctx.cLabel + "</extra>" });
      }
      var total = zones.reduce(function (s, z) { return s + built(ctx.s, z, null); }, 0);
      zones.forEach(function (z) {
        var b = built(ctx.s, z, null), row = [z, U.fmt(b / 1e3, 1), U.fmt(100 * b / Math.max(total, 1), 0)];
        if (ctx.c) row.push(U.fmt(built(ctx.c, z, null) / 1e3, 1));
        rows.push(row);
      });
      var cols = ["Zone", "GW built", "Share of all capacity built, %"];
      if (ctx.c) cols.push("GW built in " + ctx.cLabel);
      return { traces: traces, layout: U.layout({ barmode: "stack", height: 440, yaxis: { autorange: "reversed" },
          xaxis: { title: U.axisTitle("GW built") } }),
        table: { columns: cols, rows: rows } };
    },
  },

  "h2-balance": { // figure
    title: function (ctx) { return "Hydrogen supply and use: " + U.zoneName(ctx.cat, ctx.params.zone || "ALL"); },
    shows: "A year's hydrogen, in TWh of hydrogen: made from natural gas, imported or electrolysed, and used by industry or burnt back into electricity.",
    controls: ["zone"],
    compare: "overlay",
    draw: function (ctx) {
      var cat = ctx.cat, zones = U.zonesFor(ctx.params.zone || "ALL"), runs = U.runs(ctx), traces = [];
      function sums(d) {
        var o = { smr: 0, imp: 0, el: 0, ind: 0, pow: 0 };
        (d.tables.hydrogen || []).forEach(function (r) {
          if (zones.indexOf(r.zone) < 0) return;
          o.smr += r.smr_mwh; o.imp += r.import_mwh; o.el += r.electrolysis_mwh; o.ind += r.demand_mwh; o.pow += r.to_power_mwh;
        });
        return o;
      }
      var cats = ["Made from natural gas", "Imported", "Electrolysed", "Used by industry", "Burnt for electricity"];
      var colors = [U.techColor(cat, "smr"), U.techColor(cat, "h2_import"), U.techColor(cat, "electrolyser"), U.css("--ink-2"),
                    U.techColor(cat, "h2_turbine")];
      runs.slice().reverse().forEach(function (r) {
        var s = sums(r.d);
        traces.push({ type: "bar", orientation: "h", name: r.label, y: cats,
          x: [s.smr, s.imp, s.el, s.ind, s.pow].map(function (v) { return v / 1e6; }),
          marker: { color: colors, opacity: r.main ? 1 : 0.35, line: { width: r.main ? 0 : 1.5, color: colors } },
          hovertemplate: "%{y}: %{x:.1f} TWh<extra>" + r.label + "</extra>", showlegend: false });
      });
      traces = traces.concat(U.runLegend(ctx));
      var rows = (ctx.s.tables.hydrogen || []).filter(function (r) { return zones.indexOf(r.zone) >= 0; }).map(function (r) {
        return [r.zone, U.fmt(r.demand_mwh / 1e6, 1), U.fmt(r.smr_mwh / 1e6, 1), U.fmt(r.import_mwh / 1e6, 1),
          U.fmt(r.electrolysis_mwh / 1e6, 1), U.fmt(r.to_power_mwh / 1e6, 2), U.fmt(r.electrolyser_mw / 1e3, 1),
          U.fmt(r.electrolyser_flh, 0), U.fmt(r.store_mwh / 1e6, 2), U.fmt(r.h2_price, 0)];
      });
      var none = !runs.some(function (r) { return (r.d.tables.hydrogen || []).length; });
      return { traces: none ? [] : traces,
        layout: U.layout({ barmode: "group", height: 90 + 40 * cats.length * (ctx.c ? 1.5 : 1), yaxis: { autorange: "reversed" },
          xaxis: { title: U.axisTitle("TWh of hydrogen a year"), rangemode: "tozero" } }),
        table: { columns: ["Zone", "Industry, TWh", "From gas, TWh", "Imported, TWh", "Electrolysed, TWh", "Burnt for electricity, TWh",
          "Electrolysers, GW", "Electrolyser full-load hours", "Store, TWh", "Average hydrogen price, EUR/MWh"], rows: rows },
        note: none ? "This scenario has no hydrogen sector." : "Only zones with an industrial hydrogen demand have a hydrogen sector, and hydrogen cannot move between zones." };
    },
  },

  "h2-store": { // figure
    title: function (ctx) { return "Hydrogen in store through the year: " + U.zoneName(ctx.cat, ctx.params.zone || "ALL"); },
    shows: "Hydrogen held in salt caverns and steel tanks through the year, in TWh of hydrogen; below, the electricity the electrolysers draw.",
    controls: ["zone"],
    compare: "overlay",
    wide: true,
    draw: function (ctx) {
      var d = ctx.s, cat = ctx.cat, zone = ctx.params.zone || "ALL", t = U.times(d), traces = [];
      var STORES = ["h2_store_cavern", "h2_store_tank"];
      STORES.forEach(function (s) {
        var soc = U.zoneSum(d, "soc", zone, s);
        if (Math.max.apply(null, soc) < 1) return;
        traces.push({ type: "scatter", mode: "lines", stackgroup: "soc", name: U.techLabel(cat, s), x: t,
          y: soc.map(function (v) { return v / 1e6; }), line: { shape: "hv", width: 0.5, color: U.css("--card") },
          fillcolor: s === "h2_store_cavern" ? U.techColor(cat, s) : U.css("--muted"), yaxis: "y",
          hovertemplate: "%{y:.2f} TWh<extra>" + U.techLabel(cat, s) + "</extra>" });
      });
      if (ctx.c) {
        var tc = U.add(U.zoneSum(ctx.c, "soc", zone, STORES[0]), U.zoneSum(ctx.c, "soc", zone, STORES[1]));
        traces.push({ type: "scatter", mode: "lines", name: "All stores, " + ctx.cLabel, x: U.times(ctx.c),
          y: tc.map(function (v) { return v / 1e6; }), line: { shape: "hv", width: 1.6, color: U.css("--accent"), dash: "dash" },
          yaxis: "y", hovertemplate: "%{y:.2f} TWh<extra>" + ctx.cLabel + "</extra>" });
      }
      var use = U.zoneSum(d, "use", zone, "electrolyser");
      traces.push({ type: "scatter", mode: "lines", name: "Electrolysers", x: t, y: use.map(function (v) { return v / 1e3; }),
        line: { shape: "hv", width: 1, color: U.css("--ink") }, yaxis: "y2", showlegend: false,
        hovertemplate: "%{y:.1f} GW<extra>Electricity to electrolysers</extra>" });
      var rows = [], total = U.zeros(U.n(d));
      U.zonesFor(zone).forEach(function (z) {
        var soc = U.add(U.col(d, "soc|" + z + "|" + STORES[0]) || U.zeros(U.n(d)), U.col(d, "soc|" + z + "|" + STORES[1]));
        total = U.add(total, soc);
        var size = d.tables.capacity.filter(function (r) { return r.zone === z && STORES.indexOf(r.tech) >= 0; })
          .reduce(function (s, r) { return s + (r.energy_mwh || 0); }, 0);
        if (size < 1) return;
        var hi = soc.indexOf(Math.max.apply(null, soc)), lo = soc.indexOf(Math.min.apply(null, soc));
        rows.push([z, U.fmt(size / 1e6, 2), U.fmt(soc[hi] / 1e6, 2), t[hi].toISOString().slice(0, 10),
                   U.fmt(soc[lo] / 1e6, 2), t[lo].toISOString().slice(0, 10)]);
      });
      return { traces: traces.length > 1 ? traces : [],
        layout: U.layout({ height: 440, hovermode: "x unified",
          yaxis: { domain: [0.38, 1], title: U.axisTitle("Hydrogen held, TWh"), rangemode: "tozero" },
          yaxis2: { domain: [0, 0.3], title: U.axisTitle("Electrolysers, GW"), rangemode: "tozero" }, xaxis: { anchor: "y2" } }),
        table: { columns: ["Zone", "Store, TWh", "Fullest, TWh", "on", "Emptiest, TWh", "on"], rows: rows },
        note: rows.length ? "" : "No hydrogen store is built in this scenario." };
    },
  },

  "electrolyser": { // figure
    title: function (ctx) { return "Electrolysers against the electricity price: " + U.zoneName(ctx.cat, ctx.params.zone || "DE"); },
    shows: "Each point is one segment of the year: the electricity price, and the share of the electrolysers' capacity that ran. Larger points stand for longer segments.",
    controls: ["zone"],
    compare: "overlay",
    draw: function (ctx) {
      var cat = ctx.cat, zone = ctx.params.zone || "DE", zones = U.zonesFor(zone), traces = [];
      function stats(d) {
        var w = U.hours(d), use = U.zoneSum(d, "use", zone, "electrolyser"), price = U.price(d, zone);
        var c = capTable(d, zones).electrolyser, mw = c ? c.built : 0, paid = 0, energy = 0;
        zones.forEach(function (z) {
          var u = d.series["use|" + z + "|electrolyser"], p = d.series["price|" + z];
          if (!u || !p) return;
          for (var i = 0; i < u.length; i++) { paid += u[i] * p[i] * w[i]; energy += u[i] * w[i]; }
        });
        var hours = w.reduce(function (a, b) { return a + b; }, 0);
        return { w: w, use: use, price: price, mw: mw, energy: energy, flh: mw > 1 ? energy / mw : 0,
                 paid: energy > 1 ? paid / energy : null, avg: U.wsum(price, w) / hours };
      }
      U.runs(ctx).slice().reverse().forEach(function (r) {
        var s = stats(r.d);
        if (s.mw < 1) return;
        traces.push({ type: "scatter", mode: "markers", name: r.label, x: s.price,
          y: s.use.map(function (u) { return 100 * u / s.mw; }),
          marker: { size: s.w.map(function (h) { return 3 + 2.2 * Math.sqrt(h); }), opacity: r.main ? 0.55 : 0.35,
                    color: r.main ? U.techColor(cat, "electrolyser") : U.css("--accent"), line: { width: 0 } },
          hovertemplate: "%{x:.0f} EUR/MWh: %{y:.0f} % of capacity<extra>" + r.label + "</extra>" });
      });
      var s0 = stats(ctx.s), rows = [];
      [[-Infinity, 10], [10, 30], [30, 60], [60, 100], [100, 200], [200, Infinity]].forEach(function (b) {
        var h = 0, e = 0;
        s0.price.forEach(function (p, i) { if (p >= b[0] && p < b[1]) { h += s0.w[i]; e += s0.use[i] * s0.w[i]; } });
        rows.push([b[0] === -Infinity ? "below 10" : b[1] === Infinity ? "200 and above" : b[0] + " to " + b[1], U.fmt(h),
          s0.mw > 1 && h > 0 ? U.fmt(100 * e / (s0.mw * h), 0) : "–", s0.energy > 1 ? U.fmt(100 * e / s0.energy, 0) : "–"]);
      });
      return { traces: traces,
        layout: U.layout({ height: 400, showlegend: !!ctx.c,
          xaxis: { title: U.axisTitle("Electricity price, EUR/MWh"), range: [0, 300] },
          yaxis: { title: U.axisTitle("Share of capacity running, %"), range: [-3, 103] } }),
        table: { columns: ["Price band, EUR/MWh", "Hours", "Share of capacity running, %", "Share of the electrolysers' electricity, %"], rows: rows },
        note: s0.mw < 1 ? "No electrolysers are built here." :
          "Electrolysers " + U.fmt(s0.mw / 1e3, 1) + " GW, " + U.fmt(s0.flh) + " full-load hours. Average price paid " +
          U.fmt(s0.paid, 1) + " EUR/MWh; time-average price " + U.fmt(s0.avg, 1) + " EUR/MWh. Prices above 300 EUR/MWh are off the chart; the table counts them." };
    },
  },

  "grid": { // figure
    title: "Interconnectors bought",
    shows: "For each corridor the model may reinforce: the capacity it bought, against the most it was allowed to buy. Today's capacity is in the table.",
    controls: [],
    compare: "overlay",
    draw: function (ctx) {
      var byId = function (d) { var o = {}; (d.tables.corridors || []).forEach(function (r) { o[r.id] = r; }); return o; };
      var S = byId(ctx.s), C = ctx.c ? byId(ctx.c) : {};
      var ids = Object.keys(S).filter(function (k) {
        return (S[k].new_offered_mw || 0) > 0 || (C[k] && (C[k].new_offered_mw || 0) > 0);
      });
      var y = ids.map(function (k) { return S[k].a + " – " + S[k].b; }), traces = [];
      var bought = function (rows, k) { return rows[k] ? (rows[k].new_mw || 0) / 1e3 : 0; };
      if (ctx.c) {
        traces.push({ type: "bar", orientation: "h", name: "Bought in " + ctx.cLabel, y: y, x: ids.map(function (k) { return bought(C, k); }),
          marker: { color: U.css("--accent"), opacity: 0.35 }, hovertemplate: "%{y}: %{x:.2f} GW<extra>" + ctx.cLabel + "</extra>" });
      }
      traces.push({ type: "bar", orientation: "h", name: "Bought", y: y, x: ids.map(function (k) { return bought(S, k); }),
        marker: { color: U.css("--accent") }, hovertemplate: "%{y}: %{x:.2f} GW bought<extra>" + ctx.sLabel + "</extra>" });
      traces.push({ type: "scatter", mode: "markers", name: "Most it may buy", y: y,
        x: ids.map(function (k) { return Math.max((S[k].new_offered_mw || 0), C[k] ? (C[k].new_offered_mw || 0) : 0) / 1e3; }),
        marker: { symbol: "line-ns-open", size: 18, color: U.css("--ink"), line: { width: 2 } },
        hovertemplate: "%{y}: up to %{x:.2f} GW<extra></extra>" });
      var rows = ids.map(function (k) {
        var r = S[k], today = Math.max(r.cap_ab_mw, r.cap_ba_mw) - (r.new_mw || 0);
        var row = [r.a + " – " + r.b, U.fmt(today), U.fmt(r.new_mw || 0), U.fmt(r.new_offered_mw || 0),
                   U.fmt(r.hours_congested_ab), U.fmt(r.hours_congested_ba), U.fmt(r.rent_eur / 1e6, 0)];
        if (ctx.c) row.push(U.fmt(C[k] ? C[k].new_mw || 0 : 0));
        return row;
      });
      var cols = ["Corridor", "Today's capacity, MW", "Bought, MW", "Most it may buy, MW", "Hours full →", "Hours full ←", "Rent, m EUR"];
      if (ctx.c) cols.push("Bought in " + ctx.cLabel + ", MW");
      return { traces: ids.length ? traces : [],
        layout: U.layout({ barmode: "group", height: 90 + 30 * ids.length * (ctx.c ? 1.6 : 1), yaxis: { autorange: "reversed" },
          xaxis: { title: U.axisTitle("GW"), rangemode: "tozero" } }),
        table: { columns: cols, rows: rows },
        note: ids.length ? "Today's capacity includes the reinforcements already committed." : "No corridor can be reinforced in this scenario." };
    },
  },

  };

  F.capacity.order = 1;
  window.FIGURES = F;
  window.FIGURE_CHOICES = { zone: ZONE_CHOICES, zones: { greenfield: ZONE_CHOICES, expansion: ZONE_CHOICES_ALL }, week: WEEKS };
})();
