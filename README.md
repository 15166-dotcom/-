# OKNG Monitor v3

แดชบอร์ดติดตามผลการตรวจสอบคุณภาพ **OK / NG** แบบเรียลไทม์
(Real-time OK/NG quality inspection monitor)

## คุณสมบัติ

- **KPI สรุปกะ** — จำนวนตรวจทั้งหมด, OK, NG, Yield (เกจครึ่งวงกลมเทียบเป้าหมาย), อัตราการผลิต, NG ต่อเนื่อง
- **กราฟแนวโน้ม Yield** — เส้น Yield ต่อช่วงเวลา + ค่าเฉลี่ยสะสม + เส้นเป้าหมาย เลือกช่วง 30 / 60 / 120 ได้
- **Pareto สาเหตุของเสีย** — จัดอันดับประเภท defect พร้อมสัดส่วน %
- **สถานะรายสถานี** — 6 สถานีบน 3 สายการผลิต พร้อมสถานะ RUNNING / WATCH / ALARM / IDLE
- **บันทึกการตรวจสด** — ตารางเรียลไทม์ กรอง OK/NG และส่งออก CSV (UTF-8 BOM รองรับภาษาไทยใน Excel)
- **แจ้งเตือน** เมื่อพบ NG ต่อเนื่องถึงเกณฑ์
- ธีมมืด/สว่าง (จำค่าไว้ใน localStorage), responsive ถึงจอมือถือ, รองรับ `prefers-reduced-motion`

## คีย์ลัด

| ปุ่ม | การทำงาน |
|---|---|
| `Space` | หยุด / เริ่มการรับข้อมูล |
| `R` | รีเซ็ตข้อมูลกะ |

## โครงสร้าง

```
index.html                   โครงหน้า
assets/styles.css            ธีมและเลย์เอาต์ (CSS variables, ไม่มี framework)
assets/app.js                simulation engine + renderer (vanilla JS, ไม่มี dependency)
build.js                     สร้างไฟล์รวมใน dist/
dist/okng-monitor-v3.html    ไฟล์เดียวจบ — วางบน static host ไหนก็ได้
dist/artifact.html           เวอร์ชัน fragment สำหรับ Claude Artifact
netlify.toml                 การตั้งค่า deploy
```

## Build

```bash
node build.js
```

## รันในเครื่อง

```bash
python3 -m http.server 8080
# เปิด http://localhost:8080
```

## หมายเหตุเรื่องข้อมูล

ข้อมูลในหน้านี้เป็น **ข้อมูลจำลอง (simulated feed)** ที่สร้างในเบราว์เซอร์ ไม่ได้ต่อกับ PLC/MES จริง
หากต้องการต่อกับข้อมูลจริง ให้แทนที่ฟังก์ชัน `tick()` / `makeInspection()` ใน `assets/app.js`
ด้วยการดึงข้อมูลจาก WebSocket หรือ REST endpoint ของระบบจริง โดยส่งเรคอร์ดรูปแบบเดียวกัน
(`{ t, serial, station, line, result, defect, value, unit }`) เข้าสู่ `S.log` และ `S.curBucket`

## การตั้งค่า

ปรับค่าได้ที่ `CONFIG` ด้านบนของ `assets/app.js`

| ค่า | ความหมาย |
|---|---|
| `targetYield` | เป้าหมาย Yield (%) |
| `shiftTargetQty` | เป้าหมายจำนวนชิ้นต่อกะ |
| `ngStreakAlarm` | จำนวน NG ต่อเนื่องที่จะแจ้งเตือน |
| `stationAlarmYield` / `stationWarnYield` | เกณฑ์ ALARM / WATCH รายสถานี |

รายชื่อสถานีอยู่ใน `STATIONS` และประเภทของเสียอยู่ใน `DEFECTS`
