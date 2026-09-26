# Deck Landing — PX4 + Gazebo, three sea states

A PX4 X500 quadrotor takes off from a fixed launch platform, chases a moving ship,
and lands on its aft helideck in Gazebo Harmonic. There are three hardcoded
scenarios — **light breeze**, **moderate sea**, and **heavy storm**. Each one pairs a
sea state (ship speed, heave, roll, pitch, yaw, wind, and gusts) with a landing law
tuned for it.

## Run it

These commands run inside WSL Ubuntu 24.04 with PX4-Autopilot at `~/PX4-Autopilot`,
already built with `make px4_sitl gz_x500`:

```sh
cd /mnt/c/Shashank/Wave/work/deck-landing
bash scripts/run_scenario.sh light      # or: medium | storm
bash scripts/run_all.sh                 # all three, then a summary table
```

Each run does the following:

1. Builds the Gazebo plugin once, into `~/.cache/deck-landing/plugin-build`.
2. Regenerates the three worlds from `scenarios.py`.
3. Links the chosen world into PX4's world folder and starts PX4 SITL with Gazebo.
4. Points the Gazebo camera at the ship.
5. Flies the landing.

It then prints a result and writes `reports/<scenario>.json`. The simulation keeps
running afterwards so you can inspect the landed drone. To stop it:
`pkill -x px4; pkill -f "gz sim"`.

The scripts need the system `python3` (for the `python3-gz-transport13`
bindings) and `pymavlink`:
`pip install --break-system-packages pymavlink`.

## What each piece is

| File | Role |
| --- | --- |
| `scenarios.py` | **The hardcoded models.** Sea state, look, and landing law for each scenario, all in one table. |
| `gz/plugin/ShipWaveMotion.cc` | Gazebo system plugin. Moves the ship through the scenario's sea state and blows gusty wind on the drone. |
| `gz/generate_worlds.py` | Writes `gz/worlds/ship_{light,medium,storm}.sdf`: rendered ocean, launch platform, and a ship with a helideck. |
| `bridge/land_on_deck.py` | The landing controller. Reads ship and drone poses from Gazebo and flies PX4 with MAVLink offboard velocity setpoints. |
| `bridge/director.py` | Camera director (live angle cuts) and video recorder, in its own process. |
| `scripts/run_scenario.sh`, `scripts/run_all.sh` | Launch and run. The launcher relaunches once if PX4 fails to come up. |
| `scripts/camera.sh` | Manual camera angles and screenshots. |

### Sea states (prescribed motion — water is rendered, not simulated)

| | Light breeze | Moderate sea | Heavy storm |
| --- | --- | --- | --- |
| Ship speed | 1.0 m/s | 1.5 m/s | 2.0 m/s |
| Heave | ±0.15 m, 6 s | ±0.5 m, 7 s | ±1.1 m, 8.5 s |
| Roll | ±1.5°, 7 s | ±4°, 8 s | ±8°, 9.5 s |
| Pitch | ±0.8°, 5.5 s | ±2°, 6 s | ±3.5°, 7 s |
| Wind (gust σ) | 3 m/s (0.5) | 7 m/s (1.5) | 11 m/s (3.0) |

Each axis is a sum of three sinusoids at incommensurate periods, so the deck
motion is irregular rather than a clean sine. The plugin moves the ship with velocity
commands, the same way gz-sim's VelocityControl system does. This makes the hull a
real moving rigid body: once the motors cut, contact friction carries the drone
along with the ship. The wind is applied as a drag force on the drone's `base_link`
from inside the ship plugin, not through Gazebo's world-level WindEffects system.
PX4 supplies its physics and sensor systems through `server.config`, and Gazebo only
applies that file to worlds without world-level plugins.

### Landing law

The phases run in this order:

1. `CLIMB`
2. `TRANSIT`: match the ship's velocity and aim slightly ahead of the pad.
3. `ALIGN`: hold over the pad.
4. `DESCEND`: descend relative to the deck.
5. `FINAL`: ride the deck heave at the gate height until the deck is quiet enough —
   vertical speed and tilt both under the scenario's limits.
6. `COMMIT`: close at a fixed speed relative to the deck; go around if it drifts.
7. `CUT`: cut the motors a few centimetres above the deck, then confirm the drone
   stays on the pad for 6 s.

The laws get stricter as the weather worsens:

- a tighter gate on deck motion before committing,
- a higher gate height,
- a tighter alignment radius,
- an earlier go-around.

## Results

These are real runs of `scripts/run_all.sh` on this machine, all with the current
landing law. Each run's report is in `reports/`.

| Scenario | Outcome | Touchdown after arming | Offset at touchdown | Closing speed | Deck vz at cut | Deck tilt at cut | Offset after 6 s |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Light breeze | **Landed** | 13.7 s | 0.37 m | 0.77 m/s | -0.14 m/s | 0.4 deg | 0.37 m |
| Moderate sea | **Landed** | 15.5 s | 0.23 m | 0.76 m/s | -0.60 m/s | 1.9 deg | 0.23 m |
| Heavy storm | **Landed** | 16.8 s | 0.49 m | 0.88 m/s | -1.12 m/s | 10.7 deg | 0.59 m |

The pad radius is 3.2 m. The storm touchdown came on a steep and fast-dropping
deck (10.7 deg, falling at 1.1 m/s). The gate was quiet when the drone committed,
but the deck moved into a rough phase during the 1.6 s it took to close. That is
fine for a simulation demo. A real aircraft should use a stricter gate and wait
longer.

History: in the first version of the law, the storm run never landed. Every drift
of more than 1.2 m sent the drone back up to cruise height. The current law holds
height and re-centres instead.

## Camera and videos

- `bridge/director.py` cuts the live Gazebo camera between angles as the landing
  progresses:

  | Phase | Angle |
  | --- | --- |
  | take-off | launch close-up |
  | transit | chase |
  | align | over the helideck |
  | descend | 45 deg close-up |
  | final | deck level |
  | commit | tight 45 deg |
  | touchdown | top down |
  | after touchdown | wide shot of the whole ship |

- It records the GUI and writes captioned MP4s to `videos/<scenario>.mp4`.
  `run_all.sh` also joins them into `videos/all_three.mp4`.
- Videos play in real time. The Gazebo GUI saves only about 5.5 screenshots per
  second, so that is their frame rate. The live window runs at full speed.
- Override the angle at any time from a second terminal:
  `bash scripts/camera.sh close|closer|pad|side|chase|top|wide`, or `shot` to save
  a screenshot.
- The director runs as its own process. Gazebo's Python bindings block the whole
  Python process while a request waits. When the director was inside the flight
  controller, a busy GUI stalled the MAVLink setpoint stream and PX4 went into
  failsafe.

## Honest limits

- **Hardcoded guidance, not a trained model.** The laws in `scenarios.py` were set
  by hand. No policy was trained or optimised for these runs.
- **Ground-truth navigation.** Ship and drone poses come straight from Gazebo. A
  real aircraft would need a ship-relative source — RTK between ship and aircraft, a
  visual marker on the deck, or a telemetry link. Sensor noise and latency on that
  source are not modelled.
- **Illustrative sea states.** The motion is prescribed and non-hydrodynamic. The
  amplitudes are plausible for a small ship but are not calibrated to any vessel.
- **Wind is a linear-drag approximation** on the drone only. There is no ship
  airwake or turbulence behind the superstructure.
- **One run per scenario.** Each result uses a fixed seed. These are
  demonstrations, not a statistical success rate.
- The airframe is the PX4 X500 quadrotor, not a tilt-rotor. `seastate/`, `rl/`,
  and `assets/` hold groundwork for a learned policy that is not yet trained or
  connected to Gazebo:
  - a port of the Ocean Flight Lab sea state, verified to machine precision
    against the JavaScript version;
  - an X500 airframe for gym-pybullet-drones;
  - an inner loop for that airframe;
  - a causal deck-motion forecaster.
