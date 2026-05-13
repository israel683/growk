# GrowK — Architecture

מסמך תיעוד הארכיטקטורה. עודכן 2026-05-07.

## 1. תרשים מערכת (Mermaid)

```mermaid
flowchart TB
    %% ===== Physical / Hardware =====
    subgraph PHYS["🌱 Physical (Tel Aviv, outdoor)"]
        sensor[("Tuya PH-W218<br/>8-in-1 sensor")]
        doser[("Jebao MD-4.5<br/>5-channel doser")]
        reservoir[("60L reservoir<br/>+ float valve")]
        nft[("NFT pipes<br/>wall-mounted")]
        sensor -.measures.-> reservoir
        doser -.injects.-> reservoir
        reservoir -.feeds.-> nft
    end

    %% ===== Cloud APIs =====
    subgraph CLOUD["☁️ Third-party Cloud APIs"]
        tuyacloud["Tuya Cloud<br/>openapi.tuyaeu.com<br/>Thing API v2.0"]
        gizwits["Gizwits Cloud<br/>usapi.gizwits.com<br/>Jebao Aqua app_id"]
        claude["Anthropic API<br/>Claude Sonnet 4.6<br/>+ 1h prompt cache"]
        sensor -.WiFi.-> tuyacloud
        doser -.WiFi.-> gizwits
    end

    %% ===== Agent Core (Python) =====
    subgraph AGENT["🐍 GrowK Agent (Python · Railway in prod)"]
        direction TB

        subgraph DEVICES["devices/ — abstraction layer"]
            sensorbase["base.SensorDevice<br/>(ABC)"]
            doserbase["base.DoserDevice<br/>(ABC)"]
            tuyaimpl["tuya_sensor.TuyaSensor"]
            jebaoimpl["jebao_doser.JebaoDoser"]
            tuyaimpl --> sensorbase
            jebaoimpl --> doserbase
        end

        subgraph BRAIN["agent/ — intelligence"]
            prompt["prompt_engine.py<br/>SYSTEM_PROMPT (cached)<br/>+ windowed stats<br/>(5min/1h/6h/24h)"]
            brainpy["brain.GrowKBrain<br/>analyze_and_decide()"]
            safety["safety.SafetyController<br/>8 hard limits<br/>(pH, EC, temp, dose, rate)"]
            prompt --> brainpy
            brainpy -.validates via.-> safety
        end

        store[("data/store.py<br/>SQLite (POC)<br/>→ Neon Postgres (prod)<br/><br/>tables:<br/>sensor_readings<br/>dosing_actions<br/>ai_decisions<br/>human_tasks")]

        loop["main.GrowKAgent<br/>run_loop():<br/>• sensor poll every 30s<br/>• AI cycle hourly<br/>• respects next_check_minutes"]

        api["api/server.py<br/>FastAPI · :8765<br/><br/>GET /state<br/>GET /readings<br/>GET /decisions<br/>GET /tasks<br/>POST /tasks/:id/complete<br/>POST /tasks/:id/dismiss"]
    end

    %% ===== UI =====
    subgraph UI["🖥️ Dashboard (Next.js · Vercel in prod)"]
        nav["Nav (RTL/Hebrew)"]
        dash["/ — סקירה<br/>metrics + chart + tasks"]
        dec["/decisions — לוג מלא"]
        chart["SensorChart<br/>(recharts)"]
        apilib["lib/api.ts"]
        nav --> dash
        nav --> dec
        dash --> chart
        dash --> apilib
        dec --> apilib
    end

    %% ===== Connections =====
    tuyacloud -- "Thing API<br/>shadow/properties" --> tuyaimpl
    jebaoimpl -- "channe1..5<br/>switch+sleep" --> gizwits
    brainpy -- "messages.create<br/>cache_control 1h" --> claude

    sensorbase --> loop
    doserbase --> loop
    loop --> store
    loop --> brainpy
    loop -. shared instance .- api
    api --> store

    apilib -- "fetch JSON<br/>(NEXT_PUBLIC_API_URL)" --> api

    %% ===== Styling =====
    classDef physColor fill:#e0f2fe,stroke:#0369a1,stroke-width:1px,color:#0c4a6e
    classDef cloudColor fill:#fef3c7,stroke:#a16207,stroke-width:1px,color:#713f12
    classDef agentColor fill:#dcfce7,stroke:#15803d,stroke-width:1px,color:#14532d
    classDef uiColor fill:#fce7f3,stroke:#a21caf,stroke-width:1px,color:#701a75
    classDef storeColor fill:#fff,stroke:#52525b,stroke-width:2px

    class PHYS,sensor,doser,reservoir,nft physColor
    class CLOUD,tuyacloud,gizwits,claude cloudColor
    class AGENT,DEVICES,BRAIN,sensorbase,doserbase,tuyaimpl,jebaoimpl,prompt,brainpy,safety,loop,api agentColor
    class UI,nav,dash,dec,chart,apilib uiColor
    class store storeColor
```

## 2. מחזור החלטה (Sequence)

```mermaid
sequenceDiagram
    autonumber
    participant L as main.run_loop
    participant T as TuyaSensor
    participant DB as DataStore
    participant P as prompt_engine
    participant B as GrowKBrain
    participant C as Claude API
    participant S as SafetyController
    participant J as JebaoDoser

    Note over L: every 30s — sensor poll
    L->>T: read()
    T-->>L: WaterReading
    L->>DB: save_reading()

    Note over L: every ~1h — AI cycle
    L->>DB: get_recent_readings(24h)
    L->>DB: get_pending_tasks()
    L->>P: build_analysis_prompt()<br/>+ windowed stats (5m/1h/6h/24h)
    P-->>L: user_prompt (~500 tokens)
    L->>B: analyze_and_decide()
    B->>C: messages.create<br/>system=[cached SYSTEM_PROMPT]<br/>messages=[user_prompt]
    C-->>B: JSON {analysis, actions[], human_tasks_to_create[], status, next_check_minutes}
    B->>B: parse + dedupe tasks

    loop for each proposed action
        B->>S: validate_command(cmd, current_reading)
        alt safe
            S-->>B: (true, "OK")
            B-->>L: approved
            L->>J: dose(command)
            J->>J: switch ON → sleep(ml/50*60s) → switch OFF
            J-->>L: DosingResult
            L->>S: record_dose()
        else blocked
            S-->>B: (false, reason)
            B-->>L: blocked + reason
        end
    end

    L->>DB: save_decision() + create_human_task() per task
    L->>L: schedule next cycle = clamp(next_check_minutes, 5–360 min)
```

## 3. הארכיטקטורה ב-4 שכבות

| # | שכבה | אחריות | מודולים |
|---|---|---|---|
| 1 | **Hardware abstraction** | מסך כל חיישן/אקטואטור מאחורי ABCs. אפשר להחליף Tuya ל-Atlas Scientific מבלי לגעת בלוגיקה. | `devices/base.py`, `devices/tuya_sensor.py`, `devices/jebao_doser.py` |
| 2 | **Safety** | gate אחרון לפני כל פעולה פיזית. גבולות קשיחים שה-AI לא יכול לעקוף. רץ מקומית, אין צורך באינטרנט. | `agent/safety.py` (`SafetyController`, `SafetyLimits`) |
| 3 | **AI Brain** | בונה prompt עשיר עם חלונות סטטיסטיים, שולח ל-Claude (cached), מפענח JSON, מעביר דרך safety, יוצר Human Tasks עם dedup. | `agent/brain.py`, `agent/prompt_engine.py` |
| 4 | **UI / API** | חשיפה ל-grower: dashboard עברית, גרפים, היסטוריה, אישור משימות. | `api/server.py` (FastAPI) + `web/` (Next.js + recharts) |

**+ Human Task Queue (חוצה שכבות):** האייג'נט יוצר tasks עבור המשתמש כשפעולה נדרשת מחוץ ליכולת שלו (החלפת מים, אישור מינון, ריסט, שאלות, פעולה ידנית). Dedup ב-brain, persistence ב-store, חשיפה ב-UI.

## 4. מודל הנתונים

```mermaid
erDiagram
    sensor_readings ||--o{ ai_decisions : "context for"
    ai_decisions ||--o{ dosing_actions : "produced"
    ai_decisions ||--o{ human_tasks : "produced"

    sensor_readings {
        int id PK
        text system_id
        text timestamp
        real ph
        real ec
        real tds
        real orp
        real water_temp
        real cf
        real salinity
        real sg
        text source
    }
    ai_decisions {
        int id PK
        text system_id
        text timestamp
        text status
        text analysis
        text message
        text raw_response
        int tokens_input
        int tokens_output
        int cache_creation_tokens
        int cache_read_tokens
    }
    dosing_actions {
        int id PK
        text system_id
        text timestamp
        text channel
        real amount_ml
        text reason
        int success
        int decision_id FK
    }
    human_tasks {
        int id PK
        text system_id
        text created_at
        text type
        text priority
        text title
        text reason
        text payload
        text status
        text expires_at
        int decision_id FK
    }
```

`system_id` נמצא בכל טבלה מההתחלה — מאפשר הרחבה ל-3+ מערכות בלי מיגרציה.

## 5. תזרים מידע — תרחישי ליבה

### תרחיש: קריאת חיישן רגילה (כל 30 שניות)
```
Sensor → Tuya Cloud → tuya_sensor.read() → WaterReading → store.save_reading()
```
תוצאה: שורה חדשה ב-`sensor_readings`. UI מציג עדכון בכרטיסים תוך 5 שניות (interval של ה-dashboard).

### תרחיש: מחזור החלטה (כל ~1 שעה)
```
loop → store.get_recent_readings(24h)
     → prompt_engine.build_metric_table() → windowed stats
     → brain.analyze_and_decide()
     → Claude API (cache hit ~80% מהזמן)
     → JSON {actions, human_tasks_to_create, status, next_check_minutes}
     → safety.validate_command() per action (filter)
     → doser.dose(approved)
     → store.save_decision() + save_action() + create_human_task()
```
תוצאה: ai_decisions row, אולי dosing_actions, אולי human_tasks. UI מציג message חדש ב-dashboard, decision חדש ב-`/decisions`.

### תרחיש: השלמת משימה אנושית
```
UI button → POST /api/tasks/:id/complete → store.complete_task() → status='done'
```
המחזור הבא של ה-AI יראה שהמשימה לא pending — לא יווצר duplicate.

## 6. Deployment topology (מתוכנן)

```mermaid
flowchart LR
    user[👤 grower<br/>browser]

    subgraph V["Vercel"]
        nextjs[Next.js<br/>web/]
    end

    subgraph R["Railway"]
        agentbox[Python agent<br/>main.py + api/server.py<br/>FastAPI :PORT]
    end

    subgraph N["Neon"]
        pg[(Postgres<br/>main branch)]
        pgdev[(dev branch)]
    end

    subgraph EXT["Third-party clouds"]
        tuya[Tuya Cloud]
        gw[Gizwits Cloud]
        ant[Anthropic API]
    end

    user -- HTTPS --> nextjs
    nextjs -- HTTPS<br/>+ Bearer token --> agentbox
    agentbox -- TCP --> pg
    agentbox -- HTTPS --> tuya
    agentbox -- HTTPS --> gw
    agentbox -- HTTPS --> ant

    classDef ext fill:#fef3c7,stroke:#a16207
    class EXT,tuya,gw,ant ext
```

**Network boundaries:**
- Browser ↔ Vercel: HTTPS
- Vercel ↔ Railway: HTTPS + bearer token (`GROWK_API_TOKEN`)
- Railway ↔ Neon: TCP/SSL via `DATABASE_URL`
- Railway ↔ third-party clouds: outbound HTTPS

## 7. עקרונות מפתח

1. **Plug-and-play hardware:** brain אינו יודע על Tuya/Jebao. החלפת מכשיר = שינוי קובץ אחד תחת `devices/`.
2. **Safety isolated from intelligence:** AI מציע, Safety אוכף. גם אם Claude נופל ב-API שגוי, שכבת ה-safety מקומית וחוסמת.
3. **Decisions are observational, not reactive:** דגימה כל 30s, החלטה כל ~1h. cross-window agreement נדרש לפעולה.
4. **Cache-aware prompt design:** SYSTEM_PROMPT (~3.7K tokens) cached 1h TTL → ~10× חיסכון בעלות בקריאות חוזרות.
5. **Human-in-the-loop optional, not blocking:** האייג'נט אוטונומי. Tasks למשתמש רק כשנדרש (החלפת מים, אישור חריג, ריסט, שאלת הבהרה).
6. **Multi-system ready by design:** `system_id` בכל שורת DB מההתחלה.
