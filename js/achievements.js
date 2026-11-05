// 트로피와 메달. 게임 규칙에는 영향을 주지 않고, DOM을 쓰지 않는다.
(function () {
  const Engine = globalThis.Engine || (typeof require !== 'undefined' ? require('./engine.js') : null);

  const TIER_ICON = { bronze: '🥉', silver: '🥈', gold: '🏆', plat: '👑', dia: '💎', sad: '🥀' };
  const MIN_TROPHY_YEARS = 5;

  const annualAtLeast = (pct) => (r) => (r.annualPct !== null && (pct === 0 ? r.annualPct > 0 : r.annualPct >= pct));
  const multipleAtLeast = (n) => (r) => r.total >= r.contributed * n;
  const beats = (index, margin) => (r) => (r.annualPct !== null && r[index] !== null
    && (margin ? r.annualPct >= r[index] + margin : r.annualPct > r[index]));

  const annual = (id, name, pct, tier) => ({ id, name, desc: pct ? `연 ${pct}% 이상` : '연 0% 초과', tier, group: '연환산 수익률', test: annualAtLeast(pct) });
  const multiple = (name, n, tier) => ({ id: `x${n}`, name, desc: `원금의 ${n}배`, tier, group: '원금 대비 배수', test: multipleAtLeast(n) });
  const vs = (id, name, desc, tier, test) => ({ id, name, desc, tier, group: '지수와의 대결', test });
  const loss = (id, name, desc, test) => ({ id, name, desc, tier: 'sad', group: '손실 트로피', test });

  const TROPHIES = [
    annual('annual0', '플러스 인생', 0, 'bronze'),
    annual('annual3', '예금은 이겼다', 3, 'bronze'),
    annual('annual5', '든든한 노후', 5, 'bronze'),
    annual('annual7', '시장 평균', 7, 'silver'),
    annual('annual10', '두 자릿수', 10, 'silver'),
    annual('annual12', '복리의 맛', 12, 'silver'),
    annual('annual15', '고수의 길', 15, 'gold'),
    annual('annual20', '버핏 따라잡기', 20, 'gold'),
    annual('annual25', '월가의 영웅', 25, 'gold'),
    annual('annual30', '메달리온', 30, 'plat'),
    annual('annual40', '시간 여행자', 40, 'plat'),
    annual('annual50', '전설', 50, 'dia'),
    multiple('두 배', 2, 'bronze'),
    multiple('세 배', 3, 'silver'),
    multiple('다섯 배', 5, 'gold'),
    multiple('열 배', 10, 'gold'),
    multiple('스무 배', 20, 'plat'),
    multiple('오십 배', 50, 'plat'),
    multiple('백 배', 100, 'dia'),
    vs('beatKospi', '코스피 격파', '코스피보다 연환산 높음', 'silver', beats('kospiAnnualPct')),
    vs('beatSp', 'S&P 격파', 'S&P 500보다 연환산 높음', 'gold', beats('spAnnualPct')),
    vs('beatBoth', '쌍끌이', '두 지수 모두 이김', 'gold', (r) => beats('kospiAnnualPct')(r) && beats('spAnnualPct')(r)),
    vs('crushKospi', '코스피 압승', '코스피보다 연 5%p 이상', 'plat', beats('kospiAnnualPct', 5)),
    vs('crushSp', 'S&P 압승', 'S&P 500보다 연 5%p 이상', 'dia', beats('spAnnualPct', 5)),
    loss('loss', '수업료', '손익이 마이너스로 끝남', (r) => r.pnl < 0),
    { ...loss('half', '고등어', '반토막: 원금의 1/2 이하로 끝남', (r) => r.total <= r.contributed / 2), icon: '🐟' },
    { ...loss('third', '갈치', '1/3토막: 원금의 1/3 이하로 끝남', (r) => r.total <= r.contributed / 3), icon: '🎣' },
    loss('wipe', '깡통 직전', '원금의 20% 이하로 끝남', (r) => r.total <= r.contributed * 0.2),
    // 화면에 -100.0%로 나오는 손실까지 포함한다.
    { ...loss('beggarPrince', '거지왕자', '원금 100% 손실', (r) => r.total <= r.contributed * 0.0005), icon: '🪙' },
  ];

  function addYears(date, years) { return `${Number(date.slice(0, 4)) + years}${date.slice(4)}`; }

  function isTrophyGame(report) {
    return report.contributed > 0 && addYears(report.startDate, MIN_TROPHY_YEARS) <= report.endDate;
  }

  function trophiesFor(report) {
    return isTrophyGame(report) ? TROPHIES.filter((t) => t.test(report)) : [];
  }

  // ---------- 메달 ----------

  const SPINOFFS = {
    '207940.KS': '2025-10-30', '012450.KS': '2024-08-29', '003550.KS': '2021-05-27', '009540.KS': '2017-05-10', '017670.KS': '2021-11-29',
  };

  const medal = (group) => (id, icon, name, desc, test) => ({ id, icon, name, desc, group, test });
  const M1 = medal('첫 경험');
  const M2 = medal('매매');
  const M3 = medal('자동투자');
  const M4 = medal('분산');
  const M5 = medal('환전과 채권');
  const M6 = medal('시장 타이밍');
  const M7 = medal('수익 종목');
  const M8 = medal('실수와 재미');
  const M9 = medal('주식 밈');

  const MEDALS = [
    M1('firstBuy', '🛒', '첫 매수', '주식을 처음 삼', (c) => c.buys + c.autoBuys >= 1),
    M1('firstSell', '💰', '첫 매도', '주식을 처음 팖', (c) => c.sells + c.ruleSells >= 1),
    M1('firstFx', '💱', '첫 환전', '환전을 처음 함', (c) => c.fxCount >= 1),
    M1('firstBond', '🏦', '첫 채권', '채권을 처음 삼', (c) => c.bonds >= 1),
    M1('firstAuto', '🤖', '첫 자동투자', '자동투자를 처음 체결', (c) => c.autoBuys >= 1),
    M1('firstRule', '🎯', '첫 매도 규칙', '매도 규칙이 처음 실행', (c) => c.ruleSells >= 1),
    M1('firstOrder', '⏰', '첫 예약 환전', '조건 환전이 처음 실행', (c) => c.fxOrders >= 1),
    M1('firstDividend', '🎁', '첫 배당', '배당을 처음 받음', (c) => c.dividends >= 1),

    M2('buy10', '🖐️', '단타 입문', '수동 매수 10회', (c) => c.buys >= 10),
    M2('buy100', '🔥', '매수 중독', '수동 매수 100회', (c) => c.buys >= 100),
    M2('sell10', '✂️', '차익 실현', '수동 매도 10회', (c) => c.sells >= 10),
    M2('sell100', '🏃', '손이 빠른 사람', '수동 매도 100회', (c) => c.sells >= 100),
    M2('close10', '🧹', '깔끔한 정리', '전량 매도 10회', (c) => c.closed >= 10),
    M2('whale', '🐳', '큰손', '한 번에 1억 원 이상 주문', (c) => c.biggestOrder >= 1e8),
    M2('bigWhale', '🌊', '고래', '한 번에 10억 원 이상 주문', (c) => c.biggestOrder >= 1e9),
    M2('threeInADay', '🎪', '하루 세 종목', '같은 날 3종목 매수', (c) => c.mostBuysInADay >= 3),

    M3('auto100', '🌱', '꾸준함의 시작', '자동투자 100회 체결', (c) => c.autoBuys >= 100),
    M3('auto500', '🌿', '습관', '자동투자 500회 체결', (c) => c.autoBuys >= 500),
    M3('auto1000', '🌳', '10년 나무', '자동투자 1,000회 체결', (c) => c.autoBuys >= 1000),
    M3('rules3', '🧩', '세 갈래', '자동투자 3건 동시 작동', (c) => c.mostRules >= 3),
    M3('rules5', '🕸️', '다섯 갈래', '자동투자 5건 동시 작동', (c) => c.mostRules >= 5),
    M3('daily100', '📅', '매일 출근', '매일 자동투자 100회 체결', (c) => c.autoDaily >= 100),
    M3('autoUs50', '🇺🇸', '미국 적립', '미국 주식 자동투자 50회', (c) => c.autoUs >= 50),
    M3('emptyWallet', '😅', '텅 빈 지갑', '잔액 부족으로 회차를 건너뜀', (c) => c.emptySkips >= 1),

    M4('hold5', '🖐', '다섯 바구니', '5종목 동시 보유', (c) => c.mostHeld >= 5),
    M4('hold10', '🔟', '열 바구니', '10종목 동시 보유', (c) => c.mostHeld >= 10),
    M4('hold20', '🧺', '스무 바구니', '20종목 동시 보유', (c) => c.mostHeld >= 20),
    M4('hold40', '🏪', '종합 시장', '40종목 동시 보유', (c) => c.mostHeld >= 40),
    M4('hold60', '🌐', '전 종목 보유', '60종목 동시 보유', (c) => c.mostHeld >= 60),
    M4('krUs', '🌏', '한미 동맹', '한국·미국 주식 동시 보유', (c) => c.heldKrUs),
    M4('stockBond', '🛡️', '채권 방패', '주식과 채권 동시 보유', (c) => c.heldStockBond),

    M5('usd10k', '💵', '달러 부자', '달러 1만 달러 보유', (c) => c.mostUsd >= 10000),
    M5('usd100k', '🤑', '달러 큰손', '달러 10만 달러 보유', (c) => c.mostUsd >= 100000),
    M5('fxFee1m', '🏧', '환전 단골', '환전 수수료 합계 100만 원', (c) => c.fxFeeKrw >= 1e6),
    M5('lowFx', '📉', '환율 저점', '1,100원 이하에서 달러 삼', (c) => c.boughtLow),
    M5('highFx', '📈', '환율 고점', '1,400원 이상에서 달러 팖', (c) => c.soldHigh),
    M5('bond10', '📜', '채권 수집가', '채권 10회 매수', (c) => c.bonds >= 10),
    M5('mature10', '⏳', '만기 채움', '채권 만기 10회', (c) => c.maturities >= 10),
    M5('usBond', '🗽', '미국 국채', '미국 국채 매수', (c) => c.usBonds >= 1),
    M5('interest1m', '🧾', '이자 생활', '채권 이자 합계 100만 원', (c) => c.interestKrw >= 1e6),

    M6('panicBuy', '😱', '공포에 매수', '2020년 3월 폭락 때 매수', (c) => c.panicBuy),
    M6('panicSell', '🏳️', '공포에 매도', '2020년 3월 폭락 때 전량 매도', (c) => c.panicSell),
    M6('cold2022', '🧊', '냉정한 2022', '2022년 내내 팔지 않고 보유', (c) => c.cold2022),
    M6('blackMonday', '⚡', '검은 월요일', '2024-08-05 폭락일에 매수', (c) => c.blackMonday),
    M6('hodl', '🗿', '10년 존버', '첫 종목을 5년 이상 끝까지 안 팖', (c) => c.hodl),
    M6('listingDay', '🚀', '상장 첫날', '상장일에 그 종목 매수', (c) => c.listingDay),
    M6('split', '✂', '액면분할 경험', '보유 중 액면분할·무상증자', (c) => c.splits >= 1),
    M6('spinoff', '🪓', '인적분할 경험', '보유 중 인적분할', (c) => c.spinoffs >= 1),

    M7('double', '🎈', '따블', '한 종목 +100%', (c) => c.bestGain >= 2),
    M7('tenBagger', '🎆', '텐배거', '한 종목 +900%', (c) => c.bestGain >= 10),
    M7('hundredBagger', '🌋', '백배거', '한 종목 +9,900%', (c) => c.bestGain >= 100),
    M7('dividend100', '💧', '배당 맛집', '배당 100회 받음', (c) => c.dividends >= 100),
    M7('dividend10m', '🏞️', '배당 천만', '배당 합계 1천만 원', (c) => c.dividendKrw >= 1e7),
    M7('dividend100m', '🏝️', '배당 일억', '배당 합계 1억 원', (c) => c.dividendKrw >= 1e8),

    M8('bagHolder', '🐟', '고등어 손질', '산 종목이 반토막(평균 단가의 1/2 이하)', (c) => c.worstGain <= 1 / 2),
    M8('bagHolder3', '🎣', '갈치 손질', '산 종목이 1/3토막(평균 단가의 1/3 이하)', (c) => c.worstGain <= 1 / 3),
    M8('dayTrade', '🌀', '샀다 팔았다', '같은 날 같은 종목을 사고 팖', (c) => c.dayTrade),
    M8('feeKing', '🧯', '수수료 기부왕', '수수료 합계 1천만 원', (c) => c.feeKrw >= 1e7),
    M8('doNothing', '🛌', '아무것도 안 함', '현금만 들고 끝까지', (c) => c.finished && !c.acted),
    M8('finish1', '🏁', '첫 완주', '게임 1판 완주', (c) => c.finishes >= 1),
    M8('finish10', '🎖️', '베테랑', '게임 10판 완주', (c) => c.finishes >= 10),

    M9('sapal50', '🔁', '사팔사팔 입문', '수동 매수·매도 합계 50회', (c) => c.buys + c.sells >= 50),
    M9('sapal200', '👑', '사팔사팔 왕', '수동 매수·매도 합계 200회', (c) => c.buys + c.sells >= 200),
    M9('sapal500', '🏯', '사팔사팔 황제', '수동 매수·매도 합계 500회', (c) => c.buys + c.sells >= 500),
    M9('water10', '💦', '물타기 장인', '손실 중인 종목 추가 매수 10회', (c) => c.waterBuys >= 10),
    M9('fire10', '🔥', '불타기 장인', '수익 중인 종목 추가 매수 10회', (c) => c.fireBuys >= 10),
    M9('cut10', '🔪', '손절의 달인', '손해 보고 매도 10회', (c) => c.lossSells >= 10),
    M9('take10', '🍯', '익절은 항상 옳다', '이익 보고 매도 10회', (c) => c.gainSells >= 10),
    M9('knife', '🗡️', '떨어지는 칼날', '하루 -10% 이상 떨어진 날 매수', (c) => c.knife),
    M9('moon', '🚀', '떡상', '보유 종목이 하루 +20% 이상', (c) => c.bestDay >= 20),
    M9('crash', '🪂', '떡락', '보유 종목이 하루 -15% 이하', (c) => c.worstDay <= -15),
    M9('upperLimit', '🔝', '상한가', '보유한 한국 종목이 하루 +29% 이상', (c) => c.bestDayKr >= 29),
    M9('lowerLimit', '🕳️', '하한가', '보유한 한국 종목이 하루 -29% 이하', (c) => c.worstDayKr <= -29),
    M9('tenManJeonja', '💯', '십만전자', '삼성전자 10만 원 이상일 때 보유', (c) => c.tenMan),
    M9('nineManStuck', '🪝', '구만전자 물림', '2021년 삼성전자를 9만 원 이상에 매수', (c) => c.nineMan),
    M9('fiveManDip', '🧺', '오만전자 줍줍', '삼성전자를 5만 원 이하에 매수', (c) => c.fiveMan),
    M9('emperorStock', '🤴', '황제주', '1주 100만 원 이상인 한국 종목 보유', (c) => c.emperor),
    M9('neKao', '🐻', '네카오', 'NAVER와 카카오 동시 보유', (c) => c.neKao),
    M9('teslam', '🚗', '테슬람', 'Tesla 보유', (c) => c.teslam),
    M9('seohak', '🐜', '서학개미', '미국 주식 5종목 동시 보유', (c) => c.mostHeldUs >= 5),
    M9('donghak', '🎌', '동학개미', '2020년 3월 폭락 때 한국 주식 매수', (c) => c.donghak),
    M9('kingDollar', '🦅', '킹달러', '환율 1,400원 이상일 때 1천 달러 이상 보유', (c) => c.kingDollar),
    M9('suddenRich', '⚡', '벼락부자', '하루에 손익 1억 원 이상 증가', (c) => c.bestDayPnl >= 1e8),
    M9('flashPoor', '🌩️', '벼락거지', '현금만 든 사이 코스피에 넣은 돈이 2배', (c) => c.flashPoor),
    M9('soulPull', '👻', '영끌', '현금 1% 이하로 주식 보유', (c) => c.soulPull),
    M9('allIn', '🎲', '몰빵', '한 종목이 총자산의 90% 이상', (c) => c.allIn),
    M9('exitKorea', '✈️', '국장 탈출', '한국 주식을 다 팔고 미국 주식만 보유', (c) => c.exitKorea),
    M9('paperHands', '🧻', '종이 손', '산 지 7일 안에 손해 보고 전량 매도', (c) => c.paperHands),
    M9('diamondHands', '💎', '다이아몬드 손', '반토막을 팔지 않고 버텨 원금 회복', (c) => c.diamondHands),
    M9('fomo', '🏃‍♂️', '포모', '1년 최고가에 매수', (c) => c.fomo),
    M9('stonks', '📈', 'Stonks', '전체 손익 +100% 도달', (c) => c.bestPnlPct >= 100),
    M9('notStonks', '📉', 'Not Stonks', '전체 손익 -50% 도달', (c) => c.worstPnlPct <= -50),
  ];

  const FX_TYPES = new Set(['fx', 'fx_order', 'fx_auto']);
  const PASSIVE_TYPES = new Set(['deposit', 'start_moved']);
  const inPanic = (date) => date >= '2020-03-09' && date <= '2020-03-23';
  const SAMSUNG = '005930.KS';
  const SAMSUNG_SPLIT = '2018-05-04';
  const FOMO_WINDOW = 245; // 약 1년치 거래일
  const FOMO_MIN_DAYS = 20; // 상장 직후는 비교할 고점이 없다
  const PAPER_DAYS = 7;

  const dayNum = (date) => Date.parse(date) / 86400000;

  // 분할을 뺀 하루 등락률(%). 그날 거래가 없으면 null.
  function dayMove(data, i, d) {
    const s = data.stocks[i];
    if (s.close[d] == null || d === 0) return null;
    let prev = Engine.lastClose(data, i, d - 1);
    if (prev == null) return null;
    for (const [splitIdx, ratio] of s.splits) if (splitIdx === d) prev /= ratio;
    return Math.round((s.close[d] / prev - 1) * 1e8) / 1e6; // 부동소수 오차 제거
  }

  function newCounters() {
    return {
      buys: 0, sells: 0, ruleSells: 0, autoBuys: 0, autoDaily: 0, autoUs: 0, closed: 0, emptySkips: 0, fxCount: 0, fxOrders: 0,
      fxFeeKrw: 0, feeKrw: 0, bonds: 0, usBonds: 0, maturities: 0, interestKrw: 0, dividends: 0, dividendKrw: 0, splits: 0, spinoffs: 0,
      biggestOrder: 0, mostBuysInADay: 0, mostRules: 0, mostHeld: 0, mostUsd: 0, bestGain: 0, worstGain: Infinity,
      heldKrUs: false, heldStockBond: false, boughtLow: false, soldHigh: false, panicBuy: false, panicSell: false,
      blackMonday: false, listingDay: false, dayTrade: false, cold2022: false, hodl: false,
      acted: false, finished: false, finishes: 0,
      waterBuys: 0, fireBuys: 0, lossSells: 0, gainSells: 0, knife: false, bestDay: -Infinity, worstDay: Infinity,
      bestDayKr: -Infinity, worstDayKr: Infinity, tenMan: false, nineMan: false, fiveMan: false, emperor: false, neKao: false,
      teslam: false, mostHeldUs: 0, donghak: false, kingDollar: false, bestDayPnl: -Infinity, flashPoor: false, soulPull: false,
      allIn: false, exitKorea: false, paperHands: false, diamondHands: false, fomo: false, bestPnlPct: -Infinity, worstPnlPct: Infinity,
    };
  }

  function newTracker() {
    const c = newCounters();
    const earned = new Set();
    let cursor = 0;
    let firstStock = null;
    let soldFirst = false;
    let held2022 = null;
    let sold2022 = false;
    const dayBuys = new Map(); // 날짜칸 → 수동 매수한 종목들
    const dayMoves = new Map(); // "날짜칸:종목" → 산 적/판 적
    const openedOn = new Map(); // 종목 → 보유를 시작한 날
    const halved = new Set(); // 반토막을 겪고 아직 팔지 않은 종목
    const soldSome = new Set(); // 지금 보유분을 일부라도 판 종목
    let everKr = false;
    let lastSnapshotDay = null;

    const krwOf = (data, e, amount) => (data.stocks[e.stockIdx].currency === 'USD' ? amount * data.fx[e.d] : amount);

    function move(e, kind) {
      const key = `${e.d}:${e.stockIdx}`;
      const seen = dayMoves.get(key) || {};
      seen[kind] = true;
      dayMoves.set(key, seen);
      if (seen.buy && seen.sell) c.dayTrade = true;
    }

    function isFomo(data, e) {
      const series = Engine.adjustedSeries(data, e.stockIdx, e.d).filter((v) => v != null);
      if (series.length < FOMO_MIN_DAYS) return false;
      return e.price >= Math.max(...series.slice(-FOMO_WINDOW));
    }

    function onBuy(data, e, date) {
      const stock = data.stocks[e.stockIdx];
      if (!openedOn.has(e.stockIdx)) openedOn.set(e.stockIdx, date);
      if (inPanic(date) && stock.market === 'KR') c.donghak = true;
      const move = dayMove(data, e.stockIdx, e.d);
      if (move !== null && move <= -10) c.knife = true;
      if (stock.id === SAMSUNG) {
        if (date.startsWith('2021') && e.price >= 90000) c.nineMan = true;
        if (date >= SAMSUNG_SPLIT && e.price <= 50000) c.fiveMan = true;
      }
      if (firstStock === null) firstStock = e.stockIdx;
      if (inPanic(date)) c.panicBuy = true;
      if (date === '2024-08-05') c.blackMonday = true;
      const listing = Engine.listingIdx(data, e.stockIdx);
      if (listing > 0 && e.d === listing) c.listingDay = true;
    }

    function onSell(e, date) {
      halved.delete(e.stockIdx);
      if (e.closed) soldSome.delete(e.stockIdx);
      else soldSome.add(e.stockIdx);
      if (e.price < e.avg) c.lossSells += 1;
      if (e.price > e.avg) c.gainSells += 1;
      if (e.closed) {
        const opened = openedOn.get(e.stockIdx);
        if (e.price < e.avg && opened && dayNum(date) - dayNum(opened) <= PAPER_DAYS) c.paperHands = true;
        openedOn.delete(e.stockIdx);
      }
      if (e.stockIdx === firstStock) soldFirst = true;
      if (date >= '2022-01-01' && date <= '2022-12-31') sold2022 = true;
      if (e.closed) {
        c.closed += 1;
        if (inPanic(date)) c.panicSell = true;
      }
    }

    function count(data, e) {
      const date = data.dates[e.d];
      if (!PASSIVE_TYPES.has(e.type)) c.acted = true;
      if (e.feeKrw) c.feeKrw += e.feeKrw;
      if (FX_TYPES.has(e.type)) {
        c.fxCount += 1;
        c.fxFeeKrw += e.feeKrw || 0;
        if (e.dir === 'KRW_TO_USD' && data.fx[e.d] <= 1100) c.boughtLow = true;
        if (e.dir === 'USD_TO_KRW' && data.fx[e.d] >= 1400) c.soldHigh = true;
      }
      switch (e.type) {
        case 'buy': {
          c.buys += 1;
          c.biggestOrder = Math.max(c.biggestOrder, krwOf(data, e, e.amount));
          const set = dayBuys.get(e.d) || new Set();
          set.add(e.stockIdx);
          dayBuys.set(e.d, set);
          c.mostBuysInADay = Math.max(c.mostBuysInADay, set.size);
          if (e.avg !== undefined && e.price < e.avg) c.waterBuys += 1;
          if (e.avg !== undefined && e.price > e.avg) c.fireBuys += 1;
          if (isFomo(data, e)) c.fomo = true;
          move(e, 'buy');
          onBuy(data, e, date);
          break;
        }
        case 'auto_buy':
          c.autoBuys += 1;
          if (e.freq === 'day') c.autoDaily += 1;
          if (data.stocks[e.stockIdx].currency === 'USD') c.autoUs += 1;
          onBuy(data, e, date);
          break;
        case 'sell':
          c.sells += 1;
          c.biggestOrder = Math.max(c.biggestOrder, krwOf(data, e, e.amount));
          move(e, 'sell');
          onSell(e, date);
          break;
        case 'rule_sell':
          c.ruleSells += 1;
          onSell(e, date);
          break;
        case 'fx_order': c.fxOrders += 1; break;
        case 'skip': if (e.reason === '잔액 부족') c.emptySkips += 1; break;
        case 'bond_buy':
          c.bonds += 1;
          if (e.country === 'US') c.usBonds += 1;
          break;
        case 'bond_maturity':
          c.maturities += 1;
          c.interestKrw += e.currency === 'USD' ? (e.payout - e.principal) * data.fx[e.d] : e.payout - e.principal;
          break;
        case 'dividend':
          c.dividends += 1;
          c.dividendKrw += krwOf(data, e, e.amount);
          break;
        case 'split':
          if (SPINOFFS[data.stocks[e.stockIdx].id] === date) c.spinoffs += 1;
          else c.splits += 1;
          break;
        default:
      }
    }

    function snapshot(data, state) {
      const date = data.dates[state.dayIdx];
      const held = Object.keys(state.holdings).map(Number);
      c.mostHeld = Math.max(c.mostHeld, held.length);
      c.mostUsd = Math.max(c.mostUsd, state.usd);
      c.mostRules = Math.max(c.mostRules, state.autoRules.filter((r) => !r.paused).length);
      if (held.length && state.bonds.length) c.heldStockBond = true;
      let kr = false;
      let us = false;
      let usCount = 0;
      const d = state.dayIdx;
      const v = Engine.valuation(data, state);
      const newDay = lastSnapshotDay !== d;
      lastSnapshotDay = d;
      for (const i of held) {
        const stock = data.stocks[i];
        if (stock.market === 'US') { us = true; usCount += 1; } else kr = true;
        const price = Engine.lastClose(data, i, d);
        if (price != null) {
          const ratio = price / state.holdings[i].avgCost;
          if (ratio > c.bestGain) c.bestGain = ratio;
          if (ratio < c.worstGain) c.worstGain = ratio;
          if (ratio <= 0.5 && !soldSome.has(i)) halved.add(i);
          if (ratio >= 1 && halved.has(i)) c.diamondHands = true;
          const worth = stock.currency === 'USD' ? state.holdings[i].qty * price * data.fx[d] : state.holdings[i].qty * price;
          if (v.total > 0 && worth >= v.total * 0.9) c.allIn = true;
          if (stock.market === 'KR' && price >= 1e6) c.emperor = true;
          if (stock.id === SAMSUNG && date >= SAMSUNG_SPLIT && price >= 100000) c.tenMan = true;
          if (stock.id === 'TSLA') c.teslam = true;
        }
        const move = newDay ? dayMove(data, i, d) : null;
        if (move !== null) {
          if (move > c.bestDay) c.bestDay = move;
          if (move < c.worstDay) c.worstDay = move;
          if (stock.market === 'KR') {
            if (move > c.bestDayKr) c.bestDayKr = move;
            if (move < c.worstDayKr) c.worstDayKr = move;
          }
        }
      }
      if (kr && us) c.heldKrUs = true;
      if (kr) everKr = true;
      if (us && !kr && everKr) c.exitKorea = true;
      c.mostHeldUs = Math.max(c.mostHeldUs, usCount);
      const heldIds = new Set(held.map((i) => data.stocks[i].id));
      if (heldIds.has('035420.KS') && heldIds.has('035720.KS')) c.neKao = true;
      if (state.usd >= 1000 && data.fx[d] >= 1400) c.kingDollar = true;
      if (held.length && v.total > 0 && v.krw + v.usdKrw <= v.total * 0.01) c.soulPull = true;
      const pnl = state.history.pnl;
      if (pnl.length >= 2) c.bestDayPnl = Math.max(c.bestDayPnl, pnl[pnl.length - 1] - pnl[pnl.length - 2]);
      if (state.contributed > 0) {
        const pct = v.pnl / state.contributed * 100;
        c.bestPnlPct = Math.max(c.bestPnlPct, pct);
        c.worstPnlPct = Math.min(c.worstPnlPct, pct);
      }
      if (held2022 === null && date >= '2022-01-01' && date <= '2022-12-31') held2022 = held.length > 0;
      if (date >= '2023-01-01' && held2022 && !sold2022 && held.length) c.cold2022 = true;
    }

    function collect() {
      const fresh = [];
      for (const m of MEDALS) {
        if (!earned.has(m.id) && m.test(c)) {
          earned.add(m.id);
          fresh.push(m.id);
        }
      }
      return fresh;
    }

    return {
      counters: c,
      // 지금까지의 진행을 반영하고 새로 받은 메달 id를 돌려준다.
      update(data, state) {
        for (; cursor < state.events.length; cursor += 1) count(data, state.events[cursor]);
        snapshot(data, state);
        return collect();
      },
      // 마지막 날 호출한다. finishes는 이번 판까지 완주한 횟수다.
      finish(data, state, finishes) {
        const fresh = this.update(data, state);
        c.finished = true;
        c.finishes = finishes;
        const start = data.dates[state.startIdx];
        const longEnough = addYears(start, MIN_TROPHY_YEARS) <= data.dates[state.dayIdx];
        c.hodl = longEnough && firstStock !== null && !soldFirst && Boolean(state.holdings[firstStock]);
        c.flashPoor = !c.acted && state.contributed > 0 && state.history.kospi[state.history.kospi.length - 1] >= state.contributed;
        return fresh.concat(collect());
      },
    };
  }

  // ---------- 수집 저장 내용 ----------

  function empty() { return { trophies: {}, medals: {}, finishes: 0 }; }

  function addTrophies(store, ids) {
    for (const id of ids) store.trophies[id] = (store.trophies[id] || 0) + 1;
    return ids;
  }

  // 처음 받은 메달만 돌려준다.
  function addMedals(store, ids, date) {
    const fresh = ids.filter((id) => !store.medals[id]);
    for (const id of fresh) store.medals[id] = date;
    return fresh;
  }

  function counts(store) {
    const trophies = Object.keys(store.trophies).filter((id) => store.trophies[id] > 0).length;
    const medals = Object.keys(store.medals).length;
    return {
      trophies, trophyTotal: TROPHIES.length, medals, medalTotal: MEDALS.length,
      collected: trophies + medals, total: TROPHIES.length + MEDALS.length,
    };
  }

  const Achievements = {
    TROPHIES, MEDALS, TIER_ICON, isTrophyGame, trophiesFor, newTracker, empty, addTrophies, addMedals, counts,
  };
  globalThis.Achievements = Achievements;
  if (typeof module !== 'undefined') module.exports = Achievements;
})();
