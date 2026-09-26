import {
  G,
  rng,
  gaussian,
  add,
  sub,
  mul,
  norm,
  rotate,
  qconj,
  toEuler,
  clamp,
  wrap,
  fromEuler,
} from "./math.mjs";
import { activeFaults } from "./environment.mjs";
import { rangeRay } from "./geometry.mjs";
export class Sensors {
  constructor(c, drone) {
    this.c = c;
    this.random = rng(c.seed ^ 0x51a247);
    this.normal = gaussian(this.random);
    this.next = {
      imu: 0,
      gps: 0,
      barometer: 0,
      magnetometer: 0,
      deck: 0,
      rangefinder: 0,
    };
    this.queue = [];
    this.latest = {};
    this.bias = [0.025, -0.02, 0.035];
    this.gyroBias = [0.0004, -0.0003, 0.0006];
    this.baroBias = 0;
    this.estimate = {
      position: [...drone.position],
      velocity: [...drone.velocity],
      euler: toEuler(drone.quaternion),
      omega: [0, 0, 0],
    };
    this.delivered = 0;
    this.dropped = 0;
    this.time = 0;
    this.lastGps = null;
  }
  noise(std) {
    return std * this.c.noise * this.normal();
  }
  packet(name, t, delay, value, drop = 0) {
    if (this.random() < drop || activeFaults(this.c, t, name).length) {
      this.dropped++;
      return;
    }
    this.queue.push({ name, delivery: t + delay, sampleTime: t, value });
  }
  update(t, dt, drone, ship, ocean) {
    const c = this.c,
      e = this.estimate;
    this.time = t;
    const due = (n, hz) => {
      if (t + 1e-9 >= this.next[n]) {
        this.next[n] += 1 / hz;
        return true;
      }
      return false;
    };
    if (due("imu", 200)) {
      this.bias = this.bias.map((v) => v + this.noise(0.0005) * Math.sqrt(dt));
      const sf = rotate(
        qconj(drone.quaternion),
        add(drone.acceleration, [0, 0, G]),
      );
      this.packet("imu", t, 0.005, {
        accel: sf.map((v, i) => v + this.bias[i] + this.noise(0.09)),
        gyro: drone.omega.map(
          (v, i) => v + this.gyroBias[i] + this.noise(0.0025),
        ),
      });
    }
    if (due("gps", 5) && c.gpsEnabled)
      this.packet(
        "gps",
        t,
        0.14,
        {
          position: drone.position.map((v) => v + this.noise(0.35)),
          velocity: drone.velocity.map((v) => v + this.noise(0.1)),
        },
        0.01 * c.noise,
      );
    if (due("barometer", 25)) {
      this.baroBias += this.noise(0.006) * Math.sqrt(0.04);
      this.packet("barometer", t, 0.04, {
        altitude: drone.position[2] + this.baroBias + this.noise(0.06),
      });
    }
    if (due("magnetometer", 20))
      this.packet("magnetometer", t, 0.03, {
        yaw: wrap(toEuler(drone.quaternion)[2] + this.noise(0.017)),
      });
    const pad = ship.pad(),
      distance = norm(sub(pad.position, drone.position)),
      local = rotate(
        qconj(ship.quaternion),
        sub(drone.position, ship.position),
      );
    if (due("deck", 20) && c.trackerEnabled) {
      const optical = c.trackerSource === "vision",
        available = !optical || (distance < c.visibility && local[2] > -0.3);
      if (available)
        this.packet(
          "deck",
          t,
          0.1 + c.rain * 0.1,
          {
            position: pad.position.map(
              (v) => v + this.noise(optical ? 0.04 + 0.001 * distance : 0.1),
            ),
            velocity: pad.velocity.map((v) => v + this.noise(0.07)),
            euler: pad.euler.map((v) => v + this.noise(0.01)),
            angularVelocity: pad.angularVelocity.map(
              (v) => v + this.noise(0.015),
            ),
            radius: pad.radius,
            source: optical ? "optical-tracker" : "local-radio-beacon",
          },
          optical
            ? Math.min(0.7, 0.02 + 0.3 * c.rain + 15 / c.visibility)
            : 0.015,
        );
      else this.dropped++;
    }
    if (due("rangefinder", 20)) {
      const hit = rangeRay(c, drone, ship, ocean, t);
      if (hit)
        this.packet(
          "rangefinder",
          t,
          0.025,
          {
            range: Math.max(0, hit.range + this.noise(0.025)),
            surface: hit.surface,
          },
          c.rain * 0.15,
        );
    }
    // Complementary navigation estimate. Inertial prediction uses delivered noisy measurements only.
    const imu = this.latest.imu?.value;
    if (imu) {
      e.omega = [...imu.gyro];
      const [r, p] = e.euler,
        [wx, wy, wz] = imu.gyro;
      e.euler[0] = wrap(
        e.euler[0] +
          (wx +
            Math.sin(r) * Math.tan(p) * wy +
            Math.cos(r) * Math.tan(p) * wz) *
            dt,
      );
      e.euler[1] = clamp(
        e.euler[1] + (Math.cos(r) * wy - Math.sin(r) * wz) * dt,
        -1.3,
        1.3,
      );
      e.euler[2] = wrap(
        e.euler[2] +
          ((Math.sin(r) / Math.cos(p)) * wy +
            (Math.cos(r) / Math.cos(p)) * wz) *
            dt,
      );
      const a = add(rotate(fromEuler(...e.euler), imu.accel), [0, 0, -G]);
      e.velocity = add(e.velocity, mul(a, dt));
      e.position = add(e.position, mul(e.velocity, dt));
    }
    const pending = [];
    for (const pk of this.queue) {
      if (pk.delivery > t + 1e-9) {
        pending.push(pk);
        continue;
      }
      if (activeFaults(c, t, pk.name).length) {
        this.dropped++;
        continue;
      }
      this.latest[pk.name] = pk;
      this.delivered++;
      if (pk.name === "gps") {
        const age = t - pk.sampleTime,
          projected = add(pk.value.position, mul(pk.value.velocity, age));
        e.position = e.position.map((v, i) => v * 0.85 + projected[i] * 0.15);
        e.velocity = e.velocity.map(
          (v, i) => v * 0.45 + pk.value.velocity[i] * 0.55,
        );
        this.lastGps = t;
      }
      if (pk.name === "barometer")
        e.position[2] = e.position[2] * 0.94 + pk.value.altitude * 0.06;
      if (pk.name === "magnetometer")
        e.euler[2] = wrap(e.euler[2] + wrap(pk.value.yaw - e.euler[2]) * 0.06);
    }
    this.queue = pending;
  }
  observation(t) {
    const sensors = {};
    for (const [name, p] of Object.entries(this.latest))
      sensors[name] = {
        ...p.value,
        sampleTime: p.sampleTime,
        age: Math.max(0, t - p.sampleTime),
        valid: t - p.sampleTime < (name === "gps" ? 1 : 0.5),
      };
    return {
      time: t,
      dt: 0.05,
      frame:
        "world NWU: x north, y west, z up; body x forward, y port, z up; radians; SI units",
      estimate: structuredClone(this.estimate),
      sensors,
      deck: sensors.deck?.valid ? sensors.deck : null,
      health: {
        gpsAge: sensors.gps?.age ?? null,
        deckAge: sensors.deck?.age ?? null,
        delivered: this.delivered,
        dropped: this.dropped,
      },
    };
  }
}
