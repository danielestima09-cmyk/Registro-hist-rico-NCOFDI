#!/usr/bin/env bash
# Atualiza o site a partir das planilhas em fontes/.
#
# Uso:  ./atualizar.sh           mostra o que faria, sem gravar
#       ./atualizar.sh --aplicar grava
#
# Ordem importa: o índice de clubes precisa existir antes da importação, para
# que os campeões de torneios continentais saiam com o país certo.
set -e
cd "$(dirname "$0")"

APLICAR=""
[ "$1" = "--aplicar" ] && APLICAR="--aplicar"

echo "── 1/4  país de cada clube, a partir das tabelas das planilhas ──"
python3 ferramentas/gerar_clubes.py $APLICAR | tail -4

echo
echo "── 2/4  campeões ──"
python3 ferramentas/importar.py $APLICAR | head -3

echo
echo "── 3/4  escudos dos slides (se houver algum em fontes/) ──"
if ls fontes/*.pptx >/dev/null 2>&1; then
  python3 ferramentas/extrair_escudos.py $APLICAR | head -3
else
  echo "   nenhuma apresentação em fontes/ — os escudos entram à mão em assets/escudos/"
fi

echo
echo "── 4/4  conferência ──"
python3 checar.py

if [ -z "$APLICAR" ]; then
  echo
  echo "[simulação] rode ./atualizar.sh --aplicar para gravar"
fi
