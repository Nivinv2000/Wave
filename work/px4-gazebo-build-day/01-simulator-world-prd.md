# PRD 1 of 3 — PX4/Gazebo world and sensor bridge

**Owner:** Person 1, simulation and environment. **Product:** DeckSafe, a PX4 software-in-the-loop demonstration of landing decisions on a moving ship deck in wind and around an obstruction. **Due:** the team's 15:30 submission; stop adding features at 15:00. This document is your complete work brief. Give Persons 2 and 3 the interface below immediately.

## The first thing to do now

1. In the next 10 minutes, agree with the other owners that the aircraft is PX4's stock `gz_x500` quadrotor, Gazebo is the only flight/world simulator, and the shared telemetry schema below is frozen. Pick **one host machine** to run the judged flight. Write its OS, architecture, PX4 commit, `gz sim --versions`, and launch command in the team chat. The existing browser simulator is a reference and replay aid; it is not the judged flight engine.
2. Run the official stock smoke test: `make px4_sitl gz_x500` from a PX4-Autopilot checkout with submodules and the official simulator toolchain installed. Verify that Gazebo shows the vehicle and PX4 reports a healthy connection. On this Apple Silicon Mac, follow the [official macOS setup](https://docs.px4.io/main/en/dev_setup/dev_env_mac), including its simulator tools, before this command. If another teammate has a working Linux/Gazebo machine, use it instead of making all three people wait for installation.
3. Then try `PX4_GZ_MODEL_POSE=0,0,2.2 PX4_GZ_WORLD=moving_platform make px4_sitl gz_x500` from the PX4 checkout. This is the stock `gz_x500` target with the [moving-platform world](https://docs.px4.io/main/en/sim_gazebo_gz/worlds#moving-platform); verify that this exact combination works on the chosen PX4 revision. The documented standard-VTOL example is a fallback smoke test if quadrotor spawn is problematic; keep the scored aircraft the same in both controller runs. **Tell Person 2 the connection endpoint as soon as PX4 is up.**

The go/no-go gate is **14:00**: a stock PX4 vehicle and a physically moving platform must be visible. If this misses, tell the team immediately. Reduce world customization before sacrificing a working flight.

## Problem and product requirement

A deck-landing controller can align with a pad and still touch down at the wrong moment, lose alignment in wind, or approach a pad that has become occupied. The demo must show the aircraft and environment interacting in **PX4 SITL + Gazebo**, then show a controller that holds or retries when the touchdown is unsafe. It must not claim that synthetic motion is a calibrated ship or that a decorative weather effect applies force to the aircraft.

**P0 world:** the same stock aircraft and launch point, a collision-enabled deck/platform, a moving-deck trajectory, physical wind perturbation, and an obstacle that actually enters the approach/landing corridor. Three named, repeatable scenario presets: `calm`, `gust`, `gust_obstacle`. Each has a seed and fixed start time. A ship-shaped visual is useful; collision geometry and believable pad pose matter more.

**P1 if P0 works:** heave, roll and pitch driven by a small seeded wave composite rather than the stock platform's random motion. Add a visible water plane only after deck motion and landing contact work. Full six-axis hydrodynamics, tiltrotor transition, sea spray, or a detailed hull are outside today's acceptance gate.

## Shared integration contract — freeze with the team

Your bridge emits one JSON **UDP datagram** per update to `127.0.0.1:14670` at **at least 10 Hz of simulation time**. This fixed transport lets Person 2 build in parallel with fixtures. Run the bridge and controller on the same machine for the final integration. Each message is an **observation available to the controller**:

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

`ENU` means `[east, north, up]` in metres; all rates use seconds and radians. Publish **pad-point velocity**, including `angular velocity × pad offset`, not only ship-centre velocity. Give the controller delayed/noisy deck-beacon telemetry if feasible; record the clean Gazebo truth separately for scoring. Never send the future wave seed or future deck state to the controller. `obstacle.range_m` must come from a Gazebo sensor/derived return if labelled `lidar`. If time forces a scripted occupancy beacon, label its source `scenario-beacon` everywhere and tell Person 3; do not describe it as visual perception. When no obstacle return is available, send `valid:false` and `range_m:null`.

Person 2 owns PX4 commands and may use MAVSDK. Person 3 owns the scorer and may read simulator truth. They should not have to edit your world code. Keep launch/scenario inputs stable:

```json
{ "scenario": "gust_obstacle", "seed": 17, "wind_mean_mps": 5, "gust_mps": 2, "obstacle_start_s": 8 }
```

Use this as a **schema example**. Write the exact accepted numeric ranges and launch command in your handoff; do not silently change the agreed fields.

## Work you own, end to end

1. **Environment setup:** clone the official [PX4-Autopilot](https://github.com/PX4/PX4-Autopilot) source with submodules outside the team's source tree; install the official toolchain for the host. Record upstream commit and Gazebo version. Do not modify PX4 upstream in place if a team-owned overlay/world file can do the job.
2. **Stock vehicle smoke test:** start `gz_x500`, confirm takeoff or motor response and that telemetry is reaching Person 2. Re-run from a clean launch once. Capture one screenshot of PX4 and Gazebo running.
3. **Moving deck:** begin with PX4's [stock moving-platform world and plugin](https://github.com/PX4/PX4-Autopilot/blob/main/src/modules/simulation/gz_plugins/moving_platform_controller/README.md). Add a visible pad and collision surface. If adding a custom ship model, use [SDF model/collision definitions](https://sdformat.org/spec?ver=1.12&elem=model). Ensure the deck's reported pose matches the collision deck, not just a visual mesh.
4. **Deck bridge:** publish timestamped pad pose/velocity through the agreed interface. The stock plugin does **not** itself send pad state to PX4; this bridge is mandatory. Test a motion sample with a ruler: nonzero heave or rotation changes pad pose and velocity smoothly and in the expected direction.
5. **Wind:** use Gazebo's wind effect or a Gazebo vehicle force source. Prove it is physical: repeat the same initial aircraft/control conditions with wind off and on, and show a measurable change in aircraft position/attitude. A sky effect alone fails this requirement.
6. **Moving obstruction:** put a collision-enabled object across the approach/landing corridor at a known simulation time. Attach a sensor or publish an explicitly labelled infrastructure beacon. Prove the published obstacle observation changes as the object enters and leaves. Keep obstacle truth available only to Person 3's scorer.
7. **Scenario launch:** expose `calm`, `gust`, `gust_obstacle` through one documented start command or three scripts. Each run must start from the same initial aircraft/deck pose for a given seed. Save the scenario seed and parameters with the log.
8. **Handoff:** give Person 2 a sample live message and vehicle endpoint, and Person 3 the scenario launcher, raw truth output, world version, and one successful recording. Make clear which sensor values are synthetic beacons.

## Checks before marking your lane done

- PX4 and Gazebo start after a fresh restart, with the same aircraft used in all cases.
- Deck collision and visual pad stay aligned while the platform moves; touchdown can make physical contact.
- The pad message has monotonic `seq` and simulation timestamps, finite SI values, and a measured update rate at least 10 Hz. Stopping the bridge causes a detectable stale stream at Person 2.
- `gust` changes actual aircraft motion under the same command. `gust_obstacle` changes a physical object's location and the obstacle observation.
- One launch command, version/commit, known issues, and a short capture are in your PR description. Do not put secrets or `.env` files in the PR.

**PR boundary:** world/model/plugin/bridge/scenario files only. Do not edit Person 2's policy or Person 3's scoring to make a run pass. The remote currently has no `staging` branch: keep work in an isolated safe feature branch and have the repository owner explicitly designate a PR base before integration. Never create or write protected `main`/`staging`; push only when the repository owner explicitly authorizes it.

## Reference pages

[PX4 Gazebo simulation](https://docs.px4.io/main/en/sim_gazebo_gz/) · [PX4 moving-platform world](https://docs.px4.io/main/en/sim_gazebo_gz/worlds#moving-platform) · [moving-platform plugin limitations](https://github.com/PX4/PX4-Autopilot/blob/main/src/modules/simulation/gz_plugins/moving_platform_controller/README.md) · [Gazebo SDF worlds](https://gazebosim.org/docs/harmonic/sdf_worlds/) · [Gazebo system plugins](https://gazebosim.org/api/sim/8/createsystemplugins.html) · [PX4 macOS setup](https://docs.px4.io/main/en/dev_setup/dev_env_mac).
