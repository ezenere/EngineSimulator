#!/usr/bin/env python
"""audit_tool.py - recording vs simulator audit (refactored from audit1..7.py).

Input files: float32 little-endian, stereo interleaved (or mono with --mono), default 48 kHz.
A "case" is  label:path:t0:t1[:ffire]  (seconds; ffire = firing frequency in Hz, auto-detected in
[--ffmin,--ffmax] when omitted).  4-stroke: cycle = ffire/(N/2)/... -> here we assume 4 cylinders:
firing = 2 x rev, cycle (720 deg) = firing/4.  Use --cyl N for other engines (firing = N/2 per rev).

Subcommands
  timeline  one file: band RMS vs time (+ firing-freq track) -> find quiet/engine-off/unsteady parts
  lines     cases: high-res spectral peaks < --fmax and log-spectrum autocorrelation at candidate spacings
  shape     cases: 1/3-octave levels rel. --ref band, absolute band levels, narrow-line search
  sync      cases: windowed firing-phase tracking, aligned 720-deg cycle averages per band, periodic-variance
            fractions (firing/rev/cycle/2cyc), per-slot LF/HF strength, order levels, envelope stats,
            modulation-spectrum levels at engine orders, burst list, stationary-noise reference
  orders    cases: order-domain spectrum lines (integer/half-integer = engine; other = fan/belt/etc.)

Examples
  python -I audit_tool.py timeline --file ref/fusca.f32 --png ref/tl.png
  python -I audit_tool.py sync --case real:ref/fusca.f32:3:21 --case sim:ref/sim_fusca.f32:1:10:65.8 --png ref/cyc.png
"""
import argparse, sys, numpy as np
from scipy import signal

FS = 48000

# ---------------------------------------------------------------- io / helpers
def load(path, t0=0.0, t1=None, mono=False, fs=FS):
    a = np.fromfile(path, dtype='<f4')
    if not mono: a = a.reshape(-1, 2).mean(axis=1)
    return a[int(t0 * fs):(int(t1 * fs) if t1 else None)].astype(np.float64)

def parse_case(s):
    p = s.split(':'); lab, path, t0, t1 = p[0], p[1], float(p[2]), float(p[3]); ff = float(p[4]) if len(p) > 4 else None
    return lab, path, t0, t1, ff

def bp(x, lo, hi, order=4, fs=FS):
    sos = signal.butter(order, [lo, min(hi, fs / 2 * 0.98)], 'bandpass', fs=fs, output='sos'); return signal.sosfiltfilt(sos, x)

def env_of(x, lo, hi, fc=600, fs=FS):
    e = np.abs(signal.hilbert(bp(x, lo, hi, fs=fs))); sos = signal.butter(2, fc, fs=fs, output='sos'); return signal.sosfiltfilt(sos, e)

def auto_ffire(x, fmin, fmax, fs=FS):
    f, P = signal.welch(x, fs, nperseg=min(len(x), 2 * fs)); m = (f > fmin) & (f < fmax); return f[m][np.argmax(P[m])]

def firing_phase(x, ff, bw=0.1, fs=FS):
    y = bp(x, ff * (1 - bw), ff * (1 + bw), 3, fs); return np.maximum.accumulate(np.unwrap(np.angle(signal.hilbert(y))))

def to_angle(sig, ph, K):
    ph0 = np.ceil(ph[0] / (2 * np.pi)) * 2 * np.pi; ph1 = np.floor(ph[-1] / (2 * np.pi)) * 2 * np.pi
    grid = np.arange(ph0, ph1, 2 * np.pi / K); t = np.interp(grid, ph, np.arange(len(ph))); return np.interp(t, np.arange(len(sig)), sig)

def fold(e, P):
    n = len(e) // P; return e[:n * P].reshape(n, P)

def split_half_fraction(E_rows, mean, var):
    """unbiased periodic-variance fraction: cross-covariance of odd/even-period averages / total variance"""
    A1 = E_rows[0::2].mean(0) - mean; A2 = E_rows[1::2].mean(0) - mean; return float(np.mean(A1 * A2) / var)

BANDS = [(500, 1000), (1000, 2000), (2000, 4000), (4000, 8000), (8000, 16000), (2000, 8000)]

# ---------------------------------------------------------------- timeline
def cmd_timeline(a):
    x = load(a.file, mono=a.mono, fs=a.fs); fs = a.fs
    bands = [(60, 150), (150, 400), (400, 1000), (1000, 2000), (2000, 8000), (8000, 16000)]
    h = int(a.hop * fs); n = len(x) // h; T = np.arange(n) * a.hop
    BR = np.zeros((len(bands), n))
    for i, (lo, hi) in enumerate(bands):
        y = bp(x, lo, hi, fs=fs); BR[i] = 20 * np.log10(np.sqrt((y[:n * h].reshape(n, h) ** 2).mean(1)) + 1e-12)
    W = int(a.win * fs); ff = np.full(n, np.nan)
    for i in range(n):
        s0 = i * h
        if s0 + W <= len(x): ff[i] = auto_ffire(x[s0:s0 + W], a.ffmin, a.ffmax, fs)
    print(' t     ffire   rpm   ' + ' '.join(f'{lo}-{hi}'.rjust(9) for lo, hi in bands) + '   HF(2-8k)-LF(150-400)')
    step = max(1, int(a.print_every / a.hop))
    for i in range(0, n, step):
        print(f'{T[i]:6.1f} {ff[i]:6.1f} {ff[i]*120/a.cyl:5.0f}  ' + ' '.join(f'{BR[b, i]:9.1f}' for b in range(len(bands))) + f'   {BR[4, i]-BR[1, i]:6.1f}')
    if a.png:
        import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
        fig, ax = plt.subplots(3, 1, figsize=(16, 10), sharex=True)
        for i, (lo, hi) in enumerate(bands): ax[0].plot(T, BR[i], lw=.8, label=f'{lo}-{hi} Hz')
        ax[0].legend(ncol=6, fontsize=8); ax[0].grid(alpha=.3); ax[0].set_ylabel('band RMS dBFS'); ax[0].set_title(a.file)
        ax[1].plot(T, ff * 120 / a.cyl, '.-', ms=3); ax[1].set_ylabel('rpm from firing-freq peak'); ax[1].grid(alpha=.3)
        ax[2].plot(T, BR[4] - BR[1], label='2-8k minus 150-400'); ax[2].plot(T, BR[2] - BR[1], label='400-1k minus 150-400'); ax[2].legend(); ax[2].grid(alpha=.3); ax[2].set_xlabel('s')
        plt.tight_layout(); plt.savefig(a.png, dpi=72); print('saved', a.png)

# ---------------------------------------------------------------- lines
def cmd_lines(a):
    fs = a.fs
    for c in a.case:
        lab, path, t0, t1, ff = parse_case(c); x = load(path, t0, t1, a.mono, fs)
        n = min(len(x), 8 * fs); seg = x[:n]; nfft = 1 << int(np.ceil(np.log2(n)) + 1)
        S = np.abs(np.fft.rfft(seg * np.hanning(n), nfft)) ** 2; f = np.fft.rfftfreq(nfft, 1 / fs); m = f < a.fmax
        Sd = 10 * np.log10(S[m] + 1e-20); fd = f[m]; pk, _ = signal.find_peaks(Sd, prominence=6)
        sel = sorted(pk[np.argsort(Sd[pk])[::-1][:a.top]]); mx = Sd.max()
        print(f'--- {lab} ({t0}-{t1}s, first {n/fs:.0f}s): top peaks < {a.fmax} Hz (Hz:dB rel max)')
        print('  ' + '  '.join(f'{fd[i]:.1f}:{Sd[i]-mx:.0f}' for i in sel))
        f2, P = signal.welch(x, fs, nperseg=2 * fs); mm = (f2 > 30) & (f2 < 3000); lp = np.log(P[mm] + 1e-20); lp -= lp.mean()
        ac = np.correlate(lp, lp, 'full')[len(lp) - 1:]; ac /= ac[0]; lags = np.arange(len(ac)) * 0.5
        ffe = ff or auto_ffire(x, a.ffmin, a.ffmax, fs); rev = ffe / (a.cyl / 2)
        out = []
        for name, L in [('cycle', rev / 2), ('rev', rev), ('o1.5', 1.5 * rev), ('firing', ffe), ('2xfiring', 2 * ffe)]:
            i = int(round(L / 0.5)); w = 6; j = i - w + np.argmax(ac[i - w:i + w + 1]); out.append(f'{name}({L:.1f}Hz)->{ac[j]:.2f}@{lags[j]:.1f}')
        print(f'  log-spectrum autocorrelation at candidate line spacings (ffire {ffe:.1f} Hz): ' + '  '.join(out))

# ---------------------------------------------------------------- shape
def third_oct(x, ref, fs):
    f, P = signal.welch(x, fs, nperseg=8192); r = P[(f >= ref[0]) & (f < ref[1])].mean()
    cs = 250 * 2 ** (np.arange(0, 19) / 3); out = []
    for c in cs:
        m = (f >= c / 2 ** (1 / 6)) & (f < c * 2 ** (1 / 6)); out.append(10 * np.log10(P[m].mean() / r))
    return cs, np.array(out)

def cmd_shape(a):
    fs = a.fs; rows = {}
    for c in a.case:
        lab, path, t0, t1, _ = parse_case(c); x = load(path, t0, t1, a.mono, fs); cs, v = third_oct(x, a.ref, fs); rows[lab] = (v, x)
    print(f'1/3-oct levels, dB rel. mean PSD {a.ref[0]}-{a.ref[1]} Hz')
    print('center Hz:   ' + ' '.join(f'{c:6.0f}' for c in cs))
    for lab, (v, _) in rows.items(): print(f'{lab:12s} ' + ' '.join(f'{d:6.1f}' for d in v))
    labs = list(rows)
    if len(labs) > 1:
        for lab in labs[1:]: print(f'{labs[0]} minus {lab}: ' + ' '.join(f'{d:6.1f}' for d in rows[labs[0]][0] - rows[lab][0]))
    print('absolute band levels (dB, mean PSD):')
    for lo, hi in [(150, 400), (400, 1000), (1000, 2000), (2000, 4000), (4000, 8000), (8000, 16000), (16000, 20000), (20000, 24000)]:
        vals = []
        for lab, (_, x) in rows.items():
            f, P = signal.welch(x, fs, nperseg=4096); m = (f >= lo) & (f < min(hi, fs / 2)); vals.append(f'{lab} {10*np.log10(P[m].mean()+1e-30):6.1f}')
        print(f'  {lo:5d}-{hi:5d}: ' + '  '.join(vals))
    print('narrow lines > 400 Hz (Hz:dB above local median, 1 Hz resolution; rpm wander smears real lines):')
    for lab, (_, x) in rows.items():
        f, P = signal.welch(x, fs, nperseg=fs); L = 10 * np.log10(P + 1e-20); med = signal.medfilt(L, 201); m = (f > 400) & (f < 16000)
        pk, _ = signal.find_peaks((L - med)[m], prominence=5, width=(1, 12)); pk = pk[np.argsort((L - med)[m][pk])[::-1][:15]]
        print(f'  {lab}: ' + ' '.join(f'{f[m][i]:.0f}:{(L-med)[m][i]:.1f}' for i in pk))
    for lab, (_, x) in rows.items():
        y = bp(x, 2000, 8000, fs=fs); B = fs // 2; n = len(y) // B; Y = y[:n * B].reshape(n, B); k = (Y ** 4).mean(1) / (Y ** 2).mean(1) ** 2
        print(f'  {lab}: 2-8 kHz kurtosis per 0.5 s block: median {np.median(k):.2f} p10 {np.percentile(k,10):.2f} p90 {np.percentile(k,90):.2f} (3 = Gaussian; codecs Gaussianize clicks)')

# ---------------------------------------------------------------- sync
def cycle_avgs(x, ffmin, ffmax, cyl, W, hop, K, fs):
    """windowed firing-phase tracking; windows aligned to the first by the best of (cyl) 180-deg shifts on the LF average"""
    nslot = cyl; C = nslot * K  # samples per 720 deg
    lf = bp(x, 40, 300, fs=fs); envs = {b: env_of(x, *b, fs=fs) for b in BANDS}
    Wn = int(W * fs); hn = int(hop * fs); acc_lf = []; segs_lf = []; segs = {b: [] for b in BANDS}; refl = None; ffs = []
    for s0 in range(0, len(x) - Wn + 1, hn):
        seg = x[s0:s0 + Wn]; ff = auto_ffire(seg, ffmin, ffmax, fs); ffs.append(ff); ph = firing_phase(seg, ff, fs=fs)
        la = fold(to_angle(lf[s0:s0 + Wn], ph, K), C); lavg = la.mean(0)
        if refl is None: refl = lavg; sh = 0
        else: sh = max(range(nslot), key=lambda s: np.dot(np.roll(lavg, s * K), refl))
        acc_lf.append(np.roll(lavg, sh * K)); segs_lf.append(np.roll(la, sh * K, axis=1))
        for b in BANDS:
            ea = fold(to_angle(envs[b][s0:s0 + Wn], ph, K), C); segs[b].append(np.roll(ea, sh * K, axis=1))
    return np.mean(acc_lf, 0), np.concatenate(segs_lf), {b: np.concatenate(segs[b]) for b in BANDS}, envs, np.array(ffs), C

def cmd_sync(a):
    fs = a.fs; K = a.K; results = []
    for c in a.case:
        lab, path, t0, t1, ff = parse_case(c); x = load(path, t0, t1, a.mono, fs)
        ffmin, ffmax = (ff * 0.85, ff * 1.15) if ff else (a.ffmin, a.ffmax)
        lfa, lfs, es, envs, ffs, C = cycle_avgs(x, ffmin, ffmax, a.cyl, a.win, a.hop, K, fs)
        rev = ffs.mean() / (a.cyl / 2)
        print(f'=== {lab} ({t0}-{t1}s): firing {ffs.mean():.1f} Hz (per-window min/max {ffs.min():.1f}/{ffs.max():.1f}) -> rpm {rev*60:.0f}; {lfs.shape[0]} cycles')
        # LF tracking quality
        n = lfs.shape[0]; fr_lf = split_half_fraction(lfs, lfs.mean(), lfs.var())
        print(f'  LF 40-300 wave cycle-periodic fraction {fr_lf:.2f} (tracking quality; <0.5 means wander/slips -> shorten --win)')
        deg = np.arange(C) / C * 720; out = {}
        print(f'  {"band":12s} periodic-variance fraction: firing   rev  cycle  2cyc | env std/mean  p5   p50   p95 (rel mean) | cyc-avg pk-pk/mean | bursts/cycle (deg: rel height)')
        for b in BANDS:
            E = es[b]; e = envs[b]; m = e.mean(); v = e.var()
            fr = []
            for mult in (1, 2, a.cyl, 2 * a.cyl):
                P = mult * K; flat = E.reshape(-1); fr.append(split_half_fraction(fold(flat, P), m, v))
            avg = E.mean(0); pc = np.percentile(e, [5, 50, 95]) / m
            pk, _ = signal.find_peaks(np.r_[avg, avg], distance=max(4, K // 10), prominence=0.12 * (avg.max() - avg.min())); pk = [p for p in pk if p < C]
            out[b] = avg
            print(f'  {str(b):12s} ' + ' '.join(f'{f:6.2f}' for f in fr) + f' | {e.std()/m:5.2f} {pc[0]:5.2f} {pc[1]:5.2f} {pc[2]:5.2f} | {(avg.max()-avg.min())/m:5.2f} | {len(pk)}: ' + ' '.join(f'{int(deg[p])}:{avg[p]/m:.2f}' for p in pk))
        # per-slot strength (per 180 deg = per cylinder event slot) and cycle-to-cycle CV
        seg = lfs.reshape(-1, K); r = np.sqrt((seg ** 2).mean(1)); r4 = r.reshape(-1, a.cyl)
        print(f'  LF per-slot RMS (rel): {np.round(r4.mean(0)/r.mean(),2).tolist()}  CV all firings {r.std()/r.mean():.2f}  cycle-to-cycle CV per slot {np.round(r4.std(0)/r4.mean(0),2).tolist()}')
        seg = es[(2000, 8000)].reshape(-1, K); r = seg.mean(1); r4 = r.reshape(-1, a.cyl)
        print(f'  2-8k env per-slot mean (rel): {np.round(r4.mean(0)/r.mean(),2).tolist()}  CV {r.std()/r.mean():.2f}  cycle-to-cycle CV per slot {np.round(r4.std(0)/r4.mean(0),2).tolist()}')
        # order levels of the LF spectrum
        f, P = signal.welch(x, fs, nperseg=2 * fs)
        def lp(o):
            mm = (f > o * rev * 0.9) & (f < o * rev * 1.1); return 10 * np.log10(P[mm].max())
        fo = a.cyl / 2
        print('  LF order levels dB rel. firing order: ' + ' '.join(f'o{o:g}:{lp(o)-lp(fo):+.0f}' for o in (0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6) if o * rev * 1.1 < 1000))
        # modulation-spectrum levels at engine orders
        for b in [(2000, 8000), (4000, 8000), (8000, 16000), (1000, 2000)]:
            e = envs[b]; fm, Pm = signal.welch(e - e.mean(), fs, nperseg=fs); Pm /= Pm[(fm > 5) & (fm < 300)].max()
            def lv(mult):
                i = int(round(rev / 2 * mult)); return 10 * np.log10(Pm[max(0, i - 2):i + 3].max())
            print(f'  mod-spectrum {str(b):12s} dB rel max: cycle {lv(1):5.1f} rev {lv(2):5.1f} o1.5 {lv(3):5.1f} firing {lv(2*fo):5.1f} o3 {lv(6):5.1f} o4 {lv(8):5.1f}')
        # coherence LF<->HF env
        lfw = bp(x, 40, 300, fs=fs); e = envs[(2000, 8000)]; elf = env_of(x, 60, 300, 400, fs)
        fc, C1 = signal.coherence(lfw, e, fs, nperseg=fs); _, C2 = signal.coherence(elf, e, fs, nperseg=fs)
        print('  coherence with 2-8k env: ' + '  '.join(f'{nm} {fq:.1f}Hz LFwave {C1[int(round(fq))-1:int(round(fq))+2].max():.2f} LFenv {C2[int(round(fq))-1:int(round(fq))+2].max():.2f}' for nm, fq in [('cycle', rev / 2), ('rev', rev), ('firing', ffs.mean())]))
        results.append((lab, lfa, out, envs, deg))
    rng = np.random.default_rng(1); w = rng.standard_normal(10 * fs)
    print('stationary Gaussian noise reference, env std/mean: ' + '  '.join(f'{b}: {env_of(w, *b, fs=fs).std()/env_of(w, *b, fs=fs).mean():.2f}' for b in [(1000, 2000), (2000, 8000), (4000, 8000), (8000, 16000)]))
    if a.png:
        import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
        fig, ax = plt.subplots(len(results), 1, figsize=(15, 4.5 * len(results)), squeeze=False)
        for axx, (lab, lfa, out, envs, deg) in zip(ax[:, 0], results):
            axx.plot(deg, lfa / np.abs(lfa).max(), color='0.4', lw=1, label='LF 40-300 Hz wave (norm.)')
            for b, c in [((1000, 2000), 'C2'), ((2000, 4000), 'C0'), ((4000, 8000), 'C3'), ((8000, 16000), 'C4')]: axx.plot(deg, out[b] / envs[b].mean(), c, lw=1.3, label=f'env {b[0]}-{b[1]} / mean')
            for d in range(0, 720, 720 // a.cyl): axx.axvline(d, color='k', lw=.5, alpha=.4)
            axx.set_ylim(-1.2, 2.4); axx.grid(alpha=.3); axx.legend(fontsize=7, loc='upper right'); axx.set_title(f'aligned 720-deg cycle average: {lab}'); axx.set_xlabel('deg (origin arbitrary, consistent within panel)')
        plt.tight_layout(); plt.savefig(a.png, dpi=72); print('saved', a.png)

# ---------------------------------------------------------------- orders
def cmd_orders(a):
    fs = a.fs; K = 1024
    for c in a.case:
        lab, path, t0, t1, ff = parse_case(c); x = load(path, t0, t1, a.mono, fs)
        ffmin, ffmax = (ff * 0.85, ff * 1.15) if ff else (a.ffmin, a.ffmax); W = int(a.win * fs); spec = None
        for s0 in range(0, len(x) - W + 1, int(a.hop * fs)):
            seg = x[s0:s0 + W]; ffw = auto_ffire(seg, ffmin, ffmax, fs); ph = firing_phase(seg, ffw, fs=fs)
            sa = to_angle(seg, ph, K); n = (len(sa) // (a.cyl * K)) * a.cyl * K; sa = sa[:n]
            S = np.abs(np.fft.rfft(sa * np.hanning(n))) ** 2; ordr = np.arange(len(S)) / (n / K) * (a.cyl / 2)  # 1 = per rev
            spec = S if spec is None else spec + S
        L = 10 * np.log10(spec + 1e-20); med = signal.medfilt(L, 401); m = (ordr > 20) & (ordr < 200)
        pk, _ = signal.find_peaks((L - med)[m], prominence=6); pk = pk[np.argsort((L - med)[m][pk])[::-1][:30]]
        print(f'--- {lab}: order-domain lines (order: dB above local median); integer/half-integer orders = engine harmonics')
        print('  ' + ' '.join(f'{ordr[m][i]:.2f}:{(L-med)[m][i]:.0f}' for i in sorted(pk)))
        nonint = [i for i in pk if abs(ordr[m][i] * 2 - round(ordr[m][i] * 2)) > 0.15]
        print('  non-(half)integer-order lines (fan/belt/alternator candidates): ' + (' '.join(f'{ordr[m][i]:.2f}:{(L-med)[m][i]:.0f}' for i in sorted(nonint)) or 'none'))

# ---------------------------------------------------------------- main
def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--fs', type=int, default=FS); p.add_argument('--mono', action='store_true'); p.add_argument('--cyl', type=int, default=4, help='cylinders (4-stroke); slots per 720 deg')
    p.add_argument('--ffmin', type=float, default=20, help='auto firing-frequency search min (Hz)'); p.add_argument('--ffmax', type=float, default=120)
    sub = p.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('timeline'); s.add_argument('--file', required=True); s.add_argument('--hop', type=float, default=0.25); s.add_argument('--win', type=float, default=1.0); s.add_argument('--print-every', type=float, default=2.0); s.add_argument('--png')
    for name in ('lines', 'shape', 'sync', 'orders'):
        s = sub.add_parser(name); s.add_argument('--case', action='append', required=True, help='label:path:t0:t1[:ffire]')
        if name == 'lines': s.add_argument('--fmax', type=float, default=600); s.add_argument('--top', type=int, default=30)
        if name == 'shape': s.add_argument('--ref', type=float, nargs=2, default=[150, 400])
        if name in ('sync', 'orders'): s.add_argument('--win', type=float, default=2.0); s.add_argument('--hop', type=float, default=1.0)
        if name == 'sync': s.add_argument('--K', type=int, default=64, help='angle samples per 180 deg'); s.add_argument('--png')
    a = p.parse_args(); globals()['cmd_' + a.cmd](a)

if __name__ == '__main__':
    main()
