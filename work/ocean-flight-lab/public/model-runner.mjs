import { createController } from "./controllers/builtin.mjs";
import { validateCommand } from "./core/drone.mjs";
export class ModelRunner {
  constructor() {
    this.worker = null;
    this.pending = new Map();
    this.id = 0;
    this.lastMs = 0;
  }
  dispose() {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("Controller reset"));
    }
    this.pending.clear();
  }
  callWorker(message, timeout = 700) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.worker?.terminate();
        this.worker = null;
        reject(new Error(`Model exceeded ${timeout} ms; simulation paused.`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ ...message, id });
    });
  }
  async attach(kind, source, options = {}) {
    this.dispose();
    this.kind = kind;
    if (kind === "custom") {
      this.worker = new Worker("/controller-worker.mjs", { type: "module" });
      this.worker.onmessage = ({ data: m }) => {
        const p = this.pending.get(m.id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(m.id);
        m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
      };
      this.worker.onerror = (e) => {
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error(e.message || "Controller module failed"));
        }
        this.pending.clear();
      };
      await this.callWorker({ type: "init", source, options }, 2000);
    } else if (kind === "python") {
      const r = await fetch("/api/model/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!r.ok) {
        let msg;
        try {
          msg = (await r.json()).error;
        } catch {}
        throw new Error(msg ?? "Python model reset failed");
      }
    } else this.controller = createController({ kind, ...options });
  }
  async step(observation) {
    const t = performance.now();
    let cmd;
    if (this.kind === "custom")
      cmd = await this.callWorker({ type: "step", observation });
    else if (this.kind === "python") {
      const r = await fetch("/api/model/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ observation }),
        signal: AbortSignal.timeout(2500),
      });
      if (!r.ok) {
        let body;
        try {
          body = await r.json();
        } catch {}
        throw new Error(body?.error ?? "Python inference failed");
      }
      cmd = await r.json();
    } else cmd = await this.controller.step(observation);
    this.lastMs = performance.now() - t;
    return validateCommand(cmd);
  }
}
