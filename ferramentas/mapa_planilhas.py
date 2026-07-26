"""Regras de leitura das planilhas do NCOFDI.

A coluna "Campeões" de cada aba é o gabarito: ela lista os campeões na mesma
ordem dos BLOCOS de competição da aba. Este arquivo diz quais blocos contam
como competição e para qual competição do site cada um aponta.
"""

# Blocos que aparecem na linha 1 mas não são competições.
NAO_COMPETICAO = [
    "Campeões", "Campeão", "Tabela geral", "Tabela Geral", "Tabela acumulada",
    "Tabela", "Final absoluta", "Play-In", "Playoff Ásia-Oceania",
    "Fase de Grupos", "Fase preliminar", "Playoffs", "Quartas de final",
    "Oitavas de final", "Semifinal", "Final", "Grupo A", "Grupo B",
]

# Cabeçalhos de bloco que escaparam para a linha 2.
BLOCOS_LINHA_2 = {("Estaduais", "PA"): ["Paraense A3"]}

# Nome do bloco na planilha -> nome da competição no site.
# Só onde diferem; o resto casa por nome exato (sem acento/maiúsculas).
ALIASES = {
    # Europa
    ("Espanha", "LaLiga 2"): "LaLiga Hypermotion",
    ("Belarus", "Vysshaya Liga"): "Vysheyshaya Liga",
    ("San Marino", "Campionato Sammarinense"): "Campionato Sammarinese",
    ("Alemanha", "DFB Pokal"): "DFB-Pokal",
    # África
    ("Guiné", "Ligue 1"): "Guinea Ligue 1",
    ("Nigéria", "Federation Cup"): "Nigeria Federation Cup",
    ("Tanzânia", "Federation Cup"): "Tanzanian Federation Cup",
    # América do Sul
    ("Bolívia", "Copa Paceña"): "Copa de la División Profesional",
    ("Peru", "Copa LPF"): "Copa Caliente de la Liga",
    ("Uruguai", "Copa Uruguay"): "Copa Uruguay",
    # Santa Catarina
    ("SC", "Copa SC"): "Copa Santa Catarina",
}

# Abas cujos blocos NÃO podem ser deduzidos: lista explícita e ordenada dos
# nomes de competição do site correspondentes a cada campeão da coluna.
# A chave é (arquivo, aba, ano) — ano None vale para todos.
EXPLICITO = {
    # Colômbia mudou de formato: até 2026 título único, de 2027 em diante
    # Apertura e Clausura viram títulos separados.
    ("Sulamericanos", "Colômbia", 2026): ["Primera A", "Copa Colombia"],
    ("Sulamericanos", "Colômbia", 2027): ["Primera A — Apertura", "Primera A — Clausura",
                                          "Copa Colombia"],
    # A Final absoluta define o campeão nacional; Apertura e Clausura são fases.
    ("Sulamericanos", "Venezuela", None): ["Liga FUTVE", "Copa Venezuela"],
    ("Sulamericanos", "Uruguai", None): ["Primera División Uruguaia", "Copa Uruguay"],
    # O bloco 'Primera División' traz Apertura e Clausura juntos.
    ("Sulamericanos", "Paraguai", None): ["Primera División — Apertura",
                                          "Primera División — Clausura", "Copa Paraguay"],
    # A 'Tabela acumulada' guarda o playoff do título; 'Apertura' é fase.
    ("Sulamericanos", "Peru", None): ["Liga 1", "Copa Caliente de la Liga"],
    # A Tabela Geral é título na Argentina, mesmo sem bloco próprio no Ano 1.
    ("Sulamericanos", "Argentina", None): ["Torneo Apertura", "Torneo Clausura",
                                           "Tabela Geral da Liga", "Primera Nacional",
                                           "Copa Argentina"],
    # Fase regular = liga; mata-mata seguinte = copa nacional.
    ("Asiáticos", "Filipinas", None): ["Philippines Football League", "Copa Paulino Alcantara"],
    # A coluna da Alemanha não traz o campeão da Bundesliga (vem da tabela,
    # ver COMPLEMENTOS); os três listados são 2. Bundesliga, 3. Liga e a copa.
    ("Europeus", "Alemanha", None): ["2. Bundesliga", "3. Liga", "DFB-Pokal"],
    ("Concacaf", "Estados Unidos", None): ["MLS", "US Open Cup"],
    # Ordem dos blocos difere da ordem do site.
    ("Internacionais", "Conmebol", None): ["Recopa Sul-Americana", "Copa Libertadores",
                                           "Copa Sul-Americana"],
    ("Internacionais", "Concacaf", None): ["Concacaf Champions Cup", "Copa Centroamericana"],
    ("Internacionais", "UEFA", None): ["UEFA Champions League", "UEFA Europa League",
                                       "UEFA Conference League"],
    ("Internacionais", "AFC", None): ["AFC Champions League Elite", "AFC Champions League Two",
                                      "AFC Challenge League"],
    ("Internacionais", "CAF", None): ["CAF Champions League", "CAF Confederation Cup"],
    ("Internacionais", "OFC", None): ["OFC Professional League"],
    ("Internacionais", "Intercontinental", None): ["Copa Intercontinental"],
    # No Ano 2 o bloco da 2ª divisão do Maranhão ficou rotulado como "Grupo A".
    ("Estaduais", "MA", 2027): ["Campeonato Maranhense", "Campeonato Maranhense — 2ª Divisão"],
    # Pará no Ano 2: os 3 campeões são das 3 divisões (a Copa-Grão Pará não é registrada).
    ("Estaduais", "PA", 2027): ["Campeonato Paraense", "Campeonato Paraense — 2ª Divisão",
                                "Campeonato Paraense — 3ª Divisão"],
}

# Campeões que não estão na coluna e precisam ser lidos da classificação:
# (arquivo, aba, ano) -> [(competição do site, nome do bloco na planilha)]
COMPLEMENTOS = {
    ("Europeus", "Alemanha", 2026): [("Bundesliga", "Bundesliga")],
}

# Abas sem coluna "Campeões": extrair pelo chaveamento.
POR_CHAVEAMENTO = {("Estaduais", "SE", 2027)}

# Aba da planilha -> local do site, quando os nomes diferem.
ABA_PARA_LOCAL = {
    ("Europeus", "Bósnia"): "bosnia-e-herzegovina",
    ("Asiáticos", "Coreia do Sul"): "coreia-do-sul",
    # As confederações têm o mesmo nome na seção de clubes e na de seleções;
    # este arquivo é de clubes.
    ("Internacionais", "UEFA"): "uefa",
    ("Internacionais", "AFC"): "afc",
    ("Internacionais", "CAF"): "caf",
    ("Internacionais", "Concacaf"): "concacaf",
    ("Internacionais", "Conmebol"): "conmebol",
    ("Internacionais", "OFC"): "ofc",
    ("Internacionais", "Intercontinental"): "intercontinental",
}

# Sub-blocos com final própria que NÃO valem como título do bloco.
SUB_TORNEIOS = [
    "Taça Rio", "Taça Farroupilha", "Taça Acesc", "Troféu Inconfidência",
    "Copa-Grão Pará", "Playoff de acesso", "Playoff do rebaixamento",
    "Quadrangular do rebaixamento", "Rodada do rebaixamento",
    "Duelo do rebaixamento", "Disputa de 3o lugar", "Disputa de 3º lugar",
    "Disputa de 5o lugar",
]

# Sub-bloco que, ao contrário, DECIDE o título (turno/returno).
DECISIVOS = ["Final geral"]

# Arquivo -> ano de calendário de cada "ANO n".
def temporada(ano_n):
    """ANO 1 = 2026, ANO 2 = 2027, ..."""
    return 2025 + int(ano_n)


# ---------------------------------------------------------------------------
# Arquivo "Campeonatos Brasileiros": uma aba por competição, com uma célula
# "Campeão" (ou "Campeões", nos regionais).
BRASILEIROS = {
    "Supercopa":      ("brasil-nacional", ["Supercopa do Brasil"]),
    "Série A":        ("brasil-nacional", ["Brasileirão Série A"]),
    "Série B":        ("brasil-nacional", ["Brasileirão Série B"]),
    "Série C":        ("brasil-nacional", ["Brasileirão Série C"]),
    "Série D":        ("brasil-nacional", ["Brasileirão Série D"]),
    "Copa do Brasil": ("brasil-nacional", ["Copa do Brasil"]),
    # O bloco "Copa Verde" da planilha abriga Norte, Centro-Oeste e, na
    # "Final geral", a própria Copa Verde — daí os cinco campeões.
    "Regionais":      ("copas-regionais", ["Copa Sul-Sudeste", "Copa do Nordeste",
                                           "Copa Norte", "Copa Centro-Oeste", "Copa Verde"]),
}
