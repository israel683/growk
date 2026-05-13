"""
GrowK Device Abstraction Layer

This is the core of GrowK's device-agnostic design.
All sensors and actuators implement these interfaces.
The AI agent never talks to hardware directly — only through these abstractions.
Tomorrow you can swap Tuya for Atlas Scientific, and the agent won't know the difference.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional


# === Data Models ===

@dataclass
class WaterReading:
    """Normalized water quality reading from any sensor."""
    timestamp: datetime
    ph: Optional[float] = None
    ec: Optional[float] = None          # μS/cm
    tds: Optional[float] = None         # ppm
    orp: Optional[float] = None         # mV
    water_temp: Optional[float] = None  # °C
    cf: Optional[float] = None
    salinity: Optional[float] = None    # ppt
    sg: Optional[float] = None          # specific gravity
    source: str = "unknown"

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if v is not None}

    def summary(self) -> str:
        """Human-readable summary for the LLM context."""
        parts = []
        if self.ph is not None:
            parts.append(f"pH={self.ph:.2f}")
        if self.ec is not None:
            parts.append(f"EC={self.ec:.0f}μS/cm")
        if self.tds is not None:
            parts.append(f"TDS={self.tds:.0f}ppm")
        if self.orp is not None:
            parts.append(f"ORP={self.orp:.0f}mV")
        if self.water_temp is not None:
            parts.append(f"Water={self.water_temp:.1f}°C")
        return " | ".join(parts) if parts else "No data"


class DoserChannel(Enum):
    """Logical channel mapping for dosing pumps."""
    NUTRIENT_A = "nutrient_a"
    NUTRIENT_B = "nutrient_b"
    PH_UP = "ph_up"
    PH_DOWN = "ph_down"
    SUPPLEMENT = "supplement"


@dataclass
class DosingCommand:
    """A command to dose a specific amount through a channel."""
    channel: DoserChannel
    amount_ml: float
    reason: str = ""              # Why the AI decided to dose
    confidence: float = 1.0       # 0-1, how confident the AI is

    def __str__(self):
        return f"Dose {self.amount_ml:.1f}ml of {self.channel.value} ({self.reason})"


@dataclass
class DosingResult:
    """Result of a dosing operation."""
    success: bool
    channel: DoserChannel
    amount_ml: float
    actual_ml: Optional[float] = None  # If pump reports actual amount
    error: Optional[str] = None
    timestamp: datetime = field(default_factory=datetime.now)


# === Abstract Interfaces ===

class SensorDevice(ABC):
    """Interface for any water quality sensor."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable device name."""

    @property
    @abstractmethod
    def is_connected(self) -> bool:
        """Whether the device is reachable."""

    @abstractmethod
    async def read(self) -> WaterReading:
        """Read current water quality parameters."""

    @abstractmethod
    async def connect(self) -> bool:
        """Establish connection to the device."""

    async def disconnect(self):
        """Clean up connection."""
        pass

    @abstractmethod
    def capabilities(self) -> list[str]:
        """List of parameters this sensor can measure (e.g., ['ph', 'ec', 'temp'])."""


class DoserDevice(ABC):
    """Interface for any dosing pump system."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable device name."""

    @property
    @abstractmethod
    def is_connected(self) -> bool:
        """Whether the device is reachable."""

    @abstractmethod
    async def connect(self) -> bool:
        """Establish connection to the device."""

    @abstractmethod
    async def dose(self, command: DosingCommand) -> DosingResult:
        """Execute a dosing command."""

    @abstractmethod
    def available_channels(self) -> list[DoserChannel]:
        """List of configured channels on this doser."""

    @abstractmethod
    def channel_mapping(self) -> dict[DoserChannel, int]:
        """Map logical channels to physical pump numbers."""

    async def disconnect(self):
        """Clean up connection."""
        pass


class EnvironmentSensor(ABC):
    """Interface for ambient environment sensors (air temp, humidity, light)."""

    @abstractmethod
    async def read(self) -> dict:
        """Read environment data. Returns dict with available params."""
