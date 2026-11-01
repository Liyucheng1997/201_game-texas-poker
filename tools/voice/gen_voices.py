"""批量生成游戏配音（F5-TTS 克隆真人音色 + 激情后期），带语音识别质检与自动重试。

用法（必须用 F5 环境的 Python）：
  node tools/voice/collect.js > tools/voice/jobs.json
  F:\\我的编程项目\\123_AI视频自动化\\tools\\f5-tts-env\\python.exe tools/voice/gen_voices.py
可选参数：--force 全部重新生成；--voice hero 只生成某个音色；--limit N 只做前 N 条（调试）

输出：audio/voice/<音色>/<文本哈希>.mp3，以及 js/voice-manifest.js（告诉前端哪些语音存在）。
已存在的文件会跳过，所以改了台词只需重跑一次。
"""
import argparse, difflib, json, os, re, subprocess, sys, tempfile, threading, time
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
AUTO = os.environ.get("AUTO_PROJECT", r"F:\我的编程项目\123_AI视频自动化")
sys.path.insert(0, AUTO)
sys.path.insert(0, HERE)
from src import config, tts_f5        # noqa: E402  导入即配置模型缓存 / CUDA / ffmpeg 路径
import numpy as np                     # noqa: E402
import soundfile as sf                 # noqa: E402
import fx                              # noqa: E402

MALE_A = tts_f5._CUSTOM_VOICES["大一嘉豪哥"]
MALE_B = tts_f5._CUSTOM_VOICES["人工老龙凤"]
FEMALE = (os.path.join(HERE, "refs", "female.wav"), MALE_A[1])
FEMALE_OLD = (os.path.join(HERE, "refs", "female_old.wav"), MALE_A[1])

# 音色：参考音频 + 语速 + 语调夸张参数（f0_mul 整体升调，range_mul 起伏放大）+ 混响
VOICE_CFG = {
    "hero":    dict(ref=MALE_A, speed=1.15, f0_mul=1.22, range_mul=1.9, wet=0.12, drive=2.6),
    "host":    dict(ref=MALE_B, speed=1.08, f0_mul=1.18, range_mul=2.1, wet=0.28, drive=2.8),
    "m_young": dict(ref=MALE_A, speed=1.18, f0_mul=1.32, range_mul=2.0, wet=0.12, drive=2.6),
    "m_old":   dict(ref=MALE_B, speed=1.10, f0_mul=1.08, range_mul=1.8, wet=0.12, drive=2.4),
    "m_wild":  dict(ref=MALE_A, speed=1.25, f0_mul=1.42, range_mul=2.4, wet=0.12, drive=3.2),
    "m_deep":  dict(ref=MALE_B, speed=1.00, f0_mul=0.92, range_mul=1.5, wet=0.15, drive=2.4),
    "f_young": dict(ref=FEMALE, speed=1.15, f0_mul=1.00, range_mul=1.7, wet=0.12, drive=2.4),
    "f_old":   dict(ref=FEMALE_OLD, speed=0.98, f0_mul=0.95, range_mul=1.5, wet=0.12, drive=2.2),
}

EMOJI = re.compile("[\U0001F000-\U0001FAFF\u2600-\u27BF\uFE0F\u200d]")


def tts_text(raw):
    """台词原文 → 适合朗读的文本：去掉表情、舞台说明（括号）、波浪号。"""
    t = EMOJI.sub("", raw)
    t = re.sub(r"[（(][^）)]*[）)]", "", t)
    t = t.replace("～", "").replace("~", "").replace("——", "，").replace("…", "，")
    t = re.sub(r"[，,]{2,}", "，", t).strip("，, ")
    t = re.sub(r"！+", "！", t)
    # 牌面字母用打牌时的叫法念（F5 念句尾的英文字母容易被吞掉）
    if re.fullmatch(r"(对|三个|[一两三四]张)?[JQKA]！", t):
        t = t.translate(str.maketrans({"J": "钩", "Q": "圈", "K": "凯", "A": "尖"}))
    t = t.replace("pass", "帕斯")
    # “三张十”连读容易被吞成“三四”，中间停一下
    t = t.replace("三张十！", "三张，十！")
    return t


def norm(s):
    return re.findall(r"[\u4e00-\u9fffA-Za-z0-9]", s)


def pinyin(chars):
    from pypinyin import lazy_pinyin
    return [lazy_pinyin(c)[0].lower() if "\u4e00" <= c <= "\u9fff" else c.lower() for c in chars]


def similarity(want, got):
    a, b = pinyin(norm(want)), pinyin(norm(got))
    if not a:
        return 1.0
    return difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()


_asr = None
_asr_lock = threading.Lock()


def transcribe(y, sr):
    global _asr
    import librosa
    from faster_whisper import WhisperModel
    with _asr_lock:
        if _asr is None:
            _asr = WhisperModel("small", device="cuda", compute_type="float16")
        y16 = librosa.resample(y, orig_sr=sr, target_sr=16000).astype(np.float32)
        segs, _ = _asr.transcribe(y16, language="zh",
                                  initial_prompt="打牌喊话：三，四，五，六，七，八，九，十，J，Q，K，A，二，小王，大王，对三，三个三，炸弹，王炸，不要。",
                                  condition_on_previous_text=False)
        return "".join(s.text for s in segs)


_model_lock = threading.Lock()


def synth_raw(voice, text, seed, careful=False):
    """F5 合成原始音频；返回 (y, sr, tempo)。"""
    cfg = VOICE_CFG[voice]
    ref_audio, ref_text = cfg["ref"]
    model = tts_f5._get_model()
    # 很短的喊话让 F5 按常速/慢速念（否则会吞掉最后一个字），再在后期把语速提上去
    n = len(norm(text))
    f5_speed = cfg["speed"] if n > 4 else (1.0 if n > 2 else 0.88)
    if careful:                # 重试时放慢合成（句尾不容易被吞），语速在后期补回
        f5_speed = min(f5_speed, 0.95)
    with _model_lock:          # 单个模型实例：推理串行，后期处理并行
        wav, sr, _ = model.infer(ref_file=str(ref_audio), ref_text=ref_text, gen_text=text, speed=f5_speed,
                                 nfe_step=32, cross_fade_duration=0.15, remove_silence=True, seed=seed,
                                 file_wave=None, show_info=lambda *a, **k: None, progress=None)
    return np.asarray(wav, dtype=np.float32), sr, cfg["speed"] / f5_speed


def process(voice, y, sr, tempo):
    cfg = VOICE_CFG[voice]
    return fx.hype(y, sr, f0_mul=cfg["f0_mul"], range_mul=cfg["range_mul"], wet=cfg["wet"], drive=cfg["drive"],
                   tempo=tempo)


def encode_mp3(y, sr, out):
    os.makedirs(os.path.dirname(out), exist_ok=True)
    fd, tmp = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        sf.write(tmp, y, sr, subtype="PCM_16")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-ac", "1", "-ar", "44100",
                        "-codec:a", "libmp3lame", "-b:a", "64k", out], check=True)
    finally:
        os.remove(tmp)


def job(j, force):
    out = os.path.join(ROOT, "audio", "voice", j["voice"], j["hash"] + ".mp3")
    if os.path.exists(out) and not force:
        return j, None, "cached"
    text = tts_text(j["text"])
    if not norm(text):
        return j, None, "skip"
    best = None
    for attempt in range(3):          # 先用原始合成做识别质检，选中的那一版再做激情后期
        y, sr, tempo = synth_raw(j["voice"], text, seed=1234 + attempt * 97, careful=attempt > 0)
        got = transcribe(y, sr)
        sim = similarity(text, got)
        if best is None or sim > best[0]:
            best = (sim, y, sr, got, tempo)
        if sim >= (0.8 if len(norm(text)) > 4 else 0.99):
            break
    sim, y, sr, got, tempo = best
    y = process(j["voice"], y, sr, tempo)
    encode_mp3(y, sr, out)
    return j, sim, got


def write_manifest():
    base = os.path.join(ROOT, "audio", "voice")
    man = {}
    for v in sorted(os.listdir(base)) if os.path.isdir(base) else []:
        d = os.path.join(base, v)
        if os.path.isdir(d):
            man[v] = sorted(f[:-4] for f in os.listdir(d) if f.endswith(".mp3"))
    path = os.path.join(ROOT, "js", "voice-manifest.js")
    with open(path, "w", encoding="utf-8") as f:
        f.write("/* 由 tools/voice/gen_voices.py 自动生成：每个音色已有的语音（文本哈希） */\n")
        f.write("window.HUB_VOICE_MANIFEST = " + json.dumps(man, separators=(",", ":")) + ";\n")
    print("manifest:", {k: len(v) for k, v in man.items()})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--voice")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()
    jobs = json.load(open(os.path.join(HERE, "jobs.json"), encoding="utf-8"))
    if a.voice:
        jobs = [j for j in jobs if j["voice"] == a.voice]
    if a.limit:
        jobs = jobs[: a.limit]
    tts_f5._get_model()
    t0, done, weak = time.time(), 0, []
    with ThreadPoolExecutor(a.workers) as pool:
        futs = [pool.submit(job, j, a.force) for j in jobs]
        for f in as_completed(futs):
            j, sim, got = f.result()
            done += 1
            if sim is not None:
                flag = "" if sim >= 0.6 else "  ⚠"
                if sim < 0.6:
                    weak.append((j["voice"], j["text"], got, sim))
                print(f"[{done}/{len(jobs)}] {j['voice']:8s} {sim:.2f} {j['text']} → {got}{flag}", flush=True)
    print(f"完成 {done} 条，用时 {time.time() - t0:.0f}s；识别相似度偏低 {len(weak)} 条")
    for w in weak:
        print("  低:", w)
    write_manifest()


if __name__ == "__main__":
    main()
