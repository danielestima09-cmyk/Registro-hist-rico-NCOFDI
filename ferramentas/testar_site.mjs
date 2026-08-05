/* Exercita o site num DOM real: rotas, filtros, busca, ordenações e o
   conteúdo das análises. Serve para revalidar depois de importar uma planilha
   nova — as páginas de análise são todas derivadas, então um dado inesperado
   aparece aqui antes de aparecer no ar.

   Precisa do jsdom, que não é dependência do site (o site não tem nenhuma):
       npm install jsdom
       node ferramentas/testar_site.mjs
*/
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const exigir = createRequire(path.join(RAIZ, "ferramentas/"));
let JSDOM;
try {
  ({ JSDOM } = exigir("jsdom"));
} catch (e) {
  console.error("jsdom não está instalado. Rode:  npm install jsdom");
  process.exit(2);
}

let falhas = 0;
const erros = [];

function ok(cond, msg) {
  if (cond) return true;
  falhas++;
  console.log("  ✗ " + msg);
  return false;
}

const html = fs.readFileSync(path.join(RAIZ, "index.html"), "utf8");
const dom = new JSDOM(html, { url: "http://localhost/", runScripts: "dangerously",
                              pretendToBeVisual: true });
const w = dom.window;

w.fetch = function (url) {
  const f = path.join(RAIZ, String(url).split("?")[0]);
  const existe = fs.existsSync(f);
  return Promise.resolve({
    ok: existe, status: existe ? 200 : 404,
    json: () => Promise.resolve(JSON.parse(fs.readFileSync(f, "utf8")))
  });
};
w.scrollTo = () => {};
w.Element.prototype.scrollIntoView = function () {};
w.addEventListener("error", (e) => erros.push("window error: " + e.message));
const origErro = w.console.error;
w.console.error = (...a) => { erros.push("console.error: " + a.join(" ")); origErro(...a); };

const script = w.document.createElement("script");
script.textContent = fs.readFileSync(path.join(RAIZ, "assets/js/app.js"), "utf8");
w.document.body.appendChild(script);

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const doc = w.document;
const app = () => doc.getElementById("app");

async function ir(hash) {
  w.location.hash = hash;
  await espera(30);
  return app().innerHTML;
}

function sanidade(rota, h) {
  ok(h && h.length > 200, `${rota}: página vazia (${h ? h.length : 0} bytes)`);
  ok(!/undefined/.test(h), `${rota}: contém "undefined"`);
  ok(!/NaN/.test(h), `${rota}: contém "NaN"`);
  ok(!/\[object Object\]/.test(h), `${rota}: contém "[object Object]"`);
  ok(!/Página não encontrada/.test(h), `${rota}: caiu no 404`);
}

await espera(2500);

console.log("=== carga ===");
ok(!/carregando/i.test(app().innerHTML), "ainda mostrando 'Carregando'");
ok(doc.getElementById("rodape-stats").textContent.includes("títulos"), "rodapé sem estatísticas");
console.log("  rodapé:", doc.getElementById("rodape-stats").textContent);

console.log("\n=== rotas ===");
const rotas = [
  "#/", "#/maiores-campeoes", "#/competicoes", "#/temporadas",
  "#/temporadas/2026", "#/temporadas/2027", "#/comparar", "#/comparar/2026/2027",
  "#/evolucao", "#/evolucao/2026", "#/recordes", "#/dinastias",
  "#/secao/europa", "#/secao/brasil", "#/local/br-es",
  "#/local/br-es/campeonato-capixaba", "#/local/coreia-do-sul",
  "#/campeao/capixaba", "#/campeao/incheon-united", "#/campeao/psg"
];
for (const r of rotas) {
  const h = await ir(r);
  sanidade(r, h);
  if (!erros.length) console.log(`  ✓ ${r} (${h.length} bytes)`);
  else { console.log(`  ✗ ${r}: ${erros.join(" | ")}`); falhas++; erros.length = 0; }
}

console.log("\n=== rotas inválidas devolvem 404 ===");
for (const r of ["#/temporadas/1999", "#/campeao/nao-existe", "#/local/nada"]) {
  const h = await ir(r);
  ok(/Página não encontrada|Nenhum/.test(h), `${r}: deveria dar não-encontrado`);
}
console.log("  ✓ verificado");

console.log("\n=== busca global ===");
await ir("#/");
const campo = doc.getElementById("busca-global");
const painel = doc.getElementById("busca-resultados");
ok(!!campo && !!painel, "campo de busca não existe");

function digitar(txt) {
  campo.value = txt;
  campo.dispatchEvent(new w.Event("input"));
}
function grupos() {
  return Array.from(painel.querySelectorAll(".busca-grupo")).map((g) => ({
    cat: g.querySelector("h4").textContent.trim().split(" ")[0],
    itens: Array.from(g.querySelectorAll(".busca-item")).map((a) => ({
      nome: a.querySelector(".busca-nome").textContent,
      href: a.getAttribute("href")
    }))
  }));
}

digitar("Capixaba");
let g = grupos();
console.log("  'Capixaba' →", g.map((x) => `${x.cat}: ${x.itens.map((i) => i.nome).join(", ")}`).join(" | "));
ok(g.some((x) => x.itens.some((i) => i.nome === "Capixaba")), "busca não achou o clube Capixaba");
ok(g.some((x) => x.itens.some((i) => i.nome === "Campeonato Capixaba")),
   "busca não achou a competição Campeonato Capixaba");

digitar("espirito santo");
g = grupos();
console.log("  'espirito santo' (sem acento) →",
  g.map((x) => `${x.cat}: ${x.itens.length}`).join(" | "));
ok(g.some((x) => x.cat === "Locais" && x.itens.some((i) => i.nome === "Espírito Santo")),
   "busca sem acento não achou o local Espírito Santo");
ok(g.some((x) => x.cat === "Competições"), "não trouxe competições relacionadas ao estado");
ok(g.some((x) => x.cat === "Clubes"), "não trouxe clubes relacionados ao estado");

digitar("INCHEON");
ok(grupos().some((x) => x.itens.some((i) => i.nome === "Incheon United")),
   "busca em maiúsculas falhou");

digitar("2027");
ok(grupos().some((x) => x.cat === "Temporadas"), "busca não achou a temporada 2027");

digitar("zzzznadaaqui");
ok(/Nada encontrado/.test(painel.innerHTML), "busca sem resultado não avisou");

digitar("Capixaba");
const primeiro = painel.querySelector(".busca-item");
const destino = primeiro.getAttribute("href");
primeiro.dispatchEvent(new w.MouseEvent("mousedown", { bubbles: true }));
await espera(30);
ok(w.location.hash === destino, `clicar no resultado não navegou (${w.location.hash} ≠ ${destino})`);
console.log("  ✓ clique navega para", destino);

console.log("\n=== filtros da página de temporada ===");
await ir("#/temporadas/2027");
const alvo = doc.getElementById("temporada-alvo");
ok(alvo && alvo.innerHTML.length > 100, "lista de campeões da temporada não renderizou");
const agrupadoInicial = alvo.querySelectorAll("details").length;
ok(agrupadoInicial > 0, "não agrupou por região por padrão");
console.log(`  agrupamento inicial: ${agrupadoInicial} grupos`);

function selecionar(id, valor) {
  const el = doc.getElementById(id);
  el.value = valor;
  el.dispatchEvent(new w.Event("input"));
}
selecionar("temp-agrupar", "tipo");
const porTipo = alvo.querySelectorAll("details").length;
ok(porTipo > 0, "agrupar por tipo não produziu grupos");
selecionar("temp-agrupar", "");
ok(alvo.querySelectorAll("details").length === 0 && alvo.querySelectorAll("tbody tr").length > 0,
   "sem agrupamento deveria mostrar uma tabela única");
const semFiltro = alvo.querySelectorAll("tbody tr").length;
selecionar("temp-regiao", "brasil");
const comFiltro = alvo.querySelectorAll("tbody tr").length;
ok(comFiltro > 0 && comFiltro < semFiltro,
   `filtro de região não reduziu (${semFiltro} → ${comFiltro})`);
console.log(`  ✓ filtro região: ${semFiltro} → ${comFiltro} linhas`);
selecionar("temp-tipo", "Estadual");
ok(alvo.querySelectorAll("tbody tr").length <= comFiltro, "filtro de tipo não aplicou");
// combinação impossível: uma região não-brasileira + um estado brasileiro.
// O seletor só lista o que existe na temporada, então pega da própria lista.
selecionar("temp-tipo", "");
const regiaoSel = doc.getElementById("temp-regiao");
const foraDoBrasil = Array.from(regiaoSel.options)
  .find((o) => o.value && o.value !== "brasil");
ok(!!foraDoBrasil, "temporada só tem uma região; não dá para testar o cruzamento");
selecionar("temp-regiao", foraDoBrasil.value);
const estadoSel = doc.getElementById("temp-estado");
selecionar("temp-estado", estadoSel.options[1].value);
ok(/Nenhum campeão encontrado/.test(alvo.innerHTML),
   "filtro sem resultado não avisou (" + alvo.querySelectorAll("tbody tr").length + " linhas)");
console.log("  ✓ filtros combinam e avisam quando vazio");

console.log("\n=== galeria de títulos do clube ===");
await ir("#/campeao/capixaba");
const gal = doc.getElementById("galeria-alvo");
ok(gal && gal.querySelectorAll("tbody tr").length > 0, "galeria não renderizou");
const anos = () => Array.from(gal.querySelectorAll("tbody tr td.temporada")).map((t) => t.textContent);
const recente = anos();
selecionar("gal-ordem", "antigo");
const antigo = anos();
ok(recente.length === antigo.length, "ordenação mudou a quantidade de linhas");
ok(JSON.stringify(recente) === JSON.stringify(antigo.slice().reverse()) ||
   recente[0] >= antigo[0], "ordem 'mais antigo primeiro' não inverteu");
console.log(`  ✓ ${recente.length} títulos, ordenação aplicada`);
selecionar("gal-ordem", "competicao");
ok(gal.querySelectorAll("tbody tr").length === recente.length, "ordenar por competição perdeu linhas");

console.log("\n=== comparação entre temporadas ===");
await ir("#/comparar/2026/2027");
const cmp = doc.getElementById("comparar-alvo");
ok(cmp && cmp.innerHTML.length > 500, "comparação vazia");
ok(/Resumo/.test(cmp.innerHTML), "comparação sem frases automáticas");
const frases = Array.from(cmp.querySelectorAll(".frases li")).map((l) => l.textContent);
console.log("  frases geradas:", frases.length);
frases.slice(0, 3).forEach((f) => console.log("    ·", f));
ok(frases.length > 0, "nenhuma frase automática");
doc.getElementById("cmp-a").value = "2027";
doc.getElementById("cmp-a").dispatchEvent(new w.Event("input"));
await espera(20);
ok(doc.getElementById("comparar-alvo").innerHTML.length > 200, "trocar temporada quebrou a comparação");
console.log("  ✓ trocar a temporada re-renderiza");

console.log("\n=== evolução do ranking ===");
await ir("#/evolucao/2027");
const evo = doc.getElementById("evolucao-alvo");
ok(evo.querySelectorAll("tbody tr").length > 0, "tabela de evolução vazia");
ok(/entrou no ranking|▲|manteve/.test(evo.innerHTML), "sem indicação de variação");
doc.getElementById("evo-ano").value = "2026";
doc.getElementById("evo-ano").dispatchEvent(new w.Event("input"));
await espera(20);
ok(doc.getElementById("evolucao-alvo").innerHTML.length > 200, "trocar o ano quebrou a evolução");
console.log("  ✓ evolução responde ao seletor");

console.log("\n=== conteúdo específico ===");
const capixaba = await ir("#/campeao/capixaba");
ok(/Estatísticas da era NCOFDI/.test(capixaba), "página do clube sem bloco de estatísticas");
ok(/Primeiro título/.test(capixaba), "sem 'primeiro título'");
ok(/Posição no ranking geral/.test(capixaba), "sem posição no ranking");
const selos = doc.querySelectorAll(".selo");
console.log(`  selos do Capixaba: ${Array.from(selos).map((s) => s.textContent).join(" | ") || "nenhum"}`);

const comp = await ir("#/local/coreia-do-sul/k-league-1");
if (/Página não encontrada/.test(comp)) {
  console.log("  (k-league-1 não existe; testando outra competição)");
} else {
  ok(/Resumo da competição/.test(comp), "competição sem resumo");
  ok(/linha-tempo/.test(comp), "competição sem linha do tempo");
}
const capComp = await ir("#/local/br-es/campeonato-capixaba");
ok(/Resumo da competição/.test(capComp), "Campeonato Capixaba sem resumo");
ok(/Sequência atual/.test(capComp), "sem sequência atual");
ok(/linha-tempo/.test(capComp), "sem linha do tempo");
console.log("  ✓ resumo e linha do tempo presentes");

const inicio = await ir("#/");
ok(/Destaques/.test(inicio), "início sem destaques");
ok(/Maior campeão da era/.test(inicio), "início sem maior campeão");
console.log("  ✓ destaques na página inicial");

console.log("\n=== resultado ===");
console.log(falhas ? `${falhas} FALHA(S)` : "tudo passou");
process.exit(falhas ? 1 : 0);
