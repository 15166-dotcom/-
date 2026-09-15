/* ==========================================================================
   OKNG Monitor v3 — simulated real-time OK/NG quality monitor
   Vanilla JS, no dependencies.
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- config */

  var CONFIG = {
    targetYield: 98.5,        // %
    shiftTargetQty: 2400,     // pieces per shift
    tickMs: 650,              // simulation clock
    bucketMs: 3000,           // trend aggregation window
    maxBuckets: 120,
    maxLogRows: 300,
    ngStreakAlarm: 3,         // consecutive NG that raises an alarm
    stationAlarmYield: 95,    // station yield below this = alarm
    stationWarnYield: 97.5,
    gaugeMin: 80              // gauge lower bound (%)
  };

  var STATIONS = [
    { id: 'A1', line: 'A', name: 'Vision Inspect',  th: 'ตรวจด้วยกล้อง',      cycle: 2.8, ngRate: 0.010 },
    { id: 'A2', line: 'A', name: 'Dimension Check', th: 'วัดขนาดชิ้นงาน',     cycle: 3.6, ngRate: 0.014 },
    { id: 'B1', line: 'B', name: 'Weld Seam AOI',   th: 'ตรวจแนวเชื่อม',      cycle: 4.2, ngRate: 0.020 },
    { id: 'B2', line: 'B', name: 'Leak Test',       th: 'ทดสอบการรั่ว',       cycle: 5.0, ngRate: 0.012 },
    { id: 'C1', line: 'C', name: 'Paint Surface',   th: 'ตรวจผิวสี',          cycle: 3.2, ngRate: 0.018 },
    { id: 'C2', line: 'C', name: 'Final QC',        th: 'ตรวจขั้นสุดท้าย',     cycle: 4.6, ngRate: 0.008 }
  ];

  var DEFECTS = [
    { code: 'DIM',   th: 'ขนาดไม่ได้พิกัด',  en: 'Out of tolerance', w: 26, unit: 'mm',  nominal: 24.50, tol: 0.15 },
    { code: 'SCR',   th: 'รอยขีดข่วน',       en: 'Surface scratch',  w: 21, unit: 'pt',  nominal: 0,     tol: 3 },
    { code: 'WELD',  th: 'รอยเชื่อมบกพร่อง', en: 'Weld defect',      w: 17, unit: 'mm',  nominal: 6.00,  tol: 0.40 },
    { code: 'LEAK',  th: 'รั่วซึม',          en: 'Leak detected',    w: 12, unit: 'kPa', nominal: 42.0,  tol: 2.0 },
    { code: 'COAT',  th: 'ความหนาสีผิดพลาด', en: 'Coating thickness',w: 12, unit: 'µm',  nominal: 85.0,  tol: 6.0 },
    { code: 'BURR',  th: 'ครีบ / เสี้ยน',    en: 'Burr / flash',     w:  7, unit: 'pt',  nominal: 0,     tol: 2 },
    { code: 'MISS',  th: 'ชิ้นส่วนขาดหาย',   en: 'Missing part',     w:  5, unit: '-',   nominal: 1,     tol: 0 }
  ];

  var DEFECT_TOTAL_W = DEFECTS.reduce(function (s, d) { return s + d.w; }, 0);

  /* ----------------------------------------------------------------- state */

  var S = null;

  function freshStation(def) {
    return {
      def: def, ok: 0, ng: 0, acc: Math.random() * def.cycle,
      drift: 0, lastAt: 0, defects: {}
    };
  }

  function freshState() {
    return {
      startedAt: Date.now(),
      running: true,
      total: 0, ok: 0, ng: 0,
      streak: 0, streakMax: 0,
      seq: 1000,
      stations: STATIONS.map(freshStation),
      defects: {},
      log: [],
      buckets: [],
      curBucket: null,
      rateHist: [],
      lastTick: Date.now(),
      alerted: false
    };
  }

  var view = {
    line: 'ALL',
    logFilter: 'ALL',
    range: 60
  };

  /* -------------------------------------------------------------- elements */

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    clock: $('clock'), shiftName: $('shiftName'), uptime: $('uptime'),
    connBadge: $('connBadge'), connText: $('connText'),
    btnPause: $('btnPause'), btnReset: $('btnReset'), btnTheme: $('btnTheme'),
    lineSelect: $('lineSelect'),
    alertBar: $('alertBar'), alertText: $('alertText'), alertClose: $('alertClose'),
    kpiTotal: $('kpiTotal'), kpiTargetQty: $('kpiTargetQty'), kpiTargetBar: $('kpiTargetBar'),
    kpiOk: $('kpiOk'), kpiOkPct: $('kpiOkPct'), kpiOkBar: $('kpiOkBar'),
    kpiNg: $('kpiNg'), kpiNgPct: $('kpiNgPct'), kpiNgBar: $('kpiNgBar'),
    kpiYield: $('kpiYield'), yieldCard: $('yieldCard'), yieldDelta: $('yieldDelta'),
    gaugeFill: $('gaugeFill'), gaugeTargetTick: $('gaugeTargetTick'), targetLabel: $('targetLabel'),
    kpiRate: $('kpiRate'), kpiCycle: $('kpiCycle'), rateSpark: $('rateSpark'),
    kpiStreak: $('kpiStreak'), kpiStreakMax: $('kpiStreakMax'), kpiStreakBar: $('kpiStreakBar'),
    trendChart: $('trendChart'), trendWindowLabel: $('trendWindowLabel'),
    paretoList: $('paretoList'), paretoEmpty: $('paretoEmpty'), paretoTotal: $('paretoTotal'),
    stationGrid: $('stationGrid'), stationSummary: $('stationSummary'),
    logBody: $('logBody'), logCount: $('logCount'), btnExport: $('btnExport')
  };

  /* ------------------------------------------------------------- utilities */

  function pad(n, w) { var s = String(n); while (s.length < (w || 2)) s = '0' + s; return s; }
  function fmtInt(n) { return n.toLocaleString('en-US'); }
  function fmtTime(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function gauss() {
    var u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function pickDefect() {
    var r = Math.random() * DEFECT_TOTAL_W;
    for (var i = 0; i < DEFECTS.length; i++) {
      r -= DEFECTS[i].w;
      if (r <= 0) return DEFECTS[i];
    }
    return DEFECTS[0];
  }
  function shiftOf(d) {
    var h = d.getHours();
    if (h >= 6 && h < 14) return 'A — 06:00-14:00';
    if (h >= 14 && h < 22) return 'B — 14:00-22:00';
    return 'C — 22:00-06:00';
  }
  function yieldOf(ok, total) { return total ? (ok / total) * 100 : 100; }

  /* ------------------------------------------------------------ simulation */

  function stationsInView() {
    return S.stations.filter(function (st) {
      return view.line === 'ALL' || st.def.line === view.line;
    });
  }

  function newBucket(t) {
    var b = { t: t, ok: 0, ng: 0, byLine: {} };
    STATIONS.forEach(function (d) { if (!b.byLine[d.line]) b.byLine[d.line] = { ok: 0, ng: 0 }; });
    return b;
  }

  function addToBucket(b, line, isNg) {
    var slot = b.byLine[line] || (b.byLine[line] = { ok: 0, ng: 0 });
    if (isNg) { slot.ng++; b.ng++; } else { slot.ok++; b.ok++; }
  }

  // counts inside a bucket, respecting the active line filter
  function bucketView(b) {
    if (view.line === 'ALL') return { ok: b.ok, ng: b.ng };
    var slot = b.byLine[view.line];
    return slot ? { ok: slot.ok, ng: slot.ng } : { ok: 0, ng: 0 };
  }

  function agg() {
    var list = stationsInView(), ok = 0, ng = 0;
    list.forEach(function (st) { ok += st.ok; ng += st.ng; });
    return { ok: ok, ng: ng, total: ok + ng };
  }

  function makeInspection(st) {
    var def = st.def;
    var rate = def.ngRate * (1 + st.drift * 4);
    var isNg = Math.random() < rate;
    var d = pickDefect();
    var now = new Date();
    var rec = {
      t: now,
      serial: 'SN-' + pad(++S.seq, 6),
      station: def.id,
      line: def.line,
      result: isNg ? 'NG' : 'OK',
      defect: isNg ? d : null,
      value: null,
      unit: d.unit
    };

    // measured value: inside tolerance for OK, outside for NG
    if (d.nominal) {
      var dev = isNg
        ? d.tol * (1.15 + Math.random() * 0.9) * (Math.random() < 0.5 ? -1 : 1)
        : d.tol * gauss() * 0.3;
      rec.value = d.nominal + dev;
    } else {
      rec.value = isNg ? d.tol + 1 + Math.floor(Math.random() * 4) : Math.max(0, Math.round(gauss() * 0.6));
    }

    if (isNg) {
      st.ng++;
      S.ng++;
      S.streak++;
      if (S.streak > S.streakMax) S.streakMax = S.streak;
      S.defects[d.code] = (S.defects[d.code] || 0) + 1;
      st.defects[d.code] = (st.defects[d.code] || 0) + 1;
      // an NG makes a short-term drift more likely (defect clustering)
      if (Math.random() < 0.35) st.drift = Math.min(1, st.drift + 0.3);
    } else {
      st.ok++;
      S.ok++;
      S.streak = 0;
    }
    S.total++;
    st.lastAt = now.getTime();

    S.log.unshift(rec);
    if (S.log.length > CONFIG.maxLogRows) S.log.length = CONFIG.maxLogRows;

    // trend bucket
    if (!S.curBucket) S.curBucket = newBucket(now.getTime());
    addToBucket(S.curBucket, def.line, isNg);

    return rec;
  }

  function tick() {
    if (!S.running) return;
    var now = Date.now();
    var dt = Math.min(2500, now - S.lastTick) / 1000;
    S.lastTick = now;

    S.stations.forEach(function (st) {
      // drift decays over time
      st.drift = Math.max(0, st.drift - dt * 0.05);
      // random process upset
      if (Math.random() < 0.0015 * dt * 60) st.drift = Math.min(1, st.drift + 0.5);

      st.acc += dt;
      var cycle = st.def.cycle * (0.85 + Math.random() * 0.3);
      while (st.acc >= cycle) {
        st.acc -= cycle;
        makeInspection(st);
        cycle = st.def.cycle * (0.85 + Math.random() * 0.3);
      }
    });

    // close trend bucket
    if (S.curBucket && now - S.curBucket.t >= CONFIG.bucketMs) {
      S.buckets.push(S.curBucket);
      if (S.buckets.length > CONFIG.maxBuckets) S.buckets.shift();
      S.rateHist.push(S.curBucket.ok + S.curBucket.ng);
      if (S.rateHist.length > 40) S.rateHist.shift();
      S.curBucket = newBucket(now);
    }

    checkAlarms();
    render();
  }

  function checkAlarms() {
    if (S.streak >= CONFIG.ngStreakAlarm && !S.alerted) {
      showAlert('พบ NG ต่อเนื่อง ' + S.streak + ' ชิ้น — กรุณาตรวจสอบกระบวนการผลิตทันที (consecutive NG detected)');
      S.alerted = true;
    }
    if (S.streak === 0) S.alerted = false;
  }

  function showAlert(msg) {
    el.alertText.textContent = msg;
    el.alertBar.hidden = false;
  }

  /* -------------------------------------------------------------- renderer */

  var GAUGE_LEN = Math.PI * 50; // semicircle r=50

  function render() {
    var a = agg();
    var y = yieldOf(a.ok, a.total);

    // KPIs
    el.kpiTotal.textContent = fmtInt(a.total);
    el.kpiTargetQty.textContent = fmtInt(CONFIG.shiftTargetQty);
    el.kpiTargetBar.style.width = clamp((a.total / CONFIG.shiftTargetQty) * 100, 0, 100) + '%';

    el.kpiOk.textContent = fmtInt(a.ok);
    el.kpiOkPct.textContent = (a.total ? (a.ok / a.total * 100) : 0).toFixed(2) + '% ของทั้งหมด';
    el.kpiOkBar.style.width = (a.total ? a.ok / a.total * 100 : 0) + '%';

    el.kpiNg.textContent = fmtInt(a.ng);
    el.kpiNgPct.textContent = (a.total ? (a.ng / a.total * 100) : 0).toFixed(2) + '% ของทั้งหมด';
    el.kpiNgBar.style.width = (a.total ? a.ng / a.total * 100 : 0) + '%';

    // gauge
    var g = clamp((y - CONFIG.gaugeMin) / (100 - CONFIG.gaugeMin), 0, 1);
    el.gaugeFill.style.strokeDasharray = GAUGE_LEN;
    el.gaugeFill.style.strokeDashoffset = GAUGE_LEN * (1 - g);
    el.gaugeFill.style.stroke = y >= CONFIG.targetYield ? 'var(--ok)' : (y >= CONFIG.targetYield - 1 ? 'var(--warn)' : 'var(--ng)');
    el.kpiYield.innerHTML = y.toFixed(1) + '<small>%</small>';
    var tg = clamp((CONFIG.targetYield - CONFIG.gaugeMin) / (100 - CONFIG.gaugeMin), 0, 1);
    el.gaugeTargetTick.setAttribute('transform', 'rotate(' + ((tg - 0.5) * 180).toFixed(2) + ' 60 62)');
    el.targetLabel.textContent = CONFIG.targetYield.toFixed(1) + '%';

    var diff = y - CONFIG.targetYield;
    el.yieldDelta.textContent = (diff >= 0 ? '▲ +' : '▼ ') + diff.toFixed(2) + ' จุด เทียบเป้า';
    el.yieldDelta.className = 'delta ' + (diff >= 0 ? 'up' : 'down');
    el.yieldCard.classList.toggle('is-below', a.total > 20 && diff < 0);

    // throughput
    var elapsedMin = Math.max(0.05, (Date.now() - S.startedAt) / 60000);
    var rate = a.total / elapsedMin;
    el.kpiRate.innerHTML = rate.toFixed(1) + '<small> ชิ้น/นาที</small>';
    el.kpiCycle.textContent = (a.total ? (60 / rate).toFixed(1) : '0.0') + ' s';
    renderSpark();

    // streak
    el.kpiStreak.textContent = S.streak;
    el.kpiStreakMax.textContent = S.streakMax;
    el.kpiStreakBar.style.width = clamp(S.streak / CONFIG.ngStreakAlarm * 100, 0, 100) + '%';

    renderChart();
    renderPareto();
    renderStations();
    renderLog();
  }

  function renderSpark() {
    var h = S.rateHist.slice(-24);
    var max = Math.max.apply(null, h.concat([1]));
    var html = '';
    for (var i = 0; i < h.length; i++) {
      html += '<i style="height:' + clamp(h[i] / max * 100, 6, 100) + '%"></i>';
    }
    el.rateSpark.innerHTML = html;
  }

  /* ---- trend chart ---- */
  function renderChart() {
    var W = 800, H = 260, PL = 44, PR = 10, PT = 12, PB = 24;
    var data = S.buckets.slice(-view.range);
    var svg = el.trendChart;

    var pts = data.map(function (b) {
      var c = bucketView(b);
      return { t: b.t, ok: c.ok, ng: c.ng, tot: c.ok + c.ng };
    }).filter(function (c) { return c.tot > 0; });

    var yMin = 90, yMax = 100;
    pts.forEach(function (c) {
      var v = yieldOf(c.ok, c.tot);
      if (v < yMin) yMin = Math.floor(v / 2) * 2;
    });
    yMin = clamp(yMin, 0, 96);

    var iw = W - PL - PR, ih = H - PT - PB;
    var xAt = function (i) { return PL + (pts.length <= 1 ? iw / 2 : (i / (pts.length - 1)) * iw); };
    var yAt = function (v) { return PT + ih - ((clamp(v, yMin, yMax) - yMin) / (yMax - yMin)) * ih; };

    var parts = [
      '<defs><linearGradient id="yieldGrad" x1="0" y1="0" x2="0" y2="1">',
      '<stop offset="0%" stop-color="var(--ok)" stop-opacity=".28"/>',
      '<stop offset="100%" stop-color="var(--ok)" stop-opacity="0"/>',
      '</linearGradient></defs>'
    ];

    // grid + y axis
    for (var s = 0; s <= 4; s++) {
      var v = yMin + (yMax - yMin) * (s / 4);
      var yy = yAt(v);
      parts.push('<line class="grid-line" x1="' + PL + '" y1="' + yy.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + yy.toFixed(1) + '"/>');
      parts.push('<text class="axis-text" x="' + (PL - 8) + '" y="' + (yy + 4).toFixed(1) + '" text-anchor="end">' + v.toFixed(0) + '%</text>');
    }

    // target line
    if (CONFIG.targetYield >= yMin) {
      var ty = yAt(CONFIG.targetYield);
      parts.push('<line class="target-line" x1="' + PL + '" y1="' + ty.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + ty.toFixed(1) + '"/>');
    }

    if (pts.length > 1) {
      var lineD = '', areaD = '', avgD = '', cOk = 0, cTot = 0, dots = '';
      pts.forEach(function (b, i) {
        var tot = b.tot;
        var v = yieldOf(b.ok, tot);
        cOk += b.ok; cTot += tot;
        var x = xAt(i), yv = yAt(v), ya = yAt(yieldOf(cOk, cTot));
        lineD += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + yv.toFixed(1) + ' ';
        avgD += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + ya.toFixed(1) + ' ';
        areaD += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + yv.toFixed(1) + ' ';
        if (b.ng > 0) dots += '<circle class="pt-ng" cx="' + x.toFixed(1) + '" cy="' + yv.toFixed(1) + '" r="2.6"/>';
      });
      areaD += 'L' + xAt(pts.length - 1).toFixed(1) + ' ' + (PT + ih) + ' L' + xAt(0).toFixed(1) + ' ' + (PT + ih) + ' Z';
      parts.push('<path class="area" d="' + areaD + '"/>');
      parts.push('<path class="line-avg" d="' + avgD.trim() + '"/>');
      parts.push('<path class="line-yield" d="' + lineD.trim() + '"/>');
      parts.push(dots);

      // x labels
      [0, Math.floor(pts.length / 2), pts.length - 1].forEach(function (i, k) {
        var d = new Date(pts[i].t);
        parts.push('<text class="axis-text" x="' + xAt(i).toFixed(1) + '" y="' + (H - 6) +
          '" text-anchor="' + (k === 0 ? 'start' : k === 2 ? 'end' : 'middle') + '">' + fmtTime(d) + '</text>');
      });
    } else {
      parts.push('<text class="axis-text" x="' + (W / 2) + '" y="' + (H / 2) + '" text-anchor="middle">กำลังเก็บข้อมูล…</text>');
    }

    svg.innerHTML = parts.join('');
    el.trendWindowLabel.textContent = view.range;
  }

  /* ---- pareto ---- */
  function renderPareto() {
    var list = stationsInView();
    var counts = {};
    list.forEach(function (st) {
      Object.keys(st.defects).forEach(function (k) { counts[k] = (counts[k] || 0) + st.defects[k]; });
    });
    var rows = Object.keys(counts).map(function (k) {
      var d = DEFECTS.filter(function (x) { return x.code === k; })[0];
      return { code: k, n: counts[k], th: d ? d.th : k, en: d ? d.en : '' };
    }).sort(function (a, b) { return b.n - a.n; });

    var total = rows.reduce(function (s, r) { return s + r.n; }, 0);
    el.paretoTotal.textContent = fmtInt(total) + ' NG';

    if (!rows.length) {
      el.paretoList.innerHTML = '';
      el.paretoEmpty.hidden = false;
      return;
    }
    el.paretoEmpty.hidden = true;
    var max = rows[0].n;
    el.paretoList.innerHTML = rows.slice(0, 7).map(function (r) {
      return '<li>' +
        '<div class="p-name">' + r.th + '<small>' + r.code + ' · ' + r.en + '</small></div>' +
        '<div class="p-val">' + fmtInt(r.n) + ' <span>(' + (r.n / total * 100).toFixed(1) + '%)</span></div>' +
        '<div class="p-bar"><i style="width:' + (r.n / max * 100).toFixed(1) + '%"></i></div>' +
        '</li>';
    }).join('');
  }

  /* ---- stations ---- */
  function renderStations() {
    var list = stationsInView();
    var now = Date.now();
    var alarms = 0, warns = 0;

    el.stationGrid.innerHTML = list.map(function (st) {
      var tot = st.ok + st.ng;
      var y = yieldOf(st.ok, tot);
      var idle = S.running && st.lastAt && (now - st.lastAt > st.def.cycle * 3000);
      var cls = 'station', label = 'RUNNING';
      if (tot >= 15 && y < CONFIG.stationAlarmYield) { cls += ' is-alarm'; label = 'ALARM'; alarms++; }
      else if (tot >= 15 && y < CONFIG.stationWarnYield) { cls += ' is-warn'; label = 'WATCH'; warns++; }
      if (!S.running) { cls += ' is-idle'; label = 'PAUSED'; }
      else if (idle) { cls += ' is-idle'; label = 'IDLE'; }

      return '<article class="' + cls + '">' +
        '<div class="st-head">' +
          '<div class="st-name">' + st.def.id + ' · ' + st.def.name + '<small>' + st.def.th + ' — Line ' + st.def.line + '</small></div>' +
          '<span class="st-status">' + label + '</span>' +
        '</div>' +
        '<div class="st-nums">' +
          '<div class="n-ok"><span>OK</span><b>' + fmtInt(st.ok) + '</b></div>' +
          '<div class="n-ng"><span>NG</span><b>' + fmtInt(st.ng) + '</b></div>' +
          '<div><span>YIELD</span><b>' + y.toFixed(1) + '%</b></div>' +
        '</div>' +
        '<div class="st-bar">' +
          '<i style="width:' + (tot ? st.ok / tot * 100 : 100).toFixed(1) + '%"></i>' +
          '<u style="width:' + (tot ? st.ng / tot * 100 : 0).toFixed(1) + '%"></u>' +
        '</div>' +
        '<div class="st-foot"><span>รอบมาตรฐาน <b>' + st.def.cycle.toFixed(1) + 's</b></span>' +
        '<span>ตรวจแล้ว <b>' + fmtInt(tot) + '</b></span></div>' +
        '</article>';
    }).join('');

    el.stationSummary.textContent = list.length + ' สถานี · ' +
      (alarms ? alarms + ' alarm' : warns ? warns + ' watch' : 'ปกติทั้งหมด');
  }

  /* ---- log ---- */
  var lastTopSerial = null;
  function renderLog() {
    var rows = S.log.filter(function (r) {
      if (view.line !== 'ALL' && r.line !== view.line) return false;
      if (view.logFilter !== 'ALL' && r.result !== view.logFilter) return false;
      return true;
    }).slice(0, 60);

    var newTop = rows.length ? rows[0].serial : null;
    if (!rows.length) {
      el.logBody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:26px 14px;color:var(--txt-3)">' +
        'ยังไม่มีรายการที่ตรงกับตัวกรอง' + '</td></tr>';
      lastTopSerial = null;
      el.logCount.textContent = '0 รายการที่แสดง · เก็บล่าสุด ' + fmtInt(S.log.length);
      return;
    }
    el.logBody.innerHTML = rows.map(function (r, i) {
      var isNew = i === 0 && newTop !== lastTopSerial;
      var val = r.value === null ? '—'
        : (r.unit === '-' ? String(r.value) : r.value.toFixed(2) + ' ' + r.unit);
      return '<tr class="' + (r.result === 'NG' ? 'row-ng ' : '') + (isNew ? 'is-new' : '') + '">' +
        '<td class="td-mono">' + fmtTime(r.t) + '</td>' +
        '<td class="td-mono">' + r.serial + '</td>' +
        '<td>' + r.station + ' <small style="color:var(--txt-3)">L' + r.line + '</small></td>' +
        '<td><span class="tag tag-' + r.result.toLowerCase() + '">' + r.result + '</span></td>' +
        '<td class="td-mono' + (r.result === 'NG' ? ' out' : '') + '">' + val + '</td>' +
        '<td class="td-note">' + (r.defect ? r.defect.th + ' (' + r.defect.code + ')' : 'ผ่านเกณฑ์') + '</td>' +
        '</tr>';
    }).join('');
    lastTopSerial = newTop;
    el.logCount.textContent = fmtInt(rows.length) + ' รายการที่แสดง · เก็บล่าสุด ' + fmtInt(S.log.length);
  }

  /* --------------------------------------------------------------- chrome */

  function tickClock() {
    var now = new Date();
    el.clock.textContent = fmtTime(now);
    el.shiftName.textContent = shiftOf(now);
    var up = Math.floor((Date.now() - S.startedAt) / 1000);
    el.uptime.textContent = 'uptime ' + pad(Math.floor(up / 60)) + ':' + pad(up % 60);
  }

  function setRunning(run) {
    S.running = run;
    S.lastTick = Date.now();
    el.btnPause.setAttribute('aria-pressed', String(!run));
    el.btnPause.querySelector('.lbl').textContent = run ? 'หยุดชั่วคราว' : 'เริ่มต่อ';
    el.btnPause.querySelector('.ic').textContent = run ? '❚❚' : '▶';
    el.connBadge.dataset.state = run ? 'live' : 'paused';
    el.connText.textContent = run ? 'LIVE' : 'PAUSED';
    renderStations();
  }

  function resetShift() {
    S = freshState();
    lastTopSerial = null;
    el.alertBar.hidden = true;
    setRunning(true);
    render();
  }

  function exportCsv() {
    var head = ['timestamp', 'serial', 'line', 'station', 'result', 'value', 'unit', 'defect_code', 'defect_th'];
    var lines = [head.join(',')];
    S.log.slice().reverse().forEach(function (r) {
      lines.push([
        r.t.toISOString(), r.serial, r.line, r.station, r.result,
        r.value === null ? '' : (typeof r.value === 'number' ? r.value.toFixed(3) : r.value),
        r.unit, r.defect ? r.defect.code : '', r.defect ? '"' + r.defect.th + '"' : ''
      ].join(','));
    });
    var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'okng-log-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '') + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('okng-theme', t); } catch (e) { /* ignore */ }
  }

  /* --------------------------------------------------------------- wiring */

  function bind() {
    el.btnPause.addEventListener('click', function () { setRunning(!S.running); });
    el.btnReset.addEventListener('click', function () {
      if (window.confirm('รีเซ็ตข้อมูลทั้งหมดของกะนี้?')) resetShift();
    });
    el.btnTheme.addEventListener('click', function () {
      applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
      render();
    });
    el.alertClose.addEventListener('click', function () { el.alertBar.hidden = true; });
    el.lineSelect.addEventListener('change', function () { view.line = this.value; render(); });
    el.btnExport.addEventListener('click', exportCsv);

    document.querySelectorAll('.seg-btn[data-range]').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.seg-btn[data-range]').forEach(function (x) { x.classList.remove('is-active'); });
        b.classList.add('is-active');
        view.range = parseInt(b.dataset.range, 10);
        renderChart();
      });
    });
    document.querySelectorAll('.seg-btn[data-filter]').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.seg-btn[data-filter]').forEach(function (x) { x.classList.remove('is-active'); });
        b.classList.add('is-active');
        view.logFilter = b.dataset.filter;
        lastTopSerial = null;
        renderLog();
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); setRunning(!S.running); }
      if (e.key === 'r' || e.key === 'R') resetShift();
    });
  }

  /* ----------------------------------------------------------------- boot */

  function boot() {
    var saved = null;
    try { saved = localStorage.getItem('okng-theme'); } catch (e) { /* ignore */ }
    applyTheme(saved === 'light' ? 'light' : 'dark');

    S = freshState();
    bind();

    // seed history so the dashboard is populated on first paint
    var seedNow = Date.now();
    S.startedAt = seedNow - 90000;
    S.lastTick = seedNow - 90000;
    for (var i = 0; i < 30; i++) {
      var b = newBucket(seedNow - (30 - i) * CONFIG.bucketMs);
      S.stations.forEach(function (st) {
        var n = Math.max(1, Math.round(CONFIG.bucketMs / 1000 / st.def.cycle));
        for (var k = 0; k < n; k++) {
          var isNg = Math.random() < st.def.ngRate;
          if (isNg) {
            var d = pickDefect();
            st.ng++; S.ng++;
            st.defects[d.code] = (st.defects[d.code] || 0) + 1;
            S.defects[d.code] = (S.defects[d.code] || 0) + 1;
          } else { st.ok++; S.ok++; }
          S.total++;
          addToBucket(b, st.def.line, isNg);
        }
      });
      S.buckets.push(b);
      S.rateHist.push(b.ok + b.ng);
    }
    S.curBucket = newBucket(seedNow);
    S.lastTick = seedNow;
    S.startedAt = seedNow - 90000;

    setRunning(true);
    tickClock();
    render();

    setInterval(tick, CONFIG.tickMs);
    setInterval(tickClock, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
