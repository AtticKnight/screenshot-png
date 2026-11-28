const totals = new Map();
export function timed(label, action) {
  return function (...args) {
    const start = performance.now();
    try { return action(...args); }
    finally { totals.set(label, (totals.get(label) ?? 0) + performance.now() - start); }
  };
}
export function finishTiming(name, length) {
  console.log('PNG_PROFILE',name,length,JSON.stringify(Object.fromEntries([...totals].map(([k,v])=>[k,Math.round(v)]))));
  totals.clear();
}
