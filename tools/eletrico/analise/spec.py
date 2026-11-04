import sys, numpy as np, os
from scipy.io import wavfile
from scipy.signal import stft
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
W = sys.argv[1]
jobs = [
 ('yt_-SDYdHzT7Qw', 0, 44, 0, 3000, 'Taurus A (-SDYdHzT7Qw)'),
 ('yt__iLrXDU31Dg', 0, 36, 0, 3000, 'Taurus B (_iLrXDU31Dg)'),
 ('yt_mgcuAH807Yw', 36, 80, 0, 3000, 'Taurus C (mgcuAH807Yw) 36-80s'),
 ('yt_mgcuAH807Yw', 80, 185, 0, 3000, 'Taurus C 80-185s'),
 ('yt_cfWXzTl8mT0', 10, 70, 0, 3000, 'Taurus D (cfWXzTl8mT0)'),
 ('yt_pKXWDOyY-Ow', 18, 80, 0, 4000, 'CPTM 9500 18-80s'),
 ('yt_pKXWDOyY-Ow', 80, 211, 0, 4000, 'CPTM 9500 80-211s'),
 ('yt_pKXWDOyY-Ow', 18, 211, 0, 16000, 'CPTM 9500 wide'),
 ('yt_u3oip0ZNLeU', 7, 60, 0, 4000, 'CPTM 9000 7-60s'),
 ('yt_u3oip0ZNLeU', 64, 122, 0, 4000, 'CPTM 9000 64-122s'),
 ('yt_u3oip0ZNLeU', 7, 122, 0, 16000, 'CPTM 9000 wide'),
 ('D_part_de_Nation_bord_d_une_rame_MP_73_ogg', 0, 27, 0, 5000, 'MP73 depart Nation'),
 ('Entre_Daumesnil_et_Dugommier_dans_une_rame_MP_73_ogg', 0, 64, 0, 5000, 'MP73 Daumesnil'),
 ('yt_HrcpKbpuEwY', 0, 20, 0, 4000, 'Tesla Plaid launch'),
 ('yt_HrcpKbpuEwY', 0, 20, 0, 16000, 'Tesla Plaid wide'),
 ('Tesla_Roadster_ogg', 0, 7, 0, 6000, 'Tesla Roadster'),
 ('yt_mzxV8KVhrpE', 0, 39, 0, 3000, 'Leaf 0-3k'),
 ('yt_mzxV8KVhrpE', 0, 39, 0, 16000, 'Leaf wide'),
 ('yt_dzOO2IBtGxg', 42, 82, 0, 8000, 'Drill 1 (dzOO2IBtGxg)'),
 ('yt_X0ihOikLuQU', 0, 35, 0, 12000, 'Drill 2 (X0ihOikLuQU)'),
 ('yt_OMgXpoYbcKg', 0, 70, 0, 12000, 'Drill 3 (OMgXpoYbcKg)'),
 ('yt_Abyu0qtq_v4', 0, 30, 0, 12000, 'Mavic hover'),
 ('yt_DUTQkbuzxtk', 0, 80, 0, 12000, 'Drone 2'),
 ('Tram_sound_in_Lyon_France_ogg', 0, 78, 0, 6000, 'Tram Lyon'),
 ('Creaky_West_Midlands_Metro_tram_2020_03_05_Andy_Mabbett_ogg', 0, 43, 0, 6000, 'Tram WMM'),
 ('WWS_Overheadrailwaylocomotivemoving_ogg', 0, 73, 0, 4000, 'WWS moving'),
 ('WWS_Overheadrailwaylocomotivestartingup_ogg', 0, 33, 0, 4000, 'WWS start'),
]
for k, (name, t0, t1, f0, f1, title) in enumerate(jobs):
    fs, x = wavfile.read(os.path.join(W, name + '.wav'))
    if x.ndim > 1: x = x.mean(1)
    x = x.astype(np.float64) / 32768.0
    x = x[int(t0*fs):int(t1*fs)]
    N = 4096 if f1 > 6000 else 8192
    fr, t, Z = stft(x, fs, nperseg=N, noverlap=N - N//8, window='hann')
    P = 10*np.log10(np.abs(Z)**2 + 1e-14)
    m = (fr >= f0) & (fr <= f1)
    P = P[m]
    vmax = np.percentile(P, 99.5); vmin = vmax - 60
    plt.figure(figsize=(16, 7), dpi=80)
    plt.imshow(P, origin='lower', aspect='auto', extent=[t0, t0 + t[-1], fr[m][0], fr[m][-1]], vmin=vmin, vmax=vmax, cmap='magma')
    plt.title(title); plt.xlabel('s'); plt.ylabel('Hz')
    step = 100 if f1 <= 4000 else (250 if f1 <= 6000 else 500)
    plt.yticks(np.arange(f0, f1 + 1, step * (2 if f1 <= 4000 else 2)))
    plt.xticks(np.arange(t0, t1 + 1, max(1, (t1 - t0) // 30)))
    plt.grid(True, alpha=0.25, color='white', linewidth=0.4)
    plt.tight_layout(); plt.savefig(f'spec/{k:02d}.png'); plt.close()
    print(k, title)
