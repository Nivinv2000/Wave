import {
  makeConfig,
  Ocean,
  Vessel,
  Wind,
  activeFaults,
} from "./environment.mjs";
import { insideCabin, onDeck } from "./geometry.mjs";
import { CommandLink } from "./command-link.mjs";
import { Drone, PHYSICS_DT, CONTROL_DT } from "./drone.mjs";
import { Sensors } from "./sensors.mjs";
import {
  add,
  sub,
  norm,
  rotate,
  qconj,
  dot,
  toEuler,
  wrap,
  mul,
} from "./math.mjs";
export class Simulation {
  constructor(input = {}) {
    this.config = makeConfig(input);
    this.ocean = new Ocean(this.config);
    this.ship = new Vessel(this.config, this.ocean);
    this.wind = new Wind(this.config);
    this.drone = new Drone(this.config, this.ship.pad());
    this.sensors = new Sensors(this.config, this.drone);
    this.time = 0;
    this.status = "running";
    this.outcome = null;
    this.log = [];
    this.events = [];
    this.command = {
      mode: "velocity",
      velocity: [...this.ship.velocity],
      yaw: this.config.heading,
      label: "Awaiting controller",
    };
    this.drone.setCommand(this.command);
    this.issuedCommand = this.command;
    this.link = new CommandLink(this.config, this.command);
    this.previousFaults = "";
    this.previousFailsafe = false;
    this.sensors.update(0, PHYSICS_DT, this.drone, this.ship, this.ocean);
    this.record();
  }
  observation() {
    return {
      ...this.sensors.observation(this.time),
      battery: this.drone.battery,
      commandLink: this.link.snapshot(this.time),
      mission: {
        landingGearHeight: this.drone.legHeight,
        duration: this.config.duration,
      },
    };
  }
  advance(command) {
    if (this.status !== "running") return this.snapshot();
    this.link.send(command, this.time);
    this.issuedCommand = structuredClone(command);
    for (let k = 0; k < Math.round(CONTROL_DT / PHYSICS_DT); k++) {
      this.command = this.link.update(this.time, this.sensors.estimate);
      this.drone.setCommand(this.command);
      const faults = activeFaults(this.config, this.time),
        key = JSON.stringify(faults);
      if (
        key !== this.previousFaults &&
        (faults.length || this.previousFaults !== "")
      ) {
        this.events.push({
          time: this.time,
          type: "faults",
          active: faults,
          reason: faults.length
            ? "Active faults: " + faults.map((f) => f.target).join(", ")
            : "Scheduled faults cleared",
        });
      }
      this.previousFaults = key;
      if (this.previousFailsafe !== this.link.failsafe)
        this.events.push({
          time: this.time,
          type: "command-link",
          reason: this.link.failsafe
            ? "Command deadline exceeded"
            : "Command delivery recovered",
        });
      this.previousFailsafe = this.link.failsafe;
      this.drone.motorEfficiency = [1, 1, 1, 1];
      for (const f of faults.filter((f) => f.target === "motor"))
        this.drone.motorEfficiency[f.motor] = Math.min(
          this.drone.motorEfficiency[f.motor],
          f.factor,
        );
      this.time += PHYSICS_DT;
      this.ship.update(this.time, PHYSICS_DT);
      this.wind.update(PHYSICS_DT);
      this.drone.step(PHYSICS_DT, this.wind.velocity, this.sensors.estimate);
      this.sensors.update(
        this.time,
        PHYSICS_DT,
        this.drone,
        this.ship,
        this.ocean,
      );
      this.contact();
      if (this.status !== "running") break;
    }
    if (this.time >= this.config.duration && this.status === "running")
      this.finish("timeout", { reason: "No landing before episode deadline" });
    if (
      !this.drone.position.every(Number.isFinite) &&
      this.status === "running"
    )
      this.finish("invalid", { reason: "Dynamics became non-finite" });
    this.record();
    return this.snapshot();
  }
  contact() {
    const d = this.drone,
      s = this.ship,
      c = this.config,
      local = rotate(qconj(s.quaternion), sub(d.position, s.position)),
      pad = s.pad();
    if (insideCabin(c, local, 0.1)) {
      this.finish("collision", { reason: "Contact with ship superstructure" });
      return;
    }
    if (onDeck(c, local) && local[2] <= d.legHeight + 0.03) {
      const surfaceVel = s.pointVelocity(d.position),
        relative = sub(d.velocity, surfaceVel),
        normal = rotate(s.quaternion, [0, 0, 1]),
        vertical = Math.abs(dot(relative, normal)),
        tangential = Math.sqrt(
          Math.max(0, norm(relative) ** 2 - vertical ** 2),
        ),
        padError = Math.hypot(
          local[0] - c.padOffset[0],
          local[1] - c.padOffset[1],
        ),
        attitude = toEuler(d.quaternion),
        tilt = Math.hypot(
          wrap(attitude[0] - s.euler[0]),
          wrap(attitude[1] - s.euler[1]),
        ),
        ok =
          padError < c.padRadius &&
          vertical < 0.7 &&
          tangential < 1 &&
          tilt < 0.26 &&
          Math.hypot(s.euler[0], s.euler[1]) < 0.35;
      this.finish(ok ? "landed" : "hard-contact", {
        reason: ok
          ? "Touchdown inside configured envelope"
          : "Touchdown outside configured envelope",
        relativeNormalSpeed: vertical,
        relativeTangentialSpeed: tangential,
        padError,
        relativeTiltDeg: (tilt * 180) / Math.PI,
      });
      return;
    }
    if (
      d.position[2] - d.legHeight <=
      this.ocean.sample(d.position[0], d.position[1], this.time).height
    )
      this.finish("water-impact", {
        reason: "Aircraft reached the water surface",
      });
    if (norm(sub(d.position, pad.position)) > 250)
      this.finish("out-of-bounds", {
        reason: "Aircraft exceeded the 250 m test boundary",
      });
  }
  finish(status, extra) {
    if (this.status !== "running") return;
    this.status = status;
    this.outcome = { status, time: this.time, ...extra };
    this.events.push(this.outcome);
  }
  snapshot() {
    return {
      time: this.time,
      status: this.status,
      outcome: this.outcome,
      drone: this.drone.truth(),
      ship: {
        position: [...this.ship.position],
        quaternion: [...this.ship.quaternion],
        euler: [...this.ship.euler],
        velocity: [...this.ship.velocity],
        axes: [...this.ship.axes],
        rates: [...this.ship.rates],
        pad: this.ship.pad(),
      },
      wind: [...this.wind.velocity],
      observation: this.observation(),
      command: this.command,
      issuedCommand: this.issuedCommand,
      link: this.link.snapshot(this.time),
      faults: activeFaults(this.config, this.time),
    };
  }
  record() {
    this.log.push(this.snapshot());
  }
  export() {
    return {
      schemaVersion: 1,
      simulatorVersion: "0.2.0",
      description:
        "Reduced-order engineering simulation; not vessel-calibrated",
      config: this.config,
      outcome: this.outcome,
      events: this.events,
      samples: this.log,
    };
  }
}
