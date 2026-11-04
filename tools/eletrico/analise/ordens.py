import sys, numpy as np, os
from scipy.io import wavfile
from scipy.signal import find_peaks, welch
W = sys.argv[1]
def peaks(name, t0, t1, lo, hi, prom=8, n=18, nper=16384):
    fs, x = wavfile.read(os.path.join(W, name + '.wav'))
    if x.ndim > 1: x = x.mean(1)
    x = x.astype(np.float64) / 32768.0
    x = x[int(t0*fs):int(t1*fs)]
    fr, P = welch(x, fs, nperseg=nper, noverlap=nper//2, window='hann')
    L = 10*np.log10(P + 1e-20)
    m = (fr >= lo) & (fr <= hi); idx = np.where(m)[0]
    pk, _ = find_peaks(L[idx], prominence=prom, distance=2)
    pk = idx[pk]
    top = sorted(pk, key=lambda p: -L[p])[:n]
    mx = max(L[p] for p in top)
    return [(fr[p], L[p] - mx) for p in sorted(top)]
jobs = [
 ('yt_pKXWDOyY-Ow', 149.5, 150.5, 300, 4000, 'CPTM 9500 t=150 (acelerando)'),
 ('yt_pKXWDOyY-Ow', 155.5, 156.5, 300, 4000, 'CPTM 9500 t=156'),
 ('yt_pKXWDOyY-Ow', 44.5, 45.5, 300, 4000, 'CPTM 9500 t=45'),
 ('yt_pKXWDOyY-Ow', 36.5, 37.5, 300, 4000, 'CPTM 9500 t=37'),
 ('yt_pKXWDOyY-Ow', 66.0, 67.0, 300, 4000, 'CPTM 9500 t=66 (desacelerando)'),
 ('yt_u3oip0ZNLeU', 101.5, 102.5, 300, 4000, 'CPTM 9000 t=102 (freando)'),
 ('yt_u3oip0ZNLeU', 106.5, 107.5, 300, 4000, 'CPTM 9000 t=107'),
 ('yt_u3oip0ZNLeU', 40.0, 41.0, 300, 4000, 'CPTM 9000 t=40.5'),
 ('yt_u3oip0ZNLeU', 44.5, 45.5, 300, 4000, 'CPTM 9000 t=45'),
 ('yt_u3oip0ZNLeU', 13.5, 14.5, 300, 4000, 'CPTM 9000 t=14'),
 ('yt_mzxV8KVhrpE', 7.5, 8.5, 200, 16000, 'Leaf t=8'),
 ('yt_mzxV8KVhrpE', 11.5, 12.5, 200, 16000, 'Leaf t=12'),
 ('yt_mzxV8KVhrpE', 13.5, 14.5, 200, 16000, 'Leaf t=14'),
 ('yt_mzxV8KVhrpE', 17.5, 18.5, 200, 16000, 'Leaf t=18'),
 ('yt_mzxV8KVhrpE', 26.0, 27.0, 200, 16000, 'Leaf t=26.5'),
 ('yt_mzxV8KVhrpE', 36.5, 37.5, 200, 16000, 'Leaf t=37'),
 ('yt_HrcpKbpuEwY', 17.5, 18.5, 100, 6000, 'Plaid t=18'),
 ('yt_HrcpKbpuEwY', 15.0, 16.0, 100, 6000, 'Plaid t=15.5'),
 ('yt_HrcpKbpuEwY', 7.0, 9.0, 3000, 16000, 'Plaid t=7-9 agudo'),
 ('Tram_sound_in_Lyon_France_ogg', 11.0, 12.0, 1000, 6000, 'Lyon t=11.5 (bonde chegando)'),
 ('Tram_sound_in_Lyon_France_ogg', 13.5, 14.5, 1000, 6000, 'Lyon t=14'),
 ('Tram_sound_in_Lyon_France_ogg', 30.0, 45.0, 100, 6000, 'Lyon parado 30-45'),
 ('yt_Abyu0qtq_v4', 10, 30, 3000, 12000, 'Mavic agudo'),
 ('yt_DUTQkbuzxtk', 30, 40, 3000, 12000, 'drone 2 agudo'),
]
for name, t0, t1, lo, hi, label in jobs:
    ps = peaks(name, t0, t1, lo, hi)
    f1 = ps[0][0] if ps else 1
    # ratio to the strongest line below 700 Hz if any else lowest
    base = [f for f, l in ps if f < 700]
    b = max(base, key=lambda f: [l for ff, l in ps if ff == f][0]) if base else f1
    print(f"\n### {label} (base {b:.0f} Hz)")
    print('  ' + ' '.join(f"{f:.0f}({l:.0f};x{f/b:.2f})" for f, l in ps))
# Taurus D: track of the ~600 Hz line vs time
fs, x = wavfile.read(os.path.join(W, 'yt_cfWXzTl8mT0.wav'))
if x.ndim > 1: x = x.mean(1)
x = x.astype(np.float64) / 32768.0
from scipy.signal import stft
fr, t, Z = stft(x, fs, nperseg=32768, noverlap=32768 - 24000, window='hann')
P = np.abs(Z)**2
m = (fr > 560) & (fr < 640)
print("\n### Taurus D: pico 560-640 Hz vs tempo (f, dB rel 100-6k)")
out = []
for j in range(P.shape[1]):
    if t[j] < 20 or t[j] > 46: continue
    col = P[m, j]; i = np.argmax(col)
    tot = P[(fr>=100)&(fr<6000), j].sum()
    out.append(f"{t[j]:.1f}s:{fr[m][i]:.1f}({10*np.log10(col[i]/tot):.0f})")
print('  ' + ' '.join(out))
