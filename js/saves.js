// 세이브 파일 형식과 입출력. serialize/parse/summary는 순수 함수다.
(function () {
  const APP = 'stock-game';
  const SAVE_VERSION = 1;
  const OLD_FIRST_DATE = '2016-11-01'; // firstDate를 적지 않던 때의 달력 첫날
  const Engine = globalThis.Engine || (typeof require !== 'undefined' ? require('./engine.js') : null);
  const I18N = globalThis.I18N || (typeof require !== 'undefined' ? require('./i18n.js') : null);
  const T = (key, params) => I18N.t(key, params);

  function serialize(data, state, meta = {}) {
    return JSON.stringify({
      app: APP, saveVersion: SAVE_VERSION, dataVersion: data.version, firstDate: data.dates[0],
      savedAt: new Date().toISOString(), ...meta, state,
    });
  }

  function isNumber(v) { return typeof v === 'number' && Number.isFinite(v); }

  function checkState(state, data) {
    if (!state || typeof state !== 'object') return T('save.noState');
    const days = data.dates.length;
    if (!Number.isInteger(state.dayIdx) || state.dayIdx < 0 || state.dayIdx >= days) return T('save.badDay');
    if (!Number.isInteger(state.startIdx) || state.startIdx < 0 || state.startIdx > state.dayIdx) return T('save.badStart');
    if (!isNumber(state.krw) || !isNumber(state.usd) || !isNumber(state.contributed)) return T('save.badBalance');
    if (!state.settings || typeof state.settings !== 'object') return T('save.noSettings');
    for (const key of ['krw0', 'usd0', 'monthlyKrw', 'fxFeePct', 'tradeFeePct', 'sellTaxPct']) {
      if (!isNumber(state.settings[key])) return T('save.badSettings');
    }
    if (!Number.isInteger(state.nextId)) return T('save.badState');
    if (!state.bench || !isNumber(state.bench.kospiUnits) || !isNumber(state.bench.spUnits)) return T('save.badBench');
    for (const key of ['bonds', 'fxOrders', 'autoRules', 'events']) {
      if (!Array.isArray(state[key])) return T('save.badList', { key });
    }
    if (!state.history || !['pnl', 'kospi', 'sp'].every((k) => Array.isArray(state.history[k]))) return T('save.badHistory');
    if (!state.holdings || typeof state.holdings !== 'object') return T('save.badHoldings');
    for (const [key, h] of Object.entries(state.holdings)) {
      if (!data.stocks[Number(key)]) return T('save.unknownStock');
      if (!h || !isNumber(h.qty) || !isNumber(h.avgCost)) return T('save.badQty');
    }
    if (state.autoRules.some((r) => !r || !data.stocks[r.stockIdx])) return T('save.badAuto');
    if (state.sellRules !== undefined && (!Array.isArray(state.sellRules) || state.sellRules.some((r) => !r || !data.stocks[r.stockIdx]))) {
      return T('save.badSellRules');
    }
    for (const e of state.events) {
      if (!e || typeof e.type !== 'string' || !Number.isInteger(e.d) || e.d < 0 || e.d >= days) return T('save.badEvents');
      if (e.stockIdx !== undefined && !data.stocks[e.stockIdx]) return T('save.badEventStock');
    }
    return null;
  }

  // 세이브는 날짜를 달력 칸 번호로 기억한다. 달력 앞쪽이 늘어나면 같은 날짜를 가리키도록 번호를 민다.
  function shiftDays(state, offset) {
    if (!offset || !state || typeof state !== 'object') return;
    if (Number.isInteger(state.dayIdx)) state.dayIdx += offset;
    if (Number.isInteger(state.startIdx)) state.startIdx += offset;
    for (const e of Array.isArray(state.events) ? state.events : []) {
      if (e && Number.isInteger(e.d)) e.d += offset;
    }
    for (const rules of [state.autoRules, state.sellRules]) {
      for (const r of Array.isArray(rules) ? rules : []) {
        if (r && Number.isInteger(r.fromIdx)) r.fromIdx += offset;
      }
    }
  }

  function parse(text, data) {
    let file;
    try {
      file = JSON.parse(text);
    } catch {
      return { ok: false, reason: T('save.unreadable') };
    }
    if (!file || typeof file !== 'object' || file.app !== APP) return { ok: false, reason: T('save.notOurs') };
    if (file.saveVersion !== SAVE_VERSION) return { ok: false, reason: T('save.badVersion') };
    shiftDays(file.state, Math.max(data.dates.indexOf(file.firstDate || OLD_FIRST_DATE), 0));
    const problem = checkState(file.state, data);
    if (problem) return { ok: false, reason: problem };
    const result = { ok: true, state: file.state, savedAt: file.savedAt };
    if (file.dataVersion !== data.version) {
      result.warn = T('save.dataVersion', { saved: file.dataVersion, current: data.version });
    }
    return result;
  }

  function summary(data, state) {
    const v = Engine.valuation(data, state);
    return { gameDate: data.dates[state.dayIdx], total: v.total, pnlPct: v.pnlPct };
  }

  // ---------- 브라우저 파일 입출력 ----------

  const picker = () => ({ types: [{ description: T('save.fileType'), accept: { 'application/json': ['.json'] } }] });

  function isCancel(err) { return err && err.name === 'AbortError'; }

  // PC는 파일 창으로 저장한다. 핸드폰은 기종마다 파일 기능이 달라 브라우저 안에 저장한다.
  function canPickFiles() {
    if (typeof globalThis.showSaveFilePicker !== 'function') return false;
    return !(globalThis.matchMedia && globalThis.matchMedia('(pointer: coarse)').matches);
  }

  // 백업용 내려받기.
  function downloadFile(text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock-game-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // 저장한 파일 핸들. 선택 창을 취소하면 null을 돌려준다.
  async function saveToFile(text, handle) {
    try {
      let target = handle;
      if (target && target.requestPermission
        && (await target.requestPermission({ mode: 'readwrite' })) !== 'granted') target = null;
      if (!target) target = await globalThis.showSaveFilePicker({ ...picker(), startIn: 'documents', suggestedName: 'stock-game-save.json' });
      const out = await target.createWritable();
      await out.write(text);
      await out.close();
      return target;
    } catch (err) {
      if (isCancel(err)) return null;
      throw err;
    }
  }

  // 고른 파일의 내용. 취소하면 null.
  async function openFile() {
    if (typeof globalThis.showOpenFilePicker === 'function') {
      try {
        const [handle] = await globalThis.showOpenFilePicker({ ...picker(), startIn: 'documents' });
        return { text: await (await handle.getFile()).text(), handle };
      } catch (err) {
        if (isCancel(err)) return null;
        throw err;
      }
    }
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file'; // 핸드폰에서 파일이 흐리게 막히지 않도록 형식을 제한하지 않는다. 내용은 parse가 검사한다.
      input.onchange = async () => {
        const f = input.files[0];
        resolve(f ? { text: await f.text(), handle: null } : null);
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
  }

  const DB = 'stock-game';
  const STORE = 'recent';
  const RECORDS = 'records';
  const COLLECTION = 'collection';
  const KEEP = 8;

  function db() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 3);
      req.onupgradeneeded = () => {
        const names = req.result.objectStoreNames;
        if (!names.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'name' });
        if (!names.contains(RECORDS)) req.result.createObjectStore(RECORDS, { keyPath: 'id' });
        if (!names.contains(COLLECTION)) req.result.createObjectStore(COLLECTION, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function tx(conn, mode, work, store = STORE) {
    return new Promise((resolve, reject) => {
      const t = conn.transaction(store, mode);
      const out = work(t.objectStore(store));
      t.oncomplete = () => resolve(out.result);
      t.onerror = () => reject(t.error);
    });
  }

  // 최근 저장 목록. 브라우저 저장소를 못 쓰는 환경에서는 빈 목록이다.
  async function recent() {
    try {
      const conn = await db();
      const rows = await tx(conn, 'readonly', (s) => s.getAll());
      conn.close();
      rows.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
      const files = rows.filter((r) => !r.inBrowser).slice(0, KEEP);
      return rows.filter((r) => r.inBrowser || files.includes(r));
    } catch {
      return [];
    }
  }

  async function remember(handle, info) {
    if (!handle || !handle.name) return;
    try {
      const conn = await db();
      await tx(conn, 'readwrite', (s) => s.put({ name: handle.name, handle, savedAt: new Date().toISOString(), ...info }));
      conn.close();
    } catch {
      // 목록은 편의 기능이다. 저장 파일 자체는 이미 쓰였다.
    }
  }

  // 브라우저 안에 저장한다. 게임마다 칸이 하나이고 칸 이름을 돌려준다.
  async function saveToBrowser(text, info, slot) {
    const name = slot || `save-${Date.now()}`;
    const conn = await db();
    await tx(conn, 'readwrite', (s) => s.put({ name, inBrowser: true, text, savedAt: new Date().toISOString(), ...info }));
    conn.close();
    if (globalThis.navigator && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    return name;
  }

  // ---------- 트로피와 메달 ----------

  async function loadAchievements() {
    const conn = await db();
    const row = await tx(conn, 'readonly', (s) => s.get('me'), COLLECTION);
    conn.close();
    return row ? row.value : null;
  }

  async function saveAchievements(value) {
    const conn = await db();
    await tx(conn, 'readwrite', (s) => s.put({ id: 'me', value }), COLLECTION);
    conn.close();
  }

  // ---------- 투자 보고서 기록 ----------

  async function listRecords() {
    const conn = await db();
    const rows = await tx(conn, 'readonly', (s) => s.getAll(), RECORDS);
    conn.close();
    return rows.sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
  }

  async function putRecord(record) {
    const conn = await db();
    await tx(conn, 'readwrite', (s) => s.put(record), RECORDS);
    conn.close();
  }

  async function deleteRecord(id) {
    const conn = await db();
    await tx(conn, 'readwrite', (s) => s.delete(id), RECORDS);
    conn.close();
  }

  async function deleteRecent(name) {
    const conn = await db();
    await tx(conn, 'readwrite', (s) => s.delete(name));
    conn.close();
  }

  async function readRecent(row) {
    if (row.inBrowser) return { text: row.text, handle: null, slot: row.name };
    const { handle } = row;
    if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return null;
    return { text: await (await handle.getFile()).text(), handle };
  }

  const Saves = {
    serialize, parse, summary, canPickFiles, downloadFile, saveToFile, saveToBrowser, deleteRecent, loadAchievements, saveAchievements, listRecords, putRecord, deleteRecord, openFile, recent, remember, readRecent,
  };
  globalThis.Saves = Saves;
  if (typeof module !== 'undefined') module.exports = Saves;
})();
