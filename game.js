/* ============================================================
   德州扑克 · Texas Hold'em
   单机版：玩家 vs 5 个AI（各有性格），锦标赛模式，盲注递增
   ============================================================ */
'use strict';

/* ---------------- 基础工具 ---------------- */
const SUITS = ['♠', '♥', '♦', '♣'];           // 0黑桃 1红心 2方块 3梅花
const RANK_NAMES = { 2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A' };

function makeDeck() {
  const d = [];
  for (let s = 0; s < 4; s++)
    for (let r = 2; r <= 14; r++) d.push({ r, s });
  return d;
}
function shuffle(a, rng) {
  const rand = rng || Math.random;
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function cardStr(c) { return RANK_NAMES[c.r] + SUITS[c.s]; }
function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }
function randPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/* ---------------- 牌力评估 ----------------
   rank5: 5张牌 → 数值数组（可按字典序比较）
   类别: 8同花顺 7四条 6葫芦 5同花 4顺子 3三条 2两对 1一对 0高牌 */
function rank5(cs) {
  const rs = cs.map(c => c.r).sort((a, b) => b - a);
  const flush = cs.every(c => c.s === cs[0].s);
  // 顺子（含 A-5）
  let straightHigh = 0;
  const uniq = [...new Set(rs)];
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5; // A2345
  }
  if (flush && straightHigh) return [8, straightHigh];
  // 计数
  const cnt = {};
  for (const r of rs) cnt[r] = (cnt[r] || 0) + 1;
  const groups = Object.entries(cnt)
    .map(([r, n]) => [n, +r])
    .sort((a, b) => (b[0] - a[0]) || (b[1] - a[1]));
  if (groups[0][0] === 4) return [7, groups[0][1], groups[1][1]];
  if (groups[0][0] === 3 && groups[1][0] === 2) return [6, groups[0][1], groups[1][1]];
  if (flush) return [5, ...rs];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][0] === 3) return [3, groups[0][1], groups[1][1], groups[2][1]];
  if (groups[0][0] === 2 && groups[1][0] === 2)
    return [2, groups[0][1], groups[1][1], groups[2][1]];
  if (groups[0][0] === 2) return [1, groups[0][1], groups[1][1], groups[2][1], groups[3][1]];
  return [0, ...rs];
}
function cmpEval(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}
// 7选5的所有组合索引（21组）
const COMBOS7 = (() => {
  const out = [];
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 4; b++) for (let c = b + 1; c < 5; c++)
    for (let d = c + 1; d < 6; d++) for (let e = d + 1; e < 7; e++) out.push([a, b, c, d, e]);
  return out;
})();
// 返回 { val, cards }：最佳牌值和构成它的5张牌
function evaluate7(cards) {
  let best = null, bestCards = null;
  for (const idx of COMBOS7) {
    const hand = idx.map(i => cards[i]);
    const v = rank5(hand);
    if (!best || cmpEval(v, best) > 0) { best = v; bestCards = hand; }
  }
  return { val: best, cards: bestCards };
}
function evaluateBest(hole, community) {
  const all = [...hole, ...community];
  if (all.length === 5) { return { val: rank5(all), cards: all.slice() }; }
  if (all.length === 6) {
    let best = null, bc = null;
    for (let skip = 0; skip < 6; skip++) {
      const hand = all.filter((_, i) => i !== skip);
      const v = rank5(hand);
      if (!best || cmpEval(v, best) > 0) { best = v; bc = hand; }
    }
    return { val: best, cards: bc };
  }
  return evaluate7(all);
}
const CAT_NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];
function handName(val) {
  if (val[0] === 8 && val[1] === 14) return '皇家同花顺';
  let n = CAT_NAMES[val[0]];
  if (val[0] === 1 || val[0] === 3 || val[0] === 7) n += ' ' + RANK_NAMES[val[1]];
  if (val[0] === 2) n = `两对 ${RANK_NAMES[val[1]]}+${RANK_NAMES[val[2]]}`;
  if (val[0] === 6) n = `葫芦 ${RANK_NAMES[val[1]]}带${RANK_NAMES[val[2]]}`;
  if (val[0] === 0) n = `高牌 ${RANK_NAMES[val[1]]}`;
  if (val[0] === 4 || val[0] === 8) n += ` (${RANK_NAMES[val[1]]}高)`;
  if (val[0] === 5) n += ` (${RANK_NAMES[val[1]]}高)`;
  return n;
}

/* ---------------- 蒙特卡洛胜率 ---------------- */
function equityMC(hole, community, nOpp, iters) {
  if (nOpp <= 0) return 1;
  const known = new Set([...hole, ...community].map(c => c.r * 4 + c.s));
  const pool = makeDeck().filter(c => !known.has(c.r * 4 + c.s));
  let win = 0, tie = 0;
  const need = 5 - community.length;
  for (let t = 0; t < iters; t++) {
    // 部分洗牌：只需要前 need + nOpp*2 张
    const take = need + nOpp * 2;
    for (let i = 0; i < take; i++) {
      const j = i + Math.floor(Math.random() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const board = community.concat(pool.slice(0, need));
    const my = evaluateBest(hole, board).val;
    let beaten = false, tied = false;
    for (let o = 0; o < nOpp; o++) {
      const oh = pool.slice(need + o * 2, need + o * 2 + 2);
      const ov = evaluateBest(oh, board).val;
      const c = cmpEval(ov, my);
      if (c > 0) { beaten = true; break; }
      if (c === 0) tied = true;
    }
    if (!beaten) { if (tied) tie++; else win++; }
  }
  return (win + tie / 2) / iters;
}

/* ---------------- AI 性格 ---------------- */
const PERSONALITIES = [
  {
    name: '老狐狸', emoji: '🦊', loose: 0.35, aggr: 0.75, bluff: 0.18,
    quips: {
      raise: ['嗅到血腥味了~', '这把我要了。', '加点料，谁怕谁？'],
      allin: ['狐狸出洞，全下！', '梭了！心脏受得了吗？'],
      call: ['跟你看看。', '让我瞧瞧你的底细。'],
      fold: ['不上钩，撤了。', '这陷阱味太冲，弃。'],
      win: ['姜还是老的辣~', '嘿嘿，都进我口袋了。'],
      lose: ['大意了……', '算你走运。'],
      check: ['先看看风向。'],
    },
  },
  {
    name: '疯狗阿豪', emoji: '🐺', loose: 0.85, aggr: 0.9, bluff: 0.35,
    quips: {
      raise: ['干就完了！加注！', '怂什么？跟上啊！', '这点钱也叫下注？'],
      allin: ['全下！！！刺激！', '要么翻倍要么回家！'],
      call: ['跟！眨眼算我输！', '来啊来啊！'],
      fold: ['切，没劲。', '这把让给你们。'],
      win: ['哈哈哈哈全是我的！', '就这？就这？'],
      lose: ['不可能！再来！', '下把双倍赢回来！'],
      check: ['过……先忍一手。'],
    },
  },
  {
    name: '石头哥', emoji: '🗿', loose: 0.18, aggr: 0.35, bluff: 0.04,
    quips: {
      raise: ['……加注。', '（默默推出筹码）'],
      allin: ['……全下。（这很不石头）'],
      call: ['……跟。', '嗯。'],
      fold: ['弃。', '……（摇头）'],
      win: ['稳。', '……（嘴角微微上扬）'],
      lose: ['……', '（面无表情地看着筹码离开）'],
      check: ['过。'],
    },
  },
  {
    name: '教授', emoji: '🤓', loose: 0.45, aggr: 0.6, bluff: 0.12,
    quips: {
      raise: ['期望值为正，加注。', '根据凯利公式，这里应该下注。', '概率站在我这边。'],
      allin: ['方差有点大，但值得。全下。'],
      call: ['赔率合适，跟注。', '底池赔率3:1，可以跟。'],
      fold: ['胜率不足，弃牌是最优解。', '数学不会说谎，弃。'],
      win: ['一切尽在计算之中。', 'QED. 证明完毕。'],
      lose: ['小概率事件也是会发生的。', '样本量还不够大。'],
      check: ['信息不足，过牌观察。'],
    },
  },
  {
    name: '甜甜', emoji: '🐱', loose: 0.7, aggr: 0.3, bluff: 0.08,
    quips: {
      raise: ['人家也要加注试试~', '这把感觉好好哦！'],
      allin: ['呀！全、全下！好紧张！'],
      call: ['跟一个嘛，说不定有惊喜~', '好奇好奇，跟！'],
      fold: ['呜呜，牌好烂，不玩了。', '这把pass~'],
      win: ['耶！赢啦赢啦！', '喵哈哈，谢谢款待~'],
      lose: ['呜……我的筹码……', '不哭不哭，下把再来。'],
      check: ['过~先观望一下。'],
    },
  },
];

/* ---------------- 游戏状态 ---------------- */
const START_CHIPS = 2000;
const BLIND_LEVELS = [[10, 20], [15, 30], [25, 50], [40, 80], [60, 120], [100, 200], [150, 300], [250, 500]];
const HANDS_PER_LEVEL = 8;

const state = {
  players: [],       // {id,name,emoji,chips,hole,bet,total,folded,allin,out,acted,isHuman,personality,revealed}
  community: [],
  deck: [],
  dealer: 0,
  handNum: 0,
  blindLevel: 0,
  currentBet: 0,
  minRaise: 0,
  pot: 0,            // 已收集入池（不含本街 bet）
  street: 'idle',    // idle|preflop|flop|turn|river|showdown
  running: false,
  humanResolver: null,
  showEquity: false,
  muted: false,
  log: [],
  stats: { handsPlayed: 0, potsWon: 0, biggestPot: 0 },
};

function newGame() {
  state.players = [];
  state.players.push({
    id: 0, name: '你', emoji: '😎', isHuman: true,
    chips: START_CHIPS, hole: [], bet: 0, total: 0,
    folded: false, allin: false, out: false, acted: false, revealed: false,
    personality: null,
  });
  PERSONALITIES.forEach((p, i) => {
    state.players.push({
      id: i + 1, name: p.name, emoji: p.emoji, isHuman: false,
      chips: START_CHIPS, hole: [], bet: 0, total: 0,
      folded: false, allin: false, out: false, acted: false, revealed: false,
      personality: p,
    });
  });
  state.dealer = Math.floor(Math.random() * 6);
  state.handNum = 0;
  state.blindLevel = 0;
  state.log = [];
  state.stats = { handsPlayed: 0, potsWon: 0, biggestPot: 0 };
  addLog('🎲 新的锦标赛开始！每人 ' + START_CHIPS + ' 筹码，盲注每 ' + HANDS_PER_LEVEL + ' 手上涨。');
}

function blinds() { return BLIND_LEVELS[Math.min(state.blindLevel, BLIND_LEVELS.length - 1)]; }
function alivePlayers() { return state.players.filter(p => !p.out); }
function inHandPlayers() { return state.players.filter(p => !p.out && !p.folded && p.inHand); }
function potTotal() { return state.pot + state.players.reduce((s, p) => s + p.bet, 0); }

function addLog(msg) {
  state.log.push(msg);
  if (state.log.length > 200) state.log.shift();
  if (typeof document !== 'undefined') renderLog();
}

/* ---------------- 边池计算 ----------------
   contribs: [{player, total, folded}] → [{amount, eligible:[player]}] */
function buildPots(contribPlayers) {
  const levels = [...new Set(contribPlayers.filter(p => !p.folded).map(p => p.total))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const L of levels) {
    let amt = 0;
    for (const p of contribPlayers) amt += Math.max(0, Math.min(p.total, L) - Math.min(p.total, prev));
    const eligible = contribPlayers.filter(p => !p.folded && p.total >= L);
    if (amt > 0) pots.push({ amount: amt, eligible });
    prev = L;
  }
  // 弃牌者超出最高级别的多余投入 → 并入最后一个池
  const distributed = pots.reduce((s, p) => s + p.amount, 0);
  const totalIn = contribPlayers.reduce((s, p) => s + p.total, 0);
  const leftover = totalIn - distributed;
  if (leftover > 0 && pots.length) pots[pots.length - 1].amount += leftover;
  return pots;
}

/* ---------------- 一手牌流程 ---------------- */
async function playHand() {
  const alive = alivePlayers();
  if (alive.length < 2) return endTournament();

  state.handNum++;
  state.stats.handsPlayed++;
  if (state.handNum > 1 && (state.handNum - 1) % HANDS_PER_LEVEL === 0 && state.blindLevel < BLIND_LEVELS.length - 1) {
    state.blindLevel++;
    const [sb, bb] = blinds();
    addLog(`📈 盲注上涨！现在是 ${sb}/${bb}`);
    showBanner(`📈 盲注上涨：${sb}/${bb}`, 1400);
    await sleep(1400);
  }

  // 重置
  state.community = [];
  state.pot = 0;
  state.street = 'preflop';
  for (const p of state.players) {
    p.hole = []; p.bet = 0; p.total = 0;
    p.folded = false; p.allin = false; p.acted = false; p.revealed = false;
    p.inHand = !p.out;
    p.lastAction = '';
  }
  state.deck = shuffle(makeDeck());

  // 移动庄家
  state.dealer = nextAlive(state.dealer);
  const [sb, bb] = blinds();
  const headsUp = alive.length === 2;
  const sbIdx = headsUp ? state.dealer : nextAlive(state.dealer);
  const bbIdx = nextAlive(sbIdx);

  addLog(`—— 第 ${state.handNum} 手 · 盲注 ${sb}/${bb} · 庄家：${state.players[state.dealer].name} ——`);

  postBlind(state.players[sbIdx], sb, '小盲');
  postBlind(state.players[bbIdx], bb, '大盲');
  state.currentBet = bb;
  state.minRaise = bb;

  // 发底牌
  for (const p of alive) p.hole = [state.deck.pop(), state.deck.pop()];
  render();
  sfx('deal');
  await sleep(500);

  // 翻前
  await bettingRound(nextAlive(bbIdx));
  if (await maybeEndByFolds()) return;

  // 翻牌
  collectBets();
  state.street = 'flop';
  state.community.push(state.deck.pop(), state.deck.pop(), state.deck.pop());
  addLog(`🃏 翻牌: ${state.community.map(cardStr).join(' ')}`);
  sfx('deal'); render();
  await sleep(700);
  await streetBetting();
  if (await maybeEndByFolds()) return;

  // 转牌
  collectBets();
  state.street = 'turn';
  state.community.push(state.deck.pop());
  addLog(`🃏 转牌: ${cardStr(state.community[3])}`);
  sfx('deal'); render();
  await sleep(700);
  await streetBetting();
  if (await maybeEndByFolds()) return;

  // 河牌
  collectBets();
  state.street = 'river';
  state.community.push(state.deck.pop());
  addLog(`🃏 河牌: ${cardStr(state.community[4])}`);
  sfx('deal'); render();
  await sleep(700);
  await streetBetting();
  if (await maybeEndByFolds()) return;

  collectBets();
  await showdown();
}

function nextAlive(idx) {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const j = (idx + i) % n;
    if (!state.players[j].out) return j;
  }
  return idx;
}

function postBlind(p, amt, label) {
  const pay = Math.min(amt, p.chips);
  p.chips -= pay;
  p.bet += pay;
  if (p.chips === 0) { p.allin = true; p.lastAction = '全下'; }
  addLog(`${p.name} 下${label} ${pay}`);
}

function collectBets() {
  for (const p of state.players) {
    p.total += p.bet;
    state.pot += p.bet;
    p.bet = 0;
    p.acted = false;
    p.lastAction = p.folded ? '弃牌' : (p.allin ? '全下' : '');
  }
  state.currentBet = 0;
  state.minRaise = blinds()[1];
}

// 若街上可行动者不足2人，直接快进（发完公共牌并亮牌）
async function streetBetting() {
  const contenders = state.players.filter(p => p.inHand && !p.folded);
  const canAct = contenders.filter(p => !p.allin && p.chips > 0);
  if (contenders.length >= 2 && canAct.length <= 1) {
    await revealAllInDrama();
    return;
  }
  await bettingRound(nextAlive(state.dealer));
}

let allInRevealed = false;
async function revealAllInDrama() {
  if (allInRevealed) return;
  allInRevealed = true;
  for (const p of state.players) if (p.inHand && !p.folded) p.revealed = true;
  addLog('💥 全下对决！亮牌！');
  sfx('allin');
  render();
  await sleep(1200);
}

async function bettingRound(startIdx) {
  for (const p of state.players) p.acted = false;
  let idx = startIdx;
  let guard = 0;
  while (guard++ < 500) {
    const contenders = state.players.filter(p => p.inHand && !p.folded);
    if (contenders.length <= 1) return;
    const canAct = contenders.filter(p => !p.allin);
    if (canAct.length === 0) return;
    if (canAct.every(p => p.acted && p.bet === state.currentBet)) return;

    const p = state.players[idx];
    idx = (idx + 1) % state.players.length;
    if (!p.inHand || p.folded || p.allin || p.out) continue;
    if (p.acted && p.bet === state.currentBet) continue;

    render();
    if (p.isHuman) {
      await humanAction(p);
    } else {
      await sleep(500 + Math.random() * 700);
      await aiAction(p);
    }
    render();
  }
}

/* ---------------- 行动执行 ---------------- */
function doFold(p) {
  p.folded = true;
  p.lastAction = '弃牌';
  addLog(`${p.name} 弃牌`);
  sfx('fold');
  if (!p.isHuman) maybeQuip(p, 'fold', 0.35);
}
function doCheck(p) {
  p.acted = true;
  p.lastAction = '过牌';
  addLog(`${p.name} 过牌`);
  if (!p.isHuman) maybeQuip(p, 'check', 0.2);
}
function doCall(p) {
  const need = Math.min(state.currentBet - p.bet, p.chips);
  p.chips -= need;
  p.bet += need;
  p.acted = true;
  if (p.chips === 0) { p.allin = true; p.lastAction = '全下跟注'; addLog(`${p.name} 全下跟注 ${need}`); sfx('allin'); }
  else { p.lastAction = `跟注 ${need}`; addLog(`${p.name} 跟注 ${need}`); sfx('chip'); }
  if (!p.isHuman) maybeQuip(p, 'call', 0.25);
}
// raiseTo: 本街总下注额
function doRaiseTo(p, raiseTo) {
  raiseTo = Math.min(raiseTo, p.bet + p.chips);
  const add = raiseTo - p.bet;
  const isRaise = raiseTo > state.currentBet;
  p.chips -= add;
  p.bet = raiseTo;
  p.acted = true;
  if (isRaise) {
    state.minRaise = Math.max(state.minRaise, raiseTo - state.currentBet);
    state.currentBet = raiseTo;
    for (const q of state.players) if (q !== p && !q.folded && !q.allin) q.acted = false;
    p.acted = true;
  }
  if (p.chips === 0) {
    p.allin = true;
    p.lastAction = '全下 ' + raiseTo;
    addLog(`${p.name} 全下 ${raiseTo}！`);
    sfx('allin');
    if (!p.isHuman) maybeQuip(p, 'allin', 0.9);
  } else {
    p.lastAction = (state.street === 'preflop' || state.currentBet > raiseTo ? '加注到 ' : '下注 ') + raiseTo;
    addLog(`${p.name} ${isRaise ? '加注到' : '下注'} ${raiseTo}`);
    sfx('chip');
    if (!p.isHuman) maybeQuip(p, 'raise', 0.4);
  }
}

/* ---------------- AI 决策 ---------------- */
async function aiAction(p) {
  const pers = p.personality;
  const opp = state.players.filter(q => q.inHand && !q.folded && q !== p).length;
  const iters = state.street === 'preflop' ? 90 : 140;
  const eq = equityMC(p.hole, state.community, opp, iters);
  const toCall = state.currentBet - p.bet;
  const pot = potTotal();
  const rand = Math.random();

  // 有效胜率加入性格噪声
  const e = eq + (Math.random() - 0.5) * 0.06;

  if (toCall <= 0) {
    // 可过牌：强牌下注 / 偶尔诈唬
    const betThreshold = 0.72 - pers.aggr * 0.25;   // 激进者更容易下注
    if (e > betThreshold || (rand < pers.bluff * 0.6 && state.street !== 'preflop')) {
      const size = Math.round((0.45 + pers.aggr * 0.45 + Math.random() * 0.2) * pot);
      const amt = Math.max(state.minRaise, Math.min(size, p.chips + p.bet));
      doRaiseTo(p, Math.max(amt, blinds()[1]));
    } else {
      doCheck(p);
    }
    return;
  }

  // 需要跟注
  const potOdds = toCall / (pot + toCall);
  const looseFactor = 0.85 + (1 - pers.loose) * 0.5;  // tight → 需要更高胜率
  const needed = potOdds * looseFactor;

  // 超强牌：加注/全下
  const raiseThreshold = 0.78 - pers.aggr * 0.18;
  if (e > raiseThreshold && rand < 0.35 + pers.aggr * 0.5) {
    const target = state.currentBet + Math.max(state.minRaise, Math.round(pot * (0.5 + pers.aggr * 0.5)));
    doRaiseTo(p, target);
    return;
  }
  // 诈唬加注
  if (rand < pers.bluff * 0.35 && toCall < p.chips * 0.25 && state.street !== 'river') {
    const target = state.currentBet + Math.max(state.minRaise, Math.round(pot * 0.6));
    doRaiseTo(p, target);
    return;
  }
  // 跟注
  if (e > needed || (toCall <= blinds()[1] && rand < pers.loose)) {
    // 全下跟注需更强
    if (toCall >= p.chips && e < 0.5 + (1 - pers.loose) * 0.15 && rand > pers.loose * 0.5) {
      doFold(p);
      return;
    }
    doCall(p);
    return;
  }
  doFold(p);
}

/* ---------------- 玩家行动（UI 等待） ---------------- */
function humanAction(p) {
  return new Promise(resolve => {
    state.humanResolver = { p, resolve };
    renderActions();
    if (state.showEquity) updateEquityDisplay();
  });
}
function humanDo(action, raiseTo) {
  const h = state.humanResolver;
  if (!h) return;
  state.humanResolver = null;
  const p = h.p;
  if (action === 'fold') doFold(p);
  else if (action === 'check') doCheck(p);
  else if (action === 'call') doCall(p);
  else if (action === 'raise') doRaiseTo(p, raiseTo);
  else if (action === 'allin') doRaiseTo(p, p.bet + p.chips);
  renderActions();
  h.resolve();
}

/* ---------------- 结算 ---------------- */
async function maybeEndByFolds() {
  const remaining = state.players.filter(p => p.inHand && !p.folded);
  if (remaining.length === 1) {
    collectBets();
    const w = remaining[0];
    const wonAmt = state.pot;
    w.chips += wonAmt;
    state.pot = 0;
    if (w.isHuman) state.stats.potsWon++;
    state.stats.biggestPot = Math.max(state.stats.biggestPot, wonAmt);
    addLog(`🏆 其他人都弃牌了，${w.name} 赢得底池 ${wonAmt}`);
    if (!w.isHuman) maybeQuip(w, 'win', 0.6);
    sfx('win');
    render();
    showBanner(`🏆 ${w.name} 赢得 ${wonAmt}（无人跟注）`, 2000);
    await sleep(2000);
    await finishHand();
    return true;
  }
  return false;
}

async function showdown() {
  state.street = 'showdown';
  const contenders = state.players.filter(p => p.inHand && !p.folded);
  for (const p of contenders) p.revealed = true;
  render();
  await sleep(600);

  const results = contenders.map(p => {
    const ev = evaluateBest(p.hole, state.community);
    return { p, ev };
  });
  for (const r of results) addLog(`${r.p.name}: ${r.p.hole.map(cardStr).join(' ')} → ${handName(r.ev.val)}`);

  // 边池分配
  const handPlayers = state.players.filter(p => p.inHand && p.total > 0);
  const pots = buildPots(handPlayers);
  const winnersSummary = [];
  let winningCards = null;
  pots.forEach((pot, i) => {
    const evs = pot.eligible.map(p => results.find(r => r.p === p));
    let best = evs[0];
    for (const r of evs) if (cmpEval(r.ev.val, best.ev.val) > 0) best = r;
    const winners = evs.filter(r => cmpEval(r.ev.val, best.ev.val) === 0);
    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;
    for (const w of winners) {
      let got = share;
      if (remainder > 0) { got++; remainder--; }
      w.p.chips += got;
      const potName = pots.length > 1 ? (i === 0 ? '主池' : `边池${i}`) : '底池';
      addLog(`💰 ${w.p.name} 以 ${handName(w.ev.val)} 赢得${potName} ${got}`);
      winnersSummary.push(`${w.p.name} +${got}（${handName(w.ev.val)}）`);
      if (w.p.isHuman) state.stats.potsWon++;
      if (!winningCards) winningCards = w.ev.cards;
      if (!w.p.isHuman) maybeQuip(w.p, 'win', 0.5);
    }
  });
  state.stats.biggestPot = Math.max(state.stats.biggestPot, state.pot);
  state.pot = 0;

  // 高亮获胜牌
  state.highlightCards = winningCards || [];
  sfx('win');
  render();
  showBanner('🏆 ' + winnersSummary.join('　'), 2800);
  await sleep(2800);
  state.highlightCards = [];
  await finishHand();
}

async function finishHand() {
  allInRevealed = false;
  // 淘汰
  for (const p of state.players) {
    if (!p.out && p.chips === 0) {
      p.out = true;
      addLog(`💀 ${p.name} 被淘汰了！`);
      if (!p.isHuman) maybeQuip(p, 'lose', 0.9);
      showBanner(`💀 ${p.name} 出局！`, 1500);
      render();
      await sleep(1500);
    }
  }
  const human = state.players[0];
  const alive = alivePlayers();
  if (human.out) return endTournament(false);
  if (alive.length === 1) return endTournament(true);
  render();
  await sleep(600);
  if (state.running) playHand();
}

function endTournament(humanWon) {
  state.running = false;
  state.street = 'idle';
  const human = state.players[0];
  const rank = alivePlayers().length + (human.out ? 1 : 0);
  render();
  const el = document.getElementById('gameover');
  el.classList.add('show');
  document.getElementById('go-title').textContent = humanWon ? '🏆 冠军！你赢下了整场锦标赛！' : `💀 你出局了（第 ${rank} 名）`;
  document.getElementById('go-stats').innerHTML =
    `共进行 <b>${state.stats.handsPlayed}</b> 手牌 · 你赢下 <b>${state.stats.potsWon}</b> 个底池 · 最大底池 <b>${state.stats.biggestPot}</b>`;
  sfx(humanWon ? 'victory' : 'gameover');
}

/* ---------------- 台词气泡 ---------------- */
function maybeQuip(p, type, prob) {
  if (Math.random() > prob) return;
  const lines = p.personality && p.personality.quips[type];
  if (!lines || typeof document === 'undefined') return;
  showBubble(p.id, randPick(lines));
}

/* ============================================================
   以下为浏览器 UI 部分
   ============================================================ */
if (typeof document !== 'undefined') {

  const SEAT_POS = [
    { x: 50, y: 86 },   // 玩家（底部）
    { x: 11, y: 66 },
    { x: 13, y: 22 },
    { x: 50, y: 6 },
    { x: 87, y: 22 },
    { x: 89, y: 66 },
  ];

  /* ---------- 音效 ---------- */
  let audioCtx = null;
  function beep(freq, dur, type, gain, when) {
    if (state.muted) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const t = audioCtx.currentTime + (when || 0);
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(gain || 0.08, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t); o.stop(t + dur);
    } catch (e) { /* ignore */ }
  }
  function sfx(name) {
    if (name === 'deal') beep(880, 0.06, 'triangle', 0.05);
    else if (name === 'chip') { beep(520, 0.05, 'square', 0.04); beep(660, 0.05, 'square', 0.04, 0.06); }
    else if (name === 'fold') beep(180, 0.12, 'sine', 0.05);
    else if (name === 'allin') { beep(330, 0.12, 'sawtooth', 0.06); beep(440, 0.12, 'sawtooth', 0.06, 0.12); beep(550, 0.2, 'sawtooth', 0.07, 0.24); }
    else if (name === 'win') { beep(523, 0.1, 'triangle', 0.07); beep(659, 0.1, 'triangle', 0.07, 0.1); beep(784, 0.18, 'triangle', 0.08, 0.2); }
    else if (name === 'victory') { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => beep(f, 0.18, 'triangle', 0.09, i * 0.15)); }
    else if (name === 'gameover') { [400, 350, 300, 220].forEach((f, i) => beep(f, 0.25, 'sine', 0.08, i * 0.2)); }
  }
  window.__sfx = sfx;

  /* ---------- 渲染 ---------- */
  function cardHTML(c, faceDown, highlight) {
    if (faceDown) return `<div class="card back"></div>`;
    if (!c) return `<div class="card empty"></div>`;
    const red = c.s === 1 || c.s === 2;
    const hl = highlight ? ' hl' : '';
    return `<div class="card${red ? ' red' : ''}${hl}"><span class="rank">${RANK_NAMES[c.r]}</span><span class="suit">${SUITS[c.s]}</span></div>`;
  }
  function isHL(c) {
    return (state.highlightCards || []).some(h => h.r === c.r && h.s === c.s);
  }

  function render() {
    const seatsEl = document.getElementById('seats');
    seatsEl.innerHTML = '';
    const n = state.players.length;
    const actingId = state.humanResolver ? 0 : -1;

    state.players.forEach((p, i) => {
      const pos = SEAT_POS[i];
      const seat = document.createElement('div');
      seat.className = 'seat';
      seat.id = 'seat-' + p.id;
      seat.style.left = pos.x + '%';
      seat.style.top = pos.y + '%';
      if (p.out) seat.classList.add('out');
      if (p.folded) seat.classList.add('folded');
      if (state.street !== 'idle' && !p.out && !p.folded && isActing(p)) seat.classList.add('acting');

      const showFace = p.isHuman || p.revealed;
      const cardsHtml = p.inHand && p.hole.length
        ? `<div class="hole">${cardHTML(p.hole[0], !showFace, showFace && isHL(p.hole[0]))}${cardHTML(p.hole[1], !showFace, showFace && isHL(p.hole[1]))}</div>`
        : `<div class="hole"></div>`;

      const dealerBtn = i === state.dealer && !p.out ? '<span class="dealer-btn">D</span>' : '';
      const betHtml = p.bet > 0 ? `<div class="bet-chip">💰 ${p.bet}</div>` : '';
      const status = p.out ? '出局' : p.lastAction || '';

      seat.innerHTML = `
        ${cardsHtml}
        <div class="info">
          <div class="pname">${p.emoji} ${p.name} ${dealerBtn}</div>
          <div class="chips">🪙 ${p.chips}</div>
          <div class="status">${status}</div>
        </div>
        ${betHtml}`;
      seatsEl.appendChild(seat);
    });

    // 公共牌
    const commEl = document.getElementById('community');
    let html = '';
    for (let i = 0; i < 5; i++) {
      const c = state.community[i];
      html += c ? cardHTML(c, false, isHL(c)) : '<div class="card slot"></div>';
    }
    commEl.innerHTML = html;

    // 底池 & 盲注
    document.getElementById('pot').textContent = state.street === 'idle' ? '' : `底池：${potTotal()}`;
    const [sb, bb] = blinds();
    document.getElementById('blind-info').textContent =
      state.street === 'idle' ? '' : `第 ${state.handNum} 手 · 盲注 ${sb}/${bb} · ${streetName()}`;

    // 玩家当前牌型提示
    const hint = document.getElementById('hand-hint');
    const me = state.players[0];
    if (me && me.inHand && !me.folded && me.hole.length === 2 && state.street !== 'idle') {
      if (state.community.length >= 3) {
        const ev = evaluateBest(me.hole, state.community);
        hint.textContent = '你现在有：' + handName(ev.val);
      } else {
        hint.textContent = preflopHint(me.hole);
      }
    } else hint.textContent = '';

    renderActions();
  }
  window.render = render;

  function isActing(p) {
    return state.humanResolver && state.humanResolver.p === p;
  }
  function streetName() {
    return { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌', showdown: '摊牌' }[state.street] || '';
  }
  function preflopHint(hole) {
    const [a, b] = hole;
    if (a.r === b.r) return `你现在有：口袋对子 ${RANK_NAMES[a.r]}${RANK_NAMES[a.r]}`;
    const suited = a.s === b.s ? '（同花）' : '';
    const hi = Math.max(a.r, b.r), lo = Math.min(a.r, b.r);
    let extra = '';
    if (hi - lo === 1) extra = '，连张';
    return `起手牌：${RANK_NAMES[hi]}${RANK_NAMES[lo]}${suited}${extra}`;
  }

  /* ---------- 行动栏 ---------- */
  function renderActions() {
    const bar = document.getElementById('actions');
    const h = state.humanResolver;
    if (!h) { bar.classList.remove('active'); return; }
    bar.classList.add('active');
    const p = h.p;
    const toCall = state.currentBet - p.bet;
    const pot = potTotal();

    document.getElementById('btn-fold').style.display = '';
    const btnCheck = document.getElementById('btn-check');
    const btnCall = document.getElementById('btn-call');
    if (toCall <= 0) {
      btnCheck.style.display = '';
      btnCall.style.display = 'none';
    } else {
      btnCheck.style.display = 'none';
      btnCall.style.display = '';
      btnCall.textContent = toCall >= p.chips ? `全下跟注 ${p.chips}` : `跟注 ${toCall}`;
    }

    // 加注滑条：raise to 金额
    const minTo = Math.min(state.currentBet + state.minRaise, p.bet + p.chips);
    const maxTo = p.bet + p.chips;
    const slider = document.getElementById('raise-slider');
    const canRaise = maxTo > state.currentBet && p.chips > toCall;
    document.getElementById('raise-box').style.display = canRaise ? '' : 'none';
    if (canRaise) {
      slider.min = minTo;
      slider.max = maxTo;
      if (+slider.value < minTo || +slider.value > maxTo) slider.value = minTo;
      updateRaiseLabel();
    }
    document.getElementById('btn-allin').textContent = `全下 ${maxTo}`;

    // 快捷键提示按钮
    document.getElementById('quick-half').disabled = !canRaise;
    document.getElementById('quick-pot').disabled = !canRaise;
  }

  function updateRaiseLabel() {
    const slider = document.getElementById('raise-slider');
    const p = state.players[0];
    const v = +slider.value;
    const label = state.currentBet > 0 ? '加注到' : '下注';
    document.getElementById('btn-raise').textContent = `${label} ${v}`;
  }

  /* ---------- 胜率 ---------- */
  let equityTimer = null;
  function updateEquityDisplay() {
    const el = document.getElementById('equity');
    const me = state.players[0];
    if (!state.showEquity || !me.inHand || me.folded || me.hole.length !== 2 || state.street === 'idle' || state.street === 'showdown') {
      el.textContent = '';
      return;
    }
    const opp = state.players.filter(q => q.inHand && !q.folded && !q.isHuman).length;
    if (opp === 0) { el.textContent = ''; return; }
    el.textContent = '计算中…';
    clearTimeout(equityTimer);
    equityTimer = setTimeout(() => {
      const eq = equityMC(me.hole, state.community, opp, 400);
      el.textContent = `📊 胜率约 ${(eq * 100).toFixed(0)}%（对 ${opp} 人）`;
    }, 30);
  }

  /* ---------- 气泡 & 横幅 & 日志 ---------- */
  function showBubble(pid, text) {
    const layer = document.getElementById('bubbles');
    const pos = SEAT_POS[pid];
    const b = document.createElement('div');
    b.className = 'bubble';
    b.textContent = text;
    b.style.left = pos.x + '%';
    b.style.top = Math.max(0, pos.y - 13) + '%';
    layer.appendChild(b);
    setTimeout(() => b.classList.add('fade'), 2200);
    setTimeout(() => b.remove(), 3000);
  }
  window.showBubble = showBubble;

  let bannerTimer = null;
  function showBanner(text, dur) {
    const el = document.getElementById('banner');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.classList.remove('show'), dur || 2000);
  }
  window.showBanner = showBanner;

  function renderLog() {
    const el = document.getElementById('log');
    if (!el) return;
    el.innerHTML = state.log.slice(-80).map(l => `<div>${l}</div>`).join('');
    el.scrollTop = el.scrollHeight;
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    document.getElementById('btn-fold').onclick = () => humanDo('fold');
    document.getElementById('btn-check').onclick = () => humanDo('check');
    document.getElementById('btn-call').onclick = () => humanDo('call');
    document.getElementById('btn-raise').onclick = () => humanDo('raise', +document.getElementById('raise-slider').value);
    document.getElementById('btn-allin').onclick = () => humanDo('allin');
    document.getElementById('raise-slider').oninput = updateRaiseLabel;

    document.getElementById('quick-half').onclick = () => {
      const s = document.getElementById('raise-slider');
      s.value = Math.min(+s.max, Math.max(+s.min, state.currentBet + Math.round(potTotal() * 0.5)));
      updateRaiseLabel();
    };
    document.getElementById('quick-pot').onclick = () => {
      const s = document.getElementById('raise-slider');
      s.value = Math.min(+s.max, Math.max(+s.min, state.currentBet + potTotal()));
      updateRaiseLabel();
    };

    document.getElementById('chk-equity').onchange = e => {
      state.showEquity = e.target.checked;
      updateEquityDisplay();
    };
    document.getElementById('chk-mute').onchange = e => { state.muted = e.target.checked; };

    document.getElementById('btn-start').onclick = startGame;
    document.getElementById('btn-restart').onclick = () => {
      document.getElementById('gameover').classList.remove('show');
      startGame();
    };
    document.getElementById('btn-rules').onclick = () => document.getElementById('rules').classList.add('show');
    document.getElementById('btn-rules-close').onclick = () => document.getElementById('rules').classList.remove('show');

    // 键盘快捷键
    document.addEventListener('keydown', e => {
      if (!state.humanResolver) return;
      if (e.key === 'f') humanDo('fold');
      else if (e.key === 'c') {
        const toCall = state.currentBet - state.players[0].bet;
        humanDo(toCall > 0 ? 'call' : 'check');
      }
      else if (e.key === 'r') humanDo('raise', +document.getElementById('raise-slider').value);
    });
  }

  function startGame() {
    document.getElementById('start-screen').classList.remove('show');
    newGame();
    state.running = true;
    render();
    playHand();
  }

  window.addEventListener('DOMContentLoaded', () => {
    bind();
    document.getElementById('start-screen').classList.add('show');
  });

  // 把 UI 函数暴露到全局，供顶层游戏逻辑调用
  window.render = render;
  window.renderActions = renderActions;
  window.renderLog = renderLog;
  window.showBanner = showBanner;
  window.showBubble = showBubble;
  window.sfx = sfx;
  window.updateEquityDisplay = updateEquityDisplay;
}

/* 让游戏逻辑在无 DOM 环境下也能被测试 */
if (typeof document === 'undefined') {
  // node 环境的空实现
  global.render = () => {};
  global.renderActions = () => {};
  global.renderLog = () => {};
  global.showBanner = () => {};
  global.showBubble = () => {};
  global.sfx = () => {};
  global.updateEquityDisplay = () => {};
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { rank5, cmpEval, evaluate7, evaluateBest, handName, buildPots, equityMC, makeDeck };
}
