import { makeConfig, Ocean } from "./environment.mjs";
import { finiteVec } from "./math.mjs";

export function validateRecording(data) {
  if (
    !data ||
    data.schemaVersion !== 1 ||
    !["0.1.0", "0.2.0"].includes(data.simulatorVersion) ||
    !Array.isArray(data.samples) ||
    !data.samples.length ||
    data.samples.length > 12002
  )
    throw new Error(
      "Expected an Ocean Flight Lab v0.1/v0.2 episode JSON with 1..12002 frames",
    );
  makeConfig(data.config);
  let previous = -1;
  for (const s of data.samples) {
    if (
      !s ||
      !Number.isFinite(s.time) ||
      s.time < 0 ||
      s.time > 601 ||
      s.time <= previous ||
      !finiteVec(s.drone?.position) ||
      !finiteVec(s.drone?.velocity) ||
      !finiteVec(s.drone?.quaternion, 4) ||
      !finiteVec(s.drone?.motors, 4) ||
      !Number.isFinite(s.drone?.battery) ||
      !finiteVec(s.ship?.position) ||
      !finiteVec(s.ship?.quaternion, 4) ||
      !finiteVec(s.ship?.euler) ||
      !finiteVec(s.ship?.pad?.position) ||
      !finiteVec(s.ship?.pad?.velocity) ||
      !finiteVec(s.ship?.pad?.quaternion, 4) ||
      !finiteVec(s.wind) ||
      !finiteVec(s.observation?.estimate?.position) ||
      !s.observation?.sensors ||
      typeof s.command?.label !== "string" ||
      typeof s.status !== "string"
    )
      throw new Error(
        "Recording contains an invalid, missing, or out-of-order frame",
      );
    previous = s.time;
  }
  if (!Array.isArray(data.events))
    throw new Error("Recording needs an events array");
  return data;
}

// Recorded states are displayed directly. No policy code or physics is executed.
export class Replay {
  constructor(data) {
    this.data = structuredClone(validateRecording(data));
    this.config = makeConfig(data.config);
    this.ocean = new Ocean(this.config);
    this.index = 0;
  }
  get time() {
    return this.snapshot().time;
  }
  get ship() {
    return this.snapshot().ship;
  }
  get status() {
    return this.snapshot().status;
  }
  get outcome() {
    return this.snapshot().outcome;
  }
  get log() {
    return this.data.samples.slice(0, this.index + 1);
  }
  get events() {
    return this.data.events.filter((e) => e.time <= this.time);
  }
  get endTime() {
    return this.data.samples.at(-1).time;
  }
  get ended() {
    return this.index === this.data.samples.length - 1;
  }
  seek(time) {
    let lo = 0,
      hi = this.data.samples.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.data.samples[mid].time <= time) lo = mid;
      else hi = mid - 1;
    }
    this.index = lo;
    return this.snapshot();
  }
  advance() {
    this.index = Math.min(this.index + 1, this.data.samples.length - 1);
    return this.snapshot();
  }
  snapshot() {
    return this.data.samples[this.index];
  }
  export() {
    return this.data;
  }
}
