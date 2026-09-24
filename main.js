import * as L from './logic.js';

// localStorage はほかのアプリと共有される（同じ t-of.github.io のため）。
// キーは必ず 'pair-carry.' で始める。
const STORE = 'pair-carry.';

function load(key, fallback) {
  try {
    const v = localStorage.getItem(STORE + key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* 保存できなくても遊べる */ }
}

WebAppKit.init({ title: 'PAIR CARRY', text: '黒と白が交互に並んだ碁石を、となり合う 2 個ずつ空いた所へ動かして、黒と白に分けるパズル。組が増えるほど、どこから崩すかが難しくなる。1 列と市松の盤。' });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

// ---- 設定と記録 ----

const settings = L.readSettings(load('settings', null));
const progress = L.readProgress(load('progress', null));

// ---- 音（Web Audio で作る。ファイルは使わない） ----

// iPhone のマナーモードでも鳴らす（Safari 16.4 以降）。
// 'playback' にすると音楽アプリの曲が止まるので、アプリの音がオンのときだけにする。
function setAudioSession(soundOn) {
  try { if (navigator.audioSession) navigator.audioSession.type = soundOn ? 'playback' : 'auto'; } catch { /* 対応していない */ }
}
setAudioSession(settings.sound);

let actx = null;
function ctx() {
  setAudioSession(true);
  actx ||= new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function envelope(ac, t, gain, dur) {
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(ac.destination);
  return g;
}
function tone(freq, { dur = 0.12, type = 'sine', gain = 0.06, delay = 0 } = {}) {
  if (!settings.sound) return;
  try {
    const ac = ctx(), t = ac.currentTime + delay;
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(envelope(ac, t, gain, dur));
    o.start(t);
    o.stop(t + dur + 0.02);
  } catch { /* 音が出せなくても遊べる */ }
}
// 石を打つ音の「カ」の部分（短いノイズを、決めた高さのあたりだけ通す）
function click(gain, freq) {
  if (!settings.sound) return;
  try {
    const ac = ctx(), t = ac.currentTime;
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.03), ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ac.createBufferSource(), f = ac.createBiquadFilter();
    src.buffer = buf;
    f.type = 'bandpass';
    f.frequency.value = freq;
    src.connect(f).connect(envelope(ac, t, gain, 0.03));
    src.start(t);
  } catch { /* 音が出せなくても遊べる */ }
}
const sfx = {
  tap: () => tone(660, { dur: 0.05, type: 'triangle', gain: 0.04 }),
  lift: () => tone(1400, { dur: 0.03, type: 'triangle', gain: 0.04 }),
  place: () => { click(0.35, 3200); tone(320, { dur: 0.06, type: 'triangle', gain: 0.06 }); },
  undo: () => { click(0.25, 2200); tone(240, { dur: 0.06, type: 'triangle', gain: 0.05 }); },
  no: () => tone(130, { dur: 0.08, type: 'square', gain: 0.025 }),
  rotate: () => click(0.15, 5000),
  clear: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, { dur: 0.4, type: 'triangle', gain: 0.07, delay: 0.05 + i * 0.11 })),
  extra: () => tone(1568, { dur: 0.45, type: 'triangle', gain: 0.06, delay: 0.6 }),       // 最少・記録更新のとき、クリアの音のあとに
};

// ---- 盤の描き方 ----

// マス（くぼみ）と石を作る。石は動かすときに滑らせるので、マスとは別に持つ。返す配列の [i] = マス i の石（なければ null）
function buildBoard(el, s, cells) {
  let html = '';
  for (let i = 0; i < s.rows * s.cols; i++) {
    html += `<div class="hole" style="--r:${Math.floor(i / s.cols)};--c:${i % s.cols}"></div>`;
  }
  el.style.setProperty('--rows', s.rows);
  el.style.setProperty('--cols', s.cols);
  el.innerHTML = html;
  return cells.map((v, i) => {
    if (!v) return null;
    const st = document.createElement('div');
    st.className = `stone ${v === L.BLACK ? 'black' : 'white'}`;
    st.innerHTML = '<b></b><i></i>';
    el.append(st);
    putStone(st, s.cols, i);
    return st;
  });
}
function putStone(st, cols, i) {
  st.style.setProperty('--r', Math.floor(i / cols));
  st.style.setProperty('--c', i % cols);
}

// ---- タイトル ----

const $ = (id) => document.getElementById(id);
const titleEl = $('title'), playEl = $('play'), clearEl = $('clear');

function show(screen) {
  titleEl.hidden = screen !== titleEl;
  playEl.hidden = screen !== playEl;
}

// 見本: 1 列の黒白 6 個
{
  const s = { rows: 1, cols: 6, h: 1, w: 6, r0: 0, c0: 0 };
  buildBoard($('sample'), s, L.startCells(s));
}

const STATE_TEXT = { new: 'まだ', clear: 'クリア', best: '最少' };
const stageButton = (s) =>
  `<button class="stg" data-n="${s.n}"><span class="stg__n">${s.n}</span><span class="stg__size">${s.label}</span><span class="stg__state"></span></button>`;
$('stages-line').innerHTML = L.STAGES.filter((s) => !s.grid).map(stageButton).join('');
$('stages-grid').innerHTML = L.STAGES.filter((s) => s.grid).map(stageButton).join('');
const stageButtons = titleEl.querySelectorAll('.stg');

function renderTitle() {
  for (const b of stageButtons) {
    const s = L.STAGES[b.dataset.n - 1];
    const st = L.stageState(progress, s);
    b.dataset.state = st;
    b.lastChild.textContent = STATE_TEXT[st];
    b.setAttribute('aria-label', `ステージ ${s.n}、${s.label}、${STATE_TEXT[st]}`);
  }
  $('continue-btn').textContent = `つづきから（ステージ ${L.nextUnclear(progress)}）`;
  const snd = $('sound-btn');
  snd.textContent = settings.sound ? '音 オン' : '音 オフ';
  snd.setAttribute('aria-pressed', String(settings.sound));
}

titleEl.querySelector('.pick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-n]');
  if (b) play(+b.dataset.n);
});
$('continue-btn').addEventListener('click', () => play(L.nextUnclear(progress)));

$('sound-btn').addEventListener('click', () => {
  settings.sound = !settings.sound;
  setAudioSession(settings.sound);
  save('settings', settings);
  sfx.tap();
  renderTitle();
});

// ---- 遊ぶ ----

const boardEl = $('board'), stageEl = $('stage'), rotateBtn = $('rotate-btn');
let game = null;
let clearLockUntil = 0;

function play(n) {
  sfx.tap();
  show(playEl);
  const s = L.STAGES[n - 1];
  game = { s, cells: null, stones: null, history: [], held: null, done: false };
  $('stage-name').textContent = `ステージ ${n}（${s.label}）`;
  $('min').textContent = `最少 ${s.min}`;
  rotateBtn.hidden = !s.grid;
  boardEl.classList.toggle('line', !s.grid);
  fit();          // 石を作る前にマスの大きさを決める（あとで変えると石がすべって見える）
  restart();
}

// はじめから: はじめの並びに戻す（滑らせずにすぐ。石を作り直す）
function restart() {
  game.cells = L.startCells(game.s);
  game.stones = buildBoard(boardEl, game.s, game.cells);
  game.history = [];
  game.held = null;
  game.done = false;
  clearEl.hidden = true;
  playEl.classList.remove('cleared');
  render();
}

// 1 マスの大きさ: 幅（最大 480px）と、上下の表示を除いた高さの両方に収まるように。1 列は 48px まで
function fit() {
  if (!game || playEl.hidden) return;
  const { rows, cols, grid } = game.s;
  const w = Math.min(stageEl.clientWidth, 480) / cols;
  const h = (stageEl.clientHeight - (grid ? rotateBtn.offsetHeight + 16 : 0)) / rows;
  boardEl.style.setProperty('--s', `${Math.max(16, Math.floor(Math.min(grid ? 72 : 48, w, h)))}px`);
}
new ResizeObserver(fit).observe(stageEl);

// 手数・持っている石・置ける所・ボタンを描き直す
function render() {
  const { s, cells, stones, held } = game;
  $('moves').textContent = game.history.length;
  for (const st of stones) st?.classList.remove('held', 'base');
  boardEl.querySelectorAll('.hole').forEach((h, i) =>
    h.classList.toggle('can', !!held && L.canPlace(cells, s.rows, s.cols, i, held.d)));
  if (held) {
    stones[held.a].classList.add('held', 'base');
    stones[held.a].style.setProperty('--d', held.d);
    stones[held.b].classList.add('held');
  }
  rotateBtn.disabled = !held;
  $('undo-btn').disabled = !game.history.length || game.done;
}

// タップした点 → マスの番号と、盤の上の位置（マス単位）、マスの中心からのずれ
function cellAt(e) {
  const r = boardEl.getBoundingClientRect();
  const size = r.width / game.s.cols;
  const x = (e.clientX - r.left) / size, y = (e.clientY - r.top) / size;
  // 1 列は盤の上下 1 マス分も押せる（.board.line::before）。はみ出した分はいちばん近いマスにする
  const c = Math.min(game.s.cols - 1, Math.max(0, Math.floor(x))), row = Math.min(game.s.rows - 1, Math.max(0, Math.floor(y)));
  return { i: row * game.s.cols + c, x, y, dx: x - c - 0.5, dy: y - row - 0.5 };
}

function shake(i) {
  const st = game.stones[i];
  st.classList.remove('shake');
  void st.offsetWidth;          // 続けて押しても震わせ直す
  st.classList.add('shake');
}
boardEl.addEventListener('animationend', (e) => e.target.closest('.stone')?.classList.remove('shake'));

boardEl.addEventListener('click', (e) => {
  if (!game || game.done) return;
  const t = cellAt(e);
  const { s, cells, held } = game;
  if (cells[t.i]) {
    if (held && (t.i === held.a || t.i === held.b)) { game.held = null; sfx.tap(); render(); return; }
    // 相方: タップした点がもと石の中心からずれた向きに近いとなり（石がなければ次に近い向き）
    const toward = (k) => t.dx * L.DIRS[k][1] + t.dy * L.DIRS[k][0];
    const order = [0, 1, 2, 3].sort((p, q) => toward(q) - toward(p));
    const d = order.find((k) => { const j = L.step(s.rows, s.cols, t.i, k); return j >= 0 && cells[j]; });
    if (d == null) { sfx.no(); shake(t.i); return; }
    game.held = { a: t.i, b: L.step(s.rows, s.cols, t.i, d), d };
    sfx.lift();
    render();
    return;
  }
  if (!held) return;
  // 置く所: タップしたマス。置けなければ、となり 1 マス以内で置ける所のうちタップした点にいちばん近いマス
  let p = -1, best = Infinity;
  const r0 = Math.floor(t.i / s.cols), c0 = t.i % s.cols;
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      if (r < 0 || r >= s.rows || c < 0 || c >= s.cols) continue;
      const i = r * s.cols + c;
      const dist = i === t.i ? -1 : (c + 0.5 - t.x) ** 2 + (r + 0.5 - t.y) ** 2;
      if (dist < best && L.canPlace(cells, s.rows, s.cols, i, held.d)) { p = i; best = dist; }
    }
  }
  if (p < 0) { sfx.no(); return; }
  const q = L.step(s.rows, s.cols, p, held.d);
  L.move(cells, s.rows, s.cols, held.a, held.b, p, held.d);
  moveStones([[held.a, p], [held.b, q]]);
  game.history.push({ a: held.a, b: held.b, p, q });
  game.held = null;
  sfx.place();
  render();
  if (L.isClear(cells, s)) finish();
});

// 石を [もとのマス, 行き先] のとおりに動かす（2 個いっしょに。行き先がもう片方のもとのマスでも壊れないように先に外す）
function moveStones(pairs) {
  const els = pairs.map(([from]) => game.stones[from]);
  for (const [from] of pairs) game.stones[from] = null;
  pairs.forEach(([, to], k) => { game.stones[to] = els[k]; putStone(els[k], game.s.cols, to); });
}

rotateBtn.addEventListener('click', () => {
  if (!game.held || game.done) return;
  game.held.d = (game.held.d + 1) % 4;
  sfx.rotate();
  render();
});

$('undo-btn').addEventListener('click', () => {
  if (game.done) return;
  const m = game.history.pop();
  if (!m) return;
  const { cells } = game;
  const [cp, cq] = [cells[m.p], cells[m.q]];
  cells[m.p] = cells[m.q] = L.EMPTY;
  cells[m.a] = cp;
  cells[m.b] = cq;
  moveStones([[m.p, m.a], [m.q, m.b]]);
  game.held = null;
  sfx.undo();
  render();
});

function finish() {
  const { s } = game;
  const moves = game.history.length;
  game.done = true;
  render();
  sfx.clear();
  const record = L.addRecord(progress, s.n, moves);
  if (record) save('progress', progress);
  const best = moves <= s.min;
  if (best || record) sfx.extra();
  $('clear-moves').textContent = moves;
  $('clear-min').textContent = s.min;
  const badges = [best ? '最少で分けた' : `あと ${moves - s.min} 手少なくできる`];
  if (record) badges.push('記録更新');
  $('badges').innerHTML = badges.map((t) => `<span class="badge">${t}</span>`).join('');
  $('next-btn').hidden = s.n === L.STAGES.length;
  clearEl.hidden = false;
  playEl.classList.add('cleared');
  // 出た直後の 0.4 秒は押せない（最後に置いた勢いで次のボタンを押さないように）
  clearLockUntil = performance.now() + 400;
  clearEl.classList.add('locked');
  setTimeout(() => clearEl.classList.remove('locked'), 400);
}

const unlocked = () => performance.now() >= clearLockUntil;

function toTitle() {
  sfx.tap();
  show(titleEl);
  renderTitle();
}

$('back-btn').addEventListener('click', toTitle);
$('reset-btn').addEventListener('click', () => { sfx.tap(); restart(); });
$('next-btn').addEventListener('click', () => { if (unlocked()) play(game.s.n + 1); });
$('again-btn').addEventListener('click', () => { if (unlocked()) { sfx.tap(); restart(); } });
$('home-btn').addEventListener('click', () => { if (unlocked()) toTitle(); });
$('share-btn').addEventListener('click', () => {
  if (!unlocked()) return;
  const { s } = game, moves = game.history.length;
  WebAppKit.share({ text: `PAIR CARRY ステージ ${s.n}（${s.label}）を ${moves} 手で分けた（最少 ${s.min} 手）` });
});

renderTitle();
