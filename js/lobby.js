/* ============================================================
   棋牌大厅：自由对局（选游戏 + 难度 + 选项）与闯关地图
   ============================================================ */
'use strict';

/* 每个游戏在大厅里可调的一个选项 → 作为 URL 参数传给游戏页 */
const GAME_OPTIONS = {
  texas:    { key: 'opponents',   label: '对手人数', values: [[3, '3 人'], [4, '4 人'], [5, '5 人']], def: 5 },
  doudizhu: { key: 'rounds',      label: '局数',     values: [[4, '4 局'], [6, '6 局'], [10, '10 局']], def: 6 },
  douniu:   { key: 'rounds',      label: '局数',     values: [[8, '8 局'], [10, '10 局'], [15, '15 局']], def: 10 },
  guandan:  { key: 'targetLevel', label: '打到',     values: [[6, '打到 6'], [10, '打到 10'], [14, '过 A（完整）']], def: 14 },
  bluff:    { key: 'rounds',      label: '局数',     values: [[3, '3 局'], [5, '5 局'], [8, '8 局']], def: 5 },
};

const lobby = {
  settings: Hub.getSettings(),
  options: {},
};

function render() {
  const st = Hub.getStats();
  const total = Hub.LEVELS.length * 3;
  document.getElementById('lb-stars').innerHTML = `⭐ ${Hub.totalStars()} / ${total}`;

  // 难度
  document.getElementById('lb-diffs').innerHTML = Hub.DIFFS.map(d => `
    <button class="lb-diff diff-${d.id}${lobby.settings.difficulty === d.id ? ' on' : ''}" data-diff="${d.id}">
      <span class="i">${d.icon}</span><span class="n">${d.name}</span><span class="d">${d.desc}</span>
    </button>`).join('');

  // 游戏
  document.getElementById('lb-games').innerHTML = Object.values(Hub.GAMES).map(g => {
    const opt = GAME_OPTIONS[g.id];
    const cur = lobby.options[g.id] != null ? lobby.options[g.id] : opt.def;
    const s = st[g.id];
    return `
    <div class="lb-game">
      <div class="lb-game-icon">${g.icon}</div>
      <div class="lb-game-name">${g.name}</div>
      <div class="lb-game-players">${g.players}</div>
      <div class="lb-game-desc">${g.desc}</div>
      <div class="lb-opt">${opt.label}：${opt.values.map(([v, t]) =>
        `<button class="lb-chip${v === cur ? ' on' : ''}" data-game="${g.id}" data-val="${v}">${t}</button>`).join('')}</div>
      <div class="lb-game-stat">${s ? `已玩 ${s.played} 场 · 胜 ${s.won} 场` : '还没玩过'}</div>
      <button class="hub-btn gold big lb-play" data-play="${g.id}">开始游戏</button>
    </div>`;
  }).join('');

  // 闯关
  document.getElementById('lb-chapters').innerHTML = Hub.CHAPTERS.map(ch => {
    const levels = Hub.LEVELS.filter(l => l.chapter === ch.id);
    const got = levels.reduce((a, l) => a + Hub.levelStars(l.id), 0);
    return `
    <div class="lb-chapter">
      <div class="lb-ch-head"><span class="lb-ch-icon">${ch.icon}</span>
        <span class="lb-ch-name">第 ${ch.id} 章 · ${ch.name}</span>
        <span class="lb-ch-desc">${ch.desc}</span>
        <span class="lb-ch-stars">⭐ ${got}/${levels.length * 3}</span></div>
      <div class="lb-levels">${levels.map(l => levelCard(l)).join('')}</div>
    </div>`;
  }).join('');
}

function levelCard(l) {
  const g = Hub.GAMES[l.game];
  const d = Hub.DIFFS[Hub.diffIndex(l.diff)];
  const unlocked = Hub.isUnlocked(l.id);
  const stars = Hub.levelStars(l.id);
  return `
  <button class="lb-level${unlocked ? '' : ' locked'}${stars ? ' cleared' : ''}" data-level="${l.id}" ${unlocked ? '' : 'disabled'}>
    <div class="lb-lv-top"><span class="lb-lv-id">${l.id}</span><span class="hub-badge diff-${l.diff}">${d.icon} ${d.name}</span></div>
    <div class="lb-lv-icon">${unlocked ? g.icon : '🔒'}</div>
    <div class="lb-lv-name">${l.name}</div>
    <div class="lb-lv-game">${g.name}</div>
    <div class="lb-lv-stars">${[0, 1, 2].map(i => `<span class="${i < stars ? 'on' : ''}">★</span>`).join('')}</div>
  </button>`;
}

function showLevel(id) {
  const l = Hub.LEVELS.find(x => x.id === id);
  if (!l) return;
  const g = Hub.GAMES[l.game];
  const d = Hub.DIFFS[Hub.diffIndex(l.diff)];
  let el = document.getElementById('lb-level-modal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'lb-level-modal';
    el.className = 'hub-overlay';
    document.body.appendChild(el);
  }
  const stars = Hub.levelStars(l.id);
  el.innerHTML = `<div class="hub-panel">
    <div class="lb-modal-icon">${g.icon}</div>
    <h1>关卡 ${l.id} · ${l.name}</h1>
    <p>${g.name} · <span class="hub-badge diff-${l.diff}">${d.icon} ${d.name}</span></p>
    <div class="hub-goal">
      <div>${l.desc}</div>
      <div class="hub-goal-main">过关条件：${l.goal}</div>
      ${(l.stars || []).map(s => `<div class="hub-goal-star">⭐ ${s.text}</div>`).join('')}
    </div>
    <div class="hub-stars">${[0, 1, 2].map(i => `<span class="${i < stars ? 'on' : ''}">★</span>`).join('')}</div>
    <button class="hub-btn gold big" data-go>开始挑战</button>
    <button class="hub-btn gray big" data-close>返回</button>
  </div>`;
  el.classList.add('show');
  el.querySelector('[data-go]').onclick = () => { location.href = Hub.levelUrl(l); };
  el.querySelector('[data-close]').onclick = () => el.classList.remove('show');
  el.onclick = e => { if (e.target === el) el.classList.remove('show'); };
}

function setTab(tab) {
  document.querySelectorAll('.lb-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('.lb-pane').forEach(p => p.classList.toggle('show', p.id === 'pane-' + tab));
  try { localStorage.setItem('cardhub.lobbyTab', tab); } catch (e) { /* ignore */ }
}

function bind() {
  document.querySelectorAll('.lb-tab').forEach(b => { b.onclick = () => { Hub.sfx('click'); setTab(b.dataset.tab); }; });
  document.getElementById('lobby').addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.diff) {
      lobby.settings = Hub.saveSettings({ difficulty: t.dataset.diff });
      Hub.sfx('select');
      render();
    } else if (t.dataset.game) {
      lobby.options[t.dataset.game] = +t.dataset.val;
      Hub.sfx('select');
      render();
    } else if (t.dataset.play) {
      const id = t.dataset.play;
      const opt = GAME_OPTIONS[id];
      const v = lobby.options[id] != null ? lobby.options[id] : opt.def;
      location.href = `${Hub.GAMES[id].page}?diff=${lobby.settings.difficulty}&${opt.key}=${v}`;
    } else if (t.dataset.level) {
      Hub.sfx('click');
      showLevel(t.dataset.level);
    }
  });
  document.getElementById('lb-reset').onclick = () => {
    if (!confirm('确定要清空所有闯关星级吗？')) return;
    try { localStorage.removeItem('cardhub.progress'); } catch (e) { /* ignore */ }
    render();
  };
}

window.addEventListener('DOMContentLoaded', () => {
  bind();
  render();
  let tab = 'free';
  try { tab = localStorage.getItem('cardhub.lobbyTab') || 'free'; } catch (e) { /* ignore */ }
  setTab(tab);
});
