import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { runEvaluation } from "./public/core/evaluation.mjs";
const args = process.argv.slice(2);
const get = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i < 0 ? fallback : args[i + 1];
};
const manifestPath = resolve(get("manifest", "evaluation/default.json"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const split = get("split", "development");
const modelHashes = {};
for (const model of manifest.controllers)
  if (model.module) {
    const file = resolve(dirname(manifestPath), model.module);
    modelHashes[model.id] = createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
  }
const report = await runEvaluation(
  manifest,
  split,
  async (model) => {
    const worker = new Worker(new URL("./policy-worker.mjs", import.meta.url), {
      workerData: {
        ...model,
        module: model.module
          ? pathToFileURL(resolve(dirname(manifestPath), model.module)).href
          : undefined,
      },
    });
    // Termination bounds inference; workers are NOT a security sandbox for untrusted code.
    const receive = (timeout = 700) =>
      new Promise((resolveMessage, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          worker.off("message", message);
          worker.off("error", fail);
          worker.off("exit", exit);
        };
        const fail = (error) => {
          cleanup();
          reject(error);
        };
        const message = (value) => {
          cleanup();
          value.error ? reject(new Error(value.error)) : resolveMessage(value);
        };
        const exit = (code) => fail(new Error(`Model worker exited (${code})`));
        const timer = setTimeout(() => {
          fail(new Error(`Model exceeded ${timeout} ms`));
          worker.terminate();
        }, timeout);
        worker.once("message", message);
        worker.once("error", fail);
        worker.once("exit", exit);
      });
    try {
      await receive(2000);
    } catch (error) {
      await worker.terminate();
      throw error;
    }
    return {
      step: async (observation) => {
        const pending = receive();
        worker.postMessage(observation);
        return (await pending).command;
      },
      dispose: () => worker.terminate(),
    };
  },
  (result) =>
    console.log(
      `${result.controller} / ${result.scenario} / ${result.seed}: ${result.status}`,
    ),
);
report.modelHashes = modelHashes;
const output = resolve(get("output", `reports/evaluation-${split}.json`));
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.summaries, null, 2));
console.log(`Saved ${output}; gates ${report.passed ? "passed" : "failed"}`);
if (!report.passed) process.exitCode = 1;
