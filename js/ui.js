// 화면 연결. 규칙은 Engine에 있고, 여기서는 상태를 그리고 입력을 전달한다.
(function () {
  const data = globalThis.GAME_DATA;
  const $ = (id) => document.getElementById(id);
  const { t } = I18N;
  const nameOf = (stock) => I18N.stockName(stock);
  const COLOR = { mine: '#B5851A', kospi: '#2FA5B3', sp: '#9C7BEF' };
  const FRAME_MS = 33;
  const MAX_FRAME_GAP_MS = 250;

  const UI = {
    state: null,
    playing: false,
    speed: 5,
    view: null, // null이면 내 손익, 숫자면 그 종목 그래프
    selected: 0,
    side: 'buy',
    tabs: {},
    activeTab: 'stock',
  };

  let lastFrame = 0;
  let carry = 0;
  let lastDraw = 0;
  let rafId = 0;

  // ---------- 숫자 입력 ----------

  UI.parseNumber = function (text) {
    const cleaned = String(text).replace(/[,\s]/g, '');
    if (cleaned === '' || !/^-?\d*\.?\d+$/.test(cleaned)) return NaN;
    return Number(cleaned);
  };

  UI.signClass = function (n) { return n > 0 ? 'up' : n < 0 ? 'down' : ''; };

  UI.setText = function (el, text) { if (el.textContent !== text) el.textContent = text; };

  // ---------- 상단 ----------

  function drawTop() {
    const s = UI.state;
    const v = Engine.valuation(data, s);
    UI.setText($('tDate'), Format.date(data.dates[s.dayIdx]));
    UI.setText($('tTotal'), Format.krwShort(v.total));
    const pnl = $('tPnl');
    UI.setText(pnl, `${Format.krwSignedShort(v.pnl)} (${Format.pct(v.pnlPct)})`);
    pnl.className = UI.signClass(v.pnl);
    UI.setText($('tKrw'), Format.krwShort(v.krw));
    UI.setText($('tFx'), t('stat.usd', { rate: I18N.lang === 'ko' ? Math.round(data.fx[s.dayIdx]).toLocaleString('en-US') : Format.rateWhole(data.fx[s.dayIdx]) }));
    UI.setText($('tUsd'), Format.usd(Math.round(v.usd)));
    UI.setText($('tBond'), Format.krwShort(v.bondKrw));
    const ended = s.dayIdx >= data.dates.length - 1;
    $('reportBtn').hidden = !ended;
    if (!UI.playing) $('play').disabled = ended;
  }

  // ---------- 그래프 ----------

  // 내 손익 그래프의 표시. 기록이 많아도 매 화면 다시 세지 않도록 새 기록만 더한다.
  // 값은 손익 이력에서 그때 읽는다. 오늘 칸의 손익은 매매로 바뀔 수 있기 때문이다.
  let mainMarks = { events: null, cursor: 0, autos: [], manuals: [] };

  function mainMarksNow() {
    const s = UI.state;
    if (mainMarks.events !== s.events) mainMarks = { events: s.events, cursor: 0, autos: [], manuals: [] };
    for (; mainMarks.cursor < s.events.length; mainMarks.cursor += 1) {
      const e = s.events[mainMarks.cursor];
      if (e.type === 'auto_buy') mainMarks.autos.push({ idx: e.d, kind: 'auto' });
      else if (e.type === 'buy') mainMarks.manuals.push({ idx: e.d, kind: 'B' });
      else if (e.type === 'sell' || e.type === 'rule_sell') mainMarks.manuals.push({ idx: e.d, kind: 'S' });
    }
    const valueAt = (m) => ({ ...m, value: s.history.pnl[m.idx - s.startIdx] });
    return Chart.thinAutos(mainMarks.autos, s.startIdx, s.dayIdx).map(valueAt).concat(mainMarks.manuals.map(valueAt));
  }

  function marksFor(view) {
    const s = UI.state;
    if (view === null) return mainMarksNow();
    const out = [];
    const series = Engine.adjustedSeries(data, view, s.dayIdx);
    for (const e of s.events) {
      const manual = e.type === 'buy' || e.type === 'sell' || e.type === 'rule_sell';
      if (e.stockIdx === view && (manual || e.type === 'auto_buy')) {
        const kind = e.type === 'buy' ? 'B' : e.type === 'auto_buy' ? 'auto' : 'S';
        out.push({ idx: e.d, kind, value: series[e.d] });
      }
    }
    return out.sort((a, b) => (a.kind === 'auto' ? -1 : 0) - (b.kind === 'auto' ? -1 : 0));
  }

  // 그래프 표시(B·S·•) 설명과 각주.
  function markLegend(note) {
    const out = [];
    for (const [mark, cls, key] of [['B', 'up', 'chart.markBuy'], ['S', 'down', 'chart.markSell'], ['•', 'up', 'chart.markAuto']]) {
      const span = document.createElement('span');
      const mk = document.createElement('span');
      mk.className = `mk ${cls}`;
      mk.textContent = mark;
      span.append(mk, ` ${t(key)}`);
      out.push(span);
    }
    const n = document.createElement('span');
    n.className = 'note';
    n.textContent = note;
    out.push(n);
    return out;
  }

  function drawMainChart() {
    const s = UI.state;
    const h = s.history;
    const k = h.pnl.length - 1;
    UI.setText($('crumb'), '');
    $('crumb').innerHTML = '';
    $('crumb').append(Object.assign(document.createElement('h4'), { textContent: t('chart.myPnl') }));
    const legendItems = [
      [t('chart.mine'), COLOR.mine, h.pnl[k]], [t('chart.ifKospi'), COLOR.kospi, h.kospi[k]], [t('chart.ifSp'), COLOR.sp, h.sp[k]],
    ];
    const legend = $('legend');
    legend.innerHTML = '';
    for (const [name, color, value] of legendItems) {
      const span = document.createElement('span');
      const swatch = document.createElement('i');
      swatch.style.background = color;
      const b = document.createElement('b');
      b.textContent = Format.krwSignedShort(value);
      span.append(swatch, `${name} `, b);
      legend.append(span);
    }
    legend.append(...markLegend(t('chart.noteMain')));
    Chart.render($('chart'), {
      dates: data.dates,
      fromIdx: s.startIdx,
      toIdx: s.dayIdx,
      lines: [
        { values: h.pnl, color: COLOR.mine, width: 2.5 },
        { values: h.kospi, color: COLOR.kospi, width: 1.5 },
        { values: h.sp, color: COLOR.sp, width: 1.5 },
      ],
      marks: marksFor(null),
      tickOptions: { includeZero: true, minSpan: 1000000 },
      yFormat: Format.krwSignedShort,
    });
  }

  function drawStockChart() {
    const s = UI.state;
    const i = UI.view;
    const stock = data.stocks[i];
    const price = Engine.lastClose(data, i, s.dayIdx);
    const change = dayChange(i);
    const crumb = $('crumb');
    crumb.innerHTML = '';
    const back = document.createElement('button');
    back.type = 'button';
    back.textContent = t('chart.back');
    back.addEventListener('click', () => UI.showStock(null));
    const title = document.createElement('h4');
    title.textContent = nameOf(stock);
    const now = document.createElement('span');
    const listing = Engine.listingIdx(data, i);
    now.textContent = price == null
      ? t('chart.preListing', { date: listing < 0 ? '' : t('chart.listedOn', { date: Format.date(data.dates[listing]) }) })
      : `${Format.price(stock, price)} `;
    if (change != null) now.append(changeNode(change));
    crumb.append(back, title, now);

    const h = s.holdings[i];
    const legend = $('legend');
    legend.innerHTML = '';
    const hold = document.createElement('span');
    if (h) {
      const rate = price == null ? 0 : (price / h.avgCost - 1) * 100;
      hold.textContent = t('chart.hold', { qty: Format.qty(h.qty), n: h.qty, avg: Format.price(stock, h.avgCost), pct: Format.pct(rate) });
    } else {
      hold.textContent = t('chart.noHold');
    }
    legend.append(hold);

    const svg = $('chart');
    if (listing < 0 || s.dayIdx < listing) {
      svg.innerHTML = '';
      svg.chartScale = null;
      return;
    }
    // 게임 시작 뒤에 상장한 종목은 상장일부터 그린다.
    const fromIdx = Math.max(s.startIdx, listing);
    const series = Engine.adjustedSeries(data, i, s.dayIdx).slice(fromIdx);
    // 지수는 그래프 첫날 주가에서 함께 출발하도록 환산해 같은 축에 그린다.
    const usd = stock.currency === 'USD';
    const kospiAt = (d) => (usd ? data.indices.KOSPI[d] / data.fx[d] : data.indices.KOSPI[d]);
    const spAt = (d) => (usd ? data.indices.SP500[d] : data.indices.SP500[d] * data.fx[d]);
    const firstAt = series.findIndex((v) => v != null);
    const rebased = (at) => series.map((_, k) => (k < firstAt ? null : series[firstAt] * at(fromIdx + k) / at(fromIdx + firstAt)));
    const kospiLine = rebased(kospiAt);
    const spLine = rebased(spAt);
    const growth = (line) => (line[line.length - 1] / line[firstAt] - 1) * 100;
    for (const [name, color, line] of [[t('chart.kospi'), COLOR.kospi, kospiLine], [t('chart.sp'), COLOR.sp, spLine]]) {
      const item = document.createElement('span');
      const swatch = document.createElement('i');
      swatch.style.background = color;
      const b = document.createElement('b');
      b.textContent = Format.pct(growth(line));
      item.append(swatch, `${name} `, b);
      legend.append(item);
    }
    legend.append(...markLegend(t('chart.noteStock')));
    const yFormat = stock.currency === 'USD'
      ? (v) => `$${Math.round(v).toLocaleString('en-US')}`
      : (v) => Math.round(v).toLocaleString('en-US');
    Chart.render(svg, {
      dates: data.dates,
      fromIdx,
      toIdx: s.dayIdx,
      lines: [
        { values: series, color: COLOR.mine, width: 2.5 },
        { values: kospiLine, color: COLOR.kospi, width: 1.5 },
        { values: spLine, color: COLOR.sp, width: 1.5 },
      ],
      marks: marksFor(i).filter((m) => m.idx >= fromIdx),
      tickOptions: { includeZero: false, minSpan: series[firstAt] * 0.1 },
      yFormat,
    });
  }

  function drawChart() {
    if (UI.view === null) drawMainChart();
    else drawStockChart();
  }

  // ---------- 그래프 마우스 ----------

  function hoverLines(idx) {
    const s = UI.state;
    const k = idx - s.startIdx;
    const lines = [];
    if (UI.view === null) {
      lines.push(`${t('chart.mine')} ${Format.krwSignedShort(s.history.pnl[k])}`);
      lines.push(`${t('chart.kospi')} ${Format.krwSignedShort(s.history.kospi[k])}`);
      lines.push(`${t('chart.sp')} ${Format.krwSignedShort(s.history.sp[k])}`);
    } else {
      const stock = data.stocks[UI.view];
      const price = Engine.lastClose(data, UI.view, idx);
      lines.push(t('chart.close', { price: price == null ? t('stock.notListed') : Format.price(stock, price) }));
    }
    const shown = s.events.filter((e) => e.d === idx && (UI.view === null || e.stockIdx === UI.view));
    for (const e of shown.slice(0, 4)) {
      const line = Format.eventLine(data, e);
      lines.push(`${line.label} ${line.text}`);
    }
    if (shown.length > 4) lines.push(t('chart.more', { n: shown.length - 4 }));
    return lines;
  }

  function onChartMove(event) {
    const svg = $('chart');
    if (!UI.state || !svg.chartScale) return;
    const box = svg.getBoundingClientRect();
    const px = event.clientX - box.left;
    const idx = Chart.idxAt(svg.chartScale, px);
    const cross = $('cross');
    const tip = $('tip');
    if (idx === null) { cross.hidden = true; tip.hidden = true; return; }
    const cx = Chart.xOf(svg.chartScale, idx);
    cross.hidden = false;
    cross.style.left = `${cx}px`;
    tip.hidden = false;
    tip.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'h';
    head.textContent = Format.date(data.dates[idx]);
    tip.append(head);
    for (const text of hoverLines(idx)) {
      const line = document.createElement('div');
      line.textContent = text;
      tip.append(line);
    }
    const width = tip.offsetWidth;
    tip.style.left = `${Math.max(0, cx + 12 + width > box.width ? cx - width - 12 : cx + 12)}px`;
  }

  function hideHover() {
    $('cross').hidden = true;
    $('tip').hidden = true;
  }

  // ---------- 주식 탭 ----------

  function dayChange(i) {
    const d = UI.state.dayIdx;
    const stock = data.stocks[i];
    if (stock.close[d] == null) return null;
    const prev = d > 0 ? Engine.lastClose(data, i, d - 1) : null;
    if (prev == null) return null;
    let base = prev;
    for (const [splitIdx, ratio] of stock.splits) if (splitIdx === d) base /= ratio;
    return (stock.close[d] / base - 1) * 100;
  }

  function changeNode(change) {
    const small = document.createElement('small');
    small.className = UI.signClass(change);
    small.textContent = Format.pct(change);
    return small;
  }

  function buildStockList() {
    const list = $('stocks');
    list.innerHTML = '';
    const empty = document.createElement('div');
    empty.id = 'stocksEmpty';
    empty.className = 'empty listEmpty';
    empty.hidden = true;
    list.append(empty);
    // 세이브가 종목을 배열 위치로 기억하므로 배열은 그대로 두고 보이는 순서만 시장별로 묶는다.
    const order = data.stocks.map((_, i) => i).sort((a, b) => boardRank(a) - boardRank(b) || a - b);
    order.forEach((i) => {
      const stock = data.stocks[i];
      const row = document.createElement('div');
      row.className = 'row pick';
      row.dataset.i = i;
      const name = document.createElement('span');
      name.className = 'nm';
      name.textContent = nameOf(stock);
      const hold = document.createElement('small');
      hold.style.display = 'block';
      name.append(hold);
      const num = document.createElement('span');
      num.className = 'num';
      const price = document.createElement('span');
      const change = document.createElement('small');
      num.append(price, ' ', change);
      row.append(name, num);
      row.addEventListener('click', () => UI.showStock(i));
      list.append(row);

      rows[i] = { row, hold, price, change };
      if (rowWatcher) rowWatcher.observe(row);
    });
  }

  const rows = [];
  const stockFilter = { board: 'all', query: '' };
  const filterHits = new Map();

  // 목록이 길어 재생 중에는 화면에 보이는 줄만 값을 갱신한다. 줄이 보이기 시작하면 그때 채운다.
  const inView = new Set();
  const rowWatcher = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const i = Number(entry.target.dataset.i);
        if (entry.isIntersecting) {
          inView.add(i);
          if (UI.state) drawStockRow(i);
        } else inView.delete(i);
      }
    }, { rootMargin: '200px' })
    : null;

  function boardRank(i) { return ['KOSPI', 'KOSDAQ', 'US'].indexOf(data.stocks[i].board); }

  function computeFilterHit(i) {
    const stock = data.stocks[i];
    if (stockFilter.board !== 'all' && stock.board !== stockFilter.board) return false;
    const q = stockFilter.query;
    return !q || stock.name.toLowerCase().includes(q) || nameOf(stock).toLowerCase().includes(q) || stock.id.toLowerCase().includes(q);
  }

  function matchesFilter(i) {
    if (!filterHits.has(i)) filterHits.set(i, computeFilterHit(i));
    return filterHits.get(i);
  }

  function drawStockRow(i) {
    const s = UI.state;
    const r = rows[i];
    const stock = data.stocks[i];
    const price = Engine.lastClose(data, i, s.dayIdx);
    const status = Engine.tradeStatus(data, s, i);
    UI.setText(r.price, price == null ? '' : Format.priceBare(stock, price));
    const change = dayChange(i);
    let label = '';
    let cls = '';
    if (price == null) label = t('stock.notListed');
    else if (!status.ok) label = I18N.msg(status.reason);
    else if (change != null) { label = Format.pct(change); cls = UI.signClass(change); }
    UI.setText(r.change, label);
    if (r.change.className !== cls) r.change.className = cls;
    const h = s.holdings[i];
    UI.setText(r.hold, h ? t('stock.held', { qty: Format.qty(h.qty), n: h.qty }) : '');
    const on = UI.selected === i && UI.view === i;
    if (r.row.classList.contains('on') !== on) r.row.classList.toggle('on', on);
  }

  // 매도 중에는 보유 종목만 보여 준다. 고른 종목이 보유 종목이 아니면 첫 보유 종목으로 옮긴다.
  function followHoldings() {
    if (UI.side !== 'sell' || UI.state.holdings[UI.selected]) return;
    const held = rows.findIndex((_, i) => UI.state.holdings[i]);
    if (held < 0) return;
    if (UI.view === UI.selected) UI.view = held;
    UI.selected = held;
  }

  function drawStockList() {
    const s = UI.state;
    const selling = UI.side === 'sell';
    const empty = $('stocksEmpty');
    const noHoldings = selling && !Object.keys(s.holdings).length;
    const none = noHoldings || !rows.some((_, i) => matchesFilter(i) && (!selling || s.holdings[i]));
    if (empty.hidden === none) empty.hidden = !none;
    UI.setText(empty, noHoldings ? t('stock.noHoldings') : t('stock.noMatch'));
    rows.forEach((r, i) => {
      const hide = (selling && !s.holdings[i]) || !matchesFilter(i);
      if (r.row.hidden !== hide) r.row.hidden = hide;
      if (hide || (rowWatcher && !inView.has(i))) {
        const on = UI.selected === i && UI.view === i;
        if (r.row.classList.contains('on') !== on) r.row.classList.toggle('on', on);
        return;
      }
      drawStockRow(i);
    });
  }

  function orderQty() { return UI.parseNumber($('oQty').value); }

  function drawOrder() {
    const s = UI.state;
    const i = UI.selected;
    const stock = data.stocks[i];
    const status = Engine.tradeStatus(data, s, i);
    const price = stock.close[s.dayIdx];
    UI.setText($('oName'), nameOf(stock));
    UI.setText($('oPrice'), status.ok ? Format.price(stock, price) : I18N.msg(status.reason));
    const qty = orderQty();
    const valid = status.ok && Number.isFinite(qty) && qty > 0;
    let amount = '-';
    if (valid) {
      const gross = qty * price;
      const rate = UI.side === 'buy' ? s.settings.tradeFeePct : -Engine.sellCostPct(s.settings, stock);
      amount = Format.money(Engine.roundMoney(gross * (1 + rate / 100), stock.currency), stock.currency);
    }
    UI.setText($('oAmt'), amount);
    const fx = UI.side === 'buy' && valid ? Engine.buyFxNeed(data, s, i, qty) : null;
    let fxNote = '';
    if (fx) {
      fxNote = fx.enough
        ? t('order.fxAuto', { usd: Format.usd(fx.usd), krw: Format.krw(fx.krw) })
        : t('order.fxShort', { usd: Format.usd(fx.usd) });
    }
    UI.setText($('oFx'), fxNote);
    const go = $('oGo');
    go.className = `go ${UI.side}`;
    UI.setText(go, UI.side === 'buy' ? t('buy') : t('sell'));
    $('oAll').hidden = UI.side !== 'sell' || !s.holdings[i];
    go.disabled = UI.playing || !status.ok || (UI.side === 'sell' && !s.holdings[i]);
  }

  function placeOrder() {
    if (UI.playing) return;
    const msg = $('oMsg');
    const qty = orderQty();
    const r = UI.side === 'buy'
      ? Engine.buy(data, UI.state, UI.selected, qty)
      : Engine.sell(data, UI.state, UI.selected, qty);
    UI.setText(msg, r.ok ? '' : I18N.msg(r.reason));
    if (r.ok) UI.refresh();
  }

  function sellAll() {
    if (UI.playing) return;
    const r = Engine.sell(data, UI.state, UI.selected, 'all');
    UI.setText($('oMsg'), r.ok ? '' : I18N.msg(r.reason));
    if (r.ok) UI.refresh();
  }

  UI.showStock = function (i) {
    UI.view = i;
    if (i !== null) {
      UI.selected = i;
      UI.setText($('oMsg'), '');
    }
    hideHover();
    UI.refresh();
  };

  // ---------- 이벤트 기록 ----------

  const LOG_LIMIT = 500;
  let logShown = 0; // 화면에 그린 가장 최근 이벤트 수(state.events 기준 번호)
  let logOldest = 0; // 화면에 있는 가장 오래된 이벤트 번호

  function logRow(e) {
    const line = Format.eventLine(data, e);
    const row = document.createElement('div');
    if (e.type === 'skip') row.className = 'skip';
    const date = document.createElement('span');
    date.textContent = line.date;
    const label = document.createElement('span');
    label.textContent = line.label;
    const text = document.createElement('b');
    text.textContent = line.text;
    row.append(date, label, text);
    return row;
  }

  function resetLog() {
    $('log').innerHTML = '';
    logShown = 0;
    logOldest = 0;
    drawLog();
  }

  function drawLog() {
    const events = UI.state.events;
    const log = $('log');
    if (logShown === events.length) {
      if (!events.length && !log.firstChild) {
        const none = document.createElement('div');
        none.className = 'none';
        none.textContent = t('log.none');
        log.append(none);
      }
      return;
    }
    // 한 번에 너무 많이 쌓이면 다시 그린다. 중간이 비지 않게 스크롤로 이어 붙일 수 있다.
    if (events.length - logShown > LOG_LIMIT) logShown = 0;
    if (logShown === 0) log.innerHTML = '';
    const from = Math.max(logShown, events.length - LOG_LIMIT);
    if (logShown === 0) logOldest = from;
    const fragment = document.createDocumentFragment();
    for (let i = events.length - 1; i >= from; i -= 1) fragment.append(logRow(events[i]));
    log.prepend(fragment);
    logShown = events.length;
    // 재생 중 쌓이는 행은 화면 밖으로 밀린 오래된 것부터 지운다.
    while (log.childElementCount > LOG_LIMIT * 2) {
      log.lastElementChild.remove();
      logOldest += 1;
    }
  }

  // 아래로 스크롤하면 더 오래된 기록을 붙인다.
  function onLogScroll() {
    const log = $('log');
    if (log.scrollTop + log.clientHeight < log.scrollHeight - 40 || logOldest === 0) return;
    const events = UI.state.events;
    const to = logOldest;
    const from = Math.max(0, to - LOG_LIMIT);
    const fragment = document.createDocumentFragment();
    for (let i = to - 1; i >= from; i -= 1) fragment.append(logRow(events[i]));
    log.append(fragment);
    logOldest = from;
  }

  // ---------- 트로피와 메달 ----------

  UI.achievements = Achievements.empty();
  let tracker = Achievements.newTracker();
  let thisGameTrophies = null; // 이번 판에서 받은 트로피. 끝나기 전에는 null
  let roomTab = 'trophy';
  let roomFrom = 'start';
  const TOAST_MS = 4000;
  const TOAST_LIMIT = 3;
  const MEDAL_BY_ID = new Map(Achievements.MEDALS.map((m) => [m.id, m]));

  function persistAchievements() {
    Saves.saveAchievements(UI.achievements).catch(() => {});
  }

  function toast(icon, title, text) {
    const box = $('toasts');
    const item = document.createElement('div');
    item.className = 'toast';
    const ic = document.createElement('span');
    ic.className = 'ic';
    ic.textContent = icon;
    const body = document.createElement('span');
    const small = document.createElement('small');
    small.textContent = title;
    const b = document.createElement('b');
    b.textContent = text;
    body.append(small, b);
    item.append(ic, body);
    box.append(item);
    while (box.childElementCount > TOAST_LIMIT + 1) box.firstElementChild.remove();
    setTimeout(() => item.remove(), TOAST_MS);
  }

  function announceMedals(ids) {
    if (ids.length > TOAST_LIMIT) {
      toast('🏅', t('toast.medal'), t('toast.many', { n: ids.length }));
      return;
    }
    for (const id of ids) {
      const m = MEDAL_BY_ID.get(id);
      toast(m.icon, t('toast.medal'), I18N.achName(m));
    }
  }

  function grantMedals(ids) {
    if (!ids.length) return;
    const fresh = Achievements.addMedals(UI.achievements, ids, new Date().toISOString().slice(0, 10));
    if (!fresh.length) return;
    persistAchievements();
    announceMedals(fresh);
  }

  function checkMedals() {
    if (UI.state) grantMedals(tracker.update(data, UI.state));
  }

  // 마지막 날: 트로피와 완주 메달을 준다.
  function finishGame() {
    const report = Engine.report(data, UI.state);
    const earned = Achievements.trophiesFor(report);
    thisGameTrophies = { ids: earned.map((t) => t.id), eligible: Achievements.isTrophyGame(report) };
    Achievements.addTrophies(UI.achievements, thisGameTrophies.ids);
    UI.achievements.finishes += 1;
    grantMedals(tracker.finish(data, UI.state, UI.achievements.finishes));
    persistAchievements();
  }

  function trophySection() {
    const nodes = [section(t('trophy.thisGame'))];
    if (!thisGameTrophies.eligible) {
      const p = document.createElement('p');
      p.className = 'note';
      p.textContent = t('trophy.tooShort');
      nodes.push(p);
      return nodes;
    }
    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const tr of Achievements.TROPHIES.filter((x) => thisGameTrophies.ids.includes(x.id))) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = `${tr.icon || Achievements.TIER_ICON[tr.tier]} ${I18N.achName(tr)}`;
      chip.title = I18N.achDesc(tr);
      chips.append(chip);
    }
    nodes.push(chips);
    return nodes;
  }

  function roomItem(item, icon, on, tier, count) {
    const box = document.createElement('div');
    box.className = `it ${on ? tier : 'off'}`;
    box.dataset.id = item.id;
    if (count) {
      const cnt = document.createElement('span');
      cnt.className = 'cnt';
      cnt.textContent = `×${count}`;
      box.append(cnt);
    }
    const ic = document.createElement('span');
    ic.className = 'ic';
    ic.textContent = icon;
    const name = document.createElement('b');
    name.textContent = I18N.achName(item);
    const desc = document.createElement('small');
    desc.textContent = I18N.achDesc(item);
    box.append(ic, name, desc);
    return box;
  }

  function drawRoom() {
    const store = UI.achievements;
    const c = Achievements.counts(store);
    const total = $('roomTotal');
    total.textContent = t('room.collected');
    const b = document.createElement('b');
    b.textContent = c.collected;
    total.append(b, ` / ${c.total}`);
    for (const btn of $('roomTabs').children) {
      btn.classList.toggle('on', btn.dataset.k === roomTab);
      btn.textContent = btn.dataset.k === 'trophy' ? t('room.trophies', { n: c.trophies, total: c.trophyTotal }) : t('room.medals', { n: c.medals, total: c.medalTotal });
    }
    const list = roomTab === 'trophy' ? Achievements.TROPHIES : Achievements.MEDALS;
    const groups = [...new Set(list.map((x) => x.group))];
    const body = $('roomBody');
    body.replaceChildren();
    for (const group of groups) {
      const items = list.filter((x) => x.group === group);
      const head = document.createElement('div');
      head.className = 'roomSec';
      const name = document.createElement('span');
      name.textContent = I18N.achGroup(group);
      const size = document.createElement('span');
      size.textContent = t('room.kinds', { n: items.length });
      head.append(name, size);
      const grid = document.createElement('div');
      grid.className = 'roomGrid';
      for (const it of items) {
        if (roomTab === 'trophy') {
          const count = store.trophies[it.id] || 0;
          grid.append(roomItem(it, it.icon || Achievements.TIER_ICON[it.tier], count > 0, it.tier, count));
        } else {
          grid.append(roomItem(it, it.icon, Boolean(store.medals[it.id]), '', 0));
        }
      }
      body.append(head, grid);
    }
  }

  function openRoom() {
    if (UI.playing) UI.pause();
    roomFrom = $('game').hidden ? 'start' : 'game';
    $('game').hidden = true;
    $('start').hidden = true;
    $('trophyRoom').hidden = false;
    roomTab = 'trophy';
    drawRoom();
    window.scrollTo(0, 0);
  }

  function closeRoom() {
    $('trophyRoom').hidden = true;
    if (roomFrom === 'game') {
      $('game').hidden = false;
      UI.refresh();
    } else {
      $('start').hidden = false;
    }
  }

  // ---------- 그리기와 재생 ----------

  UI.refresh = function () {
    if (!UI.state) return;
    checkMedals();
    followHoldings();
    drawTop();
    drawChart();
    if (UI.activeTab === 'stock') {
      drawStockList();
      drawOrder();
    }
    const tab = UI.tabs[UI.activeTab];
    if (tab) tab();
    drawLog();
  };

  function setLocked(on) {
    $('game').classList.toggle('locked', on);
    for (const el of document.querySelectorAll('#game .right input, #game .right select, #game .right .ord button, #game .right .lockable')) {
      el.disabled = on;
    }
    $('save').disabled = on;
    $('play').disabled = !on && UI.state && UI.state.dayIdx >= data.dates.length - 1;
  }

  function tick(now) {
    if (!UI.playing) return;
    // 창을 가려 프레임이 멈췄던 시간은 몰아서 진행하지 않는다.
    carry += Math.min(Math.max(now - lastFrame, 0), MAX_FRAME_GAP_MS) / 1000 * UI.speed;
    lastFrame = now;
    let steps = Math.floor(carry);
    carry -= steps;
    let ended = false;
    while (steps > 0) {
      if (!Engine.advance(data, UI.state)) { ended = true; break; }
      checkMedals();
      steps -= 1;
    }
    if (now - lastDraw >= FRAME_MS || ended) {
      lastDraw = now;
      UI.refresh();
    }
    if (ended) {
      UI.pause();
      if (UI.onEnd) UI.onEnd();
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  UI.play = function () {
    if (UI.playing || !UI.state || UI.state.dayIdx >= data.dates.length - 1) return;
    if (UI.onPlay) UI.onPlay();
    if (Engine.alignStartToListings(data, UI.state)) {
      resetLog();
      UI.refresh();
    }
    UI.playing = true;
    $('play').textContent = t('pause');
    setLocked(true);
    lastFrame = performance.now();
    carry = 0;
    rafId = requestAnimationFrame(tick);
  };

  UI.pause = function () {
    UI.playing = false;
    cancelAnimationFrame(rafId);
    $('play').textContent = t('play');
    setLocked(false);
    UI.refresh();
  };

  UI.setSpeed = function (n) {
    UI.speed = n;
    for (const b of $('speed').children) b.classList.toggle('on', Number(b.dataset.speed) === n);
  };

  UI.step = function () {
    const moved = Engine.advance(data, UI.state);
    UI.refresh();
    return moved;
  };

  // 탭이 재생 잠금을 다시 맞출 때 쓴다.
  UI.relock = function () { setLocked(UI.playing); };

  UI.registerTab = function (name, renderFn) { UI.tabs[name] = renderFn; };

  function showGame() {
    $('start').hidden = true;
    $('game').hidden = false;
  }

  UI.loadState = function (state) {
    UI.playing = false;
    UI.state = state;
    tracker = Achievements.newTracker();
    thisGameTrophies = null;
    $('exportBtn').hidden = Saves.canPickFiles();
    UI.view = null;
    UI.selected = 0;
    UI.side = 'buy';
    for (const b of $('side').children) b.classList.toggle('on', b.dataset.side === 'buy');
    UI.setText($('oMsg'), '');
    showGame();
    resetLog();
    setLocked(false);
    $('play').textContent = t('play');
    UI.refresh();
    UI.relock();
  };

  UI.startGame = function (settings) {
    UI.loadState(Engine.newGame(data, settings));
  };

  UI.defaultSettings = function () {
    return {
      startDate: '2016-11-07', krw0: 100000000, usd0: 0, monthlyKrw: 1000000, fxFeePct: 1, tradeFeePct: 0.1, sellTaxPct: 0.2,
    };
  };

  // ---------- 종료 요약 ----------

  function section(title) {
    const h = document.createElement('h5');
    h.textContent = title;
    return h;
  }

  function reportNote() {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = t('summary.note');
    return p;
  }

  function stockTable(report) {
    const table = document.createElement('table');
    const head = table.insertRow();
    for (const name of ['stock', 'bought', 'sold', 'dividends', 'value', 'pnl', 'pct', 'annual'].map((k) => t(`col.${k}`))) {
      const th = document.createElement('th');
      th.textContent = name;
      head.append(th);
    }
    for (const r of report.stocks) {
      const stock = r.name ? r : data.stocks[r.stockIdx];
      const tr = table.insertRow();
      const m = (v) => Format.money(v, stock.currency);
      [r.name ? I18N.storedStockName(r.name) : nameOf(stock), m(r.bought), m(r.sold), m(r.dividends), m(r.value)].forEach((t) => { tr.insertCell().textContent = t; });
      const pnl = tr.insertCell();
      pnl.textContent = stock.currency === 'USD' ? Format.usdSigned(r.pnl) : Format.krwSigned(r.pnl);
      pnl.className = UI.signClass(r.pnl);
      const pct = tr.insertCell();
      pct.textContent = Format.pct(r.pnlPct);
      pct.className = UI.signClass(r.pnlPct);
      const annual = tr.insertCell();
      annual.textContent = r.annualPct === null ? '-' : Format.pct(r.annualPct);
      annual.className = r.annualPct === null ? '' : UI.signClass(r.annualPct);
    }
    return table;
  }

  function summaryRowValue(v) { return [Format.krwSigned(v), UI.signClass(v)]; }

  function summaryRow(label, value, cls) {
    const row = document.createElement('div');
    row.className = 'row';
    const name = document.createElement('span');
    name.textContent = label;
    const num = document.createElement('b');
    num.textContent = value;
    if (cls) num.className = cls;
    row.append(name, num);
    return row;
  }

  UI.showReport = function (record) {
    const saved = record && record.report ? record : null;
    const r = saved ? saved.report : Engine.report(data, UI.state);
    UI.setText($('summaryNote'), saved ? t('summary.savedNote', { name: I18N.recordName(saved.name) }) : '');
    for (const id of ['summarySave', 'summaryRestart', 'summaryNew']) $(id).hidden = Boolean(saved);
    const share = (v) => `${Format.krw(v)} (${r.total > 0 ? (v / r.total * 100).toFixed(1) : '0.0'}%)`;
    const signed = (v) => summaryRowValue(v);
    const annual = (v) => t('annual', { pct: v === null ? '-' : Format.pct(v) });
    const withReturns = (pnl, pct, yearly) => [`${Format.krwSigned(pnl)} (${Format.pct(pct)}, ${annual(yearly)})`, UI.signClass(pnl)];
    UI.setText($('summaryPeriod'), t('range', { from: Format.date(r.startDate), to: Format.date(r.endDate) }));
    $('summaryRows').replaceChildren(
      ...(!saved && thisGameTrophies ? trophySection() : []),
      section(t('summary.result')),
      summaryRow(t('summary.total'), Format.krw(r.total)),
      summaryRow(t('summary.contributed'), Format.krw(r.contributed)),
      summaryRow(t('summary.pnl'), ...withReturns(r.pnl, r.pnlPct, r.annualPct)),
      summaryRow(t('chart.ifKospi'), ...withReturns(r.kospiPnl, r.kospiPct, r.kospiAnnualPct)),
      summaryRow(t('chart.ifSp'), ...withReturns(r.spPnl, r.spPct, r.spAnnualPct)),
      summaryRow(t('summary.vsKospi'), ...signed(r.vsKospi)),
      summaryRow(t('summary.vsSp'), ...signed(r.vsSp)),
      summaryRow(t('summary.best', { date: Format.date(r.best.date) }), ...signed(r.best.pnl)),
      summaryRow(t('summary.worst', { date: Format.date(r.worst.date) }), ...signed(r.worst.pnl)),
      section(t('summary.assets')),
      summaryRow(t('summary.krw'), share(r.assets.krw)),
      summaryRow(t('summary.usdKrw'), share(r.assets.usdKrw)),
      summaryRow(t('summary.bond'), share(r.assets.bondKrw)),
      summaryRow(t('summary.stock'), share(r.assets.stockKrw)),
      section(t('summary.trades')),
      summaryRow(t('summary.manual'), t('summary.twoCounts', { a: r.counts.buys, b: r.counts.sells })),
      summaryRow(t('summary.autoRuns'), t('summary.twoCounts', { a: r.counts.autoBuys, b: r.counts.skips })),
      summaryRow(t('summary.dividends'), Format.krw(r.dividendsKrw)),
      summaryRow(t('summary.interest'), Format.krw(r.interestKrw)),
      summaryRow(t('summary.fxFees'), Format.krw(r.fxFeesKrw)),
      summaryRow(t('summary.tradeFees'), Format.krw(r.tradeFeesKrw)),
      section(t('summary.byStock')),
      stockTable(r),
      reportNote(),
    );
    $('summary').hidden = false;
    $('summaryRows').scrollTop = 0;
  };

  // 끝까지 가면 보고서를 띄우고 기록에 남긴다.
  UI.onEnd = async function () {
    finishGame();
    UI.showReport();
    try {
      const records = await Saves.listRecords();
      const name = Records.nextName(records);
      const createdAt = new Date().toISOString();
      await Saves.putRecord(Records.make(data, UI.state, { id: `rec-${Date.now()}`, name, createdAt }));
      UI.setText($('summaryNote'), t('summary.recorded', { name: I18N.recordName(name) }));
    } catch {
      UI.setText($('summaryNote'), t('summary.recordFailed'));
    }
  };

  // ---------- 투자 기록 비교 ----------

  let shownRecords = [];
  const leftOut = new Set();

  async function drawRecords() {
    const body = $('recordsBody');
    shownRecords = [];
    let records = [];
    try {
      records = await Saves.listRecords();
    } catch {
      body.textContent = t('records.cantRead');
      return;
    }
    if (!records.length) {
      body.textContent = t('records.none');
      return;
    }
    shownRecords = records;
    const best = Records.bestId(records);
    const table = document.createElement('table');
    const head = table.createTHead().insertRow();
    for (const name of ['', ...['name', 'period', 'contributed', 'total', 'pnl', 'pct', 'annual', 'kospiAnnual', 'spAnnual', 'trades', 'fees', 'settings'].map((k) => t(`col.${k}`)), '']) {
      const th = document.createElement('th');
      th.textContent = name;
      head.append(th);
    }
    const tbody = table.createTBody();
    const annual = (v) => (v === null ? '-' : Format.pct(v));
    for (const rec of records) {
      const r = rec.report;
      const tr = tbody.insertRow();
      const pick = document.createElement('input');
      pick.type = 'checkbox';
      pick.className = 'pickRec';
      pick.setAttribute('aria-label', t('records.pick', { name: I18N.recordName(rec.name) }));
      pick.checked = !leftOut.has(rec.id);
      pick.addEventListener('change', () => {
        if (pick.checked) leftOut.delete(rec.id);
        else leftOut.add(rec.id);
        UI.setText($('recordsMsg'), '');
      });
      tr.insertCell().append(pick);
      const name = tr.insertCell();
      name.textContent = I18N.recordName(rec.name);
      if (rec.id === best) {
        const mark = document.createElement('span');
        mark.className = 'bestMark';
        mark.textContent = t('records.best');
        name.append(mark);
      }
      const cells = [
        t('range', { from: Format.date(r.startDate), to: Format.date(r.endDate) }), Format.krwShort(r.contributed), Format.krwShort(r.total),
      ];
      for (const text of cells) tr.insertCell().textContent = text;
      const signed = (text, v) => { const c = tr.insertCell(); c.textContent = text; c.className = UI.signClass(v); };
      signed(Format.krwSignedShort(r.pnl), r.pnl);
      signed(Format.pct(r.pnlPct), r.pnlPct);
      signed(annual(r.annualPct), r.annualPct || 0);
      signed(annual(r.kospiAnnualPct), r.kospiAnnualPct || 0);
      signed(annual(r.spAnnualPct), r.spAnnualPct || 0);
      tr.insertCell().textContent = t('summary.twoCounts', { a: r.counts.buys + r.counts.sells, b: r.counts.autoBuys });
      tr.insertCell().textContent = Format.krwShort(Records.feeTotal(r));
      const cond = tr.insertCell();
      cond.className = 'wrap';
      const s = rec.settings;
      const base = t('records.base', { krw0: Format.krwShort(s.krw0), monthly: Format.krwShort(s.monthlyKrw) });
      const rules = Records.rulesOf(rec);
      cond.textContent = rules.length ? `${base} · ${rules.join(', ')}` : base;
      const acts = tr.insertCell();
      for (const [act, label] of [['view', t('records.view')], ['rename', t('records.rename')], ['delete', t('delete')]]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn';
        b.dataset.act = act;
        b.textContent = label;
        b.addEventListener('click', () => onRecordAction(act, rec));
        acts.append(b);
      }
    }
    body.replaceChildren(table);
  }

  async function onRecordAction(act, rec) {
    if (act === 'view') {
      UI.showReport(rec);
      return;
    }
    if (act === 'rename') {
      const shown = I18N.recordName(rec.name);
      const name = globalThis.prompt(t('records.namePrompt'), shown);
      if (!name || !name.trim() || name.trim() === shown) return;
      await Saves.putRecord({ ...rec, name: name.trim() });
    }
    if (act === 'delete') {
      if (!globalThis.confirm(t('records.deleteAsk', { name: I18N.recordName(rec.name) }))) return;
      await Saves.deleteRecord(rec.id);
    }
    drawRecords();
  }

  function openRecords() {
    if (UI.playing) UI.pause();
    UI.setText($('recordsMsg'), '');
    $('records').hidden = false;
    drawRecords();
  }

  // ---------- 비교 리포트 ----------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const annualText = (v) => (v === null || v === undefined ? '-' : Format.pct(v));

  function barSection(c) {
    const rows = c.ranked.map((r) => ({ name: I18N.recordName(r.name), value: r.report.annualPct, color: COLOR.mine, ref: false }));
    if (c.baseline) {
      rows.push({ name: t('chart.ifKospi'), value: c.baseline.kospi, color: COLOR.kospi, ref: true });
      rows.push({ name: t('chart.ifSp'), value: c.baseline.sp, color: COLOR.sp, ref: true });
    }
    const top = Math.max(1, ...rows.map((r) => Math.abs(r.value || 0)));
    const wrap = el('div');
    for (const r of rows) {
      const row = el('div', `barRow${r.ref ? ' ref' : ''}`);
      const track = el('div', 'barTrack');
      if (r.value !== null) {
        const fill = el('span', 'barFill');
        fill.style.width = `${Math.abs(r.value) / top * 100}%`;
        fill.style.background = r.value < 0 ? '#5b9bff' : r.color;
        track.append(fill);
      }
      row.append(el('span', 'nm', r.name), track, el('span', 'num', annualText(r.value)));
      wrap.append(row);
    }
    return wrap;
  }

  function reportTable(className, headers, rows) {
    const table = el('table', className);
    const head = table.createTHead().insertRow();
    for (const h of headers) head.append(el('th', '', h));
    const tbody = table.createTBody();
    for (const cells of rows) {
      const tr = tbody.insertRow();
      for (const c of cells) {
        const td = tr.insertCell();
        if (c && typeof c === 'object') {
          td.textContent = c.text;
          if (c.value) td.className = UI.signClass(c.value);
        } else td.textContent = c;
      }
    }
    return table;
  }

  function summaryLines(c) {
    const out = [];
    const [first, second] = c.ranked;
    if (first && first.rank) {
      out.push(el('p', 'lead', t('cmp.first', { name: I18N.recordName(first.name), pct: annualText(first.report.annualPct) })
        + (second && second.rank ? t('cmp.second', { name: I18N.recordName(second.name), gap: Math.abs(second.gap).toFixed(1) }) : '')));
      out.push(el('p', 'lead', t('cmp.beat', { n: c.measured, kospi: c.beatKospi, sp: c.beatSp })));
    } else {
      out.push(el('p', 'lead', t('cmp.noneMeasured')));
    }
    if (!c.samePeriod) out.push(el('p', 'warnLine', t('cmp.periodWarn')));
    else if (!c.sameMoney) out.push(el('p', 'warnLine', t('cmp.moneyWarn')));
    return out;
  }

  function leaderValue(l) {
    if (l.key === 'annual' || l.key === 'pct') return Format.pct(l.value);
    if (l.key === 'pnl') return Format.krwSignedShort(l.value);
    return Format.krwShort(l.value);
  }

  function showCompare() {
    const chosen = shownRecords.filter((r) => !leftOut.has(r.id));
    if (chosen.length < 2) {
      UI.setText($('recordsMsg'), t('records.pickTwo'));
      return;
    }
    const c = Records.compare(chosen);
    const ranking = reportTable('rankTable',
      ['rank', 'name', 'annual', 'gap', 'pct', 'pnl', 'total', 'contributed', 'fees', 'kospiAnnual', 'spAnnual'].map((k) => t(`col.${k}`)),
      c.ranked.map((r) => [
        r.rank || '-', I18N.recordName(r.name),
        { text: annualText(r.report.annualPct), value: r.report.annualPct },
        r.gap === null ? '-' : r.gap === 0 ? t('cmp.top') : t('cmp.gap', { gap: r.gap.toFixed(1).replace('-', '−') }),
        { text: Format.pct(r.report.pnlPct), value: r.report.pnlPct },
        { text: Format.krwSignedShort(r.report.pnl), value: r.report.pnl },
        Format.krwShort(r.report.total), Format.krwShort(r.report.contributed), Format.krwShort(Records.feeTotal(r.report)),
        annualText(r.report.kospiAnnualPct), annualText(r.report.spAnnualPct),
      ]));
    const leaders = el('div', 'leaderList');
    for (const l of c.leaders) {
      const box = el('div');
      box.append(el('small', '', t(`lead.${l.key}`)), el('b', '', I18N.recordName(l.name)), document.createTextNode(` ${leaderValue(l)}`));
      leaders.append(box);
    }
    const stockRows = c.stocks.map((s) => [I18N.storedStockName(s.name), ...c.ranked.map((r) => {
      const cell = s.cells[r.id];
      return cell ? { text: t('cmp.cell', { pct: Format.pct(cell.pnlPct), annual: annualText(cell.annualPct) }), value: cell.pnlPct } : '-';
    })]);
    const conditions = el('div');
    for (const r of c.ranked) {
      const row = el('div', 'condRow');
      const s = r.settings;
      const base = t('cmp.base', { krw0: Format.krwShort(s.krw0), usd: s.usd0 ? ` + ${Format.usd(s.usd0)}` : '', monthly: Format.krwShort(s.monthlyKrw) });
      const trades = t('cmp.trades', { manual: r.report.counts.buys + r.report.counts.sells, auto: r.report.counts.autoBuys });
      const period = t('range', { from: Format.date(r.report.startDate), to: Format.date(r.report.endDate) });
      row.append(el('b', '', I18N.recordName(r.name)), el('span', '', `${period} · ${base} · ${trades}${r.rules.length ? ` · ${r.rules.join(', ')}` : ''}`));
      conditions.append(row);
    }
    $('compareBody').replaceChildren(
      section(t('cmp.summary')), ...summaryLines(c),
      section(t('cmp.bars')), barSection(c),
      section(t('cmp.ranking')), ranking,
      section(t('cmp.leaders')), leaders,
      section(t('cmp.byStock')),
      c.stocks.length ? reportTable('stockCompare', [t('col.stock'), ...c.ranked.map((r) => I18N.recordName(r.name))], stockRows) : el('p', 'note', t('cmp.noStocks')),
      section(t('cmp.conditions')), conditions,
      el('p', 'note', t('cmp.note')),
    );
    $('compare').hidden = false;
    $('compareBody').scrollTop = 0;
  }

  // ---------- 다시 시작 ----------

  // 다시 시작: 같은 조건과 자동투자로 게임 첫날부터.
  UI.restart = function () {
    if (UI.playing) UI.pause();
    if (!globalThis.confirm(t('confirm.restart'))) return;
    $('summary').hidden = true;
    fileHandle = null;
    browserSlot = null;
    UI.loadState(Engine.restartGame(data, UI.state));
  };

  // 새로 시작: 설정 화면으로.
  UI.newStart = function () {
    if (UI.playing) UI.pause();
    if (!globalThis.confirm(t('confirm.newStart'))) return;
    $('summary').hidden = true;
    $('game').hidden = true;
    UI.state = null;
    UI.view = null;
    fileHandle = null;
    browserSlot = null;
    hideHover();
    showStart();
  };

  // ---------- 저장과 불러오기 ----------

  let fileHandle = null;
  let browserSlot = null;

  function flashSave(text) {
    const btn = $('save');
    btn.textContent = text;
    setTimeout(() => { btn.textContent = t('save'); }, 1500);
  }

  UI.save = async function () {
    if (UI.playing || !UI.state) return;
    try {
      if (Saves.canPickFiles()) {
        const out = await Saves.saveToFile(Saves.serialize(data, UI.state), fileHandle);
        if (out === null) return; // 선택 창 취소
        fileHandle = out;
        await Saves.remember(out, Saves.summary(data, UI.state));
      } else {
        await saveInBrowser();
      }
      flashSave(t('saved'));
    } catch {
      flashSave(t('saveFailed'));
    }
  };

  async function saveInBrowser() {
    browserSlot = await Saves.saveToBrowser(Saves.serialize(data, UI.state), Saves.summary(data, UI.state), browserSlot);
  }

  // 핸드폰은 다른 앱으로 넘어가면 탭이 닫힐 수 있어 화면을 벗어날 때 저장해 둔다.
  function autoSaveOnHide() {
    const s = UI.state;
    if (document.visibilityState !== 'hidden' || !s || Saves.canPickFiles()) return;
    if (!s.events.length && s.dayIdx === s.startIdx) return;
    saveInBrowser().catch(() => {});
  }

  // 세이브 내용으로 게임을 연다. 잘못된 파일이면 지금 게임을 건드리지 않고 사유를 보여 준다.
  UI.loadSaveText = function (text, handle = null, slot = null) {
    const r = Saves.parse(text, data);
    if (!r.ok) {
      UI.setText($('loadMsg'), r.reason);
      return { ok: false, reason: r.reason };
    }
    if (r.warn && !globalThis.confirm(t('load.anyway', { warn: r.warn }))) {
      UI.setText($('loadMsg'), r.warn);
      return { ok: false, reason: r.warn };
    }
    const previous = { state: UI.state, handle: fileHandle, slot: browserSlot };
    try {
      fileHandle = handle;
      browserSlot = slot;
      UI.loadState(r.state);
    } catch {
      fileHandle = previous.handle;
      browserSlot = previous.slot;
      const reason = t('load.badContent');
      if (previous.state) UI.loadState(previous.state);
      else { $('game').hidden = true; UI.state = null; $('start').hidden = false; }
      UI.setText($('loadMsg'), reason);
      return { ok: false, reason };
    }
    UI.setText($('loadMsg'), '');
    return { ok: true };
  };

  async function loadFromFile() {
    try {
      const f = await Saves.openFile();
      if (f) UI.loadSaveText(f.text, f.handle);
    } catch {
      UI.setText($('loadMsg'), t('save.unreadable'));
    }
  }

  async function drawRecent() {
    const list = $('recent');
    const rows = await Saves.recent();
    list.replaceChildren();
    if (!rows.length) {
      const none = document.createElement('p');
      none.className = 'empty';
      none.textContent = t('start.noRecent');
      list.append(none);
      return;
    }
    for (const row of rows) {
      const line = document.createElement('div');
      line.className = 'saveRow';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'row';
      btn.dataset.act = 'open';
      const left = document.createElement('span');
      left.textContent = row.inBrowser ? t('start.browserGame', { date: Format.date(row.gameDate) }) : row.name;
      const when = document.createElement('small');
      when.style.display = 'block';
      when.textContent = t('start.savedOn', { date: Format.date(row.gameDate), saved: Format.date(row.savedAt.slice(0, 10)) });
      left.append(when);
      const right = document.createElement('span');
      right.className = 'num';
      right.textContent = Format.krwShort(row.total);
      const rate = document.createElement('small');
      rate.style.display = 'block';
      rate.className = UI.signClass(row.pnlPct);
      rate.textContent = Format.pct(row.pnlPct);
      right.append(rate);
      btn.append(left, right);
      btn.addEventListener('click', async () => {
        try {
          const f = await Saves.readRecent(row);
          if (f) UI.loadSaveText(f.text, f.handle, f.slot || null);
        } catch {
          UI.setText($('loadMsg'), t('start.fileMissing'));
        }
      });
      line.append(btn);
      if (row.inBrowser) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn';
        del.dataset.act = 'delete';
        del.textContent = t('delete');
        del.addEventListener('click', async () => {
          if (globalThis.confirm && !globalThis.confirm(t('start.deleteSave'))) return;
          await Saves.deleteRecent(row.name);
          drawRecent();
        });
        line.append(del);
      }
      list.append(line);
    }
  }

  // ---------- 시작 화면 ----------

  function readSettings() {
    const num = (id) => UI.parseNumber($(id).value);
    const settings = {
      startDate: $('sDate').value,
      krw0: num('sKrw'),
      usd0: num('sUsd'),
      monthlyKrw: num('sMonthly'),
      fxFeePct: num('sFx'),
      tradeFeePct: num('sTrade'),
      sellTaxPct: num('sTax'),
    };
    if (!(settings.krw0 >= 0)) return { error: t('err.krw0') };
    if (!(settings.usd0 >= 0)) return { error: t('err.usd0') };
    if (!(settings.monthlyKrw >= 0)) return { error: t('err.monthly') };
    if (settings.krw0 + settings.usd0 + settings.monthlyKrw <= 0) return { error: t('err.noMoney') };
    for (const [key, name] of [['fxFeePct', 'err.fxFee'], ['tradeFeePct', 'err.tradeFee'], ['sellTaxPct', 'err.tax']]) {
      if (!(settings[key] >= 0 && settings[key] < 100)) return { error: t('err.pctRange', { name: t(name) }) };
    }
    const first = data.dates[0];
    const last = data.dates[data.dates.length - 2];
    if (!settings.startDate || settings.startDate < first || settings.startDate > last) {
      return { error: t('err.startDate', { first: Format.date(first), last: Format.date(last) }) };
    }
    return { settings };
  }

  function onNewGame(event) {
    event.preventDefault();
    const r = readSettings();
    UI.setText($('sMsg'), r.error || '');
    if (!r.error) {
      fileHandle = null;
      browserSlot = null;
      UI.startGame(r.settings);
    }
  }

  function showStart() {
    $('sDate').min = data.dates[0];
    $('sDate').max = data.dates[data.dates.length - 2];
    $('start').hidden = false;
    drawRecent();
  }

  // 핸드폰에는 기록 칸을 둘 자리가 없어 '내역' 탭 안으로 옮긴다. style.css의 핸드폰 조건과 같다.
  const phoneWidth = globalThis.matchMedia('(max-width: 760px)');
  function placeLog() {
    if (phoneWidth.matches) $('p-log').append($('log'));
    else {
      $('game').append($('log'));
      if (UI.activeTab === 'log') selectTab('stock');
    }
  }

  // 핸드폰에서는 누른 쪽을 크게 본다. 'chart'면 매매 칸이, 'trade'면 그래프가 접힌다.
  function setFocus(area) {
    if (!phoneWidth.matches || $('game').dataset.focus === area) return;
    $('game').dataset.focus = area;
    hideHover(); // 값 상자는 접히기 전 위치에 맞춰져 있다
  }

  // 가로 안내가 화면을 가리는 동안 몰래 재생되지 않게 멈춘다. style.css의 #rotateNotice 조건과 같다.
  const phoneLandscape = globalThis.matchMedia('(orientation: landscape) and (max-height: 500px) and (min-width: 520px) and (pointer: coarse)');

  function setMenu(open) {
    $('topMenu').classList.toggle('open', open);
    $('moreBtn').setAttribute('aria-expanded', String(open));
  }

  function selectTab(name) {
    UI.activeTab = name;
    for (const b of $('tabs').children) b.classList.toggle('on', b.dataset.t === name);
    for (const p of document.querySelectorAll('.pane')) p.classList.toggle('on', p.id === `p-${name}`);
    UI.refresh();
  }

  function wire() {
    $('play').addEventListener('click', () => (UI.playing ? UI.pause() : UI.play()));
    $('speed').addEventListener('click', (e) => { if (e.target.dataset.speed) UI.setSpeed(Number(e.target.dataset.speed)); });
    $('tabs').addEventListener('click', (e) => { if (e.target.dataset.t) selectTab(e.target.dataset.t); });
    placeLog();
    phoneWidth.addEventListener('change', placeLog);
    phoneLandscape.addEventListener('change', (e) => { if (e.matches && UI.playing) UI.pause(); });
    // 스크롤은 click이 생기지 않으므로 목록을 미는 동안에는 접히지 않는다. 메뉴를 닫는 터치도 건너뛴다.
    const focusOn = (area) => () => { if (!$('topMenu').classList.contains('open')) setFocus(area); };
    document.querySelector('.left').addEventListener('click', focusOn('chart'));
    document.querySelector('.right').addEventListener('click', focusOn('trade'));
    $('moreBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      setMenu(!$('topMenu').classList.contains('open'));
    });
    document.addEventListener('click', () => setMenu(false));
    $('stockSearch').addEventListener('input', (e) => {
      stockFilter.query = e.target.value.trim().toLowerCase();
      filterHits.clear();
      UI.refresh();
    });
    $('stockBoard').addEventListener('click', (e) => {
      if (!e.target.dataset.board) return;
      stockFilter.board = e.target.dataset.board;
      filterHits.clear();
      for (const b of $('stockBoard').children) b.classList.toggle('on', b === e.target);
      UI.refresh();
    });
    $('side').addEventListener('click', (e) => {
      const side = e.target.dataset.side;
      if (!side || UI.playing) return;
      UI.side = side;
      for (const b of $('side').children) b.classList.toggle('on', b.dataset.side === side);
      UI.setText($('oMsg'), '');
      UI.refresh();
    });
    $('oQty').addEventListener('input', () => { UI.setText($('oMsg'), ''); drawOrder(); });
    $('oGo').addEventListener('click', placeOrder);
    $('oAll').addEventListener('click', (e) => { e.preventDefault(); sellAll(); });
    $('log').addEventListener('scroll', onLogScroll);
    $('save').addEventListener('click', UI.save);
    $('exportBtn').addEventListener('click', () => { if (UI.state) Saves.downloadFile(Saves.serialize(data, UI.state)); });
    document.addEventListener('visibilitychange', autoSaveOnHide);
    $('newGame').addEventListener('submit', onNewGame);
    $('loadFile').addEventListener('click', loadFromFile);
    $('summaryClose').addEventListener('click', () => { $('summary').hidden = true; });
    $('summarySave').addEventListener('click', UI.save);
    $('summaryRestart').addEventListener('click', UI.restart);
    $('summaryNew').addEventListener('click', UI.newStart);
    $('restart').addEventListener('click', UI.restart);
    $('newStart').addEventListener('click', UI.newStart);
    $('reportBtn').addEventListener('click', () => UI.showReport());
    $('historyBtn').addEventListener('click', openRecords);
    $('trophyBtn').addEventListener('click', openRoom);
    $('trophyStart').addEventListener('click', openRoom);
    $('roomBack').addEventListener('click', closeRoom);
    $('roomTabs').addEventListener('click', (e) => {
      if (!e.target.dataset.k) return;
      roomTab = e.target.dataset.k;
      drawRoom();
    });
    Saves.loadAchievements().then((saved) => { if (saved) UI.achievements = saved; }).catch(() => {});
    $('historyStart').addEventListener('click', openRecords);
    $('recordsClose').addEventListener('click', () => { $('records').hidden = true; });
    $('compareBtn').addEventListener('click', showCompare);
    $('compareClose').addEventListener('click', () => { $('compare').hidden = true; });
    const box = $('chartbox');
    box.addEventListener('mousemove', onChartMove);
    box.addEventListener('mouseleave', hideHover);
    const onTouch = (e) => { if (e.touches[0]) onChartMove({ clientX: e.touches[0].clientX }); };
    box.addEventListener('touchstart', onTouch, { passive: true });
    box.addEventListener('touchmove', onTouch, { passive: true });
    document.addEventListener('touchstart', (e) => { if (!box.contains(e.target)) hideHover(); }, { passive: true });
    // 화면을 돌리면 그래프 칸의 크기가 정해진 뒤에 다시 그려야 그림이 찌그러지지 않는다.
    new ResizeObserver(() => { if (UI.state && !$('game').hidden) drawChart(); }).observe($('chartbox'));
  }

  // 언어는 시작 화면에서만 바꾼다. 진행 중인 게임이 없으니 새로고침으로 모든 문구를 다시 그린다.
  function wireLanguage() {
    I18N.mountPicker($('langPick'), (code) => {
      if (UI.state) return;
      I18N.setLang(code);
    });
  }

  I18N.applyStatic();
  buildStockList();
  wire();
  wireLanguage();
  showStart();
  globalThis.UI = UI;
})();
