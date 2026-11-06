// 게임 규칙. DOM을 쓰지 않는다. 함수는 state를 직접 바꾸고,
// 실패하면 {ok:false, reason}을 돌려주며 state를 건드리지 않는다.
(function () {
  function roundMoney(value, currency) {
    return currency === 'USD' ? Math.round(value * 100) / 100 : Math.round(value);
  }

  function roundQty(qty) {
    return Math.round(qty * 10000) / 10000;
  }

  function fail(reason) { return { ok: false, reason }; }

  function stockOf(data, stockIdx) {
    return Number.isInteger(stockIdx) ? data.stocks[stockIdx] : undefined;
  }

  function cashKey(currency) { return currency === 'USD' ? 'usd' : 'krw'; }

  function toKrw(data, dayIdx, amount, currency) {
    return currency === 'USD' ? amount * data.fx[dayIdx] : amount;
  }

  function isPositiveNumber(v) { return typeof v === 'number' && Number.isFinite(v) && v > 0; }

  // 마지막으로 거래된 종가를 오늘 수량 기준으로 환산한 값. 정지 중 분할이 있어도 평가액이 꺾이지 않는다.
  function lastClose(data, stockIdx, dayIdx) {
    const s = data.stocks[stockIdx];
    let i = dayIdx;
    while (i >= 0 && s.close[i] == null) i -= 1;
    if (i < 0) return null;
    let price = s.close[i];
    if (i < dayIdx) {
      for (const [splitIdx, ratio] of s.splits) {
        if (splitIdx > i && splitIdx <= dayIdx) price /= ratio;
      }
    }
    return price;
  }

  const listingCache = new WeakMap();

  // 처음 거래된 달력 칸. 거래 기록이 없으면 -1.
  function listingIdx(data, stockIdx) {
    const s = data.stocks[stockIdx];
    if (!listingCache.has(s)) listingCache.set(s, s.close.findIndex((c) => c != null));
    return listingCache.get(s);
  }

  function hasTraded(s, dayIdx) {
    for (let i = dayIdx; i >= 0; i -= 1) if (s.close[i] != null) return true;
    return false;
  }

  function tradeStatus(data, state, stockIdx) {
    const s = data.stocks[stockIdx];
    const d = state.dayIdx;
    if (s.close[d] != null) return { ok: true };
    if (!hasTraded(s, d)) return fail('상장 전');
    if (data.open[s.market][d] === '0') return fail('휴장');
    return fail('거래 정지');
  }

  function pushEvent(state, event) { state.events.push({ d: state.dayIdx, ...event }); }

  // 매도 비용. 증권거래세는 한국 시장 종목에만 붙는다.
  function sellCostPct(settings, stock) {
    return settings.tradeFeePct + (stock.market === 'KR' ? settings.sellTaxPct : 0);
  }

  // 오늘 매매로 바뀐 손익을 오늘 칸에 반영한다.
  function syncHistory(data, state) {
    state.history.pnl[state.history.pnl.length - 1] = valuation(data, state).pnl;
  }

  function buyCost(state, s, qty, price) {
    const gross = qty * price;
    const fee = roundMoney(gross * state.settings.tradeFeePct / 100, s.currency);
    return { fee, cost: roundMoney(gross + fee, s.currency) };
  }

  // 달러 종목을 살 때 모자란 달러만 원화에서 환전한다. 원화도 모자라면 아무것도 바꾸지 않고 false.
  function coverUsd(data, state, cost) {
    if (cost <= state.usd) return true;
    const short = roundMoney(cost - state.usd, 'USD');
    if (fxQuote(data, state, 'KRW_TO_USD', short).krw > state.krw) return false;
    settleFx(data, state, 'KRW_TO_USD', short, { type: 'fx_auto' });
    return true;
  }

  // 이 수량을 사면 자동 환전될 달러와 원화. 환전이 필요 없으면 null.
  function buyFxNeed(data, state, stockIdx, qty) {
    const s = data.stocks[stockIdx];
    const price = s && s.close[state.dayIdx];
    if (!s || s.currency !== 'USD' || price == null || !Number.isInteger(qty) || qty <= 0) return null;
    const { cost } = buyCost(state, s, qty, price);
    if (cost <= state.usd) return null;
    const usd = roundMoney(cost - state.usd, 'USD');
    const q = fxQuote(data, state, 'KRW_TO_USD', usd);
    return { usd, krw: q.krw, rate: q.rate, enough: q.krw <= state.krw };
  }

  function buy(data, state, stockIdx, qty) {
    const s = stockOf(data, stockIdx);
    if (!s) return fail('종목 없음');
    if (!Number.isInteger(qty) || qty <= 0) return fail('수량은 1주 이상 정수');
    const st = tradeStatus(data, state, stockIdx);
    if (!st.ok) return st;
    const price = s.close[state.dayIdx];
    const { fee, cost } = buyCost(state, s, qty, price);
    const key = cashKey(s.currency);
    if (s.currency === 'USD') {
      if (!coverUsd(data, state, cost)) return fail('잔액 부족');
    } else if (cost > state[key]) return fail('잔액 부족');
    state[key] = roundMoney(state[key] - cost, s.currency);
    const held = state.holdings[stockIdx];
    const avg = held ? { avg: held.avgCost } : {};
    addShares(state, stockIdx, qty, price);
    pushEvent(state, {
      type: 'buy', ...avg, stockIdx, qty, price, amount: cost,
      feeKrw: roundMoney(toKrw(data, state.dayIdx, fee, s.currency), 'KRW'),
    });
    syncHistory(data, state);
    return { ok: true };
  }

  function addShares(state, stockIdx, qty, price) {
    const h = state.holdings[stockIdx];
    if (h) {
      const total = h.qty + qty;
      h.avgCost = (h.qty * h.avgCost + qty * price) / total;
      h.qty = roundQty(total);
    } else {
      state.holdings[stockIdx] = { qty, avgCost: price };
    }
  }

  function sell(data, state, stockIdx, qty) {
    const s = stockOf(data, stockIdx);
    if (!s) return fail('종목 없음');
    const h = state.holdings[stockIdx];
    if (qty !== 'all' && (!Number.isInteger(qty) || qty <= 0)) return fail('수량은 1주 이상 정수');
    if (!h) return fail('보유 수량 없음');
    const n = qty === 'all' ? h.qty : qty;
    if (n > h.qty) return fail('보유 수량 초과');
    const st = tradeStatus(data, state, stockIdx);
    if (!st.ok) return st;
    sellShares(data, state, stockIdx, n, { type: 'sell' });
    syncHistory(data, state);
    return { ok: true };
  }

  function sellShares(data, state, stockIdx, n, event) {
    const s = data.stocks[stockIdx];
    const h = state.holdings[stockIdx];
    const price = s.close[state.dayIdx];
    const gross = n * price;
    const fee = roundMoney(gross * sellCostPct(state.settings, s) / 100, s.currency);
    const amount = roundMoney(gross - fee, s.currency);
    const key = cashKey(s.currency);
    state[key] = roundMoney(state[key] + amount, s.currency);
    h.qty = roundQty(h.qty - n);
    const closed = h.qty <= 0;
    if (closed) delete state.holdings[stockIdx];
    pushEvent(state, {
      ...event, ...(closed ? { closed: true } : {}), avg: h.avgCost, stockIdx, qty: n, price, amount,
      feeKrw: roundMoney(toKrw(data, state.dayIdx, fee, s.currency), 'KRW'),
    });
  }

  function adjustedSeries(data, stockIdx, uptoDayIdx) {
    const s = data.stocks[stockIdx];
    const out = new Array(uptoDayIdx + 1);
    let factor = 1;
    let next = s.splits.length - 1;
    for (let i = uptoDayIdx; i >= 0; i -= 1) {
      out[i] = s.close[i] == null ? null : s.close[i] / factor;
      while (next >= 0 && s.splits[next][0] > uptoDayIdx) next -= 1;
      while (next >= 0 && s.splits[next][0] === i) {
        factor *= s.splits[next][1];
        next -= 1;
      }
    }
    return out;
  }

  function dayNumber(date) {
    const [y, m, d] = date.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
  }

  // 1년 뒤 같은 날짜. 2월 29일처럼 그 날이 없으면 다음 날.
  function oneYearLater(date) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y + 1, m - 1, d)).toISOString().slice(0, 10);
  }

  function bondValueKrw(data, state) {
    const today = data.dates[state.dayIdx];
    let total = 0;
    for (const b of state.bonds) {
      const span = dayNumber(b.maturityDate) - dayNumber(b.buyDate);
      const elapsed = Math.min(dayNumber(today) - dayNumber(b.buyDate), span);
      const value = b.principal + (b.payout - b.principal) * elapsed / span;
      total += toKrw(data, state.dayIdx, value, b.currency);
    }
    return roundMoney(total, 'KRW');
  }

  function fxQuote(data, state, dir, usd) {
    const spot = data.fx[state.dayIdx];
    const feeRate = state.settings.fxFeePct / 100;
    const raw = dir === 'KRW_TO_USD' ? spot * (1 + feeRate) : spot * (1 - feeRate);
    const krw = roundMoney(usd * raw, 'KRW');
    return { rate: Math.round(raw * 100) / 100, krw, feeKrw: roundMoney(Math.abs(usd * spot - krw), 'KRW') };
  }

  function isFxDir(dir) { return dir === 'KRW_TO_USD' || dir === 'USD_TO_KRW'; }

  function settleFx(data, state, dir, usd, event) {
    const q = fxQuote(data, state, dir, usd);
    if (dir === 'KRW_TO_USD') {
      if (q.krw > state.krw) return fail('잔액 부족');
      state.krw = roundMoney(state.krw - q.krw, 'KRW');
      state.usd = roundMoney(state.usd + usd, 'USD');
    } else {
      if (usd > state.usd) return fail('잔액 부족');
      state.usd = roundMoney(state.usd - usd, 'USD');
      state.krw = roundMoney(state.krw + q.krw, 'KRW');
    }
    pushEvent(state, { ...event, dir, usd, rate: q.rate, krw: q.krw, feeKrw: q.feeKrw });
    return { ok: true };
  }

  function exchange(data, state, dir, usd) {
    if (!isFxDir(dir)) return fail('환전 방향 오류');
    if (!isPositiveNumber(usd)) return fail('금액은 0보다 커야 합니다');
    const r = settleFx(data, state, dir, roundMoney(usd, 'USD'), { type: 'fx' });
    if (r.ok) syncHistory(data, state);
    return r;
  }

  function addFxOrder(state, order) {
    const { op, rate, dir, usd } = order;
    if (op !== 'lte' && op !== 'gte') return fail('조건 오류');
    if (!isFxDir(dir)) return fail('환전 방향 오류');
    if (!isPositiveNumber(rate)) return fail('환율은 0보다 커야 합니다');
    if (!isPositiveNumber(usd)) return fail('금액은 0보다 커야 합니다');
    const id = state.nextId;
    state.nextId += 1;
    state.fxOrders.push({ id, op, rate, dir, usd: roundMoney(usd, 'USD') });
    return { ok: true, id };
  }

  function cancelFxOrder(state, id) {
    const i = state.fxOrders.findIndex((o) => o.id === id);
    if (i < 0) return fail('예약 없음');
    state.fxOrders.splice(i, 1);
    return { ok: true };
  }

  function runFxOrders(data, state) {
    const spot = data.fx[state.dayIdx];
    state.fxOrders = state.fxOrders.filter((o) => {
      const met = o.op === 'lte' ? spot <= o.rate : spot >= o.rate;
      if (!met) return true;
      const r = settleFx(data, state, o.dir, o.usd, { type: 'fx_order', op: o.op, limit: o.rate });
      return !r.ok; // 잔액이 모자라면 대기
    });
  }

  function bondQuote(data, state, country, amount) {
    const ratePct = data.rates[country][state.dayIdx];
    const currency = country === 'US' ? 'USD' : 'KRW';
    return {
      ratePct,
      maturityDate: oneYearLater(data.dates[state.dayIdx]),
      payout: roundMoney(amount * (1 + ratePct / 100), currency),
    };
  }

  function buyBond(data, state, country, amount) {
    if (country !== 'KR' && country !== 'US') return fail('채권 종류 오류');
    if (!isPositiveNumber(amount)) return fail('금액은 0보다 커야 합니다');
    const currency = country === 'US' ? 'USD' : 'KRW';
    const principal = roundMoney(amount, currency);
    const key = cashKey(currency);
    if (principal > state[key]) return fail('잔액 부족');
    const q = bondQuote(data, state, country, principal);
    state[key] = roundMoney(state[key] - principal, currency);
    const id = state.nextId;
    state.nextId += 1;
    state.bonds.push({
      id, country, currency, principal, ratePct: q.ratePct,
      buyDate: data.dates[state.dayIdx], maturityDate: q.maturityDate, payout: q.payout,
    });
    pushEvent(state, { type: 'bond_buy', country, currency, principal, ratePct: q.ratePct, maturityDate: q.maturityDate });
    syncHistory(data, state);
    return { ok: true };
  }

  function payMaturedBonds(data, state) {
    const today = data.dates[state.dayIdx];
    state.bonds = state.bonds.filter((b) => {
      if (today < b.maturityDate) return true;
      const key = cashKey(b.currency);
      state[key] = roundMoney(state[key] + b.payout, b.currency);
      pushEvent(state, { type: 'bond_maturity', country: b.country, currency: b.currency, principal: b.principal, payout: b.payout });
      return false;
    });
  }

  function valuation(data, state) {
    const d = state.dayIdx;
    const usdKrw = roundMoney(state.usd * data.fx[d], 'KRW');
    let stockKrw = 0;
    for (const key of Object.keys(state.holdings)) {
      const idx = Number(key);
      const s = data.stocks[idx];
      const price = lastClose(data, idx, d);
      if (price != null) stockKrw += toKrw(data, d, state.holdings[key].qty * price, s.currency);
    }
    stockKrw = roundMoney(stockKrw, 'KRW');
    const bondKrw = bondValueKrw(data, state);
    const total = state.krw + usdKrw + bondKrw + stockKrw;
    const pnl = total - state.contributed;
    return {
      krw: state.krw, usd: state.usd, usdKrw, bondKrw, stockKrw, total,
      contributed: state.contributed, pnl,
      pnlPct: state.contributed > 0 ? pnl / state.contributed * 100 : 0,
    };
  }

  function contribute(data, state, krw) {
    const d = state.dayIdx;
    state.contributed = roundMoney(state.contributed + krw, 'KRW');
    state.bench.kospiUnits += krw / data.indices.KOSPI[d];
    state.bench.spUnits += krw / (data.indices.SP500[d] * data.fx[d]);
  }

  function recordHistory(data, state) {
    const d = state.dayIdx;
    state.history.pnl.push(valuation(data, state).pnl);
    state.history.kospi.push(Math.round(state.bench.kospiUnits * data.indices.KOSPI[d] - state.contributed));
    state.history.sp.push(Math.round(state.bench.spUnits * data.indices.SP500[d] * data.fx[d] - state.contributed));
  }

  function newGame(data, settings) {
    let dayIdx = data.dates.findIndex((date) => date >= settings.startDate);
    if (dayIdx < 0) dayIdx = data.dates.length - 1;
    const state = {
      settings: { ...settings },
      startIdx: dayIdx,
      dayIdx,
      krw: settings.krw0,
      usd: settings.usd0,
      holdings: {},
      bonds: [],
      fxOrders: [],
      autoRules: [],
      sellRules: [],
      nextId: 1,
      bench: { kospiUnits: 0, spUnits: 0 },
      contributed: 0,
      events: [],
      history: { pnl: [], kospi: [], sp: [] },
    };
    contribute(data, state, settings.krw0 + roundMoney(settings.usd0 * data.fx[dayIdx], 'KRW'));
    recordHistory(data, state);
    return state;
  }

  function applySplits(data, state) {
    for (const key of Object.keys(state.holdings)) {
      const idx = Number(key);
      for (const [splitIdx, ratio] of data.stocks[idx].splits) {
        if (splitIdx !== state.dayIdx) continue;
        const h = state.holdings[key];
        h.qty = roundQty(h.qty * ratio);
        h.avgCost /= ratio;
        pushEvent(state, { type: 'split', stockIdx: idx, ratio, qty: h.qty });
      }
    }
  }

  function payDividends(data, state) {
    for (const key of Object.keys(state.holdings)) {
      const idx = Number(key);
      const s = data.stocks[idx];
      for (const [divIdx, perShare] of s.dividends) {
        if (divIdx !== state.dayIdx) continue;
        const amount = roundMoney(state.holdings[key].qty * perShare, s.currency);
        const cash = cashKey(s.currency);
        state[cash] = roundMoney(state[cash] + amount, s.currency);
        pushEvent(state, { type: 'dividend', stockIdx: idx, qty: state.holdings[key].qty, perShare, amount });
      }
    }
  }

  function depositMonthly(data, state) {
    const amount = state.settings.monthlyKrw;
    if (!amount) return;
    const prev = data.dates[state.dayIdx - 1];
    if (prev.slice(0, 7) === data.dates[state.dayIdx].slice(0, 7)) return;
    state.krw = roundMoney(state.krw + amount, 'KRW');
    contribute(data, state, amount);
    pushEvent(state, { type: 'deposit', amount });
  }

  const FREQS = ['day', 'week', 'month', 'year'];

  function addAutoRule(state, rule) {
    const { stockIdx, freq, amount } = rule;
    if (!Number.isInteger(stockIdx) || stockIdx < 0) return fail('종목 오류');
    if (!FREQS.includes(freq)) return fail('주기 오류');
    if (!isPositiveNumber(amount)) return fail('금액은 0보다 커야 합니다');
    const id = state.nextId;
    state.nextId += 1;
    state.autoRules.push({ id, stockIdx, freq, amount, fromIdx: state.dayIdx });
    return { ok: true, id };
  }

  function ruleOf(state, id) { return state.autoRules.find((r) => r.id === id); }

  function setAutoRulePaused(state, id, paused) {
    const rule = ruleOf(state, id);
    if (!rule) return fail('자동투자 없음');
    rule.paused = Boolean(paused);
    rule.fromIdx = state.dayIdx;
    return { ok: true };
  }

  function editAutoRule(state, id, change) {
    const rule = ruleOf(state, id);
    if (!rule) return fail('자동투자 없음');
    const { stockIdx, freq, amount } = change;
    if (!Number.isInteger(stockIdx) || stockIdx < 0) return fail('종목 오류');
    if (!FREQS.includes(freq)) return fail('주기 오류');
    if (!isPositiveNumber(amount)) return fail('금액은 0보다 커야 합니다');
    Object.assign(rule, { stockIdx, freq, amount, fromIdx: state.dayIdx });
    return { ok: true };
  }

  function stopAutoRule(state, id) {
    const i = state.autoRules.findIndex((r) => r.id === id);
    if (i < 0) return fail('자동투자 없음');
    state.autoRules.splice(i, 1);
    return { ok: true };
  }

  // ---------- 매도 규칙 ----------

  function checkSellRule(rule) {
    const { stockIdx, op, pct, sellPct } = rule;
    if (!Number.isInteger(stockIdx) || stockIdx < 0) return '종목 오류';
    if (op !== 'gte' && op !== 'lte') return '조건 오류';
    if (typeof pct !== 'number' || !Number.isFinite(pct)) return '수익률은 숫자여야 합니다';
    if (!isPositiveNumber(sellPct) || sellPct > 100) return '매도 비율은 0보다 크고 100 이하여야 합니다';
    const { times = 1, waitDays = 0 } = rule;
    if (!Number.isInteger(times) || times < 1) return '실행 횟수는 1 이상의 정수여야 합니다';
    if (!Number.isInteger(waitDays) || waitDays < 0) return '대기 기간은 0 이상의 정수여야 합니다';
    return null;
  }

  function addSellRule(state, rule) {
    const problem = checkSellRule(rule);
    if (problem) return fail(problem);
    if (!state.sellRules) state.sellRules = [];
    const id = state.nextId;
    state.nextId += 1;
    const { stockIdx, op, pct, sellPct, times = 1, waitDays = 0 } = rule;
    state.sellRules.push({ id, stockIdx, op, pct, sellPct, times, waitDays, fromIdx: state.dayIdx });
    return { ok: true, id };
  }

  function sellRuleOf(state, id) { return (state.sellRules || []).find((r) => r.id === id); }

  function clearSellRuns(rule) {
    delete rule.firedDate;
    delete rule.firedCount;
    delete rule.lastSaleDate;
  }

  function editSellRule(state, id, change) {
    const rule = sellRuleOf(state, id);
    if (!rule) return fail('매도 규칙 없음');
    const problem = checkSellRule(change);
    if (problem) return fail(problem);
    const { stockIdx, op, pct, sellPct, times = 1, waitDays = 0 } = change;
    Object.assign(rule, { stockIdx, op, pct, sellPct, times, waitDays, fromIdx: state.dayIdx });
    clearSellRuns(rule);
    return { ok: true };
  }

  // 정지하거나, 다시 켠다. 이미 실행된 규칙을 다시 켜면 조건을 새로 기다린다.
  function setSellRulePaused(state, id, paused) {
    const rule = sellRuleOf(state, id);
    if (!rule) return fail('매도 규칙 없음');
    rule.paused = Boolean(paused);
    rule.fromIdx = state.dayIdx;
    if (!paused && rule.firedDate) {
      clearSellRuns(rule);
      rule.firedCount = 0;
    }
    return { ok: true };
  }

  function deleteSellRule(state, id) {
    const rule = sellRuleOf(state, id);
    if (!rule) return fail('매도 규칙 없음');
    state.sellRules.splice(state.sellRules.indexOf(rule), 1);
    return { ok: true };
  }

  function runSellRules(data, state) {
    for (const rule of state.sellRules || []) {
      if (rule.paused || rule.firedDate || state.dayIdx <= rule.fromIdx) continue;
      const today = data.dates[state.dayIdx];
      const since = rule.lastSaleDate || data.dates[rule.fromIdx];
      if (dayNumber(today) - dayNumber(since) < (rule.waitDays || 0)) continue;
      const h = state.holdings[rule.stockIdx];
      if (!h || !tradeStatus(data, state, rule.stockIdx).ok) continue;
      const gain = Math.round((data.stocks[rule.stockIdx].close[state.dayIdx] / h.avgCost - 1) * 1e8) / 1e6; // 부동소수 오차 제거
      if (!(rule.op === 'gte' ? gain >= rule.pct : gain <= rule.pct)) continue;
      const n = rule.sellPct >= 100 ? h.qty : roundQty(h.qty * rule.sellPct / 100);
      if (n <= 0) continue;
      const run = (rule.firedCount || 0) + 1;
      const times = rule.times || 1;
      sellShares(data, state, rule.stockIdx, n, { type: 'rule_sell', ruleId: rule.id, op: rule.op, pct: rule.pct, run, times });
      rule.firedCount = run;
      rule.lastSaleDate = today;
      if (run >= times) rule.firedDate = today;
    }
  }

  // 주(週)의 경계는 월요일이다. 1970-01-01이 목요일이므로 3을 더해 월요일에 맞춘다.
  function weekNumber(date) { return Math.floor((dayNumber(date) + 3) / 7); }

  function periodKey(freq, date) {
    if (freq === 'week') return weekNumber(date);
    if (freq === 'month') return date.slice(0, 7);
    return date.slice(0, 4);
  }

  function isDue(data, stock, freq, d) {
    const open = data.open[stock.market];
    if (open[d] !== '1') return false;
    if (freq === 'day') return true;
    let p = d - 1;
    while (p >= 0 && open[p] !== '1') p -= 1;
    return p < 0 || periodKey(freq, data.dates[p]) !== periodKey(freq, data.dates[d]);
  }

  function nextAutoDate(data, state, rule) {
    if (rule.paused) return null;
    const stock = data.stocks[rule.stockIdx];
    const listing = listingIdx(data, rule.stockIdx);
    if (listing > state.dayIdx) return data.dates[listing];
    for (let d = state.dayIdx + 1; d < data.dates.length; d += 1) {
      if (isDue(data, stock, rule.freq, d)) return data.dates[d];
    }
    return null;
  }

  function runAutoRule(data, state, rule) {
    const s = data.stocks[rule.stockIdx];
    const skip = (reason) => pushEvent(state, {
      type: 'skip', stockIdx: rule.stockIdx, amount: rule.amount, currency: s.currency, reason,
    });
    const st = tradeStatus(data, state, rule.stockIdx);
    if (!st.ok) { skip(st.reason); return; }
    const price = s.close[state.dayIdx];
    const feeRate = state.settings.tradeFeePct / 100;
    const qty = Math.floor(rule.amount / (price * (1 + feeRate)) * 10000 + 1e-9) / 10000;
    if (qty <= 0) { skip('회차 금액 부족'); return; }
    const gross = qty * price;
    const fee = roundMoney(gross * feeRate, s.currency);
    const cost = roundMoney(gross + fee, s.currency);
    const key = cashKey(s.currency);
    if (s.currency === 'USD' ? !coverUsd(data, state, cost) : cost > state[key]) { skip('잔액 부족'); return; }
    state[key] = roundMoney(state[key] - cost, s.currency);
    addShares(state, rule.stockIdx, qty, price);
    pushEvent(state, {
      type: 'auto_buy', stockIdx: rule.stockIdx, qty, price, amount: cost, ruleId: rule.id, freq: rule.freq,
      feeKrw: roundMoney(toKrw(data, state.dayIdx, fee, s.currency), 'KRW'),
    });
  }

  function runAutoRules(data, state) {
    for (const rule of state.autoRules) {
      if (rule.paused || state.dayIdx <= rule.fromIdx) continue;
      const listing = listingIdx(data, rule.stockIdx);
      // 상장 전에는 조용히 기다리고, 등록 뒤 상장한 종목은 상장일에 첫 회차를 산다.
      if (listing < 0 || state.dayIdx < listing) continue;
      const firstDay = state.dayIdx === listing && rule.fromIdx < listing;
      if (firstDay || isDue(data, data.stocks[rule.stockIdx], rule.freq, state.dayIdx)) runAutoRule(data, state, rule);
    }
  }

  // 아직 아무 일도 없었고 자동투자 종목이 모두 상장 전이면,
  // 가장 먼저 상장하는 종목의 상장일로 시뮬레이션 시작일을 옮긴다.
  function alignStartToListings(data, state) {
    if (state.dayIdx !== state.startIdx || state.events.length) return false;
    const rules = state.autoRules.filter((r) => !r.paused);
    if (!rules.length) return false;
    const listings = rules.map((r) => listingIdx(data, r.stockIdx));
    if (listings.some((l) => l >= 0 && l <= state.dayIdx)) return false;
    const known = listings.filter((l) => l >= 0);
    if (!known.length) return false;
    const first = Math.min(...known);
    const { autoRules, sellRules, fxOrders, nextId, settings } = state;
    const fresh = newGame(data, {
      ...settings, startDate: data.dates[first], chosenStartDate: settings.chosenStartDate || settings.startDate,
    });
    Object.assign(state, fresh, { autoRules, sellRules: sellRules || [], fxOrders, nextId });
    for (const r of state.sellRules) r.fromIdx = first - 1;
    for (const r of state.autoRules) if (!r.paused) r.fromIdx = first - 1;
    const leader = rules[listings.indexOf(first)];
    pushEvent(state, { type: 'start_moved', stockIdx: leader.stockIdx });
    runAutoRules(data, state);
    syncHistory(data, state);
    return true;
  }

  // 같은 조건으로 처음부터. 자동투자 항목만 유지하고 매매, 예약, 기록은 비운 새 상태를 돌려준다.
  function restartGame(data, state) {
    const { chosenStartDate, ...rest } = state.settings;
    const fresh = newGame(data, { ...rest, startDate: chosenStartDate || rest.startDate });
    fresh.settings = { ...state.settings, startDate: chosenStartDate || rest.startDate };
    delete fresh.settings.chosenStartDate;
    fresh.autoRules = state.autoRules.map((r) => ({ ...r, fromIdx: fresh.dayIdx }));
    fresh.sellRules = (state.sellRules || []).map(({ firedDate, firedCount, lastSaleDate, ...r }) => ({ ...r, fromIdx: fresh.dayIdx }));
    fresh.nextId = state.nextId;
    return fresh;
  }

  function advance(data, state) {
    if (state.dayIdx >= data.dates.length - 1) return false;
    state.dayIdx += 1;
    applySplits(data, state);
    payMaturedBonds(data, state);
    payDividends(data, state);
    depositMonthly(data, state);
    runFxOrders(data, state);
    runAutoRules(data, state);
    runSellRules(data, state);
    recordHistory(data, state);
    return true;
  }

  const FX_EVENTS = ['fx', 'fx_order', 'fx_auto'];
  const MIN_ANNUAL_DAYS = 30;

  // 돈이 오간 날짜를 반영한 연환산 수익률(XIRR, %). flows의 투자금은 음수, 받은 돈은 양수다.
  // 기간이 30일 미만이면 연환산 값이 과장되므로 계산하지 않고 null을 돌려준다.
  function annualizedPct(flows) {
    const moves = flows.filter((f) => f.amount !== 0);
    if (!moves.some((f) => f.amount < 0)) return null;
    const days = flows.map((f) => dayNumber(f.date));
    const first = Math.min(...days);
    if (Math.max(...days) - first < MIN_ANNUAL_DAYS) return null;
    if (!moves.some((f) => f.amount > 0)) return -100;
    const npv = (r) => moves.reduce((sum, f) => sum + f.amount / (1 + r) ** ((dayNumber(f.date) - first) / 365), 0);
    let lo = -0.9999;
    let hi = 1000;
    if (npv(lo) * npv(hi) > 0) return null;
    for (let i = 0; i < 200; i += 1) {
      const mid = (lo + hi) / 2;
      if (npv(lo) * npv(mid) <= 0) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2 * 100;
  }

  // 게임 전체를 요약한 투자 보고서.
  function report(data, state) {
    const d = state.dayIdx;
    const v = valuation(data, state);
    const h = state.history;
    const k = h.pnl.length - 1;
    const counts = { buys: 0, sells: 0, autoBuys: 0, skips: 0 };
    const perStock = new Map();
    const row = (i) => {
      if (!perStock.has(i)) perStock.set(i, { stockIdx: i, bought: 0, sold: 0, dividends: 0, flows: [] });
      return perStock.get(i);
    };
    const flowOf = (e, sign) => row(e.stockIdx).flows.push({ date: data.dates[e.d], amount: sign * e.amount });
    const endDate = data.dates[d];
    let deposited = 0;
    const contributions = [];
    let dividendsKrw = 0;
    let interestKrw = 0;
    let fxFeesKrw = 0;
    let tradeFeesKrw = 0;
    for (const e of state.events) {
      if (e.feeKrw) {
        if (FX_EVENTS.includes(e.type)) fxFeesKrw += e.feeKrw;
        else tradeFeesKrw += e.feeKrw;
      }
      if (e.type === 'buy') { counts.buys += 1; row(e.stockIdx).bought += e.amount; flowOf(e, -1); }
      if (e.type === 'auto_buy') { counts.autoBuys += 1; row(e.stockIdx).bought += e.amount; flowOf(e, -1); }
      if (e.type === 'sell' || e.type === 'rule_sell') { counts.sells += 1; row(e.stockIdx).sold += e.amount; flowOf(e, 1); }
      if (e.type === 'deposit') {
        deposited += e.amount;
        contributions.push({ date: data.dates[e.d], amount: -e.amount });
      }
      if (e.type === 'skip') counts.skips += 1;
      if (e.type === 'dividend') {
        row(e.stockIdx).dividends += e.amount;
        flowOf(e, 1);
        dividendsKrw += toKrw(data, e.d, e.amount, data.stocks[e.stockIdx].currency);
      }
      if (e.type === 'bond_maturity') interestKrw += toKrw(data, e.d, e.payout - e.principal, e.currency);
    }
    const stocks = [...perStock.values()].map((r) => {
      const s = data.stocks[r.stockIdx];
      const h0 = state.holdings[r.stockIdx];
      const qty = h0 ? h0.qty : 0;
      const price = lastClose(data, r.stockIdx, d);
      const value = roundMoney(qty * (price || 0), s.currency);
      const round = (x) => roundMoney(x, s.currency);
      const pnl = round(r.sold + r.dividends + value - r.bought);
      return {
        stockIdx: r.stockIdx, qty, bought: round(r.bought), sold: round(r.sold), dividends: round(r.dividends),
        value, pnl, pnlKrw: roundMoney(toKrw(data, d, pnl, s.currency), 'KRW'),
        pnlPct: r.bought > 0 ? pnl / r.bought * 100 : 0,
        annualPct: annualizedPct([...r.flows, { date: endDate, amount: value }]),
      };
    }).sort((a, b) => b.pnlKrw - a.pnlKrw);
    let best = 0;
    let worst = 0;
    h.pnl.forEach((p, i) => {
      if (p > h.pnl[best]) best = i;
      if (p < h.pnl[worst]) worst = i;
    });
    const point = (i) => ({ date: data.dates[state.startIdx + i], pnl: h.pnl[i] });
    // 넣은 돈의 흐름: 시작일의 초기 자금과 달마다의 입금. 내 투자와 두 지수에 똑같이 쓴다.
    const paidIn = [{ date: data.dates[state.startIdx], amount: -(v.contributed - deposited) }, ...contributions];
    const annualOf = (pnl) => annualizedPct([...paidIn, { date: endDate, amount: v.contributed + pnl }]);
    const pctOf = (pnl) => (v.contributed > 0 ? pnl / v.contributed * 100 : 0);
    return {
      startDate: data.dates[state.startIdx], endDate: data.dates[d],
      total: v.total, contributed: v.contributed, pnl: v.pnl, pnlPct: v.pnlPct,
      annualPct: annualOf(v.pnl),
      kospiPnl: h.kospi[k], kospiPct: pctOf(h.kospi[k]), kospiAnnualPct: annualOf(h.kospi[k]),
      spPnl: h.sp[k], spPct: pctOf(h.sp[k]), spAnnualPct: annualOf(h.sp[k]),
      vsKospi: v.pnl - h.kospi[k], vsSp: v.pnl - h.sp[k],
      assets: { krw: v.krw, usdKrw: v.usdKrw, bondKrw: v.bondKrw, stockKrw: v.stockKrw },
      best: point(best), worst: point(worst), counts, stocks,
      dividendsKrw: roundMoney(dividendsKrw, 'KRW'), interestKrw: roundMoney(interestKrw, 'KRW'),
      fxFeesKrw, tradeFeesKrw,
    };
  }

  const Engine = {
    report, annualizedPct, sellCostPct, listingIdx, restartGame,
    addSellRule, editSellRule, setSellRulePaused, deleteSellRule,
    roundMoney, newGame, advance, tradeStatus, lastClose, buy, buyFxNeed, sell, valuation, adjustedSeries,
    fxQuote, exchange, addFxOrder, cancelFxOrder, bondQuote, buyBond,
    addAutoRule, stopAutoRule, setAutoRulePaused, editAutoRule, nextAutoDate, alignStartToListings,
  };
  globalThis.Engine = Engine;
  if (typeof module !== 'undefined') module.exports = Engine;
})();
