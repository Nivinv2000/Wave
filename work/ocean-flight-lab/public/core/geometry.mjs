import { add, sub, mul, rotate, qconj } from "./math.mjs";

// Shared dimensions for visual geometry, collisions and the rangefinder.
export function cabinGeometry(c) {
  return {
    center: [c.shipLength * 0.278125, 0, c.freeboard * 0.6],
    size: [c.shipLength * 0.2375, c.shipBeam * (3.6 / 5.8), c.freeboard * 1.2],
  };
}
export function onDeck(c, p) {
  const half = c.shipLength / 2,
    shoulder = c.shipLength * 0.3625;
  const width =
    p[0] > shoulder
      ? ((c.shipBeam / 2) * (half - p[0])) / (half - shoulder)
      : c.shipBeam / 2;
  return p[0] >= -half && p[0] <= half && Math.abs(p[1]) <= width;
}
export function insideCabin(c, p, margin = 0) {
  const { center, size } = cabinGeometry(c);
  return p.every((v, i) => Math.abs(v - center[i]) <= size[i] / 2 + margin);
}
export function rangeRay(c, drone, ship, ocean, time, maxRange = 20) {
  const direction = rotate(drone.quaternion, [0, 0, -1]);
  const origin = add(drone.position, mul(direction, drone.legHeight));
  const localOrigin = rotate(
    qconj(ship.quaternion),
    sub(origin, ship.position),
  );
  const localDirection = rotate(qconj(ship.quaternion), direction);
  let hit = null;
  const accept = (range, surface) => {
    if (range >= 0 && range <= maxRange && (!hit || range < hit.range))
      hit = {
        range,
        surface,
        origin,
        point: add(origin, mul(direction, range)),
      };
  };
  if (localDirection[2] < -1e-9) {
    const distance = -localOrigin[2] / localDirection[2];
    if (onDeck(c, add(localOrigin, mul(localDirection, distance))))
      accept(distance, "deck");
  }
  const { center, size } = cabinGeometry(c);
  let near = 0,
    far = maxRange;
  for (let i = 0; i < 3; i++) {
    const lo = center[i] - size[i] / 2,
      hi = center[i] + size[i] / 2;
    if (Math.abs(localDirection[i]) < 1e-9) {
      if (localOrigin[i] < lo || localOrigin[i] > hi) {
        far = -1;
        break;
      }
    } else {
      const a = (lo - localOrigin[i]) / localDirection[i],
        b = (hi - localOrigin[i]) / localDirection[i];
      near = Math.max(near, Math.min(a, b));
      far = Math.min(far, Math.max(a, b));
    }
  }
  if (near <= far) accept(near, "superstructure");
  const clearance = (distance) => {
    const p = add(origin, mul(direction, distance));
    return p[2] - ocean.sample(p[0], p[1], time).height;
  };
  // Locate the first water crossing; bisection refines the analytic surface hit.
  let previous = clearance(0);
  if (previous <= 0) accept(0, "water");
  else
    for (let distance = 0.5; distance <= maxRange; distance += 0.5) {
      const next = clearance(distance);
      if (next <= 0 && previous > 0) {
        let lo = distance - 0.5,
          hi = distance;
        for (let i = 0; i < 14; i++) {
          const mid = (lo + hi) / 2;
          if (clearance(mid) > 0) lo = mid;
          else hi = mid;
        }
        accept((lo + hi) / 2, "water");
        break;
      }
      previous = next;
    }
  return hit;
}
