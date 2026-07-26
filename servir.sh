#!/usr/bin/env bash
# Sobe um servidor local para testar o site.
# Uso: ./servir.sh   (depois abra http://localhost:8000)
set -e
cd "$(dirname "$0")"
PORTA="${1:-8000}"
echo "NCOFDI rodando em http://localhost:$PORTA  (Ctrl+C para parar)"
python3 -m http.server "$PORTA"
