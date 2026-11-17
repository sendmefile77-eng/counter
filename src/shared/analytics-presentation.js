(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) root.LadAnalyticsPresentation = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const metrics = ['workedDays', 'objectsReceived', 'kpi'];
  function change(current, previous, metric) {
    if (!current || !previous || !metrics.includes(metric)) return null;
    const a = current[metric], b = previous[metric];
    if (!Number.isFinite(a) || !Number.isFinite(b) || !previous.workedDays) return null;
    if (metric !== 'workedDays' && (current.legacyUnknownDays || previous.legacyUnknownDays)) return null;
    if (metric === 'kpi') return { value: Math.round((a - b) * 10) / 10, unit: 'points' };
    return b ? { value: Math.round((a - b) * 1000 / b) / 10, unit: 'percent' } : null;
  }
  function series(facts, daysPerObject = 1.5, limit = 12) {
    const dates = [...new Set(facts.filter(f => !f.future).map(f => f.date))].sort();
    if (!dates.length) return [];
    const count = Math.max(1, Math.min(dates.length, limit)), positions = new Map(dates.map((d, i) => [d, Math.min(count - 1, Math.floor(i * count / dates.length))]));
    const rows = Array.from({length:count}, () => ({from:'',to:'',workedDays:0,objectsReceived:0,legacyUnknownDays:0}));
    for (const date of dates) { const r = rows[positions.get(date)]; r.from ||= date; r.to = date; }
    for (const f of facts) if (!f.future) {
      const row = rows[positions.get(f.date)];
      row.workedDays += Number(Boolean(f.worked)); row.objectsReceived += f.objects || 0;
      row.legacyUnknownDays += Number(Boolean(f.legacyResultUnknown));
    }
    return rows.map(r => ({...r, kpi:r.workedDays && !r.legacyUnknownDays ? Math.round(r.objectsReceived * daysPerObject * 1000 / r.workedDays) / 10 : null}));
  }
  // Linear segments preserve actual extrema. Missing KPI buckets stay gaps.
  function chart(points, metric, width = 300, height = 74) {
    const values = points.map(p => p[metric]), valid = values.filter(Number.isFinite);
    if (!valid.length) return {path:'', points:[]};
    const max = Math.max(1, ...valid), pad = 6;
    const coords = values.map((v, i) => Number.isFinite(v) ? {x:pad + i * (width - pad * 2) / Math.max(1, values.length - 1), y:height - pad - v / max * (height - pad * 2), value:v, from:points[i].from, to:points[i].to} : null);
    let pen = false;
    const path = coords.map(p => { if (!p) { pen = false; return ''; } const command = pen ? 'L' : 'M'; pen = true; return `${command}${p.x.toFixed(2)},${p.y.toFixed(2)}`; }).join(' ');
    return {path, points:coords.filter(Boolean)};
  }
  return {change, series, chart};
}));
