// Leitura e escrita de WAV estéreo para as ferramentas (sem dependências).
// Escreve float 32 bits por padrão (é o que permite comparar amostra a amostra) ou PCM 16 bits.
import fs from 'node:fs';

export type Wav = { sr: number; canais: Float32Array[]; formato: 'float32' | 'pcm16' | 'pcm24' };

// Grava L/R e devolve o pico absoluto.
export function gravarWav(arquivo: string, L: Float32Array, R: Float32Array, sr: number, formato: 'float32' | 'pcm16' = 'float32') {
  const n = L.length;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  if (formato === 'pcm16') {
    // igual ao writeWav dos harnesses antigos (render.js / jetrender.js)
    const buf = Buffer.alloc(44 + n * 4);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
    buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
    for (let i = 0; i < n; i++) { buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4); buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4); }
    fs.writeFileSync(arquivo, buf);
    return peak;
  }
  // IEEE float (formato 3): fmt de 18 bytes (cbSize = 0) + chunk fact, como pede a especificação
  const dados = n * 8, buf = Buffer.alloc(58 + dados);
  buf.write('RIFF', 0); buf.writeUInt32LE(50 + dados, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(18, 16); buf.writeUInt16LE(3, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 8, 28); buf.writeUInt16LE(8, 32); buf.writeUInt16LE(32, 34); buf.writeUInt16LE(0, 36);
  buf.write('fact', 38); buf.writeUInt32LE(4, 42); buf.writeUInt32LE(n, 46);
  buf.write('data', 50); buf.writeUInt32LE(dados, 54);
  for (let i = 0; i < n; i++) { buf.writeFloatLE(L[i], 58 + i * 8); buf.writeFloatLE(R[i], 62 + i * 8); }
  fs.writeFileSync(arquivo, buf);
  return peak;
}

// Lê PCM 16/24 bits ou float 32 bits, qualquer número de canais. Amostras PCM viram [-1, 1).
export function lerWav(arquivo: string): Wav {
  const b = fs.readFileSync(arquivo);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${arquivo}: não é WAV`);
  let pos = 12, fmt = 0, nc = 0, sr = 0, bits = 0, dados: Buffer | null = null;
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4), tam = b.readUInt32LE(pos + 4), corpo = pos + 8;
    if (id === 'fmt ') {
      fmt = b.readUInt16LE(corpo); nc = b.readUInt16LE(corpo + 2); sr = b.readUInt32LE(corpo + 4); bits = b.readUInt16LE(corpo + 14);
      if (fmt === 0xfffe) fmt = b.readUInt16LE(corpo + 24); // WAVE_FORMAT_EXTENSIBLE: subformato
    } else if (id === 'data') dados = b.subarray(corpo, Math.min(b.length, corpo + tam));
    pos = corpo + tam + (tam & 1);
  }
  if (!dados || !nc) throw new Error(`${arquivo}: WAV sem fmt/data`);
  const bpa = bits / 8, n = Math.floor(dados.length / (bpa * nc));
  const canais = Array.from({ length: nc }, () => new Float32Array(n));
  let formato: Wav['formato'];
  if (fmt === 3 && bits === 32) formato = 'float32';
  else if (fmt === 1 && bits === 16) formato = 'pcm16';
  else if (fmt === 1 && bits === 24) formato = 'pcm24';
  else throw new Error(`${arquivo}: formato ${fmt}/${bits} bits não suportado`);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nc; c++) {
      const o = (i * nc + c) * bpa;
      canais[c][i] = formato === 'float32' ? dados.readFloatLE(o) : formato === 'pcm16' ? dados.readInt16LE(o) / 32768 : dados.readIntLE(o, 3) / 8388608;
    }
  }
  return { sr, canais, formato };
}
