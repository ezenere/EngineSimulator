import sys, numpy as np
from scipy.io import wavfile
from scipy.signal import stft
import glob, os
d = sys.argv[1]
for f in sorted(glob.glob(os.path.join(d, '*.wav'))):
    fs, x = wavfile.read(f)
    if x.ndim > 1: x = x.mean(1)
    x = x.astype(np.float64) / 32768.0
    n = len(x); dur = n / fs
    # RMS per second
    sec = int(fs)
    rms = [20*np.log10(np.sqrt(np.mean(x[i:i+sec]**2))+1e-9) for i in range(0, n - sec, sec)]
    print(f"\n### {os.path.basename(f)}  fs={fs} dur={dur:.1f}s")
    print("RMS dBFS/s:", ' '.join(f"{r:.0f}" for r in rms[:60]))
    # band ratios overall and spectral centroid < 6k
    N = 8192
    fr, t, Z = stft(x, fs, nperseg=N, noverlap=N//2)
    P = np.abs(Z)**2
    Pm = P.mean(1)
    def band(lo, hi): 
        m = (fr >= lo) & (fr < hi); return 10*np.log10(Pm[m].sum()+1e-20)
    ref = band(150, 400)
    bands = [(20,60),(60,150),(150,400),(400,1000),(1000,2500),(2500,6000),(6000,12000),(12000,24000)]
    print("bands rel 150-400:", ' '.join(f"{lo}-{hi}:{band(lo,hi)-ref:+.1f}" for lo,hi in bands))
    m = fr < 6000
    print(f"centroid<6k: {np.sum(fr[m]*Pm[m])/np.sum(Pm[m]):.0f} Hz")
    # top 12 peaks of the mean spectrum (above 40 Hz)
    from scipy.signal import find_peaks
    L = 10*np.log10(Pm+1e-20)
    pk, _ = find_peaks(L, prominence=6, distance=4)
    pk = [p for p in pk if fr[p] > 40]
    pk = sorted(pk, key=lambda p: -L[p])[:14]
    print("peaks:", ' '.join(f"{fr[p]:.0f}Hz({L[p]-L.max():.0f})" for p in sorted(pk)))
