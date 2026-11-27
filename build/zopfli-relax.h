/* Batch equal symbol prices without changing Zopfli's float tie handling. */
#ifndef SCREENSHOT_RELAX_H
#define SCREENSHOT_RELAX_H
#include <stddef.h>
#include <wasm_simd128.h>
static inline void relax_length_span(float *costs, unsigned short *lengths,
                                     size_t first, size_t last, double candidate) {
  size_t k = first;
  if (first + 3 <= last) {
    const float rounded = (float)candidate;
    /* For a candidate rounded up, equality in float wins the original double comparison. */
    const int include_equal = (double)rounded > candidate;
    const v128_t value = wasm_f32x4_splat(rounded);
    const v128_t offsets = wasm_i16x8_make(0,1,2,3,0,0,0,0);
    for (; k + 3 <= last; k += 4) {
      v128_t old = wasm_v128_load(costs+k);
      v128_t replace = include_equal ? wasm_f32x4_ge(old,value) : wasm_f32x4_gt(old,value);
      if (!wasm_v128_any_true(replace)) continue;
      wasm_v128_store(costs+k,wasm_v128_bitselect(value,old,replace));
      v128_t index = wasm_i16x8_add(wasm_i16x8_splat((short)k),offsets);
      v128_t mask = wasm_i16x8_narrow_i32x4(replace,wasm_i32x4_splat(0));
      v128_t old_lengths = wasm_v128_load64_zero(lengths+k);
      wasm_v128_store64_lane(lengths+k,wasm_v128_bitselect(index,old_lengths,mask),0);
    }
  }
  for (; k <= last; k++) {
    if (candidate < costs[k]) {
      costs[k] = (float)candidate;
      lengths[k] = (unsigned short)k;
    }
  }
}
#endif
