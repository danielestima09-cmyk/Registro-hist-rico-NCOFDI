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
./atualizar.sh              # simula: mostra o que mudaria
./atualizar.sh --aplicar    # grava
```

Ele lê as planilhas de `fontes/`, importa os campeões, extrai escudos de
apresentações (se houver alguma) e confere tudo. Escudos que não vierem de
apresentação entram à mão em `assets/escudos/` — o `checar.py` lista o nome
exato de cada arquivo que falta.

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
ferramentas/           → importadores das planilhas e extrator de escudos dos slides
```

Sem dependências e sem build: HTML, CSS e JavaScript puros.

## Publicar

**GitHub Pages** — Settings → Pages → Deploy from a branch → `main` / `/ (root)`.

**Render** — [render.com](https://render.com) → New → Blueprint → escolha este repositório.
O `render.yaml` já traz a configuração; não há build.

Os dois podem ficar no ar ao mesmo tempo, apontando para o mesmo `main`.

> Ao mexer em `assets/js/app.js` ou `assets/css/estilo.css`, rode `./versionar.sh`
> antes do commit. Ele troca o `?v=N` no `index.html` para o navegador buscar a
> versão nova em vez da que está no cache.
