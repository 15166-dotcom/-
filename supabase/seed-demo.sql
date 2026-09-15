-- ============================================================================
-- ข้อมูลตัวอย่างสำหรับทดลองแดชบอร์ดก่อนต่อเครื่องจริง
-- รันเฉพาะตอนอยากเห็นหน้าจอมีข้อมูล — ไม่ต้องรันบนโปรเจกต์ production
-- ลบออกได้ด้วยบรรทัดล่างสุดของไฟล์นี้
-- ============================================================================

update public.status set
  setting        = 1000,
  counting       = 747,
  ok_total       = 747,
  ng_total       = 19,
  rate           = 2.2,
  d9             = false,
  d11            = false,
  d12            = true,
  full_counter   = false,
  lock_old       = false,
  lock_auto      = true,
  event          = 'auto_fail_miss1',
  updated_at     = now(),
  device_seen_at = now()
where id = 1;

-- event ย้อนหลัง 12 ชั่วโมง ~120 รายการ
insert into public.event_log (event, created_at)
select
  case
    when random() < 0.86 then 'ok'
    when random() < 0.55 then 'auto_fail_miss1'
    when random() < 0.40 then 'count_reset'
    when random() < 0.50 then 'full_counter'
    else 'reset_ng'
  end,
  now() - (random() * interval '12 hours')
from generate_series(1, 120);

-- ล้างข้อมูลตัวอย่าง:
--   delete from public.event_log;
--   delete from public.commands;
--   update public.status set setting=0, counting=0, ok_total=0, ng_total=0,
--     rate=0, d9=false, d11=false, d12=false, full_counter=false,
--     lock_old=false, lock_auto=false, event='none', device_seen_at=null where id=1;
