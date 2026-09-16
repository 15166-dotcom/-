/*
  ESP32_Count_OK-NG_V1b_BenchTest.ino
  ----------------------------------------------------------
  เวอร์ชันทดสอบบนโต๊ะ : นับ + จอ 20x4 + เซฟ NVS  (ยังไม่มี WiFi)
  พอร์ตมาจาก Count_OK-NG_Jun2026_TEST30.ino (Arduino) มาเป็น ESP32

  V1b : แก้ error 'Btn' does not name a type ของ Arduino IDE 1.8.x
        เปลี่ยนจาก struct มาใช้ array แทน (IDE รุ่นนี้แทรก prototype
        ไว้บนสุดของไฟล์ ก่อนถึงบรรทัดที่ประกาศ struct)

  สิ่งที่เปลี่ยนจากเวอร์ชัน Arduino เดิม
    1) EEPROM.h  ->  Preferences (NVS)  มี wear-leveling ในตัว
    2) เซฟ OK ทุก 50 ชิ้น หรือเมื่อนิ่ง 8 วินาที / NG เซฟทันที
    3) delay(100) ใน debounce -> debounce แบบ non-blocking (ไม่พลาดพัลส์)
    4) PM_LIMIT 10,000 -> 100,000
    5) แมปขา A0-A5 ใหม่เป็น GPIO ที่ปลอดภัยของ ESP32
    6) เซนเซอร์กล่อง NG จับขอบขาลง กันการนับซ้ำตอนชิ้นงานค้างหน้าเซนเซอร์

  V2 : เพิ่ม WiFi + Supabase Realtime (OKNG Monitor v3 — เครื่องเทียบสี)
        - งานเครือข่ายทั้งหมดรันบน Core 0 แยกจากงานนับพัลส์ที่ยังอยู่บน
          Core 1 เหมือนเดิมทุกประการ — HTTP/TLS ใช้เวลาเป็นร้อย ๆ มิลลิวินาที
          ถ้าเรียกตรง ๆ ใน loop() จะไปกินเวลา debounce จนพลาดพัลส์ได้
        - ส่ง event ผ่านคิว (FreeRTOS queue) จาก Core 1 ไป Core 0
        - รับคำสั่งจากแดชบอร์ดผ่านตาราง commands มาตั้งเป็น flag แล้วให้
          Core 1 เป็นคนสั่ง reset จริง (คนเดียวที่แก้ไขตัวนับ)

  V3 : เสริมความทนทานสำหรับใช้งานจริงในโรงงาน (WiFi หลุดบ่อย)
        (สถานีนี้มีเครื่องเดียว — ยังไม่ใช้สถาปัตยกรรมหลายสถานี/MAC/RPC)
        - Offline ring buffer จริง: event ที่ส่งไม่สำเร็จจะถูกส่งคืนหน้าคิว
          พร้อม timestamp ตอนเกิดเหตุจริง (ไม่ใช่ตอนส่งสำเร็จ) ไม่มีข้อมูลหาย
        - Retry แบบ exponential backoff (1s, 2s, 4s) ก่อนยอมแพ้แล้วเข้าคิว
        - Watchdog timer (Task WDT) กันเครื่องค้าง ครอบทั้ง 2 core
        - ปุ่มรีเซ็ต (resetPin1/resetPin2) เปลี่ยนจากกดครั้งเดียว ->
          ต้องกดค้าง 2 วินาที กันโดนชนโดยไม่ตั้งใจ (ปุ่มนับ/เซนเซอร์กล่อง
          ยังเป็น edge-trigger ทันทีเหมือนเดิม เพราะเป็นสัญญาณจากเครื่องจักร
          ไม่ใช่คนกด)
        - เลี่ยง String ต่อกันใน networkTask ที่วนถี่ ใช้ char buffer + snprintf
        - เซฟ NVS แบบ throttle ชัดเจน: เปลี่ยนแล้วเซฟได้ห่างกันอย่างน้อย 5
          วินาที ยกเว้น NG ที่เซฟทันทีเสมอ (ของเสียห้ามหายแม้ไฟดับ)
        - แยกฟังก์ชันตามหน้าที่ (setupPins/handleSensors/updateOutputs/...)
          อ่านง่ายขึ้น ไม่กระทบพฤติกรรมเดิม

  ** สำคัญ ** ESP32 เป็น 3.3V  อินพุตทุกเส้นต้องผ่าน optocoupler (เช่น PC817)
  ห้ามต่อสัญญาณ 12V/24V จากเครื่องจักรเข้าขาตรง ๆ

  บอร์ด : ESP32-WROOM-DA Module
  ไลบรารีจอ : ถ้าจอไม่ขึ้น ให้เปลี่ยนไปใช้ LiquidCrystal I2C ที่รองรับ esp32
  ไลบรารีเพิ่มสำหรับ V2/V3 : ArduinoJson (6.x) — ติดตั้งผ่าน Library Manager
  WiFi/HTTPClient/WiFiClientSecure/Preferences/esp_task_wdt มากับ ESP32 core
  อยู่แล้ว ไม่ต้องติดตั้งเพิ่ม

  หมายเหตุ esp_task_wdt: โค้ดนี้ใช้ API รูปแบบเก่า
  (esp_task_wdt_init(seconds, panic)) ที่ใช้ได้กับ ESP32 Arduino core 2.x
  ถ้าใช้ core 3.x ขึ้นไป ต้องเปลี่ยนเป็น esp_task_wdt_config_t ตาม
  https://docs.espressif.com/projects/arduino-esp32/en/latest/api/watchdog.html
  ----------------------------------------------------------
*/

#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <Preferences.h>

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include <esp_task_wdt.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"

// ==================== ตั้งค่า ====================
const uint8_t LCD_COLS = 20;
const uint8_t LCD_ROWS = 4;
LiquidCrystal_I2C lcd(0x27, LCD_COLS, LCD_ROWS);   // ถ้าจอไม่ขึ้น ลองเปลี่ยนเป็น 0x3F

const long PM_LIMIT  = 100000;     // รอบ PM (นับเป็นชิ้น)
const long COUNT_MAX = 999999;     // เพดานของจอ %6ld

// ==================== ขา GPIO (ของจริงที่ต่อสายไว้ — ห้ามเปลี่ยนเลข) ====================
// อินพุต (active-LOW ผ่าน optocoupler, ใช้ INPUT_PULLUP)
const int countPin1      = 32;   // เดิม A0 : นับ OK
const int resetPin1      = 33;   // เดิม A1 : รีเซ็ต OK (กดค้าง 2 วิ — ดู V3)
const int countPin2      = 25;   // เดิม A2 : นับ NG
const int resetPin2      = 26;   // เดิม A3 : รีเซ็ต NG (กดค้าง 2 วิ — ดู V3)
const int ngBoxSensorPin = 27;   // เดิม A4 : เซนเซอร์กล่อง NG (E3F-DS10C4 NPN) มีชิ้นงาน=LOW

// เอาต์พุต
const int buzzerPin   = 13;   // เดิม 11
const int limitOutPin = 18;   // เดิม 12
const int lockPin     = 19;   // เดิม A5 : HIGH เมื่อ NG ค้างยังไม่ใส่กล่อง

// I2C : SDA = 21, SCL = 22

// ==================== ตั้งค่าเครือข่าย (V2/V3) ====================
// TODO: ใส่ WiFi ของโรงงานจริงตรงนี้
const char* WIFI_SSID = "ใส่ชื่อ WiFi";
const char* WIFI_PASS = "ใส่รหัสผ่าน WiFi";

// โปรเจกต์ Supabase "เครื่องเทียบสี" — publishable key ฝังในเฟิร์มแวร์ได้
// อย่างปลอดภัย สิทธิ์จริงถูกคุมด้วย RLS ฝั่งฐานข้อมูล ไม่ใช่คีย์นี้
const char* SUPABASE_URL = "https://yfygpxvprvhlprsivkkq.supabase.co";
const char* SUPABASE_KEY = "sb_publishable_SmnBtZ_tK2f4fL3dIgUQow_cjWmWkwF";

const unsigned long STATUS_PUSH_MS   = 5000;    // heartbeat สถานะเครื่อง
const unsigned long CMD_POLL_MS      = 3000;    // เช็คคำสั่งจากแดชบอร์ด
const unsigned long RATE_WINDOW_MS   = 30000;   // หน้าต่างคำนวณอัตราผลิต
const unsigned long WIFI_RETRY_MS    = 5000;    // ห่างกันแค่ไหนถึงลองต่อ WiFi ใหม่
const unsigned long NVS_THROTTLE_MS  = 5000;    // เซฟ NVS ห่างกันอย่างน้อยเท่านี้ (V3)
const unsigned long LONG_PRESS_MS    = 2000;    // ปุ่มรีเซ็ตต้องกดค้างเท่านี้ (V3)
const uint32_t       WDT_TIMEOUT_S   = 30;      // watchdog timeout (V3) — ยาวพอให้ retry 3 ครั้งจบ

// หน่วงก่อน retry แต่ละครั้ง (exponential backoff ตาม Prompt: 1s, 2s, 4s)
const unsigned long HTTP_RETRY_DELAYS_MS[3] = { 1000, 2000, 4000 };
const uint8_t HTTP_MAX_ATTEMPTS = 3;

// event ที่จะขึ้นในตาราง event_log — ต้องตรงกับ okEvents/ngEvents ใน
// assets/config.js ของแดชบอร์ด ("ok" คือ OK, "ng" คือ NG)
enum EventCode : uint8_t {
  EVT_OK = 0,
  EVT_NG,
  EVT_NG_BOXED,
  EVT_RESET_OK,
  EVT_RESET_NG,
  EVT_FACTORY_RESET,
  EVT_PM_LIMIT
};

const char* eventName(EventCode e) {
  switch (e) {
    case EVT_OK:            return "ok";
    case EVT_NG:             return "ng";
    case EVT_NG_BOXED:       return "ng_boxed";
    case EVT_RESET_OK:       return "reset_ok";
    case EVT_RESET_NG:       return "reset_ng";
    case EVT_FACTORY_RESET:  return "factory_reset";
    case EVT_PM_LIMIT:       return "pm_limit_reached";
    default:                 return "unknown";
  }
}

// คำสั่งที่แดชบอร์ดส่งมา (ตาราง commands, คอลัมน์ cmd) — ต้องตรงกับ
// assets/config.js -> CFG.commands ตัวอักษรใหญ่-เล็กต้องตรงเป๊ะ
enum RemoteCmd : uint8_t { CMD_NONE = 0, CMD_RESET_NG, CMD_RESET_COUNT, CMD_FACTORY_RESET };

// รายการในคิว offline (V3) — ไม่ใช้เป็นพารามิเตอร์ของฟังก์ชันไหนเลย
// (จงใจ) เพื่อเลี่ยงบั๊ก auto-prototype ของ Arduino IDE กับ struct แบบที่
// เคยเจอตอนพอร์ตมาเป็น ESP32 (ดูหมายเหตุ V1b ด้านบน) — ฟังก์ชันทุกตัวรับ
// เฉพาะ field ข้างในเป็นพารามิเตอร์ธรรมดา ไม่รับ struct ทั้งก้อน
struct QueuedEvent {
  EventCode code;
  bool hasTs;      // true ถ้า NTP sync แล้วตอนเกิด event (ใส่ timestamp จริงได้)
  time_t ts;
};

// ==================== ตัวนับ ====================
// volatile: ถูกเขียนจาก Core 1 (loop) และอ่านจาก Core 0 (networkTask)
volatile long counter1 = 0;   // OK
volatile long counter2 = 0;   // NG (นับทุกครั้งที่เกิด)
volatile long counter3 = 0;   // NG Part Box (เซนเซอร์ยืนยันว่าใส่กล่องจริง)

// ==================== NVS ====================
Preferences prefs;
long savedOK = 0, savedNG = 0, savedBox = 0;
unsigned long lastSaveMs = 0;     // V3: ใช้คู่กับ NVS_THROTTLE_MS
bool ngPendingUrgentSave = false; // V3: NG ต้องเซฟทันที ข้าม throttle

// ==================== debounce แบบ non-blocking ====================
// ใช้ array แทน struct เพื่อเลี่ยงปัญหา auto-prototype ของ Arduino IDE 1.8.x
const uint8_t BTN_N = 4;
const uint8_t B_COUNT1 = 0;   // นับ OK (edge-trigger ทันที)
const uint8_t B_RESET1 = 1;   // รีเซ็ต OK (V3: ต้องกดค้าง LONG_PRESS_MS)
const uint8_t B_COUNT2 = 2;   // นับ NG (edge-trigger ทันที)
const uint8_t B_RESET2 = 3;   // รีเซ็ต NG (V3: ต้องกดค้าง LONG_PRESS_MS)

const unsigned long DEBOUNCE_MS = 30;

int           btnPin[BTN_N];
int           btnStable[BTN_N];
int           btnLastRead[BTN_N];
unsigned long btnTChange[BTN_N];
bool          btnHeldFired[BTN_N];   // V3: กันยิงซ้ำระหว่างกดค้างครั้งเดียว

// ==================== สถานะอื่น ====================
unsigned long previousMillis = 0;
const long interval = 500;
bool blinkState = false;

volatile bool ngBoxPending = false;   // true ตั้งแต่เกิด NG จนเซนเซอร์ยืนยันว่าใส่กล่องแล้ว
bool lastBuzzerState = false;
bool lastSensorLow   = false;  // กันการนับซ้ำขณะชิ้นงานค้างหน้าเซนเซอร์
bool pmLimitNotified = false;  // กันส่ง event "ครบ PM" ซ้ำทุกรอบ blink

char shownRow[LCD_ROWS][LCD_COLS + 1];

// ==================== สถานะเครือข่าย (V2/V3, ใช้ข้ามสอง core) ====================
QueueHandle_t eventQueue = NULL;   // คิวเก็บ QueuedEvent (อ่าน/เขียนแค่ผ่าน xQueueSend/Receive)
TaskHandle_t  networkTaskHandle = NULL;
volatile RemoteCmd pendingRemoteCmd = CMD_NONE;
char lastEventName[24] = "none";   // ค่าล่าสุดที่ใส่ในคอลัมน์ status.event
bool timeSynced = false;

// ==================== SETUP ====================
void setup() {
  Serial.begin(115200);

  setupPins();
  btnInit(B_COUNT1, countPin1);
  btnInit(B_RESET1, resetPin1);
  btnInit(B_COUNT2, countPin2);
  btnInit(B_RESET2, resetPin2);

  for (uint8_t r = 0; r < LCD_ROWS; r++) shownRow[r][0] = '\0';

  Wire.begin(21, 22);
  lcd.init();
  lcd.backlight();
  lcd.clear();

  showLoadingScreen();

  loadState();
  updateDisplay();

  // ---------- watchdog (V3) ----------
  // ครอบทั้ง loop() หลัก (Core 1) และ networkTask (Core 0) ด้วย timeout
  // เดียวกัน ตั้งยาวพอ (30s) ให้ retry เครือข่าย 3 ครั้งจบก่อนโดน panic
  esp_task_wdt_init(WDT_TIMEOUT_S, true);
  esp_task_wdt_add(NULL);   // ลงทะเบียน task ปัจจุบัน (loop) กับ WDT

  // ---------- เริ่มงานเครือข่าย (Core 0) แยกจากงานนับพัลส์ (Core 1) ----------
  // ขนาดคิว 50 ช่องตาม Prompt เผื่อเน็ตหลุดแล้วเกิด event รัว ๆ ไม่ให้หาย
  eventQueue = xQueueCreate(50, sizeof(QueuedEvent));
  xTaskCreatePinnedToCore(networkTask, "networkTask", 16384, NULL, 1, &networkTaskHandle, 0);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

// ==================== LOOP (Core 1 — งานนับพัลส์ ห้ามบล็อกด้วยเครือข่าย) ====================
void loop() {
  esp_task_wdt_reset();

  // รับคำสั่งจากแดชบอร์ด (ถ้ามี) — pendingRemoteCmd ถูกตั้งจาก Core 0
  handleRemoteCommand();

  handleSensors();     // อ่านปุ่ม/เซนเซอร์ + debounce + เพิ่มตัวนับ (V3: แยกเป็นฟังก์ชัน)
  updateOutputs();      // ไฟ/ล็อก/บัซเซอร์ตามสถานะปัจจุบัน (V3: แยกเป็นฟังก์ชัน)

  saveState();          // เซฟ NVS แบบ throttle (V3)
  updateDisplay();
}

// ==================== ตั้งค่าขา I/O ====================
void setupPins() {
  pinMode(countPin1, INPUT_PULLUP);
  pinMode(resetPin1, INPUT_PULLUP);
  pinMode(countPin2, INPUT_PULLUP);
  pinMode(resetPin2, INPUT_PULLUP);
  pinMode(ngBoxSensorPin, INPUT_PULLUP);

  pinMode(buzzerPin, OUTPUT);
  pinMode(limitOutPin, OUTPUT);
  pinMode(lockPin, OUTPUT);
  digitalWrite(buzzerPin, LOW);
  digitalWrite(limitOutPin, LOW);
  digitalWrite(lockPin, LOW);
}

// ==================== อ่านปุ่ม/เซนเซอร์ + นับ (V3: แยกจาก loop เดิม) ====================
void handleSensors() {
  // ---------- กระพริบตอน PM ครบ ----------
  if (counter1 > PM_LIMIT) {
    unsigned long now = millis();
    if (now - previousMillis >= interval) {
      previousMillis = now;
      blinkState = !blinkState;
    }
  }

  // ---------- ตัวนับ OK (edge-trigger ทันที — เป็นพัลส์จากเครื่องจักร) ----------
  if (btnFell(B_COUNT1)) {
    if (counter1 <= PM_LIMIT) {
      counter1++;
      if (counter1 > COUNT_MAX) counter1 = 0;
      queueEvent(EVT_OK);
      if (counter1 > PM_LIMIT) {
        digitalWrite(limitOutPin, HIGH);
        if (!pmLimitNotified) { pmLimitNotified = true; queueEvent(EVT_PM_LIMIT); }
      }
      Serial.printf("OK -> %ld\n", counter1);
    }
  }

  // ---------- รีเซ็ต OK (V3: ต้องกดค้าง 2 วินาที) ----------
  if (btnHeld(B_RESET1, LONG_PRESS_MS)) {
    counter1 = 0;
    digitalWrite(limitOutPin, LOW);
    blinkState = false;
    pmLimitNotified = false;
    saveCounters();
    lastSaveMs = millis();
    queueEvent(EVT_RESET_OK);
    Serial.println("RESET OK (กดค้าง 2 วิ)");
  }

  // ---------- ตัวนับ NG (edge-trigger ทันที) ----------
  if (btnFell(B_COUNT2)) {
    counter2++;
    if (counter2 > COUNT_MAX) counter2 = 0;
    ngBoxPending = true;            // เริ่มรอเซนเซอร์ยืนยัน
    ngPendingUrgentSave = true;     // ของเสียห้ามหาย — ข้าม throttle รอบถัดไป
    queueEvent(EVT_NG);
    Serial.printf("NG -> %ld (รอใส่กล่อง)\n", counter2);
  }

  // ---------- รีเซ็ต NG (V3: ต้องกดค้าง 2 วินาที) ----------
  if (btnHeld(B_RESET2, LONG_PRESS_MS)) {
    counter2 = 0;
    ngBoxPending = false;
    saveCounters();
    lastSaveMs = millis();
    queueEvent(EVT_RESET_NG);
    Serial.println("RESET NG (กดค้าง 2 วิ)");
  }

  // ---------- เซนเซอร์กล่อง NG ----------
  bool sensorLow = (digitalRead(ngBoxSensorPin) == LOW);
  if (sensorLow && !lastSensorLow && ngBoxPending) {
    ngBoxPending = false;
    counter3++;
    if (counter3 > COUNT_MAX) counter3 = 0;
    ngPendingUrgentSave = true;
    queueEvent(EVT_NG_BOXED);
    Serial.printf("NG BOXED -> %ld\n", counter3);
  }
  lastSensorLow = sensorLow;
}

// ==================== ไฟ/ล็อก/บัซเซอร์ (V3: แยกจาก loop เดิม) ====================
// LOCK ตัดสินจากสถานะในบอร์ดล้วน ๆ (ngBoxPending) ไม่รอคำตอบจาก server เด็ดขาด
void updateOutputs() {
  digitalWrite(lockPin, ngBoxPending ? HIGH : LOW);

  bool wantBuzzer = (counter1 > PM_LIMIT && blinkState) || ngBoxPending;
  if (wantBuzzer != lastBuzzerState) {
    digitalWrite(buzzerPin, wantBuzzer ? HIGH : LOW);
    lastBuzzerState = wantBuzzer;
  }
}

// ==================== รับคำสั่งจากแดชบอร์ด ====================
// เรียกจาก loop() (Core 1) ทุกรอบ — pendingRemoteCmd ถูกตั้งค่าจาก Core 0
void handleRemoteCommand() {
  if (pendingRemoteCmd == CMD_NONE) return;
  RemoteCmd cmd = pendingRemoteCmd;
  pendingRemoteCmd = CMD_NONE;

  switch (cmd) {
    case CMD_RESET_NG:
      counter2 = 0;
      ngBoxPending = false;
      saveCounters();
      lastSaveMs = millis();
      queueEvent(EVT_RESET_NG);
      Serial.println("[REMOTE] RESET NG");
      break;

    case CMD_RESET_COUNT:
      counter1 = 0;
      digitalWrite(limitOutPin, LOW);
      blinkState = false;
      pmLimitNotified = false;
      saveCounters();
      lastSaveMs = millis();
      queueEvent(EVT_RESET_OK);
      Serial.println("[REMOTE] RESET OK");
      break;

    case CMD_FACTORY_RESET:
      counter1 = 0; counter2 = 0; counter3 = 0;
      ngBoxPending = false;
      digitalWrite(limitOutPin, LOW);
      blinkState = false;
      pmLimitNotified = false;
      saveCounters();
      lastSaveMs = millis();
      queueEvent(EVT_FACTORY_RESET);
      Serial.println("[REMOTE] FACTORY RESET");
      break;

    default:
      break;
  }
}

// ==================== debounce ====================
void btnInit(uint8_t i, int pin) {
  btnPin[i]      = pin;
  btnStable[i]   = HIGH;
  btnLastRead[i] = HIGH;
  btnTChange[i]  = 0;
  btnHeldFired[i] = false;
}

// คืน true หนึ่งครั้งเมื่อเกิดขอบขาลง (HIGH -> LOW) — ใช้กับสัญญาณจากเครื่องจักร
bool btnFell(uint8_t i) {
  int r = digitalRead(btnPin[i]);
  if (r != btnLastRead[i]) {
    btnLastRead[i] = r;
    btnTChange[i]  = millis();
    return false;
  }
  if (millis() - btnTChange[i] < DEBOUNCE_MS) return false;
  if (r != btnStable[i]) {
    btnStable[i] = r;
    if (r == LOW) return true;
  }
  return false;
}

// V3: คืน true "หนึ่งครั้ง" เมื่อกดค้าง (LOW ต่อเนื่อง) ครบ holdMs
// ใช้กับปุ่มที่คนกด (รีเซ็ต) กันโดนชนโดยไม่ตั้งใจ — ต้องปล่อยก่อนถึงจะกดติดใหม่ได้
bool btnHeld(uint8_t i, unsigned long holdMs) {
  int r = digitalRead(btnPin[i]);
  if (r != btnLastRead[i]) {
    btnLastRead[i] = r;
    btnTChange[i]  = millis();
    return false;
  }
  if (millis() - btnTChange[i] < DEBOUNCE_MS) return false;

  if (r != btnStable[i]) {
    btnStable[i] = r;
    if (r == HIGH) btnHeldFired[i] = false;   // ปล่อยปุ่มแล้ว พร้อมกดรอบใหม่
  }

  if (btnStable[i] == LOW && !btnHeldFired[i] &&
      (millis() - btnTChange[i] >= holdMs)) {
    btnHeldFired[i] = true;
    return true;
  }
  return false;
}

// ==================== NVS ====================
void loadState() {
  prefs.begin("qacount", false);
  counter1 = prefs.getLong("ok", 0);
  counter2 = prefs.getLong("ng", 0);
  counter3 = prefs.getLong("ngbox", 0);

  if (counter1 < 0 || counter1 > COUNT_MAX) counter1 = 0;
  if (counter2 < 0 || counter2 > COUNT_MAX) counter2 = 0;
  if (counter3 < 0 || counter3 > COUNT_MAX) counter3 = 0;

  savedOK = counter1; savedNG = counter2; savedBox = counter3;

  if (counter1 > PM_LIMIT) { digitalWrite(limitOutPin, HIGH); pmLimitNotified = true; }

  Serial.printf("Boot: OK=%ld  NG=%ld  BOX=%ld  PM_LIMIT=%ld\n",
                counter1, counter2, counter3, PM_LIMIT);
}

void saveCounters() {
  prefs.putLong("ok",    counter1);
  prefs.putLong("ng",    counter2);
  prefs.putLong("ngbox", counter3);
  savedOK = counter1; savedNG = counter2; savedBox = counter3;
}

// V3: เซฟแบบ throttle ชัดเจน — เปลี่ยนแล้วเซฟห่างกันอย่างน้อย NVS_THROTTLE_MS
// ยกเว้น NG/NG BOXED ที่ตั้ง ngPendingUrgentSave ไว้ให้เซฟทันทีข้าม throttle
// (ของเสียห้ามหายแม้ไฟดับ ตรงกับพฤติกรรมเดิมของไฟล์ V1b)
void saveState() {
  if (counter1 == savedOK && counter2 == savedNG && counter3 == savedBox) {
    ngPendingUrgentSave = false;
    return;
  }

  bool timeUp = (millis() - lastSaveMs >= NVS_THROTTLE_MS);
  if (ngPendingUrgentSave || timeUp) {
    saveCounters();
    lastSaveMs = millis();
    ngPendingUrgentSave = false;
    Serial.println("[NVS] saved");
  }
}

// ==================== หน้าจอ LOADING ====================
void showLoadingScreen() {
  const uint8_t textRow = 1;
  const uint8_t barRow  = 2;
  const char *msg = " H   E   T ";
  uint8_t msgLen = strlen(msg);
  uint8_t startCol = (LCD_COLS - msgLen) / 2;

  lcd.setCursor(startCol, textRow);
  lcd.print(msg);

  for (uint8_t i = 0; i < LCD_COLS; i++) {
    lcd.setCursor(i, barRow);
    lcd.print("*");
    delay(60);
  }
  delay(400);

  int left  = startCol;
  int right = startCol + msgLen - 1;
  while (left <= right) {
    lcd.setCursor(left, textRow);  lcd.print(" ");
    lcd.setCursor(right, textRow); lcd.print(" ");
    left++; right--;
    delay(120);
  }

  for (int i = LCD_COLS - 1; i >= 0; i--) {
    lcd.setCursor(i, barRow);
    lcd.print(" ");
    delay(40);
  }
  lcd.clear();
}

// ==================== วาดจอเฉพาะแถวที่เปลี่ยน ====================
void printRow(uint8_t row, const char *text) {
  char buf[LCD_COLS + 1];
  uint8_t i = 0;
  for (; i < LCD_COLS && text[i] != '\0'; i++) buf[i] = text[i];
  for (; i < LCD_COLS; i++) buf[i] = ' ';
  buf[LCD_COLS] = '\0';
  if (strcmp(buf, shownRow[row]) == 0) return;
  lcd.setCursor(0, row);
  lcd.print(buf);
  strcpy(shownRow[row], buf);
}

/*
  เลย์เอาต์จอ 20x4
  01234567890123456789
  Review OK=    25 Pcs
  Jun,26 NG=     3 Pcs
  NG Part Box =      2
  Status for PM:100000
*/
void updateDisplay() {
  char buf[LCD_COLS + 1];

  snprintf(buf, sizeof(buf), "Review OK=%6ld Pcs", counter1);
  printRow(0, buf);

  snprintf(buf, sizeof(buf), "Jun,26 NG=%6ld Pcs", counter2);
  printRow(1, buf);

  snprintf(buf, sizeof(buf), "NG Box =  %6ld Pcs", counter3);
  printRow(2, buf);

  if (counter1 > PM_LIMIT) {
    printRow(3, blinkState ? "!! FULL LIMIT PM !!" : "");
  } else {
    snprintf(buf, sizeof(buf), "Status for PM:%6ld", PM_LIMIT);
    printRow(3, buf);
  }
}

// ============================================================
// ====================  V2/V3 : เครือข่าย  =====================
// ทุกฟังก์ชันในส่วนนี้รันบน Core 0 (จาก networkTask) เท่านั้น
// ไม่มีอะไรในนี้ถูกเรียกจาก loop() ตรง ๆ ยกเว้นผ่านคิว/flag
// ============================================================

// ใส่ event ลงคิว — เรียกจาก Core 1 เท่านั้น, ไม่รอ/ไม่บล็อก (timeout=0)
void queueEvent(EventCode e) {
  strncpy(lastEventName, eventName(e), sizeof(lastEventName) - 1);
  lastEventName[sizeof(lastEventName) - 1] = '\0';

  QueuedEvent qe;
  qe.code = e;
  qe.hasTs = timeSynced;
  qe.ts = timeSynced ? time(nullptr) : 0;
  xQueueSend(eventQueue, &qe, 0);
}

void ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  static unsigned long lastAttempt = 0;
  if (millis() - lastAttempt < WIFI_RETRY_MS) return;
  lastAttempt = millis();
  Serial.println("[WiFi] กำลังเชื่อมต่อ...");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

void ensureTimeSynced() {
  if (timeSynced || WiFi.status() != WL_CONNECTED) return;
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");   // ใช้ UTC ตรง ๆ ส่งแบบ Z ให้ Postgres
  time_t now = time(nullptr);
  if (now > 1700000000) {   // ประมาณปี 2023 ขึ้นไป = เวลาซิงก์แล้ว
    timeSynced = true;
    Serial.println("[NTP] เวลาซิงก์แล้ว");
  }
}

// แปลง epoch -> ISO8601 UTC ("...Z") ลง buffer ที่ให้มา (V3: เลี่ยง String)
void isoFromEpoch(time_t t, char* out, size_t outLen) {
  struct tm tmInfo;
  gmtime_r(&t, &tmInfo);
  strftime(out, outLen, "%Y-%m-%dT%H:%M:%SZ", &tmInfo);
}

// V3: ส่ง HTTP พร้อม retry แบบ exponential backoff (1s, 2s, 4s ตาม Prompt)
// คืน true ถ้าสำเร็จ (2xx) ภายใน HTTP_MAX_ATTEMPTS ครั้ง
bool httpSendWithRetry(const char* method, const String& url, const String& body,
                        bool withPreferMinimal) {
  for (uint8_t attempt = 0; attempt < HTTP_MAX_ATTEMPTS; attempt++) {
    esp_task_wdt_reset();   // กัน watchdog หลุดระหว่างรอ backoff/retry

    WiFiClientSecure client;
    client.setInsecure();   // ใช้งานภายในโรงงาน — ถ้าต้องการเข้มขึ้นให้ปักหมุด root CA ของ Supabase
    HTTPClient http;
    http.setTimeout(4000);
    http.begin(client, url);
    http.addHeader("apikey", SUPABASE_KEY);
    http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
    http.addHeader("Content-Type", "application/json");
    if (withPreferMinimal) http.addHeader("Prefer", "return=minimal");

    int code;
    if (strcmp(method, "PATCH") == 0) code = http.PATCH(body);
    else if (strcmp(method, "POST") == 0) code = http.POST(body);
    else code = http.sendRequest(method, body);
    http.end();

    if (code >= 200 && code < 300) {
      if (attempt > 0) Serial.printf("[Supabase] สำเร็จหลัง retry ครั้งที่ %d\n", attempt + 1);
      return true;
    }

    Serial.printf("[Supabase] %s ผิดพลาด code=%d (ครั้งที่ %d/%d)\n",
                  method, code, attempt + 1, HTTP_MAX_ATTEMPTS);

    if (attempt < HTTP_MAX_ATTEMPTS - 1) {
      vTaskDelay(pdMS_TO_TICKS(HTTP_RETRY_DELAYS_MS[attempt]));
    }
  }
  return false;
}

void supaPushStatus(float rate) {
  if (WiFi.status() != WL_CONNECTED || !timeSynced) return;

  char tsBuf[25];
  isoFromEpoch(time(nullptr), tsBuf, sizeof(tsBuf));

  StaticJsonDocument<512> doc;
  doc["setting"]        = PM_LIMIT;
  doc["counting"]       = counter1;
  doc["ok_total"]       = counter1;
  doc["ng_total"]       = counter2;
  doc["rate"]           = rate;
  doc["d9"]             = false;              // บอร์ดนี้ไม่มีเซนเซอร์ตัวนี้
  doc["d11"]            = false;              // บอร์ดนี้ไม่มีเซนเซอร์ตัวนี้
  doc["d12"]            = ngBoxPending;       // ตรงกับสถานะขา lockPin จริง
  doc["full_counter"]   = (counter1 > PM_LIMIT);
  doc["lock_old"]       = false;
  doc["lock_auto"]      = ngBoxPending;
  doc["event"]          = lastEventName;
  doc["device_seen_at"] = tsBuf;

  String body;
  serializeJson(doc, body);

  String url = String(SUPABASE_URL) + "/rest/v1/status?id=eq.1";
  httpSendWithRetry("PATCH", url, body, true);
  // ถ้าล้มเหลวครบ 3 ครั้งก็ปล่อยผ่าน — heartbeat รอบถัดไปอีก 5 วิจะลองใหม่เอง
  // ไม่ต้อง queue เพราะ status เป็น "สถานะล่าสุด" ไม่ใช่ event ที่ห้ามหาย
}

// ส่ง event หนึ่งรายการที่ดึงออกจากคิวแล้ว — พารามิเตอร์เป็นค่าธรรมดา
// ไม่ใช่ struct (ดูหมายเหตุ QueuedEvent ด้านบน)
bool supaLogEvent(const char* name, bool hasTs, time_t ts) {
  if (WiFi.status() != WL_CONNECTED) return false;

  StaticJsonDocument<160> doc;
  doc["event"] = name;
  if (hasTs) {
    char tsBuf[25];
    isoFromEpoch(ts, tsBuf, sizeof(tsBuf));
    doc["created_at"] = tsBuf;   // เก็บเวลาที่เกิดเหตุจริง ไม่ใช่เวลาที่ส่งสำเร็จ
  }

  String body;
  serializeJson(doc, body);

  String url = String(SUPABASE_URL) + "/rest/v1/event_log";
  return httpSendWithRetry("POST", url, body, false);
}

void supaPollCommandsAndDispatch() {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(4000);
  http.begin(client, String(SUPABASE_URL) +
    "/rest/v1/commands?processed=eq.false&order=created_at.asc&limit=5");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);

  int code = http.GET();
  if (code == 200) {
    DynamicJsonDocument doc(1024);
    DeserializationError err = deserializeJson(doc, http.getString());
    if (!err) {
      for (JsonObject row : doc.as<JsonArray>()) {
        long id = row["id"] | 0L;
        const char* cmd = row["cmd"] | "";

        RemoteCmd rc = CMD_NONE;
        if      (strcmp(cmd, "RESET_NG") == 0)      rc = CMD_RESET_NG;
        else if (strcmp(cmd, "RESET_COUNT") == 0)   rc = CMD_RESET_COUNT;
        else if (strcmp(cmd, "FACTORY_RESET") == 0) rc = CMD_FACTORY_RESET;

        if (rc != CMD_NONE) {
          pendingRemoteCmd = rc;   // Core 1 จะไปทำงานจริงในรอบ loop() ถัดไป
          Serial.printf("[Supabase] รับคำสั่ง %s (id=%ld)\n", cmd, id);
        } else {
          Serial.printf("[Supabase] คำสั่งไม่รู้จัก: %s\n", cmd);
        }

        // มาร์คว่ารับแล้วทันที — ยอมรับความเสี่ยงเล็กน้อยถ้าไฟดับพอดีจังหวะนี้
        // (การรีเซ็ตไม่ใช่งาน safety-critical เหมือนตัวนับ)
        char patchUrl[160];
        snprintf(patchUrl, sizeof(patchUrl), "%s/rest/v1/commands?id=eq.%ld", SUPABASE_URL, id);
        httpSendWithRetry("PATCH", String(patchUrl), "{\"processed\": true}", true);
      }
    }
  }
  http.end();
}

// งานหลักของ Core 0 — วนอ่านคิว event, ส่ง heartbeat, เช็คคำสั่ง
void networkTask(void* param) {
  esp_task_wdt_add(NULL);   // ลงทะเบียนตัวเองกับ watchdog ด้วย (คนละ task จาก loop)

  unsigned long lastStatusPush = 0, lastCmdPoll = 0, lastRateCalc = millis();
  long lastOkForRate = counter1;
  float currentRate = 0;

  for (;;) {
    esp_task_wdt_reset();

    ensureWiFi();
    ensureTimeSynced();

    // ส่ง event ที่ค้างอยู่ในคิว — ถ้าตัวไหนส่งไม่สำเร็จ (WiFi หลุดกลางทาง)
    // ให้ใส่คืนหน้าคิวแล้วหยุดรอบนี้ กันยิงรัวใส่เน็ตที่ยังไม่กลับมา และ
    // รักษาลำดับ event ไว้ไม่ให้สลับกัน (V3: ring buffer จริง ไม่ทิ้งข้อมูล)
    QueuedEvent qe;
    while (xQueueReceive(eventQueue, &qe, 0) == pdTRUE) {
      bool ok = supaLogEvent(eventName(qe.code), qe.hasTs, qe.ts);
      if (!ok) {
        xQueueSendToFront(eventQueue, &qe, 0);
        break;
      }
    }

    // คำนวณอัตราการผลิตทุก RATE_WINDOW_MS
    if (millis() - lastRateCalc >= RATE_WINDOW_MS) {
      long delta = counter1 - lastOkForRate;
      float minutes = (millis() - lastRateCalc) / 60000.0;
      currentRate = (minutes > 0) ? (delta / minutes) : 0;
      lastOkForRate = counter1;
      lastRateCalc = millis();
    }

    if (millis() - lastStatusPush >= STATUS_PUSH_MS) {
      supaPushStatus(currentRate);
      lastStatusPush = millis();
    }

    if (millis() - lastCmdPoll >= CMD_POLL_MS) {
      supaPollCommandsAndDispatch();
      lastCmdPoll = millis();
    }

    vTaskDelay(pdMS_TO_TICKS(200));
  }
}
