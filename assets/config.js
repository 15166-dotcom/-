/* ==========================================================================
   OKNG Monitor v3 — connection and device vocabulary
   ========================================================================== */
window.OKNG_CONFIG = {
  /* Supabase project: 15166-dotcom's Project, org "เครื่องเทียบสี" (ap-northeast-2).
     The publishable key is meant to be public — row access is enforced by RLS,
     which only grants reads to signed-in (authenticated) users. */
  supabaseUrl: 'https://yfygpxvprvhlprsivkkq.supabase.co',
  supabaseKey: 'sb_publishable_SmnBtZ_tK2f4fL3dIgUQow_cjWmWkwF',

  /* The status table is a single row pinned to id = 1 (one machine). */
  statusId: 1,

  /* How long without a device heartbeat before the machine reads as offline. */
  offlineAfterMs: 3 * 60 * 1000,

  /* event_log.event values, grouped for the hourly chart.
     Taken from the events the device has actually written. Anything not
     listed here still shows in the tables, just outside the OK/NG chart. */
  okEvents: ['ok'],
  ngEvents: ['auto_fail_miss1', 'ng', 'n', 'ne'],

  /* commands.cmd strings sent to the device.
     CONFIRMED from the commands table: FACTORY_RESET.
     The rest are inferred from the event names the device logs
     (reset_ng, count_reset) and are NOT yet confirmed against the firmware —
     check them before relying on them. Every send asks for confirmation and
     shows the exact string first, so nothing goes out silently. */
  commands: {
    resetNg:      { cmd: 'RESET_NG',      label: 'เคลียร์ NG / ปลด LOCK', confirmed: false },
    resetCount:   { cmd: 'RESET_COUNT',   label: 'รีเซ็ตตัวนับล็อต',      confirmed: false },
    factoryReset: { cmd: 'FACTORY_RESET', label: 'Factory reset',        confirmed: true }
  }
};
