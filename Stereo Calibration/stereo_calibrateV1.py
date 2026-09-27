"""

what does each model do, run in therminal the commands this way
  python stereo_calibrate.py list                  live view of every camera index -> set CAM1_INDEX / CAM2_INDEX
  python stereo_calibrate.py board                 check the board settings below match your print
  python stereo_calibrate.py intrinsics --cam 1    lens calibration, CAM1 (board close, fill the image)
  python stereo_calibrate.py intrinsics --cam 2    lens calibration, CAM2
  python stereo_calibrate.py stereo                pair calibration (board at the blue-dot spot, seen by both)
  python stereo_calibrate.py verify                live 3D check of the result

these are the options:
  --reuse           recompute 'intrinsics' / 'stereo' from the last saved images (no new capture)
  --backend dshow   if MSMF won't open the cameras (default: msmf)

keys in the capture windows:
  (auto)    a view is taken automatically when the board is held STILL in a NEW position
  SPACE     take a view now (board must be still)
  A         auto-capture on/off
  U         undo last view
  ENTER/ C finish and calibrate (needs at least MIN_VIEWS)
  Q/ESC   quit
"""

import os
os.environ.setdefault("OPENCV_VIDEOIO_MSMF_ENABLE_HW_TRANSFORMS", "0")  # makes MSMF open much faster

import argparse
import glob
import json
import sys
import threading
import time
from datetime import datetime

import numpy as np
import cv2


CAM1_INDEX = 0          # left camera in your drawing  (find with: list)
CAM2_INDEX = 1          # right camera in your drawing
BACKEND = "msmf"        # "msmf" or "dshow"
WIDTH, HEIGHT, FPS = 1920, 1080, 30   # calibrate at the SAME resolution you will stream at

BOARD_DICT = "DICT_4X4_100"   # ArUco dictionary (the 'board' mode tells you if this is wrong)
BOARD_SQUARES_X = 7           # number of SQUARES across (count them on the print)
BOARD_SQUARES_Y = 5           # number of SQUARES down
SQUARE_MM = 40.0              # side of one chess square, MEASURED with a ruler on the print
MARKER_MM = 30.0              # side of one black ArUco marker, measured
BOARD_FIRST_ID = 0            # id of the first marker (normally 0)
BOARD_LEGACY = False          # True for boards made with old OpenCV (the 'board' mode tells you)

# Capture behaviour
MIN_VIEWS = 15          # minimum views before you can calibrate
TARGET_VIEWS = 25       # recommended number of views
MIN_CORNERS = 8         # a view needs at least this many corners (shared by both cams in 'stereo')
STILL_PX = 1.5          # board counts as still if corners move less than this (pixels/frame)
STILL_FRAMES = 8        # ...for this many frames in a row (cameras aren't synced, so hold still)
NOVELTY_PX = 60         # auto-capture only if the board moved this far from every earlier view
DISPLAY_W = 1600        # width of the preview window
DATA_DIR = "calib_data"
BACKENDS = {"msmf": cv2.CAP_MSMF, "dshow": cv2.CAP_DSHOW, "any": cv2.CAP_ANY}

def pt(p):
    return int(round(float(p[0]))), int(round(float(p[1])))


def put(img, text, y, color=(255, 255, 255), scale=0.7):
    cv2.putText(img, text, (12, y), cv2.FONT_HERSHEY_SIMPLEX, scale, (0, 0, 0), 4, cv2.LINE_AA)
    cv2.putText(img, text, (12, y), cv2.FONT_HERSHEY_SIMPLEX, scale, color, 2, cv2.LINE_AA)


def shrink(img, width):
    s = width / img.shape[1]
    return cv2.resize(img, (width, int(round(img.shape[0] * s))), interpolation=cv2.INTER_AREA), s


def save_json(path, data):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def load_json(path):
    if not os.path.exists(path):
        sys.exit(f"Missing {path}. Run the earlier calibration step first.")
    with open(path) as f:
        return json.load(f)


def new_session_dir(kind):
    path = os.path.join(DATA_DIR, kind, datetime.now().strftime("%Y%m%d_%H%M%S"))
    os.makedirs(path, exist_ok=True)
    return path


def latest_session_dir(kind):
    dirs = sorted(d for d in glob.glob(os.path.join(DATA_DIR, kind, "*")) if os.path.isdir(d))
    return dirs[-1] if dirs else None


def board_info():
    return {"dict": BOARD_DICT, "squares_x": BOARD_SQUARES_X, "squares_y": BOARD_SQUARES_Y,
            "square_mm": SQUARE_MM, "marker_mm": MARKER_MM, "first_id": BOARD_FIRST_ID,
            "legacy": BOARD_LEGACY}


# ---------------------------------------------------------------- camera
def open_camera(index, width=WIDTH, height=HEIGHT, fps=FPS, quiet=False):
    cap = cv2.VideoCapture(index, BACKENDS[BACKEND])
    if not cap.isOpened():
        cap.release()
        return None
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    cap.set(cv2.CAP_PROP_FPS, fps)
    cap.set(cv2.CAP_PROP_AUTOFOCUS, 0)      # harmless if the camera has fixed focus
    frame = None
    for _ in range(40):                      # warm-up: first frames are often black
        ok, f = cap.read()
        if ok and f is not None:
            frame = f
            if f.mean() > 2:
                break
    if frame is None:
        cap.release()
        return None
    if not quiet:
        h, w = frame.shape[:2]
        note = "" if (w, h) == (width, height) else f"   <-- WARNING: asked for {width}x{height}"
        dark = "   <-- WARNING: frames are black (try --backend dshow)" if frame.mean() <= 2 else ""
        print(f"  camera index {index}: {w}x{h}{note}{dark}")
    return cap


class Camera:
    """Reads frames in a background thread so both cameras always give their newest frame."""

    def __init__(self, index, label):
        self.label = label
        self.cap = open_camera(index)
        if self.cap is None:
            sys.exit(f"Could not open {label} (index {index}). Close FreeMoCap / other apps using it, "
                     f"check the index with 'list', or try --backend dshow.")
        self.lock = threading.Lock()
        self.frame = None
        self.running = True
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()

    def _loop(self):
        while self.running:
            ok, f = self.cap.read()
            if ok and f is not None:
                with self.lock:
                    self.frame = f
            else:
                time.sleep(0.005)

    def read(self):
        with self.lock:
            return None if self.frame is None else self.frame.copy()

    def close(self):
        self.running = False
        self.thread.join(timeout=1.0)
        self.cap.release()


def check_opencv():
    if not hasattr(cv2, "aruco") or not hasattr(cv2.aruco, "CharucoDetector"):
        sys.exit(f"OpenCV {cv2.__version__} is too old or lacks aruco. "
                 "Run: pip install --upgrade opencv-contrib-python")


def make_board(legacy):
    d = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, BOARD_DICT))
    n = (BOARD_SQUARES_X * BOARD_SQUARES_Y) // 2
    ids = np.arange(BOARD_FIRST_ID, BOARD_FIRST_ID + n, dtype=np.int32)
    board = cv2.aruco.CharucoBoard((BOARD_SQUARES_X, BOARD_SQUARES_Y), SQUARE_MM, MARKER_MM, d, ids)
    board.setLegacyPattern(legacy)
    return board


class BoardDetector:
    def __init__(self, legacy=BOARD_LEGACY):
        self.board = make_board(legacy)
        self.det = cv2.aruco.CharucoDetector(self.board)
        self.obj = np.asarray(self.board.getChessboardCorners(), np.float32).reshape(-1, 3)
        self.max_corners = (BOARD_SQUARES_X - 1) * (BOARD_SQUARES_Y - 1)

    def detect(self, img, min_corners=MIN_CORNERS):
        """Returns (ids[N] int, pts[N,2] float32) sorted by id, or None."""
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
        cc, ci, _, _ = self.det.detectBoard(gray)
        if ci is None or len(ci) < min_corners:
            return None
        ids = ci.reshape(-1).astype(int)
        pts = cc.reshape(-1, 2).astype(np.float32)
        order = np.argsort(ids)
        return ids[order], pts[order]


def common(a, b):
    ids, ia, ib = np.intersect1d(a[0], b[0], return_indices=True)
    return ids, ia, ib


def motion(prev, cur):
    """Median corner movement between two detections of the same camera."""
    if prev is None or cur is None:
        return float("inf")
    ids, ia, ib = common(prev, cur)
    if len(ids) < MIN_CORNERS:
        return float("inf")
    return float(np.median(np.linalg.norm(prev[1][ia] - cur[1][ib], axis=1)))


def displacement(a, b):
    """How different a view is from an earlier one (mean corner shift, inf if mostly different corners)."""
    if a is None or b is None:
        return float("inf")
    ids, ia, ib = common(a, b)
    if len(ids) < 0.5 * min(len(a[0]), len(b[0])):
        return float("inf")
    return float(np.mean(np.linalg.norm(a[1][ia] - b[1][ib], axis=1)))


def capture_session(cams, folder, title):
 
    det = BoardDetector()
    n = len(cams)
    accepted, paths = [], []
    prev, still = [None] * n, [0] * n
    auto, counter = True, 0
    flash_msg, flash_until = "", 0.0
    panel_w = DISPLAY_W // n if n == 2 else min(DISPLAY_W, 1280)
    cv2.namedWindow(title, cv2.WINDOW_NORMAL)

    def flash(msg):
        nonlocal flash_msg, flash_until
        flash_msg, flash_until = msg, time.time() + 1.5

    while True:
        frames = [c.read() for c in cams]
        if any(f is None for f in frames):
            if (cv2.waitKey(10) & 0xFF) in (ord("q"), 27):
                cv2.destroyWindow(title)
                return None
            continue

        dets = [det.detect(f) for f in frames]
        for k in range(n):
            m = motion(prev[k], dets[k])
            prev[k] = dets[k]
            still[k] = still[k] + 1 if m < STILL_PX else 0
        all_still = all(s >= STILL_FRAMES for s in still)

        if n == 1:
            usable = dets[0] is not None
            shared = 0 if not usable else len(dets[0][0])
        else:
            shared = len(common(dets[0], dets[1])[0]) if (dets[0] is not None and dets[1] is not None) else 0
            usable = shared >= MIN_CORNERS
        novel = usable and all(any(displacement(dets[k], acc[k]) > NOVELTY_PX for k in range(n))
                               for acc in accepted)

        key = cv2.waitKey(1) & 0xFF
        take = (auto and novel and all_still) or (key == 32 and usable and all_still)
        if key == 32 and not (usable and all_still):
            flash("Board must be visible" + (" to BOTH cameras" if n == 2 else "") + " and held still")
        if take:
            counter += 1
            names = []
            for k, f in enumerate(frames):
                p = os.path.join(folder, f"{counter:03d}_{cams[k].label}.png")
                cv2.imwrite(p, f)
                names.append(p)
            accepted.append(dets)
            paths.append(names)
            still = [0] * n
            flash(f"View {len(accepted)} captured - move to a new position/angle")
        if key == ord("u") and accepted:
            accepted.pop()
            for p in paths.pop():
                if os.path.exists(p):
                    os.remove(p)
            flash("Removed last view")
        if key == ord("a"):
            auto = not auto
        if key in (13, 10, ord("c")):
            if len(accepted) >= MIN_VIEWS:
                break
            flash(f"Need at least {MIN_VIEWS} views (have {len(accepted)})")
        if key in (ord("q"), 27):
            cv2.destroyWindow(title)
            return None

        # ---- draw
        panels = []
        for k in range(n):
            v = frames[k].copy()
            for acc in accepted:                       # coverage so far (blue dots)
                if acc[k] is not None:
                    for p in acc[k][1]:
                        cv2.circle(v, pt(p), 5, (255, 140, 0), -1)
            if dets[k] is not None:                    # current board (yellow = moving, green = still)
                col = (0, 255, 0) if still[k] >= STILL_FRAMES else (0, 220, 255)
                for p in dets[k][1]:
                    cv2.circle(v, pt(p), 9, col, 3)
            v, _ = shrink(v, panel_w)
            put(v, cams[k].label.upper(), 30, (0, 255, 255), 0.9)
            panels.append(v)
        view = np.hstack(panels)

        if not usable:
            state = ("Board not seen by BOTH cameras" if n == 2 else "No board detected") + \
                    (f" (shared corners: {shared})" if n == 2 else "")
            scol = (0, 0, 255)
        elif not all_still:
            state, scol = "Hold still...", (0, 220, 255)
        elif not novel:
            state, scol = "Move / tilt the board to a NEW position", (0, 220, 255)
        else:
            state, scol = "OK", (0, 255, 0)
        y0 = view.shape[0] - 100
        put(view, f"Views: {len(accepted)} / {TARGET_VIEWS}  (min {MIN_VIEWS})    auto-capture: "
                  f"{'ON' if auto else 'OFF'}" + (f"    shared corners: {shared}" if n == 2 else ""), y0)
        put(view, state, y0 + 30, scol)
        if time.time() < flash_until:
            put(view, flash_msg, y0 + 60, (255, 255, 0))
        elif len(accepted) >= TARGET_VIEWS:
            put(view, "Enough views - press ENTER to calibrate", y0 + 60, (0, 255, 0))
        put(view, "SPACE capture   A auto on/off   U undo   ENTER calibrate   Q quit", y0 + 90, (200, 200, 200), 0.55)
        cv2.imshow(title, view)

    cv2.destroyWindow(title)
    return len(accepted)


def view_error(obj, img, rvec, tvec, K, D):
    proj, _ = cv2.projectPoints(obj, rvec, tvec, K, D)
    return float(np.sqrt(np.mean(np.sum((proj.reshape(-1, 2) - img.reshape(-1, 2)) ** 2, axis=1))))


def coverage_fraction(img_pts, size, gx=8, gy=6):
    allp = np.vstack([p.reshape(-1, 2) for p in img_pts])
    cx = np.clip((allp[:, 0] / size[0] * gx).astype(int), 0, gx - 1)
    cy = np.clip((allp[:, 1] / size[1] * gy).astype(int), 0, gy - 1)
    return len(set(zip(cx.tolist(), cy.tolist()))) / (gx * gy)


def calibrate_intrinsics(cam_no, folder):
    det = BoardDetector()
    files = sorted(glob.glob(os.path.join(folder, f"*_cam{cam_no}.png")))
    objs, imgs, used, size = [], [], [], None
    for f in files:
        img = cv2.imread(f)
        if img is None:
            continue
        size = (img.shape[1], img.shape[0])
        d = det.detect(img)
        if d is None:
            continue
        objs.append(det.obj[d[0]])
        imgs.append(d[1].reshape(-1, 1, 2))
        used.append(f)
    print(f"\nCAM{cam_no}: {len(used)} usable views out of {len(files)} images in {folder}")
    if len(used) < 6:
        sys.exit("Not enough usable views. Capture again.")

    def run(o, i):
        rms, K, D, rv, tv = cv2.calibrateCamera(o, i, size, None, None)
        errs = np.array([view_error(o[j], i[j], rv[j], tv[j], K, D) for j in range(len(o))])
        return rms, K, D, errs

    rms, K, D, errs = run(objs, imgs)
    bad = errs > max(3 * np.median(errs), 1.0)
    if bad.any() and (len(objs) - bad.sum()) >= 8:
        print("  Dropping blurry/bad views: " + ", ".join(os.path.basename(used[j]) for j in np.where(bad)[0]))
        keep = np.where(~bad)[0]
        objs, imgs, used = [objs[j] for j in keep], [imgs[j] for j in keep], [used[j] for j in keep]
        rms, K, D, errs = run(objs, imgs)

    w, h = size
    fx, fy = K[0, 0], K[1, 1]
    hfov = np.degrees(2 * np.arctan(w / (2 * fx)))
    vfov = np.degrees(2 * np.arctan(h / (2 * fy)))
    dfov = np.degrees(2 * np.arctan(np.hypot(w / (2 * fx), h / (2 * fy))))
    cov = coverage_fraction(imgs, size)

    out = {"camera": f"cam{cam_no}", "index": CAM1_INDEX if cam_no == 1 else CAM2_INDEX,
           "image_size": [w, h], "K": K.tolist(), "dist": D.ravel().tolist(),
           "rms_px": float(rms), "views": len(used), "coverage": round(cov, 3),
           "fov_deg": {"horizontal": round(hfov, 2), "vertical": round(vfov, 2), "diagonal": round(dfov, 2)},
           "board": board_info(), "created": datetime.now().isoformat(timespec="seconds")}
    path = os.path.join(DATA_DIR, f"intrinsics_cam{cam_no}.json")
    save_json(path, out)

    verdict = "excellent" if rms < 0.5 else "good" if rms < 1.0 else "POOR - recapture (sharper, stiller views)"
    print(f"  RMS reprojection error: {rms:.3f} px  -> {verdict}")
    print(f"  fx={fx:.1f}  fy={fy:.1f}  cx={K[0, 2]:.1f}  cy={K[1, 2]:.1f}")
    print(f"  Field of view: {hfov:.1f} deg horizontal, {vfov:.1f} vertical, {dfov:.1f} diagonal")
    print(f"  Image coverage: {cov * 100:.0f}%" +
          ("  <-- low: also hold the board near the corners/edges of the image" if cov < 0.7 else ""))
    print(f"  Saved {path}")


def closest_points_between_rays(o1, d1, o2, d2):
    w0 = o1 - o2
    a, b, c = d1 @ d1, d1 @ d2, d2 @ d2
    d, e = d1 @ w0, d2 @ w0
    den = a * c - b * b
    if abs(den) < 1e-9:
        return None
    s = (b * e - c * d) / den
    t = (a * e - b * d) / den
    p1, p2 = o1 + s * d1, o2 + t * d2
    return (p1 + p2) / 2, float(np.linalg.norm(p1 - p2)), float(s), float(t)


def calibrate_stereo(folder):
    det = BoardDetector()
    i1 = load_json(os.path.join(DATA_DIR, "intrinsics_cam1.json"))
    i2 = load_json(os.path.join(DATA_DIR, "intrinsics_cam2.json"))
    K1, D1 = np.array(i1["K"]), np.array(i1["dist"]).reshape(1, -1)
    K2, D2 = np.array(i2["K"]), np.array(i2["dist"]).reshape(1, -1)

    objs, p1s, p2s, used, size = [], [], [], [], None
    files = sorted(glob.glob(os.path.join(folder, "*_cam1.png")))
    for f1 in files:
        f2 = f1[:-len("_cam1.png")] + "_cam2.png"
        a, b = cv2.imread(f1), cv2.imread(f2)
        if a is None or b is None:
            continue
        size = (a.shape[1], a.shape[0])
        d1, d2 = det.detect(a), det.detect(b)
        if d1 is None or d2 is None:
            continue
        ids, ia, ib = common(d1, d2)
        if len(ids) < MIN_CORNERS:
            continue
        objs.append(det.obj[ids])
        p1s.append(d1[1][ia].reshape(-1, 1, 2))
        p2s.append(d2[1][ib].reshape(-1, 1, 2))
        used.append(f1)
    print(f"\nStereo: {len(used)} usable pairs out of {len(files)} in {folder}")
    if len(used) < 5:
        sys.exit("Not enough usable pairs. Capture again with the board visible to both cameras.")
    if tuple(i1["image_size"]) != size or tuple(i2["image_size"]) != size:
        sys.exit(f"Image size {size} differs from the intrinsics ({i1['image_size']}, {i2['image_size']}). "
                 "Use the same WIDTH/HEIGHT for every step.")

    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 200, 1e-7)

    def pair_error(o, a, b, R, T):
        ok, rv, tv = cv2.solvePnP(o, a, K1, D1, flags=cv2.SOLVEPNP_IPPE)
        if not ok:
            return float("inf")
        R1, _ = cv2.Rodrigues(rv)
        rv2, _ = cv2.Rodrigues(R @ R1)
        tv2 = R @ tv + T.reshape(3, 1)
        return view_error(o, b, rv2, tv2, K2, D2)       # error when predicting CAM2 from CAM1

    def run(o, a, b):
        rms, _, _, _, _, R, T, E, F = cv2.stereoCalibrate(o, a, b, K1, D1, K2, D2, size,
                                                          criteria=crit, flags=cv2.CALIB_FIX_INTRINSIC)
        errs = np.array([pair_error(o[j], a[j], b[j], R, T) for j in range(len(o))])
        return rms, R, T, E, F, errs

    rms, R, T, E, F, errs = run(objs, p1s, p2s)
    bad = errs > max(3 * np.median(errs), 2.0)
    if bad.any() and (len(objs) - bad.sum()) >= 5:
        print("  Dropping inconsistent pairs (board probably moved between the two cameras): " +
              ", ".join(os.path.basename(used[j]) for j in np.where(bad)[0]))
        keep = np.where(~bad)[0]
        objs, p1s, p2s, used = ([x[j] for j in keep] for x in (objs, p1s, p2s, used))
        rms, R, T, E, F, errs = run(objs, p1s, p2s)

    T = T.reshape(3)
    baseline = float(np.linalg.norm(T))
    C2 = -R.T @ T                                  # CAM2 position in CAM1 coordinates (mm)
    z2 = R[2, :]                                   # CAM2 optical axis in CAM1 coordinates
    axis_angle = float(np.degrees(np.arccos(np.clip(R[2, 2], -1, 1))))
    conv = closest_points_between_rays(np.zeros(3), np.array([0, 0, 1.0]), C2, z2)

    out = {"image_size": list(size), "K1": K1.tolist(), "dist1": D1.ravel().tolist(),
           "K2": K2.tolist(), "dist2": D2.ravel().tolist(), "R": R.tolist(), "T": T.tolist(),
           "E": E.tolist(), "F": F.tolist(), "rms_px": float(rms), "pairs": len(used),
           "baseline_mm": round(baseline, 1), "cam2_position_in_cam1_mm": np.round(C2, 1).tolist(),
           "axis_angle_deg": round(axis_angle, 2), "board": board_info(),
           "created": datetime.now().isoformat(timespec="seconds"),
           "note": "Coordinates: CAM1 frame, x right, y down, z forward, millimetres. "
                   "X_cam2 = R @ X_cam1 + T."}
    if conv is not None:
        mid, gap, s, t = conv
        out["axes_crossing_point_mm"] = np.round(mid, 1).tolist()
        out["axes_crossing_gap_mm"] = round(gap, 1)
    path = os.path.join(DATA_DIR, "stereo_calib.json")
    save_json(path, out)

    verdict = "excellent" if rms < 0.7 else "good" if rms < 1.5 else "POOR - recapture (hold the board stiller)"
    print(f"  Stereo RMS error: {rms:.3f} px  -> {verdict}")
    print(f"  Distance between the cameras (baseline): {baseline:.0f} mm   <-- check this with a tape measure")
    print(f"  CAM2 relative to CAM1: {C2[0]:+.0f} mm right, {C2[1]:+.0f} mm down, {C2[2]:+.0f} mm forward")
    print(f"  Angle between the two viewing directions: {axis_angle:.1f} deg")
    if conv is not None:
        mid, gap, s, t = conv
        if s > 0 and t > 0:
            print(f"  The two camera axes cross {np.linalg.norm(mid) / 1000:.2f} m from CAM1 and "
                  f"{np.linalg.norm(mid - C2) / 1000:.2f} m from CAM2 (they miss each other by {gap:.0f} mm) "
                  f"- this should be near the blue-dot spot")
        else:
            print("  The camera axes do not cross in front of the rig (cameras not pointing inward?)")
    print(f"  Saved {path}")


def mode_list():
    print("Scanning camera indices 0-7 (this can take a few seconds per camera)...")
    caps = []
    for i in range(8):
        cap = open_camera(i, 1280, 720, 30, quiet=False)
        if cap is not None:
            caps.append((i, cap))
    if not caps:
        sys.exit("No cameras found. Close FreeMoCap/other apps, or try --backend dshow.")
    print("\nLive view open. Cover or wave in front of each Brio to see which index it is.")
    print("Put the LEFT camera of your drawing in CAM1_INDEX and the RIGHT one in CAM2_INDEX. Press Q to close.")
    win = "Camera indices"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)
    while True:
        tiles = []
        for i, cap in caps:
            ok, f = cap.read()
            if not ok or f is None:
                f = np.zeros((720, 1280, 3), np.uint8)
            t = cv2.resize(f, (640, 360))
            tag = ""
            if i == CAM1_INDEX:
                tag = "  = CAM1 now"
            elif i == CAM2_INDEX:
                tag = "  = CAM2 now"
            put(t, f"index {i}{tag}", 30, (0, 255, 255), 0.8)
            tiles.append(t)
        cols = 2 if len(tiles) > 1 else 1
        while len(tiles) % cols:
            tiles.append(np.zeros_like(tiles[0]))
        grid = np.vstack([np.hstack(tiles[r:r + cols]) for r in range(0, len(tiles), cols)])
        cv2.imshow(win, grid)
        if (cv2.waitKey(1) & 0xFF) in (ord("q"), 27):
            break
    for _, cap in caps:
        cap.release()
    cv2.destroyAllWindows()


def scan_dictionaries(gray):
    families = ["DICT_4X4_1000", "DICT_5X5_1000", "DICT_6X6_1000", "DICT_7X7_1000", "DICT_ARUCO_ORIGINAL"]
    results = []
    for name in families:
        d = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, name))
        ad = cv2.aruco.ArucoDetector(d, cv2.aruco.DetectorParameters())
        _, ids, _ = ad.detectMarkers(gray)
        ids = [] if ids is None else sorted(int(x) for x in ids.reshape(-1))
        results.append((name, ids))
    return results


def mode_board():
    print("Hold the WHOLE board flat in front of CAM1, well lit, filling about half the image.")
    print("SPACE = full analysis in this terminal, Q = quit.\n")
    cam = Camera(CAM1_INDEX, "cam1")
    det_cfg, det_alt = BoardDetector(BOARD_LEGACY), BoardDetector(not BOARD_LEGACY)
    win = "Board check"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)
    try:
        while True:
            f = cam.read()
            if f is None:
                cv2.waitKey(10)
                continue
            d1 = det_cfg.detect(f, min_corners=1)
            d2 = det_alt.detect(f, min_corners=1)
            n1 = 0 if d1 is None else len(d1[0])
            n2 = 0 if d2 is None else len(d2[0])
            v = f.copy()
            if d1 is not None:
                for p in d1[1]:
                    cv2.circle(v, pt(p), 9, (0, 255, 0), 3)
            v, _ = shrink(v, 1280)
            put(v, f"Corners with current settings: {n1} / {det_cfg.max_corners}", 30,
                (0, 255, 0) if n1 > 0.7 * det_cfg.max_corners else (0, 0, 255))
            put(v, f"With BOARD_LEGACY = {not BOARD_LEGACY}: {n2}", 60, (200, 200, 200))
            put(v, "SPACE: full analysis in terminal    Q: quit", 90, (200, 200, 200), 0.6)
            cv2.imshow(win, v)
            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), 27):
                break
            if key == 32:
                analyse_board(f, n1, n2)
    finally:
        cam.close()
        cv2.destroyAllWindows()


def analyse_board(frame, n_cfg, n_alt):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    res = scan_dictionaries(gray)
    print("\n================ BOARD ANALYSIS ================")
    for name, ids in res:
        print(f"  {name:22s}: {len(ids):3d} markers" + (f"  ids {ids[0]}..{ids[-1]}" if ids else ""))
    best_name, best_ids = max(res, key=lambda r: len(r[1]))
    if not best_ids:
        print("  No markers found. Better light, board flatter/closer, no glare.")
        return
    fam = best_name.rsplit("_", 1)[0]
    cfg_fam = BOARD_DICT.rsplit("_", 1)[0]
    lo, hi = best_ids[0], best_ids[-1]
    if fam != cfg_fam:
        print(f"  -> Your board uses the {fam}_* family. Set BOARD_DICT = \"{fam}_{1000 if hi >= 250 else 250 if hi >= 100 else 100 if hi >= 50 else 50}\"")
    else:
        size = int(BOARD_DICT.rsplit("_", 1)[1]) if BOARD_DICT.rsplit("_", 1)[1].isdigit() else 1024
        if hi >= size:
            print(f"  -> Marker id {hi} is too big for {BOARD_DICT}; use {cfg_fam}_1000")
        else:
            print(f"  -> BOARD_DICT = \"{BOARD_DICT}\" is correct.")
    if lo != BOARD_FIRST_ID:
        print(f"  -> Lowest marker id seen is {lo}. If the whole board is visible, set BOARD_FIRST_ID = {lo}")
    n_markers = hi - lo + 1
    cands = [(x, y) for x in range(3, 16) for y in range(3, 16) if (x * y) // 2 == n_markers and x >= y]
    expected = (BOARD_SQUARES_X * BOARD_SQUARES_Y) // 2
    if n_markers != expected:
        print(f"  -> Board seems to have {n_markers} markers but settings expect {expected}. "
              f"Possible sizes (squares, either orientation): {cands}. Count the squares on the print.")
    else:
        print(f"  -> Marker count matches {BOARD_SQUARES_X}x{BOARD_SQUARES_Y} squares.")
    if n_alt > n_cfg:
        print(f"  -> Set BOARD_LEGACY = {not BOARD_LEGACY}  ({n_alt} corners vs {n_cfg})")
    elif n_cfg > 0:
        print(f"  -> BOARD_LEGACY = {BOARD_LEGACY} is correct ({n_cfg} corners).")
    print("  Reminder: SQUARE_MM and MARKER_MM must be MEASURED on the print (printers rescale).")
    print("================================================\n")


def mode_intrinsics(cam_no, reuse):
    kind = f"intrinsics_cam{cam_no}"
    if reuse:
        folder = latest_session_dir(kind)
        if folder is None:
            sys.exit(f"No saved images for {kind}.")
    else:
        idx = CAM1_INDEX if cam_no == 1 else CAM2_INDEX
        print(f"\nLens calibration for CAM{cam_no} (index {idx}).")
        print("Hold the board 30-80 cm from the camera. Fill the image, visit the corners and edges,")
        print("and TILT the board (up to ~45 deg) in different directions. Hold still for each capture.\n")
        cam = Camera(idx, f"cam{cam_no}")
        folder = new_session_dir(kind)
        try:
            n = capture_session([cam], folder, f"Intrinsics CAM{cam_no}")
        finally:
            cam.close()
            cv2.destroyAllWindows()
        if n is None:
            sys.exit("Quit without calibrating (images kept in " + folder + ").")
    calibrate_intrinsics(cam_no, folder)


def mode_stereo(reuse):
    for c in (1, 2):
        load_json(os.path.join(DATA_DIR, f"intrinsics_cam{c}.json"))
    if reuse:
        folder = latest_session_dir("stereo")
        if folder is None:
            sys.exit("No saved stereo images.")
    else:
        print("\nStereo calibration. Stand at the blue-dot spot and hold the board so BOTH cameras see it")
        print("(face it toward the point between the cameras). Move around the whole space the person")
        print("will use: near/far, left/right, high/low, tilted. Hold still for each capture.\n")
        cam1, cam2 = Camera(CAM1_INDEX, "cam1"), Camera(CAM2_INDEX, "cam2")
        folder = new_session_dir("stereo")
        try:
            n = capture_session([cam1, cam2], folder, "Stereo CAM1 + CAM2")
        finally:
            cam1.close()
            cam2.close()
            cv2.destroyAllWindows()
        if n is None:
            sys.exit("Quit without calibrating (images kept in " + folder + ").")
    calibrate_stereo(folder)


def mode_verify():
    st = load_json(os.path.join(DATA_DIR, "stereo_calib.json"))
    K1, D1 = np.array(st["K1"]), np.array(st["dist1"])
    K2, D2 = np.array(st["K2"]), np.array(st["dist2"])
    R, T = np.array(st["R"]), np.array(st["T"]).reshape(3, 1)
    C2 = (-R.T @ T).reshape(3)
    P1 = K1 @ np.hstack([np.eye(3), np.zeros((3, 1))])
    P2 = K2 @ np.hstack([R, T])
    F = np.array(st["F"])
    rv2, _ = cv2.Rodrigues(R)
    det = BoardDetector()
    ncols = BOARD_SQUARES_X - 1

    cam1, cam2 = Camera(CAM1_INDEX, "cam1"), Camera(CAM2_INDEX, "cam2")
    win = "Verify stereo calibration"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)
    panel_w = DISPLAY_W // 2
    state = {"click": None, "scale": 1.0}

    def on_mouse(event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN and x < panel_w:
            state["click"] = (x / state["scale"], y / state["scale"])

    cv2.setMouseCallback(win, on_mouse)
    print("Hold the board where the person will be. Click any point in CAM1 (left panel):")
    print("the green curve in CAM2 must pass through the SAME point. Q to quit.")
    try:
        while True:
            f1, f2 = cam1.read(), cam2.read()
            if f1 is None or f2 is None:
                if (cv2.waitKey(10) & 0xFF) in (ord("q"), 27):
                    break
                continue
            d1, d2 = det.detect(f1, 4), det.detect(f2, 4)
            lines = []
            v1, v2 = f1.copy(), f2.copy()
            if d1 is not None and d2 is not None:
                ids, ia, ib = common(d1, d2)
                if len(ids) >= 4:
                    a, b = d1[1][ia].reshape(-1, 1, 2), d2[1][ib].reshape(-1, 1, 2)
                    u1 = cv2.undistortPoints(a, K1, D1, P=K1).reshape(-1, 2).T
                    u2 = cv2.undistortPoints(b, K2, D2, P=K2).reshape(-1, 2).T
                    X = cv2.triangulatePoints(P1, P2, u1, u2)
                    X = (X[:3] / X[3]).T
                    pos = {int(i): k for k, i in enumerate(ids)}
                    ds = []
                    for i, k in pos.items():
                        if i % ncols != ncols - 1 and (i + 1) in pos:
                            ds.append(np.linalg.norm(X[k] - X[pos[i + 1]]))
                        if (i + ncols) in pos:
                            ds.append(np.linalg.norm(X[k] - X[pos[i + ncols]]))
                    pr1, _ = cv2.projectPoints(X, np.zeros(3), np.zeros(3), K1, D1)
                    pr2, _ = cv2.projectPoints(X, rv2, T, K2, D2)
                    rep = np.sqrt(np.mean(np.concatenate([
                        np.sum((pr1.reshape(-1, 2) - a.reshape(-1, 2)) ** 2, 1),
                        np.sum((pr2.reshape(-1, 2) - b.reshape(-1, 2)) ** 2, 1)])))
                    c = X.mean(axis=0)
                    if ds:
                        m = float(np.mean(ds))
                        err = abs(m - SQUARE_MM)
                        col = (0, 255, 0) if err < 1.0 else (0, 220, 255) if err < 2.5 else (0, 0, 255)
                        lines.append((f"Square size in 3D: {m:.1f} mm (true {SQUARE_MM:.1f}) -> error {err:.1f} mm", col))
                    lines.append((f"Board: {np.linalg.norm(c) / 1000:.2f} m from CAM1, "
                                  f"{np.linalg.norm(c - C2) / 1000:.2f} m from CAM2   "
                                  f"reprojection {rep:.2f} px   ({len(ids)} shared corners)", (255, 255, 255)))
                    for p in a.reshape(-1, 2):
                        cv2.circle(v1, pt(p), 7, (0, 255, 0), 2)
                    for p in b.reshape(-1, 2):
                        cv2.circle(v2, pt(p), 7, (0, 255, 0), 2)
            if not lines:
                lines.append(("Show the board to BOTH cameras", (0, 0, 255)))

            if state["click"] is not None:                          # epipolar curve
                cx, cy = state["click"]
                cv2.drawMarker(v1, pt((cx, cy)), (0, 0, 255), cv2.MARKER_CROSS, 40, 4)
                u = cv2.undistortPoints(np.array([[[cx, cy]]], np.float32), K1, D1, P=K1).reshape(2)
                l = F @ np.array([u[0], u[1], 1.0])
                w, h = f2.shape[1], f2.shape[0]
                if abs(l[1]) > 1e-9:
                    xs = np.linspace(-0.2 * w, 1.2 * w, 200)
                    ys = -(l[0] * xs + l[2]) / l[1]
                else:
                    ys = np.linspace(-0.2 * h, 1.2 * h, 200)
                    xs = -(l[1] * ys + l[2]) / l[0]
                ideal = np.stack([xs, ys, np.ones_like(xs)], 1)
                rays = (np.linalg.inv(K2) @ ideal.T).T                 # undistorted -> distorted pixels
                curve, _ = cv2.projectPoints(rays, np.zeros(3), np.zeros(3), K2, D2)
                cv2.polylines(v2, [np.int32(curve.reshape(-1, 2))], False, (0, 255, 0), 3, cv2.LINE_AA)

            s1, s = shrink(v1, panel_w)
            s2, _ = shrink(v2, panel_w)
            state["scale"] = s
            put(s1, "CAM1 (click a point)", 30, (0, 255, 255), 0.8)
            put(s2, "CAM2", 30, (0, 255, 255), 0.8)
            view = np.hstack([s1, s2])
            y = view.shape[0] - 20 - 30 * (len(lines) - 1)
            for text, col in lines:
                put(view, text, y, col)
                y += 30
            cv2.imshow(win, view)
            if (cv2.waitKey(1) & 0xFF) in (ord("q"), 27):
                break
    finally:
        cam1.close()
        cam2.close()
        cv2.destroyAllWindows()


def main():
    global BACKEND
    ap = argparse.ArgumentParser(description="ChArUco stereo calibration for two webcams.")
    ap.add_argument("mode", choices=["list", "board", "intrinsics", "stereo", "verify"])
    ap.add_argument("--cam", type=int, choices=[1, 2], help="camera for 'intrinsics'")
    ap.add_argument("--reuse", action="store_true", help="recalibrate from the last saved images")
    ap.add_argument("--backend", choices=list(BACKENDS), default=BACKEND)
    args = ap.parse_args()
    BACKEND = args.backend
    check_opencv()
    print(f"OpenCV {cv2.__version__}, backend {BACKEND}")

    if args.mode == "list":
        mode_list()
    elif args.mode == "board":
        mode_board()
    elif args.mode == "intrinsics":
        if args.cam is None:
            sys.exit("Use: python stereo_calibrate.py intrinsics --cam 1   (then --cam 2)")
        mode_intrinsics(args.cam, args.reuse)
    elif args.mode == "stereo":
        mode_stereo(args.reuse)
    elif args.mode == "verify":
        mode_verify()


if __name__ == "__main__":
    main()



