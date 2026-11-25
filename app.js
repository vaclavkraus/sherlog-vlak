/* SHERLOG RMJ – PWA pro Web Bluetooth (Chrome / Android)
 * Specifikace: "Přehled parametrů Bluetooth LE pro SHERLOG VLAK, 15.03.2026"
 */
'use strict';
const APP_VERSION = '0.2.0';

/* ====================== Nastavení ====================== */
const DEFAULTS = {
  endian: 'le', mode: 'notify', poll: 1000, slow: 5, prefix: 'D3R', red: 60, yellow: 180, sound: '1', theme: 'light',
  // vyvolání alertu (jako v původní aplikaci + čas do střetu a SOS)
  alDist: true, alDistM: 250, alBit: true, alCrash: true, alSos: true, crew: 'CETA',
  // diagnostika a karty hlavního panelu
  dDec: true, dHex: true, dBin: false, cWatch: true, cTrains: true, cUser: true, cDev: true, cLog: true,
  autologin: true,
};
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
// Chrome vrací plné UUID (0000xxxx-0000-1000-8000-00805f9b34fb), Bluefy na iOS jen krátké „xxxx“ nebo „0x…“
const short16 = (u) => { const t = String(u).trim().toLowerCase().replace(/^0x/, ''); return t.length <= 8 ? parseInt(t, 16) : parseInt(t.slice(4, 8), 16); };
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
const hexStr = (b) => Array.from(b, (x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');
/** Rádiový kód / traťový úsek: 6 znaků ASCII, platné A–Z a 0–9 (např. VLAK01, NAKLAD).
 *  Původní aplikace bajty zobrazovala jako text UTF-8 → nečitelné znaky „���[“.
 *  Zde: nuly a mezery na okrajích se odříznou, platný kód se zobrazí velkými písmeny,
 *  neplatné bajty se nezobrazí jako „rozsypaný čaj“, ale jako HEX s upozorněním. */
function radioCode(b, emptyText) {
  if (!b || !b.length || b.every((x) => x === 0 || x === 0x20 || x === 0xff)) return { v: null, ok: true, t: emptyText };
  let a = Array.from(b);
  while (a.length && (a[a.length - 1] === 0 || a[a.length - 1] === 0x20)) a.pop();
  while (a.length && (a[0] === 0 || a[0] === 0x20)) a.shift();
  const s = String.fromCharCode(...a);
  if (/^[A-Za-z0-9]+$/.test(s)) { const v = s.toUpperCase(); return { v, ok: true, t: v }; }
  if (/^[\x20-\x7e]+$/.test(s)) return { v: s, ok: false, t: s + ' (nestandardní znaky)' };
  const h = hexStr(b);
  return { v: 'HEX ' + h.replace(/ /g, ''), ok: false, t: 'neplatný kód – HEX ' + h };
}
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
def(0x0002, 'RADKOD', 'Rádiový kód', 'id', (b) => radioCode(b, 'nepřiřazen'));
def(0x0003, 'VLAKCISLO', 'Číslo vlaku', 'id', (b) => { const v = uintBytes(b); return { v: v || null, t: v ? String(v) : '—' }; });
def(0x0004, 'TELEFON', 'Telefon strojvůdce', 'id', (b) => { const d = bcdDigits(b); const v = /^0+$/.test(d) ? null : d.replace(/^0+/, ''); return { v, t: fmtPhone(v) }; });
def(0x0005, 'TU', 'Traťový úsek', 'slow', (b) => radioCode(b, '—'));
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
  if (u.svc !== SVC_LOCAL && (id === 0x0002 || id === 0x0001)) updateActive(u);
  if (source === 'notify') log(`Notify ${hex4(u.svc)}/${hex4(id)} ${d.n} = ${u.val[id].t}`, true);
}

/* Slot okolního vlaku je aktivní, když jeho služba existuje a chodí na ni notifikace TIMESTAMP
   (dle vývojářů FW: prázdný slot buď ve službách vůbec není, nebo na něj nechodí notifikace).
   V režimu periodického čtení (bez notifikací) se použije TIMESTAMP ≠ 0 a RADKOD ≠ 0. */
const STALE_MS = 6000;
function updateActive(u) {
  if (u.svc === SVC_LOCAL) return;
  let act;
  if (!u.present) act = false;
  else if (S.mode === 'notify' && !simulating) act = Date.now() - u.lastNotify < STALE_MS;
  else if (simulating) act = Date.now() - u.lastNotify < STALE_MS;
  else { const ts = u.val[0x0001] && u.val[0x0001].v, rk = u.val[0x0002] && u.val[0x0002].v; act = !!(ts && rk); }
  if (act !== u.active) {
    u.active = act;
    const rk = u.val[0x0002] && u.val[0x0002].v;
    log(`Slot ${hex4(u.svc)}: ${act ? 'aktivní ' + (rk || '') : 'neaktivní (bez notifikací)'}`);
  }
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
    log(`Chyba čtení ${hex4(u.svc)}/${hex4(id)}: ${errText(e)}`);
    if (!device || !device.gatt.connected) throw e;
    if (u.svc !== SVC_LOCAL && e && (e.name === 'InvalidStateError' || e.name === 'NotFoundError')) {
      u.present = false; updateActive(u); log(`Služba ${hex4(u.svc)} zanikla – vlak mimo dosah`);
    }
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
    if (S.mode === 'poll') for (const id of [0x0001, 0x0002]) if (u.chars.has(id)) out.push(id);
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
  } catch (e) { log('Plánovač čtení přerušen: ' + errText(e)); }
  finally { pumpRunning = false; }
}

/* ====================== Připojení ====================== */
function errText(e) {
  if (e == null) return 'neznámá chyba';
  if (typeof e === 'string') return e;
  const parts = [e.name, e.message, e.code != null ? 'kód ' + e.code : ''].filter(Boolean);
  if (parts.length) return parts.join(': ');
  try { return JSON.stringify(e); } catch (x) { return String(e); }
}
async function scanAndConnect() {
  $('scanErr').textContent = '';
  try {
    // UUID vždy jako plný text – některé prohlížeče (např. Bluefy na iOS) číselné aliasy nepřijímají
    const opts = { optionalServices: [...SVC_ALL.map(uuid16), uuid16(0x180a), '6e400001-b5a3-f393-e0a9-e50e24dcca9e'] };
    // filtry se sčítají (OR): název D3R… NEBO zařízení vysílající službu 5400 (např. simulátor na Windows)
    if (S.prefix) opts.filters = [{ namePrefix: S.prefix }, { services: [uuid16(SVC_LOCAL)] }]; else opts.acceptAllDevices = true;
    const dev = await navigator.bluetooth.requestDevice(opts);
    await connectDevice(dev);
  } catch (e) {
    const msg = errText(e);
    if (e && e.name === 'NotFoundError') $('scanErr').textContent = 'Výběr zrušen nebo nenalezeno žádné zařízení. (' + msg + ')';
    else $('scanErr').textContent = 'Chyba: ' + msg;
    log('Vyhledání/připojení selhalo: ' + msg);
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
  for (const u of units) await discoverUnit(u);
  const local = unitBy(SVC_LOCAL);
  if (!units.some((u) => u.present)) throw new Error('Zařízení nemá služby 5400–5408');
  connected = true;
  setConn('ok', 'Připojeno');
  log(`ConManager: připojeno, služby: ${units.filter((u) => u.present).map((u) => hex4(u.svc)).join(' ')}`);

  // Přihlášení: zápis čísla vlaku a telefonu (po připojení se v jednotce nulují)
  if (local.present) await writeIdentity().catch((e) => { log('Zápis identifikace selhal: ' + errText(e)); banner('Nepodařilo se zapsat číslo vlaku/telefon: ' + errText(e), 'red'); });

  // Notifikace / indikace
  for (const u of units) if (u.present) await subscribeUnit(u);
  pump();
}

async function discoverUnit(u) {
  try {
    const s = await gatt(() => server.getPrimaryService(uuid16(u.svc)));
    const chs = await gatt(() => s.getCharacteristics());
    u.chars = new Map();
    for (const ch of chs) u.chars.set(short16(ch.uuid), ch);
    u.present = true;
    log(`Služba ${hex4(u.svc)}: ${chs.length} charakteristik (${[...u.chars.keys()].map(hex4).join(' ')})`);
    return true;
  } catch (e) { return false; /* služba neexistuje */ }
}

async function subscribeUnit(u) {
  for (const id of u.svc === SVC_LOCAL ? [0x0001, 0x0003, 0x0004, 0x0031] : [0x0001]) await setNotify(u, id, true);
}
async function setNotify(u, id, on) {
  const ch = u.chars.get(id); if (!ch || !(ch.properties.notify || ch.properties.indicate)) return;
  u.notif = u.notif || new Set(); u.lsn = u.lsn || {};
  try {
    if (on) {
      if (!u.lsn[id]) {
        u.lsn[id] = (ev) => {
          const dv = ev.target.value; store(u, id, new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength).slice(), 'notify');
          if (id === 0x0001) { u.lastNotify = Date.now(); u.dirty = true; updateActive(u); }
          if (curTab === 'tabDiag') render();
        };
        ch.addEventListener('characteristicvaluechanged', u.lsn[id]);
      }
      await gatt(() => ch.startNotifications()); u.notif.add(id);
    } else {
      await gatt(() => ch.stopNotifications()); u.notif.delete(id);
      if (u.lsn[id]) { ch.removeEventListener('characteristicvaluechanged', u.lsn[id]); delete u.lsn[id]; }
    }
    log(`Notifikace ${hex4(u.svc)}/${hex4(id)} ${on ? 'zapnuta' : 'vypnuta'}`);
  } catch (e) { log(`Notifikace ${hex4(u.svc)}/${hex4(id)} nelze ${on ? 'zapnout' : 'vypnout'}: ${errText(e)}`); }
}

/* Služby okolních vlaků mohou vznikat a zanikat za běhu (vlak se objeví / zmizí).
   Každých 10 s se zkusí najít chybějící služby 5401–5408. */
setInterval(async () => {
  if (!connected || simulating || !server || !device || !device.gatt.connected) return;
  for (const u of units) {
    if (u.svc === SVC_LOCAL || u.present) continue;
    if (await discoverUnit(u)) { log(`Nová služba ${hex4(u.svc)} – vlak v dosahu`); await subscribeUnit(u); u.dirty = true; }
  }
}, 10000);

async function writeIdentity() {
  const local = unitBy(SVC_LOCAL);
  const vlak = parseInt(input.vlak, 10) || 0;
  if (local.chars.has(0x0003)) await writeChar(local, 0x0003, uintToBytes(vlak, 3));
  if (local.chars.has(0x0004)) await writeChar(local, 0x0004, phoneToBcd(input.telefon));
  log(`Zápis identifikace: uživatel ${user ? user.u : '?'}, kontakt "${input.kontakt}", vlak ${vlak || '—'}, telefon ${fmtPhone(phoneDigits(input.telefon))}`);
}
function phoneDigits(s) { let d = String(s || '').replace(/\D/g, ''); if (!d) return ''; if (d.startsWith('00')) d = d.slice(2); if (d.length === 9) d = '420' + d; return d; }
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
    catch (e) { log('Obnova připojení selhala: ' + errText(e)); }
  }
}

async function disconnect() {
  userDisconnect = true; connected = false;
  if (simulating) stopSim();
  try { if (device && device.gatt.connected) device.gatt.disconnect(); } catch (e) { /* ignore */ }
  setConn('', 'Odpojeno');
  banner('');
  stopAlarm(); closeAlert();
  showScreen('scrScan');
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
  } catch (e) { banner('Zápis SOS selhal: ' + errText(e), 'red'); log('Zápis SOS selhal: ' + errText(e)); }
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
const TITLES = { scrLogin: 'Přihlášení', scrInput: 'Zadání vstupních dat', scrScan: 'Vyhledání zařízení', scrMain: 'Hlavní panel', scrSettings: 'Nastavení' };
function showScreen(id) {
  if (id !== 'scrSettings') prevScreen = id;
  curScreen = id;
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  $('title').textContent = TITLES[id];
  const inMain = id === 'scrMain';
  $('bottombar').classList.toggle('active', inMain);
  $('btnDisconnect').hidden = !inMain;
  $('btnMute').hidden = !inMain;
  $('btnSettings').hidden = !user || id === 'scrSettings';
  $('btnLogout').hidden = !user;
  $('btnInputBack').hidden = !(connected || simulating);
  if (inMain) { keepAwake(); render(); }
  renderSummaries();
}
function banner(text, kind) { const b = $('banner'); b.textContent = text; b.className = 'banner' + (text ? ' show' : '') + (kind === 'red' ? ' red' : ''); }
function setConn(cls, text) { $('connDot').className = 'conn-dot ' + cls; $('connDot').title = text; $('bbStatus').textContent = text; renderSummaries(); }
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderSummaries() {
  const vlak = input.vlak || '—';
  const html = `<div><b>${esc(input.kontakt || '—')}</b></div><div>Tel.: ${esc(fmtPhone(phoneDigits(input.telefon)))}</div><div>Vlak: ${esc(vlak)}</div>`
    + (user ? `<div class="hint">Přihlášen: ${esc(user.name || user.u)} (${user.role === 'admin' ? 'admin' : 'strojvedoucí'})</div>` : '');
  $('sumScan').innerHTML = html; $('sumMain').innerHTML = html; $('sumUser').innerHTML = html;
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
  const al = evalAlerts(remotes);
  if (al.some((a) => !a.ack)) level = 2;
  setAlarm(level);
  renderAlertCard(al);

  // nejbližší
  let best = null;
  for (const u of remotes) { const d = V(u, 0x0015).v || V(u, 0x0014).v; if (d && (!best || d < best.d)) best = { u, d, one: !!V(u, 0x0015).v }; }
  $('kNearest').innerHTML = best ? esc(fmtDist(best.d)) + (best.one ? '' : ' <small>vzduš.</small>') : '—';
  let minC = null; for (const u of remotes) { const c = V(u, 0x0016); if (c.v && !c.away && (minC == null || c.v < minC)) minC = c.v; }
  $('kCrash').textContent = minC == null ? '—' : fmtDur(minC);
  $('kSos').innerHTML = sosLocal ? '<span class="chip red">VLASTNÍ SOS</span>' : sosRemote.length ? '<span class="chip red">SOS: ' + sosRemote.map((u) => esc(trainName(u))).join(', ') + '</span>' : '✕';
  $('kAlert').innerHTML = al.length ? '<span class="chip red">' + al.length + '× ALERT</span>' : level === 2 ? '<span class="chip red">ČERVENÁ</span>' : level === 1 ? '<span class="chip yellow">ŽLUTÁ</span>' : '✕';
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

  for (const [k, id] of [['cWatch', 'cardWatch'], ['cTrains', 'cardTrains'], ['cUser', 'cardUser'], ['cDev', 'cardDev'], ['cLog', 'cardLog']]) $(id).hidden = !S[k];
  if (S.cLog) renderLogCard();
  if (curTab === 'tabRadar') drawRadar(remotes);
  if (curTab === 'tabDiag') renderDiag();
}

/* ====================== Alert (blížící se vlak / četa) ====================== */
const crewPrefixes = () => String(S.crew || '').split(/[,; ]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
function isCrew(u) { const rk = u.val[0x0002] && u.val[0x0002].ok && u.val[0x0002].v; return !!rk && crewPrefixes().some((p) => rk.startsWith(p)); }
const alertAck = new Map(); // svc → true (potvrzeno zavřením okna)
let alertList = [], alertOpen = false, alertIdx = 0;
function alertReasons(u) {
  const V = (id) => u.val[id] || {};
  const r = []; let red = false;
  const fl = V(0x0008).v;
  const d = V(0x0015).v || V(0x0014).v;
  const c = V(0x0016);
  if (S.alSos && fl != null && bit(fl, 12)) { r.push('SOS vyhlášené touto jednotkou'); red = true; }
  if (S.alSos && fl != null && bit(fl, 5)) { r.push('Nehoda / náraz hlášený jednotkou'); red = true; }
  if (S.alBit && fl != null && bit(fl, 30)) { r.push('Jednotka hlásí poplach – blízká jednotka (PBJ)'); red = true; }
  if (S.alCrash && c.v && !c.away && c.v <= S.red) { r.push('Čas do možného střetu ' + fmtDur(c.v)); red = true; }
  if (S.alDist && d && d < S.alDistM) r.push('Vzdálenost ' + fmtDist(d) + ' je menší než nastavených ' + S.alDistM + ' m');
  return { r, red };
}
function evalAlerts(remotes) {
  const list = [];
  for (const u of remotes) { const a = alertReasons(u); if (a.r.length) list.push({ u, svc: u.svc, ...a, ack: alertAck.has(u.svc) }); }
  // jednotka, která z alertu vypadla, při dalším vstupu alert znovu vyvolá
  for (const svc of [...alertAck.keys()]) if (!list.some((a) => a.svc === svc)) alertAck.delete(svc);
  for (const a of list) if (!alertList.some((b) => b.svc === a.svc)) log(`ALERT ${trainName(a.u)} (${hex4(a.svc)}): ${a.r.join('; ')}`);
  list.sort((a, b) => (b.red - a.red) || (dangerRank(a.u) - dangerRank(b.u)));
  alertList = list;
  if (list.some((a) => !a.ack) && !alertOpen) { const i = list.findIndex((a) => !a.ack); openAlert(i); }
  if (alertOpen) renderAlertOv();
  return list;
}
function renderAlertCard(list) {
  $('cardAlert').hidden = !list.length;
  $('alertList').innerHTML = list.map((a, i) => `<div class="al-row" data-i="${i}"><img src="${isCrew(a.u) ? 'ikona-ceta.png' : 'ikona-vlak.png'}" alt=""><div style="flex:1"><b>${esc(isCrew(a.u) ? 'Četa ' : '')}${esc(trainName(a.u))}</b> <span class="chip ${a.red ? 'red' : 'yellow'}">${esc(fmtDist(a.u.val[0x0015] && a.u.val[0x0015].v || a.u.val[0x0014] && a.u.val[0x0014].v))}</span><div class="hint">${esc(a.r[0])}</div></div></div>`).join('');
}
function openAlert(i) { alertOpen = true; alertIdx = Math.max(0, i); $('alertOv').classList.add('show'); renderAlertOv(); }
function closeAlert() { for (const a of alertList) alertAck.set(a.svc, true); alertOpen = false; $('alertOv').classList.remove('show'); render(); }
function renderAlertOv() {
  if (!alertList.length) { alertOpen = false; $('alertOv').classList.remove('show'); return; }
  if (alertIdx >= alertList.length) alertIdx = alertList.length - 1;
  const a = alertList[alertIdx], u = a.u, V = (id) => u.val[id] || {};
  const crew = isCrew(u);
  $('alertBox').className = 'alert-box' + (a.red ? '' : ' yellow');
  $('alIco').src = crew ? 'ikona-ceta.png' : 'ikona-vlak.png';
  const sos = V(0x0008).v != null && bit(V(0x0008).v, 12);
  $('alTitle').textContent = sos ? 'SOS – ' + (crew ? 'pracovní četa' : 'vlak') : crew ? 'Pozor, pracovní četa!' : 'Blíží se vlak!';
  $('alSub').textContent = trainName(u) + (V(0x0002).v ? ' · rádiový kód ' + V(0x0002).t : '');
  const d1 = V(0x0015).v, d2 = V(0x0014).v;
  $('alDist').textContent = fmtDist(d1 || d2) + (d1 ? '' : d2 ? ' (vzdušně)' : '');
  $('alReason').innerHTML = a.r.map(esc).join('<br>');
  const rows = [
    ['Vzdálenost po trati', V(0x0015).t], ['Vzdálenost vzdušná', V(0x0014).t], ['Čas do možného střetu', V(0x0016).t],
    ['Rychlost', V(0x000f).v != null ? V(0x000f).v + ' km/h' : '—'], ['Směr (azimut)', V(0x0013).v != null ? V(0x0013).v + '°' : '—'],
    ['Číslo vlaku', V(0x0003).t], ['Rádiový kód', V(0x0002).t], ['Traťový úsek', V(0x0005).t],
    ['Telefon', V(0x0004).v ? `<a href="tel:+${esc(V(0x0004).v)}">${esc(V(0x0004).t)}</a>` : '—', true], ['Poslední příjem', V(0x0012).t],
  ];
  $('alDl').innerHTML = rows.map(([k, v, html]) => `<dt>${esc(k)}</dt><dd>${html ? v : esc(v || '—')}</dd>`).join('');
  $('alPos').textContent = alertList.length > 1 ? `${alertIdx + 1} / ${alertList.length}` : '';
  $('alPrev').hidden = $('alNext').hidden = alertList.length < 2;
}

/* ====================== Karta Log ====================== */
const logFileName = () => `sherlog_${(user && user.u) || 'log'}_${today()}.log`;
function renderLogCard() {
  $('logName').textContent = logFileName();
  const el = $('logMini'); const txt = logLines.slice(-50).join('\n');
  if (el.textContent !== txt) { el.textContent = txt; el.scrollTop = el.scrollHeight; }
}
async function sendLog() {
  const name = logFileName(), text = logLines.join('\r\n');
  try {
    const f = new File([text], name, { type: 'text/plain' });
    if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: name, text: 'Log aplikace SHERLOG RMJ' }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  download(name, text, 'text/plain');
  const body = 'Log aplikace SHERLOG RMJ – soubor ' + name + ' byl uložen do Stažených souborů, přiložte jej prosím.\n\nPosledních 50 řádků:\n' + logLines.slice(-50).join('\n');
  location.href = 'mailto:?subject=' + encodeURIComponent('SHERLOG RMJ log ' + name) + '&body=' + encodeURIComponent(body.slice(0, 1800));
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
    <div class="top"><div><div class="name"><img src="${isCrew(u) ? 'ikona-ceta.png' : 'ikona-vlak.png'}" alt="" style="width:26px;height:26px;vertical-align:-6px;background:#fff;border-radius:50%;padding:2px;margin-right:4px">${esc(isCrew(u) ? 'Četa ' : '')}${esc(trainName(u))}</div><div class="hint">${esc((V(0x0002).v || '') + (V(0x0005).v ? ' · TÚ ' + V(0x0005).v : '') + ' · ' + hex4(u.svc))}</div></div>
    <div style="text-align:right"><div class="dist">${esc(fmtDist(d1 || d2))}</div><div class="hint">${d1 ? 'po koleji' : d2 ? 'vzdušně' : ''}${d1 && d2 ? ' · vzduš. ' + esc(fmtDist(d2)) : ''}</div></div></div>
    <div class="grid3">
      <div><span>Čas do střetu</span><b>${esc(V(0x0016).t || '—')}</b></div>
      <div><span>Rychlost</span><b>${esc(V(0x000f).v != null ? V(0x000f).v + ' km/h' : '—')}</b></div>
      <div><span>Azimut</span><b>${arrow} ${esc(az.v != null ? az.v + '°' : '—')}</b></div>
      <div><span>Poslední příjem</span><b>${esc(V(0x0012).t || '—')}</b></div>
      <div><span>RSSI</span><b>${esc(V(0x0006).t || '—')}</b></div>
      <div><span>Napájení / aku</span><b>${esc((V(0x0009).v != null ? V(0x0009).v.toFixed(1) + ' V' : '—') + ' / ' + (V(0x000a).v != null ? V(0x000a).v.toFixed(1) + ' V' : '—'))}</b></div>
    </div>
    ${V(0x0004).v ? `<div class="hint" style="margin-top:4px">${isCrew(u) ? 'Kontakt' : 'Strojvůdce'}: <a href="tel:+${esc(V(0x0004).v)}">${esc(V(0x0004).t)}</a></div>` : ''}
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

let diagSvc = SVC_LOCAL;
function binStr(b) { return Array.from(b, (x) => x.toString(2).padStart(8, '0')).join(' '); }
function renderDiag() {
  const sig = units.map((u) => u.svc + ':' + u.present + ':' + u.active).join(',') + diagSvc;
  const sel = $('svcSel');
  if (sel.dataset.sig !== sig) {
    sel.dataset.sig = sig;
    sel.innerHTML = units.map((u) => `<button class="btn secondary ${u.svc === diagSvc ? 'sel' : ''} ${u.present ? '' : 'off'}" data-svc="${u.svc}">${hex4(u.svc)}${u.svc === SVC_LOCAL ? ' vlastní' : u.active ? ' ●' : ''}</button>`).join('');
  }
  const u = unitBy(diagSvc); const list = $('diagList');
  if (!u || !u.present) { list.innerHTML = '<p class="hint">Služba ' + hex4(diagSvc) + ' v zařízení není (slot bez vlaku).</p>'; list.dataset.sig = ''; return; }
  const ids = [...new Set([...(u.svc === SVC_LOCAL ? LOCAL_CHARS : REMOTE_CHARS), ...u.chars.keys()])].sort((a, b) => a - b);
  const notif = u.notif || new Set();
  const rsig = u.svc + '|' + ids.join(',') + '|' + [...notif].join(',') + '|' + simulating;
  if (list.dataset.sig !== rsig) {
    list.dataset.sig = rsig;
    list.innerHTML = ids.map((id) => {
      const ch = u.chars.get(id); const p = ch ? ch.properties : null;
      const prop = p ? [p.read && 'READ', (p.write || p.writeWithoutResponse) && 'WRITE', p.notify && 'NOTIFY', p.indicate && 'INDICATE'].filter(Boolean).join(', ') : simulating ? 'simulace' : 'nenalezena';
      const canN = p && (p.notify || p.indicate);
      return `<div class="dg-row" data-id="${id}"><div><div class="nm">${esc(D[id] ? D[id].l : '?')} <small>${hex4(id)} · ${esc(D[id] ? D[id].n : '')} · ${prop}</small></div><div class="val" id="dgv${id}"></div><div class="num" id="dgn${id}"></div></div>
        <div class="acts">${p && p.read ? `<button data-act="read" title="Načíst">⟳</button>` : ''}${canN ? `<button data-act="notif" class="${notif.has(id) ? 'on' : ''}" title="Notifikace">🔔</button>` : ''}</div></div>`;
    }).join('');
  }
  const now = Date.now();
  for (const id of ids) {
    const vEl = $('dgv' + id), nEl = $('dgn' + id); if (!vEl) continue;
    const raw = u.raw[id];
    const age = u.readAt[id] ? ' · před ' + ((now - u.readAt[id]) / 1000).toFixed(0) + ' s' : '';
    vEl.textContent = (u.val[id] ? u.val[id].t : 'nenačteno') + age;
    const parts = [];
    if (raw && raw.length) {
      if (S.dDec) parts.push('DEC ' + (raw.length <= 6 ? uintBytes(raw) : Array.from(raw).join(' ')));
      if (S.dHex) parts.push('HEX ' + hexStr(raw));
      if (S.dBin) parts.push('BIN ' + binStr(raw));
    }
    nEl.textContent = parts.join('  ·  ');
  }
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
    { svc: 0x5404, rk: 'CETA07', no: 0, tel: '777555333', d0: 320, v: -1.5, az: 355 },     // pracovní četa (do 250 m za ~45 s)
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
      let d = tr.d0 + tr.v * t; const dmin = tr.rk.startsWith('CETA') ? 60 : 150; if (d < dmin) { d = dmin; tr.v = 0; }
      const tc = tr.v < 0 ? Math.round(d / -tr.v) : tr.v > 0 ? 65535 : 0;
      if (tr.v < 0 && tc <= S.red) red = true; else if (tr.v < 0 && tc <= S.yellow) yellow = true;
      put(u, 0x0002, tr.rk); u.lastNotify = Date.now(); put(u, 0x0001, gps); put(u, 0x0003, tr.no); put(u, 0x0004, tr.tel); put(u, 0x0005, '1234R' + (tr.svc - 0x5400));
      put(u, 0x0006, (-70 + Math.round(Math.sin(t / 3) * 6) + 32 + 256) % 256);
      put(u, 0x0007, 0x8000 | (5 << 8) | (2 << 4) | 1);
      let fl = 2 ** 0 + 2 ** 29 + (3 * 2 ** 19) + (5 * 2 ** 21) + (2 * 2 ** 16) + (tr.v ? 2 ** 14 : 0);
      if (tr.svc === 0x5403) fl += 2 ** 9; // nízké napětí aku
      if (tr.v < 0 && tc && tc <= S.red) fl += 2 ** 30; // PBJ – poplach blízká jednotka
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
function applyTheme() { document.documentElement.dataset.theme = S.theme; const b = $('btnTheme'); if (b) b.textContent = S.theme === 'dark' ? '☀' : '🌙'; }

/* ====================== Uživatelé a přihlášení ======================
 * Centrální seznam users.json (v repozitáři vedle aplikace) – hesla jen jako PBKDF2-SHA256 hash se solí.
 * Po prvním načtení se seznam uloží v zařízení, takže přihlášení funguje i offline.
 * Úpravy seznamu: nástroj uzivatele.html → stáhnout users.json → nahrát na GitHub. */
let user = null; // {u, name, role}
let usersDb = LS.get('sv.users', null), usersFresh = false;
const SESSION_DAYS = 30;
const isAdmin = () => !!user && user.role === 'admin';
const b2h = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const h2b = (h) => Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16));
async function pbkdf2(pass, saltHex, iter) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
  return b2h(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: h2b(saltHex), iterations: iter }, key, 256)));
}
async function loadUsers() {
  try {
    const r = await fetch('users.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json(); if (!Array.isArray(j.users)) throw new Error('chybný formát');
    usersDb = j; usersFresh = true; LS.set('sv.users', j);
  } catch (e) { log('Seznam uživatelů nelze načíst ze sítě (' + errText(e) + ') – používám uložený'); }
  return usersDb;
}
function saveSession(uu, remember) {
  const sess = { u: uu.u, name: uu.name, role: uu.role, h: uu.h, t: Date.now() };
  try { sessionStorage.setItem('sv.session', JSON.stringify(sess)); } catch (e) { /* ignore */ }
  if (remember) LS.set('sv.session', sess);
}
function loadSession() {
  let s = null;
  try { s = JSON.parse(sessionStorage.getItem('sv.session') || 'null'); } catch (e) { /* ignore */ }
  if (!s && S.autologin) s = LS.get('sv.session', null);
  if (!s || Date.now() - s.t > SESSION_DAYS * 864e5) return null;
  return s;
}
function findUser(name) { return usersDb && usersDb.users.find((x) => x.u.toLowerCase() === String(name).trim().toLowerCase()); }
async function doLogin() {
  const name = $('lgUser').value.trim(), pass = $('lgPass').value;
  $('lgErr').textContent = '';
  if (!name || !pass) { $('lgErr').textContent = 'Zadejte uživatele a heslo.'; return; }
  if (!(window.crypto && crypto.subtle)) { $('lgErr').textContent = 'Přihlášení vyžaduje zabezpečené spojení (HTTPS).'; return; }
  $('btnLogin').disabled = true;
  try {
    await loadUsers();
    if (!usersDb) { $('lgErr').textContent = 'Seznam uživatelů není k dispozici – při prvním přihlášení musí být zařízení online.'; return; }
    const uu = findUser(name);
    const h = uu ? await pbkdf2(pass, uu.salt, uu.iter || 100000) : await pbkdf2(pass, '00', 1000);
    if (!uu || uu.disabled || h !== uu.hash) { $('lgErr').textContent = 'Nesprávný uživatel nebo heslo.'; log('Neúspěšné přihlášení: ' + name); return; }
    S.autologin = $('lgRemember').checked; LS.set('sv.settings', S);
    onLoggedIn({ u: uu.u, name: uu.name, role: uu.role, h: uu.hash.slice(0, 16) });
    saveSession(user, S.autologin);
    $('lgPass').value = '';
  } catch (e) { $('lgErr').textContent = 'Chyba přihlášení: ' + errText(e); }
  finally { $('btnLogin').disabled = false; }
}
function onLoggedIn(sess) {
  user = sess;
  log(`Přihlášen uživatel ${user.u} (${user.role})`);
  applyRole();
  showScreen((connected || simulating) ? 'scrMain' : 'scrInput');
}
function applyRole() {
  $('tabBtnDiag').hidden = !isAdmin();
  if (!isAdmin() && curTab === 'tabDiag') document.querySelector('.tabs button[data-tab="tabPrehled"]').click();
}
/* Po online načtení seznamu ověří, že zapamatovaný uživatel stále existuje a nezměnil heslo. */
async function verifySession() {
  await loadUsers();
  if (!user || !usersFresh) return;
  const uu = findUser(user.u);
  if (!uu || uu.disabled || uu.hash.slice(0, 16) !== user.h) { log('Zapamatované přihlášení už neplatí – nutné nové přihlášení'); logout(true); }
  else if (uu.role !== user.role) { user.role = uu.role; saveSession(user, S.autologin); applyRole(); }
}
async function logout(silent) {
  if (!silent && !(await confirmDlg('<b>Odhlásit?</b><p>' + ((connected || simulating) ? 'Spojení s jednotkou se ukončí.' : '') + '</p>'))) return;
  if (connected || simulating) await disconnect();
  log('Odhlášen uživatel ' + (user ? user.u : ''));
  user = null;
  try { sessionStorage.removeItem('sv.session'); localStorage.removeItem('sv.session'); } catch (e) { /* ignore */ }
  $('lgRemember').checked = S.autologin;
  showScreen('scrLogin');
}
const CHK = { setAlDist: 'alDist', setAlBit: 'alBit', setAlCrash: 'alCrash', setAlSos: 'alSos', setDDec: 'dDec', setDHex: 'dHex', setDBin: 'dBin', setCWatch: 'cWatch', setCTrains: 'cTrains', setCUser: 'cUser', setCDev: 'cDev', setCLog: 'cLog', setAutologin: 'autologin' };
function loadSettingsForm() {
  for (const [el, k] of Object.entries(CHK)) $(el).checked = !!S[k];
  $('setAlDistM').value = S.alDistM; $('setCrew').value = S.crew;
  document.querySelectorAll('.adminOnly').forEach((e) => { e.hidden = !isAdmin(); });
  $('setEndian').value = S.endian; $('setMode').value = S.mode; $('setPoll').value = S.poll; $('setSlow').value = S.slow; $('setPrefix').value = S.prefix; $('setRed').value = S.red; $('setYellow').value = S.yellow; $('setSound').value = S.sound; $('setTheme').value = S.theme; }
function saveSettingsForm() {
  S.endian = $('setEndian').value; S.mode = $('setMode').value; S.poll = Math.max(200, +$('setPoll').value || DEFAULTS.poll); S.slow = Math.max(1, +$('setSlow').value || DEFAULTS.slow);
  for (const [el, k] of Object.entries(CHK)) S[k] = $(el).checked;
  S.alDistM = Math.max(10, +$('setAlDistM').value || DEFAULTS.alDistM); S.crew = $('setCrew').value.trim().toUpperCase();
  if (!S.autologin) { try { localStorage.removeItem('sv.session'); } catch (e) { /* ignore */ } } else if (user) saveSession(user, true);
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
    if (v && (!/^\d{1,8}$/.test(v) || +v < 1 || +v > 16777215)) err = 'Číslo vlaku: 1–16777215 (nebo nechte prázdné).';
    else if (t && d.length !== 12) err = 'Telefon zadejte jako 9 číslic (CZ) nebo s předvolbou, celkem 12 číslic.';
    $('inErr').textContent = err;
    if (err) return;
    Object.assign(input, { kontakt: k, telefon: t, vlak: v ? String(+v) : '' });
    LS.set('sv.input', input);
    ensureAudio();
    log(`Zadání: kontakt "${k}", vlak ${v || '—'}, telefon ${fmtPhone(d)}`);
    if (connected || simulating) {
      // úprava za běhu → hned zapsat do jednotky
      if (simulating) { const l = unitBy(SVC_LOCAL); store(l, 0x0003, uintToBytes(+v || 0, 3)); store(l, 0x0004, phoneToBcd(t)); }
      else writeIdentity().then(() => banner('')).catch((e) => banner('Zápis selhal: ' + errText(e), 'red'));
      showScreen('scrMain');
    } else showScreen('scrScan');
  };
  $('btnInputBack').onclick = () => showScreen('scrMain');
  $('cardUser').onclick = () => { $('inKontakt').value = input.kontakt; $('inTelefon').value = input.telefon; $('inVlak').value = input.vlak; showScreen('scrInput'); };
  $('btnLogin').onclick = doLogin;
  $('lgPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  $('lgRemember').checked = S.autologin;
  $('btnLogout').onclick = () => logout(false);
  $('btnTheme').onclick = () => { S.theme = S.theme === 'dark' ? 'light' : 'dark'; LS.set('sv.settings', S); applyTheme(); render(); };
  $('alClose').onclick = closeAlert;
  $('alPrev').onclick = () => { alertIdx = (alertIdx - 1 + alertList.length) % alertList.length; renderAlertOv(); };
  $('alNext').onclick = () => { alertIdx = (alertIdx + 1) % alertList.length; renderAlertOv(); };
  $('alertList').onclick = (e) => { const r = e.target.closest('.al-row'); if (r) openAlert(+r.dataset.i); };
  $('btnLogSend').onclick = sendLog;
  $('btnLogShow').onclick = () => { $('logOvName').textContent = logFileName(); $('logOvText').textContent = logLines.slice(-3000).join('\n'); $('logOv').classList.add('show'); const p = $('logOvText'); p.scrollTop = p.scrollHeight; };
  $('btnLogOvClose').onclick = () => $('logOv').classList.remove('show');
  $('btnLogDl2').onclick = () => download(logFileName(), logLines.join('\r\n'), 'text/plain');
  $('svcSel').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; diagSvc = +b.dataset.svc; renderDiag(); };
  $('diagList').onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const id = +b.closest('.dg-row').dataset.id, u = unitBy(diagSvc);
    if (simulating || !connected) return;
    if (b.dataset.act === 'read') { await readChar(u, id).catch(() => {}); renderDiag(); }
    if (b.dataset.act === 'notif') { await setNotify(u, id, !(u.notif && u.notif.has(id))); renderDiag(); }
  };
  $('btnDiagAll').onclick = async () => { const u = unitBy(diagSvc); if (simulating || !connected || !u) return; for (const id of u.chars.keys()) { if (u.chars.get(id).properties.read) await readChar(u, id).catch(() => {}); } renderDiag(); };
  $('btnBackInput').onclick = () => showScreen('scrInput');
  $('btnScan').onclick = () => { ensureAudio(); scanAndConnect(); };
  $('btnSim').onclick = () => { ensureAudio(); startSim(); };
  $('btnSettings').onclick = () => { loadSettingsForm(); showScreen('scrSettings'); };
  $('btnSettingsBack').onclick = () => { saveSettingsForm(); showScreen(prevScreen); };
  $('btnDisconnect').onclick = async () => { if (await confirmDlg('<b>Odpojit?</b><p>Chcete se odpojit od ' + esc(simulating ? 'simulace' : (device && device.name) || 'jednotky') + '?</p>')) disconnect(); };
  $('btnMute').onclick = () => { muteUntil = Date.now() + 60000; $('btnMute').textContent = '🔕'; setTimeout(() => { $('btnMute').textContent = '🔔'; }, 60000); log('Alarm ztlumen na 60 s'); };
  $('btnRewrite').onclick = () => { if (simulating) return; writeIdentity().then(() => banner('')).catch((e) => banner('Zápis selhal: ' + errText(e), 'red')); };
  $('btnLogDl').onclick = () => download(logFileName(), logLines.join('\r\n'), 'text/plain');
  $('btnCsvDl').onclick = () => download(`sherlog_${today()}.csv`, ['cas;slot;radkod;vlak;flags;status;lat;lon;rychlost_kmh;smer;dist1d_m;dist2d_m;crashtime_s;sat', ...csvRows.map((r) => r.join(';'))].join('\r\n'), 'text/csv');
  $('btnLogClear').onclick = async () => { if (await confirmDlg('Vymazat log?')) { logLines = []; csvRows = []; LS.set('sv.log', []); renderLogSoon(); } };
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.onclick = () => {
      curTab = b.dataset.tab;
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('sel', x === b));
      document.querySelectorAll('.tab').forEach((t) => { t.hidden = t.id !== curTab; });
      if (curTab === 'tabDiag') { verbose = true; renderLogSoon(); } else verbose = false;
      render();
    };
  });

  // SOS – 3× za sebou stisknout (mezi stisky max. 0,7 s)
  const sos = $('btnSos'); let taps = 0, tapT = null;
  const resetTaps = () => { taps = 0; clearTimeout(tapT); tapT = null; $('sosFill').style.height = '0'; };
  sos.addEventListener('pointerdown', (e) => {
    e.preventDefault(); ensureAudio();
    taps++; clearTimeout(tapT);
    $('sosFill').style.height = (taps / 3) * 100 + '%';
    try { navigator.vibrate && navigator.vibrate(taps < 3 ? 40 : 300); } catch (er) { /* ignore */ }
    if (taps >= 3) { resetTaps(); toggleSos(); return; }
    tapT = setTimeout(() => { resetTaps(); banner('SOS: stiskněte tlačítko 3× rychle za sebou'); setTimeout(() => banner(''), 2500); }, 700);
  });
  sos.addEventListener('contextmenu', (e) => e.preventDefault());

  // Podpora Web Bluetooth
  const ok = !!(navigator.bluetooth && window.isSecureContext);
  $('btSupport').innerHTML = ok ? '' : '<span class="err">Tento prohlížeč nepodporuje Web Bluetooth. Použijte Chrome na Androidu (stránka musí běžet přes HTTPS).</span>';
  $('btnScan').disabled = !ok;
  if (ok && navigator.bluetooth.getDevices) {
    navigator.bluetooth.getDevices().then((devs) => {
      if (!devs.length) return;
      $('knownDevices').innerHTML = '<p class="hint">Dříve spárovaná zařízení:</p>' + devs.map((d, i) => `<div class="dev"><div>${esc(d.name || 'Unknown Device')}<small>${esc(d.id)}</small></div><button class="btn" data-i="${i}">Připojit</button></div>`).join('');
      $('knownDevices').querySelectorAll('button').forEach((b) => { b.onclick = () => connectDevice(devs[+b.dataset.i]).catch((e) => { $('scanErr').textContent = 'Chyba: ' + errText(e); showScreen('scrScan'); }); });
    }).catch(() => {});
  }
  window.addEventListener('beforeunload', (e) => { LS.set('sv.log', logLines.slice(-3000)); if (connected) { e.preventDefault(); e.returnValue = ''; } });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  setInterval(() => { for (const u of units) updateActive(u); if (curScreen === 'scrMain') render(); }, 1000);
  const sess = loadSession();
  if (sess) { onLoggedIn(sess); verifySession(); } else { showScreen('scrLogin'); loadUsers(); }
}

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);
if (typeof module !== 'undefined') module.exports = { D, radioCode, nonlinTime, phoneToBcd, uintToBytes, uintBytes, decodeFlags, S };
