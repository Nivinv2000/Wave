# Opus Build Day: setup, architecture, and reference pack

Prepared 26 September 2026 (Bengaluru time). This is a working plan for a **simulation demo**, not a validated flight system. The [public Luma page](https://luma.com/claude-x5dm) currently lists **Saturday 26 September, 09:00–19:00**. Check the date in the approved registration email immediately; the team's supplied submission deadline is 15:30.

## Decision in one minute

| Path | What it proves | Downloads needed on this Mac | Risk for today's deadline |
| --- | --- | --- | --- |
| **A. Browser-first landing lab (recommended deliverable)** | Same seeded deck motion, current-state versus forecast-based landing, visible touchdown metrics; an Opus flight-test trace | None for the core simulation: Node and Python are installed. Add a small package only if the chosen implementation needs it. | Manageable if the team builds and tests one end-to-end scenario first. |
| **B. PX4 SITL + Gazebo moving platform (parallel technical spike)** | An actual PX4 VTOL frame operating in Gazebo on a moving deck | PX4 source/submodules, PX4 macOS simulation toolchain (including Gazebo Harmonic and XQuartz), optionally MAVSDK/QGroundControl | High. The stock platform does **not** yet supply deck telemetry to PX4 or the wave-driven landing controller. |
| **C. Full six-degree-of-freedom vessel dynamics** | Synthetic or hydrodynamically modelled surge, sway, heave, roll, pitch, yaw, coupled to landing | All of B, plus vessel motion plugin/code and possibly a community wave/hydrodynamics plugin | Research project. Do not make this the dependency for the 15:30 submission. |

**Hardware:** No drone, Pixhawk, radio, physical ship, or sensor is needed for any software-in-the-loop path. Bring a charged laptop, charger, reliable internet/hotspot, and a phone for the mandatory physical photos and handwritten note. A controller/gamepad is optional and unnecessary. The hosted demo must run independently of the laptop after submission.

## What I checked on this Mac

- Apple Silicon Mac, macOS 27.0, roughly 126 GiB free storage.
- Present: Apple Command Line Tools, Homebrew, Git, Python 3.13.2, Node 22.23.1, Claude Code 2.1.277, `make`.
- The open-file limit is 1,048,575, so the PX4 guide's suggested increase to 2,048 is already satisfied.
- Not found: `gz`/Gazebo, Docker, CMake, Ninja. PX4 source was not found in this task's folder. No Git repository is attached to this task.
- **Nothing has been installed or downloaded yet.** Authentication, Anthropic credits, and hosting account status have not been checked. The PX4 setup script can require a password and an XQuartz logout/login, so allow time for that rather than starting it during the final sprint.

## What to do now, in order

1. **Confirm date, attendance, and rules.** Check the Luma-approved email and that the team is exactly three people. Ask the organizer whether pre-event code or prepared assets are allowed; keep the actual on-site build within those rules. Use only each attendee's approved email to redeem credits; do not share the credit link.
2. **Pick one owner per lane.** Person 1: simulator/visuals. Person 2: controllers, telemetry, and metrics. Person 3: Opus integration, demo, hosting, and submission evidence. The third person should prompt everyone to take real photos during the build.
3. **Choose Path A as the deliverable.** It can be built with the installed Node/Python stack and hosted as static files. Implement one seeded run and one result metric before adding sea-state controls or polished visuals.
4. **Run Path B only as a time-boxed spike.** If PX4/Gazebo is not running reliably after the initial setup window, stop integrating it into today's judged demo. Keep it as the post-event research path.
5. **Prepare accounts and power.** Sign in to Claude Code/Anthropic Console with the approved account, confirm the event model and usable credits, and choose a hosting account. Keep the Mac on its charger. A foreground Claude Code process can be wrapped with macOS `caffeinate -i` to prevent idle sleep; record state to disk so an interrupted session can be restarted. Set a cost/iteration cap; a prompt alone does not guarantee an agent will run indefinitely.
6. **Freeze features by 14:45.** Test the hosted URL from a second device or private browser window, then capture the video, photos, close-ups, behind-the-scenes image, and handwritten note. Submit by 15:30 with the live URL kept online for a month.

### Accounts, downloads, and installation matrix

| Item | Need now? | Why / setup |
| --- | --- | --- |
| Claude Code | Already installed | Sign in and verify the **event's required Opus model**. Fable 5.1 can be used for difficult coding work, but the judged artifact should visibly use the model the event asks teams to explore. [Model list](https://platform.claude.com/docs/en/models/overview), [Fable 5.1 notes](https://platform.claude.com/docs/en/models/fable-5-1/whats-new-fable-5-1), [loop guidance](https://claude.com/blog/getting-started-with-loops). |
| Anthropic Console and credits | Yes, attendee action | Use the Luma-approved email and the attendee's own credit link. Store API credentials in environment variables or the host's secret store, never in client-side JavaScript, screenshots, Git, or this document. |
| Node/Python | Already installed | Enough for a browser simulation and local test runner. Use a project-local environment if dependencies are added. |
| Browser-first visualization | No fixed download | A small HTML/Canvas app can run without a framework. If the team chooses React/Vite, install only that project's packages. Avoid a heavy 3D engine until the physics and metrics work. |
| Static hosting | Account needed by deployment | [Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/) can host built files without a Git push. It supports drag-and-drop or Wrangler. A static site needs no server or exposed API key. |
| Live Opus API inside hosted app | Optional, higher effort | Requires a server-side function and secret storage. Never call the Anthropic API directly from public browser code with an embedded key. An authentic, recorded flight-test trace can accompany a fully live static simulator if the backend is not ready. |
| PX4 + Gazebo Harmonic + XQuartz | Path B only | Use [PX4's Apple Silicon macOS setup](https://docs.px4.io/main/en/dev_setup/dev_env_mac), not a mix of old Gazebo Classic instructions. PX4's setup script installs required development packages, including CMake/Ninja and simulation packages. |
| QGroundControl | Optional Path B | Helpful to inspect/manual-test SITL, but not required for the browser demo. [PX4 QGC daily build guidance](https://docs.px4.io/main/en/dev_setup/qgc_daily_build). |
| MAVSDK Python | Optional Path B | Simpler external MAVLink control than a full ROS 2 setup. [MAVSDK Python QuickStart](https://mavsdk.mavlink.io/main/en/python/quickstart.html). Use it only after PX4 and a platform telemetry source work. |
| Ocean/wave plugin | Optional Path C | [asv_wave_sim](https://github.com/srmainwaring/asv_wave_sim) has wave and hydrodynamics plugins. Its README targets Gazebo Garden or later and documents macOS builds; verify compatibility with this machine's Gazebo Harmonic and macOS 27 before relying on it. |

## Path A: what the simulator must model

### 1. Deck and sea motion

The first scenario needs only **heave** (vertical deck motion) and **pitch/roll** if the latter is visible in the landing result. Represent the sea as a seeded sum of sinusoidal components, then derive deck motion from it. Add sensor noise and a finite observation rate. If using JONSWAP or Pierson–Moskowitz, generate wave elevation from that spectrum; do **not** call a synthetic deck motion a physically calibrated ship model. [OpenFAST SeaState input documentation](https://openfast.readthedocs.io/en/dev/source/user/seastate/input_files.html) documents JONSWAP/PM stochastic-wave inputs. Its [HydroDyn manual](https://openfast.readthedocs.io/en/main/source/user/hydrodyn/index.html) shows the additional hydrodynamic modelling needed for a floating structure.

For a later six-axis synthetic model, define deck-center pose `q(t) = [x, y, z, roll, pitch, yaw]`. A landing point is obtained by rotating the pad's offset from the ship center and adding the ship translation. At contact, compute deck-point velocity from translation **plus** `angular_velocity × offset`; compare aircraft velocity with that local deck velocity. This matters because a deck corner can move vertically faster than the deck center during roll/pitch. Keep units, axes, and time stamps explicit.

For a lightweight fitted predictor, choose a small set of wave frequencies from *past* samples and fit sine/cosine coefficients by least squares, then evaluate that fitted curve at touchdown time. The optional Python references are [NumPy least squares](https://numpy.org/doc/stable/reference/generated/numpy.linalg.lstsq.html) and [SciPy Welch spectral estimation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.welch.html). If the browser app uses JavaScript, the same small calculation can be implemented locally without downloading Python packages. Separate the **truth generator** from the **predictor** in code and tests to make future-information leakage easy to audit.

A *hydrodynamically justified* 6-DOF ship response needs vessel geometry, displacement/inertia, damping/added mass or response-amplitude operators (RAOs), wave direction, and sea-state parameters. None of the vessel-specific values have been supplied. An illustrative six-axis motion can be built without them, but it must be labelled synthetic. A visually moving ocean surface alone does not calculate ship motion.

### 2. Aircraft and two controllers

- Model the same aircraft mass/response delay, approach path, descent authority, observation latency, and safety envelope for both controllers. A minimal model can use fixed descent time and limited vertical acceleration.
- **Reactive baseline:** use the deck state measured now to decide whether to descend; track present deck pose. It may use current measured velocity, but does not evaluate a future touchdown state.
- **Predictive:** estimate deck pose and local velocity at the expected touchdown time from past and current observations, then choose or defer the descent. A short harmonic fit or other simple causal forecast is enough for the demonstration. Never read the simulator's hidden future wave seed or future samples from this controller.
- Score the same conditions: inside the pad, acceptable relative vertical speed at contact, and acceptable deck attitude. Report the raw contact values as well as success/failure. Use several held-out seeds, not only a selected failure of the baseline.

**Prior art to acknowledge:** [ArduPilot Plane 4.2+ moving-platform VTOL landing](https://ardupilot.org/plane/docs/common-ship-landing.html) already tracks a beacon-equipped platform. [PX4 precision landing](https://docs.px4.io/main/en/advanced_features/precland) already has moving-target handling and moving-target prediction-time parameters; its page describes multicopter precision landing. Frame the new claim narrowly as **forecasting wave-driven deck pose/velocity at touchdown to time the landing transition**, then demonstrate it fairly. Do not describe either autopilot as an intentionally failing “reactive controller.”

For a PX4-backed controller, preserve PX4's existing inner control loops and modify only the high-level touchdown timing/setpoint logic. [PX4 controller diagrams](https://docs.px4.io/main/en/flight_stack/controller_diagrams) explain the cascaded position, velocity, attitude, and rate controllers. A custom airframe is a separate model-integration task, not a prerequisite for this comparison.

### 3. Opus's actual role

Use Opus as a flight-test engineer with bounded tools: inspect a failed trace, propose a forecast/controller parameter change, run simulation, and accept the change only if held-out metrics improve. Preserve the genuine tool/result trace for the judges. The fast numerical control loop should remain deterministic. The model used, its exact version, the tool calls, and the before/after evaluation must be visible. If the previous model failed a comparable task, show a real comparison; do not invent one.

### 4. Minimal completion checks

The app must start on a second machine/browser; both controllers must run on the same seed; forecasts must not access future truth; the safe-landing definition must be identical; at least ten seeded outcomes and one fresh live outcome must be reproducible; the public URL must work after the developer laptop is disconnected. Keep a recorded video as a fallback for venue Wi-Fi failure, clearly identified as recorded if played.

## Path B: official PX4/Gazebo setup on this Mac

These commands are **instructions for the team**, not work already performed here. The official [PX4 macOS setup](https://docs.px4.io/main/en/dev_setup/dev_env_mac) says Apple Silicon is supported and uses Gazebo Harmonic. This Mac already has Command Line Tools and Homebrew. The `--sim-tools` step installs XQuartz and can request a system password; macOS may require logging out and back in afterward. Confirm the local macOS 27 combination with an actual smoke test.

```sh
# In a suitable development folder. Keep the upstream source unmodified.
git clone --recursive https://github.com/PX4/PX4-Autopilot.git
cd PX4-Autopilot
./Tools/setup/macos.sh --sim-tools
source .venv/bin/activate
gz sim --versions
make px4_sitl gz_x500
```

Then run the **stock moving platform and standard VTOL** in a new session from that PX4 directory:

```sh
source .venv/bin/activate
PX4_GZ_MODEL_POSE=0,0,2.2 PX4_GZ_WORLD=moving_platform make px4_sitl gz_standard_vtol
```

This command is documented by [PX4 Gazebo Worlds](https://docs.px4.io/main/en/sim_gazebo_gz/worlds#moving-platform) and the [moving-platform plugin README](https://github.com/PX4/PX4-Autopilot/blob/main/src/modules/simulation/gz_plugins/moving_platform_controller/README.md). [PX4's vehicle list](https://docs.px4.io/main/en/sim_gazebo_gz/vehicles#vtol) also includes `gz_tiltrotor`; try that *after* the documented standard-VTOL smoke test. The stock platform's mean speed/heading can be configured with `PX4_GZ_PLATFORM_VEL` and `PX4_GZ_PLATFORM_HEADING_DEG`.

The stock plugin has random velocity/angular-velocity fluctuations, but its README says the fluctuation spectrum is not configurable and it **does not communicate platform state to PX4**. That means the critical remaining work is: obtain timestamped deck pose/velocity, expose it to the external landing controller, add a wave-driven deck-motion model or plugin, command PX4 in a supported mode, and log touchdown outcomes. Do not assume the simulator's moving visual automatically supplies landing-target telemetry.

For an external controller, read [PX4 Offboard Mode](https://docs.px4.io/main/en/flight_modes/offboard) carefully. PX4 requires a continuous proof-of-life stream of at least 2 Hz before entering Offboard and has a loss failsafe. MAVLink position/velocity setpoints for Copter/VTOL use supported NED frames. Gazebo scene coordinates and PX4 NED coordinates must be translated consistently. Use [MAVSDK Python](https://mavsdk.mavlink.io/main/en/python/quickstart.html) or another supported MAVLink interface; adding ROS 2 is unnecessary unless the team already uses it.

### Custom frame or ship geometry (later stage)

Use the native `gz_standard_vtol` or `gz_tiltrotor` first. A custom **aircraft frame** requires a PX4 airframe configuration, simulator model, and build target; see [PX4 Gazebo Simulation — Adding New Worlds and Models](https://docs.px4.io/main/en/sim_gazebo_gz/#adding-new-worlds-and-models), [PX4 VTOL](https://docs.px4.io/main/en/frames_vtol/), and the [PX4 Gazebo models repository](https://github.com/PX4/PX4-gazebo-models). A custom **ship/deck shape** is a Gazebo model with visual mesh, collision geometry, pose, and meaningful inertial properties; see [Gazebo SDF Worlds](https://gazebosim.org/docs/harmonic/sdf_worlds/) and the [SDFormat model specification](https://sdformat.org/spec?ver=1.12&elem=model). Keep the collision deck simple and flat even if the visible hull is detailed.

To drive six-axis motion inside Gazebo, a system plugin can update the model in simulation time and publish motion telemetry. See the [Gazebo System Plugin tutorial](https://gazebosim.org/api/sim/8/createsystemplugins.html). For actual wave–vessel hydrodynamics, evaluate [asv_wave_sim](https://github.com/srmainwaring/asv_wave_sim) and [OpenFAST HydroDyn](https://openfast.readthedocs.io/en/main/source/user/hydrodyn/index.html); expect extra model parameters, native compilation, version checks, and validation. The community wave plugin is not a drop-in completion of the controller comparison.

## Keep the work running without losing the deadline

- Use **one canonical run command** and one verification command. The agent should save `BUILD_STATUS.md` after each working milestone, including the current command, latest passing seed set, known failures, and next step. Restart from that file after interruption.
- Give the agent a bounded goal: the app runs; same-seed comparison and held-out metrics pass; the hosted link works. Cap attempts and spending. [Anthropic's loop guidance](https://claude.com/blog/getting-started-with-loops) describes goal-based loops and explicit stop conditions. [Claude Code hooks](https://code.claude.com/docs/en/hooks) can run deterministic checks automatically, but a simple script is sufficient today.
- Keep the laptop plugged in and avoid sleep while the *local* agent runs. Do not rely on that laptop to serve the final demo URL. Test the deployed link from another device.
- Stop adding features at 14:45 and reserve the remaining time for packaging, footage, the required physical photos, and final submission. Record an honest local video backup before traveling or before Wi-Fi gets busy.
- This task folder is not a Git repository. If the team uses an existing repository, obey its branch rules: fetch remote branch information, work on a new feature branch from `staging`, and never modify/commit/push protected `main` or `staging`. Do not push any branch without explicit authorization. Keep the PX4 upstream checkout as an unmodified dependency; put the team's own controller/plugin source in its safe feature branch.

## Reference index

**Event and Claude:** [Luma event](https://luma.com/claude-x5dm) · [Claude model overview](https://platform.claude.com/docs/en/models/overview) · [Fable 5.1](https://platform.claude.com/docs/en/models/fable-5-1/whats-new-fable-5-1) · [Claude Code loops](https://claude.com/blog/getting-started-with-loops) · [Claude Code hooks](https://code.claude.com/docs/en/hooks).

**PX4 aircraft/control:** [macOS setup](https://docs.px4.io/main/en/dev_setup/dev_env_mac) · [Gazebo SITL](https://docs.px4.io/main/en/sim_gazebo_gz/) · [Gazebo vehicles including standard VTOL and tiltrotor](https://docs.px4.io/main/en/sim_gazebo_gz/vehicles#vtol) · [moving-platform world](https://docs.px4.io/main/en/sim_gazebo_gz/worlds#moving-platform) · [moving-platform plugin](https://github.com/PX4/PX4-Autopilot/blob/main/src/modules/simulation/gz_plugins/moving_platform_controller/README.md) · [Offboard Mode](https://docs.px4.io/main/en/flight_modes/offboard) · [precision landing/prior art](https://docs.px4.io/main/en/advanced_features/precland) · [VTOL frames](https://docs.px4.io/main/en/frames_vtol/) · [MAVSDK Python](https://mavsdk.mavlink.io/main/en/python/quickstart.html).

**Sea, vessel, geometry:** [OpenFAST SeaState JONSWAP/PM inputs](https://openfast.readthedocs.io/en/dev/source/user/seastate/input_files.html) · [OpenFAST HydroDyn](https://openfast.readthedocs.io/en/main/source/user/hydrodyn/index.html) · [NumPy least squares](https://numpy.org/doc/stable/reference/generated/numpy.linalg.lstsq.html) · [SciPy spectral estimation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.welch.html) · [Gazebo Harmonic on macOS](https://gazebosim.org/docs/harmonic/install_osx/) · [Gazebo SDF worlds](https://gazebosim.org/docs/harmonic/sdf_worlds/) · [SDFormat model](https://sdformat.org/spec?ver=1.12&elem=model) · [SDFormat link/inertia](https://sdformat.org/spec?ver=1.12&elem=link) · [SDFormat collision](https://sdformat.org/spec?ver=1.12&elem=collision) · [Gazebo plugins](https://gazebosim.org/api/sim/8/createsystemplugins.html) · [PX4 Gazebo models](https://github.com/PX4/PX4-gazebo-models) · [community wave/hydrodynamics plugin](https://github.com/srmainwaring/asv_wave_sim) · [ArduPilot moving-platform landing/prior art](https://ardupilot.org/plane/docs/common-ship-landing.html).

**Deployment:** [Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/). If the hosted page makes live Claude API requests, add a server-side function and secret management before deployment; static files alone cannot conceal an API key.
