"""Camera director and recorder for the deck-landing runs.

Two halves, deliberately in two processes:

* ``DirectorLink`` lives in the flight controller. It only appends small JSON
  events (camera shot, caption, live numbers) to a file, which cannot block.
* ``main()`` below is a separate process that follows those events: it cuts the
  live Gazebo camera between angles, takes screenshots, and after the landing
  builds a captioned MP4.

Why the split: Gazebo's Python bindings block the whole Python process while a
service request waits (the GIL is not released). When the director ran inside the
controller, a slow GUI stalled the MAVLink setpoint and heartbeat threads, PX4
saw its offboard link go quiet and triggered a failsafe. In its own process the
director can be as slow as the GUI likes without touching the flight.

Every angle follows the drone at a fixed offset (east, north, up, in metres);
Gazebo's camera tracking eases between offsets, so cuts glide rather than jump.
The GUI saves about 5-6 screenshots a second, so the video has that frame rate
and plays back in real time using each frame's own timestamp.
"""

from __future__ import annotations

import argparse
import datetime
import glob
import json
import os
import shutil
import subprocess
import sys
import time

# phase -> (angle name, offset from the drone in metres: east, north, up)
SHOTS = {
    "CLIMB":   ("launch close-up",    (-3.0, 3.0, 2.2)),
    "TRANSIT": ("chase",              (-9.0, 7.0, 5.0)),
    "ALIGN":   ("over the helideck",  (-4.5, 4.5, 6.4)),
    "DESCEND": ("45 deg close",       (-2.0, 2.0, 2.8)),
    "FINAL":   ("deck level",         (0.5, 4.5, 0.9)),
    "COMMIT":  ("45 deg tight",       (-1.4, 1.4, 1.9)),
    "LANDED":  ("top down",           (0.01, 0.0, 5.0)),
    "OUTRO":   ("wide, whole ship",   (-16.0, 12.0, 8.0)),
}

CAPTIONS = {
    "CLIMB":   "Take-off from the launch platform",
    "TRANSIT": "Chasing the ship - matching its speed",
    "ALIGN":   "Over the helideck, locking on",
    "DESCEND": "Descending relative to the heaving deck",
    "FINAL":   "Holding at gate height - waiting for a quiet deck",
    "COMMIT":  "Deck quiet - committing to touchdown",
    "LANDED":  "Touchdown - motors cut, riding the deck",
    "OUTRO":   "Secured on the moving ship",
}

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


# ---------------------------------------------------------------------------
# Controller side
# ---------------------------------------------------------------------------

class DirectorLink:
    """Handle used by the flight controller. Writes events; never talks to Gazebo."""

    def __init__(self, target, title, subtitle, frames_dir=None, video_path=None, fps=6.0):
        cache = os.path.expanduser("~/.cache/deck-landing")
        os.makedirs(cache, exist_ok=True)
        self.events = os.path.join(cache, "director_events.jsonl")
        self._fh = open(self.events, "w", encoding="utf-8")
        self._last_note = 0.0
        self.video_path = video_path if frames_dir else None
        if self.video_path and os.path.exists(self.video_path):
            os.remove(self.video_path)          # so a failed build is never mistaken for success
        args = [sys.executable, "-u", os.path.abspath(__file__), "--events", self.events,
                "--target", target, "--title", title, "--subtitle", subtitle, "--fps", str(fps)]
        if frames_dir:
            args += ["--frames", frames_dir, "--video", video_path]
        self.proc = subprocess.Popen(args)

    def _emit(self, **event):
        event["t"] = time.time()
        self._fh.write(json.dumps(event) + "\n")
        self._fh.flush()

    def shot(self, phase, caption=None):
        self._emit(kind="shot", phase=phase, caption=caption or CAPTIONS[phase])

    def note(self, text):
        now = time.time()
        if now - self._last_note >= 0.1:
            self._last_note = now
            self._emit(kind="note", text=text)

    def start_recording(self):
        self._emit(kind="record")

    def finish(self, timeout=180.0):
        """Tell the director to stop, wait for the video. Returns its path or None."""
        self._emit(kind="end")
        try:
            self.proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            return None
        if self.video_path and os.path.exists(self.video_path):
            return self.video_path
        return None


# ---------------------------------------------------------------------------
# Director process
# ---------------------------------------------------------------------------

def _stamp(path):
    """GUI screenshot names are ISO times with nanoseconds."""
    name = os.path.basename(path)[:-4]
    day, clock = name.split("T")
    hms, _, frac = clock.partition(".")
    dt = datetime.datetime.strptime(day + "T" + hms, "%Y-%m-%dT%H:%M:%S")
    dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.timestamp() + (float("0." + frac) if frac else 0.0)


def _at(series, t, default=""):
    text = default
    for ts, value in series:
        if ts <= t:
            text = value
        else:
            break
    return text


def build_video(frames_dir, video_path, rec_start, timeline, telemetry, title, subtitle, fps):
    from PIL import Image, ImageDraw, ImageFont
    import imageio_ffmpeg

    files = sorted(glob.glob(os.path.join(frames_dir, "*.png")))
    if len(files) < 2:
        print("[director] no frames captured - is the Gazebo window open?")
        return None
    stamps = [_stamp(f) for f in files]
    # Guard against a GUI clock in another time zone: remove whole hours.
    skew = round((stamps[0] - rec_start) / 3600.0) * 3600.0
    stamps = [s - skew for s in stamps]

    try:
        big = ImageFont.truetype(FONT_BOLD, 30)
        mid = ImageFont.truetype(FONT, 21)
        small = ImageFont.truetype(FONT_BOLD, 22)
    except OSError:
        big = mid = small = ImageFont.load_default()

    work = frames_dir.rstrip("/") + "_captioned"
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)
    W, H = 1280, 720
    listing = []
    for i, (f, t) in enumerate(zip(files, stamps)):
        img = Image.open(f).convert("RGB")
        img.thumbnail((W, H))
        canvas = Image.new("RGB", (W, H), (12, 14, 18))
        canvas.paste(img, ((W - img.width) // 2, (H - img.height) // 2))
        d = ImageDraw.Draw(canvas, "RGBA")
        d.rectangle([0, 0, W, 78], fill=(0, 0, 0, 150))
        d.text((20, 8), title, font=big, fill=(255, 255, 255))
        d.text((20, 46), subtitle, font=mid, fill=(210, 220, 230))
        d.rectangle([0, H - 74, W, H], fill=(0, 0, 0, 150))
        d.text((20, H - 68), _at(timeline, t), font=small, fill=(255, 214, 90))
        d.text((20, H - 36), _at(telemetry, t), font=mid, fill=(230, 230, 230))
        d.text((W - 150, H - 36), "t = %5.1f s" % (t - rec_start), font=mid, fill=(230, 230, 230))
        out = os.path.join(work, "%05d.jpg" % i)
        canvas.save(out, quality=90)
        nxt = stamps[i + 1] if i + 1 < len(stamps) else t + 1.0 / fps
        listing.append((out, max(0.02, nxt - t)))

    concat = os.path.join(work, "frames.txt")
    with open(concat, "w") as fh:
        for out, dur in listing:
            fh.write("file '%s'\nduration %.4f\n" % (out, dur))
        fh.write("file '%s'\n" % listing[-1][0])     # the concat demuxer needs the last one twice

    os.makedirs(os.path.dirname(video_path), exist_ok=True)
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error",
                    "-f", "concat", "-safe", "0", "-i", concat,
                    "-vf", "fps=25,format=yuv420p", "-c:v", "libx264",
                    "-preset", "veryfast", "-crf", "22", "-movflags", "+faststart",
                    video_path], check=True)
    span = stamps[-1] - stamps[0]
    print("[director] video: %s (%d frames over %.1f s, %.1f fps captured)"
          % (video_path, len(files), span, (len(files) - 1) / span if span > 0 else 0.0))
    return video_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--events", required=True)
    ap.add_argument("--target", default="x500_0")
    ap.add_argument("--title", default="")
    ap.add_argument("--subtitle", default="")
    ap.add_argument("--fps", type=float, default=6.0)
    ap.add_argument("--frames")
    ap.add_argument("--video")
    a = ap.parse_args()

    from gz.msgs10.boolean_pb2 import Boolean
    from gz.msgs10.stringmsg_pb2 import StringMsg
    from gz.msgs10.vector3d_pb2 import Vector3d
    from gz.transport13 import Node

    node = Node()

    def request(service, msg, mtype, timeout_ms):
        try:
            ok, _ = node.request(service, msg, mtype, Boolean, timeout_ms)
            return bool(ok)
        except Exception:
            return False

    following = request("/gui/follow", StringMsg(data=a.target), StringMsg, 2000)
    timeline, telemetry = [], []
    recording, rec_start, next_frame = False, None, 0.0
    buf, pos, ended = "", 0, False
    deadline = time.time() + 900.0            # never outlive a stuck controller by long

    while not ended and time.time() < deadline:
        try:
            with open(a.events, encoding="utf-8") as fh:
                fh.seek(pos)
                chunk = fh.read()
                pos = fh.tell()
        except OSError:
            chunk = ""
        buf += chunk
        while "\n" in buf:
            line, buf = buf.split("\n", 1)
            if not line.strip():
                continue
            ev = json.loads(line)
            kind = ev.get("kind")
            if kind == "shot":
                if not following:
                    following = request("/gui/follow", StringMsg(data=a.target), StringMsg, 1000)
                off = SHOTS[ev["phase"]][1]
                request("/gui/follow/offset", Vector3d(x=off[0], y=off[1], z=off[2]), Vector3d, 800)
                timeline.append((ev["t"], ev["caption"]))
            elif kind == "note":
                telemetry.append((ev["t"], ev["text"]))
            elif kind == "record" and a.frames:
                shutil.rmtree(a.frames, ignore_errors=True)
                os.makedirs(a.frames, exist_ok=True)
                recording, rec_start = True, ev["t"]
            elif kind == "end":
                ended = True

        now = time.time()
        if recording and not ended and now >= next_frame:
            request("/gui/screenshot", StringMsg(data=a.frames), StringMsg, 400)
            next_frame = now + 1.0 / a.fps
        time.sleep(0.02)

    if recording and a.video:
        time.sleep(1.0)                        # let the last screenshots land
        try:
            build_video(a.frames, a.video, rec_start, timeline, telemetry,
                        a.title, a.subtitle, a.fps)
        except Exception as exc:
            print("[director] video build failed:", exc)


if __name__ == "__main__":
    main()
