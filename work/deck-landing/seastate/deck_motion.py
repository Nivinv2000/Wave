"""Shared ship-deck motion truth model.

This is a direct port of ``work/ocean-flight-lab/public/core/environment.mjs``
(``Ocean``, ``Vessel``, ``Wind``) including its mulberry32 random generator, so a
given ``(seed, preset)`` produces the same deck trajectory in the browser
simulator, in PyBullet training, and in Gazebo.

Everything here is a reduced-order response, not a vessel-calibrated digital
twin: the six-axis periods and damping below are illustrative constants, not
identified from a real hull. See ``work/deck-landing/README.md``.

Frames: world is ENU (x east/forward, y north/left, z up). Quaternions are
(x, y, z, w). Angles are radians, lengths metres, time seconds.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace
from typing import Callable

G = 9.80665

_U32 = 0xFFFFFFFF


def mulberry32(seed: int) -> Callable[[], float]:
    """Exact port of ``rng()`` in math.mjs (mulberry32).

    Kept bit-exact so Python and the JavaScript simulator draw the same wave
    phases and directions for a seed. It operates on unsigned 32-bit patterns,
    which is equivalent to the JavaScript int32 coercions modulo 2**32.
    """
    s = seed & _U32

    def nxt() -> float:
        nonlocal s
        s = (s + 0x6D2B79F5) & _U32
        t = s
        t = ((t ^ (t >> 15)) * (t | 1)) & _U32
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & _U32)) & _U32
        t &= _U32
        return ((t ^ (t >> 14)) & _U32) / 4294967296.0

    return nxt


def gaussian(random: Callable[[], float]) -> Callable[[], float]:
    """Exact port of ``gaussian()`` in math.mjs (Marsaglia polar, cached spare)."""
    spare: float | None = None

    def nxt() -> float:
        nonlocal spare
        if spare is not None:
            v = spare
            spare = None
            return v
        r = math.sqrt(-2.0 * math.log(max(1e-10, random())))
        a = 2.0 * math.pi * random()
        spare = r * math.sin(a)
        return r * math.cos(a)

    return nxt


def clamp(x: float, a: float, b: float) -> float:
    return max(a, min(b, x))


def from_euler(r: float, p: float, y: float) -> tuple[float, float, float, float]:
    """ZYX intrinsic Euler angles to an (x, y, z, w) quaternion."""
    cr, sr = math.cos(r / 2), math.sin(r / 2)
    cp, sp = math.cos(p / 2), math.sin(p / 2)
    cy, sy = math.cos(y / 2), math.sin(y / 2)
    return (
        sr * cp * cy - cr * sp * sy,
        cr * sp * cy + sr * cp * sy,
        cr * cp * sy - sr * sp * cy,
        cr * cp * cy + sr * sp * sy,
    )


def to_euler(q) -> tuple[float, float, float]:
    """(x, y, z, w) quaternion to ZYX roll, pitch, yaw."""
    x, y, z, w = q
    return (
        math.atan2(2.0 * (w * x + y * z), 1.0 - 2.0 * (x * x + y * y)),
        math.asin(clamp(2.0 * (w * y - z * x), -1.0, 1.0)),
        math.atan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z)),
    )


def rotate(q, v):
    """Rotate vector v by quaternion q given as (x, y, z, w)."""
    ax, ay, az, aw = q
    tx = 2.0 * (ay * v[2] - az * v[1])
    ty = 2.0 * (az * v[0] - ax * v[2])
    tz = 2.0 * (ax * v[1] - ay * v[0])
    return (
        v[0] + aw * tx + (ay * tz - az * ty),
        v[1] + aw * ty + (az * tx - ax * tz),
        v[2] + aw * tz + (ax * ty - ay * tx),
    )


def cross(a, b):
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


# --------------------------------------------------------------------------
# Weather presets, mirrored from the PRESETS table in environment.mjs.
# --------------------------------------------------------------------------

PRESETS: dict[str, dict] = {
    "light": dict(hs=0.35, tp=4.5, wind=2.5, gust=0.7, current=0.15, gamma=3.3),
    "medium": dict(hs=1.3, tp=6.5, wind=7.0, gust=2.0, current=0.4, gamma=3.3),
    "swell": dict(hs=2.0, tp=13.0, wind=4.0, gust=1.0, current=0.3, gamma=1.2),
    "spring": dict(
        hs=1.3, tp=6.5, wind=7.0, gust=2.0, current=1.1, gamma=3.3,
        tide_amplitude=1.5, tide_phase=math.pi / 2,
    ),
    "rogue": dict(
        hs=2.0, tp=8.0, wind=10.0, gust=3.0, current=0.6, gamma=3.3, focused=True
    ),
    "extreme": dict(hs=4.5, tp=9.0, wind=18.0, gust=5.0, current=1.0, gamma=3.3),
}

#: Rough ordering by how hard the deck is to land on. The curriculum walks this.
PRESET_ORDER = ["light", "medium", "swell", "spring", "rogue", "extreme"]


@dataclass
class DeckConfig:
    """Sea state, vessel geometry and ship track for one episode."""

    seed: int = 17
    # Sea state
    hs: float = 0.35           # significant wave height, m
    tp: float = 4.5            # peak period, s
    gamma: float = 3.3         # JONSWAP peak enhancement
    wave_direction: float = 0.6
    focused: bool = False      # synthetic large-wave pulse, not a rogue-wave model
    tide_amplitude: float = 0.4
    tide_phase: float = 0.0
    current: float = 0.15
    # Wind
    wind: float = 2.5
    gust: float = 0.7
    wind_direction: float = 0.35
    # Ship
    ship_speed: float = 0.5
    heading: float = 0.0
    ship_length: float = 16.0
    ship_beam: float = 5.8
    freeboard: float = 2.0
    pad_offset: tuple[float, float, float] = (-3.2, 0.0, 0.05)
    pad_radius: float = 1.8
    # Number of JONSWAP components; 28 matches the JavaScript simulator.
    components: int = 28

    @classmethod
    def from_preset(cls, preset: str, **overrides) -> "DeckConfig":
        if preset not in PRESETS:
            raise ValueError("unknown weather preset " + repr(preset))
        cfg = cls(**PRESETS[preset])
        return replace(cfg, **overrides) if overrides else cfg


class Ocean:
    """Seeded JONSWAP-shaped directional wave field. Port of ``Ocean``."""

    def __init__(self, c: DeckConfig):
        self.c = c
        r = mulberry32(c.seed)
        self.components: list[dict] = []
        count = c.components
        fp = 1.0 / c.tp
        df = (2.8 * fp - 0.35 * fp) / count
        total = 0.0
        for i in range(count):
            f = 0.35 * fp + (i + 0.5) * df
            sigma = 0.07 if f <= fp else 0.09
            peak = math.exp(-0.5 * ((f - fp) / (sigma * fp)) ** 2)
            s = f ** -5.0 * math.exp(-1.25 * (fp / f) ** 4) * c.gamma ** peak
            total += s * df
            w = 2.0 * math.pi * f
            k = w * w / G
            direction = c.wave_direction + (r() - 0.5) * 0.8
            self.components.append(
                dict(w=w, k=k, dx=math.cos(direction), dy=math.sin(direction),
                     raw=s * df, phase=r() * 2.0 * math.pi, a=0.0)
            )
        m0 = (c.hs / 4.0) ** 2
        for p in self.components:
            p["a"] = math.sqrt(2.0 * p["raw"] * m0 / total) if total > 0 else 0.0

    def tide(self, t: float) -> float:
        """Moon-driven water level: an hours-long offset, not a storm generator."""
        return self.c.tide_amplitude * math.sin(
            2.0 * math.pi * t / (12.42 * 3600.0) + self.c.tide_phase
        )

    def height(self, x: float, y: float, t: float) -> float:
        z = self.tide(t)
        for p in self.components:
            z += p["a"] * math.sin(
                p["k"] * (p["dx"] * x + p["dy"] * y) - p["w"] * t + p["phase"]
            )
        if self.c.focused:
            u = x * 0.12 - t * 1.15 + 22.0
            z += self.c.hs * 1.3 * math.exp(-u * u / 14.0)
        return z


@dataclass
class PadState:
    """Landing pad pose and twist in the world (ENU) frame."""

    position: tuple[float, float, float]
    velocity: tuple[float, float, float]
    quaternion: tuple[float, float, float, float]
    euler: tuple[float, float, float]          # roll, pitch, yaw
    angular_velocity: tuple[float, float, float]
    radius: float


class Vessel:
    """Six-axis damped vessel response driven by sampled wave heights.

    Port of ``Vessel``. The axes are surge, sway, heave, roll, pitch, yaw; each
    is a second-order system relaxing toward a wave-derived target. The periods
    and damping are illustrative, not identified from a hull.
    """

    PERIODS = (8.0, 9.0, 3.8, 5.2, 4.6, 10.0)
    DAMPING = (0.9, 0.9, 0.7, 0.5, 0.7, 0.9)

    def __init__(self, c: DeckConfig, ocean: Ocean):
        self.c = c
        self.ocean = ocean
        self.time = 0.0
        self.axes = [0.0] * 6
        self.rates = [0.0] * 6
        self.position = (0.0, 0.0, c.freeboard + ocean.tide(0.0))
        self.velocity = (c.ship_speed + c.current, 0.0, 0.0)
        self.euler = (0.0, 0.0, c.heading)
        self.angular_velocity = (0.0, 0.0, 0.0)
        self.quaternion = from_euler(*self.euler)
        # Warm-up so t=0 starts on the developed response, not from rest.
        for i in range(-1000, 0):
            self.update(i * 0.02, 0.02)
        self.update(0.0, 0.001)

    def update(self, t: float, dt: float) -> None:
        c = self.c
        hd = c.heading
        bx = (math.cos(hd) * c.ship_speed + c.current) * t
        by = math.sin(hd) * c.ship_speed * t
        ch, sh = math.cos(hd), math.sin(hd)

        def point(x: float, y: float) -> float:
            return self.ocean.height(bx + ch * x - sh * y, by + sh * x + ch * y, t)

        bow = point(c.ship_length * 0.38, 0.0)
        stern = point(-c.ship_length * 0.38, 0.0)
        port = point(0.0, c.ship_beam * 0.4)
        starboard = point(0.0, -c.ship_beam * 0.4)
        mid = point(0.0, 0.0)
        mean = (bow + stern + port + starboard + 2.0 * mid) / 6.0

        target = (
            0.15 * (bow - stern),
            0.10 * (port - starboard),
            mean,
            clamp(math.atan2(port - starboard, c.ship_beam * 0.8), -0.65, 0.65),
            clamp(-math.atan2(bow - stern, c.ship_length * 0.76), -0.55, 0.55),
            0.025 * (port - starboard),
        )

        for i in range(6):
            wn = 2.0 * math.pi / self.PERIODS[i]
            self.rates[i] += (
                (target[i] - self.axes[i]) * wn * wn
                - 2.0 * self.DAMPING[i] * wn * self.rates[i]
            ) * dt
            self.axes[i] += self.rates[i] * dt

        self.position = (bx + self.axes[0], by + self.axes[1], c.freeboard + self.axes[2])
        self.velocity = (
            ch * c.ship_speed + c.current + self.rates[0],
            sh * c.ship_speed + self.rates[1],
            self.rates[2],
        )
        self.euler = (self.axes[3], self.axes[4], hd + self.axes[5])
        roll, pitch, yaw = self.euler
        rd, pd, yd = self.rates[3], self.rates[4], self.rates[5]
        # Exact ZYX Euler-rate to world angular-velocity mapping.
        self.angular_velocity = (
            rd * math.cos(yaw) * math.cos(pitch) - pd * math.sin(yaw),
            rd * math.sin(yaw) * math.cos(pitch) + pd * math.cos(yaw),
            yd - rd * math.sin(pitch),
        )
        self.quaternion = from_euler(*self.euler)
        self.time = t

    def pad(self) -> PadState:
        r = rotate(self.quaternion, self.c.pad_offset)
        return PadState(
            position=(self.position[0] + r[0], self.position[1] + r[1],
                      self.position[2] + r[2]),
            velocity=tuple(
                v + w for v, w in zip(self.velocity, cross(self.angular_velocity, r))
            ),
            quaternion=self.quaternion,
            euler=self.euler,
            angular_velocity=self.angular_velocity,
            radius=self.c.pad_radius,
        )

    def point_velocity(self, world_point) -> tuple[float, float, float]:
        """Velocity of the deck material point currently at ``world_point``."""
        offset = tuple(w - p for w, p in zip(world_point, self.position))
        c_ = cross(self.angular_velocity, offset)
        return tuple(v + w for v, w in zip(self.velocity, c_))


class Wind:
    """First-order gust process around a mean wind. Port of ``Wind``."""

    def __init__(self, c: DeckConfig):
        self.c = c
        self.noise = gaussian(mulberry32(c.seed ^ 0x74185))
        self.gust = [0.0, 0.0, 0.0]
        self.velocity = (0.0, 0.0, 0.0)

    def update(self, dt: float):
        for i in range(3):
            self.gust[i] += (-self.gust[i] / 1.6) * dt + self.c.gust * math.sqrt(
                2.0 * dt / 1.6
            ) * self.noise() * (0.25 if i == 2 else 1.0)
        self.velocity = (
            self.c.wind * math.cos(self.c.wind_direction) + self.gust[0],
            self.c.wind * math.sin(self.c.wind_direction) + self.gust[1],
            self.gust[2],
        )
        return self.velocity


class DeckTrajectory:
    """Deterministic deck motion sampled on a fixed time grid.

    This is how Gazebo is handed the identical trajectory that training saw:
    ``write_table`` emits a plain text table that
    ``gz/plugin/ShipDeckMotion.cpp`` loads and interpolates by simulation time.
    Keeping the sea state in one place means the Gazebo deck cannot silently
    drift away from the deck the policy was trained on.
    """

    def __init__(self, config: DeckConfig, duration: float, rate: float = 200.0):
        if duration <= 0 or rate <= 0:
            raise ValueError("duration and rate must be positive")
        self.config = config
        self.rate = float(rate)
        self.dt = 1.0 / self.rate
        ocean = Ocean(config)
        vessel = Vessel(config, ocean)
        self.samples: list[dict] = []
        n = int(math.ceil(duration * self.rate)) + 1
        for i in range(n):
            t = i * self.dt
            vessel.update(t, self.dt)
            self.samples.append(
                dict(t=t, pad=vessel.pad(), position=vessel.position,
                     quaternion=vessel.quaternion, velocity=vessel.velocity,
                     angular_velocity=vessel.angular_velocity)
            )

    def __len__(self) -> int:
        return len(self.samples)

    @property
    def duration(self) -> float:
        return (len(self.samples) - 1) * self.dt

    def pad_at(self, t: float) -> PadState:
        """Nearest-sample pad state; used for quick lookups, not integration."""
        i = int(round(clamp(t, 0.0, self.duration) * self.rate))
        return self.samples[min(i, len(self.samples) - 1)]["pad"]

    def write_table(self, path: str) -> str:
        """Write the hull trajectory as a plain table for the Gazebo plugin.

        Columns: ``t x y z qx qy qz qw vx vy vz wx wy wz``.
        """
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(
                "# ship_deck trajectory seed=%d hs=%g tp=%g rate=%g\n"
                % (self.config.seed, self.config.hs, self.config.tp, self.rate)
            )
            fh.write("# t x y z qx qy qz qw vx vy vz wx wy wz\n")
            for s in self.samples:
                pos, q, v, w = (s["position"], s["quaternion"], s["velocity"],
                                s["angular_velocity"])
                fh.write(
                    "%.6f %.6f %.6f %.6f %.9f %.9f %.9f %.9f "
                    "%.6f %.6f %.6f %.6f %.6f %.6f\n"
                    % (s["t"], pos[0], pos[1], pos[2], q[0], q[1], q[2], q[3],
                       v[0], v[1], v[2], w[0], w[1], w[2])
                )
        return path
