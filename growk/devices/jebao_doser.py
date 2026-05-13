"""
Jebao MD-4.5 Dosing Pump Controller (Gizwits Cloud API)

Protocol verified against the chrisc123/jebao_aqua-homeassistant integration
(packet captures from the Jebao Aqua Android app). Key differences from the
generic Gizwits API:
- App ID is specific to the Jebao Aqua Android app: c3703c4888ec4736a3a0d9425c321604
- Login endpoint is /app/smart_home/login/pwd (not /app/login)
- Auth field is X-Gizwits-User-token + appKey body field
- Devices expose per-channel boolean switches (channe1..channeN) — NOT a
  "dose X ml" attribute. We dose by turning a channel on, sleeping for the
  duration calculated from the pump's flow rate, and turning it off.

Region maps:
  EU: euaepapp.gizwits.com / euapi.gizwits.com
  US: usaepapp.gizwits.com / usapi.gizwits.com
  CN: aep-app.gizwits.com  / api.gizwits.com
"""
import asyncio
import logging
import httpx
from typing import Optional

from devices.base import DoserDevice, DoserChannel, DosingCommand, DosingResult

logger = logging.getLogger("growk.jebao_doser")


JEBAO_AQUA_APP_ID = "c3703c4888ec4736a3a0d9425c321604"

REGION_URLS = {
    "eu": {
        "login":  "https://euaepapp.gizwits.com/app/smart_home/login/pwd",
        "bind":   "https://euapi.gizwits.com/app/bindings",
        "control":"https://euapi.gizwits.com/app/control/{device_id}",
    },
    "us": {
        "login":  "https://usaepapp.gizwits.com/app/smart_home/login/pwd",
        "bind":   "https://usapi.gizwits.com/app/bindings",
        "control":"https://usapi.gizwits.com/app/control/{device_id}",
    },
    "cn": {
        "login":  "https://aep-app.gizwits.com/app/smart_home/login/pwd",
        "bind":   "https://api.gizwits.com/app/bindings",
        "control":"https://api.gizwits.com/app/control/{device_id}",
    },
}


class JebaoDoser(DoserDevice):
    """Jebao MD-4.5 dosing pump via Gizwits Cloud API."""

    DEFAULT_CHANNEL_MAP = {
        DoserChannel.NUTRIENT_A: 1,
        DoserChannel.NUTRIENT_B: 2,
        DoserChannel.PH_DOWN: 3,
        DoserChannel.PH_UP: 4,
        DoserChannel.SUPPLEMENT: 5,
    }

    # Spec: 50 ml/min per channel.
    FLOW_RATE_ML_PER_MIN = 50.0

    def __init__(self, username: str, password: str,
                 app_id: Optional[str] = None,
                 region: str = "eu",
                 channel_map: Optional[dict] = None):
        # app_id arg kept for backward compat but ignored — Jebao Aqua app
        # has a specific app_id, no point letting it be overridden by stale .env.
        self._username = username
        self._password = password
        self._region = region if region in REGION_URLS else "eu"
        self._urls = REGION_URLS[self._region]
        self._channel_map = channel_map or self.DEFAULT_CHANNEL_MAP
        self._token: Optional[str] = None
        self._device_id: Optional[str] = None
        self._product_key: Optional[str] = None
        self._connected = False
        self._client = httpx.AsyncClient(timeout=15)

    @property
    def name(self) -> str:
        return "Jebao MD-4.5 Doser (5-channel)"

    @property
    def is_connected(self) -> bool:
        return self._connected

    def available_channels(self) -> list[DoserChannel]:
        return list(self._channel_map.keys())

    def channel_mapping(self) -> dict[DoserChannel, int]:
        return self._channel_map.copy()

    def _headers(self, include_token: bool = True) -> dict:
        h = {
            "X-Gizwits-Application-Id": JEBAO_AQUA_APP_ID,
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if include_token and self._token:
            h["X-Gizwits-User-token"] = self._token
        return h

    async def _login(self, region: str) -> Optional[str]:
        """Try login on a given region. Returns userToken or None."""
        urls = REGION_URLS[region]
        body = {
            "appKey": JEBAO_AQUA_APP_ID,
            "data": {
                "account": self._username,
                "password": self._password,
                "lang": "en",
                "refreshToken": True,
            },
            "version": "1.0",
        }
        try:
            r = await self._client.post(urls["login"], json=body, headers={
                "X-Gizwits-Application-Id": JEBAO_AQUA_APP_ID,
                "Content-Type": "application/json",
            })
            data = r.json()
            if data.get("error"):
                logger.warning(f"Jebao login [{region}] error: {data}")
                return None
            token = (data.get("data") or {}).get("userToken")
            if token:
                logger.info(f"Jebao login OK on region={region}")
                return token
            logger.warning(f"Jebao login [{region}] no userToken: {data}")
            return None
        except Exception as e:
            logger.warning(f"Jebao login [{region}] exception: {e}")
            return None

    async def connect(self) -> bool:
        # Try the configured region first, then fall back to the others.
        # Israeli accounts are sometimes on EU, sometimes on US; cheap to try both.
        regions_to_try = [self._region] + [r for r in REGION_URLS if r != self._region]
        token = None
        used_region = None
        for region in regions_to_try:
            token = await self._login(region)
            if token:
                used_region = region
                break
        if not token:
            logger.error("Jebao login failed on all regions")
            return False

        self._token = token
        self._region = used_region
        self._urls = REGION_URLS[used_region]

        try:
            r = await self._client.get(self._urls["bind"], headers=self._headers())
            data = r.json()
            devices = data.get("devices", [])
            if not devices:
                logger.warning("No Jebao devices bound to this account")
                return False
            # Pick the first device. If multiple, we'd want to filter by product_key
            # for MD-4.x family. TODO when there's >1 doser.
            d = devices[0]
            self._device_id = d.get("did")
            self._product_key = d.get("product_key")
            logger.info(f"Jebao device: did={self._device_id} "
                        f"product_key={self._product_key} name={d.get('dev_alias') or d.get('product_name')}")
            self._connected = True
            return True
        except Exception as e:
            logger.error(f"Jebao bindings fetch error: {e}")
            return False

    async def _set_channel(self, physical_channel: int, on: bool) -> bool:
        """Toggle a channel switch (channe1..channe5) via Gizwits control."""
        attr_name = f"channe{physical_channel}"
        url = self._urls["control"].format(device_id=self._device_id)
        body = {"attrs": {attr_name: on}}
        try:
            r = await self._client.post(url, json=body, headers=self._headers())
            if r.status_code == 200:
                logger.debug(f"Channel {physical_channel} → {'ON' if on else 'OFF'}")
                return True
            logger.error(f"Control failed {r.status_code}: {r.text}")
            return False
        except Exception as e:
            logger.error(f"Control exception: {e}")
            return False

    async def dose(self, command: DosingCommand) -> DosingResult:
        if not self._connected:
            return DosingResult(
                success=False, channel=command.channel,
                amount_ml=command.amount_ml, error="Not connected"
            )

        physical = self._channel_map.get(command.channel)
        if physical is None:
            return DosingResult(
                success=False, channel=command.channel,
                amount_ml=command.amount_ml,
                error=f"Channel {command.channel} not mapped"
            )

        runtime_seconds = (command.amount_ml / self.FLOW_RATE_ML_PER_MIN) * 60.0
        logger.info(
            f"Dosing {command.amount_ml}ml on channel {physical} "
            f"({command.channel.value}) — runtime {runtime_seconds:.2f}s · {command.reason}"
        )

        on_ok = await self._set_channel(physical, True)
        if not on_ok:
            return DosingResult(
                success=False, channel=command.channel,
                amount_ml=command.amount_ml, error="Failed to switch ON"
            )

        try:
            await asyncio.sleep(runtime_seconds)
        finally:
            # Always attempt to switch off, even if sleep was interrupted.
            off_ok = await self._set_channel(physical, False)
            if not off_ok:
                logger.error("CRITICAL: pump may still be running — switch OFF failed")
                return DosingResult(
                    success=False, channel=command.channel,
                    amount_ml=command.amount_ml,
                    error="Switch OFF failed — pump may be stuck on"
                )

        return DosingResult(
            success=True, channel=command.channel, amount_ml=command.amount_ml
        )

    async def disconnect(self):
        self._connected = False
        await self._client.aclose()


class MockDoser(DoserDevice):
    """Mock doser for development. Logs commands without hardware."""

    def __init__(self):
        self._connected = False
        self._dose_log: list[DosingResult] = []

    @property
    def name(self) -> str:
        return "Mock Doser (Development)"

    @property
    def is_connected(self) -> bool:
        return self._connected

    def available_channels(self) -> list[DoserChannel]:
        return list(DoserChannel)

    def channel_mapping(self) -> dict[DoserChannel, int]:
        return {ch: i + 1 for i, ch in enumerate(DoserChannel)}

    async def connect(self) -> bool:
        self._connected = True
        logger.info("Mock doser connected")
        return True

    async def dose(self, command: DosingCommand) -> DosingResult:
        logger.info(f"[MOCK] {command}")
        result = DosingResult(
            success=True, channel=command.channel,
            amount_ml=command.amount_ml
        )
        self._dose_log.append(result)
        return result
