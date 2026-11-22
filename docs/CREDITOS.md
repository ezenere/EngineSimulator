# Créditos

Todo som do site é sintetizado; nada é gravação. Abaixo, o que vem de terceiros.

## Recursos 3D (página Passagem)

Arquivos em `public/3d/`, com a tabela completa (arquivo, fonte, autor, licença, URL, verificação) em `public/3d/LICENSES.md`.

- **Gravel Floor**: textura de brita, por Matterfield e Jenelle van Heerden, [Poly Haven](https://polyhaven.com/a/gravel_floor), CC0 1.0.
- **Concrete Floor 02**: textura de concreto, [Poly Haven](https://polyhaven.com/a/concrete_floor_02), CC0 1.0.

CC0 não exige atribuição. O crédito fica aqui mesmo assim.

## Bibliotecas

- [three.js](https://threejs.org/) (MIT): cena 3D da Passagem, com o `OrbitControls` dos exemplos.
- [React](https://react.dev/) (MIT), [Vite](https://vite.dev/) (MIT), [TypeScript](https://www.typescriptlang.org/) (Apache 2.0).

## Gravações usadas só para comparar (não distribuídas)

A validação do som compara o simulado com gravações reais, medidas por bandas e envoltórias (`docs/TECNICO.md`, Validação). As gravações não fazem parte do site nem do repositório.

O trem-bala foi comparado com passagens perto da via, a 265–320 km/h:

| Trem | Velocidade (km/h) |
|---|---|
| E5 Hayabusa | 320 |
| ICE 3 | 320 |
| Velaro E | 300 e 265 |
| Velaro | 300 |
| Tohoku Shinkansen | ~300 |

As passagens anotadas em `tools/referencias/lista.json` são vídeos públicos (referência privada, abaixo). A lista desta etapa citava também gravações do Commons sem anotar qual arquivo; o autor e a licença delas ficam a conferir quando forem identificadas.

### Wikimedia Commons: autor e licença de cada gravação

As 25 gravações do Commons anotadas em `tools/referencias/lista.json` (as de `fonte` no Commons), usadas como alvo de análise do Diesel, do Radial, dos Rotativos, do Vapor, do Elétrico e do helicóptero da Passagem. O autor e a licença foram conferidos na página de cada arquivo (API do Commons, `imageinfo`) em 22/11/2026. Nenhuma é redistribuída: o áudio fica em `referencias/`, fora do git e do site. A atribuição fica aqui assim mesmo.

| Família | Arquivo no Commons | O que é | Autor | Licença |
|---|---|---|---|---|
| Diesel | [Volkswagen Passat B5 1.9 TDI (remapped, 185 hp) - engine and exhaust sound (YouTube 12P7SQ 48k4).opus](https://commons.wikimedia.org/wiki/File:Volkswagen_Passat_B5_1.9_TDI_%28remapped,_185_hp%29_-_engine_and_exhaust_sound_%28YouTube_12P7SQ_48k4%29.opus) | VW Passat B5 1.9 TDI, 4 em linha (reprogramado) | tomeko0o3769 (YouTube) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0) |
| Diesel | [WWS H.C.rstedenginerunning.ogg](https://commons.wikimedia.org/wiki/File:WWS_H.C.rstedenginerunning.ogg) | B&W de 2 tempos e dupla ação, 8 cilindros (usina H.C. Ørsted, 1933) | Work With Sounds / Torsten Nilsson | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) |
| Diesel | [WWS Bediadiesellocomotiveidling.ogg](https://commons.wikimedia.org/wiki/File:WWS_Bediadiesellocomotiveidling.ogg) | locomotiva de mina BEDIA | Work With Sounds / Technical Museum of Slovenia | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) |
| Radial | [Yakovlev Yak-52 beim Starvorgang.webm](https://commons.wikimedia.org/wiki/File:Yakovlev_Yak-52_beim_Starvorgang.webm) | Vedeneyev M-14P, 9 cilindros (Yak-52) | Fiver, der Hellseher | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| Radial | [Start-Sh-14.webm](https://commons.wikimedia.org/wiki/File:Start-Sh-14.webm) | Siemens-Halske Sh 14 | Hermannk | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| Radial | [EAA Ford TriMotor NC8407.ogg](https://commons.wikimedia.org/wiki/File:EAA_Ford_TriMotor_NC8407.ogg) | Ford Trimotor, 3 × P&W R-985 Wasp Junior de 9 cilindros | Alexf | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |
| Radial | [Chance Vought F4U Corsair at Hahnweide Air Show 2013.ogv](https://commons.wikimedia.org/wiki/File:Chance_Vought_F4U_Corsair_at_Hahnweide_Air_Show_2013.ogv) | P&W R-2800 Double Wasp, 18 cilindros (F4U Corsair) | LEJ.approach/dvldi | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0) |
| Rotativos | [Mazda RX-7 - engine and exhaust sound (YouTube 4z0y1H2REvE).opus](https://commons.wikimedia.org/wiki/File:Mazda_RX-7_-_engine_and_exhaust_sound_%28YouTube_4z0y1H2REvE%29.opus) | Mazda RX-7, 2 rotores | Taz Ringer (YouTube) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0) |
| Rotativos | [Mazda RX-8 - engine and exhaust sound (YouTube u-Lc2Nt3OR8).opus](https://commons.wikimedia.org/wiki/File:Mazda_RX-8_-_engine_and_exhaust_sound_%28YouTube_u-Lc2Nt3OR8%29.opus) | Mazda RX-8 Renesis, 2 rotores | cz125cz125 (YouTube) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0) |
| Vapor | [Steam engine.ogg](https://commons.wikimedia.org/wiki/File:Steam_engine.ogg) | 0-4-0 de bitola estreita, Huntsville ON (2008) | aradlaw | domínio público |
| Vapor | [6024 Lickey Bank.ogg](https://commons.wikimedia.org/wiki/File:6024_Lickey_Bank.ogg) | GWR 6000 "King" 6024 (4 cilindros) | não informado na página (enviado por Duncharris) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
| Vapor | [Steam Locomotive Leaving Depot 10-01-2022.webm](https://commons.wikimedia.org/wiki/File:Steam_Locomotive_Leaving_Depot_10-01-2022.webm) | Grand Canyon Railway 4960 (2-8-2) | Grand Canyon National Park | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) |
| Vapor | [C57180.kiteki.1.ogg](https://commons.wikimedia.org/wiki/File:C57180.kiteki.1.ogg) | apito da JNR C57 180 | SL Story's | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| Vapor | [D51498.kiteki.2005.ogg](https://commons.wikimedia.org/wiki/File:D51498.kiteki.2005.ogg) | apito da JNR D51 498 | SL Story's | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| Vapor | [2010 UP844 Whistle.ogg](https://commons.wikimedia.org/wiki/File:2010_UP844_Whistle.ogg) | apito da Union Pacific 844 | Rvassar | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |
| Vapor | [WWS Airpumpsteamlocomotive.ogg](https://commons.wikimedia.org/wiki/File:WWS_Airpumpsteamlocomotive.ogg) | bomba de ar da P 8 prussiana (38 2267) | Work With Sounds / Konrad Gutkowski | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) |
| Vapor | [WWS HathornDaveytripleexpansionengine.ogg](https://commons.wikimedia.org/wiki/File:WWS_HathornDaveytripleexpansionengine.ogg) | máquina de tripla expansão Hathorn Davey (bombeamento) | Work With Sounds / Torsten Nilsson | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) |
| Vapor | [Marshall Sons & Co traction engine powered timber saw.ogg](https://commons.wikimedia.org/wiki/File:Marshall_Sons_%26_Co_traction_engine_powered_timber_saw.ogg) | trator a vapor Marshall acionando uma serra | LouiseBrown1981 | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |
| Elétrico | [Départ de Nation à bord d'une rame MP 73.ogg](https://commons.wikimedia.org/wiki/File:D%C3%A9part_de_Nation_%C3%A0_bord_d'une_rame_MP_73.ogg) | Metrô de Paris MP 73 (reostático, pneus) | Philt3r | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) |
| Elétrico | [Entre Daumesnil et Dugommier dans une rame MP 73.ogg](https://commons.wikimedia.org/wiki/File:Entre_Daumesnil_et_Dugommier_dans_une_rame_MP_73.ogg) | Metrô de Paris MP 73 | Philt3r | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) |
| Elétrico | [Tram sound in Lyon, France.ogg](https://commons.wikimedia.org/wiki/File:Tram_sound_in_Lyon,_France.ogg) | Alstom Citadis (Lyon) | Glaneur de sons | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0) |
| Elétrico | [Creaky West Midlands Metro tram - 2020-03-05 - Andy Mabbett.ogg](https://commons.wikimedia.org/wiki/File:Creaky_West_Midlands_Metro_tram_-_2020-03-05_-_Andy_Mabbett.ogg) | CAF Urbos 3 (West Midlands Metro) | Andy Mabbett | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| Elétrico | [Tesla Roadster.ogg](https://commons.wikimedia.org/wiki/File:Tesla_Roadster.ogg) | Tesla Roadster | Edvvc | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |
| Elétrico | [Siemens Combino Engine Sound.wav](https://commons.wikimedia.org/wiki/File:Siemens_Combino_Engine_Sound.wav) | Siemens Combino (bonde) | Dawidpl4553 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| Helicóptero (Passagem) | [Chinook helicopter flying over Greenwich in London.ogg](https://commons.wikimedia.org/wiki/File:Chinook_helicopter_flying_over_Greenwich_in_London.ogg) | Boeing CH-47 Chinook | JoBrodie | [CC0](https://creativecommons.org/publicdomain/zero/1.0/deed.en) |

Onde a página do arquivo não informa o autor (o "King" na rampa de Lickey), fica quem enviou. Fora da lista: a Schwebebahn de Wuppertal (Work With Sounds, CC BY 4.0; `docs/ELETRICO.md` 3.4) não está anotada em `lista.json`, então o arquivo exato e o autor ficam a conferir.

O que cada gravação mediu (o trecho, a rotação confirmada e as bandas) está no Apêndice A do documento de projeto de cada família (`docs/DIESEL.md`, `docs/RADIAL.md`, `docs/ROTATIVO.md`, `docs/VAPOR.md` A.1, `docs/ELETRICO.md` 3) e em `referencias/INDEX.md`.

### Vídeos públicos (referência privada)

As outras 219 fontes de `tools/referencias/lista.json` são vídeos públicos (YouTube): o trem-bala acima, o Taurus partindo (o "do-re-mi"), os metrôs da CPTM, carros elétricos, ferramentas e drones do Elétrico, e os motores do Diesel, do Radial, dos Rotativos, do Vapor e da gasolina. Servem só como alvo privado de análise de som: não são redistribuídos, não entram no site nem no git, e a lista guarda só o link e as anotações.
