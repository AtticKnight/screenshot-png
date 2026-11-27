// Order palette entries using the observed horizontal and vertical color changes.
// A frequent equal step in adjacent palette indices lets the PNG predictors reuse
// one residual symbol across different edges. The order changes only the indices.
export function adjacencyOrders(indices, width, colors, counts) {
  const count = colors.length;
  if (count < 3 || count > 80) return [];
  const weights = new Uint32Array(count * count);
  for (let y = 0; y < indices.length; y += width) {
    for (let x = 0; x < width; x++) {
      const i = y + x, here = indices[i];
      if (x && indices[i-1] !== here) weights[indices[i-1]*count + here]++;
      if (y && indices[i-width] !== here) weights[indices[i-width]*count + here]++;
    }
  }
  const edges = [];
  const pairs = [];
  for (let a = 0; a < count; a++) {
    for (let b = 0; b < count; b++) {
      const weight = weights[a*count+b];
      if (weight) edges.push([a,b,weight]);
      if (a < b && weight + weights[b*count+a]) pairs.push([a,b,weight+weights[b*count+a]]);
    }
  }
  if (!pairs.length) return [];
  pairs.sort((a,b) => b[2]-a[2] || a[0]-b[0] || a[1]-b[1]);
  const neighbors = Array.from({ length: count }, () => []);
  const parent = Array.from({ length: count }, (_, i) => i);
  const component = i => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  // Build disjoint paths joined across strong transitions. No vertex can get a
  // third neighbor and no edge can close a cycle.
  for (const [a,b] of pairs) {
    if (neighbors[a].length === 2 || neighbors[b].length === 2) continue;
    const ca = component(a), cb = component(b);
    if (ca === cb) continue;
    neighbors[a].push(b);
    neighbors[b].push(a);
    parent[cb] = ca;
  }
  const ends = parent.map((_,i) => i).filter(i => neighbors[i].length < 2)
    .sort((a,b) => counts.get(colors[b])-counts.get(colors[a]) || a-b);
  const path = [], seen = new Uint8Array(count);
  for (const start of ends) {
    let i = start;
    while (i !== undefined && !seen[i]) {
      seen[i] = 1;
      path.push(i);
      i = neighbors[i].find(j => !seen[j]);
    }
  }
  const rank = new Uint8Array(count);
  path.forEach((c,i) => { rank[c] = i; });
  const histogram = new Uint32Array(256);
  const bitCost = Float64Array.from({ length:256 }, (_,v) => Math.log2(1+Math.min(v,256-v)));
  function concentration() {
    histogram.fill(0);
    for (const [a,b,n] of edges) histogram[(rank[b]-rank[a]) & 255] += n;
    let score = 0;
    for (let i = 0; i < histogram.length; i++) {
      const h = histogram[i];
      if (h) score += h * (Math.log2(h) - 0.03 * bitCost[i]);
    }
    return score;
  }
  let current = concentration(), attempts = 0;
  for (let pass = 0; pass < 3; pass++) {
    let improved = false;
    for (let gap = 1; gap < count && attempts < 2600; gap++) {
      for (let a = 0; a+gap < count && attempts < 2600; a++) {
        const b = a+gap, old = rank[a];
        rank[a] = rank[b]; rank[b] = old;
        const trial = concentration();
        attempts++;
        if (trial > current + 0.001) {
          current = trial;
          improved = true;
        } else {
          rank[b] = rank[a]; rank[a] = old;
        }
      }
    }
    if (!improved || attempts === 2600) break;
  }
  const ordered = new Array(count);
  for (let i = 0; i < count; i++) ordered[rank[i]] = colors[i];
  return [path.map(i => colors[i]), ordered];
}
