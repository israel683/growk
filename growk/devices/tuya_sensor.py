"""
Tuya 8-in-1 Water Quality Sensor (PH-W218 / "WiFi smart online 8 in 1 tester")
Connects via Tuya Cloud "Thing" model API (v2.0).

Setup:
1. Create account at https://platform.tuya.com
2. Create a Cloud Project (Smart Home, Central Europe data center)
3. Link your Tuya Smart app account under "Link Tuya App Account" (QR scan)
4. Get Access ID and Access Secret from project overview
5. Find your device ID in the Devices tab
"""
import logging
from datetime import datetime
from typing import Optional

from devices.base import SensorDevice, WaterReading

logger = logging.getLogger("growk.tuya_sensor")


# Mapping: Tuya DP code → (WaterReading attr, scale_divisor, friendly_name)
# Scales verified against the live PH-W218 Thing model on 2026-05-07:
#   temp_current      scale=1 → /10   (°C)
#   ph_current        scale=2 → /100  (pH)
#   tds_current       scale=0 → /1    (ms/cm, device's reported unit)
#   ec_current        scale=0 → /1    (μS/cm)
#   salinity_current  scale=0 → /1    (PPM)
#   pro_current       scale=3 → /1000 (S.G. — Tuya's "pro" = specific gravity)
#   orp_current       scale=0 → /1    (mV; signed)
#   cf_current        scale=2 → /100  (CF)
DP_MAPPING = {
    "temp_current":     ("water_temp", 10.0,   "°C"),
    "ph_current":       ("ph",         100.0,  "pH"),
    "tds_current":      ("tds",        1.0,    "ms/cm"),
    "ec_current":       ("ec",         1.0,    "μS/cm"),
    "salinity_current": ("salinity",   1.0,    "PPM"),
    "pro_current":      ("sg",         1000.0, "S.G."),
    "orp_current":      ("orp",        1.0,    "mV"),
    "cf_current":       ("cf",         100.0,  "CF"),
}


class TuyaSensor(SensorDevice):
    """Tuya PH-W218 8-in-1 water quality sensor via Thing model API."""

    def __init__(self, access_id: str, access_secret: str,
                 device_id: str, api_endpoint: str):
        self._access_id = access_id
        self._access_secret = access_secret
        self._device_id = device_id
        self._api_endpoint = api_endpoint
        self._api = None
        self._connected = False
        self._last_online: Optional[bool] = None

    @property
    def name(self) -> str:
        return "Tuya PH-W218 8-in-1 Sensor"

    @property
    def is_connected(self) -> bool:
        return self._connected

    def capabilities(self) -> list[str]:
        return ["ph", "ec", "orp", "tds", "cf", "salinity", "sg", "water_temp"]

    async def connect(self) -> bool:
        try:
            from tuya_connector import TuyaOpenAPI
            self._api = TuyaOpenAPI(self._api_endpoint, self._access_id, self._access_secret)
            response = self._api.connect()
            if response.get("success", False):
                self._connected = True
                logger.info("Connected to Tuya Cloud (Thing API)")
                return True
            logger.error(f"Tuya connection failed: {response}")
            return False
        except ImportError:
            logger.error("tuya-connector-python not installed: pip install tuya-connector-python")
            return False
        except Exception as e:
            logger.error(f"Tuya connection error: {e}")
            return False

    async def read(self) -> WaterReading:
        if not self._connected or not self._api:
            raise ConnectionError("Tuya sensor not connected")

        # Check online state. Shadow always returns last-known values, but if
        # the device is offline, the readings may be stale.
        try:
            info = self._api.get(f"/v1.0/devices/{self._device_id}")
            online = bool(info.get("result", {}).get("online", False))
            if online != self._last_online:
                logger.info(f"Device online: {online}")
                self._last_online = online
            if not online:
                logger.warning("Device offline — readings reflect last cloud-shadow values")
        except Exception as e:
            logger.warning(f"Could not query device online status: {e}")

        try:
            response = self._api.get(
                f"/v2.0/cloud/thing/{self._device_id}/shadow/properties"
            )
            if not response.get("success"):
                raise Exception(f"Thing API failed: {response}")

            reading = WaterReading(
                timestamp=datetime.now(),
                source="tuya_ph_w218"
            )

            properties = response.get("result", {}).get("properties", [])
            for prop in properties:
                code = prop.get("code", "")
                value = prop.get("value")
                if value is None:
                    continue

                mapping = DP_MAPPING.get(code)
                if mapping is None:
                    continue  # warning thresholds and similar non-data DPs

                attr, scale, _unit = mapping
                try:
                    scaled = float(value) / scale
                except (TypeError, ValueError):
                    logger.warning(f"Could not parse {code}={value!r}")
                    continue

                # Skip zero readings on probes that should never be exactly 0 in
                # real solution (EC, TDS, salinity, CF). pH and ORP can legitimately
                # be near-zero or signed; let those through. S.G. of pure water is
                # ~1.000, so 0 means probe not reporting.
                if attr in ("ec", "tds", "salinity", "cf") and scaled == 0.0:
                    continue
                if attr == "sg" and scaled < 0.5:
                    continue

                setattr(reading, attr, scaled)

            logger.debug(f"Sensor reading: {reading.summary()}")
            return reading

        except Exception as e:
            logger.error(f"Error reading Tuya sensor: {e}")
            raise

    async def disconnect(self):
        self._connected = False
        self._api = None


class MockSensor(SensorDevice):
    """Mock sensor for development. Generates realistic readings with drift."""

    def __init__(self):
        self._connected = False
        self._base_ph = 6.0
        self._base_ec = 1200.0

    @property
    def name(self) -> str:
        return "Mock Sensor (Development)"

    @property
    def is_connected(self) -> bool:
        return self._connected

    def capabilities(self) -> list[str]:
        return ["ph", "ec", "tds", "orp", "water_temp"]

    async def connect(self) -> bool:
        self._connected = True
        logger.info("Mock sensor connected")
        return True

    async def read(self) -> WaterReading:
        import random
        # pH tends to drift down over time; EC drops as plants consume nutrients.
        self._base_ph += random.uniform(-0.05, 0.03)
        self._base_ec += random.uniform(-20, 15)

        return WaterReading(
            timestamp=datetime.now(),
            ph=round(max(4.0, min(9.0, self._base_ph + random.uniform(-0.1, 0.1))), 2),
            ec=round(max(200, min(3000, self._base_ec + random.uniform(-30, 30))), 0),
            tds=round(max(100, min(1500, self._base_ec * 0.5)), 0),
            orp=round(random.uniform(200, 400), 0),
            water_temp=round(random.uniform(22, 28), 1),
            source="mock"
        )
