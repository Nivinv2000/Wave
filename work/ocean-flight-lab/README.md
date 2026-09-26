# Ocean Flight Lab

A local, browser-based ship-deck landing simulator with a 3D ocean, a moving vessel, a physically simulated quadrotor, imperfect sensors, and a controller interface for your own models.

**Version 0.1.0.** This is a working reduced-order engineering test environment. It is not a vessel-calibrated digital twin, a certified safety tool, or a full PX4/Gazebo installation. The equations, approximations, interfaces, and remaining fidelity work are documented below so results can be interpreted correctly.

## 1. Start and use it

Requirements: Node.js 20 or later and a modern WebGL-capable browser. Python 3 is optional, for the external model example. The Three.js rendering library is included locally, so the simulator does not need a CDN, API key, or internet connection after you have the codebase. No drone hardware is needed.

From this directory:

```sh
npm start
```

Open **http://127.0.0.1:4180**. There is no `npm install` step: the server and tests use Node built-ins, and the pinned rendering library is already vendored.

1. Choose a weather preset and wave seed. Adjust wave height, period, wind, gusts, rain, visibility, current, or tide.
2. Expand **Airframe & sensors** for payload mass, starting height, sensor noise, GPS, and deck tracking.
3. Choose a built-in controller, upload a JavaScript module, or connect a local Python model.
4. Click **Apply & reset scenario** or **Attach model & reset flight**.
5. Click **Run simulation**, or **Step 0.05 s** to inspect one controller interval.
6. Use **Follow**, **Drone**, **Orbit**, or **Top** to inspect motion. Orbit mode supports mouse drag and wheel zoom.
7. Watch the command, inference duration, sensor ages, four motor thrusts, battery, clearance, deck roll/pitch, and telemetry.
8. Download the entire episode with **Export flight log**. It includes configuration, controller identity/options, sensor observations, truth, commands, and the final outcome. An uploaded module's SHA-256 digest identifies the exact code; preserve the original module separately.

Changing form values does not change the running physics until reset. Changing the model dropdown does not attach the new model until **Attach model & reset flight**. The displayed speed is a requested wall-clock playback rate; slow rendering or inference can reduce it, while simulation time and physics steps remain fixed.

The app pauses on touchdown, a collision, water impact, an exceeded test boundary, the episode deadline, or a model error. Model timeouts pause the simulation rather than silently substituting another policy. Reattach a failed/timed-out JavaScript worker before resuming.

## 2. What is built

- Seeded irregular **JONSWAP-shaped wave spectrum**, normalized to configured significant wave height, with directional spreading and deep-water dispersion.
- A six-axis vessel response: surge, sway, heave, roll, pitch, and yaw. The landing pad has an offset from the centre; its motion includes translation and rotation.
- Independent wind, gusts, rain/visibility, current, and slow tide settings. A deliberate large-wave pulse is a separate stress test.
- A quadrotor with position/velocity, quaternion attitude, angular velocity, rigid-body inertia, gravity, drag, rotor thrust/torque mixing, motor lag, and an approximate battery/voltage effect.
- Simulated IMU, GPS, barometer, magnetometer, deck tracker, and downward rangefinder, with sampling, noise, bias, delivery latency, and dropped/missing measurements.
- A simple complementary navigation estimate derived from delivered sensor measurements. Built-in stabilization uses this estimate.
- Three local example controllers: reactive landing, measured-motion predictive landing, and deck following at fixed clearance.
- A JavaScript model plugin interface in a dedicated worker and a local HTTP bridge for Python/ONNX/PyTorch or other runtimes.
- A live 3D dashboard, command display, telemetry, sensor ages, motor thrust bars, episode outcomes, and JSON log export.
- A headless batch runner using the **same physics code** as the browser and automated integration tests.

There is no self-improvement agent in this version. This is the environment on which that agent or your trained controller can be tested. SMAF, pull-request generation, and deployment approval are separate future layers.

## 3. Weather and tides

| Preset                     |             Hs | Peak period | Mean wind | Gust RMS | What it exercises                                                                                                      |
| -------------------------- | -------------: | ----------: | --------: | -------: | ---------------------------------------------------------------------------------------------------------------------- |
| Light breeze               |         0.35 m |       4.5 s |   2.5 m/s |  0.7 m/s | Basic alignment and landing; use first when integrating a model.                                                       |
| Moderate sea               |          1.3 m |       6.5 s |     7 m/s |    2 m/s | Deck motion and wind compensation.                                                                                     |
| Severe storm               |          4.5 m |         9 s |    18 m/s |    5 m/s | Strong disturbances, rain, tracker degradation, and possible inability to land.                                        |
| Long ocean swell           |            2 m |        13 s |     4 m/s |    1 m/s | Long-period vessel motion with relatively modest local wind.                                                           |
| Spring tide + moderate sea |          1.3 m |       6.5 s |     7 m/s |    2 m/s | Higher tide level/range and stronger prescribed current, independent of storm intensity.                               |
| Focused large-wave event   | 2 m background |         8 s |    10 m/s |    3 m/s | A deliberately added travelling large-wave pulse. This is a stress test, not a validated rogue-wave probability model. |

**Hs** is significant wave height: approximately the average of the highest third of waves, represented spectrally by `Hs = 4 * sqrt(m0)`. It is not the amplitude of every individual wave. A particular crest may be larger or smaller.

Full and new moons can produce **spring tides**: a larger range between high and low tide over hours. They do not directly create a sudden storm or tsunami. The simulator uses a 12.42-hour sinusoidal tide. Over a 120-second episode its level changes only slightly. Selecting High tide changes the starting phase rather than speeding up the tide. Mean current is prescribed independently; this version does not compute current from coastal bathymetry or tidal hydrodynamics.

Rain changes the visible scene and the optical tracker's dropout and latency. Visibility reduces tracker range and increases scene fog. It does not model raindrop aerodynamics, icing, a fluid wind field around the superstructure, or spray covering a physical lens. The radio beacon option avoids the optical visibility dependency but still has delivery delay, measurement noise, and random dropouts.

## 4. Coordinate frames and timing

All distances are metres; time seconds; velocity m/s; acceleration m/s²; angles radians; angular velocity rad/s; mass kilograms; thrust newtons.

- **World frame: NWU** — x north, y west, z up, with a local origin at the ship's initial nominal location.
- **Ship/drone body:** x forward, y port/left, z up. Positive roll/pitch/yaw follow the right-hand rule.
- Euler angles use the ZYX convention. Quaternions are `[x, y, z, w]`.
- Position/GPS values are local Cartesian coordinates, not latitude/longitude.
- Physics integrates at **200 Hz** (`dt = 0.005 s`). The model runs at **20 Hz** (`dt = 0.05 s`). Each command is held for ten physics steps.
- Observations contain simulation timestamps and measurement ages. Never assume a delivered sensor packet was sampled at the current time.
- Policy inference is **lockstep**: the simulator waits for a response before advancing. Its measured wall-clock inference duration is displayed, but it is not injected as additional physical command delay. Motor lag and sensor delivery delays are simulated. Real-time deadline/communication-latency testing needs an additional delayed-command model.

## 5. Attach a JavaScript model

Choose **Upload JavaScript controller**, select `examples/follow-and-land.mjs`, and click **Attach model & reset flight**. The example can be copied and replaced with your own logic. Modules must export `createController(options)`, which returns an object with `step(observation)`. `step` can be synchronous or async.

```js
export function createController(options = {}) {
  let recurrentState = null;
  return {
    step(observation) {
      // Read estimate and timestamped sensors. Keep recurrent state here.
      // Preprocess -> your model inference -> map output to one command.
      return {
        mode: "velocity",
        velocity: [0, 0, 0], // world-frame m/s
        yaw: 0, // radians
        label: "My controller: hover",
      };
    },
  };
}
```

Options entered in the dashboard are passed to the factory. The factory is called again on every reset, so episode state should start there. The upload accepts one self-contained `.mjs` or `.js` module up to 2 MB. Relative imports from the uploaded blob are not supported. Bundle dependencies into a single module or use the Python bridge for large neural networks and weights. The controller is not trained by uploading it.

The worker receives only observations, not the simulation instance, true trajectory, wave seed, future samples, or hidden vessel state. Its network access is blocked by the worker's response policy. This improves separation and protects UI responsiveness, but the local application is intended for **trusted model code**, not as a hardened public execution service. A controller that does not respond within 700 ms is terminated and the simulation pauses. Module initialization has a 2-second timeout.

### The observation

```js
{
  time: 3.25,
  dt: 0.05,
  frame: 'world NWU ...',
  estimate: {
    position: [x, y, z],
    velocity: [vx, vy, vz],
    euler: [roll, pitch, yaw],
    omega: [wx, wy, wz]
  },
  sensors: {
    imu: { accel: [ax, ay, az], gyro: [wx, wy, wz], sampleTime, age, valid },
    gps: { position: [x,y,z], velocity: [vx,vy,vz], sampleTime, age, valid },
    barometer: { altitude, sampleTime, age, valid },
    magnetometer: { yaw, sampleTime, age, valid },
    deck: { position, velocity, euler, angularVelocity, radius, source,
            sampleTime, age, valid },
    rangefinder: { range, surface: 'deck', sampleTime, age, valid }
  },
  deck: null, // or latest valid deck packet; null when absent/stale
  health: { gpsAge, deckAge, delivered, dropped },
  battery: 0.99,
  mission: { landingGearHeight: 0.28, duration: 120 }
}
```

This is a shape illustration; names such as `x` and `sampleTime` stand for numeric values. A sensor key can be absent before its first packet or when disabled. A retained packet has `valid: false` once too old; `deck` becomes `null` after 0.5 seconds without a fresh enough packet. GPS validity allows up to 1 second; other sensor validity limits are 0.5 seconds. Check validity/age before using data. The IMU accelerometer measures body-frame **specific force**; a stationary level aircraft measures approximately `[0, 0, +g]`, not zero. Initial navigation position/velocity are initialized from the known simulated spawn pose; this does not represent real startup localization uncertainty.

### Supported commands

**Velocity command** — use the simulated onboard position/attitude loops:

```json
{
  "mode": "velocity",
  "velocity": [0.7, 0, -0.25],
  "yaw": 0,
  "label": "Descend"
}
```

Velocity components are limited to ±6 m/s. Acceleration demands are limited, converted to desired roll/pitch and collective thrust, then allocated to rotors. This is the easiest route for a high-level landing model.

**Position command** — target a world position through a proportional position loop and the same stabilization:

```json
{
  "mode": "position",
  "position": [10, 0, 8],
  "yaw": 0,
  "label": "Hold clearance"
}
```

**Direct motors** — bypass the high-level autopilot and control each rotor:

```json
{
  "mode": "motors",
  "motors": [0.49, 0.49, 0.49, 0.49],
  "label": "Raw actuator model"
}
```

Each motor value is a normalized thrust request in `[0,1]`, **not RPM or PWM**. Actual thrust is affected by the battery limit and 55 ms motor lag. Rotor positions are `(+x,+y)`, `(-x,+y)`, `(-x,-y)`, `(+x,-y)` in order, with alternating yaw torque signs `+,-,+,-`. The example constant values are an approximate level-hover feedforward for the default mass, not a stabilizing controller.

Invalid vectors, non-finite values, unsupported modes, and out-of-range motor requests are rejected. A `label` is optional and appears in the live execution log. The dashboard displays truth-derived metrics for evaluation; those are not automatically passed to the model.

## 6. Attach a Python, PyTorch, ONNX, or other local model

The app includes a generic local HTTP bridge. The included Python file uses only the standard library so you can prove the connection first:

```sh
python3 examples/python_controller.py
```

Keep `npm start` running in a second terminal. Choose **Python / HTTP model** in the dashboard and attach it.

Replace `policy(observation)` in the example with your preprocessing, inference, and output conversion. Load weights once at module startup. Keep recurrent state in your service and clear it on `POST /reset`; the provided example is stateless. Install your model's own dependencies separately in a Python virtual environment. This project does not bundle PyTorch, ONNX Runtime, or any trained model.

Protocol:

- `POST http://127.0.0.1:8765/reset` with `{}`: return `{"ok":true}` after resetting episode state.
- `POST http://127.0.0.1:8765/step` with `{"observation": ...}`: return one supported command object as JSON.
- The browser calls the local Node server, which forwards to this loopback endpoint. No CORS configuration is required on the model service.
- Requests are bounded; the server allows 2 seconds for the local service and reports failures in the dashboard.
- `MODEL_ENDPOINT=http://127.0.0.1:PORT npm start` selects another **loopback HTTP** service. The server rejects remote model endpoints by default.

Never treat absent sensor fields as zero measurements. Normalize features to the units above and train/validate against the actual observation stream. A neural policy trained on perfect states may fail with delayed, noisy measurements.

## 7. Physics and its limits

### Ocean

`public/core/environment.mjs` discretizes a JONSWAP-shaped spectrum into 28 frequency components from 0.35 to 2.8 times the peak frequency. Component energies are normalized so `sum(a_i² / 2) = (Hs / 4)²`. Random seeded phases and a bounded angular spread produce a deterministic directional sea:

```text
eta(x,y,t) = tide(t) + sum a_i sin(k_i * (direction_i · [x,y]) - omega_i*t + phase_i)
omega_i² = g * k_i  (deep-water dispersion)
```

The scene surface and the physical vessel sample the same wave function. Wind is a prescribed mean vector plus an Ornstein-Uhlenbeck-style correlated gust process. A fixed seed controls physical randomness. Decorative rain particles are visual only and do not affect deterministic outcomes.

This implementation assumes deep water. There is no shallow-water shoaling, surf breaking, coastal tsunami propagation, nonlinear wave-vessel coupling, flooding, slamming, or oceanographic forecast assimilation. The large-wave preset adds a travelling Gaussian pulse; it is explicitly an illustrative stressor rather than a statistical rogue-wave model. Rendering may undersample the shortest visual waves, but physics samples the analytic wave function directly.

### Vessel

Five hull sampling locations (centre, bow, stern, port, starboard) provide approximate local elevation and slope. Independent damped second-order response axes filter these into surge, sway, heave, roll, pitch, and yaw. The vessel starts after a short response warmup; otherwise every run would begin with an arbitrary zero-motion transient.

The response uses illustrative natural periods `[8, 9, 3.8, 5.2, 4.6, 10]` seconds and damping ratios `[0.9, 0.9, 0.7, 0.5, 0.7, 0.9]` for the six axes. These are **not measured coefficients for a particular ship**. Mean speed and current set translation; this is not a full propulsion/rudder or hydrodynamic-force solver.

The pad velocity includes `v_ship + omega_world × r_pad`, so a pad away from the rotation centre moves differently from the centre. Vessel dimensions are 16 m long by 5.8 m wide with 2 m nominal freeboard. The pad centre is 3.2 m aft and 0.05 m above the nominal deck, with a 1.8 m radius.

For an actual vessel, replace this response with measured response amplitude operators or a validated six-axis hydrodynamic model including mass, added mass, damping, restoring forces, geometry, and heading-dependent wave excitation. Fossen's formulation and Gazebo's maritime plugins are reference paths, not engines already embedded in this app.

### Aircraft

The drone integrates Newton-Euler rigid-body equations using fixed 5 ms semi-implicit steps and a normalized quaternion. Rotor thrust acts along body +z. Differential thrust generates roll/pitch moments, alternating rotor torque generates yaw, and inertia/gyroscopic terms affect angular acceleration. Quadratic drag uses relative airspeed, air density 1.225 kg/m³, and illustrative drag area 0.10 m².

Defaults: 3 kg mass, 0.32 m rotor arm radius, maximum 15 N per rotor, inertia `[0.055, 0.055, 0.095]` kg·m² scaled with mass, 55 ms motor lag, and 0.28 m landing gear clearance. Maximum thrust falls with state of charge. Battery is an 80 Wh illustrative energy budget with a thrust-based power approximation. It is not an identified propulsion, electrical, or battery model.

High-level control is a simple cascaded position/velocity/attitude PD controller. It is not PX4, a tiltrotor, or a proprietary airframe. Increasing mass to 10 kg deliberately makes this 60 N-thrust aircraft unable to hover; the mass control represents an experiment, not automatic motor resizing. Aerodynamic blade physics, ground effect, rotor-wake/deck interaction, and VTOL transition are absent.

### Sensors and estimation

At the default noise multiplier of 1:

| Sensor               |   Rate | Delivery delay | Illustrative errors                                                                                       |
| -------------------- | -----: | -------------: | --------------------------------------------------------------------------------------------------------- |
| IMU                  | 200 Hz |           5 ms | Accel white noise 0.09 m/s², gyro noise 0.0025 rad/s, biases and accel-bias random walk.                  |
| GPS                  |   5 Hz |         140 ms | Position noise 0.35 m, velocity noise 0.10 m/s, 1% random packet loss; switchable.                        |
| Barometer            |  25 Hz |          40 ms | Altitude noise 0.06 m and slow bias drift.                                                                |
| Magnetometer heading |  20 Hz |          30 ms | Heading noise about 1 degree.                                                                             |
| Deck tracker         |  20 Hz |     100–200 ms | Position/velocity/orientation noise; optical range, rain-dependent dropout, or a local radio alternative. |
| Downward rangefinder |  20 Hz |          25 ms | Range noise 0.025 m, 20 m limit, rain dropout, a simplified deck/water return.                            |

The estimator integrates gyro and accelerometer readings and corrects position/velocity with GPS, altitude with barometer, and heading with magnetometer. It is a simplified complementary observer; it is not a full PX4 EKF or a complete model of GNSS multipath, electromagnetic interference, camera image processing, or sensor hardware. The rangefinder is a simplified geometric measurement, not a ray-traced LiDAR. Noise multiplier 0 removes Gaussian noise terms but preserves fixed bias, sampling delay, and applicable packet-loss processes. Disable sensors independently to study missing information.

### Contact and outcomes

Contact is a simplified deck-plane/foot-height check plus a box for the superstructure and the analytic water surface. No elastic landing-gear, frictional deck dynamics, rotor collisions with rails, or post-touchdown sliding are simulated. The episode stops at first contact.

A default `landed` outcome requires all of:

- Inside the pad's 1.8 m radius.
- Relative normal contact speed below 0.7 m/s.
- Relative tangential speed below 1 m/s.
- Relative roll/pitch difference below 0.26 rad (about 15 degrees).
- Deck roll/pitch magnitude below 0.35 rad (about 20 degrees).

These are **illustrative simulator acceptance thresholds**, not limits supplied by an aircraft manufacturer. Other outcomes include `hard-contact`, `water-impact`, `collision`, `out-of-bounds` (250 m), `timeout`, or `invalid`. A hover timeout is not a successful landing. Compare landing availability, unsafe contacts, and abstentions separately.

## 8. Parameter reference

Parameters live in `DEFAULTS`, `PRESETS`, and `makeConfig()` in `public/core/environment.mjs`. Dashboard fields expose the common subset.

| Parameter                             | Default / unit             | Meaning                                                             |
| ------------------------------------- | -------------------------- | ------------------------------------------------------------------- |
| `seed`                                | 17                         | Unsigned integer; controls waves, wind, sensors.                    |
| `preset`                              | `light`                    | One of `light`, `medium`, `extreme`, `swell`, `spring`, `rogue`.    |
| `hs`, `tp`, `gamma`                   | 0.35 m, 4.5 s, 3.3         | Significant height, peak period, spectral peak enhancement.         |
| `waveDirection`                       | 0.6 rad                    | Direction in which the analytic wave travels in the world XY plane. |
| `wind`, `gust`, `windDirection`       | 2.5 m/s, 0.7 m/s, 0.35 rad | Mean wind, gust scale, and direction the air moves.                 |
| `rain`, `visibility`                  | 0, 1500 m                  | Visual weather and optical-tracker degradation.                     |
| `current`                             | 0.15 m/s                   | Prescribed drift component added to world x motion.                 |
| `shipSpeed`, `heading`                | 0.5 m/s, 0 rad             | Nominal vessel forward speed and initial heading.                   |
| `tideAmplitude`, `tidePhase`          | 0.4 m, 0 rad               | Tide half-range and starting phase; 12.42-hour period.              |
| `noise`                               | 1                          | Gaussian sensor-noise multiplier.                                   |
| `gpsEnabled`, `trackerEnabled`        | true                       | Availability switches.                                              |
| `trackerSource`                       | `vision`                   | `vision` or `radio`.                                                |
| `droneMass`                           | 3 kg                       | Aircraft mass; inertia scales with it, motor capacity does not.     |
| `initialHeight`, `initialOffset`      | 7 m, -6 m                  | Initial altitude and world-x offset relative to pad.                |
| `duration`                            | 120 s                      | Maximum simulated episode length.                                   |
| `shipLength`, `shipBeam`, `freeboard` | 16 m, 5.8 m, 2 m           | Reduced-order vessel geometry.                                      |
| `padOffset`, `padRadius`              | [-3.2, 0, 0.05] m, 1.8 m   | Local target geometry.                                              |

Geometry changes through code must also be reflected in `scene.mjs`; the current visual mesh uses the default geometry. Keep physics and visuals synchronized when adding custom vessels. The browser form intentionally does not expose unsupported automatic custom-airframe import.

## 9. Headless tests and batches

```sh
npm test
node batch.mjs --weather light --controller predictive --seed 17 --runs 5
node batch.mjs --weather medium --controller reactive --seed 17 --runs 5
node batch.mjs --weather extreme --controller predictive --duration 40 --runs 5
node batch.mjs --weather light --model examples/follow-and-land.mjs --runs 3
```

The batch runner writes outcome JSON under `reports/`. `--output reports/my-run.json` overrides the output filename. Keep output paths inside existing directories. It uses the same `Simulation` and controller contracts as the browser. The CLI imports model code directly in Node and therefore should be used only with trusted modules; it does not impose the browser worker timeout or isolation.

To compare models, freeze weather settings, seed lists, duration, physics version, sensor settings, and evaluation thresholds. Preserve every result, including failed attempts and timeouts. Use separate development and held-out seed sets. The codebase does not automatically conceal an evaluation set from a model author; that is an evaluation-process responsibility.

The automated tests cover reproducibility, spectral normalization, slow tide timescale, sensor delay and outages, observation separation, command validation, finite dynamics across all weather presets, light-weather landing, no-thrust impacts, body/world transforms, rotational pad velocity, and the uploaded-model contract. Passing these checks verifies implementation properties; it does not establish physical accuracy for a real vessel.

## 10. Code map

```text
ocean-flight-lab/
  server.mjs                   Static server + loopback model proxy
  batch.mjs                    Headless episodes
  package.json                 Start/test/batch commands; no npm dependencies
  README.md                    This guide
  public/
    index.html, style.css      Dashboard
    app.mjs                    Playback, model attachment, telemetry, export
    scene.mjs                  Three.js ocean, vessel, drone, camera, rain
    model-runner.mjs           Built-in / worker / Python policy execution
    controller-worker.mjs      Uploaded module lifecycle and messages
    core/
      math.mjs                 Vector/quaternion math, seeded RNG
      environment.mjs          Waves, tide, wind, vessel response, presets
      drone.mjs                Drone dynamics, autopilot, rotor mixing
      sensors.mjs              Sensor sampling, latency, estimation
      simulation.mjs           Episode stepping, contact evaluation, logs
    controllers/builtin.mjs    Predictive / reactive / hover examples
    vendor/                   Pinned Three.js 0.170.0 + OrbitControls + MIT license
  examples/
    follow-and-land.mjs        Uploadable JS policy
    python_controller.py      Local HTTP inference adapter
  tests/simulator.test.mjs     Automated checks
  reports/                    Saved batch outcomes
```

## 11. Research and future fidelity work

The implementation is informed by these primary references; citing them does not imply this lightweight simulator implements their complete models:

- [OpenFAST SeaState input documentation](https://openfast.readthedocs.io/en/dev/source/user/seastate/input_files.html): irregular JONSWAP/Pierson-Moskowitz seas, height/period/spectrum settings.
- [NOAA: spring and neap tides](https://oceanservice.noaa.gov/facts/springtide.html) and [perigean spring tides](https://oceanservice.noaa.gov/facts/perigean-spring-tide.html): moon/solar alignment, tidal range, and timescale.
- [Fossen's marine craft model](https://www.fossen.biz/html/marineCraftModel.html): full six-degree-of-freedom marine dynamics, added mass, damping, and restoring effects; a target for future calibrated vessel integration.
- [Gazebo buoyancy](https://gazebosim.org/api/sim/8/theory_buoyancy.html) and [hydrodynamics system](https://gazebosim.org/api/sim/9/classgz_1_1sim_1_1systems_1_1Hydrodynamics.html): reference path for a richer maritime simulator.
- [PX4 simulation](https://docs.px4.io/main/en/simulation/), [controller diagrams](https://docs.px4.io/main/en/flight_stack/controller_diagrams), and [Offboard Mode](https://docs.px4.io/main/en/flight_modes/offboard): reference for replacing the small autopilot with real PX4 SITL.
- [ArduPilot ship landing](https://ardupilot.org/plane/docs/common-ship-landing.html): existing moving-platform landing capability and relevant prior art.
- [NOAA NDBC historical observations](https://www.ndbc.noaa.gov/historical_data.shtml): possible sea-condition inputs; these are not ship-pose measurements.
- [RMA maritime landing datasets](https://mecatron.rma.ac.be/index.php/publications/datasets/): ship IMU prediction and visual-localization research data for a future calibration/validation stage.
- [Three.js](https://threejs.org/): local rendering library, vendored under its MIT license.

For an actual ship/airframe: collect synchronized vessel IMU/pose, aircraft state, sensor quality, commands, weather, and landing outcomes; identify vessel response and motor/aerodynamic parameters; validate held-out voyages; replace the lightweight autopilot with PX4 SITL/HIL; and model deck contact and communications appropriate to the aircraft. Treat the current output as evidence about controller behaviour **inside these documented assumptions**.
