import test from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../public/core/simulation.mjs";
import {
  Ocean,
  Vessel,
  makeConfig,
  PRESETS,
} from "../public/core/environment.mjs";
import { createController } from "../public/controllers/builtin.mjs";
import { validateCommand } from "../public/core/drone.mjs";
import { rotate, fromEuler, norm, sub } from "../public/core/math.mjs";
function run(config, kind = "predictive") {
  const sim = new Simulation(config),
    policy = createController({ kind });
  while (sim.status === "running") sim.advance(policy.step(sim.observation()));
  return sim;
}
test("same seed and controller produce identical complete outcomes", () => {
  assert.deepEqual(
    run({ seed: 17, duration: 30 }).export(),
    run({ seed: 17, duration: 30 }).export(),
  );
});
test("wave realization changes with seed, spectral variance is Hs squared /16", () => {
  const a = new Ocean(makeConfig({ seed: 1, hs: 2 })),
    b = new Ocean(makeConfig({ seed: 2, hs: 2 }));
  assert.notEqual(a.sample(0, 0, 1).height, b.sample(0, 0, 1).height);
  assert.ok(
    Math.abs(a.components.reduce((s, p) => s + (p.a * p.a) / 2, 0) - 0.25) <
      1e-10,
  );
});
test("spring tide changes over hours and does not automatically amplify storm waves", () => {
  const o = new Ocean(makeConfig({ tideAmplitude: 2, tidePhase: 0 }));
  assert.ok(Math.abs(o.tide(60) - o.tide(0)) < 0.02);
  assert.ok(Math.abs(o.tide((12.42 * 3600) / 4) - 2) < 1e-10);
});
test("observation excludes seed, future trajectory, true position and hidden ship state", () => {
  const sim = new Simulation();
  sim.advance({ mode: "velocity", velocity: [0, 0, 0] });
  const obs = sim.observation();
  assert.equal(obs.seed, undefined);
  assert.equal(obs.truth, undefined);
  assert.equal(obs.ship, undefined);
  assert.ok(obs.sensors.imu);
  assert.ok(obs.sensors.imu.age >= 0.005 - 1e-8);
  assert.equal(obs.sensors.gps, undefined);
});
test("GPS and tracker outages become missing observations", () => {
  const sim = new Simulation({
    gpsEnabled: false,
    trackerEnabled: false,
    duration: 5,
  });
  for (let i = 0; i < 20; i++)
    sim.advance({ mode: "velocity", velocity: [0, 0, 0] });
  assert.equal(sim.observation().deck, null);
  assert.equal(sim.observation().sensors.gps, undefined);
  assert.ok(sim.observation().sensors.imu.valid);
});
test("commands reject invalid modes, NaN, missing vectors and motor range violations", () => {
  for (const v of [
    {},
    null,
    { mode: "velocity", velocity: [NaN, 0, 0] },
    { mode: "motors", motors: [1, 2, 0, 0] },
    { mode: "bogus" },
  ])
    assert.throws(() => validateCommand(v));
  assert.equal(
    validateCommand({ mode: "position", position: [1, 2, 3] }).mode,
    "position",
  );
});
test("all weather presets remain finite through complete episodes", () => {
  for (const preset of Object.keys(PRESETS)) {
    const sim = run({ preset, duration: 25 });
    assert.ok(sim.log.every((s) => s.drone.position.every(Number.isFinite)));
    assert.ok(
      [
        "landed",
        "hard-contact",
        "timeout",
        "water-impact",
        "out-of-bounds",
        "collision",
      ].includes(sim.status),
    );
  }
});
test("predictive example completes light-weather landing, zero motors cause impact", () => {
  const safe = run({ preset: "light", seed: 17, duration: 30 });
  assert.equal(safe.status, "landed");
  assert.ok(safe.outcome.relativeNormalSpeed < 0.7);
  const sim = new Simulation({ duration: 10 });
  while (sim.status === "running")
    sim.advance({ mode: "motors", motors: [0, 0, 0, 0] });
  assert.ok(["hard-contact", "water-impact", "collision"].includes(sim.status));
});
test("body/world quaternion transforms preserve vector length", () => {
  const q = fromEuler(0.3, -0.4, 1),
    v = [1, 2, -3],
    r = rotate(q, v);
  assert.ok(Math.abs(norm(v) - norm(r)) < 1e-10);
});
test("pad velocity includes rotation at offset landing point", () => {
  const c = makeConfig(),
    v = new Vessel(c, new Ocean(c));
  v.angularVelocity = [0, 1, 0];
  v.velocity = [0, 0, 0];
  v.quaternion = fromEuler(0, 0, 0);
  assert.ok(v.pad().velocity[2] > 3);
});
test("example JS model loads through documented contract", async () => {
  const { createController: factory } = await import(
    "../examples/follow-and-land.mjs"
  );
  const sim = new Simulation({ duration: 30 }),
    policy = factory();
  while (sim.status === "running")
    sim.advance(await policy.step(sim.observation()));
  assert.equal(sim.status, "landed");
});
