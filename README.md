# Screenshot PNG

A lossless JavaScript encoder for 8-bit RGBA screenshots. It tests grayscale, indexed color and direct color, and keeps the smallest complete PNG it produces. It preserves all four channels, including the RGB values of fully transparent pixels.

Run `node main.ts` on Node.js 22.18 or later. The program reads one `image.png` from every subdirectory under `MAKEFUN_INPUT_DIR` and writes the same name and subdirectory under `MAKEFUN_OUTPUT_DIR`. Those directories default to `/input` and `/output`.

## Encoding

The encoder compares grayscale, indexed and direct-color representations. It ranks row filters and strips with Node's zlib, then tests small changes to a strip with the nearby scanlines on both sides. A JavaScript implementation of libdeflate's level-12 parser compresses one selected layout per screenshot.

A second parser builds independent match indices from three-byte prefixes, longer contexts and run boundaries, and tests distances aligned with earlier scanlines. It chooses literals and matches using each block's Huffman prices. It can vary block boundaries, build length-limited trees with package-merge and shorten repeat instructions in their headers. The block search combines proposed cuts under exact coding costs and retains the original tokens when they cost fewer bits. Raw plane length and compressed size set the search budget. Dense streams use block or header changes only.

The bundled libdeflate JavaScript was generated from the MIT-licensed upstream implementation. Its license is in `vendor/COPYING`. The source and build recipe are public. [Upstream libdeflate](https://github.com/ebiggers/libdeflate/tree/96836d7d9d10e3e0d53e6edb54eb908514e336c4) · [Compiler invocation and build script](https://github.com/AtticKnight/screenshot-png/blob/581504201bc18ca451698597c7aff183d94f6815/build/compile.sh)

## Verification

The normal entry point ran twice on each of five sets on Node 22.18 with one CPU. The official decoder recovered every RGBA pixel in all 40 screenshots. The two outputs for each set were byte-identical.

| Eight-image set | Output bytes | Score | Run times (seconds) |
| --- | ---: | ---: | --- |
| Published practice | 482,073 | 794,135 | 47.02, 46.62 |
| Independent draw 3 | 1,283,199 | 776,989 | 47.08, 47.66 |
| Independent draw 4 | 1,823,528 | 782,321 | 46.94, 46.01 |
| Independent draw 5 | 779,207 | 791,388 | 34.65, 33.57 |
| Independent draw 6 | 699,911 | 784,024 | 29.88, 28.43 |

The competition's Docker grader independently scored all eight practice screenshots at 794,135. [Official Docker grade](https://github.com/AtticKnight/screenshot-png/actions/runs/46057273875/job/140702698412) · [Five-set benchmark](https://github.com/AtticKnight/screenshot-png/actions/runs/46057273875)

I developed and tested the image representation, predictor selection, DEFLATE reparser and integration with OpenAI Codex for make.fun’s screenshot challenge. [Bounty](https://make.fun/bounty/png-squeeze-01-run-20261127)
