# GrowK — Intelligent Hydroponics Agent 🌱🧠

מערכת הידרופונית חכמה המבוססת על Claude AI כמנוע ההחלטות.

## Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────┐
│  Tuya 8-in-1    │────▶│              │────▶│  Claude API  │
│  Water Sensor   │     │   GrowK      │     │  (Analysis)  │
│  (pH/EC/ORP/T)  │     │   Agent      │     │              │
└─────────────────┘     │              │     └──────┬───────┘
                        │  ┌────────┐  │            │
┌─────────────────┐     │  │Safety  │  │◀───────────┘
│  Jebao MD-4.5   │◀────│  │Control │  │  Validated Commands
│  5-ch Doser     │     │  └────────┘  │
│  (Nutrients/pH) │     └──────────────┘
└─────────────────┘
```

## Quick Start

### 1. Clone & Install
```bash
cd growk
pip install -r requirements.txt
```

### 2. Configure
```bash
cp .env.example .env
# Edit .env with your API keys (see Setup Guide below)
```

### 3. Test with Mock Devices
```bash
python main.py --mock --once    # Single cycle, no hardware
python main.py --mock           # Continuous loop, no hardware
```

### 4. Run with Real Hardware
```bash
python main.py                  # Continuous monitoring + dosing
python main.py --once           # Single analysis cycle
```

## Setup Guide

### Tuya Sensor Setup
1. Install Tuya Smart app, create account, add your PH-W218 sensor
2. Go to https://platform.tuya.com → Create Cloud Project
3. Select "Smart Home" scenario, Data Center = EU
4. Under "Link Tuya App Account" — link your phone app account
5. Copy Access ID and Access Secret to .env
6. Find your device ID in Devices tab → copy to .env

### Jebao Doser Setup
1. Install Jebao Aqua app, create account, add your doser
2. Use same email/password in .env
3. The Gizwits App ID is pre-configured (extracted from Jebao Aqua APK)

### Claude API
1. Go to https://console.anthropic.com
2. Create API key → copy to .env

## Project Structure

```
growk/
├── main.py                 # Entry point & main loop
├── config.py               # Configuration from .env
├── devices/
│   ├── base.py             # Abstract interfaces (SensorDevice, DoserDevice)
│   ├── tuya_sensor.py      # Tuya PH-W218 implementation + MockSensor
│   └── jebao_doser.py      # Jebao MD-4.5 via Gizwits + MockDoser
├── agent/
│   ├── brain.py            # Claude API integration & decision engine
│   ├── prompt_engine.py    # Context builder (the secret sauce)
│   └── safety.py           # Hard safety limits (overrides AI)
├── data/
│   └── store.py            # SQLite storage for readings & actions
├── .env.example            # Configuration template
└── requirements.txt
```

## Key Design Principles

**Device Agnostic**: All hardware talks through abstract interfaces.
Swap Tuya for Atlas Scientific? Change one file, agent doesn't notice.

**Safety First**: The SafetyController has hard limits that the AI cannot
override. pH below 4.5? All dosing blocked. Period.

**AI as Advisor, Not Dictator**: Every AI recommendation goes through
safety validation. The AI explains its reasoning — transparency is a feature.

**Graceful Degradation**: If Claude API is down, the system maintains
current state and alerts the grower. No internet ≠ dead plants.

## Channel Mapping (Default)

| Physical Pump | Logical Channel | Solution |
|:---:|:---:|:---:|
| 1 | nutrient_a | Nutrient A (grow) |
| 2 | nutrient_b | Nutrient B (bloom) |
| 3 | ph_down | pH Down (phosphoric acid) |
| 4 | ph_up | pH Up (potassium hydroxide) |
| 5 | supplement | Cal-Mag / supplement |

## Safety Limits (Default)

| Parameter | Min | Max |
|:---:|:---:|:---:|
| pH | 4.5 | 8.0 |
| EC | 100 μS/cm | 3500 μS/cm |
| Water Temp | 5°C | 35°C |
| Single Dose | — | 50 ml |
| Hourly Dose/Channel | — | 150 ml |
| Min Dose Interval | 120 sec | — |
