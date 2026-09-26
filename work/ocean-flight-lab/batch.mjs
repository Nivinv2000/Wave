import { Simulation } from "./public/core/simulation.mjs";
import { createController } from "./public/controllers/builtin.mjs";
import { writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const args = process.argv.slice(2),
  get = (key, fallback) => {
    const i = args.indexOf("--" + key);
    return i < 0 ? fallback : args[i + 1];
  };
const preset = get("weather", "light"),
  kind = get("controller", "predictive"),
  n = Number(get("runs", "5")),
  baseSeed = Number(get("seed", "17")),
  duration = Number(get("duration", "120")),
  model = get("model", null);
if (!Number.isInteger(n) || n < 1 || n > 1000)
  throw new Error("runs must be 1..1000");
let factory = createController;
if (model)
  factory = (await import(pathToFileURL(process.cwd() + "/" + model)))
    .createController;
const results = [];
for (let i = 0; i < n; i++) {
  const sim = new Simulation({ preset, seed: baseSeed + i, duration }),
    controller = await factory({ kind });
  while (sim.status === "running") {
    const cmd = await controller.step(sim.observation());
    sim.advance(cmd);
  }
  results.push({ seed: baseSeed + i, ...sim.outcome });
  console.log(JSON.stringify(results.at(-1)));
}
await mkdir("reports", { recursive: true });
await writeFile(
  get("output", `reports/${preset}-${kind}-seed${baseSeed}.json`),
  JSON.stringify(
    { weather: preset, controller: model ?? kind, duration, results },
    null,
    2,
  ),
);
console.log(
  `Saved ${results.length} runs to ${get("output", `reports/${preset}-${kind}-seed${baseSeed}.json`)}`,
);
