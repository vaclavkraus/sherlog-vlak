/* SHERLOG RMJ – PWA pro Web Bluetooth (Chrome / Android)
 * Specifikace: "Přehled parametrů Bluetooth LE pro SHERLOG VLAK, 15.03.2026"
 */
'use strict';
const APP_VERSION = '0.1.2';

/* ====================== Nastavení ====================== */
const DEFAULTS = { endian: 'le', mode: 'notify', poll: 1000, slow: 5, prefix: 'D3R', red: 60, yellow: 180, sound: '1', theme: 'light' };
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
};
const S = Object.assign({}, DEFAULTS, LS.get('sv.settings', {}));
const input = Object.assign({ kontakt: '', telefon: '', vlak: '' }, LS.get('sv.input', {}));

/* ====================== UUID ====================== */
const SVC_LOCAL = 0x5400;
const SVC_REMOTE = [0x5401, 0x5402, 0x5403, 0x5404, 0x5405, 0x5406, 0x5407, 0x5408];
const SVC_ALL = [SVC_LOCAL, ...SVC_REMOTE];
const uuid16 = (n) => '0000' + n.toString(16).padStart(4, '0') + '-0000-1000-8000-00805f9b34fb';
const short16 = (u) => parseInt(u.slice(4, 8), 16);
const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');

/* ====================== Dekodéry ====================== */
function uintBytes(b) { // b: Uint8Array
  let v = 0; const n = b.length;
  for (let i = 0; i < n; i++) { const byte = S.endian === 'le' ? b[i] : b[n - 1 - i]; v += byte * 2 ** (8 * i); }
  return v;
}
function uintToBytes(v, n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const byte = Math.floor(v / 2 ** (8 * i)) & 0xff; out[S.endian === 'le' ? i : n - 1 - i] = byte; }
  return out;
}
const int32 = (b) => { let v = uintBytes(b); if (v >= 2 ** 31) v -= 2 ** 32; return v; };
const ascii = (b) => { if (b.every((x) => x === 0)) return null; return String.fromCharCode(...b).replace(/\0/g, '').trim() || null; };
const bcdDigits = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const bit = (v, i) => Math.floor(v / 2 ** i) % 2 === 1;
const bits = (v, from, len) => Math.floor(v / 2 ** from) % 2 ** len;

/** Nelineární čas (NOMOVE/NOPOS/NOSEEN), U1. Vrací sekundy, null = neznámé. */
function nonlinTime(b) {
  if (b === 0) return null;
  if (b === 0xff) return { s: 82 * 3600, atLeast: true };
  const E = b >> 6, M = b & 63;
  const off = [0, 60, 4500, 64800][E], res = [1, 60, 900, 3600][E];
  return { s: off + M * res, atLeast: false };
}
function fmtDur(s, atLeast) {
  if (s == null) return '—';
  let t;
  if (s < 60) t = s + ' s';
  else if (s < 3600) { const m = Math.floor(s / 60), r = Math.round(s % 60); t = m + ' min' + (r ? ' ' + r + ' s' : ''); }
  else { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); t = h + ' h' + (m ? ' ' + m + ' min' : ''); }
  return (atLeast ? '≥ ' : '') + t;
}
const fmtDist = (m) => (m == null ? '—' : m >= 10000 ? (m / 1000).toFixed(1) + ' km' : m >= 1000 ? (m / 1000).toFixed(2) + ' km' : m + ' m');
const fmtPhone = (d) => { if (!d) return '—'; return d.startsWith('420') && d.length === 12 ? '+420 ' + d.slice(3, 6) + ' ' + d.slice(6, 9) + ' ' + d.slice(9) : '+' + d; };
const angleUnc = (u) => (u === 0 ? '< 3°' : u >= 120 ? '360°' : '±' + u * 3 + '°');

const FLAG_NAMES = {
  0: ['GRD', 'Uživatel přihlášen'], 1: ['CIP', 'Jízda bez čipu'], 2: ['CHY', 'Chyba'], 3: ['BNP', 'Byl výpadek napájení'],
  4: ['NAP', 'Ztráta hlavního napájení'], 5: ['NEH', 'Náraz / nehoda'], 6: ['KLD', 'Stav klidu'], 7: ['LGS', 'Kniha v GSM'],
  8: ['PVZ', 'Poplach vzdálená jednotka'], 11: ['LGR', 'Kniha na GPRS'], 12: ['SOS', 'SOS'], 13: ['RUS', 'Rušení rádia'],
  18: ['GPR', 'Rušení GPS'], 28: ['MDE', 'Master deaktivace'], 29: ['OTR', 'Na trati'], 30: ['PBJ', 'Poplach blízká jednotka'], 31: ['STA', 'Zóna stanice'],
};
const RED_FLAGS = new Set([5, 12, 30]), YELLOW_FLAGS = new Set([1, 2, 4, 8, 13, 18]);
function decodeFlags(v) {
  const set = [];
  for (const k of Object.keys(FLAG_NAMES)) if (bit(v, +k)) set.push(+k);
  const ak = bits(v, 9, 2); // AK0=bit9, AK1=bit10
  const mv = bits(v, 14, 2);
  const al = bits(v, 16, 2);
  const gs = bits(v, 19, 2);
  const ed = bits(v, 21, 3);
  const spr = bits(v, 24, 4);
  return {
    set,
    ak: ['Akumulátor OK', 'Nízké napětí aku', 'Dobíjení aku', 'Vadný akumulátor'][ak], akCode: ak,
    mv: ['Bez pohybu', 'Pohyb (úr. 1)', 'Pohyb (úr. 2)', 'Pohyb (úr. 3)'][mv], mvCode: mv,
    al: ['Poplach', 'Informační vysílání', 'Standardní režim', 'Odpověď na TEST'][al], alCode: al,
    gs: ['Poloha neplatná', 'Poloha z externí jednotky', 'Nízká přesnost polohy', 'Poloha OK (3D)'][gs], gsCode: gs,
    ed: ed === 0 ? 'směr nelze určit' : 'nejistota směru ' + +(360 / 2 ** ed).toFixed(4) + '°', edCode: ed,
    spr,
  };
}
const STATUS_BITS = { 0: 'Na trati', 1: 'Semafor ZELENÁ', 2: 'Není kalibrace', 3: 'Kalibrace OK', 4: 'Semafor ČERVENÁ', 5: 'Semafor ŽLUTÁ', 7: 'Zóna stanice' };

/* Definice charakteristik: id → {n: název, l: popisek, len, dec(bytes) → {v, t}, pr: 'fast'|'slow'|'id'} */
const D = {};
function def(id, n, l, pr, dec) { D[id] = { id, n, l, pr, dec }; }
def(0x0001, 'TIMESTAMP', 'Časová značka', 'ts', (b) => { const v = uintBytes(b); return { v, t: String(v) + (v > 1e9 ? ' (≈ ' + gpsToDate(v) + ')' : '') }; });
def(0x0002, 'RADKOD', 'Rádiový kód', 'id', (b) => { const v = ascii(b); return { v, t: v || '—' }; });
def(0x0003, 'VLAKCISLO', 'Číslo vlaku', 'id', (b) => { const v = uintBytes(b); return { v: v || null, t: v ? String(v) : '—' }; });
def(0x0004, 'TELEFON', 'Telefon strojvůdce', 'id', (b) => { const d = bcdDigits(b); const v = /^0+$/.test(d) ? null : d.replace(/^0+/, ''); return { v, t: fmtPhone(v) }; });
def(0x0005, 'TU', 'Traťový úsek', 'slow', (b) => { const v = ascii(b); return { v, t: v || '—' }; });
def(0x0006, 'RX_RSSI', 'RSSI zprávy', 'slow', (b) => { const s = b[0] > 127 ? b[0] - 256 : b[0]; const v = s === -128 ? null : s - 32; return { v, t: v == null ? '—' : v + ' dBm' }; });
def(0x0007, 'RX_QVAL', 'Kvalita zprávy', 'slow', (b) => { const v = uintBytes(b); const ok = bit(v, 15); return { v, ok, t: (ok ? 'OK' : 'CHYBNÁ') + ` LQI ${bits(v, 8, 6)} PQT ${bits(v, 4, 4)} SYNC ${bits(v, 0, 4)}` }; });
def(0x0008, 'RX_FLAGS', 'Příznaky', 'fast', (b) => { const v = uintBytes(b); const f = decodeFlags(v); return { v, f, t: '0x' + v.toString(16).toUpperCase().padStart(8, '0') + ' ' + f.set.map((i) => FLAG_NAMES[i][0]).join(' ') }; });
def(0x0009, 'RX_PWR_MAIN', 'Hlavní napájení', 'slow', (b) => { const v = b[0] ? +(b[0] * 0.15).toFixed(2) : null; return { v, t: v == null ? 'neměří se' : v.toFixed(2) + ' V' }; });
def(0x000a, 'RX_PWR_AKU', 'Akumulátor', 'slow', (b) => { const v = b[0] ? +(b[0] * 0.075).toFixed(3) : null; return { v, t: v == null ? 'neměří se' : v.toFixed(2) + ' V' }; });
def(0x000b, 'RX_LAT', 'Zem. šířka', 'slow', (b) => latlon(b, 90));
def(0x000c, 'RX_LON', 'Zem. délka', 'slow', (b) => latlon(b, 180));
def(0x000d, 'RX_ALT', 'Výška', 'slow', (b) => { const v = uintBytes(b) / 10; return { v, t: v.toFixed(1) + ' m' }; });
def(0x000e, 'RX_DIRUNC', 'Směr pohybu', 'slow', (b) => dirUnc(b));
def(0x000f, 'RX_VELUNC', 'Rychlost', 'fast', (b) => velUnc(b));
def(0x0010, 'RX_NOMOVE', 'Bez pohybu', 'slow', (b) => timeVal(b));
def(0x0011, 'RX_NOPOS', 'Bez polohy', 'slow', (b) => timeVal(b));
def(0x0012, 'RX_NOSEEN', 'Od posl. příjmu', 'fast', (b) => timeVal(b));
def(0x0013, 'RX_AZIM', 'Azimut', 'fast', (b) => dirUnc(b));
def(0x0014, 'RX_DIST2D', 'Vzdálenost vzdušná', 'fast', (b) => { const v = uintBytes(b) || null; return { v, t: fmtDist(v) }; });
def(0x0015, 'RX_DIST1D', 'Vzdálenost po koleji', 'fast', (b) => { const v = uintBytes(b) || null; return { v, t: fmtDist(v) }; });
def(0x0016, 'RX_CRASHTIME', 'Čas do střetu', 'fast', (b) => { const v = uintBytes(b); return { v: v === 0 ? null : v, away: v === 65535, t: v === 0 ? '—' : v === 65535 ? 'vzdalují se' : fmtDur(v) }; });
def(0x0026, 'ZAM_RSSI_BGR', 'Šum pozadí VHF', 'slow', (b) => { const s = b[0] > 127 ? b[0] - 256 : b[0]; const v = s === -128 ? null : s - 32; return { v, t: v == null ? '—' : v + ' dBm' }; });
def(0x0027, 'ZAM_STATUS', 'Stav jednotky', 'fast', (b) => { const v = b[0]; const on = Object.keys(STATUS_BITS).filter((k) => bit(v, +k)).map((k) => STATUS_BITS[k]); return { v, t: '0x' + v.toString(16).toUpperCase().padStart(2, '0') + ' ' + on.join(', ') }; });
def(0x0028, 'ZAM_FIXDOP', 'GNSS fix / DOP', 'slow', (b) => { const v = b[0]; const fix = v & 3, fl = (v >> 2) & 3, dop = v >> 4; return { v, fix, fl, dop, t: `${['žádný fix', 'jen čas', '2D', '3D'][fix]}, ${['chybná', 'platná', 'korekce', 'platná+korekce'][fl]}, DOP ${dop}` }; });
def(0x0029, 'ZAM_SAT', 'Satelity', 'slow', (b) => ({ v: b[0], t: String(b[0]) }));
def(0x002a, 'ZAM_JAMM', 'Rušení GNSS', 'slow', (b) => { const v = uintBytes(b); return { v, t: '0x' + v.toString(16).toUpperCase().padStart(4, '0') }; });
def(0x002b, 'ZAM_LAT', 'Zem. šířka', 'slow', (b) => latlon(b, 90));
def(0x002c, 'ZAM_LON', 'Zem. délka', 'slow', (b) => latlon(b, 180));
def(0x002d, 'ZAM_ALT', 'Výška', 'slow', (b) => { const v = uintBytes(b) / 10; return { v, t: v.toFixed(1) + ' m' }; });
def(0x002e, 'ZAM_POSUNC', 'Nejistota polohy', 'slow', (b) => ({ v: b[0], t: b[0] === 255 ? '> 255 m' : b[0] + ' m' }));
def(0x002f, 'ZAM_VELUNC', 'Rychlost', 'fast', (b) => velUnc(b));
def(0x0030, 'ZAM_HEADING', 'Směr pohybu', 'slow', (b) => dirUnc(b));
def(0x0031, 'ZAM_FLAGS', 'Příznaky z aplikace', 'fast', (b) => { const v = uintBytes(b); const f = decodeFlags(v); return { v, f, t: '0x' + v.toString(16).toUpperCase().padStart(8, '0') + ' ' + f.set.map((i) => FLAG_NAMES[i][0]).join(' ') }; });

function latlon(b, lim) { const r = int32(b) * 1e-7; const v = Math.abs(r) <= lim && r !== 0 ? r : null; return { v, t: v == null ? 'neplatná' : v.toFixed(7) + '°' }; }
function dirUnc(b) { const r = uintBytes(b); const deg = r & 0x1ff, u = (r >> 9) & 0x7f; return { v: deg, unc: u, t: `${deg}° (${angleUnc(u)})` }; }
function velUnc(b) { const r = uintBytes(b); const v = r & 0x1ff, u = ((r >> 9) & 0x7f) * 2; return { v, unc: u, t: `${v === 511 ? '≥ 511' : v} km/h (±${u})` }; }
function timeVal(b) { if (b.length >= 2) { const v = uintBytes(b.slice(0, 2)); return { v: v || null, t: v ? fmtDur(v) : '—' }; } const n = nonlinTime(b[0]); return { v: n ? n.s : null, t: n ? fmtDur(n.s, n.atLeast) : '—' }; }
function gpsToDate(sec) { const d = new Date(Date.UTC(1980, 0, 6) + (sec - 18) * 1000); return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'; }

const LOCAL_CHARS = [0x0001, 0x0002, 0x0003, 0x0004, 0x0005, 0x0026, 0x0027, 0x0028, 0x0029, 0x002a, 0x002b, 0x002c, 0x002d, 0x002e, 0x002f, 0x0030, 0x0031];
const REMOTE_CHARS = [0x0001, 0x0002, 0x0003, 0x0004, 0x0005, 0x0006, 0x0007, 0x0008, 0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x000e, 0x000f, 0x0010, 0x0011, 0x0012, 0x0013, 0x0014, 0x0015, 0x0016];

/* ====================== Stav jednotek ====================== */
function newUnit(svc) { return { svc, present: false, chars: new Map(), raw: {}, val: {}, readAt: {}, lastNotify: 0, lastCycle: 0, dirty: false, active: svc === SVC_LOCAL }; }
let units = SVC_ALL.map(newUnit);
const unitBy = (svc) => units.find((u) => u.svc === svc);

function store(u, id, bytes, source) {
  const d = D[id]; if (!d) return;
  u.raw[id] = bytes; u.readAt[id] = Date.now();
  try { u.val[id] = d.dec(bytes); } catch (e) { u.val[id] = { v: null, t: 'chyba dekódování' }; }
  if (u.svc !== SVC_LOCAL && (id === 0x0002 || id === 0x0001)) {
    const ts = u.val[0x0001] && u.val[0x0001].v, rk = u.val[0x0002] && u.val[0x0002].v;
    const was = u.active; u.active = !!(ts && rk);
    if (was !== u.active) log(`Slot ${hex4(u.svc)}: ${u.active ? 'aktivní ' + (rk || '') : 'prázdný'}`);
  }
  if (source === 'notify') log(`Notify ${hex4(u.svc)}/${hex4(id)} ${d.n} = ${u.val[id].t}`, true);
}

/* ====================== Log ====================== */
let logLines = LS.get('sv.log', []);
let csvRows = [];
const pad = (n, l = 2) => String(n).padStart(l, '0');
function nowStr(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`; }
let verbose = false;
function log(msg, isVerbose) {
  if (isVerbose && !verbose) return;
  logLines.push(nowStr() + '  ' + msg);
  if (logLines.length > 20000) logLines.splice(0, logLines.length - 20000);
  scheduleLogSave();
  if (curTab === 'tabDiag') renderLogSoon();
}
let logSaveT = null;
function scheduleLogSave() { if (logSaveT) return; logSaveT = setTimeout(() => { logSaveT = null; LS.set('sv.log', logLines.slice(-3000)); }, 3000); }

/* ====================== GATT fronta ====================== */
let device = null, server = null, connected = false, userDisconnect = false, simTimer = null, simulating = false;
let chain = Promise.resolve();
function gatt(fn) { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readChar(u, id) {
  const ch = u.chars.get(id); if (!ch) return;
  try {
    const dv = await gatt(() => ch.readValue());
    store(u, id, new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength).slice(), 'read');
  } catch (e) {
    log(`Chyba čtení ${hex4(u.svc)}/${hex4(id)}: ${e.message}`);
    if (!device || !device.gatt.connected) throw e;
  }
}
async function writeChar(u, id, bytes) {
  const ch = u.chars.get(id); if (!ch) throw new Error('Charakteristika ' + hex4(id) + ' nenalezena');
  await gatt(() => (ch.writeValueWithResponse ? ch.writeValueWithResponse(bytes) : ch.writeValue(bytes)));
  log(`Zápis ${hex4(u.svc)}/${hex4(id)} ${D[id].n} = ${Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join(' ')}`);
}

/* Plánovač čtení: po notifikaci TIMESTAMP (nebo periodicky) se načtou rychlé údaje,
   pomalé jen jednou za S.slow sekund, identifikace jednou za 10 s. Prázdné sloty jen RADKOD+TIMESTAMP. */
function cycleList(u) {
  const now = Date.now();
  const list = u.svc === SVC_LOCAL ? LOCAL_CHARS : REMOTE_CHARS;
  const due = (id, period) => !u.readAt[id] || now - u.readAt[id] >= period;
  const out = [];
  if (u.svc !== SVC_LOCAL && !u.active) {
    for (const id of [0x0001, 0x0002]) if (u.chars.has(id)) out.push(id);
    return out;
  }
  for (const id of list) {
    if (!u.chars.has(id)) continue;
    const pr = D[id].pr;
    if (pr === 'ts') { if (S.mode === 'poll' || due(id, 3000)) out.push(id); }
    else if (pr === 'fast') out.push(id);
    else if (pr === 'slow') { if (due(id, S.slow * 1000)) out.push(id); }
    else if (pr === 'id') { if (due(id, 10000)) out.push(id); }
  }
  // rychlé údaje dopředu
  const rank = { fast: 0, ts: 1, id: 2, slow: 3 };
  return out.sort((a, b) => rank[D[a].pr] - rank[D[b].pr]);
}
function dangerRank(u) { const c = u.val[0x0016]; const d = u.val[0x0015] || u.val[0x0014]; return (c && c.v) || (d && d.v) || 1e9; }

let pumpRunning = false;
async function pump() {
  if (pumpRunning) return; pumpRunning = true;
  try {
    while (connected && !simulating) {
      const now = Date.now();
      for (const u of units) {
        if (!u.present) continue;
        const period = S.mode === 'poll' ? S.poll : (u.svc === SVC_LOCAL || u.active ? 3000 : 5000);
        if (now - u.lastCycle >= period) u.dirty = true; // watchdog / periodické čtení
      }
      const todo = units.filter((u) => u.present && u.dirty).sort((a, b) => (a.svc === SVC_LOCAL ? -1 : b.svc === SVC_LOCAL ? 1 : dangerRank(a) - dangerRank(b)));
      if (!todo.length) { await sleep(40); continue; }
      for (const u of todo) {
        u.dirty = false; u.lastCycle = Date.now();
        for (const id of cycleList(u)) { if (!connected) break; await readChar(u, id); }
        render();
      }
    }
  } catch (e) { log('Plánovač čtení přerušen: ' + e.message); }
  finally { pumpRunning = false; }
}

/* ====================== Připojení ====================== */
async function scanAndConnect() {
  $('scanErr').textContent = '';
  try {
    const opts = { optionalServices: [...SVC_ALL, 0x180a, '6e400001-b5a3-f393-e0a9-e50e24dcca9e'] };
    // filtry se sčítají (OR): název D3R… NEBO zařízení vysílající službu 5400 (např. simulátor na Windows)
    if (S.prefix) opts.filters = [{ namePrefix: S.prefix }, { services: [uuid16(SVC_LOCAL)] }]; else opts.acceptAllDevices = true;
    const dev = await navigator.bluetooth.requestDevice(opts);
    await connectDevice(dev);
  } catch (e) {
    if (e.name === 'NotFoundError') $('scanErr').textContent = 'Výběr zrušen nebo nenalezeno žádné zařízení.';
    else $('scanErr').textContent = 'Chyba: ' + e.message;
    log('Vyhledání/připojení selhalo: ' + e.message);
  }
}

async function connectDevice(dev) {
  device = dev; userDisconnect = false;
  device.removeEventListener('gattserverdisconnected', onDisconnected);
  device.addEventListener('gattserverdisconnected', onDisconnected);
  setConn('wait', 'Připojuji…');
  showScreen('scrMain');
  try { await setupGatt(); }
  catch (e) {
    connected = false; userDisconnect = true;
    try { device.gatt.disconnect(); } catch (er) { /* ignore */ }
    setConn('err', 'Připojení selhalo');
    showScreen('scrScan');
    throw e;
  }
}

async function setupGatt() {
  log(`ConManager: připojuji ${device.name || '(bez názvu)'} ${device.id}`);
  server = await device.gatt.connect();
  units = SVC_ALL.map(newUnit);
  chain = Promise.resolve();
  for (const u of units) {
    try {
      const s = await server.getPrimaryService(uuid16(u.svc));
      const chs = await s.getCharacteristics();
      u.present = true;
      for (const ch of chs) u.chars.set(short16(ch.uuid), ch);
      log(`Služba ${hex4(u.svc)}: ${chs.length} charakteristik (${[...u.chars.keys()].map(hex4).join(' ')})`);
    } catch (e) { /* služba neexistuje */ }
  }
  const local = unitBy(SVC_LOCAL);
  if (!units.some((u) => u.present)) throw new Error('Zařízení nemá služby 5400–5408');
  connected = true;
  setConn('ok', 'Připojeno');
  log(`ConManager: připojeno, služby: ${units.filter((u) => u.present).map((u) => hex4(u.svc)).join(' ')}`);

  // Přihlášení: zápis čísla vlaku a telefonu (po připojení se v jednotce nulují)
  if (local.present) await writeIdentity().catch((e) => { log('Zápis identifikace selhal: ' + e.message); banner('Nepodařilo se zapsat číslo vlaku/telefon: ' + e.message, 'red'); });

  // Notifikace / indikace
  for (const u of units) {
    if (!u.present) continue;
    for (const id of u.svc === SVC_LOCAL ? [0x0001, 0x0003, 0x0004, 0x0031] : [0x0001]) {
      const ch = u.chars.get(id); if (!ch || !(ch.properties.notify || ch.properties.indicate)) continue;
      try {
        ch.addEventListener('characteristicvaluechanged', (ev) => {
          const dv = ev.target.value; store(u, id, new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength).slice(), 'notify');
          if (id === 0x0001) { u.lastNotify = Date.now(); u.dirty = true; }
        });
        await gatt(() => ch.startNotifications());
      } catch (e) { log(`Notifikace ${hex4(u.svc)}/${hex4(id)} nelze zapnout: ${e.message}`); }
    }
  }
  pump();
}

async function writeIdentity() {
  const local = unitBy(SVC_LOCAL);
  const vlak = parseInt(input.vlak, 10) || 0;
  if (local.chars.has(0x0003)) await writeChar(local, 0x0003, uintToBytes(vlak, 3));
  if (local.chars.has(0x0004)) await writeChar(local, 0x0004, phoneToBcd(input.telefon));
  log(`Přihlášení: kontakt "${input.kontakt}", vlak ${vlak}, telefon ${fmtPhone(phoneDigits(input.telefon))}`);
}
function phoneDigits(s) { let d = String(s || '').replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); if (d.length === 9) d = '420' + d; return d; }
function phoneToBcd(s) {
  const d = phoneDigits(s).padStart(12, '0').slice(-12);
  const out = new Uint8Array(6);
  for (let i = 0; i < 6; i++) out[i] = parseInt(d.substr(i * 2, 2), 16);
  return out;
}

let reconnectTry = 0;
async function onDisconnected() {
  connected = false;
  log('ConManager: odpojeno' + (userDisconnect ? ' uživatelem' : ''));
  if (userDisconnect) { setConn('', 'Odpojeno'); return; }
  setConn('err', 'Spojení ztraceno, obnovuji…');
  banner('Spojení s jednotkou ztraceno – probíhá obnova připojení', 'red');
  while (!userDisconnect && device && !device.gatt.connected) {
    const wait = Math.min(10000, 1000 * 2 ** reconnectTry++);
    await sleep(wait);
    if (userDisconnect) return;
    try { await setupGatt(); reconnectTry = 0; banner(''); log('ConManager: spojení obnoveno'); return; }
    catch (e) { log('Obnova připojení selhala: ' + e.message); }
  }
}

async function disconnect() {
  userDisconnect = true; connected = false;
  if (simulating) stopSim();
  try { if (device && device.gatt.connected) device.gatt.disconnect(); } catch (e) { /* ignore */ }
  setConn('', 'Odpojeno');
  banner('');
  stopAlarm();
  showScreen('scrInput');
}

/* ====================== SOS ====================== */
async function toggleSos() {
  const local = unitBy(SVC_LOCAL);
  const cur = (local.val[0x0031] && local.val[0x0031].v) || 0;
  const on = bit(cur, 12);
  const next = on ? cur - 2 ** 12 : cur + 2 ** 12;
  if (simulating) { store(local, 0x0031, uintToBytes(next, 4)); log(`SOS ${on ? 'deaktivováno' : 'AKTIVOVÁNO'} (simulace)`); render(); return; }
  if (!local.chars.has(0x0031)) { banner('Jednotka nemá charakteristiku 0031 (ZAM_FLAGS)', 'red'); return; }
  try {
    await writeChar(local, 0x0031, uintToBytes(next, 4));
    store(local, 0x0031, uintToBytes(next, 4));
    log(`SOS ${on ? 'deaktivováno' : 'AKTIVOVÁNO'}`);
    await readChar(local, 0x0031);
  } catch (e) { banner('Zápis SOS selhal: ' + e.message, 'red'); log('Zápis SOS selhal: ' + e.message); }
  render();
}

/* ====================== Alarm (zvuk + vibrace) ====================== */
let audioCtx = null, alarmTimer = null, alarmLevel = 0, muteUntil = 0;
function ensureAudio() { try { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) { /* ignore */ } }
function beep(freq, ms) {
  if (!audioCtx) return;
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = 'square'; o.frequency.value = freq; g.gain.value = 0.15;
  o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + ms / 1000);
}
function setAlarm(level) { // 0 nic, 1 žlutá, 2 červená/SOS
  if (level === alarmLevel) return;
  alarmLevel = level; clearInterval(alarmTimer); alarmTimer = null;
  if (!level) return;
  const tick = () => {
    if (Date.now() < muteUntil || S.sound !== '1') return;
    if (alarmLevel === 2) { beep(1400, 150); setTimeout(() => beep(1400, 150), 250); try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) { /* ignore */ } }
    else { beep(900, 200); try { navigator.vibrate && navigator.vibrate(150); } catch (e) { /* ignore */ } }
  };
  tick(); alarmTimer = setInterval(tick, level === 2 ? 1000 : 2500);
}
function stopAlarm() { setAlarm(0); }

/* ====================== Wake lock ====================== */
let wakeLock = null;
async function keepAwake() { try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) { /* ignore */ } }

/* ====================== UI ====================== */
const $ = (id) => document.getElementById(id);
let curScreen = 'scrInput', prevScreen = 'scrInput', curTab = 'tabPrehled';
const TITLES = { scrInput: 'Zadání vstupních dat', scrScan: 'Vyhledání zařízení', scrMain: 'Hlavní panel', scrSettings: 'Nastavení' };
function showScreen(id) {
  if (id !== 'scrSettings') prevScreen = id;
  curScreen = id;
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  $('title').textContent = TITLES[id];
  const inMain = id === 'scrMain';
  $('bottombar').classList.toggle('active', inMain);
  $('btnDisconnect').hidden = !inMain;
  $('btnMute').hidden = !inMain;
  if (inMain) { keepAwake(); render(); }
  renderSummaries();
}
function banner(text, kind) { const b = $('banner'); b.textContent = text; b.className = 'banner' + (text ? ' show' : '') + (kind === 'red' ? ' red' : ''); }
function setConn(cls, text) { $('connDot').className = 'conn-dot ' + cls; $('connDot').title = text; $('bbStatus').textContent = text; renderSummaries(); }
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderSummaries() {
  const vlak = input.vlak || '—';
  const html = `<div><b>${esc(input.kontakt || '—')}</b></div><div>Tel.: ${esc(fmtPhone(phoneDigits(input.telefon)))}</div><div>Vlak: ${esc(vlak)}</div>`;
  $('sumScan').innerHTML = html; $('sumMain').innerHTML = html;
  const name = simulating ? 'SIMULACE' : device ? device.name || '(bez názvu)' : '—';
  const st = $('connDot').title || '—';
  $('sumDev').innerHTML = `<div><b>${esc(name)}</b></div><div class="hint">${esc(device && !simulating ? device.id : '')}</div><div>${esc(st)}</div>`;
}

function trainColor(u) {
  const c = u.val[0x0016];
  const f = u.val[0x0008] && u.val[0x0008].f;
  if (f && (bit(u.val[0x0008].v, 12) || bit(u.val[0x0008].v, 5))) return 'red';
  if (c && c.v && !c.away) { if (c.v <= S.red) return 'red'; if (c.v <= S.yellow) return 'yellow'; }
  return '';
}

let renderQueued = false;
function render() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; doRender(); }); }
function doRender() {
  if (curScreen !== 'scrMain') return;
  const local = unitBy(SVC_LOCAL);
  const V = (u, id) => u.val[id] || {};
  const T = (u, id) => (u.val[id] ? u.val[id].t : '—');

  // semafor podle ZAM_STATUS
  const st = V(local, 0x0027).v;
  const lamp = $('lamp');
  let lampCls = '', lampTxt = '—', level = 0;
  if (st != null) {
    if (bit(st, 4)) { lampCls = 'red'; lampTxt = 'STOP'; level = 2; }
    else if (bit(st, 5)) { lampCls = 'yellow'; lampTxt = 'POZOR'; level = 1; }
    else if (bit(st, 1)) { lampCls = 'green'; lampTxt = 'OK'; }
  }
  lamp.className = 'lamp ' + lampCls; lamp.textContent = lampTxt;

  const remotes = units.filter((u) => u.svc !== SVC_LOCAL && u.present && u.active);
  const sosRemote = remotes.filter((u) => V(u, 0x0008).v != null && bit(V(u, 0x0008).v, 12));
  const localFlags = V(local, 0x0031).v || 0;
  const sosLocal = bit(localFlags, 12);
  if (sosRemote.length) level = 2;
  setAlarm(level);

  // nejbližší
  let best = null;
  for (const u of remotes) { const d = V(u, 0x0015).v || V(u, 0x0014).v; if (d && (!best || d < best.d)) best = { u, d, one: !!V(u, 0x0015).v }; }
  $('kNearest').innerHTML = best ? esc(fmtDist(best.d)) + (best.one ? '' : ' <small>vzduš.</small>') : '—';
  let minC = null; for (const u of remotes) { const c = V(u, 0x0016); if (c.v && !c.away && (minC == null || c.v < minC)) minC = c.v; }
  $('kCrash').textContent = minC == null ? '—' : fmtDur(minC);
  $('kSos').innerHTML = sosLocal ? '<span class="chip red">VLASTNÍ SOS</span>' : sosRemote.length ? '<span class="chip red">SOS: ' + sosRemote.map((u) => esc(trainName(u))).join(', ') + '</span>' : '✕';
  $('kAlert').innerHTML = level === 2 ? '<span class="chip red">ČERVENÁ</span>' : level === 1 ? '<span class="chip yellow">ŽLUTÁ</span>' : '✕';
  $('btnSos').classList.toggle('on', sosLocal);

  // vlastní příznaky
  const chips = [];
  if (st != null) { if (bit(st, 0)) chips.push(['Na trati', 'blue']); if (bit(st, 7)) chips.push(['Stanice', 'blue']); if (bit(st, 2)) chips.push(['Není kalibrace', 'yellow']); if (bit(st, 3)) chips.push(['Kalibrace OK', '']); }
  const fd = V(local, 0x0028); if (fd.v != null) chips.push(['GNSS ' + ['bez fixu', 'čas', '2D', '3D'][fd.fix] + ' · ' + (V(local, 0x0029).v ?? '?') + ' sat', fd.fix === 3 ? 'green' : 'yellow']);
  const sp = V(local, 0x002f); if (sp.v != null) chips.push([sp.v + ' km/h', '']);
  const tu = V(local, 0x0005); if (tu.v) chips.push(['TÚ ' + tu.v, '']);
  if (!connected && !simulating) chips.push(['Nepřipojeno', 'red']);
  $('localChips').innerHTML = chips.map(([t, c]) => `<span class="chip ${c}">${esc(t)}</span>`).join('');

  // seznam vlaků
  const sorted = remotes.slice().sort((a, b) => (V(a, 0x0015).v || V(a, 0x0014).v || 1e9) - (V(b, 0x0015).v || V(b, 0x0014).v || 1e9));
  $('trainCount').textContent = remotes.length ? `(${remotes.length})` : '';
  $('trains').innerHTML = sorted.length ? sorted.map((u) => trainCard(u)).join('') : '<p class="hint">Zatím žádná přijatá jednotka.</p>';

  // jednotka
  const rows = [
    ['Rádiový kód', T(local, 0x0002)], ['Číslo vlaku (v jednotce)', T(local, 0x0003)], ['Telefon (v jednotce)', T(local, 0x0004)], ['Traťový úsek', T(local, 0x0005)],
    ['Stav', T(local, 0x0027)], ['GNSS', T(local, 0x0028)], ['Satelity', T(local, 0x0029)], ['Rušení GNSS', T(local, 0x002a)],
    ['Zem. šířka', T(local, 0x002b)], ['Zem. délka', T(local, 0x002c)], ['Výška', T(local, 0x002d)], ['Nejistota polohy', T(local, 0x002e)],
    ['Rychlost', T(local, 0x002f)], ['Směr', T(local, 0x0030)], ['Šum pozadí VHF', T(local, 0x0026)], ['Příznaky (0031)', T(local, 0x0031)], ['Časová značka', T(local, 0x0001)],
  ];
  $('localDl').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  const la = V(local, 0x002b).v, lo = V(local, 0x002c).v;
  if (la != null && lo != null) $('localDl').innerHTML += `<dt>Mapa</dt><dd><a href="https://mapy.cz/zakladni?x=${lo}&y=${la}&z=16&source=coor&id=${lo}%2C${la}" target="_blank" rel="noopener">otevřít v Mapy.cz</a></dd>`;

  if (curTab === 'tabRadar') drawRadar(remotes);
  if (curTab === 'tabDiag') renderDiag();
}
function trainName(u) { const v = u.val; return (v[0x0003] && v[0x0003].v) ? 'Vlak ' + v[0x0003].v : (v[0x0002] && v[0x0002].v) || 'Slot ' + hex4(u.svc); }
function trainCard(u) {
  const V = (id) => u.val[id] || {};
  const col = trainColor(u);
  const seen = V(0x0012).v;
  const stale = seen != null && seen > 30;
  const flags = V(0x0008).f;
  const chips = [];
  if (flags) {
    for (const i of flags.set) { if ([0, 7, 11, 29, 31].includes(i)) continue; chips.push([FLAG_NAMES[i][1], RED_FLAGS.has(i) ? 'red' : YELLOW_FLAGS.has(i) ? 'yellow' : '']); }
    if (bit(V(0x0008).v, 29)) chips.push(['Na trati', 'blue']);
    if (bit(V(0x0008).v, 31)) chips.push(['Stanice', 'blue']);
    chips.push([flags.mv, '']);
    if (flags.akCode) chips.push([flags.ak, flags.akCode === 3 ? 'red' : 'yellow']);
    if (flags.gsCode !== 3) chips.push([flags.gs, 'yellow']);
  }
  if (V(0x0007).v != null && !V(0x0007).ok) chips.push(['Chybná zpráva', 'yellow']);
  const d1 = V(0x0015).v, d2 = V(0x0014).v;
  const az = V(0x0013);
  const arrow = az.v != null ? `<span style="display:inline-block;transform:rotate(${az.v}deg)">↑</span>` : '';
  return `<div class="train ${col} ${stale ? 'stale' : ''}">
    <div class="top"><div><div class="name">${esc(trainName(u))}</div><div class="hint">${esc((V(0x0002).v || '') + (V(0x0005).v ? ' · TÚ ' + V(0x0005).v : '') + ' · ' + hex4(u.svc))}</div></div>
    <div style="text-align:right"><div class="dist">${esc(fmtDist(d1 || d2))}</div><div class="hint">${d1 ? 'po koleji' : d2 ? 'vzdušně' : ''}${d1 && d2 ? ' · vzduš. ' + esc(fmtDist(d2)) : ''}</div></div></div>
    <div class="grid3">
      <div><span>Čas do střetu</span><b>${esc(V(0x0016).t || '—')}</b></div>
      <div><span>Rychlost</span><b>${esc(V(0x000f).v != null ? V(0x000f).v + ' km/h' : '—')}</b></div>
      <div><span>Azimut</span><b>${arrow} ${esc(az.v != null ? az.v + '°' : '—')}</b></div>
      <div><span>Poslední příjem</span><b>${esc(V(0x0012).t || '—')}</b></div>
      <div><span>RSSI</span><b>${esc(V(0x0006).t || '—')}</b></div>
      <div><span>Napájení / aku</span><b>${esc((V(0x0009).v != null ? V(0x0009).v.toFixed(1) + ' V' : '—') + ' / ' + (V(0x000a).v != null ? V(0x000a).v.toFixed(1) + ' V' : '—'))}</b></div>
    </div>
    ${V(0x0004).v ? `<div class="hint" style="margin-top:4px">Strojvůdce: <a href="tel:+${esc(V(0x0004).v)}">${esc(V(0x0004).t)}</a></div>` : ''}
    <div class="chips">${chips.map(([t, c]) => `<span class="chip ${c}">${esc(t)}</span>`).join('')}</div>
  </div>`;
}

function drawRadar(remotes) {
  const cv = $('radar'), ctx = cv.getContext('2d');
  const W = cv.width, c = W / 2, R = W / 2 - 40;
  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue('--ink').trim(), line = css.getPropertyValue('--line').trim(), muted = css.getPropertyValue('--muted').trim();
  ctx.clearRect(0, 0, W, W);
  const pts = remotes.map((u) => ({ u, d: (u.val[0x0014] && u.val[0x0014].v) || (u.val[0x0015] && u.val[0x0015].v), az: u.val[0x0013] })).filter((p) => p.d && p.az && p.az.v != null);
  const maxD = Math.max(500, ...pts.map((p) => p.d));
  const steps = [500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
  const scale = steps.find((s) => s >= maxD) || maxD;
  ctx.lineWidth = 2; ctx.strokeStyle = line; ctx.fillStyle = muted; ctx.font = '22px system-ui'; ctx.textAlign = 'left';
  for (let i = 1; i <= 4; i++) { ctx.beginPath(); ctx.arc(c, c, (R * i) / 4, 0, Math.PI * 2); ctx.stroke(); { const rr = (R * i) / 4; ctx.fillText(fmtDist((scale * i) / 4), c + rr * 0.707 + 4, c + rr * 0.707 + 20); } }
  ctx.beginPath(); ctx.moveTo(c, c - R - 10); ctx.lineTo(c, c + R + 10); ctx.moveTo(c - R - 10, c); ctx.lineTo(c + R + 10, c); ctx.stroke();
  // vlastní vlak
  ctx.fillStyle = ink; ctx.beginPath(); ctx.moveTo(c, c - 22); ctx.lineTo(c - 14, c + 14); ctx.lineTo(c + 14, c + 14); ctx.closePath(); ctx.fill();
  ctx.font = 'bold 22px system-ui'; ctx.textAlign = 'center'; ctx.fillText('směr jízdy', c, 26);
  for (const p of pts) {
    const r = Math.min(1, p.d / scale) * R, a = (p.az.v * Math.PI) / 180;
    const x = c + r * Math.sin(a), y = c - r * Math.cos(a);
    const col = trainColor(p.u);
    const fill = col === 'red' ? css.getPropertyValue('--red') : col === 'yellow' ? css.getPropertyValue('--yellow') : css.getPropertyValue('--blue');
    if (p.az.unc && p.az.unc < 120) { const du = (p.az.unc * 3 * Math.PI) / 180; ctx.strokeStyle = fill; ctx.globalAlpha = 0.35; ctx.lineWidth = 14; ctx.beginPath(); ctx.arc(c, c, r, a - du - Math.PI / 2, a + du - Math.PI / 2); ctx.stroke(); ctx.globalAlpha = 1; ctx.lineWidth = 2; }
    ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ink; ctx.font = 'bold 22px system-ui'; ctx.fillText(trainName(p.u), x, y - 24);
    ctx.font = '20px system-ui'; ctx.fillText(fmtDist(p.d), x, y + 38);
  }
  if (!pts.length) { ctx.fillStyle = muted; ctx.font = '24px system-ui'; ctx.fillText('Žádné vlaky s platným azimutem', c, c + R / 2); }
}

function renderDiag() {
  const sel = $('diagUnit');
  const opts = units.filter((u) => u.present).map((u) => `<option value="${u.svc}">${hex4(u.svc)} ${u.svc === SVC_LOCAL ? 'Local' : 'Vlak ' + (u.svc - SVC_LOCAL) + (u.active ? ' – ' + trainName(u) : ' (prázdný)')}</option>`).join('');
  const keep = sel.value;
  if (sel.dataset.sig !== opts) { sel.innerHTML = opts; sel.dataset.sig = opts; if (keep) sel.value = keep; }
  const u = unitBy(+sel.value); if (!u) { $('diagTable').innerHTML = ''; return; }
  const ids = [...new Set([...(u.svc === SVC_LOCAL ? LOCAL_CHARS : REMOTE_CHARS), ...u.chars.keys()])].sort((a, b) => a - b);
  const now = Date.now();
  $('diagTable').innerHTML = '<tr><th>UUID</th><th>Název</th><th>Prop</th><th>HEX</th><th>Hodnota</th><th>Stáří</th></tr>' + ids.map((id) => {
    const ch = u.chars.get(id); const p = ch ? ch.properties : null;
    const prop = p ? (p.read ? 'R' : '') + (p.write || p.writeWithoutResponse ? 'W' : '') + (p.notify ? 'N' : '') + (p.indicate ? 'I' : '') : simulating ? 'sim' : '✕';
    const raw = u.raw[id]; const hex = raw ? Array.from(raw, (x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ') : '';
    const age = u.readAt[id] ? ((now - u.readAt[id]) / 1000).toFixed(1) + ' s' : '';
    return `<tr><td>${hex4(id)}</td><td>${esc(D[id] ? D[id].n : '?')}</td><td>${prop}</td><td>${hex}</td><td>${esc(u.val[id] ? u.val[id].t : '')}</td><td>${age}</td></tr>`;
  }).join('');
}
let logRenderT = null;
function renderLogSoon() { if (logRenderT) return; logRenderT = setTimeout(() => { logRenderT = null; const el = $('logView'); const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 20; el.textContent = logLines.slice(-400).join('\n'); if (atEnd) el.scrollTop = el.scrollHeight; }, 300); }

/* ====================== Snapshot do CSV (každých 5 s) ====================== */
setInterval(() => {
  if (!(connected || simulating)) return;
  const local = unitBy(SVC_LOCAL); const V = (u, id) => (u.val[id] ? u.val[id].v : '');
  const ts = nowStr();
  csvRows.push([ts, 'LOCAL', V(local, 0x0002), V(local, 0x0003), '', V(local, 0x0027), V(local, 0x002b), V(local, 0x002c), V(local, 0x002f), V(local, 0x0030), '', '', '', V(local, 0x0029)]);
  const parts = [];
  for (const u of units.filter((x) => x.svc !== SVC_LOCAL && x.active)) {
    csvRows.push([ts, hex4(u.svc), V(u, 0x0002), V(u, 0x0003), V(u, 0x0008), '', V(u, 0x000b), V(u, 0x000c), V(u, 0x000f), V(u, 0x000e), V(u, 0x0015), V(u, 0x0014), V(u, 0x0016), '']);
    parts.push(`${trainName(u)} d1=${V(u, 0x0015)} d2=${V(u, 0x0014)} tc=${V(u, 0x0016)}`);
  }
  if (csvRows.length > 100000) csvRows.splice(0, 10000);
  log(`SNAP stav=0x${(V(local, 0x0027) || 0).toString(16)} v=${V(local, 0x002f)} | ${parts.join(' | ') || 'žádné vlaky'}`);
}, 5000);

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const today = () => nowStr().slice(0, 10);

/* ====================== Simulace ====================== */
function startSim() {
  simulating = true; connected = false; device = null;
  units = SVC_ALL.map(newUnit);
  units.forEach((u) => { u.present = true; });
  const local = unitBy(SVC_LOCAL);
  const t0 = Date.now();
  const enc = (id, v) => {
    switch (id) {
      case 0x0002: case 0x0005: { const s = (v || '').padEnd(6, '\0').slice(0, 6); return Uint8Array.from(s, (ch) => ch.charCodeAt(0)); }
      case 0x0004: return phoneToBcd(v);
      default: return uintToBytes(v, ({ 0x0001: 4, 0x0003: 3, 0x0008: 4, 0x0031: 4, 0x000b: 4, 0x000c: 4, 0x002b: 4, 0x002c: 4 })[id] || ([0x0006, 0x0009, 0x000a, 0x0010, 0x0011, 0x0012, 0x0026, 0x0027, 0x0028, 0x0029, 0x002e].includes(id) ? 1 : 2));
    }
  };
  const put = (u, id, v) => store(u, id, enc(id, v));
  const i32 = (x) => (x < 0 ? 2 ** 32 + x : x);
  const trains = [
    { svc: 0x5401, rk: 'VLAK01', no: 17101, tel: '602123456', d0: 4200, v: -12, az: 8 },   // přibližuje se
    { svc: 0x5402, rk: 'NAKLAD', no: 61330, tel: '', d0: 2600, v: 6, az: 172 },          // vzdaluje se
    { svc: 0x5403, rk: 'VLAKXY', no: 0, tel: '731000222', d0: 9800, v: 0, az: 245 },      // stojí
  ];
  put(local, 0x0002, 'VLAK00'); put(local, 0x0003, parseInt(input.vlak, 10) || 0); put(local, 0x0004, input.telefon);
  put(local, 0x0031, 2 ** 0); put(local, 0x0005, '1234R0');
  log('Simulace spuštěna');
  const step = () => {
    const t = (Date.now() - t0) / 1000;
    const gps = Math.floor((Date.now() - Date.UTC(1980, 0, 6)) / 1000) + 18;
    let red = false, yellow = false;
    for (const tr of trains) {
      const u = unitBy(tr.svc);
      let d = tr.d0 + tr.v * t; if (d < 150) { d = 150; } if (tr.v < 0 && d <= 150) tr.v = 0;
      const tc = tr.v < 0 ? Math.round(d / -tr.v) : tr.v > 0 ? 65535 : 0;
      if (tr.v < 0 && tc <= S.red) red = true; else if (tr.v < 0 && tc <= S.yellow) yellow = true;
      put(u, 0x0001, gps); put(u, 0x0002, tr.rk); put(u, 0x0003, tr.no); put(u, 0x0004, tr.tel); put(u, 0x0005, '1234R' + (tr.svc - 0x5400));
      put(u, 0x0006, (-70 + Math.round(Math.sin(t / 3) * 6) + 32 + 256) % 256);
      put(u, 0x0007, 0x8000 | (5 << 8) | (2 << 4) | 1);
      let fl = 2 ** 0 + 2 ** 29 + (3 * 2 ** 19) + (5 * 2 ** 21) + (2 * 2 ** 16) + (tr.v ? 2 ** 14 : 0);
      if (tr.svc === 0x5403) fl += 2 ** 9; // nízké napětí aku
      put(u, 0x0008, fl);
      put(u, 0x0009, 160); put(u, 0x000a, tr.svc === 0x5403 ? 140 : 168);
      put(u, 0x000b, i32(Math.round((50.07 + tr.az / 10000) * 1e7))); put(u, 0x000c, i32(Math.round((12.95 + d / 1e6) * 1e7))); put(u, 0x000d, 4520);
      put(u, 0x000e, ((tr.az + 180) % 360) | (2 << 9)); put(u, 0x000f, Math.round(Math.abs(tr.v) * 3.6) | (1 << 9));
      put(u, 0x0010, tr.v ? 0 : 0x42); put(u, 0x0011, 2); put(u, 0x0012, 1 + (Math.floor(t) % 3));
      put(u, 0x0013, tr.az | (1 << 9)); put(u, 0x0014, Math.round(d * 0.92)); put(u, 0x0015, Math.round(d)); put(u, 0x0016, tc);
    }
    put(local, 0x0001, gps);
    put(local, 0x0027, 1 + 8 + (red ? 16 : yellow ? 32 : 2));
    put(local, 0x0028, 0x03 | (0x01 << 2) | (1 << 4)); put(local, 0x0029, 14); put(local, 0x002a, 0x0000);
    put(local, 0x002b, i32(500712345)); put(local, 0x002c, i32(129512345)); put(local, 0x002d, 4480); put(local, 0x002e, 3);
    put(local, 0x002f, 62 | (1 << 9)); put(local, 0x0030, 274 | (1 << 9)); put(local, 0x0026, (-110 + 32 + 256) % 256);
    render();
  };
  step(); simTimer = setInterval(step, 1000);
  setConn('ok', 'Simulace');
  showScreen('scrMain');
}
function stopSim() { clearInterval(simTimer); simTimer = null; simulating = false; log('Simulace ukončena'); }

/* ====================== Dialog ====================== */
function confirmDlg(text) {
  return new Promise((res) => {
    const d = $('dlg'); $('dlgText').innerHTML = text;
    const done = (v) => { d.close(); $('dlgYes').onclick = $('dlgNo').onclick = null; res(v); };
    $('dlgYes').onclick = () => done(true); $('dlgNo').onclick = () => done(false);
    d.showModal();
  });
}

/* ====================== Inicializace ====================== */
function applyTheme() { document.documentElement.dataset.theme = S.theme; }
function loadSettingsForm() { $('setEndian').value = S.endian; $('setMode').value = S.mode; $('setPoll').value = S.poll; $('setSlow').value = S.slow; $('setPrefix').value = S.prefix; $('setRed').value = S.red; $('setYellow').value = S.yellow; $('setSound').value = S.sound; $('setTheme').value = S.theme; }
function saveSettingsForm() {
  S.endian = $('setEndian').value; S.mode = $('setMode').value; S.poll = Math.max(200, +$('setPoll').value || DEFAULTS.poll); S.slow = Math.max(1, +$('setSlow').value || DEFAULTS.slow);
  S.prefix = $('setPrefix').value.trim(); S.red = +$('setRed').value || 0; S.yellow = +$('setYellow').value || 0; S.sound = $('setSound').value; S.theme = $('setTheme').value;
  LS.set('sv.settings', S); applyTheme(); log('Nastavení uloženo: ' + JSON.stringify(S));
}

function init() {
  $('ver').textContent = APP_VERSION;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && curScreen === 'scrMain') keepAwake(); });
  applyTheme();
  $('inKontakt').value = input.kontakt; $('inTelefon').value = input.telefon; $('inVlak').value = input.vlak;

  $('btnContinue').onclick = () => {
    const k = $('inKontakt').value.trim(), t = $('inTelefon').value.trim(), v = $('inVlak').value.trim();
    const d = phoneDigits(t);
    let err = '';
    if (!/^\d{1,8}$/.test(v) || +v < 1 || +v > 16777215) err = 'Zadejte číslo vlaku 1–999999 (max. 16777215).';
    else if (t && d.length !== 12) err = 'Telefon zadejte jako 9 číslic (CZ) nebo s předvolbou, celkem 12 číslic.';
    $('inErr').textContent = err;
    if (err) return;
    Object.assign(input, { kontakt: k, telefon: t, vlak: String(+v) });
    LS.set('sv.input', input);
    ensureAudio();
    log(`Zadání: kontakt "${k}", vlak ${v}, telefon ${fmtPhone(d)}`);
    showScreen('scrScan');
  };
  $('btnBackInput').onclick = () => showScreen('scrInput');
  $('btnScan').onclick = () => { ensureAudio(); scanAndConnect(); };
  $('btnSim').onclick = () => { ensureAudio(); startSim(); };
  $('btnSettings').onclick = () => { loadSettingsForm(); showScreen('scrSettings'); };
  $('btnSettingsBack').onclick = () => { saveSettingsForm(); showScreen(prevScreen); };
  $('btnDisconnect').onclick = async () => { if (await confirmDlg('<b>Odpojit?</b><p>Chcete se odpojit od ' + esc(simulating ? 'simulace' : (device && device.name) || 'jednotky') + '?</p>')) disconnect(); };
  $('btnMute').onclick = () => { muteUntil = Date.now() + 60000; $('btnMute').textContent = '🔕'; setTimeout(() => { $('btnMute').textContent = '🔔'; }, 60000); log('Alarm ztlumen na 60 s'); };
  $('btnRewrite').onclick = () => { if (simulating) return; writeIdentity().then(() => banner('')).catch((e) => banner('Zápis selhal: ' + e.message, 'red')); };
  $('btnLogDl').onclick = () => download(`${today()}.log`, logLines.join('\r\n'), 'text/plain');
  $('btnCsvDl').onclick = () => download(`sherlog_${today()}.csv`, ['cas;slot;radkod;vlak;flags;status;lat;lon;rychlost_kmh;smer;dist1d_m;dist2d_m;crashtime_s;sat', ...csvRows.map((r) => r.join(';'))].join('\r\n'), 'text/csv');
  $('btnLogClear').onclick = async () => { if (await confirmDlg('Vymazat log?')) { logLines = []; csvRows = []; LS.set('sv.log', []); renderLogSoon(); } };
  $('diagUnit').onchange = renderDiag;
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.onclick = () => {
      curTab = b.dataset.tab;
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('sel', x === b));
      document.querySelectorAll('.tab').forEach((t) => { t.hidden = t.id !== curTab; });
      if (curTab === 'tabDiag') { verbose = true; renderLogSoon(); } else verbose = false;
      render();
    };
  });

  // SOS – podržet 2 s
  const sos = $('btnSos'); let holdT = null, holdStart = 0, raf = null;
  const resetHold = () => { clearTimeout(holdT); cancelAnimationFrame(raf); holdT = null; $('sosFill').style.height = '0'; };
  const anim = () => { const p = Math.min(1, (Date.now() - holdStart) / 2000); $('sosFill').style.height = p * 100 + '%'; if (p < 1) raf = requestAnimationFrame(anim); };
  sos.addEventListener('pointerdown', (e) => { e.preventDefault(); ensureAudio(); holdStart = Date.now(); anim(); holdT = setTimeout(() => { resetHold(); try { navigator.vibrate && navigator.vibrate(300); } catch (er) { /* ignore */ } toggleSos(); }, 2000); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => sos.addEventListener(ev, () => { if (holdT) { resetHold(); banner('SOS: tlačítko podržte 2 sekundy'); setTimeout(() => banner(''), 2500); } }));
  sos.addEventListener('contextmenu', (e) => e.preventDefault());

  // Podpora Web Bluetooth
  const ok = !!(navigator.bluetooth && window.isSecureContext);
  $('btSupport').innerHTML = ok ? '' : '<span class="err">Tento prohlížeč nepodporuje Web Bluetooth. Použijte Chrome na Androidu (stránka musí běžet přes HTTPS).</span>';
  $('btnScan').disabled = !ok;
  if (ok && navigator.bluetooth.getDevices) {
    navigator.bluetooth.getDevices().then((devs) => {
      if (!devs.length) return;
      $('knownDevices').innerHTML = '<p class="hint">Dříve spárovaná zařízení:</p>' + devs.map((d, i) => `<div class="dev"><div>${esc(d.name || 'Unknown Device')}<small>${esc(d.id)}</small></div><button class="btn" data-i="${i}">Připojit</button></div>`).join('');
      $('knownDevices').querySelectorAll('button').forEach((b) => { b.onclick = () => connectDevice(devs[+b.dataset.i]).catch((e) => { $('scanErr').textContent = 'Chyba: ' + e.message; showScreen('scrScan'); }); });
    }).catch(() => {});
  }
  window.addEventListener('beforeunload', (e) => { LS.set('sv.log', logLines.slice(-3000)); if (connected) { e.preventDefault(); e.returnValue = ''; } });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  setInterval(() => { if (curScreen === 'scrMain') render(); }, 1000);
  showScreen('scrInput');
}

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);
if (typeof module !== 'undefined') module.exports = { D, nonlinTime, phoneToBcd, uintToBytes, uintBytes, decodeFlags, S };
