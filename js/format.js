// 금액과 기록 문구. DOM을 쓰지 않는다.
(function () {
  const MINUS = '−';

  function comma(n) { return Math.round(n).toLocaleString('en-US'); }

  function bad(n) { return typeof n !== 'number' || !Number.isFinite(n); }

  function krwAbs(n) {
    const v = Math.round(Math.abs(n));
    const eok = Math.floor(v / 100000000);
    const man = Math.floor((v % 100000000) / 10000);
    const rest = v % 10000;
    const parts = [];
    if (eok) parts.push(`${comma(eok)}억`);
    if (man) parts.push(`${comma(man)}만`);
    if (rest || !parts.length) parts.push(comma(rest));
    return parts.join(' ');
  }

  function krw(n) {
    if (bad(n)) return '-';
    return (n < 0 ? MINUS : '') + krwAbs(n);
  }

  function krwSigned(n) {
    if (bad(n)) return '-';
    if (Math.round(n) === 0) return '0';
    return (n > 0 ? '+' : MINUS) + krwAbs(n);
  }

  // 공간이 좁은 곳용. 억·만 단위가 있으면 만 아래를 버린다.
  function krwShort(n) {
    if (bad(n)) return '-';
    const v = Math.abs(n) >= 10000 ? Math.floor(Math.abs(n) / 10000) * 10000 : Math.abs(n);
    return (n < 0 ? MINUS : '') + krwAbs(v);
  }

  function krwSignedShort(n) {
    if (bad(n)) return '-';
    if (Math.round(n) === 0) return '0';
    return (n > 0 ? '+' : MINUS) + krwShort(Math.abs(n));
  }

  function usd(n) {
    if (bad(n)) return '-';
    const a = Math.abs(n);
    const body = Number.isInteger(Math.round(a * 100) / 100)
      ? comma(a)
      : a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${n < 0 ? MINUS : ''}$${body}`;
  }

  function usdSigned(n) {
    if (bad(n)) return '-';
    if (Math.round(n * 100) === 0) return '$0';
    return (n > 0 ? '+' : '') + usd(n);
  }

  function money(n, currency) { return currency === 'USD' ? usd(n) : krw(n); }

  function pct(n) {
    if (bad(n)) return '-';
    const r = Math.round(Math.abs(n) * 10) / 10;
    if (r === 0) return '0.0%';
    return `${n > 0 ? '+' : MINUS}${r.toFixed(1)}%`;
  }

  function date(s) { return s.replaceAll('-', '.'); }

  function usd2(v) { return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

  function rate(v) { return `${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}원`; }

  function price(stock, v) {
    if (bad(v)) return '-';
    return stock.currency === 'USD' ? usd2(v) : `${comma(v)}원`;
  }

  // 목록용. 원 글자 없이 숫자만.
  function priceBare(stock, v) {
    if (bad(v)) return '-';
    return stock.currency === 'USD' ? usd2(v) : comma(v);
  }

  function qty(n) {
    if (bad(n)) return '-';
    return (Math.round(n * 10000) / 10000).toLocaleString('en-US', { maximumFractionDigits: 4 });
  }

  const BOND_NAME = { KR: '한국 국고채', US: '미국 국채' };
  const DIR_NAME = { KRW_TO_USD: '원화 → 달러', USD_TO_KRW: '달러 → 원화' };

  function eventLine(data, e) {
    const when = date(data.dates[e.d]);
    const stock = e.stockIdx === undefined ? null : data.stocks[e.stockIdx];
    const make = (label, text) => ({ date: when, label, text });
    switch (e.type) {
      case 'buy': return make('매수', `${stock.name} ${qty(e.qty)}주 · ${price(stock, e.price)}`);
      case 'sell': return make('매도', `${stock.name} ${qty(e.qty)}주 · ${price(stock, e.price)}`);
      case 'rule_sell': {
        const sign = e.pct > 0 ? '+' : e.pct < 0 ? MINUS : '';
        const cond = `수익률 ${sign}${Math.abs(e.pct)}% ${e.op === 'gte' ? '이상' : '이하'}`;
        const run = e.times > 1 ? ` · ${e.run}/${e.times}회` : '';
        return make('매도 규칙', `${stock.name} ${qty(e.qty)}주 · ${price(stock, e.price)} · ${cond}${run}`);
      }
      case 'auto_buy': return make('자동투자', `${stock.name} ${money(e.amount, stock.currency)} → ${qty(e.qty)}주`);
      case 'skip': {
        const reason = e.reason === '잔액 부족' ? '원화 잔액 부족' : e.reason;
        return make('건너뜀', `${stock.name} 자동투자 ${money(e.amount, stock.currency)} · ${reason}`);
      }
      case 'start_moved': return make('시작일 변경', `${stock.name} 상장일부터 시작합니다`);
      case 'deposit': return make('입금', `월 추가 투자금 ${krw(e.amount)}`);
      case 'dividend': return make('배당', `${stock.name} ${qty(e.qty)}주 ${money(e.amount, stock.currency)}`);
      case 'split': return make('주식 수 변경', `${stock.name} ×${qty(e.ratio)} → ${qty(e.qty)}주`);
      case 'fx': return make('환전', `${DIR_NAME[e.dir]} ${usd(e.usd)} · 적용 환율 ${rate(e.rate)}`);
      case 'fx_order': {
        const cond = `환율 ${comma(e.limit)}원 ${e.op === 'lte' ? '이하' : '이상'} 조건 충족`;
        return make('조건 환전', `${usd(e.usd)} · ${cond}, 적용 환율 ${rate(e.rate)}`);
      }
      case 'fx_auto': return make('자동 환전', `달러 부족분 ${usd(e.usd)} · 적용 환율 ${rate(e.rate)}`);
      case 'bond_buy':
        return make('채권 매수', `${BOND_NAME[e.country]} ${money(e.principal, e.currency)} · 금리 ${e.ratePct}% · 만기 ${date(e.maturityDate)}`);
      case 'bond_maturity':
        return make('채권 만기', `${BOND_NAME[e.country]} ${money(e.principal, e.currency)} → ${money(e.payout, e.currency)}`);
      default: return make(e.type, '');
    }
  }

  const Format = {
    krw, krwSigned, krwShort, krwSignedShort, usd, usdSigned, usd2, money, pct, date, price, priceBare, qty, rate, eventLine,
    BOND_NAME, DIR_NAME,
  };
  globalThis.Format = Format;
  if (typeof module !== 'undefined') module.exports = Format;
})();
