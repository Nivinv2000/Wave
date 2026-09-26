#!/usr/bin/env bash
# Launch one deck-landing scenario in PX4 SITL + Gazebo and fly the landing.
#
#   scripts/run_scenario.sh light|medium|storm
#
# Builds the ShipWaveMotion plugin if needed, regenerates the three worlds from
# scenarios.py, links the chosen world into PX4's world folder, starts PX4 with
# Gazebo, and then runs bridge/land_on_deck.py. The simulation is left running
# afterwards so the landed drone can be inspected; stop it with
#   pkill -x px4; pkill -f "gz sim"
set -uo pipefail

SCEN="${1:-medium}"
case "$SCEN" in light|medium|storm) ;; *) echo "usage: $0 light|medium|storm" >&2; exit 2 ;; esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PX4_DIR="${PX4_DIR:-$HOME/PX4-Autopilot}"
CACHE="${DECK_CACHE:-$HOME/.cache/deck-landing}"
BUILD="$CACHE/plugin-build"
LOG="$CACHE/px4_${SCEN}.log"
WORLD="ship_${SCEN}"
SPAWN="0,20,1.3,0,0,0"      # on the launch platform, see scenarios.LAUNCH_PAD_*

# 1. Plugin
if [ ! -f "$BUILD/libShipWaveMotion.so" ]; then
  echo "[run_scenario] building ShipWaveMotion plugin"
  mkdir -p "$BUILD"
  (cd "$BUILD" && cmake "$ROOT/gz/plugin" -DCMAKE_BUILD_TYPE=Release > cmake.log && make -j4) \
    || { echo "[run_scenario] plugin build failed" >&2; exit 2; }
fi

# 2. Worlds
python3 "$ROOT/gz/generate_worlds.py" "$ROOT/gz/worlds" > /dev/null || exit 2
ln -sf "$ROOT/gz/worlds/$WORLD.sdf" "$PX4_DIR/Tools/simulation/gz/worlds/$WORLD.sdf"

launch_and_fly() {
  # 3. Stop any previous simulation. Bracketed patterns so pkill cannot match
  #    this shell's own command line.
  pkill -9 -f "land_on_dec[k].py" 2>/dev/null
  pkill -9 -f "bridge/directo[r].py" 2>/dev/null
  pkill -9 -x px4 2>/dev/null
  pkill -9 -f "g[z] sim" 2>/dev/null
  pkill -f "sleep infinit[y]" 2>/dev/null
  sleep 2

  # 4. Launch, detached. The idle stdin pipe keeps px4's interactive shell from
  #    spinning on EOF and flooding the log.
  mkdir -p "$CACHE"
  ( cd "$PX4_DIR" && setsid bash -c "sleep infinity | env \
      GZ_SIM_SYSTEM_PLUGIN_PATH='$BUILD' \
      PX4_GZ_WORLD='$WORLD' \
      PX4_GZ_MODEL_POSE='$SPAWN' \
      make px4_sitl gz_x500 > '$LOG' 2>&1" > /dev/null 2>&1 & )
  echo "[run_scenario] launched PX4 + Gazebo on $WORLD (log: $LOG)"

  # 5. Wait for the drone to appear in the world.
  for _ in $(seq 1 120); do
    if gz topic -l 2>/dev/null | grep -q "/world/$WORLD/model/x500_0/"; then
      break
    fi
    sleep 1
  done
  if ! gz topic -l 2>/dev/null | grep -q "/world/$WORLD/model/x500_0/"; then
    echo "[run_scenario] drone never appeared; see $LOG" >&2
    return 2
  fi

  # 6. Close-up camera to start with; bridge/director.py then cuts between
  #    angles as the landing progresses. Override live with scripts/camera.sh.
  bash "$ROOT/scripts/camera.sh" close || true

  # 7. Fly.
  /usr/bin/python3 -u "$ROOT/bridge/land_on_deck.py" --scenario "$SCEN"
}

# Exit code 2 means the run never got going (sim did not come up, or PX4 would
# not arm) - a flaky boot, not a landing failure. Relaunch once in that case.
launch_and_fly; rc=$?
if [ "$rc" -eq 2 ]; then
  echo "[run_scenario] setup failed; relaunching once"
  launch_and_fly; rc=$?
fi
exit "$rc"
