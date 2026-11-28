# Screenshot PNG

A lossless JavaScript encoder for 8-bit RGBA screenshots. It tests grayscale, indexed color and direct color, and keeps the smallest complete PNG it produces. It preserves all four channels, including the RGB values of fully transparent pixels.

Run `node main.ts` on Node.js 22.18 or later. The program reads one `image.png` from every subdirectory under `MAKEFUN_INPUT_DIR` and writes the same name and subdirectory under `MAKEFUN_OUTPUT_DIR`. Those directories default to `/input` and `/output`.

## Encoding

The encoder ranks row and strip filters with Node's zlib. On flat or single-channel images it also retains two different filter choices across successive bands. It can move a boundary toward a change in vertical detail. It also revisits individual high-cost rows in smaller images. The encoder chooses one layout per image from the zlib previews and compresses it with libdeflate at level 12.

A second DEFLATE parser compares literals with matches from short prefixes, longer contexts, run boundaries and earlier scanlines. It also tests displacements that recur in the same block. A second pass blends the measured symbol frequencies with their Huffman lengths. For inputs larger than 1.7 MB, it selects blocks by the number and variety of their matches within a fixed byte budget. The other blocks retain their original tokens. The encoder can change block boundaries, build length-limited Huffman trees, and optimize repeated code lengths in their headers. The search compares exact emitted sizes. After the frequency-weighted parse chooses its final tokens, a second boundary search can switch Huffman tables at different positions. For trees that already meet the format’s depth limit, a pair of sorted queues gives the optimal code lengths. Deeper trees use package-merge. For dense images, it also tries a bounded token search on selected blocks. The encoder estimates where the literal and distance distributions change inside each block. It splits a block only when two new Huffman tables reduce its emitted size.

The bundled libdeflate JavaScript was generated from the MIT-licensed upstream implementation. Its license is in `vendor/COPYING`. The source and build recipe are public. [Upstream libdeflate](https://github.com/ebiggers/libdeflate/tree/96836d7d9d10e3e0d53e6edb54eb908514e336c4) · [Compiler invocation and build script](https://github.com/AtticKnight/screenshot-png/blob/581504201bc18ca451698597c7aff183d94f6815/build/compile.sh)

## Verification

The normal entry point ran twice on each of five sets on Node 22.18 with one CPU. The official decoder recovered every RGBA pixel in all 40 screenshots. The two outputs for each set were byte-identical.

| Eight-image set | Output bytes | Score | Run times (seconds) |
| --- | ---: | ---: | --- |
| Published practice | 481,674 | 794,629 | 41.32, 40.26 |
| Independent draw 3 | 1,282,474 | 777,443 | 43.35, 42.78 |
| Independent draw 4 | 1,822,374 | 783,118 | 40.84, 39.52 |
| Independent draw 5 | 777,477 | 794,632 | 30.97, 31.05 |
| Independent draw 6 | 698,849 | 785,347 | 31.88, 32.06 |

The competition's Docker grader independently scored all eight practice screenshots at 794,629. [Official Docker grade](https://github.com/AtticKnight/screenshot-png/actions/runs/46090823096/job/140811069811) · [Five-set benchmark](https://github.com/AtticKnight/screenshot-png/actions/runs/46090823096)

I developed and tested the image representation, predictor selection, DEFLATE reparser and integration with OpenAI Codex for make.fun’s screenshot challenge. [Bounty](https://make.fun/bounty/png-squeeze-01-run-20261127)
