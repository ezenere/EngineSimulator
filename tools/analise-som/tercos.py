# Níveis em terços de oitava (1, 2, 4, 8, 16 kHz) relativos à média de 150–400 Hz, e profundidade da envoltória
# do agudo 2–8 kHz (desvio/média e p95/p5). Uso: python tercos.py "nome:arquivo.f32:t0:t1" ...
import sys, numpy as np
from scipy import signal
FS = 48000
def load(p, t0, t1):
    a = np.fromfile(p, dtype='<f4').reshape(-1, 2).mean(axis=1); return a[int(t0*FS):int(t1*FS)].astype(float)
def thirds(x):
    f, P = signal.welch(x, FS, nperseg=8192); ref = P[(f >= 150) & (f < 400)].mean()
    out = []
    for fc in [1000, 2000, 4000, 8000, 16000]:
        m = (f >= fc / 2**(1/6)) & (f < fc * 2**(1/6)); out.append(10*np.log10(P[m].mean()/ref))
    b, a = signal.butter(4, [2000, 8000], 'bandpass', fs=FS); y = signal.filtfilt(b, a, x)
    env = np.abs(signal.hilbert(y)); bl, al = signal.butter(2, 600, fs=FS); env = signal.filtfilt(bl, al, env)
    return out, env.std()/env.mean(), np.percentile(env, 95)/np.percentile(env, 5)
for spec in sys.argv[1:]:
    name, p, t0, t1 = spec.split(':'); o, sm, pr = thirds(load(p, float(t0), float(t1)))
    print(f"{name:22s} 1k {o[0]:6.1f} 2k {o[1]:6.1f} 4k {o[2]:6.1f} 8k {o[3]:6.1f} 16k {o[4]:6.1f} | env std/mean {sm:.2f} p95/p5 {pr:.1f}")
