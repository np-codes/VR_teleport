"""
Frame sources.

StereoSource opens the left and right cameras in parallel with identical settings, waits
until both deliver frames, locks exposure / white balance / focus where the cameras accept
it, and hands out left + right frame PAIRS captured at most max_pair_gap_ms apart.
VideoPairSource does the same from two video files (testing).
Both: pair(timeout) -> (left, right, gap_seconds) or None; stats(); stop(); swap(); running.
"""

import threading
import time
from collections import deque

import cv2
import numpy as np

BACKENDS = {"msmf": cv2.CAP_MSMF, "dshow": cv2.CAP_DSHOW, "any": cv2.CAP_ANY}


def open_camera(index, backend, width, height, fps, mjpg=False):
    """Open a camera with the given format. MJPG: compressed, needed for two USB 2.0 webcams."""
    # Format, size and fps are passed together when opening. With DirectShow, setting width/height
    # AFTER the FOURCC silently resets it to YUY2 (about 10 fps at 1280x720 on USB 2.0 webcams).
    params = [cv2.CAP_PROP_FRAME_WIDTH, width, cv2.CAP_PROP_FRAME_HEIGHT, height, cv2.CAP_PROP_FPS, fps]
    if mjpg:
        params = [cv2.CAP_PROP_FOURCC, cv2.VideoWriter.fourcc(*"MJPG"), *params]
    cap = cv2.VideoCapture(index, BACKENDS[backend.lower()], params)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # keep only the newest frame -> lower latency
    return cap


def _try(cap, prop, value):
    """Set a camera property; returns 'accepted (reads X)' or 'not accepted'."""
    ok = cap.set(prop, value)
    got = cap.get(prop)
    if not ok:
        return f"not accepted (reads {got:g})"
    return "accepted" if abs(got - value) < 0.01 else f"set, but reads {got:g} (the camera may not apply it)"


def lock_settings(cap, c, backend):
    """Lock exposure, white balance and focus as settings.toml asks. Returns {setting: result}."""
    result = {}
    if c.lock_exposure:
        manual = 0.25 if backend == "dshow" else 0  # "manual exposure" value differs per backend
        result["auto exposure off"] = _try(cap, cv2.CAP_PROP_AUTO_EXPOSURE, manual)
        result[f"exposure {c.exposure}"] = _try(cap, cv2.CAP_PROP_EXPOSURE, c.exposure)
    if c.lock_white_balance:
        result["auto white balance off"] = _try(cap, cv2.CAP_PROP_AUTO_WB, 0)
        result[f"white balance {c.wb_temperature} K"] = _try(cap, cv2.CAP_PROP_WB_TEMPERATURE, c.wb_temperature)
    if c.lock_focus:
        result["autofocus off"] = _try(cap, cv2.CAP_PROP_AUTOFOCUS, 0)
    return result


def restore_auto(cap, c, backend):
    """Give the camera its automatic modes back (the driver may otherwise keep our fixed values)."""
    if c.lock_exposure:
        cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 0.75 if backend == "dshow" else 1)
    if c.lock_white_balance:
        cap.set(cv2.CAP_PROP_AUTO_WB, 1)
    if c.lock_focus:
        cap.set(cv2.CAP_PROP_AUTOFOCUS, 1)


def fourcc_text(cap):
    code = int(cap.get(cv2.CAP_PROP_FOURCC))
    text = code.to_bytes(4, "little").decode("ascii", errors="replace")
    return text if text.isprintable() and text.strip() else f"code {code}"


class Camera:
    """One camera on its own thread; keeps its last few frames with their arrival times."""

    def __init__(self, name, index, c, start_gate=None):
        """start_gate: a threading.Barrier shared with the other camera, so both start
        streaming at the same moment (opening takes different times per camera)."""
        self.name, self.index, self.c, self.start_gate = name, index, c, start_gate
        self.backend = c.backend.lower()
        self.frames = deque(maxlen=4)  # (arrival time, frame)
        self.lock = threading.Lock()
        self.count, self.state, self.info, self.settings = 0, "opening", {}, {}
        self.running = True
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()

    def _loop(self):
        c = self.c
        cap = open_camera(self.index, self.backend, c.width, c.height, c.fps, c.mjpg)
        if not cap.isOpened():
            self.state = "could not open"
            if self.start_gate:
                self.start_gate.abort()  # don't keep the other camera waiting
            return
        self.settings = lock_settings(cap, c, self.backend)
        self.info = {"format": fourcc_text(cap), "size": f"{int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))}x"
                     f"{int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))}", "fps": f"{cap.get(cv2.CAP_PROP_FPS):g}"}
        if c.mjpg and self.info["format"] != "MJPG":
            print(f"WARNING {self.name} camera (index {self.index}) is using {self.info['format']}, not MJPG. "
                  "Two cameras may not both reach full speed; try another USB port or a lower resolution.",
                  flush=True)
        if self.start_gate:
            self.state = "opened, waiting for the other camera"
            try:
                self.start_gate.wait(timeout=c.open_timeout_s if hasattr(c, "open_timeout_s") else 10)
            except threading.BrokenBarrierError:
                pass  # the other camera failed or is slow: stream anyway
        self.state = "waiting for frames"
        fails = 0
        while self.running:
            ok, frame = cap.read()
            now = time.perf_counter()
            if ok:
                with self.lock:
                    self.frames.append((now, frame))
                    self.count += 1
                self.state, fails = "ok", 0
            else:
                fails += 1
                self.state = f"read failing ({fails}x)"
                time.sleep(0.02)
        restore_auto(cap, c, self.backend)
        cap.release()

    def recent(self):
        with self.lock:
            return list(self.frames)

    def stop(self):
        self.running = False
        self.thread.join(timeout=2)


class StereoSource:
    def __init__(self, cfg):
        c = cfg.cameras
        self.c = c
        self.max_gap = c.max_pair_gap_ms / 1000
        gate = threading.Barrier(2)  # both cameras start streaming together
        self.left = Camera("left", c.left_index, c, gate)
        self.right = Camera("right", c.right_index, c, gate)
        self.running = True
        self.used = (0.0, 0.0)  # arrival times of the last frames handed out
        self.gaps = deque(maxlen=300)
        self.paired = self.skipped = self.unpaired = 0
        self._wait_for_both(c.open_timeout_s)

    def _wait_for_both(self, timeout):
        end = time.perf_counter() + timeout
        while time.perf_counter() < end and (self.left.count == 0 or self.right.count == 0):
            if "could not open" in (self.left.state, self.right.state):
                break
            time.sleep(0.02)
        failed = [cam for cam in (self.left, self.right) if cam.count == 0]
        if failed:
            self.stop()
            names = ", ".join(f"{cam.name} camera (index {cam.index}: {cam.state})" for cam in failed)
            raise SystemExit(
                f"No frames from the {names} within {timeout} s. Try:\n"
                "  - close other apps that may use it (OBS preview, Camo, browser, Teams, stereo_calib)\n"
                "  - plug the two cameras into different USB ports (not the same hub)\n"
                "  - keep [cameras] mjpg = true, or lower width/height in settings.toml\n"
                '  - try the other [cameras] backend ("msmf" / "dshow")\n'
                "  - run python tools\\diagnose.py to check the indexes")

    def report(self):
        """What each camera actually accepted, as printable lines."""
        lines = []
        for cam in (self.left, self.right):
            i = cam.info
            lines.append(f"  {cam.name} camera, index {cam.index}: {i.get('format')} {i.get('size')} "
                         f"@ {i.get('fps')} fps")
            for name, result in cam.settings.items():
                lines.append(f"      {name}: {result}")
        return lines

    def swap(self):
        """Swap which camera is left and which is right (in this run only)."""
        self.left, self.right = self.right, self.left
        self.left.name, self.right.name = "left", "right"
        self.used = (0.0, 0.0)

    def pair(self, timeout=1.0):
        """Newest left + right frames captured within max_pair_gap_ms; unpaired frames are dropped."""
        end = time.perf_counter() + timeout
        lefts = rights = []
        while self.running and time.perf_counter() < end:
            lefts = [f for f in self.left.recent() if f[0] > self.used[0]]
            rights = [f for f in self.right.recent() if f[0] > self.used[1]]
            best = None
            for tl, fl in lefts:
                for tr, fr in rights:
                    gap = abs(tl - tr)
                    if gap <= self.max_gap and (best is None or min(tl, tr) > min(best[0], best[2])):
                        best = (tl, fl, tr, fr, gap)
            if best:
                tl, fl, tr, fr, gap = best
                self.skipped += sum(t < tl for t, _ in lefts) + sum(t < tr for t, _ in rights)
                self.used = (tl, tr)
                self.gaps.append(gap)
                self.paired += 1
                return fl, fr, gap
            time.sleep(0.001)
        if lefts and rights:
            self.unpaired += 1  # both cameras had new frames, but never within the gap
        return None

    def stats(self):
        """(average pair gap ms, pairs made, frames skipped while busy, times no partner was found)"""
        return (1000 * float(np.mean(self.gaps)) if self.gaps else 0.0), self.paired, self.skipped, self.unpaired

    def stop(self):
        self.running = False
        self.left.stop()
        self.right.stop()


class VideoPairSource:
    """Two video files read in step (a perfect pair every time), played at real speed, looped."""

    def __init__(self, cfg):
        c = cfg.capture
        self.caps = []
        for path in (c.left_path, c.right_path):
            cap = cv2.VideoCapture(str(path))
            if not cap.isOpened():
                raise SystemExit(f"Could not open {path} (capture.source = \"video\" in settings.toml)")
            self.caps.append(cap)
        self.interval = 1.0 / (self.caps[0].get(cv2.CAP_PROP_FPS) or 30)
        self.next_t = time.perf_counter()
        self.running = True
        self.paired = 0

    def report(self):
        return [f"  video files: {cap.get(cv2.CAP_PROP_FRAME_WIDTH):g}x{cap.get(cv2.CAP_PROP_FRAME_HEIGHT):g}"
                for cap in self.caps]

    def swap(self):
        self.caps.reverse()

    def pair(self, timeout=1.0):
        time.sleep(max(0.0, self.next_t - time.perf_counter()))
        self.next_t = max(self.next_t + self.interval, time.perf_counter())
        frames = []
        for cap in self.caps:
            ok, frame = cap.read()
            if not ok:  # loop both files together
                for other in self.caps:
                    other.set(cv2.CAP_PROP_POS_FRAMES, 0)
                return self.pair(timeout)
            frames.append(frame)
        self.paired += 1
        return frames[0], frames[1], 0.0

    def stats(self):
        return 0.0, self.paired, 0, 0

    def stop(self):
        self.running = False
        for cap in self.caps:
            cap.release()


def open_stereo(cfg):
    return VideoPairSource(cfg) if cfg.capture.source == "video" else StereoSource(cfg)
