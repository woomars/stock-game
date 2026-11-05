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

  const Records = { make, nextName, bestId, feeTotal };
  globalThis.Records = Records;
  if (typeof module !== 'undefined') module.exports = Records;
})();
