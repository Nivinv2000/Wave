# Ocean Flight Lab — 90-second local demo

This is a working presentation of the project's **own browser simulator**. It is not a PX4/Gazebo run, a validated ship model, or an Opus-controlled aircraft. The page plays six recorded flights generated with the same simulator physics, ship motion, aircraft, sensors and contact rules. Each reactive/predictive pair uses the same weather and wave seed.

## Start

In `work/ocean-flight-lab`:

```sh
node demo/build-demo.mjs
npm start
```

Open `http://127.0.0.1:4180/demo/index.html` in a full-width desktop browser. The six recordings and comparison table are generated under `public/demo/data/`. Three.js is included locally. Use **Play both flights**, choose seeds 17, 18 or 19, and change playback speed as needed. The full simulator remains at `/`.

## What this run shows

The `medium` preset uses significant wave height 1.3 m, peak period 6.5 s, mean wind 7 m/s and gust RMS 2 m/s. For seeds 17–19 in the current implementation, predictive landed **3/3**, while reactive landed **1/3** with two hard contacts. These are outcomes inside the documented reduced-order simulation; the sample is too small to establish real-world reliability. The page links all six outcome records, and each recording contains the full trajectory and sensor observations.

## 90-second presentation

1. **0–15 s:** “A deck moves after the drone decides to descend. We compare current-state landing with short-horizon timing under the same waves and wind.” Point to the shared seed and the two aircraft.
2. **15–45 s:** press **Play both flights** at 2×. Point out deck motion, aircraft paths, decision labels and differing touchdown results. Seed 17 shows reactive hard contact and predictive landing.
3. **45–65 s:** switch to seed 18 and play. This is a second matching failure/success pair; seed 19 lands with both. State all three results, including the reactive success.
4. **65–80 s:** show the evidence panel and download link. State that the same initial state, weather seed, aircraft and landing envelope were used.
5. **80–90 s:** identify the next step: port the high-level decision to PX4 SITL + Gazebo and test physical wind, deck obstruction and sensor measurements. Do not describe this recording as PX4.

If the team records this on screen for submission, capture the actual browser page and keep the spoken pitch under 90 seconds. The event also requires photos of the build, builders, details, behind-the-scenes work and a handwritten note; the team must supply those separately.
