"""Velocity-setpoint inner loop for the X500 in PyBullet.

Why this exists instead of ``DSLPIDControl``: that controller hardcodes
Crazyflie constants (``PWM2RPM_SCALE``, ``PWM2RPM_CONST``, attitude gains around
70000) and reads ``kf``/mass from ``cf2x.urdf``. Pointing it at a 2 kg X500 does
not fly. This is a compact cascade sized for the X500 instead:

    velocity setpoint -> acceleration -> tilt + collective thrust
                      -> attitude -> body rates -> torques -> motor RPM

That is deliberately the same cascade PX4 runs for a multicopter, which is what
makes the trained policy portable: in PyBullet this class closes the loop, in
Gazebo PX4's own controllers do, and the policy above only ever emits a velocity
setpoint. ``randomize()`` perturbs the gains and adds command lag so the policy
cannot overfit to this particular inner loop's response.

Frames: world is ENU, body is forward-x / left-y / up-z. The mixer signs are
derived to match ``BaseAviary._physics`` and ``assets/x500.urdf`` exactly - see
``tests/test_inner_loop.py``, which checks a commanded torque comes back out of
the plant.
"""

from __future__ import annotations

import math

import numpy as np


def _quat_mul(a, b):
    """Hamilton product of (x, y, z, w) quaternions."""
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return np.array([
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ])


def _quat_from_two_vectors(a, b):
    """Shortest rotation taking unit vector a to unit vector b, as (x, y, z, w)."""
    dot = float(np.dot(a, b))
    if dot > 1.0 - 1e-12:
        return np.array([0.0, 0.0, 0.0, 1.0])
    if dot < -1.0 + 1e-12:
        axis = np.cross(a, np.array([1.0, 0.0, 0.0]))
        if np.linalg.norm(axis) < 1e-6:
            axis = np.cross(a, np.array([0.0, 1.0, 0.0]))
        axis = axis / np.linalg.norm(axis)
        return np.array([axis[0], axis[1], axis[2], 0.0])
    axis = np.cross(a, b)
    q = np.array([axis[0], axis[1], axis[2], 1.0 + dot])
    return q / np.linalg.norm(q)


def _rot_from_quat(q):
    """Rotation matrix from an (x, y, z, w) quaternion."""
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


class X500VelocityController:
    """Cascaded velocity controller producing motor RPM for the X500 plant.

    Parameters mirror the airframe so this stays consistent with
    ``assets/x500.urdf``; the environment passes them straight from the loaded
    ``BaseAviary`` attributes rather than duplicating literals.
    """

    #: Nominal gains. PX4 equivalents are noted for orientation.
    VEL_P = np.array([2.5, 2.5, 4.0])     # MPC_XY_VEL_P_ACC / MPC_Z_VEL_P_ACC
    VEL_I = np.array([0.4, 0.4, 2.0])
    VEL_D = np.array([0.15, 0.15, 0.15])
    ATT_P = 8.0                            # MC_ROLL_P / MC_PITCH_P
    YAW_P = 3.0                            # MC_YAW_P
    RATE_P = 20.0                          # rate-loop bandwidth, 1/s
    MAX_TILT = math.radians(35.0)          # MPC_TILTMAX_AIR
    MAX_ACC_XY = 8.0                       # m/s^2
    MAX_ACC_UP = 6.0
    MAX_ACC_DOWN = 4.0

    def __init__(self, mass, inertia_diag, arm_offset, kf, km, max_rpm, g=9.8):
        self.m = float(mass)
        self.J = np.asarray(inertia_diag, dtype=float)
        self.a = float(arm_offset)       # per-axis rotor offset, not the diagonal arm
        self.kf = float(kf)
        self.km = float(km)
        self.c = self.km / self.kf       # yaw torque per newton of thrust
        self.max_rpm = float(max_rpm)
        self.g = float(g)
        self.max_thrust = 4.0 * self.kf * self.max_rpm ** 2
        # Mutable copies so randomize() does not touch the class defaults.
        self.vel_p = self.VEL_P.copy()
        self.vel_i = self.VEL_I.copy()
        self.vel_d = self.VEL_D.copy()
        self.att_p = self.ATT_P
        self.yaw_p = self.YAW_P
        self.rate_p = self.RATE_P
        self.cmd_lag = 0.0               # first-order lag on the velocity command, s
        self.reset()

    # ------------------------------------------------------------------

    def reset(self, yaw: float = 0.0) -> None:
        self._int = np.zeros(3)
        self._last_vel_err = np.zeros(3)
        self._yaw_sp = float(yaw)
        self._v_cmd = np.zeros(3)
        self._v_cmd_init = False

    def randomize(self, rng: np.random.Generator, amount: float = 1.0) -> dict:
        """Perturb gains and add command lag, so the policy does not overfit.

        ``amount`` scales the spread; 0 reproduces the nominal loop. Returns the
        drawn values for logging.
        """
        def jitter(scale):
            return float(np.exp(rng.normal(0.0, 0.25 * amount)) * scale)

        self.vel_p = self.VEL_P * np.exp(rng.normal(0.0, 0.20 * amount, 3))
        self.vel_i = self.VEL_I * np.exp(rng.normal(0.0, 0.25 * amount, 3))
        self.att_p = jitter(self.ATT_P)
        self.rate_p = jitter(self.RATE_P)
        self.cmd_lag = float(rng.uniform(0.0, 0.25 * amount))
        return dict(vel_p=self.vel_p.tolist(), att_p=self.att_p,
                    rate_p=self.rate_p, cmd_lag=self.cmd_lag)

    # ------------------------------------------------------------------

    def update(self, pos, quat, vel, ang_v_world, vel_sp, yaw_rate_sp, dt):
        """One inner-loop tick. Returns (4,) motor RPM.

        ``vel_sp`` is a world-frame velocity setpoint in m/s and ``yaw_rate_sp``
        a yaw rate in rad/s - the same pair the PX4 bridge sends as
        ``SET_POSITION_TARGET_LOCAL_NED``.
        """
        quat = np.asarray(quat, dtype=float)
        vel = np.asarray(vel, dtype=float)
        vel_sp = np.asarray(vel_sp, dtype=float)
        R = _rot_from_quat(quat)
        z_b = R[:, 2]

        # --- Command lag: stands in for the setpoint transport and filtering a
        # --- real autopilot applies before its own velocity loop sees it.
        if not self._v_cmd_init:
            self._v_cmd = vel_sp.copy()
            self._v_cmd_init = True
        elif self.cmd_lag > 1e-6:
            alpha = dt / (dt + self.cmd_lag)
            self._v_cmd = (1.0 - alpha) * self._v_cmd + alpha * vel_sp
        else:
            self._v_cmd = vel_sp.copy()

        # --- Velocity loop -> acceleration setpoint
        err = self._v_cmd - vel
        self._int = np.clip(self._int + err * dt, -4.0, 4.0)
        d_err = (err - self._last_vel_err) / dt if dt > 0 else np.zeros(3)
        self._last_vel_err = err
        acc = self.vel_p * err + self.vel_i * self._int + self.vel_d * d_err
        acc[0] = float(np.clip(acc[0], -self.MAX_ACC_XY, self.MAX_ACC_XY))
        acc[1] = float(np.clip(acc[1], -self.MAX_ACC_XY, self.MAX_ACC_XY))
        acc[2] = float(np.clip(acc[2], -self.MAX_ACC_DOWN, self.MAX_ACC_UP))

        # --- Thrust vector, tilt limited
        f_des = self.m * (acc + np.array([0.0, 0.0, self.g]))
        f_z = max(f_des[2], 0.3 * self.m * self.g)
        max_xy = math.tan(self.MAX_TILT) * f_z
        xy_norm = math.hypot(f_des[0], f_des[1])
        if xy_norm > max_xy and xy_norm > 1e-9:
            scale = max_xy / xy_norm
            f_des[0] *= scale
            f_des[1] *= scale
        f_des[2] = f_z
        f_norm = float(np.linalg.norm(f_des))
        z_des = f_des / f_norm if f_norm > 1e-9 else np.array([0.0, 0.0, 1.0])

        # Collective thrust projected on the current body axis, as PX4 does:
        # it avoids commanding thrust the vehicle cannot yet point.
        thrust = float(np.dot(f_des, z_b))
        thrust = float(np.clip(thrust, 0.05 * self.max_thrust, 0.95 * self.max_thrust))

        # --- Attitude setpoint: tilt from z_des, heading from the yaw setpoint
        self._yaw_sp += float(yaw_rate_sp) * dt
        self._yaw_sp = math.atan2(math.sin(self._yaw_sp), math.cos(self._yaw_sp))
        q_tilt = _quat_from_two_vectors(np.array([0.0, 0.0, 1.0]), z_des)
        half = 0.5 * self._yaw_sp
        q_yaw = np.array([0.0, 0.0, math.sin(half), math.cos(half)])
        q_des = _quat_mul(q_tilt, q_yaw)

        # --- Attitude error -> body rate setpoint
        q_cur_inv = np.array([-quat[0], -quat[1], -quat[2], quat[3]])
        q_err = _quat_mul(q_cur_inv, q_des)
        if q_err[3] < 0.0:
            q_err = -q_err
        rate_sp = 2.0 * q_err[:3] * np.array([self.att_p, self.att_p, self.yaw_p])

        # --- Rate loop -> body torque. ang_v from PyBullet is world frame.
        omega_body = R.T @ np.asarray(ang_v_world, dtype=float)
        torque = self.J * (self.rate_p * (rate_sp - omega_body))

        return self._mix(thrust, torque)

    # ------------------------------------------------------------------

    def _mix(self, thrust, torque):
        """Thrust and body torque to per-rotor RPM.

        Rotor layout from assets/x500.urdf, offsets (x, y) in metres:
            0 front-right (+a, -a)   1 rear-right  (-a, -a)
            2 rear-left   (-a, +a)   3 front-left  (+a, +a)

        BaseAviary._physics applies each rotor force at its own link origin, so
        roll and pitch torque come out of the geometry; only yaw torque is
        applied explicitly, as km*(-r0^2 + r1^2 - r2^2 + r3^2). Inverting
            T  = f0 + f1 + f2 + f3
            tx = a(-f0 - f1 + f2 + f3)
            ty = a(-f0 + f1 + f2 - f3)
            tz = c(-f0 + f1 - f2 + f3)
        gives the signs below.
        """
        tx, ty, tz = float(torque[0]), float(torque[1]), float(torque[2])
        qt = thrust / 4.0
        qx = tx / (4.0 * self.a)
        qy = ty / (4.0 * self.a)
        qz = tz / (4.0 * self.c)
        f = np.array([
            qt - qx - qy - qz,
            qt - qx + qy + qz,
            qt + qx + qy - qz,
            qt + qx - qy + qz,
        ])
        f = np.maximum(f, 0.0)
        rpm = np.sqrt(f / self.kf)
        return np.clip(rpm, 0.0, self.max_rpm)
