# Recursos 3D da cena (public/3d)

Tudo o que está aqui é carregado sob demanda pela cena 3D da página Passagem (`src/pages/passagem/cena3d.ts`). Se um arquivo não carregar, a cena usa a cor lisa e o som não é afetado. Orçamento da página: ~10 MB (PLANO.md, Recursos 3D); hoje são 0,8 MB.

| Arquivo | O que é | Fonte | Autor | Licença | URL |
|---|---|---|---|---|---|
| `texturas/brita_1k.jpg` | Textura difusa do chão de brita (lastro da via, solo `brita`), 1024 × 1024 | Poly Haven, "Gravel Floor" (`gravel_floor_diff_1k.jpg`, MD5 do original 4f055e1545dcf41f347600fbb01d9ac2) | Matterfield (fotografia), Jenelle van Heerden (processamento) | CC0 1.0 | https://polyhaven.com/a/gravel_floor |
| `texturas/concreto_1k.jpg` | Textura difusa de concreto (túnel, estação, ponte; também o asfalto, escurecida), 1024 × 1024 | Poly Haven, "Concrete Floor 02" (`concrete_floor_02_diff_1k.jpg`, MD5 do original 1cfee53d2f82fa59726ab7ae6a2e8c09) | Poly Haven | CC0 1.0 | https://polyhaven.com/a/concrete_floor_02 |

As duas foram baixadas do CDN da Poly Haven (`dl.polyhaven.org`), conferidas pelo MD5 publicado na API e pelo tipo (JPEG baseline, 1024 × 1024) e regravadas com `magick -strip -quality 80` (sem EXIF; 1,3 MB e 0,8 MB → 0,4 MB cada).

**Sem modelos glTF por enquanto.** O trem-bala e o helicóptero são geometria parametrizada no three.js, com as dimensões do portador (largura, altura, folga do piso, nariz e cauda afilados, truques, pantógrafos, rotor): não achei modelo aberto (CC0/CC-BY) de vagão de trem-bala com silhueta e dimensões confiáveis, e a geometria parametrizada acompanha o que o modo de testes muda (N, passo, vão, nariz). Quando entrar um modelo, ele vai para cá em glTF binário comprimido (Draco ou meshopt), com uma linha nesta tabela e outra em `docs/CREDITOS.md`.
