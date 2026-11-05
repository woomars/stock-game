// 게임별 투자 보고서 기록. 데이터가 바뀌어도 그대로 볼 수 있게 보고서를 통째로 남긴다.
(function () {
  const load = (name, file) => globalThis[name] || (typeof require !== 'undefined' ? require(file) : null);
  const Engine = load('Engine', './engine.js');
  const Format = load('Format', './format.js');
  const FREQ_NAME = { day: '매일', week: '매주', month: '매월', year: '매년' };

  function ruleTexts(data, state) {
    const auto = state.autoRules.map((r) => {
      const s = data.stocks[r.stockIdx];
      return `${s.name} ${FREQ_NAME[r.freq]} ${Format.money(r.amount, s.currency)}`;
    });
    const sell = (state.sellRules || []).map((r) => {
      const sign = r.pct > 0 ? '+' : r.pct < 0 ? '−' : '';
      return `${data.stocks[r.stockIdx].name} ${sign}${Math.abs(r.pct)}% ${r.op === 'gte' ? '이상' : '이하'} ${r.sellPct}% 매도`;
    });
    return [...auto, ...sell];
  }

  function make(data, state, { id, name, createdAt }) {
    const report = Engine.report(data, state);
    report.stocks = report.stocks.map((r) => ({
      ...r, name: data.stocks[r.stockIdx].name, currency: data.stocks[r.stockIdx].currency,
    }));
    return { id, name, createdAt, dataVersion: data.version, settings: { ...state.settings }, rules: ruleTexts(data, state), report };
  }

  function nextName(records) {
    const numbers = records.map((r) => /^기록 (\d+)$/.exec(r.name)).filter(Boolean).map((m) => Number(m[1]));
    return `기록 ${Math.max(0, ...numbers) + 1}`;
  }

  function bestId(records) {
    const comparable = records.filter((r) => r.report.annualPct !== null);
    if (comparable.length < 2) return null;
    return comparable.reduce((a, b) => (b.report.annualPct > a.report.annualPct ? b : a)).id;
  }

  function feeTotal(report) { return report.fxFeesKrw + report.tradeFeesKrw; }

  function allSame(values) { return values.every((v) => v === values[0]); }

  // 고른 기록들을 비교한 리포트 내용. 연환산이 비교 기준이고, 값이 없는 기록은 맨 뒤로 보낸다.
  function compare(records) {
    const known = records.filter((r) => r.report.annualPct !== null);
    const top = known.length ? Math.max(...known.map((r) => r.report.annualPct)) : null;
    const sorted = [...known].sort((a, b) => b.report.annualPct - a.report.annualPct)
      .concat(records.filter((r) => r.report.annualPct === null));
    const ranked = sorted.map((r, i) => ({
      id: r.id, name: r.name, rules: r.rules, settings: r.settings, report: r.report,
      rank: r.report.annualPct === null ? null : i + 1,
      gap: r.report.annualPct === null ? null : r.report.annualPct - top,
    }));

    const leader = (key, label, value, wantLow = false) => {
      const pool = records.filter((r) => value(r.report) !== null);
      if (!pool.length) return null;
      const win = pool.reduce((a, b) => {
        const better = wantLow ? value(b.report) < value(a.report) : value(b.report) > value(a.report);
        return better ? b : a;
      });
      return { key, label, id: win.id, name: win.name, value: value(win.report) };
    };
    const leaders = [
      leader('annual', '연환산', (r) => r.annualPct),
      leader('pct', '원금 대비', (r) => r.pnlPct),
      leader('pnl', '손익', (r) => r.pnl),
      leader('total', '최종 자산', (r) => r.total),
      leader('fees', '수수료가 가장 적음', feeTotal, true),
    ].filter(Boolean);

    const beats = (index) => known.filter((r) => r.report[index] !== null && r.report.annualPct > r.report[index]).length;
    const samePeriod = allSame(records.map((r) => `${r.report.startDate}~${r.report.endDate}`));
    const sameMoney = allSame(records.map((r) => r.report.contributed));
    const first = records[0] && records[0].report;

    const table = new Map();
    for (const r of records) {
      for (const s of r.report.stocks) {
        if (!table.has(s.name)) table.set(s.name, { name: s.name, currency: s.currency, best: -Infinity, cells: {} });
        const row = table.get(s.name);
        row.cells[r.id] = { pnlPct: s.pnlPct, annualPct: s.annualPct, pnlKrw: s.pnlKrw };
        row.best = Math.max(row.best, s.pnlKrw);
      }
    }
    const stocks = [...table.values()].sort((a, b) => b.best - a.best);

    return {
      ranked, leaders, stocks, samePeriod, sameMoney, measured: known.length,
      beatKospi: beats('kospiAnnualPct'), beatSp: beats('spAnnualPct'),
      // 넣은 돈의 날짜까지 같아야 지수 값도 같으므로, 기간과 금액이 모두 같을 때만 기준선을 보여 준다.
      baseline: samePeriod && sameMoney && first ? { kospi: first.kospiAnnualPct, sp: first.spAnnualPct } : null,
    };
  }

  const Records = { make, nextName, bestId, feeTotal, compare };
  globalThis.Records = Records;
  if (typeof module !== 'undefined') module.exports = Records;
})();
