#!/usr/bin/env bash
# Run light, medium and storm back to back and print a summary table.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for s in light medium storm; do
  bash "$ROOT/scripts/run_scenario.sh" "$s"
  echo
done

python3 - "$ROOT/reports" <<'EOF'
import json, os, sys
d = sys.argv[1]
print("%-14s %-10s %8s %9s %9s %8s %6s" % ("scenario", "outcome", "offset", "closing", "deck_vz", "tilt", "t"))
for s in ("light", "medium", "storm"):
    p = os.path.join(d, s + ".json")
    if not os.path.exists(p):
        print("%-14s %-10s" % (s, "no report")); continue
    r = json.load(open(p))
    print("%-14s %-10s %7s m %6s m/s %6s m/s %6s deg %5s s" % (
        r["label"], r["outcome"], r.get("offset_from_pad_m", "-"), r.get("closing_speed_mps", "-"),
        r.get("deck_vz_mps", "-"), r.get("deck_tilt_deg", "-"), r.get("time_s", "-")))
EOF

# One combined video, light -> medium -> storm.
FF=$(/usr/bin/python3 -c "import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())" 2>/dev/null)
V="$ROOT/videos"
if [ -n "$FF" ] && [ -f "$V/light.mp4" ] && [ -f "$V/medium.mp4" ] && [ -f "$V/storm.mp4" ]; then
  printf "file '%s'\n" "$V/light.mp4" "$V/medium.mp4" "$V/storm.mp4" > /tmp/deck_concat.txt
  "$FF" -y -loglevel error -f concat -safe 0 -i /tmp/deck_concat.txt -c copy "$V/all_three.mp4" \
    && echo "combined video: $V/all_three.mp4"
fi
