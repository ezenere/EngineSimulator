# Variação de explosão para explosão: RMS do grave (30–400 Hz) em cada janela de ignição de uma renderização com giro
# travado (render.js). Mostra a variação total, a do mesmo cilindro ciclo a ciclo e a força média de cada cilindro.
# Uso: python variacao.py --cilindros 4 "nome:arquivo.f32:rpm" ...
import argparse, numpy as np
from scipy import signal
FS = 48000
ap = argparse.ArgumentParser(); ap.add_argument('--cilindros', type=int, default=4); ap.add_argument('casos', nargs='+'); a = ap.parse_args()
for spec in a.casos:
    name, p, rpm = spec.split(':'); rpm = float(rpm)
    x = np.fromfile(p, dtype='<f4').reshape(-1, 2).mean(axis=1)[FS:].astype(float)
    y = signal.sosfiltfilt(signal.butter(4, [30, 400], 'bandpass', fs=FS, output='sos'), x)
    per = FS * 120 / rpm / a.cilindros; n = int(len(y) / per) - 1
    r = np.array([np.sqrt(np.mean(y[int(i * per):int((i + 1) * per)] ** 2)) for i in range(n)])
    sl = r[:n - n % a.cilindros].reshape(-1, a.cilindros)
    print(f"{name:14s} CV total {r.std()/r.mean():.2f} · mesmo cilindro {np.mean(sl.std(axis=0)/sl.mean(axis=0)):.2f} · força por cilindro {np.round(sl.mean(axis=0)/sl.mean(), 2)}")
