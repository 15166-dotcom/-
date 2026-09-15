# OKNG Monitor v3

**ระบบเก็บข้อมูลการเทส — เครื่องเทียบสี (Color Inspection System)**

เว็บแอปติดตามผลตรวจ OK/NG รายสถานีแบบเรียลไทม์ สร้างตามดีไซน์ต้นฉบับ `OKNG Monitor v3.dc.html`

## หน้าจอ

| เมนู | เนื้อหา |
|---|---|
| **แดชบอร์ด** | KPI 5 ตัว (OK/NG สะสม, Yield, อัตราผลิต, Downtime), กราฟ OK/NG รายชั่วโมง, เกจความก้าวหน้าล็อต, สถานะ I/O, Yield Trend, ตาราง NG events |
| **บันทึกผล** | ปุ่มบันทึก OK/NG และ 10 รายการล่าสุด |
| **ประวัติ** | event ทุกสถานีรวมกัน สูงสุด 300 รายการ กรองด้วยช่องค้นหา |
| **ล็อตงาน** | การ์ดทุกสถานี พร้อม % ความคืบหน้า, สถานะ, ETA — คลิกเพื่อกระโดดไปแดชบอร์ดของสถานีนั้น |
| **รายงาน** | ยอดรวมทุกสถานี + ตารางสรุปรายสถานี + Export รายงาน CSV |

## กลไก LOCK

เมื่อ `NG > NG ในกล่อง` สถานีจะเข้าสถานะ **LOCK** — แถบแดงขึ้นด้านบน, ตัวนับ OK หยุดเดิน, และ `lockSec` เดินขึ้นทุกวินาที
กด **เคลียร์ NG/LOCK** เพื่อบันทึกว่า NG เข้ากล่องครบแล้ว ระบบจะปลดล็อกและนับต่อ

## การปรับแต่ง

- **โทนสี** — Cool blue / Organic cream / Night (จอ TV)
- **ตัวหนังสือ** — Sarabun / Prompt / IBM Plex Sans Thai
- **โหมด TV** — ขยายตัวอักษรทั้งหน้าสำหรับจอในไลน์ผลิต

ทั้งสามค่าถูกจำไว้ใน localStorage

## โครงสร้าง

```
index.html                   โครงหน้า + แถบข้าง
assets/styles.css            ธีมทั้งสามโทน + เลย์เอาต์ (CSS variables, ไม่มี framework)
assets/app.js                logic ทั้งหมด (vanilla JS, ไม่มี dependency)
build.js                     สร้างไฟล์รวมใน dist/
dist/okng-monitor-v3.html    ไฟล์เดียวจบ — วางบน static host ไหนก็ได้
dist/artifact.html           เวอร์ชัน fragment สำหรับ Claude Artifact
netlify.toml                 การตั้งค่า deploy
```

## Build / รันในเครื่อง

```bash
node build.js                 # สร้าง dist/
python3 -m http.server 8080   # เปิด http://localhost:8080
```

## ต่อกับ Supabase

แดชบอร์ดอ่านข้อมูลสดจาก 3 ตาราง และต้องล็อกอินก่อน เพราะ RLS เปิดสิทธิ์อ่านให้เฉพาะ `authenticated`

| ตาราง | แดชบอร์ดใช้ทำอะไร |
|---|---|
| `status` (แถวเดียว id=1) | KPI, เกจล็อต, สถานะ I/O (d9/d11/d12/full_counter), heartbeat |
| `event_log` | กราฟ OK/NG รายชั่วโมง, ตาราง event, หน้าประวัติ |
| `commands` | ปุ่มเคลียร์ NG/LOCK และคำสั่งอื่น (insert), หน้าล็อตงานแสดงคิวคำสั่ง |

### ที่อยู่ของเว็บ

| ที่ | URL |
|---|---|
| Netlify (หลัก) | https://magical-entremet-691865.netlify.app/ |
| Supabase Edge Function | https://yfygpxvprvhlprsivkkq.supabase.co/functions/v1/okng |

Netlify เป็น static host จริง เร็วกว่าและไม่กิน quota — Edge Function เป็นทางเลือกสำรอง
อัปเดตหน้าเว็บบน Edge Function:

```bash
node build.js
node scripts-build-edge.js
supabase functions deploy okng --no-verify-jwt --project-ref yfygpxvprvhlprsivkkq
```

### โปรเจกต์ที่ต่ออยู่

org **เครื่องเทียบสี** → `15166-dotcom's Project` (`yfygpxvprvhlprsivkkq`, ap-northeast-2)
schema + RLS + realtime ติดตั้งแล้ว ค่าเชื่อมต่ออยู่ใน `assets/config.js`

### ติดตั้งบนโปรเจกต์อื่น

1. รัน `supabase/schema.sql` ใน SQL Editor ของโปรเจกต์
2. สร้าง user ที่ Authentication → Users → Add user (เปิด Auto Confirm)
3. ใส่ `supabaseUrl` + `supabaseKey` (publishable) ใน `assets/config.js`
4. `node build.js` แล้ว deploy

อยากเห็นหน้าจอมีข้อมูลก่อนต่อเครื่องจริง รัน `supabase/seed-demo.sql` เพิ่ม

### role

- `anon` = ตัวเครื่อง ESP32 — เขียน `status`, insert `event_log`, อ่าน/อัปเดต `commands`
- `authenticated` = ทีม — อ่านทุกตาราง, insert `commands`

เครื่องอ่าน `event_log` ไม่ได้และสั่งงานตัวเองไม่ได้ ส่วน anon key ที่ฝังในหน้าเว็บดึง `event_log` ไม่ออกถ้าไม่ล็อกอิน

### คำสั่งที่ส่งไปเครื่อง

อยู่ใน `assets/config.js` → `commands` ยืนยันแล้วจากข้อมูลจริงมีแค่ `FACTORY_RESET`
ส่วน `RESET_NG` / `RESET_COUNT` เดาจากชื่อ event ที่เครื่อง log (`reset_ng`, `count_reset`) **ยังไม่ได้เทียบกับ firmware** — ทุกครั้งที่กดส่ง จะมี confirm แสดงชื่อคำสั่งจริงก่อนเสมอ

## ต่อข้อมูลจริง (เดิม)

ตอนนี้ข้อมูลถูกสร้างจำลองในเบราว์เซอร์ (ตาม logic ของดีไซน์ต้นฉบับ) ยังไม่ได้ต่อ Supabase จริง
จุดที่ต้องแก้ใน `assets/app.js`:

| ฟังก์ชัน | แทนที่ด้วย |
|---|---|
| `buildStations()` | ดึงรายการสถานีจากตาราง `stations` |
| `seedEvents()` | ดึง event ย้อนหลังจากตาราง `events` |
| `hoursOf()` | query สรุป OK/NG รายชั่วโมง |
| `tick()` | Supabase Realtime subscription แทน `setInterval` |

รูปแบบเรคอร์ด event: `{ ts, type: 'NG' | 'NG_BOXED', ok, ng, box }`

## ค่าคงที่

ปรับได้ที่หัวไฟล์ `assets/app.js` — `STATION_COUNT`, `NAMES` (ชื่อสถานี), `NAV` (เมนู)
ค่า `setting` (เป้าหมายต่อล็อต) ตั้งไว้ที่ 1,000 ชิ้นต่อสถานี
