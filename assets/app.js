/* ==========================================================================
   OKNG Monitor v3 — Color Inspection System
   Reads the live machine from Supabase: status (one row), event_log and
   commands. RLS only grants those reads to signed-in users, so the page
   opens on a login gate.
   ========================================================================== */
(function () {
  'use strict';

  var CFG = window.OKNG_CONFIG;
  var sb = null;

  var NAV = [
    { label: 'แดชบอร์ด', icon: '▤', tint: '#e7e9fd', ink: '#4f56e0' },
    { label: 'บันทึกผล', icon: '✎', tint: '#e5f5ec', ink: '#2f9e52' },
    { label: 'ประวัติ',  icon: '≡', tint: '#e9eefb', ink: '#3f74d8' },
    { label: 'ล็อตงาน',  icon: '▦', tint: '#fdf0e2', ink: '#c67139' },
    { label: 'รายงาน',   icon: '◈', tint: '#fdeaf1', ink: '#c8407a' }
  ];

  var fmt = function (n) { return Number(n || 0).toLocaleString('en-US'); };
  var pad2 = function (n) { return String(n).padStart(2, '0'); };
  var hhmm = function (d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
  var thDate = function (ts) {
    return new Date(ts).toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  var ago = function (ts) {
    if (!ts) return 'ไม่เคยส่งข้อมูล';
    var ms = Date.now() - new Date(ts).getTime();
    var m = Math.floor(ms / 60000);
    if (m < 1) return 'เมื่อสักครู่';
    if (m < 60) return m + ' นาทีที่แล้ว';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' ชั่วโมงที่แล้ว';
    return Math.floor(h / 24) + ' วันที่แล้ว';
  };

  /* ---------------------------------------------------------------- state */

  var S = {
    status: null, events: [], commands: [],
    view: 'แดชบอร์ด', q: '',
    theme: 'cool', font: 'sarabun', tv: false,
    live: 'off', notice: null, noticeKind: 'warn'
  };

  var $ = function (id) { return document.getElementById(id); };
  var el = {};

  /* ------------------------------------------------------------- derived */

  function offline() {
    if (!S.status) return true;
    var seen = S.status.device_seen_at || S.status.updated_at;
    return !seen || (Date.now() - new Date(seen).getTime()) > CFG.offlineAfterMs;
  }
  function locked() {
    return !!(S.status && (S.status.lock_old || S.status.lock_auto));
  }
  function yieldPct() {
    if (!S.status) return 100;
    var t = Number(S.status.ok_total || 0) + Number(S.status.ng_total || 0);
    return t ? Number(S.status.ok_total || 0) / t * 100 : 100;
  }
  function lotPct() {
    if (!S.status) return 0;
    var setting = Number(S.status.setting || 0);
    return setting > 0 ? Math.min(Number(S.status.counting || 0) / setting * 100, 100) : 0;
  }
  function etaMin() {
    if (!S.status) return 0;
    var rate = Number(S.status.rate || 0);
    var left = Number(S.status.setting || 0) - Number(S.status.counting || 0);
    return rate > 0 ? Math.max(left / rate, 0) : 0;
  }
  function categoryOf(ev) {
    var e = String(ev || '').toLowerCase();
    if (CFG.okEvents.indexOf(e) !== -1) return 'ok';
    if (CFG.ngEvents.indexOf(e) !== -1) return 'ng';
    return 'other';
  }

  /* -------------------------------------------------------------- loading */

  function setNotice(msg, kind) {
    S.notice = msg || null;
    S.noticeKind = kind || 'warn';
  }

  function setLive(state, label) {
    S.live = state;
    el.liveBadge.dataset.state = state;
    el.liveText.textContent = label;
  }

  async function loadAll() {
    try {
      var res = await Promise.all([
        sb.from('status').select('*').eq('id', CFG.statusId).maybeSingle(),
        sb.from('event_log').select('*').order('created_at', { ascending: false }).limit(300),
        sb.from('commands').select('*').order('created_at', { ascending: false }).limit(50)
      ]);
      var statusRes = res[0], eventRes = res[1], cmdRes = res[2];

      if (statusRes.error) throw statusRes.error;
      S.status = statusRes.data;
      S.events = eventRes.error ? [] : (eventRes.data || []);
      S.commands = cmdRes.error ? [] : (cmdRes.data || []);

      if (!S.status) setNotice('ยังไม่มีแถว status (id = ' + CFG.statusId + ') ในฐานข้อมูล — เครื่องยังไม่เคยส่งข้อมูลเข้ามา', 'warn');
      else if (eventRes.error) setNotice('อ่าน event_log ไม่ได้: ' + eventRes.error.message, 'error');
      else setNotice(null);

      setLive('on', 'LIVE');
    } catch (err) {
      setNotice('โหลดข้อมูลไม่สำเร็จ: ' + (err.message || err), 'error');
      setLive('err', 'ERROR');
    }
    render();
  }

  function subscribe() {
    sb.channel('okng-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'status' }, function (p) {
        if (p.new && p.new.id === CFG.statusId) { S.status = p.new; render(); }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'event_log' }, function (p) {
        if (!p.new) return;
        S.events = [p.new].concat(S.events).slice(0, 300);
        render();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'commands' }, function () {
        sb.from('commands').select('*').order('created_at', { ascending: false }).limit(50)
          .then(function (r) { if (!r.error) { S.commands = r.data || []; render(); } });
      })
      .subscribe(function (st) {
        if (st === 'SUBSCRIBED') setLive('on', 'LIVE');
        else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') setLive('err', 'RECONNECT');
      });
  }

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

  function renderHeader() {
    el.crumb.textContent = S.view;
    var off = offline();
    var seen = S.status && (S.status.device_seen_at || S.status.updated_at);

    el.sub.textContent = 'ภาพรวมผลการเทส — ข้อมูลล่าสุด ' + ago(seen);
    el.deviceSub.textContent = off ? 'ไม่มีสัญญาณ · ' + ago(seen) : 'ออนไลน์ · ' + ago(seen);
    el.deviceStamp.textContent = seen ? 'device_seen_at ' + thDate(seen) : 'ยังไม่มีข้อมูล';

    el.health.classList.toggle('is-off', off);
    el.healthText.textContent = off ? 'ไม่มีข้อมูลใหม่ ' + ago(seen) : 'heartbeat ปกติ';

    var lk = locked();
    el.lock.hidden = !lk;
    if (lk) {
      var why = [];
      if (S.status.lock_old) why.push('lock_old');
      if (S.status.lock_auto) why.push('lock_auto');
      el.lockDetail.textContent = 'NG สะสม ' + fmt(S.status.ng_total) + ' ชิ้น · ' + why.join(' + ');
    }

    el.banner.hidden = !S.notice;
    if (S.notice) {
      el.banner.textContent = S.notice;
      el.banner.classList.toggle('is-error', S.noticeKind === 'error');
    }
  }

  /* --------------------------------------------------------------- views */

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

  function kpis() {
    var s = S.status || {};
    var off = offline();
    return [
      { label: 'OK สะสม', value: fmt(s.ok_total), unit: 'ชิ้น', icon: '✓',
        edge: '#2f9e52', tint: 'var(--ok-tint)', tagInk: 'var(--ok-ink)', tag: 'ผ่านการตรวจสีครบ' },
      { label: 'NG สะสม', value: fmt(s.ng_total), unit: 'ชิ้น', icon: '✕',
        edge: '#e0342f', tint: 'var(--ng-tint)', tagInk: 'var(--ng-ink)',
        tag: locked() ? 'LOCK อยู่' : 'ไม่มีของค้าง' },
      { label: 'Yield', value: yieldPct().toFixed(1) + '%', unit: '', icon: '%',
        edge: '#4f7fe8', tint: 'var(--info-tint)', tagInk: 'var(--info-ink)', tag: 'OK / ทั้งหมด' },
      { label: 'อัตราผลิต', value: off ? '0.0' : Number(s.rate || 0).toFixed(1), unit: 'ชิ้น/นาที', icon: '⚡',
        edge: '#7c56e0', tint: 'var(--violet-tint)', tagInk: '#7c56e0',
        tag: 'ETA ' + etaMin().toFixed(1) + ' นาที' },
      { label: 'อัปเดตล่าสุด', value: off ? 'OFFLINE' : 'ONLINE', unit: '', icon: '◔',
        edge: off ? '#e0a020' : '#2f9e52', tint: off ? 'var(--amber-tint)' : 'var(--ok-tint)',
        tagInk: off ? 'var(--amber-ink)' : 'var(--ok-ink)', tag: ago(s.device_seen_at || s.updated_at) }
    ];
  }

  // 12 hourly buckets counted from event_log
  function hourly() {
    var now = new Date();
    now.setMinutes(0, 0, 0);
    var buckets = [];
    for (var i = 11; i >= 0; i--) {
      buckets.push({ h: new Date(now.getTime() - i * 3600000), ok: 0, ng: 0, other: 0 });
    }
    var first = buckets[0].h.getTime();
    S.events.forEach(function (e) {
      var t = new Date(e.created_at).getTime();
      if (t < first) return;
      var idx = Math.floor((t - first) / 3600000);
      if (idx < 0 || idx >= buckets.length) return;
      buckets[idx][categoryOf(e.event)]++;
    });
    return buckets;
  }

  function ioRows() {
    var s = S.status || {};
    var off = offline();
    var pin = function (name, label, on, onInk, onTint, onText, offText) {
      return { pin: name, name: label,
        dot: off ? '#c3c8d8' : (on ? onInk : '#c3c8d8'),
        state: off ? 'ไม่มีสัญญาณ' : (on ? onText : offText),
        tint: off ? 'var(--soft)' : (on ? onTint : 'var(--soft)'),
        ink: off ? 'var(--muted)' : (on ? onInk : 'var(--muted)') };
    };
    return [
      pin('D9', 'เซ็นเซอร์ตรวจพบสี', s.d9, '#2f9e52', 'var(--ok-tint)', 'ตรวจพบ', 'ว่าง'),
      pin('D11', 'OK output', s.d11, '#4f7fe8', 'var(--info-tint)', 'ทำงาน', 'ว่าง'),
      pin('D12', 'NG / LOCK', s.d12, '#e0342f', 'var(--ng-tint)', 'LOCK', 'ปกติ'),
      pin('D5 / D6', 'Full counter', s.full_counter, '#e0a020', 'var(--amber-tint)', 'ครบล็อต', 'ยังไม่ครบ')
    ];
  }

  function eventTag(ev) {
    var c = categoryOf(ev);
    var tint = c === 'ok' ? 'var(--ok-tint)' : c === 'ng' ? 'var(--ng-tint)' : 'var(--soft)';
    var ink = c === 'ok' ? 'var(--ok-ink)' : c === 'ng' ? 'var(--ng-ink)' : 'var(--muted)';
    return '<span class="chip" style="background:' + tint + ';color:' + ink + '">' + esc(ev) + '</span>';
  }

  function filteredEvents() {
    var q = S.q.trim().toLowerCase();
    if (!q) return S.events;
    return S.events.filter(function (e) {
      return (String(e.event) + ' ' + thDate(e.created_at)).toLowerCase().indexOf(q) !== -1;
    });
  }

  function eventTable(rows, emptyText) {
    if (!rows.length) return '<p class="empty">' + esc(emptyText) + '</p>';
    return '<div class="tbl-wrap"><table><thead><tr>' +
      '<th>เวลา</th><th>event</th><th class="t-right">id</th>' +
      '</tr></thead><tbody>' + rows.map(function (e) {
        return '<tr><td class="num">' + esc(thDate(e.created_at)) + '</td>' +
          '<td>' + eventTag(e.event) + '</td>' +
          '<td class="t-right">' + fmt(e.id) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function viewDashboard() {
    var buckets = hourly();
    var maxBar = Math.max.apply(null, buckets.map(function (b) { return b.ok + b.ng + b.other; }).concat([1]));
    var bars = buckets.map(function (b) {
      var tot = b.ok + b.ng;
      return '<div class="bar-col"><div class="bar-pair">' +
        '<i class="bar-ok" data-v="' + (tot || '') + '" style="height:' + Math.max(b.ok ? 8 : 2, b.ok / maxBar * 168).toFixed(0) + 'px"></i>' +
        '<i class="bar-ng" style="height:' + Math.max(b.ng ? 6 : 2, b.ng / maxBar * 168).toFixed(0) + 'px"></i>' +
        '</div><span class="bar-h">' + pad2(b.h.getHours()) + '</span></div>';
    }).join('');

    var pts = buckets.map(function (b, i) {
      var t = b.ok + b.ng;
      var y = t ? b.ok / t * 100 : 100;
      return (i / 11 * 470 + 5).toFixed(1) + ',' + (140 - y / 100 * 120).toFixed(1);
    }).join(' ');

    var io = ioRows().map(function (r) {
      return '<div class="io-row" style="background:' + r.tint + '">' +
        '<span class="io-dot" style="background:' + r.dot + '"></span>' +
        '<span class="io-pin" style="color:' + r.ink + '">' + esc(r.pin) + '</span>' +
        '<span class="io-name">' + esc(r.name) + '</span>' +
        '<span class="io-state" style="color:' + r.ink + '">' + esc(r.state) + '</span></div>';
    }).join('');

    var s = S.status || {};
    var rows = filteredEvents().slice(0, 60);

    return '<section class="grid-kpi">' + kpis().map(kpiHtml).join('') + '</section>' +

      '<section class="grid-2">' +
        '<article class="card">' +
          '<div class="card-head"><div><h2>OK / NG รายชั่วโมง</h2>' +
            '<p>12 ชั่วโมงที่ผ่านมา · ' + hhmm(buckets[0].h) + ' → ' + hhmm(buckets[11].h) + '</p></div>' +
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
                'style="stroke-dasharray:' + (lotPct() / 100 * 267).toFixed(1) + ' 267"/>' +
            '</svg>' +
            '<strong class="gauge-val num">' + Math.round(lotPct()) + '%</strong>' +
            '<span class="gauge-sub num">' + fmt(s.counting) + ' / ' + fmt(s.setting) + ' pcs</span>' +
          '</div>' +
          '<div class="rows">' +
            '<div><span>อัตราผลิต</span><b>' + Number(s.rate || 0).toFixed(1) + ' ชิ้น/นาที</b></div>' +
            '<div><span>คาดว่าจะครบใน</span><b>' + etaMin().toFixed(1) + ' นาที</b></div>' +
            '<div><span>event ล่าสุดจากเครื่อง</span><b>' + esc(s.event || '—') + '</b></div>' +
          '</div>' +
        '</article>' +
      '</section>' +

      '<section class="grid-2b">' +
        '<article class="card">' +
          '<div class="card-head"><div><h2>สถานะ I/O</h2><p>อ่านสดจากตาราง status</p></div></div>' +
          '<p class="big-stat">NG สะสมรอเคลียร์<b class="num">' + fmt(s.ng_total) + '<small> ชิ้น</small></b></p>' +
          '<p class="big-hint">' + (locked() ? 'ต้องนำ NG เข้ากล่องเพื่อปลดล็อก' : 'ไม่มี LOCK ค้างอยู่') + '</p>' +
          '<div class="io">' + io + '</div>' +
        '</article>' +
        '<article class="card">' +
          '<div class="card-head"><div><h2>Yield Trend</h2><p>เปอร์เซ็นต์ OK รายชั่วโมง</p></div></div>' +
          '<svg class="trend" viewBox="0 0 480 150" preserveAspectRatio="none" role="img" aria-label="แนวโน้ม Yield">' +
            '<polygon class="trend-area" points="5,140 ' + pts + ' 475,140"/>' +
            '<polyline class="trend-line" points="' + pts + '"/>' +
          '</svg>' +
          '<div class="trend-axis"><span>' + hhmm(buckets[0].h) + '</span><span>100 · 50 · 0 %</span>' +
            '<span>' + hhmm(buckets[11].h) + '</span></div>' +
        '</article>' +
      '</section>' +

      '<article class="card">' +
        '<div class="card-head"><div><h2>Event ล่าสุด</h2></div>' +
          '<span class="card-note">' + fmt(filteredEvents().length) + ' รายการ</span></div>' +
        eventTable(rows, S.q ? 'ไม่พบ event ที่ตรงกับคำค้น' : 'ยังไม่มี event จากเครื่อง') +
      '</article>';
  }

  function viewLog() {
    var cmds = Object.keys(CFG.commands).map(function (key) {
      var c = CFG.commands[key];
      return '<div class="cmd-row">' +
        '<span class="cmd-name">' + esc(c.label) + '<code>' + esc(c.cmd) + '</code></span>' +
        (c.confirmed ? '' : '<span class="cmd-warn">ยังไม่ยืนยันกับ firmware</span>') +
        '<button class="b ' + (key === 'factoryReset' ? 'b-danger' : 'b-primary') + ' b-sm" type="button" ' +
          'data-cmd="' + esc(key) + '">ส่งคำสั่ง</button>' +
        '</div>';
    }).join('');

    return '<article class="card">' +
        '<div class="card-head"><div><h2>ส่งคำสั่งไปที่เครื่อง</h2>' +
          '<p>เขียนลงตาราง commands · เครื่องจะอ่านแล้วตั้ง processed = true</p></div></div>' +
        '<div class="cmds">' + cmds + '</div>' +
      '</article>' +
      '<article class="card">' +
        '<div class="card-head"><div><h2>10 รายการที่บันทึกล่าสุด</h2></div>' +
          '<span class="card-note">OK ' + fmt(S.status && S.status.ok_total) +
          ' · NG ' + fmt(S.status && S.status.ng_total) + '</span></div>' +
        (S.events.length ? '<div class="log-list">' + S.events.slice(0, 10).map(function (e) {
          var c = categoryOf(e.event);
          return '<div class="log-row">' +
            '<span class="log-dot" style="background:' +
              (c === 'ok' ? '#2f9e52' : c === 'ng' ? '#e0342f' : '#c3c8d8') + '"></span>' +
            '<span class="log-type">' + esc(e.event) + '</span>' +
            '<span class="log-time">' + esc(thDate(e.created_at)) + '</span></div>';
        }).join('') + '</div>' : '<p class="empty">ยังไม่มี event จากเครื่อง</p>') +
      '</article>';
  }

  function viewHistory() {
    var rows = filteredEvents();
    return '<article class="card">' +
      '<div class="card-head"><div><h2>ประวัติ event ทั้งหมด</h2>' +
        '<p>' + fmt(rows.length) + ' รายการ · กรองด้วยช่องค้นหาด้านบน</p></div></div>' +
      eventTable(rows, S.q ? 'ไม่พบ event ที่ตรงกับคำค้น' : 'ยังไม่มี event จากเครื่อง') +
      '</article>';
  }

  function viewLots() {
    var s = S.status || {};
    var p = lotPct();
    var edge = locked() ? '#e0342f' : p >= 100 ? '#e0a020' : offline() ? '#8a90ab' : '#2f9e52';
    var tint = locked() ? 'var(--ng-tint)' : p >= 100 ? 'var(--amber-tint)' : offline() ? 'var(--soft)' : 'var(--ok-tint)';
    var status = locked() ? 'LOCK' : offline() ? 'NO SIGNAL' : p >= 100 ? 'ครบล็อต' : 'กำลังผลิต';

    return '<article class="card">' +
        '<div class="card-head"><div><h2>ล็อตที่กำลังเดิน</h2><p>ST-001 · เครื่องเทียบสี</p></div>' +
          '<span class="chip" style="background:' + tint + ';color:' + edge + '">' + esc(status) + '</span></div>' +
        '<div class="lot-head"><span class="lot-pct" style="color:' + edge + '">' + Math.round(p) + '%</span>' +
          '<span class="lot-meta num">' + fmt(s.counting) + ' / ' + fmt(s.setting) + ' pcs</span></div>' +
        '<div class="lot-bar"><i style="width:' + p.toFixed(1) + '%;background:' + edge + '"></i></div>' +
        '<div class="rows">' +
          '<div><span>OK สะสม</span><b>' + fmt(s.ok_total) + '</b></div>' +
          '<div><span>NG สะสม</span><b>' + fmt(s.ng_total) + '</b></div>' +
          '<div><span>คาดว่าจะครบใน</span><b>' + etaMin().toFixed(1) + ' นาที</b></div>' +
        '</div>' +
      '</article>' +
      '<article class="card">' +
        '<div class="card-head"><div><h2>คำสั่งที่ส่งไปแล้ว</h2><p>ตาราง commands · 50 รายการล่าสุด</p></div></div>' +
        (S.commands.length ? '<div class="tbl-wrap"><table><thead><tr>' +
          '<th>เวลา</th><th>คำสั่ง</th><th class="t-right">value</th><th>สถานะ</th>' +
          '</tr></thead><tbody>' + S.commands.map(function (c) {
            return '<tr><td class="num">' + esc(thDate(c.created_at)) + '</td>' +
              '<td class="t-id">' + esc(c.cmd) + '</td>' +
              '<td class="t-right">' + (c.value == null ? '—' : fmt(c.value)) + '</td>' +
              '<td><span class="chip" style="background:' +
                (c.processed ? 'var(--ok-tint)' : 'var(--amber-tint)') + ';color:' +
                (c.processed ? 'var(--ok-ink)' : 'var(--amber-ink)') + '">' +
                (c.processed ? 'เครื่องรับแล้ว' : 'รอเครื่องอ่าน') + '</span></td></tr>';
          }).join('') + '</tbody></table></div>' : '<p class="empty">ยังไม่เคยส่งคำสั่ง</p>') +
      '</article>';
  }

  function viewReport() {
    var s = S.status || {};
    var counts = { ok: 0, ng: 0, other: 0 };
    var byEvent = {};
    S.events.forEach(function (e) {
      counts[categoryOf(e.event)]++;
      byEvent[e.event] = (byEvent[e.event] || 0) + 1;
    });
    var rows = Object.keys(byEvent).map(function (k) { return { event: k, n: byEvent[k] }; })
      .sort(function (a, b) { return b.n - a.n; });

    var totals = [
      { label: 'OK สะสม', value: fmt(s.ok_total), ink: 'var(--ok-ink)' },
      { label: 'NG สะสม', value: fmt(s.ng_total), ink: 'var(--ng-ink)' },
      { label: 'Yield รวม', value: yieldPct().toFixed(1) + '%', ink: 'var(--accent)' },
      { label: 'Event ที่เก็บไว้', value: fmt(S.events.length), ink: 'var(--ink)' }
    ];

    return '<section class="grid-tot">' + totals.map(function (t) {
        return '<article class="card"><span class="tot-label">' + esc(t.label) + '</span>' +
          '<div class="tot-val num" style="color:' + t.ink + '">' + esc(t.value) + '</div></article>';
      }).join('') + '</section>' +
      '<article class="card">' +
        '<div class="card-head"><div><h2>สรุปตามชนิด event</h2>' +
          '<p>OK ' + counts.ok + ' · NG ' + counts.ng + ' · อื่นๆ ' + counts.other + '</p></div>' +
          '<button class="b b-primary b-sm" type="button" data-act="exportReport">↓ Export รายงาน CSV</button></div>' +
        (rows.length ? '<div class="tbl-wrap"><table><thead><tr>' +
          '<th>event</th><th>กลุ่ม</th><th class="t-right">จำนวน</th><th class="t-right">สัดส่วน</th>' +
          '</tr></thead><tbody>' + rows.map(function (r) {
            var c = categoryOf(r.event);
            return '<tr><td class="t-id">' + esc(r.event) + '</td>' +
              '<td>' + (c === 'ok' ? '<span class="t-ok">OK</span>' : c === 'ng' ? '<span class="t-ng">NG</span>' : 'อื่นๆ') + '</td>' +
              '<td class="t-right">' + fmt(r.n) + '</td>' +
              '<td class="t-right">' + (r.n / S.events.length * 100).toFixed(1) + '%</td></tr>';
          }).join('') + '</tbody></table></div>' : '<p class="empty">ยังไม่มี event</p>') +
      '</article>';
  }

  /* -------------------------------------------------------------- render */

  function render() {
    renderNav();
    renderHeader();
    if (S.view === 'บันทึกผล') el.view.innerHTML = viewLog();
    else if (S.view === 'ประวัติ') el.view.innerHTML = viewHistory();
    else if (S.view === 'ล็อตงาน') el.view.innerHTML = viewLots();
    else if (S.view === 'รายงาน') el.view.innerHTML = viewReport();
    else el.view.innerHTML = viewDashboard();
  }

  /* -------------------------------------------------------------- export */

  var hostDownloads = null;

  function saveCsv(name, rows) {
    var text = '﻿' + rows.map(function (r) { return r.join(','); }).join('\n');
    if (hostDownloads) {
      hostDownloads.save({ filename: name, data: text }).catch(function (err) {
        var code = err && err.code;
        if (code !== 'declined' && code !== 'rate_limited') {
          window.alert('บันทึกไฟล์ไม่สำเร็จ (' + (code || 'error') + ')');
        }
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
    saveCsv('okng-events.csv', [['id', 'event', 'created_at']].concat(
      S.events.map(function (e) { return [e.id, e.event, new Date(e.created_at).toISOString()]; })));
  }

  function exportReport() {
    var s = S.status || {};
    saveCsv('okng-report.csv', [
      ['field', 'value'],
      ['ok_total', s.ok_total], ['ng_total', s.ng_total],
      ['yield_pct', yieldPct().toFixed(2)],
      ['counting', s.counting], ['setting', s.setting],
      ['rate', s.rate], ['lock_old', s.lock_old], ['lock_auto', s.lock_auto],
      ['d9', s.d9], ['d11', s.d11], ['d12', s.d12], ['full_counter', s.full_counter],
      ['device_seen_at', s.device_seen_at], ['exported_at', new Date().toISOString()]
    ]);
  }

  /* ------------------------------------------------------------- commands */

  async function sendCommand(key) {
    var c = CFG.commands[key];
    if (!c) return;
    var warn = c.confirmed ? '' :
      '\n\n⚠ คำสั่งนี้ยังไม่ได้ยืนยันกับ firmware — ถ้าชื่อไม่ตรง เครื่องจะไม่ทำอะไร';
    if (!window.confirm('ส่งคำสั่ง "' + c.cmd + '" ไปที่เครื่อง?' + warn)) return;

    var r = await sb.from('commands').insert({ cmd: c.cmd });
    if (r.error) {
      setNotice('ส่งคำสั่งไม่สำเร็จ: ' + r.error.message, 'error');
    } else {
      setNotice('ส่งคำสั่ง ' + c.cmd + ' แล้ว — รอเครื่องอ่าน', 'warn');
    }
    render();
  }

  /* --------------------------------------------------------------- look */

  function applyLook() {
    var r = document.documentElement;
    r.setAttribute('data-theme', S.theme);
    r.setAttribute('data-font', S.font);
    r.setAttribute('data-tv', S.tv ? 'on' : 'off');
    el.btnTv.textContent = S.tv ? 'ออกจากโหมด TV' : 'โหมด TV';
    try {
      localStorage.setItem('okng-look', JSON.stringify({ theme: S.theme, font: S.font, tv: S.tv }));
    } catch (e) { /* ignore */ }
  }

  /* --------------------------------------------------------------- auth */

  function showGate(show) {
    $('gate').hidden = !show;
    $('app').hidden = show;
  }

  async function onLogin(e) {
    e.preventDefault();
    var err = $('loginError');
    err.hidden = true;
    $('btnLogin').disabled = true;
    $('btnLogin').textContent = 'กำลังเข้าสู่ระบบ…';
    try {
      var r = await sb.auth.signInWithPassword({
        email: $('email').value.trim(), password: $('password').value
      });
      if (r.error) throw r.error;
      await startApp();
    } catch (ex) {
      err.textContent = ex.message === 'Invalid login credentials'
        ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' : (ex.message || String(ex));
      err.hidden = false;
    } finally {
      $('btnLogin').disabled = false;
      $('btnLogin').textContent = 'เข้าสู่ระบบ';
    }
  }

  async function startApp() {
    showGate(false);
    await loadAll();
    subscribe();
  }

  /* -------------------------------------------------------------- wiring */

  function bind() {
    $('loginForm').addEventListener('submit', onLogin);

    el.nav.addEventListener('click', function (e) {
      var b = e.target.closest('[data-view]');
      if (b) { S.view = b.dataset.view; render(); }
    });

    el.btnRefresh.addEventListener('click', loadAll);
    el.btnExport.addEventListener('click', exportEvents);
    el.search.addEventListener('input', function () { S.q = this.value; render(); });

    el.btnClearLock.addEventListener('click', function () { sendCommand('resetNg'); });

    el.view.addEventListener('click', function (e) {
      var cmd = e.target.closest('[data-cmd]');
      if (cmd) { sendCommand(cmd.dataset.cmd); return; }
      var act = e.target.closest('[data-act]');
      if (act && act.dataset.act === 'exportReport') exportReport();
    });

    el.theme.addEventListener('change', function () { S.theme = this.value; applyLook(); });
    el.font.addEventListener('change', function () { S.font = this.value; applyLook(); });
    el.btnTv.addEventListener('click', function () { S.tv = !S.tv; applyLook(); });

    $('btnLogout').addEventListener('click', async function () {
      await sb.auth.signOut();
      location.reload();
    });
  }

  function initDownloads() {
    if (!window.claude || typeof window.claude.use !== 'function') return;
    window.claude.use('downloads').then(function (dl) {
      hostDownloads = dl;
      if (!dl) el.btnExport.hidden = true;
    }, function () { el.btnExport.hidden = true; });
  }

  /* ---------------------------------------------------------------- boot */

  async function boot() {
    el = {
      nav: $('nav'), view: $('view'), crumb: $('crumbView'),
      sub: $('stationSub'), deviceSub: $('deviceSub'), deviceStamp: $('deviceStamp'),
      lock: $('lockBanner'), lockDetail: $('lockDetail'), btnClearLock: $('btnClearLock'),
      banner: $('banner'), health: $('health'), healthText: $('healthText'),
      liveBadge: $('liveBadge'), liveText: $('liveText'),
      search: $('search'), btnRefresh: $('btnRefresh'), btnExport: $('btnExport'),
      btnTv: $('btnTv'), theme: $('themeSelect'), font: $('fontSelect')
    };

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

    bind();
    initDownloads();

    if (!window.supabase || !CFG.supabaseUrl || !CFG.supabaseKey) {
      showGate(true);
      var err = $('loginError');
      err.textContent = 'ยังไม่ได้ตั้งค่า Supabase — ใส่ supabaseUrl และ supabaseKey ใน assets/config.js';
      err.hidden = false;
      return;
    }

    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
    var session = await sb.auth.getSession();
    if (session.data && session.data.session) await startApp();
    else showGate(true);

    setInterval(function () { if (!$('app').hidden) renderHeader(); }, 30000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
