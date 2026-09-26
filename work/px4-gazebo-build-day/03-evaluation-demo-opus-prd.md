# PRD 3 of 3 — fair evaluation, Opus trace, demo and submission

**Owner:** Person 3, evidence and integration. **Product:** DeckSafe, a PX4 SITL + Gazebo demonstration of landing decisions on a moving deck in gusts and with an obstruction. **Due:** 15:30 submission; freeze the demo at 15:00. You own the proof that the simulator, controller and claimed improvement actually work. This brief is self-contained.

## The first thing to do now

1. Ask Person 1 for the stock Gazebo/PX4 launch command, host/version, and deck bridge format. Ask Person 2 for the mode names and event-log format. Freeze the flight protocol below in the team chat within 10 minutes. Create **fixture logs immediately**, so scoring and the results page can be built while the simulator installs.
2. Create one repeatable runner that launches or resets the scenario, selects `reactive` or `predictive`, records the seed and version, saves the aircraft/deck trajectories and event log, then produces an outcome JSON even on failure or timeout.
3. Pick the real demo machine, a screen recorder, and a hosting destination now. Verify that the venue can show the local Gazebo window. The hosted link must remain up for a month; host a truthful **replay/results experience** for the actual Gazebo runs, with runnable source instructions and raw evidence. Do not present a recording as a live simulator.

The **14:00 gate** is a visible PX4/Gazebo moving-platform smoke test. The **14:30 gate** is a complete controller run with a log. At **15:00**, stop feature work and capture the final matched flight, video and required photos.

## Product claim and judging evidence

**Problem:** a drone may line up with a ship deck yet touch down at the wrong moment after deck motion, drift in gusts, or fly into an obstruction that entered the landing corridor. **Proposed solution:** a short-horizon, causal landing decision on a PX4 aircraft that forecasts the pad at touchdown and pauses/retries if a sensor reports danger. The controls remain in PX4; Claude Opus acts as an **offline flight-test engineer**, proposing a bounded change after seeing an actual failure.

Give the judges a visible answer to all four equal judging criteria:

| Criterion | Evidence to show |
| --- | --- |
| New Capability | Authentic Opus trace: read a flight log and controller diff, propose one grounded hypothesis/change, then run the fixed evaluator. Name the actual event model and show real tool outputs. Do not assert an older model could not do it without a real comparison. |
| It Works | Live PX4/Gazebo flight, simulator contact/abort result, and raw trajectory/event log. |
| Keep or Share | A reusable flight-test harness and a safety decision another drone team can inspect and run. |
| Clarity of Demo | Aircraft and moving deck first; gust and entering obstacle second; one matched comparison with outcome counts; explain the audience in one sentence. Keep pitch under 90 seconds. |

## Fixed comparison protocol — do not tune on held-out results

Use the **same** aircraft/world versions, spawn poses, deck/obstacle programs, sensor input, command limits, safety envelope and scenario seed for both controller modes. Minimum scenarios: `calm`, `gust`, `gust_obstacle`; use seeds `17,18` for development and `401` as the held-out seed. If simulator runtime allows, use three held-out seeds. Record every attempt, including failed model startup, timeout, no landing, and safe refusal.

Pre-register these result fields before the first scored run:

```json
{
  "scenario": "gust_obstacle",
  "seed": 401,
  "policy": "predictive",
  "simulator_revision": "PX4 commit + world commit",
  "policy_revision": "commit or content hash",
  "outcome": "LANDED|HARD_CONTACT|PAD_MISS|OBSTACLE_CONTACT|WATER_CONTACT|SAFE_ABORT|TIMEOUT|MODEL_ERROR",
  "touchdown_time_s": null,
  "pad_error_m": null,
  "relative_normal_speed_mps": null,
  "relative_tangential_speed_mps": null,
  "obstacle_min_clearance_m": null,
  "deck_signal_age_s": null,
  "artifact_paths": { "flight_log": "...", "screen_recording": "..." }
}
```

A `LANDED` result requires **all** of: contact on the designated pad collision surface, pad-centre error below the pad radius, relative normal contact speed below 0.7 m/s, relative tangential speed below 1.0 m/s, and no obstacle contact. Adjust numeric thresholds once with Persons 1 and 2 **before** running held-out seeds if Gazebo geometry makes them inappropriate; document the change. Derive contact speed from time-aligned aircraft truth and **pad-point** velocity, not ship-centre velocity. Publish both landed rate and unsafe-contact rate; a safe abort is separate from both. Show each seed, not just averages. Person 2 must not receive your simulator-truth scoring stream as controller input.

Your runner should preserve a machine-readable manifest with scenario parameters, seed, controller mode, commit/hash, package versions, timestamps, raw logs and generated results. Do not overwrite earlier failed runs. A paired run passes the fairness check only if the manifest fields match except controller mode and its hash.

## Shared integration contract

Person 1 sends timestamped pad/obstacle **observations** to Person 2 as JSON UDP datagrams to `127.0.0.1:14670` (schema 1, ENU pad position/velocity/orientation, obstacle `valid/range_m/source`). Person 3 may separately collect clean Gazebo/PX4 **truth** for scoring. A deck beacon is a permitted simulation assumption. The obstacle reading must identify whether it came from a simulated lidar or a scripted scenario beacon. Do not let the controller read the wave seed, future motion, clean obstacle pose, or outcome scorer. Read Person 2's state-transition log to show `TRACK`, `DESCEND`, `HOLD`, and `ABORT_AND_RETRY` on the timeline.

## Work you own, end to end

1. **Fixture and scorer first:** create a tiny recorded trajectory that produces one safe landing and one safe abort. Implement the outcome labels and numerical touchdown checks as a pure scorer. Test known edge cases: off-pad contact, too-fast contact, obstacle contact, and non-landing timeout.
2. **Run orchestration:** add a script/config that selects scenario, seed and policy, starts a clean episode, waits with a fixed deadline, captures logs/video references, scores, and writes unique results. A process crash becomes `MODEL_ERROR`, not a dropped row. Re-running the same case should reproduce trajectory/outcome within declared tolerances.
3. **Matched evaluation:** complete at least one paired `calm` flight, one paired `gust` flight and one paired `gust_obstacle` flight. If time allows, run all three on the held-out seed. Produce a small table of successes, hard contacts, safe aborts and obstacle incursions. If predictive does not beat reactive, report that honestly and lead the demo with the working hazard response rather than an invented performance claim.
4. **Opus step:** use the event-approved model/account. Feed it one actual failed episode and the relevant controller code/config. Ask for **one bounded change** to a touchdown forecast or safety threshold, plus a testable prediction. Save the exact prompt, model identifier, suggested diff, evaluator result, and whether the change was accepted. Apply only after the same development and held-out gates pass. Keep the API key in a local secret store or ignored environment file, never in Git, browser source, or a screen recording. The Luma credit link is individual and must not be shared.
5. **Demo artifact:** build a lightweight hosted results/replay page with actual Gazebo recordings and run table, labelled as replay. Include one button/command showing how to run PX4/Gazebo locally. Test the hosted link in a fresh browser/device; keep it live at least a month. Screen-record one complete physical simulator run before the deadline so a live demo can recover from venue Wi-Fi or rendering issues.
6. **Submission package:** collect a photo of the finished build, a video/screen recording in action, a photo of the builder with it, a group/team photo, close-up details, a behind-the-scenes shot, and a handwritten note. Link the hosted project and keep copies outside the simulator laptop. The team must have exactly three official members under the supplied event rule.

## Final 90-second pitch sequence

0–35 s: show the PX4 aircraft tracking the moving ship deck, wind gust, and a moving obstacle; show `HOLD` or retry when the corridor is blocked. 35–60 s: show same-seed reactive versus proposed run and raw outcome numbers. 60–75 s: show the Opus failure-analysis suggestion and the rerun result. 75–90 s: say who would use the flight-test harness and what remains synthetic. Demo first, explanation second. Rehearse with a timer; going over time is penalized.

## Acceptance and handoff

- A single command/manifest can repeat a named seed; both modes are run on matching simulator conditions.
- Every attempt has an outcome JSON and flight/event log. All claims shown on the hosted page map to those files.
- Contact and obstacle scoring uses simulator truth, while Person 2 receives only the declared observation stream and PX4 telemetry.
- A real Gazebo video, a 90-second pitch rehearsal, hosted link verification, and every required submission image are complete before 15:30.
- Your PR changes evaluation, evidence packaging and results page only. The remote currently has no `staging` branch: keep work in an isolated safe feature branch and have the repository owner explicitly designate a PR base before integration. Never create or write protected `main`/`staging`; push only with explicit owner authorization.

## References

[PX4 simulation](https://docs.px4.io/main/en/simulation/) · [PX4 moving-platform world](https://docs.px4.io/main/en/sim_gazebo_gz/worlds#moving-platform) · [Gazebo SDF collisions](https://sdformat.org/spec?ver=1.12&elem=collision) · [PX4 Offboard](https://docs.px4.io/main/en/flight_modes/offboard) · [Claude model list](https://platform.claude.com/docs/en/models/overview). The existing research brief in `outputs/OPUS_BUILD_DAY_SETUP_AND_REFERENCES.md` has additional background and prior art.
