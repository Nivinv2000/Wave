import { Replay } from "./core/replay.mjs";
import { summarize } from "./core/evaluation.mjs";
import { Simulation } from "./core/simulation.mjs";
import { PRESETS } from "./core/environment.mjs";
import { WorldView } from "./scene.mjs";
import { ModelRunner } from "./model-runner.mjs";
import { sub, norm, rotate, qconj, dot } from "./core/math.mjs";
const $ = (id) => document.getElementById(id);
let comparisonReport = null,
  comparisonToken = 0,
  comparing = false,
  attachedSource = "",
  eventCount = 0;
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
  "shipLength",
  "shipBeam",
  "freeboard",
  "padRadius",
  "heading",
  "maxRotorThrust",
  "armRadius",
  "motorLagMs",
  "batteryWh",
  "initialBattery",
  "commandLatencyMs",
  "commandDropout",
  "commandTimeoutMs",
];
function config() {
  const c = { preset: $("weather").value };
  for (const name of numeric) c[name] = Number($(name).value);
  c.gpsEnabled = $("gpsEnabled").checked;
  c.trackerEnabled = $("trackerEnabled").checked;
  c.trackerSource = $("trackerSource").value;
  c.padOffset = [Number($("padOffsetX").value), 0, 0.05];
  const response = JSON.parse($("response-options").value);
  c.responsePeriods = response.responsePeriods;
  c.responseDamping = response.responseDamping;
  c.faults = JSON.parse($("faults").value);
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
  $("play").textContent =
    sim instanceof Replay ? "▶ Play replay" : "▶ Run simulation";
}
async function reset() {
  pause();
  const mine = ++generation;
  modelReady = false;
  $("attach").disabled = true;
  $("apply").disabled = true;
  $("compare").disabled = true;
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
    attachedSource = source;
    eventCount = 0;
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
    $("replay-controls").hidden = true;
    $("leave-replay").hidden = true;
    $("replay-status").textContent = "LIVE SIMULATION";
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
      $("compare").disabled = !modelReady;
    }
  }
}
function exportLog() {
  const data =
    sim instanceof Replay
      ? sim.export()
      : { ...sim.export(), controller: modelMetadata };
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `ocean-flight-${sim.config.preset}-seed${sim.config.seed}-${attached}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function tick() {
  if (sim instanceof Replay) {
    sim.advance();
    if (sim.ended) {
      pause();
      if (sim.outcome) showResult();
    }
    updateUi();
    return;
  }
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
  if (!out) return;
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
    sim instanceof Replay
      ? running
        ? "REPLAY PLAYING"
        : "REPLAY PAUSED"
      : s.status === "running"
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
  $("inference-ms").textContent =
    sim instanceof Replay ? "recorded" : runner.lastMs.toFixed(1) + " ms";
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
    $("motor-" + i).style.width =
      Math.min(100, (v / sim.config.maxRotorThrust) * 100) + "%";
    $("motor-val-" + i).textContent = v.toFixed(1) + " N";
  });
  $("flight-count").textContent = sim.log.length + " frames recorded";
  const axes = s.ship.axes ?? [
    null,
    null,
    s.ship.position[2] - sim.config.freeboard,
    ...s.ship.euler,
  ];
  $("ship-axes").replaceChildren();
  ["Surge", "Sway", "Heave", "Roll", "Pitch", "Yaw"].forEach((name, i) => {
    const cell = document.createElement("div"),
      label = document.createElement("span"),
      value = document.createElement("strong");
    label.textContent = name;
    value.textContent =
      axes[i] === null
        ? "—"
        : (axes[i] * (i > 2 ? 180 / Math.PI : 1)).toFixed(2) +
          (i > 2 ? "°" : " m");
    cell.append(label, value);
    $("ship-axes").append(cell);
  });
  $("link-health").textContent = s.link
    ? `Command delay ${s.link.latencyMs} ms · ${s.link.delivered} delivered / ${s.link.dropped} lost · ${s.link.failsafe ? "BRAKE / HOVER ACTIVE" : "receiving"}`
    : "Recorded before command-link simulation";
  $("active-faults").textContent = s.faults?.length
    ? "Active failures: " +
      s.faults
        .map((f) =>
          f.target === "motor"
            ? `motor ${f.motor + 1} at ${Math.round(f.factor * 100)}%`
            : f.target,
        )
        .join(", ")
    : "No scheduled failures active";
  $("airframe-summary").textContent =
    `X quadrotor · ${sim.config.droneMass} kg · ${sim.config.maxRotorThrust} N / rotor · ${sim.config.motorLagMs} ms motor lag`;
  if (sim instanceof Replay) {
    $("replay-time").value = sim.time;
    $("replay-time-label").textContent =
      `${sim.time.toFixed(2)} / ${sim.endTime.toFixed(2)} s`;
  }
  if (sim.events.length < eventCount) {
    $("events").replaceChildren();
    eventCount = 0;
  }
  for (const event of sim.events.slice(eventCount)) log(event.reason);
  eventCount = sim.events.length;
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
  if (sim instanceof Replay && !running) {
    if (sim.ended) {
      sim.seek(0);
      if (view) view.lastPath = Infinity;
    }
    running = true;
    lastTick = 0;
    $("play").textContent = "Ⅱ Pause replay";
    return;
  }
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

function downloadJson(data, name) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function openReplay(data) {
  const recording = new Replay(data);
  pause();
  ++generation;
  runner.dispose();
  modelReady = false;
  sim = recording;
  eventCount = 0;
  $("events").replaceChildren();
  $("result").hidden = true;
  $("replay-controls").hidden = false;
  $("leave-replay").hidden = false;
  $("replay-time").max = sim.endTime;
  $("replay-status").textContent =
    "RECORDED FLIGHT · " +
    (data.controller?.name ?? data.controller?.type ?? "controller");
  $("play").disabled = false;
  $("step").disabled = false;
  $("compare").disabled = true;
  $("play").textContent = "▶ Play replay";
  $("model-state").textContent = "Viewing saved states; no model is executing";
  $("duration-label").textContent = sim.endTime.toFixed(2);
  $("scene-title").textContent = PRESETS[sim.config.preset].label;
  $("weather-summary").textContent =
    `Recorded · Hs ${sim.config.hs} m · seed ${sim.config.seed}`;
  view?.reset(sim);
  updateUi();
}
$("replay-current").addEventListener("click", () => {
  if (!comparing)
    openReplay(
      sim instanceof Replay
        ? sim.export()
        : { ...sim.export(), controller: modelMetadata },
    );
});
$("leave-replay").addEventListener("click", reset);
$("replay-file").addEventListener("change", async () => {
  const file = $("replay-file").files[0];
  if (!file) return;
  try {
    if (file.size > 100_000_000)
      throw new Error("Flight recording must be under 100 MB");
    openReplay(JSON.parse(await file.text()));
  } catch (e) {
    $("replay-status").textContent = e.message;
  }
  $("replay-file").value = "";
});
$("replay-time").addEventListener("input", () => {
  if (!(sim instanceof Replay)) return;
  pause();
  sim.seek(Number($("replay-time").value));
  if (view) view.lastPath = Infinity;
  $("result").hidden = true;
  if (sim.ended && sim.outcome) showResult();
  updateUi();
});
$("fault-preset").addEventListener("change", () => {
  const target = $("fault-preset").value;
  if (target === "custom") return;
  $("faults").value = JSON.stringify(
    target === "none"
      ? []
      : [
          {
            target,
            start: 5,
            end: target === "motor" ? 120 : target === "gps" ? 10 : 8,
            ...(target === "motor" ? { motor: 0, factor: 0.65 } : {}),
          },
        ],
    null,
    2,
  );
});
$("cancel-compare").addEventListener("click", () => {
  ++comparisonToken;
  $("comparison-status").textContent = "Cancelling comparison…";
});
$("export-comparison").addEventListener("click", () => {
  if (comparisonReport)
    downloadJson(
      {
        ...comparisonReport,
        results: comparisonReport.results.map(({ recording, ...r }) => r),
      },
      "controller-comparison.json",
    );
});
function renderComparison() {
  const container = $("comparison-results");
  container.replaceChildren();
  const p = document.createElement("p");
  p.className = "hint";
  p.textContent = Object.entries(comparisonReport.summaries)
    .map(
      ([name, r]) =>
        `${name}: ${r.landings}/${r.attempts} landings, ${r.impacts} impacts, ${r.timeouts} timeouts, ${r.errors} errors`,
    )
    .join(" · ");
  container.append(p);
  const table = document.createElement("table");
  table.className = "comparison-table";
  const head = document.createElement("tr");
  for (const label of ["Model", "Seed", "Outcome", "Time", "Inspect"]) {
    const th = document.createElement("th");
    th.textContent = label;
    head.append(th);
  }
  table.append(head);
  for (const r of comparisonReport.results) {
    const tr = document.createElement("tr");
    for (const value of [
      r.controller,
      r.seed,
      r.status,
      r.time.toFixed(2) + " s",
    ]) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    }
    const td = document.createElement("td"),
      button = document.createElement("button");
    button.className = "secondary";
    button.textContent = "Replay";
    button.addEventListener("click", () => {
      if (!comparing) openReplay(r.recording);
    });
    td.append(button);
    tr.append(td);
    table.append(tr);
  }
  container.append(table);
}
$("compare").addEventListener("click", async () => {
  if (!modelReady || comparing || sim instanceof Replay) return;
  const seeds = $("compare-seeds")
    .value.split(",")
    .map((s) => Number(s.trim()));
  if (
    seeds.length > 3 ||
    !seeds.length ||
    new Set(seeds).size !== seeds.length ||
    !seeds.every((n) => Number.isInteger(n) && n >= 0 && n <= 4294967295) ||
    sim.config.duration > 120
  ) {
    $("comparison-status").textContent =
      "Use 1–3 distinct unsigned integer seeds and an episode of at most 120 seconds. Use the CLI for larger evaluations.";
    return;
  }
  pause();
  ++generation;
  runner.dispose();
  modelReady = false;
  comparing = true;
  const mine = ++comparisonToken,
    frozen = structuredClone(sim.config);
  const models = [
    {
      type: attached === "reactive" ? "predictive" : "reactive",
      name: attached === "reactive" ? "predictive" : "reactive",
      options: {},
    },
    structuredClone(modelMetadata),
  ];
  const controls = [
    "play",
    "step",
    "reset",
    "apply",
    "attach",
    "compare",
    "replay-current",
    "replay-file",
    "leave-replay",
    "controller",
    "model-file",
  ];
  controls.forEach((id) => ($(id).disabled = true));
  $("cancel-compare").disabled = false;
  $("export-comparison").disabled = true;
  comparisonReport = {
    schemaVersion: 1,
    simulatorVersion: "0.2.0",
    config: frozen,
    seeds,
    models,
    completed: false,
    results: [],
    summaries: {},
  };
  $("comparison-results").replaceChildren();
  let cancelled = false;
  try {
    for (const seed of seeds)
      for (const metadata of models) {
        if (mine !== comparisonToken) {
          cancelled = true;
          break;
        }
        const episode = new Simulation({ ...frozen, seed }),
          policy = new ModelRunner();
        $("comparison-status").textContent =
          `Running ${metadata.name} · seed ${seed} (${comparisonReport.results.length + 1}/${seeds.length * 2})`;
        try {
          await policy.attach(
            metadata.type,
            metadata.type === "custom" ? attachedSource : "",
            metadata.options,
          );
          let ticks = 0;
          while (episode.status === "running") {
            if (mine !== comparisonToken) {
              cancelled = true;
              break;
            }
            episode.advance(await policy.step(episode.observation()));
            if (++ticks % 20 === 0)
              await new Promise((resolve) => setTimeout(resolve, 0));
          }
        } catch (e) {
          episode.finish("model-error", { reason: e.message });
          episode.record();
        } finally {
          policy.dispose();
        }
        if (cancelled) break;
        comparisonReport.results.push({
          controller: metadata.name,
          seed,
          ...episode.outcome,
          recording: { ...episode.export(), controller: metadata },
        });
        for (const m of models)
          comparisonReport.summaries[m.name] = summarize(
            comparisonReport.results.filter((r) => r.controller === m.name),
          );
        renderComparison();
      }
    comparisonReport.completed = !cancelled;
    $("comparison-status").textContent = cancelled
      ? "Cancelled. Completed runs are retained; this is a partial comparison."
      : "Comparison complete. Inspect any flight with Replay; reset to run your controller again.";
  } catch (e) {
    $("comparison-status").textContent = e.message;
  } finally {
    comparing = false;
    controls.forEach((id) => ($(id).disabled = false));
    $("play").disabled = true;
    $("step").disabled = true;
    $("compare").disabled = true;
    $("cancel-compare").disabled = true;
    $("export-comparison").disabled = !comparisonReport.results.length;
    $("model-state").textContent =
      "Comparison finished. Attach/reset before another live flight.";
  }
});

await reset();
requestAnimationFrame(frame);
