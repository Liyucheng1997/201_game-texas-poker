/* ============================================================
   吹牛（说谎扑克）
   轮到你时把 1~4 张牌扣着出，嘴上说“N 张 X”（真假随你）；
   每次扣牌后，其他人按顺序选择相信或质疑——
   开出假牌，吹牛的人收下整堆；开出真牌，质疑的人收下整堆。
   规则 / AI / 无头对局与 DOM 解耦，Node 下可直接测试。
   ============================================================ */
'use strict';
const Hub = (typeof window !== 'undefined' && window.Hub) || require('./common.js');

const NP = 4;          // 座位：你 + 3 个 AI，出牌顺序 0 → 1 → 2 → 3（逆时针：你 → 右 → 上 → 左）
const MAX_PLAY = 4;    // 一次最多扣 4 张
const WIN_VALUE = 25;  // AI 估值里“出完赢下这局”值多少张牌
const LEAD_VALUE = 2;  // 拿到出牌权（可以自由报点数）大约值几张牌

/* ---------------- 牌 ---------------- */
function isJoker(c) { return c.s === 4; }
function fits(c, r) { return c.r === r || c.s === 4; }      // 王是万能牌，算作任何点数
function countFit(cards, r) { let n = 0; for (const c of cards) if (fits(c, r)) n++; return n; }
function sortHand(cards) { return cards.slice().sort((a, b) => (a.r - b.r) || (a.s - b.s)); }
function rankName(r) { return Hub.rankLabel(r); }
function claimText(n, r) { return `${n} 张 ${rankName(r)}`; }
function nextSeat(p) { return (p + 1) % NP; }
function fitTotal(G) { return 4 + (G.wild ? 2 : 0); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
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

/* ---------------- 对局状态 ----------------
   pile: 本轮扣下的牌 [{ p, cards, n, rank, lead }]
   window: 刚扣完牌、等其他人表态 { play, order:[三个座位], idx }
   mem[m]: 座位 m 的私有记忆（只记 m 能合法知道的东西）
     knownIn[o]: 确定在 o 手里的牌（开牌亮出的牌 + 我自己丢进那堆的牌）
     myDiscard: 我丢进“无人跟、作废”的牌
   pub: 公开统计，整场比赛累积（大师用来给每个人建模）
     chal[o]: { opp 有机会质疑的次数, made 实际质疑次数, exp 按公开信息预期的质疑次数 }
     rev[o]:  { n 被开牌次数, lies 其中说谎次数 } */
function newPub() {
  return {
    chal: Array.from({ length: NP }, () => ({ opp: 0, made: 0, exp: 0 })),
    rev: Array.from({ length: NP }, () => ({ n: 0, lies: 0 })),
  };
}
function createRound(opts) {
  const o = opts || {};
  const rng = o.rng || Math.random;
  const wild = !o.noJokers;
  const deck = o.deck ? o.deck.slice() : Hub.shuffle(Hub.makeDeck({ decks: 1, jokers: wild }), rng);
  const first = o.first || 0;
  const hands = Array.from({ length: NP }, () => []);
  deck.forEach((c, i) => hands[(first + i) % NP].push(c));
  return {
    hands: hands.map(sortHand), all: deck.slice(), total: deck.length, wild,
    pile: [], rank: 0, turn: first, leader: first, passes: 0,
    window: null, phase: 'play', winner: -1, discarded: 0, tricks: 0,
    history: [],
    mem: Array.from({ length: NP }, () => ({ knownIn: Array.from({ length: NP }, () => []), myDiscard: [] })),
    pub: o.pub || newPub(),
  };
}
function pileCount(G) { let n = 0; for (const e of G.pile) n += e.n; return n; }
function myContrib(G, m) { const out = []; for (const e of G.pile) if (e.p === m) out.push(...e.cards); return out; }
function judgeOf(G) { return G.window ? G.window.order[G.window.idx] : -1; }

function checkPlay(G, p, cards, rank) {
  if (G.phase !== 'play' || G.window) return '现在不能出牌';
  if (G.turn !== p) return '还没轮到你';
  if (!cards || !cards.length) return '请至少扣 1 张牌';
  if (cards.length > MAX_PLAY) return `一次最多扣 ${MAX_PLAY} 张`;
  const ids = new Set(G.hands[p].map(c => c.id));
  if (new Set(cards.map(c => c.id)).size !== cards.length || !cards.every(c => ids.has(c.id))) return '这些牌不在你手里';
  const r = G.rank || rank;
  if (!(r >= 1 && r <= 13)) return '请先选择要声称的点数';
  return '';
}
function applyPlay(G, p, cards, rank) {
  const err = checkPlay(G, p, cards, rank);
  if (err) throw new Error(err);
  const lead = !G.rank;
  if (lead) { G.rank = rank; G.leader = p; G.tricks++; }
  const ids = new Set(cards.map(c => c.id));
  G.hands[p] = G.hands[p].filter(c => !ids.has(c.id));
  const play = { p, cards: cards.slice(), n: cards.length, rank: G.rank, lead };
  G.pile.push(play);
  G.passes = 0;
  G.window = { play, order: [1, 2, 3].map(k => (p + k) % NP), idx: 0 };
  G.history.push({ t: 'play', p, n: play.n, rank: play.rank, lead });
  return play;
}
function applyPass(G, p) {
  if (G.phase !== 'play' || G.window || G.turn !== p) throw new Error('现在不能过');
  if (!G.rank) throw new Error('首家必须出牌');
  G.passes++;
  G.history.push({ t: 'pass', p });
  if (G.passes >= NP - 1) {
    // 其他人都不跟：这一轮扣下的牌作废（谁也不知道里面是什么），最后扣牌的人重新定点数
    const last = G.pile[G.pile.length - 1].p;
    for (const e of G.pile) G.mem[e.p].myDiscard.push(...e.cards);
    const n = pileCount(G);
    G.discarded += n;
    G.pile = []; G.rank = 0; G.passes = 0;
    G.turn = G.leader = last;
    G.history.push({ t: 'clear', p: last, n });
    return { cleared: true, leader: last, n };
  }
  G.turn = nextSeat(p);
  return { cleared: false };
}

/* 记一次“有机会质疑”的表态（大师据此估计每个人爱不爱开牌） */
function recordChance(G, c, made) {
  const ch = G.pub.chal[c];
  ch.opp++;
  if (made) ch.made++;
  ch.exp += expectChallenge(G, c, G.window.play);
}
function applyBelieve(G, c) {
  const w = G.window;
  if (!w || w.order[w.idx] !== c) throw new Error('还没轮到表态');
  recordChance(G, c, false);
  w.idx++;
  if (w.idx >= w.order.length) return closeWindow(G);
  return { closed: false };
}
/* 所有人都相信：牌留在堆里，轮到下家 */
function closeWindow(G) {
  const play = G.window.play, q = play.p;
  G.window = null;
  // 大家默认 q 打出的是真牌：把记得的 q 手里这个点数的牌划掉
  for (let m = 0; m < NP; m++) if (m !== q) forgetPlayed(G.mem[m].knownIn[q], play.rank, play.n, G.hands[q].length);
  if (!G.hands[q].length) {
    G.phase = 'over'; G.winner = q;
    G.history.push({ t: 'win', p: q });
    return { closed: true, win: q };
  }
  G.turn = nextSeat(q);
  return { closed: true };
}
function forgetPlayed(list, r, n, handLen) {
  let k = n;
  for (let pass = 0; pass < 2 && k; pass++) {
    for (let i = list.length - 1; i >= 0 && k; i--) {
      const c = list[i];
      if (pass === 0 ? (c.r === r && !isJoker(c)) : isJoker(c)) { list.splice(i, 1); k--; }
    }
  }
  while (list.length > handLen) list.shift();
}
/* 质疑：翻开刚扣下的那手牌。有一张不符（王算任何点数）就是吹牛 */
function applyChallenge(G, c) {
  const w = G.window;
  if (!w || w.order[w.idx] !== c) throw new Error('还没轮到表态');
  recordChance(G, c, true);
  const play = w.play, q = play.p;
  G.window = null;
  const lie = play.cards.some(x => !fits(x, play.rank));
  const loser = lie ? q : c, winner = lie ? c : q;
  const taken = [];
  const contrib = Array.from({ length: NP }, () => []);
  for (const e of G.pile) { taken.push(...e.cards); contrib[e.p].push(...e.cards); }
  // 记忆：亮出来的牌 + 我自己丢进这堆的牌，现在都在 loser 手里
  const revIds = new Set(play.cards.map(x => x.id));
  for (let m = 0; m < NP; m++) {
    const mem = G.mem[m];
    for (let o = 0; o < NP; o++) mem.knownIn[o] = mem.knownIn[o].filter(x => !revIds.has(x.id));
    if (m === loser) continue;
    const have = new Set(mem.knownIn[loser].map(x => x.id));
    for (const x of play.cards.concat(contrib[m])) if (!have.has(x.id)) { have.add(x.id); mem.knownIn[loser].push(x); }
  }
  G.hands[loser] = sortHand(G.hands[loser].concat(taken));
  G.pub.rev[q].n++;
  if (lie) G.pub.rev[q].lies++;
  G.history.push({ t: 'challenge', c, q, lie, n: taken.length, loser });
  G.pile = []; G.rank = 0; G.passes = 0;
  const res = { lie, loser, winner, revealed: play.cards, taken, play };
  if (!lie && !G.hands[q].length) {
    // 最后一手是真牌：质疑失败，照样出完获胜
    G.phase = 'over'; G.winner = q;
    G.history.push({ t: 'win', p: q });
    res.win = q;
    return res;
  }
  G.turn = G.leader = winner;
  return res;
}
/* 一局结算：其他人按手里剩下的张数，每张付 1 分给出完的人 */
function settle(G) {
  const deltas = new Array(NP).fill(0);
  const w = G.winner;
  for (let p = 0; p < NP; p++) {
    if (p === w) continue;
    deltas[p] = -G.hands[p].length;
    deltas[w] += G.hands[p].length;
  }
  return { winner: w, deltas, left: G.hands.map(h => h.length) };
}

/* ============================================================
   AI
   难度 0 简单 / 1 普通 / 2 困难 / 3 大师
   ============================================================ */
const LF = [0];
for (let i = 1; i <= 120; i++) LF[i] = LF[i - 1] + Math.log(i);
function lnC(n, k) { return k < 0 || k > n ? -Infinity : LF[n] - LF[k] - LF[n - k]; }
/* 超几何分布右尾：N 张里有 K 张“好牌”，抽 n 张，至少抽到 k 张好牌的概率 */
function hyperTail(N, K, n, k) {
  N = Math.max(0, Math.round(N));
  K = clamp(Math.round(K), 0, N);
  n = clamp(Math.round(n), 0, N);
  if (k <= 0) return 1;
  const hi = Math.min(K, n);
  if (k > hi) return 0;
  const den = lnC(N, n);
  let s = 0;
  for (let x = k; x <= hi; x++) s += Math.exp(lnC(K, x) + lnC(N - K, n - x) - den);
  return Math.min(1, s);
}
const NEUTRAL = { lie: 1, doubt: 1 };

/* 首家是挑着自己多的点数报的：问题不是“他碰巧有 n 张 X”，而是“他手里最多的点数够不够 n 张”。
   随机 h 张手牌里，某个点数（含王）凑够 n 张的概率，蒙特卡洛估计后缓存 */
const BEST_CACHE = {};
function bestOfHand(h, wild) {
  const key = (wild ? 'w' : 'n') + h;
  if (BEST_CACHE[key]) return BEST_CACHE[key];
  const rng = mulberry32(9001 + h * 7 + (wild ? 1 : 0));
  const deck = Hub.makeDeck({ decks: 1, jokers: wild });
  const T = 3000, hit = [0, 0, 0, 0, 0];
  const take = Math.min(h, deck.length);
  for (let t = 0; t < T; t++) {
    for (let i = 0; i < take; i++) {         // 部分洗牌：只洗出前 take 张
      const j = i + Math.floor(rng() * (deck.length - i));
      const x = deck[i]; deck[i] = deck[j]; deck[j] = x;
    }
    const cnt = new Array(14).fill(0);
    let jk = 0;
    for (let i = 0; i < take; i++) { const c = deck[i]; if (isJoker(c)) jk++; else cnt[c.r]++; }
    const best = Math.max(...cnt) + jk;
    for (let n = 1; n <= 4; n++) if (best >= n) hit[n]++;
  }
  return (BEST_CACHE[key] = hit.map(x => x / T));
}
/* ge[k] = 此人手里（该点数，含王）至少有 k 张的概率，k = 0..4
   跟牌：点数是别人定的，按超几何分布；首家：看他最多的点数，再按我对这个点数的了解修正 */
function geFollow(N, a, u, inQ) {
  const ge = [1, 1, 1, 1, 1];
  for (let k = 1; k <= 4; k++) ge[k] = k - inQ <= 0 ? 1 : hyperTail(N, a, Math.min(u, N), k - inQ);
  return ge;
}
function geLead(G, hq, know) {
  const best = bestOfHand(hq, G.wild);
  const ge = [1, 1, 1, 1, 1];
  for (let k = 2; k <= 4; k++) {
    const blind = hyperTail(G.total, fitTotal(G), hq, k);
    const ratio = blind > 1e-9 ? Math.min(1.4, know[k] / blind) : (know[k] > 0 ? 1 : 0);
    ge[k] = Math.min(ge[k - 1], clamp(best[k] * ratio, 0, 1));
  }
  return ge;
}
/* 声称 n 张时在说谎的后验概率（一个简单的生成模型）
   诚实：手里有 ≥ n 张，照实报（概率 1-λ）
   掺假：只有 k 张（1 ≤ k < n），掺进 n-k 张假牌（概率 λ^(n-k)）
   硬吹：一张都没有（只有跟牌会这样），以 β 的概率硬吹 1~2 张而不是过 */
const BLUFF_SIZE = [0, 0.65, 0.3, 0.05, 0];
function claimLie(ge, n, beta, lambda, lead) {
  const honest = ge[n] * (1 - lambda);
  let lie = 0;
  for (let k = lead ? 1 : 0; k < n; k++) {
    const p = Math.max(0, ge[k] - ge[k + 1]);
    lie += k ? p * Math.pow(lambda, n - k) : p * beta * BLUFF_SIZE[n];
  }
  return honest + lie > 0 ? clamp(lie / (honest + lie), 0, 1) : 1;
}

/* 对某个人的说谎倾向建模
   beta: 手里没有这么多真牌时，选择硬吹（而不是过）的概率
   lambda: 手里有真牌时，还往里掺假牌的概率
   大师按此人被开牌时的说谎比例做收缩估计 */
function lieModel(G, q, level, lead) {
  let beta = 0.45, lambda = lead ? 0.15 : 0.1;
  if (level >= 3) {
    const rv = G.pub.rev[q];
    const k = ((rv.lies + 2) / (rv.n + 5)) / 0.4;
    beta = clamp(beta * k, 0.1, 0.95);
    lambda = clamp(lambda * k, 0.02, 0.6);
  }
  return { beta, lambda };
}
/* 本轮更早的声称有多大可能是真的（用来扣减“外面还剩几张”） */
function credOf(G, p, level) {
  if (level < 3) return 0.6;
  const rv = G.pub.rev[p];
  return clamp(1 - (rv.lies + 2) / (rv.n + 5), 0.3, 0.85);
}

/* 座位 m 估计某手声称是吹牛的概率
   普通：只看自己手里 + 自己扣进堆里的牌
   困难：+ 记牌（开牌亮出的牌在谁手里、自己作废的牌）+ 本轮之前的声称
   大师：+ 按每个人的历史说谎比例调整 */
function assessClaim(G, m, level, play) {
  play = play || G.window.play;
  const r = play.rank, n = play.n, q = play.p;
  const W = fitTotal(G);
  const mine = G.hands[m], contrib = myContrib(G, m);
  let known = countFit(mine, r) + countFit(contrib, r);
  let N = G.total - mine.length - contrib.length;
  let inQ = 0, knownQ = 0;
  if (level >= 2) {
    const mem = G.mem[m];
    known += countFit(mem.myDiscard, r);
    N -= mem.myDiscard.length;
    for (let o = 0; o < NP; o++) {
      if (o === m) continue;
      const kl = mem.knownIn[o];
      if (o === q) { inQ = countFit(kl, r); knownQ = kl.length; }
      else { known += countFit(kl, r); N -= kl.length; }
    }
    N -= knownQ;
  }
  if (n > W - known) return { pLie: 1, certain: true, pCap: 0 };
  let a = W - known - inQ;
  const u = Math.max(0, G.hands[q].length + n - knownQ);
  if (level >= 2) {
    let prev = 0;
    for (const e of G.pile) if (e !== play && e.p !== m) prev += e.n * credOf(G, e.p, level);
    a = Math.max(0, Math.round(a - prev));
  }
  const geF = geFollow(N, a, u, inQ);
  const ge = play.lead ? geLead(G, G.hands[q].length + n, geF) : geF;
  const { beta, lambda } = lieModel(G, q, level, play.lead);
  return { pLie: claimLie(ge, n, beta, lambda, play.lead), certain: false, pCap: ge[n] };
}
/* 只用公开信息估计（不看任何人的手牌） */
function publicLie(G, play) {
  const W = fitTotal(G);
  if (play.n > W) return 1;
  let prev = 0;
  for (const e of G.pile) if (e !== play) prev += e.n;
  const a = Math.max(0, Math.round(W - 0.6 * prev));
  const hq = G.hands[play.p].length + play.n;
  const geF = geFollow(G.total, a, hq, 0);
  const ge = play.lead ? geLead(G, hq, geF) : geF;
  return claimLie(ge, play.n, 0.45, play.lead ? 0.15 : 0.1, play.lead);
}
/* 对 m 来说，让 q 多吃一张牌值多少：q 越接近出完越值钱 */
function threatOf(G, q, m) {
  const hq = G.hands[q].length;
  if (hq <= 3) return 1.2;
  for (let o = 0; o < NP; o++) if (o !== m && o !== q && G.hands[o].length < hq) return 0.45;
  return 0.9;
}
/* 质疑的期望收益（单位：张牌）
   开中：对方吃下整堆，我拿到出牌权
   开错：我吃下整堆（我快出完时更伤），对方拿到出牌权
   不开：一般没有损失；但对方这一手已出完，不开对方就赢了 */
function challengeEV(pLie, S, threat, myLeft, qLeft, later) {
  const gain = S * threat + LEAD_VALUE;
  const cost = S * (myLeft <= 4 ? 1.6 : 1) + LEAD_VALUE * threat;
  const evC = pLie * gain - (1 - pLie) * cost;
  const evB = qLeft === 0 ? -(12 + myLeft) * (later ? 0.6 : 1) : 0;
  return evC - evB;
}
function expectChallenge(G, c, play) {
  const q = play.p;
  const ev = challengeEV(publicLie(G, play), pileCount(G), threatOf(G, q, c), G.hands[c].length, G.hands[q].length, true);
  return 1 / (1 + Math.exp(-ev / 1.5));
}

/* ---------------- 质疑决策 ---------------- */
function aiChallenge(G, m, diff, rng, persona) {
  rng = rng || Math.random;
  const per = persona || NEUTRAL;
  const w = G.window, play = w.play, q = play.p;
  const qLeft = G.hands[q].length, S = pileCount(G);
  if (diff <= 0) {
    // 简单：只偶尔注意到“我手里的牌已经说明他在吹”，其余靠感觉
    const a = assessClaim(G, m, 1, play);
    if (a.certain) return rng() < 0.6;
    const p = (0.1 + 0.07 * (play.n - 1) + (qLeft === 0 ? 0.35 : qLeft <= 2 ? 0.1 : 0)) * per.doubt;
    return rng() < p;
  }
  const a = assessClaim(G, m, diff, play);
  if (a.certain) return true;
  const noise = [0, 1.2, 0.6, 0.4][diff];
  const pw = [1, 1, 0.6, 0.3][diff];             // 性格对决策的影响（越高难度越理性）
  const bias = (per.doubt - 1) * 2 * pw;
  const later = w.idx < w.order.length - 1;
  const ev = challengeEV(a.pLie, S, threatOf(G, q, m), G.hands[m].length, qLeft, later);
  return ev + bias + (rng() * 2 - 1) * noise > 0;
}

/* ---------------- 出牌决策 ---------------- */
/* 掺假时先丢哪些牌：自己手里张数少的点数（以后很难凑出真牌），王永远不当假牌 */
function bluffOrder(hand, r) {
  const cnt = {};
  for (const c of hand) cnt[c.r] = (cnt[c.r] || 0) + 1;
  return hand.filter(c => !fits(c, r)).sort((a, b) => (cnt[a.r] - cnt[b.r]) || (a.r - b.r) || (a.s - b.s));
}
/* 某点数下的候选出法：全部真牌 + 0~2 张王 + 0~2 张假牌（出完时可以更多） */
function playOptions(hand, r) {
  const nat = hand.filter(c => c.r === r && !isJoker(c));
  const jk = hand.filter(isJoker);
  const junk = bluffOrder(hand, r);
  const tN = Math.min(nat.length, MAX_PLAY);
  const out = [];
  for (let j = 0; j <= Math.min(jk.length, MAX_PLAY - tN); j++) {
    const room = MAX_PLAY - tN - j;
    for (let b = 0; b <= Math.min(junk.length, room); b++) {
      const n = tN + j + b;
      if (!n) continue;
      if (b > 2 && n !== hand.length) continue;
      out.push({ cards: nat.slice(0, tN).concat(jk.slice(0, j), junk.slice(0, b)), n, rank: r, lie: b > 0, jokers: j });
    }
  }
  return out;
}
/* 出法估值（单位：张牌）：出掉的张数；真牌被开 = 对方吃整堆、我拿出牌权；
   假牌被开 = 我吃回整堆、出牌权给别人；出完 = WIN_VALUE */
function evalOption(handLen, o, Pch, S) {
  const left = handLen - o.n;
  const caught = S + LEAD_VALUE * 0.5;
  if (!left) return o.lie ? (1 - Pch) * WIN_VALUE - Pch * caught : WIN_VALUE;
  const shed = o.n - 0.6 * o.jokers;          // 王留着更值钱
  if (!o.lie) return shed + Pch * (0.45 * (S + o.n) + LEAD_VALUE);
  return (1 - Pch) * shed - Pch * caught;
}

/* 困难 / 大师：按记忆对其他人的手牌抽样 */
function sampleOppHands(G, p, rng) {
  const mem = G.mem[p];
  const ex = new Set();
  for (const c of G.hands[p]) ex.add(c.id);
  for (const c of myContrib(G, p)) ex.add(c.id);
  for (const c of mem.myDiscard) ex.add(c.id);
  for (let o = 0; o < NP; o++) if (o !== p) for (const c of mem.knownIn[o]) ex.add(c.id);
  const pool = Hub.shuffle(G.all.filter(c => !ex.has(c.id)), rng);
  const hands = [];
  let k = 0;
  for (let o = 0; o < NP; o++) {
    if (o === p) { hands.push(null); continue; }
    const kn = mem.knownIn[o].slice(-G.hands[o].length);
    const need = Math.max(0, G.hands[o].length - kn.length);
    hands.push(kn.concat(pool.slice(k, k + need)));
    k += need;
  }
  return hands;
}
/* 对手 o（手牌 oHand）看到我这手声称后会不会开：按“普通”难度的思路模拟 */
function oppChallengeProb(G, o, oHand, claim, shift) {
  const W = fitTotal(G);
  let ownPile = 0, ownClaim = 0, prev = 0;
  for (const e of G.pile) {
    if (e.p === o) { ownPile += e.n; ownClaim += e.n; }
    else if (e.p !== claim.p) prev += e.n;
  }
  const known = countFit(oHand, claim.rank) + Math.round(0.7 * ownClaim);
  let pLie;
  if (claim.n > W - known) pLie = 1;
  else {
    const a = Math.max(0, Math.round(W - known - 0.6 * prev));
    const geF = geFollow(G.total - oHand.length - ownPile, a, claim.handBefore, 0);
    const ge = claim.lead ? geLead(G, claim.handBefore, geF) : geF;
    pLie = claimLie(ge, claim.n, 0.45, claim.lead ? 0.15 : 0.1, claim.lead);
  }
  if (pLie >= 1) return 0.97;
  const ev = challengeEV(pLie, claim.S, claim.threat[o], oHand.length, claim.left, claim.later);
  return 1 / (1 + Math.exp(-(ev + shift) / 1.0));
}
/* 大师：对手实际质疑次数 vs 按公开信息“应该”质疑的次数 → 此人爱开牌程度的修正 */
function doubtShift(G, o) {
  const ch = G.pub.chal[o];
  return clamp(1.5 * Math.log((ch.made + 1) / (ch.exp + 1)), -3, 3);
}
/* 估计一手声称（rank, n）被人开牌的概率 */
function makeRiskFn(G, p, level, rng) {
  const lead = !G.rank;
  const S = pileCount(G);
  const handBefore = G.hands[p].length;
  const order = [1, 2, 3].map(k => (p + k) % NP);
  if (level <= 1) {
    // 普通：粗略估计，不抽样
    let prevSame = 0;
    for (const e of G.pile) prevSame += e.n;
    return (r, n) => {
      const left = handBefore - n;
      if (!left) return 0.95;
      return clamp(0.06 + 0.07 * n + 0.05 * prevSame + (lead ? -0.04 : 0) + (left <= 2 ? 0.15 : 0), 0.02, 0.9);
    };
  }
  const samples = [];
  const K = level >= 3 ? 28 : 16;
  for (let i = 0; i < K; i++) samples.push(sampleOppHands(G, p, rng));
  const shifts = order.map(o => (level >= 3 ? doubtShift(G, o) : 0));
  const cache = new Map();
  return (r, n) => {
    const key = r + ':' + n;
    if (cache.has(key)) return cache.get(key);
    const claim = { p, rank: r, n, lead, handBefore, S: S + n, left: handBefore - n, later: true, threat: [] };
    // 我出完这手之后，在每个对手眼里我有多大威胁
    const hs0 = G.hands.map(h => h.length);
    hs0[p] = handBefore - n;
    for (const o of order) {
      let t = 0.9;
      if (hs0[p] <= 3) t = 1.2;
      else for (let x = 0; x < NP; x++) if (x !== o && x !== p && hs0[x] < hs0[p]) t = 0.45;
      claim.threat[o] = t;
    }
    let tot = 0;
    for (const hs of samples) {
      let none = 1;
      order.forEach((o, i) => {
        claim.later = i < order.length - 1;
        none *= 1 - oppChallengeProb(G, o, hs[o], claim, shifts[i]);
      });
      tot += 1 - none;
    }
    const v = tot / samples.length;
    cache.set(key, v);
    return v;
  };
}

function easyPlay(G, p, rng, per) {
  const hand = G.hands[p];
  const pick = arr => arr[Math.floor(rng() * arr.length)];
  if (!G.rank) {
    const nats = hand.filter(c => !isJoker(c));
    const r = nats.length && rng() < 0.75 ? pick(nats).r : 1 + Math.floor(rng() * 13);
    let cards = hand.filter(c => c.r === r).slice(0, MAX_PLAY);
    const junk = hand.filter(c => !fits(c, r));
    if (junk.length && cards.length < MAX_PLAY && (!cards.length || rng() < 0.35 * per.lie)) cards.push(pick(junk));
    if (!cards.length) cards = [pick(hand)];
    return { cards, rank: r };
  }
  const r = G.rank;
  const fit = hand.filter(c => fits(c, r));
  if (hand.length <= MAX_PLAY && fit.length === hand.length) return { cards: hand.slice(), rank: r };
  const nat = hand.filter(c => c.r === r && !isJoker(c)).slice(0, MAX_PLAY);
  const junk = hand.filter(c => !fits(c, r));
  if (nat.length) {
    if (junk.length && nat.length < MAX_PLAY && rng() < 0.25 * per.lie) nat.push(pick(junk));
    return { cards: nat, rank: r };
  }
  if (junk.length && rng() < 0.5 * per.lie) {
    const k = Math.min(junk.length, rng() < 0.6 ? 1 : 2);
    return { cards: Hub.shuffle(junk.slice(), rng).slice(0, k), rank: r };
  }
  if (fit.length) return { cards: [fit[0]], rank: r };
  return { pass: true };
}

function smartPlay(G, p, level, rng, per) {
  const hand = G.hands[p];
  const S = pileCount(G);
  const risk = makeRiskFn(G, p, level, rng);
  const noise = [0, 0.8, 0.4, 0.35][level];
  const pw = [1, 1, 0.6, 0.3][level];
  const lieBias = (per.lie - 1) * 2 * pw;
  let ranks;
  if (G.rank) ranks = [G.rank];
  else {
    // 首家：在自己真牌最多的几个点数里挑
    const cnt = {};
    for (const c of hand) if (!isJoker(c)) cnt[c.r] = (cnt[c.r] || 0) + 1;
    ranks = Object.keys(cnt).map(Number).sort((a, b) => (cnt[b] - cnt[a]) || (a - b)).slice(0, 4);
    if (!ranks.length) ranks = [1 + Math.floor(rng() * 13)];      // 手里只剩王
  }
  let best = null, bestV = -Infinity;
  for (const r of ranks) {
    for (const o of playOptions(hand, r)) {
      const P = risk(r, o.n);
      let v = evalOption(hand.length, o, P, S) + (rng() * 2 - 1) * noise;
      if (o.lie) v += lieBias;
      if (v > bestV) { bestV = v; best = o; }
    }
  }
  if (G.rank && bestV < 0) return { pass: true };
  return { cards: best.cards, rank: best.rank };
}

/* AI 行动入口：{ cards, rank } 或 { pass: true } */
function aiAct(G, p, diff, rng, persona) {
  rng = rng || Math.random;
  const per = persona || NEUTRAL;
  if (diff <= 0) return easyPlay(G, p, rng, per);
  return smartPlay(G, p, diff, rng, per);
}

/* ---------------- 无头整局（测试 / 自对弈） ----------------
   opts: { rng, diffs:[4], first, noJokers, pub, check(G) } */
function playHeadless(opts) {
  const rng = opts.rng || Math.random;
  const diffs = opts.diffs;
  const G = createRound({ rng, first: opts.first || 0, noJokers: opts.noJokers, pub: opts.pub });
  let steps = 0;
  while (G.phase === 'play') {
    const p = G.turn;
    const act = aiAct(G, p, diffs[p], rng);
    if (act.pass) applyPass(G, p);
    else {
      applyPlay(G, p, act.cards, act.rank);
      while (G.window) {
        const c = judgeOf(G);
        if (aiChallenge(G, c, diffs[c], rng)) applyChallenge(G, c);
        else applyBelieve(G, c);
      }
    }
    if (opts.check) opts.check(G);
    if (++steps > 4000) throw new Error('too many steps');
  }
  return { G, res: settle(G), steps };
}

/* ============================================================
   UI（仅浏览器）
   ============================================================ */
if (typeof document !== 'undefined') {
  /* ---------- 角色 ---------- */
  const CHARACTERS = [
    { name: '大嘴', emoji: '😜', style: '吹牛大王，张口就来，脸不红心不跳', persona: { lie: 1.5, doubt: 0.9 }, lines: {
      brag: ['这把稳了！', '全是真的，骗你是小狗！', '信我，没错的！'],
      caught: ['哎呀，被你看穿了！', '失误失误，下把还吹！'],
      vindicated: ['哈哈，这回可是真的！', '让你不信我！'],
      catch: ['就这？还想骗我？', '一眼就看穿了！'],
      wrong: ['什么？居然是真的？', '亏大了……'],
      win: ['吹牛也是一门手艺！', '赢了！就问你服不服！'],
      lose: ['下把我要吹得更狠！'],
      warn: ['我快出完了，有本事来开我！'] } },
    { name: '老周', emoji: '🕵️', style: '退休老刑警，疑心病重，最爱开牌', persona: { lie: 0.7, doubt: 1.4 }, lines: {
      brag: ['老实人从不说谎。', '这牌，经得起查。'],
      caught: ['老了老了，手艺生疏了。', '被抓了，认罚。'],
      vindicated: ['查我？我可是清白的。', '年轻人，别太多疑。'],
      catch: ['证据确凿，拿走吧！', '我干了一辈子刑警，你骗不了我。'],
      wrong: ['看走眼了，惭愧。', '这次是我多疑了。'],
      win: ['破案收工！', '姜还是老的辣。'],
      lose: ['这回让你们了。'],
      warn: ['快结案了，各位注意。'] } },
    { name: '小雅', emoji: '💃', style: '戏精本精，真真假假全看心情', persona: { lie: 1.25, doubt: 1.05 }, lines: {
      brag: ['人家可是很诚实的哦～', '你猜猜看呀～'],
      caught: ['讨厌，被发现啦～', '哼，这次不算！'],
      vindicated: ['都说了是真的嘛～', '不信我，活该哦～'],
      catch: ['抓到你啦！', '演技太差啦～'],
      wrong: ['呜呜，我错怪你了～', '怎么会是真的嘛！'],
      win: ['耶！又赢啦～', '我演技满分吧！'],
      lose: ['下把一定赢回来！'],
      warn: ['人家快出完啦～'] } },
    { name: '闷葫芦', emoji: '😶', style: '面无表情，很少说谎，也很少开口', persona: { lie: 0.6, doubt: 0.85 }, lines: {
      brag: ['真的。'],
      caught: ['失手了。'],
      vindicated: ['我说了，是真的。'],
      catch: ['开。你在吹牛。'],
      wrong: ['算我的。'],
      win: ['赢了。'],
      lose: ['嗯，下一局。'],
      warn: ['快了。'] } },
    { name: '王婶', emoji: '👵', style: '菜市场砍价冠军，专挑软柿子捏', persona: { lie: 1.05, doubt: 1.15 }, lines: {
      brag: ['婶子我从不骗人。', '实打实的，你放心。'],
      caught: ['哎哟，婶子老眼昏花放错了。', '被你逮着了，算你厉害。'],
      vindicated: ['你看看，婶子没骗你吧？', '冤枉好人哟！'],
      catch: ['小样，跟婶子玩这套？', '婶子一眼就看出来了！'],
      wrong: ['哎哟，婶子错怪你了。', '这下亏大了哟。'],
      win: ['婶子赢喽！', '买菜钱又有了！'],
      lose: ['不玩了不玩了，回家做饭去。'],
      warn: ['婶子快出完喽！'] } },
  ];
  const HUMAN = { name: '你', emoji: '😎', persona: NEUTRAL };

  const RULES = `
    <p><b>人数与发牌：</b>你和 3 位对手，一副牌 54 张全部发完（两人 14 张、两人 13 张）。出牌顺序：你 → 右 → 上 → 左。</p>
    <p><b>扣牌：</b>首家先报一个点数（A~K 任选），然后把 1~4 张牌<b>扣着</b>出，声称“这是 N 张 X”——牌可以是真的，也可以夹着假牌，甚至全是假的。之后轮到的人只能接着报<b>同一个点数</b>：扣 1~4 张继续声称，或者“过”。</p>
    <p><b>王是万能牌：</b>大小王算作任何点数，所以每个点数最多有 6 张“真牌”（4 张本点 + 2 张王）。</p>
    <p><b>相信还是质疑：</b>每次有人扣牌后，其他三人按顺序表态。有人质疑就当场翻开<b>刚扣下的那一手</b>：</p>
    <p>　· 只要有一张不是所报点数（王除外）→ <b>吹牛被抓</b>，吹牛的人把整堆牌收进手里，质疑者重新开始一轮；<br>　· 全是真牌 → <b>质疑失败</b>，质疑的人收下整堆牌，被冤枉的人重新开始一轮。</p>
    <p><b>没人跟：</b>扣牌后其余三人都选择“过”，这一轮的牌整堆作废（不翻开），最后扣牌的人重新报点数。</p>
    <p><b>胜负：</b>谁先把手牌出完、并且最后一手没有被抓，谁就赢下这局。其他人每剩 1 张牌付 1 分给赢家。打完约定局数比总积分。</p>
    <p><b>小窍门：</b>中间的“本轮声称”会统计这一轮大家一共报了多少张——超过 6 张就一定有人在吹牛。你手里本点的牌越多，别人报大数就越可疑。首家报牌时夹一两张假牌风险最小（被抓也只是收回自己的牌）。</p>
    <p><b>快捷键：</b>出牌 Enter，过 P，重选 Esc；首家选点数可直接按 A 2~9 0(=10) J Q K。表态时 空格 / Enter 相信，Q 质疑。</p>
    <p><b>对手难度：</b>🌱 简单靠感觉开牌、乱吹；⚔️ 普通会按自己手里的牌算概率、权衡牌堆大小再决定吹不吹、开不开；🔥 困难还会记住开牌亮出的牌和自己扣进去的牌在谁手里、把本轮之前的声称算进去，并对其他人的手牌抽样估计“这手吹牛会不会被开”；👑 大师在此基础上统计每个人（包括你）被开牌时说谎的比例、爱不爱开牌，针对性地决定什么时候吹、什么时候抓。</p>`;

  const ctx = Hub.init({ game: 'bluff', defaults: { rounds: 5, target: 1, noJokers: false }, rules: RULES });
  const P = ctx.params;
  const DIFF = ctx.diffIndex;
  const chars = Hub.shuffle(CHARACTERS.slice()).slice(0, 3);
  const st = {
    G: null, pub: newPub(), round: 0, rounds: Math.max(1, Math.floor(P.rounds) || 5), target: +P.target || 0,
    totals: [0, 0, 0, 0], wins: 0, catches: 0, caught: 0, wrong: 0, fooled: 0,
    players: [HUMAN, chars[0], chars[1], chars[2]],
    sel: new Set(), pick: 0, pickManual: false, newIds: new Set(),
    acting: -1, judging: -1, mode: 'idle', resolve: null, resultResolve: null,
    status: [null, null, null, null], reveal: null, doubt: null, cleared: null, dealAnim: false, actSig: '',
    alerted: [0, 0, 0, 0],
  };
  const $ = id => document.getElementById(id);
  const fmt = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);
  const pname = p => st.players[p].name;
  const who = p => `${st.players[p].emoji} ${pname(p)}`;
  const say = (p, kind, prob) => {
    if (p === 0 || Math.random() > (prob == null ? 1 : prob)) return;
    const lines = st.players[p].lines[kind];
    if (lines) Hub.bubble($('seat-' + p), Hub.randPick(lines), undefined, pname(p));
  };
  const handOf = p => st.G.hands[p];

  /* ---------- 尺寸 ---------- */
  let handCw = 76;
  function layout() {
    const h = window.innerHeight - 52, w = window.innerWidth;
    handCw = Math.round(Math.max(48, Math.min(82, h * 0.08, w / 15)));
    $('bf-app').style.setProperty('--hand-cw', handCw + 'px');
  }

  /* ---------- 渲染 ---------- */
  function statusOf(p) {
    if (st.acting === p) return { kind: 'acting', text: p === 0 ? (st.G.rank ? '请扣牌' : '请报点数') : '思考中…' };
    if (st.judging === p) return { kind: 'acting', text: p === 0 ? '信不信？' : '琢磨中…' };
    if (st.G && st.G.phase === 'over' && st.G.winner === p) return { kind: 'good', text: '🏆 出完了' };
    return st.status[p] || { kind: '', text: '' };
  }
  function backsHTML(n) {
    const k = Math.min(n, 10);
    return `<span class="bf-backs">${'<i></i>'.repeat(k)}</span>`;
  }
  function seatHTML(p) {
    const pl = st.players[p];
    const n = st.G ? handOf(p).length : 0;
    const s = statusOf(p);
    const warn = st.G && st.G.phase === 'play' && n > 0 && n <= 2 ? `<span class="bf-warn">⚠ 剩 ${n} 张</span>` : '';
    if (p === 0) {
      return `<div class="avatar">${pl.emoji}</div><div class="me-info"><div class="name">${pl.name}${warn}</div>
        <div class="sub">剩 <b>${n}</b> 张 · 积分 <b>${fmt(st.totals[0])}</b></div></div>
        <div class="hub-status" data-kind="${s.kind}">${s.text}</div>`;
    }
    return `<div class="bf-seat-row"><div class="avatar">${pl.emoji}</div>
      <div class="bf-seat-info"><div class="name">${pl.name}</div>
        <div class="sub">${backsHTML(n)}<b>${n}</b> 张</div>
        <div class="bf-score">积分 ${fmt(st.totals[p])}</div></div></div>
      ${warn}
      <div class="hub-status" data-kind="${s.kind}">${s.text}</div>`;
  }
  function renderSeats() {
    for (let p = 0; p < NP; p++) {
      const el = $('seat-' + p);
      const html = seatHTML(p);
      if (el._html !== html) { el.innerHTML = html; el._html = html; }
      el.classList.toggle('acting', st.acting === p || st.judging === p);
    }
  }
  function renderCenter() {
    const G = st.G;
    // 当前点数
    let claim;
    if (!G) claim = '';
    else if (st.reveal) claim = `开牌！<b>${rankName(st.reveal.play.rank)}</b>`;
    else if (st.doubt) claim = `<span class="doubt">🤨 ${who(st.doubt.c)} 质疑 ${who(st.doubt.q)}：开牌！</span>`;
    else if (G.rank) claim = `本轮点数 <b>${rankName(G.rank)}</b>`;
    else if (G.phase === 'play') claim = `<span class="dim">${who(G.turn)} 报点数…</span>`;
    else claim = '';
    const cEl = $('bf-claim');
    if (cEl._html !== claim) { cEl.innerHTML = claim; cEl._html = claim; }
    // 牌堆
    const n = st.reveal ? st.reveal.taken : (G ? pileCount(G) : 0);
    const stack = n ? `<div class="bf-stack">${'<div class="pk back"></div>'.repeat(Math.min(6, Math.ceil(n / 3)))}</div>` : '<div class="bf-stack empty"></div>';
    const pile = `${stack}<div class="bf-pile-n">${n ? `牌堆 <b>${n}</b> 张` : (st.cleared ? `<span class="dim">上一轮没人跟，${st.cleared} 张作废</span>` : '<span class="dim">牌堆是空的</span>')}</div>`;
    const pEl = $('bf-pile');
    if (pEl._html !== pile) { pEl.innerHTML = pile; pEl._html = pile; }
    // 最后一手 / 开牌
    let last = '';
    if (st.reveal) {
      const rv = st.reveal;
      last = `<div class="bf-last-cards reveal">${rv.play.cards.map(c => {
        const ok = fits(c, rv.play.rank);
        return `<div class="bf-rc ${ok ? 'ok' : 'bad'}">${Hub.cardHTML(c)}<span class="mark">${ok ? '✓' : '✗'}</span></div>`;
      }).join('')}</div>
        <div class="bf-last-lab ${rv.lie ? 'bad' : 'ok'}">${rv.lie
          ? `🤥 是假的！${pname(rv.play.p)} 在吹牛，收下整堆 ${rv.taken} 张`
          : `😇 是真的！${pname(rv.c)} 开错了，收下整堆 ${rv.taken} 张`}</div>`;
    } else if (G && G.pile.length) {
      const e = G.pile[G.pile.length - 1];
      last = `<div class="bf-last-cards">${(e.p === 0 ? e.cards.map(c => Hub.cardHTML(c, { cls: 'mine' })) : e.cards.map(() => Hub.cardHTML(null, { back: true }))).join('')}</div>
        <div class="bf-last-lab">${who(e.p)} 声称 <b>${claimText(e.n, e.rank)}</b></div>`;
    }
    const lEl = $('bf-last');
    if (lEl._html !== last) { lEl.innerHTML = last; lEl._html = last; }
    // 本轮声称
    let log = '';
    if (G && G.pile.length && !st.reveal) {
      const W = fitTotal(G);
      const tot = pileCount(G);
      log = `<div class="bf-log-title">本轮声称</div>
        ${G.pile.map(e => `<div class="bf-log-row${e.p === 0 ? ' me' : ''}"><span>${who(e.p)}</span><b>${e.n} 张</b></div>`).join('')}
        <div class="bf-log-sum ${tot > W ? 'over' : ''}">共 <b>${tot}</b> 张 ${rankName(G.rank)}<br><span>全副牌最多 ${W} 张${G.wild ? '（含 2 张王）' : ''}</span></div>`;
    }
    const gEl = $('bf-log');
    if (gEl._html !== log) { gEl.innerHTML = log; gEl._html = log; }
    gEl.classList.toggle('show', !!log);
    Hub.setInfo(`第 <b>${Math.max(1, st.round)}</b>/${st.rounds} 局 · 积分 <b>${fmt(st.totals[0])}</b>`);
  }
  function selCards() { return st.G ? handOf(0).filter(c => st.sel.has(c.id)) : []; }
  function autoRank() {
    // 首家没手动选点数时，按选中的牌里最多的点数来报
    if (st.pickManual) return;
    const cnt = {};
    for (const c of selCards()) if (!isJoker(c)) cnt[c.r] = (cnt[c.r] || 0) + 1;
    const best = Object.keys(cnt).map(Number).sort((a, b) => cnt[b] - cnt[a] || a - b)[0];
    st.pick = best || 0;
  }
  function renderBar() {
    const G = st.G;
    const el = $('bf-btns');
    const n = st.sel.size;
    const rank = G && (G.rank || st.pick);
    const sig = [st.mode, st.acting, st.judging, n, rank].join('|');
    if (sig !== st.actSig) {
      st.actSig = sig;
      if (st.mode === 'lead' || st.mode === 'follow') {
        const label = n && rank ? `扣牌：${claimText(n, rank)}` : n ? '扣牌（先选点数）' : '扣牌';
        el.innerHTML = `${st.mode === 'follow' ? '<button class="hub-btn gray" data-act="pass">过 <kbd>P</kbd></button>' : ''}
          <button class="hub-btn gray" data-act="clear">重选 <kbd>Esc</kbd></button>
          <button class="hub-btn gold${n && rank && n <= MAX_PLAY ? ' pulse' : ''}" data-act="play"${n && rank && n <= MAX_PLAY ? '' : ' disabled'}>${label} <kbd>Enter</kbd></button>`;
      } else if (st.mode === 'judge') {
        el.innerHTML = `<button class="hub-btn green" data-act="believe">😌 相信 <kbd>空格</kbd></button>
          <button class="hub-btn red" data-act="doubt">🤨 质疑！开牌 <kbd>Q</kbd></button>`;
      } else if (st.acting > 0) {
        el.innerHTML = `<div class="waiting">等待 ${who(st.acting)} ${G.rank ? '扣牌' : '报点数'}…</div>`;
      } else if (st.judging > 0) {
        el.innerHTML = `<div class="waiting">${who(st.judging)} 在考虑要不要开牌…</div>`;
      } else el.innerHTML = '';
    }
    // 点数选择（首家）
    const rEl = $('bf-ranks');
    let rh = '';
    if (st.mode === 'lead') {
      const cnt = {};
      for (const c of handOf(0)) if (!isJoker(c)) cnt[c.r] = (cnt[c.r] || 0) + 1;
      rh = '<span class="bf-ranks-lab">报点数：</span>' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(r =>
        `<button class="bf-rk${st.pick === r ? ' on' : ''}${cnt[r] ? '' : ' none'}" data-rank="${r}">${rankName(r)}${cnt[r] ? `<i>${cnt[r]}</i>` : ''}</button>`).join('');
    }
    if (rEl._html !== rh) { rEl.innerHTML = rh; rEl._html = rh; }
    rEl.classList.toggle('show', !!rh);
    renderMsg();
  }
  function renderMsg() {
    const G = st.G;
    let h = '';
    if (G && (st.mode === 'lead' || st.mode === 'follow' || st.mode === 'judge')) {
      const r = st.mode === 'judge' ? G.window.play.rank : (G.rank || st.pick);
      const mine = r ? handOf(0).filter(c => c.r === r && !isJoker(c)).length : 0;
      const jk = handOf(0).filter(isJoker).length;
      const W = fitTotal(G);
      if (st.mode === 'lead') {
        const sc = selCards();
        const real = r ? countFit(sc, r) : 0;
        h = sc.length
          ? (r ? `扣 ${sc.length} 张，声称 <b>${claimText(sc.length, r)}</b>${real < sc.length ? ` <span class="bad">（其中 ${sc.length - real} 张是假的）</span>` : ' <span class="ok">（全是真的）</span>'}` : '选好牌后，点上面的点数来报')
          : '你是首家：选 1~4 张牌，再选要报的点数';
      } else if (st.mode === 'follow') {
        const sc = selCards();
        const real = countFit(sc, r);
        h = `你手里有 <b>${mine}</b> 张 ${rankName(r)}${jk ? ` + <b>${jk}</b> 张王` : ''}`;
        if (sc.length) h += `<br>扣 ${sc.length} 张${real < sc.length ? ` <span class="bad">（${sc.length - real} 张假牌）</span>` : ' <span class="ok">（全是真的）</span>'}`;
        else h += '<br>选牌接着吹，或者按 P 过';
      } else {
        const play = G.window.play;
        const known = mine + jk + countFit(myContrib(G, 0), r);
        const outside = W - known;
        h = `${who(play.p)} 扣下 ${play.n} 张，说是 <b>${claimText(play.n, play.rank)}</b>${handOf(play.p).length === 0 ? ' <span class="bad">——这是最后一手，不开就让对方出完了！</span>' : ''}
          <br>你知道的 ${rankName(r)}：手里 ${mine}${jk ? ` + 王 ${jk}` : ''}${countFit(myContrib(G, 0), r) ? ` + 你扣进堆里 ${countFit(myContrib(G, 0), r)}` : ''} → 别人最多还有 <b class="${play.n > outside ? 'bad' : ''}">${Math.max(0, outside)}</b> 张`;
        if (play.n > outside) h += ' <span class="bad">（肯定是在吹！）</span>';
      }
    }
    const el = $('bf-msg');
    if (el._html !== h) { el.innerHTML = h; el._html = h; }
  }
  function renderHand() {
    const el = $('bf-hand');
    const hand = st.G ? handOf(0) : [];
    for (const id of [...st.sel]) if (!hand.some(c => c.id === id)) st.sel.delete(id);
    const n = hand.length;
    const avail = Math.max(200, el.clientWidth - 24);
    const step = n > 1 ? Math.min(handCw * 0.7, (avail - handCw) / (n - 1)) : handCw;
    el.style.setProperty('--overlap', Math.max(0, handCw - step).toFixed(1) + 'px');
    el.classList.toggle('locked', !(st.mode === 'lead' || st.mode === 'follow'));
    const r = st.G && (st.mode === 'judge' && st.G.window ? st.G.window.play.rank : st.G.rank || st.pick);
    const ids = hand.map(c => c.id).join(',');
    if (!st.dealAnim && el._ids === ids) {
      for (const ch of el.children) {
        ch.classList.toggle('sel', st.sel.has(ch.dataset.id));
        ch.classList.toggle('hl', st.newIds.has(ch.dataset.id));
        const c = hand.find(x => x.id === ch.dataset.id);
        ch.classList.toggle('fit', !!(r && c && fits(c, r)));
      }
      return;
    }
    el._ids = ids;
    el.classList.toggle('noanim', !st.dealAnim);
    el.innerHTML = hand.map(c => Hub.cardHTML(c, { sel: st.sel.has(c.id), hl: st.newIds.has(c.id), cls: r && fits(c, r) ? 'fit' : '' })).join('');
    if (st.dealAnim) Array.from(el.children).forEach((c, i) => { c.style.animationDelay = (i * 30) + 'ms'; c.style.animationFillMode = 'backwards'; });
  }
  function render() {
    renderSeats();
    renderCenter();
    renderBar();
    renderHand();
  }

  /* ---------- 飞牌动画 ---------- */
  function fly(fromEl, toEl, n) {
    if (!fromEl || !toEl || !n || !document.body.animate) return;
    const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'bf-fly';
    el.innerHTML = '<div class="pk back"></div>'.repeat(Math.min(n, 5));
    const x0 = a.left + a.width / 2, y0 = a.top + a.height / 2;
    el.style.left = x0 + 'px';
    el.style.top = y0 + 'px';
    document.body.appendChild(el);
    const dx = b.left + b.width / 2 - x0, dy = b.top + b.height / 2 - y0;
    const anim = el.animate([
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.75)`, opacity: 0.7 },
    ], { duration: ctx.fast ? 260 : 420, easing: 'cubic-bezier(.4,.1,.6,1)', fill: 'forwards' });
    anim.onfinish = () => el.remove();
    setTimeout(() => el.remove(), 900);   // 页面在后台时动画不推进，兜底清掉
  }

  /* ---------- 玩家操作 ---------- */
  function humanTurn() {
    return new Promise(resolve => {
      st.mode = st.G.rank ? 'follow' : 'lead';
      st.pick = st.G.rank || 0;
      st.pickManual = false;
      st.resolve = resolve;
      render();
    });
  }
  function humanJudge() {
    return new Promise(resolve => {
      st.mode = 'judge';
      st.resolve = resolve;
      render();
    });
  }
  function finishHuman(v) {
    const fn = st.resolve;
    st.resolve = null;
    st.mode = 'idle';
    st.sel.clear();
    fn(v);
  }
  function onPlay() {
    if ((st.mode !== 'lead' && st.mode !== 'follow') || !st.resolve) return;
    const cards = selCards();
    const rank = st.G.rank || st.pick;
    const err = checkPlay(st.G, 0, cards, rank);
    if (err) { Hub.toast(err); Hub.sfx('error'); return; }
    st.newIds.clear();
    finishHuman({ cards, rank });
  }
  function onPass() {
    if (st.mode !== 'follow' || !st.resolve) return;
    finishHuman({ pass: true });
  }
  function onClear() {
    if (st.mode !== 'lead' && st.mode !== 'follow') return;
    st.sel.clear();
    autoRank();
    renderHand(); renderBar();
  }
  function onRank(r) {
    if (st.mode !== 'lead') return;
    st.pick = r;
    st.pickManual = true;
    Hub.sfx('select');
    renderBar(); renderHand();
  }
  function onJudge(doubt) {
    if (st.mode !== 'judge' || !st.resolve) return;
    Hub.sfx('click');
    finishHuman(!!doubt);
  }

  /* ---------- 一局流程 ---------- */
  function callClaim(p, play) {
    // 报牌口播：“三张K！”
    Hub.call(pname(p), `bf_${play.n}_${play.rank}`);
  }
  async function aiTurn(p) {
    await Hub.wait(550 + Math.random() * 450);
    return aiAct(st.G, p, DIFF, Math.random, st.players[p].persona);
  }
  function clearStatuses() { st.status = [null, null, null, null]; }
  async function judgePhase(play) {
    const G = st.G;
    while (G.window) {
      const c = judgeOf(G);
      st.judging = c;
      render();
      let doubt;
      if (c === 0) doubt = await humanJudge();
      else {
        await Hub.wait(380 + Math.random() * 380);
        doubt = aiChallenge(G, c, DIFF, Math.random, st.players[c].persona);
      }
      st.judging = -1;
      if (doubt) { await reveal(c, play); return; }
      const r = applyBelieve(G, c);
      st.status[c] = { kind: 'pass', text: '相信' };
      if (r.closed) {
        if (play.p === 0 && play.cards.some(x => !fits(x, play.rank))) st.fooled++;
        if (play.p !== 0 && Math.random() < 0.12) say(play.p, 'brag', 1);
      }
      render();
    }
  }
  async function reveal(c, play) {
    const G = st.G;
    const q = play.p;
    st.status[c] = { kind: 'hot', text: '质疑！' };
    Hub.call(pname(c), Hub.randPick(['bf_kai1', 'bf_kai2', 'bf_kai3']));
    st.doubt = { c, q };
    Hub.sfx('whoosh');
    render();
    await Hub.wait(1150);
    const res = applyChallenge(G, c);
    st.doubt = null;
    st.reveal = { play, c, lie: res.lie, taken: res.taken.length };
    st.status[q] = res.lie ? { kind: 'bad', text: '🤥 被抓' } : { kind: 'good', text: '😇 清白' };
    st.status[c] = res.lie ? { kind: 'good', text: '🎯 抓到了' } : { kind: 'bad', text: '😵 开错了' };
    Hub.sfx('reveal');
    render();
    await Hub.wait(650);
    Hub.announce(res.lie ? 'bf_liar' : 'bf_truth');
    Hub.sfx(res.lie ? (c === 0 ? 'win' : 'chips') : (c === 0 ? 'lose' : 'chips'));
    // 台词：被开的人和开牌的人各有一半机会说一句
    if (Math.random() < 0.5) say(q, res.lie ? 'caught' : 'vindicated', 0.8);
    else say(c, res.lie ? 'catch' : 'wrong', 0.8);
    if (c === 0) { if (res.lie) st.catches++; else st.wrong++; }
    if (q === 0 && res.lie) st.caught++;
    await Hub.wait(1900);
    fly($('bf-pile'), $('seat-' + res.loser), res.taken.length);
    if (res.loser === 0) st.newIds = new Set(res.taken.map(x => x.id));
    st.reveal = null;
    st.cleared = null;
    render();
    await Hub.wait(700);
    if (G.phase === 'play') {
      clearStatuses();
      Hub.toast(`${pname(res.winner)} 重新报点数`, 1300);
    }
    tenseCheck();
  }
  function tenseCheck() {
    const G = st.G;
    let hot = false;
    for (let p = 0; p < NP; p++) {
      const n = handOf(p).length;
      if (G.phase === 'play' && n > 0 && n <= 2) {
        hot = true;
        if (!st.alerted[p] || st.alerted[p] > n) {
          st.alerted[p] = n;
          setTimeout(() => Hub.call(pname(p), 'bf_left' + n), 700);
          say(p, 'warn', 0.3);
        }
      } else if (n > 2) st.alerted[p] = 0;
    }
    Hub.bgmTense(hot);
  }
  async function playRound(first) {
    st.G = createRound({ first, noJokers: P.noJokers, pub: st.pub });
    const G = st.G;
    clearStatuses();
    st.reveal = null; st.cleared = null; st.sel.clear(); st.newIds.clear();
    st.acting = -1; st.judging = -1; st.mode = 'idle'; st.alerted = [0, 0, 0, 0];
    Hub.bgmTense(false);
    st.dealAnim = true;
    render();
    st.dealAnim = false;
    Hub.sfx('shuffle');
    Hub.banner(`第 ${st.round} 局 · ${who(first)} 先报点数`, 1500);
    await Hub.wait(1300);
    while (G.phase === 'play') {
      const p = G.turn;
      if (!G.rank) clearStatuses();
      st.acting = p;
      render();
      const act = p === 0 ? await humanTurn() : await aiTurn(p);
      st.acting = -1;
      if (act.pass) {
        const r = applyPass(G, p);
        st.status[p] = { kind: 'pass', text: '过' };
        Hub.sfx('pass');
        Hub.call(pname(p), 'bf_pass');
        if (r.cleared) {
          render();
          await Hub.wait(500);
          st.cleared = r.n;
          Hub.banner(`没人跟，这一轮 ${r.n} 张牌作废 · ${who(r.leader)} 重新报点数`, 1600);
          Hub.sfx('whoosh');
          await Hub.wait(900);
        }
        render();
        await Hub.wait(250);
        continue;
      }
      const play = applyPlay(G, p, act.cards, act.rank);
      st.cleared = null;
      st.status[p] = { kind: play.lead ? 'info' : 'good', text: `${play.lead ? '报' : '跟'} ${claimText(play.n, play.rank)}` };
      for (let o = 0; o < NP; o++) if (o !== p && st.status[o] && st.status[o].text === '相信') st.status[o] = null;
      fly($('seat-' + p), $('bf-pile'), play.n);
      Hub.sfx('play');
      callClaim(p, play);
      render();
      tenseCheck();
      await Hub.wait(650);
      await judgePhase(play);
      render();
      if (G.phase === 'play') await Hub.wait(260);
    }
    await roundOver();
  }
  async function roundOver() {
    const G = st.G;
    const res = settle(G);
    for (let p = 0; p < NP; p++) st.totals[p] += res.deltas[p];
    const meWin = res.winner === 0;
    if (meWin) st.wins++;
    Hub.bgmTense(false);
    Hub.sfx(meWin ? 'win' : 'lose');
    Hub.banner(meWin ? `🎉 你出完了！赢 ${fmt(res.deltas[0])} 分` : `${who(res.winner)} 出完了，你付 ${-res.deltas[0]} 分`, 1800);
    for (let p = 1; p < NP; p++) say(p, p === res.winner ? 'win' : 'lose', p === res.winner ? 0.7 : 0.25);
    render();
    await Hub.wait(1400);
    const last = st.round >= st.rounds;
    const order = [0, 1, 2, 3].sort((a, b) => res.left[a] - res.left[b]);
    const rows = order.map(p => {
      const d = res.deltas[p];
      return `<div class="rr-row${p === 0 ? ' me' : ''}"><span>${who(p)}</span><span class="left">${p === res.winner ? '🏆 出完' : `剩 ${res.left[p]} 张`}</span>
        <span class="d ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${fmt(d)}</span><span class="t">累计 ${fmt(st.totals[p])}</span></div>`;
    }).join('');
    const el = $('bf-result');
    el.innerHTML = `<div class="rr-panel">
      <h2>${meWin ? '🎉 本局你赢了' : `本局 ${who(res.winner)} 获胜`}</h2>
      <div class="rr-mult">其他人每剩 1 张牌付 1 分给赢家</div>
      <div class="rr-rows">${rows}</div>
      <button class="hub-btn gold big" id="rr-next">${last ? '查看总成绩 🏁' : `下一局 ▶（第 ${st.round + 1} 局）`}</button>
      <div class="rr-key">Enter / 空格 继续</div></div>`;
    el.classList.add('show');
    st.mode = 'result';
    await new Promise(resolve => {
      st.resultResolve = resolve;
      $('rr-next').onclick = () => nextFromResult();
    });
    el.classList.remove('show');
  }
  function nextFromResult() {
    if (st.mode !== 'result' || !st.resultResolve) return;
    const r = st.resultResolve; st.resultResolve = null; st.mode = 'idle';
    Hub.sfx('click');
    r();
  }
  function finishMatch() {
    const score = st.totals[0];
    const passed = score >= st.target;
    Hub.finish({
      passed,
      stats: { score, wins: st.wins, catches: st.catches, caught: st.caught, fooled: st.fooled, wrong: st.wrong },
      lines: [
        `共 <b>${st.rounds}</b> 局，你先出完 <b>${st.wins}</b> 局`,
        `总积分：<b>${fmt(score)}</b>（目标 ≥ ${st.target}）`,
        `🎯 抓到别人吹牛 ${st.catches} 次 · 😵 开错 ${st.wrong} 次 · 🤥 吹牛被抓 ${st.caught} 次 · 😏 成功骗过大家 ${st.fooled} 次`,
        [1, 2, 3].map(p => `${who(p)} ${fmt(st.totals[p])}`).join(' · '),
      ],
    });
  }

  /* ---------- 初始化 ---------- */
  const KEY_RANK = { a: 1, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 0: 10, t: 10, j: 11, q: 12, k: 13 };
  function bind() {
    Hub.enableHandSelect($('bf-hand'), ids => {
      if (st.mode !== 'lead' && st.mode !== 'follow') return;
      if (!ids) st.sel.clear();
      else for (const id of ids) { if (st.sel.has(id)) st.sel.delete(id); else st.sel.add(id); }
      if (st.sel.size > MAX_PLAY) Hub.toast(`一次最多扣 ${MAX_PLAY} 张`);
      autoRank();
      renderHand(); renderBar();
    });
    $('bf-bottom').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.blur) b.blur();
      if (b.dataset.rank) onRank(+b.dataset.rank);
      else if (b.dataset.act === 'play') onPlay();
      else if (b.dataset.act === 'pass') onPass();
      else if (b.dataset.act === 'clear') onClear();
      else if (b.dataset.act === 'believe') onJudge(false);
      else if (b.dataset.act === 'doubt') onJudge(true);
    });
    document.addEventListener('keydown', e => {
      if (document.querySelector('.hub-overlay.show')) return;
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      const k = e.key;
      if (st.mode === 'result') {
        if (k === 'Enter' || k === ' ') { e.preventDefault(); nextFromResult(); }
        return;
      }
      if (st.mode === 'judge') {
        if (k === ' ' || k === 'Enter') { e.preventDefault(); onJudge(false); }
        else if (k === 'q' || k === 'Q') { e.preventDefault(); onJudge(true); }
        return;
      }
      if (st.mode !== 'lead' && st.mode !== 'follow') return;
      if (k === 'Enter' || k === ' ') { e.preventDefault(); onPlay(); }
      else if (k === 'p' || k === 'P') { e.preventDefault(); onPass(); }
      else if (k === 'Escape') onClear();
      else if (st.mode === 'lead' && KEY_RANK[k.toLowerCase()] != null) onRank(KEY_RANK[k.toLowerCase()]);
    });
    window.addEventListener('resize', () => { layout(); renderHand(); });
  }
  function introHTML() {
    const v = st.players.slice(1).map(pl => `<div class="bf-v"><div class="e">${pl.emoji}</div><div class="n">${pl.name}</div><div class="d">${pl.style}</div></div>`).join('');
    return `<p>把牌<b>扣着</b>出，嘴上报“N 张 X”——可以说真话，也可以吹牛。<br>别人可以<b>相信</b>，也可以<b>质疑</b>开牌：谁错了谁把整堆牌收回去。先出完的人赢。</p>
      <p>${P.noJokers ? '<b>本关没有王</b>：每个点数只有 4 张，吹牛更容易露馅。' : '大小王是<b>万能牌</b>，算作任何点数。'}共 <b>${st.rounds}</b> 局。</p>
      <div class="bf-villains">${v}</div>
      <p style="font-size:14px;color:#9aa3b0">快捷键：Enter 扣牌 · P 过 · Esc 重选 · 表态时 空格 相信 / Q 质疑</p>`;
  }
  async function main() {
    layout();
    bind();
    render();
    await Hub.intro({ title: '🤥 吹牛', html: introHTML(), button: '开始游戏 🃏' });
    const startSeat = Math.floor(Math.random() * NP);
    for (st.round = 1; st.round <= st.rounds; st.round++) {
      await playRound((startSeat + st.round - 1) % NP);
    }
    finishMatch();
  }
  main();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    NP, MAX_PLAY, fits, countFit, sortHand, claimText, fitTotal, mulberry32, newPub,
    createRound, checkPlay, applyPlay, applyPass, applyBelieve, applyChallenge, settle, pileCount, judgeOf,
    hyperTail, assessClaim, publicLie, challengeEV, aiChallenge, aiAct, playOptions, evalOption, bluffOrder,
    sampleOppHands, playHeadless,
  };
}
