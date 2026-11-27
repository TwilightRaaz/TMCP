/* TMCP — The Morse Code Project · built by Raaz
   Zero backend. Public MQTT broker is the airwaves. */
'use strict';

/* ---------------------------------------------------------------- morse */
const MORSE = {
  A:'.-',B:'-...',C:'-.-.',D:'-..',E:'.',F:'..-.',G:'--.',H:'....',I:'..',J:'.---',
  K:'-.-',L:'.-..',M:'--',N:'-.',O:'---',P:'.--.',Q:'--.-',R:'.-.',S:'...',T:'-',
  U:'..-',V:'...-',W:'.--',X:'-..-',Y:'-.--',Z:'--..',
  '0':'-----','1':'.----','2':'..---','3':'...--','4':'....-','5':'.....',
  '6':'-....','7':'--...','8':'---..','9':'----.',
  '.':'.-.-.-',',':'--..--','?':'..--..',"'":'.----.','!':'-.-.--','/':'-..-.',
  '(':'-.--.',')':'-.--.-','&':'.-...',':':'---...',';':'-.-.-.','=':'-...-',
  '+':'.-.-.','-':'-....-','_':'..--.-','"':'.-..-.','$':'...-..-','@':'.--.-.'
};
const RMORSE = {};
for (const k in MORSE) RMORSE[MORSE[k]] = k;

/* ------------------------------------------------------------- constants */
const DOT_MS = 100;          // side-tone dot length
const DASH_MS = 300;
const GAP_MS = 100;          // gap between elements inside a letter
const LETTER_COMMIT_MS = 700;  // idle before a keyed letter is committed
const WORD_COMMIT_MS = 1600;   // idle before a word break
const KEY_THRESHOLD_MS = 240;  // press shorter than this = dot (widened from 220 for touch jitter)
const PITCH = 650;

// slider position 0..5 = Whisper .. Global
const BANDS = [
  { name: 'Whisper', prec: 4, dist: '11m' },
  { name: 'Walkie',  prec: 3, dist: '110m' },
  { name: 'Block',   prec: 2, dist: '1.1Km' },
  { name: 'City',    prec: 1, dist: '11Km' },
  { name: 'Region',  prec: 0, dist: '111Km' },
  { name: 'Global',  prec: null, dist: 'Earth' }
];

const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt'
];

/* ----------------------------------------------------------------- state */
const S = {
  powered: false,
  connected: false,
  broker: 0,
  client: null,
  myId: 'u' + Math.random().toString(36).slice(2, 10),
  msgSeq: 0,
  seen: [],                    // recent message ids for dedupe
  tab: 'local',                // 'local' | 'private'
  band: 1,                     // index into BANDS (default = Walkie)
  cell: null,
  subs: [],                    // topics we want
  applied: [],                 // topics the broker confirmed
  geo: null,                   // {lat,lon}
  geoWatch: null,
  pendingCell: null,
  cellTimer: null,
  freq: '',
  pass: '',
  topic: null,                 // active rx/tx topic
  mode: 'key',
  muted: false,
  txBuf: '',                   // keyed pulses awaiting commit
  screen: 'welcome',
  text: '',                    // decoded transcript
  sent: '',                    // what I transmitted
  pulses: [],                  // ticker tape
  rxFree: 0                    // next free scheduling time (audio clock)
};

const $ = id => document.getElementById(id);
const nowMs = () => (window.performance && performance.now) ? performance.now() : Date.now();

/* ------------------------------------------------------------ toast / led */
let toastT = 0;
function toast(msg, ms) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), ms || 2600);
}

let airTimer = 0;
function setStatus(state) {
  const l1 = $('led'), l2 = $('led2');
  const t1 = $('ledTxt'), t2 = $('ledTxt2');
  l1.className = 'dot'; l2.className = 'dot';
  clearTimeout(airTimer);
  let label = 'OFFLINE', cls = '';
  if (state === 'standby') { label = 'STANDBY'; cls = 'standby'; }
  else if (state === 'air') { label = 'ON AIR'; cls = 'on'; }
  else if (state === 'error') { label = 'ERROR'; cls = 'err'; }
  if (cls) { l1.classList.add(cls); l2.classList.add(cls); }
  t1.textContent = label; t2.textContent = label;
}
function refreshStatus() {
  if (!S.powered) return setStatus('offline');
  if (!S.connected) return setStatus('error');
  setStatus(S.topic ? 'air' : 'standby');
}
/* a channel is live once we have a topic; GPS-less local band shows STANDBY */

/* ---------------------------------------------------------------- audio */
const Audio = {
  ctx: null, osc: null, gain: null, ready: false,
  init() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.osc = this.ctx.createOscillator();
    this.gain = this.ctx.createGain();
    this.osc.type = 'sine';
    this.osc.frequency.value = PITCH;
    this.gain.gain.value = 0;
    this.osc.connect(this.gain);
    this.gain.connect(this.ctx.destination);
    this.osc.start();
    this.ready = true;
    return true;
  },
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  /* schedule one gated tone at absolute audio time */
  beep(at, dur) {
    if (!this.ready) return;
    const g = this.gain.gain, A = 0.008, R = 0.012;
    const end = at + Math.max(dur, A + R + 0.01);
    g.cancelScheduledValues(at);
    g.setValueAtTime(0, at);
    g.linearRampToValueAtTime(1, at + A);
    g.setValueAtTime(1, end - R);
    g.linearRampToValueAtTime(0, end);
    if (S.muted) g.setValueAtTime(0, at + 0.001);
  },
  /* key held down */
  keyDown() {
    if (!this.ready) return;
    const t = this.ctx.currentTime, g = this.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(S.muted ? 0 : 1, t + 0.008);
  },
  keyUp() {
    if (!this.ready) return;
    const t = this.ctx.currentTime, g = this.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + 0.012);
  }
};

/* --------------------------------------------------------------- helpers */
function vibrate(ms) {
  if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} }
}

function enc(str) { return new TextEncoder().encode(str); }
function bufToHex(buf) {
  let s = '';
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}
async function hmac16(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc(message));
  return bufToHex(sig).slice(0, 16);
}

/* ------------------------------------------------------- cell / geo maths */
function stepFor(p) { return Math.pow(10, -p); }

function cellOf(lat, lon, p) {
  const st = stepFor(p);
  const qlat = Math.round(lat / st) * st;
  const qlon = Math.round(lon / st) * st;
  const fmt = v => p === 0 ? String(Math.round(v)) : v.toFixed(p);
  return fmt(qlat) + ',' + fmt(qlon);
}

/* centre cell + the 8 surrounding cells (boundary-overlap fix) */
function nineCells(lat, lon, p) {
  const st = stepFor(p), out = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      out.push(cellOf(lat + dy * st, lon + dx * st, p));
    }
  }
  return out;
}

/* ------------------------------------------------------------ mqtt layer */
function connectBroker() {
  if (!window.mqtt) {
    toast('Radio module failed to load');
    setStatus('error');
    return;
  }
  const url = BROKERS[S.broker % BROKERS.length];
  $('pwrMsg').textContent = 'CONNECTING ' + url.split('//')[1].split(':')[0].toUpperCase() + '…';

  const client = mqtt.connect(url, {
    clientId: 'tmcp_' + S.myId + '_' + Math.random().toString(16).slice(2, 8),
    clean: true,
    keepalive: 30,
    connectTimeout: 9000,
    reconnectPeriod: 5000,
    protocolVersion: 4
  });
  S.client = client;

  let failed = false;
  const bail = setTimeout(() => {
    if (!S.connected) { failed = true; try { client.end(true); } catch (e) {} failover(); }
  }, 11000);

  client.on('connect', () => {
    clearTimeout(bail);
    S.connected = true;
    S.applied = [];             // a fresh MQTT session - re-subscribe for real
    $('pwrMsg').textContent = 'LINK ESTABLISHED · ' + url.split('//')[1].split('/')[0];
    refreshStatus();
    resubscribe();
    toast('Airwaves open');
  });
  client.on('message', onMessage);
  client.on('error', () => { if (!S.connected) { failed = true; try { client.end(true); } catch (e) {} failover(); } });
  client.on('close', () => {
    S.applied = [];
    if (!S.connected) return;
    S.connected = false;
    refreshStatus();
  });
}

function failover() {
  if (!S.powered) return;
  S.broker++;
  if (S.broker > 4) {
    setStatus('error');
    $('pwrMsg').textContent = 'NO LINK — check your connection';
    toast('Could not reach the airwaves. Retrying…', 3600);
    S.broker = 0;
    setTimeout(() => { if (S.powered) connectBroker(); }, 9000);
    return;
  }
  toast('Switching relay…');
  connectBroker();
}

function publish(topic, obj) {
  if (!S.client || !S.connected) { toast('Not connected'); return; }
  obj.id = S.myId;
  obj.m = S.myId + '-' + (++S.msgSeq);
  try { S.client.publish(topic, JSON.stringify(obj), { qos: 0, retain: false }); } catch (e) {}
}

/* list = the topics we WANT. S.applied = the topics the broker has actually
   confirmed. They are kept apart so a request made before the socket is open is
   not mistaken for a completed subscription. */
function subscribe(list) {
  list = list.filter((v, i, a) => a.indexOf(v) === i);
  S.subs = list;
  if (!S.client || !S.connected) return;      // applied on the next 'connect'
  const fresh = list.filter(t => S.applied.indexOf(t) < 0);
  const gone = S.applied.filter(t => list.indexOf(t) < 0);
  if (gone.length && S.client.unsubscribe) { try { S.client.unsubscribe(gone); } catch (e) {} }
  if (fresh.length) {
    try {
      S.client.subscribe(fresh, { qos: 0 }, (err, granted) => {
        if (!err) S.applied = list.slice();
      });
    } catch (e) {}
  } else {
    S.applied = list.slice();
  }
}

function resubscribe() {
  if (!S.topic) { subscribe([]); return; }
  const list = [S.topic.sub].flat();
  subscribe(list.filter((v, i, a) => a.indexOf(v) === i));
}

/* ------------------------------------------------------------ tuning core */
function currentTopic() {
  if (S.tab === 'private') {
    return S.privTopic ? { pub: S.privTopic, sub: [S.privTopic] } : null;
  }
  const band = BANDS[S.band];
  if (band.prec === null) {
    return { pub: 'tmcp/global/band', sub: ['tmcp/global/band'] };
  }
  if (!S.geo) return null;
  const p = band.prec;
  const centre = cellOf(S.geo.lat, S.geo.lon, p);
  const subs = nineCells(S.geo.lat, S.geo.lon, p)
    .map(c => 'tmcp/local/' + p + '/' + c);
  // monitor: also listen on coarser bands so a nearby operator on a wider
  // setting is still audible
  for (let q = p - 1; q >= 0; q--) {
    subs.push('tmcp/local/' + q + '/' + cellOf(S.geo.lat, S.geo.lon, q));
  }
  return { pub: 'tmcp/local/' + p + '/' + centre, sub: subs };
}

function applyTuning() {
  const t = currentTopic();
  S.topic = t;
  if (!t) { subscribe([]); refreshStatus(); return; }
  resubscribe();
  refreshStatus();
}

/* --------------------------------------------------------------- receive */
const PULSE_CHAR = { '.': '•', '-': '—' };

function renderTape() {
  const el = $('tape');
  if (!S.pulses.length) { el.innerHTML = '<span class="idle">- No Signal -</span>'; return; }
  let html = '';
  const from = Math.max(0, S.pulses.length - 26);
  for (let i = from; i < S.pulses.length; i++) {
    const p = S.pulses[i];
    html += p === ' ' ? '<span class="sp">·</span>' : PULSE_CHAR[p];
  }
  el.innerHTML = html;
}

let tapeTimer = 0;
function pushPulse(ch) {
  S.pulses.push(ch);
  if (S.pulses.length > 90) S.pulses = S.pulses.slice(-60);
  renderTape();
  clearTimeout(tapeTimer);
  tapeTimer = setTimeout(() => {
    S.pulses = [];
    renderTape();
  }, 1400);
}

function appendText(str) {
  S.text += str;
  if (S.text.length > 600) S.text = S.text.slice(-450);
  const d = $('decoded');
  if (!S.text.trim()) { d.innerHTML = '<span class="ph">Incoming letters land here.</span>'; return; }
  d.innerHTML = escapeHtml(S.text);
  d.scrollTop = d.scrollHeight;
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function onMessage(topic, payload) {
  let o;
  try { o = JSON.parse(payload.toString()); } catch (e) { return; }
  if (!o || o.v !== 1) return;
  if (o.id === S.myId) return;                 // self echo
  if (o.m) {
    if (S.seen.indexOf(o.m) >= 0) return;      // duplicate
    S.seen.push(o.m);
    if (S.seen.length > 60) S.seen.shift();
  }
  if (o.t === 'L' && typeof o.s === 'string') receiveLetter(o.s);
  else if (o.t === 'W') receiveWord();
}

function receiveLetter(sym) {
  if (!/^[.\-]{1,4}$/.test(sym)) return;
  const syms = sym.split('');
  let t = Math.max(Audio.ctx ? Audio.ctx.currentTime + 0.02 : 0, S.rxFree);
  const start = t;

  syms.forEach((sy, i) => {
    const dur = sy === '.' ? DOT_MS : DASH_MS;
    if (!S.muted) Audio.beep(t, dur / 1000);
    const at = Math.round((t - start) * 1000);
    setTimeout(() => { pushPulse(sy); }, Math.max(0, at));
    setTimeout(() => { vibrate(dur); }, Math.max(0, at));
    t += (dur + GAP_MS) / 1000;
  });

  S.rxFree = t + GAP_MS / 1000;
  const ch = RMORSE[sym] || '?';
  setTimeout(() => { appendText(ch); }, Math.max(0, Math.round((t - start) * 1000)));
}

function receiveWord() {
  setTimeout(() => { appendText(' '); }, 0);
}

/* ---------------------------------------------------------- transmit flow */
function symbolString() {
  return S.txBuf;
}

/* render the symbols currently sitting in the morse box */
function renderMorseBox() {
  const box = $('morseBox');
  if (!box) return;
  if (!S.txBuf) { box.textContent = ''; return; }
  let h = '';
  for (const c of S.txBuf) h += c === '.' ? '•' : '—';
  box.textContent = h;
}

function appendSent(ch) {
  S.sent += ch;
  if (S.sent.length > 600) S.sent = S.sent.slice(-450);
  const el = $('sentText');
  if (!el) return;
  if (!S.sent.trim()) { el.innerHTML = '<span class="ph">Your text lands here.</span>'; return; }
  el.innerHTML = escapeHtml(S.sent);
  el.scrollTop = el.scrollHeight;
}

/* key a pulse into the morse box (no network yet) */
function addSymbol(sym) {
  if (!S.powered) return;
  if (!S.topic) { toast('Tune in first'); return; }
  if (S.txBuf.length >= 4) { toast('4 symbols max'); return; }
  S.txBuf += sym;
  renderMorseBox();
}

/* SEND button: commit the letter */
function sendLetter() {
  if (!S.txBuf) { toast('Key a letter first'); return; }
  const sym = S.txBuf;
  const ch = RMORSE[sym];
  clearMorseBox();
  if (!ch) { toast('Not a valid Morse letter'); return; }
  if (!S.topic) { toast('Tune in first'); return; }
  appendSent(ch);
  publish(S.topic.pub, { v: 1, t: 'L', s: sym });
}

function sendSpace() {
  if (!S.topic) { toast('Tune in first'); return; }
  if (!S.sent || S.sent.endsWith(' ')) return;
  appendSent(' ');
  publish(S.topic.pub, { v: 1, t: 'W' });
}

function clearMorseBox() {
  S.txBuf = '';
  renderMorseBox();
}

function backspaceSymbol() {
  if (!S.txBuf) return;
  S.txBuf = S.txBuf.slice(0, -1);
  renderMorseBox();
}

/* ------------------------------------------------------------ telegraph key */
let keyDownAt = 0, keyHeld = false;

function keyPress(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (!S.powered) return;
  if (!S.topic) { toast('Tune in first'); return; }
  keyHeld = true;
  keyDownAt = nowMs();
  $('keyBtn').classList.add('down');
  Audio.keyDown();
  if (navigator.vibrate) { try { navigator.vibrate(12); } catch (er) {} }
}
function keyRelease(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (!keyHeld) return;
  keyHeld = false;
  $('keyBtn').classList.remove('down');
  Audio.keyUp();
  const held = nowMs() - keyDownAt;
  addSymbol(held < KEY_THRESHOLD_MS ? '.' : '-');
}

/* ------------------------------------------------------------ sonic sync */
function sonicCodes() {
  // 6 significant digits, e.g. 4819.35
  let d = '';
  for (let i = 0; i < 6; i++) d += Math.floor(Math.random() * 10);
  return d;
}
function digitsToFreq(d) {
  return (parseInt(d.slice(0, 4), 10) + '.' + d.slice(4)).replace(/\.$/, '');
}

async function syncSend() {
  if (!Audio.init()) { toast('Audio unavailable'); return; }
  Audio.resume();
  const d = sonicCodes();
  const freq = digitsToFreq(d);
  $('freqIn').value = freq;
  const ctx = Audio.ctx, t0 = ctx.currentTime + 0.08;
  // 3800 Hz lead-in, then six 200 ms tones
  const lead = ctx.createOscillator(), lg = ctx.createGain();
  lead.type = 'sine'; lead.frequency.value = 3800;
  lg.gain.value = 0; lead.connect(lg); lg.connect(ctx.destination);
  lg.gain.setValueAtTime(0, t0);
  lg.gain.linearRampToValueAtTime(0.55, t0 + 0.01);
  lg.gain.setValueAtTime(0.55, t0 + 0.14);
  lg.gain.linearRampToValueAtTime(0, t0 + 0.15);
  lead.start(t0); lead.stop(t0 + 0.17);

  for (let i = 0; i < 6; i++) {
    const f = 1800 + parseInt(d[i], 10) * 200;
    const at = t0 + 0.15 + i * 0.2;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.55, at + 0.012);
    g.gain.setValueAtTime(0.55, at + 0.185);
    g.gain.linearRampToValueAtTime(0, at + 0.2);
    o.connect(g); g.connect(ctx.destination);
    o.start(at); o.stop(at + 0.22);
    o.onended = () => { try { o.disconnect(); g.disconnect(); } catch (e) {} };
  }
  $('syncMsg').textContent = 'SYNC : Sending ' + freq + '…';
  toast('Sending ' + freq + ' — hold your phone near the other one', 3400);
  setTimeout(() => {
    $('syncMsg').textContent = 'SYNC : Transmission sent.';
    toast('Frequency ' + freq + ' ready. Now type the passcode.');
  }, 1600);
}

let syncStream = null, syncCtx = null;

async function syncListen() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('Microphone not available'); return;
  }
  try {
    syncStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (e) {
    toast('Microphone permission denied'); return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  syncCtx = new AC();
  if (syncCtx.state === 'suspended') await syncCtx.resume();
  const src = syncCtx.createMediaStreamSource(syncStream);
  const an = syncCtx.createAnalyser();
  an.fftSize = 8192;
  an.smoothingTimeConstant = 0;
  src.connect(an);

  const bins = new Float32Array(an.frequencyBinCount);
  const binHz = syncCtx.sampleRate / an.fftSize;
  const samples = [];
  const t0 = performance.now();

  $('syncMsg').textContent = 'SYNC : Listening…';
  toast('Listening… play the tones', 3000);

  await new Promise(resolve => {
    const tick = () => {
      const elapsed = performance.now() - t0;
      if (elapsed > 4200) return resolve();
      an.getFloatFrequencyData(bins);
      let best = -Infinity, bestI = -1;
      const lo = Math.floor(1700 / binHz), hi = Math.ceil(3900 / binHz);
      for (let i = lo; i <= hi; i++) {
        if (bins[i] > best) { best = bins[i]; bestI = i; }
      }
      if (bestI > 0 && best > -78) samples.push({ t: elapsed, f: bestI * binHz, db: best });
      setTimeout(tick, 24);
    };
    tick();
  });

  stopSyncMic();

  const lead = samples.find(s => s.f >= 3700);
  if (!lead) { $('syncMsg').textContent = 'SYNC : No signal heard.'; toast('No signal heard. Try again, closer.', 3200); return; }
  const start = lead.t + 150;
  let digits = '';
  for (let k = 0; k < 6; k++) {
    const a = start + k * 200 + 35, b = a + 140;
    const seg = samples.filter(s => s.t >= a && s.t <= b && s.f < 3700);
    if (!seg.length) { digits = ''; break; }
    seg.sort((x, y) => y.db - x.db);
    const f = seg[0].f;
    const d = Math.round((f - 1800) / 200);
    if (d < 0 || d > 9) { digits = ''; break; }
    digits += d;
  }
  if (digits.length !== 6) { $('syncMsg').textContent = 'SYNC : Decode failed.'; toast('Could not decode cleanly. Try again.', 3200); return; }

  const freq = digitsToFreq(digits);
  $('freqIn').value = freq;
  S.freq = freq;
  $('syncMsg').textContent = 'SYNC : Locked onto ' + freq;
  toast('Locked onto ' + freq + ' — enter the passcode to open the channel', 4200);
  saveCfg();
}

function stopSyncMic() {
  if (syncStream) { syncStream.getTracks().forEach(t => t.stop()); syncStream = null; }
  if (syncCtx) { try { syncCtx.close(); } catch (e) {} syncCtx = null; }
}

/* --------------------------------------------------------------- geoloc */
function startGeo() {
  if (!navigator.geolocation) { $('geoMsg').textContent = 'GPS: Not Available'; return; }
  if (S.geoWatch != null) {
    // watch already running - just restore the label, never reset it to Acquiring
    if (S.geo) $('geoMsg').textContent = 'GPS lock · ±' + Math.round(S.geo.acc) + 'm';
    return;
  }
  $('geoMsg').textContent = 'GPS: Acquiring…';
  S.geoWatch = navigator.geolocation.watchPosition(pos => {
    const was = S.geo;
    S.geo = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy };
    $('geoMsg').textContent = 'GPS lock · ±' + Math.round(pos.coords.accuracy) + 'm';
    if (!was) { applyTuning(); updateLocalReadout(); return; }
    // hysteresis: only re-tune after the cell is stable for 2.5 s
    if (BANDS[S.band].prec === null) return;
    const p = BANDS[S.band].prec;
    const c = cellOf(S.geo.lat, S.geo.lon, p);
    if (c !== S.cell) {
      if (S.pendingCell !== c) {
        S.pendingCell = c;
        clearTimeout(S.cellTimer);
        S.cellTimer = setTimeout(() => {
          if (S.pendingCell) {
            S.cell = S.pendingCell;
            S.pendingCell = null;
            applyTuning();
            updateLocalReadout();
          }
        }, 2500);
      }
    }
  }, err => {
    const m = { 1: 'GPS: Permission Denied - use Private Band', 2: 'GPS: No Signal', 3: 'GPS: Timed Out' };
    $('geoMsg').textContent = m[err.code] || 'GPS: ERROR';
  }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
}

function updateLocalReadout() {
  const el = $('localFreq');
  if (!el) return;
  const band = BANDS[S.band];
  if (band.prec === null) { el.innerHTML = 'BAND 6 : <b>GLOBAL</b> · tmcp/global/band'; return; }
  if (!S.geo) { el.textContent = 'BAND ' + (S.band + 1) + ' : Waiting for GPS'; return; }
  el.innerHTML = 'BAND ' + (S.band + 1) + ' : <b>' + band.name + '</b> · '
    + cellOf(S.geo.lat, S.geo.lon, band.prec) + ' · 9-cell';
}

/* ------------------------------------------------------------- tuning UI */
function setTabUI() {
  const local = S.tab === 'local';
  $('tabLocal').setAttribute('aria-pressed', local ? 'true' : 'false');
  $('tabPrivate').setAttribute('aria-pressed', local ? 'false' : 'true');
  $('viewLocal').hidden = !local;
  $('viewPrivate').hidden = local;
}

async function tunePrivate() {
  const f = ($('freqIn').value || '').trim();
  const pass = ($('passIn').value || '').trim();
  if (!/^\d{1,7}(\.\d{1,4})?$/.test(f)) { toast('Frequency must be a number, e.g. 1627.92'); return; }
  if (pass.length < 4) { toast('Passcode must be at least 4 characters'); return; }
  S.freq = f; S.pass = pass;
  $('privRead').textContent = 'TUNER : Deriving key…';
  let h;
  try { h = await hmac16(pass, f); }
  catch (e) {
    $('privRead').textContent = 'TUNER : Encryption unavailable (needs HTTPS)';
    toast('This page needs HTTPS to derive the channel key', 3800);
    return;
  }
  S.privTopic = 'tmcp/private/' + h;
  $('privRead').innerHTML = 'TUNER : <b>' + f + '</b> · tmcp/private/' + h;
  S.tab = 'private';
  setTabUI();
  applyTuning();
  saveCfg();
  toast('Tuned to ' + f + ' — give your friend the frequency and passcode');
}

function saveCfg() {
  try {
    localStorage.setItem('tmcp.cfg', JSON.stringify({
      freq: S.freq, pass: S.pass, band: S.band, tab: S.tab, muted: S.muted,
      powered: S.powered
    }));
  } catch (e) {}
}

/* returns true when the previous session was on air and should be resumed */
function loadCfg() {
  try {
    const c = JSON.parse(localStorage.getItem('tmcp.cfg') || '{}');
    if (c.freq) { S.freq = c.freq; }
    if (c.pass) { S.pass = c.pass; }
    if (typeof c.band === 'number' && c.band >= 0 && c.band < BANDS.length) S.band = c.band;
    if (c.tab) S.tab = c.tab;
    if (c.muted) S.muted = true;
    return c.powered === true;
  } catch (e) { return false; }
}

/* the tuning dial: a ruler slider.
   Uniform 22px pitch, tall checkpoint line every 4th, the scale glides under a
   fixed centre marker and snaps to the band checkpoints. */
const TICK_GAP    = 22;   // px between two consecutive lines - never varies
const TICK_STRIDE = 4;    // lines per band step (1 tall + 3 short)
const TICK_TALL   = 22;   // height of a checkpoint line
const TICK_SHORT  = 11;   // height of an in-between line
const TICK_MID    = 61;   // strip height, lines are vertically centred in it
const TICK_OVER   = 0;    // the ruler ends exactly at Whisper and at Global

const BAND_STEP = TICK_GAP * TICK_STRIDE;   // px of drag per band

function buildDial() {
  const strip = $('dialScroll');
  if (!strip || strip.childElementCount) return;
  const last = (BANDS.length - 1) * TICK_STRIDE;
  for (let k = -TICK_OVER; k <= last + TICK_OVER; k++) {
    const tall = k % TICK_STRIDE === 0 && k >= 0 && k <= last;
    const h = tall ? TICK_TALL : TICK_SHORT;
    const i = document.createElement('i');
    i.style.left = (k * TICK_GAP) + 'px';
    i.style.width = TICK_GAP + 'px';
    i.dataset.k = String(k);
    const ln = document.createElement('b');
    ln.style.height = h + 'px';
    ln.style.top = ((TICK_MID - h) / 2) + 'px';
    i.appendChild(ln);
    strip.appendChild(i);
  }
  stickDial();
}

function bandTick(i) {
  const strip = $('dialScroll');
  if (!strip) return null;
  return strip.querySelector('i[data-k="' + (i * TICK_STRIDE) + '"]');
}

/* drag / keyboard. The strip glides continuously under the needle; on release
   it settles onto the nearest checkpoint. */
let lastNearest = null;

function dialOffsetFor(band) {
  const strip = $('dialScroll'), wrap = strip && strip.parentElement;
  const tick = bandTick(band);
  if (!strip || !wrap || !tick || !wrap.clientWidth) return null;
  return wrap.clientWidth / 2 - (tick.offsetLeft + tick.offsetWidth / 2);
}

function glideTo(px) {
  const strip = $('dialScroll');
  if (strip) strip.style.transform = 'translateX(' + px + 'px)';
}

function stickDial() {
  const strip = $('dialScroll');
  if (!strip || strip.dataset.wired) return;
  strip.dataset.wired = '1';
  let startX = 0, baseX = 0, zeroX = 0, dragging = false;

  strip.addEventListener('pointerdown', e => {
    const off = dialOffsetFor(S.band);
    const zero = dialOffsetFor(0);
    if (off === null || zero === null) return;
    dragging = true; startX = e.clientX; baseX = off; zeroX = zero;
    strip.classList.add('dragging');
    try { strip.setPointerCapture(e.pointerId); } catch (err) {}
  });

  strip.addEventListener('pointermove', e => {
    if (!dragging) return;
    const off = baseX + (e.clientX - startX);
    glideTo(off);
    const nearest = Math.min(BANDS.length - 1, Math.max(0,
      Math.round((zeroX - off) / BAND_STEP)));
    if (nearest !== lastNearest) {
      lastNearest = nearest;
      readDial(nearest);
      if (navigator.vibrate) { try { navigator.vibrate(8); } catch (err) {} }
    }
  });

  const end = () => {
    if (!dragging) return;
    dragging = false;
    strip.classList.remove('dragging');
    if (lastNearest !== null && lastNearest !== S.band) setBand(lastNearest);
    else renderDial();
    lastNearest = null;
  };
  strip.addEventListener('pointerup', end);
  strip.addEventListener('pointercancel', end);

  strip.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft')  { setBand(Math.max(0, S.band - 1)); e.preventDefault(); }
    if (e.key === 'ArrowRight') { setBand(Math.min(BANDS.length - 1, S.band + 1)); e.preventDefault(); }
  });
}

/* label the band under the needle without committing it */
function readDial(i) {
  const band = BANDS[i];
  if (!band) return;
  $('dialTop').textContent = band.dist;
  $('dialName').textContent = band.name;
  const prev = BANDS[i - 1], next = BANDS[i + 1];
  $('dialLeft').textContent = prev ? prev.dist : '';
  $('dialRight').textContent = next ? next.dist : '';
}

function setBand(i) {
  S.band = i;
  renderDial();
  if (S.powered) { if (BANDS[i].prec === null || S.geo) startGeo(); applyTuning(); }
  updateLocalReadout();
  saveCfg();
}

function renderDial() {
  buildDial();
  const i = S.band;
  const band = BANDS[i];
  const strip = $('dialScroll');
  const off = dialOffsetFor(i);
  if (strip && off !== null) {
    glideTo(off);
    strip.setAttribute('aria-valuenow', String(i + 1));
    strip.setAttribute('aria-valuetext', band.name + ' ' + band.dist);
  }
  readDial(i);
}

/* --------------------------------------------------------------- power on */
function showScreen(name) {
  S.screen = name;
  $('screenWelcome').hidden = name !== 'welcome';
  $('screenHome').hidden = name !== 'home';
  $('screenTune').hidden = name !== 'tune';
  if (window.scrollTo) window.scrollTo(0, 0);
}

function powerOn() {
  if (S.powered) { showScreen('home'); return; }
  S.powered = true;
  Audio.init();
  Audio.resume();
  $('pwrMsg').textContent = 'WARMING UP…';
  showScreen('home');
  setStatus('error');
  connectBroker();
  if (S.tab === 'local') { startGeo(); updateLocalReadout(); }
  // restore a saved private channel automatically
  if (S.freq && S.pass) {
    hmac16(S.pass, S.freq).then(h => {
      S.privTopic = 'tmcp/private/' + h;
      $('privRead').innerHTML = 'TUNER : <b>' + S.freq + '</b> · tmcp/private/' + S.privTopic.split('/').pop();
      if (S.tab === 'private') applyTuning();
      saveCfg();
    }).catch(() => {});
  }
  saveCfg();                    // remember that the radio is on, so a reload resumes it
}

function powerOff() {
  S.powered = false;
  saveCfg();                    // the session is over - a reload must land on Welcome
  $('pwrMsg').textContent = 'RADIO IS OFF';
  showScreen('welcome');
  S.text = '';
  renderTape();
  if ($('decoded')) $('decoded').innerHTML = '<span class="ph">Incoming letters land here.</span>';
  if (S.client) { try { S.client.end(true); } catch (e) {} S.client = null; }
  S.connected = false;
  S.topic = null;
  S.subs = [];
  S.applied = [];
  if (S.geoWatch != null && navigator.geolocation) {
    navigator.geolocation.clearWatch(S.geoWatch); S.geoWatch = null;
  }
  stopSyncMic();
  setStatus('offline');
}

/* --------------------------------------------------------------- wiring */
function wire() {
  /* welcome → home */
  $('powerBtn').addEventListener('click', powerOn);

  /* home → tuner */
  $('openTune').addEventListener('click', () => {
    if (!S.powered) { toast('Power on first'); return; }
    showScreen('tune');
    renderDial();               // the strip has no width until the screen is visible
    if (S.tab === 'local') { startGeo(); updateLocalReadout(); }
  });
  $('backBtn').addEventListener('click', () => {
    showScreen('home');
    renderDial();
  });

  /* tuner tabs */
  $('tabLocal').addEventListener('click', () => {
    S.tab = 'local'; setTabUI();
    if (S.powered) { startGeo(); applyTuning(); updateLocalReadout(); }
    saveCfg();
  });
  $('tabPrivate').addEventListener('click', () => {
    S.tab = 'private'; setTabUI();
    if (S.powered) applyTuning();
    saveCfg();
  });

  $('tuneBtn').addEventListener('click', tunePrivate);
  $('syncTx').addEventListener('click', syncSend);
  $('syncRx').addEventListener('click', syncListen);
  $('powerOffBtn').addEventListener('click', powerOff);

  /* morse panel */
  $('sendBtn').addEventListener('click', sendLetter);
  $('spaceBtn').addEventListener('click', sendSpace);
  $('backspaceBtn').addEventListener('click', backspaceSymbol);

  /* telegraph key */
  const kb = $('keyBtn');
  kb.addEventListener('pointerdown', keyPress);
  kb.addEventListener('pointerup', keyRelease);
  kb.addEventListener('pointercancel', keyRelease);
  kb.addEventListener('pointerleave', keyRelease);
  kb.addEventListener('contextmenu', e => e.preventDefault());

  /* mute */
  $('muteBtn').addEventListener('click', () => {
    S.muted = !S.muted;
    $('muteBtn').setAttribute('aria-pressed', S.muted ? 'true' : 'false');
    toast(S.muted ? 'Receive audio muted' : 'Receive audio on');
    saveCfg();
  });

  /* clear: transmitter */
  $('clearBtn').addEventListener('click', () => {
    S.sent = ''; S.txBuf = '';
    renderMorseBox();
    $('sentText').innerHTML = '<span class="ph">Your text lands here.</span>';
  });

  /* clear: receiver - wipes what came in, leaves what you sent */
  $('clearRxBtn').addEventListener('click', () => {
    S.text = ''; S.pulses = [];
    clearTimeout(tapeTimer);
    renderTape();
    $('decoded').innerHTML = '<span class="ph">Incoming letters land here.</span>';
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) Audio.resume();
  });
}

/* ------------------------------------------------------------------ boot */
function boot() {
  const resume = loadCfg();
  wire();
  if (S.freq) $('freqIn').value = S.freq;
  if (S.pass) $('passIn').value = S.pass;
  setTabUI();
  updateLocalReadout();
  renderDial();
  renderMorseBox();
  setStatus('offline');
  if (resume) {
    // the radio was on air before the reload - come straight back to the same channel
    S.powered = false;          // so powerOn() does not early-return
    showScreen('welcome');      // set the baseline, powerOn() switches to Home
    powerOn();
    // browsers hold audio until a gesture; re-arm it silently on the first touch
    const rearm = () => {
      Audio.resume();
      document.removeEventListener('pointerdown', rearm, true);
      document.removeEventListener('keydown', rearm, true);
    };
    document.addEventListener('pointerdown', rearm, true);
    document.addEventListener('keydown', rearm, true);
  } else {
    showScreen('welcome');
  }
}
document.addEventListener('DOMContentLoaded', boot);
