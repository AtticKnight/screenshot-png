# Screenshot PNG

A lossless JavaScript encoder for 8-bit RGBA screenshots. It tests grayscale, indexed color and direct color, and keeps the smallest complete PNG it produces. It preserves all four channels, including the RGB values of fully transparent pixels.

Run `node main.ts` on Node.js 22.18 or later. The program reads one `image.png` from every subdirectory under `MAKEFUN_INPUT_DIR` and writes the same name and subdirectory under `MAKEFUN_OUTPUT_DIR`. Those directories default to `/input` and `/output`.

## Encoding

The encoder compares fixed PNG row filters, two row-by-row predictors, and strips selected against a dictionary of preceding scanlines. For grayscale, it also tests one-row strips with a full 32 KiB dictionary. For direct color, it tests two- or sixteen-row strips according to the measured compression density. Node's built-in zlib ranks these filtered streams. A JavaScript implementation of libdeflate's level-12 parser then compresses the two shortest candidates.

The released compressor is a self-contained JavaScript module generated from libdeflate. It runs as JavaScript when WebAssembly is unavailable. The MIT license is included in `vendor/COPYING`. The exact upstream source and build recipe are public. [Upstream libdeflate](https://github.com/ebiggers/libdeflate/tree/96836d7d9d10e3e0d53e6edb54eb908514e336c4) · [Rebuild instructions and compiler invocation](https://github.com/AtticKnight/screenshot-png/blob/581504201bc18ca451698597c7aff183d94f6815/build/compile.sh)

## Verification

Fifteen compressor round trips passed with WebAssembly disabled in Node. Four fresh executions of the normal entry point compared every decoded RGBA pixel and checked repeated output byte for byte. On the published practice set the encoder produced 491,873 bytes and scored 779,849 in 46.86 and 45.61 seconds. On an independently seeded set it produced 1,287,221 bytes and scored 766,834 in 52.72 and 52.98 seconds. Both sets contained eight screenshots. [Verification job](https://github.com/AtticKnight/screenshot-png/actions/runs/46012982568/job/140552905529)

I developed and tested the image representation, predictor selection and integration with OpenAI Codex for the [make.fun screenshot challenge](https://make.fun/bounty/png-squeeze-01-run-20261127).
