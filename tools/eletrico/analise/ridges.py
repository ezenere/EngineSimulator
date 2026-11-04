import sys, numpy as np, os, glob
from scipy.io import wavfile
from scipy.signal import stft, find_peaks
d = sys.argv[1]; out = sys.argv[2]
os.makedirs(out, exist_ok=True)
for f in sorted(glob.glob(os.path.join(d, '*.wav'))):
    fs, x = wavfile.read(f)
    if x.ndim > 1: x = x.mean(1)
    x = x.astype(np.float64) / 32768.0
    N = 16384; hop = fs // 2
    fr, t, Z = stft(x, fs, nperseg=N, noverlap=N - hop, window='hann')
    P = 10*np.log10(np.abs(Z)**2 + 1e-20)
    name = os.path.basename(f).replace('.wav', '')
    with open(os.path.join(out, name + '.txt'), 'w') as g:
        g.write(f"# {name} fs={fs} N={N} hop={hop/fs:.2f}s; per frame: t  level(dBFS, 100-6k)  peaks f(dB rel frame max, 100-20k)\n")
        for j in range(P.shape[1]):
            col = P[:, j]
            m = (fr >= 100) & (fr < 20000)
            lvl = 10*np.log10(np.sum(10**(col[(fr>=100)&(fr<6000)]/10)) + 1e-20)
            idx = np.where(m)[0]
            pk, pr = find_peaks(col[idx], prominence=8, distance=3)
            pk = idx[pk]
            top = sorted(pk, key=lambda p: -col[p])[:8]
            mx = col[idx].max()
            g.write(f"{t[j]:6.1f} {lvl:6.1f}  " + ' '.join(f"{fr[p]:.0f}({col[p]-mx:.0f})" for p in sorted(top)) + "\n")
    print(name, "done")
