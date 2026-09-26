import { WorldView } from "../scene.mjs";
import { Replay } from "../core/replay.mjs";

const $ = (id) => document.getElementById(id);
const views = {
  reactive: new WorldView($("reactive-world")),
  predictive: new WorldView($("predictive-world")),
};
const recordings = {};
let comparison, time = 0, playing = false, previousFrame = 0, generation = 0;

function update() {
  $("time").textContent = time.toFixed(1);
  for (const kind of ["reactive", "predictive"]) {
    const replay = recordings[kind];
    if (!replay) continue;
    replay.seek(time);
    views[kind].draw(replay.snapshot());
    const state = replay.snapshot();
    $(kind + "-decision").textContent = state.command.label;
    $(kind + "-metric").textContent = `Gap ${Math.max(0, state.drone.position[2] - state.ship.pad.position[2] - 0.28).toFixed(2)} m`;
    const outcome = replay.ended ? replay.outcome : null;
    const result = $(kind + "-result");
    result.textContent = outcome ? outcome.status.toUpperCase().replaceAll("-", " ") : "IN FLIGHT";
    result.className = outcome ? (outcome.status === "landed" ? "good" : "bad") : "";
  }
}

async function loadSeed(seed) {
  const mine = ++generation;
  playing = false;
  $("play").textContent = "▶ Play both flights";
  for (const kind of ["reactive", "predictive"]) {
    const result = comparison.results.find((r) => r.seed === seed && r.controller === kind);
    const response = await fetch(`/demo/data/${result.file}`);
    if (!response.ok) throw new Error(`Recording unavailable: ${result.file}`);
    const replay = new Replay(await response.json());
    if (mine !== generation) return;
    recordings[kind] = replay;
    views[kind].reset(replay);
  }
  time = 0;
  previousFrame = 0;
  update();
}

function frame(now) {
  if (playing && recordings.reactive && recordings.predictive) {
    if (previousFrame) time += Math.min(0.1, (now - previousFrame) / 1000) * Number($("speed").value);
    previousFrame = now;
    const end = Math.max(recordings.reactive.endTime, recordings.predictive.endTime);
    if (time >= end) {
      time = end;
      playing = false;
      $("play").textContent = "▶ Play again";
    }
  }
  update();
  requestAnimationFrame(frame);
}

$("play").addEventListener("click", () => {
  if (recordings.reactive?.ended && recordings.predictive?.ended) {
    time = 0;
    for (const view of Object.values(views)) view.lastPath = Infinity;
  }
  playing = !playing;
  previousFrame = 0;
  $("play").textContent = playing ? "Ⅱ Pause both flights" : "▶ Play both flights";
});
$("restart").addEventListener("click", () => {
  playing = false;
  time = 0;
  previousFrame = 0;
  for (const view of Object.values(views)) view.lastPath = Infinity;
  $("play").textContent = "▶ Play both flights";
  update();
});
$("seed").addEventListener("change", () => loadSeed(Number($("seed").value)));

try {
  const response = await fetch("/demo/data/comparison.json");
  if (!response.ok) throw new Error("Comparison data not found. Run node demo/build-demo.mjs first.");
  comparison = await response.json();
  $("summary").textContent = `${comparison.counts.predictive.landings}/${comparison.counts.predictive.attempts} predictive landings · ${comparison.counts.reactive.landings}/${comparison.counts.reactive.attempts} reactive landings`;
  $("conditions").textContent = `Moderate sea: Hs ${comparison.scenario.hs} m, wind ${comparison.scenario.wind} m/s, gust RMS ${comparison.scenario.gust} m/s. Same scenario and wave seed for each pair.`;
  await loadSeed(17);
  requestAnimationFrame(frame);
} catch (error) {
  $("summary").textContent = error.message;
}
