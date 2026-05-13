"""
GrowK Safety Controller

This is the LAST LINE OF DEFENSE before any command reaches hardware.
It runs locally, requires no internet, and cannot be overridden by the AI.

Every dosing command passes through here. If it violates safety limits,
it gets blocked — period. The AI can be creative, but never dangerous.
"""
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

from devices.base import WaterReading, DosingCommand, DoserChannel

logger = logging.getLogger("growk.safety")


@dataclass
class SafetyLimits:
    """Hard safety boundaries. These are NOT negotiable."""

    # pH absolute bounds — outside this range, block ALL dosing
    ph_min: float = 4.5
    ph_max: float = 8.0

    # pH target range — normal operating range
    ph_target_min: float = 5.5
    ph_target_max: float = 6.5

    # EC bounds (μS/cm)
    ec_min: float = 100
    ec_max: float = 3500

    # Water temperature bounds (°C)
    water_temp_min: float = 5.0
    water_temp_max: float = 35.0

    # Maximum dosing per command (ml)
    max_single_dose_ml: float = 50.0

    # Maximum total dosing per hour per channel (ml)
    max_hourly_dose_ml: float = 150.0

    # Minimum time between doses on same channel (seconds)
    min_dose_interval_seconds: int = 120

    # If no sensor reading for this long, block all dosing (seconds)
    max_sensor_age_seconds: int = 300


class SafetyController:
    """
    Validates every command before execution.
    Keeps a log of recent doses for rate limiting.
    """

    def __init__(self, limits: Optional[SafetyLimits] = None):
        self.limits = limits or SafetyLimits()
        self._dose_history: list[tuple[datetime, DoserChannel, float]] = []

    def validate_command(
        self, command: DosingCommand, current_reading: Optional[WaterReading]
    ) -> tuple[bool, str]:
        """
        Validate a dosing command against safety limits.

        Returns: (is_safe, reason)
        - (True, "OK") if command is safe to execute
        - (False, "reason") if command should be blocked
        """
        # Check 1: Sensor freshness
        if current_reading is None:
            return False, "No sensor reading available — refusing to dose blind"

        age = (datetime.now() - current_reading.timestamp).total_seconds()
        if age > self.limits.max_sensor_age_seconds:
            return False, f"Sensor reading is {age:.0f}s old (max {self.limits.max_sensor_age_seconds}s)"

        # Check 2: pH absolute bounds
        if current_reading.ph is not None:
            if current_reading.ph < self.limits.ph_min:
                if command.channel != DoserChannel.PH_UP:
                    return False, f"pH={current_reading.ph:.2f} is critically low — only pH Up allowed"
            if current_reading.ph > self.limits.ph_max:
                if command.channel != DoserChannel.PH_DOWN:
                    return False, f"pH={current_reading.ph:.2f} is critically high — only pH Down allowed"

        # Check 3: EC bounds
        if current_reading.ec is not None:
            if current_reading.ec > self.limits.ec_max:
                if command.channel in (DoserChannel.NUTRIENT_A, DoserChannel.NUTRIENT_B):
                    return False, f"EC={current_reading.ec:.0f} exceeds max — blocking nutrient dose"

        # Check 4: Water temperature
        if current_reading.water_temp is not None:
            if current_reading.water_temp > self.limits.water_temp_max:
                return False, f"Water temp={current_reading.water_temp:.1f}°C too high — blocking all dosing"
            if current_reading.water_temp < self.limits.water_temp_min:
                return False, f"Water temp={current_reading.water_temp:.1f}°C too low — blocking all dosing"

        # Check 5: Single dose limit
        if command.amount_ml > self.limits.max_single_dose_ml:
            return False, f"Dose {command.amount_ml}ml exceeds max single dose ({self.limits.max_single_dose_ml}ml)"

        # Check 6: Negative or zero dose
        if command.amount_ml <= 0:
            return False, f"Invalid dose amount: {command.amount_ml}ml"

        # Check 7: Hourly rate limit per channel
        self._prune_old_history()
        one_hour_ago = datetime.now() - timedelta(hours=1)
        hourly_total = sum(
            ml for ts, ch, ml in self._dose_history
            if ch == command.channel and ts > one_hour_ago
        )
        if hourly_total + command.amount_ml > self.limits.max_hourly_dose_ml:
            return False, (
                f"Hourly limit: already dosed {hourly_total:.1f}ml on {command.channel.value} "
                f"(max {self.limits.max_hourly_dose_ml}ml/hr)"
            )

        # Check 8: Minimum interval between doses
        recent = [
            ts for ts, ch, _ in self._dose_history
            if ch == command.channel
        ]
        if recent:
            last_dose = max(recent)
            elapsed = (datetime.now() - last_dose).total_seconds()
            if elapsed < self.limits.min_dose_interval_seconds:
                return False, (
                    f"Too soon: last dose on {command.channel.value} was {elapsed:.0f}s ago "
                    f"(min {self.limits.min_dose_interval_seconds}s)"
                )

        return True, "OK"

    def record_dose(self, channel: DoserChannel, amount_ml: float):
        """Record a successful dose for rate limiting."""
        self._dose_history.append((datetime.now(), channel, amount_ml))

    def _prune_old_history(self):
        """Remove dose records older than 2 hours."""
        cutoff = datetime.now() - timedelta(hours=2)
        self._dose_history = [
            (ts, ch, ml) for ts, ch, ml in self._dose_history if ts > cutoff
        ]

    def emergency_stop(self) -> str:
        """Called when things go very wrong. Returns status message."""
        logger.critical("EMERGENCY STOP triggered")
        return "Emergency stop — all dosing halted. Manual intervention required."
