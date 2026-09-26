import { DEFAULT_SEED, latestSafeAbort, simulate } from "./sim.mjs";

const OBSERVATION_CUTOFF = 4.0;
const DURATION = 8;
const COLORS = {
  mint: "#caff73",
  cyan: "#6ce0d4",
  orange: "#ffae70",
  red: "#ff827d",
  ink: "#0b1929",
  grid: "rgba(182, 205, 216, 0.11)",
  muted: "#8298a8",
};

const $ = (selector) => document.querySelector(selector);
const ui = {
  seed: $("#seedInput"), randomSeed: $("#randomSeed"), runLabel: $("#runLabel"),
  scene: $("#sceneCanvas"), chart: $("#chartCanvas"), sceneState: $("#sceneState"), sceneClock: $("#sceneClock"),
  scrubber: $("#scrubber"), replayTime: $("#replayTimeLabel"), play: $("#playButton"), playGlyph: $("#playGlyph"), reset: $("#resetButton"),
  observation: $("#observationTime"), ask: $("#askButton"), model: $("#modelSelect"), decisionStatus: $("#decisionStatus"),
  result: $("#analysisResult"), manualForm: $("#manualForm"), manualAbort: $("#manualAbort"), apiNote: $("#apiNote"),
  branchChip: $("#branchChip"), outcomePlaceholder: $("#outcomePlaceholder"), outcomeResult: $("#outcomeResult"),
  download: $("#downloadButton"), toast: $("#toast"),
};

let seed = DEFAULT_SEED;
let baseline = simulate(seed, null);
let latest = latestSafeAbort(seed);
let activeRun = baseline;
let analysis = null;
let branch = null;
let currentTime = 0;
let playing = false;
let lastFrame = 0;
let toastTimer = 0;

ui.observation.textContent = `${OBSERVATION_CUTOFF.toFixed(2)} s`;
ui.scrubber.max = String(DURATION);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function fmtTime(value, digits = 2) {
  return Number.isFinite(value) ? `${value.toFixed(digits)} s` : "—";
}

function prettyClock(t) {
  const seconds = clamp(Number(t) || 0, 0, DURATION);
  return `00:${seconds.toFixed(1).padStart(4, "0")}`;
}

function sampleAt(run, time) {
  const samples = run?.samples || [];
  if (!samples.length) return null;
  if (time <= samples[0].t) return samples[0];
  for (let i = 1; i < samples.length; i += 1) {
    if (samples[i].t >= time) {
      const a = samples[i - 1];
      const b = samples[i];
      const p = (time - a.t) / Math.max(1e-6, b.t - a.t);
      return Object.fromEntries(["t", "deckY", "deckV", "droneY", "droneV", "gap"].map((key) => [
        key, (a[key] ?? 0) + ((b[key] ?? 0) - (a[key] ?? 0)) * p,
      ]));
    }
  }
  return samples[samples.length - 1];
}

function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawDrone(ctx, x, y, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.shadowColor = "rgba(202,255,115,.32)";
  ctx.shadowBlur = 18;
  ctx.strokeStyle = COLORS.mint;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-29, -8); ctx.lineTo(-16, -3); ctx.lineTo(0, 0); ctx.lineTo(16, -3); ctx.lineTo(29, -8);
  ctx.moveTo(-25, -11); ctx.lineTo(-33, -11);
  ctx.moveTo(25, -11); ctx.lineTo(33, -11);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#d9ffa0";
  ctx.beginPath(); ctx.moveTo(-7, -4); ctx.lineTo(0, -14); ctx.lineTo(7, -4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(202,255,115,.65)";
  for (const rotorX of [-33, 33]) {
    ctx.beginPath(); ctx.ellipse(rotorX, -11, 11, 2.3, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = "rgba(202,255,115,.55)";
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(-3, 1); ctx.lineTo(-5, 8); ctx.moveTo(3, 1); ctx.lineTo(5, 8); ctx.stroke();
  ctx.restore();
}

function drawSceneTo(ctx, run, time, { evidence = false, branchMark = null } = {}) {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const sample = sampleAt(run, time) || { t: 0, deckY: 0, droneY: 4, gap: 4 };
  const scale = width / 1200;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, 1200, 570);

  const sky = ctx.createLinearGradient(0, 0, 0, 570);
  sky.addColorStop(0, "#12283b"); sky.addColorStop(.64, "#183348"); sky.addColorStop(1, "#0c2031");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, 1200, 570);

  ctx.fillStyle = "rgba(216,238,229,.8)";
  ctx.beginPath(); ctx.arc(1004, 83, 23, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(12,32,49,.42)";
  ctx.beginPath(); ctx.arc(1014, 76, 21, 0, Math.PI * 2); ctx.fill();

  ctx.strokeStyle = "rgba(177,207,216,.07)"; ctx.lineWidth = 1;
  for (let x = 45; x < 1200; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 480); ctx.stroke(); }
  for (let y = 45; y < 500; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1200, y); ctx.stroke(); }

  const deckY = 430 - sample.deckY * 115;
  const waterTop = 414 + Math.sin(time * .85 + (Number(seed) % 5)) * 4;
  ctx.fillStyle = "rgba(35,113,132,.22)";
  ctx.beginPath(); ctx.moveTo(0, waterTop);
  for (let x = 0; x <= 1200; x += 10) ctx.lineTo(x, waterTop + Math.sin(x * .016 + time * 1.9) * 3.7 + Math.sin(x * .037 - time) * 1.4);
  ctx.lineTo(1200, 570); ctx.lineTo(0, 570); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "rgba(108,224,212,.35)"; ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let x = 0; x <= 1200; x += 8) {
    const y = waterTop + Math.sin(x * .016 + time * 1.9) * 3.7 + Math.sin(x * .037 - time) * 1.4;
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();

  const hullTop = deckY + 10;
  ctx.fillStyle = "#51697a";
  ctx.beginPath(); ctx.moveTo(560, hullTop); ctx.lineTo(1040, hullTop); ctx.lineTo(979, 510); ctx.lineTo(635, 510); ctx.lineTo(585, 482); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#3f5669";
  ctx.beginPath(); ctx.moveTo(635, 510); ctx.lineTo(979, 510); ctx.lineTo(947, 529); ctx.lineTo(648, 529); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "rgba(219,235,232,.18)"; ctx.lineWidth = 1;
  for (let x = 625; x < 971; x += 44) { ctx.beginPath(); ctx.moveTo(x, hullTop + 20); ctx.lineTo(x + 1, 490); ctx.stroke(); }

  ctx.fillStyle = "#8d9fac";
  ctx.fillRect(645, deckY - 12, 362, 13);
  ctx.fillStyle = "#bac5ca";
  ctx.fillRect(646, deckY - 14, 360, 4);
  ctx.fillStyle = "rgba(20,38,55,.72)";
  ctx.fillRect(650, deckY - 10, 353, 3);
  for (let x = 672; x <= 982; x += 24) {
    ctx.fillStyle = x % 48 === 0 ? "rgba(229,237,229,.28)" : "rgba(229,237,229,.11)";
    ctx.fillRect(x, deckY - 9, 1, 5);
  }

  ctx.fillStyle = "rgba(255,174,112,.12)";
  ctx.fillRect(779, deckY - 22, 85, 9);
  ctx.strokeStyle = "rgba(255,174,112,.85)";
  ctx.lineWidth = 1.2;
  ctx.setLineDash([6, 5]); ctx.strokeRect(779, deckY - 22, 85, 9); ctx.setLineDash([]);
  ctx.fillStyle = COLORS.orange;
  ctx.font = "500 8px 'DM Mono', monospace";
  ctx.fillText("SAFE PAD", 796, deckY - 28);

  const droneX = 821;
  const droneY = deckY - 14 - sample.gap * 72;
  ctx.setLineDash([3, 8]); ctx.strokeStyle = "rgba(202,255,115,.25)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(droneX, droneY + 12); ctx.lineTo(821, deckY - 28); ctx.stroke(); ctx.setLineDash([]);
  drawDrone(ctx, droneX, droneY, 1.12);

  ctx.fillStyle = "rgba(5,16,27,.68)";
  roundedRect(ctx, 22, 22, 174, 58, 7); ctx.fill();
  ctx.fillStyle = "#8195a5"; ctx.font = "500 8px 'DM Mono', monospace"; ctx.fillText("RELATIVE CLEARANCE", 35, 42);
  ctx.fillStyle = sample.gap < .75 ? COLORS.orange : "#e3eee7"; ctx.font = "600 19px 'DM Mono', monospace";
  ctx.fillText(`${Math.max(0, sample.gap).toFixed(2)} m`, 35, 67);

  ctx.fillStyle = "rgba(5,16,27,.68)";
  roundedRect(ctx, 1012, 22, 164, 58, 7); ctx.fill();
  ctx.fillStyle = "#8195a5"; ctx.font = "500 8px 'DM Mono', monospace"; ctx.fillText("DECK HEAVE", 1026, 42);
  ctx.fillStyle = COLORS.cyan; ctx.font = "600 17px 'DM Mono', monospace";
  ctx.fillText(`${sample.deckY >= 0 ? "+" : ""}${sample.deckY.toFixed(2)} m`, 1026, 67);

  if (branchMark !== null && branchMark !== undefined) {
    const markerX = 335 + clamp(branchMark / (run.duration || DURATION), 0, 1) * 355;
    ctx.strokeStyle = COLORS.mint; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(markerX, deckY - 66); ctx.lineTo(markerX, deckY - 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = COLORS.mint; ctx.font = "500 8px 'DM Mono', monospace"; ctx.fillText("ABORT", markerX - 18, deckY - 73);
  }

  if (!evidence) {
    const contact = run.contact;
    if (contact && time >= contact.t) {
      const impact = run.safe ? COLORS.mint : COLORS.red;
      ctx.strokeStyle = impact; ctx.lineWidth = 2;
      for (let r = 10; r <= 30; r += 10) { ctx.beginPath(); ctx.arc(821, deckY - 19, r, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = impact; ctx.font = "600 9px 'DM Mono', monospace";
      ctx.fillText(run.safe ? "SOFT TOUCHDOWN" : "HARD TOUCHDOWN", 872, deckY - 36);
    }
    ctx.fillStyle = "rgba(255,255,255,.38)"; ctx.font = "500 8px 'DM Mono', monospace";
    ctx.fillText("SIDE ELEVATION · HEAVE ONLY", 22, 548);
  } else {
    ctx.fillStyle = "rgba(255,255,255,.52)"; ctx.font = "500 10px 'DM Mono', monospace";
    ctx.fillText(`OBSERVED FRAME · t = ${time.toFixed(2)} s`, 22, 548);
  }

  ctx.restore();
}

function drawChartTo(ctx, run, { cutoff = run.duration, cursor = null, evidence = false, mode = "altitude" } = {}) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#101e2e"; ctx.fillRect(0, 0, w, h);
  const scale = w / 1200;
  ctx.save(); ctx.scale(scale, scale);
  const left = 65, top = 30, plotW = 1090, plotH = 238, bottom = top + plotH;
  const maxT = evidence ? cutoff : DURATION;
  const samples = (run.samples || []).filter((s) => s.t <= maxT + .0001);
  const observedTop = Math.max(4.4, ...samples.map((sample) => sample.droneY + .15));
  const range = mode === "velocity" ? { min: -1.25, max: 1.25 } : { min: 0, max: Math.min(6.5, observedTop) };
  const mapX = (t) => left + (t / maxT) * plotW;
  const mapY = (v) => top + ((range.max - v) / (range.max - range.min)) * plotH;

  ctx.strokeStyle = COLORS.grid; ctx.lineWidth = 1;
  ctx.fillStyle = "#72899a"; ctx.font = "500 8px 'DM Mono', monospace";
  const yTicks = mode === "velocity" ? [-1, -.5, 0, .5, 1] : [0, 1, 2, 3, 4];
  for (const value of yTicks) {
    const y = mapY(value);
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + plotW, y); ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(mode === "velocity" ? `${value.toFixed(1)}` : `${value.toFixed(0)}`, left - 12, y + 3);
  }
  for (let tick = 0; tick <= maxT; tick += 1) {
    const x = mapX(tick);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
    ctx.textAlign = "center"; ctx.fillText(`${tick.toFixed(0)}s`, x, bottom + 19);
  }
  ctx.textAlign = "left"; ctx.fillStyle = "#688094";
  ctx.fillText(mode === "velocity" ? "VERTICAL SPEED · m/s" : "HEIGHT · m", 14, top + 6);

  if (mode === "velocity") {
    const bandTop = mapY(.32), bandBottom = mapY(-.32);
    ctx.fillStyle = "rgba(202,255,115,.07)"; ctx.fillRect(left, bandTop, plotW, bandBottom - bandTop);
    ctx.strokeStyle = "rgba(202,255,115,.5)"; ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.moveTo(left, bandTop); ctx.lineTo(left + plotW, bandTop); ctx.moveTo(left, bandBottom); ctx.lineTo(left + plotW, bandBottom); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "rgba(202,255,115,.75)"; ctx.textAlign = "right"; ctx.font = "500 7px 'DM Mono', monospace";
    ctx.fillText("SAFE TOUCHDOWN BAND", left + plotW - 5, bandTop - 5);
  }

  const trace = (getter, color, dash = []) => {
    ctx.strokeStyle = color; ctx.lineWidth = 2.3; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.setLineDash(dash);
    ctx.beginPath();
    samples.forEach((sample, index) => {
      const raw = getter(sample);
      const x = mapX(sample.t), y = mapY(clamp(raw, range.min - .1, range.max + .1));
      index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke(); ctx.setLineDash([]);
  };

  if (mode === "velocity") {
    trace((s) => s.droneV, COLORS.mint);
    trace((s) => s.deckV, COLORS.cyan);
  } else {
    trace((s) => s.droneY, COLORS.mint);
    trace((s) => s.deckY, COLORS.cyan);
    const contact = !evidence && run.contact;
    if (contact && contact.t <= DURATION) {
      const x = mapX(contact.t);
      ctx.strokeStyle = run.safe ? COLORS.mint : COLORS.red; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = run.safe ? COLORS.mint : COLORS.red; ctx.textAlign = "center"; ctx.font = "500 8px 'DM Mono', monospace";
      ctx.fillText(`CONTACT ${contact.t.toFixed(2)}s`, x, top + 12);
    }
  }

  if (cursor !== null && cursor <= maxT) {
    const x = mapX(cursor);
    ctx.strokeStyle = COLORS.orange; ctx.lineWidth = 1.5; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); ctx.setLineDash([]);
  }
  if (evidence) {
    ctx.fillStyle = "rgba(255,174,112,.13)"; ctx.fillRect(mapX(maxT) - 1, top, 2, plotH);
    ctx.fillStyle = COLORS.orange; ctx.textAlign = "right"; ctx.font = "500 8px 'DM Mono', monospace";
    ctx.fillText(`OBSERVATION ENDS ${maxT.toFixed(2)}s`, left + plotW, bottom + 35);
  }
  ctx.restore();
}

function render() {
  drawSceneTo(ui.scene.getContext("2d"), activeRun, currentTime, { branchMark: branch?.time ?? null });
  drawChartTo(ui.chart.getContext("2d"), activeRun, { cursor: currentTime });
  ui.sceneClock.textContent = prettyClock(currentTime);
  ui.replayTime.textContent = `${currentTime.toFixed(2)} s`;
  ui.scrubber.value = String(currentTime);
  const touching = activeRun.contact && currentTime >= activeRun.contact.t;
  ui.sceneState.textContent = touching ? (activeRun.safe ? "SOFT TOUCHDOWN" : "HARD TOUCHDOWN") : "DESCENDING";
  ui.sceneState.style.color = touching ? (activeRun.safe ? COLORS.mint : COLORS.red) : COLORS.cyan;
}

function makeEvidenceImages() {
  const visibleRun = baseline;
  const frame = sampleAt(visibleRun, OBSERVATION_CUTOFF);
  const sceneCanvas = document.createElement("canvas");
  sceneCanvas.width = 1200; sceneCanvas.height = 570;
  drawSceneTo(sceneCanvas.getContext("2d"), visibleRun, OBSERVATION_CUTOFF, { evidence: true });

  const altitudeCanvas = document.createElement("canvas");
  altitudeCanvas.width = 1200; altitudeCanvas.height = 330;
  drawChartTo(altitudeCanvas.getContext("2d"), visibleRun, { cutoff: OBSERVATION_CUTOFF, evidence: true, mode: "altitude" });

  const velocityCanvas = document.createElement("canvas");
  velocityCanvas.width = 1200; velocityCanvas.height = 330;
  drawChartTo(velocityCanvas.getContext("2d"), visibleRun, { cutoff: OBSERVATION_CUTOFF, evidence: true, mode: "velocity" });

  if (!frame) throw new Error("Could not prepare the visible approach frames.");
  return [sceneCanvas, altitudeCanvas, velocityCanvas].map((canvas) => canvas.toDataURL("image/png"));
}

function setStatus(label, className) {
  ui.decisionStatus.textContent = label;
  ui.decisionStatus.className = `status-pill ${className}`;
}

function toast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 2800);
}

function updateAskButton() {
  const modelLabel = ui.model.value === "claude-opus-5" ? "Opus 5" : "Opus 5.5";
  ui.ask.dataset.modelLabel = modelLabel;
  if (!ui.ask.disabled) {
    ui.ask.innerHTML = `<span class="button-spark" aria-hidden="true">✳</span><span>Ask ${modelLabel}</span><span class="button-arrow" aria-hidden="true">↗</span>`;
  }
}

function resetForSeed(nextSeed, { quiet = false } = {}) {
  seed = nextSeed;
  baseline = simulate(seed, null);
  latest = latestSafeAbort(seed);
  activeRun = baseline;
  currentTime = 0;
  playing = false;
  analysis = null;
  branch = null;
  ui.playGlyph.textContent = "▶";
  ui.ask.disabled = false;
  updateAskButton();
  ui.runLabel.textContent = `#${String(seed).padStart(3, "0")}`;
  ui.seed.value = String(seed);
  ui.scrubber.value = "0";
  setStatus("AWAITING READ", "status-waiting");
  ui.result.innerHTML = '<div class="result-placeholder"><span class="placeholder-orbit"><i></i><i></i><i></i></span><span>Waiting for visual analysis</span></div>';
  ui.branchChip.textContent = "NO BRANCH YET";
  ui.branchChip.className = "branch-chip";
  ui.outcomePlaceholder.hidden = false;
  ui.outcomeResult.hidden = true;
  ui.outcomeResult.innerHTML = "";
  ui.download.disabled = true;
  ui.manualAbort.value = "";
  render();
  if (!quiet) toast(`Wave seed ${seed} loaded. Model view ends at ${OBSERVATION_CUTOFF.toFixed(2)} seconds.`);
}

function drawAnalysis(result) {
  const time = clamp(result.abortAt, 0, DURATION);
  const modelName = result.model || ui.model.options[ui.model.selectedIndex].textContent.trim();
  ui.result.innerHTML = `
    <div class="result-content">
      <div class="result-time-row">
        <div><div class="result-time-label">PROPOSED ABORT</div><div class="result-time">${time.toFixed(2)}<small>s</small></div></div>
        <div class="result-model">${escapeHtml(modelName)}<br>visual estimate</div>
      </div>
      <p class="result-evidence">${escapeHtml(result.evidence || "No visual evidence was returned.")}</p>
      ${result.reason ? `<p class="result-reason">${escapeHtml(result.reason)}</p>` : ""}
    </div>`;
  setStatus("ESTIMATE READY", "status-ready");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function branchAt(time, { source, proposal = null } = {}) {
  const abortAt = Number(time);
  if (!Number.isFinite(abortAt) || abortAt < 0 || abortAt > DURATION) {
    toast("Enter an abort time between 0 and 8 seconds.");
    return;
  }
  branch = { time: Number(abortAt.toFixed(2)), source, proposal };
  activeRun = simulate(seed, branch.time);
  playing = source === "model";
  currentTime = 0;
  ui.playGlyph.textContent = playing ? "Ⅱ" : "▶";
  ui.outcomePlaceholder.hidden = true;
  ui.outcomeResult.hidden = false;
  ui.branchChip.textContent = activeRun.safe ? "SAFE BRANCH" : "UNSAFE BRANCH";
  ui.branchChip.className = `branch-chip ${activeRun.safe ? "safe" : "unsafe"}`;
  ui.outcomeResult.innerHTML = buildOutcomeHtml(activeRun, branch.time, source);
  ui.download.disabled = !activeRun.safe;
  ui.scrubber.max = String(DURATION);
  render();
  if (playing) { lastFrame = 0; requestAnimationFrame(animate); }
  toast(activeRun.safe ? "Counterfactual cleared the deck." : "This timing still contacts the deck unsafely.");
}

function buildOutcomeHtml(run, abortAt, source) {
  const contactValue = run.contact ? fmtTime(run.contact.t) : "none";
  const relValue = run.contact ? `${run.contact.relativeSpeed.toFixed(2)} m/s` : "clear";
  const compare = latest.time === null ? "No safe abort window in this run." : Math.abs(latest.time - abortAt);
  const compareCopy = typeof compare === "number"
    ? `${Math.abs(compare) < .005 ? "At" : abortAt < latest.time ? `${compare.toFixed(2)}s before` : `${compare.toFixed(2)}s after`} latest safe simulator time · ${fmtTime(latest.time)}`
    : compare;
  return `
    <div class="outcome-verdict">
      <span class="verdict-icon ${run.safe ? "safe" : "unsafe"}">${run.safe ? "✓" : "!"}</span>
      <div><div class="verdict-title">${run.safe ? "Abort clears the deck" : run.contact ? "Unsafe contact" : "Deck not cleared"}</div><div class="verdict-subtitle">${escapeHtml(run.reason.replaceAll("-", " ").toUpperCase())} · ${escapeHtml(source.toUpperCase())}</div></div>
    </div>
    <div class="metric-grid">
      <div class="metric"><label>COMMAND TIME</label><strong>${abortAt.toFixed(2)}<small>s</small></strong></div>
      <div class="metric"><label>CONTACT</label><strong>${run.contact ? run.contact.relativeSpeed.toFixed(2) : "—"}<small>${run.contact ? "m/s rel." : "no hit"}</small></strong></div>
    </div>
    <div class="oracle-row"><span>SIMULATOR REFERENCE</span><b>${escapeHtml(compareCopy)}</b></div>`;
}

async function askOpus() {
  const modelLabel = ui.model.value === "claude-opus-5" ? "Opus 5" : "Opus 5.5";
  ui.ask.disabled = true;
  ui.ask.innerHTML = `<span class="placeholder-orbit"><i></i><i></i><i></i></span><span>Reading with ${modelLabel}…</span>`;
  setStatus("READING IMAGES", "status-thinking");
  ui.apiNote.textContent = "Sending three visible evidence views. No future telemetry is included.";
  try {
    const images = makeEvidenceImages();
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ images, seed, model: ui.model.value }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Analysis unavailable (${response.status}).`);
    if (!Number.isFinite(payload.abortAt) || payload.abortAt < 0 || payload.abortAt > DURATION) {
      throw new Error("The model response did not include a valid abort time.");
    }
    analysis = {
      abortAt: Number(payload.abortAt.toFixed(2)),
      evidence: String(payload.evidence || ""),
      reason: String(payload.reason || ""),
      model: String(payload.model || ui.model.value),
      requestedModel: ui.model.value,
      seed,
      createdAt: new Date().toISOString(),
    };
    drawAnalysis(analysis);
    ui.manualAbort.value = analysis.abortAt.toFixed(2);
    branchAt(analysis.abortAt, { source: "model", proposal: analysis });
    ui.apiNote.textContent = "Branch result is checked by the deterministic simulator.";
  } catch (error) {
    setStatus("API UNAVAILABLE", "status-error");
    ui.result.innerHTML = `<div class="result-content"><div class="result-time-label">MODEL COULD NOT COMPLETE THIS READ</div><p class="result-evidence">${escapeHtml(error.message)}</p><p class="result-reason">Use manual time entry below to continue the physics replay.</p></div>`;
    ui.apiNote.textContent = "Model access unavailable. Manual branch remains ready.";
    toast("Model unavailable. You can still test an abort time manually.");
  } finally {
    ui.ask.disabled = false;
    updateAskButton();
  }
}

function downloadFixture() {
  if (!branch || !activeRun?.safe) return;
  const fixture = {
    fixture: "last-safe-second-counterfactual",
    version: 1,
    createdAt: new Date().toISOString(),
    scenario: {
      seed,
      simulator: "synthetic heave-only drone/deck model",
      durationSeconds: DURATION,
      observationCutoffSeconds: OBSERVATION_CUTOFF,
      evidenceViews: ["approach frame", "altitude history", "vertical speed history"],
    },
    proposal: branch.proposal ? {
      model: branch.proposal.model,
      requestedModel: branch.proposal.requestedModel,
      abortAtSeconds: branch.time,
      evidence: branch.proposal.evidence,
      reason: branch.proposal.reason,
    } : { source: "manual", abortAtSeconds: branch.time },
    assertion: {
      abortClearsDeck: true,
      observedAbortClearsDeck: activeRun.safe,
      latestSafeAbortSeconds: latest.time,
      proposedTimeWithinSafeBoundary: latest.time !== null && branch.time <= latest.time + 1e-9,
      touchdown: activeRun.contact,
      result: activeRun.reason,
    },
    replay: activeRun.samples,
    baseline: {
      safe: baseline.safe,
      reason: baseline.reason,
      contact: baseline.contact,
    },
    disclaimer: "Synthetic simulator fixture only. Not aircraft flight guidance or a safety certification.",
  };
  const blob = new Blob([JSON.stringify(fixture, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `last-safe-second-seed-${seed}-abort-${branch.time.toFixed(2)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  toast("Regression fixture saved.");
}

function setTime(value) {
  currentTime = clamp(Number(value) || 0, 0, DURATION);
  render();
}

function animate(now) {
  if (!playing) return;
  if (!lastFrame) lastFrame = now;
  const delta = Math.min(70, now - lastFrame) / 1000;
  lastFrame = now;
  currentTime += delta * 1.3;
  if (currentTime >= DURATION) {
    currentTime = DURATION;
    playing = false;
    ui.playGlyph.textContent = "▶";
  }
  render();
  if (playing) requestAnimationFrame(animate);
}

ui.seed.addEventListener("change", () => {
  const value = Number(ui.seed.value);
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    ui.seed.value = String(seed);
    toast("Choose a whole-number seed from 0 to 4,294,967,295.");
    return;
  }
  resetForSeed(value);
});

ui.randomSeed.addEventListener("click", () => {
  let next = Math.floor(Math.random() * 1000);
  if (next === seed) next = (next + 1) % 1000;
  resetForSeed(next);
});

ui.scrubber.addEventListener("input", () => {
  playing = false; ui.playGlyph.textContent = "▶"; lastFrame = 0;
  setTime(ui.scrubber.value);
});

ui.play.addEventListener("click", () => {
  if (currentTime >= DURATION) setTime(0);
  playing = !playing;
  ui.playGlyph.textContent = playing ? "Ⅱ" : "▶";
  lastFrame = 0;
  if (playing) requestAnimationFrame(animate);
});

ui.reset.addEventListener("click", () => resetForSeed(seed));
ui.ask.addEventListener("click", askOpus);
ui.model.addEventListener("change", updateAskButton);
ui.manualForm.addEventListener("submit", (event) => {
  event.preventDefault();
  branchAt(ui.manualAbort.value, { source: "manual" });
});
ui.download.addEventListener("click", downloadFixture);

resetForSeed(DEFAULT_SEED, { quiet: true });
