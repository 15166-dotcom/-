-- ============================================================================
-- OKNG Monitor v3 — เครื่องเทียบสี (Color Inspection System)
-- Schema + RLS + Realtime
--
-- รันไฟล์นี้ใน Supabase SQL Editor ของโปรเจกต์ที่ต้องการ
-- รันซ้ำได้ ไม่ทำข้อมูลเดิมหาย (idempotent)
--
-- แนวคิด role:
--   anon          = ตัวเครื่อง (ESP32) — เขียน status, insert event, อ่าน/อัปเดต commands
--   authenticated = ทีม/แดชบอร์ด      — อ่านทุกตาราง, สั่งงานผ่าน commands
--
-- ตัวเครื่องใช้ anon key ที่ฝังใน firmware จึงไม่ได้ล็อกอิน
-- แดชบอร์ดต้องล็อกอินก่อน ถึงจะอ่าน event_log และสั่งงานได้
-- ============================================================================


-- ---------------------------------------------------------------- 1. ตาราง

-- สถานะเครื่อง ณ ปัจจุบัน — แถวเดียวเสมอ ล็อกด้วย check (id = 1)
create table if not exists public.status (
  id              integer     primary key default 1 check (id = 1),
  setting         integer     not null default 0,      -- เป้าหมายต่อล็อต
  counting        integer     not null default 0,      -- นับได้แล้ว
  d9              boolean     not null default false,  -- เซ็นเซอร์ตรวจพบสี
  d11             boolean     not null default false,  -- OK output
  d12             boolean     not null default false,  -- NG / LOCK
  full_counter    boolean     not null default false,  -- D5/D6 ครบล็อต
  lock_old        boolean     not null default false,
  lock_auto       boolean     not null default false,
  ok_total        bigint      not null default 0,
  ng_total        bigint      not null default 0,
  rate            numeric     not null default 0,      -- ชิ้น/นาที
  event           text        not null default 'none', -- event ล่าสุด
  updated_at      timestamptz not null default now(),
  device_seen_at  timestamptz                          -- heartbeat ล่าสุด
);

-- log ทุก event ที่เครื่องส่งมา
create table if not exists public.event_log (
  id         bigint      generated always as identity primary key,
  event      text        not null,
  created_at timestamptz not null default now()
);

-- คิวคำสั่งจากแดชบอร์ดไปที่เครื่อง
create table if not exists public.commands (
  id         bigint      generated always as identity primary key,
  cmd        text        not null,
  value      integer,
  created_at timestamptz not null default now(),
  processed  boolean     not null default false
);

-- ดึง event ล่าสุดเร็วขึ้น (แดชบอร์ดอ่าน 300 แถวล่าสุดทุกครั้งที่เปิด)
create index if not exists event_log_created_at_idx
  on public.event_log (created_at desc);

-- เครื่องวนอ่านเฉพาะคำสั่งที่ยังไม่ประมวลผล
create index if not exists commands_unprocessed_idx
  on public.commands (created_at desc) where not processed;


-- ------------------------------------------------------------ 2. แถวตั้งต้น

-- สร้างแถว status ให้มีตั้งแต่แรก แดชบอร์ดจะได้ไม่ขึ้นหน้าว่าง
insert into public.status (id) values (1)
on conflict (id) do nothing;


-- -------------------------------------------------------------------- 3. RLS

alter table public.status    enable row level security;
alter table public.event_log enable row level security;
alter table public.commands  enable row level security;

-- ลบ policy ชื่อเดิมก่อน เพื่อให้รันไฟล์นี้ซ้ำได้
drop policy if exists "esp32 can insert status"            on public.status;
drop policy if exists "esp32 can select status for upsert" on public.status;
drop policy if exists "esp32 can update status"            on public.status;
drop policy if exists "team can read status"               on public.status;

drop policy if exists "esp32 can insert event_log" on public.event_log;
drop policy if exists "team can read event_log"    on public.event_log;

drop policy if exists "esp32 can read commands"    on public.commands;
drop policy if exists "esp32 can update commands"  on public.commands;
drop policy if exists "team can insert commands"   on public.commands;
drop policy if exists "team can read commands"     on public.commands;

-- status ------------------------------------------------------------------
-- เครื่อง upsert สถานะตัวเอง จึงต้อง select ได้ด้วย
create policy "esp32 can insert status"
  on public.status for insert to anon with check (true);

create policy "esp32 can select status for upsert"
  on public.status for select to anon using (true);

create policy "esp32 can update status"
  on public.status for update to anon using (true) with check (true);

create policy "team can read status"
  on public.status for select to authenticated using (true);

-- event_log ---------------------------------------------------------------
-- เครื่องเขียนได้อย่างเดียว อ่านไม่ได้ — กันไม่ให้ใครก็ได้ดึง log ด้วย anon key
create policy "esp32 can insert event_log"
  on public.event_log for insert to anon with check (true);

create policy "team can read event_log"
  on public.event_log for select to authenticated using (true);

-- commands ----------------------------------------------------------------
-- เครื่องอ่านคำสั่งและตั้ง processed = true เองได้ แต่สั่งงานตัวเองไม่ได้
create policy "esp32 can read commands"
  on public.commands for select to anon using (true);

create policy "esp32 can update commands"
  on public.commands for update to anon using (true) with check (true);

-- สั่งงานได้เฉพาะคนที่ล็อกอินแล้ว
create policy "team can insert commands"
  on public.commands for insert to authenticated with check (true);

create policy "team can read commands"
  on public.commands for select to authenticated using (true);


-- --------------------------------------------------------------- 4. Realtime

-- ให้แดชบอร์ดรับ update สดโดยไม่ต้อง poll
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'status'
  ) then
    alter publication supabase_realtime add table public.status;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'event_log'
  ) then
    alter publication supabase_realtime add table public.event_log;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'commands'
  ) then
    alter publication supabase_realtime add table public.commands;
  end if;
end $$;


-- ----------------------------------------------------------------- 5. ตรวจผล

select
  (select count(*) from public.status)                                  as status_rows,
  (select count(*) from pg_policies where schemaname = 'public')         as policies,
  (select count(*) from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public')      as realtime_tables;
-- ควรได้: status_rows = 1, policies = 10, realtime_tables = 3
