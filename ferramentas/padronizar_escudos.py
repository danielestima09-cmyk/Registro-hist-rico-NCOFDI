#!/usr/bin/env python3
"""Deixa todos os escudos do mesmo tamanho aparente.

Os arquivos chegam em tamanhos e enquadramentos muito diferentes: um escudo
pode vir com 1080x1440 e outro com 90x90, um encostando nas bordas e outro
cercado de espaço vazio. Como o site mostra a imagem inteira dentro de uma
caixa quadrada, quem tem muita margem vazia aparece pequeno e quem é alto e
estreito parece cortado ao lado dos demais.

A padronização é feita pelo ESCUDO, não pela imagem:

  1. recorta a margem vazia (transparente, ou de cor uniforme nas bordas);
  2. redimensiona para que o lado maior do escudo tenha sempre a mesma medida;
  3. centraliza numa tela quadrada de tamanho fixo.

Assim dois escudos de proporções diferentes ocupam a mesma altura na tela.

SVG é rasterizado antes de entrar nesse caminho. Deixá-lo de fora parecia
razoável — vetor escala sozinho —, mas na prática ele escapava do recorte e da
escala uniforme, e ficava visivelmente maior ou menor que os vizinhos.

Uso:  python3 ferramentas/padronizar_escudos.py [--aplicar]
"""
import glob, os, sys, io, json, re, unicodedata
from PIL import Image

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESTINO = os.path.join(RAIZ, "assets", "escudos")

TELA = 160        # lado da imagem final
CONTEUDO = 152    # lado maior do escudo dentro dela (deixa uma margem mínima)
TOLERANCIA = 12   # quanto uma cor pode variar e ainda contar como margem

# Escudos cuja imagem de origem traz um fundo chapado em volta do desenho, que
# no site aparece como um retângulo. Não vale como regra geral: medi os 475
# escudos e em quase todos a cor que encosta na borda É o escudo (o Al Hilal é
# azul de ponta a ponta, o PSG tem o círculo azul-marinho). Apagar o fundo por
# heurística comeria esses. Só a Internazionale precisa, então vai na mão.
FUNDO_CHAPADO = {"internazionale"}
TOLERANCIA_FUNDO = 40   # o fundo costuma ter serrilhado do redimensionamento


def formato(dados):
    if dados[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if dados[:3] == b"\xff\xd8\xff":
        return "jpg"
    if dados[:4] == b"RIFF" and dados[8:12] == b"WEBP":
        return "webp"
    if dados[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if b"<svg" in dados[:600].lower():
        return "svg"
    return "?"


def _silhueta_de_caixa(im, limite=0.88):
    """O alfa preenche quase todo o retângulo? Então há fundo, não recorte.

    Medi os 475 escudos: a mediana é 0.75 e escudos em forma de brasão ou
    círculo ficam entre 0.70 e 0.80. Acima de 0.88 a silhueta é uma caixa.
    """
    m = im.getchannel("A").point(lambda v: 255 if v > 128 else 0)
    caixa = m.getbbox()
    if not caixa:
        return False
    area = sum(1 for v in m.crop(caixa).tobytes() if v)
    return area / ((caixa[2] - caixa[0]) * (caixa[3] - caixa[1])) > limite


def apagar_fundo_chapado(im):
    """Torna transparente o fundo chapado que encosta na borda do desenho.

    Preenchimento a partir do contorno externo, então só sai o que está ligado
    à borda: uma área da mesma cor cercada pelo escudo (o preto dentro do
    monograma da Inter, por exemplo) fica no lugar.
    """
    from collections import deque, Counter
    im = im.convert("RGBA")
    l, a = im.size
    px = im.load()
    opaco = lambda x, y: px[x, y][3] > 128

    contorno = []
    for y in range(a):
        for x in range(l):
            if not opaco(x, y):
                continue
            if x in (0, l - 1) or y in (0, a - 1):
                contorno.append((x, y))
                continue
            if any(not opaco(x + dx, y + dy)
                   for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                contorno.append((x, y))
    if not contorno:
        return im
    cor = Counter(px[x, y][:3] for x, y in contorno).most_common(1)[0][0]
    perto = lambda x, y: sum(abs(px[x, y][i] - cor[i]) for i in range(3)) <= TOLERANCIA_FUNDO

    vis = bytearray(l * a)
    fila = deque(p for p in contorno if perto(*p))
    for x, y in fila:
        vis[y * l + x] = 1
    while fila:
        x, y = fila.popleft()
        px[x, y] = (0, 0, 0, 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            u, v = x + dx, y + dy
            if 0 <= u < l and 0 <= v < a and not vis[v * l + u] \
               and px[u, v][3] > 128 and perto(u, v):
                vis[v * l + u] = 1
                fila.append((u, v))
    return im


def recortar_margem(im):
    """Tira a moldura vazia em volta do escudo."""
    caixa = im.getchannel("A").getbbox()          # margem transparente
    if caixa and caixa != (0, 0) + im.size:
        return im.crop(caixa)

    # sem transparência: se os quatro cantos têm a mesma cor, ela é o fundo
    l, a = im.size
    cantos = [im.getpixel(p) for p in ((0, 0), (l - 1, 0), (0, a - 1), (l - 1, a - 1))]
    if len({c[:3] for c in cantos}) != 1:
        return im
    fundo = cantos[0][:3]
    fundo_img = Image.new("RGB", im.size, fundo)
    from PIL import ImageChops
    dif = ImageChops.difference(im.convert("RGB"), fundo_img).convert("L")
    caixa = dif.point(lambda v: 255 if v > TOLERANCIA else 0).getbbox()
    return im.crop(caixa) if caixa else im


def _sem_entidades(svg):
    """Expande as entidades XML declaradas no DOCTYPE e remove a declaração.

    SVG exportado pelo Illustrator costuma declarar entidades e usá-las no
    próprio cabeçalho (xmlns="&ns_svg;"). O rasterizador recusa arquivos com
    DOCTYPE por segurança, e apagar a declaração sem substituir os usos deixa
    referências soltas — o arquivo passa a não ser XML válido.
    """
    doc = re.search(rb"<!DOCTYPE.*?\[(.*?)\]\s*>", svg, flags=re.S)
    if not doc:
        return svg
    for nome, valor in re.findall(rb'<!ENTITY\s+(\S+)\s+"([^"]*)"', doc.group(1)):
        svg = svg.replace(b"&" + nome + b";", valor)
    return svg[:doc.start()] + svg[doc.end():]


def padronizar(caminho):
    """(mudou, descricao)"""
    bruto = open(caminho, "rb").read()
    tipo = formato(bruto)
    if tipo == "svg":
        try:
            import cairosvg
        except ImportError:
            return False, "SVG e cairosvg não está instalado (pip install cairosvg)"
        # rasteriza grande para que o recorte e a redução saiam nítidos
        try:
            bruto = cairosvg.svg2png(bytestring=bruto, output_width=TELA * 4)
        except Exception:
            bruto = cairosvg.svg2png(bytestring=_sem_entidades(bruto),
                                     output_width=TELA * 4)
        tipo = "svg→png"
    if tipo == "?":
        return False, "formato não reconhecido"

    base, ext = os.path.splitext(caminho)
    im = Image.open(io.BytesIO(bruto)).convert("RGBA")
    antes = im.size

    # Antes da verificação de "já padronizado": apagar o fundo muda o tamanho do
    # desenho, então ele precisa ser reescalado e recentralizado depois.
    #
    # A condição de silhueta é o que torna isso seguro de repetir: só age quando
    # o alfa é quase uma caixa (o fundo chapado é retangular). Depois de apagar,
    # sobra o desenho recortado e a condição deixa de valer — sem ela, a segunda
    # execução acharia que o contorno é o próprio escudo e o apagaria.
    mexeu_fundo = False
    if os.path.basename(base) in FUNDO_CHAPADO and _silhueta_de_caixa(im):
        im = apagar_fundo_chapado(im)
        mexeu_fundo = True

    # já padronizado: não reprocessa. Redimensionar de novo só perderia
    # nitidez, e é o tipo de perda que se acumula a cada execução do ciclo.
    if ext.lower() == ".png" and im.size == (TELA, TELA) and not mexeu_fundo:
        caixa = im.getchannel("A").point(lambda v: 255 if v > 12 else 0).getbbox()
        if caixa and abs(max(caixa[2] - caixa[0], caixa[3] - caixa[1]) - CONTEUDO) <= 2:
            return False, None

    escudo = recortar_margem(im)
    escala = CONTEUDO / max(escudo.size)
    novo = (max(1, round(escudo.size[0] * escala)), max(1, round(escudo.size[1] * escala)))
    escudo = escudo.resize(novo, Image.LANCZOS)

    tela = Image.new("RGBA", (TELA, TELA), (0, 0, 0, 0))
    # alpha_composite, não paste com a própria imagem como máscara: naquele
    # caminho o Pillow multiplica o alfa por si mesmo, então cada execução
    # deixava o escudo um pouco mais transparente. Depois de algumas rodadas
    # os escudos sumiam.
    tela.alpha_composite(escudo, ((TELA - novo[0]) // 2, (TELA - novo[1]) // 2))

    destino = base + ".png"
    if ext.lower() != ".png":
        os.remove(caminho)
    tela.save(destino, "PNG", optimize=True)
    marca = f"  ({tipo}→png)" if tipo != "png" else ""
    return True, f"{antes[0]}x{antes[1]} → {TELA}x{TELA}{marca}"


def slug(t):
    t = unicodedata.normalize("NFD", str(t))
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = t.replace("'", "").replace("’", "").replace("ª", "a").replace("º", "o")
    return re.sub(r"[^a-zA-Z0-9]+", "-", t).strip("-").lower()


def precisa_de_fundo(caminho):
    """O escudo é escuro demais para o fundo escuro do site?

    O site é escuro (o cartão tem luminância ~30) e a maioria dos escudos foi
    desenhada para fundo branco. Os escuros somem. Quem for escuro recebe um
    contorno claro, no CSS; quem for claro fica como está — realçar um escudo
    branco criaria o problema inverso.

    O contorno é um drop-shadow, que acompanha o recorte do PNG. A primeira
    tentativa foi uma placa retangular atrás do escudo, mas ela aparecia como um
    fundo branco em parte deles e o conjunto ficava desigual.
    """
    try:
        im = Image.open(caminho).convert("RGBA")
    except Exception:
        return False
    px = im.load()
    soma = escuros = total = 0
    for y in range(0, im.size[1], 2):
        for x in range(0, im.size[0], 2):
            r, g, b, a = px[x, y]
            if a < 128:
                continue
            lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
            soma += lum
            escuros += lum < 60
            total += 1
    if not total:
        return False
    return (soma / total) < 105 or (escuros / total) > 0.60


def corrigir_apontamentos():
    """Refaz o campo 'escudo' de clubes.json a partir dos arquivos presentes.

    Esta função converte formatos, então é ela que sabe o nome final de cada
    arquivo. Sem isso, um apontamento gravado antes da conversão ficava preso à
    extensão antiga — foi o que aconteceu com o fc-jurong.webp.
    """
    cam = os.path.join(RAIZ, "data", "clubes.json")
    if not os.path.exists(cam):
        return 0
    clubes = json.load(io.open(cam, encoding="utf-8"))
    mudou = 0
    for nome, info in clubes.items():
        if info.get("bandeira"):
            continue
        sl = slug(nome)
        arquivo = next((os.path.join(DESTINO, sl + e)
                        for e in (".png", ".svg", ".jpg", ".jpeg", ".gif", ".webp")
                        if os.path.exists(os.path.join(DESTINO, sl + e))), None)
        if arquivo:
            escuro = precisa_de_fundo(arquivo)
            if escuro != bool(info.get("escuro")):
                if escuro:
                    info["escuro"] = True
                else:
                    info.pop("escuro", None)
                mudou += 1
        if os.path.exists(os.path.join(DESTINO, sl + ".png")):
            if info.pop("escudo", None) is not None:
                mudou += 1
            continue
        alt = next((e for e in (".svg", ".jpg", ".jpeg", ".gif", ".webp")
                    if os.path.exists(os.path.join(DESTINO, sl + e))), None)
        novo = sl + alt if alt else None
        if novo != info.get("escudo"):
            if novo:
                info["escudo"] = novo
            else:
                info.pop("escudo", None)
            mudou += 1
    if mudou:
        json.dump(clubes, io.open(cam, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        io.open(cam, "a", encoding="utf-8").write("\n")
    return mudou


def main():
    aplicar = "--aplicar" in sys.argv
    arquivos = [f for f in sorted(glob.glob(os.path.join(DESTINO, "*")))
                if not f.endswith(".md")]
    mudados, problemas, svgs = 0, [], 0
    for f in arquivos:
        if not aplicar:
            tipo = formato(open(f, "rb").read(1024))
            if tipo == "svg":
                svgs += 1
            elif tipo == "?":
                problemas.append(os.path.basename(f))
            else:
                mudados += 1
            continue
        try:
            mudou, desc = padronizar(f)
            if desc and mudou:
                mudados += 1
            elif desc:
                problemas.append(f"{os.path.basename(f)}: {desc}")
            else:
                svgs += 1
        except Exception as e:
            problemas.append(f"{os.path.basename(f)}: {e}")

    print(f"{len(arquivos)} escudos · {mudados} padronizados em {TELA}x{TELA}"
          + (f" · {svgs} sem tratamento" if svgs else ""))
    if aplicar:
        n = corrigir_apontamentos()
        if n:
            print(f"{n} apontamentos de escudo corrigidos em clubes.json")
    if problemas:
        print(f"\nnão consegui tratar ({len(problemas)}):")
        for p in problemas:
            print("   ✗", p)
    if not aplicar:
        print("\n[simulação] rode com --aplicar para gravar")


if __name__ == "__main__":
    main()
