// 환전, 채권, 자동투자 탭. 입력칸은 index.html에 고정해 두고 값만 다시 그린다.
(function () {
  const data = globalThis.GAME_DATA;
  const $ = (id) => document.getElementById(id);
  const { parseNumber, setText } = UI;

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
    setText($('fxBal'), `달러 계좌 ${Format.usd(s.usd)} · 원화 계좌 ${Format.krw(s.krw)}`);

    const buying = fxDir === 'KRW_TO_USD';
    setText($('fxUsdLabel'), buying ? '받을 달러' : '팔 달러');
    setText($('fxRateLabel'), `수수료 ${s.settings.fxFeePct}% 적용 환율`);
    setText($('fxKrwLabel'), buying ? '나가는 원화' : '들어오는 원화');
    const usd = parseNumber($('fxUsd').value);
    if (Number.isFinite(usd) && usd > 0) {
      const q = Engine.fxQuote(data, s, fxDir, usd);
      setText($('fxRate'), Format.rate(q.rate));
      setText($('fxKrw'), Format.krw(q.krw));
      setText($('fxFee'), `이 중 수수료는 ${Format.krw(q.feeKrw)}원입니다.`);
    } else {
      setText($('fxRate'), Format.rate(buying ? spot * (1 + s.settings.fxFeePct / 100) : spot * (1 - s.settings.fxFeePct / 100)));
      setText($('fxKrw'), '-');
      setText($('fxFee'), '');
    }

    const orders = s.fxOrders;
    setText($('foTitle'), `조건 환전 예약 ${orders.length}건`);
    fillList($('foList'), JSON.stringify(orders) + UI.playing, () => orders.map((o) => listRow(
      `${Math.round(o.rate).toLocaleString('en-US')}원 ${o.op === 'lte' ? '이하' : '이상'}일 때`,
      `${Format.DIR_NAME[o.dir]} ${Format.usd(o.usd)}`,
      null,
      { label: '취소', id: o.id },
    )), '예약이 없습니다.');
    setText($('foRateLabel'), foDir === 'KRW_TO_USD' ? '환율이 이 값 이하일 때' : '환율이 이 값 이상일 때');
  }

  function doExchange() {
    if (UI.playing) return;
    const r = Engine.exchange(data, UI.state, fxDir, parseNumber($('fxUsd').value));
    setText($('fxMsg'), r.ok ? '' : r.reason);
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
    setText($('foMsg'), r.ok ? '' : r.reason);
    if (r.ok) UI.refresh();
  }

  // ---------- 채권 ----------

  let bondCountry = 'KR';

  function drawBond() {
    const s = UI.state;
    setText($('bKr'), `한국 국고채 ${data.rates.KR[s.dayIdx].toFixed(2)}%`);
    setText($('bUs'), `미국 국채 ${data.rates.US[s.dayIdx].toFixed(2)}%`);
    const currency = bondCountry === 'US' ? 'USD' : 'KRW';
    setText($('bAmtLabel'), currency === 'USD' ? '넣을 금액 (달러)' : '넣을 금액 (원)');
    const amount = parseNumber($('bAmt').value);
    if (Number.isFinite(amount) && amount > 0) {
      const q = Engine.bondQuote(data, s, bondCountry, amount);
      setText($('bPayLabel'), `${Format.date(q.maturityDate)} 만기 수령액`);
      setText($('bPay'), Format.money(q.payout, currency));
    } else {
      setText($('bPay'), '-');
    }
    setText($('bTitle'), `보유 채권 ${s.bonds.length}건`);
    fillList($('bList'), JSON.stringify(s.bonds), () => s.bonds.map((b) => listRow(
      `${Format.BOND_NAME[b.country]} ${Format.money(b.principal, b.currency)}`,
      `금리 ${b.ratePct.toFixed(2)}% · 만기 ${Format.date(b.maturityDate)}`,
      [`+${Format.money(Engine.roundMoney(b.payout - b.principal, b.currency), b.currency)}`, '만기 이자'],
    )), '보유 채권이 없습니다.');
  }

  function doBuyBond() {
    if (UI.playing) return;
    const r = Engine.buyBond(data, UI.state, bondCountry, parseNumber($('bAmt').value));
    setText($('bMsg'), r.ok ? '' : r.reason);
    if (r.ok) UI.refresh();
  }

  // ---------- 자동투자 ----------

  let autoFreq = 'month';
  const FREQ_NAME = { day: '매일', week: '매주', month: '매월', year: '매년' };

  let editingId = null;

  function setFreq(freq) {
    autoFreq = freq;
    selectSeg($('aFreq'), 'freq', autoFreq);
  }

  function cancelEdit() {
    editingId = null;
    setText($('aGo'), '자동투자 추가');
    setText($('aFormTitle'), '새 자동투자');
    $('aCancel').hidden = true;
    setText($('aMsg'), '');
  }

  function startEdit(rule) {
    editingId = rule.id;
    $('aStock').value = rule.stockIdx;
    setFreq(rule.freq);
    $('aAmt').value = rule.amount.toLocaleString('en-US');
    setText($('aGo'), '수정 저장');
    setText($('aFormTitle'), '자동투자 편집');
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
    name.textContent = st.name;
    const sub = document.createElement('small');
    const when = rule.paused ? '정지됨' : `다음 ${next ? Format.date(next) : '없음'}`;
    sub.textContent = `${FREQ_NAME[rule.freq]} ${Format.money(rule.amount, st.currency)} · ${when}`;
    const btns = document.createElement('div');
    btns.className = 'autoBtns';
    for (const [act, label] of [['pause', rule.paused ? '다시 시작' : '정지'], ['edit', '편집'], ['delete', '삭제']]) {
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
    setText($('aAmtLabel'), stock.currency === 'USD' ? '회차당 금액 (달러)' : '회차당 금액 (원)');
    const listing = Engine.listingIdx(data, Number($('aStock').value));
    setText($('aListing'), listing > s.dayIdx ? `아직 상장 전입니다. ${Format.date(data.dates[listing])} 상장일부터 자동투자가 시작됩니다.` : '');
    setText($('aTitle'), `작동 중 ${s.autoRules.length}건`);
    const sig = JSON.stringify(s.autoRules) + s.dayIdx + UI.playing + editingId;
    fillList($('aList'), sig, () => s.autoRules.map(autoRow), '자동투자가 없습니다.');
  }

  function doAddAuto() {
    if (UI.playing) return;
    const rule = { stockIdx: Number($('aStock').value), freq: autoFreq, amount: parseNumber($('aAmt').value) };
    const r = editingId === null ? Engine.addAutoRule(UI.state, rule) : Engine.editAutoRule(UI.state, editingId, rule);
    setText($('aMsg'), r.ok ? '' : r.reason);
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
    setText($('rGo'), '매도 규칙 추가');
    setText($('rFormTitle'), '새 매도 규칙');
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
    setText($('rGo'), '수정 저장');
    setText($('rFormTitle'), '매도 규칙 편집');
    $('rCancel').hidden = false;
    setText($('rMsg'), '');
  }

  function sellRow(rule) {
    const row = document.createElement('div');
    const stopped = rule.paused || rule.firedDate;
    row.className = `autoRow${stopped ? ' stopped' : ''}${rule.id === editingSellId ? ' editing' : ''}`;
    const name = document.createElement('div');
    name.className = 'autoName';
    name.textContent = data.stocks[rule.stockIdx].name;
    const sub = document.createElement('small');
    const sign = rule.pct > 0 ? '+' : rule.pct < 0 ? '−' : '';
    const status = rule.firedDate ? `실행됨 ${Format.date(rule.firedDate)}` : rule.paused ? '정지됨' : '대기 중';
    const times = rule.times || 1;
    const repeat = times > 1 || rule.waitDays
      ? ` · ${times}회 · 대기 ${rule.waitDays || 0}일${rule.firedDate ? '' : ` · ${rule.firedCount || 0}/${times}회 실행`}` : '';
    sub.textContent = `수익률 ${sign}${Math.abs(rule.pct)}% ${rule.op === 'gte' ? '이상' : '이하'}이면 ${rule.sellPct}% 매도${repeat} · ${status}`;
    const btns = document.createElement('div');
    btns.className = 'autoBtns';
    for (const [act, label] of [['pause', stopped ? '다시 시작' : '정지'], ['edit', '편집'], ['delete', '삭제']]) {
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
    setText($('rTitle'), `매도 규칙 ${rules.length}건`);
    const sig = JSON.stringify(rules) + UI.playing + editingSellId;
    fillList($('rList'), sig, () => rules.map(sellRow), '매도 규칙이 없습니다.');
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
    setText($('rMsg'), r.ok ? '' : r.reason);
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
      for (const [board, label] of [['KOSPI', '코스피'], ['KOSDAQ', '코스닥'], ['US', '미국']]) {
        const group = document.createElement('optgroup');
        group.label = label;
        data.stocks.forEach((stock, i) => {
          if (stock.board !== board) return;
          const option = document.createElement('option');
          option.value = i;
          option.textContent = stock.name;
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
