export const G = 9.80665;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const add = (a, b) => a.map((v, i) => v + b[i]);
export const sub = (a, b) => a.map((v, i) => v - b[i]);
export const mul = (a, s) => a.map((v) => v * s);
export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export const norm = (a) => Math.hypot(...a);
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function gaussian(random) {
  let spare = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    const r = Math.sqrt(-2 * Math.log(Math.max(1e-10, random()))),
      a = 2 * Math.PI * random();
    spare = r * Math.sin(a);
    return r * Math.cos(a);
  };
}
// Quaternion order x,y,z,w. Body axes: forward x, left y, up z.
export const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export const qnorm = (q) => {
  const n = Math.hypot(...q);
  return q.map((x) => x / n);
};
export const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];
export const rotate = (q, v) => {
  const a = [q[0], q[1], q[2]],
    t = mul(cross(a, v), 2);
  return add(v, add(mul(t, q[3]), cross(a, t)));
};
export function fromEuler(r, p, y) {
  const cr = Math.cos(r / 2),
    sr = Math.sin(r / 2),
    cp = Math.cos(p / 2),
    sp = Math.sin(p / 2),
    cy = Math.cos(y / 2),
    sy = Math.sin(y / 2);
  return [
    sr * cp * cy - cr * sp * sy,
    cr * sp * cy + sr * cp * sy,
    cr * cp * sy - sr * sp * cy,
    cr * cp * cy + sr * sp * sy,
  ];
}
export function toEuler(q) {
  const [x, y, z, w] = q;
  return [
    Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)),
    Math.asin(clamp(2 * (w * y - z * x), -1, 1)),
    Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)),
  ];
}
export const integrateQ = (q, w, dt) =>
  qnorm(add(q, mul(qmul(q, [...w, 0]), dt / 2)));
export const finiteVec = (v, n = 3) =>
  Array.isArray(v) && v.length === n && v.every(Number.isFinite);
