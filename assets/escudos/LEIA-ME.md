# Escudos dos clubes

Coloque aqui os escudos. **Não se preocupe com tamanho nem com formato** —
PNG, JPG, WEBP, GIF ou SVG, em qualquer dimensão. O `./atualizar.sh` converte,
recorta a margem vazia em volta e padroniza tudo em 160×160, de modo que dois
escudos de proporções diferentes ocupem a mesma altura na tela.

O que importa é só o nome do arquivo.

O nome do arquivo deve ser o **nome do clube em minúsculas, sem acento, com hífen no lugar dos espaços** e terminando em `.png`:

| Clube no JSON      | Arquivo esperado           |
| ------------------ | -------------------------- |
| `Real Madrid`      | `real-madrid.png`          |
| `São Paulo`        | `sao-paulo.png`            |
| `Bayern de Munique`| `bayern-de-munique.png`    |
| `1. FC Köln`       | `1-fc-koln.png`            |

Se o arquivo não existir, o site mostra automaticamente um escudo provisório com as iniciais do clube — nada quebra. Você pode ir adicionando os escudos aos poucos.

## Nome de arquivo diferente

Se preferir outro nome (ou usar uma imagem hospedada na internet), declare em `data/clubes.json`:

```json
{
  "Real Madrid": { "pais": "Espanha", "escudo": "rma-2024.png" },
  "Porto":       { "pais": "Portugal", "escudo": "https://exemplo.com/porto.png" }
}
```
