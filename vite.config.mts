// Configuração do Vite: site estático multi-página, com caminhos relativos para funcionar
// em qualquer subpasta (ezenere.com/data/engine/).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const raiz = import.meta.dirname;

export default defineConfig({
  base: './',
  plugins: [
    // o React Refresh não pode entrar no código do AudioWorklet nem no DSP (não há `window` lá)
    react({ exclude: [/\/src\/worklet\//, /\/src\/acoustics\//, /\/src\/engines\//, /\/src\/scene\//, /\/src\/carriers\//] }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // a cena 3D da Passagem (three.js, ~600 kB) é um chunk carregado sob demanda, depois do áudio
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      input: {
        menu: resolve(raiz, 'index.html'),
        ronco: resolve(raiz, 'ronco.html'),
        turbina: resolve(raiz, 'turbina.html'),
        passagem: resolve(raiz, 'passagem.html'),
        diesel: resolve(raiz, 'diesel.html'),
      },
    },
  },
  // O processador do AudioWorklet é importado com `?worker&url`: o Vite compila o TS num bundle
  // próprio (com tudo o que ele importa) e devolve a URL para `audioWorklet.addModule`.
  worker: {
    format: 'es',
    rolldownOptions: {
      // sem minificar: o DSP que roda no navegador fica igual, linha a linha, ao que roda no Node
      output: { minify: false },
    },
  },
});
