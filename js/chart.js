// 눈금 계산(순수)과 SVG 그리기.
(function () {
  function niceStep(rough) {
    const mag = 10 ** Math.floor(Math.log10(rough));
    const r = rough / mag;
    if (r <= 1) return mag;
    if (r <= 2) return 2 * mag;
    if (r <= 2.5) return 2.5 * mag;
    if (r <= 5) return 5 * mag;
    return 10 * mag;
  }

  function niceTicks(min, max, options = {}) {
    const { includeZero = true, minSpan = 1, count = 5 } = options;
    let lo = includeZero ? Math.min(min, 0) : min;
    let hi = includeZero ? Math.max(max, 0) : max;
    if (hi - lo < minSpan) {
      if (includeZero && lo === 0) hi = lo + minSpan;
      else if (includeZero && hi === 0) lo = hi - minSpan;
      else { const mid = (lo + hi) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
    }
    const step = niceStep((hi - lo) / count);
    const first = Math.floor(lo / step + 1e-9);
    const last = Math.ceil(hi / step - 1e-9);
    const ticks = [];
    for (let i = first; i <= last; i += 1) ticks.push(i * step === 0 ? 0 : i * step);
    return ticks;
  }

  function yearTicks(dates, fromIdx, toIdx) {
    const out = [];
    for (let i = fromIdx + 1; i <= toIdx; i += 1) {
      if (dates[i].slice(0, 4) !== dates[i - 1].slice(0, 4)) out.push({ idx: i, label: dates[i].slice(0, 4) });
    }
    return out;
  }

  function monthTicks(dates, fromIdx, toIdx) {
    const out = [];
    for (let i = fromIdx + 1; i <= toIdx; i += 1) {
      if (dates[i].slice(0, 7) !== dates[i - 1].slice(0, 7)) {
        out.push({ idx: i, label: dates[i].slice(0, 7).replace('-', '.') });
      }
    }
    return out;
  }

  function timeTicks(dates, fromIdx, toIdx, maxLabels = 12) {
    const thin = (ticks) => (ticks.length <= maxLabels ? ticks : ticks.filter((_, i) => i % Math.ceil(ticks.length / maxLabels) === 0));
    const years = yearTicks(dates, fromIdx, toIdx);
    if (years.length >= 2) return thin(years);
    return thin(monthTicks(dates, fromIdx, toIdx));
  }

  // values[0]은 달력 칸 fromIdx의 값이다. 점이 많으면 maxPoints 정도로 솎되 끝점은 남긴다.
  function linePath(values, fromIdx, x, y, maxPoints) {
    const n = values.length;
    const stride = Math.max(1, Math.floor(n / maxPoints));
    let d = '';
    for (let i = 0; i < n; i += 1) {
      if (i % stride !== 0 && i !== n - 1) continue;
      const v = values[i];
      if (v == null) continue;
      d += `${d ? 'L' : 'M'}${round1(x(fromIdx + i))} ${round1(y(v))}`;
    }
    return d;
  }

  function round1(v) { return Math.round(v * 10) / 10; }

  const THEME = {
    grid: '#242a33', zero: '#5a6370', text: '#97a1ad', ink: '#eef1f4', bg: '#0c0f13',
    buy: '#ff6b64', sell: '#5b9bff',
  };

  function escapeXml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // opts: {dates, fromIdx, toIdx, lines:[{values,color,width}], marks:[{idx,kind,value}], tickOptions, yFormat}
  function render(svg, opts) {
    const W = svg.clientWidth;
    const H = svg.clientHeight;
    if (!W || !H) return null;
    const { dates, fromIdx, toIdx, lines, marks = [], tickOptions, yFormat } = opts;
    let min = Infinity;
    let max = -Infinity;
    for (const l of lines) {
      for (const v of l.values) {
        if (v == null) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (min === Infinity) { min = 0; max = 1; }
    const ticks = niceTicks(min, max, tickOptions);
    const L = 74;
    const R = 12;
    const T = 10;
    const B = 22;
    const lo = ticks[0];
    const hi = ticks[ticks.length - 1];
    const span = Math.max(toIdx - fromIdx, 1);
    const x = (i) => L + (i - fromIdx) / span * (W - L - R);
    const y = (v) => T + (hi - v) / (hi - lo) * (H - T - B);
    const out = [];
    for (const v of ticks) {
      const py = round1(y(v));
      out.push(`<line x1="${L}" x2="${W - R}" y1="${py}" y2="${py}" stroke="${v === 0 ? THEME.zero : THEME.grid}"/>`);
      out.push(`<text x="${L - 7}" y="${py + 4}" text-anchor="end" font-size="11" fill="${THEME.text}">${escapeXml(yFormat(v))}</text>`);
    }
    // 글자가 겹치지 않을 만큼만 쓴다. 연도 하나의 폭이 약 30px이다.
    for (const t of timeTicks(dates, fromIdx, toIdx, Math.max(2, Math.min(12, Math.floor((W - L - R) / 46))))) {
      out.push(`<text x="${round1(x(t.idx))}" y="${H - 5}" text-anchor="middle" font-size="11" fill="${THEME.text}">${t.label}</text>`);
    }
    const maxPoints = Math.max(50, Math.ceil(W));
    for (let k = lines.length - 1; k >= 0; k -= 1) {
      const l = lines[k];
      const d = linePath(l.values, fromIdx, x, y, maxPoints);
      if (d) out.push(`<path d="${d}" fill="none" stroke="${l.color}" stroke-width="${l.width}" stroke-linejoin="round" stroke-linecap="round"/>`);
    }
    let lastAutoX = -Infinity;
    for (const m of marks) {
      if (m.value == null) continue;
      const cx = round1(x(m.idx));
      const cy = round1(y(m.value));
      if (m.kind === 'auto') {
        // 매일 자동투자처럼 촘촘하면 3픽셀에 하나만 그려 선을 덮지 않게 한다.
        if (cx - lastAutoX < 3) continue;
        lastAutoX = cx;
        out.push(`<circle class="mark-auto" cx="${cx}" cy="${cy}" r="3" fill="${THEME.buy}" stroke="${THEME.bg}"/>`);
      } else {
        const fill = m.kind === 'B' ? THEME.buy : THEME.sell;
        out.push(`<rect x="${cx - 8}" y="${cy - 8}" width="16" height="16" rx="4" fill="${fill}" stroke="${THEME.bg}" stroke-width="2" paint-order="stroke"/>`);
        out.push(`<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="${THEME.bg}">${m.kind}</text>`);
      }
    }
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = out.join('');
    const scale = { fromIdx, toIdx, L, R, W, T, H, B, span };
    svg.chartScale = scale;
    return scale;
  }

  // 마우스 위치의 달력 칸. 그래프 밖이면 null.
  function idxAt(scale, px) {
    if (!scale || px < scale.L || px > scale.W - scale.R) return null;
    const i = Math.round(scale.fromIdx + (px - scale.L) / (scale.W - scale.L - scale.R) * scale.span);
    return Math.min(Math.max(i, scale.fromIdx), scale.toIdx);
  }

  function xOf(scale, idx) {
    return scale.L + (idx - scale.fromIdx) / scale.span * (scale.W - scale.L - scale.R);
  }

  // 자동투자 표시가 많으면 달력 칸 수에 맞춰 솎는다. 같은 칸이나 가까운 칸은 하나만 남긴다.
  function thinAutos(marks, fromIdx, toIdx, maxMarks = 400) {
    const step = Math.max(1, Math.ceil((toIdx - fromIdx + 1) / maxMarks));
    const out = [];
    let last = -Infinity;
    for (const m of marks) {
      if (m.idx - last >= step) {
        out.push(m);
        last = m.idx;
      }
    }
    return out;
  }

  const Chart = { thinAutos, niceTicks, yearTicks, timeTicks, linePath, render, idxAt, xOf };
  globalThis.Chart = Chart;
  if (typeof module !== 'undefined') module.exports = Chart;
})();
