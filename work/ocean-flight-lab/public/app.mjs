import { Simulation } from "./core/simulation.mjs";
import { PRESETS } from "./core/environment.mjs";
import { WorldView } from "./scene.mjs";
import { ModelRunner } from "./model-runner.mjs";
import { sub, norm, rotate, qconj, dot } from "./core/math.mjs";
const $ = (id) => document.getElementById(id);
let sim = new Simulation(),
  view = null,
  runner = new ModelRunner(),
  running = false,
  busy = false,
  modelReady = false,
  generation = 0,
  lastTick = 0,
  source = "",
  attached = "predictive",
  lastDecision = "",
  lastUi = 0,
  pumping = false,
  modelMetadata = { type: "predictive", options: {} };
try {
  view = new WorldView($("viewport"));
} catch (error) {
  $("webgl-error").hidden = false;
  $("webgl-error").textContent = "3D rendering unavailable: " + error.message;
}
const numeric = [
  "seed",
  "duration",
  "hs",
  "tp",
  "wind",
  "gust",
  "rain",
  "visibility",
  "current",
  "shipSpeed",
  "tideAmplitude",
  "tidePhase",
  "droneMass",
  "initialHeight",
  "noise",
];
function config() {
  const c = { preset: $("weather").value };
  for (const name of numeric) c[name] = Number($(name).value);
  c.gpsEnabled = $("gpsEnabled").checked;
  c.trackerEnabled = $("trackerEnabled").checked;
  c.trackerSource = $("trackerSource").value;
  return c;
}
function log(message) {
  const li = document.createElement("li"),
    t = document.createElement("time");
  t.textContent = sim.time.toFixed(2) + "s";
  li.append(t, document.createTextNode(message));
  $("events").prepend(li);
  while ($("events").children.length > 50) $("events").lastChild.remove();
}
function error(message) {
  running = false;
  modelReady = false;
  $("play").disabled = true;
  $("step").disabled = true;
  $("play").textContent = "▶ Resume";
  $("model-state").textContent = message;
  $("model-state").classList.add("error");
  log(message);
}
function pause() {
  running = false;
  $("play").textContent = "▶ Run simulation";
}
async function reset() {
  pause();
  const mine = ++generation;
  modelReady = false;
  $("attach").disabled = true;
  $("apply").disabled = true;
  $("play").disabled = true;
  $("step").disabled = true;
  try {
    const next = new Simulation(config());
    const kind = $("controller").value;
    let options = {};
    if (kind === "custom") {
      if (!source)
        throw new Error("Choose a JavaScript module before attaching it");
      options = JSON.parse($("model-options").value);
    }
    await runner.attach(kind, source, options);
    if (mine !== generation) return;
    sim = next;
    attached = kind;
    modelMetadata = {
      type: kind,
      name: kind === "custom" ? $("model-file").files[0]?.name : kind,
      options: structuredClone(options),
      sourceSha256:
        kind === "custom"
          ? Array.from(
              new Uint8Array(
                await crypto.subtle.digest(
                  "SHA-256",
                  new TextEncoder().encode(source),
                ),
              ),
              (b) => b.toString(16).padStart(2, "0"),
            ).join("")
          : null,
    };
    modelReady = true;
    lastDecision = "";
    $("events").replaceChildren();
    $("result").hidden = true;
    view?.reset(sim);
    $("scene-title").textContent = PRESETS[sim.config.preset].label;
    $("weather-summary").textContent =
      `Hs ${sim.config.hs.toFixed(2)} m · wind ${sim.config.wind.toFixed(1)} m/s`;
    $("duration-label").textContent = sim.config.duration;
    $("model-state").classList.remove("error");
    $("model-state").textContent =
      kind === "custom"
        ? "Uploaded model attached"
        : kind === "python"
          ? "Local Python model connected"
          : "Built-in controller ready";
    $("config-message").textContent =
      "Scenario applied. Fixed seed " + sim.config.seed + ".";
    log(
      `Scenario loaded: ${PRESETS[sim.config.preset].label}; ${attached} controller.`,
    );
    updateUi();
  } catch (e) {
    error(e.message);
  } finally {
    if (mine === generation) {
      $("attach").disabled = false;
      $("apply").disabled = false;
      $("play").disabled = !modelReady;
      $("step").disabled = !modelReady;
    }
  }
}
function exportLog() {
  const data = { ...sim.export(), controller: modelMetadata };
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `ocean-flight-${sim.config.preset}-seed${sim.config.seed}-${attached}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function tick() {
  if (busy || !modelReady || sim.status !== "running") return;
  busy = true;
  const mine = generation;
  try {
    const obs = sim.observation(),
      cmd = await runner.step(obs);
    if (mine !== generation) return;
    sim.advance(cmd);
    if (cmd.label !== lastDecision) {
      log(cmd.label);
      lastDecision = cmd.label;
    }
    if (sim.status !== "running") {
      pause();
      showResult();
    }
  } catch (e) {
    if (mine === generation) error(e.message);
  } finally {
    busy = false;
    if (mine === generation) updateUi();
  }
}
function showResult() {
  const out = sim.outcome;
  $("result").hidden = false;
  $("result").classList.toggle("bad", out.status !== "landed");
  $("result-title").textContent =
    out.status === "landed"
      ? "Landing completed"
      : out.status === "timeout"
        ? "Episode ended: no touchdown"
        : "Episode ended: " + out.status.replaceAll("-", " ");
  $("result-detail").textContent =
    out.reason +
    (out.relativeNormalSpeed !== undefined
      ? ` · Contact speed ${out.relativeNormalSpeed.toFixed(2)} m/s · Pad error ${out.padError.toFixed(2)} m · Tilt ${out.relativeTiltDeg.toFixed(1)}°`
      : "");
  log(out.reason);
}
function updateUi() {
  const s = sim.snapshot(),
    d = s.drone,
    p = s.ship.pad,
    local = rotate(qconj(p.quaternion), sub(d.position, p.position)),
    relative = sub(d.velocity, p.velocity);
  $("time").textContent = s.time.toFixed(2);
  $("run-status").textContent =
    s.status === "running"
      ? running
        ? "RUNNING"
        : "PAUSED"
      : s.status.toUpperCase().replaceAll("-", " ");
  $("metric-gap").textContent = (local[2] - 0.28).toFixed(2) + " m";
  $("metric-relative").textContent =
    dot(relative, rotate(p.quaternion, [0, 0, 1])).toFixed(2) + " m/s";
  $("metric-tilt").textContent = s.ship.euler
    .slice(0, 2)
    .map((v) => ((v * 180) / Math.PI).toFixed(1) + "°")
    .join(" / ");
  $("metric-offset").textContent =
    Math.hypot(local[0], local[1]).toFixed(2) + " m";
  $("decision").textContent = s.command.label;
  $("command").textContent = JSON.stringify(
    s.command,
    (_, v) => (typeof v === "number" ? Number(v.toFixed(3)) : v),
    2,
  );
  $("inference-ms").textContent = runner.lastMs.toFixed(1) + " ms";
  $("estimate-error").textContent =
    norm(sub(d.position, s.observation.estimate.position)).toFixed(2) + " m";
  $("battery").textContent = (d.battery * 100).toFixed(1) + "% battery";
  const rates = {
    imu: 200,
    gps: 5,
    barometer: 25,
    magnetometer: 20,
    deck: 20,
    rangefinder: 20,
  };
  $("sensors").replaceChildren();
  for (const [name, hz] of Object.entries(rates)) {
    const pk = s.observation.sensors[name],
      tr = document.createElement("tr");
    if (!pk?.valid) tr.className = "stale";
    for (const v of [
      name === "deck"
        ? "Deck tracker"
        : name === "imu"
          ? "IMU"
          : name === "gps"
            ? "GPS"
            : name,
      hz + " Hz",
      pk ? (pk.age * 1000).toFixed(0) + " ms" : "no signal",
    ]) {
      const td = document.createElement("td");
      td.textContent = v;
      tr.append(td);
    }
    $("sensors").append(tr);
  }
  d.motors.forEach((v, i) => {
    $("motor-" + i).style.width = Math.min(100, (v / 15) * 100) + "%";
    $("motor-val-" + i).textContent = v.toFixed(1) + " N";
  });
  $("flight-count").textContent = sim.log.length + " frames recorded";
  drawTelemetry();
}
function drawTelemetry() {
  const canvas = $("telemetry-chart"),
    w = canvas.clientWidth,
    h = 165,
    pr = devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * pr)) {
    canvas.width = Math.round(w * pr);
    canvas.height = h * pr;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(pr, 0, 0, pr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const data = sim.log.filter(
    (_, i, a) =>
      i % Math.max(1, Math.floor(a.length / 350)) === 0 || i === a.length - 1,
  );
  const L = 38,
    R = 10,
    T = 13,
    B = 24;
  let min = Infinity,
    max = -Infinity;
  for (const s of data)
    for (const v of [
      s.drone.position[2],
      s.ship.pad.position[2],
      s.observation.estimate.position[2],
    ]) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  min = Math.floor(min - 1);
  max = Math.ceil(max + 1);
  const xmax = Math.max(10, sim.time),
    x = (t) => L + (t / xmax) * (w - L - R),
    y = (v) => T + ((max - v) / (max - min)) * (h - T - B);
  ctx.font = "10px sans-serif";
  ctx.textBaseline = "middle";
  for (let i = 0; i < 4; i++) {
    const v = min + ((max - min) * i) / 3,
      yy = y(v);
    ctx.strokeStyle = "#27384d";
    ctx.beginPath();
    ctx.moveTo(L, yy);
    ctx.lineTo(w - R, yy);
    ctx.stroke();
    ctx.fillStyle = "#92a8bf";
    ctx.textAlign = "right";
    ctx.fillText(v.toFixed(0), L - 7, yy);
  }
  ctx.textAlign = "center";
  for (let i = 0; i < 4; i++)
    ctx.fillText(((xmax * i) / 3).toFixed(0), x((xmax * i) / 3), h - 7);
  for (const [color, fn] of [
    ["#58e6db", (s) => s.drone.position[2]],
    ["#ffbf66", (s) => s.ship.pad.position[2]],
    ["#bfadff", (s) => s.observation.estimate.position[2]],
  ]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = color === "#bfadff" ? 1 : 1.8;
    ctx.beginPath();
    data.forEach((s, i) =>
      i ? ctx.lineTo(x(s.time), y(fn(s))) : ctx.moveTo(x(s.time), y(fn(s))),
    );
    ctx.stroke();
  }
}
for (let i = 0; i < 4; i++) {
  $("motors").insertAdjacentHTML(
    "beforeend",
    `<div class="motor-row"><span>M${i + 1}</span><div class="motor-track"><div class="motor-fill" id="motor-${i}"></div></div><span class="motor-value" id="motor-val-${i}">0 N</span></div>`,
  );
}
$("weather").addEventListener("change", () => {
  const p = {
    ...PRESETS[$("weather").value],
    tideAmplitude: PRESETS[$("weather").value].tideAmplitude ?? 0.4,
    tidePhase: PRESETS[$("weather").value].tidePhase ?? 0,
  };
  for (const name of numeric)
    if (p[name] !== undefined) $(name).value = p[name];
  rangeLabels();
  $("config-message").textContent = "Preset selected. Apply & reset to run it.";
});
function rangeLabels() {
  $("hs-val").textContent = Number($("hs").value).toFixed(2) + " m";
  $("tp-val").textContent = Number($("tp").value).toFixed(1) + " s";
}
["hs", "tp"].forEach((id) => $(id).addEventListener("input", rangeLabels));
$("controller").addEventListener("change", () => {
  const kind = $("controller").value;
  $("custom-panel").hidden = kind !== "custom";
  $("python-panel").hidden = kind !== "python";
  $("model-description").textContent = {
    predictive:
      "Forecasts short-term deck velocity from delayed measurements. No cloud service.",
    reactive:
      "Aligns over the measured pad and descends at a fixed rate; no forecast.",
    hover:
      "Tracks the pad while holding 5 m clearance. It does not try to land.",
    custom:
      "A module receives measured observations and returns velocity, position or four motor commands. Runs in a dedicated worker.",
    python:
      "Connect any locally installed model through the example HTTP adapter. Simulation waits for each inference.",
  }[kind];
});
$("model-file").addEventListener("change", async () => {
  const f = $("model-file").files[0];
  if (f) {
    if (f.size > 2000000) {
      error("Controller module must be smaller than 2 MB");
      return;
    }
    source = await f.text();
    $("model-state").textContent = f.name + " selected. Attach it to run.";
  }
});
$("play").addEventListener("click", async () => {
  if (running) {
    pause();
    return;
  }
  if (sim.status !== "running") await reset();
  if (modelReady) {
    running = true;
    lastTick = 0;
    $("play").textContent = "Ⅱ Pause";
  }
});
$("step").addEventListener("click", () => {
  pause();
  tick();
});
$("reset").addEventListener("click", reset);
$("apply").addEventListener("click", reset);
$("attach").addEventListener("click", reset);
$("export").addEventListener("click", exportLog);
$("download-result").addEventListener("click", exportLog);
document.querySelectorAll("[data-camera]").forEach((b) =>
  b.addEventListener("click", () => {
    if (view) view.mode = b.dataset.camera;
    document
      .querySelectorAll("[data-camera]")
      .forEach((x) => x.classList.toggle("selected", x === b));
  }),
);
window.addEventListener("resize", drawTelemetry);
function frame(t) {
  if (running && !pumping && !busy) {
    if (lastTick === 0) lastTick = t;
    const interval = 50 / Number($("speed").value),
      due = Math.min(6, Math.floor((t - lastTick) / interval));
    if (due > 0) {
      lastTick += due * interval;
      if (t - lastTick > 1000) lastTick = t;
      pumping = true;
      (async () => {
        try {
          for (let n = 0; n < due && running; n++) await tick();
        } finally {
          pumping = false;
        }
      })();
    }
  }
  view?.draw(sim.snapshot());
  if (t - lastUi > 250) {
    updateUi();
    lastUi = t;
  }
  requestAnimationFrame(frame);
}
await reset();
requestAnimationFrame(frame);
