/* 斗地主：牌型识别 / 大小比较 / 跟牌生成 / 拆牌 / 叫分 / 计分 / 四个难度无头自对弈
   运行：node tests/doudizhu.test.js   （加 --sim 跑难度对比） */
'use strict';
const assert = require('assert');
const D = require('../js/doudizhu.js');

// 'J'→11 … 'A'→14、'2'→15、'S' 小王 16、'B' 大王 17
const V = s => s.trim().split(/\s+/).map(t => ({ J: 11, Q: 12, K: 13, A: 14, 2: 15, S: 16, B: 17 }[t] || +t));
const types = s => D.analyzeAll(V(s)).map(m => m.type).sort();
const one = s => D.analyze(V(s));

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { console.error('✗', name); throw e; }
}

test('点数映射', () => {
  assert.strictEqual(D.cardVal({ r: 1, s: 0 }), 14);
  assert.strictEqual(D.cardVal({ r: 2, s: 0 }), 15);
  assert.strictEqual(D.cardVal({ r: 14, s: 4 }), 16);
  assert.strictEqual(D.cardVal({ r: 15, s: 4 }), 17);
  assert.strictEqual(D.cardVal({ r: 13, s: 2 }), 13);
});

test('基本牌型', () => {
  assert.strictEqual(one('7').type, 'single');
  assert.strictEqual(one('B').type, 'single');
  assert.strictEqual(one('9 9').type, 'pair');
  assert.strictEqual(one('S B').type, 'rocket');
  assert.strictEqual(one('S 2'), null);
  assert.strictEqual(one('2 2 2').type, 'triple');
  assert.strictEqual(one('5 5 5 5').type, 'bomb');
  assert.deepStrictEqual(types('5 5 5 5'), ['bomb']);
  assert.strictEqual(one('3 3 3 4').type, 'triple1');
  assert.strictEqual(one('3 3 3 B').type, 'triple1');
  assert.strictEqual(one('3 3 3 4 4').type, 'triple2');
  assert.strictEqual(one('3 3 3 S B'), null, '三带王炸不算三带一对');
  assert.strictEqual(one('3 3 4 5'), null);
  assert.strictEqual(one('3 3 3 4 5'), null);
});

test('顺子边界', () => {
  assert.strictEqual(one('3 4 5 6 7').type, 'straight');
  assert.strictEqual(one('10 J Q K A').type, 'straight');
  assert.strictEqual(one('3 4 5 6 7 8 9 10 J Q K A').len, 12);
  assert.strictEqual(one('J Q K A 2'), null, '2 不能进顺子');
  assert.strictEqual(one('3 4 5 6'), null, '顺子至少 5 张');
  assert.strictEqual(one('3 4 5 6 8'), null);
  assert.strictEqual(one('K A 2 S B'), null);
});

test('连对与飞机边界', () => {
  assert.strictEqual(one('3 3 4 4 5 5').type, 'pairs');
  assert.strictEqual(one('Q Q K K A A').type, 'pairs');
  assert.strictEqual(one('K K A A 2 2'), null);
  assert.strictEqual(one('3 3 4 4'), null, '连对至少 3 对');
  assert.strictEqual(one('3 3 3 4 4 4').type, 'plane');
  assert.strictEqual(one('K K K A A A').type, 'plane');
  assert.strictEqual(one('A A A 2 2 2'), null, '飞机不含 2');
  assert.strictEqual(one('3 3 3 5 5 5'), null, '不连续');
});

test('飞机带翅膀', () => {
  assert.deepStrictEqual(types('3 3 3 4 4 4 5 6'), ['plane1']);
  assert.deepStrictEqual(types('3 3 3 4 4 4 5 5'), ['plane1'], '两张同点数单翅膀');
  assert.deepStrictEqual(types('3 3 3 4 4 4 S B'), [], '王炸不能当翅膀');
  assert.deepStrictEqual(types('3 3 3 4 4 4 S 2'), ['plane1']);
  assert.deepStrictEqual(types('3 3 3 3 4 4 4 5'), [], '翅膀不能与飞机主体同点数');
  assert.deepStrictEqual(types('3 3 3 4 4 4 5 5 5 7 8 9'), ['plane1']);
  // 333444555666：既是 4 连飞机，也可解释为 3 连飞机带 3 张单（两种窗口）
  const all = D.analyzeAll(V('3 3 3 4 4 4 5 5 5 6 6 6'));
  assert.deepStrictEqual(all.map(m => m.type + m.rank).sort(), ['plane3', 'plane13', 'plane14'].sort());
  assert.strictEqual(one('3 3 3 4 4 4 5 5 5 6 6 6').type, 'plane', '自由出牌优先解释为飞机');
  assert.deepStrictEqual(types('3 3 3 4 4 4 5 5 6 6'), ['plane2']);
  assert.deepStrictEqual(types('3 3 3 4 4 4 5 5 5 5'), ['plane2'], '一炸当两对翅膀');
  assert.deepStrictEqual(types('3 3 3 4 4 4 5 5 6 7'), []);
  assert.deepStrictEqual(types('3 3 3 4 4 4 5 5 5 6'), [], '10 张但不构成带对');
  assert.deepStrictEqual(types('Q Q Q K K K A A A 2 2 2'), ['plane1'], 'QKA 飞机带三个 2');
  assert.deepStrictEqual(types('J J J Q Q Q K K K A A A 3 4 5 6'), ['plane1']);
  const p = one('J J J Q Q Q K K K A A A 3 4 5 6');
  assert.strictEqual(p.rank, 11); assert.strictEqual(p.len, 4);
});

test('四带二', () => {
  assert.deepStrictEqual(types('5 5 5 5 3 9'), ['four2']);
  assert.deepStrictEqual(types('5 5 5 5 3 3'), ['four2']);
  assert.deepStrictEqual(types('5 5 5 5 S B'), []);
  assert.deepStrictEqual(types('5 5 5 5 3 3 9 9'), ['four22']);
  assert.deepStrictEqual(types('5 5 5 5 3 3 9 8'), []);
  const two = D.analyzeAll(V('3 3 3 3 4 4 4 4'));
  assert.deepStrictEqual(two.map(m => m.type + m.rank).sort(), ['four223', 'four224']);
  assert.strictEqual(one('3 3 3 3 4 4 4 4').rank, 4);
});

test('大小比较', () => {
  const b = (x, y) => D.canBeat(one(x), one(y));
  assert.ok(b('8', '7'));
  assert.ok(!b('7', '7'));
  assert.ok(b('2', 'A'));
  assert.ok(b('S', '2'));
  assert.ok(b('B', 'S'));
  assert.ok(!b('8 8', '7'), '牌型不同');
  assert.ok(b('4 5 6 7 8', '3 4 5 6 7'));
  assert.ok(!b('4 5 6 7 8 9', '3 4 5 6 7'), '张数不同');
  assert.ok(b('4 4 4 3', '3 3 3 K'));
  assert.ok(!b('4 4 4 3 3', '3 3 3 K'));
  assert.ok(b('3 3 3 3', 'J J J Q Q Q K K K A A A 3 4 5 6'), '炸弹压一切非炸弹');
  assert.ok(b('4 4 4 4', '3 3 3 3'));
  assert.ok(b('2 2 2 2', 'A A A A'));
  assert.ok(b('S B', '2 2 2 2'));
  assert.ok(!b('2 2 2 2', 'S B'));
  assert.ok(!b('3 3 3 3 5 6', '4 4 4 4'), '四带二不是炸弹');
  assert.ok(b('4 4 4 4', '3 3 3 3 5 6'));
  assert.ok(b('4 4 4 4 5 6', '3 3 3 3 8 9'));
  assert.ok(b('4 4 4 5 5 5 7 8', '3 3 3 4 4 4 K K'));
});

test('resolvePlay：歧义牌按上家牌型解释', () => {
  const last = one('3 3 3 4 4 4 5 5 5 7 8 9');
  const r = D.resolvePlay(V('4 4 4 5 5 5 6 6 6 7 7 7'), last);
  assert.ok(!r.err);
  assert.strictEqual(r.move.type, 'plane1');
  const r2 = D.resolvePlay(V('3 3 4'), null);
  assert.strictEqual(r2.err, 'type');
  const r3 = D.resolvePlay(V('5'), one('9'));
  assert.strictEqual(r3.err, 'small');
  const r4 = D.resolvePlay(V('5 5'), one('9'));
  assert.strictEqual(r4.err, 'mismatch');
  assert.ok(!D.resolvePlay(V('3 3 3 3'), one('9')).err);
});

/* 暴力枚举：手牌所有子集里能压过 last 的出法（按 type+点数去重） */
function bruteBeats(handVals, last) {
  const out = new Set();
  const n = handVals.length;
  for (let mask = 1; mask < (1 << n); mask++) {
    const vals = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) vals.push(handVals[i]);
    for (const m of D.analyzeAll(vals)) if (D.canBeat(m, last)) out.add(m.type + '|' + m.vals.join(','));
  }
  return out;
}
test('跟牌生成 = 暴力枚举（含带牌全部组合）', () => {
  const rng = D.mulberry32(7);
  const lasts = ['5', '9 9', '6 6 6', '4 4 4 3', '4 4 4 3 3', '3 4 5 6 7', '3 3 4 4 5 5', '3 3 3 4 4 4',
    '3 3 3 4 4 4 9 J', '3 3 3 4 4 4 9 9 J J', '3 3 3 3 5 6', '3 3 3 3 5 5 6 6', '6 6 6 6', 'S B'].map(one);
  for (let t = 0; t < 120; t++) {
    // 随机 11 张（偏向重复点数，便于出现三张/炸弹）
    const vals = [];
    const pool = [];
    for (let v = 3; v <= 15; v++) for (let k = 0; k < 4; k++) pool.push(v);
    pool.push(16, 17);
    const ranks = [];
    while (ranks.length < 6) { const v = 3 + Math.floor(rng() * 13); if (!ranks.includes(v)) ranks.push(v); }
    const cand = pool.filter(v => ranks.includes(v) || v >= 16);
    require('../js/common.js').shuffle(cand, rng);
    vals.push(...cand.slice(0, 11));
    const cnt = D.countVals(vals);
    for (const last of lasts) {
      const gen = new Set(D.genBeats(cnt, last, 'all').map(m => m.type + '|' + m.vals.join(',')));
      const bf = bruteBeats(vals, last);
      assert.deepStrictEqual([...gen].sort(), [...bf].sort(), `hand ${vals} vs ${last.type}`);
      // 'min' 模式：只要能压就至少给一种，且都合法
      const mins = D.genBeats(cnt, last, 'min');
      assert.strictEqual(mins.length > 0, bf.size > 0);
      for (const m of mins) assert.ok(bf.has(m.type + '|' + m.vals.join(',')));
    }
  }
});

test('自由出牌生成全部合法', () => {
  const rng = D.mulberry32(9);
  for (let t = 0; t < 30; t++) {
    const G = D.createRound({ rng });
    const cnt = D.countVals(G.hands[0].map(D.cardVal));
    for (const m of D.genLeads(cnt, 'min')) {
      const r = D.resolvePlay(m.vals, null, m);
      assert.ok(!r.err);
      assert.strictEqual(r.move.type, m.type);
    }
  }
});

test('拆牌：最少手数', () => {
  const sp = s => D.splitHand(D.countVals(V(s)));
  assert.strictEqual(sp('3 4 5 6 7 8').hands, 1);
  assert.strictEqual(sp('3 3 4 4 5 5 6 6 7 7').hands, 1, '连对优于两条顺子');
  assert.strictEqual(sp('3 4 5 6 7 7 8').hands, 2);
  assert.strictEqual(sp('3 3 3 4 4 4 9 J').hands, 1, '飞机带两张');
  assert.strictEqual(sp('5 5 5 5 9').hands, 2, '炸弹保留');
  assert.strictEqual(sp('S B 3').hands, 2);
  const s = sp('3 4 5 6 7 9 9 9 K');
  assert.strictEqual(s.hands, 2);
  const g = D.leadGroups(s);
  assert.ok(g.normal.some(m => m.type === 'triple1' && m.rank === 9));
  // 大手牌速度
  const rng = D.mulberry32(3);
  const t0 = Date.now();
  for (let i = 0; i < 300; i++) {
    const G = D.createRound({ rng });
    D.splitHand(D.countVals(G.hands[0].concat(G.bottom).map(D.cardVal)));
  }
  assert.ok(Date.now() - t0 < 2000);
});

test('叫分流程：叫 3 分立即成交 / 都不叫重发 / 一轮最高者', () => {
  let G = D.createRound({ rng: D.mulberry32(1), firstBidder: 1 });
  assert.strictEqual(D.applyBid(G, 1, 1), 'next');
  assert.throws(() => D.applyBid(G, 2, 1), /invalid bid/);
  assert.strictEqual(D.applyBid(G, 2, 3), 'done');
  assert.strictEqual(G.landlord, 2);
  assert.strictEqual(G.bid, 3);
  assert.strictEqual(G.hands[2].length, 20);
  assert.strictEqual(G.turn, 2);
  G = D.createRound({ rng: D.mulberry32(2), firstBidder: 0 });
  D.applyBid(G, 0, 0); D.applyBid(G, 1, 0);
  assert.strictEqual(D.applyBid(G, 2, 0), 'redeal');
  G = D.createRound({ rng: D.mulberry32(3), firstBidder: 2 });
  D.applyBid(G, 2, 1); D.applyBid(G, 0, 2);
  assert.strictEqual(D.applyBid(G, 1, 0), 'done');
  assert.strictEqual(G.landlord, 0);
  assert.strictEqual(G.bid, 2);
});

test('出牌流程：两家不要后重新自由出牌，地主不能不出', () => {
  const G = D.createRound({ rng: D.mulberry32(5), firstBidder: 0 });
  D.setLandlord(G, 0, 1);
  assert.throws(() => D.applyPlay(G, 0, []), /leader cannot pass/);
  const low = G.hands[0][G.hands[0].length - 1];
  D.applyPlay(G, 0, [low]);
  D.applyPlay(G, 1, []);
  D.applyPlay(G, 2, []);
  assert.strictEqual(G.last, null);
  assert.strictEqual(G.turn, 0);
  assert.throws(() => D.applyPlay(G, 1, []), /not your turn/);
});

test('计分：叫分 × 炸弹 × 春天', () => {
  const G = { landlord: 1, winner: 1, bid: 3, bombs: 1, rockets: 0, plays: [0, 6, 0] };
  let r = D.settle(G, 1);
  assert.ok(r.spring);
  assert.strictEqual(r.mult, 12);
  assert.deepStrictEqual(r.deltas, [-12, 24, -12]);
  // 农民赢 + 反春 + 王炸 + 炸弹，底分 2
  const G2 = { landlord: 0, winner: 2, bid: 2, bombs: 1, rockets: 1, plays: [1, 3, 5] };
  r = D.settle(G2, 2);
  assert.ok(r.antiSpring && !r.spring);
  assert.strictEqual(r.mult, 2 * 4 * 2);
  assert.deepStrictEqual(r.deltas, [-64, 32, 32]);
  // 普通结局
  const G3 = { landlord: 2, winner: 0, bid: 1, bombs: 0, rockets: 0, plays: [5, 2, 4] };
  r = D.settle(G3, 1);
  assert.ok(!r.spring && !r.antiSpring);
  assert.deepStrictEqual(r.deltas, [1, 1, -2]);
});

test('提示：每个方案都合法并能压过', () => {
  const rng = D.mulberry32(11);
  for (let t = 0; t < 40; t++) {
    const G = D.createRound({ rng });
    const cnt = D.countVals(G.hands[0].map(D.cardVal));
    for (const last of [null, one('7'), one('8 8'), one('3 4 5 6 7'), one('5 5 5 6')]) {
      for (const m of D.hintMoves(cnt, last)) {
        const r = D.resolvePlay(m.vals, last, m);
        assert.ok(!r.err, `${m.type} vs ${last && last.type}`);
        assert.ok(D.moveToCards(G.hands[0], m).length === m.vals.length);
      }
    }
  }
});

test('AI 叫分合法', () => {
  const rng = D.mulberry32(12);
  for (let d = 0; d < 4; d++) {
    for (let t = 0; t < (d === 3 ? 6 : 50); t++) {
      const G = D.createRound({ rng });
      const cnt = D.countVals(G.hands[0].map(D.cardVal));
      for (const cur of [0, 1, 2]) {
        const b = D.aiBid({ cnt, cur, diff: d, rng, budget: 10 });
        assert.ok(b === 0 || (b > cur && b <= 3));
      }
    }
  }
});

/* ---------------- 无头自对弈 ---------------- */
function checkState(G) {
  const ids = new Set();
  let n = 0;
  for (const h of G.hands) for (const c of h) { ids.add(c.id); n++; }
  for (const c of G.played) { ids.add(c.id); n++; }
  assert.strictEqual(n, 54, '牌数守恒');
  assert.strictEqual(ids.size, 54, '没有重复的牌');
  const h = G.history[G.history.length - 1];
  if (h && !h.pass) {
    // 每一步出牌都是合法牌型，跟牌时能压过上家
    const prev = G.history.slice(0, -1).reverse();
    let target = null, passes = 0;
    for (const x of prev) {
      if (x.pass) { passes++; continue; }
      target = passes >= 2 ? null : x.move;
      break;
    }
    const r = D.resolvePlay(h.cards.map(D.cardVal), target, h.move);
    assert.ok(!r.err, 'illegal ' + JSON.stringify(h.move));
  }
}
const diffNames = ['简单', '普通', '困难', '大师'];
for (let d = 0; d < 4; d++) {
  test(`自对弈 100 局：${diffNames[d]}`, () => {
    const rng = D.mulberry32(100 + d);
    let total = 0;
    const t0 = Date.now();
    for (let g = 0; g < 100; g++) {
      const { G, res } = D.playHeadless({
        rng, diffs: [d, d, d], firstBidder: g % 3, budget: d === 3 ? 4 : undefined, bidBudget: 4, check: checkState,
      });
      assert.strictEqual(G.phase, 'over');
      assert.strictEqual(G.hands[G.winner].length, 0);
      assert.strictEqual(res.deltas[0] + res.deltas[1] + res.deltas[2], 0, '积分守恒');
      assert.ok([1, 2, 3].includes(G.bid));
      total += G.history.length;
    }
    assert.ok(total > 0);
    if (process.argv.includes('-v')) console.log(`  ${diffNames[d]}：100 局 ${Date.now() - t0}ms`);
  });
}

test('大师单次决策耗时可控', () => {
  const rng = D.mulberry32(77);
  let worst = 0;
  for (let g = 0; g < 4; g++) {
    const G = D.createRound({ rng });
    D.setLandlord(G, 0, 3);
    let steps = 0;
    while (G.phase === 'play' && steps < 300) {
      const t0 = Date.now();
      const { move, cards } = D.aiTurn(G, G.turn, 3, rng, 300);
      worst = Math.max(worst, Date.now() - t0);
      D.applyPlay(G, G.turn, cards, move);
      steps++;
    }
  }
  assert.ok(worst < 900, 'worst ' + worst + 'ms');
});

console.log(`✓ doudizhu: ${passed} 项测试通过`);

/* --sim：难度对比（固定座位 0 当地主、叫 1 分，同一批牌；大师每步 60ms 预算，局数较少） */
if (process.argv.includes('--sim')) {
  const run = (ll, fm, N) => {
    let w = 0;
    for (let i = 0; i < N; i++) {
      const r = D.playHeadless({ rng: D.mulberry32(5000 + i), diffs: [ll, fm, fm], forceLandlord: 0, forceBid: 1, budget: 60 });
      if (r.res.llWin) w++;
    }
    return (w / N * 100).toFixed(1) + '%';
  };
  for (const [a, b] of [[0, 0], [1, 1], [2, 2], [1, 0], [0, 1], [2, 1], [1, 2]]) {
    console.log(`地主 ${diffNames[a]} vs 农民 ${diffNames[b]}：地主胜率 ${run(a, b, 2000)}（2000 局）`);
  }
  for (const [a, b] of [[3, 0], [0, 3], [3, 2], [2, 3]]) {
    console.log(`地主 ${diffNames[a]} vs 农民 ${diffNames[b]}：地主胜率 ${run(a, b, 100)}（100 局）`);
  }
}
