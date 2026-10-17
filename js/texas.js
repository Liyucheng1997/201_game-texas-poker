/* ============================================================
   德州扑克 · Texas Hold'em
   单机版：玩家 vs 3~5 个AI（各有性格），锦标赛模式，盲注递增
   难度：简单 / 普通 / 困难（范围建模） / 大师（范围建模 + 针对玩家建模）
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
// 按“快速模式”缩放的停顿（Node 测试中直接等待）
function pause(ms) { return typeof Hub !== 'undefined' && Hub.wait ? Hub.wait(ms) : sleep(ms); }
function randPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
// 配音（浏览器中由大厅公共模块提供；Node 测试中为空操作）
const hubOk = fn => typeof Hub !== 'undefined' && typeof Hub[fn] === 'function';
function voice(p, key) { if (hubOk('call')) Hub.call(p.name, key); }
function announce(key) { if (hubOk('announce')) Hub.announce(key); }
function tense(on) { if (hubOk('bgmTense')) Hub.bgmTense(on); }
const HAND_CALL = ['h_high', 'h_pair', 'h_two', 'h_trips', 'h_straight', 'h_flush', 'h_fh', 'h_quads', 'h_sf'];

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

/* ---------------- 起手牌强度（Chen 公式）→ 百分位 ----------------
   pct ∈ [0,1]：该起手牌强于多少比例的随机起手牌，AA≈1，72o≈0 */
function chenScore(a, b) {
  const hi = Math.max(a.r, b.r), lo = Math.min(a.r, b.r);
  const base = { 14: 10, 13: 8, 12: 7, 11: 6 }[hi] || hi / 2;
  if (a.r === b.r) return Math.max(5, base * 2);
  let s = base;
  if (a.s === b.s) s += 2;
  const gap = hi - lo - 1;
  s -= [0, 1, 2, 4][Math.min(gap, 3)] + (gap >= 4 ? 1 : 0);
  if (gap <= 1 && hi < 12) s += 1;
  return s;
}
const CHEN_SORTED = (() => {
  const d = makeDeck(), out = [];
  for (let i = 0; i < d.length; i++) for (let j = i + 1; j < d.length; j++) out.push(chenScore(d[i], d[j]));
  return out.sort((x, y) => x - y);
})();
function holePct(a, b) {
  const s = chenScore(a, b);
  let lo = 0, hi = CHEN_SORTED.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (CHEN_SORTED[m] < s) lo = m + 1; else hi = m; }
  return lo / CHEN_SORTED.length;
}

/* ---------------- 范围加权的蒙特卡洛胜率 ----------------
   不再把对手的底牌当作完全随机：根据对手本手的行动给每种底牌一个“会这么打”的概率，
   用拒绝采样抽取对手底牌。
   opps: [{ minPct, loosePass, betStreets, bluff }]
     minPct    翻前入池范围下限（只玩前 1-minPct 的起手牌）
     loosePass 范围外的牌仍被采样接受的概率（对手偶尔乱玩）
     betStreets 翻后主动下注/加注的次数 → 要求现在至少有对子，否则按 bluff 概率接受 */
function equityRange(hole, community, opps, iters) {
  if (!opps.length) return 1;
  const known = new Set([...hole, ...community].map(c => c.r * 4 + c.s));
  const pool = makeDeck().filter(c => !known.has(c.r * 4 + c.s));
  const need = 5 - community.length;
  let win = 0, tie = 0;
  for (let t = 0; t < iters; t++) {
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(Math.random() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const board = community.concat(pool.slice(0, need));
    let next = need;
    const hands = [];
    for (const o of opps) {
      let pick = null;
      const postW = Math.pow(o.bluff, o.betStreets > 1 ? 1.4 : 1);
      // 拒绝采样：翻前范围判定很便宜，可多试几次；翻后“是否有牌”判定只做有限次
      for (let tries = 0, post = 0; tries < 40; tries++) {
        // 从剩余牌中随机交换出两张
        for (let k = 0; k < 2; k++) {
          const j = next + k + Math.floor(Math.random() * (pool.length - next - k));
          [pool[next + k], pool[j]] = [pool[j], pool[next + k]];
        }
        const a = pool[next], b = pool[next + 1];
        pick = [a, b];
        if (o.minPct > 0 && holePct(a, b) < o.minPct && Math.random() >= o.loosePass) continue;
        if (o.betStreets > 0 && community.length >= 3 && post++ < 8 &&
            !hasPiece(a, b, community) && Math.random() >= postW) continue;
        break;
      }
      hands.push(pick);
      next += 2;
    }
    const my = evaluateBest(hole, board).val;
    let beaten = false, tied = false;
    for (const oh of hands) {
      const c = cmpEval(evaluateBest(oh, board).val, my);
      if (c > 0) { beaten = true; break; }
      if (c === 0) tied = true;
    }
    if (!beaten) { if (tied) tie++; else win++; }
  }
  return (win + tie / 2) / iters;
}
// 底牌是否和公共牌“有关系”：口袋对、击中对子、成顺/同花、或听同花（位运算，供采样热路径使用）
function hasPiece(a, b, community) {
  if (a.r === b.r) return true;
  const suit = [0, 0, 0, 0];
  let mask = (1 << a.r) | (1 << b.r);
  for (const c of community) {
    if (c.r === a.r || c.r === b.r) return true;
    mask |= 1 << c.r;
    suit[c.s]++;
  }
  suit[a.s]++; suit[b.s]++;
  if (Math.max(suit[a.s], suit[b.s]) >= (community.length < 5 ? 4 : 5)) return true;
  if (mask & (1 << 14)) mask |= 2;   // A 当 1 用于 A2345
  for (let hi = 14; hi >= 5; hi--) {
    const need = 0b11111 << (hi - 4);
    if ((mask & need) === need) return true;
  }
  return false;
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

// 不同人数时出场的对手（保证风格多样）
const OPPONENT_ORDER = [0, 1, 4, 3, 2];

/* ---------------- 难度 ----------------
   iters    蒙特卡洛次数（翻前/翻后）
   noise    对胜率估计的随机扰动（越大越容易误判）
   blunder  完全随机行动的概率
   range    是否按对手行动推断其范围（范围加权胜率）
   model    是否对玩家做统计建模并针对性调整（剥削）
   position 是否考虑位置 */
const AI_LEVELS = [
  { id: 'easy',   itersPre: 40,  itersPost: 60,  noise: 0.20, blunder: 0.12, range: false, model: false, position: false, aggrMul: 0.7, bluffMul: 0.5, callMul: 0.78 },
  { id: 'normal', itersPre: 90,  itersPost: 140, noise: 0.06, blunder: 0,    range: false, model: false, position: false, aggrMul: 1,   bluffMul: 1,   callMul: 1 },
  { id: 'hard',   itersPre: 150, itersPost: 220, noise: 0.03, blunder: 0,    range: true,  model: false, position: true,  aggrMul: 1.05, bluffMul: 1,  callMul: 1 },
  { id: 'master', itersPre: 200, itersPost: 300, noise: 0.015, blunder: 0,   range: true,  model: true,  position: true,  aggrMul: 1.1, bluffMul: 1.1, callMul: 1 },
];

/* ---------------- 游戏状态 ---------------- */
const BLIND_LEVELS = [[10, 20], [15, 30], [25, 50], [40, 80], [60, 120], [100, 200], [150, 300], [250, 500], [400, 800], [600, 1200]];
const DEFAULT_PARAMS = { opponents: 5, startChips: 2000, heroChips: 0, handsPerLevel: 8 };
let START_CHIPS = 2000;
let HANDS_PER_LEVEL = 8;

/* 玩家画像：统计你的入池率 / 翻前加注率 / 面对下注弃牌率 / 激进度。
   困难难度用默认先验估计你的范围；大师难度用这些真实统计来推断你的范围并针对性剥削。 */
function newHumanModel() {
  return { hands: 0, vpip: 0, pfr: 0, bets: 0, calls: 0, facedBet: 0, foldToBet: 0, showdowns: 0, bluffsShown: 0 };
}
function humanRates(m) {
  return {
    vpip: (m.vpip + 3) / (m.hands + 10),               // 先验 30%
    pfr: (m.pfr + 1.5) / (m.hands + 10),               // 先验 15%
    foldToBet: (m.foldToBet + 3) / (m.facedBet + 8),   // 先验 ~40%
    aggr: (m.bets + 2) / (m.bets + m.calls + 5),       // 先验 40%
    bluff: (m.bluffsShown + 1) / (m.showdowns + 5),    // 摊牌时诈唬比例，先验 20%
  };
}
function humanStyle(r) {
  const tight = r.vpip < 0.28, aggr = r.aggr > 0.5;
  return (tight ? '紧' : '松') + (aggr ? '凶' : '弱');
}

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
  actingPlayerId: null,
  showEquity: false,
  muted: false,
  log: [],
  stats: { handsPlayed: 0, potsWon: 0, biggestPot: 0 },
  ai: AI_LEVELS[1],
  humanModel: newHumanModel(),
};

function newGame(params, diffIndex) {
  const P = Object.assign({}, DEFAULT_PARAMS, params || {});
  START_CHIPS = P.startChips;
  HANDS_PER_LEVEL = Math.max(3, P.handsPerLevel);
  state.ai = AI_LEVELS[diffIndex == null ? 1 : diffIndex];
  state.humanModel = newHumanModel();
  state.actingPlayerId = null;
  state.humanResolver = null;
  state.players = [];
  state.players.push({
    id: 0, name: '你', emoji: '😎', isHuman: true,
    chips: P.heroChips || START_CHIPS, hole: [], bet: 0, total: 0,
    folded: false, allin: false, out: false, acted: false, revealed: false,
    personality: null,
  });
  const nOpp = Math.max(1, Math.min(5, P.opponents));
  OPPONENT_ORDER.slice(0, nOpp).forEach((pi, i) => {
    const p = PERSONALITIES[pi];
    state.players.push({
      id: i + 1, name: p.name, emoji: p.emoji, isHuman: false,
      chips: START_CHIPS, hole: [], bet: 0, total: 0,
      folded: false, allin: false, out: false, acted: false, revealed: false,
      personality: p,
    });
  });
  state.dealer = Math.floor(Math.random() * state.players.length);
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
    announce('blinds_up');
    await pause(1400);
  }

  // 重置
  tense(false);
  state.community = [];
  state.pot = 0;
  state.street = 'preflop';
  for (const p of state.players) {
    p.hole = []; p.bet = 0; p.total = 0;
    p.folded = false; p.allin = false; p.acted = false; p.revealed = false;
    p.inHand = !p.out;
    p.lastAction = '';
    // 本手行动记录（供 AI 推断范围）
    p.vpipHand = false; p.raisedPre = false; p.betStreets = 0;
  }
  if (!state.players[0].out) state.humanModel.hands++;
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
  await pause(500);

  // 翻前
  await bettingRound(nextAlive(bbIdx));
  if (await maybeEndByFolds()) return;

  // 翻牌
  collectBets();
  state.street = 'flop';
  state.community.push(state.deck.pop(), state.deck.pop(), state.deck.pop());
  addLog(`🃏 翻牌: ${state.community.map(cardStr).join(' ')}`);
  announce('flop');
  sfx('deal'); render();
  await pause(700);
  await streetBetting();
  if (await maybeEndByFolds()) return;

  // 转牌
  collectBets();
  state.street = 'turn';
  state.community.push(state.deck.pop());
  addLog(`🃏 转牌: ${cardStr(state.community[3])}`);
  announce('turn');
  sfx('deal'); render();
  await pause(700);
  await streetBetting();
  if (await maybeEndByFolds()) return;

  // 河牌
  collectBets();
  state.street = 'river';
  state.community.push(state.deck.pop());
  addLog(`🃏 河牌: ${cardStr(state.community[4])}`);
  announce('river');
  sfx('deal'); render();
  await pause(700);
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
  sfx('reveal');
  announce('allin_duel');
  tense(true);
  render();
  await pause(1200);
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

    state.actingPlayerId = p.id;
    render();
    if (p.isHuman) {
      await humanAction(p);
    } else {
      await pause(500 + Math.random() * 700);
      await aiAction(p);
    }
    state.actingPlayerId = null;
    render();
    // 留出时间看清刚刚完成的行动，包括本街最后一次行动。
    await pause(650);
  }
}

/* ---------------- 行动执行 ---------------- */
// 记录行动：更新本手范围线索与玩家画像
function noteAction(p, kind) {
  const m = state.humanModel;
  const toCall = state.currentBet - p.bet;
  if (p.isHuman && toCall > 0) m.facedBet++;
  if (state.street === 'preflop') {
    if (kind === 'call' || kind === 'raise') {
      if (p.isHuman && !p.vpipHand) m.vpip++;
      p.vpipHand = true;
    }
    if (kind === 'raise') {
      if (p.isHuman && !p.raisedPre) m.pfr++;
      p.raisedPre = true;
    }
  } else if (kind === 'raise') p.betStreets++;
  if (!p.isHuman) return;
  if (kind === 'raise') m.bets++;
  else if (kind === 'call') m.calls++;
  else if (kind === 'fold' && toCall > 0) m.foldToBet++;
}
function doFold(p) {
  noteAction(p, 'fold');
  p.folded = true;
  voice(p, 'fold');
  p.lastAction = '弃牌';
  addLog(`${p.name} 弃牌`);
  sfx('fold');
  if (!p.isHuman) maybeQuip(p, 'fold', 0.35);
}
function doCheck(p) {
  p.acted = true;
  voice(p, 'check');
  p.lastAction = '过牌';
  addLog(`${p.name} 过牌`);
  if (!p.isHuman) maybeQuip(p, 'check', 0.2);
}
function doCall(p) {
  noteAction(p, 'call');
  const need = Math.min(state.currentBet - p.bet, p.chips);
  p.chips -= need;
  p.bet += need;
  p.acted = true;
  if (p.chips === 0) { p.allin = true; p.lastAction = '全下跟注'; addLog(`${p.name} 全下跟注 ${need}`); sfx('allin'); voice(p, 'allin'); tense(true); }
  else { p.lastAction = `跟注 ${need}`; addLog(`${p.name} 跟注 ${need}`); sfx('chip'); voice(p, 'call'); }
  if (!p.isHuman) maybeQuip(p, 'call', 0.25);
}
// raiseTo: 本街总下注额
function doRaiseTo(p, raiseTo) {
  raiseTo = Math.min(raiseTo, p.bet + p.chips);
  const add = raiseTo - p.bet;
  const isRaise = raiseTo > state.currentBet;
  // 翻前有大盲、或本街已有人下注 → “加注到”；否则是首次“下注”
  const verb = state.street === 'preflop' || state.currentBet > 0 ? '加注到' : '下注';
  noteAction(p, isRaise ? 'raise' : 'call');
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
    voice(p, 'allin');
    tense(true);
    if (!p.isHuman) maybeQuip(p, 'allin', 0.9);
  } else {
    p.lastAction = `${verb} ${raiseTo}`;
    addLog(`${p.name} ${verb} ${raiseTo}`);
    sfx(add > state.minRaise * 3 ? 'chips' : 'chip');
    voice(p, verb === '下注' ? 'bet' : 'raise');
    if (!p.isHuman) maybeQuip(p, 'raise', 0.4);
  }
}

/* ---------------- AI 决策 ---------------- */
function clampN(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// AI 眼中对手 q 的打法画像
function profileOf(q) {
  if (q.isHuman) {
    if (state.ai.model) return humanRates(state.humanModel);
    return { vpip: 0.32, pfr: 0.15, foldToBet: 0.4, aggr: 0.4, bluff: 0.2 };
  }
  const per = q.personality;
  return {
    vpip: 0.15 + per.loose * 0.6,
    pfr: 0.05 + per.aggr * per.loose * 0.3,
    foldToBet: 0.55 - per.loose * 0.3,
    aggr: per.aggr * 0.7,
    bluff: 0.05 + per.bluff,
  };
}
// 根据 q 本手的行动推断其范围
function rangeOf(q) {
  const pr = profileOf(q);
  let minPct = 0, loosePass = 1;
  if (q.raisedPre) { minPct = clampN(1 - pr.pfr, 0.5, 0.93); loosePass = 0.12; }
  else if (q.vpipHand) { minPct = clampN(1 - pr.vpip, 0.2, 0.85); loosePass = 0.3; }
  return { minPct, loosePass, betStreets: q.betStreets, bluff: clampN(pr.bluff + pr.aggr * 0.2, 0.08, 0.6) };
}

async function aiAction(p) {
  const pers = p.personality;
  const L = p.aiLevel || state.ai;   // 自对弈测试可为每个座位单独指定难度
  const opps = state.players.filter(q => q.inHand && !q.folded && q !== p);
  const iters = state.street === 'preflop' ? L.itersPre : L.itersPost;
  const eq = L.range
    ? equityRange(p.hole, state.community, opps.map(rangeOf), iters)
    : equityMC(p.hole, state.community, opps.length, iters);
  const toCall = state.currentBet - p.bet;
  const pot = potTotal();
  const rand = Math.random();

  // 简单难度：偶尔完全凭感觉乱打
  if (L.blunder && rand < L.blunder) {
    if (toCall <= 0) {
      if (Math.random() < 0.7) doCheck(p);
      else doRaiseTo(p, state.currentBet + Math.max(state.minRaise, blinds()[1]));
    } else if (Math.random() < 0.6) doCall(p);
    else doFold(p);
    return;
  }

  // 有效胜率加入噪声（难度越低噪声越大）
  let e = eq + (Math.random() - 0.5) * L.noise;

  // 位置：翻前后位更松、前位更紧
  if (L.position && state.street === 'preflop') {
    const n = state.players.length;
    let behind = 0;
    for (let i = 1; i < n; i++) {
      const q = state.players[(p.id + i) % n];
      if (q.inHand && !q.folded && !q.acted && !q.allin) behind++;
      if ((p.id + i) % n === state.dealer) break;
    }
    e += behind <= 1 ? 0.03 : behind >= 3 ? -0.02 : 0;
  }

  // 诈唬效果随对手人数下降；大师会针对玩家画像调整
  let bluffMul = L.bluffMul * (L.range ? (opps.length <= 1 ? 1.2 : opps.length === 2 ? 0.8 : 0.4) : 1);
  let betAdj = 0, callAdj = L.callMul;
  const human = state.players[0];
  if (L.model && human.inHand && !human.folded && state.humanModel.hands >= 6) {
    const hr = humanRates(state.humanModel);
    if (hr.foldToBet > 0.5) bluffMul *= 1.5 + (hr.foldToBet - 0.5) * 2;   // 你容易被吓跑 → 多诈唬
    if (hr.foldToBet < 0.3) { bluffMul *= 0.35; betAdj -= 0.05; }        // 你爱跟注 → 少诈唬、薄价值下注
    const humanIsBettor = toCall > 0 && human.bet === state.currentBet;
    if (humanIsBettor && hr.aggr > 0.55) callAdj *= 0.85;               // 你下注太频繁 → 更宽地抓诈唬
    if (humanIsBettor && hr.aggr < 0.3) callAdj *= 1.15;                // 你很少下注 → 尊重你的下注
  }

  if (toCall <= 0) {
    // 可过牌：强牌下注 / 偶尔诈唬
    const betThreshold = 0.72 - pers.aggr * L.aggrMul * 0.25 + betAdj;   // 激进者更容易下注
    if (e > betThreshold || (rand < pers.bluff * bluffMul * 0.6 && state.street !== 'preflop')) {
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
  const looseFactor = (0.85 + (1 - pers.loose) * 0.5) * callAdj;  // tight → 需要更高胜率
  const needed = potOdds * looseFactor;

  // 超强牌：加注/全下
  const raiseThreshold = 0.78 - pers.aggr * L.aggrMul * 0.18;
  if (e > raiseThreshold && rand < 0.35 + pers.aggr * L.aggrMul * 0.5) {
    const target = state.currentBet + Math.max(state.minRaise, Math.round(pot * (0.5 + pers.aggr * 0.5)));
    doRaiseTo(p, target);
    return;
  }
  // 诈唬加注
  if (rand < pers.bluff * bluffMul * 0.35 && toCall < p.chips * 0.25 && state.street !== 'river') {
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
    render();
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
    sfx('chips');
    render();
    showBanner(`🏆 ${w.name} 赢得 ${wonAmt}（无人跟注）`, 2000);
    await pause(2000);
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
  await pause(600);

  const results = contenders.map(p => {
    const ev = evaluateBest(p.hole, state.community);
    return { p, ev };
  });
  for (const r of results) addLog(`${r.p.name}: ${r.p.hole.map(cardStr).join(' ')} → ${handName(r.ev.val)}`);
  // 玩家画像：摊牌时看你翻后主动下注的牌是不是空气
  const me = contenders.find(p => p.isHuman);
  if (me && me.betStreets > 0) {
    state.humanModel.showdowns++;
    if (!hasPiece(me.hole[0], me.hole[1], state.community)) state.humanModel.bluffsShown++;
  }

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

  // 高亮获胜牌，赢家喊出牌型
  state.highlightCards = winningCards || [];
  sfx('chips');
  const topWinner = results.filter(r => winnersSummary.some(w => w.startsWith(r.p.name + ' ')))
    .sort((a, b) => cmpEval(b.ev.val, a.ev.val))[0];
  if (topWinner) {
    const v = topWinner.ev.val;
    voice(topWinner.p, v[0] === 8 && v[1] === 14 ? 'h_royal' : HAND_CALL[v[0]]);
  }
  render();
  showBanner('🏆 ' + winnersSummary.join('　'), 2800);
  await pause(2800);
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
      await pause(1500);
    }
  }
  const human = state.players[0];
  const alive = alivePlayers();
  if (human.out) return endTournament(false);
  if (alive.length === 1) return endTournament(true);
  render();
  await pause(600);
  if (state.running) playHand();
}

function endTournament(humanWon) {
  state.running = false;
  state.street = 'idle';
  const human = state.players[0];
  const rank = alivePlayers().length + (human.out ? 1 : 0);
  render();
  if (typeof document === 'undefined') return;
  const r = humanRates(state.humanModel);
  Hub.finish({
    passed: !!humanWon,
    stats: { hands: state.stats.handsPlayed, place: rank },
    title: humanWon ? '🏆 冠军！你赢下了整场锦标赛！' : `💀 你出局了（第 ${rank} 名）`,
    lines: [
      `共进行 <b>${state.stats.handsPlayed}</b> 手牌 · 你赢下 <b>${state.stats.potsWon}</b> 个底池 · 最大底池 <b>${state.stats.biggestPot}</b>`,
      `你的打法画像：入池率 ${(r.vpip * 100).toFixed(0)}% · 翻前加注率 ${(r.pfr * 100).toFixed(0)}% · 面对下注弃牌率 ${(r.foldToBet * 100).toFixed(0)}% → <b>${humanStyle(r)}</b>`,
    ],
  });
}

/* ---------------- 台词气泡 ---------------- */
function maybeQuip(p, type, prob) {
  if (Math.random() > prob) return;
  const lines = p.personality && p.personality.quips[type];
  if (!lines || typeof document === 'undefined') return;
  const line = randPick(lines);
  showBubble(p.id, line);
  if (hubOk('speak')) Hub.speak(p.name, line);
}

/* ============================================================
   以下为浏览器 UI 部分
   ============================================================ */
if (typeof document !== 'undefined') {

  // 按总人数排列座位（索引 0 为玩家，位于底部，为提示与操作栏留出空间）
  const SEAT_LAYOUTS = {
    6: [{ x: 50, y: 73 }, { x: 13, y: 64 }, { x: 15, y: 25 }, { x: 50, y: 17 }, { x: 85, y: 25 }, { x: 87, y: 64 }],
    5: [{ x: 50, y: 73 }, { x: 12, y: 52 }, { x: 30, y: 18 }, { x: 70, y: 18 }, { x: 88, y: 52 }],
    4: [{ x: 50, y: 73 }, { x: 12, y: 45 }, { x: 50, y: 17 }, { x: 88, y: 45 }],
    3: [{ x: 50, y: 73 }, { x: 22, y: 22 }, { x: 78, y: 22 }],
  };
  const seatPos = i => (SEAT_LAYOUTS[state.players.length] || SEAT_LAYOUTS[6])[i];

  /* ---------- 音效：使用大厅公共音效 ---------- */
  const sfx = Hub.sfx;

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

    state.players.forEach((p, i) => {
      const pos = seatPos(i);
      let seat = document.getElementById('seat-' + p.id);
      if (!seat) {
        seat = document.createElement('div');
        seat.id = 'seat-' + p.id;
        seat.innerHTML = '<div class="turn-label"></div><div class="hole"></div><div class="info"><div class="pname"></div><div class="chips"></div></div><div class="status" role="status" aria-live="polite"></div><div class="bet-chip"></div>';
        seatsEl.appendChild(seat);
      }
      seat.className = 'seat' + (p.isHuman ? ' human' : '');
      seat.style.left = pos.x + '%';
      seat.style.top = pos.y + '%';
      if (p.out) seat.classList.add('out');
      if (p.folded) seat.classList.add('folded');
      if (state.street !== 'idle' && !p.out && !p.folded && isActing(p)) seat.classList.add('acting');

      const showFace = p.isHuman || p.revealed;
      renderCards(seat.querySelector('.hole'), p.inHand ? p.hole : [], !showFace);

      const dealerBtn = i === state.dealer && !p.out ? '<span class="dealer-btn">D</span>' : '';
      const status = p.out ? '已出局' : p.folded ? '已弃牌' : p.lastAction || '等待行动';
      const nameEl = seat.querySelector('.pname');
      const nameHTML = `${p.emoji} ${p.name} ${dealerBtn}`;
      if (nameEl.innerHTML !== nameHTML) nameEl.innerHTML = nameHTML;
      seat.querySelector('.chips').textContent = `🪙 ${p.chips}`;
      seat.querySelector('.turn-label').textContent = isActing(p) ? (p.isHuman ? '▼ 轮到你了' : '▼ 正在行动') : '';
      const statusEl = seat.querySelector('.status');
      const label = isActing(p) ? (p.isHuman ? (state.currentBet > p.bet ? `需跟注 ${Math.min(state.currentBet - p.bet, p.chips)}` : '可以过牌') : '思考中…') : status;
      if (statusEl.textContent !== label) statusEl.textContent = label;
      statusEl.dataset.action = isActing(p) ? 'acting' : p.out || p.folded ? 'fold' : p.allin ? 'allin' : /跟注/.test(status) ? 'call' : /加注|下注/.test(status) ? 'raise' : /过牌/.test(status) ? 'check' : 'waiting';
      seat.querySelector('.bet-chip').textContent = p.bet > 0 ? `已投入 ${p.bet}` : '';
    });

    // 公共牌
    const commEl = document.getElementById('community');
    renderCards(commEl, Array.from({ length: 5 }, (_, i) => state.community[i]), false);

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

    const alive = alivePlayers().length;
    Hub.setInfo(state.street === 'idle' ? '' :
      `第 <b>${state.handNum}</b> 手 · 盲注 <b>${sb}/${bb}</b> · 剩余 <b>${alive}</b> 人 · 每 ${HANDS_PER_LEVEL} 手涨盲`);
    renderRead();
    renderActions();
  }
  window.render = render;

  // 困难/大师：展示“对手眼中的你”——AI 正在使用的玩家画像
  function renderRead() {
    const el = document.getElementById('read-box');
    if (!state.ai.range) { el.innerHTML = ''; return; }
    if (!state.ai.model) {
      el.innerHTML = '🔍 对手会根据下注行动推断你的牌力范围';
      return;
    }
    const m = state.humanModel, r = humanRates(m);
    const html = m.hands < 6 ? '🔍 对手正在观察你的打法…' :
      `🔍 对手眼中的你：<b>${humanStyle(r)}</b><br>入池 ${(r.vpip * 100).toFixed(0)}% · 加注 ${(r.pfr * 100).toFixed(0)}% · 被下注弃牌 ${(r.foldToBet * 100).toFixed(0)}%`;
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  // 只替换新发出或翻开的牌；过牌、筹码更新及高亮均保留原 DOM 节点。
  function renderCards(container, cards, faceDown) {
    while (container.children.length > cards.length) container.lastElementChild.remove();
    cards.forEach((c, i) => {
      const key = c ? `${state.handNum}:${c.r}:${c.s}:${faceDown}` : 'slot';
      let el = container.children[i];
      if (!el || el.dataset.cardKey !== key) {
        const template = document.createElement('template');
        template.innerHTML = c ? cardHTML(c, faceDown, false) : '<div class="card slot"></div>';
        const next = template.content.firstElementChild;
        next.dataset.cardKey = key;
        if (el) el.replaceWith(next); else container.appendChild(next);
        el = next;
      }
      el.classList.toggle('hl', !!c && !faceDown && isHL(c));
    });
  }

  function isActing(p) {
    return state.actingPlayerId === p.id && p.inHand && !p.out && !p.folded;
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
      const toCall = Math.min(state.currentBet - me.bet, me.chips);
      // 底池赔率：跟注所需的最低胜率，帮助新手判断是否该跟
      const odds = toCall > 0 ? ` · 跟注需胜率 ${(toCall / (potTotal() + toCall) * 100).toFixed(0)}%` : '';
      el.textContent = `📊 胜率约 ${(eq * 100).toFixed(0)}%（对 ${opp} 人随机牌）${odds}`;
    }, 30);
  }

  /* ---------- 气泡 & 横幅 & 日志 ---------- */
  function showBubble(pid, text) {
    const layer = document.getElementById('bubbles');
    const pos = seatPos(pid);
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

  const RULES_HTML = `
    <p><b>目标：</b>用你的 2 张底牌 + 5 张公共牌，组成最大的 5 张牌型，赢下底池。输光筹码即出局，活到最后就是冠军。</p>
    <p><b>流程：</b>发 2 张底牌 → 下注 → 翻 3 张公共牌（翻牌）→ 下注 → 第 4 张（转牌）→ 下注 → 第 5 张（河牌）→ 下注 → 摊牌比大小。</p>
    <p><b>行动：</b><br>
    · <b>弃牌</b>：放弃这手牌，已下注的不退还<br>
    · <b>过牌</b>：无人下注时可以不下注继续<br>
    · <b>跟注</b>：跟上别人的下注<br>
    · <b>加注</b>：下更多的注，逼对手做选择<br>
    · <b>全下</b>：押上全部筹码！</p>
    <p><b>牌型（从大到小）：</b>皇家同花顺 > 同花顺 > 四条 > 葫芦（三条+一对）> 同花 > 顺子 > 三条 > 两对 > 一对 > 高牌</p>
    <p><b>难度：</b>简单的对手常常乱跟乱打；普通对手按胜率和性格行动；<b>困难</b>对手会根据每个人的加注、跟注推断其可能的手牌范围，而不是把对手当成随机牌；<b>大师</b>对手还会统计你的入池率、加注率和被下注时的弃牌率，针对你的习惯调整诈唬与抓诈的频率（侧栏可以看到“对手眼中的你”）。</p>
    <p><b>小技巧：</b>位置越靠后（越晚行动）越有利；起手牌太差就果断弃牌；侧栏的“显示胜率”会同时给出底池赔率——胜率高于“跟注需胜率”时跟注才划算。</p>
    <p><b>快捷键：</b>F 弃牌 · C 过牌/跟注 · R 加注</p>`;

  async function startGame() {
    const ctx = Hub.init({ game: 'texas', defaults: DEFAULT_PARAMS, rules: RULES_HTML });
    newGame(ctx.params, ctx.diffIndex);
    // 大师难度不提供胜率辅助
    if (ctx.diffIndex === 3) {
      document.getElementById('equity-opt').innerHTML = '📊 大师难度不提供胜率辅助';
    }
    const villains = state.players.filter(p => !p.isHuman).map(p => {
      const d = { '老狐狸': '紧凶老手，出手必有好牌？也可能在下套…', '疯狗阿豪': '什么牌都敢玩，诈唬成瘾，小心他梭哈',
        '石头哥': '极度保守，他加注了就快跑', '教授': '全靠数学，赔率不对绝不跟注', '甜甜': '好奇宝宝，什么牌都想跟着看看' }[p.name];
      return `<div class="v"><div class="e">${p.emoji}</div><div class="n">${p.name}</div><div class="d">${d}</div></div>`;
    }).join('');
    const hero = state.players[0].chips;
    await Hub.intro({
      title: '♠♥ 德州扑克锦标赛 ♦♣',
      html: `<p>你和 ${state.players.length - 1} 位性格迥异的对手同桌，你有 <b>${hero}</b> 筹码${hero !== START_CHIPS ? `，对手各 <b>${START_CHIPS}</b>` : ''}。<br>
        盲注每 ${HANDS_PER_LEVEL} 手上涨一次，输光筹码就出局 —— 活到最后就是冠军！</p>
        <div class="villains">${villains}</div>
        <p style="font-size:13px;color:#8b93a0">新手？开局后勾选侧栏的「显示胜率」，会实时告诉你这手牌的赢面和底池赔率。</p>`,
      button: '开始游戏 🎲',
    });
    state.running = true;
    render();
    playHand();
  }

  window.addEventListener('DOMContentLoaded', () => {
    bind();
    startGame();
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
  module.exports = {
    rank5, cmpEval, evaluate7, evaluateBest, handName, buildPots, equityMC, makeDeck,
    chenScore, holePct, equityRange, hasPiece, humanRates, AI_LEVELS, state, newGame, aiAction,
    playHandForTest: playHand,
  };
}
