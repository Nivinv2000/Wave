import { Simulation } from "./simulation.mjs";
import { makeConfig } from "./environment.mjs";

export function summarize(results) {
  const outcomes = {};
  for (const result of results)
    outcomes[result.status] = (outcomes[result.status] ?? 0) + 1;
  const impacts = results.filter((r) =>
    ["hard-contact", "water-impact", "collision"].includes(r.status),
  ).length;
  const contacts = results.filter((r) =>
    Number.isFinite(r.relativeNormalSpeed),
  );
  return {
    attempts: results.length,
    landings: outcomes.landed ?? 0,
    landingRate: results.length ? (outcomes.landed ?? 0) / results.length : 0,
    impacts,
    timeouts: outcomes.timeout ?? 0,
    errors: outcomes["model-error"] ?? 0,
    outcomes,
    meanContactSpeed: contacts.length
      ? contacts.reduce((sum, r) => sum + r.relativeNormalSpeed, 0) /
        contacts.length
      : null,
  };
}
export function validateManifest(m) {
  if (
    m?.schemaVersion !== 1 ||
    !Array.isArray(m.scenarios) ||
    !m.scenarios.length ||
    m.scenarios.length > 30 ||
    !Array.isArray(m.controllers) ||
    !m.controllers.length ||
    m.controllers.length > 10
  )
    throw new Error("Invalid evaluation manifest");
  const development = m.seeds?.development,
    heldout = m.seeds?.heldout;
  for (const seeds of [development, heldout])
    if (
      !Array.isArray(seeds) ||
      !seeds.length ||
      seeds.length > 50 ||
      new Set(seeds).size !== seeds.length ||
      !seeds.every((s) => Number.isInteger(s) && s >= 0 && s <= 4294967295)
    )
      throw new Error("Seed lists need 1..50 distinct unsigned integers");
  if (development.some((s) => heldout.includes(s)))
    throw new Error("Development and held-out seeds must not overlap");
  const ids = m.controllers.map((c) => c.id);
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== "string" || !id)
  )
    throw new Error("Controller IDs must be unique names");
  for (const c of m.controllers)
    if (!(c.module || ["predictive", "reactive", "hover"].includes(c.kind)))
      throw new Error(
        "Controller needs a built-in kind or trusted module path",
      );
  if (new Set(m.scenarios.map((s) => s.id)).size !== m.scenarios.length)
    throw new Error("Scenario IDs must be unique");
  for (const s of m.scenarios) {
    if (typeof s.id !== "string" || !s.id)
      throw new Error("Scenario needs a name");
    makeConfig(s.config);
  }
  for (const [id, gate] of Object.entries(m.gates ?? {})) {
    if (
      !ids.includes(id) ||
      !Number.isFinite(gate.minLandingRate) ||
      gate.minLandingRate < 0 ||
      gate.minLandingRate > 1 ||
      !Number.isInteger(gate.maxImpacts) ||
      gate.maxImpacts < 0
    )
      throw new Error(
        "Gates need a controller ID, minLandingRate in [0,1] and nonnegative maxImpacts",
      );
  }
  return m;
}
export async function runEvaluation(
  manifest,
  split,
  factory,
  onProgress = () => {},
) {
  validateManifest(manifest);
  if (!["development", "heldout"].includes(split))
    throw new Error("split must be development or heldout");
  const results = [];
  for (const scenario of manifest.scenarios)
    for (const seed of manifest.seeds[split])
      for (const model of manifest.controllers) {
        const sim = new Simulation({ ...scenario.config, seed });
        let controller;
        try {
          controller = await factory(model);
          while (sim.status === "running")
            sim.advance(await controller.step(sim.observation()));
        } catch (error) {
          sim.finish("model-error", { reason: String(error.message ?? error) });
          sim.record();
        } finally {
          await controller?.dispose?.();
        }
        const result = {
          scenario: scenario.id,
          seed,
          controller: model.id,
          ...sim.outcome,
        };
        results.push(result);
        await onProgress(result);
      }
  const summaries = Object.fromEntries(
    manifest.controllers.map((c) => [
      c.id,
      summarize(results.filter((r) => r.controller === c.id)),
    ]),
  );
  const gates = Object.fromEntries(
    Object.entries(manifest.gates ?? {}).map(([id, gate]) => [
      id,
      {
        ...gate,
        passed:
          summaries[id].landingRate >= gate.minLandingRate &&
          summaries[id].impacts <= gate.maxImpacts &&
          summaries[id].errors === 0,
      },
    ]),
  );
  return {
    schemaVersion: 1,
    simulatorVersion: "0.2.0",
    split,
    manifest,
    results,
    summaries,
    gates,
    passed:
      Object.values(gates).every((g) => g.passed) &&
      results.every((r) => r.status !== "model-error"),
  };
}
