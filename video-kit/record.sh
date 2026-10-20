#!/bin/bash
# Interactive recorder. Run from a terminal that is NOT over the browser window
# (move this terminal to the right of x>1290 points). Needs Screen Recording permission.
# Per step: Enter = start the step (narration timing begins), do the actions, Enter = step done. q = stop.
KIT="$(cd "$(dirname "$0")" && pwd)"; REC="$KIT/recording"; mkdir -p "$REC"; rm -f "$REC"/*
FIFO="$REC/ctl"; mkfifo "$FIFO"
cleanup(){ [ -n "$FF" ] && { echo q > "$FIFO" 2>/dev/null; sleep 2; kill $FF 2>/dev/null; }; pkill -f "http.server 8765" 2>/dev/null; rm -f "$FIFO"; }
trap cleanup EXIT
"$KIT/serve-demo.sh" >/dev/null 2>&1 & sleep 1
# Default: your own Chrome (signed in, Keytray installed). TEST_BROWSER=1 uses the separate Chrome for Testing profile.
if [ "$TEST_BROWSER" = 1 ]; then
  PROC="Google Chrome for Testing"; "$KIT/launch-browser.sh" >/dev/null 2>&1 & sleep 6
else
  PROC="Google Chrome"
  # A fresh window in your normal profile, 1280x800 at the top left, showing only the demo page.
  osascript -e 'tell application "Google Chrome"' -e 'activate' -e 'set w to make new window' \
    -e 'set URL of active tab of w to "http://127.0.0.1:8765/"' -e 'set bounds of w to {0, 25, 1280, 825}' -e 'end tell' >/dev/null
  sleep 2
fi
# geometry in points (x y w h) of the front window
B=$(osascript -e "tell application \"System Events\" to tell (first process whose name is \"$PROC\") to get {position, size} of window 1" 2>/dev/null | tr -d ' ')
IFS=, read -r GX GY GW GH <<<"${B:-0,34,1280,800}"
# scale = capture width / desktop width in points
DW=$(osascript -e 'tell application "Finder" to get item 3 of (get bounds of window of desktop)' 2>/dev/null)
ffmpeg -loglevel error -y -f avfoundation -framerate 30 -pixel_format uyvy422 -i "2:none" -frames:v 1 "$REC/probe.png"
PW=$(ffprobe -v error -show_entries stream=width -of csv=p=0 "$REC/probe.png"); rm "$REC/probe.png"
SC=$(python3 -c "print(round($PW/${DW:-1710}))")
echo "{\"x\":$GX,\"y\":$GY,\"w\":$GW,\"h\":$GH,\"scale\":$SC}" > "$REC/geometry.json"; cat "$REC/geometry.json"
echo "Browser is up. Only this new window is recorded: hide the bookmarks bar (Cmd+Shift+B), keep it the front window, close notifications. Press Enter to begin recording."; read -r < /dev/tty
ffmpeg -loglevel error -nostats -progress "$REC/progress.txt" -y -f avfoundation -framerate 30 -capture_cursor 1 -pixel_format uyvy422 -i "2:none" \
  -c:v libx264 -preset ultrafast -crf 18 -pix_fmt yuv420p "$REC/raw.mov" < "$FIFO" &
FF=$!
exec 3>"$FIFO"
sleep 2
T0=$(date +%s.%N)
python3 - "$KIT/script.json" <<'E2' > "$REC/steps.txt"
import json,sys
for s in json.load(open(sys.argv[1])): print(s['id']+'\t'+s['instruction'])
E2
OFFSET=$(awk -F= '/out_time_us=/{v=$2} END{print v/1000000}' "$REC/progress.txt")
MARKS=""
while IFS=$'\t' read -r ID INS; do
  echo; echo "== STEP $ID =="; echo "$INS"; echo "[Enter] start step  (q = stop)"; read -r A </dev/tty; [ "$A" = q ] && break
  S=$(python3 -c "import time;print(round(time.time()-$T0+$OFFSET,3))"); say_hint="narration plays in the edit; act now"
  echo "$say_hint. [Enter] when done"; read -r A </dev/tty
  E=$(python3 -c "import time;print(round(time.time()-$T0+$OFFSET,3))")
  MARKS="$MARKS{\"id\":\"$ID\",\"start\":$S,\"end\":$E},"
  [ "$A" = q ] && break
done < "$REC/steps.txt"
echo "[${MARKS%,}]" > "$REC/marks.json"
echo q >&3; wait $FF; FF=""
echo "Saved $REC/raw.mov and marks.json. Next: $KIT/edit.sh"
