# Screenshot PNG

A lossless JavaScript encoder for 8-bit RGBA screenshots. It tests grayscale, indexed color and direct color, and keeps the smallest complete PNG it produces. It preserves all four channels, including the RGB values of fully transparent pixels.

Run `node main.ts` on Node.js 22.18 or later. The program reads one `image.png` from every subdirectory under `MAKEFUN_INPUT_DIR` and writes the same name and subdirectory under `MAKEFUN_OUTPUT_DIR`. Those directories default to `/input` and `/output`.

## Encoding

The encoder compares grayscale, indexed and direct-color representations. It ranks row filters and strips with Node's zlib, then tests small changes to a strip with the nearby scanlines on both sides. A JavaScript implementation of libdeflate's level-12 parser compresses one selected layout per screenshot.

A second parser recovers the LZ77 matches from several compressed representations of the same input. It searches alternative match starts and distances and chooses a path using the cost of the literals, distances and length codes. It can also move block boundaries, build length-limited Huffman trees with package-merge and shorten the repeat instructions in their headers. Dense images use a smaller search budget. The parser caps hash-chain probes and additional match positions per image.

The bundled libdeflate JavaScript was generated from the MIT-licensed upstream implementation. Its license is in `vendor/COPYING`. The source and build recipe are public. [Upstream libdeflate](https://github.com/ebiggers/libdeflate/tree/96836d7d9d10e3e0d53e6edb54eb908514e336c4) · [Compiler invocation and build script](https://github.com/AtticKnight/screenshot-png/blob/581504201bc18ca451698597c7aff183d94f6815/build/compile.sh)

## Verification

The normal entry point ran twice on each of four sets on Node 22.18 with one CPU. On every run the official decoder recovered all RGBA pixels. Repeated output was byte-identical for all 32 screenshots.

| Eight-image set | Output bytes | Score | Run times (seconds) |
| --- | ---: | ---: | --- |
| Published practice | 484,904 | 790,395 | 38.65, 38.57 |
| Independent draw 3 | 1,282,969 | 774,435 | 39.75, 38.99 |
| Independent draw 4 | 1,825,667 | 779,468 | 40.73, 40.29 |
| Independent draw 5 | 780,799 | 787,954 | 29.11, 28.72 |

The same workflow ran 15 compressor round trips and 100 recompression round trips with WebAssembly disabled. [All verification jobs](https://github.com/AtticKnight/screenshot-png/actions/runs/46032371841)

I developed and tested the image representation, predictor selection, DEFLATE reparser and integration with OpenAI Codex for the [make.fun screenshot challenge](https://make.fun/bounty/png-squeeze-01-run-20261127).
