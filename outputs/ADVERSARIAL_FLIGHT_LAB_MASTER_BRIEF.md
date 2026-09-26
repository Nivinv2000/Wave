# Adversarial Flight Lab: a drone that improves its landing policy in simulation

> **Status:** Product and engineering brief, not a validated flight system. The current workspace contains a small synthetic landing replay, but it does **not** yet implement autonomous policy improvement, a six-degree-of-freedom ship, PX4/Gazebo integration, SMAF, or real-aircraft control. This document explains the proposed system from first principles, its build path, data needs, alternatives, and limits.

## 1. The idea in one minute

A drone returning to a ship must meet a landing pad that is moving in six directions. A landing that looks well aligned *now* can be unsafe when the drone actually touches down: the deck may rise, tilt, or slide during the remaining descent. Existing moving-platform landing systems and research address parts of this problem, so the claim is not that ship landing has never been solved.

**Adversarial Flight Lab** is a tool for the people developing and operating such drones. It runs a candidate landing policy through many simulated deck motions, actively searches for conditions in which that policy fails, proposes a bounded change, and tests the candidate against both known failures and unseen conditions. It keeps a versioned record of the failure, the change, and the evidence. A human can decide whether an improved version deserves further engineering review.

The core loop is:

```text
Current policy
   -> run simulated landings
   -> find counterexamples / near misses
   -> diagnose the failure
   -> propose a bounded policy change
   -> compare old and new on fixed + unseen tests
   -> accept or reject the candidate
   -> repeat
```

This is **self-improvement through simulated experience and selection**. It does not mean retraining Claude/Opus's weights, rewriting a drone in the middle of a real flight, or claiming that simulation alone proves flight safety.

### The exact problem statement

> Drone teams test the conditions they expect. How can they discover the conditions they missed, improve a landing policy before encountering them on a real deck, and keep evidence that the change helps beyond one hand-picked replay?

For a shipboard product, the operational version is: *How can a team turn difficult landings and near misses into better, tested landing behaviour for its vessel and aircraft, even when the ship has no internet?*

## 2. Why this is a real problem, and what already exists

Landing on a moving ship is a real perception, prediction, and control problem. The aircraft must estimate its own motion and the motion of a small deck; both estimates have delay and noise. The deck's future position and **relative velocity at touchdown** matter more than its present position alone. Pitch and roll also make a landing point away from the ship's centre move differently from the centre.

This is an active area, not an untouched category. [ArduPilot documents ship landing](https://ardupilot.org/plane/docs/common-ship-landing.html); [PX4 documents precision landing and moving-target handling](https://docs.px4.io/main/en/advanced_features/precland). [LLM-Land](https://arxiv.org/abs/2505.06399) explores LLM-assisted landing, [AutoSimTest](https://arxiv.org/abs/2501.11864) explores AI agents for UAV simulation testing, and [WaveLander](https://arxiv.org/abs/2607.01281) studies wave-disturbed landing. Public flight-log analysis tools already exist. We should make no “first ever” claim.

The useful, testable contribution here is the **counterexample-to-improvement workflow**: an agent finds a difficult but plausible condition, proposes an inspectable change to a bounded policy, and has to pass an independent test suite that it did not choose. That is a product hypothesis, not yet evidence of technical superiority or customer demand. Validation with flight-test engineers and ship operators is still needed.

## 3. What “the drone learns from itself” actually means

There are three distinct things that can be called learning:

1. **Policy search:** adjust a small set of controller parameters or rules after simulated attempts. This is the recommended first implementation. The result is a new version of the landing policy, not a new base model.
2. **Wave prediction fitting:** fit a compact forecasting model to *past* deck-motion measurements, then predict deck motion at a short future horizon. This may use classical filtering or a trained time-series model; it is independent of Opus.
3. **Model or reinforcement-learning training:** train a neural controller on many simulated episodes. This is a larger research path with substantial data, compute, reward-design, and simulation-to-reality challenges.

In the proposed hackathon loop, Opus is a **flight-test and design agent**. It reads traces, chooses additional test conditions, explains likely causes, and proposes a small policy modification. A deterministic simulator and fixed evaluator decide whether the change helps. During a real landing, a pre-tested onboard controller runs without Opus or an internet connection.

### Example

The baseline policy starts descent when the deck is near a desired height. It repeatedly contacts the pad too hard when the deck is rising rapidly. The agent observes that the error correlates with *relative vertical speed at predicted touchdown*. It proposes delaying the descent or aborting when that predicted relative speed exceeds a limit. The lab tests the new rule on the failing replay, ordinary sea states, and hidden wave conditions. A result that fixes only the original replay is rejected.

## 4. System architecture

```text
Scenario generator -----> simulator -----> immutable run log
        |                     ^                 |
        |                     |                 v
        +---- held-out suite  |          failure explorer
                              |                 |
                     versioned policy <--- Opus proposes candidate
                              |                 |
                              +---- independent evaluator
                                        | pass / fail + explanation
                                        v
                               review and version history
```

### 4.1 Scenario generator

Create seeded, reproducible conditions: wave height and periods, phase, vessel heading, wind/gusts, sensor noise, observation delay, initial aircraft position, and control delay. Partition the seeds *before* agent search into development, regression, and held-out evaluation sets. The agent can inspect development failures; it must not read hidden future samples or held-out answers.

For the first browser version, a sum of sinusoids can generate deck heave. It is a synthetic teaching model. Later, use JONSWAP/Pierson-Moskowitz sea spectra, a vessel response model, and six-degree-of-freedom pose. A visual ocean surface by itself does not yield physically correct ship motion.

### 4.2 Aircraft and deck model

Start with a simple aircraft response model including descent speed, acceleration limits, command latency, and abort capability. The deck model supplies its pose and velocity. For six degrees of freedom, store deck-centre translation `(x, y, z)` and orientation `(roll, pitch, yaw)`, plus translational and angular velocity. The landing pad's world position is the rotated local pad offset added to deck-centre position. Its local velocity includes `angular_velocity × pad_offset`; this matters on a rolling or pitching ship.

Keep coordinate frames, units, timestamps, sensor latency, and the distinction between simulator truth and measured observations explicit. The candidate controller sees only observations available at decision time. Both baseline and proposed policy use the same aircraft, physics, and scoring rules.

### 4.3 Policy to improve

Make the editable surface small: a typed configuration or compact decision function with parameters such as forecast horizon, allowed relative touchdown speed, descent gate, confidence threshold, and abort trigger. Preserve stable low-level attitude and motor control. A change might be a new condition in the high-level *land / wait / abort* decision. Store each version and its exact diff.

Unrestricted code rewriting makes it harder to know what changed, to compare versions, and to rule out shortcuts. Begin with bounded parameters and rules; permit broader code changes only after the verification harness is credible.

### 4.4 Predictor

The reactive baseline uses current measured deck state. The predictive version estimates pad pose and velocity at expected touchdown time. A first predictor can fit a few sinusoidal components to recent observations or use a simple state estimator. It must use *past and current* samples only, with the same observation delay the controller would have in reality. Compare forecasts with future simulator truth only in the evaluator, never inside the policy.

### 4.5 Independent evaluator

The evaluator is fixed before candidate generation and outside the agent's editable scope. It should check at least:

- touchdown inside the usable pad;
- aircraft-to-pad **relative** speed and deck angle at contact;
- collisions and missed approaches;
- whether an abort clears the deck;
- performance across ordinary and difficult conditions, including held-out seeds;
- regressions relative to the previous policy; and
- forecast leakage, malformed changes, runtime errors, and excessive computation.

Report distributions and counts, not a single selected win. Separate “landed safely,” “aborted safely,” and “unsafe.” A policy that aborts every attempt should not appear successful simply because it avoids hard touchdowns. The acceptance rule must balance landing availability and safety under explicit constraints. Thresholds in a hackathon simulator are illustrative and are **not** real flight limits.

### 4.6 Improvement algorithm

An implementable first version:

1. Run baseline policy on a preselected batch and store every trace.
2. Ask Opus to find a failure mechanism and propose one bounded change in a structured format.
3. Validate the proposal against the allowed policy schema and limits.
4. Run baseline and candidate on identical development and regression scenarios.
5. Run both on held-out scenarios that the agent has not seen.
6. Promote the candidate *within the simulation lab* only if fixed acceptance criteria pass; otherwise preserve the failed proposal and reasons.
7. Repeat for a small, budgeted number of generations and show the entire history.

Classical grid search or Bayesian optimization over the same policy parameters is a useful non-LLM baseline. An Opus 5 versus Opus 5.5 comparison, if both are available, must use the same prompt, tools, scenarios, time and step budget; we cannot assume the newer model wins this task.

## 5. Training and evaluation data

The first build needs **simulated episodes**, not a large supervised training set. Each episode should contain timestamped aircraft state, deck state, controller observations, decisions, control commands, weather/scenario parameters, predicted touchdown state, true outcome, and policy version. Do not store only a final success flag; the trace is needed for diagnosis and replay.

| Source | What it contributes | What it does not provide |
| --- | --- | --- |
| Seeded in-house simulator | Unlimited reproducible attempts, including rare failures; exact outcome labels from the simulator. | Evidence that a real ship and aircraft behave the same way. |
| [NOAA NDBC historical data](https://www.ndbc.noaa.gov/historical_data.shtml) | Wind and wave observations or spectra to choose plausible sea conditions. | Vessel-specific six-axis deck pose or paired aircraft landings. |
| [RMA maritime UAV-landing research datasets](https://mecatron.rma.ac.be/index.php/publications/datasets/) | Research ship IMU motion data and code for long-term ship-motion prediction; the same page also lists maritime visual-localization data. Check fields, access, and license before using. | A ready-made, fully matched dataset for our exact airframe, vessel, sensors, and controller. |
| [PX4 Flight Review public logs](https://docs.px4.io/main/en/dev_log/flight_log_analysis_statistical) | Realistic ULog format and varied aircraft flight traces for ingestion and analysis. | Generally, synchronized moving-deck pose and landing outcomes. |
| Own field data, later | Synchronized deck pose, aircraft pose, sensor quality, wind, commands, and outcome from the actual vessel/aircraft pair. | Available only after real instrumentation and permission to collect it. |

For a true neural wave predictor, training examples are windows of *past* ship-motion samples with a future deck-pose target; split by voyage, vessel, and sea condition rather than random adjacent windows to avoid leakage. For a neural controller, simulation can produce many episodes, but the reward must penalize unsafe contact, unnecessary aborts, and time/energy cost. Real-world validation remains separate.

The immediate data task is to build a clean episode format and held-out scenario set. Downloading a huge imagery dataset is unnecessary for a one-day controller demo unless the chosen MVP includes visual pad detection.

A minimal episode record should be portable and replayable:

```json
{
  "scenario_id": "heldout-017",
  "seed": 17,
  "simulator_version": "v1",
  "policy_version": "candidate-3",
  "conditions": { "wave_components": "recorded separately", "wind_mps": 4 },
  "samples": [
    { "t_s": 0.0, "observed_deck_pose": "...", "aircraft_pose": "...", "command": "wait" }
  ],
  "outcome": { "class": "safe_abort", "relative_contact_speed_mps": null }
}
```

The strings above are schema placeholders, not measured values. The real record should use explicit numeric fields, units, coordinate frames, sensor timestamps, and a checksum for the complete scenario. Save the policy and simulator versions alongside every result so a future run can reproduce it.

## 6. What runs offline on a ship

**Real-time drone loop:** onboard sensors estimate aircraft state and relative deck pose, through a camera, beacon, local radio, or a combination. A compact onboard predictor estimates deck state at touchdown. A pre-tested controller chooses to land, wait, or abort. The drone does not call a cloud LLM to stay in the air.

**Ship-side improvement loop:** an onboard/ship computer collects logs, replays difficult approaches, runs simulations, evaluates candidates, and stores versioned evidence. If a suitable model is available locally, it can assist offline. Otherwise, the ship records the traces and runs the AI design step once connected. The numerical simulator and non-LLM parameter search can run fully offline.

**Local communication:** the aircraft and ship can use a local link even when there is no internet. A loss of deck tracking, local link, or trustworthy prediction must trigger a pre-tested hold or abort behaviour. Candidate changes are never installed mid-flight. Real aircraft updates require engineering review, configuration control, and field validation beyond the hackathon system.

For the software-only demo, no drone, Pixhawk, ship, radio, or ocean sensor is required. A real deployment would require flight hardware, sensing/localization, compute, a local communication system, and trials.

## 7. Where SMAF fits - as a later product feature

**SMAF (Self-service Modification & Approval Flow)** is the proposed in-app flow in which a nontechnical operator requests a change in plain language; an agent makes a scoped, reviewable change under project policy; an independent verifier checks it; and an authorized person approves or rolls it back. It is **not the self-improvement algorithm**. The learning loop can exist without SMAF.

SMAF becomes natural when an operator sees a real replay and asks: “This rising-deck approach was called safe. Test cases like this and show me a better warning.” The request becomes a new scenario and acceptance criterion. The lab produces a candidate policy or dashboard improvement and an evidence package: before/after replay, fixed and held-out scores, policy diff, tests, and limitations. SMAF handles who may request, review, approve, deploy, or roll back each version. It is the **human interface and change-control layer** for the same evidence loop.

The distinction:

| Inner loop: self-improvement | Outer loop: SMAF |
| --- | --- |
| Searches for failures and better decisions in simulation. | Lets people express needs, set permitted scope, inspect evidence, approve changes, and recover a prior version. |
| Can operate automatically with fixed tests. | Connects the result to an organization's users and workflow. |
| Changes a candidate policy in the lab. | Promotes an accepted change into an operational product only under appropriate review. |

For an external customer, SMAF could allow changes to alerts, reports, thresholds, training scenarios, and workflow text without exposing private hardware or controller IP. Flight-critical firmware or control changes require specialist engineering review and should not be treated as ordinary admin edits. On a ship, the request and review UI can run on the local network and sync later. A generic “AI edits any app” widget, disconnected from replay evidence, would feel forced; build the learning lab first.

A full SMAF extension would add per-project policy about editable files and operations, role or tier permissions, and hard limits on change size. The agent would create one isolated candidate change and, when connected to the development service, a separately reviewable pull request. A verifier independent of the proposing agent would run policy checks, security scans, the project's build/lint/tests, the flight lab's hidden simulations, and browser checks against a preview. The operator or engineer would see the evidence before approval. Each approved change would be versioned, deployed separately, monitored, and reversible. Offline shipboard requests can be recorded and reviewed locally; remote pull requests and deployments wait for connectivity. This outer workflow is valuable only if operators truly need to influence the system and the evidence is understandable enough for them to decide.

## 8. Build path and current workspace status

### What exists now

The local [Last Safe Second prototype](../work/last-safe-second/README.md) has a deterministic **one-dimensional** heaving-deck replay, touchdown/abort scoring, a browser UI, and a server endpoint that can ask Opus to analyze screenshots when a server-side API key is configured. It is a useful starting point for visualization and reproducible seeded runs. It does **not** yet propose, verify, and adopt successive controller versions. It also does not model a six-axis ship or run PX4/Gazebo. The API key and a successful live model call have not been verified in this workspace.

### Stage A: hackathon-sized, browser-first lab

1. **Keep the deterministic simulator.** Extend the current episode output so every run includes scenario parameters, observation history, policy version, and outcome.
2. **Add two explicit policies.** Baseline reactive rule and a forecast-aware decision rule; use identical aircraft response and evaluation.
3. **Add a bounded editable policy surface.** For example, a JSON policy specification with forecast horizon, descent gate, and abort threshold. Reject invalid changes.
4. **Create fixed development and held-out scenario lists.** Save seeds before model runs. Include easy, difficult, and noisy cases.
5. **Implement an improvement worker.** It reads failed development traces, asks Opus for one structured candidate, validates it, runs both versions, and records accept/reject with reasons. Limit calls and attempts.
6. **Show the evidence in one screen.** Animate the discovered failure, show the proposed rule in plain English and as a diff, then display baseline versus candidate metrics on hidden cases and a version history.
7. **Test the hosted artifact on another device.** Keep the API key server-side. Label recorded fallback footage as recorded, not live.

The minimum persuasive demo is **one genuine model-proposed improvement** that passes an evaluator it cannot edit. If that fails, show the rejected proposal honestly rather than a staged success. Avoid making full 3D physics a dependency for the first complete loop.

### Practical setup and an interruption-resistant workflow

The browser-first version needs a laptop with Node.js, a browser, a local test runner, an Anthropic account with access to the event model, and a hosting destination for the final app. The current Mac had Node, Python, Git, and Claude Code when the earlier [setup pack](OPUS_BUILD_DAY_SETUP_AND_REFERENCES.md) was prepared; re-check before relying on that inventory. Put API credentials in server-side environment variables, not browser code or a repository. A static demo can run without an API key, but a *live* Opus improvement requires a server-side API call or a locally hosted model with enough capability.

An autonomous agent should have a **bounded task**, not an instruction to “keep looping forever.” Give it an editable policy schema, allowed tools, a fixed evaluation command, a call/time budget, and stop conditions: valid improvement found, budget exhausted, or repeated non-improving proposals. Save every candidate and evaluator result to disk. A short status file should record the current run command, policy version, passing scenario set, failed cases, and next action so work can resume after power, network, or model interruption. The evaluator must remain outside the agent's editable area. This is the harness; extra GitHub skills or agent frameworks are optional and should be added only if they help this loop run reliably.

No physical hardware is needed for Stage A or PX4 software-in-the-loop. Stage B adds PX4 source, its supported simulation toolchain, Gazebo, and possibly a wave plugin; those downloads and native builds are a separate integration risk. [PX4's macOS setup guide](https://docs.px4.io/main/en/dev_setup/dev_env_mac) and the local setup pack cover the current platform. The folder holding this document is not a Git repository. If implementation moves into an existing repository, first update remote branch knowledge and create a feature branch from `staging`; treat `main` and `staging` as read-only and do not push without explicit authorization.

### Stage B: physics and autopilot integration

Use [PX4 SITL with Gazebo](https://docs.px4.io/main/en/sim_gazebo_gz/), beginning with a stock [standard VTOL or tiltrotor frame](https://docs.px4.io/main/en/sim_gazebo_gz/vehicles#vtol) and the [moving-platform world](https://docs.px4.io/main/en/sim_gazebo_gz/worlds#moving-platform). The stock platform does not automatically provide everything the landing agent needs: add timestamped deck pose/velocity telemetry, coordinate-frame conversion, an external high-level landing decision interface, and touchdown scoring. Read [PX4 Offboard Mode](https://docs.px4.io/main/en/flight_modes/offboard) for setpoint and link-loss requirements. Preserve PX4's existing low-level control loops.

For a custom visual ship, Gazebo needs a model with a simple collision deck and correct frames/inertial properties. For actual wave-driven six-axis motion, evaluate [asv_wave_sim](https://github.com/srmainwaring/asv_wave_sim) and a vessel response model. A JONSWAP wave field alone is not a calibrated vessel model: vessel geometry, inertia, hydrodynamic response, damping, and wave direction matter. A custom aircraft frame is optional and should follow the working native VTOL integration, not precede it. The [PX4 setup/reference pack](OPUS_BUILD_DAY_SETUP_AND_REFERENCES.md) contains detailed local setup notes and documentation links.

### Stage C: research/operational product

Fit to vessel-specific recordings; measure prediction calibration, controller performance, and failures across voyages and weather. Run hardware-in-the-loop and staged field trials. Separate learning, verification, and operational promotion. Only then can a real shipboard claim be evaluated. The hackathon app demonstrates the workflow, not operational safety.

## 9. Hackathon strategy and work split

The event rules supplied in this conversation give four equal judging dimensions: **New Capability**, **It Works**, **Keep or Share**, and **Clarity of Demo**. They also specify a **90-second pitch, demo first**, a final submission at **15:30**, and **exactly three people per team**. Four interested builders were mentioned later; confirm with organizers how a fourth person may participate. Check the authoritative event email/page for the current schedule and terms.

The strongest track hypothesis is **Breakthrough** if Opus 5.5 demonstrably finds a counterexample and proposes a valid improvement under fixed tools and tests. A same-task Opus 5 comparison would strengthen the claim only if the measured result supports it. Model marketing benchmarks are motivation, not proof for this exact product. The product's “keep or share” case is a reusable flight-test lab for UAV teams, not a novelty visual alone.

Suggested three-person split:

1. **Simulator and UI:** deterministic scenario replay, graphs, side-by-side comparison, hosted app.
2. **Policy and evaluator:** reactive/predictive policies, fixed scoring, held-out tests, anti-leakage checks.
3. **Opus workflow and delivery:** candidate schema, bounded agent loop, server-side key, model comparison, pitch, submission media.

Build order: have one complete baseline run and metric by the idea checkpoint; one real candidate, evaluator result, and saved evidence by the build checkpoint; freeze features in time for hosted-link verification, photos, screen recording, a handwritten note, and final submission. The submitted link must remain live for the month required by the event. Use the Luma-approved email for each attendee's credits and do not share the redemption link. No prize money is listed in the supplied event details.

The supplied event run of show begins with 09:00 arrival/breakfast, 10:00 opening, 10:45 Claude session and team formation, 11:30 idea checkpoint, 11:45 first build sprint, 13:00 build checkpoint, 13:30 lunch, 14:30 second sprint, 15:30 final submission, 16:00 selected-team showcase, and 17:00 results. Venue notes supplied in the chat: Anakin.io beside MTR/HSR; check-in, name tags, coffee, and the event are on floor 3; food is on floor 5; nearby parking is unavailable. The exact event date and timetable should be checked against the organizer's current message because an earlier public listing and the phrase “tomorrow” in the chat were not consistent. Mentors are on site. The required final evidence includes a finished-build photo, an action video or screen recording, a participant-with-build photo, a group photo, close-up shots, a behind-the-scenes image, a handwritten note, and a hosted link kept live for a month. The supplied sharing guidance uses `#OpusBuildDay`, `@knowshubhangi`, `@anakin`, and `@theresidencyblr`.

### 90-second demonstration

- **0-15 seconds:** show a plausible landing failure and the current policy's mistaken decision.
- **15-35 seconds:** show Opus locating the failure mechanism and proposing one bounded change.
- **35-65 seconds:** run old and new policies against identical conditions plus held-out cases; display safe landings, safe aborts, unsafe contacts, and any regression.
- **65-80 seconds:** show the versioned evidence and a replay of an unseen successful case.
- **80-90 seconds:** say who uses it: flight-test teams discovering weaknesses before risking aircraft on a real deck.

This sequence is an **aspiration for a working live demo**. Rehearse it against actual model latency. A precomputed run can support a recorded fallback, but should never be described as a live model call.

## 10. Other ideas considered

| Idea | Problem | Assessment |
| --- | --- | --- |
| **Offline Landing Envelope** | Tell a shipboard operator when to land, wait, or abort under predicted deck motion and uncertainty. | Strong direct operational product; harder to establish trustworthy forecast performance quickly. Can become the operator-facing product built on the lab. |
| **Airspace Conflict Simulator** | Detect and resolve conflicts between overlapping drone missions, including unreliable communications. | Broad audience and clear map demo, but [UAS traffic management](https://www.faa.gov/uas/advanced_operations/traffic_management) already exists; a narrow new capability needs proof. |
| **Reactive vs predictive wave landing comparison** | Show whether forecasting deck motion improves touchdown timing over using present deck state. | Directly tests the original maritime hypothesis; simpler than an improvement loop but more like a research demonstration. |
| **The Last Safe Second** | Find the latest safe abort point in a near-miss replay and save the case. | Clear, narrow visual; the existing local prototype implements a synthetic replay, but this alone does not make a self-improving controller. |
| **Twin Worlds** | Find paired wave scenarios that look identical now but demand different future landing decisions. | Strong way to demonstrate why forecasting matters; could become an adversarial test generator. |
| **Missing Message** | Debug communication failure in cooperating simulated drones. | Another aerospace scenario, but separate from the ship-landing hypothesis. |
| **Promise Breaker / ProofLoop** | Turn product claims or incidents into tests and reviewed improvements. | General software product direction; its principles inform the verifier and SMAF extension, but the core flight lab should stand on its own. |
| **Napkin Quest and other general hackathon concepts** | Use Opus to turn a sketch or complex input into a working artifact. | Considered earlier for broad shareability; current recommendation follows the later aerospace-specific direction. See the [older idea decision](OPUS_BUILD_DAY_IDEA_DECISION.md), which marks itself superseded. |

None of these ideas is guaranteed to win. The decisive test for Adversarial Flight Lab is whether a real Opus call, an independently scored candidate, and a clear before/after result can run reliably within the build window.

## 11. Risks, controls, and honest claims

- **Simulation gaming:** an agent can overfit one seed or exploit a scoring loophole. Use fixed hidden conditions, multiple metrics, limits on needless aborts, and a non-editable evaluator.
- **Truth leakage:** a predictor with access to future simulator samples is not forecasting. Separate truth generation, observation stream, and evaluator in code.
- **False confidence:** synthetic waves and aircraft dynamics are illustrative. Real ships require paired measurements and field trials.
- **Prior art:** moving-platform landing, wave forecasting, and AI simulation testing already exist. Claim a demonstrated workflow and measured outcome, not global novelty.
- **Model dependence:** if Opus produces no useful change, the result is still informative; do not fabricate an improvement or a comparison with older models.
- **Offline reality:** cloud Opus is unavailable at sea without internet. The flying controller and simulator must be able to operate locally; AI-assisted design can run on a suitable local model or wait until connected.
- **Private IP:** use synthetic telemetry and generic policy examples for public demos. Do not expose proprietary aircraft hardware or unreleased controller algorithms in prompts, recordings, or the hosted app.

## 12. Reference shelf

**Event and model:** [Build Day event page](https://luma.com/claude-x5dm) · [Anthropic model overview](https://platform.claude.com/docs/en/models/overview) · [Opus 5.5 overview](https://platform.claude.com/docs/en/models/opus-5-5/overview).

**Flight stack:** [PX4 Gazebo simulation](https://docs.px4.io/main/en/sim_gazebo_gz/) · [PX4 VTOL models](https://docs.px4.io/main/en/sim_gazebo_gz/vehicles#vtol) · [PX4 moving-platform world](https://docs.px4.io/main/en/sim_gazebo_gz/worlds#moving-platform) · [PX4 Offboard Mode](https://docs.px4.io/main/en/flight_modes/offboard) · [PX4 precision landing](https://docs.px4.io/main/en/advanced_features/precland) · [ArduPilot ship landing](https://ardupilot.org/plane/docs/common-ship-landing.html).

**Sea and vessel:** [NOAA historical data](https://www.ndbc.noaa.gov/historical_data.shtml) · [Gazebo surface vehicles](https://gazebosim.org/api/sim/8/surface_vehicles.html) · [asv_wave_sim](https://github.com/srmainwaring/asv_wave_sim) · [OpenFAST SeaState](https://openfast.readthedocs.io/en/dev/source/user/seastate/input_files.html) · [OpenFAST HydroDyn](https://openfast.readthedocs.io/en/main/source/user/hydrodyn/index.html).

**Data and prior work:** [RMA maritime datasets](https://mecatron.rma.ac.be/index.php/publications/datasets/) · [PX4 public flight-log analysis](https://docs.px4.io/main/en/dev_log/flight_log_analysis_statistical) · [AutoSimTest](https://arxiv.org/abs/2501.11864) · [LLM-Land](https://arxiv.org/abs/2505.06399) · [WaveLander](https://arxiv.org/abs/2607.01281) · [FAA UAS Traffic Management](https://www.faa.gov/uas/advanced_operations/traffic_management).

**Local project documents:** [Setup and references](OPUS_BUILD_DAY_SETUP_AND_REFERENCES.md) · [Earlier concept research](OPUS_WAVE_DRONE_CONCEPT_RESEARCH.md) · [Current prototype README](../work/last-safe-second/README.md).
