#!/bin/bash
# Renders each narration with macOS `say` (voice Samantha) -> voice/step-<id>.{aiff,m4a,wav} and voice/durations.json
set -euo pipefail
KIT="$(cd "$(dirname "$0")" && pwd)"; cd "$KIT"
VOICE="${VOICE:-Samantha}"; RATE="${RATE:-170}"
mkdir -p voice
python3 - "$VOICE" "$RATE" <<'PY'
import json,subprocess,sys
voice,rate=sys.argv[1],sys.argv[2]
dur={}
for s in json.load(open('script.json')):
    i=s['id']; a=f'voice/step-{i}.aiff'
    subprocess.run(['say','-v',voice,'-r',rate,'-o',a,s['narration']],check=True)
    subprocess.run(['ffmpeg','-loglevel','error','-y','-i',a,'-ar','48000','-ac','1','-c:a','aac','-b:a','128k',f'voice/step-{i}.m4a'],check=True)
    subprocess.run(['ffmpeg','-loglevel','error','-y','-i',a,'-ar','48000','-ac','1',f'voice/step-{i}.wav'],check=True)
    d=subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f'voice/step-{i}.wav']).decode().strip()
    dur[i]=round(float(d),3); print(i,dur[i])
json.dump(dur,open('voice/durations.json','w'),indent=2)
print('total',round(sum(dur.values()),1),'s')
PY
