Keytray OAuth demo video kit
1. ./record.sh      (terminal must sit outside the browser window, e.g. right of x>1290 pts; needs Screen Recording permission)
   It opens a new 1280x800 window in your normal Chrome (already signed in, Keytray installed and logged in)
   and records only that window. Hide the bookmarks bar (Cmd+Shift+B) and keep other windows off it.
   Enter starts/ends each step; q stops. TEST_BROWSER=1 ./record.sh uses the separate test profile instead.
2. Edit blur.json (see blur.example.json) to hide anything private, then ./edit.sh
3. Review final/frames/*.png for leaks, then upload final/keytray-oauth-demo.mp4 (unlisted).
Fallback if Google blocks sign-in in Chrome for Testing: in branded Chrome use a NEW profile,
open chrome://extensions, enable Developer mode, Load unpacked -> ../.output/chrome-mv3
(same id kfkmcgkbicdmgdodjjindmnpofbcmoji), then record with record.sh using that window
(set the process name in record.sh osascript line to "Google Chrome").
Privacy: first sync reads the last day of mail; use a clean Gmail account or blur the popup list.
