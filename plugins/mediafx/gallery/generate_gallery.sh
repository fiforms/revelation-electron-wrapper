#!/bin/bash

rm -f bigwaves.mp4 bigwaves.jpg
../../../bin/effectgenerator --width 1920 --height 1080 --fps 30 --fade 0 --crf 23 --duration 20 --background-image demo_base.jpg --warmup 0 --max-fade 1 --effect waves --warmup 9 --output - | ffmpeg -f rawvideo -pix_fmt rgb24 -s 1920x1080 -r 30 -i - -vf "scale=960:540" -c:v libx264 -crf 32 -movflags faststart bigwaves.mp4
ffmpeg -i bigwaves.mp4 -ss 00:00:10 -vframes 1 bigwaves.jpg

rm -f fireworks.mp4 fireworks.jpg
../../../bin/effectgenerator --width 1920 --height 1080 --fps 30 --fade 3 --crf 23 --duration 15 --background-image demo_base.jpg --warmup 0 --max-fade 1 --effect fireworks --ground-fire --ground-fire-rate 10 --ground-fire-color '#F5EAA3' --output - | ffmpeg -f rawvideo -pix_fmt rgb24 -s 1920x1080 -r 30 -i - -vf "scale=960:540" -c:v libx264 -crf 32 -movflags faststart fireworks.mp4
ffmpeg -i fireworks.mp4 -ss 00:00:10 -vframes 1 fireworks.jpg