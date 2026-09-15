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
        - ส่ง event ผ่านคิว (FreeRTOS queue) จาก Core 1 ไป Core 0 —
          Core 1 แค่ยัดคิวแล้วเดินต่อ ไม่รอเครือข่ายเลย
        - รับคำสั่งจากแดชบอร์ด (เคลียร์ NG/LOCK ฯลฯ) ผ่านตาราง commands
          มาตั้งเป็น flag แล้วให้ Core 1 เป็นคนสั่ง reset จริง (คนเดียวที่
          แก้ไขตัวนับ กันข้อมูลชนกันระหว่าง 2 core)
        - ตัวแปรตัวนับที่ทั้งสอง core แตะ ประกาศเป็น volatile

  ** สำคัญ ** ESP32 เป็น 3.3V  อินพุตทุกเส้นต้องผ่าน optocoupler (เช่น PC817)
  ห้ามต่อสัญญาณ 12V/24V จากเครื่องจักรเข้าขาตรง ๆ

  บอร์ด : ESP32-WROOM-DA Module
  ไลบรารีจอ : ถ้าจอไม่ขึ้น ให้เปลี่ยนไปใช้ LiquidCrystal I2C ที่รองรับ esp32
  ไลบรารีเพิ่มสำหรับ V2 : ArduinoJson (ติดตั้งผ่าน Library Manager)
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
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"

// ==================== ตั้งค่า ====================
const uint8_t LCD_COLS = 20;
const uint8_t LCD_ROWS = 4;
LiquidCrystal_I2C lcd(0x27, LCD_COLS, LCD_ROWS);   // ถ้าจอไม่ขึ้น ลองเปลี่ยนเป็น 0x3F

const long PM_LIMIT  = 100000;     // รอบ PM (นับเป็นชิ้น)
const long COUNT_MAX = 999999;     // เพดานของจอ %6ld

// ==================== ขา GPIO ====================
// อินพุต (active-LOW ผ่าน optocoupler, ใช้ INPUT_PULLUP)
const int countPin1      = 32;   // เดิม A0 : นับ OK
const int resetPin1      = 33;   // เดิม A1 : รีเซ็ต OK
const int countPin2      = 25;   // เดิม A2 : นับ NG
const int resetPin2      = 26;   // เดิม A3 : รีเซ็ต NG
const int ngBoxSensorPin = 27;   // เดิม A4 : เซนเซอร์กล่อง NG (E3F-DS10C4 NPN) มีชิ้นงาน=LOW

// เอาต์พุต
const int buzzerPin   = 13;   // เดิม 11
const int limitOutPin = 18;   // เดิม 12
const int lockPin     = 19;   // เดิม A5 : HIGH เมื่อ NG ค้างยังไม่ใส่กล่อง

// I2C : SDA = 21, SCL = 22

// ==================== ตั้งค่าเครือข่าย (V2) ====================
// TODO: ใส่ WiFi ของโรงงานจริงตรงนี้
const char* WIFI_SSID = "ใส่ชื่อ WiFi";
const char* WIFI_PASS = "ใส่รหัสผ่าน WiFi";

// โปรเจกต์ Supabase "เครื่องเทียบสี" — publishable key ฝังในเฟิร์มแวร์ได้
// อย่างปลอดภัย สิทธิ์จริงถูกคุมด้วย RLS ฝั่งฐานข้อมูล ไม่ใช่คีย์นี้
const char* SUPABASE_URL = "https://yfygpxvprvhlprsivkkq.supabase.co";
const char* SUPABASE_KEY = "sb_publishable_SmnBtZ_tK2f4fL3dIgUQow_cjWmWkwF";

const unsigned long STATUS_PUSH_MS = 5000;    // heartbeat สถานะเครื่อง
const unsigned long CMD_POLL_MS    = 3000;    // เช็คคำสั่งจากแดชบอร์ด
const unsigned long RATE_WINDOW_MS = 30000;   // หน้าต่างคำนวณอัตราผลิต
const unsigned long WIFI_RETRY_MS  = 5000;    // ห่างกันแค่ไหนถึงลองต่อ WiFi ใหม่

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

// ==================== ตัวนับ ====================
// volatile: ถูกเขียนจาก Core 1 (loop) และอ่านจาก Core 0 (networkTask)
volatile long counter1 = 0;   // OK
volatile long counter2 = 0;   // NG (นับทุกครั้งที่เกิด)
volatile long counter3 = 0;   // NG Part Box (เซนเซอร์ยืนยันว่าใส่กล่องจริง)

// ==================== NVS ====================
Preferences prefs;
long savedOK = 0, savedNG = 0, savedBox = 0;
unsigned long lastChangeMs = 0;
const long SAVE_EVERY = 50;               // OK ครบ 50 ชิ้นค่อยเซฟ
const unsigned long SAVE_IDLE = 8000;     // หรือไม่มีการเปลี่ยนแปลง 8 วินาที

// ==================== debounce แบบ non-blocking ====================
// ใช้ array แทน struct เพื่อเลี่ยงปัญหา auto-prototype ของ Arduino IDE 1.8.x
const uint8_t BTN_N = 4;
const uint8_t B_COUNT1 = 0;   // นับ OK
const uint8_t B_RESET1 = 1;   // รีเซ็ต OK
const uint8_t B_COUNT2 = 2;   // นับ NG
const uint8_t B_RESET2 = 3;   // รีเซ็ต NG

const unsigned long DEBOUNCE_MS = 30;

int           btnPin[BTN_N];
int           btnStable[BTN_N];
int           btnLastRead[BTN_N];
unsigned long btnTChange[BTN_N];

// ==================== สถานะอื่น ====================
unsigned long previousMillis = 0;
const long interval = 500;
bool blinkState = false;

volatile bool ngBoxPending = false;   // true ตั้งแต่เกิด NG จนเซนเซอร์ยืนยันว่าใส่กล่องแล้ว
bool lastBuzzerState = false;
bool lastSensorLow   = false;  // กันการนับซ้ำขณะชิ้นงานค้างหน้าเซนเซอร์
bool pmLimitNotified = false;  // กันส่ง event "ครบ PM" ซ้ำทุกรอบ blink

char shownRow[LCD_ROWS][LCD_COLS + 1];

// ==================== สถานะเครือข่าย (V2, ใช้ข้ามสอง core) ====================
QueueHandle_t eventQueue = NULL;
TaskHandle_t  networkTaskHandle = NULL;
volatile RemoteCmd pendingRemoteCmd = CMD_NONE;
char lastEventName[24] = "none";   // ค่าล่าสุดที่ใส่ในคอลัมน์ status.event
bool timeSynced = false;

// ==================== SETUP ====================
void setup() {
  Serial.begin(115200);

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

  // ---------- โหลดค่าจาก NVS ----------
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

  updateDisplay();

  // ---------- เริ่มงานเครือข่าย (Core 0) แยกจากงานนับพัลส์ (Core 1) ----------
  // ขนาดคิว 64 ช่อง เผื่อเน็ตหลุดแป๊บหนึ่งแล้วเกิด event รัว ๆ ไม่ให้หาย
  eventQueue = xQueueCreate(64, sizeof(EventCode));
  xTaskCreatePinnedToCore(networkTask, "networkTask", 16384, NULL, 1, &networkTaskHandle, 0);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

// ==================== LOOP (Core 1 — งานนับพัลส์ ห้ามบล็อกด้วยเครือข่าย) ====================
void loop() {

  // ---------- รับคำสั่งจากแดชบอร์ด (ถ้ามี) ----------
  // pendingRemoteCmd ถูกตั้งจาก Core 0 (networkTask) หลัง poll ตาราง commands
  // แต่ให้ Core 1 เป็นคนสั่ง reset จริง เพราะเป็นคนเดียวที่แก้ตัวนับ
  handleRemoteCommand();

  // ---------- กระพริบตอน PM ครบ ----------
  if (counter1 > PM_LIMIT) {
    unsigned long now = millis();
    if (now - previousMillis >= interval) {
      previousMillis = now;
      blinkState = !blinkState;
    }
  }

  // ---------- ตัวนับ OK ----------
  if (btnFell(B_COUNT1)) {
    if (counter1 <= PM_LIMIT) {
      counter1++;
      if (counter1 > COUNT_MAX) counter1 = 0;
      lastChangeMs = millis();
      queueEvent(EVT_OK);
      if (counter1 > PM_LIMIT) {
        digitalWrite(limitOutPin, HIGH);
        if (!pmLimitNotified) { pmLimitNotified = true; queueEvent(EVT_PM_LIMIT); }
      }
      Serial.printf("OK -> %ld\n", counter1);
    }
  }

  if (btnFell(B_RESET1)) {
    counter1 = 0;
    digitalWrite(limitOutPin, LOW);
    blinkState = false;
    pmLimitNotified = false;
    saveCounters();                 // รีเซ็ต = เซฟทันที
    queueEvent(EVT_RESET_OK);
    Serial.println("RESET OK");
  }

  // ---------- ตัวนับ NG ----------
  if (btnFell(B_COUNT2)) {
    counter2++;
    if (counter2 > COUNT_MAX) counter2 = 0;
    ngBoxPending = true;            // เริ่มรอเซนเซอร์ยืนยัน
    saveCounters();                 // NG เซฟทันที
    queueEvent(EVT_NG);
    Serial.printf("NG -> %ld (รอใส่กล่อง)\n", counter2);
  }

  if (btnFell(B_RESET2)) {
    counter2 = 0;
    ngBoxPending = false;
    saveCounters();
    queueEvent(EVT_RESET_NG);
    Serial.println("RESET NG");
  }

  // ---------- เซนเซอร์กล่อง NG ----------
  bool sensorLow = (digitalRead(ngBoxSensorPin) == LOW);
  if (sensorLow && !lastSensorLow && ngBoxPending) {
    ngBoxPending = false;
    counter3++;
    if (counter3 > COUNT_MAX) counter3 = 0;
    saveCounters();
    queueEvent(EVT_NG_BOXED);
    Serial.printf("NG BOXED -> %ld\n", counter3);
  }
  lastSensorLow = sensorLow;

  // ---------- ขาล็อกระบบ ----------
  digitalWrite(lockPin, ngBoxPending ? HIGH : LOW);

  // ---------- บัซเซอร์ ----------
  bool wantBuzzer = (counter1 > PM_LIMIT && blinkState) || ngBoxPending;
  if (wantBuzzer != lastBuzzerState) {
    digitalWrite(buzzerPin, wantBuzzer ? HIGH : LOW);
    lastBuzzerState = wantBuzzer;
  }

  saveIfNeeded();
  updateDisplay();
}

// ==================== รับคำสั่งจากแดชบอร์ด (V2) ====================
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
      queueEvent(EVT_RESET_NG);
      Serial.println("[REMOTE] RESET NG");
      break;

    case CMD_RESET_COUNT:
      counter1 = 0;
      digitalWrite(limitOutPin, LOW);
      blinkState = false;
      pmLimitNotified = false;
      saveCounters();
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
}

// คืน true หนึ่งครั้งเมื่อเกิดขอบขาลง (HIGH -> LOW)
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

// ==================== เซฟค่าลง NVS ====================
void saveCounters() {
  prefs.putLong("ok",    counter1);
  prefs.putLong("ng",    counter2);
  prefs.putLong("ngbox", counter3);
  savedOK = counter1; savedNG = counter2; savedBox = counter3;
}

void saveIfNeeded() {
  if (counter1 == savedOK && counter2 == savedNG && counter3 == savedBox) return;

  bool bigGap = (counter1 - savedOK >= SAVE_EVERY) || (savedOK - counter1 >= SAVE_EVERY);
  bool idle   = (millis() - lastChangeMs >= SAVE_IDLE);

  if (bigGap || idle) {
    saveCounters();
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
// ====================  V2 : เครือข่าย  =======================
// ทุกฟังก์ชันในส่วนนี้รันบน Core 0 (จาก networkTask) เท่านั้น
// ไม่มีอะไรในนี้ถูกเรียกจาก loop() ตรง ๆ ยกเว้นผ่านคิว/flag
// ============================================================

void queueEvent(EventCode e) {
  strncpy(lastEventName, eventName(e), sizeof(lastEventName) - 1);
  lastEventName[sizeof(lastEventName) - 1] = '\0';
  EventCode copy = e;
  xQueueSend(eventQueue, &copy, 0);   // timeout=0 กันไม่ให้ loop() (Core 1) สะดุด
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

String nowISO() {
  time_t now = time(nullptr);
  struct tm tmInfo;
  gmtime_r(&now, &tmInfo);
  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tmInfo);
  return String(buf);
}

void supaPushStatus(float rate) {
  if (WiFi.status() != WL_CONNECTED || !timeSynced) return;

  WiFiClientSecure client;
  client.setInsecure();   // ใช้งานภายในโรงงาน — ถ้าต้องการเข้มขึ้นให้ปักหมุด root CA ของ Supabase
  HTTPClient http;
  http.setTimeout(4000);
  http.begin(client, String(SUPABASE_URL) + "/rest/v1/status?id=eq.1");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Prefer", "return=minimal");

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
  doc["device_seen_at"] = nowISO();

  String body;
  serializeJson(doc, body);
  int code = http.PATCH(body);
  if (code < 200 || code >= 300) {
    Serial.printf("[Supabase] status PATCH ผิดพลาด code=%d\n", code);
  }
  http.end();
}

void supaLogEvent(const char* name) {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(4000);
  http.begin(client, String(SUPABASE_URL) + "/rest/v1/event_log");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<128> doc;
  doc["event"] = name;
  String body;
  serializeJson(doc, body);

  int code = http.POST(body);
  if (code < 200 || code >= 300) {
    Serial.printf("[Supabase] event_log POST ผิดพลาด (%s) code=%d\n", name, code);
  }
  http.end();
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
        HTTPClient httpMark;
        WiFiClientSecure clientMark;
        clientMark.setInsecure();
        httpMark.setTimeout(4000);
        httpMark.begin(clientMark, String(SUPABASE_URL) + "/rest/v1/commands?id=eq." + String(id));
        httpMark.addHeader("apikey", SUPABASE_KEY);
        httpMark.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
        httpMark.addHeader("Content-Type", "application/json");
        httpMark.addHeader("Prefer", "return=minimal");
        httpMark.PATCH("{\"processed\": true}");
        httpMark.end();
      }
    }
  }
  http.end();
}

// งานหลักของ Core 0 — วนอ่านคิว event, ส่ง heartbeat, เช็คคำสั่ง
void networkTask(void* param) {
  unsigned long lastStatusPush = 0, lastCmdPoll = 0, lastRateCalc = millis();
  long lastOkForRate = counter1;
  float currentRate = 0;

  for (;;) {
    ensureWiFi();
    ensureTimeSynced();

    // ส่ง event ที่ค้างอยู่ในคิวทั้งหมด — อ่านจากคิวเท่านั้น ไม่แตะ loop()
    EventCode evt;
    while (xQueueReceive(eventQueue, &evt, 0) == pdTRUE) {
      supaLogEvent(eventName(evt));
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
