# Opus Build Day: wave and drone software concept

**Research snapshot:** 26 September 2026, during the event. This is a software-only, simulator-only proposal for a three-person team. It does not claim a first-ever invention or real-world flight safety.

## Judge's recommendation: The Last Safe Second

**Problem:** A moving-deck drone approach fails. The replay shows what happened, but engineers still need to know *when* an abort would have remained safe and turn that discovery into a check that runs on future software changes.

**Product sentence:** Claude Opus 5.5 reads a short visual replay and motion plots, proposes the last safe abort point and its evidence, and a deterministic simulator branches the same approach at that instant to prove or disprove the proposal. A verified branch is saved as a regression test.

**Stage image:** red failed landing → Opus marks a second on the timeline → the replay forks at that second → green safe outcome → saved test card. The visible fork is the evidence. Opus acts as a flight-test analyst; it does not issue commands to a real aircraft.

### Why this is the strongest domain idea

| Idea checked | What works | Decisive weakness today |
| --- | --- | --- |
| **The Last Safe Second** | Clear physical event, model reads visual/temporal evidence, simulator verifies a counterfactual, durable test artifact | Needs a reliable one-incident simulator and an honest paired model test |
| Crash to Test alone | Model creates a useful executable safety check | An unconstrained test generator is harder to make reliable; broad LLM drone simulation testing already exists |
| Twin Wake | Matched present states with different histories elegantly show why history matters | A standard harmonic fit is a better clean-signal forecaster than an LLM; model's value can look incidental |
| Rescue Window | Human story around delivery to a vessel; land/wait/winch choices | Many moving pieces; simulator can make the choice without Opus, and the medicine premise would need careful evidence |
| Full PX4/Gazebo landing | Technically ambitious and domain-relevant | Too much setup and integration risk before the 15:30 deadline |

The recommended build combines Last Safe Second's clear counterfactual with **one constrained saved test**. Do not add arbitrary generated code, policy rewriting, a winch, PX4, Gazebo, or full 6-DOF motion before submission.

## The exact work for Opus 5.5

Input: 6–10 rendered frames of the approach, plus plots of deck height/tilt, drone height and relative vertical speed. Give the model the fixed touchdown limits and a short description of the abort actuator. Do **not** give it the simulator's computed safe boundary.

Opus must:

1. Identify what made the original touchdown unsafe, citing a visible frame or plot segment.
2. Propose one latest abort time and explain why that moment matters.
3. Return a small structured test specification: replay ID, proposed abort time, evidence references, expected safe/unsafe outcome.
4. Use at most one branch-test call in the judged run; the app shows whether the simulator agrees and records the full trace.

The deterministic software, not the model, calculates deck motion, drone dynamics, safety thresholds, ground truth, and pass/fail. Thresholds are fixed before model runs. This makes a wrong Opus answer visible rather than letting the model grade itself.

### Minimum simulator

Start with one vertical axis: a seeded composite heave signal, a simple descending drone, a fixed reaction delay and upward acceleration after abort. The verifier replays the same seed with and without abort and checks separation and relative impact speed. Pitch and pad geometry are optional polish only after the one-axis experiment works. Label the motion synthetic; do not call it a validated sea-state model.

The oracle scans possible abort times to find the latest safe time. The score includes: whether Opus's proposed branch is safe, how far its time is from that oracle, whether its cited evidence appears in the rendered input, and whether the saved test runs again. An `always abort immediately` rule is a useful baseline for showing why *latest safe* matters.

## 90-second demo

- **0–12 s:** Show the simulated moving-deck near miss and the safety threshold it violates.
- **12–35 s:** Opus inspects the replay frames and plots, then marks its proposed last safe second.
- **35–58 s:** Press replay. The simulator branches at Opus's time and shows the outcome and oracle timing error.
- **58–73 s:** Save the verified branch as a test; rerun it against the baseline and a candidate abort policy.
- **73–90 s:** Show a same-case Opus 5 vs Opus 5.5 result only if actually measured, then state that this is a simulator-only engineering prototype.

Keep the user's stricter 90-second pitch limit even though the public event page says two-minute demos.

## Build order for exactly three people

1. **Simulator and oracle:** one wave seed, original failed descent, branch-at-time, fixed safety score, scan for latest safe abort. This person owns physical assumptions.
2. **Opus and evaluation:** send image sequence and plots, parse constrained output, enforce one branch call, preserve full model trace, run identical Opus 5 and 5.5 cases if both are available.
3. **UI, hosting and submission:** timeline with red/green branch, saved test card, hosted link, rehearsed pitch, all required photos and screen recording.

**11:30 idea checkpoint:** show the product sentence, a prepared near-miss replay, and the three-person split. **13:00 build checkpoint:** one real Opus response, one simulator branch, one objective pass/fail score, one saved test. If this does not work, cut pitch, multi-axis physics, and extra test cases. **14:45:** freeze features and collect submission media. **15:30:** submit a link that remains live for a month.

## Evidence needed for the 'new capability' claim

Anthropic reports much stronger Opus 5.5 performance on **agentic scientific research** (Terminal-Bench-Science 0.1: 58.7% versus Opus 5 at 29.0%), plus gains in chart recognition and computer use. These are Anthropic-reported benchmark results; they do not prove this flight-test task works. The app must run Opus 5 and 5.5 on the **same frozen replays, images, prompt, safety limits, tools, and step budget**, then display each model's actual proposed time, outcome and trace. Add held-out wave seeds and a simple non-LLM baseline. A tie or failure must be shown honestly. Without a measured old-model failure, do not claim that the last model could not handle this specific task.

## Prior art found: claims to avoid

- PX4 supports [precision landing on moving targets](https://docs.px4.io/main/en/advanced_features/precland), and ArduPilot documents [ship landing](https://ardupilot.org/plane/docs/common-ship-landing.html). Moving-platform landing itself is established.
- [LLM-Land](https://arxiv.org/abs/2505.06399) has already studied LLM-assisted context-aware drone landing in ROS/Gazebo. Do not say this is the first LLM drone lander.
- [WaveLander](https://arxiv.org/abs/2607.01281) and other 2026 work cover wave-disturbed landing and prediction. Do not claim wave prediction as novel.
- [AutoSimTest](https://arxiv.org/abs/2501.11864) already uses LLM agents for UAV scenario design, simulator execution and flight-log analysis; its [code is public](https://github.com/UAVLab-SLU/AutoSimTestFramework). Do not say this is the first AI drone testing agent.
- PX4 documents [flight-log analysis](https://docs.px4.io/main/en/log/flight_log_analysis), and services such as [FlightAssistant](https://www.flightassistant.app/) offer AI-assisted ULog diagnosis. Log summarization is established.

A targeted search did **not** surface an exact product that turns a wave-driven near-miss into a single simulator-verified *last safe abort* branch and preserves it as a regression case. That is a narrow research observation, **not** proof that no one has ever built one.

## What could make this an Anthropic feature story

The [event page](https://luma.com/claude-x5dm) says the best builds may be submitted to Anthropic for possible global featuring; it does not promise publication or publish formal editorial criteria. In Anthropic's public [Project Fetch Phase Two](https://www.anthropic.com/news/project-fetch-phase-two), [Biomni](https://www.anthropic.com/customers/biomni), and [Claude Science](https://www.anthropic.com/news/claude-science-ai-workbench) examples, the visible pattern is a concrete task, a check beyond the model's own answer, measured results, reproducible artifacts, and clear limits. That is an observation, not an official checklist.

Today: deliver a crisp live fork, fixed safety oracle, saved test, full traces, and honest same-task model comparison. Later: use realistic vessel motion or recorded flight data; expand to held-out incidents; compare with a classical predictor and a domain expert; get independent review of safety thresholds. A hackathon prototype alone cannot establish real-world flight safety.

**Official model sources:** [Opus 5.5 announcement](https://www.anthropic.com/claude-opus-5-5) · [Vision API: multiple images in one request](https://platform.claude.com/docs/en/build-with-claude/vision) · [Opus 5.5 overview](https://platform.claude.com/docs/en/models/opus-5-5/overview)
