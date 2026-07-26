#!/usr/bin/env python3
"""Confere a saúde dos dados do NCOFDI.

Uso:  python3 checar.py
"""
import json, os, re, sys, unicodedata, collections

RAIZ = os.path.dirname(os.path.abspath(__file__))
DIR_COMP = os.path.join(RAIZ, "data", "competicoes")
DIR_ESCUDOS = os.path.join(RAIZ, "assets", "escudos")
EXTENSOES = (".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif")

erros, avisos = [], []


def slug(txt):
    txt = unicodedata.normalize("NFD", str(txt))
    txt = "".join(c for c in txt if unicodedata.category(c) != "Mn")
    txt = txt.replace("'", "").replace("’", "").replace("ª", "a").replace("º", "o")
    return re.sub(r"[^a-zA-Z0-9]+", "-", txt).strip("-").lower()


def carregar(caminho):
    try:
        with open(caminho, encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        erros.append(f"{os.path.relpath(caminho, RAIZ)}: JSON inválido — linha {e.lineno}, {e.msg}")
    except OSError as e:
        erros.append(f"{os.path.relpath(caminho, RAIZ)}: {e}")
    return None


# ---------------------------------------------------------------- estrutura
estrutura = carregar(os.path.join(RAIZ, "data", "estrutura.json"))
clubes_json = carregar(os.path.join(RAIZ, "data", "clubes.json")) or {}
if not estrutura:
    print("\n".join(erros))
    sys.exit(1)

locais = {}   # id -> (nome, secao, tipo)
for secao in estrutura["secoes"]:
    for c in secao.get("confederacoes") or []:
        locais[c["id"]] = (c["nome"], secao, "confederacao")
    for p in secao.get("paises") or []:
        locais[p["id"]] = (p["nome"], secao, "estado" if p.get("sigla") else "pais")

# ------------------------------------------------------------ competições
titulos = []            # (clube, competicao, temporada, local_id)
n_comp = 0
for lid, (nome, secao, tipo) in sorted(locais.items()):
    caminho = os.path.join(DIR_COMP, lid + ".json")
    if not os.path.exists(caminho):
        erros.append(f"estrutura.json cita '{lid}', mas data/competicoes/{lid}.json não existe")
        continue
    d = carregar(caminho)
    if not d:
        continue
    if d.get("id") != lid:
        erros.append(f"{lid}.json: campo 'id' é '{d.get('id')}', deveria ser '{lid}'")

    vistos = collections.Counter(c.get("id") for c in d.get("competicoes", []))
    for cid, n in vistos.items():
        if n > 1:
            erros.append(f"{lid}.json: id de competição repetido '{cid}' ({n}x)")

    for comp in d.get("competicoes", []):
        n_comp += 1
        for campo in ("id", "nome"):
            if not comp.get(campo):
                erros.append(f"{lid}.json: competição sem '{campo}'")
        temporadas = collections.Counter()
        for t in comp.get("campeoes", []):
            if not t.get("clube"):
                erros.append(f"{lid}.json / {comp.get('nome')}: campeão sem 'clube'")
                continue
            if t.get("temporada") in (None, ""):
                erros.append(f"{lid}.json / {comp.get('nome')}: '{t['clube']}' sem 'temporada'")
                continue
            temporadas[str(t["temporada"])] += 1
            titulos.append((t["clube"], comp["nome"], str(t["temporada"]), lid))
        for temp, n in temporadas.items():
            if n > 1:
                avisos.append(f"{lid}.json / {comp.get('nome')}: temporada {temp} aparece {n}x")

# sobras: arquivos em competicoes/ que a estrutura não referencia
for arq in sorted(os.listdir(DIR_COMP)):
    if arq.endswith(".json") and arq[:-5] not in locais:
        avisos.append(f"data/competicoes/{arq} não é citado em estrutura.json (não aparece no site)")

# ------------------------------------------------------------------ clubes
por_clube = collections.Counter(c for c, _, _, _ in titulos)

# nomes quase iguais — provável erro de digitação que divide os títulos
por_slug = collections.defaultdict(set)
for nome in por_clube:
    por_slug[slug(nome)].add(nome)
for s, nomes in por_slug.items():
    if len(nomes) > 1:
        avisos.append("grafias diferentes do mesmo clube: " + " / ".join(f"'{n}'" for n in sorted(nomes)))

# nome comum sem sufixo: risco de somar clubes homônimos no mesmo ranking
LISTA_COMUNS = os.path.join(RAIZ, "ferramentas", "nomes-comuns.txt")
if os.path.exists(LISTA_COMUNS):
    comuns = set()
    with open(LISTA_COMUNS, encoding="utf-8") as f:
        for linha in f:
            linha = linha.split("#")[0].strip()
            if linha:
                comuns.add(slug(linha))
    for nome in sorted(por_clube):
        if slug(nome) in comuns:
            erros.append(f"'{nome}' é um nome comum e está SEM sufixo de estado/país — "
                         f"vai somar títulos de clubes diferentes no ranking "
                         f"({por_clube[nome]} título(s))")

# ----------------------------------------------------------------- escudos
arquivos_escudo = {}
if os.path.isdir(DIR_ESCUDOS):
    for arq in os.listdir(DIR_ESCUDOS):
        if arq.lower().endswith(EXTENSOES):
            arquivos_escudo[arq] = os.path.splitext(arq)[0]

usados, sem_escudo = set(), []
for nome in sorted(por_clube):
    info = clubes_json.get(nome) or {}
    if info.get("bandeira"):
        continue                      # usa emoji, não precisa de imagem
    esperado = info.get("escudo") or (slug(nome) + ".png")
    if str(esperado).startswith("http"):
        continue                      # imagem externa
    if esperado in arquivos_escudo:
        usados.add(esperado)
    else:
        sem_escudo.append((nome, esperado))

orfaos = sorted(set(arquivos_escudo) - usados)

# ---------------------------------------------------------------- relatório
print(f"Estrutura : {len(estrutura['secoes'])} seções · {len(locais)} locais · {n_comp} competições")
print(f"Registros : {len(titulos)} títulos · {len(por_clube)} campeões distintos")
print(f"Escudos   : {len(usados)} em uso · {len(sem_escudo)} faltando · {len(orfaos)} sem dono")

if sem_escudo:
    print(f"\n── Campeões sem escudo ({len(sem_escudo)}) " + "─" * 30)
    print("   Coloque estes arquivos em assets/escudos/ (até lá o site mostra as iniciais):")
    for nome, arquivo in sem_escudo[:40]:
        print(f"   {arquivo:<44} ← {nome}")
    if len(sem_escudo) > 40:
        print(f"   … e mais {len(sem_escudo) - 40}")

if orfaos:
    print(f"\n── Escudos sem clube correspondente ({len(orfaos)}) " + "─" * 16)
    print("   Nome de arquivo não bate com nenhum campeão registrado:")
    for arq in orfaos[:20]:
        print(f"   {arq}")
    if len(orfaos) > 20:
        print(f"   … e mais {len(orfaos) - 20}")

if avisos:
    print(f"\n── Avisos ({len(avisos)}) " + "─" * 44)
    for a in avisos[:30]:
        print("   •", a)
    if len(avisos) > 30:
        print(f"   … e mais {len(avisos) - 30}")

if erros:
    print(f"\n── ERROS ({len(erros)}) " + "─" * 45)
    for e in erros:
        print("   ✗", e)
    print("\nCorrija os erros acima — eles quebram o site.")
    sys.exit(1)

print("\n✓ Nenhum erro. Os dados estão consistentes.")
