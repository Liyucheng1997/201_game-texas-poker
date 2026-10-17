/* 德州扑克：牌力评估 / 边池 / 范围胜率 / 难度自对弈
   运行：node tests/texas.test.js  （加 --sim 跑更长的难度对比） */
'use strict';
const assert = require('assert');
// 让 AI 停顿立即完成
global.Hub = { wait: () => Promise.resolve() };
const T = require('../js/texas.js');

const C = s => {
  const m = s.match(/^(10|[2-9JQKA])([shdc])$/);
  const r = { J: 11, Q: 12, K: 13, A: 14 }[m[1]] || +m[1];
  return { r, s: 'shdc'.indexOf(m[2]) };
};
const H = str => str.split(' ').map(C);

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { console.error('✗', name); throw e; }
}

test('牌型识别', () => {
  assert.deepStrictEqual(T.rank5(H('As Ks Qs Js 10s')), [8, 14]);
  assert.deepStrictEqual(T.rank5(H('As 2d 3c 4h 5s')), [4, 5]);
  assert.strictEqual(T.rank5(H('9s 9d 9c 4h 4s'))[0], 6);
  assert.strictEqual(T.handName(T.rank5(H('As Ks Qs Js 10s'))), '皇家同花顺');
});

test('7 张取最优', () => {
  const ev = T.evaluateBest(H('Ah Kh'), H('Qh Jh 10h 2c 3d'));
  assert.deepStrictEqual(ev.val, [8, 14]);
});

test('边池分配', () => {
  const a = { total: 100, folded: false }, b = { total: 300, folded: false }, c = { total: 300, folded: true };
  const pots = T.buildPots([a, b, c]);
  assert.strictEqual(pots.reduce((s, p) => s + p.amount, 0), 700);
  assert.strictEqual(pots[0].amount, 300);
  assert.deepStrictEqual(pots[0].eligible, [a, b]);
});

test('起手牌百分位', () => {
  assert.ok(T.holePct(...H('As Ad')) > 0.98);
  assert.ok(T.holePct(...H('7c 2d')) < 0.1);
  assert.ok(T.holePct(...H('Ks Qs')) > T.holePct(...H('Ks 7d')));
});

test('范围加权胜率：对紧手加注者，中等牌胜率下降', () => {
  const hole = H('Ac 9d');
  const vsRandom = T.equityRange(hole, [], [{ minPct: 0, loosePass: 1, betStreets: 0, bluff: 1 }], 3000);
  const vsTight = T.equityRange(hole, [], [{ minPct: 0.9, loosePass: 0.05, betStreets: 0, bluff: 1 }], 3000);
  assert.ok(vsRandom > 0.55, 'A9 对随机牌应占优 ' + vsRandom);
  assert.ok(vsTight < vsRandom - 0.12, `对紧范围应明显变差 ${vsTight} vs ${vsRandom}`);
});

test('范围加权胜率：翻后连续下注的对手更可能有牌', () => {
  const hole = H('Kc Qd'), board = H('Kh 7s 2d');
  const passive = T.equityRange(hole, board, [{ minPct: 0, loosePass: 1, betStreets: 0, bluff: 1 }], 3000);
  const aggressive = T.equityRange(hole, board, [{ minPct: 0, loosePass: 1, betStreets: 2, bluff: 0.1 }], 3000);
  assert.ok(aggressive < passive - 0.05, `${aggressive} vs ${passive}`);
});

/* ---------- 难度自对弈：一半座位用高难度，一半用低难度，比较平均每手盈亏 ---------- */
async function duel(hiIdx, loIdx, hands) {
  const res = { hi: 0, lo: 0 };
  for (let flip = 0; flip < 2; flip++) {
    T.newGame({ opponents: 5, startChips: 2000 }, 1);
    const st = T.state;
    st.players[0].isHuman = false;
    st.players[0].personality = { ...st.players[4].personality, name: '测试' };
    st.players[0].name = '测试';
    st.players.forEach((p, i) => { p.aiLevel = T.AI_LEVELS[(i + flip) % 2 === 0 ? hiIdx : loIdx]; });
    st.running = false;   // 每次只打一手
    for (let h = 0; h < hands / 2; h++) {
      for (const p of st.players) { p.chips = 2000; p.out = false; }
      st.handNum = 0;      // 固定盲注级别
      // eslint-disable-next-line no-await-in-loop
      await T.playHandForTest();
      st.players.forEach((p, i) => { res[(i + flip) % 2 === 0 ? 'hi' : 'lo'] += p.chips - 2000; });
    }
  }
  return { hi: res.hi / hands / 3, lo: res.lo / hands / 3 };
}

(async () => {
  const sim = process.argv.includes('--sim');
  const hands = sim ? 1000 : 30;
  for (const [hi, lo] of [[1, 0], [3, 0], [3, 1]]) {
    const r = await duel(hi, lo, hands);
    console.log(`  ${T.AI_LEVELS[hi].id} vs ${T.AI_LEVELS[lo].id}：每人每手平均 ${r.hi.toFixed(1)} vs ${r.lo.toFixed(1)} 筹码（${hands} 手）`);
    if (sim) assert.ok(r.hi > r.lo, '高难度应当赢筹码');
  }
  console.log(`✓ 德州扑克 ${passed} 项测试通过`);
})().catch(e => { console.error(e); process.exit(1); });
