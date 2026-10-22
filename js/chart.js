// Liniendiagramm als SVG-String (keine Bibliothek, offline). Ein y-Achse, Punkte = Trainings.
// series: [{ id, label, color (CSS-Var-Index 1–8), points: [{ t (ms), y, estimated, info }] }]
// Tap-Ziele: unsichtbare Kreise mit data-a="chart-pt" und data-info (Text für die Info-Zeile).

const W = 340;
const PAD = { top: 12, right: 12, bottom: 24, left: 40 };
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Schöne Achsenschritte (1, 2, 5 × 10^n), ca. 4 Linien.
function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1000) / 1000);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

function monthTicks(t0, t1) {
  const out = [];
  const d = new Date(t0);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  while (d.getTime() <= t1) {
    out.push({ t: d.getTime(), label: MONTHS[d.getUTCMonth()] });
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  // Bei langen Zeiträumen nur jeden zweiten/dritten Monat beschriften.
  const every = Math.ceil(out.length / 6);
  return out.filter((_, i) => i % every === 0);
}

export function lineChart(series, { height = 200, unit = '%', zero = true, directLabels = true } = {}) {
  const pts = series.flatMap((s) => s.points);
  if (!pts.length) return '<div class="empty small">Noch keine Daten mit Gewicht.</div>';
  const H = height;
  const right = PAD.right + (directLabels && series.length <= 4 && series.length > 1 ? 64 : 0);
  let t0 = Math.min(...pts.map((p) => p.t));
  let t1 = Math.max(...pts.map((p) => p.t));
  if (t0 === t1) { t0 -= 7 * 864e5; t1 += 7 * 864e5; }
  const ys = pts.map((p) => p.y);
  const ticks = niceTicks(Math.min(...ys, zero ? 0 : Infinity), Math.max(...ys, zero ? 0 : -Infinity));
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const x = (t) => PAD.left + ((t - t0) / (t1 - t0)) * (W - PAD.left - right);
  const y = (v) => PAD.top + (1 - (v - y0) / (y1 - y0)) * (H - PAD.top - PAD.bottom);
  const fmt = (v) => (unit === '%' && v > 0 ? '+' : '') + String(Math.round(v * 10) / 10).replace('.', ',') + (unit === '%' ? ' %' : '');

  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map((s) => s.label).join(', '))}">`;
  ticks.forEach((v) => {
    svg += `<line class="grid${v === 0 && zero ? ' zero' : ''}" x1="${PAD.left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text class="axis" x="${PAD.left - 6}" y="${y(v) + 4}" text-anchor="end">${esc(fmt(v))}</text>`;
  });
  monthTicks(t0, t1).forEach((m) => {
    svg += `<text class="axis" x="${x(m.t)}" y="${H - 6}" text-anchor="middle">${m.label}</text>`;
  });

  // Linien zuerst, dann Punkte (Ring in Flächenfarbe), dann Tap-Ziele obenauf.
  series.forEach((s) => {
    if (s.points.length > 1) {
      const d = s.points.map((p, i) => (i ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.y).toFixed(1)).join(' ');
      svg += `<path class="line" d="${d}" style="stroke:var(--s${s.color})"/>`;
    }
  });
  series.forEach((s) => {
    s.points.forEach((p) => {
      svg += `<circle class="dot${p.estimated ? ' est' : ''}" cx="${x(p.t).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="4" style="--c:var(--s${s.color})"/>`;
    });
  });
  // Direkte Beschriftung am Linienende (nur bei wenigen Serien), Kollisionen nach unten schieben.
  if (right > PAD.right) {
    const labels = series.filter((s) => s.points.length)
      .map((s) => ({ s, yy: y(s.points[s.points.length - 1].y) })).sort((a, b) => a.yy - b.yy);
    labels.forEach((l, i) => { if (i && l.yy - labels[i - 1].yy < 13) l.yy = labels[i - 1].yy + 13; });
    labels.forEach((l) => {
      svg += `<text class="dlabel" x="${W - right + 8}" y="${l.yy + 4}">${esc(l.s.label.length > 9 ? l.s.label.slice(0, 8) + '…' : l.s.label)}</text>`;
    });
  }
  series.forEach((s) => {
    s.points.forEach((p) => {
      svg += `<circle class="hit" data-a="chart-pt" data-info="${esc(s.label + ' · ' + p.info)}" cx="${x(p.t).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="12"/>`;
    });
  });
  return svg + '</svg>';
}
