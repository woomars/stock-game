// 금액과 기록 문구. DOM을 쓰지 않는다.
// 한국어는 억·만 단위(원 글자 없음), 영어는 ₩ + K·M·B, 일본어는 ₩ + 億·万 단위로 쓴다.
(function () {
  const I18N = globalThis.I18N || (typeof require !== 'undefined' ? require('./i18n.js') : null);
  const MINUS = '−';
  const lang = () => (I18N ? I18N.lang : 'ko');
  const t = (key, params) => I18N.t(key, params);
  const msg = (text) => (I18N ? I18N.msg(text) : text);
  const nameOf = (stock) => (I18N ? I18N.stockName(stock) : stock.name);

  function comma(n) { return Math.round(n).toLocaleString('en-US'); }

  function bad(n) { return typeof n !== 'number' || !Number.isFinite(n); }

  // 억·만 단위. 한국어는 단위 사이를 띄우고, 일본어는 붙인다.
  function unitsAbs(v, eokMark, manMark, gap) {
    const eok = Math.floor(v / 100000000);
    const man = Math.floor((v % 100000000) / 10000);
    const rest = v % 10000;
    const parts = [];
    if (eok) parts.push(`${comma(eok)}${eokMark}`);
    if (man) parts.push(`${comma(man)}${manMark}`);
    if (rest || !parts.length) parts.push(comma(rest));
    return parts.join(gap);
  }

  // 0.01 단위까지 버린 뒤 뒤쪽 0을 지운다(12.30 → 12.3).
  function trimmed(x) {
    const v = Math.floor(x * 100 + 1e-6) / 100;
    return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  // 영어 약식. v는 이미 만 단위로 버린 값이다.
  function compactEn(v) {
    if (v >= 1e9) return `${trimmed(v / 1e9)}B`;
    if (v >= 1e6) return `${trimmed(v / 1e6)}M`;
    if (v >= 1e4) return `${trimmed(v / 1e3)}K`;
    return comma(v);
  }

  function krwAbs(n) {
    const v = Math.round(Math.abs(n));
    if (lang() === 'en') return `₩${comma(v)}`;
    if (lang() === 'ja') return `₩${unitsAbs(v, '億', '万', '')}`;
    return unitsAbs(v, '억', '만', ' ');
  }

  function krwShortAbs(n) {
    const a = Math.abs(n);
    const v = Math.round(a >= 10000 ? Math.floor(a / 10000) * 10000 : a);
    if (lang() === 'en') return `₩${compactEn(v)}`;
    if (lang() === 'ja') return `₩${unitsAbs(v, '億', '万', '')}`;
    return unitsAbs(v, '억', '만', ' ');
  }

  function zero() { return lang() === 'ko' ? '0' : '₩0'; }

  function krw(n) {
    if (bad(n)) return '-';
    return (n < 0 ? MINUS : '') + krwAbs(n);
  }

  function krwSigned(n) {
    if (bad(n)) return '-';
    if (Math.round(n) === 0) return zero();
    return (n > 0 ? '+' : MINUS) + krwAbs(n);
  }

  // 공간이 좁은 곳용. 억·만 단위가 있으면 만 아래를 버린다.
  function krwShort(n) {
    if (bad(n)) return '-';
    return (n < 0 ? MINUS : '') + krwShortAbs(n);
  }

  function krwSignedShort(n) {
    if (bad(n)) return '-';
    if (Math.round(n) === 0) return zero();
    return (n > 0 ? '+' : MINUS) + krwShortAbs(n);
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

  // 날짜 구분자. 한국어 2021.03.16, 영어 2021-03-16, 일본어 2021/03/16.
  function dateSep() { return { ko: '.', en: '-', ja: '/' }[lang()] || '.'; }

  function date(s) { return s.replaceAll('-', dateSep()); }

  function usd2(v) { return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

  // 원화 금액에 붙는 통화 표시. 한국어는 뒤에 '원', 그 밖은 앞에 '₩'.
  function wonMark(body) { return lang() === 'ko' ? `${body}원` : `₩${body}`; }

  function rate(v) { return wonMark(v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })); }

  // 소수점 없는 환율(예약 조건, 상단 표시).
  function rateWhole(v) { return wonMark(comma(v)); }

  function price(stock, v) {
    if (bad(v)) return '-';
    return stock.currency === 'USD' ? usd2(v) : wonMark(comma(v));
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

  // 화면에 그릴 때 언어를 따라가도록 이름표는 매번 읽는다.
  const BOND_NAME = {};
  const DIR_NAME = {};
  for (const k of ['KR', 'US']) Object.defineProperty(BOND_NAME, k, { enumerable: true, get: () => t(`bond.${k}`) });
  for (const k of ['KRW_TO_USD', 'USD_TO_KRW']) Object.defineProperty(DIR_NAME, k, { enumerable: true, get: () => t(`dir.${k}`) });

  function signedPct(p) {
    const sign = p > 0 ? '+' : p < 0 ? MINUS : '';
    return `${sign}${Math.abs(p)}`;
  }

  function eventLine(data, e) {
    const when = date(data.dates[e.d]);
    const stock = e.stockIdx === undefined ? null : data.stocks[e.stockIdx];
    const name = stock ? nameOf(stock) : '';
    const make = (type, text) => ({ date: when, label: t(`ev.${type}`), text });
    const shares = (n) => ({ qty: qty(n), n });
    switch (e.type) {
      case 'buy':
      case 'sell':
        return make(e.type, t('ev.trade', { name, ...shares(e.qty), price: price(stock, e.price) }));
      case 'rule_sell': {
        const cond = t('ev.ruleCond', { pct: signedPct(e.pct), op: e.op });
        const run = e.times > 1 ? t('ev.ruleRun', { run: e.run, times: e.times }) : '';
        return make('rule_sell', `${t('ev.trade', { name, ...shares(e.qty), price: price(stock, e.price) })} · ${cond}${run}`);
      }
      case 'auto_buy': return make('auto_buy', t('ev.autoBuy', { name, money: money(e.amount, stock.currency), ...shares(e.qty) }));
      case 'skip': {
        const reason = e.reason === '잔액 부족' ? t('ev.noKrw') : msg(e.reason);
        return make('skip', t('ev.skipLine', { name, money: money(e.amount, stock.currency), reason }));
      }
      case 'start_moved': return make('start_moved', t('ev.startMoved', { name }));
      case 'deposit': return make('deposit', t('ev.depositLine', { money: krw(e.amount) }));
      case 'dividend': return make('dividend', t('ev.dividendLine', { name, ...shares(e.qty), money: money(e.amount, stock.currency) }));
      case 'split': return make('split', t('ev.splitLine', { name, ratio: qty(e.ratio), ...shares(e.qty) }));
      case 'fx': return make('fx', t('ev.fxLine', { dir: DIR_NAME[e.dir], usd: usd(e.usd), rate: rate(e.rate) }));
      case 'fx_order': {
        const limit = lang() === 'ko' ? comma(e.limit) : rateWhole(e.limit);
        return make('fx_order', t('ev.fxOrderLine', { usd: usd(e.usd), limit, op: e.op, rate: rate(e.rate) }));
      }
      case 'fx_auto': return make('fx_auto', t('ev.fxAutoLine', { usd: usd(e.usd), rate: rate(e.rate) }));
      case 'bond_buy':
        return make('bond_buy', t('ev.bondBuyLine', {
          bond: BOND_NAME[e.country], money: money(e.principal, e.currency), rate: e.ratePct, date: date(e.maturityDate),
        }));
      case 'bond_maturity':
        return make('bond_maturity', t('ev.bondMatureLine', {
          bond: BOND_NAME[e.country], principal: money(e.principal, e.currency), payout: money(e.payout, e.currency),
        }));
      default: return { date: when, label: e.type, text: '' };
    }
  }

  const Format = {
    krw, krwSigned, krwShort, krwSignedShort, usd, usdSigned, usd2, money, pct, date, dateSep, price, priceBare, qty, rate, rateWhole,
    signedPct, eventLine, BOND_NAME, DIR_NAME,
  };
  globalThis.Format = Format;
  if (typeof module !== 'undefined') module.exports = Format;
})();
