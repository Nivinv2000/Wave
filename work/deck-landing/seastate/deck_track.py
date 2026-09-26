"""Vectorised whole-episode deck trajectory.

``deck_motion.Vessel`` is a scalar ODE integration, which is fine as the
reference implementation but far too slow to re-run on every RL reset. This
module reproduces the *same* integration with NumPy doing the expensive part
(sampling the wave field at the five hull points over all timesteps), then runs
the cheap six-axis recurrence.

``DeckTrack`` is the single source of deck motion for everything downstream:

* the PyBullet training environment looks up pad state by simulation time,
* ``write_table`` emits the table that the Gazebo plugin interpolates,
* the PX4 bridge can replay the identical deck.

``assert_matches_reference`` checks this against ``deck_motion.Vessel`` and is
exercised by ``tests/test_seastate.py``. If you change one, the test will tell
you the other drifted.
"""

from __future__ import annotations

import math

import numpy as np

from deck_motion import (
    DeckConfig,
    Ocean,
    PadState,
    Vessel,
    clamp,
)

_WARMUP_STEPS = 1000
_WARMUP_DT = 0.02
_SETTLE_DT = 0.001


def _quat_from_euler_array(roll, pitch, yaw):
    """Vectorised ZYX Euler to (x, y, z, w), matching deck_motion.from_euler."""
    cr, sr = np.cos(roll / 2), np.sin(roll / 2)
    cp, sp = np.cos(pitch / 2), np.sin(pitch / 2)
    cy, sy = np.cos(yaw / 2), np.sin(yaw / 2)
    return np.stack(
        [
            sr * cp * cy - cr * sp * sy,
            cr * sp * cy + sr * cp * sy,
            cr * cp * sy - sr * sp * cy,
            cr * cp * cy + sr * sp * sy,
        ],
        axis=-1,
    )


def _rotate_array(quat, vec):
    """Rotate a fixed vector by an array of quaternions. quat[N,4], vec[3]."""
    ax, ay, az, aw = quat[:, 0], quat[:, 1], quat[:, 2], quat[:, 3]
    vx, vy, vz = float(vec[0]), float(vec[1]), float(vec[2])
    tx = 2.0 * (ay * vz - az * vy)
    ty = 2.0 * (az * vx - ax * vz)
    tz = 2.0 * (ax * vy - ay * vx)
    return np.stack(
        [
            vx + aw * tx + (ay * tz - az * ty),
            vy + aw * ty + (az * tx - ax * tz),
            vz + aw * tz + (ax * ty - ay * tx),
        ],
        axis=-1,
    )


class DeckTrack:
    """Whole-episode six-axis deck motion on a fixed time grid."""

    #: Hull sampling offsets, in the order the reference model uses them.
    #: bow, stern, port, starboard, midships.
    def _hull_offsets(self) -> np.ndarray:
        c = self.config
        return np.array(
            [
                [c.ship_length * 0.38, 0.0],
                [-c.ship_length * 0.38, 0.0],
                [0.0, c.ship_beam * 0.4],
                [0.0, -c.ship_beam * 0.4],
                [0.0, 0.0],
            ]
        )

    def __init__(self, config: DeckConfig, duration: float, dt: float = 0.005):
        if duration <= 0 or dt <= 0:
            raise ValueError("duration and dt must be positive")
        self.config = config
        self.dt = float(dt)
        self.n = int(math.ceil(duration / self.dt)) + 1
        self.ocean = Ocean(config)

        # Wave-field component arrays, taken straight from the reference Ocean so
        # the seeded phases and directions are identical.
        comp = self.ocean.components
        self._a = np.array([p["a"] for p in comp])
        self._k = np.array([p["k"] for p in comp])
        self._dx = np.array([p["dx"] for p in comp])
        self._dy = np.array([p["dy"] for p in comp])
        self._w = np.array([p["w"] for p in comp])
        self._phase = np.array([p["phase"] for p in comp])

        # Time grid: the reference warm-up, the settling step, then the episode.
        warm_t = np.arange(-_WARMUP_STEPS, 0) * _WARMUP_DT
        ep_t = np.arange(1, self.n) * self.dt
        all_t = np.concatenate([warm_t, [0.0], ep_t])
        all_dt = np.concatenate(
            [np.full(_WARMUP_STEPS, _WARMUP_DT), [_SETTLE_DT], np.full(self.n - 1, self.dt)]
        )

        targets = self._wave_targets(all_t)
        axes, rates = self._integrate(targets, all_dt)

        # Keep only the episode grid (drop the warm-up rows).
        keep = slice(_WARMUP_STEPS, None)
        self.t = all_t[keep]
        axes, rates = axes[keep], rates[keep]
        self._finalise(axes, rates)

    # ------------------------------------------------------------------
    # Construction helpers
    # ------------------------------------------------------------------

    def _wave_heights(self, x, y, t):
        """Wave elevation at points (x, y) at times t; arrays broadcast to [..., 5]."""
        arg = (
            self._k * (self._dx * x[..., None] + self._dy * y[..., None])
            - self._w * t[..., None]
            + self._phase
        )
        z = np.sum(self._a * np.sin(arg), axis=-1)
        c = self.config
        tide = c.tide_amplitude * np.sin(
            2.0 * np.pi * t / (12.42 * 3600.0) + c.tide_phase
        )
        z = z + tide
        if c.focused:
            u = x * 0.12 - t * 1.15 + 22.0
            z = z + c.hs * 1.3 * np.exp(-u * u / 14.0)
        return z

    def _wave_targets(self, t: np.ndarray) -> np.ndarray:
        """Six-axis target values driving the vessel response, shape [N, 6]."""
        c = self.config
        ch, sh = math.cos(c.heading), math.sin(c.heading)
        bx = (ch * c.ship_speed + c.current) * t
        by = (sh * c.ship_speed) * t

        off = self._hull_offsets()                     # [5, 2]
        # World position of each hull sample point at each time: [N, 5]
        px = bx[:, None] + ch * off[None, :, 0] - sh * off[None, :, 1]
        py = by[:, None] + sh * off[None, :, 0] + ch * off[None, :, 1]
        tt = np.repeat(t[:, None], off.shape[0], axis=1)

        h = self._wave_heights(px, py, tt)             # [N, 5]
        bow, stern, port, star, mid = (h[:, i] for i in range(5))
        mean = (bow + stern + port + star + 2.0 * mid) / 6.0

        return np.stack(
            [
                0.15 * (bow - stern),
                0.10 * (port - star),
                mean,
                np.clip(np.arctan2(port - star, c.ship_beam * 0.8), -0.65, 0.65),
                np.clip(-np.arctan2(bow - stern, c.ship_length * 0.76), -0.55, 0.55),
                0.025 * (port - star),
            ],
            axis=-1,
        )

    def _integrate(self, targets: np.ndarray, dts: np.ndarray):
        """Semi-implicit Euler six-axis recurrence, matching Vessel.update exactly."""
        wn = 2.0 * np.pi / np.array(Vessel.PERIODS)
        damp = np.array(Vessel.DAMPING)
        wn2 = wn * wn
        two_damp_wn = 2.0 * damp * wn

        n = targets.shape[0]
        axes_out = np.empty((n, 6))
        rates_out = np.empty((n, 6))
        axes = np.zeros(6)
        rates = np.zeros(6)
        for i in range(n):
            dt = dts[i]
            # rates first, then axes uses the updated rate - as in the reference.
            rates = rates + ((targets[i] - axes) * wn2 - two_damp_wn * rates) * dt
            axes = axes + rates * dt
            axes_out[i] = axes
            rates_out[i] = rates
        return axes_out, rates_out

    def _finalise(self, axes: np.ndarray, rates: np.ndarray) -> None:
        c = self.config
        t = self.t
        ch, sh = math.cos(c.heading), math.sin(c.heading)
        bx = (ch * c.ship_speed + c.current) * t
        by = (sh * c.ship_speed) * t

        self.hull_pos = np.stack(
            [bx + axes[:, 0], by + axes[:, 1], c.freeboard + axes[:, 2]], axis=-1
        )
        self.hull_vel = np.stack(
            [
                ch * c.ship_speed + c.current + rates[:, 0],
                sh * c.ship_speed + rates[:, 1],
                rates[:, 2],
            ],
            axis=-1,
        )
        roll, pitch = axes[:, 3], axes[:, 4]
        yaw = c.heading + axes[:, 5]
        self.euler = np.stack([roll, pitch, yaw], axis=-1)
        self.hull_quat = _quat_from_euler_array(roll, pitch, yaw)

        rd, pd, yd = rates[:, 3], rates[:, 4], rates[:, 5]
        self.hull_angvel = np.stack(
            [
                rd * np.cos(yaw) * np.cos(pitch) - pd * np.sin(yaw),
                rd * np.sin(yaw) * np.cos(pitch) + pd * np.cos(yaw),
                yd - rd * np.sin(pitch),
            ],
            axis=-1,
        )

        # Pad kinematics: rotate the pad offset into the world and add the
        # rigid-body term omega x r, so a pad away from the centre of rotation
        # moves faster than the hull centre during roll and pitch.
        r = _rotate_array(self.hull_quat, np.array(c.pad_offset))
        self.pad_offset_world = r
        self.pad_pos = self.hull_pos + r
        self.pad_vel = self.hull_vel + np.cross(self.hull_angvel, r)

    # ------------------------------------------------------------------
    # Lookup
    # ------------------------------------------------------------------

    @property
    def duration(self) -> float:
        return float(self.t[-1])

    def _frac_index(self, t: float):
        x = clamp(float(t), 0.0, self.duration) / self.dt
        i = int(x)
        if i >= self.n - 1:
            return self.n - 1, self.n - 1, 0.0
        return i, i + 1, x - i

    def _lerp(self, arr: np.ndarray, t: float) -> np.ndarray:
        i, j, f = self._frac_index(t)
        if f == 0.0:
            return arr[i]
        return arr[i] * (1.0 - f) + arr[j] * f

    def pad_at(self, t: float) -> PadState:
        """Linearly interpolated pad state at time ``t``."""
        q = self._lerp(self.hull_quat, t)
        norm = float(np.linalg.norm(q))
        q = q / norm if norm > 0 else np.array([0.0, 0.0, 0.0, 1.0])
        eul = self._lerp(self.euler, t)
        return PadState(
            position=tuple(self._lerp(self.pad_pos, t)),
            velocity=tuple(self._lerp(self.pad_vel, t)),
            quaternion=tuple(q),
            euler=tuple(eul),
            angular_velocity=tuple(self._lerp(self.hull_angvel, t)),
            radius=self.config.pad_radius,
        )

    def deck_surface_z(self, t: float, x: float, y: float) -> float:
        """Height of the deck plane at world (x, y), time t.

        The deck is treated as the plane through the pad centre with the hull
        normal, which is what the landing checks in the training environment
        and the Gazebo deck collision both approximate.
        """
        pad = self.pad_at(t)
        roll, pitch, _ = pad.euler
        dx = x - pad.position[0]
        dy = y - pad.position[1]
        # Small-angle plane through the pad: dz = -tan(pitch)*dx + tan(roll)*dy
        return pad.position[2] - math.tan(pitch) * dx + math.tan(roll) * dy

    def write_table(self, path: str, rate: float | None = None) -> str:
        """Write the hull trajectory for the Gazebo plugin to interpolate.

        Columns: ``t x y z qx qy qz qw vx vy vz wx wy wz``.
        """
        if rate is None:
            idx = np.arange(self.n)
        else:
            step = max(1, int(round((1.0 / rate) / self.dt)))
            idx = np.arange(0, self.n, step)
        c = self.config
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(
                "# ship_deck trajectory seed=%d hs=%g tp=%g gamma=%g heading=%g "
                "ship_speed=%g dt=%g\n"
                % (c.seed, c.hs, c.tp, c.gamma, c.heading, c.ship_speed,
                   self.dt * (idx[1] - idx[0] if len(idx) > 1 else 1))
            )
            fh.write("# t x y z qx qy qz qw vx vy vz wx wy wz\n")
            for i in idx:
                fh.write(
                    "%.6f %.6f %.6f %.6f %.9f %.9f %.9f %.9f "
                    "%.6f %.6f %.6f %.6f %.6f %.6f\n"
                    % (
                        self.t[i],
                        self.hull_pos[i, 0], self.hull_pos[i, 1], self.hull_pos[i, 2],
                        self.hull_quat[i, 0], self.hull_quat[i, 1],
                        self.hull_quat[i, 2], self.hull_quat[i, 3],
                        self.hull_vel[i, 0], self.hull_vel[i, 1], self.hull_vel[i, 2],
                        self.hull_angvel[i, 0], self.hull_angvel[i, 1],
                        self.hull_angvel[i, 2],
                    )
                )
        return path


def assert_matches_reference(config: DeckConfig, duration: float = 4.0,
                            dt: float = 0.005, tol: float = 1e-9) -> float:
    """Check DeckTrack against the scalar reference Vessel. Returns max error."""
    track = DeckTrack(config, duration=duration, dt=dt)
    ocean = Ocean(config)
    vessel = Vessel(config, ocean)
    worst = 0.0
    n = int(duration / dt)
    for i in range(1, n + 1):
        t = i * dt
        vessel.update(t, dt)
        ref = vessel.pad()
        got = track.pad_at(t)
        for a, b in (
            (ref.position, got.position),
            (ref.velocity, got.velocity),
            (ref.euler, got.euler),
            (ref.angular_velocity, got.angular_velocity),
        ):
            for u, v in zip(a, b):
                worst = max(worst, abs(u - v))
    if worst > tol:
        raise AssertionError(
            "DeckTrack diverged from deck_motion.Vessel by %.3e (tol %.1e)" % (worst, tol)
        )
    return worst
