#!/usr/bin/env bash
# Atualiza a versão do CSS e do JS no index.html.
#
# O GitHub Pages manda o navegador guardar os arquivos por 10 minutos. Sem uma
# versão na URL, uma mudança no app.js pode não aparecer para quem já visitou o
# site. Rode isto sempre que mexer em assets/js/app.js ou assets/css/estilo.css,
# antes do commit.
set -e
cd "$(dirname "$0")"
V=$(( $(git rev-list --count HEAD) + 1 ))
sed -i -E "s|(assets/css/estilo\.css)(\?v=[0-9]+)?|\1?v=$V|; s|(assets/js/app\.js)(\?v=[0-9]+)?|\1?v=$V|" index.html
echo "assets versionados como v=$V"
