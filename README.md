# Screenshot PNG

A lossless JavaScript encoder for 8-bit RGBA screenshots. It tests grayscale, indexed color and direct color, and keeps the smallest complete PNG it produces. It preserves all four channels, including the RGB values of fully transparent pixels.

Run `node main.ts` on Node.js 22.18 or later. The program reads one `image.png` from every subdirectory under `MAKEFUN_INPUT_DIR` and writes the same name and subdirectory under `MAKEFUN_OUTPUT_DIR`. Those directories default to `/input` and `/output`.

## Encoding

The encoder compares grayscale, indexed and direct-color representations. It ranks row filters and strips with Node's zlib, then tests small changes to a strip with the nearby scanlines on both sides. A JavaScript implementation of libdeflate's level-12 parser compresses one selected layout per screenshot.

A second parser builds independent match indices from three-byte prefixes, longer contexts and run boundaries, and tests distances aligned with earlier scanlines. It chooses literals and matches using each block's Huffman prices. It can vary block boundaries, build length-limited trees with package-merge and shorten repeat instructions in their headers. Raw plane length and compressed size set the search budget. Dense streams use block or header changes only.

The bundled libdeflate JavaScript was generated from the MIT-licensed upstream implementation. Its license is in `vendor/COPYING`. The source and build recipe are public. [Upstream libdeflate](https://github.com/ebiggers/libdeflate/tree/96836d7d9d10e3e0d53e6edb54eb908514e336c4) · [Compiler invocation and build script](https://github.com/AtticKnight/screenshot-png/blob/581504201bc18ca451698597c7aff183d94f6815/build/compile.sh)

## Verification

The normal entry point ran twice on each of five sets on Node 22.18 with one CPU. The official decoder recovered every RGBA pixel in all 40 screenshots. The two outputs for each set were byte-identical.

| Eight-image set | Output bytes | Score | Run times (seconds) |
| --- | ---: | ---: | --- |
| Published practice | 483,199 | 793,311 | 35.24, 34.90 |
| Independent draw 3 | 1,283,305 | 776,702 | 36.53, 36.55 |
| Independent draw 4 | 1,823,643 | 781,758 | 36.86, 36.02 |
| Independent draw 5 | 779,540 | 790,774 | 44.39, 43.61 |
| Independent draw 6 | 700,071 | 783,429 | 37.72, 37.57 |

The competition's Docker grader independently scored all eight practice screenshots at 793,311. [Official Docker grade](https://github.com/AtticKnight/screenshot-png/actions/runs/46055055784/job/140695401716) · [Five-set benchmark](https://github.com/AtticKnight/screenshot-png/actions/runs/46054384995)

I developed and tested the image representation, predictor selection, DEFLATE reparser and integration with OpenAI Codex for make.fun’s screenshot challenge. [Bounty](https://make.fun/bounty/png-squeeze-01-run-20261127)
