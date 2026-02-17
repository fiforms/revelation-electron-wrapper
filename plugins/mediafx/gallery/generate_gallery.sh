#!/bin/bash

rm -f waves_big.mp4 waves_big.jpg
../../../bin/effectgenerator --width 1920 --height 1080 --fps 30 --fade 0 --crf 23 --duration 20 --background-image demo_base.jpg --effect waves --warmup 9 --output - | ffmpeg -f rawvideo -pix_fmt rgb24 -s 1920x1080 -r 30 -i - -vf "scale=960:540" -c:v libx264 -crf 32 -movflags faststart waves_big.mp4
ffmpeg -i waves_big.mp4 -ss 00:00:10 -vframes 1 waves_big.jpg

rm -f fireworks.mp4 fireworks.jpg
../../../bin/effectgenerator --width 1920 --height 1080 --fps 30 --fade 3 --crf 23 --duration 15 --background-image demo_base.jpg --effect fireworks --ground-fire --ground-fire-rate 10 --ground-fire-color '#F5EAA3' --output - | ffmpeg -f rawvideo -pix_fmt rgb24 -s 1920x1080 -r 30 -i - -vf "scale=960:540" -c:v libx264 -crf 32 -movflags faststart fireworks.mp4
ffmpeg -i fireworks.mp4 -ss 00:00:10 -vframes 1 fireworks.jpg

rm -f waves_subtle.mp4 waves_subtle.jpg
../../../bin/effectgenerator --width 1920 --height 1080 --fps 30 --fade 0 --crf 23 --duration 20 --background-image demo_base.jpg --effect waves --warmup 9 --sources 1 --spawn-prob 0.03 --amplitude 0.1 --frequency 0.01 --speed 0.3 --direction downleft --light-angle 45 --light-intensity 0.2 --output - | ffmpeg -f rawvideo -pix_fmt rgb24 -s 1920x1080 -r 30 -i - -vf "scale=960:540" -c:v libx264 -crf 32 -movflags faststart waves_subtle.mp4
ffmpeg -i waves_subtle.mp4 -ss 00:00:10 -vframes 1 waves_subtle.jpg

rm -f flames_candles.mp4 flames_candles.jpg
../../../bin/effectgenerator --width 1920 --height 1080 --fps 30 --fade 0 --crf 23 --duration 20 --background-image demo_base.jpg --warmup 5 --effect flame --preset candle --sources '897,795,1.2;175,880,1.0;1740,980,1.6' --effect loopfade --output - | ffmpeg -f rawvideo -pix_fmt rgb24 -s 1920x1080 -r 30 -i - -vf "scale=960:540" -c:v libx264 -crf 32 -movflags faststart flames_candles.mp4
ffmpeg -i flames_candles.mp4 -ss 00:00:10 -vframes 1 flames_candles.jpg

rm -f snowflake.mp4 snowflake.jpg
../../../bin/effectgenerator --width 1920 --height 1080 --fps 30 --fade 2 --crf 23 --duration 30 --background-image demo_base.jpg --warmup 0 --max-fade 1 --effect snowflake --brightness 0.8 --flakes 250 --size-var 1.6 --motion-x -0.6 --motion-y 1.9 --size-bias 4 --size 2 --min-size 0.2 --randomness 1.5 --softness 3 --output - | ffmpeg -f rawvideo -pix_fmt rgb24 -s 1920x1080 -r 30 -i - -vf "scale=960:540" -c:v libx264 -crf 32 -movflags faststart snowflake.mp4
ffmpeg -i snowflake.mp4 -ss 00:00:10 -vframes 1 snowflake.jpg