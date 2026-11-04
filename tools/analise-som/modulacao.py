# Espectro de modulação da envoltória do agudo 2–8 kHz: força nas taxas de ciclo (720°), volta, ordem 1,5 e ignição,
# em dB relativos ao maior pico. Uso: python modulacao.py "nome:arquivo.f32:t0:t1:freq_ignicao_Hz" ...
import sys, numpy as np
from scipy import signal
FS = 48000
def load(p, t0, t1):
    a = np.fromfile(p, dtype='<f4').reshape(-1, 2).mean(axis=1); return a[int(t0*FS):int(t1*FS)].astype(float)
def mod(x, fire):
    b, a = signal.butter(4, [2000, 8000], 'bandpass', fs=FS); y = signal.filtfilt(b, a, x)
    env = np.abs(signal.hilbert(y)); bl, al = signal.butter(2, 600, fs=FS); env = signal.filtfilt(bl, al, env)
    f, P = signal.welch(env - env.mean(), FS, nperseg=FS); m = (f > 5) & (f < 300); mx = P[m].max()
    lv = lambda k: 10*np.log10(P[np.argmin(np.abs(f - k*fire/4))]/mx)
    return f"ciclo {lv(1):6.1f} volta {lv(2):6.1f} o1.5 {lv(3):6.1f} ign {lv(4):6.1f} | std/mean {env.std()/env.mean():.2f}"
for spec in sys.argv[1:]:
    name, p, t0, t1, fire = spec.split(':'); print(f"{name:20s} {mod(load(p, float(t0), float(t1)), float(fire))}")
