/* 收集需要合成的全部语音：报牌口播（Hub.CALLS）× 用到它的音色 + 每个角色的台词。
   输出 JSON：[{ voice, text, hash }]
   用法：node tools/voice/collect.js > tools/voice/jobs.json */
'use strict';
const fs = require('fs');
const path = require('path');
const Hub = require('../../js/common.js');

const ROOT = path.join(__dirname, '..', '..');
const jobs = new Map();
function add(voice, text) {
  const key = voice + '|' + text;
  if (!jobs.has(key)) jobs.set(key, { voice, text, hash: Hub.textHash(text) });
}

// 1) 报牌口播
for (const [voice, games] of Object.entries(Hub.VOICE_GAMES)) {
  for (const c of Object.values(Hub.CALLS)) {
    if (c.games.some(g => games.includes(g))) add(voice, c.text);
  }
}

// 2) 角色台词：在游戏源码里找到 name: '角色名' 之后的那段定义，取出其中数组里的字符串
const names = Object.keys(Hub.VOICE_OF).filter(n => n !== '你' && n !== '解说');
const files = ['texas', 'doudizhu', 'douniu', 'guandan', 'bluff'].map(g => path.join(ROOT, 'js', g + '.js'));
const STR = /'((?:[^'\\\n]|\\.)*)'/g;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const marks = [];
  for (const n of names) {
    const re = new RegExp(`name:\\s*'${n}'`, 'g');
    let m;
    while ((m = re.exec(src))) marks.push({ n, at: m.index });
  }
  marks.sort((a, b) => a.at - b.at);
  marks.forEach((mk, i) => {
    let end = i + 1 < marks.length ? marks[i + 1].at : src.length;
    const close = src.indexOf('];', mk.at);   // 角色数组结束
    if (close > 0 && close < end) end = close;
    const seg = src.slice(mk.at, end);
    const arrays = seg.match(/\[[^\]]*\]/g) || [];
    for (const arr of arrays) {
      let m;
      STR.lastIndex = 0;
      while ((m = STR.exec(arr))) {
        const text = m[1];
        if (/[一-鿿]/.test(text)) add(Hub.voiceOf(mk.n), text);
      }
    }
  });
}

const out = [...jobs.values()];
process.stdout.write(JSON.stringify(out, null, 1));
const byVoice = {};
for (const j of out) byVoice[j.voice] = (byVoice[j.voice] || 0) + 1;
process.stderr.write(`共 ${out.length} 条：${JSON.stringify(byVoice)}\n`);
