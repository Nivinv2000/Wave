# Opus Build Day: judge's decision and build brief

> **Superseded after the user's domain-specific direction.** The current wave/drone recommendation and prior-art review are in [OPUS_WAVE_DRONE_CONCEPT_RESEARCH.md](OPUS_WAVE_DRONE_CONCEPT_RESEARCH.md). The Napkin Quest idea below should not be used as the current build recommendation; [SketchToGame](https://www.sketchtogame.fun/) is close prior art.

**Decision time:** 26 September 2026, during team formation. The submission deadline is 15:30 IST. The team must have exactly three people.

## Recommendation: Napkin Quest

**One-line pitch:** Photograph a hand-drawn puzzle map; Claude Opus 5.5 turns it into a playable, shareable mini game while preserving the drawing's layout and rules.

Use the **Delight** track. The judge sees the sketch and the working game side by side, then watches a person play it. This makes the model's visual interpretation and the finished result visible in seconds. The product is easy to understand and easy to share. Its main risk is proving that Opus 5.5 handles the same sketches better than Opus 5; run a small, honest head-to-head test rather than claiming the official benchmarks prove this app's result.

### My ranking against the four equal judging criteria

| Candidate | New capability | Works live | Keep or share | Demo clarity | Verdict |
| --- | --- | --- | --- | --- | --- |
| **Napkin Quest** | Strong potential if same-sketch comparison supports it | Good with a fixed game engine | Strong: friends can play each other's sketches | Excellent: drawing becomes a game | **Build this** |
| **Console Rescue** | Strong potential: visual navigation, chart reading and safe action | Risky: computer-use loop and simulated UI must work | Good for operations teams | Good if the run is short | High-ceiling alternate for an experienced agent/UI team |
| **Chart Court** | Plausible chart-reading gain, but the task is familiar | Excellent | Useful to people reviewing charts | Excellent | Reliable fallback, lower surprise |
| **PatchProof** | Crowded coding-agent category | Variable run time | Useful to developers | Needs a lot of explanation | Do not choose for this deadline |
| **VectorFly Flight-Test Lab** | Opus's essential role is unclear | Simulation adds failure points | Narrow audience | Controller comparison needs explanation | Keep as a later research demo |

These are build-risk judgments, not predictions of the event's actual scores.

## Exact product boundary

Input: one photo or uploaded image of a hand-drawn **8 × 8** map with a marked start, exit, walls, and at most one key and locked gate. A clear paper grid is acceptable. Opus returns the interpreted cells, a short theme, a title, and an explanation of any ambiguous mark. Show the interpretation over the original image.

The app validates the result, checks that the exit is reachable, then runs it in an ordinary browser game engine. The model interprets the sketch and chooses the theme; the engine handles movement, collisions, key pickup, victory and sharing. Keep the game playable and deterministic even if the model's wording varies. Reject malformed maps and offer a quick correction of misread cells.

The live demo should use an actual model call and an actual playable result. Keep two already-tested backup sketches. If model output is unreliable, restrict drawings to a visible grid and simple symbols rather than adding features.

## Three-person split

1. **Game and interface:** upload/photo input, sketch and game side by side, keyboard controls, shareable URL.
2. **Opus integration:** image-to-structured-map prompt, schema validation, reachability check, one bounded retry, error messages.
3. **Evidence and delivery:** prepare three test sketches and answer keys, run identical prompts on Opus 5 and 5.5 if available, host and check the URL, rehearse the 90-second demo, capture all submission media.

## Checkpoints and stop rules

- **Immediately:** confirm that one team member can call `claude-opus-5-5` with the Luma-approved account, choose hosting with a server-side API key, and sketch the first level. Keep the key out of the browser and repository.
- **11:30 idea checkpoint:** show the product sentence, three-person roles, and one sample drawing.
- **13:00 build checkpoint:** one genuine photo → Opus response → valid playable level → win screen. If this path fails, cut theme and sharing work until it works.
- **14:30:** verify the hosted link on another device and finish the small model comparison. Keep test cases and results visible, including failures.
- **14:45:** freeze features; rehearse and record. The 15:30 submission needs time for photos and upload.
- **15:30 final submission:** working hosted link kept live for a month, finished-build photo, video or screen recording in action, individual-with-build photo, group photo, detail shots, behind-the-scenes shot, and handwritten note.

## Honest claim for the New Capability criterion

Use the same three sketches, prompt, response schema, and limits for Opus 5 and Opus 5.5. Score whether each output preserves start, exit, walls and key/gate, produces a playable level, and respects the sketch. Display the individual results. Anthropic's reported model benchmarks motivate the test; they are not evidence that the older model fails on these drawings. If both models perform equally, present the working product in the Delight track without claiming a head-to-head win.

## 90-second demo

- **0–10 s:** Show the paper sketch and say, “This drawing is the entire brief.”
- **10–30 s:** Upload it; show Opus identifying start, exit, walls and the key/gate.
- **30–60 s:** Play and finish the generated game live, with the original sketch still visible.
- **60–75 s:** Show the share link and one concise same-sketch comparison, if the results support it.
- **75–90 s:** Say who uses it: anyone who wants to turn a quick drawing into a tiny game friends can play.

## If the team chooses the high-ceiling alternate

**Console Rescue:** a visibly simulated cloud console. Give Opus screenshots and interface actions only, ask it to diagnose a checkout incident, permit a simulated rollback only after it cites evidence, then have a hidden checker confirm service recovery. Require one complete Opus run by 13:00. Build this only if the three-person team already knows how to integrate model tool calls with a browser UI rapidly. Label every rollback as simulated.

## Sources

- [Build Day event page and track descriptions](https://luma.com/claude-x5dm)
- [Anthropic Opus 5.5 announcement](https://www.anthropic.com/claude-opus-5-5)
- [Opus 5.5 model overview](https://platform.claude.com/docs/en/models/opus-5-5/overview)
- [Prompting Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5)
