#!/usr/bin/env bash
# Rebuilds every hero/poster/support asset in public/media from the sources in
# media/source. Requires ffmpeg with libx264, libsvtav1, libaom and libwebp.
#
# To swap in a true AI-generated hero clip later (e.g. from Higgsfield), pass it
# as HERO_VIDEO=path/to/clip.mp4 — it replaces the still-image camera drift but
# keeps the same encodes, posters and file names, so no code changes are needed.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=media/source; OUT=public/media; TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"
N=360  # 12 s at 30 fps; the drift is one full sine period, so the loop is seamless
ZP="zoompan=z='1.07+0.035*sin(2*PI*on/$N)':x='iw/2-(iw/zoom/2)+iw*0.012*sin(2*PI*on/$N)':y='ih/2-(ih/zoom/2)+ih*0.008*cos(2*PI*on/$N)':d=1:fps=30"

if [[ -n "${HERO_VIDEO:-}" ]]; then
  ffmpeg -v error -y -i "$HERO_VIDEO" -an -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,format=yuv420p" -c:v libx264 -crf 10 -preset veryfast "$TMP/desktop.mp4"
  ffmpeg -v error -y -i "$HERO_VIDEO" -an -vf "scale=-2:1920,crop=1080:1920,format=yuv420p" -c:v libx264 -crf 10 -preset veryfast "$TMP/mobile.mp4"
else
  ffmpeg -v error -y -loop 1 -framerate 30 -t 12 -i "$SRC/hero-src.jpg" -vf "scale=5376:-2:flags=lanczos,${ZP}:s=1920x1080,format=yuv420p" -frames:v $N -c:v libx264 -crf 10 -preset veryfast "$TMP/desktop.mp4"
  # Mobile 9:16 crop, centred right of middle to keep the fiber burst + homes
  ffmpeg -v error -y -loop 1 -framerate 30 -t 12 -i "$SRC/hero-src.jpg" -vf "crop=856:1520:1572:0,scale=2160:-2:flags=lanczos,${ZP}:s=1080x1920,format=yuv420p" -frames:v $N -c:v libx264 -crf 10 -preset veryfast "$TMP/mobile.mp4"
fi

enc() { # master scale name h264crf maxrate bufsize av1crf
  ffmpeg -v error -y -i "$1" -vf "scale=$2:flags=lanczos" -an -c:v libx264 -profile:v high -preset slower -crf "$4" -maxrate "$5" -bufsize "$6" -pix_fmt yuv420p -g 60 -movflags +faststart "$OUT/$3.mp4"
  ffmpeg -v error -y -i "$1" -vf "scale=$2:flags=lanczos" -an -c:v libsvtav1 -preset 5 -crf "$7" -pix_fmt yuv420p -g 120 -movflags +faststart "$OUT/$3.av1.mp4"
}
enc "$TMP/desktop.mp4" 1920:1080 hero-1080 26 3M 6M 40
enc "$TMP/desktop.mp4" 1280:720 hero-720 26 1.6M 3.2M 40
enc "$TMP/mobile.mp4" 720:1280 hero-mobile 27 1.4M 2.8M 41

still() { # input scale name avifcrf webpq
  ffmpeg -v error -y -i "$1" -vf "select=eq(n\,0),scale=$2:flags=lanczos" -frames:v 1 "$TMP/p.png"
  ffmpeg -v error -y -i "$TMP/p.png" -c:v libaom-av1 -still-picture 1 -crf "$4" -cpu-used 3 "$OUT/$3.avif"
  ffmpeg -v error -y -i "$TMP/p.png" -c:v libwebp -quality "$5" "$OUT/$3.webp"
  ffmpeg -v error -y -i "$TMP/p.png" -q:v 6 "$OUT/$3.jpg"
}
# Posters = frame 0 of each video, so the fade to video never jumps
still "$TMP/desktop.mp4" 1920:1080 poster-1920 44 60
still "$TMP/desktop.mp4" 1280:720 poster-1280 44 60
still "$TMP/desktop.mp4" 768:432 poster-768 44 60
still "$TMP/mobile.mp4" 720:1280 poster-mobile 44 60
still "$TMP/mobile.mp4" 480:854 poster-mobile-480 44 60
for w in 640 960 1400; do still "$SRC/home-src.jpg" "$w:-2" "home-$w" 40 66; done
echo "Media rebuilt in $OUT"; ls -la "$OUT"
