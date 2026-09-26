import test from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../public/core/simulation.mjs";
import { CommandLink } from "../public/core/command-link.mjs";
import { makeConfig } from "../public/core/environment.mjs";
import { Replay } from "../public/core/replay.mjs";
import { rangeRay, onDeck } from "../public/core/geometry.mjs";
import { fromEuler } from "../public/core/math.mjs";
import {
  runEvaluation,
  validateManifest,
  summarize,
} from "../public/core/evaluation.mjs";
import { createController } from "../public/controllers/builtin.mjs";

const hover = { mode: "velocity", velocity: [0, 0, 0], label: "hover" };
test("command transport applies fixed delay, expiry and recovery in simulation time", () => {
  const config = makeConfig({ commandLatencyMs: 200, commandTimeoutMs: 500 });
  const link = new CommandLink(config, hover),
    estimate = { euler: [0, 0, 0] };
  const forward = { mode: "velocity", velocity: [1, 0, 0], label: "forward" };
  link.send(forward, 0);
  assert.equal(link.update(0.199, estimate).label, "hover");
  assert.equal(link.update(0.2, estimate).label, "forward");
  assert.equal(link.snapshot(0.2).delivered, 1);
  link.update(0.5, estimate);
  assert.equal(link.failsafe, true);
  link.send(forward, 0.5);
  assert.equal(link.update(0.7, estimate).label, "forward");
  assert.equal(link.failsafe, false);
});
test("expired packets are rejected and complete packet loss activates the failsafe", () => {
  const estimate = { euler: [0, 0, 0] };
  for (const overrides of [
    { commandLatencyMs: 1000, commandTimeoutMs: 500 },
    { commandDropout: 1 },
  ]) {
    const link = new CommandLink(makeConfig(overrides), hover);
    link.send(hover, 0);
    link.update(1.1, estimate);
    assert.equal(link.delivered, 0);
    assert.equal(link.dropped, 1);
    assert.equal(link.failsafe, true);
  }
});
test("sensor outages produce stale signals and resume on schedule without exposing the schedule", () => {
  const sim = new Simulation({
    faults: [
      { target: "gps", start: 0.5, end: 2 },
      { target: "deck", start: 0.5, end: 2 },
    ],
  });
  const controller = createController({ kind: "hover" });
  while (sim.time < 1.7) sim.advance(controller.step(sim.observation()));
  assert.equal(sim.observation().sensors.gps.valid, false);
  assert.equal(sim.observation().deck, null);
  assert.equal(sim.observation().faults, undefined);
  while (sim.time < 2.5) sim.advance(controller.step(sim.observation()));
  assert.equal(sim.observation().sensors.gps.valid, true);
  assert.ok(sim.observation().deck);
});
test("motor faults reduce actual thrust and are visible in recorded evidence", () => {
  const sim = new Simulation({
    faults: [{ target: "motor", motor: 0, factor: 0, start: 0, end: 5 }],
  });
  for (let i = 0; i < 5; i++)
    sim.advance({ mode: "motors", motors: [0.5, 0.5, 0.5, 0.5] });
  assert.equal(sim.drone.motorEfficiency[0], 0);
  assert.ok(sim.drone.motors[0] < 0.1);
  assert.ok(sim.drone.motors[1] > 7);
  assert.equal(sim.snapshot().faults[0].target, "motor");
});
test("rangefinder follows body attitude and detects the cabin before the deck", () => {
  const c = makeConfig(),
    ocean = { sample: () => ({ height: -3 }) },
    ship = { position: [0, 0, 0], quaternion: fromEuler(0, 0, 0) };
  const drone = {
    position: [-3, 0, 5],
    quaternion: fromEuler(0, 0.2, 0),
    legHeight: 0.28,
  };
  const hit = rangeRay(c, drone, ship, ocean, 0);
  assert.equal(hit.surface, "deck");
  assert.ok(Math.abs(hit.range - (5 / Math.cos(0.2) - 0.28)) < 1e-8);
  drone.position = [4.45, 0, 5];
  drone.quaternion = fromEuler(0, 0, 0);
  const cabin = rangeRay(c, drone, ship, ocean, 0);
  assert.equal(cabin.surface, "superstructure");
  assert.ok(Math.abs(cabin.range - 2.32) < 1e-8);
  drone.position = [20, 0, 5];
  const water = rangeRay(c, drone, ship, ocean, 0);
  assert.equal(water.surface, "water");
  assert.ok(Math.abs(water.range - 7.72) < 0.0001);
  assert.equal(onDeck(c, [7.9, 2, 0]), false);
});
test("configuration rejects impossible pad placements, response values and fault events", () => {
  for (const value of [
    { shipBeam: 2 },
    { padOffset: [6, 0, 0.05] },
    { responsePeriods: [1] },
    { responseDamping: [0, 0, 0, 0, 0, 0] },
    { faults: [{ target: "motor", start: 5, end: 3 }] },
    { faults: [{ target: "motor", motor: 4, factor: 0.5, start: 1, end: 3 }] },
  ])
    assert.throws(() => makeConfig(value));
});
test("replay seeks the original recorded state without executing a controller", () => {
  const sim = new Simulation({ duration: 5 });
  const model = createController({ kind: "hover" });
  while (sim.status === "running") sim.advance(model.step(sim.observation()));
  const data = sim.export(),
    replay = new Replay(data);
  replay.seek(2);
  assert.deepEqual(
    replay.snapshot(),
    data.samples.filter((s) => s.time <= 2).at(-1),
  );
  replay.seek(100);
  assert.equal(replay.ended, true);
  replay.seek(0);
  assert.equal(replay.time, 0);
  assert.deepEqual(replay.export(), data);
  const broken = structuredClone(data);
  broken.samples[3].time = -1;
  assert.throws(() => new Replay(broken));
  const missing = structuredClone(data);
  delete missing.samples[0].ship.pad;
  assert.throws(() => new Replay(missing));
});
test("evaluation retains model errors and timeouts, resets every model, and enforces gates", async () => {
  const manifest = {
    schemaVersion: 1,
    seeds: { development: [1, 2], heldout: [3] },
    scenarios: [{ id: "calm", config: { duration: 5 } }],
    controllers: [
      { id: "hover", kind: "hover" },
      { id: "broken", kind: "hover" },
    ],
    gates: { hover: { minLandingRate: 1, maxImpacts: 0 } },
  };
  let factories = 0;
  const report = await runEvaluation(manifest, "development", async (m) => {
    factories++;
    return m.id === "broken"
      ? {
          step: () => {
            throw new Error("Example failure");
          },
        }
      : createController(m);
  });
  assert.equal(factories, 4);
  assert.equal(report.results.length, 4);
  assert.equal(report.summaries.broken.errors, 2);
  assert.equal(report.summaries.hover.timeouts, 2);
  assert.equal(report.passed, false);
  assert.equal(summarize([{ status: "timeout" }]).landings, 0);
  manifest.seeds.heldout = [1];
  assert.throws(() => validateManifest(manifest));
});
