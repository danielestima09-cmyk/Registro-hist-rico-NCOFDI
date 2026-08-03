/* ==========================================================================
   NCOFDI — Registro Histórico
   Site estático: lê os JSON de /data e monta a navegação por hash.
   ========================================================================== */

(function () {
  "use strict";

  var app = document.getElementById("app");

  /* Estado global carregado uma única vez -------------------------------- */
  var DADOS = {
    estrutura: null,
    clubes: {},        // "Real Madrid" -> { pais, escudo, bandeira }
    competicoes: {},   // "espanha" -> arquivo de competições
    locais: {},        // "espanha" -> { id, nome, tipo, secao, ref }
    ranking: [],       // agregação dos campeões (clubes + seleções)
    porChave: {},      // chave -> registro do campeão
    tipos: [],         // tipos de competição encontrados nos dados
    falhas: []         // arquivos de dados que não carregaram
  };

  var indicePaisPorNome = {};

  // Versão dos arquivos, lida do ?v=N com que o index.html carrega este script.
  // Ela é repassada às buscas de dados: sem isso o navegador podia continuar
  // servindo JSON antigo do cache mesmo depois de uma publicação, e o site
  // aparecia sem os campeões recém-adicionados.
  var VERSAO = (function () {
    try {
      var s = document.currentScript ||
              document.querySelector('script[src*="app.js"]');
      var m = s && s.src && s.src.match(/[?&]v=([\w.]+)/);
      return m ? m[1] : "";
    } catch (e) {
      return "";
    }
  })();

  /* ---------------------------------------------------------------- utils */

  function slug(txt) {
    return String(txt)
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/['’]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
  }

  function esc(txt) {
    return String(txt == null ? "" : txt)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Emoji de bandeira a partir do código ISO de 2 letras.
  function bandeira(pais) {
    if (pais && pais.bandeira) return pais.bandeira;
    var iso = pais && pais.iso;
    if (!iso || iso.length !== 2) return "🏳️";
    return String.fromCodePoint.apply(null, iso.toUpperCase().split("").map(function (c) {
      return 0x1F1E6 + c.charCodeAt(0) - 65;
    }));
  }

  function bandeiraDoPaisNome(nome) {
    var p = indicePaisPorNome[nome];
    return p ? bandeira(p) : "";
  }

  // Ícone de um local: bandeira para país, sigla para estado, troféu para confederação.
  function iconeLocal(local) {
    if (!local) return "🏆";
    if (local.tipo === "estado") return '<span class="sigla">' + esc(local.ref.sigla) + "</span>";
    if (local.tipo === "pais") return bandeira(local.ref);
    return "🏆";
  }

  // Cor estável derivada do nome, usada no escudo provisório.
  function corDoNome(nome) {
    var h = 0;
    for (var i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) % 360;
    return "hsl(" + h + ", 42%, 34%)";
  }

  function iniciais(nome) {
    var ignorar = { de: 1, do: 1, da: 1, dos: 1, das: 1, of: 1, the: 1, el: 1, la: 1, and: 1, e: 1 };
    var partes = nome.split(/\s+/).filter(function (p) {
      return p && !ignorar[p.toLowerCase()];
    });
    if (!partes.length) return "?";
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[1][0]).toUpperCase();
  }

  function escudoHTML(nome, grande) {
    var info = DADOS.clubes[nome] || {};
    var classe = "escudo" + (grande ? " g" : "");

    // Seleções podem usar a bandeira direto, sem precisar de PNG.
    if (info.bandeira) {
      return '<span class="' + classe + ' emoji">' + info.bandeira + "</span>";
    }

    // escudo escuro ganha uma placa clara atrás: o fundo do site é escuro e
    // esses desapareciam nele. Quem decide é a padronização, que mede o
    // contraste de cada arquivo e grava "escuro" em clubes.json.
    if (info.escuro) classe += " escuro";

    var arquivo = info.escudo || (slug(nome) + ".png");
    var src = /^https?:/.test(arquivo) ? arquivo : "assets/escudos/" + arquivo;
    // As iniciais ficam por baixo como reserva; somem assim que o PNG carrega,
    // para que escudos com fundo transparente não apareçam sobre o texto.
    return '<span class="' + classe + '">' +
      '<span class="iniciais" style="background:' + corDoNome(nome) + '">' +
        esc(iniciais(nome)) + "</span>" +
      '<img src="' + esc(src) + '" alt="" loading="lazy"' +
        ' onload="this.parentNode.classList.add(\'ok\')" onerror="this.remove()">' +
      "</span>";
  }

  function campeaoHTML(nome, chave) {
    return '<a class="clube" href="#/campeao/' + chave + '">' +
      escudoHTML(nome) + '<span class="clube-nome">' + esc(nome) + "</span></a>";
  }

  // Ordena "2024/25", "2024" etc. pelo primeiro ano.
  // "2026" -> "2025/26" onde a temporada cruza o ano (agosto a maio).
  // O dado guardado é sempre o ano de encerramento; quem cruza é marcado com
  // "calendario": "europeu" em estrutura.json.
  function temporadaEmTexto(temporada, localId) {
    var local = DADOS.locais[localId];
    var t = String(temporada);
    if (!local || (local.ref || {}).calendario !== "europeu" || !/^\d{4}$/.test(t)) {
      return t;
    }
    return (parseInt(t, 10) - 1) + "/" + t.slice(2);
  }

  function anoDe(temporada) {
    var m = String(temporada).match(/\d{4}/);
    return m ? parseInt(m[0], 10) : 0;
  }

  function plural(n, sing, plur) {
    return n + " " + (n === 1 ? sing : plur);
  }

  /* ------------------------------------------------------------- carga */

  function buscarJSON(caminho, tentativas) {
    tentativas = tentativas == null ? 3 : tentativas;
    var url = VERSAO ? caminho + "?v=" + VERSAO : caminho;
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(caminho + " → HTTP " + r.status);
      return r.json();
    }).catch(function (e) {
      // Uma falha isolada é comum logo após uma publicação, enquanto os
      // arquivos ainda não chegaram a todos os servidores. Insiste um pouco
      // antes de desistir — sem isso, a competição simplesmente sumia da tela.
      if (tentativas <= 1) throw e;
      return new Promise(function (ok) { setTimeout(ok, 400); })
        .then(function () { return buscarJSON(caminho, tentativas - 1); });
    });
  }

  function carregar() {
    return Promise.all([
      buscarJSON("data/estrutura.json"),
      buscarJSON("data/clubes.json").catch(function () { return {}; })
    ]).then(function (res) {
      DADOS.estrutura = res[0];
      DADOS.clubes = res[1] || {};

      var ids = [];
      DADOS.estrutura.secoes.forEach(function (secao) {
        // Seção com país próprio (Brasil): serve de país padrão dos campeões dela.
        if (secao.pais) indicePaisPorNome[secao.pais.nome] = secao.pais;
        (secao.confederacoes || []).forEach(function (c) {
          DADOS.locais[c.id] = { id: c.id, nome: c.nome, tipo: "confederacao", secao: secao, ref: c };
          ids.push(c.id);
        });
        (secao.paises || []).forEach(function (p) {
          var tipo = p.sigla ? "estado" : "pais";
          DADOS.locais[p.id] = { id: p.id, nome: p.nome, tipo: tipo, secao: secao, ref: p };
          if (tipo === "pais") indicePaisPorNome[p.nome] = p;
          ids.push(p.id);
        });
      });

      // São ~150 arquivos pequenos; mostra o progresso para não parecer travado.
      var prontos = 0;
      var texto = document.querySelector(".carregando p");
      return Promise.all(ids.map(function (id) {
        return buscarJSON("data/competicoes/" + id + ".json")
          .catch(function (e) {
            console.warn("Não foi possível carregar", id, e);
            DADOS.falhas.push(id);
            return { id: id, nome: id, competicoes: [] };
          })
          .then(function (arq) {
            prontos++;
            if (texto && prontos % 10 === 0) {
              texto.textContent = "Carregando o registro histórico… " + prontos + "/" + ids.length;
            }
            return arq;
          });
      }));
    }).then(function (arquivos) {
      arquivos.forEach(function (arq) { DADOS.competicoes[arq.id] = arq; });
      agregar();
    });
  }

  /* --------------------------------------------------- agregação de títulos */

  function agregar() {
    var mapa = {};
    var tipos = {};

    Object.keys(DADOS.locais).forEach(function (localId) {
      var arq = DADOS.competicoes[localId];
      var local = DADOS.locais[localId];
      if (!arq) return;
      var ehSelecao = local.secao.entidade === "selecao";
      // País deduzido quando o clube não está em clubes.json: o do próprio local,
      // ou o da seção (estaduais e competições nacionais brasileiras).
      var paisDoLocal = local.tipo === "pais" ? local.nome
                      : (local.secao.pais ? local.secao.pais.nome : "");

      (arq.competicoes || []).forEach(function (comp) {
        if (comp.tipo) tipos[comp.tipo] = 1;
        (comp.campeoes || []).forEach(function (t) {
          if (!t || !t.clube) return;
          // Prefixo evita que a seleção do Brasil colida com um clube homônimo.
          var chave = (ehSelecao ? "sel-" : "") + slug(t.clube);
          if (!mapa[chave]) {
            mapa[chave] = {
              chave: chave,
              nome: t.clube,
              selecao: ehSelecao,
              pais: (DADOS.clubes[t.clube] || {}).pais || (ehSelecao ? t.clube : paisDoLocal),
              titulos: [],
              porCompeticao: {}
            };
          }
          var reg = mapa[chave];
          if (!reg.pais) reg.pais = paisDoLocal;
          reg.titulos.push({
            temporada: t.temporada,
            competicao: comp.nome,
            competicaoId: comp.id,
            localId: localId,
            localNome: local.nome,
            secaoId: local.secao.id,
            tipo: comp.tipo || ""
          });
          reg.porCompeticao[comp.nome] = (reg.porCompeticao[comp.nome] || 0) + 1;
        });
      });
    });

    DADOS.porChave = mapa;
    DADOS.ranking = Object.keys(mapa).map(function (k) { return mapa[k]; }).sort(ordenarRanking);

    var ordemPreferida = ["Liga Nacional", "2ª Divisão", "3ª Divisão", "4ª Divisão", "5ª Divisão",
      "Copa Nacional", "Copa da Liga", "Supercopa", "Estadual", "Copa Estadual", "Copa Regional",
      "Torneio Continental", "Torneio Mundial"];
    DADOS.tipos = Object.keys(tipos).sort(function (a, b) {
      var ia = ordemPreferida.indexOf(a), ib = ordemPreferida.indexOf(b);
      if (ia === -1) ia = 99;
      if (ib === -1) ib = 99;
      return ia - ib || a.localeCompare(b, "pt-BR");
    });
  }

  function ordenarRanking(a, b) {
    return b.titulos.length - a.titulos.length || a.nome.localeCompare(b.nome, "pt-BR");
  }

  function totalTitulos() {
    return DADOS.ranking.reduce(function (s, c) { return s + c.titulos.length; }, 0);
  }

  function totalCompeticoes() {
    return Object.keys(DADOS.competicoes).reduce(function (s, k) {
      return s + (DADOS.competicoes[k].competicoes || []).length;
    }, 0);
  }

  function contarTitulosDoLocal(localId) {
    var arq = DADOS.competicoes[localId];
    if (!arq) return 0;
    return (arq.competicoes || []).reduce(function (s, c) { return s + (c.campeoes || []).length; }, 0);
  }

  function locaisDaSecao(secao) {
    return [].concat(secao.confederacoes || [], secao.paises || []);
  }

  /* ---------------------------------------------------------- componentes */

  function migalhas(itens) {
    return '<nav class="migalhas">' + itens.map(function (it, i) {
      var pedaco = it.href ? '<a href="' + it.href + '">' + esc(it.texto) + "</a>"
                           : "<span>" + esc(it.texto) + "</span>";
      return (i ? '<span class="sep">›</span>' : "") + pedaco;
    }).join("") + "</nav>";
  }

  function cartao(href, icone, titulo, sub, classe) {
    return '<a class="cartao ' + (classe || "") + '" href="' + href + '">' +
      '<span class="cartao-icone">' + icone + "</span>" +
      '<span class="cartao-texto">' +
        '<span class="cartao-titulo">' + esc(titulo) + "</span>" +
        (sub ? '<span class="cartao-sub">' + esc(sub) + "</span>" : "") +
      "</span></a>";
  }

  function mensagemVazia(titulo, texto) {
    return '<div class="vazio-msg"><strong>' + esc(titulo) + "</strong>" + texto + "</div>";
  }

  function iconeCompeticao(comp) {
    if (comp.tipo === "Torneio Continental" || comp.tipo === "Torneio Mundial") return "🌍";
    if (/copa|cup|taça|taca|pokal|beker|coupe|coppa/i.test(comp.nome)) return "🏅";
    return "🏆";
  }

  /* ----------------------------------------------------------- páginas */

  function paginaInicio() {
    var h = "";

    h += '<section class="hero">' +
      "<h1>Registro Histórico do NCOFDI</h1>" +
      "<p>" + esc(DADOS.estrutura.projeto.descricao) + "</p>" +
      '<div class="numeros">' +
        '<div class="numero"><b>' + totalTitulos() + "</b><span>Títulos</span></div>" +
        '<div class="numero"><b>' + DADOS.ranking.length + "</b><span>Campeões</span></div>" +
        '<div class="numero"><b>' + totalCompeticoes() + "</b><span>Competições</span></div>" +
        '<div class="numero"><b>' + Object.keys(DADOS.locais).length + "</b><span>Locais</span></div>" +
      "</div></section>";

    h += '<section class="secao"><h2 class="secao-titulo">Seções</h2><div class="grade">';
    DADOS.estrutura.secoes.forEach(function (secao) {
      var locais = locaisDaSecao(secao);
      var titulos = locais.reduce(function (s, x) { return s + contarTitulosDoLocal(x.id); }, 0);
      var comps = locais.reduce(function (s, x) {
        return s + ((DADOS.competicoes[x.id] || { competicoes: [] }).competicoes || []).length;
      }, 0);
      h += cartao("#/secao/" + secao.id, secao.emoji || "🌍", secao.nome,
        plural(comps, "competição", "competições") + " · " + plural(titulos, "título", "títulos"),
        titulos ? "" : "vazio");
    });
    h += "</div></section>";

    if (DADOS.ranking.length) {
      h += '<section class="secao"><h2 class="secao-titulo">Pódio geral</h2>';
      h += tabelaRanking(DADOS.ranking.slice(0, 5));
      h += '<p style="margin-top:14px"><a class="chip ouro" href="#/maiores-campeoes">Ver ranking completo →</a></p>';
      h += "</section>";
    }

    return h;
  }

  function paginaSecao(id) {
    var secao = DADOS.estrutura.secoes.filter(function (c) { return c.id === id; })[0];
    if (!secao) return paginaNaoEncontrada();

    var h = migalhas([{ texto: "Início", href: "#/" }, { texto: secao.nome }]);
    h += '<div class="cabecalho-pagina"><h1>' + (secao.emoji || "") + " " + esc(secao.nome) + "</h1></div>";

    if (secao.verTambem) {
      h += '<p class="aviso-caixa"><a href="' + secao.verTambem.href + '">' +
        esc(secao.verTambem.texto) + " →</a></p>";
    }

    if ((secao.confederacoes || []).length) {
      h += '<section class="secao"><h2 class="secao-titulo">' +
        esc(secao.rotuloConfederacoes || "Torneios continentais") + "</h2><div class=\"grade\">";
      secao.confederacoes.forEach(function (c) {
        var n = contarTitulosDoLocal(c.id);
        h += cartao("#/local/" + c.id, "🏆", c.nome, c.descricao || plural(n, "título", "títulos"),
          "destaque" + (n ? "" : " vazio"));
      });
      h += "</div></section>";
    }

    if ((secao.paises || []).length) {
      h += '<section class="secao"><h2 class="secao-titulo">' +
        esc(secao.rotuloPaises || "Países") + "</h2><div class=\"grade\">";
      secao.paises.forEach(function (p) {
        var arq = DADOS.competicoes[p.id] || { competicoes: [] };
        var n = contarTitulosDoLocal(p.id);
        h += cartao("#/local/" + p.id, iconeLocal(DADOS.locais[p.id]), p.nome,
          plural((arq.competicoes || []).length, "competição", "competições") +
          " · " + plural(n, "título", "títulos"), n ? "" : "vazio");
      });
      h += "</div></section>";
    }

    return h;
  }

  function paginaLocal(id) {
    var local = DADOS.locais[id];
    var arq = DADOS.competicoes[id];
    if (!local || !arq) return paginaNaoEncontrada();

    var h = migalhas([
      { texto: "Início", href: "#/" },
      { texto: local.secao.nome, href: "#/secao/" + local.secao.id },
      { texto: local.nome }
    ]);
    h += '<div class="cabecalho-pagina"><h1>' + iconeLocal(local) + " " + esc(local.nome) + "</h1>" +
      "<p>Escolha uma competição para ver os campeões de cada temporada.</p></div>";

    var comps = arq.competicoes || [];
    if (!comps.length) {
      return h + mensagemVazia("Nenhuma competição cadastrada",
        "Adicione competições em <code>data/competicoes/" + esc(id) + ".json</code>.");
    }

    h += '<div class="grade">';
    comps.forEach(function (c) {
      var n = (c.campeoes || []).length;
      h += cartao("#/local/" + id + "/" + c.id, iconeCompeticao(c), c.nome,
        (c.tipo ? c.tipo + " · " : "") + plural(n, "edição", "edições"), n ? "" : "vazio");
    });
    return h + "</div>";
  }

  function paginaCompeticao(localId, compId) {
    var local = DADOS.locais[localId];
    var arq = DADOS.competicoes[localId];
    if (!local || !arq) return paginaNaoEncontrada();
    var comp = (arq.competicoes || []).filter(function (c) { return c.id === compId; })[0];
    if (!comp) return paginaNaoEncontrada();

    var ehSelecao = local.secao.entidade === "selecao";

    var h = migalhas([
      { texto: "Início", href: "#/" },
      { texto: local.secao.nome, href: "#/secao/" + local.secao.id },
      { texto: local.nome, href: "#/local/" + localId },
      { texto: comp.nome }
    ]);

    h += '<div class="cabecalho-pagina"><h1>' + esc(comp.nome) + "</h1>" +
      "<p>" + esc(local.nome) + (comp.tipo ? " · " + esc(comp.tipo) : "") + "</p></div>";

    var campeoes = (comp.campeoes || []).slice().sort(function (a, b) {
      return anoDe(b.temporada) - anoDe(a.temporada) ||
        String(b.temporada).localeCompare(String(a.temporada));
    });

    if (!campeoes.length) {
      return h + mensagemVazia("Nenhum campeão registrado ainda",
        "Adicione as temporadas no array <code>campeoes</code> de " +
        "<code>data/competicoes/" + esc(localId) + ".json</code>.");
    }

    var contagem = {};
    campeoes.forEach(function (t) { contagem[t.clube] = (contagem[t.clube] || 0) + 1; });
    var maiores = Object.keys(contagem).sort(function (a, b) {
      return contagem[b] - contagem[a] || a.localeCompare(b, "pt-BR");
    });
    var prefixo = ehSelecao ? "sel-" : "";

    h += '<section class="secao"><h2 class="secao-titulo">Maiores vencedores</h2><div class="chips">';
    maiores.slice(0, 12).forEach(function (nome) {
      h += '<a class="chip' + (contagem[nome] === contagem[maiores[0]] ? " ouro" : "") +
        '" href="#/campeao/' + prefixo + slug(nome) + '">' + esc(nome) + " <b>" + contagem[nome] + "</b></a>";
    });
    h += "</div></section>";

    // Num torneio continental o país do campeão varia, então vale a coluna.
    // Numa liga nacional seria a mesma informação repetida em toda linha.
    var mostrarPais = local.tipo === "confederacao" && !ehSelecao;

    h += '<section class="secao"><h2 class="secao-titulo">Campeões por temporada</h2>';
    h += '<div class="tabela-wrap"><table><thead><tr>' +
      "<th>Temporada</th><th>Campeão</th>" + (mostrarPais ? "<th>País</th>" : "") +
      "</tr></thead><tbody>";
    campeoes.forEach(function (t) {
      h += '<tr><td class="temporada">' + esc(temporadaEmTexto(t.temporada, localId)) + "</td>" +
        "<td>" + campeaoHTML(t.clube, prefixo + slug(t.clube)) + "</td>";
      if (mostrarPais) {
        var pais = (DADOS.clubes[t.clube] || {}).pais;
        h += "<td>" + (pais ? bandeiraDoPaisNome(pais) + " " + esc(pais) : "—") + "</td>";
      }
      h += "</tr>";
    });
    return h + "</tbody></table></div></section>";
  }

  function tabelaRanking(lista, offset) {
    offset = offset || 0;
    var h = '<div class="tabela-wrap"><table><thead><tr>' +
      '<th class="pos">#</th><th>Campeão</th><th>País</th><th class="num">Títulos</th>' +
      "<th>Títulos conquistados</th></tr></thead><tbody>";

    lista.forEach(function (c, i) {
      var pos = offset + i + 1;
      var comps = Object.keys(c.porCompeticao).sort(function (a, b) {
        return c.porCompeticao[b] - c.porCompeticao[a] || a.localeCompare(b, "pt-BR");
      });
      var chips = comps.map(function (nome) {
        return '<span class="chip">' + esc(nome) + " <b>" + c.porCompeticao[nome] + "</b></span>";
      }).join("");
      h += '<tr class="p' + pos + '">' +
        '<td class="pos">' + pos + "</td>" +
        "<td>" + campeaoHTML(c.nome, c.chave) +
          (c.selecao ? ' <span class="etiqueta">seleção</span>' : "") + "</td>" +
        "<td>" + (c.pais ? bandeiraDoPaisNome(c.pais) + " " + esc(c.pais) : "—") + "</td>" +
        '<td class="num"><span class="total">' + c.titulos.length + "</span></td>" +
        '<td><div class="chips">' + chips + "</div></td>" +
        "</tr>";
    });
    return h + "</tbody></table></div>";
  }

  function paginaMaioresCampeoes() {
    var h = migalhas([{ texto: "Início", href: "#/" }, { texto: "Maiores campeões" }]);
    h += '<div class="cabecalho-pagina"><h1>🏆 Maiores campeões</h1>' +
      "<p>Ranking de todos os clubes e seleções que já conquistaram algum título no NCOFDI.</p></div>";

    if (!DADOS.ranking.length) {
      return h + mensagemVazia("Nenhum título registrado ainda",
        "Assim que você cadastrar campeões nos arquivos de <code>data/competicoes/</code>, " +
        "o ranking aparece aqui automaticamente.");
    }

    h += '<div class="controles">' +
      '<input type="search" id="busca-clube" placeholder="Buscar campeão ou país…" autocomplete="off">' +
      '<select id="filtro-secao"><option value="">Todas as seções</option>' +
      DADOS.estrutura.secoes.map(function (c) {
        return '<option value="' + c.id + '">' + esc(c.nome) + "</option>";
      }).join("") + "</select>" +
      '<select id="filtro-tipo"><option value="">Todos os tipos</option>' +
      DADOS.tipos.map(function (t) {
        return '<option value="' + esc(t) + '">' + esc(t) + "</option>";
      }).join("") + "</select></div>";

    h += '<div id="ranking-alvo">' + tabelaRanking(DADOS.ranking) + "</div>";
    return h;
  }

  function aplicarFiltrosRanking() {
    var alvo = document.getElementById("ranking-alvo");
    if (!alvo) return;
    var busca = (document.getElementById("busca-clube") || {}).value || "";
    var secao = (document.getElementById("filtro-secao") || {}).value || "";
    var tipo = (document.getElementById("filtro-tipo") || {}).value || "";
    var termo = slug(busca);

    var lista = DADOS.ranking.map(function (c) {
      var titulos = c.titulos.filter(function (t) {
        if (secao && t.secaoId !== secao) return false;
        if (tipo && t.tipo !== tipo) return false;
        return true;
      });
      if (!titulos.length) return null;
      var porCompeticao = {};
      titulos.forEach(function (t) { porCompeticao[t.competicao] = (porCompeticao[t.competicao] || 0) + 1; });
      return {
        chave: c.chave, nome: c.nome, pais: c.pais, selecao: c.selecao,
        titulos: titulos, porCompeticao: porCompeticao
      };
    }).filter(Boolean).filter(function (c) {
      if (!termo) return true;
      return slug(c.nome).indexOf(termo) !== -1 || slug(c.pais || "").indexOf(termo) !== -1;
    }).sort(ordenarRanking);

    alvo.innerHTML = lista.length ? tabelaRanking(lista)
      : mensagemVazia("Nenhum campeão encontrado", "Ajuste a busca ou os filtros.");
  }

  function paginaCampeao(chave) {
    var c = DADOS.porChave[chave];
    if (!c) return paginaNaoEncontrada();

    var h = migalhas([
      { texto: "Início", href: "#/" },
      { texto: "Maiores campeões", href: "#/maiores-campeoes" },
      { texto: c.nome }
    ]);

    var posicao = 0;
    DADOS.ranking.forEach(function (x, i) { if (x.chave === chave) posicao = i + 1; });

    h += '<div class="cabecalho-pagina"><h1>' + escudoHTML(c.nome, true) + " " + esc(c.nome) +
      (c.selecao ? ' <span class="etiqueta">seleção</span>' : "") + "</h1>" +
      "<p>" + (c.pais && !c.selecao ? bandeiraDoPaisNome(c.pais) + " " + esc(c.pais) + " · " : "") +
      plural(c.titulos.length, "título", "títulos") + " · " + posicao + "º no ranking geral</p></div>";

    var comps = Object.keys(c.porCompeticao).sort(function (a, b) {
      return c.porCompeticao[b] - c.porCompeticao[a] || a.localeCompare(b, "pt-BR");
    });
    h += '<section class="secao"><h2 class="secao-titulo">Resumo</h2><div class="chips">' +
      comps.map(function (nome) {
        return '<span class="chip ouro">' + esc(nome) + " <b>" + c.porCompeticao[nome] + "</b></span>";
      }).join("") + "</div></section>";

    var titulos = c.titulos.slice().sort(function (a, b) {
      return anoDe(b.temporada) - anoDe(a.temporada) ||
        String(b.temporada).localeCompare(String(a.temporada)) ||
        a.competicao.localeCompare(b.competicao, "pt-BR");
    });

    h += '<section class="secao"><h2 class="secao-titulo">Galeria de títulos</h2>';
    h += '<div class="tabela-wrap"><table><thead><tr>' +
      "<th>Temporada</th><th>Competição</th><th>Onde</th></tr></thead><tbody>";
    titulos.forEach(function (t) {
      h += '<tr><td class="temporada">' + esc(temporadaEmTexto(t.temporada, t.localId)) + "</td>" +
        '<td><a href="#/local/' + t.localId + "/" + t.competicaoId + '">' + esc(t.competicao) + "</a></td>" +
        '<td><a href="#/local/' + t.localId + '">' + esc(t.localNome) + "</a></td></tr>";
    });
    return h + "</tbody></table></div></section>";
  }

  function paginaTodasCompeticoes() {
    var h = migalhas([{ texto: "Início", href: "#/" }, { texto: "Competições" }]);
    h += '<div class="cabecalho-pagina"><h1>Todas as competições</h1>' +
      "<p>Índice completo de tudo que é registrado no NCOFDI. Clique numa seção para abrir.</p></div>";

    DADOS.estrutura.secoes.forEach(function (secao) {
      var locais = locaisDaSecao(secao);
      if (!locais.length) return;
      var nComps = locais.reduce(function (s, d) {
        return s + ((DADOS.competicoes[d.id] || { competicoes: [] }).competicoes || []).length;
      }, 0);

      h += "<details class=\"secao-lista\"><summary>" + (secao.emoji || "") + " " +
        esc(secao.nome) + ' <span class="cartao-sub">' + nComps + " competições</span></summary>";
      h += '<div class="tabela-wrap"><table><thead><tr>' +
        "<th>Local</th><th>Competições</th><th class=\"num\">Títulos</th></tr></thead><tbody>";
      locais.forEach(function (d) {
        var arq = DADOS.competicoes[d.id] || { competicoes: [] };
        var links = (arq.competicoes || []).map(function (c) {
          return '<a class="chip" href="#/local/' + d.id + "/" + c.id + '">' + esc(c.nome) +
            ((c.campeoes || []).length ? " <b>" + c.campeoes.length + "</b>" : "") + "</a>";
        }).join("");
        h += '<tr><td><a href="#/local/' + d.id + '"><b>' + iconeLocal(DADOS.locais[d.id]) +
            " " + esc(d.nome) + "</b></a></td>" +
          '<td><div class="chips">' + (links || '<span class="cartao-sub">—</span>') + "</div></td>" +
          '<td class="num">' + contarTitulosDoLocal(d.id) + "</td></tr>";
      });
      h += "</tbody></table></div></details>";
    });

    return h;
  }

  function paginaNaoEncontrada() {
    return migalhas([{ texto: "Início", href: "#/" }]) +
      mensagemVazia("Página não encontrada", 'Volte para o <a href="#/">início</a>.');
  }

  /* ------------------------------------------------------------ roteador */

  function rotaAtual() {
    var h = location.hash.replace(/^#\/?/, "");
    return h.split("/").filter(Boolean).map(decodeURIComponent);
  }

  function renderizar() {
    var partes = rotaAtual();
    var html;

    if (!partes.length) html = paginaInicio();
    else if (partes[0] === "secao" && partes[1]) html = paginaSecao(partes[1]);
    else if (partes[0] === "local" && partes[2]) html = paginaCompeticao(partes[1], partes[2]);
    else if (partes[0] === "local" && partes[1]) html = paginaLocal(partes[1]);
    else if (partes[0] === "campeao" && partes[1]) html = paginaCampeao(partes[1]);
    else if (partes[0] === "maiores-campeoes") html = paginaMaioresCampeoes();
    else if (partes[0] === "competicoes") html = paginaTodasCompeticoes();
    else html = paginaNaoEncontrada();

    app.innerHTML = html;
    window.scrollTo(0, 0);

    var raiz = partes[0] || "inicio";
    Array.prototype.forEach.call(document.querySelectorAll(".menu a"), function (a) {
      a.classList.toggle("ativo", a.dataset.rota === raiz);
    });

    ["busca-clube", "filtro-secao", "filtro-tipo"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("input", aplicarFiltrosRanking);
    });
  }

  /* ------------------------------------------------------------- inicial */

  carregar().then(function () {
    var rodape = document.getElementById("rodape-stats");
    if (rodape) {
      rodape.textContent = totalTitulos() + " títulos · " + DADOS.ranking.length +
        " campeões · " + totalCompeticoes() + " competições · " +
        Object.keys(DADOS.locais).length + " locais";
    }
    if (DADOS.falhas.length) {
      var aviso = document.createElement("div");
      aviso.className = "container";
      aviso.innerHTML = '<p class="aviso-caixa"><b>Atenção:</b> ' + DADOS.falhas.length +
        " arquivo(s) de dados não carregaram, então algumas competições podem " +
        "aparecer vazias. Recarregue a página. (" +
        DADOS.falhas.slice(0, 8).map(esc).join(", ") +
        (DADOS.falhas.length > 8 ? ", …" : "") + ")</p>";
      app.parentNode.insertBefore(aviso, app);
    }
    window.addEventListener("hashchange", renderizar);
    renderizar();
  }).catch(function (e) {
    console.error(e);
    var local = location.protocol === "file:";
    app.innerHTML = '<div class="vazio-msg"><strong>Não foi possível carregar os dados</strong>' +
      (local
        ? "Você abriu o arquivo direto do disco (<code>file://</code>) e o navegador bloqueia a leitura dos JSON. " +
          "Rode <code>./servir.sh</code> (ou <code>python3 -m http.server 8000</code>) nesta pasta e acesse " +
          "<code>http://localhost:8000</code>."
        : "Erro: <code>" + esc(e.message) + "</code>") +
      "</div>";
  });
})();
