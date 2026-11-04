// Portador de teste (bancada da Cena): um corpo pequeno com fontes sintéticas (tom ou ruído branco) em
// posições escolhidas, andando com velocidade fixa. É o que os testes do propagador usam (Doppler,
// 1/r, pente do solo, sombra, orçamento de CPU com N fontes) sem depender de nenhum motor.
import type { FonteSonora, Diretividade, Vec3, TipoFonte } from '../scene/tipos';
import type { Portador, Corpo, Cinematica, ComandoPortador, TelemetriaPortador, Motor, FamiliaMotor } from './tipos';
import { RNG } from '../acoustics/rng';

export interface FonteTeste {
  id?: string;
  pos: Vec3;
  sinal: 'tom' | 'ruido';
  f?: number;               // Hz (tom)
  paRms: number;            // Pa RMS a refDist
  refDist?: number;
  expConv?: number;
  tipo?: TipoFonte;
  dir?: Diretividade['tabela']; eixo?: Vec3;
}

export class PortadorTeste implements Portador {
  readonly tipo = 'nenhum' as const;
  readonly compat: readonly FamiliaMotor[] = ['nenhum'];
  corpo: Corpo;
  cinematica: Cinematica = { s: 0, v: 0, a: 0, rumo: 0 };
  fs: number;
  lista: FonteSonora[];
  esp: FonteTeste[];
  fase: Float64Array;
  rng: RNG[];
  vFixa = 0;

  constructor(fs: number, fontes: FonteTeste[], corpo?: Partial<Corpo> & { largura?: number; altura?: number; zPiso?: number; comprimento?: number }) {
    this.fs = fs; this.esp = fontes;
    const L = corpo?.comprimento ?? 4.6;
    this.corpo = {
      segmentos: [{ comprimento: L, vao: 0, altura: corpo?.altura ?? 1.4, largura: corpo?.largura ?? 1.85, zPiso: corpo?.zPiso ?? 0.15 }],
      comprimento: L, nariz: 0, cauda: 0, areaFrontal: 2.2, cd: 0.3, cpNariz: 0.05, massaSuperficial: 12, fCabine: 70,
    };
    this.lista = fontes.map((f, i) => ({
      id: f.id ?? `teste.${i}`, tipo: f.tipo ?? 'mecanica', pos: f.pos,
      dir: { tabela: f.dir ?? [0, 0, 0, 0, 0, 0, 0], eixo: f.eixo ?? [1, 0, 0], expConv: f.expConv ?? 2 },
      refDist: f.refDist ?? 7.5, dentro: false,
    }));
    this.fase = new Float64Array(fontes.length);
    this.rng = fontes.map((_, i) => new RNG(0x7e57 + i * 7919));
  }
  acoplar(m: Motor | null) { if (m) throw new Error('portador de teste não leva motor'); }
  comandar(c: ComandoPortador) { if (c.velocidadeFixa != null) this.vFixa = c.velocidadeFixa; }
  fontes() { return this.lista; }
  processar(saidas: Float32Array[], n: number, dt: number) {
    const k = this.cinematica;
    k.v = this.vFixa; k.a = 0;
    for (let i = 0; i < this.esp.length; i++) {
      const e = this.esp[i], out = saidas[i];
      if (e.sinal === 'tom') {
        const a = e.paRms * Math.SQRT2, d = (e.f ?? 1000) / this.fs;
        let ph = this.fase[i];
        for (let j = 0; j < n; j++) { out[j] = a * Math.sin(2 * Math.PI * ph); ph += d; if (ph >= 1) ph -= 1; }
        this.fase[i] = ph;
      } else {
        const a = e.paRms * Math.sqrt(3), r = this.rng[i];
        for (let j = 0; j < n; j++) out[j] = a * r.bi();
      }
    }
    k.s += k.v * n * dt;
  }
  telemetria(): TelemetriaPortador { return { v: this.cinematica.v, s: this.cinematica.s, rpmEixo: 0, torqueCarga: 0 }; }
}
