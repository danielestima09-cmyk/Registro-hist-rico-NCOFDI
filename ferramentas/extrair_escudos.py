#!/usr/bin/env python3
"""Extrai os escudos dos PowerPoints para assets/escudos/.

Cada slide "CAMPEÕES ..." é uma grade: em cada célula, a bandeira do país
(imagem pequena) em cima e o escudo do campeão (imagem maior) embaixo. Não há
o nome do clube em texto, então a associação é posicional: as células, em
ordem de leitura, correspondem à lista de campeões que já está em data/.

A conferência é feita por hash: um clube campeão de mais de uma competição
tem de aparecer com exatamente a mesma imagem em todas elas.

Uso:  python3 ferramentas/extrair_escudos.py [--aplicar]
"""
import zipfile, re, glob, os, io, json, sys, hashlib, collections, unicodedata
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapa_planilhas as M
from xml.etree import ElementTree as ET

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESTINO = os.path.join(RAIZ, "assets", "escudos")

NS = {'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
      'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
EMU = 9525                      # EMU por pixel
LARG_BANNER = 250               # acima disso é decoração, não escudo
PROPORCAO_MAX = 1.30            # acima disso é bandeira de país, não escudo
FRACAO_MIN = 0.40               # abaixo desta fração da mediana, é bandeira


def slug(t):
    t = unicodedata.normalize("NFD", str(t))
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = t.replace("'", "").replace("’", "").replace("ª", "a").replace("º", "o")
    return re.sub(r"[^a-zA-Z0-9]+", "-", t).strip("-").lower()


def num(el, at):
    try:
        return int(el.get(at))
    except (TypeError, ValueError):
        return None


def _blip_alvo(pic, alvo):
    """Arquivo da imagem: o r:embed do blip ou, se faltar, o svgBlip do extLst."""
    blip = pic.find('.//a:blip', NS)
    if blip is None:
        return None
    rid = blip.get('{%s}embed' % NS['r'])
    if rid is None:                      # imagem só em SVG, referenciada no extLst
        svg = blip.find('.//{http://schemas.microsoft.com/office/drawing/2016/SVG/main}svgBlip')
        if svg is not None:
            rid = svg.get('{%s}embed' % NS['r'])
    return alvo.get(rid)


def _percorrer(no, alvo, desloc, escala, saida):
    """Anda pela árvore somando as transformações dos grupos."""
    for filho in no:
        tag = filho.tag.split('}')[-1]
        if tag == 'grpSp':
            xfrm = filho.find('./p:grpSpPr/a:xfrm', NS)
            d, e = desloc, escala
            if xfrm is not None:
                off, ext = xfrm.find('a:off', NS), xfrm.find('a:ext', NS)
                cho, che = xfrm.find('a:chOff', NS), xfrm.find('a:chExt', NS)
                if None not in (off, ext, cho, che):
                    ex, ey = num(ext, 'cx') or 1, num(ext, 'cy') or 1
                    cx, cy = num(che, 'cx') or 1, num(che, 'cy') or 1
                    sx, sy = (ex / cx if cx else 1), (ey / cy if cy else 1)
                    e = (escala[0] * sx, escala[1] * sy)
                    d = (desloc[0] + (num(off, 'x') or 0) - (num(cho, 'x') or 0) * e[0],
                         desloc[1] + (num(off, 'y') or 0) - (num(cho, 'y') or 0) * e[1])
            _percorrer(filho, alvo, d, e, saida)
        elif tag == 'pic':
            img = _blip_alvo(filho, alvo)
            xfrm = filho.find('./p:spPr/a:xfrm', NS)
            off = xfrm.find('a:off', NS) if xfrm is not None else None
            ext = xfrm.find('a:ext', NS) if xfrm is not None else None
            x, y = num(off, 'x'), num(off, 'y')
            cx, cy = num(ext, 'cx'), num(ext, 'cy')
            if img and None not in (x, y, cx, cy):
                saida.append((int(desloc[1] + y * escala[1]),
                              int(desloc[0] + x * escala[0]),
                              int(cx * escala[0]) // EMU,
                              int(cy * escala[1]) // EMU, img))
        else:
            _percorrer(filho, alvo, desloc, escala, saida)


def imagens_do_slide(z, slide):
    """[(y, x, largura, altura, arquivo)] em coordenadas absolutas do slide."""
    base = os.path.basename(slide)
    rels = ET.fromstring(z.read(f"ppt/slides/_rels/{base}.rels"))
    alvo = {r.get("Id"): r.get("Target").split("/")[-1] for r in rels}
    root = ET.fromstring(z.read(slide))
    saida = []
    _percorrer(root, alvo, (0, 0), (1.0, 1.0), saida)
    return saida


def escudos_em_ordem(z, slide):
    """Escudos do slide em ordem de leitura (linha a linha, esquerda p/ direita).

    Cada célula traz a bandeira do país e o escudo do campeão. O que separa os
    dois com segurança não é o tamanho — que muda conforme a grade é densa ou
    esparsa — e sim a proporção: bandeiras são nitidamente retangulares
    (~1,4 de largura por altura) e escudos são quase quadrados (≤1,15).
    """
    imgs = [i for i in imagens_do_slide(z, slide)
            if i[2] < LARG_BANNER and i[3] and i[2] / i[3] <= PROPORCAO_MAX]
    # Algumas bandeiras chegam a 1,29 de proporção e escapariam do filtro.
    # Elas são sempre muito menores que os escudos do mesmo slide, então
    # descarto o que estiver bem abaixo da mediana das larguras.
    if imgs:
        larg = sorted(i[2] for i in imgs)
        mediana = larg[len(larg) // 2]
        imgs = [i for i in imgs if i[2] >= mediana * FRACAO_MIN]
    return _ordem_de_leitura(imgs)


def _ordem_de_leitura(imgs):
    """Linha a linha, da esquerda para a direita."""
    imgs = sorted(imgs)
    linhas, atual, ref = [], [], None
    for it in imgs:
        if ref is None or abs(it[0] - ref) <= 40 * EMU:
            atual.append(it)
            ref = it[0] if ref is None else ref
        else:
            linhas.append(atual)
            atual, ref = [it], it[0]
    if atual:
        linhas.append(atual)
    return [it for linha in linhas for it in sorted(linha, key=lambda t: t[1])]


def bandeiras_em_ordem(z, slide):
    """Bandeiras de país do slide, em ordem de leitura.

    Elas ancoram a grade: cada bandeira abre a célula de um país, e os escudos
    que vêm depois dela (até a bandeira seguinte) são os campeões daquele país.
    Sem isso a associação seria puramente sequencial e um único escudo a mais
    ou a menos desalinharia todo o resto do slide — foi o que aconteceu quando
    a "Tabela Geral da Liga" da Argentina não apareceu no slide.
    """
    escudos = {(e[0], e[1], e[4]) for e in escudos_em_ordem(z, slide)}
    imgs = [i for i in imagens_do_slide(z, slide)
            if i[2] < LARG_BANNER and (i[0], i[1], i[4]) not in escudos and i[2] < 60]
    return _ordem_de_leitura(imgs)


def celulas_por_pais(z, slide):
    """[[escudo, ...], ...] — os escudos de cada país, na ordem das bandeiras.

    Bandeira e escudo ficam quase na mesma altura dentro da célula, e o escudo
    às vezes começa alguns pixels à esquerda da bandeira. Por isso a associação
    é por proximidade — cada escudo pertence à bandeira mais perto — e não pela
    ordem de leitura, que os intercalaria.
    """
    bandeiras = bandeiras_em_ordem(z, slide)
    escudos = escudos_em_ordem(z, slide)
    if not bandeiras:
        return [escudos] if escudos else []

    def centro(i):
        return (i[1] + i[2] * EMU / 2, i[0] + i[3] * EMU / 2)

    grupos = [[] for _ in bandeiras]
    cband = [centro(b) for b in bandeiras]
    for e in escudos:
        cx, cy = centro(e)
        dist = [((cx - bx) ** 2 + (cy - by) ** 2, k) for k, (bx, by) in enumerate(cband)]
        grupos[min(dist)[1]].append(e)
    return [_ordem_de_leitura(g) for g in grupos]


def titulo(z, slide):
    root = ET.fromstring(z.read(slide))
    for t in root.iter('{%s}t' % NS['a']):
        if t.text and t.text.strip():
            return t.text.strip()
    return ""


def slides_de_campeoes(caminho):
    z = zipfile.ZipFile(caminho)
    slides = sorted((n for n in z.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n)),
                    key=lambda n: int(re.search(r"\d+", os.path.basename(n)).group()))
    return z, [(s, titulo(z, s)) for s in slides
               if titulo(z, s).upper().startswith(("CAMPEÕES", "CAMPEÃO"))]


PLANO = {
    # (apresentação, ano, slide): (planilha, tipos de competição, só 1ª divisão)
    ("africanas", 1, "slide1"): ("Africanos", {"Liga Nacional"}, False),
    ("africanas", 1, "slide2"): ("Africanos", {"Copa Nacional"}, False),
    ("asiáticas", 1, "slide1"): ("Asiáticos", {"Liga Nacional"}, False),
    ("asiáticas", 1, "slide4"): ("Asiáticos", {"Copa Nacional"}, False),
    ("concacaf", 1, "slide1"): ("Concacaf", {"Liga Nacional"}, False),
    ("concacaf", 1, "slide2"): ("Concacaf", {"Copa Nacional"}, False),
    ("concacaf", 2, "slide1"): ("Concacaf", {"Liga Nacional"}, False),
    ("concacaf", 2, "slide2"): ("Concacaf", {"Copa Nacional"}, False),
    ("europeias", 1, "slide1"): ("Europeus", {"Liga Nacional"}, False),
    ("europeias", 1, "slide8"): ("Europeus", {"Copa Nacional"}, False),
    ("oceânicas", 1, "slide1"): ("Oceânicos", {"Liga Nacional"}, False),
    ("oceânicas", 1, "slide2"): ("Oceânicos", {"Copa Nacional"}, False),
    ("sulamericanas", 1, "slide1"): ("Sulamericanos", {"Liga Nacional"}, False),
    ("sulamericanas", 1, "slide4"): ("Sulamericanos", {"Copa Nacional"}, False),
    ("sulamericanas", 2, "slide1"): ("Sulamericanos", {"Liga Nacional"}, False),
    ("sulamericanas", 2, "slide4"): ("Sulamericanos", {"Copa Nacional"}, False),
    ("estaduais", 1, "slide1"): ("Estaduais", {"Estadual"}, True),
    ("estaduais", 2, "slide1"): ("Estaduais", {"Estadual"}, True),
}


def _campeoes_por_local(xlsx, temporada, tipos, so_primeira, comp, por_nome):
    """[(local, [campeões])] na ordem das abas da planilha."""
    import openpyxl
    wb = openpyxl.load_workbook(xlsx, data_only=True, read_only=True)
    saida = []
    for aba in wb.sheetnames:
        lid = (f"br-{aba.lower()}" if "Estaduais" in xlsx
               else M.ABA_PARA_LOCAL.get((_base_xlsx(xlsx), aba)) or por_nome.get(_norm(aba)))
        if lid not in comp:
            continue
        nomes = []
        for c in comp[lid]["competicoes"]:
            if c["tipo"] not in tipos:
                continue
            if so_primeira and "Divisão" in c["nome"]:
                continue
            nomes += [t["clube"] for t in c["campeoes"] if str(t["temporada"]) == temporada]
        if nomes:
            saida.append((lid, nomes))
    return saida


def _base_xlsx(caminho):
    import re as _re
    m = _re.search(r"Campeonatos (.+) - NCOFDI", os.path.basename(caminho))
    return m.group(1) if m else ""


def _norm(t):
    t = unicodedata.normalize("NFD", str(t))
    t = "".join(c for c in t if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def _extensao(dados):
    """Formato real da imagem — o PowerPoint mistura PNG, JPEG e SVG."""
    if dados[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if dados[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if dados[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    if b"<svg" in dados[:400].lower():
        return ".svg"
    return ".png"


def main():
    aplicar = "--aplicar" in sys.argv
    est = json.load(io.open(os.path.join(RAIZ, "data", "estrutura.json"), encoding="utf-8"))
    comp, por_nome = {}, {}
    for s in est["secoes"]:
        for x in (s.get("confederacoes") or []) + (s.get("paises") or []):
            comp[x["id"]] = json.load(io.open(
                os.path.join(RAIZ, "data", "competicoes", x["id"] + ".json"), encoding="utf-8"))
            por_nome[_norm(x["nome"])] = x["id"]

    atrib = {}          # clube -> (hash, bytes, origem)
    conflitos, pulados = [], []
    for (pres, ano, sl), (xl, tipos, so1) in sorted(PLANO.items()):
        cam = os.path.join(RAIZ, "fontes", f"Campeões competições {pres} NCOFDI - ANO {ano}.pptx")
        xlsx = os.path.join(RAIZ, "fontes", f"Campeonatos {xl} - NCOFDI (ANO {ano}).xlsx")
        if not (os.path.exists(cam) and os.path.exists(xlsx)):
            continue
        z = zipfile.ZipFile(cam)
        grupos = celulas_por_pais(z, f"ppt/slides/{sl}.xml")
        locais = _campeoes_por_local(xlsx, str(2025 + ano), tipos, so1, comp, por_nome)
        origem = f"{pres} ANO {ano}/{sl}"
        if len(grupos) != len(locais):
            pulados.append(f"{origem}: {len(grupos)} bandeiras para {len(locais)} locais")
            continue
        for grupo, (lid, campeoes) in zip(grupos, locais):
            if len(grupo) != len(campeoes):
                if grupo or campeoes:
                    pulados.append(f"{origem} · {lid}: {len(grupo)} escudo(s) "
                                   f"para {len(campeoes)} campeão(ões)")
                continue
            for esc, clube in zip(grupo, campeoes):
                dados = z.read(f"ppt/media/{esc[4]}")
                h = hashlib.sha1(dados).hexdigest()[:10]
                if clube in atrib and atrib[clube][0] != h:
                    conflitos.append(f"{clube}: {atrib[clube][2]} != {origem}")
                else:
                    atrib[clube] = (h, dados, origem)

    # um mesmo escudo em dois clubes diferentes também é erro de alinhamento
    por_hash = collections.defaultdict(list)
    for clube, (h, _d, _o) in atrib.items():
        por_hash[h].append(clube)
    repetidos = {h: c for h, c in por_hash.items() if len(c) > 1}

    print(f"{len(atrib)} escudos associados a clubes")
    print(f"conflitos (mesmo clube, imagens diferentes): {len(conflitos)}")
    for c in conflitos[:10]:
        print("   ✗", c)
    print(f"imagens atribuídas a mais de um clube: {len(repetidos)}")
    for h, cs in list(repetidos.items())[:10]:
        print("   ✗", h, "→", cs)
    if pulados:
        print(f"\ngrupos pulados por contagem divergente ({len(pulados)}):")
        for p in pulados[:20]:
            print("   ·", p)
        if len(pulados) > 20:
            print(f"   … e mais {len(pulados) - 20}")

    if not aplicar:
        print("\n[simulação] rode com --aplicar para gravar em assets/escudos/")
        return
    if conflitos or repetidos:
        print("\nNão gravei nada: resolva os conflitos antes.")
        return
    os.makedirs(DESTINO, exist_ok=True)
    outros = {}
    for clube, (_h, dados, _o) in sorted(atrib.items()):
        ext = _extensao(dados)
        nome = slug(clube) + ext
        with open(os.path.join(DESTINO, nome), "wb") as f:
            f.write(dados)
        if ext != ".png":
            outros[clube] = nome

    # o site procura <slug>.png por padrão; os demais formatos entram em clubes.json
    if outros:
        cam = os.path.join(RAIZ, "data", "clubes.json")
        clubes = json.load(io.open(cam, encoding="utf-8"))
        for clube, nome in outros.items():
            clubes.setdefault(clube, {})["escudo"] = nome
        json.dump(clubes, io.open(cam, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        io.open(cam, "a", encoding="utf-8").write("\n")
        print(f"   {len(outros)} escudos em outro formato, apontados em data/clubes.json")
    print(f"\n✓ {len(atrib)} escudos gravados em assets/escudos/")


if __name__ == "__main__":
    main()
