# Como alimentar o registro do NCOFDI

Todo o conteúdo do site vem dos arquivos JSON dentro de `data/`. Você nunca precisa mexer no HTML, CSS ou JS para cadastrar um campeão.

```
data/
├── estrutura.json          → seções, confederações, países e estados (o menu do site)
├── clubes.json             → país e escudo de cada clube (gerado)
└── competicoes/            → 154 arquivos, um por local
    ├── uefa.json           → Champions, Europa League, Conference, Super Cup
    ├── espanha.json        → LaLiga, Hypermotion, Primera Federación, Copa del Rey
    ├── brasil-nacional.json → Séries A–D, Copa do Brasil, Supercopa
    ├── copas-regionais.json → Copa Verde, do Nordeste, Norte, Centro-Oeste, Sul-Sudeste
    ├── br-sp.json          → Campeonato Paulista (1ª a 5ª) e Copa Paulista
    ├── br-rj.json          → Campeonato Carioca (1ª a 5ª) e Copa Rio
    ├── selecoes-uefa.json  → Eurocopa, Liga das Nações
    └── … (mais 147)
```

O site está organizado em **9 seções**: Europa, Ásia, África, América do Sul, América do Norte/Central, Oceania, Internacional de Clubes, Brasil e Seleções.

---

## 1. Registrar um campeão

Abra o arquivo do local e acrescente uma entrada no array `campeoes`:

```json
{
  "id": "espanha",
  "nome": "Espanha",
  "tipo": "pais",
  "competicoes": [
    {
      "id": "laliga",
      "nome": "LaLiga",
      "tipo": "Liga Nacional",
      "campeoes": [
        { "temporada": "2024/25", "clube": "Real Madrid" },
        { "temporada": "2025/26", "clube": "Getafe" }
      ]
    }
  ]
}
```

Cada campeão tem só dois campos, ambos obrigatórios:

| Campo       | Observação                                                          |
| ----------- | ------------------------------------------------------------------- |
| `temporada` | sempre o **ano de encerramento** (`"2026"`); a exibição cuida do resto |
| `clube`     | escreva **sempre igual**; é a chave que soma os títulos              |

**Temporadas que cruzam o ano.** Não escreva `"2025/26"` no JSON. Guarde `"2026"` e marque o país em `data/estrutura.json` com `"calendario": "europeu"` — o site então mostra `2025/26` em todas as competições daquele local. Assim a importação e a ordenação continuam simples, e mudar a classificação de um país é uma linha.

> ⚠️ **Grafia consistente é o que importa.** "Real Madrid" e "Real Madrid CF" contam como dois clubes diferentes no ranking.

A ordem não importa — o site ordena da temporada mais recente para a mais antiga.

O ranking de **Maiores campeões** é calculado sozinho a partir de tudo que está registrado. Não existe planilha separada pra manter.

---

## 2. Onde fica cada coisa

| O que você quer registrar          | Arquivo                              |
| ---------------------------------- | ------------------------------------ |
| Champions League, Europa League    | `uefa.json`                          |
| Libertadores, Sul-Americana        | `conmebol.json`                      |
| Liga/copa de um país               | `<pais>.json` (ex.: `alemanha.json`) |
| Brasileirão, Copa do Brasil        | `brasil-nacional.json`               |
| Copa do Nordeste, Copa Verde…      | `copas-regionais.json`               |
| Estaduais e copas estaduais        | `br-<uf>.json` (ex.: `br-mg.json`)   |
| Mundial de Clubes, Intercontinental| `intercontinental.json`              |
| Copa do Mundo, Finalíssima         | `selecoes-mundiais.json`             |
| Eurocopa, Copa América, AFCON…     | `selecoes-<confederação>.json`       |

---

## 3. País e escudo de um clube

`data/clubes.json` é **gerado automaticamente** por `ferramentas/gerar_clubes.py`, que varre as tabelas de classificação de todas as planilhas e descobre o país de cada clube. É assim que os campeões de torneios continentais aparecem com a bandeira do país de origem.

Rode-o sempre **antes** do importador, e de novo quando acrescentar planilhas:

```bash
python3 ferramentas/gerar_clubes.py --aplicar   # descobre o país de cada clube
python3 ferramentas/importar.py --aplicar       # importa os campeões
```

Clubes que não aparecem em nenhuma aba de país (só como campeões continentais) ficam em `CLUBES_MANUAIS`, em `ferramentas/mapa_planilhas.py`.

Você ainda pode editar o arquivo à mão para acrescentar campos:

```json
{
  "Real Madrid": { "pais": "Espanha",  "escudo": "real-madrid.png" },
  "Porto":       { "pais": "Portugal", "escudo": "porto.png" },
  "Brasil":      { "bandeira": "🇧🇷" }
}
```

- **`pais`** — se não informar, o site deduz: clubes que venceram uma liga nacional herdam o país dela; clubes das competições brasileiras (estaduais, Séries A–D, copas regionais) herdam "Brasil".
- **`escudo`** — nome do arquivo em `assets/escudos/` (veja `assets/escudos/LEIA-ME.md`) ou uma URL completa.
- **`bandeira`** — um emoji usado no lugar do escudo. Útil para seleções, que não precisam de PNG.

---

## 4. Adicionar uma competição nova

Dentro do arquivo do local, acrescente um objeto em `competicoes`:

```json
{
  "id": "supercopa-da-espanha",
  "nome": "Supercopa da Espanha",
  "tipo": "Supercopa",
  "campeoes": []
}
```

- **`id`** — minúsculo, sem acento, com hífen. Vira o endereço da página.
- **`nome`** — o que aparece na tela. **Pode ser alterado sem mexer no `id`.**
- **`tipo`** — alimenta o filtro do ranking e o ícone do cartão. Os tipos em uso hoje:

  `Liga Nacional` · `2ª Divisão` · `3ª Divisão` · `4ª Divisão` · `5ª Divisão` · `Copa Nacional` · `Copa da Liga` · `Supercopa` · `Estadual` · `Copa Estadual` · `Copa Regional` · `Torneio Continental` · `Torneio Mundial`

  Você pode inventar tipos novos — o filtro é montado a partir do que existe nos dados.

---

## 5. Corrigir o nome de uma competição

Troque o campo `nome` no JSON do local. O `id` pode continuar o mesmo — ele só aparece no endereço da página.

**[NOMES-DAS-COMPETICOES.md](NOMES-DAS-COMPETICOES.md)** lista as 359 competições com o arquivo de cada uma, para você encontrar rápido onde mexer. Esse arquivo é **gerado a partir dos dados**: editar ele não muda o site.

---

## 6. Adicionar um país novo

**a)** em `data/estrutura.json`, dentro da seção certa, acrescente no array `paises`:

```json
{ "id": "senegal", "nome": "Senegal", "iso": "sn" }
```

O `iso` é o código de 2 letras — o site converte no emoji da bandeira sozinho. Para bandeiras sem código ISO (Escócia, Inglaterra, País de Gales), use `"bandeira": "🏴󠁧󠁢󠁳󠁣󠁴󠁿"`.

**b)** crie `data/competicoes/senegal.json`:

```json
{
  "id": "senegal",
  "nome": "Senegal",
  "tipo": "pais",
  "competicoes": [
    { "id": "ligue-1", "nome": "Ligue 1 Senegalesa", "tipo": "Liga Nacional", "campeoes": [] }
  ]
}
```

O `id` do arquivo, o `id` dentro dele e o `id` em `estrutura.json` precisam ser **iguais**.

---

## 7. Rodar e publicar

**Testar na sua máquina** — o navegador bloqueia a leitura dos JSON se você abrir o `index.html` direto do disco, então use um servidor local:

```bash
./servir.sh          # depois abra http://localhost:8000
```

**Publicar no GitHub Pages** — depois de dar `git push`:

1. Repositório → **Settings** → **Pages**
2. *Source*: `Deploy from a branch`
3. *Branch*: `main`, pasta `/ (root)` → **Save**

Em ~1 minuto o site fica no ar em `https://<seu-usuario>.github.io/Registro-hist-rico-NCOFDI/`. Cada `git push` atualiza o site.

---

## 8. Conferir os dados

Sempre que mexer nos JSON, rode:

```bash
python3 checar.py
```

Ele varre os 156 arquivos e aponta:

- **Erros que quebram o site** — JSON inválido (vírgula sobrando, aspas simples, chave faltando), campeão sem `clube` ou sem `temporada`, `id` que não bate com o nome do arquivo, id de competição repetido.
- **Avisos** — a mesma temporada cadastrada duas vezes na mesma competição, arquivo em `competicoes/` que não está em `estrutura.json` (não aparece no site), e **grafias diferentes do mesmo clube** ("Santa Cruz-AC" vs "Santa Cruz AC"), que é o erro que mais silenciosamente estraga o ranking.
- **Escudos** — a lista exata dos arquivos que faltam em `assets/escudos/`, com o nome que cada um precisa ter, e os escudos que estão na pasta sem clube correspondente.

Sai com código de erro se houver algum problema grave, então dá pra usar antes de publicar.
