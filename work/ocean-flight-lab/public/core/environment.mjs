import {
  G,
  rng,
  gaussian,
  clamp,
  fromEuler,
  rotate,
  add,
  sub,
  mul,
  cross,
} from "./math.mjs";
export const PRESETS = {
  light: {
    label: "Light breeze",
    hs: 0.35,
    tp: 4.5,
    wind: 2.5,
    gust: 0.7,
    rain: 0,
    visibility: 1500,
    current: 0.15,
    gamma: 3.3,
  },
  medium: {
    label: "Moderate sea",
    hs: 1.3,
    tp: 6.5,
    wind: 7,
    gust: 2,
    rain: 0.15,
    visibility: 600,
    current: 0.4,
    gamma: 3.3,
  },
  extreme: {
    label: "Severe storm",
    hs: 4.5,
    tp: 9,
    wind: 18,
    gust: 5,
    rain: 0.9,
    visibility: 100,
    current: 1,
    gamma: 3.3,
  },
  swell: {
    label: "Long ocean swell",
    hs: 2,
    tp: 13,
    wind: 4,
    gust: 1,
    rain: 0,
    visibility: 1200,
    current: 0.3,
    gamma: 1.2,
  },
  spring: {
    label: "Spring tide + moderate sea",
    hs: 1.3,
    tp: 6.5,
    wind: 7,
    gust: 2,
    rain: 0.1,
    visibility: 600,
    current: 1.1,
    gamma: 3.3,
    tideAmplitude: 1.5,
    tidePhase: Math.PI / 2,
  },
  rogue: {
    label: "Focused large-wave event",
    hs: 2,
    tp: 8,
    wind: 10,
    gust: 3,
    rain: 0.35,
    visibility: 300,
    current: 0.6,
    gamma: 3.3,
    focused: true,
  },
};
export const DEFAULTS = {
  seed: 17,
  preset: "light",
  duration: 120,
  shipSpeed: 0.5,
  heading: 0,
  waveDirection: 0.6,
  windDirection: 0.35,
  tideAmplitude: 0.4,
  tidePhase: 0,
  noise: 1,
  gpsEnabled: true,
  trackerEnabled: true,
  trackerSource: "vision",
  modelTimeoutMs: 700,
  droneMass: 3,
  initialHeight: 7,
  initialOffset: -6,
  shipLength: 16,
  shipBeam: 5.8,
  freeboard: 2,
  padOffset: [-3.2, 0, 0.05],
  padRadius: 1.8,
  responsePeriods: [8, 9, 3.8, 5.2, 4.6, 10],
  responseDamping: [0.9, 0.9, 0.7, 0.5, 0.7, 0.9],
  maxRotorThrust: 15,
  armRadius: 0.32,
  motorLagMs: 55,
  batteryWh: 80,
  initialBattery: 1,
  commandLatencyMs: 0,
  commandDropout: 0,
  commandTimeoutMs: 1000,
  faults: [],
};
export function makeConfig(input = {}) {
  const preset = input.preset ?? "light";
  if (!PRESETS[preset]) throw new Error("Unknown weather preset");
  const c = { ...DEFAULTS, ...PRESETS[preset], ...input };
  const bounds = {
    seed: [0, 4294967295],
    hs: [0, 8],
    tp: [2, 20],
    wind: [0, 30],
    gust: [0, 12],
    rain: [0, 1],
    visibility: [10, 10000],
    current: [0, 3],
    tideAmplitude: [0, 4],
    shipSpeed: [0, 5],
    noise: [0, 5],
    droneMass: [1, 10],
    initialHeight: [2, 30],
    duration: [5, 600],
    gamma: [1, 7],
    heading: [-6.2832, 6.2832],
    waveDirection: [-6.2832, 6.2832],
    windDirection: [-6.2832, 6.2832],
    shipLength: [5, 60],
    shipBeam: [2, 20],
    freeboard: [0.5, 8],
    padRadius: [0.3, 8],
    initialOffset: [-100, 100],
    tidePhase: [-6.2832, 6.2832],
    maxRotorThrust: [2, 100],
    armRadius: [0.15, 1],
    motorLagMs: [5, 500],
    batteryWh: [1, 1000],
    initialBattery: [0, 1],
    commandLatencyMs: [0, 3000],
    commandDropout: [0, 1],
    commandTimeoutMs: [100, 5000],
  };
  for (const [k, [a, b]] of Object.entries(bounds))
    if (!Number.isFinite(c[k]) || c[k] < a || c[k] > b)
      throw new Error(`${k} must be between ${a} and ${b}`);
  if (!Number.isInteger(c.seed)) throw new Error("Seed must be an integer");
  if (
    !Array.isArray(c.padOffset) ||
    c.padOffset.length !== 3 ||
    !c.padOffset.every(Number.isFinite)
  )
    throw new Error("padOffset requires three finite metres");
  if (!["vision", "radio"].includes(c.trackerSource))
    throw new Error("trackerSource must be vision or radio");
  for (const [name, min, max] of [
    ["responsePeriods", 1, 30],
    ["responseDamping", 0.1, 3],
  ]) {
    if (
      !Array.isArray(c[name]) ||
      c[name].length !== 6 ||
      !c[name].every((v) => Number.isFinite(v) && v >= min && v <= max)
    )
      throw new Error(
        `${name} needs six numbers in [${min}, ${max}] in surge/sway/heave/roll/pitch/yaw order`,
      );
    c[name] = [...c[name]];
  }
  if (
    Math.abs(c.padOffset[0]) + c.padRadius > c.shipLength / 2 ||
    Math.abs(c.padOffset[1]) + c.padRadius > c.shipBeam / 2
  )
    throw new Error("Landing pad must fit on the aft rectangular deck");
  if (
    c.padOffset[0] + c.padRadius > c.shipLength * 0.159375 ||
    Math.abs(c.padOffset[2] - 0.05) > 1e-9
  )
    throw new Error("Pad must be aft of the cabin and 0.05 m above the deck");
  c.padOffset = [...c.padOffset];
  if (!Array.isArray(c.faults) || c.faults.length > 50)
    throw new Error("faults must be an array of up to 50 events");
  c.faults = c.faults.map((f) => {
    if (
      !f ||
      !["gps", "deck", "link", "motor"].includes(f.target) ||
      !Number.isFinite(f.start) ||
      !Number.isFinite(f.end) ||
      f.start < 0 ||
      f.end > 600 ||
      f.end <= f.start
    )
      throw new Error(
        "Each fault needs target gps/deck/link/motor and 0 <= start < end <= 600 seconds",
      );
    if (
      f.target === "motor" &&
      (!Number.isInteger(f.motor) ||
        f.motor < 0 ||
        f.motor > 3 ||
        !Number.isFinite(f.factor) ||
        f.factor < 0 ||
        f.factor > 1)
    )
      throw new Error("Motor faults need motor index 0..3 and factor 0..1");
    return { ...f };
  });
  return c;
}
export function activeFaults(c, t, target) {
  return c.faults.filter(
    (f) =>
      f.start <= t + 1e-9 &&
      t < f.end - 1e-9 &&
      (!target || f.target === target),
  );
}
export class Ocean {
  constructor(config) {
    this.c = config;
    const r = rng(config.seed);
    this.components = [];
    const count = 28,
      fp = 1 / config.tp,
      df = (2.8 * fp - 0.35 * fp) / count;
    let sum = 0;
    for (let i = 0; i < count; i++) {
      const f = 0.35 * fp + (i + 0.5) * df,
        sigma = f <= fp ? 0.07 : 0.09,
        peak = Math.exp(-0.5 * ((f - fp) / (sigma * fp)) ** 2);
      const s =
        f ** -5 * Math.exp(-1.25 * (fp / f) ** 4) * config.gamma ** peak;
      sum += s * df;
      const w = 2 * Math.PI * f,
        k = (w * w) / G,
        dir = config.waveDirection + (r() - 0.5) * 0.8;
      this.components.push({
        w,
        k,
        dx: Math.cos(dir),
        dy: Math.sin(dir),
        raw: s * df,
        phase: r() * 2 * Math.PI,
      });
    }
    const m0 = (config.hs / 4) ** 2;
    for (const p of this.components) p.a = Math.sqrt((2 * p.raw * m0) / sum);
  }
  tide(t) {
    return (
      this.c.tideAmplitude *
      Math.sin((2 * Math.PI * t) / (12.42 * 3600) + this.c.tidePhase)
    );
  }
  sample(x, y, t) {
    let z = this.tide(t),
      dz = 0,
      sx = 0,
      sy = 0;
    for (const p of this.components) {
      const a = p.k * (p.dx * x + p.dy * y) - p.w * t + p.phase,
        co = Math.cos(a);
      z += p.a * Math.sin(a);
      dz -= p.a * p.w * co;
      sx += p.a * p.k * p.dx * co;
      sy += p.a * p.k * p.dy * co;
    }
    if (this.c.focused) {
      const u = x * 0.12 - t * 1.15 + 22,
        e = Math.exp((-u * u) / 14),
        a = this.c.hs * 1.3;
      z += a * e;
      dz += (a * e * 2 * u * 1.15) / 14;
      sx -= (a * e * 2 * u * 0.12) / 14;
    }
    return { height: z, verticalSpeed: dz, slopeX: sx, slopeY: sy };
  }
}
export class Vessel {
  constructor(c, ocean) {
    this.c = c;
    this.ocean = ocean;
    this.time = 0;
    this.axes = [0, 0, 0, 0, 0, 0];
    this.rates = [0, 0, 0, 0, 0, 0];
    this.position = [0, 0, c.freeboard + ocean.tide(0)];
    this.velocity = [c.shipSpeed + c.current, 0, 0];
    this.euler = [0, 0, c.heading];
    this.angularVelocity = [0, 0, 0];
    this.quaternion = fromEuler(...this.euler);
    for (let i = -1000; i < 0; i++) this.update(i * 0.02, 0.02, true);
    this.update(0, 0.001, true);
  }
  update(t, dt, warmup = false) {
    const c = this.c,
      hd = c.heading,
      base = [
        (Math.cos(hd) * c.shipSpeed + c.current) * t,
        Math.sin(hd) * c.shipSpeed * t,
      ];
    const point = (x, y) =>
      this.ocean.sample(
        base[0] + Math.cos(hd) * x - Math.sin(hd) * y,
        base[1] + Math.sin(hd) * x + Math.cos(hd) * y,
        t,
      ).height;
    const bow = point(c.shipLength * 0.38, 0),
      stern = point(-c.shipLength * 0.38, 0),
      port = point(0, c.shipBeam * 0.4),
      starboard = point(0, -c.shipBeam * 0.4),
      mid = point(0, 0),
      mean = (bow + stern + port + starboard + 2 * mid) / 6;
    const target = [
      0.15 * (bow - stern),
      0.1 * (port - starboard),
      mean,
      clamp(Math.atan2(port - starboard, c.shipBeam * 0.8), -0.65, 0.65),
      clamp(-Math.atan2(bow - stern, c.shipLength * 0.76), -0.55, 0.55),
      0.025 * (port - starboard),
    ];
    const periods = c.responsePeriods,
      damping = c.responseDamping;
    for (let i = 0; i < 6; i++) {
      const wn = (2 * Math.PI) / periods[i];
      this.rates[i] +=
        ((target[i] - this.axes[i]) * wn * wn -
          2 * damping[i] * wn * this.rates[i]) *
        dt;
      this.axes[i] += this.rates[i] * dt;
    }
    this.position = [
      base[0] + this.axes[0],
      base[1] + this.axes[1],
      c.freeboard + this.axes[2],
    ];
    this.velocity = [
      Math.cos(hd) * c.shipSpeed + c.current + this.rates[0],
      Math.sin(hd) * c.shipSpeed + this.rates[1],
      this.rates[2],
    ];
    this.euler = [this.axes[3], this.axes[4], hd + this.axes[5]];
    const [roll, pitch, yaw] = this.euler,
      [rd, pd, yd] = this.rates.slice(3);
    // Exact ZYX Euler-rate to world angular velocity mapping.
    this.angularVelocity = [
      rd * Math.cos(yaw) * Math.cos(pitch) - pd * Math.sin(yaw),
      rd * Math.sin(yaw) * Math.cos(pitch) + pd * Math.cos(yaw),
      yd - rd * Math.sin(pitch),
    ];
    this.quaternion = fromEuler(...this.euler);
    this.time = t;
  }
  pad() {
    const r = rotate(this.quaternion, this.c.padOffset);
    return {
      position: add(this.position, r),
      velocity: add(this.velocity, cross(this.angularVelocity, r)),
      quaternion: [...this.quaternion],
      euler: [...this.euler],
      angularVelocity: [...this.angularVelocity],
      radius: this.c.padRadius,
    };
  }
  pointVelocity(world) {
    return add(
      this.velocity,
      cross(this.angularVelocity, sub(world, this.position)),
    );
  }
}
export class Wind {
  constructor(c) {
    this.c = c;
    this.noise = gaussian(rng(c.seed ^ 0x74185));
    this.gust = [0, 0, 0];
    this.velocity = [0, 0, 0];
  }
  update(dt) {
    for (let i = 0; i < 3; i++)
      this.gust[i] +=
        (-this.gust[i] / 1.6) * dt +
        this.c.gust *
          Math.sqrt((2 * dt) / 1.6) *
          this.noise() *
          (i === 2 ? 0.25 : 1);
    this.velocity = [
      this.c.wind * Math.cos(this.c.windDirection) + this.gust[0],
      this.c.wind * Math.sin(this.c.windDirection) + this.gust[1],
      this.gust[2],
    ];
    return this.velocity;
  }
}
