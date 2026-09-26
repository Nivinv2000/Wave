import assert from "node:assert/strict";
import { DEFAULT_SEED, latestSafeAbort, simulate } from "./public/sim.mjs";

const baseline = simulate(DEFAULT_SEED);
assert.equal(baseline.seed, DEFAULT_SEED);
assert.ok(baseline.samples.length > 2);
assert.ok(baseline.contact, "default run should touch the deck");
assert.equal(baseline.safe, false, "default baseline touchdown should be unsafe");

const earlyAbort = simulate(DEFAULT_SEED, 0);
assert.equal(earlyAbort.contact, null, "early abort should avoid contact");
assert.equal(earlyAbort.safe, true, "early abort should clear the deck");

const latest = latestSafeAbort(DEFAULT_SEED);
assert.ok(Number.isFinite(latest.time), "a latest safe abort time should exist");
assert.deepEqual(latest.baselineContact, baseline.contact);
assert.equal(latest.baselineSafe, false);
assert.equal(simulate(DEFAULT_SEED, latest.time).safe, true);
assert.equal(simulate(DEFAULT_SEED, latest.time + baseline.dt).safe, false,
  "the next sampled abort time should be too late");

const repeat = simulate(DEFAULT_SEED);
assert.deepEqual(repeat, baseline, "same seed must replay deterministically");

console.log({
  baseline: { contact: baseline.contact, safe: baseline.safe, reason: baseline.reason },
  earliestAbort: { safe: earlyAbort.safe, reason: earlyAbort.reason },
  latest,
});
