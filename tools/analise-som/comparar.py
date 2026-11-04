# Figura de comparação gravação × simulador: PSD normalizada (Welch), espectrogramas, modulação da envoltória do agudo
# e dois ciclos de forma de onda. Uso:
#   python comparar.py --ciclo 16.45 --saida comparacao.png "real=gravacao.f32:3:21" "sim=sim.f32:1:10" ["HEAD=head.f32:1:10"]
# (--ciclo: frequência do ciclo de 720° em Hz = rpm/120; marca ciclo, volta e ignição de um 4 cilindros)
import argparse, numpy as np, matplotlib
matplotlib.use('Agg'); import matplotlib.pyplot as plt
from scipy import signal
FS = 48000
ap = argparse.ArgumentParser(); ap.add_argument('--ciclo', type=float, required=True); ap.add_argument('--saida', default='comparacao.png')
ap.add_argument('--ignicoes', type=int, default=4, help='ignições por ciclo de 720° (= nº de cilindros)'); ap.add_argument('casos', nargs='+')
a = ap.parse_args()
def load(p, t0, t1):
    x = np.fromfile(p, dtype='<f4').reshape(-1, 2).mean(axis=1); return x[int(t0 * FS):int(t1 * FS)].astype(np.float64)
cases = []
for c in a.casos:
    name, rest = c.split('='); p, t0, t1 = rest.rsplit(':', 2); cases.append((name, load(p, float(t0), float(t1))))
cols = ['k', 'C3', 'C0', 'C2', 'C1']; n = len(cases)
fig, ax = plt.subplots(4, n, figsize=(6 * n, 17), squeeze=False)
gs = ax[0, 0].get_gridspec()
for x in ax[0, :]: x.remove()
axp = fig.add_subplot(gs[0, :])
for (name, x), c in zip(cases, cols):
    f, P = signal.welch(x, FS, nperseg=8192); ref = P[(f >= 150) & (f < 400)].mean()
    axp.semilogx(f, 10 * np.log10(P / ref + 1e-20), c, lw=1.1, label=name)
axp.set_xlim(30, 16000); axp.set_ylim(-60, 15); axp.grid(True, which='both', alpha=.3); axp.legend()
axp.set_title('PSD (Welch), normalizada pela média de 150–400 Hz'); axp.set_xlabel('Hz'); axp.set_ylabel('dB')
sos = signal.butter(4, [2000, 8000], 'bandpass', fs=FS, output='sos'); sol = signal.butter(2, 400, fs=FS, output='sos')
for j, ((name, x), c) in enumerate(zip(cases, cols)):
    f, t, S = signal.spectrogram(x[:3 * FS], FS, nperseg=1024, noverlap=896); S = 10 * np.log10(S + 1e-20); S -= S.max()
    ax[1, j].pcolormesh(t, f, S, vmin=-70, vmax=0, shading='auto', cmap='magma'); ax[1, j].set_ylim(0, 8000); ax[1, j].set_title(f'espectrograma: {name}')
    y = signal.sosfiltfilt(sos, x); env = signal.sosfiltfilt(sol, np.abs(signal.hilbert(y)))
    fm, Pm = signal.welch(env - env.mean(), FS, nperseg=FS // 2); Pm = Pm / Pm[(fm > 5) & (fm < 200)].max()
    ax[2, j].plot(fm, 10 * np.log10(Pm + 1e-9), c)
    for k, lab in [(1, 'ciclo'), (2, 'volta'), (a.ignicoes, 'ignição')]:
        ax[2, j].axvline(k * a.ciclo, color='g', ls='--', lw=.8); ax[2, j].text(k * a.ciclo, -2, lab, rotation=90, fontsize=8)
    kurt = ((y - y.mean()) ** 4).mean() / (y.var() ** 2)
    ax[2, j].set_xlim(0, 200); ax[2, j].set_ylim(-35, 2); ax[2, j].set_title(f'modulação do agudo 2–8 kHz: {name}'); ax[2, j].set_xlabel('Hz de modulação')
    ax[2, j].text(140, -30, f'curtose {kurt:.1f}\nmod. {env.std()/env.mean():.2f}', fontsize=9)
    m = int(2 / a.ciclo * FS); s0 = FS; tt = np.arange(m) / FS * 1000
    ax[3, j].plot(tt, x[s0:s0 + m] / np.abs(x[s0:s0 + m]).max(), color='0.6', lw=.8)
    ax[3, j].plot(tt, y[s0:s0 + m] / np.abs(y[s0:s0 + m]).max() * 0.8 - 1.2, c, lw=.6)
    ax[3, j].set_title(f'2 ciclos (cinza: bruta; cor: 2–8 kHz): {name}'); ax[3, j].set_xlabel('ms'); ax[3, j].set_yticks([])
plt.tight_layout(); plt.savefig(a.saida, dpi=72); print('figura:', a.saida)
