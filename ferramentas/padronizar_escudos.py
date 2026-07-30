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
SVG fica de fora: é vetor, escala sozinho sem perder nada.

Uso:  python3 ferramentas/padronizar_escudos.py [--aplicar]
"""
import glob, os, sys, io, json, re, unicodedata
from PIL import Image

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESTINO = os.path.join(RAIZ, "assets", "escudos")

TELA = 160        # lado da imagem final
CONTEUDO = 152    # lado maior do escudo dentro dela (deixa uma margem mínima)
TOLERANCIA = 12   # quanto uma cor pode variar e ainda contar como margem


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


def padronizar(caminho):
    """(mudou, descricao)"""
    bruto = open(caminho, "rb").read()
    tipo = formato(bruto)
    if tipo == "svg":
        return False, None
    if tipo == "?":
        return False, "formato não reconhecido"

    base, ext = os.path.splitext(caminho)
    im = Image.open(io.BytesIO(bruto)).convert("RGBA")
    antes = im.size

    escudo = recortar_margem(im)
    escala = CONTEUDO / max(escudo.size)
    novo = (max(1, round(escudo.size[0] * escala)), max(1, round(escudo.size[1] * escala)))
    escudo = escudo.resize(novo, Image.LANCZOS)

    tela = Image.new("RGBA", (TELA, TELA), (0, 0, 0, 0))
    tela.paste(escudo, ((TELA - novo[0]) // 2, (TELA - novo[1]) // 2), escudo)

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

    print(f"{len(arquivos)} escudos · {mudados} padronizados em {TELA}x{TELA} · {svgs} SVG intactos")
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
