"""程序合成游戏音效与背景音乐（无版权素材，全部由代码生成）。

用法（需要 numpy / scipy / soundfile，以及 PATH 中的 ffmpeg；F5 环境的 Python 都有）：
  F:\\我的编程项目\\123_AI视频自动化\\tools\\f5-tts-env\\python.exe tools/audio/make_audio.py
输出：audio/sfx/*.mp3、audio/bgm/*.mp3
"""
import os, subprocess, sys, tempfile
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, fftconvolve

SR = 44100
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
AUTO = os.environ.get("AUTO_PROJECT", r"F:\我的编程项目\123_AI视频自动化")
if os.path.isdir(AUTO):
    sys.path.insert(0, AUTO)
    try:
        from src import config  # noqa: F401  把项目自带的 ffmpeg 加进 PATH
    except Exception:
        pass
rng = np.random.default_rng(20261017)


# ---------------------------------------------------------------- 基础
def T(d): return np.arange(int(d * SR)) / SR
def sec(n): return int(n * SR)
def midi(m): return 440.0 * 2 ** ((m - 69) / 12)
def sos(kind, f, o=2): return butter(o, f, btype=kind, fs=SR, output="sos")
def bp(x, lo, hi, o=2): return sosfilt(sos("band", [lo, hi], o), x)
def hp(x, f, o=2): return sosfilt(sos("high", f, o), x)
def lp(x, f, o=2): return sosfilt(sos("low", f, o), x)
def noise(d): return rng.standard_normal(sec(d))


def env_exp(n, decay):
    return np.exp(-np.arange(n) / (decay * SR))


def adsr(n, a=0.01, d=0.08, s=0.7, r=0.08):
    e = np.ones(n) * s
    na, nd, nr = min(n, sec(a)), sec(d), min(n, sec(r))
    e[:na] = np.linspace(0, 1, na)
    e[na:na + nd] = np.linspace(1, s, len(e[na:na + nd]))
    if nr:
        e[-nr:] *= np.linspace(1, 0, nr)
    return e


def add(buf, sig, at, g=1.0):
    i = int(at * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += g * sig[: j - i]


def add_wrap(buf, sig, at, g=1.0):
    """循环叠加：超出结尾的部分绕回开头（用于无缝循环的背景音乐）。"""
    i = int(at * SR) % len(buf)
    k = 0
    while k < len(sig):
        j = min(len(buf), i + len(sig) - k)
        buf[i:j] += g * sig[k:k + j - i]
        k += j - i
        i = 0


def reverb(x, seconds=1.2, wet=0.18, bright=6000, loop=False):
    n = sec(seconds)
    ir = rng.standard_normal(n) * np.exp(-np.linspace(0, 6.5, n))
    ir = lp(ir, bright)
    ir /= np.sqrt(np.sum(ir ** 2))
    tail = fftconvolve(x, ir)
    if loop:  # 尾巴绕回开头 → 无缝循环
        out = tail[:len(x)].copy()
        rest = tail[len(x):]
        out[:len(rest)] += rest[:len(x)]
        return (1 - wet) * x + wet * out
    dry = np.concatenate([x, np.zeros(len(tail) - len(x))])
    return (1 - wet) * dry + wet * tail


def norm(x, peak=0.9):
    m = np.max(np.abs(x)) or 1.0
    return x * (peak / m)


def soft(x, drive=1.5):
    return np.tanh(drive * x) / np.tanh(drive)


# ---------------------------------------------------------------- 乐器
def saw(f, t):
    return 2 * ((f * t) % 1.0) - 1


def brass(freq, dur, bright=1.0, vib=True):
    """铜管：多支锯齿波失谐 + 随包络打开的低通 → 有“冲劲”的号声。"""
    t = T(dur)
    v = 1 + (0.006 * np.sin(2 * np.pi * 5.5 * t) * np.clip((t - 0.12) * 5, 0, 1) if vib else 0)
    x = sum(saw(freq * d * v, t) for d in (0.997, 1.0, 1.004)) / 3
    e = adsr(len(t), a=0.03, d=0.12, s=0.8, r=0.08)
    # 暗/亮两路按包络交叉淡化，模拟铜管“吹开”的滤波扫频
    dark, bright_ = lp(x, 650), lp(x, 900 + 3600 * bright)
    out = dark * (1 - e) + bright_ * e
    return soft(out * e, 1.3)


def suona(freq, dur):
    """唢呐风格：明亮带鼻音的簧片音 + 揉音。"""
    t = T(dur)
    vib = 1 + 0.012 * np.sin(2 * np.pi * 6.2 * t) * np.clip((t - 0.08) * 6, 0, 1)
    ph = 2 * np.pi * np.cumsum(freq * vib) / SR
    x = 0.55 * np.sign(np.sin(ph)) * np.abs(np.sin(ph)) ** 0.6 + 0.45 * saw(freq * vib, t)
    x = bp(x, 450, 5200) + 0.6 * bp(x, 1100, 1900)
    e = adsr(len(t), a=0.012, d=0.05, s=0.85, r=0.05)
    return soft(x * e, 2.2) * 0.6


def pluck(freq, dur=1.0, bright=0.6):
    """Karplus-Strong 弹拨（琵琶/吉他感）。"""
    n = sec(dur)
    p = max(2, int(SR / freq))
    buf = rng.uniform(-1, 1, p) * bright + (1 - bright) * np.sin(np.linspace(0, 2 * np.pi, p))
    out = np.zeros(n)
    for i in range(n):
        out[i] = buf[i % p]
        buf[i % p] = 0.996 * 0.5 * (buf[i % p] + buf[(i + 1) % p])
    return out * env_exp(n, dur * 0.5)


def epiano(freq, dur):
    """电钢琴：FM 铃音 + 正弦。"""
    t = T(dur)
    mod = np.sin(2 * np.pi * freq * 14 * t) * 1.2 * env_exp(len(t), 0.15)
    x = np.sin(2 * np.pi * freq * t + mod) * 0.6 + 0.4 * np.sin(2 * np.pi * freq * t)
    return x * env_exp(len(t), dur * 0.6) * adsr(len(t), 0.005, 0.1, 1, 0.05)


def bass(freq, dur):
    t = T(dur)
    x = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(4 * np.pi * freq * t) + 0.15 * saw(freq, t)
    return lp(x, 900) * adsr(len(t), 0.005, 0.1, 0.7, 0.05)


def kick(g=1.0):
    t = T(0.35)
    f = 50 + 110 * np.exp(-t * 28)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(len(t), 0.12)
    x[:sec(0.004)] += 0.5 * rng.standard_normal(sec(0.004))
    return g * x


def bigdrum(g=1.0):
    """大鼓（堂鼓）：低频 + 鼓皮噪声。"""
    t = T(0.6)
    f = 70 + 60 * np.exp(-t * 20)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(len(t), 0.22)
    x += 0.3 * bp(noise(0.6), 80, 900) * env_exp(len(t), 0.05)
    return g * x


def snare(g=1.0, brush=False):
    n = noise(0.25)
    x = hp(n, 1500 if brush else 800) * env_exp(len(n), 0.05 if brush else 0.09)
    if not brush:
        t = T(0.25)
        x += 0.5 * np.sin(2 * np.pi * 190 * t) * env_exp(len(t), 0.04)
    return g * x


def hat(g=1.0, open_=False):
    n = noise(0.3)
    return g * hp(n, 7000) * env_exp(len(n), 0.12 if open_ else 0.025)


def ride(g=1.0):
    t = T(0.8)
    x = sum(np.sin(2 * np.pi * f * t) for f in (3150, 4420, 5870, 7230)) * 0.12
    x += 0.4 * hp(noise(0.8), 6000)
    return g * x * env_exp(len(t), 0.35)


def crash(g=1.0, d=1.6):
    n = noise(d)
    return g * (hp(n, 3500) * env_exp(len(n), d * 0.35))


def gong(freq=180, d=3.0, g=1.0):
    t = T(d)
    parts = [(1, 1), (1.47, .6), (2.09, .45), (2.56, .3), (3.21, .2)]
    x = sum(a * np.sin(2 * np.pi * freq * r * t * (1 + 0.002 * np.sin(2 * np.pi * 0.7 * t))) for r, a in parts)
    x = x * env_exp(len(t), d * 0.4) * np.clip(t * 40, 0, 1)
    return g * x


def woodblock(g=1.0, f=1400):
    t = T(0.12)
    return g * np.sin(2 * np.pi * f * t) * env_exp(len(t), 0.02)


def cymbal_small(g=1.0):  # 小镲
    t = T(0.35)
    x = sum(np.sin(2 * np.pi * f * t) for f in (2950, 4110, 5480)) * 0.15 + 0.5 * hp(noise(0.35), 5000)
    return g * x * env_exp(len(t), 0.08)


def firecrackers(d=1.6, density=38):
    """鞭炮：密集的短促爆裂声。"""
    out = np.zeros(sec(d + 0.3))
    times = np.sort(rng.uniform(0, d, int(d * density)))
    for t0 in times:
        n = sec(0.05)
        pop = rng.standard_normal(n) * env_exp(n, 0.008)
        pop = bp(pop, 900, 7000) + 0.4 * lp(pop, 400)
        add(out, pop * rng.uniform(0.4, 1.0), t0)
    return out


def whoosh(d=0.5, f0=300, f1=4000):
    n = noise(d)
    out = np.zeros_like(n)
    seg = 1024
    for k in range(0, len(n), seg):
        frac = k / len(n)
        fc = f0 * (f1 / f0) ** frac
        out[k:k + seg] = bp(n[k:k + seg], fc * 0.7, min(fc * 1.4, SR / 2 - 100))
    e = np.sin(np.pi * np.linspace(0, 1, len(n))) ** 1.5
    return out * e


def explosion(d=1.8, g=1.0):
    t = T(d)
    sub = np.sin(2 * np.pi * np.cumsum(30 + 60 * np.exp(-t * 6)) / SR) * env_exp(len(t), 0.45)
    body = lp(noise(d), 1200) * env_exp(len(t), 0.35)
    crack = hp(noise(d), 2500) * env_exp(len(t), 0.06)
    rumble = lp(noise(d), 180) * env_exp(len(t), 0.9) * 2
    return g * soft(1.4 * sub + 0.9 * body + 0.6 * crack + rumble, 2.5)


# ---------------------------------------------------------------- 音效
def sfx_bank():
    S = {}
    # 发牌：纸牌划过 + 轻拍
    n = sec(0.09)
    x = bp(rng.standard_normal(n), 2500, 9000) * env_exp(n, 0.02)
    x += 0.6 * lp(rng.standard_normal(n), 600) * env_exp(n, 0.012)
    S["deal"] = x
    # 洗牌：一串加速的哗啦声
    out = np.zeros(sec(0.9))
    tt = 0.0
    for k in range(34):
        m = sec(0.03)
        c = bp(rng.standard_normal(m), 2000, 8000) * env_exp(m, 0.006)
        add(out, c * rng.uniform(0.5, 1), tt)
        tt += 0.03 * (1 - k / 50)
    S["shuffle"] = out
    # 界面
    t = T(0.05)
    S["click"] = np.sin(2 * np.pi * 1700 * t) * env_exp(len(t), 0.008) + 0.3 * hp(noise(0.05), 3000) * env_exp(len(t), 0.004)
    S["select"] = np.sin(2 * np.pi * 1250 * t) * env_exp(len(t), 0.01) * 0.7
    S["tick"] = woodblock(0.8, 2100)
    # 筹码：陶瓷筹码碰撞（不谐和泛音）
    def clack(g=1.0):
        tt = T(0.12)
        f = rng.uniform(0.95, 1.05)
        y = sum(a * np.sin(2 * np.pi * fr * f * tt) for fr, a in ((2350, 1), (3720, .7), (5150, .5), (6900, .3)))
        y = y * env_exp(len(tt), 0.025) + 0.5 * hp(rng.standard_normal(len(tt)), 3000) * env_exp(len(tt), 0.004)
        return g * y
    out = np.zeros(sec(0.25)); add(out, clack(), 0); add(out, clack(0.7), 0.055)
    S["chip"] = out
    out = np.zeros(sec(0.7))
    for k in range(10):
        add(out, clack(rng.uniform(0.4, 1)), rng.uniform(0, 0.45))
    S["chips"] = out
    # 金币：清脆的叮 + 闪光
    tt = T(1.0)
    ding = sum(a * np.sin(2 * np.pi * f * tt) for f, a in ((1975, 1), (2960, .5), (3950, .35), (5925, .2)))
    out = ding * env_exp(len(tt), 0.25)
    out2 = np.zeros(len(tt)); add(out2, ding * env_exp(len(tt), 0.2), 0.09, 0.8)
    S["coin"] = out + out2 + 0.15 * hp(noise(1.0), 8000) * env_exp(len(tt), 0.3)
    # 出牌：牌拍在桌上
    n = sec(0.16)
    x = lp(rng.standard_normal(n), 2200) * env_exp(n, 0.03)
    x += 0.8 * np.sin(2 * np.pi * np.cumsum(120 + 200 * np.exp(-np.arange(n) / 600)) / SR) * env_exp(n, 0.03)
    x += 0.5 * bp(rng.standard_normal(n), 3000, 8000) * env_exp(n, 0.006)
    S["play"] = soft(x, 1.5)
    # 不要：两下敲桌
    out = np.zeros(sec(0.35))
    for t0 in (0, 0.13):
        n = sec(0.12)
        k = np.sin(2 * np.pi * np.cumsum(180 + 120 * np.exp(-np.arange(n) / 300)) / SR) * env_exp(n, 0.03)
        add(out, k + 0.3 * bp(rng.standard_normal(n), 500, 2500) * env_exp(n, 0.01), t0)
    S["pass"] = out
    # 错误：低沉嗡嗡
    tt = T(0.25)
    S["error"] = lp(np.sign(np.sin(2 * np.pi * 140 * tt)), 900) * adsr(len(tt), 0.005, 0.05, 0.8, 0.05) * 0.6
    # 嗖
    S["whoosh"] = whoosh(0.45, 400, 5000)
    # 亮牌：大鼓 + 小镲
    out = np.zeros(sec(1.0)); add(out, bigdrum(1), 0); add(out, crash(0.35, 0.8), 0)
    S["reveal"] = out
    # 全下：小军鼓滚奏渐强 + 重击
    out = np.zeros(sec(2.2))
    for k in range(48):
        t0 = k * 0.022
        add(out, snare(0.15 + 0.85 * k / 48), t0)
    add(out, kick(1.4), 1.08); add(out, bigdrum(1.0), 1.08); add(out, crash(0.9, 1.4), 1.08)
    add(out, brass(midi(50), 0.9, 1.2) * 0.7, 1.08); add(out, brass(midi(57), 0.9, 1.2) * 0.5, 1.08)
    S["allin"] = out
    # 炸弹：引信嘶嘶 + 爆炸
    out = np.zeros(sec(2.4))
    fuse = hp(noise(0.35), 4000) * np.linspace(0.2, 1, sec(0.35)) * 0.4
    add(out, fuse, 0); add(out, explosion(2.0, 1.0), 0.33); add(out, firecrackers(0.6, 30) * 0.5, 0.45)
    S["bomb"] = out
    # 王炸：火箭升空 + 超大爆炸 + 鞭炮
    out = np.zeros(sec(3.4))
    add(out, whoosh(0.8, 200, 7000) * 1.4, 0)
    add(out, explosion(2.4, 1.2), 0.75)
    add(out, firecrackers(1.6, 45) * 0.6, 1.0)
    S["rocket"] = out
    # 飞机：呼啸而过（多普勒下滑）
    d = 1.6
    n = noise(d)
    tt = T(d)
    eng = sum(np.sin(2 * np.pi * np.cumsum(f * (1.25 - 0.5 * tt / d)) / SR) for f in (110, 220, 330)) * 0.2
    out = (bp(n, 300, 3000) * 0.6 + eng) * (np.sin(np.pi * tt / d) ** 2)
    S["plane"] = out
    # 春天：唢呐号角 + 锣 + 鞭炮
    out = np.zeros(sec(3.2))
    for i, (m, t0, dd) in enumerate([(69, 0, .16), (74, .16, .16), (78, .32, .16), (81, .48, .8)]):
        add(out, suona(midi(m), dd), t0, 0.9)
    add(out, gong(170, 2.6, 0.6), 0.48); add(out, firecrackers(2.0, 40) * 0.55, 0.6)
    S["spring"] = out
    # 赢一局：铜管短号
    out = np.zeros(sec(1.8))
    for m, t0, dd in [(67, 0, .12), (72, .12, .12), (76, .24, .12), (79, .36, .7)]:
        add(out, brass(midi(m), dd + .05), t0, 0.8)
    add(out, brass(midi(72), .8) * .5, .36); add(out, crash(0.5), .36); add(out, kick(1), .36)
    S["win"] = out
    # 输：伤心长号
    out = np.zeros(sec(1.9))
    for m, t0, dd in [(62, 0, .35), (61, .38, .35), (60, .76, .35), (59, 1.14, .7)]:
        tt = T(dd)
        f = midi(m) * (1 - 0.03 * (tt / dd) * (1 if m == 59 else 0))
        x = lp(saw(f, tt), 1200) * adsr(len(tt), .03, .1, .8, .1) * (1 + 0.3 * np.sin(2 * np.pi * 5 * tt))
        add(out, x * 0.6, t0)
    S["lose"] = out
    # 胜利：大号角 + 锣 + 鞭炮
    out = np.zeros(sec(4.2))
    for m, t0, dd in [(67, 0, .14), (67, .14, .14), (67, .28, .14), (72, .42, .5), (76, .92, .2), (79, 1.12, 1.3)]:
        add(out, brass(midi(m), dd + .05), t0, 0.75)
    for m in (60, 64, 67):
        add(out, brass(midi(m), 1.3) * .35, 1.12)
    add(out, kick(1.3), 1.12); add(out, crash(0.8, 2.0), 1.12); add(out, gong(150, 2.8, 0.5), 1.12)
    add(out, firecrackers(2.4, 42) * 0.5, 1.3)
    S["victory"] = out
    # 失败
    out = np.zeros(sec(3.0))
    for m, t0 in [(55, 0), (53, .4), (51, .8), (48, 1.2)]:
        add(out, brass(midi(m), .5, .5, vib=False) * .6, t0)
    add(out, gong(95, 2.5, 0.55), 1.2)
    S["gameover"] = out
    return S


# ---------------------------------------------------------------- 配乐
def bgm_folk():
    """喜庆民乐：唢呐主旋律 + 琵琶分解和弦 + 堂鼓/梆子/小镲，140 BPM，D 宫调。"""
    bpm = 140
    beat = 60 / bpm
    e8 = beat / 2
    deg = {"1": 0, "2": 2, "3": 4, "5": 7, "6": 9}
    base = 62  # D4

    def note(tok):
        oct_ = tok.count("'") - tok.count(",")
        return base + deg[tok.strip("',")] + 12 * oct_

    A = ["5 5 6 5 3 - 2 3", "5 - 6 1' 6 5 3 -", "2 2 3 5 3 2 1 2", "3 - - - 0 3 5 6",
         "1' - 6 1' 2' 1' 6 5", "6 5 3 5 6 - 0 5", "5 6 1' 6 5 3 2 3", "1 - - - 0 0 0 0"]
    B = ["1' 1' 2' 1' 6 5 6 1'", "5 - 3 5 6 - 5 6", "1' 2' 3' 2' 1' 6 5 6", "5 - - - 0 5 6 1'",
         "2' - 1' 6 5 6 1' 2'", "3' 2' 1' 6 5 - 3 5", "6 5 3 2 1 2 3 5", "1 - - - 0 0 0 0"]
    bars = A + B
    chords = [62, 62, 57, 62, 55, 62, 57, 62, 55, 62, 55, 57, 59, 55, 57, 62]  # 根音（D/A/G/B）
    total = len(bars) * 8 * e8
    out = np.zeros(sec(total))
    t = 0.0
    for bi, bar in enumerate(bars):
        toks = bar.split()
        i = 0
        while i < 8:
            tok = toks[i]
            if tok in ("0", "-"):
                i += 1
                continue
            L = 1
            while i + L < 8 and toks[i + L] == "-":
                L += 1
            add_wrap(out, suona(midi(note(tok)), L * e8 * 0.96), t + i * e8, 0.42)
            i += L
        root = chords[bi]
        third = root + (3 if root in (59,) else 4)
        for k in range(4):                                                      # 低音：根-五度
            add_wrap(out, bass(midi(root - 24 + (7 if k % 2 else 0)), beat * 0.9), t + k * beat, 0.5)
        for k, m in enumerate([root, third, root + 7, third + 12, root + 7, third, root + 12, root + 7]):
            add_wrap(out, pluck(midi(m), 0.6, 0.5), t + k * e8, 0.16)           # 琵琶分解
        for k in range(4):                                                      # 打击乐
            add_wrap(out, bigdrum(0.75 if k in (0, 2) else 0.35), t + k * beat)
            add_wrap(out, woodblock(0.18, 1500), t + k * beat + e8)
            add_wrap(out, cymbal_small(0.16), t + k * beat + e8)
        add_wrap(out, bigdrum(0.4), t + 3.5 * beat)
        if bi % 4 == 0:
            add_wrap(out, crash(0.35, 1.5), t)
        t += 8 * e8
    out = reverb(out, 1.4, 0.16, loop=True)
    return norm(soft(out * 1.2, 1.2), 0.85)


def bgm_texas():
    """赌场爵士律动：电钢琴和弦 + 行走低音 + 摇摆鼓刷，112 BPM。"""
    bpm = 112
    beat = 60 / bpm
    swing = beat * 2 / 3
    prog = [(50, [53, 57, 60, 64]), (43, [53, 57, 59, 64]), (48, [52, 55, 59, 62]), (45, [55, 58, 61, 64]),
            (50, [53, 57, 60, 64]), (43, [53, 57, 59, 64]), (52, [55, 59, 62, 66]), (45, [55, 57, 61, 64])]
    bars = prog * 2
    total = len(bars) * 4 * beat
    out = np.zeros(sec(total))
    t = 0.0
    walk = [0, 4, 7, 9]
    for bi, (root, chord) in enumerate(bars):
        # 电钢琴：第 2 拍与第 3 拍后半拍
        for at in (beat, 2 * beat + swing):
            for m in chord:
                add_wrap(out, epiano(midi(m), beat * 1.2), t + at, 0.12)
        # 行走低音
        nxt = bars[(bi + 1) % len(bars)][0]
        for k in range(4):
            m = root + walk[k] if k < 3 else nxt + (1 if nxt < root else -1)
            add_wrap(out, bass(midi(m - 12), beat * 0.95), t + k * beat, 0.55)
        # 鼓：ride 摇摆 + 2/4 拍鼓刷 + 轻踩底鼓
        for k in range(4):
            add_wrap(out, ride(0.18), t + k * beat)
            if k % 2 == 1:
                add_wrap(out, ride(0.12), t + k * beat + swing)
                add_wrap(out, snare(0.35, brush=True), t + k * beat)
            add_wrap(out, kick(0.35), t + k * beat)
        # 偶尔一段颤音琴旋律
        if bi % 2 == 1:
            for k, m in enumerate([chord[-1] + 12, chord[-2] + 12, chord[1] + 12]):
                add_wrap(out, epiano(midi(m), beat * 0.8), t + 2 * beat + k * swing / 2 + k * beat / 3, 0.1)
        t += 4 * beat
    out = reverb(out, 1.0, 0.14, bright=5000, loop=True)
    return norm(soft(out, 1.1), 0.8)


def bgm_tense():
    """紧张时刻：E 小调，168 BPM 八分音符低音持续 + 战鼓 + 铜管顿音。"""
    bpm = 168
    beat = 60 / bpm
    e8 = beat / 2
    roots = [40, 40, 36, 38, 40, 40, 43, 42]
    total = len(roots) * 2 * 4 * beat
    out = np.zeros(sec(total))
    t = 0.0
    for rep in range(2):
        for bi, r in enumerate(roots):
            for k in range(8):
                add_wrap(out, bass(midi(r + (12 if k % 4 == 3 else 0)), e8 * 0.85), t + k * e8, 0.55)
            for k in range(4):
                add_wrap(out, bigdrum(0.9 if k == 0 else 0.55), t + k * beat)
                add_wrap(out, hat(0.18), t + k * beat + e8)
            add_wrap(out, snare(0.5), t + 1 * beat); add_wrap(out, snare(0.5), t + 3 * beat)
            if bi % 2 == 0:
                for m in (r + 24, r + 27, r + 31):
                    add_wrap(out, brass(midi(m), beat * 0.45, 1.3, vib=False) * 0.22, t)
                    add_wrap(out, brass(midi(m), beat * 0.45, 1.3, vib=False) * 0.18, t + 2.5 * beat)
            if bi % 4 == 0:
                add_wrap(out, crash(0.3, 1.2), t)
            t += 4 * beat
    out = reverb(out, 0.9, 0.12, loop=True)
    return norm(soft(out * 1.3, 1.4), 0.82)


# ---------------------------------------------------------------- 输出
def save_mp3(x, path, kbps=96):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        sf.write(tmp, np.clip(x, -1, 1).astype(np.float32), SR, subtype="PCM_16")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-ac", "1", "-codec:a", "libmp3lame",
                        "-b:a", f"{kbps}k", path], check=True)
    finally:
        os.remove(tmp)
    print("wrote", os.path.relpath(path, ROOT), f"{len(x) / SR:.1f}s")


def main():
    only = set(sys.argv[1:])
    if not only or "sfx" in only:
        for name, x in sfx_bank().items():
            x = reverb(x, 0.6, 0.08) if name not in ("click", "select", "tick") else x
            save_mp3(norm(x, 0.92), os.path.join(ROOT, "audio", "sfx", name + ".mp3"), 96)
    if not only or "bgm" in only:
        save_mp3(bgm_folk(), os.path.join(ROOT, "audio", "bgm", "folk.mp3"), 96)
        save_mp3(bgm_texas(), os.path.join(ROOT, "audio", "bgm", "texas.mp3"), 96)
        save_mp3(bgm_tense(), os.path.join(ROOT, "audio", "bgm", "tense.mp3"), 96)


if __name__ == "__main__":
    main()
