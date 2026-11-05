// 화면 연결. 규칙은 Engine에 있고, 여기서는 상태를 그리고 입력을 전달한다.
(function () {
  const data = globalThis.GAME_DATA;
  const $ = (id) => document.getElementById(id);
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
    UI.setText($('tFx'), `달러 · ${Math.round(data.fx[s.dayIdx]).toLocaleString('en-US')}원`);
    UI.setText($('tUsd'), Format.usd(Math.round(v.usd)));
    UI.setText($('tBond'), Format.krwShort(v.bondKrw));
    const ended = s.dayIdx >= data.dates.length - 1;
    $('reportBtn').hidden = !ended;
    if (!UI.playing) $('play').disabled = ended;
  }

  // ---------- 그래프 ----------

  function marksFor(view) {
    const s = UI.state;
    const out = [];
    let series = null;
    if (view !== null) series = Engine.adjustedSeries(data, view, s.dayIdx);
    for (const e of s.events) {
      const manual = e.type === 'buy' || e.type === 'sell' || e.type === 'rule_sell';
      if (view === null) {
        if (manual) out.push({ idx: e.d, kind: e.type === 'buy' ? 'B' : 'S', value: s.history.pnl[e.d - s.startIdx] });
        if (e.type === 'auto_buy') out.push({ idx: e.d, kind: 'auto', value: s.history.pnl[e.d - s.startIdx] });
      } else if (e.stockIdx === view && (manual || e.type === 'auto_buy')) {
        const kind = e.type === 'buy' ? 'B' : e.type === 'auto_buy' ? 'auto' : 'S';
        out.push({ idx: e.d, kind, value: series[e.d] });
      }
    }
    return out.sort((a, b) => (a.kind === 'auto' ? -1 : 0) - (b.kind === 'auto' ? -1 : 0));
  }

  function drawMainChart() {
    const s = UI.state;
    const h = s.history;
    const k = h.pnl.length - 1;
    UI.setText($('crumb'), '');
    $('crumb').innerHTML = '<h4>내 손익</h4>';
    const legendItems = [
      ['내 투자', COLOR.mine, h.pnl[k]], ['코스피에 넣었다면', COLOR.kospi, h.kospi[k]], ['S&P 500에 넣었다면', COLOR.sp, h.sp[k]],
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
    legend.insertAdjacentHTML('beforeend',
      '<span><span class="mk up">B</span> 매수</span><span><span class="mk down">S</span> 매도</span><span><span class="mk up">•</span> 자동투자</span><span class="note">지수는 배당 제외 가격지수</span>');
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
    back.textContent = '← 내 손익';
    back.addEventListener('click', () => UI.showStock(null));
    const title = document.createElement('h4');
    title.textContent = stock.name;
    const now = document.createElement('span');
    const listing = Engine.listingIdx(data, i);
    now.textContent = price == null
      ? `상장 전 · ${listing < 0 ? '' : `${Format.date(data.dates[listing])} 상장`}`
      : `${Format.price(stock, price)} `;
    if (change != null) now.append(changeNode(change));
    crumb.append(back, title, now);

    const h = s.holdings[i];
    const legend = $('legend');
    legend.innerHTML = '';
    const hold = document.createElement('span');
    if (h) {
      const rate = price == null ? 0 : (price / h.avgCost - 1) * 100;
      hold.textContent = `보유 ${Format.qty(h.qty)}주 · 평균 ${Format.price(stock, h.avgCost)} · ${Format.pct(rate)}`;
    } else {
      hold.textContent = '보유 없음';
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
    for (const [name, color, line] of [['코스피', COLOR.kospi, kospiLine], ['S&P 500', COLOR.sp, spLine]]) {
      const item = document.createElement('span');
      const swatch = document.createElement('i');
      swatch.style.background = color;
      const b = document.createElement('b');
      b.textContent = Format.pct(growth(line));
      item.append(swatch, `${name} `, b);
      legend.append(item);
    }
    legend.insertAdjacentHTML('beforeend',
      '<span><span class="mk up">B</span> 매수</span><span><span class="mk down">S</span> 매도</span><span><span class="mk up">•</span> 자동투자</span><span class="note">지수는 첫날 주가와 같은 출발점으로 환산</span>');
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
      tickOptions: { includeZero: false, minSpan: stock.currency === 'USD' ? 1 : 100 },
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
      lines.push(`내 투자 ${Format.krwSignedShort(s.history.pnl[k])}`);
      lines.push(`코스피 ${Format.krwSignedShort(s.history.kospi[k])}`);
      lines.push(`S&P 500 ${Format.krwSignedShort(s.history.sp[k])}`);
    } else {
      const stock = data.stocks[UI.view];
      const price = Engine.lastClose(data, UI.view, idx);
      lines.push(`종가 ${price == null ? '상장 전' : Format.price(stock, price)}`);
    }
    const shown = s.events.filter((e) => e.d === idx && (UI.view === null || e.stockIdx === UI.view));
    for (const e of shown.slice(0, 4)) {
      const line = Format.eventLine(data, e);
      lines.push(`${line.label} ${line.text}`);
    }
    if (shown.length > 4) lines.push(`외 ${shown.length - 4}건`);
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
    empty.textContent = '보유한 주식이 없습니다.';
    list.append(empty);
    data.stocks.forEach((stock, i) => {
      const row = document.createElement('div');
      row.className = 'row pick';
      row.dataset.i = i;
      const name = document.createElement('span');
      name.className = 'nm';
      name.textContent = stock.name;
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
    });
  }

  const rows = [];

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
    const none = selling && !Object.keys(s.holdings).length;
    if (empty.hidden === none) empty.hidden = !none;
    rows.forEach((r, i) => {
      const hide = selling && !s.holdings[i];
      if (r.row.hidden !== hide) r.row.hidden = hide;
      if (hide) return;
      const stock = data.stocks[i];
      const price = Engine.lastClose(data, i, s.dayIdx);
      const status = Engine.tradeStatus(data, s, i);
      UI.setText(r.price, price == null ? '' : Format.priceBare(stock, price));
      const change = dayChange(i);
      let label = '';
      let cls = '';
      if (price == null) label = '상장 전';
      else if (!status.ok) label = status.reason;
      else if (change != null) { label = Format.pct(change); cls = UI.signClass(change); }
      UI.setText(r.change, label);
      r.change.className = cls;
      const h = s.holdings[i];
      UI.setText(r.hold, h ? `${Format.qty(h.qty)}주 보유` : '');
      const on = UI.selected === i && UI.view === i;
      if (r.row.classList.contains('on') !== on) r.row.classList.toggle('on', on);
    });
  }

  function orderQty() { return UI.parseNumber($('oQty').value); }

  function drawOrder() {
    const s = UI.state;
    const i = UI.selected;
    const stock = data.stocks[i];
    const status = Engine.tradeStatus(data, s, i);
    const price = stock.close[s.dayIdx];
    UI.setText($('oName'), stock.name);
    UI.setText($('oPrice'), status.ok ? Format.price(stock, price) : status.reason);
    const qty = orderQty();
    const valid = status.ok && Number.isFinite(qty) && qty > 0;
    let amount = '-';
    if (valid) {
      const gross = qty * price;
      const rate = UI.side === 'buy' ? s.settings.tradeFeePct : -Engine.sellCostPct(s.settings, stock);
      amount = Format.money(Engine.roundMoney(gross * (1 + rate / 100), stock.currency), stock.currency);
    }
    UI.setText($('oAmt'), amount);
    const go = $('oGo');
    go.className = `go ${UI.side}`;
    UI.setText(go, UI.side === 'buy' ? '매수' : '매도');
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
    UI.setText(msg, r.ok ? '' : r.reason);
    if (r.ok) UI.refresh();
  }

  function sellAll() {
    if (UI.playing) return;
    const r = Engine.sell(data, UI.state, UI.selected, 'all');
    UI.setText($('oMsg'), r.ok ? '' : r.reason);
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
        none.textContent = '아직 기록이 없습니다.';
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

  // ---------- 그리기와 재생 ----------

  UI.refresh = function () {
    if (!UI.state) return;
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
    $('play').textContent = '❚❚ 멈춤';
    setLocked(true);
    lastFrame = performance.now();
    carry = 0;
    rafId = requestAnimationFrame(tick);
  };

  UI.pause = function () {
    UI.playing = false;
    cancelAnimationFrame(rafId);
    $('play').textContent = '▶ 재생';
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
    $('exportBtn').hidden = Saves.canPickFiles();
    UI.view = null;
    UI.selected = 0;
    UI.side = 'buy';
    for (const b of $('side').children) b.classList.toggle('on', b.dataset.side === 'buy');
    UI.setText($('oMsg'), '');
    showGame();
    resetLog();
    setLocked(false);
    $('play').textContent = '▶ 재생';
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
    p.textContent = '원금 대비는 넣은 돈 전체에 대한 비율이고, 연환산은 돈이 들어가고 나온 날짜를 반영한 연 수익률(XIRR)입니다. '
      + '기간이 30일 미만이면 표시하지 않습니다. 달러 종목은 환율을 뺀 달러 기준입니다. 지수는 배당을 뺀 가격지수입니다.';
    return p;
  }

  function stockTable(report) {
    const table = document.createElement('table');
    const head = table.insertRow();
    for (const name of ['종목', '산 금액', '판 금액', '배당', '평가액', '손익', '원금 대비', '연환산']) {
      const th = document.createElement('th');
      th.textContent = name;
      head.append(th);
    }
    for (const r of report.stocks) {
      const stock = r.name ? r : data.stocks[r.stockIdx];
      const tr = table.insertRow();
      const m = (v) => Format.money(v, stock.currency);
      [stock.name, m(r.bought), m(r.sold), m(r.dividends), m(r.value)].forEach((t) => { tr.insertCell().textContent = t; });
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
    UI.setText($('summaryNote'), saved ? `${saved.name} · 저장된 보고서` : '');
    for (const id of ['summarySave', 'summaryRestart', 'summaryNew']) $(id).hidden = Boolean(saved);
    const share = (v) => `${Format.krw(v)} (${r.total > 0 ? (v / r.total * 100).toFixed(1) : '0.0'}%)`;
    const signed = (v) => summaryRowValue(v);
    const annual = (v) => (v === null ? '연 -' : `연 ${Format.pct(v)}`);
    const withReturns = (pnl, pct, yearly) => [`${Format.krwSigned(pnl)} (${Format.pct(pct)}, ${annual(yearly)})`, UI.signClass(pnl)];
    UI.setText($('summaryPeriod'), `${Format.date(r.startDate)} ~ ${Format.date(r.endDate)}`);
    $('summaryRows').replaceChildren(
      section('결과'),
      summaryRow('최종 자산', Format.krw(r.total)),
      summaryRow('넣은 돈', Format.krw(r.contributed)),
      summaryRow('손익', ...withReturns(r.pnl, r.pnlPct, r.annualPct)),
      summaryRow('코스피에 넣었다면', ...withReturns(r.kospiPnl, r.kospiPct, r.kospiAnnualPct)),
      summaryRow('S&P 500에 넣었다면', ...withReturns(r.spPnl, r.spPct, r.spAnnualPct)),
      summaryRow('코스피와 차이', ...signed(r.vsKospi)),
      summaryRow('S&P 500과 차이', ...signed(r.vsSp)),
      summaryRow(`가장 높았던 손익 (${Format.date(r.best.date)})`, ...signed(r.best.pnl)),
      summaryRow(`가장 낮았던 손익 (${Format.date(r.worst.date)})`, ...signed(r.worst.pnl)),
      section('자산 구성'),
      summaryRow('원화', share(r.assets.krw)),
      summaryRow('달러 (원화 환산)', share(r.assets.usdKrw)),
      summaryRow('채권', share(r.assets.bondKrw)),
      summaryRow('주식', share(r.assets.stockKrw)),
      section('매매 요약'),
      summaryRow('수동 매수 · 매도', `${r.counts.buys}회 · ${r.counts.sells}회`),
      summaryRow('자동투자 체결 · 건너뜀', `${r.counts.autoBuys}회 · ${r.counts.skips}회`),
      summaryRow('받은 배당', Format.krw(r.dividendsKrw)),
      summaryRow('받은 채권 이자', Format.krw(r.interestKrw)),
      summaryRow('낸 환전 수수료', Format.krw(r.fxFeesKrw)),
      summaryRow('낸 매매 수수료 · 거래세', Format.krw(r.tradeFeesKrw)),
      section('종목별 손익'),
      stockTable(r),
      reportNote(),
    );
    $('summary').hidden = false;
    $('summaryRows').scrollTop = 0;
  };

  // 끝까지 가면 보고서를 띄우고 기록에 남긴다.
  UI.onEnd = async function () {
    UI.showReport();
    try {
      const records = await Saves.listRecords();
      const name = Records.nextName(records);
      const createdAt = new Date().toISOString();
      await Saves.putRecord(Records.make(data, UI.state, { id: `rec-${Date.now()}`, name, createdAt }));
      UI.setText($('summaryNote'), `${name}로 기록에 남겼습니다.`);
    } catch {
      UI.setText($('summaryNote'), '기록을 남기지 못했습니다.');
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
      body.textContent = '이 브라우저에서는 기록을 읽을 수 없습니다.';
      return;
    }
    if (!records.length) {
      body.textContent = '아직 기록이 없습니다. 마지막 날까지 진행하면 남습니다.';
      return;
    }
    shownRecords = records;
    const best = Records.bestId(records);
    const table = document.createElement('table');
    const head = table.createTHead().insertRow();
    for (const name of ['', '이름', '기간', '넣은 돈', '최종 자산', '손익', '원금 대비', '연환산', '코스피 연환산', 'S&P 500 연환산', '매매(수동·자동)', '수수료', '조건', '']) {
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
      pick.setAttribute('aria-label', `${rec.name} 비교에 넣기`);
      pick.checked = !leftOut.has(rec.id);
      pick.addEventListener('change', () => {
        if (pick.checked) leftOut.delete(rec.id);
        else leftOut.add(rec.id);
        UI.setText($('recordsMsg'), '');
      });
      tr.insertCell().append(pick);
      const name = tr.insertCell();
      name.textContent = rec.name;
      if (rec.id === best) {
        const mark = document.createElement('span');
        mark.className = 'bestMark';
        mark.textContent = '최고';
        name.append(mark);
      }
      const cells = [
        `${Format.date(r.startDate)} ~ ${Format.date(r.endDate)}`, Format.krwShort(r.contributed), Format.krwShort(r.total),
      ];
      for (const text of cells) tr.insertCell().textContent = text;
      const signed = (text, v) => { const c = tr.insertCell(); c.textContent = text; c.className = UI.signClass(v); };
      signed(Format.krwSignedShort(r.pnl), r.pnl);
      signed(Format.pct(r.pnlPct), r.pnlPct);
      signed(annual(r.annualPct), r.annualPct || 0);
      signed(annual(r.kospiAnnualPct), r.kospiAnnualPct || 0);
      signed(annual(r.spAnnualPct), r.spAnnualPct || 0);
      tr.insertCell().textContent = `${r.counts.buys + r.counts.sells}회 · ${r.counts.autoBuys}회`;
      tr.insertCell().textContent = Format.krwShort(Records.feeTotal(r));
      const cond = tr.insertCell();
      cond.className = 'wrap';
      const s = rec.settings;
      const base = `초기 ${Format.krwShort(s.krw0)}, 월 ${Format.krwShort(s.monthlyKrw)}`;
      cond.textContent = rec.rules.length ? `${base} · ${rec.rules.join(', ')}` : base;
      const acts = tr.insertCell();
      for (const [act, label] of [['view', '보기'], ['rename', '이름'], ['delete', '삭제']]) {
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
      const name = globalThis.prompt('기록 이름', rec.name);
      if (!name || !name.trim()) return;
      await Saves.putRecord({ ...rec, name: name.trim() });
    }
    if (act === 'delete') {
      if (!globalThis.confirm(`${rec.name}을(를) 지울까요?`)) return;
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
    const rows = c.ranked.map((r) => ({ name: r.name, value: r.report.annualPct, color: COLOR.mine, ref: false }));
    if (c.baseline) {
      rows.push({ name: '코스피에 넣었다면', value: c.baseline.kospi, color: COLOR.kospi, ref: true });
      rows.push({ name: 'S&P 500에 넣었다면', value: c.baseline.sp, color: COLOR.sp, ref: true });
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
      out.push(el('p', 'lead', `연환산 1위는 ${first.name}(${annualText(first.report.annualPct)})입니다.`
        + (second && second.rank ? ` 2위 ${second.name}보다 연 ${Math.abs(second.gap).toFixed(1)}%p 높습니다.` : '')));
      out.push(el('p', 'lead', `연환산을 계산한 ${c.measured}개 기록 중 코스피를 이긴 기록은 ${c.beatKospi}개, S&P 500을 이긴 기록은 ${c.beatSp}개입니다.`));
    } else {
      out.push(el('p', 'lead', '연환산을 계산할 수 있는 기록이 없습니다. 기간이 30일 이상이어야 합니다.'));
    }
    if (!c.samePeriod) out.push(el('p', 'warnLine', '기간이 다른 기록이 섞여 있어 금액보다 연환산으로 비교하세요. 지수 기준선은 기간이 같을 때만 보여 줍니다.'));
    else if (!c.sameMoney) out.push(el('p', 'warnLine', '넣은 돈이 달라 금액보다 %로 비교하세요. 지수 기준선은 넣은 돈이 같을 때만 보여 줍니다.'));
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
      UI.setText($('recordsMsg'), '비교할 기록을 2개 이상 골라 주세요.');
      return;
    }
    const c = Records.compare(chosen);
    const ranking = reportTable('rankTable',
      ['순위', '이름', '연환산', '1위와 차이', '원금 대비', '손익', '최종 자산', '넣은 돈', '수수료', '코스피 연환산', 'S&P 500 연환산'],
      c.ranked.map((r) => [
        r.rank || '-', r.name,
        { text: annualText(r.report.annualPct), value: r.report.annualPct },
        r.gap === null ? '-' : r.gap === 0 ? '1위' : `${r.gap.toFixed(1).replace('-', '−')}%p`,
        { text: Format.pct(r.report.pnlPct), value: r.report.pnlPct },
        { text: Format.krwSignedShort(r.report.pnl), value: r.report.pnl },
        Format.krwShort(r.report.total), Format.krwShort(r.report.contributed), Format.krwShort(Records.feeTotal(r.report)),
        annualText(r.report.kospiAnnualPct), annualText(r.report.spAnnualPct),
      ]));
    const leaders = el('div', 'leaderList');
    for (const l of c.leaders) {
      const box = el('div');
      box.append(el('small', '', l.label), el('b', '', l.name), document.createTextNode(` ${leaderValue(l)}`));
      leaders.append(box);
    }
    const stockRows = c.stocks.map((s) => [s.name, ...c.ranked.map((r) => {
      const cell = s.cells[r.id];
      return cell ? { text: `${Format.pct(cell.pnlPct)} / 연 ${annualText(cell.annualPct)}`, value: cell.pnlPct } : '-';
    })]);
    const conditions = el('div');
    for (const r of c.ranked) {
      const row = el('div', 'condRow');
      const s = r.settings;
      const base = `초기 ${Format.krwShort(s.krw0)}${s.usd0 ? ` + ${Format.usd(s.usd0)}` : ''}, 월 ${Format.krwShort(s.monthlyKrw)}`;
      const trades = `수동 ${r.report.counts.buys + r.report.counts.sells}회, 자동 ${r.report.counts.autoBuys}회`;
      row.append(el('b', '', r.name), el('span', '', `${Format.date(r.report.startDate)} ~ ${Format.date(r.report.endDate)} · ${base} · ${trades}${r.rules.length ? ` · ${r.rules.join(', ')}` : ''}`));
      conditions.append(row);
    }
    $('compareBody').replaceChildren(
      section('요약'), ...summaryLines(c),
      section('연환산 비교'), barSection(c),
      section('순위'), ranking,
      section('항목별 1위'), leaders,
      section('종목별 손익 (원금 대비 / 연환산)'),
      c.stocks.length ? reportTable('stockCompare', ['종목', ...c.ranked.map((r) => r.name)], stockRows) : el('p', 'note', '거래한 종목이 없습니다.'),
      section('조건'), conditions,
      el('p', 'note', '연환산은 돈이 들어가고 나온 날짜를 반영한 연 수익률(XIRR)입니다. 달러 종목은 환율을 뺀 달러 기준이고, 지수는 배당을 뺀 가격지수입니다.'),
    );
    $('compare').hidden = false;
    $('compareBody').scrollTop = 0;
  }

  // ---------- 다시 시작 ----------

  // 다시 시작: 같은 조건과 자동투자로 게임 첫날부터.
  UI.restart = function () {
    if (UI.playing) UI.pause();
    if (!globalThis.confirm('같은 조건과 자동투자로 첫날부터 다시 할까요?\n저장하지 않은 진행 내용은 사라집니다.')) return;
    $('summary').hidden = true;
    fileHandle = null;
    browserSlot = null;
    UI.loadState(Engine.restartGame(data, UI.state));
  };

  // 새로 시작: 설정 화면으로.
  UI.newStart = function () {
    if (UI.playing) UI.pause();
    if (!globalThis.confirm('게임을 끝내고 설정 화면으로 돌아갈까요?\n저장하지 않은 내용과 자동투자 항목은 사라집니다.')) return;
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
    setTimeout(() => { btn.textContent = '저장'; }, 1500);
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
      flashSave('저장됨');
    } catch {
      flashSave('저장 실패');
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
    if (r.warn && !globalThis.confirm(`${r.warn}\n그래도 불러올까요?`)) {
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
      const reason = '세이브 파일의 내용이 잘못되었습니다';
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
      UI.setText($('loadMsg'), '세이브 파일을 읽을 수 없습니다');
    }
  }

  async function drawRecent() {
    const list = $('recent');
    const rows = await Saves.recent();
    list.replaceChildren();
    if (!rows.length) {
      const none = document.createElement('p');
      none.className = 'empty';
      none.textContent = '최근 저장이 없습니다.';
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
      left.textContent = row.inBrowser ? `${Format.date(row.gameDate)} 게임` : row.name;
      const when = document.createElement('small');
      when.style.display = 'block';
      when.textContent = `${Format.date(row.gameDate)} · ${Format.date(row.savedAt.slice(0, 10))} 저장`;
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
          UI.setText($('loadMsg'), '파일을 찾을 수 없습니다. 옮겼다면 "세이브 파일 불러오기"로 열어 주세요.');
        }
      });
      line.append(btn);
      if (row.inBrowser) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn';
        del.dataset.act = 'delete';
        del.textContent = '삭제';
        del.addEventListener('click', async () => {
          if (globalThis.confirm && !globalThis.confirm('이 저장을 지울까요?')) return;
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
    if (!(settings.krw0 >= 0)) return { error: '초기 자금(원화)은 0 이상의 숫자여야 합니다' };
    if (!(settings.usd0 >= 0)) return { error: '초기 자금(달러)은 0 이상의 숫자여야 합니다' };
    if (!(settings.monthlyKrw >= 0)) return { error: '월 추가 투자금은 0 이상의 숫자여야 합니다' };
    if (settings.krw0 + settings.usd0 + settings.monthlyKrw <= 0) return { error: '초기 자금이나 월 추가 투자금 중 하나는 있어야 합니다' };
    for (const [key, name] of [['fxFeePct', '환전 수수료'], ['tradeFeePct', '매매 수수료'], ['sellTaxPct', '거래세']]) {
      if (!(settings[key] >= 0 && settings[key] < 100)) return { error: `${name}는 0 이상 100 미만이어야 합니다` };
    }
    const first = data.dates[0];
    const last = data.dates[data.dates.length - 2];
    if (!settings.startDate || settings.startDate < first || settings.startDate > last) {
      return { error: `시작일은 ${Format.date(first)}부터 ${Format.date(last)} 사이여야 합니다` };
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
    window.addEventListener('resize', () => { if (UI.state) drawChart(); });
  }

  buildStockList();
  wire();
  showStart();
  globalThis.UI = UI;
})();
