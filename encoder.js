import { crc32, deflateRawSync, deflateSync, inflateSync } from 'node:zlib';
import { compressOptimally } from './optimal.js';
import { repack } from './repack.js';


const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(left, above, corner) {
  const da = Math.abs(above - corner);
  const db = Math.abs(left - corner);
  const dc = Math.abs(left + above - 2 * corner);
  return da <= db && da <= dc ? left : db <= dc ? above : corner;
}

export function decodeRgba(file) {
  if (!file.subarray(0, 8).equals(signature)) throw new Error('Expected a PNG.');
  const width = file.readUInt32BE(16);
  const height = file.readUInt32BE(20);
  if (file[24] !== 8 || file[25] !== 6 || file[28] !== 0) {
    throw new Error('Expected a noninterlaced 8-bit RGBA source.');
  }
  const data = [];
  for (let at = 8; at + 12 <= file.length;) {
    const size = file.readUInt32BE(at);
    if (at + 12 + size > file.length) throw new Error('Incomplete PNG chunk.');
    const type = file.toString('ascii', at + 4, at + 8);
    if (type === 'IDAT') data.push(file.subarray(at + 8, at + 8 + size));
    at += 12 + size;
    if (type === 'IEND') break;
  }
  const stride = width * 4;
  const raw = inflateSync(Buffer.concat(data), { maxOutputLength: (stride + 1) * height });
  if (raw.length !== (stride + 1) * height) throw new Error('Incorrect image size.');
  const pixels = Buffer.allocUnsafe(stride * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    const from = row + y;
    const mode = raw[from];
    if (mode === 0) {
      raw.copy(pixels, row, from + 1, from + 1 + stride);
      continue;
    }
    if (mode > 4) throw new Error('Unknown row filter.');
    for (let x = 0; x < stride; x++) {
      const pos = row + x;
      const left = x >= 4 ? pixels[pos - 4] : 0;
      const up = y ? pixels[pos - stride] : 0;
      const corner = y && x >= 4 ? pixels[pos - stride - 4] : 0;
      const prediction = mode === 1 ? left : mode === 2 ? up : mode === 3 ? (left + up) >> 1 : paeth(left, up, corner);
      pixels[pos] = raw[from + 1 + x] + prediction;
    }
  }
  return { width, height, pixels };
}

function chunk(name, data) {
  const out = Buffer.allocUnsafe(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(name, 4, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function assemble(w, h, mode, stream, palette, transparency) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header[8] = 8;
  header[9] = mode;
  const parts = [signature, chunk('IHDR', header)];
  if (palette) parts.push(chunk('PLTE', palette));
  if (transparency?.length) parts.push(chunk('tRNS', transparency));
  parts.push(chunk('IDAT', stream), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

function inspectColors(pixels) {
  const counts = new Map();
  let indexed = true;
  let gray = true;
  let opaque = true;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] !== pixels[i + 1] || pixels[i] !== pixels[i + 2]) gray = false;
    if (pixels[i + 3] !== 255) opaque = false;
    if (indexed) {
      const color = pixels.readUInt32LE(i);
      counts.set(color, (counts.get(color) ?? 0) + 1);
      if (counts.size > 256) indexed = false;
    }
    if (!indexed && !gray && !opaque) break;
  }
  return { counts, indexed, gray, opaque };
}

function paletteImage(pixels, colors) {
  const byColor = new Map();
  const table = Buffer.allocUnsafe(colors.length * 3);
  const alphas = Buffer.allocUnsafe(colors.length);
  let alphaLength = 0;
  for (let i = 0; i < colors.length; i++) {
    const color = colors[i];
    byColor.set(color, i);
    table[3 * i] = color;
    table[3 * i + 1] = color >>> 8;
    table[3 * i + 2] = color >>> 16;
    alphas[i] = color >>> 24;
    if (alphas[i] !== 255) alphaLength = i + 1;
  }
  const data = Buffer.allocUnsafe(pixels.length / 4);
  for (let p = 0; p < data.length; p++) data[p] = byColor.get(pixels.readUInt32LE(4 * p));
  return { data, mode: 3, channels: 1, palette: table, transparency: alphas.subarray(0, alphaLength) };
}

function directImage(pixels, mode) {
  if (mode === 6) return { data: pixels, mode, channels: 4 };
  const channels = mode === 0 ? 1 : mode === 4 ? 2 : 3;
  const data = Buffer.allocUnsafe(pixels.length / 4 * channels);
  for (let i = 0, j = 0; i < pixels.length; i += 4) {
    data[j++] = pixels[i];
    if (mode === 2) {
      data[j++] = pixels[i + 1];
      data[j++] = pixels[i + 2];
    } else if (mode === 4) {
      data[j++] = pixels[i + 3];
    }
  }
  return { data, mode, channels };
}

const magnitude = Uint8Array.from({ length: 256 }, (_, x) => Math.min(x, 256 - x));
const tokenCost = Uint8Array.from(magnitude, x => x === 0 ? 0 : 2 + Math.floor(Math.log2(x)));

// Compare whole-image filters with row-wise predictors. A row of constant residuals
// compresses well even when the byte is large, so our second estimator discounts runs.
function filteredImages(image, width, height) {
  const { data, channels } = image;
  const stride = width * channels;
  const outputStride = stride + 1;
  const streams = Array.from({ length: 7 }, () => Buffer.allocUnsafe(outputStride * height));
  const [plain, sub, up, avg, paethStream, byMagnitude, byRuns] = streams;
  const sums = new Float64Array(5);
  const runs = new Float64Array(5);
  for (let y = 0; y < height; y++) {
    const dst = y * outputStride;
    const src = y * stride;
    for (let f = 0; f < 5; ++f) streams[f][dst] = f;
    for (let x = 0; x < stride; x++) {
      const pos = src + x;
      const byte = data[pos];
      const left = x >= channels ? data[pos - channels] : 0;
      const above = y ? data[pos - stride] : 0;
      const corner = y && x >= channels ? data[pos - stride - channels] : 0;
      const p = dst + x + 1;
      plain[p] = byte;
      sub[p] = byte - left;
      up[p] = byte - above;
      avg[p] = byte - ((left + above) >> 1);
      paethStream[p] = byte - paeth(left, above, corner);
    }
    // Sample every channel on alternate pixels. The phase changes on each row.
    for (let f = 0; f < 5; f++) {
      const stream = streams[f];
      let magnitudeTotal = 0, symbolTotal = 0, last = -1;
      for (let x = (y & 1) * channels; x < stride; x += 2 * channels) {
        for (let c = 0; c < channels; c++) {
          const b = stream[dst + x + c + 1];
          magnitudeTotal += magnitude[b];
          if (last !== b) symbolTotal += 4 + tokenCost[b];
          last = b;
        }
      }
      sums[f] = magnitudeTotal;
      runs[f] = symbolTotal;
    }
    let a = 0, b = 0;
    for (let f = 1; f < 5; f++) {
      if (sums[f] < sums[a]) a = f;
      if (runs[f] < runs[b]) b = f;
    }
    streams[a].copy(byMagnitude, dst, dst, dst + outputStride);
    streams[b].copy(byRuns, dst, dst, dst + outputStride);
  }
  return streams;
}

function candidatesFor(image, w, h, effort, streams) {
  const order = streams.map((raw, index) => ({
    index, bytes: deflateSync(raw, { level: 3, memLevel: 9 }).length,
  })).sort((a, b) => a.bytes - b.bytes);
  const indices = new Set(order.slice(0, effort).map(candidate => candidate.index));
  if (image.mode === 2 || image.mode === 6) indices.add(4);
  const candidates = [];
  for (const index of indices) {
    const raw = streams[index];
    const packed = deflateSync(raw, { level: 9, memLevel: 8 });
    const png = assemble(w, h, image.mode, packed, image.palette, image.transparency);
    candidates.push({ png, raw, image, index });
  }
  return candidates;
}

// Compare complete strips against the same prefix dictionary. Fixed Paeth, for
// example, can work well across a soft shadow and poorly in a table of flat fills.
// Previous choices become the dictionary for the next group of rows.
function chooseStrips(streams, w, h, channels, stripHeight, history, level) {
  const stride = w * channels + 1;
  const selected = Buffer.allocUnsafe(stride * h);
  for (let y = 0; y < h; y += stripHeight) {
    const start = y * stride;
    const end = Math.min(h, y + stripHeight) * stride;
    const options = { level, memLevel: 7 };
    if (start) options.dictionary = selected.subarray(Math.max(0, start - history), start);
    let best = null, bestSize = Infinity;
    const tried = [];
    for (const stream of streams) {
      const strip = stream.subarray(start, end);
      if (tried.some(previous => previous.equals(strip))) continue;
      tried.push(strip);
      const size = deflateRawSync(strip, options).length;
      if (size < bestSize) {
        best = strip;
        bestSize = size;
      }
    }
    best.copy(selected, start);
  }
  return selected;
}

// Change a band only when its neighboring rows still compress well across both
// edges. Keeping the rest of a strong layout fixed preserves long-distance matches.
function polishStrips(base, sources, width, height, channels, rows) {
  const stride = width * channels + 1;
  const result = Buffer.from(base);
  for (let y = 0; y < height; y += rows) {
    const start = y * stride, end = Math.min(height, y + rows) * stride;
    const warmStart = Math.max(0, start - 2 * stride);
    const left = result.subarray(warmStart, start);
    const right = base.subarray(end, Math.min(base.length, end + 3 * stride));
    const options = { level: 6, memLevel: 8 };
    if (warmStart) options.dictionary = result.subarray(Math.max(0, warmStart - 32768), warmStart);
    const size = (strip) => deflateRawSync(Buffer.concat([left, strip, right]), options).length;
    const original = base.subarray(start, end);
    const originalSize = size(original);
    const seen = [original];
    let best = original, bestSize = originalSize;
    for (const source of sources) {
      const strip = source.subarray(start, end);
      if (seen.some((previous) => previous.equals(strip))) continue;
      seen.push(strip);
      const bytes = size(strip);
      if (bytes < bestSize) {
        best = strip;
        bestSize = bytes;
      }
    }
    if (bestSize + 12 < originalSize) best.copy(result, start);
  }
  return result;
}

// Score alternative filter paths against a rolling DEFLATE dictionary. Two
// different endings survive each band, so an initially costlier predictor can
// win once the next band uses its matches. Place cuts near changes in the
// amount of vertical detail rather than tying them to a fixed scanline grid.
function chooseFilterPath(streams, width, height, channels, guide) {
  const stride = width * channels + 1;
  const detail = new Float64Array(height);
  const up = streams[2], plain = streams[0];
  for (let y = 0; y < height; y++) {
    let changed = 0, edges = 0, samples = 0;
    const at = y * stride;
    for (let x = channels; x < stride - 1; x += 5 * channels) {
      const pos = at + 1 + x;
      for (let c = 0; c < channels; c++) {
        if (up[pos + c]) changed++;
        if (plain[pos + c] !== plain[pos + c - channels]) edges++;
        samples++;
      }
    }
    detail[y] = (changed + 0.4 * edges) / Math.max(1, samples);
  }
  const band = channels === 1 ? 11 : 9;
  let paths = [{ score: 0, history: Buffer.alloc(0), previous: null, strip: null }];
  for (let y = 0; y < height;) {
    let stop = Math.min(height, y + band);
    if (stop + 3 < height) {
      let bestEdge = -Infinity;
      for (let row = Math.max(y + 3, stop - 4); row <= Math.min(height - 1, y + band + 4); row++) {
        const edge = Math.abs(detail[row] - detail[row - 1])
          + 0.3 * Math.abs(detail[Math.min(height - 1, row + 1)] - detail[row - 1])
          - 0.013 * Math.abs(row - y - band);
        if (edge > bestEdge) { bestEdge = edge; stop = row; }
      }
    }
    const start = y * stride, end = stop * stride;
    const bands = [];
    for (const source of [...streams, guide]) {
      const strip = source.subarray(start, end);
      if (!bands.some(s => s.equals(strip))) bands.push(strip);
    }
    const choices = [];
    for (const previous of paths) {
      const options = { level: 5, memLevel: 7 };
      if (previous.history.length) options.dictionary = previous.history;
      for (const strip of bands) {
        const bytes = deflateRawSync(strip, options).length;
        choices.push({ score: previous.score + bytes, previous, strip });
      }
    }
    choices.sort((a, b) => a.score - b.score);
    const first = choices[0];
    const alternative = choices.find(p => p.strip !== first.strip);
    paths = alternative ? [first, alternative] : [first];
    for (const path of paths) {
      const n = Math.max(0, 32768 - path.strip.length);
      path.history = n === 0 ? path.strip.subarray(-32768) :
        Buffer.concat([path.previous.history.subarray(Math.max(0, path.previous.history.length - n)), path.strip]);
    }
    y = stop;
  }
  const selected = [];
  for (let state = paths[0]; state.previous; state = state.previous) selected.push(state.strip);
  return Buffer.concat(selected.reverse(), stride * height);
}

// Revisit individual scanlines where the chosen predictor has expensive
// residuals compared with its alternatives. Test the actual byte stream on
// both sides of the row against the same 32 KiB history before changing it.
function polishBoundaryRows(base, streams, width, height, channels) {
  const stride = width * channels + 1;
  const bands = [];
  for (let from = 0; from < height; from += 20) {
    let bestRow = -1, bestGain = 0;
    for (let y = from; y < Math.min(height, from + 20); y++) {
      const start = y * stride, current = base[start];
      let lowest = Infinity, original = 0;
      for (let f = 0; f < 5; f++) {
        const data = streams[f];
        let score = 0;
        for (let x = 1 + channels; x < stride; x += 11 * channels) {
          for (let c = 0; c < channels && x + c < stride; c++) {
            const pos = start + x + c, value = data[pos];
            if (!value) continue;
            score += value === data[pos - channels] || (y && value === base[pos - stride])
              ? 1 : 5 + tokenCost[value];
          }
        }
        if (f === current) original = score;
        lowest = Math.min(lowest, score);
      }
      const transition = (y && base[start - stride] !== current) ||
        (y + 1 < height && base[start + stride] !== current);
      const gain = original - lowest + (transition ? 4 : 0);
      if (gain > bestGain) { bestGain = gain; bestRow = y; }
    }
    if (bestRow >= 0) bands.push(bestRow);
  }
  const result = Buffer.from(base);
  for (const row of bands) {
    const offset = row * stride, warm = Math.max(0, offset - stride);
    const window = Buffer.from(result.subarray(warm, Math.min(result.length, offset + 3 * stride)));
    const opts = { level: 5, memLevel: 7 };
    if (warm) opts.dictionary = result.subarray(Math.max(0, warm - 32768), warm);
    const current = result[offset];
    let size = deflateRawSync(window, opts).length, selected = current;
    for (let f = 0; f < 5; f++) {
      if (f === current) continue;
      streams[f].copy(window, offset - warm, offset, offset + stride);
      const candidate = deflateRawSync(window, opts).length;
      if (candidate + 2 < size) { selected = f; size = candidate; }
    }
    if (selected !== current) streams[selected].copy(result, offset, offset, offset + stride);
  }
  return result;
}

export function encodeScreenshot(file) {
  const { width, height, pixels } = decodeRgba(file);
  const { counts, indexed, gray, opaque } = inspectColors(pixels);
  let strongest, chosenStreams;
  function compare(image, effort = 3) {
    const streams = filteredImages(image, width, height);
    for (const candidate of candidatesFor(image, width, height, effort, streams)) {
      if (!strongest || candidate.png.length < strongest.png.length) {
        strongest = candidate;
        chosenStreams = streams;
      }
    }
  }
  if (gray) compare(directImage(pixels, opaque ? 0 : 4), 4);
  // A dense gray ramp already has an ordered one-byte representation.
  if (indexed && (!gray || counts.size < 96)) {
    const colors = Array.from(counts.keys());
    compare(paletteImage(pixels, colors));
    const luma = c => (c & 255) * 3 + ((c >>> 8) & 255) * 6 + ((c >>> 16) & 255);
    const sorted = colors.slice().sort((a, b) => luma(a) - luma(b) || a - b);
    if (sorted.some((c,i) => c !== colors[i])) compare(paletteImage(pixels, sorted));
    const frequent = colors.slice().sort((a, b) => counts.get(b) - counts.get(a) || a - b);
    if (frequent.some((c,i) => c !== colors[i])) compare(paletteImage(pixels, frequent));
  }
  // Small opaque flat palettes avoid repeating a full three-channel filter search.
  if (!gray && (!indexed || !opaque || counts.size > 64)) compare(directImage(pixels, opaque ? 2 : 6), 4);
  let result = strongest.png;
  function refine(raw, image, compressor) {
    const packed = compressor(raw);
    if (!packed) return Infinity;
    const png = assemble(width, height, image.mode, packed, image.palette, image.transparency);
    if (png.length < result.length) result = png;
    return png.length;
  }
  const image = strongest.image;
  const alternatives = chosenStreams;
  const wide = chooseStrips(alternatives, width, height, image.channels, 8, 32768, 5);
  const narrow = chooseStrips(alternatives, width, height, image.channels, 2, 3 * (width * image.channels + 1), 3);
  const layouts = [strongest.raw, wide, narrow];
  // A long strip keeps one predictor across repeated shapes. Dense RGB data
  // changes faster, so compare shorter strips against the full 32 KiB history.
  // Grayscale samples can switch predictors on each row at lower search cost.
  if (image.mode !== 3) {
    const denseRgb = image.mode === 2 && strongest.png.length > width * height * 0.30;
    const rows = image.mode === 0 || image.mode === 4 ? 1 : denseRgb ? 2 : 16;
    const level = rows === 1 ? 3 : rows === 2 ? 5 : 7;
    layouts.push(chooseStrips(alternatives, width, height, image.channels, rows, 32768, level));
  }
  if (image.channels === 1 || strongest.png.length < width * height * 0.09) {
    layouts.push(chooseFilterPath(alternatives, width, height, image.channels, wide));
  }
  const distinct = layouts.filter((raw, i) => layouts.slice(0, i).every(previous => !raw.equals(previous)));
  const ranked = distinct.map(raw => ({
    raw,
    bytes: refine(raw, image, data => deflateSync(data, { level: 9, memLevel: 9 })),
  })).sort((a, b) => a.bytes - b.bytes);
  const bestSize = ranked[0].bytes;
  const limit = bestSize < 40000 && image.mode === 0 ? 2 : 1;
  const finalists = ranked.slice(0, limit);
  if (bestSize <= 175000) {
    const rows = image.mode === 0 || image.mode === 4 ? 5 : 8;
    const sources = [...alternatives, ...ranked.map((candidate) => candidate.raw)];
    const polished = polishStrips(ranked[0].raw, sources, width, height, image.channels, rows);
    if (!ranked.some((candidate) => candidate.raw.equals(polished))) {
      const bytes = refine(polished, image, (data) => deflateSync(data, { level: 9, memLevel: 9 }));
      if (bytes <= bestSize * 1.005) {
        finalists.push({ raw: polished, bytes });
        finalists.sort((a, b) => a.bytes - b.bytes);
      }
    }
  }
  let extraLayout;
  if (bestSize <= 135000) {
    const start = finalists[0];
    const adjusted = polishBoundaryRows(start.raw, alternatives, width, height, image.channels);
    if (!adjusted.equals(start.raw)) {
      const bytes = refine(adjusted, image, raw => deflateSync(raw, { level: 9, memLevel: 9 }));
      if (bytes + Math.max(4, start.bytes * 0.0002) < start.bytes) extraLayout = adjusted;
    }
  }
  let winner;
  for (const { raw } of finalists.filter(layout => layout.bytes <= bestSize * 1.02).slice(0, limit)) {
    const packed = compressOptimally(raw);
    if (packed && (!winner || packed.length < winner.packed.length)) winner = { raw, packed };
  }
  if (winner) {
    const rowBytes = width * image.channels + 1;
    const finish = (raw, compressed) => {
      const packed = repack(raw, compressed, rowBytes);
      const png = assemble(width, height, image.mode, packed, image.palette, image.transparency);
      if (png.length < result.length) result = png;
    };
    finish(winner.raw, winner.packed);
    // A smaller zlib preview can lose after optimal parsing and block splitting.
    // Preserve the fully optimized incumbent and compare actual output bytes.
    if (extraLayout && !extraLayout.equals(winner.raw)) {
      const alternative = compressOptimally(extraLayout);
      if (alternative && alternative.length < winner.packed.length) finish(extraLayout, alternative);
    }
  }
  return result;
}
