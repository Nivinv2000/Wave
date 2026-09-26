/** Upload this JavaScript module in the dashboard. No library imports required. */
export function createController(options = {}) {
  const descent = options.descentSpeed ?? 0.28;
  let hold = null;
  const clip = (v, a, b) => Math.max(a, Math.min(b, v));
  return {
    step(observation) {
      const { estimate, deck } = observation;
      hold ??= [...estimate.position];
      if (!deck)
        return {
          mode: "position",
          position: hold,
          yaw: 0,
          label: "Missing deck signal: hold",
        };
      const target = deck.position.map(
        (v, i) => v + deck.velocity[i] * deck.age,
      );
      const error = target.map((v, i) => v - estimate.position[i]);
      const aligned = Math.hypot(error[0], error[1]) < 0.7;
      hold = [target[0], target[1], target[2] + 4];
      return {
        mode: "velocity",
        velocity: [
          clip(deck.velocity[0] + error[0], -4, 4),
          clip(deck.velocity[1] + error[1], -4, 4),
          aligned
            ? deck.velocity[2] - descent
            : clip(deck.velocity[2] + (error[2] + 4) * 0.7, -1, 1),
        ],
        yaw: deck.euler[2],
        label: aligned ? "Follow deck and descend" : "Align above deck",
      };
    },
  };
}
