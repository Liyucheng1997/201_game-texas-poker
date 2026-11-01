/* ============================================================
   棋牌大厅 · 公共模块（Hub）
   难度 / 关卡 / 进度存档 / 顶栏 / 结算 / 音效 / 牌面 / 选牌
   所有游戏页面先加载本文件，再加载各自的游戏脚本。
   ============================================================ */
'use strict';
(function (root) {

  /* ---------------- 难度 ---------------- */
  const DIFFS = [
    { id: 'easy',   name: '简单', icon: '🌱', desc: '对手经常失误，适合熟悉规则' },
    { id: 'normal', name: '普通', icon: '⚔️', desc: '对手按常规思路出牌' },
    { id: 'hard',   name: '困难', icon: '🔥', desc: '对手会记牌、算概率、懂配合' },
    { id: 'master', name: '大师', icon: '👑', desc: '对手会针对你的打法建模，极少失误' },
  ];

  /* ---------------- 游戏目录 ---------------- */
  const GAMES = {
    texas:    { id: 'texas',    name: '德州扑克', icon: '♠️', page: 'texas.html',    players: '6 人桌', desc: '盲注递增的淘汰锦标赛，活到最后就是冠军' },
    doudizhu: { id: 'doudizhu', name: '斗地主',   icon: '👲', page: 'doudizhu.html', players: '3 人',   desc: '叫分抢地主，农民联手对抗地主' },
    douniu:   { id: 'douniu',   name: '斗牛',     icon: '🐮', page: 'douniu.html',   players: '5 人',   desc: '抢庄牛牛：看四张抢庄，押倍数，比牛型' },
    guandan:  { id: 'guandan',  name: '掼蛋',     icon: '🥚', page: 'guandan.html',  players: '4 人 · 2v2', desc: '两副牌，对家组队，从 2 一路打过 A' },
    bluff:    { id: 'bluff',    name: '吹牛',     icon: '🤥', page: 'bluff.html',    players: '4 人',   desc: '扣着出牌报点数，信不信由你，敢不敢开？' },
  };

  /* ---------------- 闯关关卡 ----------------
     params 覆盖游戏默认参数；stars 为额外星级条件（过关=1星，每满足一条+1星）。
     各游戏在结算时把 stats 交给 Hub.finish，由这里统一评星。 */
  const CHAPTERS = [
    { id: 1, name: '新手村',   icon: '🌱', desc: '熟悉五种玩法的基本规则' },
    { id: 2, name: '牌桌进阶', icon: '⚔️', desc: '对手开始认真了' },
    { id: 3, name: '高手过招', icon: '🔥', desc: '会记牌、会配合、会算概率的对手' },
    { id: 4, name: '大师殿堂', icon: '👑', desc: '对手会研究你的打法，还有特殊规则' },
  ];
  const LEVELS = [
    // 第一章
    { id: '1-1', chapter: 1, game: 'texas', diff: 'easy', name: '初入牌桌',
      desc: '和 3 位新手对手打一场小型锦标赛。', goal: '赢下锦标赛（成为最后的赢家）',
      params: { opponents: 3, startChips: 1500, handsPerLevel: 8 },
      stars: [{ key: 'hands', op: '<=', val: 45, text: '45 手内夺冠' }, { key: 'hands', op: '<=', val: 25, text: '25 手内夺冠' }] },
    { id: '1-2', chapter: 1, game: 'doudizhu', diff: 'easy', name: '初识地主',
      desc: '打 4 局斗地主，学会叫分、出牌和配合。', goal: '4 局后总积分 > 0',
      params: { rounds: 4, target: 1 },
      stars: [{ key: 'score', op: '>=', val: 6, text: '总积分 ≥ 6' }, { key: 'score', op: '>=', val: 12, text: '总积分 ≥ 12' }] },
    { id: '1-3', chapter: 1, game: 'douniu', diff: 'easy', name: '牛刀小试',
      desc: '抢庄牛牛 8 局，本金 1000。', goal: '8 局后筹码 ≥ 1100',
      params: { rounds: 8, startChips: 1000, target: 1100 },
      stars: [{ key: 'chips', op: '>=', val: 1300, text: '筹码 ≥ 1300' }, { key: 'chips', op: '>=', val: 1600, text: '筹码 ≥ 1600' }] },
    { id: '1-4', chapter: 1, game: 'guandan', diff: 'easy', name: '掼蛋入门',
      desc: '和电脑搭档，从 2 打到 5。', goal: '我方率先打到 5 级',
      params: { targetLevel: 5 },
      stars: [{ key: 'oppLevel', op: '<=', val: 3, text: '对手不超过 3 级' }, { key: 'rounds', op: '<=', val: 2, text: '2 局内完成' }] },
    { id: '1-5', chapter: 1, game: 'bluff', diff: 'easy', name: '初学吹牛',
      desc: '3 局吹牛，学会扣牌、报点数和开牌。', goal: '3 局后总积分 > 0',
      params: { rounds: 3, target: 1 },
      stars: [{ key: 'catches', op: '>=', val: 2, text: '抓到别人吹牛 2 次' }, { key: 'wins', op: '>=', val: 2, text: '先出完 2 局' }] },
    // 第二章
    { id: '2-1', chapter: 2, game: 'texas', diff: 'normal', name: '五人局',
      desc: '4 位对手，标准筹码。', goal: '赢下锦标赛',
      params: { opponents: 4, startChips: 2000, handsPerLevel: 8 },
      stars: [{ key: 'hands', op: '<=', val: 60, text: '60 手内夺冠' }, { key: 'hands', op: '<=', val: 35, text: '35 手内夺冠' }] },
    { id: '2-2', chapter: 2, game: 'doudizhu', diff: 'normal', name: '连战六局',
      desc: '对手会合理拆牌，不会乱出炸弹。', goal: '6 局后总积分 ≥ 6',
      params: { rounds: 6, target: 6 },
      stars: [{ key: 'score', op: '>=', val: 12, text: '总积分 ≥ 12' }, { key: 'landlordWins', op: '>=', val: 2, text: '当地主赢 2 局' }] },
    { id: '2-3', chapter: 2, game: 'douniu', diff: 'normal', name: '牛气冲天',
      desc: '10 局，对手按牌力抢庄。', goal: '10 局后筹码 ≥ 1300',
      params: { rounds: 10, startChips: 1000, target: 1300 },
      stars: [{ key: 'chips', op: '>=', val: 1600, text: '筹码 ≥ 1600' }, { key: 'chips', op: '>=', val: 2000, text: '筹码 ≥ 2000' }] },
    { id: '2-4', chapter: 2, game: 'guandan', diff: 'normal', name: '升级之路',
      desc: '从 2 打到 7，注意进贡还贡。', goal: '我方率先打到 7 级',
      params: { targetLevel: 7 },
      stars: [{ key: 'oppLevel', op: '<=', val: 4, text: '对手不超过 4 级' }, { key: 'rounds', op: '<=', val: 4, text: '4 局内完成' }] },
    { id: '2-5', chapter: 2, game: 'bluff', diff: 'normal', name: '真真假假',
      desc: '4 局，对手会按自己手里的牌算概率。', goal: '4 局后总积分 ≥ 5',
      params: { rounds: 4, target: 5 },
      stars: [{ key: 'fooled', op: '>=', val: 5, text: '成功骗过大家 5 次' }, { key: 'score', op: '>=', val: 25, text: '总积分 ≥ 25' }] },
    // 第三章
    { id: '3-1', chapter: 3, game: 'texas', diff: 'hard', name: '满桌高手',
      desc: '5 位会算胜率、会读范围的对手，盲注涨得更快。', goal: '赢下锦标赛',
      params: { opponents: 5, startChips: 2000, handsPerLevel: 7 },
      stars: [{ key: 'hands', op: '<=', val: 70, text: '70 手内夺冠' }, { key: 'hands', op: '<=', val: 45, text: '45 手内夺冠' }] },
    { id: '3-2', chapter: 3, game: 'doudizhu', diff: 'hard', name: '地主挑战',
      desc: '你每局都是地主（叫 3 分），对手会记牌、会配合。', goal: '6 局后总积分 ≥ 6',
      params: { rounds: 6, target: 6, forceLandlord: true },
      stars: [{ key: 'score', op: '>=', val: 18, text: '总积分 ≥ 18' }, { key: 'springs', op: '>=', val: 1, text: '打出 1 次春天' }] },
    { id: '3-3', chapter: 3, game: 'douniu', diff: 'hard', name: '坐庄之道',
      desc: '你固定坐庄（4 倍庄），闲家会精算押注。', goal: '10 局后筹码 ≥ 1200',
      params: { rounds: 10, startChips: 1000, target: 1200, forceBanker: true },
      stars: [{ key: 'chips', op: '>=', val: 1500, text: '筹码 ≥ 1500' }, { key: 'chips', op: '>=', val: 1900, text: '筹码 ≥ 1900' }] },
    { id: '3-4', chapter: 3, game: 'guandan', diff: 'hard', name: '十级攻坚',
      desc: '对手会记牌、会配合、会封牌。', goal: '我方率先打到 10 级',
      params: { targetLevel: 10 },
      stars: [{ key: 'oppLevel', op: '<=', val: 6, text: '对手不超过 6 级' }, { key: 'rounds', op: '<=', val: 6, text: '6 局内完成' }] },
    { id: '3-5', chapter: 3, game: 'bluff', diff: 'hard', name: '没有王牌',
      desc: '去掉大小王：每个点数只有 4 张，对手还会记牌。', goal: '5 局后总积分 ≥ 5',
      params: { rounds: 5, target: 5, noJokers: true },
      stars: [{ key: 'caught', op: '<=', val: 1, text: '吹牛被抓不超过 1 次' }, { key: 'score', op: '>=', val: 30, text: '总积分 ≥ 30' }] },
    // 第四章
    { id: '4-1', chapter: 4, game: 'texas', diff: 'master', name: '短码生存',
      desc: '5 位大师，你只有 1200 筹码而对手各 2000，盲注每 6 手上涨。', goal: '赢下锦标赛',
      params: { opponents: 5, startChips: 2000, heroChips: 1200, handsPerLevel: 6 },
      stars: [{ key: 'hands', op: '<=', val: 70, text: '70 手内夺冠' }, { key: 'hands', op: '<=', val: 45, text: '45 手内夺冠' }] },
    { id: '4-2', chapter: 4, game: 'doudizhu', diff: 'master', name: '八局鏖战',
      desc: '8 局，对手全力记牌并推算你的手牌。', goal: '8 局后总积分 ≥ 12',
      params: { rounds: 8, target: 12 },
      stars: [{ key: 'score', op: '>=', val: 24, text: '总积分 ≥ 24' }, { key: 'landlordWins', op: '>=', val: 3, text: '当地主赢 3 局' }] },
    { id: '4-3', chapter: 4, game: 'douniu', diff: 'master', name: '牛魔王',
      desc: '12 局，对手会根据你的抢庄、押注习惯调整策略。', goal: '12 局后筹码 ≥ 1500',
      params: { rounds: 12, startChips: 1000, target: 1500 },
      stars: [{ key: 'chips', op: '>=', val: 2000, text: '筹码 ≥ 2000' }, { key: 'chips', op: '>=', val: 2600, text: '筹码 ≥ 2600' }] },
    { id: '4-4', chapter: 4, game: 'guandan', diff: 'master', name: '过 A 封神',
      desc: '完整一局掼蛋，从 2 打过 A。', goal: '我方率先打过 A',
      params: { targetLevel: 14 },
      stars: [{ key: 'oppLevel', op: '<=', val: 8, text: '对手不超过 8 级' }, { key: 'rounds', op: '<=', val: 9, text: '9 局内完成' }] },
    { id: '4-5', chapter: 4, game: 'bluff', diff: 'master', name: '谎言之王',
      desc: '6 局，对手会统计你说谎和开牌的习惯并针对你。', goal: '6 局后总积分 ≥ 10',
      params: { rounds: 6, target: 10 },
      stars: [{ key: 'wins', op: '>=', val: 3, text: '先出完 3 局' }, { key: 'score', op: '>=', val: 40, text: '总积分 ≥ 40' }] },
  ];

  /* ---------------- 存档 ---------------- */
  const KEY_SETTINGS = 'cardhub.settings';
  const KEY_PROGRESS = 'cardhub.progress';
  const KEY_STATS = 'cardhub.stats';
  function load(key, def) {
    try {
      const v = JSON.parse(root.localStorage.getItem(key));
      return v && typeof v === 'object' ? Object.assign(def, v) : def;
    } catch (e) { return def; }
  }
  function save(key, val) {
    try { root.localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 隐私模式等情况下忽略 */ }
  }
  function getSettings() { return load(KEY_SETTINGS, { difficulty: 'normal', muted: false, fast: false }); }
  function saveSettings(patch) { const s = Object.assign(getSettings(), patch); save(KEY_SETTINGS, s); return s; }
  function getProgress() { return load(KEY_PROGRESS, { stars: {} }); }
  function levelStars(id) { return getProgress().stars[id] || 0; }
  function isUnlocked(id) {
    const i = LEVELS.findIndex(l => l.id === id);
    if (i <= 0 || levelStars(LEVELS[i - 1].id) > 0) return true;
    // 版本更新插入了新关卡时，已经打到后面的存档不应被重新锁住
    return LEVELS.slice(i).some(l => levelStars(l.id) > 0);
  }
  function totalStars() { return Object.values(getProgress().stars).reduce((a, b) => a + b, 0); }
  function getStats() { return load(KEY_STATS, {}); }
  function recordStat(game, won) {
    const all = getStats();
    const s = all[game] || { played: 0, won: 0 };
    s.played++;
    if (won) s.won++;
    all[game] = s;
    save(KEY_STATS, all);
  }

  function diffIndex(id) { const i = DIFFS.findIndex(d => d.id === id); return i < 0 ? 1 : i; }
  function levelUrl(level) { return `${GAMES[level.game].page}?level=${encodeURIComponent(level.id)}`; }
  function nextLevel(id) { const i = LEVELS.findIndex(l => l.id === id); return i >= 0 ? LEVELS[i + 1] || null : null; }

  function evalStars(level, passed, stats) {
    if (!passed) return 0;
    let n = 1;
    for (const r of level.stars || []) {
      const v = stats[r.key];
      if (typeof v !== 'number') continue;
      if ((r.op === '>=' && v >= r.val) || (r.op === '<=' && v <= r.val)) n++;
    }
    return Math.min(3, n);
  }

  /* ---------------- 通用工具 ---------------- */
  function shuffle(a, rng) {
    const rand = rng || Math.random;
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }
  function randPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function randInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* 牌的统一表示：{ id, r, s }
     r: 1=A, 2..10, 11=J, 12=Q, 13=K, 14=小王, 15=大王
     s: 0♠ 1♥ 2♦ 3♣，4=王
     id: 唯一字符串（多副牌时也唯一） */
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANK_LABEL = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
  function rankLabel(r) { return RANK_LABEL[r] || String(r); }
  function makeDeck(opts) {
    const o = Object.assign({ decks: 1, jokers: true }, opts);
    const d = [];
    for (let k = 0; k < o.decks; k++) {
      for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) d.push({ id: `${k}-${s}-${r}`, r, s });
      if (o.jokers) { d.push({ id: `${k}-4-14`, r: 14, s: 4 }); d.push({ id: `${k}-4-15`, r: 15, s: 4 }); }
    }
    return d;
  }
  function cardText(c) {
    if (c.s === 4) return c.r === 15 ? '大王' : '小王';
    return SUITS[c.s] + rankLabel(c.r);
  }

  const Hub = {
    DIFFS, GAMES, CHAPTERS, LEVELS, SUITS,
    getSettings, saveSettings, getProgress, levelStars, isUnlocked, totalStars, getStats, recordStat,
    diffIndex, levelUrl, nextLevel, evalStars,
    shuffle, sleep, randPick, randInt, clamp, rankLabel, makeDeck, cardText,
    ctx: null,
  };

  /* 按速度设置缩放的等待（AI 出牌节奏统一用它） */
  Hub.wait = function (ms) {
    const fast = Hub.ctx ? Hub.ctx.fast : getSettings().fast;
    return sleep(fast ? ms * 0.45 : ms);
  };

  /* ---------------- 页面初始化 ----------------
     opts: { game, defaults: {参数默认值}, rules: '规则HTML', onToggleMute? }
     URL: ?diff=hard&rounds=8   或   ?level=2-3
     返回 ctx: { game, mode:'free'|'level', level, difficulty, diffIndex, diff, params, fast, muted } */
  Hub.init = function (opts) {
    const q = new URLSearchParams(root.location ? root.location.search : '');
    const settings = getSettings();
    let level = null;
    if (q.get('level')) level = LEVELS.find(l => l.id === q.get('level') && l.game === opts.game) || null;
    let difficulty = level ? level.diff : (q.get('diff') || settings.difficulty);
    if (!DIFFS.some(d => d.id === difficulty)) difficulty = 'normal';
    const defaults = opts.defaults || {};
    const params = Object.assign({}, defaults);
    if (!level) {
      for (const k of Object.keys(defaults)) {
        if (!q.has(k)) continue;
        const raw = q.get(k), d = defaults[k];
        params[k] = typeof d === 'number' ? (Number.isFinite(+raw) ? +raw : d)
          : typeof d === 'boolean' ? (raw === '1' || raw === 'true') : raw;
      }
    } else Object.assign(params, level.params);
    const di = diffIndex(difficulty);
    Hub.ctx = {
      game: opts.game, mode: level ? 'level' : 'free', level,
      difficulty, diffIndex: di, diff: DIFFS[di], params,
      fast: !!settings.fast, muted: !!settings.muted,
    };
    if (typeof document !== 'undefined') { buildChrome(opts); ensureManifest(); }
    return Hub.ctx;
  };

  /* ============================================================
     声音：真人克隆配音（每个角色一个音色）+ 采样音效 + 背景音乐
     资源由 tools/voice/gen_voices.py、tools/audio/make_audio.py 生成到 audio/ 下；
     缺少资源时自动退回 WebAudio 合成音，保证不报错。
     ============================================================ */

  /* 音色（生成参数见 tools/voice/gen_voices.py） */
  const VOICES = {
    hero:    '你（热血青年）',
    host:    '解说',
    m_young: '年轻男声',
    m_old:   '老练男声',
    m_wild:  '嚣张男声',
    m_deep:  '低沉男声',
    f_young: '活泼女声',
    f_old:   '慈祥奶奶',
  };
  /* 角色 → 音色 */
  const VOICE_OF = {
    '你': 'hero', '解说': 'host',
    // 德州扑克
    '老狐狸': 'm_old', '疯狗阿豪': 'm_wild', '石头哥': 'm_deep', '教授': 'm_old', '甜甜': 'f_young',
    // 斗地主
    '老王': 'm_old', '小美': 'f_young', '阿强': 'm_wild',
    // 斗牛
    '牛大哥': 'm_deep', '狮子王': 'm_wild', '团团': 'f_young', '猫头鹰': 'm_old', '狐小妹': 'f_young',
    '虎哥': 'm_wild', '呱呱': 'm_young', '猴老三': 'm_wild', '龙少': 'm_young', '兔兔': 'f_young',
    // 掼蛋
    '小李': 'm_young', '老张': 'm_old', '刘奶奶': 'f_old',
    // 吹牛
    '大嘴': 'm_wild', '老周': 'm_old', '小雅': 'f_young', '闷葫芦': 'm_deep', '王婶': 'f_old',
  };
  /* 每个音色会出现在哪些游戏里（只为用得到的组合生成语音） */
  const VOICE_GAMES = {
    hero: ['texas', 'doudizhu', 'douniu', 'guandan', 'bluff'], host: ['host'],
    m_old: ['texas', 'doudizhu', 'douniu', 'guandan', 'bluff'], m_wild: ['texas', 'doudizhu', 'douniu', 'bluff'],
    m_deep: ['texas', 'douniu', 'bluff'], f_young: ['texas', 'doudizhu', 'douniu', 'bluff'],
    m_young: ['douniu', 'guandan'], f_old: ['guandan', 'bluff'],
  };

  /* 报牌 / 行动口播：key → { text, games } */
  const CALLS = {};
  const RANK_WORD = { 1: 'A', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '七', 8: '八', 9: '九', 10: '十', 11: 'J', 12: 'Q', 13: 'K', 14: '小王', 15: '大王' };
  function addCall(key, text, games) { CALLS[key] = { text, games }; }
  (function buildCalls() {
    const CARD = ['doudizhu', 'guandan'];
    for (let r = 1; r <= 15; r++) {
      addCall('s' + r, RANK_WORD[r] + '！', CARD);
      addCall('p' + r, '对' + RANK_WORD[r] + '！', r >= 14 ? ['guandan'] : CARD);
      if (r <= 13) addCall('t' + r, '三个' + RANK_WORD[r] + '！', CARD);
    }
    [['sandaiyi', '三带一！'], ['sandaidui', '三带一对！'], ['liandui', '连对！'],
      ['feiji', '飞机！'], ['sidaier', '四带二！'], ['wangzha', '王炸！！'], ['chuntian', '春天！'],
      ['fanchun', '反春！'], ['bid0', '不叫'], ['bid1', '一分！'], ['bid2', '两分！'], ['bid3', '三分！'],
      ['dizhu', '地主是我的了！']].forEach(([k, t]) => addCall(k, t, ['doudizhu']));
    [['sandaier', '三带二！'], ['sanliandui', '三连对！'], ['gangban', '钢板！'], ['tonghuashun', '同花顺！'],
      ['tianwangzha', '天王炸！！'], ['jingong', '进贡'], ['huangong', '还贡'], ['kanggong', '抗贡！'],
      ['jiefeng', '接风！'], ['touyou', '头游！']].forEach(([k, t]) => addCall(k, t, ['guandan']));
    // 斗地主、掼蛋共用
    [['shunzi', '顺子！'], ['zhadan', '炸弹！'], ['pass1', '不要'], ['pass2', '要不起'], ['pass3', '过！'],
      ['beat1', '大你！'], ['beat2', '管上！'], ['beat3', '压死！'],
      ['left1', '我只剩一张牌啦！'], ['left2', '我只剩两张牌啦！']].forEach(([k, t]) => addCall(k, t, CARD));
    // 斗牛
    ['不抢', '抢一倍！', '抢两倍！', '抢三倍！', '抢四倍！'].forEach((t, i) => addCall('grab' + i, t, ['douniu']));
    [[1, '押一倍'], [2, '押两倍！'], [3, '押三倍！'], [5, '押五倍！']].forEach(([m, t]) => addCall('bet' + m, t, ['douniu']));
    ['没牛', '牛一', '牛二', '牛三', '牛四', '牛五', '牛六', '牛七！', '牛八！', '牛九！', '牛牛！！']
      .forEach((t, i) => addCall('niu' + i, t, ['douniu']));
    [['wuhua', '五花牛！！'], ['zhadanniu', '炸弹牛！！'], ['wuxiao', '五小牛！！'], ['zuozhuang', '我坐庄！']]
      .forEach(([k, t]) => addCall(k, t, ['douniu']));
    // 德州扑克
    [['check', '过牌'], ['call', '跟注'], ['raise', '加注！'], ['bet', '下注！'], ['allin', '全下！梭哈！'], ['fold', '弃牌'],
      ['h_royal', '皇家同花顺！！'], ['h_sf', '同花顺！！'], ['h_quads', '四条！'], ['h_fh', '葫芦！'], ['h_flush', '同花！'],
      ['h_straight', '顺子！'], ['h_trips', '三条！'], ['h_two', '两对！'], ['h_pair', '一对'], ['h_high', '高牌']]
      .forEach(([k, t]) => addCall(k, t, ['texas']));
    // 吹牛：报牌“三张K！”、过、开牌
    const NUM_WORD = ['', '一', '两', '三', '四'];
    for (let n = 1; n <= 4; n++) for (let r = 1; r <= 13; r++) addCall(`bf_${n}_${r}`, NUM_WORD[n] + '张' + RANK_WORD[r] + '！', ['bluff']);
    [['bf_pass', '过！'], ['bf_kai1', '开！我不信！'], ['bf_kai2', '你在吹牛！'], ['bf_kai3', '我不信，开牌！'],
      ['bf_left1', '我只剩一张牌啦！'], ['bf_left2', '我只剩两张牌啦！']].forEach(([k, t]) => addCall(k, t, ['bluff']));
    // 解说
    [['bf_liar', '是假的！吹牛被抓！'], ['bf_truth', '是真的！质疑失败！'],
      ['flop', '翻牌！'], ['turn', '转牌！'], ['river', '河牌！'], ['showdown', '摊牌！'], ['allin_duel', '全下对决！'],
      ['blinds_up', '盲注上涨！'], ['start', '牌局开始！'], ['win_game', '漂亮！你赢了！'], ['lose_game', '别灰心，再来一局！'],
      ['level_clear', '挑战成功！'], ['level_fail', '挑战失败，再来一次！'], ['tongsha', '庄家通杀！'], ['tongpei', '庄家通赔！'],
      ['chuntian_host', '春天！'], ['bomb_host', '炸弹！翻倍！'], ['champion', '冠军诞生！']]
      .forEach(([k, t]) => addCall(k, t, ['host']));
  })();

  /* FNV-1a 32 位哈希：文本 → 语音文件名（与 Python 生成器一致） */
  function textHash(text) {
    const bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text) : Buffer.from(text, 'utf8');
    let h = 0x811c9dc5;
    for (const b of bytes) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  const SFX_FILES = ['deal', 'shuffle', 'click', 'select', 'chip', 'chips', 'coin', 'play', 'pass', 'error', 'allin',
    'bomb', 'rocket', 'plane', 'spring', 'reveal', 'win', 'lose', 'victory', 'gameover', 'tick', 'whoosh'];
  const SFX_ALIAS = { fold: 'pass' };
  const BGM_FILES = ['texas', 'folk', 'tense'];
  const GAME_BGM = { texas: 'texas', doudizhu: 'folk', douniu: 'folk', guandan: 'folk', bluff: 'folk' };

  Object.assign(Hub, { VOICES, VOICE_OF, VOICE_GAMES, CALLS, RANK_WORD, textHash, SFX_FILES, BGM_FILES, GAME_BGM });

  function soundSettings() {
    const s = getSettings();
    return {
      muted: Hub.ctx ? Hub.ctx.muted : !!s.muted,
      voice: s.voice !== false, bgm: s.bgm !== false,
    };
  }

  /* ---------- 采样播放（HTMLAudio：file:// 双击打开也能用） ---------- */
  const sampleCache = {};
  const missing = new Set();
  function playFile(url, vol) {
    if (typeof Audio === 'undefined' || missing.has(url)) return null;
    let base = sampleCache[url];
    if (!base) {
      base = new Audio(url);
      base.preload = 'auto';
      base.addEventListener('error', () => missing.add(url));
      sampleCache[url] = base;
    }
    // 已加载过的采样复制一份播放，允许同一音效重叠
    const a = base.readyState >= 2 && !base.paused ? base.cloneNode() : base;
    a.volume = Math.max(0, Math.min(1, vol));
    try { a.currentTime = 0; } catch (e) { /* 尚未加载 */ }
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
    return a;
  }
  // 预加载常用音效，避免第一次播放的延迟
  Hub.preloadSfx = function () {
    if (typeof Audio === 'undefined') return;
    for (const n of SFX_FILES) {
      const url = `audio/sfx/${n}.mp3`;
      if (sampleCache[url]) continue;
      const a = new Audio(url);
      a.preload = 'auto';
      a.addEventListener('error', () => missing.add(url));
      sampleCache[url] = a;
    }
  };

  /* ---------- WebAudio 合成兜底 ---------- */
  let audioCtx = null;
  function beep(freq, dur, type, gain, when) {
    if (soundSettings().muted) return;
    try {
      if (!audioCtx) audioCtx = new (root.AudioContext || root.webkitAudioContext)();
      const t = audioCtx.currentTime + (when || 0);
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(gain || 0.08, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t); o.stop(t + dur);
    } catch (e) { /* 无音频环境 */ }
  }
  function beepFallback(name) {
    switch (name) {
      case 'deal': case 'shuffle': beep(880, 0.06, 'triangle', 0.05); break;
      case 'click': case 'select': case 'tick': beep(1000, 0.03, 'triangle', 0.03); break;
      case 'chip': case 'chips': case 'coin': beep(520, 0.05, 'square', 0.04); beep(660, 0.05, 'square', 0.04, 0.06); break;
      case 'play': case 'reveal': case 'whoosh': beep(420, 0.07, 'triangle', 0.07); break;
      case 'pass': beep(180, 0.12, 'sine', 0.05); break;
      case 'error': beep(160, 0.1, 'square', 0.05); break;
      case 'bomb': case 'rocket': case 'allin': case 'plane': [90, 70, 55].forEach((f, i) => beep(f, 0.22, 'sawtooth', 0.12, i * 0.08)); break;
      case 'win': case 'spring': case 'victory': [523, 659, 784].forEach((f, i) => beep(f, 0.15, 'triangle', 0.08, i * 0.1)); break;
      case 'lose': case 'gameover': [392, 330, 262].forEach((f, i) => beep(f, 0.18, 'sine', 0.07, i * 0.14)); break;
    }
  }

  const SFX_VOL = { click: 0.5, select: 0.45, tick: 0.5, deal: 0.7, pass: 0.6, error: 0.6 };
  Hub.sfx = function (name) {
    if (typeof document === 'undefined' || soundSettings().muted) return;
    const n = SFX_ALIAS[name] || name;
    if (!SFX_FILES.includes(n)) return;
    const url = `audio/sfx/${n}.mp3`;
    if (missing.has(url) || !playFile(url, SFX_VOL[n] || 0.85)) beepFallback(n);
  };

  /* ---------- 配音 ----------
     同一时间只说一句：解说(3) > 报牌(2) > 台词(1)。高优先级打断低优先级；
     台词遇到别人正在说话就排队，等那句说完再说（最多等 1.6 秒）。 */
  let speech = null, pendingQuip = null;
  let manifestRequested = false;
  function ensureManifest() {
    if (manifestRequested || typeof document === 'undefined') return;
    manifestRequested = true;
    if (root.HUB_VOICE_MANIFEST) return;
    const sc = document.createElement('script');
    sc.src = 'js/voice-manifest.js?v=' + Date.now().toString(36).slice(0, 6);
    document.head.appendChild(sc);
  }
  Hub.voiceOf = function (speaker) { return VOICE_OF[speaker] || 'm_young'; };
  function hasVoice(v, h) {
    const m = root.HUB_VOICE_MANIFEST;
    return !!(m && m[v] && m[v].indexOf(h) >= 0);
  }
  function speechBusy() { return speech && !speech.audio.paused && !speech.audio.ended; }

  /* speaker: 角色名（决定音色）；text: 要说的话（必须是生成过的文本，否则静默跳过） */
  Hub.speak = function (speaker, text, opts) {
    const o = opts || {};
    const ss = soundSettings();
    if (typeof document === 'undefined' || ss.muted || !ss.voice || !text) return false;
    ensureManifest();
    const v = o.voice || Hub.voiceOf(speaker);
    const h = textHash(text);
    if (!hasVoice(v, h)) return false;
    const pri = o.priority || 1;
    if (speechBusy()) {
      if (speech.pri > pri || (pri === 1 && speech.pri === 1)) {
        if (pri === 1) pendingQuip = { speaker, text, opts: o, until: Date.now() + 1600 };
        return false;
      }
      speech.audio.pause();
    }
    const a = playFile(`audio/voice/${v}/${h}.mp3`, o.volume || 1);
    if (!a) return false;
    speech = { audio: a, pri };
    a.addEventListener('ended', () => {
      const q = pendingQuip;
      pendingQuip = null;
      if (q && Date.now() < q.until) Hub.speak(q.speaker, q.text, q.opts);
    }, { once: true });
    return true;
  };
  /* 报牌 / 行动口播：key 见 Hub.CALLS */
  Hub.call = function (speaker, key) {
    const c = CALLS[key];
    return c ? Hub.speak(speaker, c.text, { priority: 2 }) : false;
  };
  /* 解说员口播 */
  Hub.announce = function (key) {
    const c = CALLS[key];
    return c ? Hub.speak('解说', c.text, { priority: 3, voice: 'host' }) : false;
  };

  /* ---------- 背景音乐 ---------- */
  let bgmEl = null, bgmName = null;
  Hub.bgm = function (name) {
    if (typeof document === 'undefined') return;
    if (name !== undefined) bgmName = name;
    const ss = soundSettings();
    if (!bgmName || ss.muted || !ss.bgm) { if (bgmEl) bgmEl.pause(); return; }
    const url = `audio/bgm/${bgmName}.mp3`;
    if (!bgmEl || bgmEl.dataset.name !== bgmName) {
      if (bgmEl) bgmEl.pause();
      bgmEl = new Audio(url);
      bgmEl.dataset.name = bgmName;
      bgmEl.loop = true;
      bgmEl.volume = 0.3;
    }
    const p = bgmEl.play();
    if (p && p.catch) p.catch(() => {});
  };
  /* 紧张时刻（有人快出完 / 全下对决）切到更快的配乐，结束后切回 */
  Hub.bgmTense = function (on) {
    if (!Hub.ctx) return;
    const target = on ? 'tense' : GAME_BGM[Hub.ctx.game];
    if (target !== bgmName) Hub.bgm(target);
  };

  /* ---------------- 牌面 HTML ----------------
     opts: { cls: 额外类名, wild: 是否百搭牌(掼蛋逢人配), sel: 是否选中, hl: 高亮, back: 背面 } */
  Hub.cardHTML = function (c, opts) {
    const o = opts || {};
    if (o.back || !c) return `<div class="pk back ${o.cls || ''}"></div>`;
    const cls = ['pk'];
    if (c.s === 4) cls.push('joker', c.r === 15 ? 'big red' : 'small');
    else if (c.s === 1 || c.s === 2) cls.push('red');
    if (o.wild) cls.push('wild');
    if (o.sel) cls.push('sel');
    if (o.hl) cls.push('hl');
    if (o.cls) cls.push(o.cls);
    const data = ` data-id="${c.id}"`;
    if (c.s === 4) {
      return `<div class="${cls.join(' ')}"${data}><span class="tl jk">JOKER</span><span class="ctr">${c.r === 15 ? '🃏' : '🂿'}</span></div>`;
    }
    const lab = rankLabel(c.r), suit = SUITS[c.s];
    return `<div class="${cls.join(' ')}"${data}><span class="tl"><b>${lab}</b><i>${suit}</i></span><span class="ctr">${suit}</span>${o.wild ? '<span class="wild-tag">配</span>' : ''}</div>`;
  };

  /* ---------------- 手牌点选 / 拖选 ----------------
     container 内的 .pk[data-id] 可点击切换；按住拖过多张一次性切换。
     onToggle(ids[]) 由游戏自己维护选中集合并重新渲染。 */
  Hub.enableHandSelect = function (container, onToggle) {
    let dragging = false, startId = null, ids = [];
    const cardAt = (x, y) => {
      const el = document.elementFromPoint(x, y);
      const card = el && el.closest('.pk[data-id]');
      return card && container.contains(card) ? card : null;
    };
    const orderOf = () => Array.from(container.querySelectorAll('.pk[data-id]')).map(e => e.dataset.id);
    const mark = () => {
      container.querySelectorAll('.pk.drag').forEach(e => e.classList.remove('drag'));
      for (const id of ids) {
        const e = container.querySelector(`.pk[data-id="${CSS.escape(id)}"]`);
        if (e) e.classList.add('drag');
      }
    };
    container.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const card = cardAt(e.clientX, e.clientY);
      if (!card) return;
      e.preventDefault();
      dragging = true;
      startId = card.dataset.id;
      ids = [startId];
      mark();
    });
    root.addEventListener('pointermove', e => {
      if (!dragging) return;
      const card = cardAt(e.clientX, e.clientY);
      if (!card) return;
      const order = orderOf();
      const a = order.indexOf(startId), b = order.indexOf(card.dataset.id);
      if (a < 0 || b < 0) return;
      ids = order.slice(Math.min(a, b), Math.max(a, b) + 1);
      mark();
    });
    root.addEventListener('pointerup', () => {
      if (!dragging) return;
      dragging = false;
      const out = ids;
      ids = [];
      mark();
      if (out.length) { Hub.sfx('select'); onToggle(out); }
    });
    // 右键清空选择
    container.addEventListener('contextmenu', e => { e.preventDefault(); onToggle(null); });
  };

  /* ---------------- 横幅 / 气泡 / 提示 ---------------- */
  let bannerTimer = null;
  Hub.banner = function (text, ms) {
    const el = document.getElementById('hub-banner');
    if (!el) return;
    el.innerHTML = text;
    el.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.classList.remove('show'), ms || 1800);
  };
  // target: 元素（气泡显示在其上方）；speaker: 角色名，给出时用该角色的声音念出来
  Hub.bubble = function (target, text, ms, speaker) {
    if (speaker) Hub.speak(speaker, text);
    if (!target) return;
    const r = target.getBoundingClientRect();
    const b = document.createElement('div');
    b.className = 'hub-bubble';
    b.textContent = text;
    b.style.left = (r.left + r.width / 2) + 'px';
    b.style.top = Math.max(60, r.top - 6) + 'px';
    document.body.appendChild(b);
    setTimeout(() => b.classList.add('fade'), (ms || 2200));
    setTimeout(() => b.remove(), (ms || 2200) + 800);
  };
  let toastTimer = null;
  Hub.toast = function (text, ms) {
    const el = document.getElementById('hub-toast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms || 1600);
  };
  // 顶栏右侧的实时信息（第几局 / 积分 等）
  Hub.setInfo = function (html) {
    const el = document.getElementById('hub-info');
    if (el && el.innerHTML !== html) el.innerHTML = html;
  };

  /* ---------------- 弹窗 ---------------- */
  function overlay(id, innerHTML) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.className = 'hub-overlay';
      document.body.appendChild(el);
    }
    el.innerHTML = `<div class="hub-panel">${innerHTML}</div>`;
    el.classList.add('show');
    return el;
  }
  Hub.closeOverlay = function (id) { const el = document.getElementById(id); if (el) el.classList.remove('show'); };
  Hub.showRules = function () {
    const el = overlay('hub-rules', `<h2>📖 ${GAMES[Hub.ctx.game].name} 玩法</h2><div class="hub-rules-body">${Hub._rules || ''}</div><button class="hub-btn gold big" data-close>明白了</button>`);
    el.querySelector('[data-close]').onclick = () => Hub.closeOverlay('hub-rules');
  };

  /* 开局说明弹窗：intro = { title, html, button } → Promise（点击开始后 resolve） */
  Hub.intro = function (intro) {
    return new Promise(resolve => {
      const ctx = Hub.ctx;
      const lvl = ctx.level;
      const goal = lvl ? `<div class="hub-goal"><div class="hub-goal-title">🎯 关卡 ${lvl.id} · ${lvl.name}</div><div>${lvl.desc}</div><div class="hub-goal-main">过关条件：${lvl.goal}</div>${(lvl.stars || []).map(s => `<div class="hub-goal-star">⭐ ${s.text}</div>`).join('')}</div>` : '';
      const el = overlay('hub-intro', `<h1>${intro.title}</h1>${goal}<div class="hub-intro-body">${intro.html || ''}</div>
        <div class="hub-diff-line">难度：<b>${ctx.diff.icon} ${ctx.diff.name}</b> · <span>${ctx.diff.desc}</span></div>
        <button class="hub-btn gold big" data-go>${intro.button || '开始游戏'}</button>`);
      el.querySelector('[data-go]').onclick = () => {
        Hub.closeOverlay('hub-intro');
        // 浏览器要求用户点击后才能播放声音：在这里启动背景音乐和开场口播
        Hub.preloadSfx();
        Hub.bgm(GAME_BGM[ctx.game]);
        Hub.sfx('shuffle');
        Hub.announce('start');
        resolve();
      };
    });
  };

  /* ---------------- 结算 ----------------
     res: { passed: bool(是否胜利/过关), stats: {..数值..}, title, lines: [文本] } */
  Hub.finish = function (res) {
    const ctx = Hub.ctx;
    const lvl = ctx.level;
    recordStat(ctx.game, !!res.passed);
    let starsHTML = '', btns = '';
    if (lvl) {
      const stars = evalStars(lvl, res.passed, res.stats || {});
      const prog = getProgress();
      const prev = prog.stars[lvl.id] || 0;
      if (stars > prev) { prog.stars[lvl.id] = stars; save(KEY_PROGRESS, prog); }
      starsHTML = `<div class="hub-stars">${[0, 1, 2].map(i => `<span class="${i < stars ? 'on' : ''}">★</span>`).join('')}</div>
        <div class="hub-star-rules">${(lvl.stars || []).map(s => {
          const v = (res.stats || {})[s.key];
          const ok = res.passed && typeof v === 'number' && ((s.op === '>=' && v >= s.val) || (s.op === '<=' && v <= s.val));
          return `<div class="${ok ? 'ok' : ''}">${ok ? '✅' : '⬜'} ${s.text}</div>`;
        }).join('')}</div>`;
      const nx = nextLevel(lvl.id);
      if (res.passed && nx) btns += `<button class="hub-btn gold big" data-act="next">下一关：${nx.id} ${nx.name} ▶</button>`;
      btns += `<button class="hub-btn ${res.passed ? 'gray' : 'gold'} big" data-act="retry">${res.passed ? '再挑战一次' : '重新挑战'}</button>`;
    } else {
      btns += `<button class="hub-btn gold big" data-act="retry">再来一局 🔄</button>`;
    }
    btns += `<button class="hub-btn gray big" data-act="lobby">返回大厅</button>`;
    const title = res.title || (res.passed ? (lvl ? '🎉 挑战成功！' : '🏆 你赢了！') : (lvl ? '💀 挑战失败' : '💀 你输了'));
    const el = overlay('hub-result', `<h1>${title}</h1>${starsHTML}<div class="hub-result-lines">${(res.lines || []).map(l => `<p>${l}</p>`).join('')}</div><div class="hub-result-btns">${btns}</div>`);
    el.querySelectorAll('[data-act]').forEach(b => {
      b.onclick = () => {
        const act = b.dataset.act;
        if (act === 'next') root.location.href = levelUrl(nextLevel(lvl.id));
        else if (act === 'retry') root.location.reload();
        else root.location.href = 'index.html';
      };
    });
    Hub.sfx(res.passed ? 'victory' : 'gameover');
    Hub.bgm(null);
    setTimeout(() => Hub.announce(lvl ? (res.passed ? 'level_clear' : 'level_fail') : (res.passed ? 'win_game' : 'lose_game')), 600);
  };

  /* ---------------- 顶栏 & 公共节点 ---------------- */
  function buildChrome(opts) {
    Hub._rules = opts.rules || '';
    const ctx = Hub.ctx;
    const g = GAMES[ctx.game];
    const bar = document.createElement('div');
    bar.id = 'hub-top';
    const lvl = ctx.level;
    const st0 = getSettings();
    const voiceOff = st0.voice === false, bgmOff = st0.bgm === false;
    bar.innerHTML = `
      <a class="hub-top-btn" href="index.html" title="返回大厅">🏠 大厅</a>
      <div class="hub-top-title">${g.icon} ${g.name}</div>
      <span class="hub-badge diff-${ctx.difficulty}">${ctx.diff.icon} ${ctx.diff.name}</span>
      ${lvl ? `<span class="hub-badge level" title="${lvl.desc}">🎯 ${lvl.id} ${lvl.name} · ${lvl.goal}</span>` : ''}
      <div class="hub-top-info" id="hub-info"></div>
      <button class="hub-top-btn" id="hub-fast" title="加快 AI 出牌节奏">${ctx.fast ? '⏩ 快速' : '▶ 正常'}</button>
      <button class="hub-top-btn${voiceOff ? ' off' : ''}" id="hub-voice" title="真人配音开关">🗣️ 配音</button>
      <button class="hub-top-btn${bgmOff ? ' off' : ''}" id="hub-bgm" title="背景音乐开关">🎵 音乐</button>
      <button class="hub-top-btn" id="hub-mute" title="全部声音开关">${ctx.muted ? '🔇' : '🔊'}</button>
      <button class="hub-top-btn" id="hub-rules-btn">📖 规则</button>`;
    document.body.prepend(bar);
    document.body.classList.add('hub-page');
    for (const id of ['hub-banner', 'hub-toast']) {
      if (!document.getElementById(id)) {
        const d = document.createElement('div');
        d.id = id;
        document.body.appendChild(d);
      }
    }
    bar.querySelector('#hub-mute').onclick = e => {
      ctx.muted = !ctx.muted;
      saveSettings({ muted: ctx.muted });
      e.currentTarget.textContent = ctx.muted ? '🔇' : '🔊';
      if (opts.onToggleMute) opts.onToggleMute(ctx.muted);
      Hub.bgm();
    };
    bar.querySelector('#hub-voice').onclick = e => {
      const on = getSettings().voice === false;
      saveSettings({ voice: on });
      e.currentTarget.classList.toggle('off', !on);
      if (on) Hub.call('你', 'start') || Hub.announce('start');
    };
    bar.querySelector('#hub-bgm').onclick = e => {
      const on = getSettings().bgm === false;
      saveSettings({ bgm: on });
      e.currentTarget.classList.toggle('off', !on);
      Hub.bgm();
    };
    bar.querySelector('#hub-fast').onclick = e => {
      ctx.fast = !ctx.fast;
      saveSettings({ fast: ctx.fast });
      e.currentTarget.textContent = ctx.fast ? '⏩ 快速' : '▶ 正常';
    };
    bar.querySelector('#hub-rules-btn').onclick = Hub.showRules;
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') ['hub-rules'].forEach(Hub.closeOverlay);
    });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = Hub;
  root.Hub = Hub;
})(typeof window !== 'undefined' ? window : globalThis);
