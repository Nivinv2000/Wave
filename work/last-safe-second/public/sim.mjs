const DT = 0.02;
const DURATION = 8;
const START_HEIGHT = 4;
const INITIAL_DESCENT_SPEED = -0.72;
const ABORT_LATENCY = 0.18;
const ABORT_ACCELERATION = 1.45;
const MAX_CLIMB_SPEED = 1.1;
const SAFE_RELATIVE_SPEED = 0.32;
const REQUIRED_ABORT_CLEARANCE = 0.35;

export const DEFAULT_SEED = 17;

function hashSeed(seed) {
  const text = String(seed);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeRandom(seed) {
  let state = hashSeed(seed) || 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function waveForSeed(seed) {
  const random = makeRandom(seed);
  const waves = [
    { amplitude: 0.22, omega: 1.08, phase: random() * Math.PI * 2 },
    { amplitude: 0.11, omega: 1.83, phase: random() * Math.PI * 2 },
    { amplitude: 0.055, omega: 2.57, phase: random() * Math.PI * 2 },
  ];

  return (t) => {
    let deckY = 0;
    let deckV = 0;
    for (const wave of waves) {
      const angle = wave.omega * t + wave.phase;
      deckY += wave.amplitude * Math.sin(angle);
      deckV += wave.amplitude * wave.omega * Math.cos(angle);
    }
    return { deckY, deckV };
  };
}

function sampleAt(t, droneY, droneV, wave) {
  const { deckY, deckV } = wave(t);
  return {
    t: Number(t.toFixed(4)),
    deckY,
    deckV,
    droneY,
    droneV,
    gap: droneY - deckY,
  };
}

function moveDrone(droneY, droneV, t, nextT, abortStart) {
  const interval = nextT - t;
  const brakingStart = Math.max(t, abortStart);
  const brakingDuration = Math.max(0, nextT - brakingStart);
  const unbrakedDuration = interval - brakingDuration;

  let y = droneY + droneV * unbrakedDuration;
  let v = droneV;

  if (brakingDuration > 0) {
    const timeToLimit = Math.max(0, (MAX_CLIMB_SPEED - v) / ABORT_ACCELERATION);
    const acceleratingDuration = Math.min(brakingDuration, timeToLimit);
    y += v * acceleratingDuration
      + 0.5 * ABORT_ACCELERATION * acceleratingDuration ** 2;
    v += ABORT_ACCELERATION * acceleratingDuration;

    const cappedDuration = brakingDuration - acceleratingDuration;
    if (cappedDuration > 0) y += MAX_CLIMB_SPEED * cappedDuration;
  }

  return { droneY: y, droneV: v };
}

function crossingSample(previous, current, wave) {
  const span = current.t - previous.t;
  const fraction = span === 0 ? 0 : previous.gap / (previous.gap - current.gap);
  const t = previous.t + Math.max(0, Math.min(1, fraction)) * span;
  const { deckY, deckV } = wave(t);
  const droneV = previous.droneV + fraction * (current.droneV - previous.droneV);
  return {
    t,
    sample: {
      t: Number(t.toFixed(4)),
      deckY,
      deckV,
      droneY: deckY,
      droneV,
      gap: 0,
    },
    relativeSpeed: Math.abs(droneV - deckV),
  };
}

/**
 * Simulate a one-dimensional drone approach to a heaving deck.
 * abortAt is the time an abort is commanded; it takes effect after a fixed
 * actuator latency and then accelerates the drone upward.
 */
export function simulate(seed, abortAt = null) {
  if (abortAt !== null && (!Number.isFinite(abortAt) || abortAt < 0)) {
    throw new TypeError("abortAt must be null or a finite non-negative time");
  }

  const wave = waveForSeed(seed);
  const abortStart = abortAt === null ? Infinity : abortAt + ABORT_LATENCY;
  let droneY = START_HEIGHT;
  let droneV = INITIAL_DESCENT_SPEED;
  let previous = sampleAt(0, droneY, droneV, wave);
  const samples = [previous];
  let contact = null;

  for (let step = 1; step <= Math.round(DURATION / DT); step += 1) {
    const t = (step - 1) * DT;
    const nextT = step * DT;
    ({ droneY, droneV } = moveDrone(droneY, droneV, t, nextT, abortStart));
    const current = sampleAt(nextT, droneY, droneV, wave);

    if (current.gap <= 0 && previous.gap > 0) {
      const crossing = crossingSample(previous, current, wave);
      contact = {
        t: crossing.t,
        relativeSpeed: crossing.relativeSpeed,
      };
      samples.push(crossing.sample);
      const safe = crossing.relativeSpeed <= SAFE_RELATIVE_SPEED;
      return {
        seed,
        dt: DT,
        duration: DURATION,
        samples,
        contact,
        safe,
        reason: safe ? "soft-touchdown" : "hard-touchdown",
      };
    }

    samples.push(current);
    previous = current;
  }

  const final = samples[samples.length - 1];
  const safeAbort = abortAt !== null
    && final.gap >= REQUIRED_ABORT_CLEARANCE
    && final.droneV > 0;

  return {
    seed,
    dt: DT,
    duration: DURATION,
    samples,
    contact,
    safe: safeAbort,
    reason: safeAbort
      ? "abort-cleared"
      : abortAt === null
        ? "no-contact-before-timeout"
        : "abort-did-not-clear-deck",
  };
}

/**
 * Scan abort command times and return the latest sampled time that clears the
 * deck without contact. baselineContact is the natural touchdown (if any).
 */
export function latestSafeAbort(seed) {
  const baseline = simulate(seed, null);
  let latest = null;

  for (let step = 0; step <= Math.round(DURATION / DT); step += 1) {
    const time = Number((step * DT).toFixed(4));
    if (simulate(seed, time).safe) latest = time;
  }

  return {
    time: latest,
    baselineContact: baseline.contact,
    baselineSafe: baseline.safe,
  };
}
