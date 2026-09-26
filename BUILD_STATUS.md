# Build checkpoint — 26 September 2026

## Repository and branch

- Repository: https://github.com/Nivinv2000/Wave
- Checkpoint branch: `feature/ocean-flight-lab`
- The remote was empty when this checkpoint was prepared. The initial commit is on the feature branch; no commit was made to `main` or `staging`.
- Use this file and `work/ocean-flight-lab/README.md` when resuming. Preserve the user's protected-branch and explicit-push rules.
- There is currently no committed `staging` base in the formerly empty remote. Establish the intended base under the user's branch policy before opening a new development branch in a later task; do not silently create or write a protected branch.

## Working deliverable

`work/ocean-flight-lab` is the current simulator. Start with `npm start` in that directory, then visit http://127.0.0.1:4180. Optional Python inference adapter: `python3 examples/python_controller.py`.

Implemented:

- Seeded JONSWAP-shaped directional ocean waves; six weather/stress presets.
- Separate spring-tide phase/range, wind/gusts, rain/visibility, and prescribed current.
- Six-axis damped vessel response, pad-offset kinematics, superstructure and deck/water contact checks.
- Rigid-body quadrotor dynamics, motor mixing/lag, drag, gravity, inertia, and approximate battery effects.
- IMU, GPS, barometer, magnetometer, deck tracker, and rangefinder with imperfect measurements and delivery times.
- Complementary navigation estimate and high-level stabilization.
- Reactive, predictive, and hover example controllers.
- Uploadable JavaScript controller in a worker; local Python/HTTP adapter for other runtimes.
- 3D dashboard with cameras, trajectory, telemetry, commands, sensor ages, motor thrusts, and outcomes.
- JSON episode export including actual attached-model metadata and a module digest.
- Same-engine headless batch testing and a documented model interface.

## Verification at this checkpoint

- Automated simulator tests: 11 passed (determinism, spectrum normalization, tide timescale, sensor delivery/outages, observation separation, command validation, weather stability, contact, transforms, model interface).
- Six weather presets × two built-in policies × three seeds = 36 completed 40-second-or-shorter episodes. Full outcomes are in `work/ocean-flight-lab/reports/weather-matrix.json`.
- Browser: JavaScript example uploaded through the file chooser, attached in a worker, and completed a landing.
- Browser: Python example connected through the local proxy, produced live commands, and completed a landing.
- Browser: an intentionally non-returning policy was terminated after 700 ms; physics stayed at time zero, and Run/Step were disabled until reattachment.
- Browser: light/storm scenes, command/telemetry updates, and dashboard layouts at the observed 1280 px and 704 px widths were inspected.
- These are implementation checks, not real-vessel or aircraft validation. No actual proprietary controller or trained neural model has been tested.

## Files retained from earlier work

- `outputs/ADVERSARIAL_FLIGHT_LAB_MASTER_BRIEF.md`: concept and build plan.
- `outputs/OPUS_BUILD_DAY_SETUP_AND_REFERENCES.md`: earlier setup inventory and PX4/Gazebo references.
- `outputs/OPUS_WAVE_DRONE_CONCEPT_RESEARCH.md`: earlier domain research and prior art.
- `outputs/OPUS_BUILD_DAY_IDEA_DECISION.md`: superseded idea selection history.
- `output/pdf/drone-airspace-ideas-and-data.pdf`: compact data/idea brief.
- `work/last-safe-second`: earlier one-dimensional replay prototype.
- `visualizations/ship-deck-wave.html`: the earlier inline wave explainer, preserved as source.

## Next build priorities

1. Attach the team's actual model using the documented observation and command contract. Confirm units, frame, normalization, recurrent-state reset, and missing-sensor handling.
2. Add a saved evaluation manifest with development and held-out seeds, automatic multi-controller comparison, and regression thresholds. Treat safe abstention and successful landing separately.
3. Improve environment fidelity using measured vessel response or RAOs, identified aircraft/motor parameters, and synchronized real logs. Add contact/landing-gear dynamics if touchdown loads matter.
4. Add explicit command/network latency and deadline testing. Current inference is lockstep; measured wall-clock inference duration is not a physical transport delay.
5. Add real sensor imagery or a camera pipeline if testing visual perception. Current optical tracking is a noisy measurement model.
6. Add PX4 SITL/Gazebo as a separate backend, keeping the same policy/evaluation API. The current autopilot is the project's small PD implementation.
7. Build the proposed Opus counterexample → candidate policy → fixed evaluator improvement loop on top of this simulator. It is not implemented yet.
8. Consider SMAF only after that loop works: operator incident requests, scoped candidate changes, independent checks, evidence review, and version rollback.

## Important limitations to preserve in future claims

- Vessel motion is a reduced-order response; no vessel-specific calibration has been supplied.
- Moon-driven spring tides are hours-long water-level changes, not storm or tsunami generation.
- The large-wave event is a synthetic pulse, not a validated rogue-wave probability model.
- No rotor/deck ground effect, aircraft VTOL transition, full EKF, hydrodynamic solver, or post-contact deck physics.
- Geometry changes through code must also update the currently fixed visual vessel mesh.
- The local controller execution interfaces are for trusted code, not a hardened public sandbox.
