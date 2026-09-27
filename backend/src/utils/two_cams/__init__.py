"""Two-camera capture: open two cameras in parallel, start them together, hand out frame pairs.
Standalone: imports nothing from the rest of this project."""

import os

# Media Foundation opens cameras in seconds instead of 10-30+ s, and two USB webcams can
# stream together, with hardware transforms off. Must be set before OpenCV is imported.
os.environ.setdefault("OPENCV_VIDEOIO_MSMF_ENABLE_HW_TRANSFORMS", "0")
