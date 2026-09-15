/* ==========================================================================
   OKNG Monitor v3 — Color Inspection System
   Vanilla JS port of the source design's component logic.
   ========================================================================== */
(function () {
  'use strict';

  var NAMES = ['Press A1', 'Press A2', 'Weld B1', 'Weld B2', 'Assy C1', 'Assy C2',
               'Inspect D1', 'Inspect D2', 'Paint E1', 'Pack F1', 'Pack F2', 'Trim G1'];

  var NAV = [
    { label: 'แดชบอร์ด', icon: '▤', tint: '#e7e9fd', ink: '#4f56e0' },
    { label: 'บันทึกผล', icon: '✎', tint: '#e5f5ec', ink: '#2f9e52' },
    { label: 'ประวัติ',  icon: '≡', tint: '#e9eefb', ink: '#3f74d8' },
    { label: 'ล็อตงาน',  icon: '▦', tint: '#fdf0e2', ink: '#c67139' },
    { label: 'รายงาน',   icon: '◈', tint: '#fdeaf1', ink: '#c8407a' }
  ];

  var STATION_COUNT = 11;

  var fmt = function (n) { return n.toLocaleString('en-US'); };
  var pad2 = function (n) { return String(n).padStart(2, '0'); };
  var hhmm = function (d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
  var thDate = function (ts) {
    return new Date(ts).toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  var esc = function (s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  /* ---------------------------------------------------------------- state */

  var S = {
    all: [], st: [], removed: [], sel: null,
    series: {}, events: {},
    view: 'แดชบอร์ด', q: '',
    theme: 'cool', font: 'sarabun', tv: false,
    clock: hhmm(new Date())
  };

  function buildStations() {
    var st = [];
    for (var i = 0; i < STATION_COUNT; i++) {
      var ok = 40 + Math.floor(Math.random() * 900);
      var ng = 2 + Math.floor(Math.random() * 24);
      st.push({
        id: 'ST-' + String(i + 1).padStart(3, '0'),
        name: NAMES[i % NAMES.length],
        ok: ok, ng: ng, ngBox: ng, setting: 1000,
        rate: 1.6 + Math.random() * 2.4,
        downtime: Math.random() * 4,
        lockSec: 0, offline: false
      });
    }
    // the design opens with station 1 locked and station 6 off the air
    st[0].ng = st[0].ngBox + 1;
    st[0].lockSec = 6;
    if (st[5]) st[5].offline = true;
    return st;
  }

  function seedEvents(s) {
    var out = [], t = Date.now(), ng = s.ng, box = s.ngBox;
    for (var i = 0; i < 40; i++) {
      t -= (2 + Math.random() * 16) * 60000;
      out.push({
        ts: t, type: i % 4 === 3 ? 'NG_BOXED' : 'NG',
        ok: Math.max(s.ok - i * 7, 0), ng: ng--, box: box--
      });
    }
    return out;
  }

  function hoursOf(s) {
    if (!S.series[s.id]) {
      var hours = [];
      for (var i = 11; i >= 0; i--) {
        var h = new Date(Date.now() - i * 3600000);
        var ok = Math.max(2, Math.round(s.rate * 60 * (0.5 + Math.random() * 0.7) / 8));
        hours.push({ h: h, ok: ok, ng: Math.max(0, Math.round(ok * (0.01 + Math.random() * 0.12))) });
      }
      S.series[s.id] = hours;
    }
    return S.series[s.id];
  }

  function current() {
    return S.st.filter(function (x) { return x.id === S.sel; })[0] || S.st[0] || null;
  }

  /* ------------------------------------------------------------- elements */

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    side: $('stationSelect'), nav: $('nav'), view: $('view'),
    crumb: $('crumbView'), title: $('stationTitle'), sub: $('stationSub'),
    lock: $('lockBanner'), lockDetail: $('lockDetail'), btnClearLock: $('btnClearLock'),
    health: $('health'), healthText: $('healthText'), count: $('stationCount'),
    search: $('search'), btnRemove: $('btnRemove'), btnRestore: $('btnRestore'),
    btnRefresh: $('btnRefresh'), btnExport: $('btnExport'), btnTv: $('btnTv'),
    theme: $('themeSelect'), font: $('fontSelect')
  };

  /* -------------------------------------------------------------- chrome */

  function renderNav() {
    el.nav.innerHTML = NAV.map(function (n) {
      var on = S.view === n.label;
      return '<button class="nav-item" type="button" data-view="' + esc(n.label) + '"' +
        (on ? ' aria-current="page"' : '') + '>' +
        '<span class="nav-ic" style="background:' + n.tint + ';color:' + n.ink + '">' + n.icon + '</span>' +
        esc(n.label) + '</button>';
    }).join('');
  }

  function renderStationSelect() {
    el.side.innerHTML = S.st.map(function (x) {
      return '<option value="' + esc(x.id) + '"' + (x.id === S.sel ? ' selected' : '') + '>' +
        esc(x.id + ' · ' + x.name) + '</option>';
    }).join('');
    el.btnRemove.disabled = S.st.length <= 1;
    el.btnRestore.disabled = !S.removed.length;
    el.count.textContent = S.st.length + ' สถานี' + (S.removed.length ? ' · ลบไป ' + S.removed.length : '');
  }

  function renderHeader(s) {
    el.crumb.textContent = S.view;
    el.title.textContent = s ? s.id + ' · ' + s.name : 'ไม่มีสถานี';
    el.sub.textContent = 'ภาพรวมผลการเทสวันนี้ — อัปเดตล่าสุด ' + S.clock;

    var locked = s && s.ng > s.ngBox;
    el.lock.hidden = !locked;
    if (locked) {
      el.lockDetail.textContent = s.id + ' ค้าง ' + (s.ng - s.ngBox) + ' ชิ้น · LOCK ' + s.lockSec + ' วินาที';
    }

    var off = s && s.offline;
    el.health.classList.toggle('is-off', !!off);
    el.healthText.textContent = off ? 'ไม่มีข้อมูลใหม่ 3 นาที' : 'heartbeat ปกติ';
  }

  /* --------------------------------------------------------------- views */

  function kpisOf(s) {
    var total = s.ok + s.ng;
    var locked = s.ng > s.ngBox;
    var eta = s.rate > 0 ? (s.setting - s.ok) / s.rate : 0;
    return [
      { label: 'OK สะสม', value: fmt(s.ok), unit: 'ชิ้น', icon: '✓', edge: '#2f9e52', tint: 'var(--ok-tint)', tagInk: 'var(--ok-ink)', tag: 'ผ่านการตรวจสีครบ' },
      { label: 'NG สะสม', value: fmt(s.ng), unit: 'ชิ้น', icon: '✕', edge: '#e0342f', tint: 'var(--ng-tint)', tagInk: 'var(--ng-ink)', tag: locked ? 'ค้าง ' + (s.ng - s.ngBox) + ' ชิ้น' : 'เข้ากล่องครบ' },
      { label: 'Yield', value: (total ? s.ok / total * 100 : 100).toFixed(1) + '%', unit: '', icon: '%', edge: '#4f7fe8', tint: 'var(--info-tint)', tagInk: 'var(--info-ink)', tag: 'OK / ทั้งหมด' },
      { label: 'อัตราผลิต', value: s.offline ? '0.0' : s.rate.toFixed(1), unit: 'ชิ้น/นาที', icon: '⚡', edge: '#7c56e0', tint: 'var(--violet-tint)', tagInk: '#7c56e0', tag: 'ETA ' + Math.max(eta, 0).toFixed(1) + ' นาที' },
      { label: 'Downtime วันนี้', value: s.downtime.toFixed(1), unit: 'นาที', icon: '◔', edge: '#c67139', tint: 'var(--clay-tint)', tagInk: '#c67139', tag: 'LOCK สะสม' }
    ];
  }

  function kpiHtml(k) {
    return '<article class="card">' +
      '<div class="kpi-top">' +
        '<span class="kpi-ic" style="background:' + k.tint + ';color:' + k.edge + '">' + k.icon + '</span>' +
        '<span class="kpi-label">' + esc(k.label) + '</span>' +
      '</div>' +
      '<div class="kpi-val"><b class="num">' + esc(k.value) + '</b>' +
        (k.unit ? '<span>' + esc(k.unit) + '</span>' : '') + '</div>' +
      '<div class="kpi-rule" style="background:' + k.edge + '"></div>' +
      '<span class="chip" style="background:' + k.tint + ';color:' + k.tagInk + '">' + esc(k.tag) + '</span>' +
      '</article>';
  }

  function ioOf(s, locked, pct) {
    return [
      { pin: 'D9', name: 'เซ็นเซอร์ตรวจพบสี', dot: s.offline ? '#c3c8d8' : '#2f9e52', state: s.offline ? 'ไม่มีสัญญาณ' : 'ว่าง', tint: s.offline ? 'var(--soft)' : 'var(--ok-tint)', ink: s.offline ? 'var(--muted)' : 'var(--ok-ink)' },
      { pin: 'D11', name: 'OK output', dot: '#4f7fe8', state: 'ว่าง', tint: 'var(--info-tint)', ink: 'var(--info-ink)' },
      { pin: 'D12', name: 'NG / LOCK', dot: locked ? '#e0342f' : '#c3c8d8', state: locked ? 'LOCK' : 'ปกติ', tint: locked ? 'var(--ng-tint)' : 'var(--soft)', ink: locked ? 'var(--ng-ink)' : 'var(--muted)' },
      { pin: 'D5 / D6', name: 'Full counter', dot: pct >= 100 ? '#e0a020' : '#c3c8d8', state: pct >= 100 ? 'ครบล็อต' : 'ยังไม่ครบ', tint: pct >= 100 ? 'var(--amber-tint)' : 'var(--soft)', ink: pct >= 100 ? 'var(--amber-ink)' : 'var(--muted)' }
    ];
  }

  function viewDashboard(s) {
    var locked = s.ng > s.ngBox;
    var pct = Math.min(s.ok / Math.max(s.setting, 1) * 100, 100);
    var eta = s.rate > 0 ? (s.setting - s.ok) / s.rate : 0;
    var hours = hoursOf(s);
    var maxBar = Math.max.apply(null, hours.map(function (h) { return h.ok + h.ng; }).concat([1]));

    var bars = hours.map(function (h) {
      var tot = h.ok + h.ng;
      return '<div class="bar-col">' +
        '<div class="bar-pair">' +
          '<i class="bar-ok" data-v="' + tot + '" style="height:' + Math.max(8, tot / maxBar * 168).toFixed(0) + 'px"></i>' +
          '<i class="bar-ng" style="height:' + Math.max(4, h.ng / maxBar * 168).toFixed(0) + 'px"></i>' +
        '</div>' +
        '<span class="bar-h">' + pad2(h.h.getHours()) + '</span>' +
        '</div>';
    }).join('');

    // yield trend polyline over the same 12 hours
    var pts = hours.map(function (h, i) {
      var y = (h.ok + h.ng) ? h.ok / (h.ok + h.ng) * 100 : 100;
      return (i / 11 * 470 + 5).toFixed(1) + ',' + (140 - y / 100 * 120).toFixed(1);
    }).join(' ');

    var io = ioOf(s, locked, pct).map(function (r) {
      return '<div class="io-row" style="background:' + r.tint + '">' +
        '<span class="io-dot" style="background:' + r.dot + '"></span>' +
        '<span class="io-pin" style="color:' + r.ink + '">' + esc(r.pin) + '</span>' +
        '<span class="io-name">' + esc(r.name) + '</span>' +
        '<span class="io-state" style="color:' + r.ink + '">' + esc(r.state) + '</span>' +
        '</div>';
    }).join('');

    var evs = eventsFor(s);

    return '<section class="grid-kpi">' + kpisOf(s).map(kpiHtml).join('') + '</section>' +

      '<section class="grid-2">' +
        '<article class="card">' +
          '<div class="card-head"><div><h2>OK / NG รายชั่วโมง</h2>' +
            '<p>12 ชั่วโมงที่ผ่านมา · ' + hhmm(hours[0].h) + ' → ' + hhmm(hours[hours.length - 1].h) + '</p></div>' +
            '<div class="legend"><span><i style="background:var(--info)"></i>OK</span>' +
            '<span><i style="background:var(--bar-ng)"></i>NG</span></div></div>' +
          '<div class="bars">' + bars + '</div>' +
        '</article>' +
        '<article class="card">' +
          '<div class="card-head"><div><h2>ความก้าวหน้าของล็อต</h2><p>Counting vs Setting</p></div></div>' +
          '<div class="gauge-wrap">' +
            '<svg class="gauge" viewBox="0 0 200 110" aria-hidden="true">' +
              '<path class="gauge-track" d="M15 100 A85 85 0 0 1 185 100"/>' +
              '<path class="gauge-fill" d="M15 100 A85 85 0 0 1 185 100" ' +
                'style="stroke-dasharray:' + (pct / 100 * 267).toFixed(1) + ' 267"/>' +
            '</svg>' +
            '<strong class="gauge-val num">' + Math.round(pct) + '%</strong>' +
            '<span class="gauge-sub num">' + fmt(s.ok) + ' / ' + fmt(s.setting) + ' pcs</span>' +
          '</div>' +
          '<div class="rows">' +
            '<div><span>อัตราผลิต</span><b>' + s.rate.toFixed(1) + ' ชิ้น/นาที</b></div>' +
            '<div><span>คาดว่าจะครบใน</span><b>' + Math.max(eta, 0).toFixed(1) + ' นาที</b></div>' +
            '<div><span>Downtime วันนี้</span><b>' + s.downtime.toFixed(1) + ' นาที</b></div>' +
          '</div>' +
        '</article>' +
      '</section>' +

      '<section class="grid-2b">' +
        '<article class="card">' +
          '<div class="card-head"><div><h2>สถานะ I/O</h2></div></div>' +
          '<p class="big-stat">LOCK ต่อเนื่องขณะนี้<b class="num">' + s.lockSec + '<small> วินาที</small></b></p>' +
          '<p class="big-hint">' + (locked ? 'ต้องนำ NG เข้ากล่องเพื่อปลดล็อก' : 'ยังไม่มี NG ค้างในกะนี้') + '</p>' +
          '<div class="io">' + io + '</div>' +
        '</article>' +
        '<article class="card">' +
          '<div class="card-head"><div><h2>Yield Trend</h2><p>เปอร์เซ็นต์ OK รายชั่วโมง</p></div></div>' +
          '<svg class="trend" viewBox="0 0 480 150" preserveAspectRatio="none" role="img" aria-label="แนวโน้ม Yield">' +
            '<polygon class="trend-area" points="5,140 ' + pts + ' 475,140"/>' +
            '<polyline class="trend-line" points="' + pts + '"/>' +
          '</svg>' +
          '<div class="trend-axis"><span>' + hhmm(hours[0].h) + '</span><span>100 · 50 · 0 %</span>' +
            '<span>' + hhmm(hours[hours.length - 1].h) + '</span></div>' +
        '</article>' +
      '</section>' +

      '<article class="card">' +
        '<div class="card-head"><div><h2>NG events ล่าสุด</h2></div>' +
          '<span class="card-note">' + fmt(evs.length) + ' รายการ</span></div>' +
        (evs.length ? '<div class="tbl-wrap"><table><thead><tr>' +
          '<th>เวลา</th><th>ชนิด</th><th class="t-right">OK</th><th class="t-right">NG</th><th class="t-right">ในกล่อง</th>' +
          '</tr></thead><tbody>' + evs.map(function (e) {
            return '<tr><td class="num">' + esc(thDate(e.ts)) + '</td>' +
              '<td>' + typeTag(e.type) + '</td>' +
              '<td class="t-right">' + fmt(e.ok) + '</td>' +
              '<td class="t-right">' + fmt(Math.max(e.ng, 0)) + '</td>' +
              '<td class="t-right">' + fmt(Math.max(e.box, 0)) + '</td></tr>';
          }).join('') + '</tbody></table></div>'
        : '<p class="empty">ไม่พบ event ที่ตรงกับคำค้น</p>') +
      '</article>';
  }

  function typeTag(t) {
    var boxed = t === 'NG_BOXED';
    return '<span class="chip" style="background:' + (boxed ? 'var(--ok-tint)' : 'var(--ng-tint)') +
      ';color:' + (boxed ? 'var(--ok-ink)' : 'var(--ng-ink)') + '">' + esc(t) + '</span>';
  }

  function eventsFor(s) {
    var all = S.events[s.id] || [];
    var q = S.q.toLowerCase();
    if (!q) return all;
    return all.filter(function (e) {
      return (e.type + ' ' + thDate(e.ts)).toLowerCase().indexOf(q) !== -1;
    });
  }

  function viewLog(s) {
    var recent = (S.events[s.id] || []).slice(0, 10);
    return '<div class="log-actions">' +
        '<button class="b b-primary" type="button" data-act="addOk">+ บันทึก OK</button>' +
        '<button class="b b-danger" type="button" data-act="addNg">+ บันทึก NG</button>' +
      '</div>' +
      '<article class="card">' +
        '<div class="card-head"><div><h2>10 รายการที่บันทึกล่าสุด</h2></div>' +
          '<span class="card-note">OK ' + fmt(s.ok) + ' · NG ' + fmt(s.ng) + '</span></div>' +
        (recent.length ? '<div class="log-list">' + recent.map(function (e) {
          var boxed = e.type === 'NG_BOXED';
          return '<div class="log-row">' +
            '<span class="log-dot" style="background:' + (boxed ? '#2f9e52' : '#e0342f') + '"></span>' +
            '<span class="log-type">' + esc(e.type) + '</span>' +
            '<span class="log-time">' + esc(thDate(e.ts)) + '</span></div>';
        }).join('') + '</div>' : '<p class="empty">ยังไม่มีรายการที่บันทึก</p>') +
      '</article>';
  }

  function viewHistory() {
    var rows = [];
    S.st.forEach(function (x) {
      (S.events[x.id] || []).forEach(function (e) { rows.push({ station: x.id, e: e }); });
    });
    rows.sort(function (a, b) { return b.e.ts - a.e.ts; });
    var q = S.q.toLowerCase();
    rows = rows.map(function (r) {
      return { station: r.station, type: r.e.type, time: thDate(r.e.ts),
        ok: r.e.ok, ng: Math.max(r.e.ng, 0), box: Math.max(r.e.box, 0) };
    }).filter(function (r) {
      return !q || (r.station + ' ' + r.type + ' ' + r.time).toLowerCase().indexOf(q) !== -1;
    }).slice(0, 300);

    return '<article class="card">' +
      '<div class="card-head"><div><h2>ประวัติ event ทุกสถานี</h2>' +
        '<p>' + fmt(rows.length) + ' รายการ · กรองด้วยช่องค้นหาด้านบน</p></div></div>' +
      (rows.length ? '<div class="tbl-wrap"><table><thead><tr>' +
        '<th>เวลา</th><th>สถานี</th><th>ชนิด</th><th class="t-right">OK</th><th class="t-right">NG</th><th class="t-right">ในกล่อง</th>' +
        '</tr></thead><tbody>' + rows.map(function (r) {
          return '<tr><td class="num">' + esc(r.time) + '</td>' +
            '<td class="t-id">' + esc(r.station) + '</td>' +
            '<td>' + typeTag(r.type) + '</td>' +
            '<td class="t-right">' + fmt(r.ok) + '</td>' +
            '<td class="t-right">' + fmt(r.ng) + '</td>' +
            '<td class="t-right">' + fmt(r.box) + '</td></tr>';
        }).join('') + '</tbody></table></div>'
      : '<p class="empty">ไม่พบ event ที่ตรงกับคำค้น</p>') +
      '</article>';
  }

  function viewLots() {
    return '<div class="lots">' + S.st.map(function (x) {
      var p = Math.min(x.ok / Math.max(x.setting, 1) * 100, 100);
      var lk = x.ng > x.ngBox;
      var edge = lk ? '#e0342f' : p >= 100 ? '#e0a020' : x.offline ? '#8a90ab' : '#2f9e52';
      var tint = lk ? 'var(--ng-tint)' : p >= 100 ? 'var(--amber-tint)' : x.offline ? 'var(--soft)' : 'var(--ok-tint)';
      var status = lk ? 'LOCK' : x.offline ? 'NO SIGNAL' : p >= 100 ? 'ครบล็อต' : 'กำลังผลิต';
      return '<button class="lot" type="button" data-lot="' + esc(x.id) + '">' +
        '<div class="lot-head"><span class="lot-id">' + esc(x.id) + '<small>' + esc(x.name) + '</small></span>' +
          '<span class="chip" style="background:' + tint + ';color:' + edge + '">' + esc(status) + '</span></div>' +
        '<div class="lot-head"><span class="lot-pct" style="color:' + edge + '">' + Math.round(p) + '%</span>' +
          '<span class="lot-meta num">' + fmt(x.ok) + ' / ' + fmt(x.setting) + ' pcs</span></div>' +
        '<div class="lot-bar"><i style="width:' + p.toFixed(1) + '%;background:' + edge + '"></i></div>' +
        '<div class="lot-meta"><span>OK ' + fmt(x.ok) + '</span><span>NG ' + fmt(x.ng) + '</span>' +
          '<span>ETA ' + (x.rate > 0 ? Math.max((x.setting - x.ok) / x.rate, 0).toFixed(1) + ' นาที' : '—') + '</span></div>' +
        '</button>';
    }).join('') + '</div>';
  }

  function reportRows() {
    return S.st.map(function (x) {
      var t = x.ok + x.ng, lk = x.ng > x.ngBox;
      return {
        id: x.id, name: x.name, ok: x.ok, ng: x.ng,
        ngPct: (t ? x.ng / t * 100 : 0).toFixed(2),
        yield: (t ? x.ok / t * 100 : 100).toFixed(1),
        status: lk ? 'LOCK' : x.offline ? 'NO SIGNAL' : 'ปกติ',
        edge: lk ? 'var(--ng-ink)' : x.offline ? 'var(--muted)' : 'var(--ok-ink)',
        tint: lk ? 'var(--ng-tint)' : x.offline ? 'var(--soft)' : 'var(--ok-tint)'
      };
    });
  }

  function viewReport() {
    var rows = reportRows();
    var repOk = S.st.reduce(function (a, x) { return a + x.ok; }, 0);
    var repNg = S.st.reduce(function (a, x) { return a + x.ng; }, 0);
    var totals = [
      { label: 'สถานีที่มอนิเตอร์', value: fmt(S.st.length), ink: 'var(--ink)' },
      { label: 'OK รวม', value: fmt(repOk), ink: 'var(--ok-ink)' },
      { label: 'NG รวม', value: fmt(repNg), ink: 'var(--ng-ink)' },
      { label: 'Yield รวม', value: (repOk + repNg ? repOk / (repOk + repNg) * 100 : 100).toFixed(1) + '%', ink: 'var(--accent)' }
    ];

    return '<section class="grid-tot">' + totals.map(function (t) {
        return '<article class="card"><span class="tot-label">' + esc(t.label) + '</span>' +
          '<div class="tot-val num" style="color:' + t.ink + '">' + esc(t.value) + '</div></article>';
      }).join('') + '</section>' +
      '<article class="card">' +
        '<div class="card-head"><div><h2>สรุปรายสถานี</h2></div>' +
          '<button class="b b-primary b-sm" type="button" data-act="exportReport">↓ Export รายงาน CSV</button></div>' +
        '<div class="tbl-wrap"><table><thead><tr>' +
          '<th>สถานี</th><th>ชื่อ</th><th class="t-right">OK</th><th class="t-right">NG</th>' +
          '<th class="t-right">%NG</th><th class="t-right">Yield</th><th>สถานะ</th>' +
        '</tr></thead><tbody>' + rows.map(function (r) {
          return '<tr><td class="t-id">' + esc(r.id) + '</td><td>' + esc(r.name) + '</td>' +
            '<td class="t-right t-ok">' + fmt(r.ok) + '</td>' +
            '<td class="t-right t-ng">' + fmt(r.ng) + '</td>' +
            '<td class="t-right">' + r.ngPct + '%</td>' +
            '<td class="t-right">' + r.yield + '%</td>' +
            '<td><span class="chip" style="background:' + r.tint + ';color:' + r.edge + '">' + esc(r.status) + '</span></td></tr>';
        }).join('') + '</tbody></table></div>' +
      '</article>';
  }

  /* -------------------------------------------------------------- render */

  function render() {
    var s = current();
    renderStationSelect();
    renderNav();
    renderHeader(s);

    if (!s) {
      el.view.innerHTML = '<article class="card"><p class="empty">ลบสถานีไปหมดแล้ว — กด “คืนค่าสถานีที่ลบ” เพื่อเรียกคืน</p></article>';
      return;
    }
    if (S.view === 'บันทึกผล') el.view.innerHTML = viewLog(s);
    else if (S.view === 'ประวัติ') el.view.innerHTML = viewHistory();
    else if (S.view === 'ล็อตงาน') el.view.innerHTML = viewLots();
    else if (S.view === 'รายงาน') el.view.innerHTML = viewReport();
    else el.view.innerHTML = viewDashboard(s);
  }

  /* -------------------------------------------------------------- export */

  var hostDownloads = null;

  function saveCsv(name, rows) {
    var text = '﻿' + rows.map(function (r) { return r.join(','); }).join('\n');
    if (hostDownloads) {
      hostDownloads.save({ filename: name, data: text }).catch(function (err) {
        var code = err && err.code;
        if (code === 'declined' || code === 'rate_limited') return;
        window.alert('บันทึกไฟล์ไม่สำเร็จ (' + (code || 'error') + ')');
      });
      return;
    }
    var url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' }));
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportEvents() {
    var s = current();
    if (!s) return;
    var rows = [['time', 'type', 'ok', 'ng', 'in_box']].concat(
      (S.events[s.id] || []).map(function (e) {
        return [new Date(e.ts).toISOString(), e.type, e.ok, Math.max(e.ng, 0), Math.max(e.box, 0)];
      }));
    saveCsv(s.id + '-events.csv', rows);
  }

  function exportReport() {
    var rows = [['station', 'name', 'ok', 'ng', 'ng_pct', 'yield', 'status']].concat(
      reportRows().map(function (r) { return [r.id, r.name, r.ok, r.ng, r.ngPct, r.yield, r.status]; }));
    saveCsv('station-report.csv', rows);
  }

  /* ------------------------------------------------------------- actions */

  function patch(id, fn) {
    S.st = S.st.map(function (x) { return x.id === id ? fn(x) : x; });
  }

  function applyLook() {
    document.documentElement.setAttribute('data-theme', S.theme);
    document.documentElement.setAttribute('data-font', S.font);
    document.documentElement.setAttribute('data-tv', S.tv ? 'on' : 'off');
    el.btnTv.textContent = S.tv ? 'ออกจากโหมด TV' : 'โหมด TV';
    try {
      localStorage.setItem('okng-look', JSON.stringify({ theme: S.theme, font: S.font, tv: S.tv }));
    } catch (e) { /* ignore */ }
  }

  function bind() {
    el.nav.addEventListener('click', function (e) {
      var b = e.target.closest('[data-view]');
      if (!b) return;
      S.view = b.dataset.view;
      render();
    });

    el.side.addEventListener('change', function () { S.sel = this.value; render(); });

    el.btnRemove.addEventListener('click', function () {
      var s = current();
      if (!s || S.st.length <= 1) return;
      S.st = S.st.filter(function (x) { return x.id !== s.id; });
      S.removed = S.removed.concat(s.id);
      S.sel = S.st.length ? S.st[0].id : null;
      render();
    });

    el.btnRestore.addEventListener('click', function () {
      S.st = S.all.slice();
      S.removed = [];
      if (!S.sel || !current()) S.sel = S.st[0].id;
      render();
    });

    el.btnClearLock.addEventListener('click', function () {
      var s = current();
      if (!s) return;
      patch(s.id, function (x) { return Object.assign({}, x, { ngBox: x.ng, lockSec: 0 }); });
      render();
    });

    el.btnRefresh.addEventListener('click', function () { S.clock = hhmm(new Date()); render(); });
    el.btnExport.addEventListener('click', exportEvents);

    el.search.addEventListener('input', function () { S.q = this.value; render(); });

    el.theme.addEventListener('change', function () { S.theme = this.value; applyLook(); });
    el.font.addEventListener('change', function () { S.font = this.value; applyLook(); });
    el.btnTv.addEventListener('click', function () { S.tv = !S.tv; applyLook(); });

    el.view.addEventListener('click', function (e) {
      var lot = e.target.closest('[data-lot]');
      if (lot) { S.sel = lot.dataset.lot; S.view = 'แดชบอร์ด'; render(); return; }

      var act = e.target.closest('[data-act]');
      if (!act) return;
      var s = current();
      if (act.dataset.act === 'exportReport') { exportReport(); return; }
      if (!s) return;
      if (act.dataset.act === 'addOk') {
        patch(s.id, function (x) { return Object.assign({}, x, { ok: x.ok + 1 }); });
      } else if (act.dataset.act === 'addNg') {
        S.events[s.id] = [{ ts: Date.now(), type: 'NG', ok: s.ok, ng: s.ng + 1, box: s.ngBox }]
          .concat(S.events[s.id] || []);
        patch(s.id, function (x) { return Object.assign({}, x, { ng: x.ng + 1 }); });
      }
      render();
    });
  }

  function tick() {
    S.clock = hhmm(new Date());
    S.st = S.st.map(function (s) {
      if (s.offline) return s;
      var locked = s.ng > s.ngBox;
      return Object.assign({}, s, {
        ok: locked ? s.ok : Math.min(s.ok + (Math.random() < s.rate / 12 ? 1 : 0), s.setting),
        lockSec: locked ? s.lockSec + 1 : 0
      });
    });
    render();
  }

  function initDownloads() {
    if (!window.claude || typeof window.claude.use !== 'function') return;
    window.claude.use('downloads').then(function (dl) {
      hostDownloads = dl;
      if (!dl) {
        el.btnExport.hidden = true;
        var r = el.view.querySelector('[data-act="exportReport"]');
        if (r) r.hidden = true;
      }
    }, function () { el.btnExport.hidden = true; });
  }

  function boot() {
    try {
      var saved = JSON.parse(localStorage.getItem('okng-look') || 'null');
      if (saved) {
        if (saved.theme) S.theme = saved.theme;
        if (saved.font) S.font = saved.font;
        S.tv = !!saved.tv;
      }
    } catch (e) { /* ignore */ }
    el.theme.value = S.theme;
    el.font.value = S.font;
    applyLook();

    S.all = buildStations();
    S.st = S.all.slice();
    S.sel = S.st[0].id;
    S.st.forEach(function (s) { S.events[s.id] = seedEvents(s); });

    bind();
    render();
    initDownloads();
    setInterval(tick, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
