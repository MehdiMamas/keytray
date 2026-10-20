#!/bin/bash
# Builds final/keytray-oauth-demo.mp4 from recording/raw.mov + marks.json + voice/ + blur.json.
# Blur boxes (blur.json, at least 40x40) are in the 1280x800 output frame; start/end are seconds inside the step.
set -e
KIT="$(cd "$(dirname "$0")" && pwd)"; REC="${REC:-$KIT/recording}"; OUT="$KIT/final"; W=work
mkdir -p "$OUT" "$REC/$W"; rm -rf "$OUT/frames"; mkdir -p "$OUT/frames"
export KIT REC OUT W
python3 - <<'PY'
import json,os,subprocess
KIT,REC,OUT,W=[os.environ[k] for k in("KIT","REC","OUT","W")]
g=json.load(open(f"{REC}/geometry.json")); marks=json.load(open(f"{REC}/marks.json"))
dur=json.load(open(f"{KIT}/voice/durations.json")); script={s['id']:s for s in json.load(open(f"{KIT}/script.json"))}
blur=json.load(open(f"{KIT}/blur.json"))
sc=g['scale']; cw,ch,cx,cy=[int(round(v*sc)) for v in (g['w'],g['h'],g['x'],g['y'])]
cw-=cw%2; ch-=ch%2
parts=[];t=0.0;cues=[]
for m in marks:
    i=m['id'];n=dur[i]+0.4;clip=m['end']-m['start']
    # clip longer than narration: speed up at most 2x, else keep; shorter: freeze last frame
    sp=1.0
    if clip>n: sp=min(2.0,clip/n)
    eff=clip/sp; total=max(n,eff); pad=max(0,total-eff)
    f=f"crop={cw}:{ch}:{cx}:{cy},scale=1280:800,setsar=1,fps=30,setpts=PTS/{sp},tpad=stop_mode=clone:stop_duration={pad+0.1:.3f}"
    lab="[v]"; chain=f"[0:v]{f}[b0]"; cur="b0";k=0
    for b in blur:
        if b['step']!=i: continue
        k+=1; en=""
        if 'start' in b or 'end' in b: en=f":enable='between(t,{b.get('start',0)},{b.get('end',9999)})'"
        chain+=f";[{cur}]split[a{k}][c{k}];[c{k}]crop={b['w']}:{b['h']}:{b['x']}:{b['y']},boxblur=8:3[bl{k}];[a{k}][bl{k}]overlay={b['x']}:{b['y']}{en}[b{k}]"; cur=f"b{k}"
    chain+=f";[{cur}]format=yuv420p[v]"
    out=f"{REC}/{W}/{i}.mp4"
    cmd=["ffmpeg","-loglevel","error","-y","-ss",str(m['start']),"-t",str(clip),"-i",f"{REC}/raw.mov","-i",f"{KIT}/voice/step-{i}.wav",
      "-filter_complex",chain+f";[1:a]adelay=200|200,apad,aresample=48000[a]","-map","[v]","-map","[a]","-t",f"{total:.3f}",
      "-c:v","libx264","-preset","fast","-crf","18","-r","30","-c:a","aac","-b:a","160k",out]
    subprocess.check_call(cmd)
    # cues: ~6s, <=2 lines
    text=script[i].get('subtitle') or script[i]['narration']
    words=text.split();chunks=[];cur=[]
    for w in words:
        cur.append(w)
        if len(' '.join(cur))>70 and len(chunks)%1==0: chunks.append(' '.join(cur));cur=[]
    if cur: chunks.append(' '.join(cur))
    # group 2 lines per cue
    cs=[chunks[j:j+2] for j in range(0,len(chunks),2)]
    L=sum(len(' '.join(c)) for c in cs) or 1; tt=t+0.2
    for c in cs:
        d=dur[i]*len(' '.join(c))/L; cues.append((tt,tt+d,'\n'.join(c))); tt+=d
    parts.append(out); t+=total
def ts(x):
    h=int(x//3600);m=int(x%3600//60);s=x%60
    return f"{h:02}:{m:02}:{int(s):02},{int(round((s-int(s))*1000)):03}"
with open(f"{OUT}/subtitles.srt","w") as f:
    for n,(a,b,tx) in enumerate(cues,1): f.write(f"{n}\n{ts(a)} --> {ts(b-0.02)}\n{tx}\n\n")
open(f"{REC}/{W}/list.txt","w").write(''.join(f"file '{p}'\n" for p in parts))
PY
cd "$OUT"
ffmpeg -loglevel error -y -f concat -safe 0 -i "$REC/$W/list.txt" -c copy "$REC/$W/joined.mp4"
ffmpeg -loglevel error -y -i "$REC/$W/joined.mp4" \
  -vf "subtitles=subtitles.srt:force_style='FontName=Helvetica,FontSize=9,Outline=1,Shadow=0,MarginV=12'" \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart keytray-oauth-demo.mp4
ffmpeg -loglevel error -y -i keytray-oauth-demo.mp4 -vf fps=1 frames/f_%03d.png
echo "Done: $OUT/keytray-oauth-demo.mp4  (review frames in $OUT/frames for leaks)"
