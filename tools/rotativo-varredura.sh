#!/bin/sh
# Varredura dos controles "Ø da saída" e "Ponteira (jato)" do mínimo ao máximo, com o orçamento de ruído em cada posição:
# em nenhuma delas o chiado do jato pode ser a fonte dominante (docs/PLANO.md, rodada de som). Três condições (lenta,
# 3 000 rpm em ponto morto, 5 000 rpm em plena carga) × cinco posições (fábrica, saída 20 mm, ponteira 20 mm, as duas em
# 20 mm, as duas em 130 mm). Em cada pasta sai o conjunto do tools/rotativo-fontes.ts e o *_orcamento.txt do kit ouvido.
#
#   sh tools/rotativo-varredura.sh <pasta de saída> [preset=rx7fc] [Ø de fábrica=70] [comprimento da saída=3.2]
#   (rodar da raiz do repositório; as pastas de trabalho ficam fora do git, em referencias/_sim/rotativo/)
O=$1; P=${2:-rx7fc}; DF=${3:-70}; LS=${4:-3.2}
[ -n "$O" ] || { echo "uso: sh tools/rotativo-varredura.sh <pasta> [preset] [Dfab] [Lsaida]"; exit 2; }
mkdir -p "$O"
um() { # nome campo condição...
  n=$1; campo=$2; shift 2
  d="$O/$n"
  npx tsx tools/rotativo-fontes.ts "$P" "$d/" --cada --fontes jato,posBoca,posqueima,janela --campo "$campo" "$@" > "$d.log" 2>&1 \
    && python3 -I tools/ouvido/orcamento.py "$d" --voltas-por-ciclo 3 --na-rede posBoca,posQuente,posPrim,posqueima,janela,estouros,variacao --sem-figura >> "$d.log" 2>&1
}
for cond in lenta 3000 5000c; do
  case $cond in
    lenta) args="--lenta" ;;
    3000) args="--rpm 3000" ;;
    5000c) args="--rpm 5000 --pedal 1" ;;
  esac
  um "$cond-fabrica" "{}" $args &
  um "$cond-saida20" "{\"escape\":{\"ponteira\":$DF,\"saidas\":[{\"L\":$LS,\"D\":20,\"phi\":30}]}}" $args &
  um "$cond-ponteira20" "{\"escape\":{\"ponteira\":20}}" $args &
  um "$cond-ambos20" "{\"escape\":{\"ponteira\":20,\"saidas\":[{\"L\":$LS,\"D\":20,\"phi\":30}]}}" $args &
  um "$cond-ambos130" "{\"escape\":{\"ponteira\":130,\"saidas\":[{\"L\":$LS,\"D\":130,\"phi\":30}]}}" $args &
  wait
done
# resumo: fração ponderada A do jato, das fontes de ar contínuas juntas e da pós-queima em cada posição
for cond in lenta 3000 5000c; do for pos in fabrica saida20 ponteira20 ambos20 ambos130; do
  f=$(ls "$O/$cond-$pos"/*_orcamento.txt 2>/dev/null | head -1)
  [ -n "$f" ] || { echo "$cond-$pos: sem orçamento (ver $O/$cond-$pos.log)"; continue; }
  printf '%-18s jato %s | ar contínuo junto %s | pós-queima %s\n' "$cond-$pos" \
    "$(grep '^jato  ' "$f" | awk -F'|' '{print $2}')" "$(grep '^jato+' "$f" | awk -F'|' '{print $2}')" "$(grep '^posqueima' "$f" | awk -F'|' '{print $2}')"
done; done
