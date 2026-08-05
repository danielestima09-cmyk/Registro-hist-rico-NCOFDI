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
    titulos: [],       // todos os títulos numa lista só, para as análises
    temporadas: [],    // anos com título registrado, do mais antigo ao mais novo
    falhas: []         // arquivos de dados que não carregaram
  };

  var indicePaisPorNome = {};
  var secaoDoPaisNome = {};   // "Espanha" -> seção Europa

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

    // escudo escuro recebe um contorno claro que acompanha o desenho: o fundo
    // do site é escuro e esses desapareciam nele. Quem decide é a padronização,
    // que mede o contraste de cada arquivo e grava "escuro" em clubes.json.
    if (info.escuro) classe += " escuro";

    var arquivo = info.escudo || (slug(nome) + ".png");
    var src = /^https?:/.test(arquivo) ? arquivo : "assets/escudos/" + arquivo;
    // O ?v= vale também para as imagens: sem ele o navegador reaproveita
    // indefinidamente o escudo antigo em cache e correções de arquivo não
    // chegam ao usuário, mesmo com CSS e JSON já atualizados.
    if (VERSAO && !/^https?:/.test(arquivo)) src += "?v=" + VERSAO;
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
        if (secao.pais) {
          indicePaisPorNome[secao.pais.nome] = secao.pais;
          secaoDoPaisNome[secao.pais.nome] = secao;
        }
        (secao.confederacoes || []).forEach(function (c) {
          DADOS.locais[c.id] = { id: c.id, nome: c.nome, tipo: "confederacao", secao: secao, ref: c };
          ids.push(c.id);
        });
        (secao.paises || []).forEach(function (p) {
          var tipo = p.sigla ? "estado" : "pais";
          DADOS.locais[p.id] = { id: p.id, nome: p.nome, tipo: tipo, secao: secao, ref: p };
          if (tipo === "pais") {
            indicePaisPorNome[p.nome] = p;
            secaoDoPaisNome[p.nome] = secao;
          }
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
            ano: anoDe(t.temporada),
            competicao: comp.nome,
            competicaoId: comp.id,
            localId: localId,
            localNome: local.nome,
            localTipo: local.tipo,
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

    derivar();
  }

  /* ------------------------------------------------- análise derivada */

  /* Daqui para baixo nada é cadastrado: temporadas, selos, recordes e
     comparações saem todos dos títulos já importados. Quando uma planilha nova
     entra, tudo se refaz sozinho — que é a condição para o site não virar mais
     trabalho de manutenção do que já é. */

  // Um título pertence a um âmbito (onde foi disputado) e a uma forma (como foi
  // disputado). Os dois saem do tipo da competição e do tipo do local, que já
  // existem nos dados.
  function ambitoDoTitulo(t) {
    if (t.tipo === "Copa Regional") return "regional";
    if (t.tipo === "Torneio Mundial") return "mundial";
    if (t.localTipo === "estado") return "estadual";
    if (t.localTipo === "confederacao") {
      // O Brasileirão e a Copa do Brasil ficam sob uma "confederação"
      // (brasil-nacional) porque a seção Brasil é dividida por estado. São
      // títulos nacionais, não continentais: quem diz isso é a seção ter um
      // país próprio.
      var local = DADOS.locais[t.localId];
      return local && local.secao && local.secao.pais ? "nacional" : "continental";
    }
    return "nacional";
  }

  // Liga ou copa — e nem todo título é um dos dois. Torneios continentais e
  // mundiais ficam de fora de propósito: a Champions League é eliminatória mas
  // não é "a copa" de nenhum país, e contá-la como liga (que era o que a regra
  // antiga fazia, por não ter "copa" no nome) inflava o recorde de ligas.
  function formaDoTitulo(t) {
    if (/^(Copa|Supercopa|Taça)/i.test(t.tipo)) return "copa";
    if (/^(Liga|Estadual)/i.test(t.tipo) || /Divisão$/i.test(t.tipo)) return "liga";
    return "";
  }

  function derivar() {
    DADOS.titulos = [];
    var anos = {};

    DADOS.ranking.forEach(function (c) {
      // ordem cronológica: quase toda estatística abaixo depende dela
      c.titulos.sort(function (a, b) {
        return a.ano - b.ano || a.competicao.localeCompare(b.competicao, "pt-BR");
      });
      c.estreia = c.titulos.length ? c.titulos[0].ano : 0;
      c.secaoPais = secaoDoPaisNome[c.pais] || null;

      // Estado de um clube brasileiro: aquele onde ele mais venceu estaduais.
      // Não dá para tirar do sufixo do nome — só os homônimos têm sufixo.
      var porEstado = {};
      c.titulos.forEach(function (t) {
        if (t.localTipo === "estado") porEstado[t.localId] = (porEstado[t.localId] || 0) + 1;
      });
      var estados = Object.keys(porEstado).sort(function (a, b) {
        return porEstado[b] - porEstado[a] || a.localeCompare(b);
      });
      c.estadoId = estados[0] || "";

      c.titulos.forEach(function (t) {
        anos[t.ano] = 1;
        DADOS.titulos.push({
          ano: t.ano, temporada: t.temporada,
          chave: c.chave, nome: c.nome, pais: c.pais, selecao: c.selecao,
          competicao: t.competicao, competicaoId: t.competicaoId,
          localId: t.localId, localNome: t.localNome, localTipo: t.localTipo,
          secaoId: t.secaoId, tipo: t.tipo,
          ambito: ambitoDoTitulo(t), forma: formaDoTitulo(t)
        });
      });
    });

    DADOS.temporadas = Object.keys(anos).map(Number).sort(function (a, b) { return a - b; });
  }

  function titulosDaTemporada(ano) {
    return DADOS.titulos.filter(function (t) { return t.ano === ano; });
  }

  function temporadaAnterior(ano) {
    var i = DADOS.temporadas.indexOf(ano);
    return i > 0 ? DADOS.temporadas[i - 1] : null;
  }

  // Ranking acumulado até uma temporada (inclusive), com a posição de cada um.
  // É o que permite dizer "subiu 11 posições": o ranking de hoje comparado com
  // o que ele era antes da temporada entrar.
  function rankingAte(ano) {
    var por = {};
    DADOS.titulos.forEach(function (t) {
      if (t.ano > ano) return;
      if (!por[t.chave]) {
        por[t.chave] = { chave: t.chave, nome: t.nome, pais: t.pais,
                         selecao: t.selecao, titulos: [] };
      }
      por[t.chave].titulos.push(t);
    });
    var lista = Object.keys(por).map(function (k) { return por[k]; }).sort(ordenarRanking);
    var posicao = {};
    lista.forEach(function (c, i) { posicao[c.chave] = i + 1; });
    return { lista: lista, posicao: posicao };
  }

  // Sequências de temporadas seguidas em que o clube venceu a MESMA competição.
  function sequenciasDoClube(c) {
    var porComp = {};
    c.titulos.forEach(function (t) {
      var k = t.localId + "/" + t.competicaoId;
      (porComp[k] = porComp[k] || { competicao: t.competicao, localId: t.localId,
                                    competicaoId: t.competicaoId, anos: [] }).anos.push(t.ano);
    });
    var out = [];
    Object.keys(porComp).forEach(function (k) {
      var reg = porComp[k];
      var anos = reg.anos.slice().sort(function (a, b) { return a - b; });
      var corrida = [anos[0]];
      for (var i = 1; i <= anos.length; i++) {
        if (i < anos.length && anos[i] === anos[i - 1] + 1) {
          corrida.push(anos[i]);
          continue;
        }
        if (corrida.length > 1) {
          out.push({ competicao: reg.competicao, localId: reg.localId,
                     competicaoId: reg.competicaoId, anos: corrida.slice() });
        }
        if (i < anos.length) corrida = [anos[i]];
      }
    });
    return out.sort(function (a, b) {
      return b.anos.length - a.anos.length || b.anos[b.anos.length - 1] - a.anos[a.anos.length - 1];
    });
  }

  // Maior número de temporadas seguidas com pelo menos um título, em qualquer
  // competição.
  function maiorCorridaDeTemporadas(c) {
    var anos = [];
    c.titulos.forEach(function (t) { if (anos.indexOf(t.ano) === -1) anos.push(t.ano); });
    anos.sort(function (a, b) { return a - b; });
    var melhor = anos.length ? 1 : 0, atual = 1, fim = anos[0];
    for (var i = 1; i < anos.length; i++) {
      atual = anos[i] === anos[i - 1] + 1 ? atual + 1 : 1;
      if (atual >= melhor) { melhor = atual; fim = anos[i]; }
    }
    return { anos: melhor, ate: fim };
  }

  function porTemporadaDoClube(c) {
    var por = {};
    c.titulos.forEach(function (t) { (por[t.ano] = por[t.ano] || []).push(t); });
    return por;
  }

  // Dobradinha: liga principal + copa nacional do mesmo país na mesma temporada.
  function dobradinhasDoClube(c) {
    var por = porTemporadaDoClube(c), out = [];
    Object.keys(por).forEach(function (ano) {
      var doAno = por[ano];
      var porLocal = {};
      doAno.forEach(function (t) {
        if (t.localTipo !== "pais" && t.localTipo !== "estado") return;
        (porLocal[t.localId] = porLocal[t.localId] || []).push(t);
      });
      Object.keys(porLocal).forEach(function (localId) {
        var itens = porLocal[localId];
        var liga = itens.filter(function (t) {
          return t.tipo === "Liga Nacional" || t.tipo === "Estadual";
        })[0];
        var copa = itens.filter(function (t) { return formaDoTitulo(t) === "copa"; })[0];
        if (liga && copa) {
          out.push({ ano: Number(ano), localId: localId, localNome: liga.localNome,
                     liga: liga, copa: copa,
                     nacional: liga.localTipo === "pais" });
        }
      });
    });
    return out.sort(function (a, b) { return b.ano - a.ano; });
  }

  var COROAS = { 3: "Tríplice coroa", 4: "Quádrupla coroa", 5: "Quíntupla coroa" };

  function coroaDe(n) {
    return COROAS[n] || (n > 5 ? n + " títulos numa temporada" : "");
  }

  // Selos: leitura curta do que o clube fez, calculada na hora.
  function selosDoClube(c) {
    var selos = [];
    var ultima = DADOS.temporadas[DADOS.temporadas.length - 1];

    sequenciasDoClube(c).forEach(function (s) {
      var texto = s.anos.length === 2 ? "Bicampeão consecutivo" : "Dinastia em formação";
      selos.push({
        texto: texto + " · " + esc(s.competicao),
        detalhe: s.anos.join(" e ") + (s.anos.length > 2 ? " (" + s.anos.length + " seguidas)" : ""),
        forte: s.anos.length > 2
      });
    });

    dobradinhasDoClube(c).forEach(function (d) {
      selos.push({
        texto: (d.nacional ? "Dobradinha nacional" : "Dobradinha estadual") + " · " + esc(d.localNome),
        detalhe: d.ano + " — " + d.liga.competicao + " e " + d.copa.competicao
      });
    });

    var por = porTemporadaDoClube(c);
    Object.keys(por).forEach(function (ano) {
      var nome = coroaDe(por[ano].length);
      if (nome) selos.push({ texto: nome, detalhe: ano + " — " + por[ano].length + " títulos", forte: true });
    });

    if (c.estreia === ultima) {
      selos.push({ texto: "Primeiro título na era NCOFDI", detalhe: "estreou em " + ultima });
    }
    return selos;
  }

  // Posição do clube dentro de um recorte do ranking (país, estado, seção).
  function posicaoEm(chave, filtro) {
    var lista = DADOS.ranking.filter(filtro);
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].chave === chave) return { posicao: i + 1, de: lista.length };
    }
    return null;
  }

  function estatisticasDoClube(c) {
    var por = porTemporadaDoClube(c);
    var anos = Object.keys(por).map(Number).sort(function (a, b) { return a - b; });
    var melhor = anos.slice().sort(function (a, b) {
      return por[b].length - por[a].length || b - a;
    })[0];

    var comps = {};
    c.titulos.forEach(function (t) { comps[t.localId + "/" + t.competicaoId] = 1; });

    var primeiro = c.titulos[0];
    var recente = c.titulos[c.titulos.length - 1];

    // ambitoDoTitulo e não t.ambito: os títulos guardados no clube são os
    // originais, e o âmbito só é gravado na lista achatada de DADOS.titulos.
    var porAmbito = {}, porLocal = {};
    c.titulos.forEach(function (t) {
      var a = ambitoDoTitulo(t);
      porAmbito[a] = (porAmbito[a] || 0) + 1;
      porLocal[t.localId] = porLocal[t.localId] || { nome: t.localNome, n: 0 };
      porLocal[t.localId].n++;
    });

    return {
      total: c.titulos.length,
      temporadas: anos.length,
      competicoes: Object.keys(comps).length,
      melhorTemporada: melhor,
      titulosNaMelhor: melhor ? por[melhor].length : 0,
      primeiro: primeiro, recente: recente,
      porAmbito: porAmbito, porLocal: porLocal,
      geral: posicaoEm(c.chave, function () { return true; }),
      noPais: c.pais ? posicaoEm(c.chave, function (x) { return x.pais === c.pais; }) : null,
      noEstado: c.estadoId ? posicaoEm(c.chave, function (x) { return x.estadoId === c.estadoId; }) : null,
      naSecao: c.secaoPais ? posicaoEm(c.chave, function (x) {
        return x.secaoPais && x.secaoPais.id === c.secaoPais.id;
      }) : null,
      corrida: maiorCorridaDeTemporadas(c)
    };
  }

  function estatisticasDaCompeticao(localId, comp) {
    var lista = (comp.campeoes || []).slice().sort(function (a, b) {
      return anoDe(a.temporada) - anoDe(b.temporada);
    });
    if (!lista.length) return null;

    var contagem = {};
    lista.forEach(function (t) { contagem[t.clube] = (contagem[t.clube] || 0) + 1; });
    var maior = Object.keys(contagem).sort(function (a, b) {
      return contagem[b] - contagem[a] || a.localeCompare(b, "pt-BR");
    })[0];

    // Sequência atual: quantas edições seguidas o campeão atual já levou.
    var atual = lista[lista.length - 1], seq = 1, defendeu = null;
    for (var i = lista.length - 2; i >= 0; i--) {
      if (lista[i].clube !== atual.clube) break;
      seq++;
    }
    for (var j = lista.length - 1; j > 0; j--) {
      if (lista[j].clube === lista[j - 1].clube) { defendeu = lista[j]; break; }
    }

    // Inéditos: campeões para quem este foi o primeiro título de toda a era.
    var ehSelecao = (DADOS.locais[localId] || {}).secao &&
                    DADOS.locais[localId].secao.entidade === "selecao";
    var ineditos = 0;
    Object.keys(contagem).forEach(function (clube) {
      var reg = DADOS.porChave[(ehSelecao ? "sel-" : "") + slug(clube)];
      if (!reg) return;
      var estreouAqui = reg.titulos[0] &&
        reg.titulos[0].localId === localId && reg.titulos[0].competicaoId === comp.id;
      if (estreouAqui) ineditos++;
    });

    return {
      edicoes: lista.length,
      distintos: Object.keys(contagem).length,
      atual: atual, maior: maior, titulosDoMaior: contagem[maior],
      sequencia: seq, defendeu: defendeu, ineditos: ineditos,
      dominio: Math.round(contagem[maior] / lista.length * 100),
      linha: lista, prefixo: ehSelecao ? "sel-" : ""
    };
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

    h += secaoDestaques();

    if (DADOS.ranking.length) {
      h += '<section class="secao"><h2 class="secao-titulo">Pódio geral</h2>';
      h += tabelaRanking(DADOS.ranking.slice(0, 5));
      h += '<p style="margin-top:14px"><a class="chip ouro" href="#/maiores-campeoes">Ver ranking completo →</a></p>';
      h += "</section>";
    }

    return h;
  }

  function secaoDestaques() {
    if (!DADOS.temporadas.length || !DADOS.ranking.length) return "";
    var ultima = DADOS.temporadas[DADOS.temporadas.length - 1];
    var anterior = temporadaAnterior(ultima);
    var doAno = titulosDaTemporada(ultima);

    var porClube = {};
    doAno.forEach(function (t) {
      (porClube[t.chave] = porClube[t.chave] || { chave: t.chave, nome: t.nome, n: 0 }).n++;
    });
    var topoAno = Object.keys(porClube).map(function (k) { return porClube[k]; })
      .sort(function (a, b) { return b.n - a.n || a.nome.localeCompare(b.nome, "pt-BR"); })[0];

    var ineditos = DADOS.ranking.filter(function (c) { return c.estreia === ultima; }).length;

    // Sequência ativa: a que chega até a temporada mais recente.
    var ativa = null, dobradinha = null;
    DADOS.ranking.forEach(function (c) {
      sequenciasDoClube(c).forEach(function (s) {
        if (s.anos[s.anos.length - 1] !== ultima) return;
        if (!ativa || s.anos.length > ativa.seq.anos.length) ativa = { clube: c, seq: s };
      });
      dobradinhasDoClube(c).forEach(function (d) {
        if (!dobradinha || d.ano > dobradinha.d.ano) dobradinha = { clube: c, d: d };
      });
    });

    var subiu = null;
    if (anterior) {
      var rA = rankingAte(anterior), rB = rankingAte(ultima);
      rB.lista.forEach(function (c) {
        var pa = rA.posicao[c.chave];
        if (!pa) return;
        var d = pa - rB.posicao[c.chave];
        if (d > 0 && (!subiu || d > subiu.d)) subiu = { chave: c.chave, nome: c.nome, d: d };
      });
    }

    // Renovação: das competições disputadas nas duas últimas temporadas,
    // quantas trocaram de campeão.
    var renovacao = null;
    if (anterior) {
      var antes = {}, depois = {};
      titulosDaTemporada(anterior).forEach(function (t) {
        antes[t.localId + "/" + t.competicaoId] = t.chave;
      });
      titulosDaTemporada(ultima).forEach(function (t) {
        depois[t.localId + "/" + t.competicaoId] = t.chave;
      });
      var comuns = Object.keys(depois).filter(function (k) { return antes[k]; });
      if (comuns.length) {
        renovacao = {
          trocaram: comuns.filter(function (k) { return antes[k] !== depois[k]; }).length,
          total: comuns.length
        };
      }
    }

    var h = '<section class="secao"><h2 class="secao-titulo">Destaques</h2>' +
      '<p class="secao-nota">Calculados a partir da temporada mais recente registrada (' +
      ultima + ").</p><div class=\"fatos\">";

    h += linhaFato("Maior campeão da era",
      chipClube(DADOS.ranking[0].chave, DADOS.ranking[0].nome, DADOS.ranking[0].titulos.length));
    if (topoAno) {
      h += linhaFato("Mais títulos em " + ultima, chipClube(topoAno.chave, topoAno.nome, topoAno.n));
    }
    if (ativa) {
      h += linhaFato("Maior sequência ativa",
        chipClube(ativa.clube.chave, ativa.clube.nome, ativa.seq.anos.length) +
        ' <span class="cartao-sub">' + esc(ativa.seq.competicao) + "</span>");
    }
    if (dobradinha) {
      h += linhaFato("Última dobradinha",
        chipClube(dobradinha.clube.chave, dobradinha.clube.nome) +
        ' <span class="cartao-sub">' + esc(dobradinha.d.localNome) + ", " + dobradinha.d.ano + "</span>");
    }
    if (subiu) {
      h += linhaFato("Quem mais subiu no ranking",
        chipClube(subiu.chave, subiu.nome) + ' <span class="cartao-sub">▲ ' +
        plural(subiu.d, "posição", "posições") + "</span>");
    }
    h += linhaFato("Campeões inéditos em " + ultima,
      "<b>" + ineditos + "</b> " +
      '<a class="chip" href="#/temporadas/' + ultima + '">ver a temporada →</a>');
    if (renovacao) {
      h += linhaFato("Renovação em " + ultima,
        "<b>" + renovacao.trocaram + "</b> de " + renovacao.total +
        " competições trocaram de campeão " +
        '<a class="chip" href="#/comparar/' + anterior + "/" + ultima + '">ver a comparação →</a>');
    }
    return h + "</div></section>";
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

    h += secaoEstatisticasCompeticao(localId, comp);

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

  function secaoEstatisticasCompeticao(localId, comp) {
    var e = estatisticasDaCompeticao(localId, comp);
    if (!e) return "";
    var link = function (clube) {
      return chipClube(e.prefixo + slug(clube), clube);
    };

    var h = '<section class="secao"><h2 class="secao-titulo">Resumo da competição</h2>';
    h += numerosHTML([
      [e.edicoes, e.edicoes === 1 ? "Edição registrada" : "Edições registradas"],
      [e.distintos, e.distintos === 1 ? "Campeão diferente" : "Campeões diferentes"],
      [e.dominio + "%", "Domínio do maior campeão"],
      [e.ineditos, "Campeões inéditos na era"]
    ]);
    h += '<div class="fatos">';
    h += linhaFato("Atual campeão", link(e.atual.clube) +
      ' <span class="cartao-sub">' + esc(temporadaEmTexto(e.atual.temporada, localId)) + "</span>");
    h += linhaFato("Maior campeão", link(e.maior) +
      ' <span class="cartao-sub">' + plural(e.titulosDoMaior, "título", "títulos") + "</span>");
    h += linhaFato("Sequência atual", e.sequencia > 1
      ? "<b>" + e.sequencia + "</b> <span class=\"cartao-sub\">edições seguidas de " +
        esc(e.atual.clube) + "</span>"
      : "<em>nenhuma — o campeão atual não vinha de título</em>");
    h += linhaFato("Último a defender o título", e.defendeu
      ? link(e.defendeu.clube) + ' <span class="cartao-sub">em ' +
        esc(temporadaEmTexto(e.defendeu.temporada, localId)) + "</span>"
      : "<em>ninguém repetiu ainda</em>");
    h += "</div>";

    h += '<div class="linha-tempo">' + e.linha.map(function (t) {
      return '<a class="marco" href="#/campeao/' + e.prefixo + slug(t.clube) + '">' +
        '<span class="marco-ano">' + esc(temporadaEmTexto(t.temporada, localId)) + "</span>" +
        escudoHTML(t.clube) +
        '<span class="marco-clube">' + esc(t.clube) + "</span></a>";
    }).join("") + "</div>";
    return h + "</section>";
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

    var selos = selosDoClube(c);
    if (selos.length) {
      h += '<div class="selos">' + selos.map(function (s) {
        return '<span class="selo' + (s.forte ? " forte" : "") + '" title="' +
          esc(s.detalhe) + '">' + s.texto + "</span>";
      }).join("") + "</div>";
    }

    var comps = Object.keys(c.porCompeticao).sort(function (a, b) {
      return c.porCompeticao[b] - c.porCompeticao[a] || a.localeCompare(b, "pt-BR");
    });
    h += '<section class="secao"><h2 class="secao-titulo">Resumo</h2><div class="chips">' +
      comps.map(function (nome) {
        return '<span class="chip ouro">' + esc(nome) + " <b>" + c.porCompeticao[nome] + "</b></span>";
      }).join("") + "</div></section>";

    h += secaoEstatisticasClube(c);

    h += '<section class="secao"><h2 class="secao-titulo">Galeria de títulos</h2>';
    h += controlesGaleria(c);
    h += '<div id="galeria-alvo">' + galeriaHTML(c, "recente", {}) + "</div></section>";
    return h;
  }

  var AMBITOS = {
    nacional: "Nacionais", estadual: "Estaduais", continental: "Continentais",
    regional: "Regionais", mundial: "Mundiais"
  };

  function secaoEstatisticasClube(c) {
    var e = estatisticasDoClube(c);
    var pos = function (p, rotulo) {
      return p ? linhaFato(rotulo, "<b>" + p.posicao + "º</b> " +
        '<span class="cartao-sub">de ' + p.de + "</span>") : "";
    };
    var tituloDe = function (t) {
      return t ? linkCompeticao(t) + " <span class=\"cartao-sub\">" +
        esc(temporadaEmTexto(t.temporada, t.localId)) + "</span>" : "—";
    };

    var h = '<section class="secao"><h2 class="secao-titulo">Estatísticas da era NCOFDI</h2>';
    h += numerosHTML([
      [e.total, "Títulos"],
      [e.temporadas, e.temporadas === 1 ? "Temporada com título" : "Temporadas com título"],
      [e.competicoes, "Competições vencidas"],
      [e.melhorTemporada || "—", "Melhor temporada"],
      [e.titulosNaMelhor, "Títulos na melhor"]
    ]);
    h += '<div class="fatos">';
    h += linhaFato("Primeiro título", tituloDe(e.primeiro));
    h += linhaFato("Título mais recente", tituloDe(e.recente));
    if (e.corrida.anos > 1) {
      h += linhaFato("Temporadas seguidas com título",
        "<b>" + e.corrida.anos + "</b> <span class=\"cartao-sub\">até " + e.corrida.ate + "</span>");
    }
    h += linhaFato("Títulos por categoria", Object.keys(e.porAmbito).sort(function (a, b) {
      return e.porAmbito[b] - e.porAmbito[a];
    }).map(function (k) {
      return '<span class="chip">' + esc(AMBITOS[k] || k) + " <b>" + e.porAmbito[k] + "</b></span>";
    }).join(" "));
    h += linhaFato("Títulos por local", Object.keys(e.porLocal).sort(function (a, b) {
      return e.porLocal[b].n - e.porLocal[a].n;
    }).map(function (id) {
      return '<a class="chip" href="#/local/' + id + '">' + esc(e.porLocal[id].nome) +
        " <b>" + e.porLocal[id].n + "</b></a>";
    }).join(" "));
    h += pos(e.geral, "Posição no ranking geral");
    h += pos(e.noPais, "Posição em " + (c.pais || "seu país"));
    if (e.noEstado) {
      h += pos(e.noEstado, "Posição em " + (DADOS.locais[c.estadoId] || {}).nome);
    }
    if (e.naSecao) h += pos(e.naSecao, "Posição em " + c.secaoPais.nome);
    return h + "</div></section>";
  }

  function controlesGaleria(c) {
    if (c.titulos.length < 4) return "";
    var temporadas = {}, comps = {}, tipos = {};
    c.titulos.forEach(function (t) {
      temporadas[t.ano] = 1;
      comps[t.localId + "/" + t.competicaoId] = t.competicao;
      if (t.tipo) tipos[t.tipo] = 1;
    });
    var op = function (obj, rotulo, mapa) {
      return '<option value="">' + rotulo + "</option>" + Object.keys(obj).sort().map(function (k) {
        return '<option value="' + esc(k) + '">' + esc(mapa ? mapa(k) : k) + "</option>";
      }).join("");
    };
    return '<div class="controles" data-clube="' + esc(c.chave) + '">' +
      '<select id="gal-ordem">' +
        '<option value="recente">Mais recente primeiro</option>' +
        '<option value="antigo">Mais antigo primeiro</option>' +
        '<option value="competicao">Por competição</option>' +
        '<option value="tipo">Por tipo de título</option>' +
        '<option value="local">Por local</option>' +
      "</select>" +
      '<select id="gal-temporada">' + op(temporadas, "Todas as temporadas") + "</select>" +
      '<select id="gal-competicao">' + op(comps, "Todas as competições", function (k) {
        return comps[k];
      }) + "</select>" +
      '<select id="gal-tipo">' + op(tipos, "Todas as categorias") + "</select>" +
      "</div>";
  }

  function galeriaHTML(c, ordem, filtros) {
    var lista = c.titulos.filter(function (t) {
      if (filtros.temporada && String(t.ano) !== filtros.temporada) return false;
      if (filtros.competicao && t.localId + "/" + t.competicaoId !== filtros.competicao) return false;
      if (filtros.tipo && t.tipo !== filtros.tipo) return false;
      return true;
    });

    var por = {
      recente: function (a, b) { return b.ano - a.ano || a.competicao.localeCompare(b.competicao, "pt-BR"); },
      antigo: function (a, b) { return a.ano - b.ano || a.competicao.localeCompare(b.competicao, "pt-BR"); },
      competicao: function (a, b) { return a.competicao.localeCompare(b.competicao, "pt-BR") || a.ano - b.ano; },
      tipo: function (a, b) { return (a.tipo || "").localeCompare(b.tipo || "", "pt-BR") || b.ano - a.ano; },
      local: function (a, b) { return a.localNome.localeCompare(b.localNome, "pt-BR") || b.ano - a.ano; }
    };
    lista = lista.slice().sort(por[ordem] || por.recente);

    if (!lista.length) return mensagemVazia("Nenhum título com esses filtros", "Ajuste os filtros acima.");

    var h = '<div class="tabela-wrap"><table><thead><tr>' +
      "<th>Temporada</th><th>Competição</th><th>Categoria</th><th>Onde</th></tr></thead><tbody>";
    lista.forEach(function (t) {
      h += '<tr><td class="temporada">' + esc(temporadaEmTexto(t.temporada, t.localId)) + "</td>" +
        "<td>" + linkCompeticao(t) + "</td>" +
        "<td>" + (t.tipo ? '<span class="etiqueta">' + esc(t.tipo) + "</span>" : "—") + "</td>" +
        '<td><a href="#/local/' + t.localId + '">' + esc(t.localNome) + "</a></td></tr>";
    });
    return h + "</tbody></table></div>";
  }

  function aplicarGaleria() {
    var caixa = document.querySelector(".controles[data-clube]");
    var alvo = document.getElementById("galeria-alvo");
    if (!caixa || !alvo) return;
    var c = DADOS.porChave[caixa.dataset.clube];
    if (!c) return;
    var v = function (id) { return (document.getElementById(id) || {}).value || ""; };
    alvo.innerHTML = galeriaHTML(c, v("gal-ordem"), {
      temporada: v("gal-temporada"),
      competicao: v("gal-competicao"),
      tipo: v("gal-tipo")
    });
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

  /* --------------------------------------------------------- busca global */

  /* O índice guarda dois textos por item: o principal (o próprio nome) e o
     secundário (país, local, competições onde o clube venceu). Assim procurar
     "Espírito Santo" devolve o estado, as competições de lá e os clubes que
     ganharam títulos lá — sem precisar de uma consulta especial para cada caso.
     Resultados que batem no texto principal vêm primeiro. */
  var INDICE = [];

  function construirIndice() {
    INDICE = [];
    var add = function (tipo, rotulo, sub, href, principal, extra) {
      INDICE.push({
        tipo: tipo, rotulo: rotulo, sub: sub, href: href,
        chave: slug(principal), extra: slug(extra || "")
      });
    };

    DADOS.estrutura.secoes.forEach(function (s) {
      add("Seções", s.nome, plural(locaisDaSecao(s).length, "local", "locais"),
        "#/secao/" + s.id, s.nome);
    });

    Object.keys(DADOS.locais).forEach(function (id) {
      var l = DADOS.locais[id];
      var rotulo = { estado: "Estado", pais: "País", confederacao: "Confederação" }[l.tipo] || "Local";
      add("Locais", l.nome, rotulo + " · " + l.secao.nome, "#/local/" + id,
        l.nome, (l.ref.sigla || "") + " " + l.secao.nome);
    });

    Object.keys(DADOS.competicoes).forEach(function (localId) {
      var local = DADOS.locais[localId];
      if (!local) return;
      (DADOS.competicoes[localId].competicoes || []).forEach(function (c) {
        add("Competições", c.nome,
          local.nome + (c.tipo ? " · " + c.tipo : ""),
          "#/local/" + localId + "/" + c.id, c.nome,
          local.nome + " " + (c.tipo || "") + " " + (local.ref.sigla || ""));
      });
    });

    DADOS.ranking.forEach(function (c) {
      var locais = {};
      c.titulos.forEach(function (t) { locais[t.localNome] = 1; });
      add(c.selecao ? "Seleções" : "Clubes", c.nome,
        (c.pais ? c.pais + " · " : "") + plural(c.titulos.length, "título", "títulos"),
        "#/campeao/" + c.chave, c.nome,
        (c.pais || "") + " " + Object.keys(locais).join(" "));
    });

    DADOS.temporadas.forEach(function (ano) {
      add("Temporadas", "Temporada " + ano,
        plural(titulosDaTemporada(ano).length, "título", "títulos"),
        "#/temporadas/" + ano, String(ano), "temporada ano " + ano);
    });
  }

  var ORDEM_CATEGORIAS = ["Clubes", "Seleções", "Competições", "Locais", "Seções", "Temporadas"];

  function buscarGlobal(texto) {
    var termo = slug(texto);
    if (termo.length < 2) return [];

    var achados = INDICE.map(function (it) {
      var p = it.chave.indexOf(termo);
      if (p === 0) return { it: it, peso: 0 };
      if (p > 0) return { it: it, peso: 1 };
      if (it.extra.indexOf(termo) !== -1) return { it: it, peso: 2 };
      return null;
    }).filter(Boolean);

    var grupos = {};
    achados.forEach(function (a) {
      (grupos[a.it.tipo] = grupos[a.it.tipo] || []).push(a);
    });

    return ORDEM_CATEGORIAS.filter(function (c) { return grupos[c]; }).map(function (cat) {
      var itens = grupos[cat].sort(function (a, b) {
        return a.peso - b.peso || a.it.rotulo.localeCompare(b.it.rotulo, "pt-BR");
      });
      return { categoria: cat, total: itens.length, itens: itens.slice(0, 6).map(function (a) { return a.it; }) };
    });
  }

  function montarBuscaGlobal() {
    var campo = document.getElementById("busca-global");
    var painel = document.getElementById("busca-resultados");
    if (!campo || !painel) return;
    var selecionado = -1;

    function fechar() {
      painel.innerHTML = "";
      painel.classList.remove("aberto");
      selecionado = -1;
    }

    function desenhar() {
      var grupos = buscarGlobal(campo.value);
      if (!grupos.length) {
        if (slug(campo.value).length < 2) return fechar();
        painel.innerHTML = '<p class="busca-vazio">Nada encontrado para “' +
          esc(campo.value) + "”.</p>";
        painel.classList.add("aberto");
        return;
      }
      painel.innerHTML = grupos.map(function (g) {
        return '<div class="busca-grupo"><h4>' + esc(g.categoria) +
          (g.total > g.itens.length ? ' <span>' + g.total + "</span>" : "") + "</h4>" +
          g.itens.map(function (it) {
            return '<a class="busca-item" href="' + it.href + '">' +
              '<span class="busca-nome">' + esc(it.rotulo) + "</span>" +
              '<span class="busca-sub">' + esc(it.sub) + "</span></a>";
          }).join("") + "</div>";
      }).join("");
      painel.classList.add("aberto");
      selecionado = -1;
    }

    function itens() {
      return Array.prototype.slice.call(painel.querySelectorAll(".busca-item"));
    }

    campo.addEventListener("input", desenhar);
    campo.addEventListener("focus", function () { if (campo.value) desenhar(); });
    campo.addEventListener("keydown", function (e) {
      var lista = itens();
      if (e.key === "Escape") { fechar(); campo.blur(); return; }
      if (!lista.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        selecionado = (selecionado + (e.key === "ArrowDown" ? 1 : -1) + lista.length) % lista.length;
        lista.forEach(function (a, i) { a.classList.toggle("ativo", i === selecionado); });
        lista[selecionado].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") {
        e.preventDefault();
        (lista[selecionado < 0 ? 0 : selecionado]).click();
      }
    });

    // mousedown e não click: o blur do campo dispara antes do click e fecharia
    // o painel debaixo do cursor.
    painel.addEventListener("mousedown", function (e) {
      var alvo = e.target.closest ? e.target.closest(".busca-item") : null;
      if (!alvo) return;
      e.preventDefault();
      location.hash = alvo.getAttribute("href").slice(1);
      campo.value = "";
      fechar();
      campo.blur();
    });

    campo.addEventListener("blur", function () { setTimeout(fechar, 120); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "/" && document.activeElement !== campo &&
          !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "")) {
        e.preventDefault();
        campo.focus();
      }
    });
  }

  /* ------------------------------------------- componentes das análises */

  function numerosHTML(itens) {
    return '<div class="numeros">' + itens.filter(Boolean).map(function (n) {
      return '<div class="numero"><b>' + n[0] + "</b><span>" + esc(n[1]) + "</span></div>";
    }).join("") + "</div>";
  }

  function linhaFato(rotulo, valor) {
    return '<div class="fato"><span class="fato-rotulo">' + esc(rotulo) +
      '</span><span class="fato-valor">' + valor + "</span></div>";
  }

  function chipClube(chave, nome, n) {
    return '<a class="chip" href="#/campeao/' + chave + '">' + esc(nome) +
      (n == null ? "" : " <b>" + n + "</b>") + "</a>";
  }

  function linkCompeticao(t) {
    return '<a href="#/local/' + t.localId + "/" + t.competicaoId + '">' + esc(t.competicao) + "</a>";
  }

  function tabelaTitulos(lista, opcoes) {
    opcoes = opcoes || {};
    var h = '<div class="tabela-wrap"><table><thead><tr>' +
      (opcoes.temporada ? "<th>Temporada</th>" : "") +
      "<th>Campeão</th><th>Competição</th><th>Onde</th></tr></thead><tbody>";
    lista.forEach(function (t) {
      h += "<tr>" +
        (opcoes.temporada ? '<td class="temporada">' +
          esc(temporadaEmTexto(t.temporada, t.localId)) + "</td>" : "") +
        "<td>" + campeaoHTML(t.nome, t.chave) + "</td>" +
        "<td>" + linkCompeticao(t) + (t.tipo ? ' <span class="etiqueta">' + esc(t.tipo) + "</span>" : "") + "</td>" +
        '<td><a href="#/local/' + t.localId + '">' + esc(t.localNome) + "</a></td></tr>";
    });
    return h + "</tbody></table></div>";
  }

  // Agrupa títulos por região, país, estado ou tipo. As quatro visões da página
  // de temporada saem daqui, então a lista só é montada uma vez.
  function agruparTitulos(lista, criterio) {
    var grupos = {};
    lista.forEach(function (t) {
      var chave, rotulo;
      if (criterio === "regiao") {
        chave = t.secaoId;
        rotulo = (DADOS.locais[t.localId] || {}).secao;
        rotulo = rotulo ? rotulo.nome : t.secaoId;
      } else if (criterio === "pais") {
        chave = t.pais || "—";
        rotulo = chave;
      } else if (criterio === "estado") {
        if (t.localTipo !== "estado") return;
        chave = t.localId;
        rotulo = t.localNome;
      } else {
        chave = t.tipo || "—";
        rotulo = chave;
      }
      if (!grupos[chave]) grupos[chave] = { rotulo: rotulo, itens: [] };
      grupos[chave].itens.push(t);
    });
    return Object.keys(grupos).map(function (k) { return grupos[k]; })
      .sort(function (a, b) {
        return b.itens.length - a.itens.length || a.rotulo.localeCompare(b.rotulo, "pt-BR");
      });
  }

  /* -------------------------------------------------- páginas: temporadas */

  function paginaTemporadas() {
    var h = migalhas([{ texto: "Início", href: "#/" }, { texto: "Temporadas" }]);
    h += '<div class="cabecalho-pagina"><h1>📅 Temporadas</h1>' +
      "<p>Cada temporada tem uma página com o balanço completo daquele ano.</p></div>";

    if (!DADOS.temporadas.length) {
      return h + mensagemVazia("Nenhuma temporada registrada", "Importe uma planilha primeiro.");
    }

    h += '<section class="secao"><div class="grade">';
    DADOS.temporadas.slice().reverse().forEach(function (ano) {
      var t = titulosDaTemporada(ano);
      var clubes = {};
      t.forEach(function (x) { clubes[x.chave] = 1; });
      h += cartao("#/temporadas/" + ano, "📅", "Temporada " + ano,
        plural(t.length, "título", "títulos") + " · " +
        plural(Object.keys(clubes).length, "campeão", "campeões"));
    });
    h += "</div></section>";

    h += '<section class="secao"><h2 class="secao-titulo">Análises entre temporadas</h2><div class="grade">' +
      cartao("#/comparar", "⚖️", "Comparar temporadas",
        "Duas temporadas lado a lado: quem repetiu, quem estreou, quem caiu") +
      cartao("#/evolucao", "📈", "Evolução do ranking",
        "Como o ranking dos maiores campeões mudou a cada temporada") +
      cartao("#/dinastias", "👑", "Sequências e dinastias",
        "Bicampeonatos, temporadas seguidas com título e acúmulo rápido") +
      "</div></section>";
    return h;
  }

  function paginaTemporada(anoTxt) {
    var ano = parseInt(anoTxt, 10);
    if (DADOS.temporadas.indexOf(ano) === -1) return paginaNaoEncontrada();

    var lista = titulosDaTemporada(ano);
    var anterior = temporadaAnterior(ano);
    var i = DADOS.temporadas.indexOf(ano);
    var seguinte = i < DADOS.temporadas.length - 1 ? DADOS.temporadas[i + 1] : null;

    var porClube = {};
    lista.forEach(function (t) {
      (porClube[t.chave] = porClube[t.chave] || { nome: t.nome, chave: t.chave, itens: [] }).itens.push(t);
    });
    var clubes = Object.keys(porClube).map(function (k) { return porClube[k]; })
      .sort(function (a, b) {
        return b.itens.length - a.itens.length || a.nome.localeCompare(b.nome, "pt-BR");
      });

    var comps = {};
    lista.forEach(function (t) { comps[t.localId + "/" + t.competicaoId] = 1; });

    // Repetiram: mesmo clube, mesma competição, na temporada anterior.
    var anteriores = {};
    if (anterior) {
      titulosDaTemporada(anterior).forEach(function (t) {
        anteriores[t.chave + "|" + t.localId + "/" + t.competicaoId] = t;
      });
    }
    var repetiram = lista.filter(function (t) {
      return anteriores[t.chave + "|" + t.localId + "/" + t.competicaoId];
    });

    // Inéditos: o primeiro título da era do clube aconteceu nesta temporada.
    var ineditos = clubes.filter(function (c) {
      return (DADOS.porChave[c.chave] || {}).estreia === ano;
    });

    var multiplos = clubes.filter(function (c) { return c.itens.length > 1; });

    var h = migalhas([
      { texto: "Início", href: "#/" },
      { texto: "Temporadas", href: "#/temporadas" },
      { texto: String(ano) }
    ]);

    h += '<div class="cabecalho-pagina"><h1>📅 Temporada ' + ano + "</h1>" +
      "<p>Balanço completo do que foi decidido no ano." +
      (anterior || seguinte ? " " : "") +
      (anterior ? '<a class="chip" href="#/temporadas/' + anterior + '">← ' + anterior + "</a> " : "") +
      (seguinte ? '<a class="chip" href="#/temporadas/' + seguinte + '">' + seguinte + " →</a>" : "") +
      "</p></div>";

    h += numerosHTML([
      [lista.length, "Títulos"],
      [clubes.length, "Campeões"],
      [Object.keys(comps).length, "Competições"],
      [ineditos.length, "Campeões inéditos"],
      [repetiram.length, "Títulos repetidos"]
    ]);

    h += '<section class="secao"><h2 class="secao-titulo">Destaques do ano</h2><div class="fatos">';
    if (clubes.length) {
      h += linhaFato("Clube com mais títulos",
        chipClube(clubes[0].chave, clubes[0].nome, clubes[0].itens.length));
    }
    h += linhaFato("Clubes com mais de um título", multiplos.length
      ? multiplos.map(function (c) { return chipClube(c.chave, c.nome, c.itens.length); }).join(" ")
      : "<em>nenhum</em>");
    h += linhaFato(anterior ? "Repetiram o título de " + anterior : "Repetiram o título",
      repetiram.length
        ? repetiram.map(function (t) {
            return chipClube(t.chave, t.nome) + " <span class=\"cartao-sub\">" +
              esc(t.competicao) + "</span>";
          }).join(" · ")
        : "<em>" + (anterior ? "nenhum" : "primeira temporada registrada") + "</em>");
    h += linhaFato("Primeiro título na era NCOFDI", ineditos.length
      ? ineditos.slice(0, 24).map(function (c) { return chipClube(c.chave, c.nome); }).join(" ") +
        (ineditos.length > 24 ? ' <span class="cartao-sub">e mais ' + (ineditos.length - 24) + "</span>" : "")
      : "<em>nenhum</em>");
    h += "</div></section>";

    if (multiplos.length) {
      h += '<section class="secao" id="vencedores"><h2 class="secao-titulo">Maiores vencedores da temporada</h2>' +
        '<p class="secao-nota">Clubes que conquistaram dois ou mais títulos em ' + ano + ".</p>";
      h += '<div class="tabela-wrap"><table><thead><tr><th class="pos">#</th><th>Clube</th>' +
        '<th class="num">Títulos</th><th>Competições vencidas</th></tr></thead><tbody>';
      multiplos.forEach(function (c, k) {
        h += '<tr class="p' + (k + 1) + '"><td class="pos">' + (k + 1) + "</td>" +
          "<td>" + campeaoHTML(c.nome, c.chave) + "</td>" +
          '<td class="num"><span class="total">' + c.itens.length + "</span></td>" +
          '<td><div class="chips">' + c.itens.map(function (t) {
            return '<a class="chip" href="#/local/' + t.localId + "/" + t.competicaoId + '">' +
              esc(t.competicao) + "</a>";
          }).join("") + "</div></td></tr>";
      });
      h += "</tbody></table></div></section>";
    }

    h += '<section class="secao"><h2 class="secao-titulo">Campeões de ' + ano + "</h2>";
    h += controlesTemporada(ano);
    h += '<div id="temporada-alvo"></div></section>';
    return h;
  }

  function controlesTemporada(ano) {
    var lista = titulosDaTemporada(ano);
    var secoes = {}, paises = {}, estados = {}, tipos = {};
    lista.forEach(function (t) {
      secoes[t.secaoId] = 1;
      if (t.pais) paises[t.pais] = 1;
      if (t.localTipo === "estado") estados[t.localId] = t.localNome;
      if (t.tipo) tipos[t.tipo] = 1;
    });
    var opcoes = function (obj, rotulo, mapa) {
      return '<option value="">' + rotulo + "</option>" +
        Object.keys(obj).sort(function (a, b) {
          return String(mapa ? mapa(a) : a).localeCompare(String(mapa ? mapa(b) : b), "pt-BR");
        }).map(function (k) {
          return '<option value="' + esc(k) + '">' + esc(mapa ? mapa(k) : k) + "</option>";
        }).join("");
    };
    return '<div class="controles" data-ano="' + ano + '">' +
      '<select id="temp-agrupar">' +
        '<option value="regiao">Agrupar por região</option>' +
        '<option value="pais">Agrupar por país</option>' +
        '<option value="estado">Agrupar por estado</option>' +
        '<option value="tipo">Agrupar por tipo de título</option>' +
        '<option value="">Sem agrupamento</option>' +
      "</select>" +
      '<select id="temp-regiao">' + opcoes(secoes, "Todas as regiões", function (id) {
        var l = DADOS.estrutura.secoes.filter(function (s) { return s.id === id; })[0];
        return l ? l.nome : id;
      }) + "</select>" +
      '<select id="temp-pais">' + opcoes(paises, "Todos os países") + "</select>" +
      '<select id="temp-estado">' + opcoes(estados, "Todos os estados", function (id) {
        return estados[id];
      }) + "</select>" +
      '<select id="temp-tipo">' + opcoes(tipos, "Todos os tipos") + "</select>" +
      "</div>";
  }

  function aplicarFiltrosTemporada() {
    var alvo = document.getElementById("temporada-alvo");
    var caixa = document.querySelector(".controles[data-ano]");
    if (!alvo || !caixa) return;
    var ano = parseInt(caixa.dataset.ano, 10);
    var v = function (id) { return (document.getElementById(id) || {}).value || ""; };
    var agrupar = v("temp-agrupar");

    var lista = titulosDaTemporada(ano).filter(function (t) {
      if (v("temp-regiao") && t.secaoId !== v("temp-regiao")) return false;
      if (v("temp-pais") && t.pais !== v("temp-pais")) return false;
      if (v("temp-estado") && t.localId !== v("temp-estado")) return false;
      if (v("temp-tipo") && t.tipo !== v("temp-tipo")) return false;
      return true;
    }).sort(function (a, b) {
      return a.localNome.localeCompare(b.localNome, "pt-BR") ||
        a.competicao.localeCompare(b.competicao, "pt-BR");
    });

    if (!lista.length) {
      alvo.innerHTML = mensagemVazia("Nenhum campeão encontrado", "Ajuste os filtros.");
      return;
    }
    if (!agrupar) {
      alvo.innerHTML = tabelaTitulos(lista);
      return;
    }
    alvo.innerHTML = agruparTitulos(lista, agrupar).map(function (g) {
      return '<details class="secao-lista" open><summary>' + esc(g.rotulo) +
        ' <span class="cartao-sub">' + plural(g.itens.length, "título", "títulos") +
        "</span></summary>" + tabelaTitulos(g.itens) + "</details>";
    }).join("");
  }

  /* ------------------------------------------------ páginas: comparação */

  function paginaComparar(aTxt, bTxt) {
    var t = DADOS.temporadas;
    if (t.length < 2) {
      return migalhas([{ texto: "Início", href: "#/" }, { texto: "Comparar" }]) +
        mensagemVazia("Ainda não há duas temporadas",
          "A comparação aparece quando houver pelo menos duas temporadas registradas.");
    }
    var a = parseInt(aTxt, 10), b = parseInt(bTxt, 10);
    if (t.indexOf(a) === -1) a = t[t.length - 2];
    if (t.indexOf(b) === -1) b = t[t.length - 1];

    var h = migalhas([
      { texto: "Início", href: "#/" },
      { texto: "Temporadas", href: "#/temporadas" },
      { texto: "Comparar" }
    ]);
    h += '<div class="cabecalho-pagina"><h1>⚖️ ' + a + " × " + b + "</h1>" +
      "<p>Escolha duas temporadas para ver o que mudou de uma para a outra.</p></div>";

    var sel = function (id, valor) {
      return '<select id="' + id + '">' + t.map(function (x) {
        return '<option value="' + x + '"' + (x === valor ? " selected" : "") + ">" + x + "</option>";
      }).join("") + "</select>";
    };
    h += '<div class="controles">' + sel("cmp-a", a) + '<span class="controles-sep">×</span>' +
      sel("cmp-b", b) + "</div>";

    return h + '<div id="comparar-alvo">' + compararHTML(a, b) + "</div>";
  }

  function compararHTML(a, b) {
    var la = titulosDaTemporada(a), lb = titulosDaTemporada(b);
    var porClube = function (lista) {
      var m = {};
      lista.forEach(function (t) {
        (m[t.chave] = m[t.chave] || { nome: t.nome, chave: t.chave, itens: [] }).itens.push(t);
      });
      return m;
    };
    var ca = porClube(la), cb = porClube(lb);
    var compsA = {}, compsB = {};
    la.forEach(function (t) { compsA[t.localId + "/" + t.competicaoId] = t; });
    lb.forEach(function (t) { compsB[t.localId + "/" + t.competicaoId] = t; });

    var nosDois = Object.keys(cb).filter(function (k) { return ca[k]; });
    var repetiramMesma = [], trocaram = [];
    nosDois.forEach(function (k) {
      var mesmas = cb[k].itens.filter(function (t) {
        return ca[k].itens.some(function (x) {
          return x.localId === t.localId && x.competicaoId === t.competicaoId;
        });
      });
      if (mesmas.length) repetiramMesma.push({ clube: cb[k], titulos: mesmas });
      else trocaram.push({ clube: cb[k], antes: ca[k].itens, depois: cb[k].itens });
    });

    var estrearam = Object.keys(cb).filter(function (k) {
      return (DADOS.porChave[k] || {}).estreia === b;
    }).map(function (k) { return cb[k]; });
    var sairam = Object.keys(ca).filter(function (k) { return !cb[k]; })
      .map(function (k) { return ca[k]; })
      .sort(function (x, y) { return y.itens.length - x.itens.length; });

    var topo = function (m) {
      return Object.keys(m).map(function (k) { return m[k]; })
        .sort(function (x, y) { return y.itens.length - x.itens.length ||
          x.nome.localeCompare(y.nome, "pt-BR"); })[0];
    };

    // Crescimento: quanto o total acumulado de cada clube subiu na temporada b.
    var rankA = rankingAte(a), rankB = rankingAte(b);
    var crescimento = rankB.lista.map(function (c) {
      var antes = rankA.lista.filter(function (x) { return x.chave === c.chave; })[0];
      var nAntes = antes ? antes.titulos.length : 0;
      return {
        chave: c.chave, nome: c.nome, antes: nAntes, agora: c.titulos.length,
        ganho: c.titulos.length - nAntes,
        posAntes: rankA.posicao[c.chave] || null, posAgora: rankB.posicao[c.chave]
      };
    }).filter(function (x) { return x.ganho > 0; })
      .sort(function (x, y) { return y.ganho - x.ganho || x.posAgora - y.posAgora; });

    var mesmasComps = Object.keys(compsB).filter(function (k) { return compsA[k]; });
    var mantidas = mesmasComps.filter(function (k) { return compsA[k].chave === compsB[k].chave; });
    var mudaram = mesmasComps.filter(function (k) { return compsA[k].chave !== compsB[k].chave; });

    var h = numerosHTML([
      [la.length + " → " + lb.length, "Títulos"],
      [Object.keys(ca).length + " → " + Object.keys(cb).length, "Campeões"],
      [nosDois.length, "Campeões nos dois anos"],
      [estrearam.length, "Novos campeões da era"],
      [mantidas.length, "Competições com campeão repetido"],
      [mudaram.length, "Competições que trocaram de campeão"]
    ]);

    /* As frases automáticas são a leitura rápida da comparação; as tabelas
       abaixo têm o mesmo conteúdo em detalhe. */
    var frases = [];
    repetiramMesma.slice(0, 12).forEach(function (r) {
      r.titulos.forEach(function (t) {
        frases.push(esc(r.clube.nome) + " venceu " + esc(t.competicao) +
          " em " + a + " e " + b + ".");
      });
    });
    trocaram.slice(0, 8).forEach(function (r) {
      frases.push(esc(r.clube.nome) + " venceu " + esc(r.antes[0].competicao) + " em " + a +
        " e " + esc(r.depois[0].competicao) + " em " + b + ".");
    });
    crescimento.slice(0, 8).forEach(function (c) {
      frases.push(esc(c.nome) + " passou de " + (c.antes ? plural(c.antes, "título", "títulos")
        : "nenhum título") + " para " + plural(c.agora, "título", "títulos") +
        " na temporada de " + b + ".");
    });

    if (frases.length) {
      h += '<section class="secao"><h2 class="secao-titulo">Resumo</h2>' +
        '<ul class="frases">' + frases.slice(0, 20).map(function (f) {
          return "<li>" + f + "</li>";
        }).join("") + "</ul></section>";
    }

    var blocoClubes = function (titulo, nota, itens, render) {
      if (!itens.length) return "";
      return '<section class="secao"><h2 class="secao-titulo">' + esc(titulo) + "</h2>" +
        (nota ? '<p class="secao-nota">' + esc(nota) + "</p>" : "") +
        '<div class="chips">' + itens.map(render).join("") + "</div></section>";
    };

    h += blocoClubes("Campeões nas duas temporadas", "", nosDois.map(function (k) { return cb[k]; }),
      function (c) { return chipClube(c.chave, c.nome, c.itens.length); });
    h += blocoClubes("Repetiram o título da mesma competição", "", repetiramMesma,
      function (r) {
        return '<span class="chip ouro">' + esc(r.clube.nome) + " · " +
          esc(r.titulos[0].competicao) + "</span>";
      });
    h += blocoClubes("Títulos diferentes em cada ano", "", trocaram, function (r) {
      return '<span class="chip">' + esc(r.clube.nome) + " · " +
        esc(r.antes[0].competicao) + " → " + esc(r.depois[0].competicao) + "</span>";
    });
    h += blocoClubes("Novos campeões da era", "Primeiro título no NCOFDI em " + b + ".",
      estrearam, function (c) { return chipClube(c.chave, c.nome, c.itens.length); });
    h += blocoClubes("Deixaram de ser campeões",
      "Venceram algo em " + a + " e nada em " + b + ".", sairam,
      function (c) { return chipClube(c.chave, c.nome, c.itens.length); });

    var ta = topo(ca), tb = topo(cb);
    h += '<section class="secao"><h2 class="secao-titulo">Clube com mais títulos</h2><div class="fatos">' +
      (ta ? linhaFato(String(a), chipClube(ta.chave, ta.nome, ta.itens.length)) : "") +
      (tb ? linhaFato(String(b), chipClube(tb.chave, tb.nome, tb.itens.length)) : "") +
      "</div></section>";

    if (crescimento.length) {
      h += '<section class="secao"><h2 class="secao-titulo">Maior crescimento no total de títulos</h2>';
      h += '<div class="tabela-wrap"><table><thead><tr><th>Clube</th>' +
        "<th class=\"num\">" + a + "</th><th class=\"num\">" + b + "</th>" +
        '<th class="num">Ganho</th><th>Posição no ranking</th></tr></thead><tbody>';
      crescimento.slice(0, 20).forEach(function (c) {
        h += "<tr><td>" + campeaoHTML(c.nome, c.chave) + "</td>" +
          '<td class="num">' + c.antes + "</td><td class=\"num\">" + c.agora + "</td>" +
          '<td class="num"><span class="total">+' + c.ganho + "</span></td>" +
          "<td>" + variacaoHTML(c.posAntes, c.posAgora) + "</td></tr>";
      });
      h += "</tbody></table></div></section>";
    }

    if (mudaram.length) {
      h += '<section class="secao"><h2 class="secao-titulo">Competições que trocaram de campeão</h2>';
      h += '<div class="tabela-wrap"><table><thead><tr><th>Competição</th>' +
        "<th>" + a + "</th><th>" + b + "</th></tr></thead><tbody>";
      mudaram.sort(function (x, y) {
        return compsB[x].competicao.localeCompare(compsB[y].competicao, "pt-BR");
      }).forEach(function (k) {
        h += "<tr><td>" + linkCompeticao(compsB[k]) + "</td>" +
          "<td>" + campeaoHTML(compsA[k].nome, compsA[k].chave) + "</td>" +
          "<td>" + campeaoHTML(compsB[k].nome, compsB[k].chave) + "</td></tr>";
      });
      h += "</tbody></table></div></section>";
    }
    return h;
  }

  function variacaoHTML(antes, agora) {
    if (!antes) return '<span class="var nova">entrou no ranking</span>';
    var d = antes - agora;
    if (!d) return '<span class="var igual">' + agora + "º · manteve</span>";
    return '<span class="var ' + (d > 0 ? "sobe" : "desce") + '">' + agora + "º · " +
      (d > 0 ? "▲ +" + d : "▼ " + d) + "</span>";
  }

  /* ------------------------------------------------- páginas: evolução */

  function paginaEvolucao(anoTxt) {
    var t = DADOS.temporadas;
    if (!t.length) {
      return migalhas([{ texto: "Início", href: "#/" }, { texto: "Evolução" }]) +
        mensagemVazia("Nenhuma temporada registrada", "Importe uma planilha primeiro.");
    }
    var ano = parseInt(anoTxt, 10);
    if (t.indexOf(ano) === -1) ano = t[t.length - 1];

    var h = migalhas([
      { texto: "Início", href: "#/" },
      { texto: "Temporadas", href: "#/temporadas" },
      { texto: "Evolução do ranking" }
    ]);
    h += '<div class="cabecalho-pagina"><h1>📈 Evolução do ranking</h1>' +
      "<p>O ranking dos maiores campeões como ele estava ao fim de cada temporada.</p></div>";
    h += '<div class="controles"><select id="evo-ano">' + t.slice().reverse().map(function (x) {
      return '<option value="' + x + '"' + (x === ano ? " selected" : "") +
        ">Ranking até " + x + "</option>";
    }).join("") + "</select></div>";

    return h + '<div id="evolucao-alvo">' + evolucaoHTML(ano) + "</div>";
  }

  function evolucaoHTML(ano) {
    var anterior = temporadaAnterior(ano);
    var agora = rankingAte(ano);
    var antes = anterior ? rankingAte(anterior) : { lista: [], posicao: {} };

    var linhas = agora.lista.map(function (c) {
      var ant = antes.lista.filter(function (x) { return x.chave === c.chave; })[0];
      var nAntes = ant ? ant.titulos.length : 0;
      var pAntes = antes.posicao[c.chave] || null;
      return {
        chave: c.chave, nome: c.nome, pais: c.pais,
        posAgora: agora.posicao[c.chave], posAntes: pAntes,
        antes: nAntes, agora: c.titulos.length,
        ganho: c.titulos.length - nAntes,
        delta: pAntes ? pAntes - agora.posicao[c.chave] : null
      };
    });

    var subidas = linhas.filter(function (l) { return l.delta && l.delta > 0; })
      .sort(function (a, b) { return b.delta - a.delta || a.posAgora - b.posAgora; });
    var novos = linhas.filter(function (l) { return !l.posAntes; });

    var h = numerosHTML([
      [agora.lista.length, "Campeões no ranking"],
      [novos.length, anterior ? "Entraram em " + ano : "Campeões"],
      [subidas.length, "Subiram de posição"]
    ]);

    if (!anterior) {
      h += '<p class="aviso-caixa">' + ano +
        " é a primeira temporada registrada, então não há posição anterior para comparar.</p>";
    }

    if (subidas.length) {
      h += '<section class="secao"><h2 class="secao-titulo">Maiores subidas da temporada</h2>' +
        '<div class="chips">' + subidas.slice(0, 15).map(function (l) {
          return '<a class="chip ouro" href="#/campeao/' + l.chave + '">' + esc(l.nome) +
            " <b>▲ " + l.delta + "</b></a>";
        }).join("") + "</div></section>";
    }

    h += '<section class="secao"><h2 class="secao-titulo">Ranking até ' + ano + "</h2>";
    h += '<div class="tabela-wrap"><table><thead><tr><th class="pos">#</th><th>Campeão</th>' +
      '<th class="num">Antes</th><th class="num">Agora</th>' +
      '<th class="num">Na temporada</th><th>Variação</th></tr></thead><tbody>';
    linhas.forEach(function (l) {
      h += '<tr class="p' + l.posAgora + '"><td class="pos">' + l.posAgora + "</td>" +
        "<td>" + campeaoHTML(l.nome, l.chave) + "</td>" +
        '<td class="num">' + (l.posAntes ? l.antes : "—") + "</td>" +
        '<td class="num"><span class="total">' + l.agora + "</span></td>" +
        '<td class="num">' + (l.ganho ? "+" + l.ganho : "—") + "</td>" +
        "<td>" + variacaoHTML(l.posAntes, l.posAgora) + "</td></tr>";
    });
    return h + "</tbody></table></div></section>";
  }

  /* ------------------------------------------------- páginas: recordes */

  function melhorPor(filtro, rotulo) {
    var por = {};
    DADOS.titulos.forEach(function (t) {
      if (!filtro(t)) return;
      (por[t.chave] = por[t.chave] || { chave: t.chave, nome: t.nome, n: 0 }).n++;
    });
    var lista = Object.keys(por).map(function (k) { return por[k]; })
      .sort(function (a, b) { return b.n - a.n || a.nome.localeCompare(b.nome, "pt-BR"); });
    if (!lista.length) return null;
    return { rotulo: rotulo, lista: lista };
  }

  function recordeHTML(reg) {
    if (!reg) return "";
    var topo = reg.lista[0];
    var empatados = reg.lista.filter(function (x) { return x.n === topo.n; });
    return linhaFato(reg.rotulo, empatados.slice(0, 4).map(function (x) {
      return chipClube(x.chave, x.nome, x.n);
    }).join(" ") + (empatados.length > 4
      ? ' <span class="cartao-sub">e mais ' + (empatados.length - 4) + " empatados</span>" : ""));
  }

  function paginaRecordes() {
    var h = migalhas([{ texto: "Início", href: "#/" }, { texto: "Recordes" }]);
    h += '<div class="cabecalho-pagina"><h1>🥇 Recordes da era NCOFDI</h1>' +
      "<p>Tudo calculado a partir dos títulos já registrados. Em caso de empate, " +
      "todos os empatados aparecem.</p></div>";

    if (!DADOS.titulos.length) {
      return h + mensagemVazia("Nenhum título registrado", "Importe uma planilha primeiro.");
    }

    // Mais títulos numa única temporada.
    var porClubeAno = {};
    DADOS.titulos.forEach(function (t) {
      var k = t.chave + "|" + t.ano;
      (porClubeAno[k] = porClubeAno[k] || { chave: t.chave, nome: t.nome, ano: t.ano, n: 0 }).n++;
    });
    var melhorAno = Object.keys(porClubeAno).map(function (k) { return porClubeAno[k]; })
      .sort(function (a, b) { return b.n - a.n || b.ano - a.ano; });

    // Mais competições diferentes vencidas.
    var porClubeComp = {};
    DADOS.titulos.forEach(function (t) {
      var s = porClubeComp[t.chave] = porClubeComp[t.chave] ||
        { chave: t.chave, nome: t.nome, comps: {} };
      s.comps[t.localId + "/" + t.competicaoId] = 1;
    });
    var maisComps = Object.keys(porClubeComp).map(function (k) {
      return { chave: k, nome: porClubeComp[k].nome, n: Object.keys(porClubeComp[k].comps).length };
    }).sort(function (a, b) { return b.n - a.n || a.nome.localeCompare(b.nome, "pt-BR"); });

    // Maior sequência na mesma competição e maior corrida de temporadas.
    var seqs = [], corridas = [];
    DADOS.ranking.forEach(function (c) {
      sequenciasDoClube(c).forEach(function (s) {
        seqs.push({ chave: c.chave, nome: c.nome, n: s.anos.length,
                    competicao: s.competicao, anos: s.anos });
      });
      var cr = maiorCorridaDeTemporadas(c);
      if (cr.anos > 1) corridas.push({ chave: c.chave, nome: c.nome, n: cr.anos });
    });
    seqs.sort(function (a, b) { return b.n - a.n || a.nome.localeCompare(b.nome, "pt-BR"); });
    corridas.sort(function (a, b) { return b.n - a.n || a.nome.localeCompare(b.nome, "pt-BR"); });

    var empatadosDe = function (lista) {
      return lista.length ? lista.filter(function (x) { return x.n === lista[0].n; }) : [];
    };

    h += '<section class="secao"><h2 class="secao-titulo">Recordes gerais</h2><div class="fatos">';
    h += recordeHTML(melhorPor(function () { return true; }, "Maior campeão da era"));
    if (melhorAno.length) {
      h += linhaFato("Mais títulos numa única temporada",
        empatadosDe(melhorAno).slice(0, 4).map(function (x) {
          return chipClube(x.chave, x.nome, x.n) +
            ' <span class="cartao-sub">' + x.ano + "</span>";
        }).join(" "));
    }
    if (maisComps.length) {
      h += linhaFato("Mais competições diferentes vencidas",
        empatadosDe(maisComps).slice(0, 4).map(function (x) {
          return chipClube(x.chave, x.nome, x.n);
        }).join(" "));
    }
    h += linhaFato("Maior sequência na mesma competição", seqs.length
      ? empatadosDe(seqs).slice(0, 4).map(function (s) {
          return chipClube(s.chave, s.nome, s.n) +
            ' <span class="cartao-sub">' + esc(s.competicao) + ", " +
            s.anos[0] + "–" + s.anos[s.anos.length - 1] + "</span>";
        }).join(" ")
      : "<em>nenhuma ainda</em>");
    h += linhaFato("Mais temporadas seguidas com título", corridas.length
      ? empatadosDe(corridas).slice(0, 6).map(function (x) {
          return chipClube(x.chave, x.nome, x.n);
        }).join(" ")
      : "<em>nenhuma ainda</em>");
    h += recordeHTML(melhorPor(function (t) { return t.ambito === "nacional"; }, "Mais títulos nacionais"));
    h += recordeHTML(melhorPor(function (t) { return t.ambito === "estadual"; }, "Mais títulos estaduais"));
    h += recordeHTML(melhorPor(function (t) { return t.ambito === "continental"; }, "Mais títulos continentais"));
    h += recordeHTML(melhorPor(function (t) { return t.ambito === "regional"; }, "Mais títulos regionais"));
    h += recordeHTML(melhorPor(function (t) { return t.forma === "copa"; }, "Mais copas"));
    h += recordeHTML(melhorPor(function (t) { return t.forma === "liga"; }, "Mais ligas"));
    h += "</div></section>";

    h += '<section class="secao"><h2 class="secao-titulo">Recordes por região</h2><div class="fatos">';
    DADOS.estrutura.secoes.forEach(function (s) {
      h += recordeHTML(melhorPor(function (t) { return t.secaoId === s.id; },
        "Maior campeão · " + s.nome));
    });
    h += "</div></section>";

    var estados = DADOS.titulos.filter(function (t) { return t.localTipo === "estado"; });
    if (estados.length) {
      var porEstado = {};
      estados.forEach(function (t) {
        var e = porEstado[t.localId] = porEstado[t.localId] ||
          { nome: t.localNome, id: t.localId, n: 0, clubes: {} };
        e.n++;
        e.clubes[t.chave] = 1;
      });
      var listaEstados = Object.keys(porEstado).map(function (k) { return porEstado[k]; });
      var maisTitulos = listaEstados.slice().sort(function (a, b) { return b.n - a.n; });
      var maisClubes = listaEstados.slice().sort(function (a, b) {
        return Object.keys(b.clubes).length - Object.keys(a.clubes).length;
      });

      // Categorias diferentes = quantos tipos de competição distintos o clube venceu.
      var porCat = {};
      DADOS.titulos.forEach(function (t) {
        if (t.pais !== "Brasil") return;
        var s = porCat[t.chave] = porCat[t.chave] || { chave: t.chave, nome: t.nome, tipos: {} };
        s.tipos[t.tipo] = 1;
      });
      var catLista = Object.keys(porCat).map(function (k) {
        return { chave: k, nome: porCat[k].nome, n: Object.keys(porCat[k].tipos).length };
      }).sort(function (a, b) { return b.n - a.n || a.nome.localeCompare(b.nome, "pt-BR"); });

      h += '<section class="secao"><h2 class="secao-titulo">Recordes brasileiros</h2><div class="fatos">';
      h += recordeHTML(melhorPor(function (t) {
        return t.pais === "Brasil" && t.ambito === "nacional";
      }, "Mais títulos nacionais"));
      h += recordeHTML(melhorPor(function (t) { return t.ambito === "estadual"; },
        "Mais títulos estaduais"));
      h += recordeHTML(melhorPor(function (t) { return t.ambito === "regional"; },
        "Mais títulos regionais"));
      h += linhaFato("Estado com mais campeões diferentes",
        '<a class="chip" href="#/local/' + maisClubes[0].id + '">' + esc(maisClubes[0].nome) +
        " <b>" + Object.keys(maisClubes[0].clubes).length + "</b></a>");
      h += linhaFato("Estado com mais títulos registrados",
        '<a class="chip" href="#/local/' + maisTitulos[0].id + '">' + esc(maisTitulos[0].nome) +
        " <b>" + maisTitulos[0].n + "</b></a>");
      if (catLista.length) {
        h += linhaFato("Títulos em mais categorias diferentes",
          empatadosDe(catLista).slice(0, 4).map(function (x) {
            return chipClube(x.chave, x.nome, x.n);
          }).join(" "));
      }
      h += "</div></section>";
    }
    return h;
  }

  /* ------------------------------------------------ páginas: dinastias */

  function paginaDinastias() {
    var h = migalhas([
      { texto: "Início", href: "#/" },
      { texto: "Temporadas", href: "#/temporadas" },
      { texto: "Sequências e dinastias" }
    ]);
    h += '<div class="cabecalho-pagina"><h1>👑 Sequências e dinastias</h1>' +
      "<p>Clubes com continuidade de títulos. A página é inteiramente automática.</p></div>";

    var consecutivos = [], corridas = [], acumulo = [];
    DADOS.ranking.forEach(function (c) {
      sequenciasDoClube(c).forEach(function (s) {
        consecutivos.push({ clube: c, seq: s });
      });
      var cr = maiorCorridaDeTemporadas(c);
      if (cr.anos > 1) corridas.push({ clube: c, n: cr.anos, ate: cr.ate });

      // Quatro ou mais títulos numa janela de até três temporadas.
      var anos = c.titulos.map(function (t) { return t.ano; });
      var melhor = 0, janela = null;
      DADOS.temporadas.forEach(function (ini) {
        var n = anos.filter(function (a) { return a >= ini && a <= ini + 2; }).length;
        if (n > melhor) { melhor = n; janela = ini; }
      });
      if (melhor >= 4) acumulo.push({ clube: c, n: melhor, de: janela });
    });

    consecutivos.sort(function (a, b) {
      return b.seq.anos.length - a.seq.anos.length ||
        b.seq.anos[b.seq.anos.length - 1] - a.seq.anos[a.seq.anos.length - 1] ||
        a.clube.nome.localeCompare(b.clube.nome, "pt-BR");
    });
    corridas.sort(function (a, b) { return b.n - a.n || a.clube.nome.localeCompare(b.clube.nome, "pt-BR"); });
    acumulo.sort(function (a, b) { return b.n - a.n || a.clube.nome.localeCompare(b.clube.nome, "pt-BR"); });

    if (!consecutivos.length && !corridas.length && !acumulo.length) {
      return h + mensagemVazia("Nenhuma sequência ainda",
        "Sequências aparecem quando um clube repete títulos em temporadas seguidas. " +
        "Com poucas temporadas registradas isso ainda é raro.");
    }

    h += '<section class="secao"><h2 class="secao-titulo">Campeões consecutivos</h2>' +
      '<p class="secao-nota">Venceram a mesma competição em duas ou mais temporadas seguidas.</p>';
    if (!consecutivos.length) {
      h += mensagemVazia("Nenhum ainda", "Nenhuma competição teve o mesmo campeão em anos seguidos.");
    } else {
      h += '<div class="tabela-wrap"><table><thead><tr><th>Clube</th><th>Competição</th>' +
        '<th>Temporadas</th><th class="num">Sequência</th></tr></thead><tbody>';
      consecutivos.forEach(function (r) {
        h += "<tr><td>" + campeaoHTML(r.clube.nome, r.clube.chave) + "</td>" +
          '<td><a href="#/local/' + r.seq.localId + "/" + r.seq.competicaoId + '">' +
            esc(r.seq.competicao) + "</a></td>" +
          '<td class="temporada">' + r.seq.anos.join(", ") + "</td>" +
          '<td class="num"><span class="total">' + r.seq.anos.length + "</span></td></tr>";
      });
      h += "</tbody></table></div>";
    }
    h += "</section>";

    if (corridas.length) {
      h += '<section class="secao"><h2 class="secao-titulo">Temporadas consecutivas com título</h2>' +
        '<p class="secao-nota">Pelo menos um título em temporadas seguidas, ainda que em ' +
        "competições diferentes.</p><div class=\"chips\">" +
        corridas.slice(0, 40).map(function (r) {
          return '<a class="chip' + (r.n === corridas[0].n ? " ouro" : "") +
            '" href="#/campeao/' + r.clube.chave + '">' + esc(r.clube.nome) +
            " <b>" + r.n + "</b></a>";
        }).join("") + "</div></section>";
    }

    if (acumulo.length) {
      h += '<section class="secao"><h2 class="secao-titulo">Múltiplos títulos em curto período</h2>' +
        '<p class="secao-nota">Quatro ou mais títulos em até três temporadas.</p><div class="chips">' +
        acumulo.map(function (r) {
          return '<a class="chip ouro" href="#/campeao/' + r.clube.chave + '">' +
            esc(r.clube.nome) + " <b>" + r.n + "</b></a>";
        }).join("") + "</div></section>";
    }
    return h;
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
    else if (partes[0] === "temporadas" && partes[1]) html = paginaTemporada(partes[1]);
    else if (partes[0] === "temporadas") html = paginaTemporadas();
    else if (partes[0] === "comparar") html = paginaComparar(partes[1], partes[2]);
    else if (partes[0] === "evolucao") html = paginaEvolucao(partes[1]);
    else if (partes[0] === "recordes") html = paginaRecordes();
    else if (partes[0] === "dinastias") html = paginaDinastias();
    else html = paginaNaoEncontrada();

    app.innerHTML = html;
    window.scrollTo(0, 0);

    // Comparação, evolução e dinastias são páginas de análise entre temporadas:
    // acendem o item "Temporadas" do menu, que é por onde se chega nelas.
    var raiz = partes[0] || "inicio";
    if (raiz === "comparar" || raiz === "evolucao" || raiz === "dinastias") raiz = "temporadas";
    Array.prototype.forEach.call(document.querySelectorAll(".menu a"), function (a) {
      a.classList.toggle("ativo", a.dataset.rota === raiz);
    });

    ligar(["busca-clube", "filtro-secao", "filtro-tipo"], aplicarFiltrosRanking);
    ligar(["temp-agrupar", "temp-regiao", "temp-pais", "temp-estado", "temp-tipo"],
      aplicarFiltrosTemporada);
    ligar(["gal-ordem", "gal-temporada", "gal-competicao", "gal-tipo"], aplicarGaleria);
    ligar(["cmp-a", "cmp-b"], function () {
      var a = (document.getElementById("cmp-a") || {}).value;
      var b = (document.getElementById("cmp-b") || {}).value;
      var alvo = document.getElementById("comparar-alvo");
      if (alvo) alvo.innerHTML = compararHTML(parseInt(a, 10), parseInt(b, 10));
    });
    ligar(["evo-ano"], function () {
      var alvo = document.getElementById("evolucao-alvo");
      var ano = (document.getElementById("evo-ano") || {}).value;
      if (alvo) alvo.innerHTML = evolucaoHTML(parseInt(ano, 10));
    });

    // A página de temporada começa agrupada por região.
    if (document.getElementById("temporada-alvo")) aplicarFiltrosTemporada();
  }

  function ligar(ids, fn) {
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("input", fn);
    });
  }

  /* ------------------------------------------------------------- inicial */

  carregar().then(function () {
    construirIndice();
    montarBuscaGlobal();
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
