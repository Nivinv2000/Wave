# Teammate Setup — Ocean Flight Lab

## What This Is

A browser-based drone-landing simulator. A moving ship deck, ocean waves, wind, sensor noise. The drone must land safely. Your job is to get this running and verify it works before we wire Claude agents on top.

---

## Prerequisites

| Tool | Min version | Check |
|------|-------------|-------|
| Node.js | 20+ | `node --version` |
| Python | 3.10+ | `python --version` |

No other installs needed for the sim itself.

---

## Run the Simulator

```bash
cd Wave/work/ocean-flight-lab
node server.mjs
```

Open the URL it prints (default: `http://localhost:8080`) in your browser.

---

## What to Test

Work through these in order. Report pass/fail for each.

### 1. Basic launch
- [ ] Page loads without errors
- [ ] 3D viewport shows ocean + ship + drone

### 2. Run a simulation
- [ ] Click **Run simulation** — drone should move and attempt to land
- [ ] Telemetry chart updates in real time
- [ ] Outcome shows in the result panel (landed / hard-contact / timeout / water-impact)

### 3. Weather presets
Test each preset from the dropdown — confirm the ocean motion visibly changes:
- [ ] Light breeze
- [ ] Moderate sea
- [ ] Severe storm

### 4. Controller modes
Switch controller (top-right panel) and run each:
- [ ] Built-in · predictive landing
- [ ] Built-in · reactive landing
- [ ] Built-in · follow & hover

### 5. Python HTTP controller slot
This is the slot Claude agents will use later.

Start the example Python controller in a separate terminal:
```bash
cd Wave/work/ocean-flight-lab
python examples/python_controller.py
```

In the browser, select **Python / HTTP model** from the controller dropdown, click **Attach model & reset flight**, then run. The drone should still fly (using the example policy inside the Python file).

- [ ] Python controller connects without error
- [ ] Drone responds to commands from Python

### 6. Batch runner
```bash
node batch.mjs
```
- [ ] Runs multiple episodes and prints outcomes to terminal

### 7. Export
- [ ] Click **Export flight log** — downloads a JSON file
- [ ] Open the JSON and confirm it has `samples`, `outcome`, and `config` keys

---

## Key Files to Understand

```
work/ocean-flight-lab/
  public/core/simulation.mjs   ← main sim loop (advance, contact, finish)
  public/core/drone.mjs        ← drone physics (200 Hz)
  public/core/environment.mjs  ← ocean waves, vessel, wind
  public/core/sensors.mjs      ← GPS, deck tracker, noise, latency
  public/controllers/builtin.mjs ← predictive + reactive controllers
  examples/python_controller.py  ← Python HTTP controller template
  server.mjs                   ← Node server (serves UI + proxies Python)
  batch.mjs                    ← headless batch runner
```

---

## Python Controller Interface (for Claude agent wiring)

The Python file at `examples/python_controller.py` is a template. It runs an HTTP server at `localhost:8765`. The sim sends an observation JSON every control tick (20 Hz) and expects a command JSON back.

**Observation shape (what Claude receives):**
```json
{
  "estimate": {
    "position": [x, y, z],
    "velocity": [vx, vy, vz],
    "quaternion": [qx, qy, qz, qw]
  },
  "deck": {
    "position": [x, y, z],
    "velocity": [vx, vy, vz],
    "euler": [roll, pitch, yaw],
    "age": 0.05
  },
  "battery": 0.97,
  "mission": { "duration": 120 }
}
```

**Command shape (what Claude returns):**
```json
{
  "mode": "velocity",
  "velocity": [vx, vy, vz],
  "yaw": 0.0
}
```

---

## Report Back

Once all checkboxes above are ticked, confirm:
1. Predictive vs reactive — which one lands more reliably?
2. Any scenario (weather/seed combo) where both controllers consistently fail?
3. Does the batch runner output a success rate?

That failure scenario becomes the first test case for Claude.
