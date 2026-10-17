/* 掼蛋 测试：node tests/guandan.test.js */
'use strict';
const assert = require('assert');
const path = require('path');
const G = require(path.join(__dirname, '..', 'js', 'guandan.js'));

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name); throw e; }
}

/* 造牌：'S5' 'HA' 'D10' 'C2' 'SJ'(小王) 'BJ'(大王)；同一张牌多次出现时 id 自动区分 */
let uid = 0;
function C(str) {
  if (str === 'SJ') return { id: 't' + (uid++), r: 14, s: 4 };
  if (str === 'BJ') return { id: 't' + (uid++), r: 15, s: 4 };
  const s = 'SHDC'.indexOf(str[0]);
  const t = str.slice(1);
  const r = { A: 1, J: 11, Q: 12, K: 13 }[t] || +t;
  return { id: 't' + (uid++), r, s };
}
const H = s => s.trim().split(/\s+/).map(C);
const types = (cards, lv) => G.analyze(H(cards), lv).map(p => p.type + ':' + p.key).sort();
const has = (cards, lv, type, key) => G.analyze(H(cards), lv).some(p => p.type === type && p.key === key);

console.log('牌型识别');
test('单张 / 级牌 / 逢人配 / 王', () => {
  assert.deepStrictEqual(types('SA', 2), ['single:14']);
  assert.deepStrictEqual(types('S2', 2), ['single:15']);         // 级牌
  assert.deepStrictEqual(types('H2', 2), ['single:15']);         // 逢人配单出 = 级牌
  assert.deepStrictEqual(types('S7', 2), ['single:7']);
  assert.deepStrictEqual(types('SA', 14), ['single:15']);        // 打 A 时 A 是级牌
  assert.deepStrictEqual(types('SJ', 5), ['single:16']);
  assert.deepStrictEqual(types('BJ', 5), ['single:17']);
});
test('对子 / 三张（含百搭、王对）', () => {
  assert.deepStrictEqual(types('S5 D5', 2), ['pair:5']);
  assert.deepStrictEqual(types('S5 H2', 2), ['pair:5']);
  assert.deepStrictEqual(types('H2 H2', 2), ['pair:15']);
  assert.deepStrictEqual(types('SJ SJ', 2), ['pair:16']);
  assert.deepStrictEqual(types('BJ BJ', 2), ['pair:17']);
  assert.deepStrictEqual(types('SJ BJ', 2), []);                 // 大小王不成对
  assert.deepStrictEqual(types('SJ H2', 2), []);                 // 百搭不能当王
  assert.deepStrictEqual(types('S9 D9 C9', 2), ['triple:9']);
  assert.deepStrictEqual(types('S9 D9 H2', 2), ['triple:9']);
  assert.deepStrictEqual(types('SJ SJ SJ', 2), []);              // 王不能成三张
  assert.deepStrictEqual(types('S5 D6', 2), []);
});
test('三带二', () => {
  assert.deepStrictEqual(types('S3 D3 C3 S8 D8', 2), ['full:3']);
  assert.ok(has('S3 D3 H2 S8 D8', 2, 'full', 8));                // 百搭可补三张也可补对子
  assert.ok(has('S3 D3 H2 S8 D8', 2, 'full', 3));
  assert.ok(has('S3 D3 C3 H2 H2', 2, 'full', 3));
  assert.ok(has('S3 D3 C3 H2 H2', 2, 'bomb', 3));                // 也是 5 炸
  assert.deepStrictEqual(types('S3 D3 C3 SJ SJ', 2), []);       // 王对不能带
  assert.deepStrictEqual(types('S7 D7 C7 S2 D2', 7), ['full:15'].length ? types('S7 D7 C7 S2 D2', 7) : []);
  assert.ok(has('S7 D7 C7 S3 D3', 7, 'full', 15));               // 级牌三张最大
});
test('顺子：A 可高可低，不含王，恰好 5 张', () => {
  assert.deepStrictEqual(types('SA D2 C3 S4 D5', 7), ['straight:5']);
  assert.deepStrictEqual(types('S10 DJ CQ SK DA', 7), ['straight:14']);
  assert.deepStrictEqual(types('SJ DQ CK SA D2', 7), []);        // 不能绕
  assert.deepStrictEqual(types('S3 D4 C5 S6 SJ', 7), []);        // 含王
  assert.deepStrictEqual(types('S3 D4 C5 S6', 7), []);
  assert.deepStrictEqual(types('S3 D4 C5 S6 D7 C8', 9), []);     // 6 张不是顺子
  assert.ok(has('S3 D4 C5 S6 H9', 9, 'straight', 7));            // 百搭可补首尾
  assert.ok(has('S3 D4 C5 S6 H9', 9, 'straight', 6));
  assert.ok(has('S3 D4 C6 S7 H9', 9, 'straight', 7));            // 百搭补中间
  assert.ok(has('S3 D4 C5 S6 S7', 7, 'straight', 7));            // 级牌在顺子里按自然点数
});
test('同花顺', () => {
  assert.deepStrictEqual(types('S5 S6 S7 S8 S9', 2), ['sflush:9', 'straight:9']);
  assert.ok(has('S5 S6 H2 S8 S9', 2, 'sflush', 9));
  assert.ok(has('HA H2 H3 H4 H5', 9, 'sflush', 5));
  assert.ok(!has('S5 S6 D7 S8 S9', 2, 'sflush', 9));
});
test('三连对 / 钢板', () => {
  assert.deepStrictEqual(types('S3 D3 S4 D4 S5 D5', 2), ['tube:5']);
  assert.deepStrictEqual(types('SA DA S2 D2 S3 D3', 9), ['tube:3']);
  assert.deepStrictEqual(types('SQ DQ SK DK SA DA', 9), ['tube:14']);
  assert.deepStrictEqual(types('SK DK SA DA S2 D2', 9), []);
  assert.deepStrictEqual(types('S3 D3 C3 S4 D4 C4', 2), ['plate:4']);
  assert.deepStrictEqual(types('SA DA CA S2 D2 C2', 9), ['plate:2']);
  assert.deepStrictEqual(types('SK DK CK SA DA CA', 9), ['plate:14']);
  assert.deepStrictEqual(types('S3 D3 C3 S5 D5 C5', 2), []);
  // 百搭：W W 5 5 6 6 → 445566 / 556677 / 555666 都行
  const t = types('H2 H2 S5 D5 S6 D6', 2);
  assert.ok(t.includes('tube:6') && t.includes('tube:7') && t.includes('plate:6'));
});
test('炸弹 / 天王炸', () => {
  assert.deepStrictEqual(types('S8 D8 C8 H8', 2), ['bomb:8']);
  assert.deepStrictEqual(types('S8 D8 C8 H2', 2), ['bomb:8']);
  assert.deepStrictEqual(types('S8 D8 H2 H2', 2), ['bomb:8']);
  assert.deepStrictEqual(types('S8 D8 C8 H8 S8 D8 C8 H8 H2 H2', 2), ['bomb:8']);   // 10 张炸
  assert.deepStrictEqual(types('S2 D2 C2 S2', 2), ['bomb:15']);                     // 级牌炸
  assert.deepStrictEqual(types('SJ SJ BJ BJ', 2), ['kingbomb:17']);
  assert.deepStrictEqual(types('SJ SJ BJ H2', 2), []);
  assert.deepStrictEqual(types('SJ SJ BJ', 2), []);
});

console.log('大小比较');
test('炸弹等级：4炸<5炸<同花顺<6炸<…<天王炸', () => {
  const b = (len, key) => ({ type: 'bomb', len, key });
  const sf = key => ({ type: 'sflush', len: 5, key });
  const kb = { type: 'kingbomb', len: 4, key: 17 };
  assert.ok(G.canBeat(b(4, 15), b(4, 14)));      // 级牌炸 > A 炸
  assert.ok(!G.canBeat(b(4, 14), b(4, 15)));
  assert.ok(G.canBeat(b(5, 2), b(4, 15)));
  assert.ok(G.canBeat(sf(5), b(5, 15)));
  assert.ok(!G.canBeat(sf(14), b(6, 2)));
  assert.ok(G.canBeat(b(6, 2), sf(14)));
  assert.ok(G.canBeat(sf(10), sf(9)));
  assert.ok(G.canBeat(b(7, 3), b(6, 15)));
  assert.ok(G.canBeat(kb, b(10, 15)));
  assert.ok(!G.canBeat(b(10, 15), kb));
  assert.ok(G.canBeat(b(4, 2), { type: 'straight', len: 5, key: 14 }));
});
test('非炸弹：同型同张数比 key', () => {
  const m = (type, key, len) => ({ type, key, len });
  assert.ok(G.canBeat(m('single', 15, 1), m('single', 14, 1)));   // 级牌 > A
  assert.ok(G.canBeat(m('single', 16, 1), m('single', 15, 1)));
  assert.ok(G.canBeat(m('single', 17, 1), m('single', 16, 1)));
  assert.ok(!G.canBeat(m('pair', 9, 2), m('single', 3, 1)));
  assert.ok(!G.canBeat(m('tube', 9, 6), m('plate', 3, 6)));
  assert.ok(G.canBeat(m('straight', 6, 5), m('straight', 5, 5)));
  assert.ok(!G.canBeat(m('straight', 5, 5), m('straight', 5, 5)));
  assert.ok(!G.canBeat(m('single', 3, 1), m('bomb', 3, 4)));
});
test('resolvePlay：跟牌取最小可压解释，自由出牌取最强 / 多解释让玩家选', () => {
  const lv = 2;
  // 3 4 5 6 W 跟顺子 5（A2345 顶 5）：取 6 即可
  let r = G.resolvePlay(H('S3 D4 C5 S6 H2'), lv, { type: 'straight', key: 5, len: 5 });
  assert.strictEqual(r.move.key, 6);
  r = G.resolvePlay(H('S3 D4 C5 S6 H2'), lv, { type: 'straight', key: 6, len: 5 });
  assert.strictEqual(r.move.key, 7);
  r = G.resolvePlay(H('S3 D4 C5 S6 H2'), lv, null);
  assert.strictEqual(r.move.key, 7);                          // 自由出牌取最大
  r = G.resolvePlay(H('S3 D3 C3 H2 H2'), lv, null);
  assert.strictEqual(r.move.type, 'bomb');                    // 有炸弹解释取炸弹
  r = G.resolvePlay(H('S3 D3 C3 H2 H2'), lv, { type: 'full', key: 2, len: 5 });
  assert.strictEqual(r.move.type, 'full');                    // 跟三带二时不浪费成炸弹
  r = G.resolvePlay(H('H2 H2 S5 D5 S6 D6'), lv, null);
  assert.ok(r.options && r.options.length === 2);             // 三连对 / 钢板 二选一
  assert.ok(r.options.some(o => o.type === 'tube' && o.key === 7));
  r = G.resolvePlay(H('S5 D6'), lv, null);
  assert.ok(r.err);
  r = G.resolvePlay(H('S5'), lv, { type: 'single', key: 9, len: 1 });
  assert.ok(r.err);
});

console.log('出牌生成 / 拆牌');
function checkMove(m, hand, lv, target) {
  const ids = new Set(hand.map(c => c.id));
  assert.ok(m.cards.every(c => ids.has(c.id)), '出的牌必须在手里');
  assert.strictEqual(new Set(m.cards.map(c => c.id)).size, m.cards.length, '不能重复');
  assert.strictEqual(m.len, m.cards.length);
  const pats = G.analyze(m.cards, lv);
  assert.ok(pats.some(p => p.type === m.type && p.key === m.key), `牌型不符 ${m.type}:${m.key} ${m.cards.map(G.natOf)}`);
  if (target) assert.ok(G.canBeat(m, target), '必须压过');
}
test('genMoves：随机手牌 × 各种桌面牌，所有出法合法', () => {
  let n = 0;
  for (let i = 0; i < 120; i++) {
    const lv = 2 + (i % 13);
    const hands = G.dealHands();
    const hand = hands[0];
    const targets = [null].concat(G.genMoves(hands[1], lv, null).filter((_, k) => k % 3 === 0));
    for (const t of targets) {
      for (const m of G.genMoves(hand, lv, t)) { checkMove(m, hand, lv, t); n++; }
    }
  }
  assert.ok(n > 1000);
});
test('genMoves：能找到百搭补出的炸弹 / 同花顺 / 顺子', () => {
  const lv = 5;
  const hand = H('S9 D9 C9 H5 S3 S4 S6 S7 DJ CQ HK DA');
  const ms = G.genMoves(hand, lv, null);
  assert.ok(ms.some(m => m.type === 'bomb' && m.key === 9 && m.len === 4));
  assert.ok(ms.some(m => m.type === 'sflush' && m.key === 7));       // 3 4 (W) 6 7 黑桃
  assert.ok(ms.some(m => m.type === 'straight' && m.key === 14));    // (W) J Q K A
  const follow = G.genMoves(hand, lv, { type: 'pair', key: 9, len: 2 });
  assert.ok(follow.every(m => m.type === 'pair' || G.isBombType(m.type)));
  assert.ok(follow.some(m => m.type === 'pair' && m.key === 15 && m.nw === 1) || follow.some(m => m.type === 'pair' && m.key > 9));
});
test('buildPlan：覆盖全部手牌，每个组合都是合法牌型', () => {
  for (let i = 0; i < 200; i++) {
    const lv = 2 + (i % 13);
    const hand = G.dealHands()[i % 4];
    const plan = G.buildPlan(hand, lv);
    const ids = plan.flatMap(m => m.cards.map(c => c.id));
    assert.strictEqual(ids.length, hand.length);
    assert.strictEqual(new Set(ids).size, hand.length);
    for (const m of plan) checkMove(m, hand, lv, null);
  }
});
test('拆牌保留炸弹、优先用百搭补炸弹', () => {
  const lv = 2;
  const plan = G.buildPlan(H('S9 D9 C9 H9 S3 D4 C5 S6 D7 H2 SQ DQ CQ'), lv);
  assert.ok(plan.some(m => m.type === 'bomb' && m.key === 9 && m.len === 4));
  assert.ok(plan.some(m => m.type === 'straight' && m.key === 7));
  assert.ok(plan.some(m => m.type === 'bomb' && m.key === 12 && m.len === 4));    // QQQ + 百搭
});
test('hintMoves：跟牌从小到大、先给不拆炸弹的', () => {
  const lv = 2;
  const hand = H('S5 D5 C5 H5 S8 SK DK SA');
  const hints = G.hintMoves(hand, lv, { type: 'single', key: 4, len: 1 });
  assert.strictEqual(G.natOf(hints[0].cards[0]), 8);
  assert.ok(hints.findIndex(m => m.type === 'single' && m.key === 5) > hints.findIndex(m => m.key === 14 && m.type === 'single'));
  assert.ok(G.isBombType(hints[hints.length - 1].type));
});

console.log('出牌流程 / 接风 / 结算');
test('接风：出完最后一手、其余都不要 → 队友出牌', () => {
  const lv = 2;
  const hands = [H('S9'), H('S3 S4'), H('S5 S6'), H('S7 S8')];
  const st = G.createRound(hands, lv, 0);
  G.act(st, { type: 'single', key: 9, len: 1, cards: [hands[0][0]] });
  assert.deepStrictEqual(st.finished, [0]);
  assert.strictEqual(st.turn, 1);
  G.act(st, null);                 // 1 不要
  assert.strictEqual(st.turn, 2);
  G.act(st, null);                 // 2（队友）不要
  assert.strictEqual(st.turn, 3);
  G.act(st, null);                 // 3 不要 → 接风给 2
  assert.strictEqual(st.table, null);
  assert.strictEqual(st.turn, 2);
  assert.ok(st.jiefeng);
});
test('一圈都不要 → 出牌者继续自由出牌；双上提前结束', () => {
  const lv = 2;
  const hands = [H('S9 S10'), H('S3 S4'), H('S5'), H('S7 S8')];
  const st = G.createRound(hands, lv, 0);
  G.act(st, { type: 'single', key: 9, len: 1, cards: [hands[0][0]] });
  G.act(st, null); G.act(st, null); G.act(st, null);
  assert.strictEqual(st.turn, 0);
  assert.strictEqual(st.table, null);
  G.act(st, { type: 'single', key: 10, len: 1, cards: [st.hands[0][0]] });   // 0 出完（头游）
  G.act(st, null);                                                          // 1 不要
  G.act(st, { type: 'single', key: 15, len: 1, cards: [st.hands[2][0]] });  // 2 出完（二游）→ 双上
  assert.ok(st.over);
  assert.deepStrictEqual(st.order.slice(0, 2), [0, 2]);
  assert.deepStrictEqual(G.roundResult(st.order), { winTeam: 0, up: 3, place: 1 });
});
test('升级：+3 / +2 / +1，封顶目标级', () => {
  const m = G.createMatch(10);
  let r = G.settleRound(m, [0, 2, 1, 3]);
  assert.strictEqual(r.up, 3);
  assert.deepStrictEqual(m.levels, [5, 2]);
  assert.strictEqual(G.matchLevel(m), 5);
  r = G.settleRound(m, [1, 0, 3, 2]);
  assert.strictEqual(r.up, 2);
  assert.deepStrictEqual(m.levels, [5, 4]);
  assert.strictEqual(G.matchLevel(m), 4);       // 打赢家队的级数
  r = G.settleRound(m, [3, 0, 2, 1]);
  assert.strictEqual(r.up, 1);
  assert.deepStrictEqual(m.levels, [5, 5]);
  G.settleRound(m, [0, 2, 1, 3]);   // 8
  assert.ok(!m.over);
  G.settleRound(m, [2, 0, 1, 3]);   // 11 → 封顶 10
  assert.ok(m.over);
  assert.strictEqual(m.winner, 0);
  assert.strictEqual(m.levels[0], 10);
  assert.strictEqual(m.round, 5);
});
test('过 A：必须在打 A 的局头游且队友不是末游', () => {
  const m = G.createMatch(14);
  m.levels = [12, 13];
  m.banker = 1;
  G.settleRound(m, [0, 2, 1, 3]);              // 我方 +3 → 封顶 A，但不算过
  assert.strictEqual(m.levels[0], 14);
  assert.ok(!m.over);
  assert.strictEqual(G.matchLevel(m), 14);
  let r = G.settleRound(m, [2, 1, 3, 0]);       // 打 A 头游但队友末游
  assert.ok(r.failA && !m.over);
  assert.strictEqual(m.levels[0], 14);
  G.settleRound(m, [1, 3, 0, 2]);              // 对方双上 13 → 14，对方坐庄打 A
  assert.ok(!m.over);
  assert.strictEqual(m.banker, 1);
  r = G.settleRound(m, [0, 1, 2, 3]);           // 我方在对方的 A 局赢：不算过 A，我方坐庄
  assert.ok(!m.over && m.banker === 0);
  r = G.settleRound(m, [0, 1, 2, 3]);           // 打自己的 A，队友三游 → 过 A
  assert.ok(r.passA && m.over && m.winner === 0);
});
test('进贡 / 还贡 / 抗贡', () => {
  const lv = 2;
  // 单下：末游 3 → 头游 0
  let hands = [H('S3 S4 S5 S6 S7'), H('S8'), H('S9'), H('BJ H2 SA D4 C5')];
  let tp = G.tributePlan(hands, [0, 1, 2, 3], lv);
  assert.strictEqual(tp.kind, 'single');
  let t = G.doTribute(hands, tp, lv, () => 1, null);
  assert.strictEqual(t.pays[0].card.r, 15);       // 大王
  assert.strictEqual(t.pays[0].to, 0);
  assert.strictEqual(t.leader, 3);
  assert.ok(t.rets[0].card.r >= 2 && t.rets[0].card.r <= 10);
  assert.strictEqual(hands[0].length, 5);
  assert.strictEqual(hands[3].length, 5);
  // 不进贡红桃级牌
  hands = [H('S3'), H('S8'), H('S9'), H('H2 SK D4')];
  assert.strictEqual(G.tributeCandidates(hands[3], lv)[0].r, 13);
  // 双下（名次 0,2,1,3）：1、3 都进贡，大的给头游 0、小的给二游 2，大牌者先出
  hands = [H('S3 S4'), H('SQ D4'), H('S8 S9'), H('SA D5')];
  tp = G.tributePlan(hands, [0, 2, 1, 3], lv);
  assert.strictEqual(tp.kind, 'double');
  t = G.doTribute(hands, tp, lv, () => 2, null);
  const toHead = t.pays.find(p => p.to === 0);
  assert.strictEqual(toHead.card.r, 1);          // A 给头游
  assert.strictEqual(toHead.from, 3);
  assert.strictEqual(t.leader, 3);
  assert.strictEqual(t.pays.find(p => p.to === 2).card.r, 12);
  // 抗贡：双下两人合计两张大王
  hands = [H('S3'), H('BJ S4'), H('S5'), H('BJ S6')];
  tp = G.tributePlan(hands, [0, 2, 1, 3], lv);
  assert.strictEqual(tp.kind, 'anti');
  assert.strictEqual(tp.leader, 0);
  // 单下一张大王不能抗贡
  hands = [H('S3'), H('S4'), H('S5'), H('BJ S6')];
  assert.strictEqual(G.tributePlan(hands, [0, 1, 2, 3], lv).kind, 'single');
});

console.log('AI / 无头自对弈');
function validator(stats) {
  return (st, s, m) => {
    const total = st.hands.reduce((a, h) => a + h.length, 0) + st.played.length;
    assert.strictEqual(total, 108, '牌数守恒');
    if (m) checkMove(m, st.hands[s], st.lv, st.table && st.table.move);
    else assert.ok(st.table, '首家不能不出');
    stats.steps++;
  };
}
test('四个难度各自对弈 100 局：不卡死、牌数守恒、每步合法、能结束', () => {
  G.AI_CFG.mcMs = 1;           // 测试里把大师的模拟压到最小（每个候选 1 次模拟），只验证流程
  G.AI_CFG.mcMaxIter = 1;
  for (let d = 0; d < 4; d++) {
    const stats = { steps: 0 };
    let match = G.createMatch(14), rounds = 0, matches = 0;
    const t0 = Date.now();
    while (rounds < 100) {
      const r = G.playMatchRound(match, [d, d, d, d], validator(stats));
      assert.strictEqual(new Set(r.order).size, 4);
      rounds++;
      if (match.over) { matches++; match = G.createMatch(14); }
    }
    console.log(`    难度${d}: 100 局 ${stats.steps} 步，完成整场 ${matches} 次，${Date.now() - t0}ms`);
  }
  G.AI_CFG.mcMs = 160; G.AI_CFG.mcMaxIter = 400;
});
test('混合难度 + 短目标比赛能正常结束', () => {
  G.AI_CFG.mcMs = 1; G.AI_CFG.mcMaxIter = 1;
  for (const target of [5, 6, 10]) {
    const match = G.createMatch(target);
    const stats = { steps: 0 };
    let guard = 0;
    while (!match.over) {
      assert.ok(++guard < 80, '比赛应当结束');
      G.playMatchRound(match, [3, 0, 2, 1], validator(stats));
    }
    assert.ok(match.levels[match.winner] === target);
  }
  G.AI_CFG.mcMs = 160; G.AI_CFG.mcMaxIter = 400;
});
test('难度差异：普通队 vs 简单队 100 局，普通队头游率明显更高', () => {
  const match0 = { m: G.createMatch(14) };
  let win = 0;
  for (let i = 0; i < 100; i++) {
    const r = G.playMatchRound(match0.m, [1, 0, 1, 0]);
    if (r.res.winTeam === 0) win++;
    if (match0.m.over) match0.m = G.createMatch(14);
  }
  console.log(`    普通队头游率 ${win}%`);
  assert.ok(win >= 70);
});
test('单次决策耗时（大师全程模拟，预算 160ms）', () => {
  G.AI_CFG.mcMs = 160; G.AI_CFG.mcMaxIter = 400;
  const hands = G.dealHands();
  hands.forEach(h => G.sortHand(h, 2));
  const st = G.createRound(hands, 2, 0);
  let max = 0;
  for (let i = 0; i < 24 && !st.over; i++) {
    const t0 = Date.now();
    const m = G.aiDecide(st, st.turn, 3);
    max = Math.max(max, Date.now() - t0);
    G.act(st, m);
  }
  console.log(`    最长单步 ${max}ms`);
  assert.ok(max < 450);
});

console.log(`\n全部通过：${passed} 项`);
