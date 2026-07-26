# Registro Histórico do NCOFDI

Site estático que registra os campeões do **NCOFDI — Nível 100: O Futebol dos Iguais**, um universo simulado em que todos os clubes de futebol têm exatamente o mesmo nível.

Navegação: **seção → país / estado / confederação → competição → campeões de cada temporada**, mais uma aba de **maiores campeões** com o ranking de todos os clubes e seleções titulados.

Cobertura atual: **9 seções, 154 locais e 357 competições** — as ligas e copas nacionais de 110 países, os torneios continentais das 6 confederações, os 81 campeonatos estaduais brasileiros e as competições de seleções.

## Rodar localmente

```bash
./servir.sh          # abra http://localhost:8000
```

(Abrir o `index.html` com duplo clique não funciona: o navegador bloqueia a leitura dos arquivos JSON via `file://`.)

## Conferir os dados

```bash
python3 ferramentas/gerar_clubes.py --aplicar   # país de cada clube, a partir das planilhas
python3 ferramentas/importar.py --aplicar       # importa os campeões
python3 checar.py                               # valida tudo
```

## Cadastrar campeões

Tudo vem dos arquivos em `data/`. Passo a passo em **[COMO-USAR.md](COMO-USAR.md)**.

```
index.html
assets/
  css/estilo.css
  js/app.js
  escudos/            → PNGs dos escudos (ex.: real-madrid.png)
data/
  estrutura.json      → seções, confederações, países e estados
  clubes.json         → país e escudo de cada clube
  competicoes/*.json  → um arquivo por local (154), com os campeões
lista.txt             → lista original de competições do jogo
NOMES-DAS-COMPETICOES.md → lista de todas as competições cadastradas
```

Sem dependências e sem build: HTML, CSS e JavaScript puros.

## Publicar

Settings → Pages → Deploy from a branch → `main` / `/ (root)`.
