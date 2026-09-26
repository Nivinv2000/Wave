import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Simulation } from "../public/core/simulation.mjs";
import { createController } from "../public/controllers/builtin.mjs";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../public/demo/data");
await mkdir(dir, { recursive: true });
const results = [];
for (const seed of [17, 18, 19]) for (const kind of ["reactive", "predictive"]) {
  const sim = new Simulation({ preset: "medium", seed, duration: 40 });
  const controller = createController({ kind });
  while (sim.status === "running") sim.advance(controller.step(sim.observation()));
  const file = `${kind}-seed${seed}.json`;
  await writeFile(join(dir, file), JSON.stringify({ ...sim.export(), controller: { type: kind, name: kind, options: {} } }));
  results.push({ seed, controller: kind, file, ...sim.outcome });
  console.log(`${kind} seed ${seed}: ${sim.status}`);
}
const counts = Object.fromEntries(["reactive", "predictive"].map(kind => [kind, {
  landings: results.filter(r => r.controller === kind && r.status === "landed").length,
  attempts: 3,
}]));
await writeFile(join(dir, "comparison.json"), JSON.stringify({
  schemaVersion: 1,
  simulatorVersion: "0.2.0",
  source: "Ocean Flight Lab; local reduced-order research simulator, not PX4/Gazebo",
  preset: "medium", duration: 40, seeds: [17, 18, 19],
  scenario: { hs: 1.3, tp: 6.5, wind: 7, gust: 2, rain: 0.15 },
  counts, results,
}, null, 2));
