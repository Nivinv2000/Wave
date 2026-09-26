# PRD 2 of 3 — PX4 landing, forecast and safety controller

**Owner:** Person 2, flight logic. **Product:** DeckSafe, a fair same-aircraft comparison in PX4 SITL + Gazebo. **Due:** 15:30 submission, code freeze at 15:00. Read this independently; coordinate the short shared contract below with Person 1 immediately.

## The first thing to do now

1. Freeze the input with Person 1: one JSON UDP datagram per deck/obstacle update to `127.0.0.1:14670`, at least 10 Hz of simulation time; the aircraft is PX4 `gz_x500`; the controller owns only **high-level Offboard commands**. Get the vehicle connection endpoint from Person 1 as soon as the stock simulator starts. Run your controller on the same machine as the final simulator.
2. While Gazebo installs, create a pure policy function that accepts a fixture observation and returns a decision/state plus a bounded velocity command. Test it with fixtures for moving deck, stale deck data, wind disturbance, and obstacle arrival. This work can proceed without the simulator.
3. Once PX4 is up, make the aircraft arm, take off, hold, and disarm in Gazebo using [MAVSDK Python](https://mavsdk.mavlink.io/main/en/python/quickstart.html) and [PX4 Offboard mode](https://docs.px4.io/main/en/flight_modes/offboard). Only then connect the moving deck.

The **14:30 gate** is a stock vehicle holding over a moving deck from live timestamped deck state. If it fails, report the specific PX4 mode/telemetry error; do not hide it with a pre-recorded flight.

## Problem and intended behavior

An aircraft aligned to a deck **now** can make a hard or off-pad contact after the deck moves during descent. Wind changes tracking error, and an obstacle can block a previously safe approach. The controller must make one of four visible decisions: `TRACK`, `DESCEND`, `HOLD`, or `ABORT_AND_RETRY`. It must preserve PX4's inner flight-control loops. Claude Opus may propose *offline* policy changes; it must not send live motor commands.

**P0:** two policy modes on the same PX4 quadrotor and observations:

- `reactive`: tracks the most recently measured pad pose/velocity and applies the same safety rules; it makes no prediction of the pad at touchdown.
- `predictive`: uses a causal history of deck-beacon samples to estimate the pad pose and velocity about 0.2–0.8 seconds ahead, gates descent if expected relative contact speed/tilt is too high, and compensates for observed lateral drift.

Both modes use the **same** obstacle stop/retry and stale-telemetry behavior. Do not deliberately cripple the baseline. Wind resistance is demonstrated by stable tracking and sensible hold/retry under physical gusts, not by claiming an unmeasured capability. No trained data set is required for these classical controllers.

## Shared input/output contract

Person 1 supplies one JSON observation per deck update:

```json
{
  "schema": 1,
  "seq": 247,
  "sim_time_s": 12.35,
  "frame": "ENU",
  "pad_position_enu_m": [2.1, -0.4, 2.8],
  "pad_velocity_enu_mps": [0.2, 0.0, -0.15],
  "pad_rpy_enu_rad": [0.02, -0.04, 0.0],
  "pad_angular_velocity_enu_radps": [0.01, 0.02, 0.0],
  "obstacle": { "valid": true, "range_m": 2.4, "source": "lidar" }
}
```

Read **PX4 aircraft state from MAVSDK**, not from Gazebo truth. Do not read scenario seed, future pad poses, or the obstruction's ground-truth trajectory. Keep `seq`, source timestamp, receive timestamp, and age. Reject malformed/nonfinite data and out-of-order messages. Treat deck observations older than **0.3 simulation seconds** as stale. If the obstacle reading is unavailable during final approach, do not claim the corridor is clear; hold at safe clearance or abort. The controller's output is PX4 Offboard velocity/yaw setpoints plus a structured event log: `sim_time_s`, policy mode, decision, forecast horizon, measured/predicted pad state, aircraft estimate, velocity setpoint, deck age, obstacle status, reason.

The declared simulator frame is Gazebo `ENU=[east,north,up]`; MAVSDK velocity setpoints use `NED=[north,east,down]`. The vector conversion is `[ENU.y, ENU.x, -ENU.z]`. Test the conversion with known vectors before flight. Convert yaw separately; never swap pitch/roll by accident. Use SI units and make the yaw unit explicit: MAVSDK's `VelocityNedYaw` expects **degrees**.

## Flight state machine — exact minimum

1. `TAKEOFF`: get airborne using PX4's supported action. Begin Offboard proof-of-life/setpoint streaming before requesting Offboard, following PX4's documented 2 Hz minimum; use a faster regular stream (for example 10 Hz) and monitor mode loss.
2. `TRACK`: align above the observed pad at a conservative clearance of about 3–5 m. Apply bounded feedforward for current pad velocity. Keep horizontal and vertical command limits configured and logged. Keep both modes on the same bounds.
3. `HOLD`: enter on stale deck data, excessive deck tilt or predicted relative speed, obstacle present/unknown near the pad, or position tracking error outside the descent gate. Hold or climb to clearance; never continue blind descent.
4. `DESCEND`: only when pad alignment, deck data freshness, obstacle clearance, tilt and relative-velocity gates pass. For `predictive`, estimate touchdown horizon from measured clearance and bounded descent rate; forecast with a short rolling fit or filtered velocity/acceleration from **past** samples. Clamp extrapolation and reject spikes. For `reactive`, use the current delayed observation without future lookahead.
5. `ABORT_AND_RETRY`: on a hazard or mode loss during descent, command a bounded climb/retreat to the hold point, wait until clear, and retry once. If the attempt deadline expires or telemetry stays stale, return a safe `NO_LANDING` outcome. A refusal is a legitimate safety outcome; do not call it a touchdown success.

Start with an obstruction threshold such as **1.5 m inside the approach cone**, then tune using actual sensor range and aircraft size. Log the final number. Choose one common touchdown envelope with Person 3 before comparing modes. Do not change the threshold after inspecting held-out results.

## Work you own, end to end

1. Set up the MAVSDK/PX4 connection and a deterministic start/stop routine. Confirm `armed`, `in_air`, and flight mode from PX4 telemetry; handle Offboard-entry failure and safe exit.
2. Implement frame conversion, packet parsing, freshness validation, and bounded control output as small pure functions. Test without Gazebo first.
3. Implement the shared hazard supervisor and flight-state transitions. Prove an obstacle appearing during `DESCEND` produces `ABORT_AND_RETRY` within one controller interval or the first valid sensor update.
4. Implement `reactive` and `predictive` modes with the same aircraft, initial pose, command limits, sensor input, and hazard supervisor. Keep all tunable numbers in one configuration file and log its hash/version.
5. Run `calm`, then `gust`, then `gust_obstacle` with Person 1. Do not advance to a harder case until the previous one flies and produces a complete event log. Give Person 3 the exact run command and log fields early.
6. Let Person 3 run matching seeds. If the proposed mode is worse, adjust on **development seeds only** and rerun the complete matrix. Keep failed runs in the report. Never let a failed landing turn into an invisible process exit.

## Tests and acceptance

- Unit tests for ENU→NED vectors/yaw, timestamp ordering, stale deck, missing obstacle data, command clipping, and causal forecast (changing future simulator data cannot alter past policy output).
- Fixture test: a moving obstacle causes `HOLD`/`ABORT_AND_RETRY`; clearance later allows one retry. A stale deck signal cannot initiate descent.
- Live test: under `calm`, both modes complete a controlled approach. Under physical gusts, controller remains within command bounds and logs tracking error. Under obstacle entry, the aircraft visibly stops descent or retreats before contact.
- Every run exports policy mode, config, setpoints, state transitions, outcome and timestamped telemetry. No source code or runtime uses a real drone; SITL only.

**PR boundary:** controller, adapter and policy tests only. Do not rewrite world motion or evaluation scoring. The remote currently has no `staging` branch: keep work in an isolated safe feature branch and have the repository owner explicitly designate a PR base before integration. Never create or write protected `main`/`staging`; push only with explicit owner authorization. If a live PX4 integration dependency blocks you, continue the pure policy fixture and give Person 1 a precise missing field/error.

## References

[PX4 Offboard](https://docs.px4.io/main/en/flight_modes/offboard) · [PX4 controller diagrams](https://docs.px4.io/main/en/flight_stack/controller_diagrams) · [MAVSDK Python quickstart](https://mavsdk.mavlink.io/main/en/python/quickstart.html) · [PX4 moving-target landing prior art](https://docs.px4.io/main/en/advanced_features/precland). Existing moving-platform landing is prior art; the claim to test here is forecast timing plus hazard-aware decision making under the same simulation conditions.
