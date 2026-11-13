// 환전, 채권, 자동투자 탭. 입력칸은 index.html에 고정해 두고 값만 다시 그린다.
(function () {
  const data = globalThis.GAME_DATA;
  const $ = (id) => document.getElementById(id);
  const { parseNumber, setText } = UI;
  const { t } = I18N;
  const nameOf = (stock) => I18N.stockName(stock);

  // 현재 값이 입력 중인 숫자와 같으면 커서가 튀지 않게 건드리지 않는다.
  function listRow(title, sub, right, button) {
    const row = document.createElement('div');
    row.className = 'row plain';
    const left = document.createElement('span');
    left.textContent = title;
    const small = document.createElement('small');
    small.textContent = sub;
    small.style.display = 'block';
    left.append(small);
    row.append(left);
    if (right) {
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = right[0];
      const note = document.createElement('small');
      note.textContent = right[1];
      note.style.display = 'block';
      num.append(note);
      row.append(num);
    }
    if (button) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn lockable';
      b.textContent = button.label;
      b.dataset.id = button.id;
      b.disabled = UI.playing;
      row.append(b);
    }
    return row;
  }

  function fillList(container, signature, build, emptyText) {
    if (container.dataset.sig === signature) return;
    container.dataset.sig = signature;
    container.innerHTML = '';
    const rows = build();
    if (rows.length) container.append(...rows);
    else {
      const none = document.createElement('div');
      none.className = 'empty';
      none.textContent = emptyText;
      container.append(none);
    }
  }

  function selectSeg(el, key, value) {
    for (const b of el.children) b.classList.toggle('on', b.dataset[key] === value);
  }

  // ---------- 환전 ----------

  let fxDir = 'KRW_TO_USD';
  let foDir = 'KRW_TO_USD';

  function drawFx() {
    const s = UI.state;
    const spot = data.fx[s.dayIdx];
    const prev = s.dayIdx > 0 ? data.fx[s.dayIdx - 1] : spot;
    const big = $('fxSpot');
    big.textContent = `${Format.rate(spot)} `;
    const change = document.createElement('small');
    const pct = (spot / prev - 1) * 100;
    change.className = UI.signClass(pct);
    change.textContent = Format.pct(pct);
    big.append(change);
    setText($('fxBal'), t('fx.balance', { usd: Format.usd(s.usd), krw: Format.krw(s.krw) }));

    const buying = fxDir === 'KRW_TO_USD';
    setText($('fxUsdLabel'), buying ? t('fx.receiveUsd') : t('fx.sellUsd'));
    setText($('fxRateLabel'), t('fx.rateLabel', { fee: s.settings.fxFeePct }));
    setText($('fxKrwLabel'), buying ? t('fx.krwOut') : t('fx.krwIn'));
    const usd = parseNumber($('fxUsd').value);
    if (Number.isFinite(usd) && usd > 0) {
      const q = Engine.fxQuote(data, s, fxDir, usd);
      setText($('fxRate'), Format.rate(q.rate));
      setText($('fxKrw'), Format.krw(q.krw));
      setText($('fxFee'), t('fx.fee', { fee: Format.krw(q.feeKrw) }));
    } else {
      setText($('fxRate'), Format.rate(buying ? spot * (1 + s.settings.fxFeePct / 100) : spot * (1 - s.settings.fxFeePct / 100)));
      setText($('fxKrw'), '-');
      setText($('fxFee'), '');
    }

    const orders = s.fxOrders;
    setText($('foTitle'), t('fo.title', { n: orders.length }));
    const rateText = (v) => (I18N.lang === 'ko' ? Math.round(v).toLocaleString('en-US') : Format.rateWhole(v));
    fillList($('foList'), JSON.stringify(orders) + UI.playing, () => orders.map((o) => listRow(
      t(o.op === 'lte' ? 'fo.whenLte' : 'fo.whenGte', { rate: rateText(o.rate) }),
      `${Format.DIR_NAME[o.dir]} ${Format.usd(o.usd)}`,
      null,
      { label: t('cancel'), id: o.id },
    )), t('fo.empty'));
    setText($('foRateLabel'), foDir === 'KRW_TO_USD' ? t('fo.rateLte') : t('fo.rateGte'));
  }

  function doExchange() {
    if (UI.playing) return;
    const r = Engine.exchange(data, UI.state, fxDir, parseNumber($('fxUsd').value));
    setText($('fxMsg'), r.ok ? '' : I18N.msg(r.reason));
    if (r.ok) UI.refresh();
  }

  function addOrder() {
    if (UI.playing) return;
    const r = Engine.addFxOrder(UI.state, {
      op: foDir === 'KRW_TO_USD' ? 'lte' : 'gte',
      rate: parseNumber($('foRate').value),
      dir: foDir,
      usd: parseNumber($('foUsd').value),
    });
    setText($('foMsg'), r.ok ? '' : I18N.msg(r.reason));
    if (r.ok) UI.refresh();
  }

  // ---------- 채권 ----------

  let bondCountry = 'KR';

  function drawBond() {
    const s = UI.state;
    setText($('bKr'), `${t('bond.KR')} ${data.rates.KR[s.dayIdx].toFixed(2)}%`);
    setText($('bUs'), `${t('bond.US')} ${data.rates.US[s.dayIdx].toFixed(2)}%`);
    const currency = bondCountry === 'US' ? 'USD' : 'KRW';
    setText($('bAmtLabel'), currency === 'USD' ? t('bond.amountUsd') : t('bond.amountKrw'));
    const amount = parseNumber($('bAmt').value);
    if (Number.isFinite(amount) && amount > 0) {
      const q = Engine.bondQuote(data, s, bondCountry, amount);
      setText($('bPayLabel'), t('bond.payLabel', { date: Format.date(q.maturityDate) }));
      setText($('bPay'), Format.money(q.payout, currency));
    } else {
      setText($('bPay'), '-');
    }
    setText($('bTitle'), t('bond.title', { n: s.bonds.length }));
    fillList($('bList'), JSON.stringify(s.bonds), () => s.bonds.map((b) => listRow(
      `${Format.BOND_NAME[b.country]} ${Format.money(b.principal, b.currency)}`,
      t('bond.sub', { rate: b.ratePct.toFixed(2), date: Format.date(b.maturityDate) }),
      [`+${Format.money(Engine.roundMoney(b.payout - b.principal, b.currency), b.currency)}`, t('bond.interest')],
    )), t('bond.empty'));
  }

  function doBuyBond() {
    if (UI.playing) return;
    const r = Engine.buyBond(data, UI.state, bondCountry, parseNumber($('bAmt').value));
    setText($('bMsg'), r.ok ? '' : I18N.msg(r.reason));
    if (r.ok) UI.refresh();
  }

  // ---------- 자동투자 ----------

  let autoFreq = 'month';

  let editingId = null;

  function setFreq(freq) {
    autoFreq = freq;
    selectSeg($('aFreq'), 'freq', autoFreq);
  }

  function cancelEdit() {
    editingId = null;
    setText($('aGo'), t('auto.add'));
    setText($('aFormTitle'), t('auto.new'));
    $('aCancel').hidden = true;
    setText($('aMsg'), '');
  }

  function startEdit(rule) {
    editingId = rule.id;
    $('aStock').value = rule.stockIdx;
    setFreq(rule.freq);
    $('aAmt').value = rule.amount.toLocaleString('en-US');
    setText($('aGo'), t('saveEdit'));
    setText($('aFormTitle'), t('auto.edit'));
    $('aCancel').hidden = false;
    setText($('aMsg'), '');
  }

  function autoRow(rule) {
    const s = UI.state;
    const st = data.stocks[rule.stockIdx];
    const next = Engine.nextAutoDate(data, s, rule);
    const row = document.createElement('div');
    row.className = `autoRow${rule.paused ? ' stopped' : ''}${rule.id === editingId ? ' editing' : ''}`;
    const name = document.createElement('div');
    name.className = 'autoName';
    name.textContent = nameOf(st);
    const sub = document.createElement('small');
    const when = rule.paused ? t('auto.paused') : t('auto.next', { date: next ? Format.date(next) : t('auto.none') });
    sub.textContent = `${t(`freq.${rule.freq}`)} ${Format.money(rule.amount, st.currency)} · ${when}`;
    const btns = document.createElement('div');
    btns.className = 'autoBtns';
    for (const [act, label] of [['pause', rule.paused ? t('resume') : t('stop')], ['edit', t('edit')], ['delete', t('delete')]]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn lockable';
      b.dataset.act = act;
      b.dataset.id = rule.id;
      b.textContent = label;
      b.disabled = UI.playing;
      btns.append(b);
    }
    row.append(name, sub, btns);
    return row;
  }

  function drawAuto() {
    const s = UI.state;
    const stock = data.stocks[Number($('aStock').value)];
    setText($('aAmtLabel'), stock.currency === 'USD' ? t('auto.amountUsd') : t('auto.amountKrw'));
    const listing = Engine.listingIdx(data, Number($('aStock').value));
    setText($('aListing'), listing > s.dayIdx ? t('auto.notListed', { date: Format.date(data.dates[listing]) }) : '');
    setText($('aTitle'), t('auto.title', { n: s.autoRules.length }));
    const sig = JSON.stringify(s.autoRules) + s.dayIdx + UI.playing + editingId;
    fillList($('aList'), sig, () => s.autoRules.map(autoRow), t('auto.empty'));
  }

  function doAddAuto() {
    if (UI.playing) return;
    const rule = { stockIdx: Number($('aStock').value), freq: autoFreq, amount: parseNumber($('aAmt').value) };
    const r = editingId === null ? Engine.addAutoRule(UI.state, rule) : Engine.editAutoRule(UI.state, editingId, rule);
    setText($('aMsg'), r.ok ? '' : I18N.msg(r.reason));
    if (r.ok) {
      cancelEdit();
      UI.refresh();
    }
  }

  function onAutoListClick(e) {
    const { act, id } = e.target.dataset;
    if (!act || UI.playing) return;
    const ruleId = Number(id);
    const rule = UI.state.autoRules.find((r) => r.id === ruleId);
    if (!rule) return;
    if (act === 'pause') Engine.setAutoRulePaused(UI.state, ruleId, !rule.paused);
    if (act === 'edit') startEdit(rule);
    if (act === 'delete') {
      if (editingId === ruleId) cancelEdit();
      Engine.stopAutoRule(UI.state, ruleId);
    }
    UI.refresh();
  }

  // ---------- 매도 규칙 ----------

  let sellOp = 'gte';
  let editingSellId = null;

  function setSellOp(op) {
    sellOp = op;
    selectSeg($('rOp'), 'op', op);
  }

  function cancelSellEdit() {
    editingSellId = null;
    setText($('rGo'), t('rule.add'));
    setText($('rFormTitle'), t('rule.new'));
    $('rCancel').hidden = true;
    setText($('rMsg'), '');
  }

  function startSellEdit(rule) {
    editingSellId = rule.id;
    $('rStock').value = rule.stockIdx;
    setSellOp(rule.op);
    $('rPct').value = String(rule.pct);
    $('rQty').value = String(rule.sellPct);
    $('rTimes').value = String(rule.times || 1);
    $('rWait').value = String(rule.waitDays || 0);
    setText($('rGo'), t('saveEdit'));
    setText($('rFormTitle'), t('rule.edit'));
    $('rCancel').hidden = false;
    setText($('rMsg'), '');
  }

  function sellRow(rule) {
    const row = document.createElement('div');
    const stopped = rule.paused || rule.firedDate;
    row.className = `autoRow${stopped ? ' stopped' : ''}${rule.id === editingSellId ? ' editing' : ''}`;
    const name = document.createElement('div');
    name.className = 'autoName';
    name.textContent = nameOf(data.stocks[rule.stockIdx]);
    const sub = document.createElement('small');
    const status = rule.firedDate ? t('rule.fired', { date: Format.date(rule.firedDate) }) : rule.paused ? t('auto.paused') : t('rule.waiting');
    const times = rule.times || 1;
    const repeat = times > 1 || rule.waitDays
      ? t('rule.repeat', { times, wait: rule.waitDays || 0, fired: rule.firedDate ? null : (rule.firedCount || 0) }) : '';
    sub.textContent = t('rule.line', { pct: Format.signedPct(rule.pct), op: rule.op, sellPct: rule.sellPct, repeat, status });
    const btns = document.createElement('div');
    btns.className = 'autoBtns';
    for (const [act, label] of [['pause', stopped ? t('resume') : t('stop')], ['edit', t('edit')], ['delete', t('delete')]]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn lockable';
      b.dataset.act = act;
      b.dataset.id = rule.id;
      b.textContent = label;
      b.disabled = UI.playing;
      btns.append(b);
    }
    row.append(name, sub, btns);
    return row;
  }

  function drawSell() {
    const rules = UI.state.sellRules || [];
    setText($('rTitle'), t('rule.title', { n: rules.length }));
    const sig = JSON.stringify(rules) + UI.playing + editingSellId;
    fillList($('rList'), sig, () => rules.map(sellRow), t('rule.empty'));
  }

  function doAddSell() {
    if (UI.playing) return;
    const rule = {
      stockIdx: Number($('rStock').value),
      op: sellOp,
      pct: parseNumber($('rPct').value),
      sellPct: parseNumber($('rQty').value),
      times: parseNumber($('rTimes').value),
      waitDays: parseNumber($('rWait').value),
    };
    const r = editingSellId === null ? Engine.addSellRule(UI.state, rule) : Engine.editSellRule(UI.state, editingSellId, rule);
    setText($('rMsg'), r.ok ? '' : I18N.msg(r.reason));
    if (r.ok) {
      cancelSellEdit();
      UI.refresh();
    }
  }

  function onSellListClick(e) {
    const { act, id } = e.target.dataset;
    if (!act || UI.playing) return;
    const ruleId = Number(id);
    const rule = (UI.state.sellRules || []).find((r) => r.id === ruleId);
    if (!rule) return;
    if (act === 'pause') Engine.setSellRulePaused(UI.state, ruleId, !(rule.paused || rule.firedDate));
    if (act === 'edit') startSellEdit(rule);
    if (act === 'delete') {
      if (editingSellId === ruleId) cancelSellEdit();
      Engine.deleteSellRule(UI.state, ruleId);
    }
    UI.refresh();
  }

  // ---------- 연결 ----------

  function wire() {
    const aStock = $('aStock');
    for (const select of [aStock, $('rStock')]) {
      for (const board of ['KOSPI', 'KOSDAQ', 'US']) {
        const group = document.createElement('optgroup');
        group.label = t(`board.${board}`);
        data.stocks.forEach((stock, i) => {
          if (stock.board !== board) return;
          const option = document.createElement('option');
          option.value = i;
          option.textContent = nameOf(stock);
          group.append(option);
        });
        select.append(group);
      }
    }

    $('fxDir').addEventListener('click', (e) => {
      if (!e.target.dataset.dir || UI.playing) return;
      fxDir = e.target.dataset.dir;
      selectSeg($('fxDir'), 'dir', fxDir);
      setText($('fxMsg'), '');
      drawFx();
    });
    $('foDir').addEventListener('click', (e) => {
      if (!e.target.dataset.dir || UI.playing) return;
      foDir = e.target.dataset.dir;
      selectSeg($('foDir'), 'dir', foDir);
      drawFx();
    });
    $('bCountry').addEventListener('click', (e) => {
      if (!e.target.dataset.country || UI.playing) return;
      bondCountry = e.target.dataset.country;
      selectSeg($('bCountry'), 'country', bondCountry);
      setText($('bMsg'), '');
      drawBond();
    });
    $('aFreq').addEventListener('click', (e) => {
      if (!e.target.dataset.freq || UI.playing) return;
      setFreq(e.target.dataset.freq);
    });
    $('fxUsd').addEventListener('input', () => { setText($('fxMsg'), ''); drawFx(); });
    $('bAmt').addEventListener('input', () => { setText($('bMsg'), ''); drawBond(); });
    $('foRate').addEventListener('input', () => setText($('foMsg'), ''));
    $('foUsd').addEventListener('input', () => setText($('foMsg'), ''));
    $('aAmt').addEventListener('input', () => setText($('aMsg'), ''));
    aStock.addEventListener('change', () => { setText($('aMsg'), ''); drawAuto(); });
    $('fxGo').addEventListener('click', doExchange);
    $('foGo').addEventListener('click', addOrder);
    $('bGo').addEventListener('click', doBuyBond);
    $('aGo').addEventListener('click', doAddAuto);
    $('foList').addEventListener('click', (e) => {
      if (!e.target.dataset.id || UI.playing) return;
      Engine.cancelFxOrder(UI.state, Number(e.target.dataset.id));
      UI.refresh();
    });
    $('aList').addEventListener('click', onAutoListClick);
    $('aCancel').addEventListener('click', () => { cancelEdit(); UI.refresh(); });
    $('rOp').addEventListener('click', (e) => {
      if (e.target.dataset.op && !UI.playing) setSellOp(e.target.dataset.op);
    });
    for (const id of ['rPct', 'rQty', 'rTimes', 'rWait']) $(id).addEventListener('input', () => setText($('rMsg'), ''));
    $('rGo').addEventListener('click', doAddSell);
    $('rList').addEventListener('click', onSellListClick);
    $('rCancel').addEventListener('click', () => { cancelSellEdit(); UI.refresh(); });
    UI.onPlay = () => { cancelEdit(); cancelSellEdit(); };
  }

  wire();
  UI.registerTab('fx', drawFx);
  UI.registerTab('bond', drawBond);
  UI.registerTab('auto', drawAuto);
  UI.registerTab('sell', drawSell);
})();
