// node test.mjs — 画面を使わない部分のテスト（動かす・クリア判定・最少手数・ステージ・保存）
import assert from 'node:assert/strict';
import * as L from './logic.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`ok ${name}`); };

const B = L.BLACK, W = L.WHITE, _ = L.EMPTY;
const line = (str) => [...str].map((ch) => ({ '.': _, b: B, w: W })[ch]);
const S = (rows, cols, h, w) => ({ rows, cols, h, w, grid: rows > 1 });

// はじめの盤から幅優先で 1 手ずつ広げ、はじめてクリアの形が出た手数を返す（その手数より少ない並びはすべて調べている）。
// クリアできなければ、たどり着ける並びをすべて調べて null
function bfs(s, start = L.startCells(s)) {
  const seen = new Set([start.join('')]);
  let front = [start];
  for (let d = 1; front.length; d++) {
    const next = [];
    for (const c of front) {
      for (const [a, b, p, dir] of L.moves(c, s)) {
        const x = c.slice();
        L.move(x, s.rows, s.cols, a, b, p, dir);
        if (L.isClear(x, s)) return d;
        const key = x.join('');
        if (!seen.has(key)) { seen.add(key); next.push(x); }
      }
    }
    front = next;
  }
  return null;
}

// 市松の大きい盤用: bound 手以内で分けられるか（IDA* の 1 回分）。
// クリアの形（h × w の置き場所 × 上下か左右 × 色）ごとに、正しい所にない石の数 wrong を数える。
// 1 手で動くのは 2 個なので、あと ceil(wrong / 2) 手より早くは終わらない → 超える手は調べない。
// となり合う 2 手が別々のマスしか触らないときは、順番を入れ替えても同じなので番号の小さい順だけ調べる。
function solvableWithin(s, bound) {
  const { rows, cols } = s, N = rows * cols;
  const cells = L.startCells(s);
  const nb = (i, d) => L.step(rows, cols, i, d);
  const targets = [];
  for (let r0 = 0; r0 + s.h <= rows; r0++) {
    for (let c0 = 0; c0 + s.w <= cols; c0++) {
      for (const vertical of [false, true]) {
        for (const first of [B, W]) {
          const t = new Array(N).fill(_);
          for (let r = 0; r < s.h; r++) {
            for (let c = 0; c < s.w; c++) {
              t[(r0 + r) * cols + c0 + c] = (vertical ? r >= s.h / 2 : c >= s.w / 2) ? 3 - first : first;
            }
          }
          targets.push(t);
        }
      }
    }
  }
  let T;
  const half = (x) => (x + 1) >> 1;
  function dfs(g, wrong, last) {
    if (wrong === 0) return true;
    const left = bound - g - 1;
    for (let a = 0; a < N; a++) {
      const ca = cells[a];
      if (!ca) continue;
      for (const e of [0, 1]) {
        const b = nb(a, e);
        if (b < 0 || !cells[b]) continue;
        const cb = cells[b];
        const base = wrong - (T[a] !== ca) - (T[b] !== cb);
        if (half(base) > left) continue;
        for (let p = 0; p < N; p++) {
          if (cells[p]) continue;
          for (let d = 0; d < 4; d++) {
            const q = nb(p, d);
            if (q < 0 || cells[q]) continue;
            const w2 = base + (T[p] !== ca) + (T[q] !== cb);
            if (half(w2) > left) continue;
            const key = ((a * 2 + e) * N + p) * 4 + d, touch = [a, b, p, q];
            if (last && key < last.key && !touch.some((i) => last.touch.includes(i))) continue;
            cells[a] = cells[b] = _; cells[p] = ca; cells[q] = cb;
            const ok = dfs(g + 1, w2, { key, touch });
            cells[p] = cells[q] = _; cells[a] = ca; cells[b] = cb;
            if (ok) return true;
          }
        }
      }
    }
    return false;
  }
  for (const t of targets) {
    T = t;
    const wrong = cells.reduce((k, v, i) => k + (v && v !== t[i] ? 1 : 0), 0);
    if (half(wrong) <= bound && dfs(0, wrong, null)) return true;
  }
  return false;
}

// ステージ 10 の 7 手の解（[もと石, 相方, もと石を置くマス, 相方の向き]。IDA* で見つけたもの）
const STAGE10 = [[19, 20, 17, 1], [25, 26, 19, 0], [29, 37, 26, 2], [35, 36, 29, 1], [34, 42, 35, 0], [37, 45, 34, 1], [17, 25, 37, 1]];

test('はじめの盤: 1 列は左から黒白黒白…、市松は左上が黒', () => {
  assert.deepEqual(L.startCells(L.STAGES[0]), line('....bwbwbw....'));
  assert.deepEqual(L.startCells(L.STAGES[2]), line('..bwbwbwbw'));
  assert.deepEqual(L.startCells(L.STAGES[8]), line('.....bw..wb.....'));
});

test('置く: 2 マスとも空いているときだけ。持ち上げた石のマスには置けない。1 列は向きそのまま', () => {
  const c = line('..bwbw..');
  assert.equal(L.canPlace(c, 1, 8, 0, 0), true);
  assert.equal(L.canPlace(c, 1, 8, 1, 0), false);   // 2 マス目に石
  assert.equal(L.canPlace(c, 1, 8, 7, 0), false);   // 盤の外
  L.move(c, 1, 8, 3, 4, 0, 0);
  assert.deepEqual(c, line('wbb..w..'));
  // 1 列の手は左右を入れ替えない。市松は 4 向き
  const one = L.moves(line('..bw..'), S(1, 6, 1, 2));
  assert.deepEqual(one, [[2, 3, 0, 0], [2, 3, 4, 0]]);
  const grid = L.moves(line('.....bw.........'), S(4, 4, 2, 2));
  assert.ok(grid.some(([, , , d]) => d === 1) && grid.some(([, , , d]) => d === 2));
});

test('となり', () => {
  assert.equal(L.step(4, 4, 5, 0), 6);
  assert.equal(L.step(4, 4, 5, 1), 9);
  assert.equal(L.step(4, 4, 4, 2), -1);
  assert.equal(L.step(4, 4, 1, 3), -1);
});

test('クリア: 1 列はすき間なく黒 n → 白 n か白 n → 黒 n。市松は正方形で上下か左右に分かれる', () => {
  const s = S(1, 10, 1, 6);
  assert.equal(L.isClear(line('..bbbwww..'), s), true);
  assert.equal(L.isClear(line('wwwbbb....'), s), true);
  assert.equal(L.isClear(line('..bbb.www.'), s), false);   // すき間
  assert.equal(L.isClear(line('..bbwbww..'), s), false);
  assert.equal(L.isClear(line('..bwbwbw..'), s), false);
  const g = S(4, 4, 2, 2);
  assert.equal(L.isClear(line('.....wb..wb.....'), g), true);    // 左右
  assert.equal(L.isClear(line('......bb..ww....'), g), true);    // 上下
  assert.equal(L.isClear(line('bw..wb..........'), g), false);   // 市松のまま
  assert.equal(L.isClear(line('bb....ww........'), g), false);   // 正方形でない
  assert.equal(L.isClear(line('bbww............'), g), false);   // 1 行に並んでいる
});

test('最少手数: ステージ 1〜9 を幅優先で調べると、表の最少と同じ（どれも解ける）', () => {
  assert.equal(L.STAGES.length, 10);
  for (const s of L.STAGES.slice(0, 9)) assert.equal(bfs(s), s.min, `ステージ ${s.n}`);
  // 1 列は n 組なら n 手（ステージ 9 は市松 2×2 で 1 手）
  for (const s of L.STAGES.filter((x) => !x.grid)) assert.equal(s.min, s.w / 2);
});

test('2 組（黒白黒白）は、空きが広くても分けられない', () => {
  const s = S(1, 12, 1, 4);
  assert.equal(bfs(s, line('....bwbw....')), null);
});

test('ステージ 10（市松 4×4）: 7 手の解で分かれ、6 手以下では分けられない（最少 7）', () => {
  const s = L.STAGES[9];
  assert.equal(s.min, 7);
  const c = L.startCells(s);
  for (const [a, b, p, d] of STAGE10) {
    assert.ok(c[a] && c[b] && [0, 1, 2, 3].some((d) => L.step(s.rows, s.cols, a, d) === b), `${a},${b} がとなりの石`);
    assert.ok(L.canPlace(c, s.rows, s.cols, p, d), `${p} に置ける`);
    assert.ok(!L.isClear(c, s));
    L.move(c, s.rows, s.cols, a, b, p, d);
  }
  assert.ok(L.isClear(c, s));
  assert.equal(STAGE10.length, s.min);
  // IDA* の枝の切り方が正しいか、小さい盤で幅優先と比べる
  for (const t of L.STAGES.slice(0, 9)) {
    assert.equal(solvableWithin(t, t.min), true, `ステージ ${t.n} が ${t.min} 手で解ける`);
    assert.equal(solvableWithin(t, t.min - 1), false, `ステージ ${t.n} が ${t.min - 1} 手で解けない`);
  }
  assert.equal(solvableWithin(s, 6), false);
});

test('設定: 壊れた値ははじめの値に戻す', () => {
  assert.deepEqual(L.readSettings(null), L.DEFAULT_SETTINGS);
  assert.deepEqual(L.readSettings('x'), L.DEFAULT_SETTINGS);
  assert.deepEqual(L.readSettings({ v: 2, sound: false }), L.DEFAULT_SETTINGS);
  assert.deepEqual(L.readSettings({ v: 1, sound: false }), { v: 1, sound: false });
  assert.deepEqual(L.readSettings({ v: 1 }), { v: 1, sound: true });
});

test('記録: 少ないときだけ更新する。範囲外のステージ・壊れた値は捨てる。状態とつづきから', () => {
  const p = L.readProgress(null);
  const st = (k) => L.STAGES[k - 1];
  assert.deepEqual(p, { v: 1, best: {} });
  assert.equal(L.nextUnclear(p), 1);
  assert.equal(L.addRecord(p, 1, 6), true);
  assert.equal(L.addRecord(p, 1, 6), false);
  assert.equal(L.addRecord(p, 1, 8), false);
  assert.equal(L.addRecord(p, 1, 3), true);
  assert.deepEqual(p.best, { 1: 3 });
  assert.equal(L.stageState(p, st(1)), 'best');
  assert.equal(L.stageState(p, st(2)), 'new');
  L.addRecord(p, 2, 9);
  assert.equal(L.stageState(p, st(2)), 'clear');
  assert.equal(L.nextUnclear(p), 3);
  for (let k = 1; k <= 10; k++) L.addRecord(p, k, 50);
  assert.equal(L.nextUnclear(p), 1);
  const read = L.readProgress({ v: 1, best: { 1: 4, 5: 9, 0: 3, 11: 3, x: 1, 7: -1, 8: 2.5, 9: '3' } });
  assert.deepEqual(read.best, { 1: 4, 5: 9 });
  assert.deepEqual(L.readProgress({ v: 2, best: { 1: 4 } }).best, {});
});

console.log(`${n} tests passed`);
