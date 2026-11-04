import sys, numpy as np, os
from scipy.io import wavfile
from scipy.signal import stft, find_peaks
W = sys.argv[1]
files = [('yt_-SDYdHzT7Qw', 12, 30), ('yt__iLrXDU31Dg', 8, 24), ('yt_mgcuAH807Yw', 0, 8), ('yt_mgcuAH807Yw', 36, 60), ('yt_cfWXzTl8mT0', 14, 32)]
for name, t0, t1 in files:
    fs, x = wavfile.read(os.path.join(W, name + '.wav'))
    if x.ndim > 1: x = x.mean(1)
    x = x.astype(np.float64) / 32768.0
    x = x[int(t0*fs):int(t1*fs)]
    N = 8192; hop = int(0.05 * fs)
    fr, t, Z = stft(x, fs, nperseg=N, noverlap=N - hop, window='hann')
    P = 10*np.log10(np.abs(Z)**2 + 1e-14)
    lo, hi = 150, 800
    m = (fr >= lo) & (fr <= hi); idx = np.where(m)[0]
    track = []
    for j in range(P.shape[1]):
        col = P[idx, j]
        pk, pr = find_peaks(col, prominence=6)
        if len(pk) == 0: track.append((t0 + t[j], np.nan, -99)); continue
        p = pk[np.argmax(col[pk])]
        # parabolic interp
        i = idx[p]
        if 0 < i < len(fr) - 1:
            a, b, c = P[i-1, j], P[i, j], P[i+1, j]
            d = 0.5 * (a - c) / (a - 2*b + c) if (a - 2*b + c) != 0 else 0
        else: d = 0
        f = fr[i] + d * (fr[1] - fr[0])
        # level of this tone relative to total 100-6k
        tot = 10*np.log10(np.sum(10**(P[(fr>=100)&(fr<6000), j]/10)))
        track.append((t0 + t[j], f, P[i, j] - tot))
    # plateau detection: consecutive frames within 1.5%
    print(f"\n### {name} {t0}-{t1}s: plateaus (f Hz, start s, dur s, mean tone-to-total dB)")
    cur = []; plats = []
    for (tt, f, r) in track:
        if np.isnan(f): 
            if cur: plats.append(cur); cur = []
            continue
        if cur and abs(f - np.median([c[1] for c in cur])) / f > 0.015:
            plats.append(cur); cur = []
        cur.append((tt, f, r))
    if cur: plats.append(cur)
    for p in plats:
        if len(p) >= 4:
            fm = np.median([c[1] for c in p]); dur = p[-1][0] - p[0][0] + 0.05
            print(f"  {fm:7.1f} Hz  t={p[0][0]:6.2f}  dur={dur:5.2f}  rel={np.mean([c[2] for c in p]):6.1f}")
