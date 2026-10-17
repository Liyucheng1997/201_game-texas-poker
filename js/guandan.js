/* ============================================================
   掼蛋 · Guandan
   两副牌 108 张，四人两队（对家为队友）。逢人配（红桃级牌百搭）、
   进贡 / 还贡 / 抗贡、接风、升级、过 A。
   座位：0 你（下） 1 右 2 上（队友） 3 左；出牌顺序 0→1→2→3（逆时针）。
   ============================================================ */
'use strict';
const Hub = (typeof window !== 'undefined' && window.Hub) || require('./common.js');

/* ---------------- 基础工具 ---------------- */
const partnerOf = s => (s + 2) % 4;
const teamOf = s => s % 2;
const oppsOf = s => [(s + 1) % 4, (s + 3) % 4];
const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/* 级数 lv：2..14（14 = A）。点数 nat：2..14（A=14，顺子里 A 也可当 1）。
   单张大小 pw：普通牌 = nat；级牌 = 15；小王 16；大王 17。 */
function levelRank(lv) { return lv === 14 ? 1 : lv; }
function isWild(c, lv) { return c.s === 1 && c.r === levelRank(lv); }
function natOf(c) { return c.s === 4 ? 0 : (c.r === 1 ? 14 : c.r); }
function pwNat(v, lv) { return v === lv ? 15 : v; }
function pwOf(c, lv) { return c.s === 4 ? (c.r === 15 ? 17 : 16) : pwNat(natOf(c), lv); }
function natLabel(v) { return ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' })[v] || String(v); }
function levelName(lv) { return natLabel(lv); }
function pwLabel(p, lv) {
  if (p === 17) return '大王';
  if (p === 16) return '小王';
  if (p === 15) return natLabel(lv);
  return natLabel(p);
}

/* 手牌排序：大的在前；同点数按花色，逢人配排在本组最后 */
function sortHand(hand, lv) {
  return hand.sort((a, b) => (pwOf(b, lv) - pwOf(a, lv)) || ((isWild(a, lv) ? 1 : 0) - (isWild(b, lv) ? 1 : 0)) || (a.s - b.s) || (a.id < b.id ? -1 : 1));
}
function removeCards(hand, cards) {
  const ids = new Set(cards.map(c => c.id));
  return hand.filter(c => !ids.has(c.id));
}

/* ---------------- 牌型 ----------------
   牌型对象：{ type, key, len }（出牌时再带上 cards）
   key：单/对/三/三带二/炸弹 = 主体 pw；顺子/三连对/钢板/同花顺 = 顶张自然点数；天王炸 = 17 */
const TYPE_NAME = {
  single: '单张', pair: '对子', triple: '三张', full: '三带二', straight: '顺子',
  tube: '三连对', plate: '钢板', bomb: '炸弹', sflush: '同花顺', kingbomb: '天王炸',
};
const SEQ_LEN = { straight: 5, tube: 3, plate: 2 };   // 序列的“节数”
function isBombType(t) { return t === 'bomb' || t === 'sflush' || t === 'kingbomb'; }
/* 炸弹大小：4炸 < 5炸 < 同花顺 < 6炸 < 7炸 < … < 10炸 < 天王炸 */
function bombScore(m) {
  if (m.type === 'kingbomb') return 2000;
  if (m.type === 'sflush') return 300 + m.key;
  if (m.len === 4) return 100 + m.key;
  if (m.len === 5) return 200 + m.key;
  return (m.len - 2) * 100 + m.key;
}
/* a 能否压过 b（b 为 null 表示自由出牌） */
function canBeat(a, b) {
  if (!b) return true;
  const ab = isBombType(a.type), bb = isBombType(b.type);
  if (ab && !bb) return true;
  if (!ab && bb) return false;
  if (ab && bb) return bombScore(a) > bombScore(b);
  return a.type === b.type && a.len === b.len && a.key > b.key;
}
/* 用于“从小到大”排序：非炸弹按 key，炸弹排在后面按炸弹大小 */
function moveRank(m) { return isBombType(m.type) ? 1000 + bombScore(m) : m.key; }
function seqPos(t, n) { const a = []; for (let v = t - n + 1; v <= t; v++) a.push(v === 1 ? 14 : v); return a; }
function patternText(m, lv) {
  const n = TYPE_NAME[m.type];
  switch (m.type) {
    case 'single': case 'pair': case 'triple': return `${n} ${pwLabel(m.key, lv)}`;
    case 'full': return `三带二 ${pwLabel(m.key, lv)}`;
    case 'straight': case 'sflush': return `${n} ${natLabel(m.key - 4)}-${natLabel(m.key)}`;
    case 'tube': return `${n} ${natLabel(m.key - 2)}-${natLabel(m.key)}`;
    case 'plate': return `${n} ${natLabel(m.key - 1)}-${natLabel(m.key)}`;
    case 'bomb': return `${m.len}炸 ${pwLabel(m.key, lv)}`;
    case 'kingbomb': return '天王炸';
  }
  return n;
}

/* 识别一组牌的所有可能解释（逢人配可补位）。返回 [{type,key,len}]，去重 */
function analyze(cards, lv) {
  const n = cards.length, res = [];
  if (!n) return res;
  const add = (type, key) => { if (!res.some(r => r.type === type && r.key === key)) res.push({ type, key, len: n }); };
  let w = 0;
  const jokers = [], plain = [];
  for (const c of cards) {
    if (isWild(c, lv)) w++;
    else if (c.s === 4) jokers.push(c);
    else plain.push(c);
  }
  if (jokers.length) {
    if (n === 4 && jokers.length === 4) add('kingbomb', 17);
    else if (n === 1) add('single', pwOf(jokers[0], lv));
    else if (n === 2 && jokers.length === 2 && jokers[0].r === jokers[1].r) add('pair', pwOf(jokers[0], lv));
    return res;     // 王不能参与其他组合，也不能被百搭代替
  }
  // 同点数（单/对/三/炸弹）
  const cnt = new Map();
  for (const c of plain) { const p = pwOf(c, lv); cnt.set(p, (cnt.get(p) || 0) + 1); }
  if (cnt.size <= 1) {
    const p = cnt.size ? cnt.keys().next().value : 15;   // 全是百搭 = 级牌本身
    if (n === 1) add('single', p);
    else if (n === 2) add('pair', p);
    else if (n === 3) add('triple', p);
    else if (n <= 10) add('bomb', p);
  }
  if (n === 5) {
    // 三带二：三张 a + 一对 b（a≠b）
    const ks = [...cnt.keys()];
    if (ks.length === 2) {
      const [x, y] = ks;
      if (cnt.get(x) <= 3 && cnt.get(y) <= 2) add('full', x);
      if (cnt.get(y) <= 3 && cnt.get(x) <= 2) add('full', y);
    } else if (ks.length === 1 && cnt.get(ks[0]) === 3) add('full', ks[0]);   // 两张百搭当对子
    // 顺子 / 同花顺
    const nats = plain.map(natOf);
    const sameSuit = plain.every(c => c.s === plain[0].s);
    for (let t = 5; t <= 14; t++) {
      const pos = seqPos(t, 5);
      const used = [0, 0, 0, 0, 0];
      let ok = true;
      for (const v of nats) {
        const i = pos.indexOf(v);
        if (i < 0 || used[i]) { ok = false; break; }
        used[i] = 1;
      }
      if (ok) { add('straight', t); if (sameSuit) add('sflush', t); }
    }
  }
  if (n === 6) {
    const nats = plain.map(natOf);
    // 三连对
    for (let t = 3; t <= 14; t++) if (fitSeq(nats, seqPos(t, 3), 2)) add('tube', t);
    // 钢板
    for (let t = 2; t <= 14; t++) if (fitSeq(nats, seqPos(t, 2), 3)) add('plate', t);
  }
  return res;
}
function fitSeq(nats, pos, k) {
  const used = new Array(pos.length).fill(0);
  for (const v of nats) {
    const i = pos.indexOf(v);
    if (i < 0 || used[i] >= k) return false;
    used[i]++;
  }
  return true;
}
/* 选择解释：跟牌取能压过的最小解释；自由出牌取最强解释（多个非炸弹牌型时返回 options 供玩家选择） */
function resolvePlay(cards, lv, tableMove) {
  const pats = analyze(cards, lv);
  if (!pats.length) return { err: '不是有效的牌型' };
  if (tableMove) {
    const ok = pats.filter(p => canBeat(p, tableMove)).sort((a, b) => moveRank(a) - moveRank(b));
    if (!ok.length) {
      const same = pats.some(p => p.type === tableMove.type && p.len === tableMove.len);
      return { err: same || isBombType(tableMove.type) ? '压不过桌上的牌' : `牌型不符，需要${TYPE_NAME[tableMove.type]}或炸弹` };
    }
    return { move: Object.assign({}, ok[0], { cards }) };
  }
  const bombs = pats.filter(p => isBombType(p.type)).sort((a, b) => bombScore(b) - bombScore(a));
  if (bombs.length) return { move: Object.assign({}, bombs[0], { cards }) };
  const byType = new Map();
  for (const p of pats) if (!byType.has(p.type) || byType.get(p.type).key < p.key) byType.set(p.type, p);
  const opts = [...byType.values()].map(p => Object.assign({}, p, { cards }));
  if (opts.length === 1) return { move: opts[0] };
  return { options: opts };
}

/* ---------------- 合法出牌生成 ---------------- */
function indexHand(hand, lv) {
  const ix = { lv, wild: [], sj: [], bj: [], byNat: [], bySuit: [] };
  for (let v = 0; v < 15; v++) ix.byNat.push([]);
  for (let s = 0; s < 4; s++) { const a = []; for (let v = 0; v < 15; v++) a.push(0); ix.bySuit.push(a); }
  for (const c of hand) {
    if (isWild(c, lv)) ix.wild.push(c);
    else if (c.s === 4) (c.r === 15 ? ix.bj : ix.sj).push(c);
    else { const v = natOf(c); ix.byNat[v].push(c); ix.bySuit[c.s][v]++; }
  }
  // 同点数里优先拿“对同花顺最没用”的花色
  const use = c => {
    const v = natOf(c); let u = 0;
    for (let d = -2; d <= 2; d++) {
      if (!d) continue;
      let x = v + d; if (x === 1) x = 14;
      if (x >= 2 && x <= 14 && ix.bySuit[c.s][x]) u++;
    }
    return u;
  };
  for (let v = 2; v <= 14; v++) if (ix.byNat[v].length > 1) ix.byNat[v].sort((a, b) => use(a) - use(b));
  return ix;
}
/* 生成所有（能压过 target 的）出法；每种 (牌型, key, 张数) 给出一个具体出法（三带二给出几个带牌选项）。
   出法对象：{ type, key, len, cards, nw(用了几张百搭) } */
function genMoves(hand, lv, target) {
  const ix = indexHand(hand, lv);
  const W = ix.wild.length;
  const out = [];
  const tType = target ? target.type : null;
  const bombOnly = target && isBombType(tType);
  const want = t => !target || (!bombOnly && tType === t);
  const push = (type, key, cards, nw) => {
    const m = { type, key, len: cards.length, cards, nw: nw || 0 };
    if (!target || canBeat(m, target)) out.push(m);
  };
  const grp = (v, k) => {
    const nat = ix.byNat[v];
    if (!nat.length && v !== lv) return null;
    const nn = Math.min(nat.length, k);
    if (k - nn > W) return null;
    return nat.slice(0, nn).concat(ix.wild.slice(0, k - nn));
  };
  if (want('single')) {
    for (let v = 2; v <= 14; v++) if (ix.byNat[v].length) push('single', pwNat(v, lv), [ix.byNat[v][0]]);
    if (W && !ix.byNat[lv].length) push('single', 15, [ix.wild[0]]);
    if (ix.sj.length) push('single', 16, [ix.sj[0]]);
    if (ix.bj.length) push('single', 17, [ix.bj[0]]);
  }
  if (want('pair')) {
    for (let v = 2; v <= 14; v++) { const g = grp(v, 2); if (g) push('pair', pwNat(v, lv), g, Math.max(0, 2 - ix.byNat[v].length)); }
    if (ix.sj.length === 2) push('pair', 16, ix.sj.slice());
    if (ix.bj.length === 2) push('pair', 17, ix.bj.slice());
  }
  if (want('triple')) {
    for (let v = 2; v <= 14; v++) { const g = grp(v, 3); if (g) push('triple', pwNat(v, lv), g, Math.max(0, 3 - ix.byNat[v].length)); }
  }
  if (want('full')) {
    for (let a = 2; a <= 14; a++) {
      const na = ix.byNat[a].length;
      if (!na && a !== lv) continue;
      const wa = Math.max(0, 3 - na);
      if (wa > W) continue;
      // 带的对子：优先正好一对、点数小、不用百搭
      const opts = [];
      for (let b = 2; b <= 14; b++) {
        if (b === a) continue;
        const nb = ix.byNat[b].length;
        if (!nb && !(b === lv && W - wa >= 2)) continue;
        const wb = Math.max(0, 2 - nb);
        if (wa + wb > W) continue;
        const cost = wb * 30 + (nb === 2 ? 0 : nb === 3 ? 12 : nb >= 4 ? 40 : 6) + pwNat(b, lv);
        opts.push({ b, wb, cost });
      }
      opts.sort((x, y) => x.cost - y.cost);
      for (const o of opts.slice(0, 2)) {
        const cards = ix.byNat[a].slice(0, 3 - wa).concat(ix.wild.slice(0, wa))
          .concat(ix.byNat[o.b].slice(0, 2 - o.wb)).concat(ix.wild.slice(wa, wa + o.wb));
        push('full', pwNat(a, lv), cards, wa + o.wb);
      }
    }
  }
  const seq = (type, n, k, tFrom) => {
    for (let t = tFrom; t <= 14; t++) {
      const pos = seqPos(t, n);
      let need = 0;
      for (const v of pos) need += Math.max(0, k - ix.byNat[v].length);
      if (need > W) continue;
      const cards = [];
      let wi = 0;
      for (const v of pos) {
        const nat = ix.byNat[v];
        const nn = Math.min(nat.length, k);
        for (let i = 0; i < nn; i++) cards.push(nat[i]);
        for (let i = nn; i < k; i++) cards.push(ix.wild[wi++]);
      }
      if (type === 'straight') avoidFlush(cards, pos, ix, lv);
      push(type, t, cards, need);
    }
  };
  if (want('straight')) seq('straight', 5, 1, 5);
  if (want('tube')) seq('tube', 3, 2, 3);
  if (want('plate')) seq('plate', 2, 3, 2);
  // 炸弹
  for (let v = 2; v <= 14; v++) {
    const nn = ix.byNat[v].length;
    if (!nn && v !== lv) continue;
    for (let k = 4; k <= Math.min(10, nn + W); k++) push('bomb', pwNat(v, lv), grp(v, k), Math.max(0, k - nn));
  }
  // 同花顺
  for (let s = 0; s < 4; s++) {
    for (let t = 5; t <= 14; t++) {
      const pos = seqPos(t, 5);
      let need = 0;
      for (const v of pos) if (!ix.bySuit[s][v]) need++;
      if (need > W || need >= 3) continue;
      const cards = [];
      let wi = 0;
      for (const v of pos) {
        const c = ix.byNat[v].find(x => x.s === s);
        cards.push(c || ix.wild[wi++]);
      }
      push('sflush', t, cards, need);
    }
  }
  if (ix.sj.length === 2 && ix.bj.length === 2) push('kingbomb', 17, ix.sj.concat(ix.bj));
  return out;
}
/* 顺子尽量不要凑成同花（同花顺是炸弹，别浪费） */
function avoidFlush(cards, pos, ix, lv) {
  const nat = cards.filter(c => !isWild(c, lv));
  if (nat.length < 2 || !nat.every(c => c.s === nat[0].s)) return;
  for (let i = 0; i < cards.length; i++) {
    if (isWild(cards[i], lv)) continue;
    const alt = ix.byNat[pos[i]].find(c => c.s !== cards[i].s);
    if (alt) { cards[i] = alt; return; }
  }
}

/* ---------------- 手牌拆分（求较少手数、保留炸弹） ----------------
   状态：c[2..14] 各点数自然牌张数，w 百搭数，sj/bj 王数。
   价值 = Σ 组合价值 − HP × 非炸弹手数；搜索顺子/三连对/钢板的取法，其余按点数成组，
   百搭优先补炸弹，三张自动带最小的对子。 */
const HP = 9;
const KING_VAL = 32;
function bombVal(n, p) { return 12 + (n - 4) * 4 + (p - 2) * 0.25; }
function sflushVal(t) { return 19 + (t - 5) * 0.15; }
function seqVal(type, t) { return type === 'straight' ? (t - 10) * 0.8 : (t - 10) + 0.5; }
function comboVal(m) {
  switch (m.type) {
    case 'bomb': return bombVal(m.len, m.key);
    case 'sflush': return sflushVal(m.key);
    case 'kingbomb': return KING_VAL;
    case 'straight': case 'tube': case 'plate': return seqVal(m.type, m.key);
    default: return m.key - 10;
  }
}
const SEQ_DEF = [];
for (let t = 5; t <= 14; t++) SEQ_DEF.push({ type: 'straight', t, k: 1, pos: seqPos(t, 5), maxW: 1 });
for (let t = 3; t <= 14; t++) SEQ_DEF.push({ type: 'tube', t, k: 2, pos: seqPos(t, 3), maxW: 2 });
for (let t = 2; t <= 14; t++) SEQ_DEF.push({ type: 'plate', t, k: 3, pos: seqPos(t, 2), maxW: 2 });

let PLAN_CACHE = new Map();
function planKey(c, w, sj, bj, lv) {
  let s = lv + '|' + w + sj + bj;
  for (let v = 2; v <= 14; v++) s += c[v];
  return s;
}
function planV(c, w, sj, bj, lv) {
  const key = planKey(c, w, sj, bj, lv);
  const hit = PLAN_CACHE.get(key);
  if (hit) return hit.v;
  let best = leafVal(c, w, sj, bj, lv, null), opt = -1;
  const taken = [0, 0, 0, 0, 0];
  for (let i = 0; i < SEQ_DEF.length; i++) {
    const d = SEQ_DEF[i];
    let need = 0;
    for (const v of d.pos) if (c[v] < d.k) need += d.k - c[v];
    if (need > w || need > d.maxW) continue;
    for (let j = 0; j < d.pos.length; j++) { const v = d.pos[j]; taken[j] = Math.min(c[v], d.k); c[v] -= taken[j]; }
    const val = seqVal(d.type, d.t) - HP + planV(c, w - need, sj, bj, lv);
    for (let j = 0; j < d.pos.length; j++) c[d.pos[j]] += taken[j];
    if (val > best) { best = val; opt = i; }
  }
  if (PLAN_CACHE.size > 300000) PLAN_CACHE = new Map();
  PLAN_CACHE.set(key, { v: best, o: opt });
  return best;
}
/* 叶子：按点数成组。out 不为空时输出组合（供还原成具体牌） */
function leafVal(c, w, sj, bj, lv, out) {
  const g = [];
  for (let v = 2; v <= 14; v++) if (c[v]) g.push({ v, p: pwNat(v, lv), n: c[v], w: 0 });
  let wl = w;
  while (wl > 0) {
    let tgt = null, use = 1;
    for (const x of g) if (x.n + x.w === 3 && (!tgt || x.p < tgt.p)) tgt = x;          // 三张 → 炸弹
    if (!tgt && wl >= 2) {
      for (const x of g) if (x.n + x.w === 2 && (!tgt || x.p < tgt.p)) tgt = x;        // 对子 + 2 百搭 → 炸弹
      if (tgt) use = 2;
    }
    if (!tgt) for (const x of g) if (x.n + x.w >= 4 && (!tgt || x.n + x.w > tgt.n + tgt.w)) tgt = x;  // 炸弹加长
    if (!tgt) for (const x of g) if (x.n + x.w === 1 && (!tgt || x.p < tgt.p)) tgt = x;  // 单张 → 对子
    if (!tgt) for (const x of g) if (x.n + x.w === 2 && (!tgt || x.p < tgt.p)) tgt = x;  // 对子 → 三张
    if (!tgt) break;
    tgt.w += use; wl -= use;
  }
  if (wl) g.push({ v: lv, p: 15, n: 0, w: wl });
  let total = 0;
  const trips = [], pairs = [];
  for (const x of g) {
    const n = x.n + x.w;
    if (n >= 4) { total += bombVal(n, x.p); if (out) out.push({ type: 'bomb', g: x }); }
    else if (n === 3) trips.push(x);
    else if (n === 2) pairs.push(x);
    else { total += x.p - 10 - HP; if (out) out.push({ type: 'single', g: x }); }
  }
  if (sj + bj === 4) { total += KING_VAL; if (out) out.push({ type: 'kingbomb' }); }
  else {
    if (sj === 2) { total += 6 - HP; if (out) out.push({ type: 'jpair', r: 14 }); }
    else if (sj === 1) { total += 6 - HP; if (out) out.push({ type: 'jsingle', r: 14 }); }
    if (bj === 2) { total += 7 - HP; if (out) out.push({ type: 'jpair', r: 15 }); }
    else if (bj === 1) { total += 7 - HP; if (out) out.push({ type: 'jsingle', r: 15 }); }
  }
  trips.sort((a, b) => a.p - b.p);
  pairs.sort((a, b) => a.p - b.p);
  let pi = 0;
  for (const t of trips) {
    total += t.p - 10 - HP;
    if (pi < pairs.length && pairs[pi].p <= 14) { if (out) out.push({ type: 'full', g: t, g2: pairs[pi] }); pi++; }
    else if (out) out.push({ type: 'triple', g: t });
  }
  for (; pi < pairs.length; pi++) { total += pairs[pi].p - 10 - HP; if (out) out.push({ type: 'pair', g: pairs[pi] }); }
  return total;
}
function countsOf(hand, lv) {
  const c = new Array(15).fill(0);
  const suit = [0, 1, 2, 3].map(() => new Array(15).fill(0));
  let w = 0, sj = 0, bj = 0;
  for (const x of hand) {
    if (isWild(x, lv)) w++;
    else if (x.s === 4) { if (x.r === 15) bj++; else sj++; }
    else { const v = natOf(x); c[v]++; suit[x.s][v]++; }
  }
  return { c, suit, w, sj, bj };
}
/* 同花顺候选（最多用 2 张百搭，至少 3 张自然牌） */
function sflushOpts(C) {
  const res = [];
  for (let s = 0; s < 4; s++) for (let t = 5; t <= 14; t++) {
    const pos = seqPos(t, 5);
    let need = 0;
    for (const v of pos) if (!C.suit[s][v]) need++;
    if (need <= C.w && need <= 2) res.push({ s, t, pos, need });
  }
  return res;
}
function sfNeed(C, o) {
  let need = 0;
  for (const v of o.pos) if (!C.suit[o.s][v]) need++;
  return need;
}
function takeSf(C, o, need) {
  const took = [];
  for (const v of o.pos) if (C.suit[o.s][v] > 0) { C.suit[o.s][v]--; C.c[v]--; took.push(v); }
  C.w -= need;
  return took;
}
function putSf(C, o, need, took) {
  for (const v of took) { C.suit[o.s][v]++; C.c[v]++; }
  C.w += need;
}
/* 求最优拆分：返回 { v, sfs }（sfs 为选用的同花顺） */
function bestSplit(hand, lv) {
  const C = countsOf(hand, lv);
  let best = planV(C.c, C.w, C.sj, C.bj, lv), sfs = [];
  const opts = sflushOpts(C).slice(0, 14);
  for (let i = 0; i < opts.length; i++) {
    const a = opts[i];
    const na = sfNeed(C, a);
    if (na > C.w) continue;
    const ta = takeSf(C, a, na);
    let v = sflushVal(a.t) + planV(C.c, C.w, C.sj, C.bj, lv);
    if (v > best) { best = v; sfs = [a]; }
    for (let j = i + 1; j < opts.length; j++) {
      const b = opts[j];
      const nb = sfNeed(C, b);
      if (nb > C.w || nb > 2) continue;
      const tb = takeSf(C, b, nb);
      v = sflushVal(a.t) + sflushVal(b.t) + planV(C.c, C.w, C.sj, C.bj, lv);
      if (v > best) { best = v; sfs = [a, b]; }
      putSf(C, b, nb, tb);
    }
    putSf(C, a, na, ta);
  }
  return { v: best, sfs };
}
function handValue(hand, lv) { return bestSplit(hand, lv).v; }

/* 把最优拆分还原成具体的出牌组合 */
function buildPlan(hand, lv) {
  const sp = bestSplit(hand, lv);
  const pool = [];
  for (let v = 0; v < 15; v++) pool.push([]);
  const wilds = [], sjs = [], bjs = [];
  for (const c of hand) {
    if (isWild(c, lv)) wilds.push(c);
    else if (c.s === 4) (c.r === 15 ? bjs : sjs).push(c);
    else pool[natOf(c)].push(c);
  }
  const combos = [];
  const mk = (type, key, cards) => { const m = { type, key, len: cards.length, cards, nw: cards.filter(c => isWild(c, lv)).length }; m.val = comboVal(m); combos.push(m); };
  for (const o of sp.sfs) {
    const cards = [];
    for (const v of o.pos) {
      const i = pool[v].findIndex(x => x.s === o.s);
      cards.push(i >= 0 ? pool[v].splice(i, 1)[0] : wilds.shift());
    }
    mk('sflush', o.t, cards);
  }
  const c = new Array(15).fill(0);
  for (let v = 2; v <= 14; v++) c[v] = pool[v].length;
  let w = wilds.length;
  const sj = sjs.length, bj = bjs.length;
  for (let guard = 0; guard < 40; guard++) {
    planV(c, w, sj, bj, lv);
    const e = PLAN_CACHE.get(planKey(c, w, sj, bj, lv));
    if (!e || e.o < 0) break;
    const d = SEQ_DEF[e.o];
    const cards = [];
    for (const v of d.pos) {
      const nn = Math.min(pool[v].length, d.k);
      for (let i = 0; i < nn; i++) cards.push(pool[v].shift());
      for (let i = nn; i < d.k; i++) { cards.push(wilds.shift()); w--; }
      c[v] -= nn;
    }
    mk(d.type, d.t, cards);
  }
  const out = [];
  leafVal(c, w, sj, bj, lv, out);
  const take = g => pool[g.v].splice(0, g.n).concat(wilds.splice(0, g.w));
  for (const o of out) {
    if (o.type === 'kingbomb') mk('kingbomb', 17, sjs.concat(bjs));
    else if (o.type === 'jpair') mk('pair', o.r === 15 ? 17 : 16, o.r === 15 ? bjs.slice() : sjs.slice());
    else if (o.type === 'jsingle') mk('single', o.r === 15 ? 17 : 16, o.r === 15 ? bjs.slice() : sjs.slice());
    else if (o.type === 'full') mk('full', o.g.p, take(o.g).concat(take(o.g2)));
    else mk(o.type, o.g.p, take(o.g));
  }
  return combos;
}
/* 非炸弹手数 */
function handsCount(hand, lv) { return buildPlan(hand, lv).filter(m => !isBombType(m.type)).length; }

/* ---------------- 一局的状态机 ---------------- */
const FULL_DECK = Hub.makeDeck({ decks: 2, jokers: true });

function dealHands(rng) {
  const deck = Hub.shuffle(FULL_DECK.slice(), rng);
  return [0, 1, 2, 3].map(i => deck.slice(i * 27, i * 27 + 27));
}
function createRound(hands, lv, leader) {
  return {
    lv, hands, turn: leader, leader, table: null, passed: [], finished: [], over: false, order: null,
    last: [null, null, null, null], history: [], played: [], trick: 0, jiefeng: false, sim: false,
  };
}
function nextActive(st, s) {
  let q = s;
  for (let i = 0; i < 4; i++) { q = (q + 1) % 4; if (st.hands[q].length) return q; }
  return s;
}
/* 当前行动者出牌（move）或不出（null） */
function act(st, move) {
  const p = st.turn;
  st.jiefeng = false;
  if (move) {
    st.hands[p] = removeCards(st.hands[p], move.cards);
    if (!st.sim) {
      for (const c of move.cards) st.played.push(c);
      st.history.push({ seat: p, move, table: st.table, counts: st.hands.map(h => h.length) });
    }
    st.table = { move, by: p };
    st.passed = [];
    st.last[p] = { move, trick: st.trick };
    if (!st.hands[p].length) {
      st.finished.push(p);
      if (st.finished.includes(partnerOf(p))) { endRound(st); return; }
    }
  } else {
    if (!st.table) throw new Error('首家不能不出');
    if (!st.sim) st.history.push({ seat: p, move: null, table: st.table, counts: st.hands.map(h => h.length) });
    st.passed.push(p);
    st.last[p] = { pass: true, trick: st.trick };
  }
  const by = st.table.by;
  let allPassed = true;
  for (let i = 0; i < 4; i++) if (i !== by && st.hands[i].length && !st.passed.includes(i)) { allPassed = false; break; }
  if (allPassed) {
    st.table = null;
    st.passed = [];
    st.trick++;
    if (st.hands[by].length) st.turn = by;
    else { st.turn = partnerOf(by); st.jiefeng = true; }   // 接风
  } else st.turn = nextActive(st, p);
}
function endRound(st) {
  st.over = true;
  const order = st.finished.slice();
  let q = order[order.length - 1];
  for (let i = 0; i < 4; i++) { q = (q + 1) % 4; if (!order.includes(q)) order.push(q); }
  st.order = order;
  st.table = null;
}
/* 名次 → 升级数 */
function roundResult(order) {
  const winTeam = teamOf(order[0]);
  const place = order.indexOf(partnerOf(order[0]));
  const up = place === 1 ? 3 : place === 2 ? 2 : 1;
  return { winTeam, up, place };
}

/* ---------------- 整场比赛（升级、过 A） ---------------- */
function createMatch(targetLevel) {
  return { target: targetLevel || 14, levels: [2, 2], banker: 0, round: 0, lastOrder: null, over: false, winner: -1 };
}
function matchLevel(m) { return m.levels[m.banker]; }
/* 结算一局：返回 { winTeam, up, place, before:[..], after:[..], passA, over } */
function settleRound(m, order) {
  const r = roundResult(order);
  const played = matchLevel(m);
  const before = m.levels.slice();
  r.before = before;
  r.played = played;
  m.round++;
  if (m.target < 14) {
    m.levels[r.winTeam] = Math.min(m.target, m.levels[r.winTeam] + r.up);
    if (m.levels[r.winTeam] >= m.target) { m.over = true; m.winner = r.winTeam; }
  } else if (played === 14 && m.banker === r.winTeam && r.up >= 2) {
    m.over = true; m.winner = r.winTeam; r.passA = true;
  } else {
    if (played === 14 && m.banker === r.winTeam) r.failA = true;   // 打 A 拿了头游但队友末游：不算过
    m.levels[r.winTeam] = Math.min(14, m.levels[r.winTeam] + r.up);
  }
  r.after = m.levels.slice();
  m.banker = r.winTeam;
  m.lastOrder = order;
  r.over = m.over;
  return r;
}

/* ---------------- 进贡 / 还贡 ---------------- */
/* 根据上局名次计算本局进贡安排（不改手牌） */
function tributePlan(hands, lastOrder, lv) {
  if (!lastOrder) return { kind: 'none', leader: null };
  const [a, b, c, d] = lastOrder;
  const double = teamOf(a) === teamOf(b);
  const payers = double ? [c, d] : [d];
  const bigJ = payers.reduce((n, s) => n + hands[s].filter(x => x.s === 4 && x.r === 15).length, 0);
  if (bigJ >= 2) return { kind: 'anti', payers, leader: a };
  return { kind: double ? 'double' : 'single', payers, receivers: double ? [a, b] : [a] };
}
/* 进贡牌：最大的牌（不含红桃级牌） */
function tributeCandidates(hand, lv) {
  const cs = hand.filter(c => !isWild(c, lv));
  const mx = Math.max(...cs.map(c => pwOf(c, lv)));
  return cs.filter(c => pwOf(c, lv) === mx);
}
/* 还贡可选牌：≤10 的牌（没有则任意） */
function returnCandidates(hand) {
  const cs = hand.filter(c => c.s !== 4 && c.r >= 2 && c.r <= 10);
  return cs.length ? cs : hand.slice();
}

/* ============================================================
   AI
   0 简单：能压就用最小的牌压，经常随机不出，不分敌友，乱拆炸弹/乱用百搭
   1 普通：手牌拆分（少手数、保留炸弹），先出小的成组牌；不压队友大牌；对手快走完才炸
   2 困难：+ 记牌（外面还有没有更大的牌 / 炸弹），团队配合（送队友、顶牌、接风），百搭优先补炸弹
   3 大师：+ 根据对手“不要”推断其牌力上限，残局蒙特卡洛模拟，炸弹时机看能否走完，进还贡针对性选择
   ============================================================ */
const AI_CFG = { mcMs: 160, mcMaxIter: 400, mcMyMax: 27, mcOthersMax: 81, mcMargin: 0.15 };

/* 外面（自己看不到的）牌的计数：别人手里 = 全部 − 自己 − 已出 */
function unseenInfo(st, seat) {
  const lv = st.lv;
  const c = new Array(15).fill(8);
  c[0] = c[1] = 0;
  c[lv] -= 2;
  const U = { c, w: 2, sj: 2, bj: 2 };
  const sub = x => {
    if (isWild(x, lv)) U.w--;
    else if (x.s === 4) { if (x.r === 15) U.bj--; else U.sj--; }
    else c[natOf(x)]--;
  };
  st.hands[seat].forEach(sub);
  st.played.forEach(sub);
  return U;
}
/* 外面的牌能否组成压过 m 的同型牌（不考虑炸弹） */
function unseenCanBeat(m, U, lv) {
  const grpOk = (p, k) => {
    if (p === 16) return k <= 2 && U.sj >= k;
    if (p === 17) return k <= 2 && U.bj >= k;
    const v = p === 15 ? lv : p;
    if (p !== 15 && v === lv) return false;
    const n = U.c[v];
    return (n > 0 || p === 15) && n + U.w >= k;
  };
  const seqOk = (n, k, t) => {
    let need = 0;
    for (const v of seqPos(t, n)) need += Math.max(0, k - U.c[v]);
    return need <= U.w;
  };
  switch (m.type) {
    case 'single': for (let p = m.key + 1; p <= 17; p++) if (grpOk(p, 1)) return true; return false;
    case 'pair': for (let p = m.key + 1; p <= 17; p++) if (grpOk(p, 2)) return true; return false;
    case 'triple': case 'full': for (let p = m.key + 1; p <= 15; p++) if (grpOk(p, 3)) return true; return false;
    case 'straight': for (let t = m.key + 1; t <= 14; t++) if (seqOk(5, 1, t)) return true; return false;
    case 'tube': for (let t = m.key + 1; t <= 14; t++) if (seqOk(3, 2, t)) return true; return false;
    case 'plate': for (let t = m.key + 1; t <= 14; t++) if (seqOk(2, 3, t)) return true; return false;
    default: return unseenMaxBomb(U, lv) > bombScore(m);
  }
}
function unseenMaxBomb(U, lv) {
  if (U.sj === 2 && U.bj === 2) return 2000;
  let best = 0;
  for (let v = 2; v <= 14; v++) {
    const n = U.c[v] + U.w;
    if (n >= 4 && (U.c[v] > 0 || v === lv)) best = Math.max(best, bombScore({ type: 'bomb', len: Math.min(10, n), key: pwNat(v, lv) }));
  }
  return best;
}
/* 大师：根据对手“不要”推断——对手面对其对手出的某牌型 key 选择不出，记为该牌型的上限 */
function passCaps(st) {
  const caps = [{}, {}, {}, {}];
  for (const h of st.history) {
    if (h.move || !h.table) continue;
    const tm = h.table.move;
    if (isBombType(tm.type) || teamOf(h.table.by) === teamOf(h.seat)) continue;
    const k = tm.type + tm.len;
    if (caps[h.seat][k] === undefined || caps[h.seat][k] > tm.key) caps[h.seat][k] = tm.key;
  }
  return caps;
}
/* 这手牌是否“绝对大”（对手大概率压不住，不算炸弹） */
function isControl(m, st, seat, diff, U, caps) {
  if (isBombType(m.type)) return true;
  if (!unseenCanBeat(m, U, st.lv)) return true;
  if (diff >= 3 && caps) {
    const k = m.type + m.len;
    return oppsOf(seat).every(o => !st.hands[o].length || (caps[o][k] !== undefined && caps[o][k] <= m.key));
  }
  return false;
}

/* 统一入口：返回出法（含 cards）或 null（不出） */
function aiDecide(st, seat, diff) {
  if (diff <= 0) return aiEasy(st, seat);
  return st.table ? aiFollow(st, seat, diff) : aiLead(st, seat, diff);
}

/* ---------- 简单 ---------- */
function aiEasy(st, seat) {
  const hand = st.hands[seat], lv = st.lv;
  if (!st.table) {
    const ms = genMoves(hand, lv, null);
    const all = ms.find(m => m.len === hand.length);
    if (all) return all;
    if (Math.random() < 0.3) {
      const seqs = ms.filter(m => ['straight', 'tube', 'plate', 'full'].includes(m.type));
      if (seqs.length) return Hub.randPick(seqs);
    }
    // 点数最小的那一组整组打出（是炸弹也照打不误）
    const low = hand.filter(c => !isWild(c, lv)).reduce((a, c) => (!a || pwOf(c, lv) < pwOf(a, lv) ? c : a), null);
    if (!low) return ms[0];
    const cards = hand.filter(c => !isWild(c, lv) && pwOf(c, lv) === pwOf(low, lv));
    const r = resolvePlay(cards, lv, null);
    return r.move || ms.sort((a, b) => moveRank(a) - moveRank(b))[0];
  }
  const cands = genMoves(hand, lv, st.table.move).sort((a, b) => moveRank(a) - moveRank(b));
  if (!cands.length) return null;
  const all = cands.find(m => m.len === hand.length);
  if (all) return all;
  if (Math.random() < 0.25) return null;
  const pick = cands[Math.random() < 0.3 ? Math.floor(Math.random() * Math.min(3, cands.length)) : 0];
  if (isBombType(pick.type) && Math.random() < 0.4) return null;
  return pick;
}

/* ---------- 普通 / 困难 / 大师：主动出牌 ---------- */
function leadOrder(a, b) { return (a.val - a.len * 0.5) - (b.val - b.len * 0.5); }
function aiLead(st, seat, diff) {
  const hand = st.hands[seat], lv = st.lv;
  const plan = buildPlan(hand, lv);
  if (plan.length === 1) return plan[0];
  const nb = plan.filter(m => !isBombType(m.type)).sort(leadOrder);
  const bombs = plan.filter(m => isBombType(m.type)).sort((a, b) => bombScore(a) - bombScore(b));
  if (!nb.length) return bombs[0];
  const opps = oppsOf(seat).filter(o => st.hands[o].length);
  const oppMin = opps.length ? Math.min(...opps.map(o => st.hands[o].length)) : 99;
  const mate = partnerOf(seat), mateN = st.hands[mate].length;
  let U = null, caps = null;
  if (diff >= 2) {
    U = unseenInfo(st, seat);
    caps = diff >= 3 ? passCaps(st) : null;
    const ctl = nb.filter(m => isControl(m, st, seat, diff, U, caps));
    const rest = nb.filter(m => !ctl.includes(m));
    // 剩一手非控制牌：先出绝对大的保持出牌权，最后一手走掉
    if (rest.length <= 1 && ctl.length) return ctl.sort((a, b) => b.len - a.len)[0];
    // 只剩一手 + 炸弹：先走这一手，被压就炸回来
    if (nb.length === 1) return nb[0];
    // 送队友：队友快走完、对手还多
    if (mateN > 0 && mateN <= 3 && oppMin > 4) {
      const tiny = sendMate(hand, lv, mateN);
      if (tiny) return tiny;
    }
  }
  // 对手快走完：不出他能接的小牌型
  let pick = nb[0];
  const danger = diff >= 2 ? 4 : 2;
  if (oppMin <= danger) {
    const safe = nb.filter(m => m.len > oppMin || (U && isControl(m, st, seat, diff, U, caps)));
    pick = safe.length ? safe[0] : nb.slice().sort((a, b) => moveRank(b) - moveRank(a))[0];   // 只能出最大的
  }
  if (diff >= 3 && useMC(st, seat)) {
    const cands = [pick].concat(nb.filter(m => m !== pick).slice(0, 5), bombs.slice(0, 1));
    const extra = genMoves(hand, lv, null).filter(m => !isBombType(m.type) && !cands.some(x => x.type === m.type && x.key === m.key && x.len === m.len));
    extra.sort((a, b) => moveRank(a) - moveRank(b));
    pick = mcChoose(st, seat, cands.concat(extra.slice(0, 3)), 0);
  }
  return pick;
}
/* 给快走完的队友送小牌 */
function sendMate(hand, lv, mateN) {
  const ms = genMoves(hand, lv, null).filter(m => !isBombType(m.type) && m.nw === 0);
  const want = mateN === 1 ? ['single'] : mateN === 2 ? ['pair', 'single'] : ['triple', 'pair', 'single'];
  for (const t of want) {
    const xs = ms.filter(m => m.type === t && m.key <= 9).sort((a, b) => a.key - b.key);
    if (xs.length) return xs[0];
  }
  return null;
}

/* ---------- 普通 / 困难 / 大师：跟牌 ---------- */
function aiFollow(st, seat, diff) {
  const scored = scoreFollow(st, seat, diff);
  if (!scored.length) return null;
  if (scored[0].forced) return scored[0].m;
  if (diff >= 3 && useMC(st, seat)) {
    const cands = [null].concat(scored.slice(0, 5).map(x => x.m));
    return mcChoose(st, seat, cands, scored[0].s > 0 ? 1 : 0);
  }
  return scored[0].s > 0 ? scored[0].m : null;
}
/* 给每个能压的出法打分（不出 = 0），返回按分数降序 */
function scoreFollow(st, seat, diff) {
  const hand = st.hands[seat], lv = st.lv;
  const tm = st.table.move, owner = st.table.by;
  const cands = genMoves(hand, lv, tm);
  if (!cands.length) return [];
  const all = cands.find(m => m.len === hand.length);
  if (all) return [{ m: all, s: 999, forced: true }];
  const mateOwns = teamOf(owner) === teamOf(seat);
  const ownerN = st.hands[owner].length;
  const mateN = st.hands[partnerOf(seat)].length;
  const opps = oppsOf(seat).filter(o => st.hands[o].length);
  const oppMin = opps.length ? Math.min(...opps.map(o => st.hands[o].length)) : 99;
  const nxt = nextActive(st, seat);
  const tmBomb = isBombType(tm.type);
  let ding = false;
  if (mateOwns) {
    if (!mateN || tmBomb) return [];                      // 队友已走（等接风）/ 队友炸了
    if (diff === 1 && (tm.key >= 11 || mateN <= 6)) return [];
    if (diff >= 2) {
      if (mateN <= 5) return [];
      // 顶牌：队友出的小，下家对手快走完 → 用大牌顶住
      ding = teamOf(nxt) !== teamOf(seat) && st.hands[nxt].length <= 6 && tm.key <= 12;
      if (!ding && tm.key >= 11) return [];
    }
  }
  const before = handValue(hand, lv);
  const U = diff >= 2 ? unseenInfo(st, seat) : null;
  const caps = diff >= 3 ? passCaps(st) : null;
  const res = [];
  for (const m of cands) {
    const bomb = isBombType(m.type);
    if (mateOwns && bomb) continue;
    const rest = removeCards(hand, m.cards);
    const after = handValue(rest, lv);
    let s = after - before + 1;
    if (bomb) {
      let urg = 0;
      if (!mateOwns) {
        const lim = diff === 1 ? 5 : 6;
        if (ownerN <= lim) urg += 22 + (lim - ownerN) * 3;
        else if (diff >= 2 && oppMin <= 4) urg += 14;
        else if (diff >= 2 && ownerN <= 10) urg += 5;
      }
      if (diff >= 2) {
        const hs = handsCount(rest, lv);
        if (hs <= 1) urg += 26;
        else if (diff >= 3 && hs <= 2 && rest.length <= 10) urg += 12;
      }
      s += urg;
    } else {
      if (!mateOwns && m.key >= 14 && ownerN > 12 && oppMin > 12 && tm.key < 10) s -= (m.key - 13) * 2.5;  // 大牌留着控场
      if (!mateOwns && ownerN <= 4) s += 15;                                                              // 拦截快走完的对手
      if (U && isControl(m, st, seat, diff, U, caps)) s += 3;
      if (ding) s += 4 + m.key * 0.4;
    }
    if (mateOwns && !ding) s -= 6;
    res.push({ m, s });
  }
  res.sort((a, b) => b.s - a.s);
  return res;
}

/* ---------- 大师：残局蒙特卡洛 ---------- */
function useMC(st, seat) {
  const n = st.hands[seat].length;
  if (n > AI_CFG.mcMyMax || AI_CFG.mcMs <= 0) return false;
  const others = [0, 1, 2, 3].filter(i => i !== seat).reduce((a, i) => a + st.hands[i].length, 0);
  return others <= AI_CFG.mcOthersMax;
}
/* cands[def] 为启发式首选；只有模拟结果明显更好时才换 */
function mcChoose(st, seat, cands, def) {
  const t0 = now();
  const mine = new Set(st.hands[seat].map(c => c.id));
  const gone = new Set(st.played.map(c => c.id));
  const unknown = FULL_DECK.filter(c => !mine.has(c.id) && !gone.has(c.id));
  const sum = cands.map(() => 0), cnt = cands.map(() => 0);
  let iter = 0;
  while (iter < AI_CFG.mcMaxIter && (iter < 4 || now() - t0 < AI_CFG.mcMs)) {
    const deal = Hub.shuffle(unknown.slice());
    for (let i = 0; i < cands.length; i++) {
      const sim = simClone(st, seat, deal);
      act(sim, cands[i]);
      sum[i] += rollout(sim, seat);
      cnt[i]++;
    }
    iter++;
  }
  const d = def || 0;
  let bi = d;
  for (let i = 0; i < cands.length; i++) if (sum[i] / cnt[i] > sum[bi] / cnt[bi] + 1e-9) bi = i;
  if (bi !== d && sum[bi] / cnt[bi] < sum[d] / cnt[d] + AI_CFG.mcMargin) bi = d;
  return cands[bi];
}
function simClone(st, seat, deal) {
  const hands = [];
  let k = 0;
  for (let i = 0; i < 4; i++) {
    if (i === seat) hands.push(st.hands[i].slice());
    else { const n = st.hands[i].length; hands.push(deal.slice(k, k + n)); k += n; }
  }
  return {
    lv: st.lv, hands, turn: st.turn, table: st.table, passed: st.passed.slice(), finished: st.finished.slice(),
    over: false, order: null, last: [null, null, null, null], history: [], played: [], trick: 0, sim: true,
  };
}
function rollout(sim, seat) {
  sim.plans = [null, null, null, null];
  for (let i = 0; i < 300 && !sim.over; i++) {
    const s = sim.turn;
    const m = planPolicy(sim, s);
    if (m && sim.plans[s]) sim.plans[s] = sim.plans[s].filter(x => x !== m);
    act(sim, m);
  }
  if (!sim.over) return 0;
  const r = roundResult(sim.order);
  return r.winTeam === teamOf(seat) ? r.up : -r.up;
}
/* 模拟用策略：每人开局拆一次牌，之后只出拆分里的组合（接近“普通”AI，但非常快） */
function planPolicy(sim, s) {
  const hand = sim.hands[s], lv = sim.lv;
  if (!sim.plans[s]) sim.plans[s] = buildPlan(hand, lv);
  const plan = sim.plans[s];
  if (plan.length === 1 && canBeat(plan[0], sim.table && sim.table.move)) return plan[0];
  const oppMin = Math.min(...oppsOf(s).map(o => sim.hands[o].length || 99));
  if (!sim.table) {
    const nb = plan.filter(m => !isBombType(m.type)).sort(leadOrder);
    if (!nb.length) return plan.slice().sort((a, b) => bombScore(a) - bombScore(b))[0];
    if (oppMin <= 2) { const safe = nb.filter(m => m.len > oppMin); if (safe.length) return safe[0]; return nb[nb.length - 1]; }
    return nb[0];
  }
  const owner = sim.table.by, tm = sim.table.move;
  if (teamOf(owner) === teamOf(s)) return null;
  let best = null, bomb = null;
  for (const m of plan) {
    if (!canBeat(m, tm)) continue;
    if (isBombType(m.type)) { if (!bomb || bombScore(m) < bombScore(bomb)) bomb = m; }
    else if (!best || m.key < best.key) best = m;
  }
  if (best) return best;
  if (bomb && (sim.hands[owner].length <= 6 || plan.length <= 2)) return bomb;
  return null;
}
/* 模拟用的快速策略 */
function fastPolicy(st, s) {
  const hand = st.hands[s], lv = st.lv;
  if (!st.table) {
    const ms = genMoves(hand, lv, null);
    const all = ms.find(m => m.len === hand.length);
    if (all) return all;
    const oppMin = Math.min(...oppsOf(s).map(o => st.hands[o].length || 99));
    let best = null, bs = -1e9;
    for (const m of ms) {
      if (isBombType(m.type)) continue;
      let sc = m.len * 2 - m.key - m.nw * 4;
      if (m.len <= oppMin && oppMin <= 2) sc -= 20;
      if (sc > bs) { bs = sc; best = m; }
    }
    return best || ms.sort((a, b) => moveRank(a) - moveRank(b))[0];
  }
  const owner = st.table.by;
  const ms = genMoves(hand, lv, st.table.move);
  if (!ms.length) return null;
  const all = ms.find(m => m.len === hand.length);
  if (all) return all;
  if (teamOf(owner) === teamOf(s)) return null;
  let best = null, bomb = null;
  for (const m of ms) {
    if (isBombType(m.type)) { if (!bomb || bombScore(m) < bombScore(bomb)) bomb = m; }
    else if (!best || m.key < best.key || (m.key === best.key && m.nw < best.nw)) best = m;
  }
  if (best) return best;
  return bomb && st.hands[owner].length <= 5 ? bomb : null;
}

/* ---------- 进贡 / 还贡（AI） ---------- */
function aiTributeCard(hand, lv, diff) {
  const cs = tributeCandidates(hand, lv);
  if (diff < 2 || cs.length === 1) return cs[0];
  // 同样大小时，选拿走后自己牌型最好的那张（例如别拆同花顺）
  let best = cs[0], bv = -1e9;
  const seen = new Set();
  for (const c of cs) {
    if (seen.has(c.s)) continue;
    seen.add(c.s);
    const v = handValue(removeCards(hand, [c]), lv);
    if (v > bv) { bv = v; best = c; }
  }
  return best;
}
function aiReturnCard(hand, lv, diff) {
  const cs = returnCandidates(hand);
  if (diff <= 0) return Hub.randPick(cs);
  if (diff === 1) {
    // 普通：拆分里的单张中最小的，否则最小的牌
    const plan = buildPlan(hand, lv);
    const singles = new Set(plan.filter(m => m.type === 'single').flatMap(m => m.cards.map(c => c.id)));
    const ok = cs.filter(c => singles.has(c.id) && !isWild(c, lv));
    const pool = ok.length ? ok : cs.filter(c => !isWild(c, lv));
    return (pool.length ? pool : cs).reduce((a, c) => (pwOf(c, lv) < pwOf(a, lv) ? c : a));
  }
  // 困难 / 大师：试每张，选对自己损失最小的；大师再考虑别给对手“送”有用的牌
  const mine = countsOf(hand, lv);
  let best = cs[0], bv = -1e9;
  const tried = new Set();
  for (const c of cs) {
    const k = c.r + '-' + c.s;
    if (tried.has(k)) continue;
    tried.add(k);
    let v = handValue(removeCards(hand, [c]), lv) - (isWild(c, lv) ? 50 : 0) - pwOf(c, lv) * 0.3;
    if (diff >= 3) {
      const v0 = natOf(c);
      v -= (8 - mine.c[v0]) * 0.35;          // 这个点数外面越多，对手越可能凑成炸弹
      if (v0 === 10 || v0 === lv) v -= 1.5;  // 10 是顺子大头，级牌点数对对手也有用
    }
    if (v > bv) { bv = v; best = c; }
  }
  return best;
}

/* ---------- 提示（玩家用）：从小到大，优先不拆炸弹 ---------- */
function hintMoves(hand, lv, tableMove) {
  if (!tableMove) {
    const plan = buildPlan(hand, lv);
    const nb = plan.filter(m => !isBombType(m.type)).sort(leadOrder);
    const bb = plan.filter(m => isBombType(m.type)).sort((a, b) => bombScore(a) - bombScore(b));
    return nb.concat(bb);
  }
  const ms = genMoves(hand, lv, tableMove);
  const C = countsOf(hand, lv);
  const breaks = m => m.nw > 0 || m.cards.some(c => c.s !== 4 && !isWild(c, lv) && C.c[natOf(c)] >= 4);
  const a = [], b = [], c = [];
  for (const m of ms) (isBombType(m.type) ? c : breaks(m) ? b : a).push(m);
  const byKey = (x, y) => (x.key - y.key) || (x.nw - y.nw);
  a.sort(byKey); b.sort(byKey); c.sort((x, y) => bombScore(x) - bombScore(y));
  return a.concat(b, c);
}

/* ---------------- 无头模拟（测试 / 自对弈统计） ---------------- */
/* diffs：4 个座位的难度。check(st, seat, move) 每步回调（可做合法性校验） */
function simulateRound(hands, lv, leader, diffs, check) {
  const st = createRound(hands, lv, leader);
  let steps = 0;
  while (!st.over) {
    if (++steps > 2000) throw new Error('死循环？');
    const s = st.turn;
    const m = aiDecide(st, s, diffs[s]);
    if (check) check(st, s, m);
    act(st, m);
  }
  return { order: st.order, steps, st };
}
/* 进贡：各进贡者交出最大的牌，确定给谁、谁先出。返回 { pays:[{from,to,card}], leader } */
function tributePays(hands, tp, lv, diffOf) {
  const pays = tp.payers.map(s => ({ from: s, card: aiTributeCard(hands[s], lv, diffOf(s)) }));
  let leader;
  if (tp.kind === 'single') { pays[0].to = tp.receivers[0]; leader = pays[0].from; }
  else {
    const [x, y] = pays;   // x = 三游，y = 末游；一样大时三游的给头游、三游先出
    if (pwOf(y.card, lv) > pwOf(x.card, lv)) { y.to = tp.receivers[0]; x.to = tp.receivers[1]; leader = y.from; }
    else { x.to = tp.receivers[0]; y.to = tp.receivers[1]; leader = x.from; }
  }
  return { pays, leader };
}
function moveCard(hands, from, to, card) {
  hands[from] = removeCards(hands[from], [card]);
  hands[to].push(card);
}
/* 执行进贡还贡（直接修改 hands）。pickReturn(seat, hand, giver) 可指定还贡牌；默认 AI */
function doTribute(hands, tp, lv, diffOf, pickReturn) {
  const { pays, leader } = tributePays(hands, tp, lv, diffOf);
  for (const p of pays) moveCard(hands, p.from, p.to, p.card);
  const rets = pays.map(p => {
    const card = pickReturn ? pickReturn(p.to, hands[p.to], p.from) : aiReturnCard(hands[p.to], lv, diffOf(p.to));
    moveCard(hands, p.to, p.from, card);
    return { from: p.to, to: p.from, card };
  });
  return { pays, rets, leader };
}
/* 完整一局（含进贡还贡）：返回 { order, tp, res, steps } */
function playMatchRound(match, diffs, check, rng) {
  const lv = matchLevel(match);
  const hands = dealHands(rng);
  const tp = tributePlan(hands, match.lastOrder, lv);
  let leader, trib = null;
  if (tp.kind === 'none') leader = Math.floor((rng || Math.random)() * 4);
  else if (tp.kind === 'anti') leader = tp.leader;
  else { trib = doTribute(hands, tp, lv, s => diffs[s], null); leader = trib.leader; }
  for (const h of hands) sortHand(h, lv);
  const r = simulateRound(hands, lv, leader, diffs, check);
  const res = settleRound(match, r.order);
  return { order: r.order, tp, trib, res, steps: r.steps, lv };
}


/* ============================================================
   以下为浏览器 UI 部分
   ============================================================ */
if (typeof document !== 'undefined') {
  (function () {
    const RULES = `
      <p><b>队伍：</b>四人两队，对家是队友。你（下）和 🧔老张（上）一队，对抗 🧑‍🎤小李（右）和 👵刘奶奶（左）。出牌顺序：你 → 右 → 上 → 左。</p>
      <p><b>级牌：</b>两队各有级数，都从 2 开始；每局打“庄家队”（上一局赢的一方）的级数。当前级数的牌叫级牌，单张大小排在 A 之上、小王之下。</p>
      <p><b>逢人配：</b><b>红桃级牌</b>是百搭（牌面带「配」字），可以当作除大小王以外的任意一张牌，用来补对子、三张、顺子、炸弹、同花顺等。</p>
      <p><b>单张大小：</b>2 &lt; 3 &lt; … &lt; K &lt; A &lt; 级牌 &lt; 小王 &lt; 大王（在顺子、连对、钢板里，级牌按本身点数用）。</p>
      <p><b>牌型：</b>单张、对子、三张、三带二（三张+一对）、顺子（恰好 5 张，A 可当 1 或 14：A2345 最小、10JQKA 最大，不能含王）、三连对（如 334455）、钢板（两个连续三张，如 333444）、炸弹（4~10 张同点）、同花顺（5 张同花色顺子）、天王炸（4 张王）。两张小王或两张大王可以组成对子，但王不能组成三张或进入其他牌型。</p>
      <p><b>大小：</b>非炸弹只能用<b>同牌型、同张数</b>的更大牌压。炸弹可以压任何非炸弹：4 炸 &lt; 5 炸 &lt; 同花顺 &lt; 6 炸 &lt; 7 炸 &lt; … &lt; 10 炸 &lt; 天王炸；同张数炸弹比点数（级牌炸 &gt; A 炸），同花顺比顶张。</p>
      <p><b>名次与升级：</b>先出完的是头游，然后二游、三游、末游。头游的队伍赢：队友二游升 3 级（双上），三游升 2 级，末游升 1 级。</p>
      <p><b>接风：</b>某人出完最后一手牌后，其余人都不要，由他的队友获得出牌权。</p>
      <p><b>进贡 / 还贡：</b>第二局起，上局末游向头游进贡一张最大的牌（红桃级牌除外），头游还一张 ≤10 的牌；若上局“双下”，两人各进贡一张，大的给头游、小的给二游。进贡方手里有两张大王可以<b>抗贡</b>（免贡）。进贡者先出牌（双下时进贡大牌者先出；抗贡时头游先出）。</p>
      <p><b>胜利：</b>某队率先升到目标级数即赢下整场；目标为“过 A”时，打到 A 后还必须在打 A 的那局拿到头游、且队友不是末游才算过 A。</p>
      <p><b>操作：</b>点击选牌，按住拖过多张一次选中，<b>双击</b>选中同点数整列，右键清空。<br>快捷键：<b>Enter / 空格</b> 出牌，<b>P</b> 不出，<b>H</b> 提示（循环给出可行出法），<b>Esc</b> 重选。<br>困难 / 大师难度下按真实规则，别人的剩余牌数只在 ≤10 张时公开。</p>`;

    const ctx = Hub.init({ game: 'guandan', defaults: { targetLevel: 14 }, rules: RULES });
    const DIFF = ctx.diffIndex;
    let TARGET = Math.round(+ctx.params.targetLevel);
    if (!Number.isFinite(TARGET) || TARGET < 3 || TARGET > 14) TARGET = 14;

    const PEOPLE = [
      { name: '你', avatar: '😎' },
      { name: '小李', avatar: '🧑‍🎤', tag: '对手', quips: {
        bomb: ['炸弹来咯！', '这把我说了算！', '轰！服不服？'],
        beat: ['就这？', '小意思～', '跟得上吗？'],
        pass: ['让你一手', '先不跟了', '你厉害你先走'],
        out: ['溜了溜了～', '头游拿下！'],
        win: ['赢麻了！', '这就是实力'], lose: ['下把一定赢回来', '手气不行…'],
        tribute: ['给你给你，拿去吧', '心疼我的大牌…'] } },
      { name: '老张', avatar: '🧔', tag: '队友', quips: {
        bomb: ['炸！给你开路', '我来顶住！'],
        beat: ['我来接', '稳住'],
        pass: ['你先走', '不要，你来'],
        out: ['我先走一步，剩下靠你了！', '出完了，加油！'],
        win: ['配合得漂亮！', '咱俩默契啊'], lose: ['没事，下局再来', '牌不好，不怪你'],
        praise: ['好炸！', '漂亮！', '打得好！'], tribute: ['唉，进贡一张', '这张大牌给你们了'] } },
      { name: '刘奶奶', avatar: '👵', tag: '对手', quips: {
        bomb: ['奶奶的炸弹可不是吃素的', '年轻人，别急'],
        beat: ['年轻人，还嫩着呢', '这张奶奶要了'],
        pass: ['不要，你们年轻人打', '先看看'],
        out: ['奶奶打了四十年掼蛋了', '走喽～'],
        win: ['姜还是老的辣', '承让承让'], lose: ['老了老了…', '下局奶奶认真了'],
        tribute: ['拿去吧，孩子', '这牌给你'] } },
    ];
    const PLACE = ['头游', '二游', '三游', '末游'];
    const U = {
      match: null, st: null, sel: new Set(), hints: null, hintIdx: -1, hintMove: null,
      phase: 'idle', resolve: null, arrange: false, retCands: null, retTo: -1,
      tribShow: [null, null, null, null], newIds: new Set(), lv: 2,
    };
    const $ = id => document.getElementById(id);
    const nameOf = s => s === 0 ? '你' : PEOPLE[s].name;
    const lvTxt = v => levelName(v);

    /* ---------- 构建座位 ---------- */
    function buildSeats() {
      for (let i = 1; i <= 3; i++) {
        const p = PEOPLE[i];
        $('sw-' + i).innerHTML = `
          <div class="hub-seat gd-seat" id="seat-${i}">
            <div class="gd-seat-row">
              <div class="avatar">${p.avatar}</div>
              <div class="gd-seat-info">
                <div class="name">${p.name} <span class="tag ${i === 2 ? 'blue' : ''}">${p.tag}</span></div>
                <div class="sub"><span class="gd-backs"><i></i><i></i><i></i></span><span id="cnt-${i}"></span></div>
              </div>
            </div>
            <div class="gd-place" id="place-${i}"></div>
          </div>
          <div class="hub-status" id="status-${i}"></div>`;
      }
      $('sw-0').innerHTML = `
        <div class="hub-seat gd-seat gd-seat-me" id="seat-0">
          <div class="gd-seat-row">
            <div class="avatar">😎</div>
            <div class="gd-seat-info"><div class="name">你 <span class="tag blue">我方</span></div><div class="sub" id="cnt-0"></div></div>
          </div>
          <div class="gd-place" id="place-0"></div>
        </div>
        <div class="hub-status" id="status-0"></div>`;
    }

    /* ---------- 渲染 ---------- */
    function render() {
      renderCenter();
      for (let i = 0; i < 4; i++) renderSeat(i);
      renderHand();
      renderButtons();
    }
    function renderCenter() {
      const m = U.match;
      if (!m) return;
      const lv = U.lv;
      const mine = m.levels[0], opp = m.levels[1];
      $('gd-level').innerHTML = `本局打 <b>${lvTxt(lv)}</b>`;
      $('gd-levels').innerHTML = `我方 <b class="me">${lvTxt(mine)}</b> / 对方 <b class="op">${lvTxt(opp)}</b>`;
      const goal = TARGET >= 14 ? '目标：过 A' : `目标：打到 ${lvTxt(TARGET)}`;
      $('gd-goal').textContent = `${goal} · ${m.round === 0 ? '首局' : (m.banker === 0 ? '我方坐庄' : '对方坐庄')}`;
      const done = U.st && U.st.over;
      Hub.setInfo(m.over ? `比赛结束 · 共 <b>${m.round}</b> 局 · 我方 <b>${lvTxt(mine)}</b> / 对方 <b>${lvTxt(opp)}</b>`
        : `第 <b>${m.round + (done ? 0 : 1)}</b> 局 · 本局打 <b>${lvTxt(lv)}</b> · 我方 <b>${lvTxt(mine)}</b> / 对方 <b>${lvTxt(opp)}</b>`);
    }
    function renderSeat(i) {
      const st = U.st;
      if (!st) return;
      const seat = $('seat-' + i), status = $('status-' + i), out = $('out-' + i);
      const acting = !st.over && st.turn === i && (U.phase === 'play' || U.phase === 'ai');
      seat.classList.toggle('acting', acting);
      const n = st.hands[i].length;
      const cnt = $('cnt-' + i);
      if (i === 0) cnt.textContent = `手牌 ${n} 张`;
      else {
        const show = DIFF < 2 || n <= 10;
        cnt.innerHTML = n === 0 ? '已出完' : show ? `剩 <b class="${n <= 5 ? 'warn' : ''}">${n}</b> 张` : '剩 <b>?</b> 张';
      }
      const fi = st.finished.indexOf(i);
      const place = $('place-' + i);
      const ptxt = fi >= 0 ? PLACE[fi] : (st.over && st.order ? PLACE[st.order.indexOf(i)] : '');
      place.textContent = ptxt;
      place.className = 'gd-place' + (ptxt ? ' show p' + (fi >= 0 ? fi : st.order.indexOf(i)) : '');
      seat.classList.toggle('done', n === 0);
      // 状态胶囊
      const last = st.last[i];
      let txt = '', kind = '';
      if (acting) { txt = i === 0 ? '轮到你出牌' : '思考中…'; kind = 'acting'; }
      else if (U.tribShow[i]) { txt = U.tribShow[i].label; kind = 'info'; }
      else if (last && last.pass) { txt = '不出'; kind = 'pass'; }
      else if (last && last.move) { txt = patternText(last.move, st.lv); kind = isBombType(last.move.type) ? 'hot' : 'info'; }
      else if (fi >= 0) { txt = PLACE[fi]; kind = 'good'; }
      if (status.textContent !== txt) status.textContent = txt;
      if (kind) status.dataset.kind = kind; else delete status.dataset.kind;
      // 出的牌
      let html = '';
      const top = st.table && st.table.by === i;
      if (U.tribShow[i]) {
        html = `<div class="gd-cards">${Hub.cardHTML(U.tribShow[i].card, { wild: isWild(U.tribShow[i].card, st.lv), hl: true })}</div><div class="gd-out-lab">${U.tribShow[i].label}</div>`;
      } else if (last && last.move) {
        const cards = sortHand(last.move.cards.slice(), st.lv);
        html = `<div class="gd-cards">${cards.map(c => Hub.cardHTML(c, { wild: isWild(c, st.lv) })).join('')}</div>`;
      } else if (last && last.pass) html = '<div class="gd-pass">不出</div>';
      const key = html + (top ? 'T' : '') + (last ? last.trick : '');
      if (out.dataset.key !== key) { out.innerHTML = html; out.dataset.key = key; }
      out.classList.toggle('top', !!top);
      out.classList.toggle('old', !!(last && last.trick !== st.trick && !U.tribShow[i]));
    }

    /* 手牌分列：按掼蛋大小从大到小，同点数竖排一列；理牌模式把同花顺、天王炸、炸弹排到最前 */
    function handColumns() {
      const st = U.st, lv = U.lv;
      const hand = st.hands[0];
      const cols = [];
      let rest = hand.slice();
      if (U.arrange) {
        const plan = buildPlan(hand, lv);
        for (const m of plan) if (m.type === 'sflush' || m.type === 'kingbomb') {
          cols.push({ cards: m.cards.slice().sort((a, b) => natOf(b) - natOf(a) || a.r - b.r), special: true });
          rest = removeCards(rest, m.cards);
        }
      }
      sortHand(rest, lv);
      const groups = [];
      for (const c of rest) {
        const p = pwOf(c, lv);
        const g = groups.length && groups[groups.length - 1];
        if (g && g.p === p) g.cards.push(c); else groups.push({ p, cards: [c] });
      }
      if (U.arrange) {
        const big = groups.filter(g => g.cards.length >= 4);
        for (const g of big) cols.push({ cards: g.cards, special: true });
        for (const g of groups) if (!big.includes(g)) cols.push({ cards: g.cards });
      } else for (const g of groups) cols.push({ cards: g.cards });
      return cols;
    }
    function renderHand() {
      const el = $('gd-hand');
      const st = U.st;
      if (!st) { el.innerHTML = ''; return; }
      const lv = U.lv;
      const cols = handColumns();
      const cs = getComputedStyle(el);
      const cw = parseFloat(cs.getPropertyValue('--hand-cw')) || 72;
      const maxH = parseFloat(cs.getPropertyValue('--hand-maxh')) || 260;
      const maxLen = Math.max(1, ...cols.map(c => c.cards.length));
      const ch = cw * 1.4;
      let step = maxLen > 1 ? (maxH - ch) / (maxLen - 1) : cw * 0.42;
      step = Math.max(cw * 0.27, Math.min(cw * 0.42, step));
      el.style.setProperty('--step', step.toFixed(1) + 'px');
      const ret = U.phase === 'return';
      el.classList.toggle('locked', !(U.phase === 'play' || ret));
      el.innerHTML = cols.map(col => `<div class="gd-col${col.special ? ' special' : ''}">${col.cards.map(c => {
        const dim = ret && !U.retCands.has(c.id);
        return Hub.cardHTML(c, { wild: isWild(c, lv), sel: U.sel.has(c.id), hl: U.newIds.has(c.id), cls: dim ? 'dim' : '' });
      }).join('')}</div>`).join('');
    }
    function renderButtons() {
      const st = U.st;
      const play = U.phase === 'play', ret = U.phase === 'return';
      $('btn-play').disabled = !play;
      $('btn-pass').disabled = !play || !st || !st.table;
      $('btn-hint').disabled = !play;
      $('btn-clear').disabled = !(play || ret);
      $('btn-arrange').disabled = !st;
      $('btn-arrange').textContent = U.arrange ? '按点数' : '理牌';
      for (const id of ['btn-play', 'btn-pass', 'btn-hint']) $(id).hidden = ret;
      $('btn-ret').hidden = !ret;
      $('btn-auto-ret').hidden = !ret;
    }
    function setMsg(html) { const el = $('gd-msg'); if (el.innerHTML !== html) el.innerHTML = html; }

    /* ---------- 台词 ---------- */
    function quip(s, type, prob) {
      if (s === 0 || Math.random() > prob) return;
      const lines = PEOPLE[s].quips[type];
      if (lines && lines.length) Hub.bubble($('seat-' + s), Hub.randPick(lines), undefined, nameOf(s));
    }

    /* ---------- 配音：报牌 ---------- */
    const COMBO_CALL = { full: 'sandaier', straight: 'shunzi', tube: 'sanliandui', plate: 'gangban', bomb: 'zhadan',
      sflush: 'tonghuashun', kingbomb: 'tianwangzha' };
    function callPlay(s, move, following, lv) {
      const who = nameOf(s);
      const pw = move.key;
      const r = pw === 17 ? 15 : pw === 16 ? 14 : pw === 15 ? (lv === 14 ? 1 : lv) : pw === 14 ? 1 : pw;
      if (move.type === 'single') return Hub.call(who, 's' + r);
      if (move.type === 'pair') return Hub.call(who, 'p' + r);
      if (move.type === 'triple') return Hub.call(who, 't' + r);
      if (following && !isBombType(move.type) && Math.random() < 0.35)
        return Hub.call(who, Hub.randPick(['beat1', 'beat2', 'beat3']));
      return Hub.call(who, COMBO_CALL[move.type] || 'shunzi');
    }

    /* ---------- 选牌 ---------- */
    let drag = null;
    function canPick(el) {
      if (U.phase !== 'play' && U.phase !== 'return') return false;
      return !el.classList.contains('dim');
    }
    function bindHand() {
      const el = $('gd-hand');
      el.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        const card = e.target.closest('.pk[data-id]');
        if (!card || !canPick(card)) return;
        e.preventDefault();
        drag = { mode: U.sel.has(card.dataset.id) ? 'del' : 'add', ids: [card.dataset.id] };
        card.classList.add('drag');
      });
      window.addEventListener('pointermove', e => {
        if (!drag) return;
        const t = document.elementFromPoint(e.clientX, e.clientY);
        const card = t && t.closest('#gd-hand .pk[data-id]');
        if (card && canPick(card) && !drag.ids.includes(card.dataset.id)) { drag.ids.push(card.dataset.id); card.classList.add('drag'); }
      });
      window.addEventListener('pointerup', () => {
        if (!drag) return;
        const d = drag;
        drag = null;
        if (U.phase === 'return') U.sel = new Set(d.mode === 'add' ? [d.ids[d.ids.length - 1]] : []);
        else for (const id of d.ids) { if (d.mode === 'add') U.sel.add(id); else U.sel.delete(id); }
        U.hintMove = null;
        Hub.sfx('select');
        renderHand();
      });
      el.addEventListener('dblclick', e => {
        const card = e.target.closest('.pk[data-id]');
        if (!card || U.phase !== 'play') return;
        const ids = Array.from(card.parentElement.querySelectorAll('.pk[data-id]')).map(x => x.dataset.id);
        const all = ids.every(id => U.sel.has(id));
        for (const id of ids) { if (all) U.sel.delete(id); else U.sel.add(id); }
        U.hintMove = null;
        renderHand();
      });
      el.addEventListener('contextmenu', e => { e.preventDefault(); clearSel(); });
    }
    function clearSel() { U.sel.clear(); U.hintMove = null; renderHand(); }

    /* ---------- 玩家出牌 ---------- */
    function humanTurn() {
      return new Promise(res => {
        U.phase = 'play';
        U.resolve = res;
        U.hints = null; U.hintIdx = -1; U.hintMove = null;
        const st = U.st;
        // 保留仍在手里的已选牌
        const ids = new Set(st.hands[0].map(c => c.id));
        for (const id of [...U.sel]) if (!ids.has(id)) U.sel.delete(id);
        if (!st.table) setMsg(st.jiefeng ? '🤝 接风！由你自由出牌' : '轮到你<b>自由出牌</b>（首家不能不出）');
        else {
          const can = genMoves(st.hands[0], st.lv, st.table.move).length > 0;
          setMsg(`需要大过 ${nameOf(st.table.by)} 的 <b>${patternText(st.table.move, st.lv)}</b>${can ? '' : ' · <span class="warn">没有能大过的牌</span>'}`);
        }
        render();
      });
    }
    function commit(move) {
      const res = U.resolve;
      if (!res) return;
      U.resolve = null;
      U.phase = 'busy';
      U.sel.clear();
      setMsg('');
      res(move);
    }
    function sameCards(a, ids) { return a.length === ids.size && a.every(c => ids.has(c.id)); }
    function tryPlay() {
      if (U.phase !== 'play') return;
      const st = U.st;
      const cards = st.hands[0].filter(c => U.sel.has(c.id));
      if (!cards.length) { Hub.toast('请先选择要出的牌'); Hub.sfx('error'); return; }
      if (U.hintMove && sameCards(U.hintMove.cards, U.sel)) { commit(U.hintMove); return; }
      const r = resolvePlay(cards, st.lv, st.table && st.table.move);
      if (r.err) { Hub.toast(r.err); Hub.sfx('error'); return; }
      if (r.options) { chooseOption(r.options).then(m => { if (m && U.phase === 'play') commit(m); }); return; }
      commit(r.move);
    }
    function doPass() {
      if (U.phase !== 'play') return;
      if (!U.st.table) { Hub.toast('你是首家，必须出牌'); Hub.sfx('error'); return; }
      commit(null);
    }
    function doHint() {
      if (U.phase !== 'play') return;
      const st = U.st;
      if (!U.hints) U.hints = hintMoves(st.hands[0], st.lv, st.table && st.table.move);
      if (!U.hints.length) { Hub.toast('没有能大过的牌，只能不出'); Hub.sfx('error'); return; }
      U.hintIdx = (U.hintIdx + 1) % U.hints.length;
      U.hintMove = U.hints[U.hintIdx];
      U.sel = new Set(U.hintMove.cards.map(c => c.id));
      setMsg(`💡 提示 ${U.hintIdx + 1}/${U.hints.length}：<b>${patternText(U.hintMove, st.lv)}</b>（再按 H 换一个）`);
      Hub.sfx('click');
      renderHand();
    }
    /* 一组牌有多种非炸弹解释时让玩家选 */
    function chooseOption(opts) {
      return new Promise(res => {
        let el = $('gd-choose');
        if (!el) { el = document.createElement('div'); el.id = 'gd-choose'; el.className = 'hub-overlay'; document.body.appendChild(el); }
        el.innerHTML = `<div class="hub-panel gd-choose-panel"><h2>这手牌按哪种牌型出？</h2>
          <div class="gd-choose-btns">${opts.map((o, i) => `<button class="hub-btn gold" data-i="${i}">${patternText(o, U.lv)}</button>`).join('')}</div>
          <button class="hub-btn gray" data-i="-1">取消</button></div>`;
        el.classList.add('show');
        el.querySelectorAll('[data-i]').forEach(b => {
          b.onclick = () => { el.classList.remove('show'); const i = +b.dataset.i; Hub.sfx('click'); res(i >= 0 ? opts[i] : null); };
        });
      });
    }

    /* ---------- 还贡（玩家） ---------- */
    function humanReturn(giver) {
      return new Promise(res => {
        const hand = U.st.hands[0];
        U.retCands = new Set(returnCandidates(hand).map(c => c.id));
        const sug = aiReturnCard(hand, U.lv, 2);
        U.sel = new Set([sug.id]);
        U.retTo = giver;
        U.phase = 'return';
        U.resolve = res;
        setMsg(`请选择一张 <b>≤10</b> 的牌还给 ${nameOf(giver)}（已预选建议：<b>${Hub.cardText(sug)}</b>）`);
        render();
      });
    }
    function doReturn(auto) {
      if (U.phase !== 'return') return;
      const hand = U.st.hands[0];
      let card;
      if (auto) card = aiReturnCard(hand, U.lv, 2);
      else {
        const sel = hand.filter(c => U.sel.has(c.id));
        if (sel.length !== 1 || !U.retCands.has(sel[0].id)) { Hub.toast('请选择一张 ≤10 的牌'); Hub.sfx('error'); return; }
        card = sel[0];
      }
      const res = U.resolve;
      U.resolve = null;
      U.phase = 'busy';
      U.sel.clear();
      setMsg('');
      res(card);
    }

    /* ---------- 一局 ---------- */
    async function playRound() {
      const m = U.match;
      const lv = matchLevel(m);
      U.lv = lv;
      const hands = dealHands();
      for (const h of hands) sortHand(h, lv);
      const st = createRound(hands, lv, 0);
      U.st = st;
      U.phase = 'deal';
      U.sel.clear();
      U.tribShow = [null, null, null, null];
      U.newIds = new Set();
      render();
      const handEl = $('gd-hand');
      handEl.classList.add('dealing');
      setTimeout(() => handEl.classList.remove('dealing'), 900);
      Hub.sfx('shuffle');
      Hub.bgmTense(false);
      U.alerted = [0, 0, 0, 0];
      Hub.banner(`第 ${m.round + 1} 局 · 本局打 <b>${lvTxt(lv)}</b>${(hands[0].some(c => isWild(c, lv)) ? '<br><span style="font-size:16px">你有逢人配（红桃' + lvTxt(lv) + '）</span>' : '')}`, 1600);
      await Hub.wait(1500);

      // 进贡 / 还贡
      const tp = tributePlan(st.hands, m.lastOrder, lv);
      let leader;
      if (tp.kind === 'none') {
        leader = Math.floor(Math.random() * 4);
        Hub.banner(`首局随机：${nameOf(leader)} 先出`, 1300);
        await Hub.wait(1100);
      } else if (tp.kind === 'anti') {
        Hub.banner(`🛡️ 抗贡！${tp.payers.map(nameOf).join('、')} 手握两张大王，免进贡<br>${nameOf(tp.leader)}（头游）先出`, 2200);
        Hub.sfx('allin');
        Hub.call(nameOf(tp.payers[0]), 'kanggong');
        leader = tp.leader;
        await Hub.wait(2100);
      } else {
        U.phase = 'tribute';
        const tr = tributePays(st.hands, tp, lv, s => (s === 0 ? 2 : DIFF));
        for (const p of tr.pays) {
          moveCard(st.hands, p.from, p.to, p.card);
          if (p.to === 0) U.newIds.add(p.card.id);
          sortHand(st.hands[p.to], lv);
          U.tribShow[p.from] = { card: p.card, label: `进贡 → ${nameOf(p.to)}` };
          Hub.banner(`${nameOf(p.from)} 向 ${nameOf(p.to)} 进贡 <b>${Hub.cardText(p.card)}</b>`, 1500);
          Hub.sfx('chip');
          Hub.call(nameOf(p.from), 'jingong');
          quip(p.from, 'tribute', 0.6);
          render();
          await Hub.wait(1500);
        }
        for (const p of tr.pays) {
          let card;
          if (p.to === 0) card = await humanReturn(p.from);
          else { await Hub.wait(500); card = aiReturnCard(st.hands[p.to], lv, DIFF); }
          moveCard(st.hands, p.to, p.from, card);
          if (p.from === 0) U.newIds.add(card.id);
          sortHand(st.hands[p.from], lv);
          U.tribShow[p.to] = { card, label: `还贡 → ${nameOf(p.from)}` };
          U.phase = 'tribute';
          Hub.banner(`${nameOf(p.to)} 还给 ${nameOf(p.from)} <b>${Hub.cardText(card)}</b>`, 1400);
          Hub.sfx('chip');
          Hub.call(nameOf(p.to), 'huangong');
          render();
          await Hub.wait(1400);
        }
        leader = tr.leader;
        Hub.banner(`${nameOf(leader)} 先出牌`, 1200);
        await Hub.wait(1000);
      }
      U.tribShow = [null, null, null, null];
      st.turn = st.leader = leader;
      await playLoop();
      setTimeout(() => { U.newIds.clear(); }, 0);
      return roundOver();
    }

    async function playLoop() {
      const st = U.st;
      let firstHuman = true;
      while (!st.over) {
        const s = st.turn;
        let move;
        if (s === 0) {
          move = await humanTurn();
          if (firstHuman) { U.newIds.clear(); firstHuman = false; }
        } else {
          U.phase = 'ai';
          render();
          await Hub.wait(620 + Math.random() * 280);
          move = aiDecide(st, s, DIFF);
        }
        const tableBefore = st.table;
        act(st, move);
        U.phase = 'busy';
        if (move) {
          const bomb = isBombType(move.type);
          Hub.sfx(move.type === 'kingbomb' ? 'rocket' : bomb ? 'bomb' : move.type === 'plate' ? 'plane' : 'play');
          callPlay(s, move, !!tableBefore, st.lv);
          const left = st.hands[s].length;
          if (left > 0 && left <= 2 && (!U.alerted[s] || U.alerted[s] > left)) {
            U.alerted[s] = left;
            setTimeout(() => Hub.call(nameOf(s), 'left' + left), 750);
          }
          if (left > 0 && left <= 3) Hub.bgmTense(true);
          if (bomb) {
            if (move.type === 'kingbomb') Hub.banner(`💥 ${nameOf(s)} 打出 <b>天王炸</b>！`, 1400);
            quip(s, 'bomb', 0.7);
            if (s === 0) quip(2, 'praise', 0.5);
          } else if (tableBefore && teamOf(tableBefore.by) !== teamOf(s)) quip(s, 'beat', 0.12);
        } else {
          Hub.sfx('pass');
          Hub.call(nameOf(s), Hub.randPick(['pass1', 'pass1', 'pass3']));
          quip(s, 'pass', 0.07);
        }
        render();
        if (move && !st.hands[s].length) {
          const k = st.finished.indexOf(s);
          if (k >= 0) {
            Hub.banner(`🏁 ${nameOf(s)} 出完了 · <b>${PLACE[k]}</b>`, 1400);
            Hub.sfx(teamOf(s) === 0 ? 'win' : 'lose');
            if (k === 0) setTimeout(() => Hub.call(nameOf(s), 'touyou'), 500);
            quip(s, 'out', 0.8);
            await Hub.wait(1300);
          }
        } else await Hub.wait(move ? 260 : 140);
        if (!st.over && st.jiefeng) {
          Hub.banner(`🤝 接风！${nameOf(st.turn)} 获得出牌权`, 1300);
          Hub.call(nameOf(st.turn), 'jiefeng');
          await Hub.wait(1100);
        }
      }
      U.phase = 'idle';
      render();
    }

    /* ---------- 一局结束 ---------- */
    function roundOver() {
      const st = U.st, m = U.match;
      const res = settleRound(m, st.order);
      render();
      const meWin = res.winTeam === 0;
      Hub.bgmTense(false);
      Hub.sfx(meWin ? (res.up === 3 ? 'spring' : 'win') : 'lose');
      for (const s of [1, 2, 3]) quip(s, teamOf(s) === res.winTeam ? 'win' : 'lose', 0.45);
      const teamName = t => (t === 0 ? '我方' : '对方');
      const rows = st.order.map((s, k) => `<div class="gd-rank-row ${teamOf(s) === 0 ? 'mine' : 'opp'}"><span class="gd-place show p${k}">${PLACE[k]}</span><span>${s === 0 ? '😎 你' : PEOPLE[s].avatar + ' ' + PEOPLE[s].name}</span><span class="gd-team">${teamName(teamOf(s))}</span></div>`).join('');
      const upTxt = res.up === 3 ? '双上' : res.up === 2 ? '队友三游' : '队友末游';
      let lines = `<p>${teamName(res.winTeam)}头游（${upTxt}），升 <b>${res.up}</b> 级：${lvTxt(res.before[res.winTeam])} → <b>${lvTxt(res.after[res.winTeam])}</b></p>`;
      if (res.passA) lines = `<p>🎉 ${teamName(res.winTeam)}在打 A 的一局拿下头游，<b>成功过 A！</b></p>`;
      else if (res.failA) lines += `<p>打 A 拿了头游但队友是末游，<b>不算过 A</b>，下局继续打 A。</p>`;
      lines += `<p>当前级数：我方 <b>${lvTxt(m.levels[0])}</b> / 对方 <b>${lvTxt(m.levels[1])}</b></p>`;
      if (!m.over) {
        const o = st.order;
        const dbl = teamOf(o[0]) === teamOf(o[1]);
        const nextLv = matchLevel(m);
        lines += `<p>下局打 <b>${lvTxt(nextLv)}</b>（${teamName(m.banker)}坐庄）。`;
        lines += dbl ? `双下：${nameOf(o[2])}、${nameOf(o[3])} 各进贡一张，大的给 ${nameOf(o[0])}，小的给 ${nameOf(o[1])}。`
          : `${nameOf(o[3])} 向 ${nameOf(o[0])} 进贡一张最大的牌。`;
        lines += '（进贡方有两张大王可抗贡）</p>';
      }
      return new Promise(resolve => {
        let el = $('gd-round');
        if (!el) { el = document.createElement('div'); el.id = 'gd-round'; el.className = 'hub-overlay'; document.body.appendChild(el); }
        el.innerHTML = `<div class="hub-panel gd-round-panel">
          <h1>${meWin ? '🎉 本局我方获胜' : '😣 本局对方获胜'}</h1>
          <div class="gd-rank">${rows}</div>
          <div class="gd-round-lines">${lines}</div>
          <button class="hub-btn gold big" data-go>${m.over ? '查看结果' : '继续下一局 ▶'}</button></div>`;
        el.classList.add('show');
        const go = () => { el.classList.remove('show'); document.removeEventListener('keydown', key); Hub.sfx('click'); resolve(); };
        const key = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
        setTimeout(() => document.addEventListener('keydown', key), 400);
        el.querySelector('[data-go]').onclick = go;
      });
    }

    async function runMatch() {
      U.match = createMatch(TARGET);
      U.lv = 2;
      while (!U.match.over) await playRound();
      const m = U.match;
      const won = m.winner === 0;
      const lines = [
        `最终级数：我方 <b>${lvTxt(m.levels[0])}</b> / 对方 <b>${lvTxt(m.levels[1])}</b>`,
        `共打了 <b>${m.round}</b> 局 · 目标：${TARGET >= 14 ? '过 A' : '打到 ' + lvTxt(TARGET)}`,
      ];
      Hub.finish({ passed: won, stats: { myLevel: m.levels[0], oppLevel: m.levels[1], rounds: m.round }, lines });
    }

    /* ---------- 绑定 ---------- */
    function bind() {
      $('btn-play').onclick = tryPlay;
      $('btn-pass').onclick = doPass;
      $('btn-hint').onclick = doHint;
      $('btn-clear').onclick = () => { if (U.phase === 'return') U.sel.clear(); clearSel(); };
      $('btn-arrange').onclick = () => { U.arrange = !U.arrange; Hub.sfx('click'); render(); };
      $('btn-ret').onclick = () => doReturn(false);
      $('btn-auto-ret').onclick = () => doReturn(true);
      bindHand();
      document.addEventListener('keydown', e => {
        if (document.querySelector('.hub-overlay.show')) return;
        const k = e.key;
        if (U.phase === 'play') {
          if (k === 'Enter' || k === ' ') { e.preventDefault(); tryPlay(); }
          else if (k === 'p' || k === 'P') doPass();
          else if (k === 'h' || k === 'H') doHint();
          else if (k === 'Escape') clearSel();
        } else if (U.phase === 'return') {
          if (k === 'Enter' || k === ' ') { e.preventDefault(); doReturn(false); }
        }
      });
      let rz = null;
      window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(renderHand, 120); });
    }

    async function main() {
      buildSeats();
      bind();
      U.match = createMatch(TARGET);
      renderCenter();
      await Hub.intro({
        title: '🥚 掼蛋',
        html: `<p>两副牌 108 张，你和对家 🧔<b>老张</b> 一队，对抗 🧑‍🎤<b>小李</b> 和 👵<b>刘奶奶</b>。</p>
          <p>红桃级牌是<b>逢人配</b>，先出完拿<b>头游</b>就能升级，${TARGET >= 14 ? '率先<b>打过 A</b>' : `率先打到 <b>${lvTxt(TARGET)}</b>`} 即获胜！</p>
          <p style="font-size:14px;color:#9aa3b0">点牌 / 拖选 / 双击整列选牌 · Enter 出牌 · P 不出 · H 提示 · Esc 重选</p>`,
        button: '开始发牌 🃏',
      });
      runMatch();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
    else main();
  })();
}

/* ============================================================
   导出（Node 测试用）
   ============================================================ */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AI_CFG, FULL_DECK, TYPE_NAME,
    levelRank, isWild, natOf, pwOf, pwNat, pwLabel, levelName, sortHand, removeCards,
    isBombType, bombScore, canBeat, moveRank, patternText, analyze, resolvePlay,
    genMoves, buildPlan, bestSplit, handValue, handsCount,
    dealHands, createRound, act, nextActive, roundResult,
    createMatch, matchLevel, settleRound, tributePlan, tributeCandidates, returnCandidates, tributePays, moveCard, doTribute,
    unseenInfo, unseenCanBeat, passCaps, aiDecide, aiTributeCard, aiReturnCard, hintMoves,
    simulateRound, playMatchRound, partnerOf, teamOf,
  };
}
