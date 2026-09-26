#!/usr/bin/env python3
"""Fly a PX4 X500 from a launch platform onto a moving ship's helideck in Gazebo.

The landing law is hardcoded per scenario (see ../scenarios.py): it is a
deterministic guidance law with scenario-specific gains and gates, not a trained
policy. Phases:

    CLIMB    -> off the launch platform to cruise height
    TRANSIT  -> chase the ship, matching its velocity, aiming slightly ahead of the pad
    ALIGN    -> hold over the pad at cruise height until settled
    DESCEND  -> descend relative to the deck to the final gate height
    FINAL    -> hold at the gate height, tracking deck heave, until the deck is quiet
    COMMIT   -> close on the deck at a fixed relative speed; go around on drift
    CUT      -> motors cut a few centimetres above the deck, the way ship landings
                are done, then the drone is checked to be resting on the pad

Deck and drone poses come from Gazebo's pose stream (simulation ground truth,
standing in for a ship-relative navigation source). Commands go to PX4 as
MAVLink offboard velocity setpoints, so PX4's own controllers fly the aircraft.

Needs the system python (gz-transport bindings) and pymavlink:
    /usr/bin/python3 land_on_deck.py --scenario storm
Normally started by ../scripts/run_scenario.sh, which also launches the sim.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import struct
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from scenarios import (  # noqa: E402
    DRONE_MODEL,
    LAUNCH_PAD_TOP,
    PAD_OFFSET,
    PAD_RADIUS,
    SCENARIOS,
    SHIP_MODEL,
)

OFFBOARD = 6  # PX4 custom main mode


# --------------------------------------------------------------------------
# Small quaternion helpers, (x, y, z, w)
# --------------------------------------------------------------------------

def qrot(q, v):
    x, y, z, w = q
    tx = 2.0 * (y * v[2] - z * v[1])
    ty = 2.0 * (z * v[0] - x * v[2])
    tz = 2.0 * (x * v[1] - y * v[0])
    return (v[0] + w * tx + (y * tz - z * ty),
            v[1] + w * ty + (z * tx - x * tz),
            v[2] + w * tz + (x * ty - y * tx))


def qrot_inv(q, v):
    return qrot((-q[0], -q[1], -q[2], q[3]), v)


def tilt_of(q):
    """Angle between the body z axis and world up."""
    _, _, zz = qrot(q, (0.0, 0.0, 1.0))
    return math.acos(max(-1.0, min(1.0, zz)))


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


# --------------------------------------------------------------------------
# Gazebo ground truth
# --------------------------------------------------------------------------

class GzPoses:
    """Ship, pad and drone state from /world/<w>/dynamic_pose/info."""

    def __init__(self, world):
        from gz.msgs10.pose_v_pb2 import Pose_V
        from gz.transport13 import Node

        self._lock = threading.Lock()
        self.pose = {}                 # name -> (pos, quat)
        self.vel = {}                  # name -> filtered velocity
        self._last = {}                # name -> (t, pos)
        self.sim_time = 0.0
        self.node = Node()
        self.topic = "/world/%s/dynamic_pose/info" % world
        if not self.node.subscribe(Pose_V, self.topic, self._cb):
            raise RuntimeError("cannot subscribe to " + self.topic)

    def _track(self, name, t, pos):
        last = self._last.get(name)
        if last is not None:
            dt = t - last[0]
            if dt > 1e-4:
                raw = tuple((a - b) / dt for a, b in zip(pos, last[1]))
                old = self.vel.get(name, raw)
                self.vel[name] = tuple(0.5 * o + 0.5 * r for o, r in zip(old, raw))
        self._last[name] = (t, pos)

    def _cb(self, msg):
        stamp = msg.header.stamp.sec + 1e-9 * msg.header.stamp.nsec
        t = stamp if stamp > 0 else time.time()
        with self._lock:
            self.sim_time = t
            for p in msg.pose:
                if p.name not in (SHIP_MODEL, DRONE_MODEL):
                    continue
                pos = (p.position.x, p.position.y, p.position.z)
                q = (p.orientation.x, p.orientation.y, p.orientation.z, p.orientation.w)
                self.pose[p.name] = (pos, q)
                self._track(p.name, t, pos)
                if p.name == SHIP_MODEL:
                    off = qrot(q, PAD_OFFSET)
                    pad = (pos[0] + off[0], pos[1] + off[1], pos[2] + off[2])
                    self.pose["pad"] = (pad, q)
                    self._track("pad", t, pad)

    def get(self):
        with self._lock:
            if SHIP_MODEL not in self.pose or DRONE_MODEL not in self.pose:
                return None
            return dict(
                t=self.sim_time,
                ship=self.pose[SHIP_MODEL],
                pad=self.pose["pad"][0],
                pad_vel=self.vel.get("pad", (0.0, 0.0, 0.0)),
                ship_q=self.pose[SHIP_MODEL][1],
                drone=self.pose[DRONE_MODEL][0],
                drone_q=self.pose[DRONE_MODEL][1],
                drone_vel=self.vel.get(DRONE_MODEL, (0.0, 0.0, 0.0)),
            )

    def wait(self, timeout):
        t0 = time.time()
        while time.time() - t0 < timeout:
            if self.get() is not None:
                return True
            time.sleep(0.1)
        return False


# --------------------------------------------------------------------------
# PX4 over MAVLink
# --------------------------------------------------------------------------

class Px4:
    def __init__(self, url):
        from pymavlink import mavutil

        self.mav = mavutil.mavlink
        self.m = mavutil.mavlink_connection(url, source_system=245, source_component=190)
        print("[px4] waiting for heartbeat on", url)
        self.m.wait_heartbeat(timeout=90)
        print("[px4] connected to system", self.m.target_system)
        self.armed = False
        self.main_mode = 0
        self._target = (0.0, 0.0, 0.0)
        self._stop = False
        for fn in (self._rx, self._heartbeat, self._stream):
            threading.Thread(target=fn, daemon=True).start()

    # ---- background threads
    def _rx(self):
        while not self._stop:
            msg = self.m.recv_match(type=["HEARTBEAT", "STATUSTEXT"], blocking=True, timeout=0.5)
            if msg is None:
                continue
            if msg.get_type() == "HEARTBEAT":
                if (msg.get_srcSystem() == self.m.target_system
                        and msg.autopilot != self.mav.MAV_AUTOPILOT_INVALID):
                    self.armed = bool(msg.base_mode & self.mav.MAV_MODE_FLAG_SAFETY_ARMED)
                    self.main_mode = (msg.custom_mode >> 16) & 0xFF
            elif msg.severity <= 4:   # warning and worse
                print("[px4] %s" % msg.text)

    def _heartbeat(self):
        # PX4 refuses to arm, and drops offboard, without a live GCS link.
        while not self._stop:
            self.m.mav.heartbeat_send(self.mav.MAV_TYPE_GCS, self.mav.MAV_AUTOPILOT_INVALID,
                                      0, 0, self.mav.MAV_STATE_ACTIVE)
            time.sleep(0.5)

    def _stream(self):
        # Offboard needs an unbroken setpoint stream, before and during the mode.
        mask = (self.mav.POSITION_TARGET_TYPEMASK_X_IGNORE | self.mav.POSITION_TARGET_TYPEMASK_Y_IGNORE
                | self.mav.POSITION_TARGET_TYPEMASK_Z_IGNORE | self.mav.POSITION_TARGET_TYPEMASK_AX_IGNORE
                | self.mav.POSITION_TARGET_TYPEMASK_AY_IGNORE | self.mav.POSITION_TARGET_TYPEMASK_AZ_IGNORE
                | self.mav.POSITION_TARGET_TYPEMASK_YAW_IGNORE)
        while not self._stop:
            ve, vn, vu = self._target            # ENU in, NED out
            self.m.mav.set_position_target_local_ned_send(
                0, self.m.target_system, self.m.target_component,
                self.mav.MAV_FRAME_LOCAL_NED, mask,
                0, 0, 0, vn, ve, -vu, 0, 0, 0, 0, 0)
            time.sleep(1.0 / 30.0)

    # ---- commands
    def velocity(self, v_enu):
        self._target = tuple(float(x) for x in v_enu)

    def _cmd(self, cmd, *p):
        p = list(p) + [0.0] * (7 - len(p))
        self.m.mav.command_long_send(self.m.target_system, self.m.target_component, cmd, 0, *p)

    def set_param(self, name, value, is_int):
        if is_int:
            raw = struct.unpack("<f", struct.pack("<i", int(value)))[0]
            ptype = self.mav.MAV_PARAM_TYPE_INT32
        else:
            raw, ptype = float(value), self.mav.MAV_PARAM_TYPE_REAL32
        self.m.mav.param_set_send(self.m.target_system, self.m.target_component,
                                  name.encode(), raw, ptype)

    def offboard(self):
        self._cmd(self.mav.MAV_CMD_DO_SET_MODE, self.mav.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, OFFBOARD, 0)

    def arm(self):
        self._cmd(self.mav.MAV_CMD_COMPONENT_ARM_DISARM, 1.0)

    def kill(self):
        """Force disarm: the motor cut at touchdown."""
        self._cmd(self.mav.MAV_CMD_COMPONENT_ARM_DISARM, 0.0, 21196.0)

    def close(self):
        self._stop = True


# --------------------------------------------------------------------------
# The landing law
# --------------------------------------------------------------------------

def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def limit_xy(vx, vy, lim):
    n = math.hypot(vx, vy)
    if n > lim > 0:
        return vx * lim / n, vy * lim / n
    return vx, vy


def deck_frame(s, rest):
    """Drone relative to the pad, in the ship frame, and skid clearance."""
    ship_pos, ship_q = s["ship"]
    rel = qrot_inv(ship_q, sub(s["drone"], ship_pos))
    dx = rel[0] - PAD_OFFSET[0]
    dy = rel[1] - PAD_OFFSET[1]
    clearance = rel[2] - PAD_OFFSET[2] - rest
    return math.hypot(dx, dy), clearance


def run(key, url, timeout, report_dir, director_on=True, record=True, video_dir=None):
    scen = SCENARIOS[key]
    law = scen["landing"]
    sea = scen["sea"]
    print("=" * 76)
    print(" %s | ship %.1f m/s  heave +/-%.2f m  roll +/-%.1f deg  wind %.0f m/s (gust sd %.1f)"
          % (scen["label"].upper(), sea["speed"], sea["heave_amp"], sea["roll_amp_deg"],
             sea["wind_speed"], sea["gust_std"]))
    print(" commit gate: deck |vz| < %.2f m/s, tilt < %.1f deg, gate height %.1f m"
          % (law["gate_vz"], math.degrees(law["gate_tilt"]), law["final_height"]))
    print("=" * 76)

    gz = GzPoses(scen["world"])
    if not gz.wait(90.0):
        print("[run] FAIL: no ship/drone poses on", gz.topic)
        return 2
    px4 = Px4(url)

    # Relax the failsafes that assume a radio and a human, and let the velocity
    # loop follow deck heave. These are SITL settings, not flight advice.
    for name, val, is_int in (("COM_RC_IN_MODE", 4, True), ("NAV_DLL_ACT", 0, True),
                              ("COM_RCL_EXCEPT", 4, True), ("MPC_Z_VEL_MAX_DN", 2.0, False),
                              ("COM_DISARM_PRFLT", 60.0, False)):
        px4.set_param(name, val, is_int)
        time.sleep(0.05)

    # Rest height: where the drone's reported origin sits above a surface it is
    # standing on. Measured on the launch platform so skid clearance above the
    # deck is exact whatever the model origin convention is.
    samples = []
    for _ in range(20):
        samples.append(gz.get()["drone"][2] - LAUNCH_PAD_TOP)
        time.sleep(0.05)
    rest = sum(samples) / len(samples)
    print("[run] drone rest height above surface: %.3f m" % rest)

    director = None
    if director_on:
        from director import DirectorLink as Director
        director = Director(
            DRONE_MODEL,
            "%s  -  moving-ship landing, PX4 + Gazebo" % scen["label"].upper(),
            "ship %.1f m/s  |  heave +/-%.2f m  |  roll +/-%.1f deg  |  wind %.0f m/s, gusts sd %.1f m/s"
            % (sea["speed"], sea["heave_amp"], sea["roll_amp_deg"], sea["wind_speed"], sea["gust_std"]),
            frames_dir=os.path.expanduser("~/.cache/deck-landing/frames/" + key) if record else None,
            video_path=os.path.join(video_dir or os.path.join(os.path.dirname(HERE), "videos"),
                                    key + ".mp4"),
        )

    # ---- Offboard + arm (retries until the EKF is ready)
    t_arm = time.time()
    while not (px4.armed and px4.main_mode == OFFBOARD):
        if time.time() - t_arm > 150.0:
            print("[run] FAIL: could not arm in offboard")
            return 2
        px4.velocity((0.0, 0.0, 0.0))
        if px4.main_mode != OFFBOARD:
            px4.offboard()
        elif not px4.armed:
            px4.arm()
        time.sleep(1.0)
    print("[run] armed in OFFBOARD after %.0f s" % (time.time() - t_arm))
    if director:
        director.start_recording()
        director.shot("CLIMB")

    t0 = time.time()
    phase, phase_t = "CLIMB", t0
    last_log = 0.0
    quiet_since = None
    go_arounds = 0
    gate_scale = 1.0
    max_deck_vz = 0.0
    result = dict(scenario=key, label=scen["label"], outcome="timeout")
    dt = 1.0 / 30.0

    def enter(p):
        nonlocal phase, phase_t
        phase, phase_t = p, time.time()
        print("[%6.1fs] -> %s" % (time.time() - t0, p))
        if director:
            director.shot(p)

    while time.time() - t0 < timeout:
        s = gz.get()
        pad, pv = s["pad"], s["pad_vel"]
        d = s["drone"]
        horiz, clear = deck_frame(s, rest)
        deck_tilt = tilt_of(s["ship_q"])
        max_deck_vz = max(max_deck_vz, abs(pv[2]))
        if director:
            director.note("%.2f m from pad  |  clearance %.2f m  |  deck vz %+.2f m/s  |  deck tilt %.1f deg"
                          % (horiz, clear, pv[2], math.degrees(deck_tilt)))

        # Horizontal law: match the deck, pull toward a point slightly ahead of it.
        ax = pad[0] + pv[0] * law["lead"] - d[0]
        ay = pad[1] + pv[1] * law["lead"] - d[1]
        rx, ry = limit_xy(law["kp_xy"] * ax, law["kp_xy"] * ay, law["approach_speed"])
        vx, vy = pv[0] + rx, pv[1] + ry
        world_h = d[2] - rest - pad[2]      # height above the pad centre, world z

        if phase == "CLIMB":
            vx, vy = 0.0, 0.0
            vz = clamp(1.5 * (pad[2] + law["cruise_alt"] - (d[2] - rest)), -1.0, 2.5)
            if d[2] - rest - LAUNCH_PAD_TOP > 3.0:
                enter("TRANSIT")
        elif phase == "TRANSIT":
            vz = clamp(1.2 * (law["cruise_alt"] - world_h), -1.5, 2.0)
            if horiz < 2.0 * law["align_radius"]:
                enter("ALIGN")
        elif phase == "ALIGN":
            vz = clamp(1.2 * (law["cruise_alt"] - world_h), -1.5, 2.0)
            if horiz > 4.0 * law["align_radius"]:
                enter("TRANSIT")
            elif horiz < law["align_radius"]:
                if time.time() - phase_t > 0.3:
                    enter("DESCEND")
            else:
                phase_t = time.time()
        elif phase == "DESCEND":
            # Drifted off: hold height over the deck and re-centre, don't climb away.
            vz = pv[2] if horiz > law["abort_radius"] else pv[2] - law["descend_speed"]
            if clear <= law["final_height"]:
                enter("FINAL")
                quiet_since = None
        elif phase == "FINAL":
            # Ride the deck heave at the gate height until the deck goes quiet.
            vz = pv[2] + clamp(1.5 * (law["final_height"] - clear), -1.0, 1.0)
            waited = time.time() - phase_t
            if waited > 8.0 and gate_scale < 2.5:
                gate_scale = 2.5
                print("[%6.1fs]    no quiet window in 8 s: widening gate x2.5" % (time.time() - t0))
            elif waited > 3.0 and gate_scale < 1.5:
                gate_scale = 1.5
                print("[%6.1fs]    no quiet window in 3 s: widening gate x1.5" % (time.time() - t0))
            quiet = (abs(pv[2]) < law["gate_vz"] * gate_scale
                     and deck_tilt < law["gate_tilt"] * gate_scale
                     and horiz < law["align_radius"] * gate_scale)
            quiet_since = (quiet_since or time.time()) if quiet else None
            if quiet_since and time.time() - quiet_since > 0.2:
                result["gate_wait_s"] = round(waited, 2)
                enter("COMMIT")
        elif phase == "COMMIT":
            vz = pv[2] - law["creep_speed"]
            if horiz > law["abort_radius"] and clear > 0.4:
                go_arounds += 1
                enter("FINAL")
                continue
            if clear < law["cut_margin"]:
                px4.kill()
                rel_v = sub(s["drone_vel"], pv)
                result.update(
                    outcome="touchdown",
                    time_s=round(time.time() - t0, 2),
                    offset_from_pad_m=round(horiz, 3),
                    closing_speed_mps=round(-rel_v[2], 3),
                    horizontal_slip_mps=round(math.hypot(rel_v[0], rel_v[1]), 3),
                    deck_vz_mps=round(pv[2], 3),
                    deck_tilt_deg=round(math.degrees(deck_tilt), 2),
                    go_arounds=go_arounds,
                )
                print("[%6.1fs] CUT  offset %.2f m, closing %.2f m/s, deck vz %+.2f m/s, tilt %.1f deg"
                      % (time.time() - t0, horiz, -rel_v[2], pv[2], math.degrees(deck_tilt)))
                if director:
                    director.shot("LANDED", "Touchdown - motors cut  |  %.2f m from pad centre, closing %.2f m/s"
                                  % (horiz, -rel_v[2]))
                break
        else:
            vz = 0.0

        if clear < -0.3 and phase in ("DESCEND", "FINAL", "COMMIT"):
            result["outcome"] = "struck_deck"
            px4.kill()
            break

        px4.velocity((vx, vy, vz))

        now = time.time() - t0
        if now - last_log >= 1.0:
            last_log = now
            print("[%6.1fs] %-8s to pad %6.2f m  clearance %6.2f m  deck vz %+5.2f  tilt %4.1f deg"
                  % (now, phase, horiz, clear, pv[2], math.degrees(deck_tilt)))
        time.sleep(dt)

    # ---- Confirm it stays on the deck.
    if result["outcome"] == "touchdown":
        worst_h, worst_c = 0.0, 0.0
        t_hold = time.time()
        outro = False
        while time.time() - t_hold < 7.0:
            s = gz.get()
            h, c = deck_frame(s, rest)
            worst_h, worst_c = max(worst_h, h), max(worst_c, abs(c))
            if director:
                director.note("on deck: %.2f m from pad centre  |  deck vz %+.2f m/s  |  deck tilt %.1f deg"
                              % (h, s["pad_vel"][2], math.degrees(tilt_of(s["ship_q"]))))
                if not outro and time.time() - t_hold > 3.0:
                    outro = True
                    director.shot("OUTRO", "Secured on the moving ship  |  %.2f m from pad centre" % h)
            time.sleep(0.1)
        secured = worst_h < PAD_RADIUS and worst_c < 0.35
        result.update(outcome="landed" if secured else "slid_off",
                      settled_offset_m=round(worst_h, 3),
                      settled_clearance_m=round(worst_c, 3))
    result["max_deck_vz_seen_mps"] = round(max_deck_vz, 3)
    if director:
        video = director.finish()
        if video:
            result["video"] = video

    print("-" * 76)
    print(" RESULT %s: %s" % (scen["label"], result["outcome"].upper()))
    for k, v in result.items():
        if k not in ("scenario", "label", "outcome"):
            print("   %-24s %s" % (k, v))
    print("-" * 76)

    os.makedirs(report_dir, exist_ok=True)
    path = os.path.join(report_dir, "%s.json" % key)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2)
    print("[run] report written to", path)
    px4.close()
    return 0 if result["outcome"] == "landed" else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scenario", choices=list(SCENARIOS), default="medium")
    ap.add_argument("--url", default="udp:127.0.0.1:14540")
    ap.add_argument("--timeout", type=float, default=240.0)
    ap.add_argument("--report-dir", default=os.path.join(os.path.dirname(HERE), "reports"))
    ap.add_argument("--video-dir", default=os.path.join(os.path.dirname(HERE), "videos"))
    ap.add_argument("--no-director", action="store_true", help="leave the camera alone")
    ap.add_argument("--no-record", action="store_true", help="do not record a video")
    a = ap.parse_args()
    return run(a.scenario, a.url, a.timeout, a.report_dir,
               director_on=not a.no_director, record=not a.no_record, video_dir=a.video_dir)


if __name__ == "__main__":
    sys.exit(main())
