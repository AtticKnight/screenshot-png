"""Apply the documented screenshot build changes to a temporary upstream checkout."""
from pathlib import Path
import sys

root = Path(sys.argv[1])
def edit(file, before, after):
    path = root / file
    original = path.read_text()
    if original.count(before) != 1:
        raise ValueError(f"Expected one occurrence in {file}: {before[:50]}")
    path.write_text(original.replace(before, after))

edit("util.h", "#define ZOPFLI_MAX_CHAIN_HITS 8192", "#define ZOPFLI_MAX_CHAIN_HITS 1536")

# The matcher consumes at most 258 bytes. Compare 16 at a time and use the
# first unequal lane as the exact end of the match. Both loads stay in bounds.
path = root / "lz77.c"
source = path.read_text()
start = source.index("  if (sizeof(size_t) == 8)")
end = source.index("  /* The remaining few bytes. */",start)
source = source[:start] + """  (void)safe_end;
  while ((size_t)(end - scan) >= 16) {
    v128_t left = wasm_v128_load(scan);
    v128_t right = wasm_v128_load(match);
    unsigned mismatch = wasm_i8x16_bitmask(wasm_i8x16_ne(left, right));
    if (mismatch) return scan + __builtin_ctz(mismatch);
    scan += 16;
    match += 16;
  }
""" + source[end:]
path.write_text("#include <wasm_simd128.h>\n" + source)

# Deflate has only 30 distance symbols. Within a symbol the extra-bit COUNT
# is fixed, so the cost callback is constant for every distance in its class.
# Build the same callback values once per block/iteration, outside the hot loop.
edit("squeeze.c", "  double mincostaddcostj;", """  double mincostaddcostj;
  static unsigned char distance_class[ZOPFLI_WINDOW_SIZE + 1];
  static double pairs[30][ZOPFLI_MAX_MATCH + 1];
  double literals[256];
  static const unsigned bases[30] = {
    1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,
    257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577
  };
  if (distance_class[ZOPFLI_WINDOW_SIZE] == 0) {
    for (unsigned d = 1; d <= ZOPFLI_WINDOW_SIZE; ++d)
      distance_class[d] = (unsigned char)ZopfliGetDistSymbol(d);
  }
  for (unsigned d = 0; d < 30; ++d)
    for (unsigned l = 3; l <= ZOPFLI_MAX_MATCH; ++l)
      pairs[d][l] = costmodel(l, bases[d], costcontext);
  for (unsigned l = 0; l < 256; ++l) literals[l] = costmodel(l, 0, costcontext);""")
edit("squeeze.c","costmodel(in[i], 0, costcontext) + costs[j]","literals[in[i]] + costs[j]")
edit("squeeze.c","costmodel(k, sublen[k], costcontext) + costs[j]","pairs[distance_class[sublen[k]]][k] + costs[j]")
edit("squeeze.c","double symbolcost = costmodel(ZOPFLI_MAX_MATCH, 1, costcontext);",
     "double symbolcost = pairs[0][ZOPFLI_MAX_MATCH];")

# A run of equal length/distance symbol prices is one double. Share that price
# across its destinations; keep the scalar comparison's rounding and order.
(root / "screenshot-relax.h").write_text(
    Path(__file__).with_name("zopfli-relax.h").read_text()
)
path = root / "squeeze.c"
path.write_text('#include "screenshot-relax.h"\n' + path.read_text())
edit("squeeze.c", "  double mincost = GetCostModelMinCost(costmodel, costcontext);", "")
edit("squeeze.c", "  double mincostaddcostj;", """  static unsigned short length_end[ZOPFLI_MAX_MATCH + 1];
  if (!length_end[3]) {
    for (unsigned l = ZOPFLI_MAX_MATCH; l >= 3; --l) {
      length_end[l] = (l < ZOPFLI_MAX_MATCH &&
          ZopfliGetLengthSymbol(l) == ZopfliGetLengthSymbol(l+1)) ? length_end[l+1] : l;
    }
  }""")
edit("squeeze.c", "    mincostaddcostj = mincost + costs[j];\n    for (k = 3; k <= kend; k++) {\n      double newCost;\n\n      /* Calling the cost model is expensive, avoid this if we are already at\n      the minimum possible cost that it can return. */\n     if (costs[j + k] <= mincostaddcostj) continue;\n\n      newCost = pairs[distance_class[sublen[k]]][k] + costs[j];\n      assert(newCost >= 0);\n      if (newCost < costs[j + k]) {\n        assert(k <= ZOPFLI_MAX_MATCH);\n        costs[j + k] = newCost;\n        length_array[j + k] = k;\n      }\n    }", "    /* Longer matches require searching at least as far along the hash chain.\n       Symbol costs remain constant across each length and distance interval. */\n    for (k = 3; k <= kend; ) {\n      size_t last = length_end[k] < kend ? length_end[k] : kend;\n      unsigned dc = distance_class[sublen[k]];\n      if (distance_class[sublen[last]] != dc) {\n        size_t low = k, high = last;\n        while (low + 1 < high) {\n          size_t mid = (low + high) / 2;\n          if (distance_class[sublen[mid]] == dc) low = mid;\n          else high = mid;\n        }\n        last = low;\n      }\n      relax_length_span(costs+j,length_array+j,k,last,pairs[dc][k]+costs[j]);\n      k = last + 1;\n    }")
