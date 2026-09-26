import { parentPort, workerData } from "node:worker_threads";
import { createController } from "./public/controllers/builtin.mjs";
const factory = workerData.module
  ? (await import(workerData.module)).createController
  : createController;
const controller = await factory({
  kind: workerData.kind,
  ...workerData.options,
});
parentPort.postMessage({ ready: true });
parentPort.on("message", async (observation) => {
  try {
    parentPort.postMessage({ command: await controller.step(observation) });
  } catch (error) {
    parentPort.postMessage({ error: error.message });
  }
});
