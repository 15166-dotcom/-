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
     Matches firmware/ESP32_Count_OK-NG_V1b_BenchTest.ino exactly (see its
     eventName() function) — confirmed against the actual firmware, not
     guessed. Anything not listed here still shows in the tables, just
     outside the OK/NG chart (reset_ok, reset_ng, ng_boxed, factory_reset,
     pm_limit_reached). */
  okEvents: ['ok'],
  ngEvents: ['ng'],

  /* commands.cmd strings sent to the device.
     All three confirmed against firmware/ESP32_Count_OK-NG_V1b_BenchTest.ino,
     which handles them explicitly in handleRemoteCommand(). Every send still
     asks for confirmation and shows the exact string first. */
  commands: {
    resetNg:      { cmd: 'RESET_NG',      label: 'เคลียร์ NG / ปลด LOCK', confirmed: true },
    resetCount:   { cmd: 'RESET_COUNT',   label: 'รีเซ็ตตัวนับล็อต',      confirmed: true },
    factoryReset: { cmd: 'FACTORY_RESET', label: 'Factory reset',        confirmed: true }
  }
};
