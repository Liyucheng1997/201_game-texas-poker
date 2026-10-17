"""由真人男声参考派生出女声参考（WORLD 声码器：升基频 + 共振峰上移），再交给 F5 克隆。"""
import os, sys
import numpy as np, soundfile as sf, pyworld as pw, librosa

SRC = r"F:\我的编程项目\123_AI视频自动化\tools\voice_cache"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "refs")
os.makedirs(OUT, exist_ok=True)


def convert(src, dst, f0_mul, formant):
    y, sr = sf.read(src, dtype="float64")
    if y.ndim > 1:
        y = y.mean(axis=1)
    f0, t = pw.harvest(y, sr, f0_floor=60, f0_ceil=600)
    sp = pw.cheaptrick(y, f0, t, sr)
    ap = pw.d4c(y, f0, t, sr)
    # 频谱包络沿频率轴压缩 → 共振峰整体上移
    n = sp.shape[1]
    src_bins = np.clip(np.arange(n) / formant, 0, n - 1)
    sp2 = np.stack([np.interp(src_bins, np.arange(n), row) for row in sp])
    ap2 = np.stack([np.interp(src_bins, np.arange(n), row) for row in ap])
    out = pw.synthesize(f0 * f0_mul, sp2, ap2, sr)
    out = out / (np.max(np.abs(out)) or 1) * 0.9
    sf.write(dst, out.astype(np.float32), sr)
    print("wrote", dst)


if __name__ == "__main__":
    convert(os.path.join(SRC, "大一嘉豪哥.wav"), os.path.join(OUT, "female.wav"), 2.15, 1.20)
    convert(os.path.join(SRC, "大一嘉豪哥.wav"), os.path.join(OUT, "female_old.wav"), 1.85, 1.13)
