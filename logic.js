// PAIR CARRY の決まりごと。画面（DOM）に触らない部分をここに集める。
// main.js（ブラウザ）と test.mjs（node）の両方から読む。
//
// 盤は縦 rows × 横 cols のマス。cells[r * cols + c] = 0（空き）/ 1（黒）/ 2（白）。1 列は rows = 1。
// 1 手 = となり合う 2 個（もと石 a・相方 b）を持ち上げ、もと石をマス p へ、相方を p + 向き へ置く。
// 持ち上げた 2 マスは置くまで「石がある」扱い。1 列は向きそのまま、市松は 90° ずつ回して置ける。

export const EMPTY = 0, BLACK = 1, WHITE = 2;

// ステージ。石は h × w の市松（左上が黒）で、盤の (r0, c0) から置く。
// min = 最少手数（test.mjs で探索して確かめる）。
// 公開したあとで変えない（記録と最少が合わなくなる）
export const STAGES = [
  { rows: 1, cols: 14, h: 1, w: 6, r0: 0, c0: 4, min: 3 },
  { rows: 1, cols: 12, h: 1, w: 8, r0: 0, c0: 2, min: 4 },
  { rows: 1, cols: 10, h: 1, w: 8, r0: 0, c0: 2, min: 4 },
  { rows: 1, cols: 14, h: 1, w: 10, r0: 0, c0: 2, min: 5 },
  { rows: 1, cols: 12, h: 1, w: 10, r0: 0, c0: 2, min: 5 },
  { rows: 1, cols: 16, h: 1, w: 12, r0: 0, c0: 2, min: 6 },
  { rows: 1, cols: 14, h: 1, w: 12, r0: 0, c0: 2, min: 6 },
  { rows: 1, cols: 16, h: 1, w: 14, r0: 0, c0: 2, min: 7 },
  { rows: 4, cols: 4, h: 2, w: 2, r0: 1, c0: 1, min: 1 },
  { rows: 8, cols: 8, h: 4, w: 4, r0: 2, c0: 2, min: 7 },
].map((s, i) => ({ n: i + 1, ...s, grid: s.rows > 1, label: s.rows > 1 ? `${s.h}×${s.w}` : `${s.w / 2}組` }));

export const DEFAULT_SETTINGS = { v: 1, sound: true };

// はじめの盤
export function startCells(s) {
  const cells = new Array(s.rows * s.cols).fill(EMPTY);
  for (let r = 0; r < s.h; r++) {
    for (let c = 0; c < s.w; c++) cells[(s.r0 + r) * s.cols + s.c0 + c] = (r + c) % 2 ? WHITE : BLACK;
  }
  return cells;
}

// 上下左右の向き（右・下・左・上。右回りの順）
export const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];

// マス i から向き d のとなり。盤の外なら -1
export function step(rows, cols, i, d) {
  const r = Math.floor(i / cols) + DIRS[d][0], c = i % cols + DIRS[d][1];
  return r < 0 || r >= rows || c < 0 || c >= cols ? -1 : r * cols + c;
}

// もと石を p に、相方を p の d 向きのとなりに置けるか（2 マスとも空き。持ち上げた石のマスは空きではない）
export function canPlace(cells, rows, cols, p, d) {
  const q = step(rows, cols, p, d);
  return q >= 0 && cells[p] === EMPTY && cells[q] === EMPTY;
}

// 置く。cells を書き換える
export function move(cells, rows, cols, a, b, p, d) {
  const q = step(rows, cols, p, d);
  const ca = cells[a], cb = cells[b];
  cells[a] = cells[b] = EMPTY;
  cells[p] = ca;
  cells[q] = cb;
}

// 分かれたか: 石がすき間なく h × w の長方形に入り（市松は正方形なので向きは同じ）、上下か左右の半分で色が分かれている
export function isClear(cells, s) {
  let r1 = s.rows, r2 = -1, c1 = s.cols, c2 = -1, count = 0;
  cells.forEach((v, i) => {
    if (!v) return;
    count++;
    const r = Math.floor(i / s.cols), c = i % s.cols;
    r1 = Math.min(r1, r); r2 = Math.max(r2, r); c1 = Math.min(c1, c); c2 = Math.max(c2, c);
  });
  if (r2 - r1 + 1 !== s.h || c2 - c1 + 1 !== s.w || count !== s.h * s.w) return false;
  const at = (r, c) => cells[(r1 + r) * s.cols + c1 + c];
  // half(r, c) = そのマスがどちらの半分か。片方の半分がぜんぶ同じ色で、もう片方がその反対ならよい
  const split = (half) => {
    const color = [0, 0];
    for (let r = 0; r < s.h; r++) {
      for (let c = 0; c < s.w; c++) {
        const k = half(r, c), v = at(r, c);
        if (color[k] && color[k] !== v) return false;
        color[k] = v;
      }
    }
    return color[0] !== color[1];
  };
  return (s.w % 2 === 0 && split((r, c) => +(c >= s.w / 2))) || (s.h % 2 === 0 && split((r) => +(r >= s.h / 2)));
}

// 今の盤からの 1 手をすべて返す: [a, b, p, d]（a・b は持ち上げる 2 マス、組は a → b の向きのまま、または回して置く）
// 同じ組を逆向き（b をもと石）に選んでも置いた結果は同じなので、a < b だけ返す。
export function moves(cells, s) {
  const out = [];
  const { rows, cols } = s;
  for (let a = 0; a < cells.length; a++) {
    if (!cells[a]) continue;
    for (const e of [0, 1]) {          // 右と下のとなりだけ見れば、組はすべて 1 回ずつ出る
      const b = step(rows, cols, a, e);
      if (b < 0 || !cells[b]) continue;
      const ds = s.grid ? [0, 1, 2, 3] : [e];
      for (let p = 0; p < cells.length; p++) {
        for (const d of ds) if (canPlace(cells, rows, cols, p, d)) out.push([a, b, p, d]);
      }
    }
  }
  return out;
}

// ---- 保存 ----

// 読んだ設定を確かめる。壊れた値ははじめの値に戻す。
export function readSettings(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return { ...DEFAULT_SETTINGS };
  return { v: 1, sound: raw.sound !== false };
}

// 記録: best[ステージ番号] = クリアしたときの手数の最少。範囲外のステージや壊れた値は捨てる
export function readProgress(raw) {
  const best = {};
  if (raw && raw.v === 1 && raw.best && typeof raw.best === 'object') {
    for (const [k, m] of Object.entries(raw.best)) {
      if (/^\d+$/.test(k) && +k >= 1 && +k <= STAGES.length && Number.isInteger(m) && m > 0) best[k] = m;
    }
  }
  return { v: 1, best };
}

// クリアした手数を記録に入れる。記録を更新したら true
export function addRecord(progress, n, moves) {
  const old = progress.best[n];
  if (old != null && old <= moves) return false;
  progress.best[n] = moves;
  return true;
}

// ステージの状態: 'new'（まだ）/ 'clear'（クリア）/ 'best'（最少でクリア）
export function stageState(progress, s) {
  const m = progress.best[s.n];
  return m == null ? 'new' : m <= s.min ? 'best' : 'clear';
}

// つづきから: まだクリアしていない最初のステージ。全部クリア済みならステージ 1
export function nextUnclear(progress) {
  for (let n = 1; n <= STAGES.length; n++) if (progress.best[n] == null) return n;
  return 1;
}
