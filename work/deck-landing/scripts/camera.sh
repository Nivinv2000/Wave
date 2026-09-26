#!/usr/bin/env bash
# Switch the Gazebo camera while a scenario is running.
#
#   scripts/camera.sh close   # 45 deg from above, 4 m from the drone (default)
#   scripts/camera.sh closer  # 45 deg from above, 2.4 m
#   scripts/camera.sh pad     # 45 deg from above, whole helideck
#   scripts/camera.sh side    # deck level, beside the drone: best for seeing touchdown
#   scripts/camera.sh chase   # behind the drone, looking where the ship is heading
#   scripts/camera.sh top     # straight down onto the helideck
#   scripts/camera.sh wide    # the whole ship
#   scripts/camera.sh shot    # save a screenshot into work/deck-landing/reports/
#
# Uses Gazebo's CameraTracking services: the camera follows the drone (x500_0)
# at a fixed offset (metres, east/north/up) and keeps looking at it.
set -uo pipefail
VIEW="${1:-close}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$VIEW" in
  close)  OFF="x: -2.0, y: 2.0, z: 2.8" ;;    # 45 deg down, 4 m from the drone (default)
  closer) OFF="x: -1.2, y: 1.2, z: 1.7" ;;    # 45 deg down, 2.4 m
  pad)    OFF="x: -4.5, y: 4.5, z: 6.4" ;;    # 45 deg down, whole helideck in frame
  side)   OFF="x: 0.0, y: 6.0, z: 0.6" ;;     # deck level, beside the drone
  chase)  OFF="x: -7.0, y: 0.0, z: 2.5" ;;    # behind the drone
  top)    OFF="x: 0.01, y: 0.0, z: 9.0" ;;    # straight down
  wide)   OFF="x: -18.0, y: 14.0, z: 9.0" ;;  # the whole ship
  shot)
    mkdir -p "$ROOT/reports"
    gz service -s /gui/screenshot --reqtype gz.msgs.StringMsg --reptype gz.msgs.Boolean \
      --timeout 5000 --req "data: \"$ROOT/reports\"" > /dev/null && echo "saved into $ROOT/reports"
    exit 0 ;;
  *) echo "usage: $0 close|closer|pad|side|chase|top|wide|shot" >&2; exit 2 ;;
esac

gz service -s /gui/follow --reqtype gz.msgs.StringMsg --reptype gz.msgs.Boolean \
  --timeout 3000 --req 'data: "x500_0"' > /dev/null || { echo "Gazebo GUI not reachable" >&2; exit 1; }
gz service -s /gui/follow/offset --reqtype gz.msgs.Vector3d --reptype gz.msgs.Boolean \
  --timeout 3000 --req "$OFF" > /dev/null
echo "camera: $VIEW ($OFF)"
