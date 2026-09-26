import { rng } from "./math.mjs";
import { activeFaults } from "./environment.mjs";
import { validateCommand } from "./drone.mjs";

export class CommandLink {
  constructor(config, initialCommand) {
    this.c = config;
    this.random = rng(config.seed ^ 0x739183);
    this.queue = [];
    this.applied = initialCommand;
    this.lastSample = 0;
    this.lastReceived = null;
    this.dropped = 0;
    this.delivered = 0;
    this.failsafe = false;
  }
  send(command, time) {
    const cmd = structuredClone(validateCommand(command));
    if (
      this.random() < this.c.commandDropout ||
      activeFaults(this.c, time, "link").length
    ) {
      this.dropped++;
      return;
    }
    this.queue.push({
      command: cmd,
      sampleTime: time,
      delivery: time + this.c.commandLatencyMs / 1000,
    });
  }
  update(time, estimate) {
    while (this.queue.length && this.queue[0].delivery <= time + 1e-9) {
      const packet = this.queue.shift();
      if (
        activeFaults(this.c, time, "link").length ||
        time - packet.sampleTime >= this.c.commandTimeoutMs / 1000
      ) {
        this.dropped++;
        continue;
      }
      this.applied = packet.command;
      this.lastSample = packet.sampleTime;
      this.lastReceived = time;
      this.delivered++;
      this.failsafe = false;
    }
    if (time - this.lastSample >= this.c.commandTimeoutMs / 1000 - 1e-9) {
      this.failsafe = true;
      this.applied = {
        mode: "velocity",
        velocity: [0, 0, 0],
        yaw: estimate.euler[2],
        label: "Command deadline exceeded: brake and hover",
      };
    }
    return this.applied;
  }
  snapshot(time) {
    return {
      latencyMs: this.c.commandLatencyMs,
      age: this.lastReceived === null ? null : time - this.lastSample,
      delivered: this.delivered,
      dropped: this.dropped,
      pending: this.queue.length,
      failsafe: this.failsafe,
    };
  }
}
