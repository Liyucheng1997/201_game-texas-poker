"""配音后期：把平静的克隆音色处理成“牌桌解说”式的激情口播。

处理链：提速（F5 合成时已做）→ 升调 → 人声 EQ（压低闷音、提亮临场感）→ 压缩/软削波 → 短混响 → 响度归一。
所有函数输入输出都是 float32 单声道 numpy 数组。
"""
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve


def _sos(kind, f, sr, order=2):
    return butter(order, f, btype=kind, fs=sr, output="sos")


def pitch_shift(y, sr, semitones):
    if abs(semitones) < 1e-3:
        return y
    import librosa
    return librosa.effects.pitch_shift(y, sr=sr, n_steps=semitones, res_type="soxr_hq")


def eq(y, sr, presence_db=4.0, air_db=2.0):
    y = sosfilt(_sos("high", 110, sr), y)                       # 去掉低频轰鸣
    pres = sosfilt(_sos("band", [1800, 4800], sr), y)            # 临场感（咬字更“冲”）
    air = sosfilt(_sos("high", 7000, sr), y)
    g = lambda db: 10 ** (db / 20) - 1
    return y + g(presence_db) * pres + g(air_db) * air


def compress(y, drive=2.6):
    """软削波压缩：让每个字都“顶”出来。"""
    peak = np.max(np.abs(y)) or 1.0
    y = y / peak
    return np.tanh(drive * y) / np.tanh(drive)


def reverb(y, sr, seconds=0.35, wet=0.13, seed=7):
    n = int(sr * seconds)
    rng = np.random.default_rng(seed)
    ir = rng.standard_normal(n) * np.exp(-np.linspace(0, 7, n))
    ir = sosfilt(_sos("low", 5000, sr), ir)
    ir /= np.sqrt(np.sum(ir ** 2)) or 1.0
    tail = fftconvolve(y, ir)
    dry = np.concatenate([y, np.zeros(len(tail) - len(y))])
    return (1 - wet) * dry + wet * tail


def trim(y, sr, thresh_db=-42, pad=0.03):
    a = np.abs(y)
    th = 10 ** (thresh_db / 20) * (np.max(a) or 1.0)
    idx = np.where(a > th)[0]
    if not len(idx):
        return y
    s = max(0, idx[0] - int(pad * sr))
    e = min(len(y), idx[-1] + int(pad * sr * 4))
    return y[s:e]


def fade(y, sr, ms_in=6, ms_out=40):
    i, o = int(sr * ms_in / 1000), int(sr * ms_out / 1000)
    y = y.copy()
    if i:
        y[:i] *= np.linspace(0, 1, i)
    if o:
        y[-o:] *= np.linspace(1, 0, o)
    return y


def excite(y, sr, f0_mul=1.25, range_mul=1.9, rise=0.12, tempo=1.0):
    """语调夸张化：整体升调、放大起伏，并让句子前半段音高上扬（喊出来的感觉）。
    tempo > 1 时同时加快语速（在声码器帧上重采样，不会吞字）。"""
    import pyworld as pw
    x = y.astype(np.float64)
    f0, t = pw.dio(x, sr, f0_floor=60, f0_ceil=700, frame_period=5.0)
    f0 = pw.stonemask(x, f0, t, sr)
    sp = pw.cheaptrick(x, f0, t, sr)
    ap = pw.d4c(x, f0, t, sr)
    voiced = f0 > 0
    if voiced.sum() < 3:
        return y
    lf = np.log(f0[voiced])
    mu = np.median(lf)
    lf = mu + (lf - mu) * range_mul + np.log(f0_mul)
    # 句首到句中抬高、句尾回落：拱形音高，像在“喊”
    pos = np.linspace(0, 1, voiced.sum())
    lf += rise * np.sin(np.pi * np.clip(pos * 1.3, 0, 1))
    f0 = f0.copy()
    f0[voiced] = np.exp(lf)
    if abs(tempo - 1.0) > 1e-3:
        n = len(f0)
        idx = np.clip(np.round(np.arange(0, n, tempo)).astype(int), 0, n - 1)
        f0, sp, ap = f0[idx], np.ascontiguousarray(sp[idx]), np.ascontiguousarray(ap[idx])
    out = pw.synthesize(f0, sp, ap, sr, frame_period=5.0)
    return out.astype(np.float32)


def hype(y, sr, semitones=0.0, drive=2.6, wet=0.13, f0_mul=1.25, range_mul=1.9, tempo=1.0):
    y = trim(y, sr)
    y = pitch_shift(y, sr, semitones)
    y = excite(y, sr, f0_mul=f0_mul, range_mul=range_mul, tempo=tempo)
    y = eq(y, sr)
    y = compress(y, drive)
    y = reverb(y, sr, wet=wet)
    y = trim(y, sr, thresh_db=-50)
    y = fade(y, sr)
    peak = np.max(np.abs(y)) or 1.0
    return (y * (0.93 / peak)).astype(np.float32)
