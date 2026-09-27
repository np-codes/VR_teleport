import argparse
import signal
import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import two_cams  # noqa: E402,F401  (first: sets up fast camera opening)

import cv2  # noqa: E402
import numpy as np  # noqa: E402

from two_cams.sources import Camera  # noqa: E402

STATS_EVERY_S = 2.0
STALL_TIMEOUT_S = 5.0
TIPS = ("Try: close other apps that may use it (OBS preview, Camo, browser, Teams), plug the two cameras "
        "into different USB ports (not the same hub), keep MJPG on, or lower --width/--height.")


class StopWithError(Exception):
    """A problem that ends the program with a STATUS error line."""


def say(line):
    print(line, flush=True)


def fps(cam):
    stamps = [t for t, _ in cam.recent()]
    return (len(stamps) - 1) / (stamps[-1] - stamps[0]) if len(stamps) > 1 and stamps[-1] > stamps[0] else 0.0


def view(cam, h, started):
    """One labelled camera picture for the preview window."""
    frames = cam.recent()
    if not frames:
        img = np.zeros((h, int(h * 16 / 9), 3), np.uint8)
        msg = f"{cam.state} ({time.perf_counter() - started:.0f} s)"
    else:
        frame = frames[-1][1]
        img = cv2.resize(frame, (int(h * frame.shape[1] / frame.shape[0]), h))
        msg = f"{fps(cam):.0f} fps, brightness {frame.mean():.0f}"
    label = f"{cam.name} = index {cam.index}: {msg}"
    cv2.putText(img, label, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 4)
    cv2.putText(img, label, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
    return img


def fit(frame, width, height):
    """Make sure each eye is exactly width x height (a camera may not accept the requested size)."""
    if frame.shape[1] == width and frame.shape[0] == height:
        return frame
    return cv2.resize(frame, (width, height))


def describe(cam):
    return f"{cam.name} camera (index {cam.index})"


def parse_args():
    ap = argparse.ArgumentParser(description="Two cameras -> side-by-side frame -> OBS Virtual Camera")
    ap.add_argument("--left", "--a", type=int, default=2, help="left eye camera index (default 2)")
    ap.add_argument("--right", "--b", type=int, default=3, help="right eye camera index (default 3)")
    ap.add_argument("--width", type=int, default=1280, help="width per eye (default 1280)")
    ap.add_argument("--height", type=int, default=720, help="height per eye (default 720)")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--backend", default="dshow", choices=["dshow", "msmf", "any"])
    ap.add_argument("--mjpg", action=argparse.BooleanOptionalAction, default=True,
                    help="compressed camera video; two USB 2.0 cameras usually need it (default on)")
    ap.add_argument("--preview", action=argparse.BooleanOptionalAction, default=False,
                    help="show an OpenCV window (default off)")
    ap.add_argument("--vcam", action=argparse.BooleanOptionalAction, default=True,
                    help="send the frame to OBS Virtual Camera (default on)")
    ap.add_argument("--open-timeout", type=float, default=10, help="seconds to wait for both cameras")
    return ap.parse_args()


def install_stop_handlers(stop):
    """Ctrl+C, termination signals and (when started by another program) stdin closing all set `stop`."""
    def handle_signal(*_):
        stop.set()

    for name in ("SIGINT", "SIGTERM", "SIGBREAK"):
        if hasattr(signal, name):
            signal.signal(getattr(signal, name), handle_signal)

    if sys.stdin is not None and not sys.stdin.isatty():
        def watch_stdin():
            try:
                while sys.stdin.readline():
                    pass
            except (OSError, ValueError):
                pass
            stop.set()

        threading.Thread(target=watch_stdin, daemon=True).start()


def wait_for_both(cams, args, stop, started):
    """Waits until both cameras deliver frames; raises StopWithError naming the camera that failed."""
    deadline = started + args.open_timeout
    while not stop.is_set() and not all(cam.count for cam in cams):
        failed = [cam for cam in cams if cam.state == "could not open"]
        if failed:
            names = " and ".join(describe(cam) for cam in failed)
            raise StopWithError(f"The {names} could not be opened. {TIPS}")
        if time.perf_counter() > deadline:
            silent = [cam for cam in cams if not cam.count]
            names = " and ".join(f"{describe(cam)}: {cam.state}" for cam in silent)
            raise StopWithError(f"No frames within {args.open_timeout:g} s from the {names}. {TIPS}")
        if args.preview:
            shown = np.hstack([np.zeros((360, 640, 3), np.uint8) for _ in cams])
            for i, cam in enumerate(cams):
                cv2.putText(shown, f"{cam.name} = index {cam.index}: {cam.state}", (10 + 640 * i, 30),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 200, 255), 2)
            cv2.imshow("Two cameras (q = quit)", shown)
            if cv2.waitKey(30) & 0xFF == ord("q"):
                stop.set()
        else:
            stop.wait(0.03)


def open_virtual_camera(width, height, fps_value):
    try:
        import pyvirtualcam
    except ImportError:
        raise StopWithError("pyvirtualcam is not installed in this Python. Run: pip install -r requirements.txt")
    try:
        return pyvirtualcam.Camera(width, height, fps_value, fmt=pyvirtualcam.PixelFormat.BGR, backend="obs")
    except Exception as error:  # pyvirtualcam raises RuntimeError with a helpful text
        raise StopWithError(f"Could not start OBS Virtual Camera ({error}). Install OBS Studio and make sure "
                            "OBS's own 'Start Virtual Camera' button is OFF.")


def main():
    args = parse_args()
    stop = threading.Event()
    install_stop_handlers(stop)

    say("STATUS starting")
    settings = SimpleNamespace(backend=args.backend, width=args.width, height=args.height, fps=args.fps,
                               mjpg=args.mjpg, lock_exposure=False, lock_white_balance=False,
                               lock_focus=False, open_timeout_s=args.open_timeout)
    say(f"Opening left index {args.left} and right index {args.right} together ({args.backend}, "
        f"MJPG {args.mjpg}, {args.width}x{args.height} @ {args.fps})...")
    started = time.perf_counter()
    gate = threading.Barrier(2)
    cams = [Camera("left", args.left, settings, gate), Camera("right", args.right, settings, gate)]
    vcam = None
    exit_code = 0
    out_w, out_h = args.width * 2, args.height

    try:
        wait_for_both(cams, args, stop, started)
        if stop.is_set():
            return
        say(f"Both streaming after {time.perf_counter() - started:.1f} s.")
        for cam in cams:
            say(f"  {cam.name} = index {cam.index}: {cam.info}")

        if args.vcam:
            vcam = open_virtual_camera(out_w, out_h, args.fps)
            say(f"Sending to {vcam.device}")
        say(f"STATUS ready {out_w}x{out_h} {args.fps}")

        sent, gaps = 0, []
        last_stats = time.perf_counter()
        last_stamp = [0.0, 0.0]
        last_new = [time.perf_counter(), time.perf_counter()]
        while not stop.is_set():
            now = time.perf_counter()
            newest = [cam.recent()[-1] for cam in cams]

            # A camera that stops delivering new frames (unplugged, USB trouble) ends the program.
            for i, (stamp, _) in enumerate(newest):
                if stamp != last_stamp[i]:
                    last_stamp[i], last_new[i] = stamp, now
                elif now - last_new[i] > STALL_TIMEOUT_S:
                    raise StopWithError(f"The {describe(cams[i])} stopped sending frames "
                                        f"({cams[i].state}). {TIPS}")

            (t_left, left), (t_right, right) = newest
            frame = np.hstack([fit(left, args.width, args.height), fit(right, args.width, args.height)])
            gaps.append(abs(t_left - t_right))

            if vcam:
                vcam.send(frame)
            sent += 1

            if args.preview:
                cv2.imshow("Two cameras (q = quit)", np.hstack([view(cam, 360, started) for cam in cams]))
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    stop.set()

            if now - last_stats >= STATS_EVERY_S:
                gap_ms = 1000 * sum(gaps) / len(gaps) if gaps else 0.0
                say(f"STATS fps={sent / (now - last_stats):.1f} gap_ms={gap_ms:.1f}")
                sent, gaps, last_stats = 0, [], now

            if vcam:
                vcam.sleep_until_next_frame()
            else:
                stop.wait(1 / args.fps)
    except StopWithError as error:
        say(f"STATUS error {error}")
        exit_code = 1
    finally:
        for cam in cams:
            cam.stop()
        if vcam:
            vcam.close()
        if args.preview:
            cv2.destroyAllWindows()
        say("STATUS stopped")
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
