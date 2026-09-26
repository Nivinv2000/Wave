import {
  G,
  clamp,
  add,
  sub,
  mul,
  norm,
  dot,
  cross,
  rotate,
  qconj,
  fromEuler,
  toEuler,
  integrateQ,
  wrap,
  finiteVec,
} from "./math.mjs";
export const PHYSICS_DT = 0.005,
  CONTROL_DT = 0.05;
export function validateCommand(cmd) {
  if (!cmd || typeof cmd !== "object")
    throw new Error("Controller must return a command object");
  const mode = cmd.mode ?? "velocity";
  if (!["velocity", "position", "motors"].includes(mode))
    throw new Error("mode must be velocity, position or motors");
  if (mode === "velocity" && !finiteVec(cmd.velocity))
    throw new Error("velocity must contain three finite numbers");
  if (mode === "position" && !finiteVec(cmd.position))
    throw new Error("position must contain three finite numbers");
  if (
    mode === "motors" &&
    (!finiteVec(cmd.motors, 4) || cmd.motors.some((v) => v < 0 || v > 1))
  )
    throw new Error("motors must contain four values in [0,1]");
  if (cmd.yaw !== undefined && !Number.isFinite(cmd.yaw))
    throw new Error("yaw must be finite radians");
  return {
    ...cmd,
    mode,
    yaw: cmd.yaw ?? 0,
    label: String(cmd.label ?? mode).slice(0, 100),
  };
}
export class Drone {
  constructor(c, pad) {
    this.c = c;
    this.mass = c.droneMass;
    this.inertia = [0.055, 0.055, 0.095].map((v) => (v * c.droneMass) / 3);
    this.arm = 0.32 / Math.sqrt(2);
    this.rotors = [
      [this.arm, this.arm, 1],
      [-this.arm, this.arm, -1],
      [-this.arm, -this.arm, 1],
      [this.arm, -this.arm, -1],
    ];
    this.position = add(pad.position, [c.initialOffset, 0, c.initialHeight]);
    this.velocity = [...pad.velocity];
    this.quaternion = fromEuler(0, 0, c.heading);
    this.omega = [0, 0, 0];
    this.acceleration = [0, 0, 0];
    this.motors = Array(4).fill((this.mass * G) / 4);
    this.maxRotorThrust = 15;
    this.battery = 1;
    this.legHeight = 0.28;
    this.command = {
      mode: "velocity",
      velocity: [0, 0, 0],
      yaw: c.heading,
      label: "Ready",
    };
    this.motorTargets = [...this.motors];
  }
  setCommand(cmd) {
    this.command = validateCommand(cmd);
  }
  step(dt, wind, estimate) {
    const cmd = this.command,
      limit = this.maxRotorThrust * (0.8 + 0.2 * this.battery);
    let motor;
    if (cmd.mode === "motors") motor = cmd.motors.map((v) => v * limit);
    else {
      let desiredV =
        cmd.mode === "position"
          ? sub(cmd.position, estimate.position).map((v) =>
              clamp(v * 0.8, -5, 5),
            )
          : cmd.velocity.map((v) => clamp(v, -6, 6));
      const acc = sub(desiredV, estimate.velocity).map((v, i) =>
        clamp(v * (i === 2 ? 3 : 2.3), i === 2 ? -5 : -6, i === 2 ? 6 : 6),
      );
      const yaw = estimate.euler[2],
        roll = clamp(
          (acc[0] * Math.sin(yaw) - acc[1] * Math.cos(yaw)) / G,
          -0.55,
          0.55,
        ),
        pitch = clamp(
          (acc[0] * Math.cos(yaw) + acc[1] * Math.sin(yaw)) / G,
          -0.55,
          0.55,
        );
      const target = [roll, pitch, cmd.yaw],
        tau = target.map(
          (v, i) =>
            this.inertia[i] *
            (22 * wrap(v - estimate.euler[i]) - 7 * estimate.omega[i]),
        );
      const collective = clamp(
          (this.mass * (G + acc[2])) /
            Math.max(
              0.4,
              Math.cos(estimate.euler[0]) * Math.cos(estimate.euler[1]),
            ),
          0,
          4 * limit,
        ),
        r = this.arm,
        k = 0.025;
      motor = this.rotors.map(([x, y, spin]) =>
        clamp(
          collective / 4 +
            (tau[0] * y) / (4 * r * r) -
            (tau[1] * x) / (4 * r * r) +
            (tau[2] * spin) / (4 * k),
          0,
          limit,
        ),
      );
    }
    this.motorTargets = motor;
    for (let i = 0; i < 4; i++)
      this.motors[i] +=
        (motor[i] - this.motors[i]) * (1 - Math.exp(-dt / 0.055));
    const thrust = this.motors.reduce((a, b) => a + b, 0),
      force = rotate(this.quaternion, [0, 0, thrust]),
      relative = sub(this.velocity, wind),
      drag = mul(relative, -0.5 * 1.225 * 0.1 * norm(relative));
    this.acceleration = add(mul(add(force, drag), 1 / this.mass), [0, 0, -G]);
    this.velocity = add(this.velocity, mul(this.acceleration, dt));
    this.position = add(this.position, mul(this.velocity, dt));
    const torque = [0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const [x, y, spin] = this.rotors[i],
        f = this.motors[i];
      torque[0] += y * f;
      torque[1] -= x * f;
      torque[2] += spin * 0.025 * f;
    }
    const gyroscopic = cross(
      this.omega,
      this.omega.map((v, i) => v * this.inertia[i]),
    );
    this.omega = this.omega.map(
      (v, i) =>
        v + ((torque[i] - gyroscopic[i] - 0.025 * v) / this.inertia[i]) * dt,
    );
    this.quaternion = integrateQ(this.quaternion, this.omega, dt);
    const power =
      35 +
      this.motors.reduce((s, f) => s + 7 * Math.pow(Math.max(0, f), 1.5), 0);
    this.battery = clamp(this.battery - (power * dt) / (80 * 3600), 0, 1);
  }
  truth() {
    return {
      position: [...this.position],
      velocity: [...this.velocity],
      quaternion: [...this.quaternion],
      euler: toEuler(this.quaternion),
      omega: [...this.omega],
      acceleration: [...this.acceleration],
      motors: [...this.motors],
      motorTargets: [...this.motorTargets],
      battery: this.battery,
    };
  }
}
