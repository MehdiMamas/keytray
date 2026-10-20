#!/bin/bash
# Serves the demo OTP page on http://127.0.0.1:8765/ (foreground).
cd "$(dirname "$0")/demo-site" && exec python3 -m http.server 8765 --bind 127.0.0.1
