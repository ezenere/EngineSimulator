import sys, numpy as np, os
from scipy.io import wavfile
from scipy.signal import find_peaks, welch
W = sys.argv[1]
segs = [
 ('yt_dzOO2IBtGxg', 56, 62, 'furadeira 1 regime'),
 ('yt_dzOO2IBtGxg', 46, 52, 'furadeira 1 acelerando (gatilho)'),
 ('yt_X0ihOikLuQU', 30, 34, 'furadeira 2'),
 ('yt_X0ihOikLuQU', 8, 12, 'furadeira 2 (b)'),
 ('yt_OMgXpoYbcKg', 24, 30, 'furadeira 3 (furando)'),
 ('yt_OMgXpoYbcKg', 0, 4, 'furadeira 3 (a)'),
 ('yt_Abyu0qtq_v4', 10, 30, 'Mavic pairado'),
 ('yt_DUTQkbuzxtk', 30, 40, 'drone 2'),
 ('yt_-SDYdHzT7Qw', 21.5, 25.5, 'Taurus A: patamar 600 Hz'),
 ('yt_-SDYdHzT7Qw', 3, 12, 'Taurus A: parado antes'),
 ('yt_cfWXzTl8mT0', 21, 26, 'Taurus D: patamar 600 Hz'),
 ('yt_pKXWDOyY-Ow', 140, 160, 'CPTM 9500 acelerando 140-160'),
 ('yt_pKXWDOyY-Ow', 84, 92, 'CPTM 9500 84-92'),
 ('yt_u3oip0ZNLeU', 70, 90, 'CPTM 9000 70-90'),
 ('yt_u3oip0ZNLeU', 8, 31, 'CPTM 9000 8-31'),
 ('D_part_de_Nation_bord_d_une_rame_MP_73_ogg', 2, 6, 'MP73 Nation 2-6'),
 ('D_part_de_Nation_bord_d_une_rame_MP_73_ogg', 11, 15, 'MP73 Nation 11-15'),
 ('Entre_Daumesnil_et_Dugommier_dans_une_rame_MP_73_ogg', 4, 8, 'MP73 Daumesnil 4-8'),
 ('Entre_Daumesnil_et_Dugommier_dans_une_rame_MP_73_ogg', 20, 45, 'MP73 Daumesnil rolando'),
 ('yt_HrcpKbpuEwY', 12, 17, 'Plaid launch 12-17'),
 ('yt_HrcpKbpuEwY', 17, 20, 'Plaid 17-20'),
 ('yt_mzxV8KVhrpE', 6, 19, 'Leaf acelerando'),
 ('Tesla_Roadster_ogg', 0, 7, 'Roadster'),
 ('Tram_sound_in_Lyon_France_ogg', 18, 50, 'bonde Lyon'),
 ('Creaky_West_Midlands_Metro_tram_2020_03_05_Andy_Mabbett_ogg', 18, 40, 'bonde WMM'),
 ('WWS_Overheadrailwaylocomotivemoving_ogg', 5, 45, 'WWS movendo'),
]
bands = [(20,60),(60,150),(150,400),(400,1000),(1000,2500),(2500,6000),(6000,12000),(12000,24000)]
for name, t0, t1, label in segs:
    fs, x = wavfile.read(os.path.join(W, name + '.wav'))
    if x.ndim > 1: x = x.mean(1)
    x = x.astype(np.float64) / 32768.0
    x = x[int(t0*fs):int(t1*fs)]
    fr, Pxx = welch(x, fs, nperseg=32768, noverlap=16384, window='hann')
    L = 10*np.log10(Pxx + 1e-20)
    def band(lo, hi):
        m = (fr >= lo) & (fr < hi); return 10*np.log10(np.sum(Pxx[m]) * (fr[1]-fr[0]) + 1e-20)
    ref = band(150, 400)
    m6 = fr < 6000
    cen = np.sum(fr[m6]*Pxx[m6])/np.sum(Pxx[m6])
    print(f"\n### {label} [{name} {t0}-{t1}s]")
    print("  bandas rel 150-400:", ' '.join(f"{lo}-{hi}:{band(lo,hi)-ref:+.1f}" for lo,hi in bands), f"| centroide<6k {cen:.0f} Hz")
    # peaks with prominence; report top 25 by level, with level rel to max
    pk, pr = find_peaks(L, prominence=10, distance=3)
    pk = [p for p in pk if 40 <= fr[p] <= 20000]
    top = sorted(pk, key=lambda p: -L[p])[:28]
    mx = max(L[p] for p in top) if top else 0
    print("  linhas:", ' '.join(f"{fr[p]:.0f}({L[p]-mx:.0f})" for p in sorted(top)))
    # harmonic comb search for f0 in 40..800 Hz: score = sum of levels at k*f0 (k<=20) minus median
    best = []
    Lm = L - np.median(L)
    for f0 in np.arange(40, 800, 0.5):
        ks = np.arange(1, 21); ff = ks * f0; ff = ff[ff < 20000]
        ii = np.round(ff / (fr[1]-fr[0])).astype(int)
        s = np.sum(np.maximum(Lm[ii], 0)) / len(ii)
        best.append((s, f0))
    best.sort(reverse=True)
    # keep distinct
    out = []
    for s, f0 in best:
        if all(abs(f0 - g) > 0.05 * g and abs(f0*2 - g) > 0.03*g and abs(f0 - 2*g) > 0.03*g for _, g in out): out.append((s, f0))
        if len(out) >= 4: break
    print("  comb f0 candidatos:", ' '.join(f"{f0:.1f}Hz(score {s:.1f})" for s, f0 in out))
