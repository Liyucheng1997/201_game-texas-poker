/* ============================================================
   斗地主 · Dou Dizhu
   单机版：你 vs 两个 AI（各有性格），叫分抢地主，多局累计积分
   上半部分是纯逻辑（牌型 / 比较 / 出牌生成 / 拆牌 / 计分 / AI），
   下半部分是 UI（只在浏览器里运行），Node 可直接 require 测试。
   ============================================================ */
'use strict';

const Hub = (typeof window !== 'undefined' && window.Hub) || require('./common.js');

/* ---------------- 点数 ----------------
   比较用点数：3..13 原样，A=14，2=15，小王=16，大王=17（不改牌对象的 r） */
const V_A = 14, V_2 = 15, V_SJ = 16, V_BJ = 17;
const VAL_LABEL = ['', '', '', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', '小王', '大王'];
function cardVal(c) { return c.r === 1 ? V_A : c.r === 2 ? V_2 : c.r === 14 ? V_SJ : c.r === 15 ? V_BJ : c.r; }
function emptyCnt() { return new Array(18).fill(0); }
function countVals(vals) { const c = emptyCnt(); for (const v of vals) c[v]++; return c; }
function cntTotal(c) { let n = 0; for (let v = 3; v <= 17; v++) n += c[v]; return n; }
function cntToVals(c) { const out = []; for (let v = 3; v <= 17; v++) for (let k = 0; k < c[v]; k++) out.push(v); return out; }
function cntKey(c) { let s = ''; for (let v = 3; v <= 17; v++) s += c[v]; return s; }
function cntSub(c, vals) { const r = c.slice(); for (const v of vals) r[v]--; return r; }
function fullDeckCnt() { const c = emptyCnt(); for (let v = 3; v <= 15; v++) c[v] = 4; c[16] = c[17] = 1; return c; }
// 手牌显示顺序：点数从大到小，同点数按花色
function sortCards(cards) { return cards.slice().sort((a, b) => (cardVal(b) - cardVal(a)) || (a.s - b.s)); }

/* ---------------- 随机数（测试可复现） ---------------- */
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
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/* ---------------- 牌型 ----------------
   move = { type, rank, len, vals }
   rank：主体最小点数（单/对/三/炸弹为该点数；链类为起点；王炸=17）
   len：链长（顺子张数 / 连对对数 / 飞机三张组数），非链类为 1 */
const TYPE_NAME = {
  single: '单张', pair: '对子', triple: '三张', triple1: '三带一', triple2: '三带一对',
  straight: '顺子', pairs: '连对', plane: '飞机', plane1: '飞机带翅膀', plane2: '飞机带对翅膀',
  four2: '四带二', four22: '四带两对', bomb: '炸弹', rocket: '王炸',
};
// 同一组牌可能有多种解释，自由出牌时按此顺序取第一种（同类型取 rank 大的）
const TYPE_ORDER = ['rocket', 'bomb', 'single', 'pair', 'triple', 'straight', 'pairs', 'plane',
  'triple1', 'triple2', 'plane1', 'plane2', 'four2', 'four22'];
function mk(type, rank, len, vals) { return { type, rank, len, vals: vals.slice().sort((a, b) => a - b) }; }
function isBombType(m) { return !!m && (m.type === 'bomb' || m.type === 'rocket'); }
function moveKey(m) { return m ? m.type + ':' + m.len + ':' + m.rank + ':' + m.vals.join(',') : 'pass'; }

/* 列出一组牌的全部合法解释（空数组 = 不是合法牌型） */
function analyzeAll(vals) {
  const n = vals.length, out = [];
  if (!n) return out;
  const c = countVals(vals);
  const ranks = [];
  for (let v = 3; v <= 17; v++) if (c[v]) ranks.push(v);
  const k = ranks.length;
  if (n === 2 && c[V_SJ] && c[V_BJ]) return [mk('rocket', V_BJ, 1, vals)];
  if (k === 1) {
    const r = ranks[0];
    if (n === 1) out.push(mk('single', r, 1, vals));
    else if (n === 2) out.push(mk('pair', r, 1, vals));
    else if (n === 3) out.push(mk('triple', r, 1, vals));
    else if (n === 4) out.push(mk('bomb', r, 1, vals));
    return out;
  }
  const all = m => ranks.every(r => c[r] === m);
  const consec = ranks[k - 1] - ranks[0] === k - 1 && ranks[k - 1] <= V_A;
  if (n >= 5 && all(1) && consec) out.push(mk('straight', ranks[0], n, vals));
  if (n >= 6 && all(2) && consec) out.push(mk('pairs', ranks[0], k, vals));
  if (n >= 6 && all(3) && consec) out.push(mk('plane', ranks[0], k, vals));
  if (n === 4) for (const r of ranks) if (c[r] === 3) out.push(mk('triple1', r, 1, vals));
  if (n === 5 && k === 2) for (const r of ranks) if (c[r] === 3 && ranks.some(x => x !== r && c[x] === 2)) out.push(mk('triple2', r, 1, vals));
  if (n === 6) for (const r of ranks) if (c[r] === 4 && !(c[V_SJ] && c[V_BJ])) out.push(mk('four2', r, 1, vals));
  if (n === 8) {
    for (const r of ranks) {
      if (c[r] !== 4) continue;
      if (ranks.every(x => x === r || c[x] % 2 === 0)) out.push(mk('four22', r, 1, vals));
    }
  }
  // 飞机带翅膀：k 个连续三张（不含 2）+ k 张单 / k 对；翅膀不能与主体同点数，单翅膀不能是王炸
  for (const [size, type] of [[1, 'plane1'], [2, 'plane2']]) {
    const unit = 3 + size;
    if (n % unit !== 0 || n / unit < 2) continue;
    const len = n / unit;
    for (let s = 3; s + len - 1 <= V_A; s++) {
      let ok = true;
      for (let j = s; j < s + len; j++) if (c[j] !== 3) { ok = false; break; }
      if (!ok) continue;
      if (size === 1) {
        if (c[V_SJ] && c[V_BJ]) continue;
      } else {
        let even = true;
        for (const x of ranks) if ((x < s || x >= s + len) && (c[x] % 2 !== 0 || x > V_2)) { even = false; break; }
        if (!even) continue;
      }
      out.push(mk(type, s, len, vals));
    }
  }
  return out;
}
function preferMove(list) {
  if (!list.length) return null;
  return list.slice().sort((a, b) => (TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)) || (b.rank - a.rank))[0];
}
function analyze(vals) { return preferMove(analyzeAll(vals)); }

/* a 能否压过 b */
function canBeat(a, b) {
  if (!a) return false;
  if (!b) return true;
  if (b.type === 'rocket') return false;
  if (a.type === 'rocket') return true;
  if (a.type === 'bomb' && b.type !== 'bomb') return true;
  if (a.type !== b.type || a.len !== b.len || a.vals.length !== b.vals.length) return false;
  return a.rank > b.rank;
}

/* 解析玩家选出的牌：last 为要压的牌（null 表示自由出）。intended 为 AI 指定的解释 */
function resolvePlay(vals, last, intended) {
  const all = analyzeAll(vals);
  if (!all.length) return { err: 'type', msg: '牌型不对' };
  let ok = last ? all.filter(m => canBeat(m, last)) : all;
  if (!ok.length) {
    const same = all.some(m => m.type === last.type && m.len === last.len && m.vals.length === last.vals.length);
    if (same) return { err: 'small', msg: '压不过上家的牌' };
    if (last.type === 'rocket') return { err: 'small', msg: '王炸最大，压不过' };
    return { err: 'mismatch', msg: `牌型不符：需要 ${moveName(last, true)}（${last.vals.length} 张）或炸弹` };
  }
  if (intended) {
    const hit = ok.find(m => m.type === intended.type && m.rank === intended.rank && m.len === intended.len);
    if (hit) return { move: hit };
  }
  return { move: preferMove(ok) };
}

function moveName(m, typeOnly) {
  if (!m) return '不出';
  const L = VAL_LABEL;
  const base = TYPE_NAME[m.type];
  if (typeOnly) return base;
  switch (m.type) {
    case 'single': case 'pair': case 'triple': case 'bomb': return `${base} ${L[m.rank]}`;
    case 'triple1': case 'triple2': case 'four2': case 'four22': return `${base}（${L[m.rank]}）`;
    case 'straight': case 'pairs': case 'plane': case 'plane1': case 'plane2':
      return `${base} ${L[m.rank]}-${L[m.rank + m.len - 1]}`;
    default: return base;
  }
}

/* ---------------- 出牌生成 ----------------
   mode: 'all' 列出所有带牌组合；'min' 每个主体只给一种启发式带牌（不拆好牌、优先小单张） */
function kickerSets(c, body, k, size, mode) {
  const units = [];
  for (let v = 3; v <= 17; v++) {
    if (body.includes(v)) continue;
    if (size === 2 && v > V_2) continue;
    const n = Math.floor(c[v] / size);
    for (let i = 0; i < n; i++) units.push(v);
  }
  if (units.length < k) return [];
  const expand = ks => size === 1 ? ks.slice() : ks.flatMap(v => [v, v]);
  if (mode === 'all') {
    const res = [], cur = [];
    const rec = start => {
      if (cur.length === k) {
        if (size === 1 && cur.includes(V_SJ) && cur.includes(V_BJ)) return;
        res.push(expand(cur));
        return;
      }
      for (let i = start; i < units.length; i++) {
        if (i > start && units[i] === units[i - 1]) continue;
        cur.push(units[i]); rec(i + 1); cur.pop();
      }
    };
    rec(0);
    return res;
  }
  // 启发式：孤张/小牌优先，尽量不拆对子、三张、炸弹，少用 2 和王
  const scored = [];
  const seenIdx = {};
  for (const v of units) {
    const i = seenIdx[v] = (seenIdx[v] || 0) + 1;
    const n = c[v];
    let cost = v + (v >= V_2 ? 30 : 0) + (i - 1) * 12;
    if (size === 1) cost += [0, 0, 18, 25, 80][n];
    else cost += [0, 0, 0, 15, 60][n];
    scored.push([cost, v]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const pick = [];
  for (const [, v] of scored) {
    if (pick.length >= k) break;
    if (size === 1 && ((v === V_SJ && pick.includes(V_BJ)) || (v === V_BJ && pick.includes(V_SJ)))) continue;
    pick.push(v);
  }
  return pick.length === k ? [expand(pick)] : [];
}

function genType(c, type, len, above, mode) {
  const out = [];
  const lo = Math.max(3, above + 1);
  switch (type) {
    case 'single': for (let v = lo; v <= 17; v++) if (c[v] >= 1) out.push(mk('single', v, 1, [v])); break;
    case 'pair': for (let v = lo; v <= V_2; v++) if (c[v] >= 2) out.push(mk('pair', v, 1, [v, v])); break;
    case 'triple': for (let v = lo; v <= V_2; v++) if (c[v] >= 3) out.push(mk('triple', v, 1, [v, v, v])); break;
    case 'bomb': for (let v = lo; v <= V_2; v++) if (c[v] >= 4) out.push(mk('bomb', v, 1, [v, v, v, v])); break;
    case 'rocket': if (c[V_SJ] && c[V_BJ]) out.push(mk('rocket', V_BJ, 1, [V_SJ, V_BJ])); break;
    case 'straight': case 'pairs': case 'plane': {
      const need = type === 'straight' ? 1 : type === 'pairs' ? 2 : 3;
      for (let s = lo; s + len - 1 <= V_A; s++) {
        let ok = true;
        for (let j = s; j < s + len; j++) if (c[j] < need) { ok = false; break; }
        if (!ok) continue;
        const vals = [];
        for (let j = s; j < s + len; j++) for (let q = 0; q < need; q++) vals.push(j);
        out.push(mk(type, s, len, vals));
      }
      break;
    }
    case 'triple1': case 'triple2': {
      const size = type === 'triple1' ? 1 : 2;
      for (let t = lo; t <= V_2; t++) {
        if (c[t] < 3) continue;
        for (const ks of kickerSets(c, [t], 1, size, mode)) out.push(mk(type, t, 1, [t, t, t].concat(ks)));
      }
      break;
    }
    case 'plane1': case 'plane2': {
      const size = type === 'plane1' ? 1 : 2;
      for (let s = lo; s + len - 1 <= V_A; s++) {
        let ok = true;
        const body = [], vals = [];
        for (let j = s; j < s + len; j++) { if (c[j] < 3) { ok = false; break; } body.push(j); vals.push(j, j, j); }
        if (!ok) continue;
        for (const ks of kickerSets(c, body, len, size, mode)) out.push(mk(type, s, len, vals.concat(ks)));
      }
      break;
    }
    case 'four2': case 'four22': {
      const size = type === 'four2' ? 1 : 2;
      for (let t = lo; t <= V_2; t++) {
        if (c[t] < 4) continue;
        for (const ks of kickerSets(c, [t], 2, size, mode)) out.push(mk(type, t, 1, [t, t, t, t].concat(ks)));
      }
      break;
    }
  }
  return out;
}

/* 所有可以压过 last 的出法 */
function genBeats(c, last, mode) {
  mode = mode || 'min';
  if (!last) return genLeads(c, mode);
  if (last.type === 'rocket') return [];
  const out = [];
  if (last.type !== 'bomb') out.push(...genType(c, last.type, last.len, last.rank, mode));
  out.push(...genType(c, 'bomb', 1, last.type === 'bomb' ? last.rank : 0, mode));
  out.push(...genType(c, 'rocket', 1, 0, mode));
  return out;
}
/* 自由出牌时的所有出法 */
function genLeads(c, mode) {
  mode = mode || 'min';
  const out = [];
  for (const t of ['single', 'pair', 'triple', 'triple1', 'triple2', 'four2', 'four22', 'bomb', 'rocket']) out.push(...genType(c, t, 1, 0, mode));
  for (let L = 5; L <= 12; L++) out.push(...genType(c, 'straight', L, 0, mode));
  for (let L = 3; L <= 10; L++) out.push(...genType(c, 'pairs', L, 0, mode));
  for (let L = 2; L <= 6; L++) out.push(...genType(c, 'plane', L, 0, mode));
  for (let L = 2; L <= 5; L++) out.push(...genType(c, 'plane1', L, 0, mode));
  for (let L = 2; L <= 4; L++) out.push(...genType(c, 'plane2', L, 0, mode));
  return out;
}

/* ---------------- 拆牌（最少手数） ----------------
   先取出王炸与炸弹，2 和王不进链；对 3..A 做深搜：在最小点数处尝试起顺子/连对/飞机，
   或把该点数剩下的牌当作单/对/三。叶子估值：手数（三张/飞机可带走单或对）为主，小单张为辅。 */
const SPLIT_CACHE = new Map();
const SPLIT_NODE_LIMIT = 6000;
function splitHand(cnt) {
  const key = cntKey(cnt);
  let r = SPLIT_CACHE.get(key);
  if (r) return r;
  r = computeSplit(cnt);
  if (SPLIT_CACHE.size > 80000) SPLIT_CACHE.clear();
  SPLIT_CACHE.set(key, r);
  return r;
}
function computeSplit(cnt0) {
  const c = cnt0.slice();
  const bombs = [];
  for (let v = 3; v <= V_2; v++) if (c[v] === 4) { bombs.push(mk('bomb', v, 1, [v, v, v, v])); c[v] = 0; }
  if (c[V_SJ] && c[V_BJ]) { bombs.push(mk('rocket', V_BJ, 1, [V_SJ, V_BJ])); c[V_SJ] = c[V_BJ] = 0; }
  const left = emptyCnt();
  for (const v of [V_2, V_SJ, V_BJ]) { left[v] = c[v]; c[v] = 0; }
  const chains = []; // [kind, start, len]
  let best = null, bestCost = Infinity, nodes = 0;
  const NEED = [1, 2, 3], MINL = [5, 3, 2];

  function leaf() {
    let S = 0, P = 0, T = 0, pen = 0;
    for (let v = 3; v <= 17; v++) {
      const n = left[v];
      if (n === 1) { S++; pen += 17 - v; } else if (n === 2) { P++; pen += (17 - v) * 0.5; } else if (n === 3) T++;
    }
    let units = T;
    for (let i = 0; i < chains.length; i += 3) if (chains[i] === 2) units += chains[i + 2];
    const hands = chains.length / 3 + T + bombs.length + Math.max(0, S + P - units);
    const cost = hands * 100 + pen;
    if (cost < bestCost) { bestCost = cost; best = { hands, chains: chains.slice(), left: left.slice() }; }
  }
  function dfs(i, from) {
    if (++nodes > SPLIT_NODE_LIMIT && best) return;
    while (i <= V_A && c[i] === 0) { i++; from = 0; }
    if (i > V_A) { leaf(); return; }
    for (let kind = 0; kind < 3; kind++) {
      const need = NEED[kind];
      let len = 0;
      while (i + len <= V_A && c[i + len] >= need) len++;
      for (let L = MINL[kind]; L <= len; L++) {
        const id = kind * 20 + L;
        if (id < from) continue;
        for (let j = i; j < i + L; j++) c[j] -= need;
        chains.push(kind, i, L);
        dfs(i, id);
        chains.length -= 3;
        for (let j = i; j < i + L; j++) c[j] += need;
      }
    }
    const save = c[i];
    left[i] = save; c[i] = 0;
    dfs(i + 1, 0);
    c[i] = save; left[i] = 0;
  }
  dfs(3, 0);
  const res = { hands: best.hands, cost: bestCost, bombs, chains: [], singles: [], pairs: [], triples: [] };
  const CT = ['straight', 'pairs', 'plane'];
  for (let i = 0; i < best.chains.length; i += 3) {
    const kind = best.chains[i], s = best.chains[i + 1], L = best.chains[i + 2];
    const vals = [];
    for (let j = s; j < s + L; j++) for (let q = 0; q < NEED[kind]; q++) vals.push(j);
    res.chains.push(mk(CT[kind], s, L, vals));
  }
  for (let v = 3; v <= 17; v++) {
    const n = best.left[v];
    if (n === 1) res.singles.push(v); else if (n === 2) res.pairs.push(v); else if (n === 3) res.triples.push(v);
  }
  return res;
}

/* 把拆牌结果组织成一手手出牌：三张/飞机带上最小的单张（或对子），按点数从小到大排 */
function leadGroups(sp) {
  const singles = sp.singles.slice(), pairs = sp.pairs.slice();
  const kS = singles.filter(v => v < V_A), kP = pairs.filter(v => v < V_A);
  const usedS = [], usedP = [];
  const groups = [];
  for (const ch of sp.chains) {
    if (ch.type !== 'plane') { groups.push(ch); continue; }
    const k = ch.len;
    if (kS.length >= k) { const ks = kS.splice(0, k); usedS.push(...ks); groups.push(mk('plane1', ch.rank, k, ch.vals.concat(ks))); }
    else if (kP.length >= k) { const kp = kP.splice(0, k); usedP.push(...kp); groups.push(mk('plane2', ch.rank, k, ch.vals.concat(kp.flatMap(v => [v, v])))); }
    else groups.push(ch);
  }
  for (const t of sp.triples) {
    if (kS.length) { const s = kS.shift(); usedS.push(s); groups.push(mk('triple1', t, 1, [t, t, t, s])); }
    else if (kP.length) { const p = kP.shift(); usedP.push(p); groups.push(mk('triple2', t, 1, [t, t, t, p, p])); }
    else groups.push(mk('triple', t, 1, [t, t, t]));
  }
  for (const v of singles) { const i = usedS.indexOf(v); if (i >= 0) usedS.splice(i, 1); else groups.push(mk('single', v, 1, [v])); }
  for (const v of pairs) { const i = usedP.indexOf(v); if (i >= 0) usedP.splice(i, 1); else groups.push(mk('pair', v, 1, [v, v])); }
  groups.sort((a, b) => (a.rank - b.rank) || (b.vals.length - a.vals.length));
  const bombs = sp.bombs.slice().sort((a, b) => a.rank - b.rank);
  return { normal: groups, bombs };
}

/* ---------------- 牌局引擎 ----------------
   座位：0 = 你（下方），1 = 右（下家），2 = 左（上家）；出牌顺序 0→1→2→0 */
function createRound(opts) {
  const o = opts || {};
  const rng = o.rng || Math.random;
  const deck = o.deck ? o.deck.slice() : Hub.shuffle(Hub.makeDeck({ decks: 1, jokers: true }), rng);
  const hands = [deck.slice(0, 17), deck.slice(17, 34), deck.slice(34, 51)].map(sortCards);
  const first = o.firstBidder || 0;
  return {
    hands, bottom: deck.slice(51, 54), landlord: -1, bid: 0, bids: [null, null, null],
    bidTurn: first, firstBidder: first, bidCount: 0, bidWinner: -1,
    turn: -1, last: null, passes: 0, history: [], bombs: 0, rockets: 0,
    plays: [0, 0, 0], played: [], winner: -1, phase: 'bid',
  };
}
// 叫分：b=0 不叫；返回 'next' | 'done' | 'redeal'
function applyBid(G, p, b) {
  if (G.phase !== 'bid' || p !== G.bidTurn) throw new Error('not bidding turn');
  if (b !== 0 && (b <= G.bid || b > 3 || b !== Math.floor(b))) throw new Error('invalid bid ' + b);
  G.bids[p] = b; G.bidCount++;
  if (b > 0) { G.bid = b; G.bidWinner = p; }
  if (b === 3 || G.bidCount === 3) {
    if (G.bid > 0) { setLandlord(G, G.bidWinner, G.bid); return 'done'; }
    G.phase = 'redeal';
    return 'redeal';
  }
  G.bidTurn = (p + 1) % 3;
  return 'next';
}
function setLandlord(G, p, bid) {
  G.landlord = p; G.bid = bid;
  G.hands[p] = sortCards(G.hands[p].concat(G.bottom));
  G.phase = 'play'; G.turn = p; G.last = null; G.passes = 0;
}
// 出牌（cards 为空 = 不出）。非法时抛错
function applyPlay(G, p, cards, intended) {
  if (G.phase !== 'play' || p !== G.turn) throw new Error('not your turn');
  const hand = G.hands[p];
  if (!cards || !cards.length) {
    if (!G.last) throw new Error('leader cannot pass');
    G.history.push({ p, pass: true, vs: G.last });
    G.passes++;
    if (G.passes >= 2) { G.last = null; G.passes = 0; }
    G.turn = (p + 1) % 3;
    return { pass: true };
  }
  const ids = new Set(cards.map(c => c.id));
  if (ids.size !== cards.length) throw new Error('duplicate cards');
  for (const c of cards) if (!hand.some(h => h.id === c.id)) throw new Error('card not in hand');
  const res = resolvePlay(cards.map(cardVal), G.last ? G.last.move : null, intended);
  if (res.err) throw new Error('illegal play: ' + res.msg);
  const m = res.move;
  G.hands[p] = hand.filter(h => !ids.has(h.id));
  G.played.push(...cards);
  G.plays[p]++;
  if (m.type === 'bomb') G.bombs++;
  if (m.type === 'rocket') G.rockets++;
  const vs = G.last;
  G.last = { p, move: m, cards };
  G.passes = 0;
  G.history.push({ p, move: m, cards, vs });
  if (!G.hands[p].length) { G.winner = p; G.phase = 'over'; } else G.turn = (p + 1) % 3;
  return { move: m };
}

/* ---------------- 计分 ----------------
   倍数 = 叫分 × 2^(炸弹+王炸) × 春天/反春(×2)；农民各 ±底分×倍数，地主 ∓2×底分×倍数 */
function settle(G, base) {
  base = base || 1;
  const L = G.landlord;
  const llWin = G.winner === L;
  const farmers = [0, 1, 2].filter(i => i !== L);
  const spring = llWin && farmers.every(f => G.plays[f] === 0);
  const antiSpring = !llWin && G.plays[L] === 1;
  const bombMul = Math.pow(2, G.bombs + G.rockets);
  const springMul = (spring || antiSpring) ? 2 : 1;
  const mult = G.bid * bombMul * springMul;
  const unit = base * mult;
  const deltas = [0, 0, 0];
  for (const f of farmers) deltas[f] = llWin ? -unit : unit;
  deltas[L] = llWin ? 2 * unit : -2 * unit;
  return { llWin, spring, antiSpring, mult, bombMul, springMul, bid: G.bid, bombs: G.bombs, rockets: G.rockets, deltas };
}

/* ---------------- AI 公共 ---------------- */
// 从对局生成某个玩家能看到的信息
function situation(G, p, diff, rng, budget) {
  const L = G.landlord;
  return {
    me: p, landlord: L, diff: diff || 0, rng: rng || Math.random, budget,
    cnt: countVals(G.hands[p].map(cardVal)),
    counts: G.hands.map(h => h.length),
    last: G.last ? { p: G.last.p, move: G.last.move } : null,
    passes: G.passes,
    playedCnt: countVals(G.played.map(cardVal)),
    // 底牌是公开的：地主还没打出的底牌（按牌 id 判断）
    bottomLeft: (L >= 0 && L !== p) ? G.bottom.filter(c => G.hands[L].some(h => h.id === c.id)).map(cardVal) : [],
    history: G.history,
    plays: G.plays.slice(),
  };
}
function roleInfo(S) {
  const me = S.me, L = S.landlord;
  const isLL = me === L;
  return {
    isLL, mate: isLL ? -1 : 3 - me - L,
    opps: isLL ? [(L + 1) % 3, (L + 2) % 3] : [L],
    down: (L + 1) % 3, up: (L + 2) % 3, next: (me + 1) % 3,
  };
}
function sameTeam(a, b, L) { return a === b || (a !== L && b !== L); }
function unseenCnt(S) {
  const u = fullDeckCnt();
  for (let v = 3; v <= 17; v++) u[v] -= S.cnt[v] + S.playedCnt[v];
  return u;
}
// 对手（持有 U 里的牌、最多 maxCards 张）有没有可能压过 m
function canAnyBeat(U, m, maxCards) {
  if (m.type === 'rocket') return false;
  if (maxCards >= 2 && U[V_SJ] && U[V_BJ]) return true;
  if (maxCards >= 4) for (let v = (m.type === 'bomb' ? m.rank + 1 : 3); v <= V_2; v++) if (U[v] >= 4) return true;
  if (m.type === 'bomb') return false;
  if (maxCards < m.vals.length) return false;
  return genType(U, m.type, m.len, m.rank, 'min').length > 0;
}
function evalOptions(cnt, sp, moves) {
  return moves.map(m => {
    const rem = cntSub(cnt, m.vals);
    const s2 = splitHand(rem);
    return { m, rem, sp: s2, delta: s2.hands - (sp.hands - 1) };
  });
}
function smallestCardMove(cnt) { for (let v = 3; v <= 17; v++) if (cnt[v]) return mk('single', v, 1, [v]); return null; }
function wholeHandMove(cnt) {
  const m = analyze(cntToVals(cnt));
  return m;
}

/* ---------------- 简单 AI：会乱拆、该压不压、不认队友、乱炸 ---------------- */
function easyDecide(S) {
  const cnt = S.cnt, rng = S.rng;
  if (!S.last) {
    const whole = wholeHandMove(cnt);
    if (whole) return whole;
    const r = rng();
    if (r < 0.4) return smallestCardMove(cnt);
    if (r < 0.75) {
      const all = genLeads(cnt, 'min');
      const nb = all.filter(m => !isBombType(m));
      const pool = (nb.length && rng() < 0.8) ? nb : all;
      return pool[Math.floor(rng() * pool.length)];
    }
    return normalDecide(S);
  }
  const beats = genBeats(cnt, S.last.move, 'min');
  if (!beats.length) return null;
  const total = cntTotal(cnt);
  const fin = beats.find(m => m.vals.length === total);
  if (fin) return fin;
  if (rng() < 0.35) return null; // 该压不压
  const nb = beats.filter(m => !isBombType(m)).sort((a, b) => a.rank - b.rank);
  const bombs = beats.filter(isBombType);
  if (bombs.length && rng() < (nb.length ? 0.12 : 0.5)) return bombs[0]; // 乱炸
  return nb[0] || null;
}

/* ---------------- 普通 AI：最少手数拆牌、不拆组合、不压队友、牌少才炸 ---------------- */
function normalDecide(S) {
  const cnt = S.cnt, R = roleInfo(S);
  if (!S.last) {
    const whole = wholeHandMove(cnt);
    if (whole) return whole;
    const g = leadGroups(splitHand(cnt));
    if (g.normal.length) return g.normal[0];
    return g.bombs[0];
  }
  const last = S.last;
  const beats = genBeats(cnt, last.move, 'min');
  if (!beats.length) return null;
  const total = cntTotal(cnt);
  const fin = beats.find(m => m.vals.length === total);
  if (fin) return fin;
  const sp = splitHand(cnt);
  const nonBomb = beats.filter(m => !isBombType(m));
  const opts = evalOptions(cnt, sp, nonBomb).sort((a, b) => a.m.rank - b.m.rank);
  if (last.p === R.mate) {
    const o = opts.find(x => x.sp.hands <= 1);
    return o ? o.m : null;
  }
  const lastCnt = S.counts[last.p];
  const minOpp = Math.min(...R.opps.map(o => S.counts[o]));
  let o = opts.find(x => x.delta <= 0);
  if (!o && (lastCnt <= 5 || minOpp <= 5)) o = opts.find(x => x.delta <= 2);
  if (!o && lastCnt <= 8) o = opts.find(x => x.delta <= 1);
  if (o) return o.m;
  const bombs = evalOptions(cnt, sp, beats.filter(isBombType)).sort((a, b) => a.m.rank - b.m.rank);
  if (bombs.length) {
    const b = bombs[0];
    if (lastCnt <= 4 || minOpp <= 3 || b.sp.hands <= 1) return b.m;
  }
  return null;
}

/* ---------------- 困难 AI：记牌（绝对大牌）+ 一路走完 + 农民配合 + 看剩牌 ---------------- */
function hardDecide(S) {
  const cnt = S.cnt, R = roleInfo(S);
  const U = unseenCnt(S);
  const oppMax = Math.max(...R.opps.map(o => S.counts[o]));
  const minOpp = Math.min(...R.opps.map(o => S.counts[o]));
  const isBoss = m => !canAnyBeat(U, m, oppMax);
  // 剩下的牌除了最多一手之外全是绝对大牌 → 可以一路走完
  const canRunOut = sp2 => {
    const g = leadGroups(sp2);
    let nb = 0;
    for (const x of g.normal.concat(g.bombs)) if (!isBoss(x)) { nb++; if (nb > 1) return false; }
    return true;
  };

  if (!S.last) {
    const whole = wholeHandMove(cnt);
    if (whole) return whole;
    const sp = splitHand(cnt);
    const g = leadGroups(sp);
    const all = g.normal.concat(g.bombs);
    const nonBoss = all.filter(x => !isBoss(x));
    if (nonBoss.length <= 1 && all.length > 1) {
      const boss = all.filter(isBoss).sort((a, b) => (isBombType(a) - isBombType(b)) || (b.vals.length - a.vals.length));
      if (boss.length) return boss[0];
    }
    if (!R.isLL) {
      const mateCnt = S.counts[R.mate];
      const llCnt = S.counts[S.landlord];
      if (mateCnt === 1 && llCnt > 1) return smallestCardMove(cnt);
      if (mateCnt === 2 && llCnt > 2) {
        const p = genType(cnt, 'pair', 1, 0, 'min')[0];
        if (p && p.rank <= 12) return p;
      }
    }
    let cands = g.normal.slice();
    if (minOpp === 1) {
      const ns = cands.filter(x => x.type !== 'single');
      if (ns.length) return ns.find(x => !isBoss(x)) || ns[0];
      // 只剩单张可出：先出绝对大的，否则从大往小出，别让对手走
      const singles = genType(cnt, 'single', 1, 0, 'min').sort((a, b) => b.rank - a.rank);
      if (singles.length) {
        const bossS = singles.find(isBoss);
        if (bossS) return bossS;
        if (!R.isLL && R.next === R.mate && S.counts[R.mate] <= 2) return singles[singles.length - 1];
        return singles[0];
      }
      if (g.bombs.length) return g.bombs[0];
    }
    if (minOpp === 2) {
      const np = cands.filter(x => x.type !== 'pair');
      if (np.length) cands = np;
    }
    // 地主上家（队友在地主之后出）：队友牌少时送小牌
    if (!R.isLL && S.me === R.up && S.counts[R.mate] <= 4) {
      const small = cands.filter(x => (x.type === 'single' || x.type === 'pair') && x.rank <= 11).sort((a, b) => a.rank - b.rank)[0];
      if (small) return small;
    }
    const nb = cands.filter(x => !isBoss(x));
    // 地主先走大组合（顺子、连对、三带、飞机），把单张对子留到有控制权时再走
    if (R.isLL) { const multi = nb.find(x => x.vals.length >= 4 && x.rank <= 12); if (multi) return multi; }
    if (nb.length) return nb[0];
    if (cands.length) return cands[0];
    return g.bombs[0] || smallestCardMove(cnt);
  }

  const last = S.last, lm = last.move;
  const beats = genBeats(cnt, lm, 'min');
  if (!beats.length) return null;
  const total = cntTotal(cnt);
  const fin = beats.find(m => m.vals.length === total);
  if (fin) return fin;
  const sp = splitHand(cnt);
  const opts = evalOptions(cnt, sp, beats.filter(m => !isBombType(m))).sort((a, b) => a.m.rank - b.m.rank);
  const bombOpts = evalOptions(cnt, sp, beats.filter(isBombType)).sort((a, b) => a.m.rank - b.m.rank);

  if (last.p === R.mate) {
    const o = opts.find(x => isBoss(x.m) && canRunOut(x.sp));
    if (o) return o.m;
    const llCnt = S.counts[S.landlord];
    // 地主报单/报双、下一个就是地主，而队友的牌可能被压：替队友封住
    if (R.next === S.landlord && llCnt <= 2 && (lm.type === 'single' || lm.type === 'pair') &&
        lm.vals.length <= llCnt && canAnyBeat(U, lm, llCnt) && opts.length) {
      const top = opts.slice().sort((a, b) => b.m.rank - a.m.rank);
      return (top.find(x => isBoss(x.m)) || top[0]).m;
    }
    return null;
  }
  const lastCnt = S.counts[last.p];
  // 1. 压过之后能一路走完
  const ro = opts.filter(x => isBoss(x.m) && canRunOut(x.sp));
  if (ro.length) return ro[0].m;
  const rob = bombOpts.filter(x => isBoss(x.m) && canRunOut(x.sp));
  if (rob.length) return rob[0].m;
  // 2. 对手报单/报双（出牌者或下一个对手）：必须封住，用最大的
  const dangerNext = R.opps.includes(R.next) && S.counts[R.next] <= 2;
  if (lastCnt <= 2 || dangerNext) {
    if (opts.length) {
      const top = opts.slice().sort((a, b) => b.m.rank - a.m.rank);
      return (top.find(x => isBoss(x.m)) || top[0]).m;
    }
    if (bombOpts.length) return bombOpts[0].m;
    return null;
  }
  // 3. 地主下家顶牌：地主出小单/小对时，用 10~A 之间不拆组合的牌顶上去，不让地主轻松走小牌
  //   （自对弈显示“硬顶”——拆牌也要顶——反而降低农民胜率，所以只在不拆牌时顶）
  if (!R.isLL && last.p === S.landlord && S.me === R.down && (lm.type === 'single' || lm.type === 'pair') && lm.rank <= 9) {
    const top = opts.filter(x => x.delta <= 0 && x.m.rank >= 10 && x.m.rank <= V_A)[0];
    if (top) return top.m;
  }
  // 4. 常规：不拆为先，最多多拆一手来抢出牌权
  let o = opts.find(x => x.delta <= 0) || opts.find(x => x.delta <= 1);
  // 别为压对手的小牌而轻易交出 2 / 王（对手牌还多时）
  if (o && o.m.rank >= V_2 && lm.rank <= 10 && lastCnt > 10 && !isBoss(o.m)) o = null;
  if (!o && (lastCnt <= 6 || minOpp <= 5)) o = opts.find(x => x.delta <= 2);
  if (o) return o.m;
  // 5. 炸弹：对手牌少，或炸完能掌控局面
  if (bombOpts.length) {
    const b = bombOpts[0];
    if (lastCnt <= 4 || minOpp <= 3 || (isBoss(b.m) && b.sp.hands <= 2)) return b.m;
  }
  return null;
}

/* ---------------- 大师 AI：采样未知牌 + 模拟搜索 ----------------
   1. 采样：未知牌（整副 − 自己手牌 − 已出牌；地主未出的底牌固定在地主手里）按各家剩余张数随机分配，
      并用对手“面对敌方出牌选择不出”的记录做约束：每次最多重抽 10 次，取违反最少的分配
      （“不要”不一定是“要不起”，所以是软约束）。
   2. 候选：困难策略的选择 + 拆牌方案里的各手牌 + 少拆牌的其他出法 + 不出（最多 12 个）。
   3. 模拟：在同一批采样世界里，每个候选都用困难策略把整局模拟到终局（公共随机数），
      每 6 轮淘汰明显落后的候选，时间预算内（默认 ~380ms）尽量多采样，选平均胜率最高的；
      只有比困难策略的选择高出足够多（≥6%）才改变主意。 */
function makeSampler(S) {
  const others = [0, 1, 2].filter(i => i !== S.me);
  const U = unseenCnt(S);
  const fixed = {};
  for (const o of others) fixed[o] = emptyCnt();
  if (S.landlord !== S.me) for (const v of S.bottomLeft) { fixed[S.landlord][v]++; U[v]--; }
  const pool = cntToVals(U);
  const need = others.map(o => S.counts[o] - cntTotal(fixed[o]));
  const cons = [];
  for (let i = S.history.length - 1; i >= 0 && cons.length < 10; i--) {
    const h = S.history[i];
    if (h.pass && others.includes(h.p) && h.vs && !sameTeam(h.p, h.vs.p, S.landlord) && !isBombType(h.vs.move)) cons.push(h);
  }
  return rng => {
    let best = null, bestV = Infinity;
    for (let t = 0; t < 10; t++) {
      Hub.shuffle(pool, rng);
      const hands = [null, null, null];
      hands[S.me] = S.cnt.slice();
      let k = 0;
      others.forEach((o, i) => {
        const h = fixed[o].slice();
        for (let j = 0; j < need[i]; j++) h[pool[k++]]++;
        hands[o] = h;
      });
      let viol = 0;
      for (const h of cons) {
        const m = h.vs.move;
        if (genType(hands[h.p], m.type, m.len, m.rank, 'min').length) viol++;
      }
      if (viol < bestV) { bestV = viol; best = hands; }
      if (viol === 0) break;
    }
    return best;
  };
}
// 从当前局面（cnts 为三家手牌计数）用快速策略模拟到终局，返回赢家座位
let SIM_POLICY = 'hard';
function setSimPolicy(p) { SIM_POLICY = p; }
function simulate(cnts, landlord, turn, last, passes, rng, first, firstSet) {
  let p = turn, mv = first, haveFirst = firstSet;
  for (let step = 0; step < 400; step++) {
    if (!haveFirst) {
      const counts = [cntTotal(cnts[0]), cntTotal(cnts[1]), cntTotal(cnts[2])];
      const S = { me: p, landlord, cnt: cnts[p], counts, last, passes, rng };
      if (SIM_POLICY === 'hard') {
        // 模拟里的“已出牌” = 整副牌 − 三家手牌
        const pc = fullDeckCnt();
        for (let i = 0; i < 3; i++) for (let v = 3; v <= 17; v++) pc[v] -= cnts[i][v];
        S.playedCnt = pc;
        mv = hardDecide(S);
      } else mv = normalDecide(S);
    }
    haveFirst = false;
    if (mv) {
      for (const v of mv.vals) cnts[p][v]--;
      if (cntTotal(cnts[p]) === 0) return p;
      last = { p, move: mv }; passes = 0;
    } else {
      passes++;
      if (passes >= 2) { last = null; passes = 0; }
    }
    p = (p + 1) % 3;
  }
  return -1;
}
function masterCandidates(S, hardMove) {
  const cnt = S.cnt;
  const sp = splitHand(cnt);
  let list;
  if (S.last) {
    const beats = genBeats(cnt, S.last.move, 'min');
    let nb = beats.filter(m => !isBombType(m));
    if (nb.length > 7) {
      nb = evalOptions(cnt, sp, nb).sort((a, b) => (a.delta - b.delta) || (a.m.rank - b.m.rank)).slice(0, 7).map(x => x.m);
    }
    const bombs = beats.filter(isBombType).sort((a, b) => a.rank - b.rank);
    list = nb.concat(bombs.slice(0, 1), bombs.filter(m => m.type === 'rocket'));
    list.push(null);
  } else {
    const g = leadGroups(sp);
    list = g.normal.concat(g.bombs);
    const extra = evalOptions(cnt, sp, genLeads(cnt, 'min').filter(m => !isBombType(m)))
      .sort((a, b) => (a.delta - b.delta) || (a.m.rank - b.m.rank)).slice(0, 6).map(x => x.m);
    list = list.concat(extra);
    // 单张从小到大、从大到小各一张（残局里常常有用）
    const singles = genType(cnt, 'single', 1, 0, 'min');
    if (singles.length) list.push(singles[0], singles[singles.length - 1]);
  }
  if (hardMove !== undefined) list.unshift(hardMove);
  const seen = new Set(), out = [];
  for (const m of list) { const k = moveKey(m); if (!seen.has(k)) { seen.add(k); out.push(m); } }
  return out.slice(0, 12);
}
function masterDecide(S) {
  const hardMove = hardDecide(S);
  const R = roleInfo(S);
  const myN = cntTotal(S.cnt);
  const total = S.counts[0] + S.counts[1] + S.counts[2];
  const minOpp = Math.min(...R.opps.map(o => S.counts[o]));
  if (!(myN <= MASTER_CFG.myN || total <= MASTER_CFG.total || minOpp <= MASTER_CFG.minOpp)) return hardMove;
  if (S.last && !genBeats(S.cnt, S.last.move, 'min').length) return null;
  const cands = masterCandidates(S, hardMove);
  if (cands.length <= 1) return hardMove;
  const budget = S.budget != null ? S.budget : 380;
  const rng = S.rng;
  const sampler = makeSampler(S);
  const n = cands.length;
  const wins = new Array(n).fill(0), tries = new Array(n).fill(0);
  let alive = cands.map((_, i) => i);
  const t0 = nowMs();
  let iter = 0;
  const myLL = S.me === S.landlord;
  while (iter < MASTER_CFG.maxIter) {
    // 同一个采样世界里比较所有候选（公共随机数，减小方差）
    const world = sampler(rng);
    for (const i of alive) {
      const cnts = world.map(c => c.slice());
      const w = simulate(cnts, S.landlord, S.me, S.last, S.passes || 0, rng, cands[i], true);
      tries[i]++;
      if (w >= 0 && ((w === S.landlord) === myLL)) wins[i]++;
    }
    iter++;
    // 逐步淘汰明显更差的候选，把时间留给有希望的
    if (iter % 6 === 0 && alive.length > 2) {
      const rate = i => wins[i] / tries[i];
      const best = Math.max(...alive.map(rate));
      alive = alive.filter(i => i === 0 || rate(i) >= best - 0.25);
    }
    if (iter >= 4 && nowMs() - t0 > budget) break;
  }
  MASTER_STATS.n++; MASTER_STATS.iter += iter; MASTER_STATS.cands += n; MASTER_STATS.ms += nowMs() - t0;
  // 只有明显优于困难策略的选择时才改变主意（避免被统计噪声带偏）
  const rate = i => wins[i] / tries[i];
  let bi = 0;
  for (const i of alive) if (rate(i) > rate(bi)) bi = i;
  if (bi !== 0) {
    const margin = rate(bi) - rate(0);
    if (margin < Math.max(0.06, 1.2 / Math.sqrt(tries[bi]) * 0.5)) bi = 0;
  }
  if (bi !== 0) MASTER_STATS.changed++;
  return cands[bi];
}
const MASTER_STATS = { n: 0, iter: 0, cands: 0, ms: 0, changed: 0 };
// 大师搜索的触发条件与迭代上限（自己 ≤ myN 张 / 三家合计 ≤ total / 对手 ≤ minOpp 张时搜索）。
// 自对弈表明全程搜索比只在残局搜索更强（耗时由 budget 控制），所以默认全程开启。
const MASTER_CFG = { myN: 20, total: 54, minOpp: 20, maxIter: 400 };

/* ---------------- 叫分 ---------------- */
function bidStrength(cnt) {
  let s = cnt[V_BJ] * 4 + cnt[V_SJ] * 3 + cnt[V_2] * 2 + cnt[V_A] * 0.5;
  for (let v = 3; v <= V_2; v++) if (cnt[v] === 4) s += 4;
  if (cnt[V_SJ] && cnt[V_BJ]) s += 2;
  const sp = splitHand(cnt);
  s += (7 - sp.hands) * 0.8;
  return s;
}
// 用模拟估计“我当地主”的胜率（大师叫分用）
function landlordWinRate(cnt, rng, budget) {
  const U = fullDeckCnt();
  for (let v = 3; v <= 17; v++) U[v] -= cnt[v];
  const pool = cntToVals(U);
  let n = 0, w = 0;
  const t0 = nowMs();
  while (n < 120) {
    Hub.shuffle(pool, rng);
    const me = cnt.slice();
    for (let i = 0; i < 3; i++) me[pool[i]]++;
    const a = emptyCnt(), b = emptyCnt();
    for (let i = 3; i < 20; i++) a[pool[i]]++;
    for (let i = 20; i < 37; i++) b[pool[i]]++;
    const win = simulate([me, a, b], 0, 0, null, 0, rng, null, false);
    n++;
    if (win === 0) w++;
    if (n >= 6 && nowMs() - t0 > budget) break;
  }
  return w / n;
}
// S: { cnt, cur(当前最高叫分), diff, rng, budget }
function aiBid(S) {
  const cur = S.cur || 0, rng = S.rng || Math.random;
  let want;
  if (S.diff === 0) {
    if (rng() < 0.45) return 0;
    want = 1 + Math.floor(rng() * 3);
  } else if (S.diff === 3) {
    const p = landlordWinRate(S.cnt, rng, S.budget != null ? S.budget : 350);
    const s = bidStrength(S.cnt);
    S.estimate = p;
    want = p >= 0.6 ? 3 : p >= 0.5 ? 2 : p >= 0.42 ? 1 : 0;
    if (want === 0 && s >= 9) want = 1;
  } else {
    const s = bidStrength(S.cnt) + (S.diff === 2 ? 0.3 : 0);
    want = s >= 10 ? 3 : s >= 8 ? 2 : s >= 6 ? 1 : 0;
  }
  return want > cur ? want : 0;
}

/* ---------------- AI 出牌入口 ---------------- */
function aiDecide(S) {
  switch (S.diff) {
    case 0: return easyDecide(S);
    case 1: return normalDecide(S);
    case 2: return hardDecide(S);
    default: return masterDecide(S);
  }
}
// 把 move 的点数换成手里具体的牌
function moveToCards(hand, move) {
  if (!move) return [];
  const used = new Set(), out = [];
  for (const v of move.vals) {
    const c = hand.find(h => !used.has(h.id) && cardVal(h) === v);
    if (!c) throw new Error('move not in hand');
    used.add(c.id); out.push(c);
  }
  return out;
}
function aiTurn(G, p, diff, rng, budget) {
  const S = situation(G, p, diff, rng, budget);
  const move = aiDecide(S);
  return { move, cards: moveToCards(G.hands[p], move) };
}

/* ---------------- 提示（给玩家用） ---------------- */
function hintMoves(cnt, last) {
  if (!last) {
    const g = leadGroups(splitHand(cnt));
    const list = g.normal.concat(g.bombs);
    const seen = new Set(list.map(moveKey));
    for (const m of genLeads(cnt, 'min')) if (!seen.has(moveKey(m)) && (m.type === 'single' || m.type === 'pair')) { seen.add(moveKey(m)); list.push(m); }
    return list;
  }
  const beats = genBeats(cnt, last, 'min');
  const nb = beats.filter(m => !isBombType(m)).sort((a, b) => a.rank - b.rank);
  const bombs = beats.filter(isBombType).sort((a, b) => a.rank - b.rank);
  return nb.concat(bombs);
}

/* ---------------- 无头整局（测试 / 自对弈） ----------------
   opts: { rng, diffs:[3], firstBidder, forceLandlord(座位或 -1), budget, check(G) } */
function playHeadless(opts) {
  const rng = opts.rng || Math.random;
  const diffs = opts.diffs;
  let G, redeals = 0;
  const first = opts.firstBidder || 0;
  for (;;) {
    G = createRound({ rng, firstBidder: first });
    if (opts.forceLandlord != null && opts.forceLandlord >= 0) { setLandlord(G, opts.forceLandlord, opts.forceBid || 3); break; }
    let r = 'next';
    while (r === 'next') {
      const p = G.bidTurn;
      const b = aiBid({ cnt: countVals(G.hands[p].map(cardVal)), cur: G.bid, diff: diffs[p], rng, budget: opts.bidBudget != null ? opts.bidBudget : opts.budget });
      r = applyBid(G, p, b);
    }
    if (r === 'done') break;
    if (redeals >= 3) { setLandlord(G, first, 1); break; }
    redeals++;
  }
  let steps = 0;
  while (G.phase === 'play') {
    const p = G.turn;
    const { move, cards } = aiTurn(G, p, diffs[p], rng, opts.budget);
    applyPlay(G, p, cards, move);
    if (opts.check) opts.check(G);
    if (++steps > 600) throw new Error('too many steps');
  }
  return { G, res: settle(G, 1), redeals, steps };
}

/* ============================================================
   UI（仅浏览器）
   ============================================================ */
if (typeof document !== 'undefined') {
  /* ---------- 角色 ---------- */
  const CHARACTERS = [
    { name: '老王', emoji: '🧓', style: '稳重老练，不见兔子不撒鹰', lines: {
      landlord: ['这地主我来当，稳着点打。', '牌还行，我叫了。'],
      pass: ['不要，你们先走。', '要不起，等等看。', '不急。'],
      bomb: ['老将出马，炸！', '该出手时就出手。'],
      win: ['稳扎稳打，赢了。', '姜还是老的辣。'],
      lose: ['唉，这把牌没打好。', '胜败乃兵家常事。'],
      warn: ['我只剩这点牌了，注意了啊。'],
      mate: ['好队友，你先走。', '配合得不错。'],
      big: ['这张够大吧？'] } },
    { name: '小美', emoji: '👩‍🦰', style: '活泼好动，嘴上从不吃亏', lines: {
      landlord: ['地主是我的啦～', '嘿嘿，这把我包了！'],
      pass: ['哎呀要不起～', '你厉害，让你一次！', '过过过～'],
      bomb: ['炸弹来咯！💥', '嘭——惊不惊喜？'],
      win: ['耶！赢啦～', '我就说我运气好吧！'],
      lose: ['呜呜，下把一定赢回来！', '不玩了不玩了…才怪！'],
      warn: ['我快出完啦，小心哦～'],
      mate: ['队友给力！冲鸭！', '交给你啦～'],
      big: ['看我的！'] } },
    { name: '阿强', emoji: '🤠', style: '嚣张跋扈，最爱扔炸弹', lines: {
      landlord: ['地主？舍我其谁！', '这牌，闭着眼都能赢。'],
      pass: ['让你一手，别得意。', '哼，先让你出。'],
      bomb: ['炸你没商量！', '吃我一炸！'],
      win: ['早说了，我最强！', '就这？'],
      lose: ['运气而已，下把见！', '这不可能……'],
      warn: ['准备好认输吧！'],
      mate: ['跟着我混，有肉吃！'],
      big: ['压死你！'] } },
  ];
  const HUMAN = { name: '你', emoji: '😎' };

  const RULES = `
    <p><b>人数与发牌：</b>54 张牌，3 人各 17 张，留 3 张底牌。你坐下方，右边是你的下家，左边是上家，出牌顺序 你 → 右 → 左。</p>
    <p><b>叫分：</b>从首叫者开始每人一次机会，可叫比当前更高的 1/2/3 分或不叫；叫 3 分立即成为地主，否则一轮后叫分最高者当地主。都不叫则重新发牌（重发 3 次后由首叫者 1 分当地主）。地主拿走 3 张底牌（亮给所有人看）并先出牌。</p>
    <p><b>大小：</b>3 &lt; 4 &lt; … &lt; K &lt; A &lt; 2 &lt; 小王 &lt; 大王。2 和王不能进顺子 / 连对 / 飞机。</p>
    <p><b>牌型：</b>单张、对子、三张、三带一、三带一对、顺子（≥5 张，最大到 A）、连对（≥3 对）、飞机（≥2 个连续三张）、飞机带翅膀（每个三张带 1 张单或 1 对）、四带二（两张单或两对）、炸弹、王炸。翅膀不能与飞机主体同点数，王炸不能当翅膀。</p>
    <p><b>压牌：</b>必须同牌型、同张数且更大；炸弹可压任何非炸弹，大炸弹压小炸弹，王炸最大。两家都“不出”后，最后出牌的人重新自由出牌（自由出牌时不能不出）。</p>
    <p><b>计分：</b>倍数 = 叫分 × 2^(炸弹数+王炸数) × 春天/反春(×2)。地主赢：地主 +2×底分×倍数，农民各 −底分×倍数；农民赢则相反。<b>春天</b>：地主出完而两个农民一张没出；<b>反春</b>：地主只出过一手牌就被农民走完。</p>
    <p><b>记牌器：</b>显示除你手牌外每个点数还剩几张没出（简单 / 普通 / 困难可开关，大师难度不提供）。</p>
    <p><b>快捷键：</b>Enter / 空格 出牌，P 不出，H 提示（循环给出能压过的方案，从小到大），Esc 重选；叫分时按 0~3。点选或按住拖选手牌，右键清空选择。</p>
    <p><b>对手难度：</b>🌱 简单会乱拆牌、该压不压、不认队友、乱扔炸弹；⚔️ 普通按最少手数拆牌、不压队友、牌少才炸；🔥 困难会记牌判断“绝对大牌”、算能否一路出完、农民顶牌送牌配合、看报单封牌；👑 大师在困难基础上对未知牌做多次抽样（利用“不要”的信息）、残局模拟出平均胜率最高的出法，叫分也靠模拟估算。</p>`;

  const ctx = Hub.init({ game: 'doudizhu', defaults: { rounds: 6, target: 1, base: 1, forceLandlord: false }, rules: RULES });
  const P = ctx.params;
  const DIFF = ctx.diffIndex;
  const chars = Hub.shuffle(CHARACTERS.slice()).slice(0, 2);
  const st = {
    G: null, round: 0, rounds: Math.max(1, Math.floor(P.rounds) || 6), base: Math.max(1, +P.base || 1),
    target: +P.target || 0,
    totals: [0, 0, 0], wins: 0, landlordWins: 0, springs: 0,
    players: [HUMAN, chars[0], chars[1]],
    sel: new Set(), hints: [], hintIdx: 0, newIds: new Set(),
    acting: -1, lastAct: [null, null, null], mode: 'idle',
    humanResolve: null, reveal: false, dealAnim: false, actSig: '', resultResolve: null,
    showCounter: true,
  };
  try { st.showCounter = localStorage.getItem('ddz.counter') !== '0'; } catch (e) { /* 忽略 */ }
  const $ = id => document.getElementById(id);
  const fmt = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);
  const pname = p => st.players[p].name;
  const say = (p, kind, prob) => {
    if (p === 0 || Math.random() > (prob == null ? 1 : prob)) return;
    const lines = st.players[p].lines[kind];
    if (lines) Hub.bubble($('seat-' + p), Hub.randPick(lines), undefined, pname(p));
  };
  /* ---------- 配音：报牌 ---------- */
  const natR = v => (v <= 13 ? v : v === 14 ? 1 : v === 15 ? 2 : v === 16 ? 14 : 15);   // 比较值 → 牌面点数
  const COMBO_CALL = { triple1: 'sandaiyi', triple2: 'sandaidui', straight: 'shunzi', pairs: 'liandui',
    plane: 'feiji', plane1: 'feiji', plane2: 'feiji', four2: 'sidaier', four22: 'sidaier', bomb: 'zhadan', rocket: 'wangzha' };
  function callPlay(p, move, following) {
    const who = pname(p);
    if (move.type === 'single') return Hub.call(who, 's' + natR(move.rank));
    if (move.type === 'pair') return Hub.call(who, 'p' + natR(move.rank));
    if (move.type === 'triple') return Hub.call(who, 't' + natR(move.rank));
    // 跟牌压住别人的组合时，有时喊“大你！”
    if (following && move.type !== 'bomb' && move.type !== 'rocket' && Math.random() < 0.35)
      return Hub.call(who, Hub.randPick(['beat1', 'beat2', 'beat3']));
    return Hub.call(who, COMBO_CALL[move.type] || 'shunzi');
  }

  /* ---------- 尺寸 ---------- */
  let handCw = 80;
  function layout() {
    const h = window.innerHeight - 52, w = window.innerWidth;
    handCw = Math.round(Math.max(50, Math.min(86, h * 0.079, w / 15)));
    const root = $('ddz');
    root.style.setProperty('--hand-cw', handCw + 'px');
    root.style.setProperty('--zw', Math.round(Math.max(40, Math.min(62, handCw * 0.74))) + 'px');
    root.style.setProperty('--bw', Math.round(Math.max(36, Math.min(56, handCw * 0.66))) + 'px');
  }

  /* ---------- 渲染 ---------- */
  const COUNTER_ORDER = [17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3];
  function sortPlayed(cards) {
    const cnt = countVals(cards.map(cardVal));
    return cards.slice().sort((a, b) => (cnt[cardVal(b)] - cnt[cardVal(a)]) || (cardVal(b) - cardVal(a)) || (a.s - b.s));
  }
  function statusOf(p) {
    const G = st.G;
    if (st.acting === p) {
      const bidding = G && G.phase === 'bid';
      return { kind: 'acting', text: p === 0 ? (bidding ? '请叫分' : '请出牌') : (bidding ? '叫分中…' : '思考中…') };
    }
    if (G && G.phase === 'over' && G.winner === p) return { kind: 'good', text: '🏆 出完了' };
    const la = st.lastAct[p];
    if (!la) return { kind: '', text: '' };
    if (la.kind === 'bid') return la.bid ? { kind: 'info', text: `叫 ${la.bid} 分` } : { kind: 'pass', text: '不叫' };
    if (la.kind === 'pass') return { kind: 'pass', text: '不出' };
    return { kind: isBombType(la.move) ? 'hot' : 'good', text: TYPE_NAME[la.move.type] };
  }
  function seatHTML(p) {
    const G = st.G, pl = st.players[p];
    const n = G ? G.hands[p].length : 0;
    const L = G ? G.landlord : -1;
    const role = L < 0 ? '<span class="tag dim">待定</span>'
      : L === p ? '<span class="tag gold">👲 地主</span>' : '<span class="tag blue">🧑‍🌾 农民</span>';
    const warn = G && G.phase === 'play' && n > 0 && n <= 2 ? `<div class="warn">⚠ ${n === 1 ? '报单' : '报双'}！</div>` : '';
    const s = statusOf(p);
    if (p === 0) {
      return `<div class="avatar">${pl.emoji}</div><div class="me-info"><div class="name">${pl.name} ${role}</div>
        <div class="sub">剩 <b>${n}</b> 张 · 积分 ${fmt(st.totals[0])}</div></div>${warn}
        <div class="hub-status" data-kind="${s.kind}">${s.text}</div>`;
    }
    return `<div class="avatar">${pl.emoji}${L === p ? '<span class="hat">👲</span>' : ''}</div>
      <div class="name">${pl.name}</div>
      <div class="role">${role}</div>
      <div class="count"><span class="mini-back"></span><b>${n}</b> 张</div>
      ${warn}
      <div class="sub">积分 ${fmt(st.totals[p])}</div>
      <div class="hub-status" data-kind="${s.kind}">${s.text}</div>`;
  }
  function renderSeats() {
    for (let p = 0; p < 3; p++) {
      const el = $('seat-' + p);
      const html = seatHTML(p);
      if (el._html !== html) { el.innerHTML = html; el._html = html; }
      el.classList.toggle('acting', st.acting === p);
      el.classList.toggle('landlord', !!st.G && st.G.landlord === p);
    }
  }
  function renderZones() {
    const G = st.G;
    for (let p = 0; p < 3; p++) {
      const el = $('zone-' + p);
      let html = '', cls = 'zone' + (p === 0 ? ' me' : '');
      const la = st.lastAct[p];
      if (st.reveal && p !== 0 && G.hands[p].length) {
        html = `<div class="zone-label">剩余手牌</div><div class="zone-cards">${G.hands[p].map(c => Hub.cardHTML(c)).join('')}</div>`;
      } else if (la && la.kind === 'play') {
        html = `<div class="zone-cards">${sortPlayed(la.cards).map(c => Hub.cardHTML(c)).join('')}</div>`;
        const isTarget = G && G.last && G.last.p === p && G.last.cards === la.cards && G.phase === 'play';
        cls += isTarget ? ' target' : (G && G.phase === 'play' ? ' stale' : '');
      } else if (la && la.kind === 'pass') {
        html = '<div class="zone-text pass">不出</div>';
      } else if (la && la.kind === 'bid') {
        html = `<div class="zone-text ${la.bid ? 'bid' : 'pass'}">${la.bid ? `叫 ${la.bid} 分` : '不叫'}</div>`;
      }
      if (st.acting === p && la) cls += ' dim';
      if (el._html !== html) { el.innerHTML = html; el._html = html; }
      el.className = cls;
      // 出牌区宽度有限：按张数自适应重叠
      const cards = el.querySelector('.zone-cards');
      if (cards) {
        const nc = cards.children.length, zw = Math.round(Math.max(40, Math.min(62, handCw * 0.74)));
        const step = nc > 1 ? Math.max(zw * 0.22, Math.min(zw * 0.5, (el.clientWidth - zw - 4) / (nc - 1))) : zw;
        cards.style.setProperty('--zov', (zw - step).toFixed(1) + 'px');
      }
    }
  }
  function renderHand() {
    const el = $('hand');
    const G = st.G;
    const hand = G ? G.hands[0] : [];
    for (const id of [...st.sel]) if (!hand.some(c => c.id === id)) st.sel.delete(id);
    const n = hand.length;
    const avail = Math.max(200, el.clientWidth - 24);
    const step = n > 1 ? Math.min(handCw * 0.66, (avail - handCw) / (n - 1)) : handCw;
    el.style.setProperty('--overlap', Math.max(0, handCw - step).toFixed(1) + 'px');
    el.classList.toggle('locked', !(G && G.phase === 'play'));
    const ids = hand.map(c => c.id).join(',');
    if (!st.dealAnim && el._ids === ids) {
      // 牌没变：只切换选中/高亮，避免整手牌重绘闪烁
      for (const ch of el.children) {
        ch.classList.toggle('sel', st.sel.has(ch.dataset.id));
        ch.classList.toggle('hl', st.newIds.has(ch.dataset.id));
      }
      return;
    }
    el._ids = ids;
    el.classList.toggle('noanim', !st.dealAnim);
    el.innerHTML = hand.map(c => Hub.cardHTML(c, { sel: st.sel.has(c.id), hl: st.newIds.has(c.id) })).join('');
    if (st.dealAnim) Array.from(el.children).forEach((c, i) => { c.style.animationDelay = (i * 35) + 'ms'; c.style.animationFillMode = 'backwards'; });
  }
  function renderTop() {
    const G = st.G;
    // 底牌
    const bEl = $('bottom-cards');
    const showBottom = G && G.landlord >= 0;
    const bh = G ? G.bottom.map(c => Hub.cardHTML(c, { back: !showBottom })).join('') : '';
    if (bEl._html !== bh) { bEl.innerHTML = bh; bEl._html = bh; }
    // 倍数信息
    const mult = G && G.bid ? G.bid * Math.pow(2, G.bombs + G.rockets) : 0;
    $('info-box').innerHTML = `<div>叫分 <b>${G && G.bid ? G.bid : '—'}</b> · 底分 ${st.base}</div>
      <div>倍数 <b class="big">${mult ? '×' + mult : '—'}</b></div>
      <div>💣 炸弹 ${G ? G.bombs : 0} · 🚀 王炸 ${G ? G.rockets : 0}</div>`;
    // 记牌器
    const cEl = $('counter');
    let ch;
    if (DIFF === 3) ch = '<div class="counter-off">👑 大师难度不提供记牌器</div>';
    else if (!st.showCounter) ch = '<div class="counter-off">记牌器已关闭</div>';
    else {
      const full = fullDeckCnt();
      const mine = G ? countVals(G.hands[0].map(cardVal)) : emptyCnt();
      const played = G ? countVals(G.played.map(cardVal)) : emptyCnt();
      ch = COUNTER_ORDER.map(v => {
        const n = full[v] - mine[v] - played[v];
        const lab = v === 17 ? '大王' : v === 16 ? '小王' : VAL_LABEL[v];
        return `<div class="cc${n === 0 ? ' zero' : ''}${n === 4 ? ' full' : ''}${v >= 16 ? ' jk' : ''}"><span>${lab}</span><b>${n}</b></div>`;
      }).join('');
    }
    if (cEl._html !== ch) { cEl.innerHTML = ch; cEl._html = ch; }
    Hub.setInfo(`第 <b>${Math.max(1, st.round)}</b>/${st.rounds} 局 · 积分 <b>${fmt(st.totals[0])}</b>${mult ? ` · 倍数 ×${mult}` : ''}`);
  }
  function renderActions() {
    const G = st.G;
    const el = $('actions');
    const myTurn = st.acting === 0;
    const sig = [st.mode, st.acting, G ? G.bid : 0, G && G.last ? 1 : 0, st.hints.length].join('|');
    if (sig !== st.actSig) {
      st.actSig = sig;
      if (myTurn && st.mode === 'bid') {
        let h = '<button class="hub-btn gray" data-bid="0">不叫 <kbd>0</kbd></button>';
        for (let b = 1; b <= 3; b++) if (b > G.bid) h += `<button class="hub-btn ${b === 3 ? 'orange' : 'blue'}" data-bid="${b}">${b} 分 <kbd>${b}</kbd></button>`;
        el.innerHTML = h;
      } else if (myTurn && st.mode === 'play') {
        el.innerHTML = `<button class="hub-btn gray" data-act="pass"${G.last ? '' : ' disabled'}>不出 <kbd>P</kbd></button>
          <button class="hub-btn gray" data-act="clear">重选 <kbd>Esc</kbd></button>
          <button class="hub-btn blue" data-act="hint">提示 <kbd>H</kbd></button>
          <button class="hub-btn gold" data-act="play">出牌 <kbd>Enter</kbd></button>`;
      } else if (st.acting > 0) {
        el.innerHTML = `<div class="waiting">等待 ${st.players[st.acting].emoji} ${pname(st.acting)} ${G && G.phase === 'bid' ? '叫分' : '出牌'}…</div>`;
      } else el.innerHTML = '';
    }
    renderHintLine();
  }
  function renderHintLine() {
    const G = st.G;
    const el = $('hint-line');
    let h = '';
    if (st.acting === 0 && st.mode === 'bid') h = `当前最高：<b>${G.bid ? G.bid + ' 分' : '无人叫分'}</b>`;
    else if (st.acting === 0 && st.mode === 'play') {
      const selCards = G.hands[0].filter(c => st.sel.has(c.id));
      if (selCards.length) {
        const r = resolvePlay(selCards.map(cardVal), G.last ? G.last.move : null);
        h = r.err ? `<span class="bad">已选 ${selCards.length} 张：${r.msg}</span>` : `<span class="ok">已选：${moveName(r.move)} ✓</span>`;
      } else if (G.last) {
        h = `压过 ${pname(G.last.p)} 的 <b>${moveName(G.last.move)}</b>` + (st.hints.length ? '' : '<br><span class="bad">没有能压过的牌，按 P 不出</span>');
      } else h = '<b>自由出牌</b>：任意合法牌型';
    }
    if (el._html !== h) { el.innerHTML = h; el._html = h; }
    const playBtn = document.querySelector('#actions [data-act="play"]');
    if (playBtn) playBtn.classList.toggle('pulse', st.sel.size > 0);
    const passBtn = document.querySelector('#actions [data-act="pass"]');
    if (passBtn) passBtn.classList.toggle('pulse', !!G.last && !st.hints.length);
  }
  function render() {
    renderSeats();
    renderZones();
    renderTop();
    renderActions();
    renderHand();
  }

  /* ---------- 玩家操作 ---------- */
  function humanBid() {
    return new Promise(resolve => { st.mode = 'bid'; st.humanResolve = resolve; render(); });
  }
  function humanPlay() {
    return new Promise(resolve => {
      const G = st.G;
      st.mode = 'play';
      st.hints = hintMoves(countVals(G.hands[0].map(cardVal)), G.last ? G.last.move : null);
      st.hintIdx = 0;
      st.humanResolve = resolve;
      render();
    });
  }
  function onBid(b) {
    const G = st.G;
    if (st.mode !== 'bid' || !st.humanResolve || (b !== 0 && b <= G.bid) || b > 3) return;
    const r = st.humanResolve; st.humanResolve = null; st.mode = 'idle';
    Hub.sfx('click');
    r(b);
  }
  function onPlay() {
    const G = st.G;
    if (st.mode !== 'play' || !st.humanResolve) return;
    const cards = G.hands[0].filter(c => st.sel.has(c.id));
    if (!cards.length) { Hub.toast(G.last ? '请先选牌，或按 P 不出' : '请先选择要出的牌'); Hub.sfx('error'); return; }
    const r = resolvePlay(cards.map(cardVal), G.last ? G.last.move : null);
    if (r.err) { Hub.toast(r.msg); Hub.sfx('error'); return; }
    const res = applyPlay(G, 0, cards, r.move);
    st.sel.clear(); st.newIds.clear();
    const fn = st.humanResolve; st.humanResolve = null; st.mode = 'idle';
    fn(Object.assign(res, { cards }));
  }
  function onPass() {
    const G = st.G;
    if (st.mode !== 'play' || !st.humanResolve) return;
    if (!G.last) { Hub.toast('自由出牌时不能不出'); Hub.sfx('error'); return; }
    const res = applyPlay(G, 0, []);
    st.sel.clear();
    const fn = st.humanResolve; st.humanResolve = null; st.mode = 'idle';
    fn(res);
  }
  function onHint() {
    if (st.mode !== 'play' || !st.humanResolve) return;
    if (!st.hints.length) { Hub.toast('没有能压过的牌'); Hub.sfx('error'); return; }
    const m = st.hints[st.hintIdx % st.hints.length];
    st.hintIdx++;
    st.sel = new Set(moveToCards(st.G.hands[0], m).map(c => c.id));
    Hub.sfx('select');
    renderHand(); renderHintLine();
  }
  function onClear() { st.sel.clear(); renderHand(); renderHintLine(); }

  /* ---------- 一局流程 ---------- */
  async function aiPlay(p) {
    const G = st.G;
    await Hub.wait(180);
    const t0 = nowMs();
    const { move, cards } = aiTurn(G, p, DIFF, Math.random, 380);
    const spent = nowMs() - t0;
    await Hub.wait(Math.max(120, 520 + Math.random() * 250 - spent));
    const res = applyPlay(G, p, cards, move);
    return Object.assign(res, { cards });
  }
  function afterAction(p, res) {
    const G = st.G;
    if (res.pass) {
      st.lastAct[p] = { kind: 'pass' };
      Hub.sfx('pass');
      Hub.call(pname(p), Hub.randPick(['pass1', 'pass2', 'pass3']));
      const prev = G.history[G.history.length - 1];
      if (prev && prev.vs && G.landlord !== p && prev.vs.p !== G.landlord && prev.vs.p !== p) say(p, 'mate', 0.15);
      else say(p, 'pass', 0.12);
      return;
    }
    const h = G.history[G.history.length - 1];
    const following = !!(h && h.vs);
    st.lastAct[p] = { kind: 'play', move: res.move, cards: res.cards };
    callPlay(p, res.move, following);
    if (/^plane/.test(res.move.type)) Hub.sfx('plane');
    if (res.move.type === 'rocket') { Hub.sfx('rocket'); Hub.banner(`🚀 ${pname(p)} 打出王炸！倍数翻倍`, 1500); say(p, 'bomb', 0.9); }
    else if (res.move.type === 'bomb') { Hub.sfx('bomb'); Hub.banner(`💣 ${pname(p)} 打出炸弹！倍数翻倍`, 1500); say(p, 'bomb', 0.9); }
    else {
      Hub.sfx('play');
      if (res.move.rank >= V_2 && res.move.type === 'single') say(p, 'big', 0.3);
    }
    const n = G.hands[p].length;
    if (n > 0 && n <= 2) {
      Hub.sfx('tick');
      if (!st.alerted[p] || st.alerted[p] > n) {    // 报单 / 报双：每种只喊一次
        st.alerted[p] = n;
        setTimeout(() => Hub.call(pname(p), 'left' + n), 750);
      }
      Hub.bgmTense(true);
      say(p, 'warn', 0.3);
    }
  }
  async function biddingPhase() {
    const G = st.G;
    for (;;) {
      const p = G.bidTurn;
      st.acting = p;
      render();
      let b;
      if (p === 0) b = await humanBid();
      else {
        await Hub.wait(650 + Math.random() * 200);
        b = aiBid({ cnt: countVals(G.hands[p].map(cardVal)), cur: G.bid, diff: DIFF, rng: Math.random, budget: 300 });
      }
      st.lastAct[p] = { kind: 'bid', bid: b };
      Hub.sfx(b ? 'chip' : 'pass');
      Hub.call(pname(p), 'bid' + b);
      const r = applyBid(G, p, b);
      st.acting = -1;
      render();
      if (r !== 'next') return r;
    }
  }
  async function playRound(firstBidder) {
    let redeals = 0;
    for (;;) {
      st.G = createRound({ firstBidder });
      st.lastAct = [null, null, null];
      st.alerted = [0, 0, 0];
      Hub.bgmTense(false);
      st.reveal = false; st.sel.clear(); st.newIds.clear(); st.acting = -1; st.mode = 'idle';
      st.dealAnim = true;
      render();
      st.dealAnim = false;
      Hub.sfx('shuffle');
      await Hub.wait(900);
      if (P.forceLandlord) {
        setLandlord(st.G, 0, 3);
        Hub.banner('👲 本关你固定当地主（叫 3 分）', 2000);
        break;
      }
      const r = await biddingPhase();
      if (r === 'done') break;
      if (redeals >= 3) {
        setLandlord(st.G, firstBidder, 1);
        Hub.banner(`连续没人叫分，${pname(firstBidder)} 被指定为地主（1 分）`, 2000);
        break;
      }
      redeals++;
      Hub.banner('都不叫，重新发牌 🔄', 1300);
      await Hub.wait(1400);
    }
    const G = st.G;
    const L = G.landlord;
    if (L === 0) st.newIds = new Set(G.bottom.map(c => c.id));
    if (!P.forceLandlord || L !== 0) Hub.banner(`${st.players[L].emoji} ${pname(L)} 成为地主（${G.bid} 分），亮出底牌`, 1800);
    Hub.sfx('chips');
    if (L === 0) Hub.call(pname(0), 'dizhu');
    say(L, 'landlord', 0.8);
    render();
    await Hub.wait(1300);
    // 出牌
    while (G.phase === 'play') {
      const p = G.turn;
      st.acting = p;
      render();
      const res = p === 0 ? await humanPlay() : await aiPlay(p);
      st.acting = -1;
      afterAction(p, res);
      render();
      if (G.phase !== 'play') break;
      await Hub.wait(p === 0 ? 200 : 300);
    }
    await roundOver();
  }
  async function roundOver() {
    const G = st.G;
    const res = settle(G, st.base);
    const L = G.landlord;
    const meWin = (G.winner === L) === (L === 0);
    for (let p = 0; p < 3; p++) st.totals[p] += res.deltas[p];
    if (meWin) st.wins++;
    if (meWin && L === 0) st.landlordWins++;
    if ((L === 0 && res.spring) || (L !== 0 && res.antiSpring)) st.springs++;
    await Hub.wait(500);
    st.reveal = true;
    render();
    Hub.bgmTense(false);
    if (res.spring || res.antiSpring) { Hub.sfx('spring'); Hub.announce(res.spring ? 'chuntian_host' : 'chuntian_host'); }
    else Hub.sfx(meWin ? 'win' : 'lose');
    const tag = res.spring ? '🌸 春天！' : res.antiSpring ? '🌸 反春！' : '';
    Hub.banner(`${meWin ? '🎉 你赢了' : '😞 你输了'} ${fmt(res.deltas[0])} 分 ${tag}`, 1800);
    for (let p = 1; p < 3; p++) {
      const won = (G.winner === L) === (L === p);
      say(p, won ? 'win' : 'lose', won ? 0.6 : 0.4);
    }
    // 结果面板
    const parts = [`叫分 ${res.bid}`];
    if (res.bombs + res.rockets) parts.push(`炸弹 ×${res.bombMul}（${res.bombs ? res.bombs + ' 炸' : ''}${res.bombs && res.rockets ? ' + ' : ''}${res.rockets ? '王炸' : ''}）`);
    else parts.push('炸弹 ×1');
    parts.push(res.spring ? '春天 ×2' : res.antiSpring ? '反春 ×2' : '春天 ×1');
    const last = st.round >= st.rounds;
    const rows = [0, 1, 2].map(p => {
      const pl = st.players[p];
      const d = res.deltas[p];
      return `<div class="rr-row${p === 0 ? ' me' : ''}"><span>${pl.emoji} ${pl.name}</span><span class="role">${p === L ? '👲 地主' : '🧑‍🌾 农民'}</span>
        <span class="d ${d > 0 ? 'up' : 'down'}">${fmt(d)}</span><span class="t">累计 ${fmt(st.totals[p])}</span></div>`;
    }).join('');
    const el = $('round-result');
    el.innerHTML = `<div class="rr-panel">
      <h2>${meWin ? '🎉 本局胜利' : '😞 本局失利'} · ${G.winner === L ? '地主获胜' : '农民获胜'} ${tag}</h2>
      <div class="rr-mult">${parts.join(' × ')} = <b>×${res.mult}</b>${st.base > 1 ? `　底分 ${st.base}` : ''}</div>
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
      stats: { score, rounds: st.rounds, wins: st.wins, landlordWins: st.landlordWins, springs: st.springs },
      lines: [
        `共 <b>${st.rounds}</b> 局，你赢了 <b>${st.wins}</b> 局（当地主赢 ${st.landlordWins} 局）`,
        `总积分：<b>${fmt(score)}</b>（目标 ≥ ${st.target}）`,
        st.springs ? `打出春天 / 反春 ${st.springs} 次 🌸` : '',
        `${st.players[1].emoji} ${pname(1)} ${fmt(st.totals[1])} · ${st.players[2].emoji} ${pname(2)} ${fmt(st.totals[2])}`,
      ].filter(Boolean),
    });
  }

  /* ---------- 初始化 ---------- */
  function bind() {
    Hub.enableHandSelect($('hand'), ids => {
      if (!st.G || st.G.phase !== 'play') return;
      if (!ids) st.sel.clear();
      else for (const id of ids) { if (st.sel.has(id)) st.sel.delete(id); else st.sel.add(id); }
      renderHand(); renderHintLine();
    });
    $('actions').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.blur) b.blur();
      if (b.dataset.bid != null) onBid(+b.dataset.bid);
      else if (b.dataset.act === 'play') onPlay();
      else if (b.dataset.act === 'pass') onPass();
      else if (b.dataset.act === 'hint') onHint();
      else if (b.dataset.act === 'clear') onClear();
    });
    const chk = $('chk-counter');
    if (DIFF === 3) chk.parentElement.style.display = 'none';
    chk.checked = st.showCounter;
    chk.onchange = () => {
      st.showCounter = chk.checked;
      try { localStorage.setItem('ddz.counter', chk.checked ? '1' : '0'); } catch (e) { /* 忽略 */ }
      renderTop();
    };
    document.addEventListener('keydown', e => {
      if (document.querySelector('.hub-overlay.show')) return;
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      const k = e.key;
      if (st.mode === 'result') {
        if (k === 'Enter' || k === ' ') { e.preventDefault(); nextFromResult(); }
        return;
      }
      if (st.mode === 'bid') {
        if (/^[0-3]$/.test(k)) { e.preventDefault(); onBid(+k); }
        return;
      }
      if (st.mode !== 'play') return;
      if (k === 'Enter' || k === ' ') { e.preventDefault(); onPlay(); }
      else if (k === 'p' || k === 'P') { e.preventDefault(); onPass(); }
      else if (k === 'h' || k === 'H') { e.preventDefault(); onHint(); }
      else if (k === 'Escape') { onClear(); }
    });
    window.addEventListener('resize', () => { layout(); renderHand(); });
  }
  function introHTML() {
    const v = st.players.slice(1).map(pl => `<div class="ddz-v"><div class="e">${pl.emoji}</div><div class="n">${pl.name}</div><div class="d">${pl.style}</div></div>`).join('');
    return `<p>你和两位对手斗地主：叫分抢地主，地主一人对抗两个农民。<br>共 <b>${st.rounds}</b> 局，底分 ${st.base}，累计积分。</p>
      <div class="ddz-villains">${v}</div>
      <p style="font-size:14px;color:#9aa3b0">快捷键：Enter/空格 出牌 · P 不出 · H 提示 · Esc 重选 · 叫分 0~3</p>`;
  }
  async function main() {
    layout();
    bind();
    render();
    await Hub.intro({ title: '👲 斗地主', html: introHTML(), button: '开始游戏 🃏' });
    const startSeat = Math.floor(Math.random() * 3);
    for (st.round = 1; st.round <= st.rounds; st.round++) {
      await playRound((startSeat + st.round - 1) % 3);
    }
    finishMatch();
  }
  main();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    cardVal, VAL_LABEL, countVals, cntTotal, cntToVals, sortCards, mulberry32,
    analyze, analyzeAll, canBeat, resolvePlay, moveName, genType, genBeats, genLeads, kickerSets,
    splitHand, leadGroups, createRound, applyBid, setLandlord, applyPlay, settle,
    situation, aiBid, aiDecide, aiTurn, moveToCards, hintMoves, playHeadless, bidStrength,
    easyDecide, normalDecide, hardDecide, masterDecide, landlordWinRate, setSimPolicy, MASTER_STATS, MASTER_CFG,
  };
}
