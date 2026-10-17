/* ============================================================
   斗牛 · 抢庄牛牛
   单机版：玩家 + 4 个 AI，看四张抢庄 → 押倍数 → 发第五张 → 摆牛比牌
   逻辑（牌型 / 结算 / 概率 / AI）与 DOM 分离，Node 可直接 require 测试。
   ============================================================ */
'use strict';
const Hub = (typeof window !== 'undefined' && window.Hub) || require('./common.js');

/* ---------------- 基本常量 ---------------- */
// 牌型：0 没牛，1..9 牛1~牛9，10 牛牛，11 五花牛，12 炸弹牛，13 五小牛
const TYPE_NAMES = ['没牛', '牛1', '牛2', '牛3', '牛4', '牛5', '牛6', '牛7', '牛8', '牛9', '牛牛', '五花牛', '炸弹牛', '五小牛'];
const TYPE_MULT = [1, 1, 1, 1, 1, 1, 1, 2, 2, 3, 4, 5, 6, 8];
const GRAB_OPTS = [0, 1, 2, 3, 4];
const BET_OPTS = [1, 2, 3, 5];
const DEFAULTS = { rounds: 10, startChips: 1000, target: 1000, base: 10, forceBanker: false };
const FORCE_BANKER_MULT = 4;
// 比较用花色大小：♠ > ♥ > ♣ > ♦（s: 0♠ 1♥ 2♦ 3♣）
const SUIT_RANK = [3, 2, 0, 1];
const KEY_STRIDE = 52;                      // 比较键 = 牌型 × 52 + 牌型内大小
const KEY_COUNT = TYPE_NAMES.length * KEY_STRIDE;

function point(c) { return c.r > 10 ? 10 : c.r; }
// 单张大小：K > Q > … > A，同点比花色，0..51
function cardKey(c) { return (c.r - 1) * 4 + SUIT_RANK[c.s]; }
function cardStr(c) { return Hub.cardText(c); }

// 5 张中选 3 张的 10 种组合
const TRIPLES = (() => {
  const out = [];
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 4; b++) for (let c = b + 1; c < 5; c++) out.push([a, b, c]);
  return out;
})();
function restOf(tri) { return [0, 1, 2, 3, 4].filter(i => !tri.includes(i)); }

/* ---------------- 牌型识别 ----------------
   evalHand(5 张, prefer?) → { type, mult, key, name, groups, maxCard }
   groups：亮牌时的分组下标 [[凑十的 3 张], [另 2 张]]；炸弹为 [[4 张], [1 张]]；没牛 / 五小牛为 null
   prefer：玩家手动选的 3 张下标；若合法（和为 10 的倍数）则按它分组展示（牛几不受影响） */
function evalHand(cards, prefer) {
  const pts = cards.map(point);
  const total = pts[0] + pts[1] + pts[2] + pts[3] + pts[4];
  let maxCard = cards[0];
  for (const c of cards) if (cardKey(c) > cardKey(maxCard)) maxCard = c;
  const tbMax = cardKey(maxCard);
  const mk = (type, tb, groups) => ({
    type, mult: TYPE_MULT[type], key: type * KEY_STRIDE + tb, name: TYPE_NAMES[type], groups, maxCard,
  });
  // 1) 五小牛：5 张都 < 5 且点数和 ≤ 10
  if (cards.every(c => c.r < 5) && total <= 10) return mk(13, tbMax, null);
  // 2) 炸弹牛：4 张同点，比炸弹点数
  const cnt = {};
  for (const c of cards) cnt[c.r] = (cnt[c.r] || 0) + 1;
  for (const r in cnt) {
    if (cnt[r] === 4) {
      const four = [], one = [];
      cards.forEach((c, i) => (c.r === +r ? four : one).push(i));
      return mk(12, (+r - 1) * 4 + 3, [four, one]);
    }
  }
  // 3) 普通牛：找 3 张和为 10 的倍数；剩下两张之和 mod 10 即牛几（任意合法组合结果都相同）
  let tri = null;
  if (prefer && prefer.length === 3 && (pts[prefer[0]] + pts[prefer[1]] + pts[prefer[2]]) % 10 === 0) {
    tri = prefer.slice().sort((a, b) => a - b);
  } else {
    for (const t of TRIPLES) if ((pts[t[0]] + pts[t[1]] + pts[t[2]]) % 10 === 0) { tri = t; break; }
  }
  const groups = tri ? [tri, restOf(tri)] : null;
  // 4) 五花牛：5 张全是 JQK
  if (cards.every(c => c.r > 10)) return mk(11, tbMax, groups);
  if (!tri) return mk(0, tbMax, null);
  const n = total % 10;
  return mk(n === 0 ? 10 : n, tbMax, groups);
}
function compareHands(a, b) { return a.key - b.key; }
function typeTier(type) { return type >= 11 ? 'special' : type === 10 ? 'gold' : type >= 7 ? 'mid' : type >= 1 ? 'low' : 'none'; }

/* ---------------- 定庄 ----------------
   grabs[i] ∈ 0..4；最高倍者为庄，并列随机；全不抢则全员随机、庄倍 ×1 */
function resolveBanker(grabs, rng) {
  const rand = rng || Math.random;
  const max = Math.max(...grabs);
  const candidates = [];
  grabs.forEach((g, i) => { if (g === max) candidates.push(i); });
  const banker = candidates[Math.floor(rand() * candidates.length)];
  return { banker, mult: max > 0 ? max : 1, candidates };
}

/* ---------------- 结算 ----------------
   每个闲家单独和庄家比：赢方得 底注 × 庄倍 × 闲家押注 × 赢方牌型倍数
   · 输家最多输掉自己当前全部筹码；
   · 庄家先收输家的钱，再用（自有筹码 + 收到的钱）赔赢家，不足则按比例赔付。
   返回 { delta[], results[] }，results[i] = { win, owed, paid }（闲家） */
function settle(chips, banker, bankerMult, bets, evals, base) {
  const n = chips.length;
  const delta = new Array(n).fill(0);
  const results = new Array(n).fill(null);
  let collected = 0, totalOwed = 0;
  const winners = [];
  for (let i = 0; i < n; i++) {
    if (i === banker || !evals[i]) continue;
    const win = evals[i].key > evals[banker].key;
    const owed = base * bankerMult * bets[i] * (win ? evals[i].mult : evals[banker].mult);
    if (win) { winners.push(i); totalOwed += owed; results[i] = { win, owed, paid: 0 }; }
    else {
      const paid = Math.min(owed, Math.max(0, chips[i]));
      delta[i] -= paid;
      collected += paid;
      results[i] = { win, owed, paid };
    }
  }
  const available = Math.max(0, chips[banker]) + collected;
  let paidOut = 0;
  for (const i of winners) {
    const pay = totalOwed <= available ? results[i].owed : Math.floor(results[i].owed * available / totalOwed);
    results[i].paid = pay;
    delta[i] += pay;
    paidOut += pay;
  }
  delta[banker] = collected - paidOut;
  return { delta, results, prorated: totalOwed > available };
}

/* ---------------- 随机数 ---------------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function newDeck() { return Hub.makeDeck({ decks: 1, jokers: false }); }
const FULL_DECK = newDeck();

/* ---------------- 基准分布 ----------------
   “随机 5 张牌”在全部 C(52,5)=2598960 种组合下每个比较键出现的次数。
   由 enumerateBaseCounts() 精确枚举得到（测试中会重新枚举校验），压缩成 36 进制常量表。 */
const BASE_TOTAL = 2598960;
const BASE_COUNTS_STR = [
  '0,0,0,0,0,0,0,0,0,s,2c,4o,68,70,8e,ae,4o,94,g0,pc,pc,16o,1so,2jc,3cs,3ww,4lu,5fm,5gc,6ek,7jo,8vo,8mw,a2k,bre,dpe,b7k,ehs,hs0,l28,' +
  'ocg,rmo,uww,y74,11hc,14rk,181s,1bc0,1em8,1hwg,1l6o,1ogw,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,ao,d4,fk,i0,s4,uk,xg,10s,' +
  '15s,1bc,1hc,1ns,1ts,1z4,24m,2aa,3ls,3sg,40w,4b4,4nk,520,5io,61k,6n4,7b4,81s,8v4,9rk,aqw,btc,cyw,0,0,0,0,0,0,0,0,0,0,0,0,10,1o,2c,30,' +
  '34,34,34,34,1g,6c,bu,hy,nk,q4,t4,wk,124,158,18i,1by,1uo,23s,2dc,2nc,3lc,3s0,40c,4ac,4mg,50g,5gk,5ys,6jk,76o,7wc,8ok,9js,ahs,bis,cms,0,0,0,0,' +
  '0,0,0,0,0,0,0,0,2o,3c,40,4o,5c,5c,5c,5c,34,34,34,34,o8,q0,ry,u2,10g,160,1c0,1ig,21k,2a0,2iw,2s8,3ls,3sg,40w,4b4,4nk,520,5io,61k,' +
  '6n4,7b4,81s,8v4,9rk,aqw,btc,cyw,0,0,0,0,0,0,0,0,0,0,0,0,1g,3c,58,74,8g,8g,8g,8g,3o,3o,3o,3o,34,ag,i8,qg,180,1do,1js,1qc,' +
  '1ww,25g,2eg,2nw,3lc,3s0,40c,4ac,4mg,50g,5gk,5ys,6jk,76o,7wc,8ok,9js,ahs,bis,cms,0,0,0,0,0,0,0,0,0,0,0,0,g,1s,3k,5s,94,94,94,94,' +
  '8g,8g,8g,8g,5c,8w,cg,g0,14w,19c,1e8,1jk,1x4,25k,2eg,2ns,3uo,41w,4aw,4lo,4yo,5do,5uw,6ec,70g,7p0,8g8,9a4,a74,b70,ca0,dg4,0,0,0,0,0,0,0,0,' +
  '0,0,0,0,0,o,1i,2i,8g,aw,dc,fs,ec,ec,ec,ec,80,c8,gg,ko,mw,wo,178,1ik,21c,29c,2hs,2qo,3lc,3s0,40c,4ac,4mg,50g,5gk,5ys,6jk,76o,7wc,8ok,' +
  '9js,ahs,bis,cms,0,0,0,0,0,0,0,0,0,0,0,0,0,4,o,1o,6c,8s,b8,do,i8,jk,kw,m8,cg,go,kw,p4,sg,wo,10w,154,21k,2a0,2iw,2s8,' +
  '3ls,3sg,40w,4b4,4nk,520,5io,61k,6n4,7b4,81s,8v4,9rk,aqw,btc,cyw,0,0,0,0,0,0,0,0,0,0,0,0,0,0,6,i,3k,60,8g,aw,is,ko,mk,og,' +
  'kg,o8,sg,x4,so,y4,13k,190,1g0,1tk,28g,2oo,3lc,3s0,40c,4ac,4mg,50g,5gk,5ys,6jk,76o,7wc,8ok,9js,ahs,bis,cms,0,0,0,0,0,0,0,0,0,0,0,0,' +
  '0,0,0,0,1g,3w,6c,8s,fk,gw,i8,jk,l0,o4,ro,vo,180,1es,1m0,1to,1mo,1so,1yo,24o,3ls,3sg,40w,4b4,4nk,520,5io,61k,6n4,7b4,81s,8v4,9rk,aqw,btc,cyw,' +
  '0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1c,3k,6o,ew,hc,js,m8,s0,v4,yo,12o,1b0,1h8,1nw,1v0,2e8,2og,2z4,3a8,1lc,24w,2qe,3du,' +
  '438,4uo,5o8,6jw,7i4,8io,9ls,arg,c04,dbk,eq0,g7g,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,' +
  '0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,4,e,u,1w,3g,5s,8w,0,0,0,10,0,0,0,18,0,0,0,1c,0,0,0,1c,' +
  '0,0,0,1c,0,0,0,1c,0,0,0,1c,0,0,0,1c,0,0,0,1c,0,0,0,1c,0,0,0,1c,0,0,0,1c,0,0,0,1c,0,0,0,0,' +
  '1,5,f,z,1x,2p,3h,49,1x,1x,1x,1x,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,' +
  '0,0,0,0,0,0,0,0',
].join('');
function enumerateBaseCounts() {
  const counts = new Array(KEY_COUNT).fill(0);
  const d = FULL_DECK, h = new Array(5);
  for (let a = 0; a < 48; a++) { h[0] = d[a];
    for (let b = a + 1; b < 49; b++) { h[1] = d[b];
      for (let c = b + 1; c < 50; c++) { h[2] = d[c];
        for (let e = c + 1; e < 51; e++) { h[3] = d[e];
          for (let f = e + 1; f < 52; f++) { h[4] = d[f]; counts[evalHand(h).key]++; } } } } }
  return counts;
}
function decodeCounts(str) { return str.split(',').map(x => parseInt(x, 36)); }
const BASE_COUNTS = BASE_COUNTS_STR ? decodeCounts(BASE_COUNTS_STR) : enumerateBaseCounts();

/* 对手牌力分桶（大师用来建模“出价 → 真实牌力”）：
   0 没牛 · 1 牛1-3 · 2 牛4-6 · 3 牛7-8 · 4 牛9 · 5 牛牛 · 6 特殊牌型 */
const TYPE_BUCKET = [0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 5, 6, 6, 6];
const NB = 7;
const BUCKET_NAMES = ['没牛', '牛1-3', '牛4-6', '牛7-8', '牛9', '牛牛', '特殊'];
/* 预计算：每个桶内，对手比我小的概率 CDF、对手比我大时的 E[倍数]、E[倍数²]（同键各算一半） */
const TABLES = (() => {
  const P = BASE_COUNTS.map(c => c / BASE_TOTAL);
  const pi = new Array(NB).fill(0);
  for (let k = 0; k < KEY_COUNT; k++) pi[TYPE_BUCKET[(k / KEY_STRIDE) | 0]] += P[k];
  const cdf = [], sm = [], sm2 = [];
  for (let j = 0; j < NB; j++) {
    const c = new Float64Array(KEY_COUNT), s1 = new Float64Array(KEY_COUNT), s2 = new Float64Array(KEY_COUNT);
    const inB = k => TYPE_BUCKET[(k / KEY_STRIDE) | 0] === j;
    let acc = 0;
    for (let k = 0; k < KEY_COUNT; k++) {
      const p = inB(k) ? P[k] / pi[j] : 0;
      c[k] = acc + p / 2;
      acc += p;
    }
    let a1 = 0, a2 = 0;
    for (let k = KEY_COUNT - 1; k >= 0; k--) {
      const p = inB(k) ? P[k] / pi[j] : 0;
      const m = TYPE_MULT[(k / KEY_STRIDE) | 0];
      s1[k] = a1 + p * m / 2; s2[k] = a2 + p * m * m / 2;
      a1 += p * m; a2 += p * m * m;
    }
    cdf.push(c); sm.push(s1); sm2.push(s2);
  }
  return { P, pi, cdf, sm, sm2 };
})();
const BASE_PI = TABLES.pi;

/* 我的最终牌（比较键 key、倍数 mult）对一个牌力分布为 pi（按桶）的对手：
   单位押注下的期望 ev、二阶矩 ex2、胜率 w */
function edgeVs(key, mult, pi) {
  let w = 0, lm = 0, lm2 = 0;
  for (let j = 0; j < NB; j++) {
    const p = pi[j];
    if (p <= 0) continue;
    w += p * TABLES.cdf[j][key]; lm += p * TABLES.sm[j][key]; lm2 += p * TABLES.sm2[j][key];
  }
  return { w, ev: w * mult - lm, ex2: w * mult * mult + lm2 };
}

/* ---------------- 4 张牌分析 ----------------
   枚举剩余 48 张作为第 5 张 → 我的最终牌型分布；配合对手分布 pi 得到期望与方差 */
function finalOutcomes(hand4) {
  const used = new Set(hand4.map(c => c.id));
  const outs = [];
  for (const c of FULL_DECK) {
    if (used.has(c.id)) continue;
    const e = evalHand([hand4[0], hand4[1], hand4[2], hand4[3], c]);
    outs.push({ key: e.key, mult: e.mult, type: e.type });
  }
  return outs;
}
function analyze4(hand4, pi, outs) {
  const o = outs || finalOutcomes(hand4);
  const p = pi || BASE_PI;
  const typeProb = new Array(TYPE_NAMES.length).fill(0);
  let ev = 0, ex2 = 0, w = 0, mult = 0;
  const per = [];
  for (const x of o) {
    const s = edgeVs(x.key, x.mult, p);
    per.push(s);
    ev += s.ev; ex2 += s.ex2; w += s.w; mult += x.mult;
    typeProb[x.type]++;
  }
  const n = o.length;
  for (let t = 0; t < typeProb.length; t++) typeProb[t] /= n;
  ev /= n; ex2 /= n;
  return { outs: o, per, typeProb, ev, ex2, var: Math.max(0, ex2 - ev * ev), win: w / n, expMult: mult / n };
}

/* 当庄时（单位 = 底注 × 庄倍）的总收益期望与方差。
   opps: [{ bets: [{ b, p, pi }] }] 每个闲家可能的押注 b、概率 p、押该倍数时的牌力分布 pi。
   给定庄家最终牌 h，各闲家相互独立：E[X|h] = Σ E_j，Var[X|h] = Σ Var_j；再对 h 取全期望 / 全方差。 */
function bankerStats(outs, opps) {
  let m1 = 0, m2 = 0;
  for (const x of outs) {
    let e = 0, v = 0;
    for (const op of opps) {
      let ej = 0, sj = 0;
      for (const bp of op.bets) {
        const s = edgeVs(x.key, x.mult, bp.pi);
        ej += bp.p * bp.b * s.ev;
        sj += bp.p * bp.b * bp.b * s.ex2;
      }
      e += ej; v += Math.max(0, sj - ej * ej);
    }
    m1 += e; m2 += v + e * e;
  }
  const n = outs.length;
  m1 /= n; m2 /= n;
  return { ev: m1, var: Math.max(0, m2 - m1 * m1) };
}

/* 简单牌力（简单 / 普通难度用的直觉打分）：大牌越多、已有 3 张凑十越好 */
function quickStrength(hand4) {
  const pts = hand4.map(point);
  let tens = 0;
  for (const p of pts) if (p === 10) tens++;
  let hasTri = false;
  for (let a = 0; a < 2; a++) for (let b = a + 1; b < 3; b++) for (let c = b + 1; c < 4; c++)
    if ((pts[a] + pts[b] + pts[c]) % 10 === 0) hasTri = true;
  const faces = hand4.filter(c => c.r > 10).length;
  const cnt = {};
  for (const c of hand4) cnt[c.r] = (cnt[c.r] || 0) + 1;
  const trips = Object.values(cnt).some(v => v >= 3);
  const small = hand4.every(c => c.r < 5) && pts.reduce((a, b) => a + b, 0) <= 9;
  return tens * 0.55 + (hasTri ? 1.1 : 0) + (faces === 4 ? 1.2 : 0) + (trips ? 1 : 0) + (small ? 1.5 : 0);
}

/* ---------------- AI ----------------
   简单：基本随机（略偏好牌），经常过度激进
   普通：直觉阈值（已有 3 张凑十 / 大牌多就抢；押注按牌力分档）
   困难：枚举第 5 张 + 基准分布 → 精确期望 / 方差，按分数凯利（均值-方差）做风险控制
   大师：困难 + 对每个对手（包括你）做贝叶斯建模：
         抢庄倍数 / 押注倍数 → 亮牌后的真实牌力（Dirichlet 计数），据此推断庄家牌力并预测闲家押注 */
const HARD_BET_PRIOR = [{ b: 1, p: 0.35 }, { b: 2, p: 0.3 }, { b: 3, p: 0.2 }, { b: 5, p: 0.15 }];
const RISK_F = { hard: [0.35, 0.5, 0.7], master: [1.8, 2.7, 3.6] };   // [筹码<一半, <初始, ≥初始]
const MODEL_WEIGHT = 8;                   // 先验相当于 8 次观察
const GRAB_TILT = [-0.12, 0, 0.08, 0.15, 0.22];
const BET_TILT = { 1: -0.08, 2: 0, 3: 0.08, 5: 0.15 };

function tiltPi(t) {
  const out = BASE_PI.map((p, j) => p * Math.exp(t * (j - 2.5)));
  const s = out.reduce((a, b) => a + b, 0);
  return out.map(x => x / s);
}
function weightedPick(rng, items, weights) {
  const tot = weights.reduce((a, b) => a + b, 0);
  let r = rng() * tot;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r < 0) return items[i]; }
  return items[items.length - 1];
}

class Brain {
  constructor(diff, rng, id) {
    this.diff = diff;
    this.id = id;
    this.rng = rng || Math.random;
    this.models = {};                       // 大师：id → { sig: {g0..g4,b1..b5,forced: Float64Array(NB)}, bets: {1,2,3,5} }
    this.last = null;                       // 最近一次决策的分析（UI/调试用）
  }
  /* 分数凯利：效用 = 均值 - 方差 / (2·f·W)。筹码越少 W 越小、f 也越小 → 越保守。
     困难的估计忽略了“出价暴露牌力”，系统性偏乐观，所以 f 取得较小；
     大师的模型经自对弈校准（预测收益≈实际收益），可以放心用更大的 f 去争庄。 */
  riskAversion(chips, start) {
    const W = Math.max(chips, 1);
    const tier = W < start * 0.5 ? 0 : W < start ? 1 : 2;
    const f = (this.diff >= 3 ? RISK_F.master : RISK_F.hard)[tier];
    return 1 / (2 * f * W);
  }
  grab(v) {
    const { hand, rng } = Object.assign({ rng: this.rng }, v);
    const s = quickStrength(hand);
    if (this.diff === 0) {
      const w = s >= 2 ? [0.6, 1, 2, 3, 3.5] : [1.6, 1.6, 2.2, 2, 1.6];
      return weightedPick(rng, GRAB_OPTS, w);
    }
    if (this.diff === 1) {
      if (s >= 3.2) return 4;
      if (s >= 2.4) return 3;
      if (s >= 1.6) return 2;
      if (s >= 1.1) return 1;
      return 0;
    }
    return this.calcGrab(v);
  }
  bet(v) {
    const { hand } = v;
    const rng = this.rng;
    const s = quickStrength(hand);
    if (this.diff === 0) {
      const w = s >= 2 ? [0.6, 1, 2.2, 3.4] : [1.5, 1.8, 2, 2];
      return weightedPick(rng, BET_OPTS, w);
    }
    if (this.diff === 1) {
      if (s >= 3) return 5;
      if (s >= 2.2) return 3;
      if (s >= 1.4) return 2;
      return 1;
    }
    return this.calcBet(v);
  }
  /* ---- 困难 / 大师：精确计算 ---- */
  calcGrab(v) {
    const { hand, chips, startChips, base } = v;
    const lam = this.riskAversion(chips, startChips);
    const outs = finalOutcomes(hand);
    const opps = (v.opponents || [0, 1, 2, 3]).slice(0, 4).map(id => ({ bets: this.diff >= 3 ? this.betModel(id) : HARD_BET_PRIOR.map(x => ({ b: x.b, p: x.p, pi: BASE_PI })) }));
    const bs = bankerStats(outs, opps);
    let bestK = 0, bestU = -Infinity;
    for (let k = 1; k <= 4; k++) {
      const u = k * base * bs.ev - lam * (k * base) * (k * base) * bs.var;
      if (u > bestU) { bestU = u; bestK = k; }
    }
    // 不抢时大概率当闲家：对手庄家通常是抢了庄的，牌力偏强
    const idlePi = this.diff >= 3 ? tiltPi(GRAB_TILT[2]) : BASE_PI;
    const a = analyze4(hand, idlePi, outs);
    let idleU = -Infinity;
    for (const b of BET_OPTS) {
      const st = b * 2 * base;
      idleU = Math.max(idleU, st * a.ev - lam * st * st * a.var);
    }
    this.last = { phase: 'grab', bankEV: bs.ev, bankVar: bs.var, idleEV: a.ev, bestK, bestU, idleU };
    return bestU > idleU && bestU > 0 ? bestK : 0;
  }
  calcBet(v) {
    const { hand, chips, startChips, base, bankerMult } = v;
    const lam = this.riskAversion(chips, startChips);
    let pi = BASE_PI;
    if (this.diff >= 3 && v.bankerId != null) pi = this.posterior(v.bankerId, v.forced ? 'forced' : 'g' + (v.bankerGrab || 0));
    const a = analyze4(hand, pi);
    let best = 1, bestU = -Infinity;
    for (const b of BET_OPTS) {
      const st = b * bankerMult * base;
      const u = st * a.ev - lam * st * st * a.var;
      if (u > bestU) { bestU = u; best = b; }
    }
    this.last = { phase: 'bet', ev: a.ev, var: a.var, best };
    return best;
  }
  /* ---- 大师：对手模型 ---- */
  model(id) {
    let m = this.models[id];
    if (!m) {
      m = { sig: {}, bets: { 1: 1.4, 2: 1.2, 3: 0.8, 5: 0.6 }, n: 0 };
      this.models[id] = m;
    }
    return m;
  }
  prior(sig) {
    if (sig[0] === 'g') return tiltPi(GRAB_TILT[+sig.slice(1)] || 0);
    if (sig[0] === 'b') return tiltPi(BET_TILT[+sig.slice(1)] || 0);
    return BASE_PI;
  }
  posterior(id, sig) {
    const m = this.model(id);
    const pr = this.prior(sig);
    const c = m.sig[sig];
    const out = pr.map((p, j) => p * MODEL_WEIGHT + (c ? c[j] : 0));
    const s = out.reduce((a, b) => a + b, 0);
    return out.map(x => x / s);
  }
  betModel(id) {
    const m = this.model(id);
    const tot = BET_OPTS.reduce((a, b) => a + m.bets[b], 0);
    return BET_OPTS.map(b => ({ b, p: m.bets[b] / tot, pi: this.posterior(id, 'b' + b) }));
  }
  /* rec: { forced, entries: [{ id, grab, bet, isBanker, type }] }，每局亮牌后所有 AI 都会收到 */
  observe(rec) {
    if (this.diff < 3) return;
    for (const e of rec.entries) {
      if (e.id === this.id) continue;
      const m = this.model(e.id);
      const bucket = TYPE_BUCKET[e.type];
      const add = sig => { (m.sig[sig] || (m.sig[sig] = new Float64Array(NB)))[bucket] += 1; };
      if (rec.forced) { if (e.isBanker) add('forced'); }
      else add('g' + (e.grab || 0));
      if (!e.isBanker && e.bet) { add('b' + e.bet); m.bets[e.bet] += 1; }
      m.n++;
    }
  }
}

/* ---------------- 无头对局引擎（自对弈 / 测试用） ----------------
   seats: [{ id, diff, chips, brain }]；返回本局记录 */
function playRoundSync(seats, opts, rng) {
  const base = opts.base, start = opts.startChips;
  const deck = Hub.shuffle(newDeck(), rng);
  const hands = seats.map((_, i) => deck.slice(i * 5, i * 5 + 5));
  const ids = seats.map(s => s.id);
  const grabs = seats.map((s, i) => opts.forceBanker && i === 0 ? FORCE_BANKER_MULT
    : opts.forceBanker ? 0
      : s.brain.grab({ hand: hands[i].slice(0, 4), chips: s.chips, startChips: start, base, opponents: ids.filter((_, j) => j !== i) }));
  const bk = opts.forceBanker ? { banker: 0, mult: FORCE_BANKER_MULT, candidates: [0] } : resolveBanker(grabs, rng);
  const bets = seats.map((s, i) => i === bk.banker ? 0 : s.brain.bet({
    hand: hands[i].slice(0, 4), chips: s.chips, startChips: start, base,
    bankerId: seats[bk.banker].id, bankerMult: bk.mult, bankerGrab: grabs[bk.banker], forced: !!opts.forceBanker,
  }));
  const evals = hands.map(h => evalHand(h));
  const st = settle(seats.map(s => s.chips), bk.banker, bk.mult, bets, evals, base);
  seats.forEach((s, i) => { s.chips += st.delta[i]; });
  const rec = {
    forced: !!opts.forceBanker,
    entries: seats.map((s, i) => ({ id: s.id, grab: grabs[i], bet: bets[i], isBanker: i === bk.banker, type: evals[i].type })),
  };
  for (const s of seats) s.brain.observe(rec);
  return { hands, grabs, bets, banker: bk.banker, bankerMult: bk.mult, evals, delta: st.delta, results: st.results };
}

/* 自对弈：diffs 为 5 个座位的难度；AI 输光后由同难度新 AI（新 id，模型清零）入座。
   返回每个难度的总盈亏 / 参与局数 / 破产次数 */
function selfPlay(diffs, rounds, seed, opts) {
  const o = Object.assign({ base: 10, startChips: 1000, forceBanker: false }, opts);
  const rng = mulberry32(seed);
  let nextId = 0;
  const mkSeat = d => { const id = 'ai' + (nextId++); return { id, diff: d, chips: o.startChips, brain: new Brain(d, rng, id) }; };
  const seats = diffs.map(mkSeat);
  const stat = {};
  for (const d of diffs) stat[d] = stat[d] || { profit: 0, seatRounds: 0, busts: 0, banker: 0 };
  for (let r = 0; r < rounds; r++) {
    const res = playRoundSync(seats, o, rng);
    seats.forEach((s, i) => {
      stat[s.diff].profit += res.delta[i];
      stat[s.diff].seatRounds++;
      if (i === res.banker) stat[s.diff].banker++;
    });
    if (o.onRound) o.onRound(res, seats);
    seats.forEach((s, i) => { if (s.chips <= 0) { stat[s.diff].busts++; seats[i] = mkSeat(s.diff); } });
  }
  return stat;
}

/* ============================================================
   UI
   ============================================================ */
/* ---------------- AI 角色 ---------------- */
const AI_POOL = [
  { emoji: '🐂', name: '牛大哥', lines: {
    grab: ['这庄我坐定了！', '牛气冲天，抢！', '庄家的位置，非我莫属。'], pass: ['这把先歇歇蹄子。'],
    bet: ['跟你拼了！押！', '哞——加倍！'], banker: ['都坐好，牛大哥来坐庄！'],
    big: ['牛牛！哞——！', '看看这是什么牌！'], win: ['承让承让～', '牛就是牛。'], lose: ['哞…亏大了', '下把找回来！'] } },
  { emoji: '🦁', name: '狮子王', lines: {
    grab: ['草原之王，抢庄！', '吼——这庄归我！'], pass: ['狮子也要打个盹。'],
    bet: ['王者从不退缩！', '押满，吼！'], banker: ['臣服吧，我是庄！'],
    big: ['吼！这就是王者之牌！'], win: ['猎物到手。', '王者归来。'], lose: ['可恶……一时失手。', '吼……记住你了！'] } },
  { emoji: '🐼', name: '团团', lines: {
    grab: ['团团也想当庄家～', '抢一下下嘛～'], pass: ['竹子比较重要，不抢了～'],
    bet: ['嘿嘿，押多一点～', '感觉会赢哦！'], banker: ['团团当庄啦！'],
    big: ['哇！团团拿到大牌啦！'], win: ['好耶～有竹子吃了！'], lose: ['呜呜，我的竹子钱……', '不哭不哭～'] } },
  { emoji: '🦉', name: '猫头鹰', lines: {
    grab: ['期望值为正，抢庄。', '根据计算，这个庄值得抢。'], pass: ['胜率不足，不抢。', '方差太大，观望。'],
    bet: ['数学告诉我：加倍。', '赔率合适。'], banker: ['一切尽在计算之中。'],
    big: ['小概率事件，发生在我身上了。'], win: ['QED，证明完毕。'], lose: ['样本量还不够大。', '短期波动而已。'] } },
  { emoji: '🦊', name: '狐小妹', lines: {
    grab: ['嘻嘻，这庄我要了～', '猜猜我是不是在诈唬？'], pass: ['先看看你们怎么玩～'],
    bet: ['跟你玩玩～', '押！别眨眼哦～'], banker: ['都来送钱吧～'],
    big: ['哎呀，手气太好啦～'], win: ['谢谢款待～'], lose: ['哼，下次不会了！'] } },
  { emoji: '🐯', name: '虎哥', lines: {
    grab: ['虎哥坐庄，谁敢不服？', '抢！'], pass: ['这把放你们一马。'],
    bet: ['干就完了！', '老虎不发威你当我病猫？'], banker: ['虎哥坐镇！'],
    big: ['嗷呜！大牌！'], win: ['哈哈，痛快！'], lose: ['可恶！再来！'] } },
  { emoji: '🐸', name: '呱呱', lines: {
    grab: ['呱！抢！', '井底之蛙也想当庄～'], pass: ['呱……不抢。'],
    bet: ['呱呱，押了！'], banker: ['呱！我是庄！'],
    big: ['呱呱呱！牛牛！'], win: ['呱～开心！'], lose: ['呱……'] } },
  { emoji: '🐵', name: '猴老三', lines: {
    grab: ['俺老三来也，抢庄！'], pass: ['先溜达一圈～'],
    bet: ['押！押！押！', '吃俺老三一棒！'], banker: ['猴子称大王！'],
    big: ['嘿嘿，七十二变也变不出这么好的牌！'], win: ['哈哈，桃子钱有了！'], lose: ['哎呀呀，翻车了。'] } },
  { emoji: '🐲', name: '龙少', lines: {
    grab: ['本少爷坐庄。', '钱不是问题，抢！'], pass: ['没意思，不抢。'],
    bet: ['这点钱，随便押。'], banker: ['本少爷来坐庄。'],
    big: ['龙腾四海！'], win: ['零花钱又多了。'], lose: ['回家找老爹要钱……'] } },
  { emoji: '🐰', name: '兔兔', lines: {
    grab: ['兔兔鼓起勇气抢一下！'], pass: ['兔兔胆子小，不抢～'],
    bet: ['押、押一点点……'], banker: ['兔兔当庄，好紧张！'],
    big: ['哇！兔兔的牌好大！'], win: ['耶～胡萝卜！'], lose: ['呜……兔兔的胡萝卜没了。'] } },
];

const RULES_HTML = `
<p><b>人数：</b>你 + 4 位 AI，一副 52 张（无大小王）。点数：A=1，2~10 为面值，J/Q/K=10。</p>
<p><b>每局流程：</b><br>
① 每人先发 4 张（你能看到自己的 4 张）；<br>
② <b>抢庄</b>：选择 不抢 / 抢×1 / ×2 / ×3 / ×4（你先选，AI 同时暗选，再一起揭晓）。最高倍者坐庄，倍数即“庄倍”；并列随机；全都不抢则随机一人坐庄、庄倍 ×1；<br>
③ <b>押注</b>：每个闲家选择 ×1 / ×2 / ×3 / ×5；<br>
④ 发第 5 张，所有人亮牌<b>摆牛</b>：从 5 张中找 3 张点数和为 10 的倍数（凑成“牛”），另外 2 张之和的个位数就是“牛几”，个位为 0 即<b>牛牛</b>；找不到就是<b>没牛</b>；<br>
⑤ <b>结算</b>：每个闲家单独和庄家比牌，赢方得 <b>底注 × 庄倍 × 闲家押注倍数 × 赢方牌型倍数</b>。</p>
<p><b>牌型与倍数（由小到大）：</b>没牛 ×1 · 牛1~牛6 ×1 · 牛7/牛8 ×2 · 牛9 ×3 · <b>牛牛 ×4</b> · <b>五花牛 ×5</b>（5 张全是 JQK）· <b>炸弹牛 ×6</b>（4 张同点）· <b>五小牛 ×8</b>（5 张都小于 5 且点数和 ≤ 10）。特殊牌型优先：五小牛 &gt; 炸弹 &gt; 五花 &gt; 牛牛 &gt; 牛9 … &gt; 没牛。</p>
<p><b>同牌型比较：</b>比最大的单张（K&gt;Q&gt;J&gt;10&gt;…&gt;A），同点再比花色 ♠&gt;♥&gt;♣&gt;♦；炸弹比炸弹的点数。</p>
<p><b>筹码保护：</b>任何人最多输掉自己当前全部筹码；庄家（自有筹码 + 本局收到的钱）不够赔时，按比例赔付各赢家。AI 输光会有新 AI 入座；<b>你输光则比赛立即失败</b>。</p>
<p><b>亮牌：</b>默认开启“自动亮牌”，第 5 张发出 2 秒后自动亮牌。开启<b>手动摆牛</b>后可自己点选 3 张凑成 10 的倍数再亮牌——这只是趣味练习：牛几由总点数决定，任何合法组合结果都一样；如果你选错而其实有牛，系统会自动帮你摆好，不影响结果。</p>
<p><b>📊 牌力参考</b>（简单/普通/困难可用）：根据你的 4 张牌枚举剩下 48 张可能的第 5 张，显示各牌型概率、期望倍数、对随机牌的胜率，以及“困难 AI”在你的位置会怎么选。</p>
<p><b>快捷键：</b>抢庄 <b>0~4</b>（0=不抢）· 押注 <b>1 / 2 / 3 / 5</b> · <b>空格 / 回车</b> 亮牌、下一局。</p>
<p><b>AI 难度：</b>🌱 简单：凭感觉乱抢乱押，经常过度激进；⚔️ 普通：按大牌数、是否已有 3 张凑十等直觉分档；🔥 困难：枚举第 5 张精确计算抢庄 / 押注的期望与方差，按筹码做凯利式风险控制；👑 大师：在困难基础上记录每个对手（尤其是你）的“出价 → 亮牌”历史做贝叶斯推断——你常空抢，你的高倍抢庄就会被当成诈唬；庄家的抢庄倍数也会被用来推测其牌力。</p>`;

if (typeof document !== 'undefined') {
  (function () {
    const ctx = Hub.init({ game: 'douniu', defaults: DEFAULTS, rules: RULES_HTML });
    const P = ctx.params;
    P.rounds = Math.max(1, Math.round(P.rounds));
    P.startChips = Math.max(1, Math.round(P.startChips));
    P.base = Math.max(1, Math.round(P.base));
    const DIFF = ctx.diffIndex;
    const $ = id => document.getElementById(id);

    /* ---------- 选项（仅本机便利设置） ---------- */
    const OPT_KEY = 'douniu.opts';
    const opts = (() => {
      const d = { auto: true, manual: false, ref: DIFF < 2 };
      try { return Object.assign(d, JSON.parse(localStorage.getItem(OPT_KEY)) || {}); } catch (e) { return d; }
    })();
    function saveOpts() { try { localStorage.setItem(OPT_KEY, JSON.stringify(opts)); } catch (e) { /* 忽略 */ } }

    /* ---------- 状态 ---------- */
    const usedNames = new Set();
    let aiSerial = 0;
    function newAI() {
      let pick = AI_POOL.find(a => !usedNames.has(a.name));
      let name;
      if (pick) name = pick.name;
      else { pick = AI_POOL[aiSerial % AI_POOL.length]; name = pick.name + (2 + Math.floor(aiSerial / AI_POOL.length)) + '号'; }
      usedNames.add(name);
      const id = 'ai' + (aiSerial++);
      return { id, isMe: false, name, emoji: pick.emoji, lines: pick.lines, chips: P.startChips, brain: new Brain(DIFF, Math.random, id) };
    }
    const st = {
      round: 0, players: [], hands: [], grabs: [], bets: [], evals: [],
      banker: -1, bankerMult: 1, bankerRounds: 0, bestHand: 0, bestType: -1, records: [],
      picks: new Set(), phase: 'idle',
    };
    st.players.push({ id: 'me', isMe: true, name: '你', emoji: '😎', chips: P.startChips });
    for (let i = 0; i < 4; i++) st.players.push(newAI());
    // 每个座位的显示状态
    function resetView(p) {
      Object.assign(p, { dealt: 0, revealed: null, status: '', kind: '', grabTag: '', betTag: '', acting: false });
    }
    st.players.forEach(resetView);

    /* ---------- 座位 DOM ---------- */
    function buildSeats() {
      for (let i = 0; i < 5; i++) {
        const el = $('dn-seat-' + i);
        el.innerHTML = `
          <div class="hub-seat">
            <div class="avatar"></div><div class="name"></div><div class="sub"></div>
            <div class="dn-tags"></div>
          </div>
          <div class="dn-cardcol">
            <div class="hub-status"></div>
            <div class="dn-hand ${i === 0 ? 'hub-hand mine' : ''}"></div>
            <div class="dn-niu"></div>
          </div>`;
      }
      Hub.enableHandSelect($('dn-seat-0').querySelector('.dn-hand'), onPick);
    }
    const seatEl = i => $('dn-seat-' + i);
    const boxEl = i => seatEl(i).querySelector('.hub-seat');

    function renderSeat(i) {
      const p = st.players[i], el = seatEl(i), box = boxEl(i);
      box.querySelector('.avatar').textContent = p.emoji;
      box.querySelector('.name').textContent = p.name;
      box.querySelector('.sub').textContent = '💰 ' + p.chips;
      box.classList.toggle('acting', !!p.acting);
      box.classList.toggle('banker', i === st.banker);
      const tags = [];
      if (i === st.banker) tags.push(`<span class="tag gold">👑 庄 ×${st.bankerMult}</span>`);
      if (p.grabTag) tags.push(`<span class="tag blue">${p.grabTag}</span>`);
      if (p.betTag) tags.push(`<span class="tag">${p.betTag}</span>`);
      const th = tags.join('');
      const tg = box.querySelector('.dn-tags');
      if (tg.innerHTML !== th) tg.innerHTML = th;
      const s = el.querySelector('.hub-status');
      if (s.textContent !== p.status) s.textContent = p.status;
      s.dataset.kind = p.acting ? 'acting' : p.kind;
      const niu = el.querySelector('.dn-niu');
      if (p.revealed) {
        const e = p.revealed;
        niu.textContent = `${e.name}${e.mult > 1 ? ' ×' + e.mult : ''}`;
        niu.dataset.tier = typeTier(e.type);
      } else { niu.textContent = ''; niu.dataset.tier = ''; }
      renderHand(i);
    }
    function renderHand(i) {
      const p = st.players[i];
      const hand = st.hands[i] || [];
      const cont = seatEl(i).querySelector('.dn-hand');
      cont.classList.toggle('locked', !(p.isMe && st.phase === 'reveal' && opts.manual && !p.revealed));
      if (p.revealed) {
        // 亮牌：凑十的 3 张 | 另 2 张（整手重绘一次，带翻牌动画）
        const g = p.revealed.groups;
        const order = g ? g[0].concat(g[1]) : [0, 1, 2, 3, 4];
        const sig = 'R' + order.map(k => hand[k].id).join('|');
        if (cont.dataset.sig === sig) return;
        cont.dataset.sig = sig;
        cont.classList.add('shown');
        cont.innerHTML = order.map((k, n) => Hub.cardHTML(hand[k], {
          cls: (g && n === g[0].length ? 'gap ' : '') + (g && n < g[0].length ? 'niu3' : ''),
          hl: p.revealed.type >= 10,
        })).join('');
        return;
      }
      // 未亮牌：只追加新发的牌，已有的牌节点保留（避免重复播放发牌动画造成闪烁）
      const cards = hand.slice(0, p.dealt);
      const want = cards.map(c => (p.isMe ? c.id : 'back'));
      const have = Array.from(cont.children).map(e => e.dataset.id || 'back');
      if (cont.classList.contains('shown') || have.length > want.length || have.some((x, k) => x !== want[k])) {
        cont.innerHTML = '';
        have.length = 0;
      }
      cont.classList.remove('shown');
      cont.dataset.sig = '';
      for (let k = have.length; k < want.length; k++) cont.insertAdjacentHTML('beforeend', Hub.cardHTML(p.isMe ? cards[k] : null, { back: !p.isMe }));
      if (p.isMe) Array.from(cont.children).forEach(e => e.classList.toggle('sel', st.picks.has(e.dataset.id)));
    }
    function renderAll() { for (let i = 0; i < 5; i++) renderSeat(i); updateInfo(); }

    function setStatus(i, text, kind) { const p = st.players[i]; p.status = text; p.kind = kind || ''; renderSeat(i); }
    function setActing(i, on) { st.players[i].acting = on; renderSeat(i); }
    function setPhase(main, sub) { $('dn-phase').textContent = main; if (sub != null) $('dn-sub').innerHTML = sub; }
    function updateInfo() {
      const me = st.players[0];
      Hub.setInfo(`第 <b>${Math.max(st.round, 1)}</b>/${P.rounds} 局 · 筹码 <b>${me.chips}</b> · 目标 ${P.target} · 底注 ${P.base}`);
    }
    function speak(i, kind, prob) {
      const p = st.players[i];
      if (p.isMe || !p.lines || !p.lines[kind]) return;
      if (Math.random() > (prob == null ? 0.35 : prob)) return;
      Hub.bubble(boxEl(i), Hub.randPick(p.lines[kind]), undefined, p.name);
    }
    function floatDelta(i, v) {
      const d = document.createElement('div');
      d.className = 'dn-float ' + (v > 0 ? 'up' : v < 0 ? 'down' : 'zero');
      d.textContent = (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v);
      seatEl(i).appendChild(d);
      setTimeout(() => d.remove(), 2400);
    }
    function addLog(html) {
      const log = $('dn-log');
      const div = document.createElement('div');
      div.innerHTML = html;
      log.appendChild(div);
      while (log.children.length > 80) log.firstChild.remove();
      log.scrollTop = log.scrollHeight;
    }
    function addRecord(r) {
      st.records.push(r);
      const tb = $('dn-record').querySelector('tbody');
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.round}</td><td>${r.banker}</td><td class="t-${typeTier(r.type)}">${TYPE_NAMES[r.type]}</td><td class="${r.delta > 0 ? 'pos' : r.delta < 0 ? 'neg' : ''}">${r.delta > 0 ? '+' : ''}${r.delta}</td>`;
      tb.appendChild(tr);
      const wrap = tb.closest('.dn-record-wrap');
      if (wrap) wrap.scrollTop = wrap.scrollHeight;
    }

    /* ---------- 操作按钮 & 快捷键 ---------- */
    let keyMap = {};
    function setButtons(list, hint) {
      const box = $('dn-btns');
      box.innerHTML = '';
      keyMap = {};
      for (const b of list) {
        const el = document.createElement('button');
        el.className = 'hub-btn big ' + (b.cls || '');
        el.innerHTML = `${b.label}${b.kbd ? `<kbd>${b.kbd}</kbd>` : ''}`;
        el.onclick = () => { if (!el.disabled) { Hub.sfx('click'); b.fn(); } };
        box.appendChild(el);
        for (const k of b.keys || []) keyMap[k] = () => el.click();
      }
      $('dn-hint').innerHTML = hint || '';
    }
    function clearButtons(hint) { setButtons([], hint); }
    document.addEventListener('keydown', e => {
      if (document.querySelector('.hub-overlay.show')) return;
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      const k = e.key === ' ' ? 'Space' : e.key;
      if (keyMap[k]) { e.preventDefault(); keyMap[k](); }
    });
    // 把一组按钮变成 Promise：用户点击 / 快捷键后 resolve
    function ask(list, hint) {
      return new Promise(resolve => {
        setButtons(list.map(b => Object.assign({}, b, { fn: () => { clearButtons(); resolve(b.val); } })), hint);
      });
    }

    /* ---------- 牌力参考 ---------- */
    const helper = new Brain(2, Math.random, 'helper');
    function renderRef() {
      const el = $('dn-ref');
      const show = DIFF < 3 && opts.ref && (st.phase === 'grab' || st.phase === 'bet') && st.players[0].dealt >= 4;
      el.classList.toggle('show', show);
      if (!show) return;
      const hand = st.hands[0].slice(0, 4);
      const a = analyze4(hand);
      const tp = a.typeProb;
      const sum = (lo, hi) => tp.slice(lo, hi + 1).reduce((x, y) => x + y, 0);
      const rows = [
        ['没牛', sum(0, 0), 'none'], ['牛1-6', sum(1, 6), 'low'], ['牛7-8', sum(7, 8), 'mid'], ['牛9', sum(9, 9), 'mid'],
        ['牛牛', sum(10, 10), 'gold'], ['五花/炸弹/五小', sum(11, 13), 'special'],
      ];
      let advice = '';
      const me = st.players[0];
      if (st.phase === 'grab') {
        const k = helper.calcGrab({ hand, chips: me.chips, startChips: P.startChips, base: P.base, opponents: st.players.slice(1).map(p => p.id) });
        advice = `困难 AI 会：<b>${k ? '抢 ×' + k : '不抢'}</b>`;
      } else {
        const b = helper.calcBet({ hand, chips: me.chips, startChips: P.startChips, base: P.base, bankerMult: st.bankerMult });
        advice = `困难 AI 会：<b>押 ×${b}</b>`;
      }
      el.innerHTML = `<div class="ref-title">📊 牌力参考 <span>第 5 张共 48 种可能</span></div>
        ${rows.map(r => `<div class="ref-row"><span class="ref-name t-${r[2]}">${r[0]}</span><span class="ref-bar"><i style="width:${(r[1] * 100).toFixed(1)}%"></i></span><span class="ref-pct">${(r[1] * 100).toFixed(1)}%</span></div>`).join('')}
        <div class="ref-sum">期望倍数 <b>×${a.expMult.toFixed(2)}</b> · 对随机牌胜率 <b>${(a.win * 100).toFixed(0)}%</b></div>
        <div class="ref-sum">每单位押注期望 <b class="${a.ev >= 0 ? 'pos' : 'neg'}">${a.ev >= 0 ? '+' : ''}${a.ev.toFixed(2)}</b> · ${advice}</div>`;
    }

    /* ---------- 手动摆牛 ---------- */
    function onPick(ids) {
      if (!(st.phase === 'reveal' && opts.manual && !st.players[0].revealed)) return;
      if (ids === null) st.picks.clear();
      else for (const id of ids) {
        if (st.picks.has(id)) st.picks.delete(id);
        else if (st.picks.size < 3) st.picks.add(id);
        else Hub.toast('只能选 3 张牌凑十');
      }
      renderHand(0);
      updatePickHint();
    }
    function pickInfo() {
      const hand = st.hands[0];
      const idx = hand.map((c, k) => (st.picks.has(c.id) ? k : -1)).filter(k => k >= 0);
      const sum = idx.reduce((s, k) => s + point(hand[k]), 0);
      return { idx, sum };
    }
    function updatePickHint() {
      if (!(st.phase === 'reveal' && opts.manual)) return;
      const { idx, sum } = pickInfo();
      $('dn-hint').innerHTML = `✋ 手动摆牛：点选 3 张点数和为 10 的倍数的牌 · 已选 <b>${idx.length}</b>/3 张` +
        (idx.length ? `，点数和 <b class="${idx.length === 3 && sum % 10 === 0 ? 'pos' : ''}">${sum}</b>` : '') + '（右键清空）';
    }

    /* ---------- 一局 ---------- */
    function aiIdx() { return [1, 2, 3, 4]; }
    function grabText(g) { return g ? `抢×${g}` : '不抢'; }

    async function playRound() {
      st.round++;
      st.banker = -1; st.bankerMult = 1; st.picks.clear();
      st.grabs = [0, 0, 0, 0, 0]; st.bets = [0, 0, 0, 0, 0]; st.evals = [];
      st.players.forEach(resetView);
      st.phase = 'deal';
      renderAll();
      setPhase('发牌中…', `底注 <b>${P.base}</b> · 第 ${st.round}/${P.rounds} 局`);
      const deck = Hub.shuffle(newDeck());
      Hub.sfx('shuffle');
      st.hands = st.players.map((_, i) => deck.slice(i * 5, i * 5 + 5));
      for (let k = 0; k < 4; k++) {
        for (let i = 0; i < 5; i++) { st.players[i].dealt = k + 1; renderHand(i); }
        Hub.sfx('deal');
        await Hub.wait(140);
      }

      /* 抢庄 */
      if (P.forceBanker) {
        st.grabs = [FORCE_BANKER_MULT, 0, 0, 0, 0];
        st.banker = 0; st.bankerMult = FORCE_BANKER_MULT;
        Hub.banner(`👑 本局你固定坐庄 · 庄倍 ×${FORCE_BANKER_MULT}`, 1500);
        setPhase('你坐庄', `庄倍 <b>×${FORCE_BANKER_MULT}</b> · 底注 ${P.base}`);
        renderAll();
        await Hub.wait(1100);
      } else {
        st.phase = 'grab';
        setPhase('抢庄中…', `看 4 张牌决定抢不抢庄 · 底注 <b>${P.base}</b>`);
        setActing(0, true); setStatus(0, '请抢庄', 'acting');
        renderRef();
        const g = await ask(GRAB_OPTS.map(k => ({
          label: k ? `抢 ×${k}` : '不抢', kbd: String(k), keys: [String(k)], val: k,
          cls: k === 0 ? 'gray' : k >= 3 ? 'orange' : 'blue',
        })), '选择抢庄倍数：倍数最高者坐庄，庄倍越高输赢越大');
        st.grabs[0] = g;
        Hub.call('你', 'grab' + g);
        st.players[0].grabTag = grabText(g);
        setActing(0, false); setStatus(0, grabText(g), g ? 'hot' : 'pass');
        // AI 同时暗选（看不到你的选择）
        const ids = st.players.map(p => p.id);
        const aiG = {};
        for (const i of aiIdx()) {
          const p = st.players[i];
          aiG[i] = p.brain.grab({ hand: st.hands[i].slice(0, 4), chips: p.chips, startChips: P.startChips, base: P.base, opponents: ids.filter((_, j) => j !== i) });
        }
        for (const i of aiIdx()) {
          const p = st.players[i];
          setActing(i, true); setStatus(i, '思考中…');
          await Hub.wait(420 + Math.random() * 260);
          st.grabs[i] = aiG[i];
          p.grabTag = grabText(aiG[i]);
          setActing(i, false); setStatus(i, grabText(aiG[i]), aiG[i] ? 'hot' : 'pass');
          Hub.sfx(aiG[i] ? 'chip' : 'pass');
          Hub.call(p.name, 'grab' + aiG[i]);
          speak(i, aiG[i] >= 3 ? 'grab' : aiG[i] === 0 ? 'pass' : '', aiG[i] >= 3 ? 0.45 : 0.18);
        }
        st.phase = 'pick';
        renderRef();
        const bk = resolveBanker(st.grabs);
        if (bk.candidates.length > 1) {
          setPhase(Math.max(...st.grabs) ? '倍数相同 · 随机定庄' : '无人抢庄 · 随机定庄');
          let cur = 0;
          const steps = 10 + bk.candidates.indexOf(bk.banker) + bk.candidates.length * 2;
          for (let s = 0; s < steps; s++) {
            const who = bk.candidates[cur % bk.candidates.length];
            bk.candidates.forEach(c => boxEl(c).classList.toggle('flash', c === who));
            Hub.sfx('tick');
            await Hub.wait(70 + s * 14);
            cur++;
          }
          // 落到真正的庄家
          bk.candidates.forEach(c => boxEl(c).classList.toggle('flash', c === bk.banker));
          await Hub.wait(350);
          bk.candidates.forEach(c => boxEl(c).classList.remove('flash'));
        }
        st.banker = bk.banker; st.bankerMult = bk.mult;
        const bp = st.players[bk.banker];
        Hub.sfx('allin');
        setTimeout(() => Hub.call(bp.name, 'zuozhuang'), 900);
        Hub.banner(`👑 ${bp.emoji} ${bp.isMe ? '你' : bp.name} 坐庄 · 庄倍 ×${bk.mult}`, 1400);
        setPhase(`${bp.isMe ? '你' : bp.name} 坐庄`, `庄倍 <b>×${bk.mult}</b> · 底注 ${P.base}`);
        renderAll();
        speak(bk.banker, 'banker', 0.5);
        await Hub.wait(900);
      }
      if (st.banker === 0) st.bankerRounds++;
      const bkr = st.players[st.banker];
      addLog(`<b>第 ${st.round} 局</b> · ${bkr.emoji}${bkr.name} 坐庄 ×${st.bankerMult}`);

      /* 押注 */
      st.phase = 'bet';
      setPhase('押注中…', `庄家 ${bkr.emoji} ${bkr.isMe ? '你' : bkr.name} · 庄倍 <b>×${st.bankerMult}</b> · 底注 ${P.base}`);
      if (st.banker !== 0) {
        setActing(0, true); setStatus(0, '请押注', 'acting');
        renderRef();
        const b = await ask(BET_OPTS.map(k => ({
          label: `押 ×${k}`, kbd: String(k), keys: [String(k)], val: k, cls: k >= 5 ? 'orange' : k >= 3 ? 'blue' : 'gray',
        })), `每局输赢 = 底注 ${P.base} × 庄倍 ${st.bankerMult} × 你的押注 × 赢方牌型倍数`);
        st.bets[0] = b;
        st.players[0].betTag = `押×${b}`;
        setActing(0, false); setStatus(0, `押×${b}`, 'info');
        Hub.sfx(b >= 3 ? 'chips' : 'chip');
        Hub.call('你', 'bet' + b);
      }
      st.phase = 'betai';
      renderRef();
      for (const i of aiIdx()) {
        if (i === st.banker) continue;
        const p = st.players[i];
        setActing(i, true); setStatus(i, '思考中…');
        await Hub.wait(380 + Math.random() * 240);
        const b = p.brain.bet({
          hand: st.hands[i].slice(0, 4), chips: p.chips, startChips: P.startChips, base: P.base,
          bankerId: bkr.id, bankerMult: st.bankerMult, bankerGrab: st.grabs[st.banker], forced: !!P.forceBanker,
        });
        st.bets[i] = b;
        p.betTag = `押×${b}`;
        setActing(i, false); setStatus(i, `押×${b}`, b >= 3 ? 'hot' : 'info');
        Hub.sfx(b >= 3 ? 'chips' : 'chip');
        Hub.call(p.name, 'bet' + b);
        if (b >= 3) speak(i, 'bet', 0.3);
      }

      /* 第 5 张 */
      st.phase = 'deal5';
      setPhase('发第 5 张…');
      for (let i = 0; i < 5; i++) { st.players[i].dealt = 5; renderHand(i); Hub.sfx('deal'); await Hub.wait(110); }
      st.evals = st.hands.map(h => evalHand(h));

      /* 亮牌 */
      st.phase = 'reveal';
      setPhase('亮牌', '摆出你的牛！');
      setActing(0, true); setStatus(0, '请亮牌', 'acting');
      renderHand(0);
      await playerReveal();
      setActing(0, false);
      revealSeat(0);
      await Hub.wait(500);
      // 从庄家下家开始依次亮牌，庄家最后
      const order = [1, 2, 3, 4, 0].map(k => (st.banker + k) % 5).filter(i => i !== 0);
      for (const i of order) {
        setActing(i, true);
        await Hub.wait(320);
        setActing(i, false);
        revealSeat(i);
        await Hub.wait(420);
      }

      /* 结算 */
      st.phase = 'settle';
      setPhase('结算', `庄家 ${bkr.isMe ? '你' : bkr.name}：${st.evals[st.banker].name}`);
      const chips = st.players.map(p => p.chips);
      const res = settle(chips, st.banker, st.bankerMult, st.bets, st.evals, P.base);
      const bE = st.evals[st.banker];
      const parts = [];
      for (let i = 0; i < 5; i++) {
        const p = st.players[i];
        p.chips += res.delta[i];
        const d = res.delta[i];
        if (i !== st.banker) {
          const r = res.results[i];
          parts.push(`${p.emoji}${p.name} ${st.evals[i].name} ${r.win ? '胜' : '负'} ${d > 0 ? '+' : ''}${d}`);
        }
        floatDelta(i, d);
        setStatus(i, d > 0 ? `赢 ${d}` : d < 0 ? `输 ${-d}` : '持平', d > 0 ? 'good' : d < 0 ? 'bad' : 'pass');
      }
      addLog(`庄 ${bkr.emoji}${bkr.name} ${bE.name}${bE.mult > 1 ? '×' + bE.mult : ''} ${res.delta[st.banker] > 0 ? '+' : ''}${res.delta[st.banker]}｜${parts.join('，')}${res.prorated ? '（庄家不够赔，按比例赔付）' : ''}`);
      if (res.prorated) Hub.toast('庄家筹码不足，按比例赔付');
      const myD = res.delta[0];
      Hub.sfx(myD > 0 ? 'coin' : myD < 0 ? 'lose' : 'pass');
      // 庄家通杀 / 通赔
      const others = [0, 1, 2, 3, 4].filter(i => i !== st.banker);
      if (others.every(i => res.delta[i] < 0)) { Hub.announce('tongsha'); Hub.sfx('chips'); }
      else if (others.every(i => res.delta[i] > 0)) { Hub.announce('tongpei'); Hub.sfx('chips'); }
      for (const i of aiIdx()) {
        const d = res.delta[i];
        if (d >= P.base * 8) speak(i, 'win', 0.35);
        else if (d <= -P.base * 8) speak(i, 'lose', 0.4);
      }
      const myE = st.evals[0];
      if (myE.mult > st.bestHand || (myE.mult === st.bestHand && myE.type > st.bestType)) { st.bestHand = myE.mult; st.bestType = myE.type; }
      addRecord({ round: st.round, banker: bkr.isMe ? '👑 你' : bkr.emoji + bkr.name, type: myE.type, delta: myD });
      renderAll();

      // 大师 AI 记录本局所有人的出价与亮牌
      const rec = { forced: !!P.forceBanker, entries: st.players.map((p, i) => ({ id: p.id, grab: st.grabs[i], bet: st.bets[i], isBanker: i === st.banker, type: st.evals[i].type })) };
      for (const i of aiIdx()) st.players[i].brain.observe(rec);
      await Hub.wait(1200);

      // AI 输光 → 新 AI 入座
      for (const i of aiIdx()) {
        const p = st.players[i];
        if (p.chips > 0) continue;
        const np = newAI();
        resetView(np);
        np.dealt = 0;
        st.players[i] = np;
        if (st.banker === i) st.banker = -1;
        Hub.banner(`💸 ${p.emoji} ${p.name} 输光离场<br>${np.emoji} ${np.name} 带着 ${np.chips} 筹码入座`, 2000);
        addLog(`💸 ${p.emoji}${p.name} 输光离场，${np.emoji}${np.name} 入座（${np.chips}）`);
        renderSeat(i);
        await Hub.wait(1600);
      }
      st.phase = 'done';
      updateInfo();
    }

    function revealSeat(i) {
      const p = st.players[i];
      let e = st.evals[i];
      if (i === 0 && st.manualTri) e = evalHand(st.hands[0], st.manualTri);
      p.revealed = e;
      renderSeat(i);
      Hub.sfx('reveal');
      Hub.call(p.name, e.type <= 10 ? 'niu' + e.type : ['wuhua', 'zhadanniu', 'wuxiao'][e.type - 11]);
      if (e.type >= 10) {
        Hub.sfx(e.type >= 12 ? 'bomb' : e.type === 11 ? 'spring' : 'win');
        if (e.type >= 11) Hub.banner(`${p.emoji} ${p.isMe ? '你' : p.name} 亮出 <b>${e.name}</b> ×${e.mult}！`, 1400);
        speak(i, 'big', 0.6);
      }
    }

    // 玩家亮牌：按钮 / 空格；自动亮牌开且未开手动摆牛时 2 秒后自动
    function playerReveal() {
      st.manualTri = null;
      return new Promise(resolve => {
        let timer = null, tick = null, fired = false;
        const done = () => {
          if (fired) return;
          fired = true;
          clearTimeout(timer); clearInterval(tick);
          clearButtons();
          if (opts.manual) {
            const { idx, sum } = pickInfo();
            const has = st.evals[0].groups && st.evals[0].type <= 11;
            if (idx.length === 3 && sum % 10 === 0) { st.manualTri = idx; Hub.toast('摆牛成功！'); }
            else if (has) Hub.toast(idx.length === 3 ? '这 3 张凑不成整十，系统帮你摆好了' : '系统帮你摆好了');
          }
          st.picks.clear();
          resolve();
        };
        const btn = [{ label: '亮牌', kbd: '空格', keys: ['Space', 'Enter'], cls: 'gold', fn: done }];
        setButtons(btn, '');
        if (opts.manual) updatePickHint();
        else if (opts.auto) {
          let left = 2;
          $('dn-hint').innerHTML = `⏱ <b>${left}</b> 秒后自动亮牌`;
          tick = setInterval(() => { left--; if (left > 0) $('dn-hint').innerHTML = `⏱ <b>${left}</b> 秒后自动亮牌`; }, 1000);
          timer = setTimeout(done, 2000);
        }
      });
    }

    function waitNext(last) {
      return new Promise(resolve => {
        setButtons([{ label: last ? '查看结果' : '下一局 ▶', kbd: '空格', keys: ['Space', 'Enter'], cls: 'gold', fn: () => { clearButtons(); resolve(); } }],
          last ? '' : `本局结束 · 你当前筹码 <b>${st.players[0].chips}</b>`);
      });
    }

    /* ---------- 整场 ---------- */
    function finishMatch(busted) {
      const me = st.players[0];
      const passed = !busted && me.chips >= P.target;
      const net = me.chips - P.startChips;
      const best = st.bestType >= 0 ? `${TYPE_NAMES[st.bestType]} ×${st.bestHand}` : '—';
      const wins = st.records.filter(r => r.delta > 0).length;
      Hub.finish({
        passed,
        title: busted ? '💸 筹码输光了' : undefined,
        stats: { chips: me.chips, rounds: st.round, bankerRounds: st.bankerRounds, bestHand: st.bestHand },
        lines: [
          `最终筹码 <b>${me.chips}</b>（目标 ≥ ${P.target}）· 净${net >= 0 ? '赢' : '输'} <b>${Math.abs(net)}</b>`,
          `共 ${st.round} 局 · 赢 ${wins} 局 · 当庄 ${st.bankerRounds} 局`,
          `本场最大牌型：<b>${best}</b>`,
          busted ? '你的筹码已经输光，比赛提前结束。' : '',
        ].filter(Boolean),
      });
    }

    async function main() {
      buildSeats();
      // 选项
      const bindOpt = (id, key, after) => {
        const el = $(id);
        el.checked = !!opts[key];
        el.onchange = () => { opts[key] = el.checked; saveOpts(); if (after) after(); };
      };
      bindOpt('opt-auto', 'auto');
      bindOpt('opt-manual', 'manual', () => { renderHand(0); });
      if (DIFF < 3) bindOpt('opt-ref', 'ref', renderRef);
      else { $('opt-ref-wrap').classList.add('off'); $('opt-ref-wrap').title = '大师难度不提供牌力参考'; $('opt-ref').disabled = true; }
      renderAll();
      setPhase('准备开局', `底注 <b>${P.base}</b> · 共 ${P.rounds} 局`);
      const names = st.players.slice(1).map(p => `<span class="dn-intro-ai">${p.emoji} ${p.name}</span>`).join('');
      await Hub.intro({
        title: '🐮 抢庄牛牛',
        html: `<p>你和 4 位对手同桌，每人 <b>${P.startChips}</b> 筹码，底注 <b>${P.base}</b>，共 <b>${P.rounds}</b> 局。</p>
          <p>看 4 张牌抢庄 → 闲家押倍数 → 发第 5 张摆牛比牌。${P.forceBanker ? '<br><b>本场你固定坐庄，庄倍 ×4！</b>' : ''}</p>
          <p>${P.rounds} 局后筹码 ≥ <b>${P.target}</b> 即为胜利；中途输光直接失败。</p>
          <div class="dn-intro-ais">${names}</div>
          <p style="font-size:14px;color:#9aa3b0">快捷键：抢庄 0~4 · 押注 1/2/3/5 · 空格 亮牌 / 下一局</p>`,
        button: '开始 🐮',
      });
      for (let r = 0; r < P.rounds; r++) {
        await playRound();
        if (st.players[0].chips <= 0) {
          Hub.banner('💸 你的筹码输光了！', 1800);
          await Hub.wait(1500);
          finishMatch(true);
          return;
        }
        await waitNext(r === P.rounds - 1);
      }
      finishMatch(false);
    }
    main();
  })();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TYPE_NAMES, TYPE_MULT, GRAB_OPTS, BET_OPTS, DEFAULTS, FORCE_BANKER_MULT, SUIT_RANK, KEY_STRIDE, KEY_COUNT,
    point, cardKey, evalHand, compareHands, typeTier, resolveBanker, settle, mulberry32, newDeck,
    BASE_TOTAL, BASE_COUNTS, enumerateBaseCounts, TABLES, BASE_PI, TYPE_BUCKET, edgeVs,
    finalOutcomes, analyze4, bankerStats, quickStrength, Brain, playRoundSync, selfPlay,
  };
}
