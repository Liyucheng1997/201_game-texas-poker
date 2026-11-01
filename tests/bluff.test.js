/* 吹牛：扣牌 / 过 / 相信 / 质疑 / 作废 / 胜负 / 记牌 / 四个难度无头自对弈
   运行：node tests/bluff.test.js   （加 --sim 跑难度对比） */
'use strict';
const assert = require('assert');
const B = require('../js/bluff.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { console.error('✗', name); throw e; }
}
const C = (r, s, k) => ({ id: `${k || 0}-${s}-${r}`, r, s });   // s=4 为王
/* 按座位手牌构造牌局（其余字段与 createRound 一致） */
function rigged(hands, opts) {
  const G = B.createRound(Object.assign({ deck: [].concat(...hands) }, opts));
  G.hands = hands.map(h => B.sortHand(h));
  G.all = [].concat(...hands);
  G.total = G.all.length;
  return G;
}
function conserve(G) {
  let n = G.discarded + B.pileCount(G);
  for (const h of G.hands) n += h.length;
  assert.strictEqual(n, G.total, '牌数守恒');
  const ids = new Set();
  for (const h of G.hands) for (const c of h) { assert(!ids.has(c.id), '重复的牌'); ids.add(c.id); }
}

test('发牌：54 张发完，两人 14 张两人 13 张', () => {
  const G = B.createRound({ rng: B.mulberry32(1), first: 2 });
  assert.deepStrictEqual(G.hands.map(h => h.length), [13, 13, 14, 14]);
  assert.strictEqual(G.turn, 2);
  assert.strictEqual(B.fitTotal(G), 6);
  const G2 = B.createRound({ rng: B.mulberry32(1), noJokers: true });
  assert.strictEqual(G2.total, 52);
  assert.strictEqual(B.fitTotal(G2), 4);
  conserve(G);
});

test('王是万能牌', () => {
  assert(B.fits(C(13, 0), 13));
  assert(!B.fits(C(12, 0), 13));
  assert(B.fits(C(14, 4), 5));
  assert(B.fits(C(15, 4), 1));
});

test('出牌合法性', () => {
  const G = rigged([[C(13, 0), C(13, 1), C(2, 0), C(3, 0), C(4, 0)], [C(5, 0)], [C(6, 0)], [C(7, 0)]]);
  const h = G.hands[0];
  assert(B.checkPlay(G, 1, [G.hands[1][0]], 5), '没轮到');
  assert(B.checkPlay(G, 0, [], 13), '空');
  assert(B.checkPlay(G, 0, h, 13), '超过 4 张');
  assert(B.checkPlay(G, 0, [h[0]], 0), '首家必须报点数');
  assert(B.checkPlay(G, 0, [C(9, 3)], 13), '不在手里');
  assert.strictEqual(B.checkPlay(G, 0, [h[0], h[1]], 13), '');
});

test('全员相信：牌留在堆里，轮到下家；首家不能过', () => {
  const G = rigged([[C(13, 0), C(13, 1), C(2, 0)], [C(5, 0), C(5, 1)], [C(6, 0), C(6, 1)], [C(7, 0), C(7, 1)]]);
  assert.throws(() => B.applyPass(G, 0));
  const play = B.applyPlay(G, 0, [G.hands[0].find(c => c.r === 13)], 13);
  assert(play.lead);
  assert.strictEqual(B.judgeOf(G), 1);
  assert.throws(() => B.applyPass(G, 1), '表态时不能出牌');
  B.applyBelieve(G, 1); B.applyBelieve(G, 2);
  const r = B.applyBelieve(G, 3);
  assert(r.closed);
  assert.strictEqual(G.turn, 1);
  assert.strictEqual(G.rank, 13);
  assert.strictEqual(B.pileCount(G), 1);
  conserve(G);
});

test('质疑开出假牌：吹牛的人收整堆，质疑者重新报点数', () => {
  const G = rigged([[C(13, 0), C(2, 0), C(9, 0)], [C(5, 0), C(5, 1)], [C(6, 0), C(6, 1)], [C(7, 0), C(7, 1)]]);
  B.applyPlay(G, 0, [G.hands[0].find(c => c.r === 13)], 13);
  B.applyBelieve(G, 1); B.applyBelieve(G, 2); B.applyBelieve(G, 3);
  // 座位 1 跟：一张 5 冒充 K
  B.applyPlay(G, 1, [G.hands[1][0]], 13);
  B.applyBelieve(G, 2);
  const res = B.applyChallenge(G, 3);
  assert(res.lie);
  assert.strictEqual(res.loser, 1);
  assert.strictEqual(G.hands[1].length, 3, '收回 2 张');
  assert.strictEqual(G.turn, 3);
  assert.strictEqual(G.rank, 0, '新一轮');
  assert.strictEqual(B.pileCount(G), 0);
  assert.deepStrictEqual(G.pub.rev[1], { n: 1, lies: 1 });
  assert.strictEqual(G.pub.chal[3].made, 1);
  // 记忆：其他人知道亮出的 5 在座位 1 手里；座位 0 还知道自己扣下的 K 也在那里
  assert(G.mem[2].knownIn[1].some(c => c.r === 5));
  assert(G.mem[0].knownIn[1].some(c => c.r === 13));
  assert(!G.mem[2].knownIn[1].some(c => c.r === 13), '座位 2 不知道堆里的 K');
  conserve(G);
});

test('质疑开出真牌（含王）：质疑者收整堆，被冤枉的人重新报点数', () => {
  const G = rigged([[C(13, 0), C(14, 4), C(2, 0)], [C(5, 0), C(5, 1)], [C(6, 0), C(6, 1)], [C(7, 0), C(7, 1)]]);
  B.applyPlay(G, 0, [G.hands[0].find(c => c.r === 13), G.hands[0].find(c => c.s === 4)], 13);
  const res = B.applyChallenge(G, 1);
  assert(!res.lie);
  assert.strictEqual(res.loser, 1);
  assert.strictEqual(G.hands[1].length, 4);
  assert.strictEqual(G.turn, 0);
  assert.strictEqual(G.leader, 0);
  conserve(G);
});

test('其他人都过：整堆作废，最后扣牌的人重新报点数', () => {
  const G = rigged([[C(13, 0), C(2, 0)], [C(13, 1), C(5, 1)], [C(6, 0), C(6, 1)], [C(7, 0), C(7, 1)]]);
  B.applyPlay(G, 0, [G.hands[0][1]], 13);
  B.applyBelieve(G, 1); B.applyBelieve(G, 2); B.applyBelieve(G, 3);
  B.applyPlay(G, 1, [G.hands[1].find(c => c.r === 13)], 0);
  B.applyBelieve(G, 2); B.applyBelieve(G, 3); B.applyBelieve(G, 0);
  assert.strictEqual(B.applyPass(G, 2).cleared, false);
  assert.strictEqual(B.applyPass(G, 3).cleared, false);
  const r = B.applyPass(G, 0);
  assert(r.cleared);
  assert.strictEqual(r.leader, 1);
  assert.strictEqual(G.turn, 1);
  assert.strictEqual(G.discarded, 2);
  assert.strictEqual(G.rank, 0);
  assert.strictEqual(G.mem[0].myDiscard.length, 1);
  conserve(G);
});

test('出完：没人质疑就赢；最后一手是真牌被质疑也赢；最后一手吹牛被抓就收牌', () => {
  let G = rigged([[C(13, 0)], [C(5, 0), C(5, 1)], [C(6, 0), C(6, 1)], [C(7, 0), C(7, 1)]]);
  B.applyPlay(G, 0, G.hands[0].slice(), 13);
  B.applyBelieve(G, 1); B.applyBelieve(G, 2);
  assert.strictEqual(B.applyBelieve(G, 3).win, 0);
  assert.strictEqual(G.phase, 'over');
  assert.deepStrictEqual(B.settle(G).deltas, [6, -2, -2, -2]);

  G = rigged([[C(13, 0)], [C(5, 0), C(5, 1)], [C(6, 0), C(6, 1)], [C(7, 0), C(7, 1)]]);
  B.applyPlay(G, 0, G.hands[0].slice(), 13);
  const r = B.applyChallenge(G, 1);
  assert.strictEqual(r.win, 0);
  assert.strictEqual(G.winner, 0);
  assert.deepStrictEqual(B.settle(G).deltas, [7, -3, -2, -2]);

  G = rigged([[C(12, 0)], [C(5, 0), C(5, 1)], [C(6, 0), C(6, 1)], [C(7, 0), C(7, 1)]]);
  B.applyPlay(G, 0, G.hands[0].slice(), 13);
  B.applyBelieve(G, 1);
  const r2 = B.applyChallenge(G, 2);
  assert(r2.lie && r2.win == null);
  assert.strictEqual(G.phase, 'play');
  assert.strictEqual(G.hands[0].length, 1);
  assert.strictEqual(G.turn, 2);
});

test('概率工具：超几何右尾', () => {
  assert.strictEqual(B.hyperTail(10, 3, 4, 0), 1);
  assert.strictEqual(B.hyperTail(10, 3, 4, 4), 0);
  // 52 张里 4 张 A，抽 13 张至少 1 张 A ≈ 0.696
  assert(Math.abs(B.hyperTail(52, 4, 13, 1) - 0.6962) < 0.001);
});

test('判断：自己手里的牌说明对方必在吹牛', () => {
  // 座位 1 手握 3 张 K + 2 王，座位 0 声称 2 张 K → 外面最多只有 1 张
  const G = rigged([[C(13, 0), C(2, 0), C(3, 0)], [C(13, 1), C(13, 2), C(13, 3), C(14, 4), C(15, 4)], [C(6, 0)], [C(7, 0)]]);
  B.applyPlay(G, 0, [G.hands[0][0], G.hands[0][1]], 13);
  const a = B.assessClaim(G, 1, 1);
  assert(a.certain && a.pLie === 1);
  for (let d = 1; d <= 3; d++) assert(B.aiChallenge(G, 1, d, Math.random), '普通以上必开');
  // 座位 2 什么都不知道 → 不确定
  assert(!B.assessClaim(G, 2, 1).certain);
});

test('困难记牌：知道开牌亮出的牌在谁手里', () => {
  const G = rigged([[C(13, 0), C(13, 1), C(2, 0), C(3, 0)], [C(5, 0), C(5, 1), C(5, 2)], [C(13, 2), C(13, 3), C(9, 0)], [C(7, 0), C(7, 1), C(8, 0)]], { noJokers: true });
  // 座位 0 报 2 张 K（真），座位 1 开错，收走两张 K
  B.applyPlay(G, 0, G.hands[0].filter(c => c.r === 13), 13);
  assert(!B.applyChallenge(G, 1).lie);
  // 现在座位 0 首家，报 K，扣 2 张（都是假的）
  B.applyPlay(G, 0, G.hands[0].slice(0, 2), 13);
  // 座位 2：自己 2 张 K + 知道座位 1 有 2 张 K → 无王时 K 全在明处，必是吹牛
  assert(B.assessClaim(G, 2, 2).certain, '困难记得');
  assert(!B.assessClaim(G, 2, 1).certain, '普通不记牌');
});

test('AI 出牌合法，整局牌数守恒（四个难度 × 有王/无王）', () => {
  const rng = B.mulberry32(7);
  for (let i = 0; i < 40; i++) {
    const diffs = [i % 4, (i + 1) % 4, (i + 2) % 4, (i + 3) % 4];
    const { G, res, steps } = B.playHeadless({ rng, diffs, first: i % 4, noJokers: i % 5 === 0, check: conserve });
    assert(G.phase === 'over' && G.winner >= 0);
    assert.strictEqual(res.deltas.reduce((a, b) => a + b, 0), 0, '零和');
    assert.strictEqual(G.hands[G.winner].length, 0);
    assert(steps < 4000);
  }
});

console.log(`✓ ${passed} 项测试通过`);

/* ---------------- 难度对比自对弈 ---------------- */
if (process.argv.includes('--sim')) {
  const N = +(process.argv.find(a => /^--n=/.test(a)) || '--n=400').slice(4);
  const NAMES = ['简单', '普通', '困难', '大师'];
  // 一个 hero 难度 vs 三个对手难度，hero 轮流坐四个位置；同一场比赛 pub 统计跨局累积（模拟 6 局一场）
  function duel(hero, opp, n, seed) {
    const rng = B.mulberry32(seed);
    let score = 0, wins = 0, steps = 0, lies = 0, challenges = 0;
    let pub = B.newPub();
    for (let i = 0; i < n; i++) {
      if (i % 6 === 0) pub = B.newPub();
      const seat = i % 4;
      const diffs = [0, 1, 2, 3].map(p => (p === seat ? hero : opp));
      const out = B.playHeadless({ rng, diffs, first: (i >> 2) % 4, pub });
      score += out.res.deltas[seat];
      if (out.G.winner === seat) wins++;
      steps += out.steps;
      for (const h of out.G.history) {
        if (h.t === 'challenge') { challenges++; if (h.lie) lies++; }
      }
    }
    return { avg: score / n, win: wins / n, steps: steps / n, caughtRate: lies / Math.max(1, challenges) };
  }
  const t0 = Date.now();
  const rows = [[1, 0], [2, 1], [3, 2], [3, 1], [0, 1], [1, 2], [2, 3], [0, 3]];
  for (const [h, o] of rows) {
    const r = duel(h, o, N, 1000 + h * 10 + o);
    console.log(`${NAMES[h]} 对 3×${NAMES[o]}：每局 ${r.avg >= 0 ? '+' : ''}${r.avg.toFixed(2)} 分，先出完 ${(r.win * 100).toFixed(1)}%（基准 25%），平均 ${r.steps.toFixed(0)} 步，开牌命中 ${(r.caughtRate * 100).toFixed(0)}%`);
  }
  for (let d = 0; d < 4; d++) {
    const r = duel(d, d, N, 77 + d);
    console.log(`同难度基准 ${NAMES[d]}：每局 ${r.avg.toFixed(2)}，先出完 ${(r.win * 100).toFixed(1)}%，平均 ${r.steps.toFixed(0)} 步，开牌命中 ${(r.caughtRate * 100).toFixed(0)}%`);
  }
  console.log(`用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
