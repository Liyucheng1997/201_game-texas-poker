/* 斗牛（抢庄牛牛）：牌型识别 / 比较 / 定庄 / 结算 / 概率表 / AI / 自对弈
   运行：node tests/douniu.test.js  （加 --sim 跑更长的难度对比） */
'use strict';
const assert = require('assert');
const D = require('../js/douniu.js');

// 'As' 'Kh' '10d' '2c' → { id, r, s }；s: 0♠ 1♥ 2♦ 3♣
const C = str => {
  const m = str.match(/^(10|[2-9JQKA])([shdc])$/);
  const r = { J: 11, Q: 12, K: 13, A: 1 }[m[1]] || +m[1];
  const s = 'shdc'.indexOf(m[2]);
  return { id: `0-${s}-${r}`, r, s };
};
const H = str => str.split(' ').map(C);
const E = str => D.evalHand(H(str));

let passed = 0;
function test(name, fn) {
  const t0 = Date.now();
  try { fn(); passed++; console.log(`✓ ${name} (${Date.now() - t0}ms)`); } catch (e) { console.error('✗', name); throw e; }
}

/* ---------- 牌型识别 ---------- */
test('普通牛型与没牛', () => {
  assert.strictEqual(E('As 2h 4d 6c 8s').type, 0);               // 没有 3 张凑十
  assert.strictEqual(E('Ks Qh Jd 5c 5s').name, '牛牛');
  assert.strictEqual(E('3s 7h Kd 2c 5s').name, '牛7');
  assert.strictEqual(E('10s 10h 10d As 2s').name, '牛3');           // 10+10+10 凑十
  assert.strictEqual(E('9s Ah Kd 4c 6s').name, '牛牛');             // 9+A+K=20, 4+6=10
  assert.strictEqual(E('2s 3h 5d 9c Ks').name, '牛9');              // 2+3+5=10, 9+K=19
  assert.strictEqual(E('6s 4h Kd As 2c').type, 3);
  // 倍数
  const m = t => D.TYPE_MULT[t];
  assert.deepStrictEqual([0, 1, 6, 7, 8, 9, 10, 11, 12, 13].map(m), [1, 1, 1, 2, 2, 3, 4, 5, 6, 8]);
});

test('特殊牌型与优先级', () => {
  assert.strictEqual(E('Ks Qh Jd Jc Qs').name, '五花牛');
  assert.strictEqual(E('7s 7h 7d 7c Ks').name, '炸弹牛');
  assert.strictEqual(E('Ks Kh Kd Kc Qs').name, '炸弹牛');           // 炸弹 > 五花
  assert.strictEqual(E('10s 10h 10d 10c Ks').name, '炸弹牛');       // 10 不是花牌
  assert.strictEqual(E('As Ah 2d 2c 3s').name, '五小牛');           // 和 9
  assert.strictEqual(E('4s 3h Ad Ac Ah').name, '五小牛');           // 和 = 10 边界
  assert.strictEqual(E('4s 4h Ad Ac Ah').type, 0);                  // 和 11 → 不是五小，也凑不出十
  assert.strictEqual(E('As Ah Ad Ac 2s').name, '五小牛');           // 五小 > 炸弹
  assert.strictEqual(E('As 2h 3d 4c 5s').type, 5);                  // 有 5 → 不是五小：1+4+5=10，2+3=5 → 牛5
  assert.strictEqual(E('Ks Qh Jd 10c Qs').name, '牛牛');            // 含 10 不是五花
});

test('亮牌分组与手动摆牛', () => {
  const h = H('3s 7h Kd 2c 5s');
  const e = D.evalHand(h);
  assert.ok(e.groups);
  const [tri, rest] = e.groups;
  assert.strictEqual(tri.reduce((s, i) => s + D.point(h[i]), 0) % 10, 0);
  assert.strictEqual(rest.length, 2);
  // 手动选择另一组合法的 3 张：分组跟随玩家，结果不变
  const h2 = H('Ks Qh Jd 5c 5s');
  const e2 = D.evalHand(h2, [0, 3, 4]);                             // K+5+5 = 20
  assert.deepStrictEqual(e2.groups[0], [0, 3, 4]);
  assert.strictEqual(e2.key, D.evalHand(h2).key);
  // 非法选择被忽略
  const e3 = D.evalHand(h2, [0, 1, 3]);                             // K+Q+5 = 25
  assert.notDeepStrictEqual(e3.groups[0], [0, 1, 3]);
  assert.strictEqual(D.evalHand(H('7s 7h 7d 7c Ks')).groups[0].length, 4);
  assert.strictEqual(D.evalHand(H('As Ah 2d 2c 3s')).groups, null);
});

test('牌型识别与暴力定义一致（随机 30000 手）', () => {
  const rng = D.mulberry32(42);
  const Hub = require('../js/common.js');
  for (let t = 0; t < 30000; t++) {
    const h = Hub.shuffle(D.newDeck(), rng).slice(0, 5);
    const pts = h.map(D.point), total = pts.reduce((a, b) => a + b, 0);
    const cnt = {};
    h.forEach(c => { cnt[c.r] = (cnt[c.r] || 0) + 1; });
    let exp;
    if (h.every(c => c.r < 5) && total <= 10) exp = 13;
    else if (Object.values(cnt).includes(4)) exp = 12;
    else if (h.every(c => c.r >= 11)) exp = 11;
    else {
      let ok = false;
      for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) for (let c = b + 1; c < 5; c++)
        if ((pts[a] + pts[b] + pts[c]) % 10 === 0) ok = true;
      exp = !ok ? 0 : total % 10 === 0 ? 10 : total % 10;
    }
    const e = D.evalHand(h);
    assert.strictEqual(e.type, exp, h.map(c => c.r + '/' + c.s).join(' '));
    if (e.groups) {
      const all = e.groups[0].concat(e.groups[1]).sort();
      assert.deepStrictEqual(all, [0, 1, 2, 3, 4]);
    }
  }
});

/* ---------- 比较 ---------- */
test('同牌型比最大单张，再比花色；炸弹比点数', () => {
  const gt = (a, b) => assert.ok(D.compareHands(E(a), E(b)) > 0, `${a} 应大于 ${b}`);
  gt('Ks Qh Jd 5c 5s', 'Kh Qs Jc 5d 5h');      // 牛牛：K♠ > K♥
  gt('Kc Qh Jd 5h 5d', 'Kd Qs Js 4s 6s');      // 牛牛：K♣ > K♦
  gt('Ks 9h Ad 4c 6s', 'Qs Jh 8d 2c 10s');     // 都是牛牛，K > Q
  gt('Ks Ah 2d 3c 3s', 'Qs Ac 2c 3d 3h');      // 都没牛，K > Q
  gt('3s 3h 3d 3c Ks', '2s 2h 2d 2c Ks');      // 炸弹 3 > 炸弹 2
});
test('比较：牌型优先、花色顺序 ♠>♥>♣>♦', () => {
  assert.ok(D.compareHands(E('Kh Qh Jh 5h 5d'), E('2s 3h 5d 9c Ks')) > 0);  // 牛牛 > 牛9
  assert.ok(D.compareHands(E('3s 3h 3d 3c Ks'), E('2s 2h 2d 2c Ks')) > 0);  // 炸弹 3 > 炸弹 2
  assert.ok(D.compareHands(E('2s 2h 2d 2c Ah'), E('Ks Kh Qd Qc Js')) > 0);  // 2222A：和=9 → 五小牛 > 五花
  assert.ok(D.compareHands(E('As 2h 4d 6c 8s'), E('Ah 2s 4c 6d 8h')) > 0);  // 没牛：8♠ > 8♥
  assert.ok(D.compareHands(E('Ac 2h 4d 6s 8c'), E('Ah 2s 4c 6c 8d')) > 0);  // 没牛：8♣ > 8♦
  assert.ok(D.compareHands(E('Ks 2h 4d 6c 8s'), E('Qs Qh 4c 6d 8h')) > 0);  // 没牛：K > Q
});

/* ---------- 定庄 ---------- */
test('定庄：最高倍 / 并列随机 / 全不抢', () => {
  let r = D.resolveBanker([0, 2, 4, 1, 3], () => 0.5);
  assert.deepStrictEqual([r.banker, r.mult], [2, 4]);
  const seen = new Set();
  const rng = D.mulberry32(1);
  for (let i = 0; i < 200; i++) {
    r = D.resolveBanker([3, 1, 3, 0, 3], rng);
    assert.strictEqual(r.mult, 3);
    assert.deepStrictEqual(r.candidates, [0, 2, 4]);
    seen.add(r.banker);
  }
  assert.deepStrictEqual([...seen].sort(), [0, 2, 4]);
  r = D.resolveBanker([0, 0, 0, 0, 0], () => 0.99);
  assert.deepStrictEqual([r.banker, r.mult, r.candidates.length], [4, 1, 5]);
});

/* ---------- 结算 ---------- */
test('结算公式：底注 × 庄倍 × 押注 × 赢方倍数', () => {
  const ev = [E('Ks Qh Jd 5c 5s'), E('3s 7h Kd 2c 5h'), E('As 2h 4d 6c 8s'), E('2s 3h 5d 9c Kc'), E('7s 7h 7d 7c Kh')];
  // 庄家 = 0（牛牛 ×4），庄倍 3，底注 10
  const res = D.settle([1000, 1000, 1000, 1000, 1000], 0, 3, [0, 2, 1, 5, 3], ev, 10);
  assert.strictEqual(res.delta[1], -10 * 3 * 2 * 4);   // 牛7 输给牛牛：按庄家倍数 ×4
  assert.strictEqual(res.delta[2], -10 * 3 * 1 * 4);
  assert.strictEqual(res.delta[3], -10 * 3 * 5 * 4);
  assert.strictEqual(res.delta[4], 10 * 3 * 3 * 6);    // 炸弹赢：按炸弹倍数 ×6
  assert.strictEqual(res.delta.reduce((a, b) => a + b, 0), 0);
  assert.strictEqual(res.prorated, false);
});
test('结算：输家最多输光、庄家不够赔按比例', () => {
  const big = E('7s 7h 7d 7c Kh'), small = E('As 2h 4d 6c 8s');
  // 闲家只有 50 筹码却要输 10×4×5×6=1200 → 只输 50
  let res = D.settle([1000, 50, 1000, 1000, 1000], 0, 4, [0, 5, 1, 1, 1], [big, small, small, small, small], 10);
  assert.strictEqual(res.delta[1], -50);
  assert.strictEqual(res.delta.reduce((a, b) => a + b, 0), 0);
  // 庄家 100 筹码，三个闲家各赢 10×4×5×6=1200，另一个闲家输 10×4×1×1=40 → 可赔 140，按比例
  const strong1 = E('Ks Kh Kd Kc Qs'), strong2 = E('Qh Qd Qc Qs Jh'), strong3 = E('Js Jh Jd Jc 10s');
  res = D.settle([100, 1000, 1000, 1000, 1000], 0, 4, [0, 5, 5, 5, 1], [E('2s 3h 5d 9c Kc'), strong1, strong2, strong3, E('As 2h 4d 6c 8h')], 10);
  assert.strictEqual(res.prorated, true);
  assert.strictEqual(res.delta[4], -10 * 4 * 1 * 3);   // 输给牛9：×3
  const avail = 100 + 120;
  for (const i of [1, 2, 3]) assert.strictEqual(res.delta[i], Math.floor(1200 * avail / 3600));
  assert.strictEqual(res.delta.reduce((a, b) => a + b, 0), 0);
  assert.ok(100 + res.delta[0] >= 0);
});
test('结算随机性质：守恒且不出现负筹码', () => {
  const rng = D.mulberry32(9);
  const Hub = require('../js/common.js');
  for (let t = 0; t < 5000; t++) {
    const deck = Hub.shuffle(D.newDeck(), rng);
    const ev = [0, 1, 2, 3, 4].map(i => D.evalHand(deck.slice(i * 5, i * 5 + 5)));
    const chips = [0, 1, 2, 3, 4].map(() => 1 + Math.floor(rng() * 600));
    const banker = Math.floor(rng() * 5), mult = 1 + Math.floor(rng() * 4);
    const bets = chips.map((_, i) => (i === banker ? 0 : D.BET_OPTS[Math.floor(rng() * 4)]));
    const res = D.settle(chips, banker, mult, bets, ev, 10);
    assert.strictEqual(res.delta.reduce((a, b) => a + b, 0), 0);
    chips.forEach((c, i) => assert.ok(c + res.delta[i] >= 0));
  }
});

/* ---------- 概率表 ---------- */
test('基准分布常量表 = 精确枚举 C(52,5)', () => {
  const counts = D.enumerateBaseCounts();
  assert.deepStrictEqual(D.BASE_COUNTS, counts);
  assert.strictEqual(counts.reduce((a, b) => a + b, 0), 2598960);
  assert.ok(Math.abs(D.BASE_PI.reduce((a, b) => a + b, 0) - 1) < 1e-9);
});
test('零和：随机牌对随机牌的期望收益为 0', () => {
  let s = 0;
  for (let k = 0; k < D.KEY_COUNT; k++) {
    const p = D.TABLES.P[k];
    if (p > 0) s += p * D.edgeVs(k, D.TYPE_MULT[(k / D.KEY_STRIDE) | 0], D.BASE_PI).ev;
  }
  assert.ok(Math.abs(s) < 1e-9, String(s));
});
test('4 张牌分析：第 5 张的 48 种可能', () => {
  // KKK 已凑十，Q + 第 5 张决定牛几：10 → 牛牛（4 张）；J/Q → 五花（7 张）；K → 炸弹（1 张）；其余 x → 牛 x
  const a = D.analyze4(H('Ks Kh Kd Qs'));
  assert.strictEqual(a.outs.length, 48);
  assert.ok(Math.abs(a.typeProb.reduce((x, y) => x + y, 0) - 1) < 1e-9);
  assert.ok(Math.abs(a.typeProb[12] - 1 / 48) < 1e-9);
  assert.ok(Math.abs(a.typeProb[11] - 7 / 48) < 1e-9);
  assert.ok(Math.abs(a.typeProb[10] - 4 / 48) < 1e-9);
  assert.ok(Math.abs(a.typeProb[9] - 4 / 48) < 1e-9);
  assert.strictEqual(a.typeProb[0], 0);
  assert.ok(a.ev > 0.5, '三条 K 是强牌');
  const weak = D.analyze4(H('As 2h 4d 8c'));
  assert.ok(weak.ev < a.ev);
  assert.ok(a.var > 0 && weak.win < a.win);
});

/* ---------- AI ---------- */
test('各难度 AI 的决策合法且足够快', () => {
  const rng = D.mulberry32(5);
  const Hub = require('../js/common.js');
  for (let diff = 0; diff < 4; diff++) {
    const brain = new D.Brain(diff, rng, 'x');
    let maxMs = 0;
    for (let t = 0; t < 300; t++) {
      const hand = Hub.shuffle(D.newDeck(), rng).slice(0, 4);
      const chips = 50 + Math.floor(rng() * 2000);
      const t0 = Date.now();
      const g = brain.grab({ hand, chips, startChips: 1000, base: 10, opponents: ['a', 'b', 'c', 'd'] });
      const b = brain.bet({ hand, chips, startChips: 1000, base: 10, bankerId: 'a', bankerMult: 1 + (t % 4), bankerGrab: t % 5 });
      maxMs = Math.max(maxMs, Date.now() - t0);
      assert.ok(D.GRAB_OPTS.includes(g), `grab ${g}`);
      assert.ok(D.BET_OPTS.includes(b), `bet ${b}`);
    }
    assert.ok(maxMs < 60, `难度 ${diff} 单次决策 ${maxMs}ms`);
  }
});
test('困难 AI：强牌抢庄重押，弱牌不抢轻押；筹码少更保守', () => {
  const brain = new D.Brain(2, Math.random, 'h');
  const strong = H('Ks Kh Kd Qs'), weak = H('As 2h 4d 8c');
  const v = (hand, chips) => ({ hand, chips, startChips: 1000, base: 10, opponents: ['a', 'b', 'c', 'd'], bankerId: 'a', bankerMult: 2 });
  assert.ok(brain.grab(v(strong, 1000)) >= 2);
  assert.strictEqual(brain.grab(v(weak, 1000)), 0);
  assert.ok(brain.bet(v(strong, 1000)) >= 3);
  assert.strictEqual(brain.bet(v(weak, 1000)), 1);
  assert.ok(brain.bet(v(strong, 120)) <= brain.bet(v(strong, 3000)));
});
test('大师 AI：贝叶斯建模识破“空抢”', () => {
  const m = new D.Brain(3, Math.random, 'm');
  const prior = m.posterior('me', 'g4');
  // 你连续 12 局抢 ×4 当庄，亮出来全是没牛 / 小牛
  for (let i = 0; i < 12; i++) {
    m.observe({ forced: false, entries: [
      { id: 'me', grab: 4, bet: 0, isBanker: true, type: i % 3 === 0 ? 2 : 0 },
      { id: 'm', grab: 1, bet: 2, isBanker: false, type: 5 },
    ] });
  }
  const post = m.posterior('me', 'g4');
  assert.ok(post[0] > prior[0] + 0.25, '没牛的后验概率应明显上升');
  assert.ok(!m.models.m, '不给自己建模');
  // 同一手中等牌：面对“诈唬型”庄家押得不少于面对陌生庄家
  const hand = H('Ks 9h 5d 3c');
  const view = id => ({ hand, chips: 1000, startChips: 1000, base: 10, bankerId: id, bankerMult: 4, bankerGrab: 4 });
  const vsBluffer = m.bet(view('me')), vsUnknown = m.bet(view('stranger'));
  assert.ok(vsBluffer >= vsUnknown, `${vsBluffer} vs ${vsUnknown}`);
  const a1 = D.analyze4(hand, m.posterior('me', 'g4')), a2 = D.analyze4(hand, m.posterior('stranger', 'g4'));
  assert.ok(a1.ev > a2.ev + 0.2);
});

/* ---------- 无头自对弈 ---------- */
function checkedSelfPlay(diffs, rounds, seed, opts) {
  let n = 0;
  const stat = D.selfPlay(diffs, rounds, seed, Object.assign({}, opts, {
    onRound(res, seats) {
      n++;
      const ids = new Set(res.hands.flat().map(c => c.id));
      assert.strictEqual(ids.size, 25, '25 张牌互不重复');
      assert.strictEqual(res.delta.reduce((a, b) => a + b, 0), 0, '筹码守恒');
      seats.forEach(s => assert.ok(s.chips >= 0, '筹码不能为负'));
      res.grabs.forEach(g => assert.ok(D.GRAB_OPTS.includes(g)));
      const mx = Math.max(...res.grabs);
      if (!(opts && opts.forceBanker)) {
        assert.strictEqual(res.grabs[res.banker], mx);
        assert.strictEqual(res.bankerMult, mx || 1);
      } else assert.deepStrictEqual([res.banker, res.bankerMult], [0, 4]);
      res.bets.forEach((b, i) => assert.ok(i === res.banker ? b === 0 : D.BET_OPTS.includes(b)));
      res.evals.forEach((e, i) => assert.strictEqual(e.key, D.evalHand(res.hands[i]).key));
    },
  }));
  assert.strictEqual(n, rounds);
  return stat;
}
test('自对弈：四个难度各 150 局，规则不变量全部成立', () => {
  for (let d = 0; d < 4; d++) checkedSelfPlay([d, d, d, d, d], 150, 1000 + d);
  checkedSelfPlay([0, 1, 2, 3, 3], 150, 77, { forceBanker: true });
});

const SIM = process.argv.includes('--sim');
test(`难度对比：混合桌自对弈（${SIM ? '长' : '短'}）`, () => {
  const N = SIM ? 6000 : 1200;
  const lineups = [[0, 1, 2, 3, 0], [1, 2, 3, 0, 1], [2, 3, 0, 1, 2], [3, 0, 1, 2, 3], [0, 1, 2, 3, 1], [0, 1, 2, 3, 2], [0, 1, 2, 3, 3]];
  const tot = [0, 1, 2, 3].map(() => ({ profit: 0, n: 0, busts: 0, banker: 0 }));
  lineups.forEach((l, i) => {
    const st = D.selfPlay(l, N, 500 + i);
    for (const d in st) { tot[d].profit += st[d].profit; tot[d].n += st[d].seatRounds; tot[d].busts += st[d].busts; tot[d].banker += st[d].banker; }
  });
  const names = ['简单', '普通', '困难', '大师'];
  const avg = tot.map(t => t.profit / t.n);
  tot.forEach((t, d) => console.log(`   ${names[d]}：平均每局 ${avg[d] >= 0 ? '+' : ''}${avg[d].toFixed(2)}，坐庄率 ${(t.banker / t.n * 100).toFixed(1)}%，破产 ${t.busts} 次（${t.n} 座位局）`));
  assert.ok(avg[3] > avg[2] && avg[2] > avg[1] && avg[1] > avg[0], '应满足 大师 > 困难 > 普通 > 简单');
  // 一对一：大师 vs 困难（各 2 席 + 1 普通）
  const hm = D.selfPlay([2, 3, 2, 3, 1], N, 900);
  const h = hm[2].profit / hm[2].seatRounds, m = hm[3].profit / hm[3].seatRounds;
  console.log(`   困难 vs 大师 同桌：困难 ${h.toFixed(2)} / 大师 ${m.toFixed(2)} 每局`);
  assert.ok(m > h);
});

console.log(`
全部 ${passed} 项测试通过`);
