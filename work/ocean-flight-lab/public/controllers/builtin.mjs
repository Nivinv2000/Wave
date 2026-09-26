import { clamp, norm, sub } from "../core/math.mjs";
export function createController({ kind = "predictive" } = {}) {
  let last = null,
    filteredV = [0, 0, 0],
    accel = [0, 0, 0],
    hold = null;
  return {
    step(obs) {
      const e = obs.estimate,
        d = obs.deck;
      if (!hold) hold = [...e.position];
      if (!d) {
        return {
          mode: "position",
          position: hold,
          yaw: 0,
          label: "Deck signal stale: holding last clearance",
        };
      }
      const fresh = !last || last.sampleTime !== d.sampleTime;
      if (fresh) {
        const delta = last
          ? Math.max(0.01, d.sampleTime - last.sampleTime)
          : 0.05;
        const prev = [...filteredV];
        filteredV = d.velocity.map((v, i) =>
          last ? filteredV[i] * 0.65 + v * 0.35 : v,
        );
        if (last)
          accel = filteredV.map((v, i) =>
            clamp(0.9 * accel[i] + (0.1 * (v - prev[i])) / delta, -1.5, 1.5),
          );
        last = d;
      }
      const deck = d.position.map((v, i) => v + filteredV[i] * d.age),
        dx = deck[0] - e.position[0],
        dy = deck[1] - e.position[1],
        distance = Math.hypot(dx, dy),
        gap = e.position[2] - deck[2] - 0.28,
        tilt = Math.hypot(d.euler[0], d.euler[1]);
      hold = [deck[0], deck[1], deck[2] + Math.max(4, gap)];
      const vx = clamp(filteredV[0] + dx * 0.85, -5, 5),
        vy = clamp(filteredV[1] + dy * 0.85, -5, 5);
      if (kind === "hover")
        return {
          mode: "velocity",
          velocity: [vx, vy, clamp(filteredV[2] + (5 - gap) * 0.8, -2, 2)],
          yaw: d.euler[2],
          label: "Follow deck at 5 m clearance",
        };
      if (distance > 1.0)
        return {
          mode: "velocity",
          velocity: [vx, vy, clamp(filteredV[2] + (4 - gap) * 0.7, -1, 1.5)],
          yaw: d.euler[2],
          label: "Align over landing pad",
        };
      if (kind === "reactive")
        return {
          mode: "velocity",
          velocity: [vx, vy, tilt > 0.3 ? 1 : -0.38],
          yaw: d.euler[2],
          label:
            tilt > 0.3 ? "Deck tilt: climb" : "Descend using current alignment",
        };
      const horizon = clamp(gap / 0.7, 0.15, 0.65),
        futureVertical = filteredV[2] + accel[2] * horizon;
      if (tilt > 0.25 || Math.abs(futureVertical) > 1.4)
        return {
          mode: "velocity",
          velocity: [vx, vy, clamp(filteredV[2] + (3 - gap) * 0.7, -0.5, 1.8)],
          yaw: d.euler[2],
          label: "Wait: predicted deck motion exceeds gate",
        };
      const descent = gap > 2 ? 0.55 : gap > 1 ? 0.32 : 0.22;
      return {
        mode: "velocity",
        velocity: [vx, vy, clamp(futureVertical - descent, -1.8, 1.8)],
        yaw: d.euler[2],
        label: "Predictive descent: measured motion + short forecast",
      };
    },
  };
}
