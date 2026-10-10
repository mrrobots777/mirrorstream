const { criaFonte, catalogoGzip } = require("../../lib/fonte-painel");

// Credenciais/defaults sao os MESMOS de `src/scrapers/xtream.js` no repo do Mirror
// (painel "Blaze"). `node tools/publicacao/gerar-indice.js` compara este bloco com o do addon
// e falha alto se divergirem — nao edite aqui sem editar la.
const PAINEL = {
  sigla: "BLZ",
  idx: "blz",
  servidor: "kakito.xyz",
  porta: "443",
  // SEM DEFAULT AQUI, de proposito. A credencial que vivia embutida nestes dois
  // getters ficou publica no GitHub de 02/10 a 10/10 — o repo e' PUBLICO e
  // qualquer um lia a senha do painel. (O valor nao e' repetido aqui de
  // proposito: comentario em repo publico vaza igual.)
  //
  // A credencial agora vive so' no ambiente do gateway (`beamup secrets
  // MIRROR_BLZ_USER/PASS`, que `gateway/config.js -> carregaEnv()` copia para
  // `globalThis`). Sem o segredo definido, `undefined` vai para a URL do painel,
  // o `player_api.php` recusa e a fonte devolve `[]` com o motivo no log.
  // Falhar alto e' melhor que autenticar com senha que esta' num repo publico.
  get usuario() { return globalThis.MIRROR_BLZ_USER; },
  get senha() { return globalThis.MIRROR_BLZ_PASS; }
};

// O catalogo e so de FILME (`get_vod_streams`). Serie vem do shard do indice — o catalogo
// de serie do blz (`get_series`) tem 4,25 MB e nao traria nada que o shard nao traga.
const CATALOGO_FILME = `${PAINEL.porta === "80" ? "http" : "https"}://${PAINEL.servidor}:${PAINEL.porta}/player_api.php?username=${encodeURIComponent(PAINEL.usuario)}&password=${encodeURIComponent(PAINEL.senha)}&action=get_vod_streams`;

// MEDIDO 01/10/2026 deste servidor: o catalogo inteiro do painel tem 4,77 MB decodificado e
// ~780 KB com `Accept-Encoding: gzip` (3 rodadas: 782.283 / 775.861 / 781.820 B).
// Os paineis ignoram `Range` e `search`, entao nao ha paginacao nem busca.
//
// O runtime do plugin corta o corpo em 1 MB (512 KB na quota `limited`). Isso entra:
//
//   - `auto` (PADRAO) — o shard do indice e o caminho que entrega. O catalogo gzipado e
//     buscado EM PARALELO, sem esperar: se vier inteiro e parsear, ele e mais fresco e
//     wins; se vier cortado (que e o caso provavel, porque o corte e sobre o corpo
//     DECODIFICADO), o shard assume e o catalogo e descartado sem erro.
//   - `nunca` — so o shard. Nenhum byte de catalogo.
//   - `sempre` — so o catalogo (so funciona se o limite contar bytes comprimidos).
//
// Custo do modo `auto` no pior caso: 4,77 MB de download por consulta que nao vai usar.
// Em 4G isso e caro; em WiFi e 2,5 s. O modo `auto` existe porque NAO DA PARA TESTAR DAQUI
// se o limite do runtime conta bytes comprimidos ou decodificados — e o dono decide
// olhando o consumo. Ver `public/PLANO-PUBLICACAO.md`.
function modoDoCatalogo() {
  const bruto = globalThis.MIRROR_BLZ_CATALOGO;
  const v = bruto === null || bruto === void 0 ? "auto" : String(bruto).trim().toLowerCase();
  return ["auto", "nunca", "sempre"].includes(v) ? v : "auto";
}

const base = criaFonte(PAINEL, { calado: false });

async function getStreams(tmdbId, mediaType, season, episode) {
  const modo = modoDoCatalogo();
  const estado = {};
  const eSerie = String(mediaType || "").toLowerCase() === "tv";
  if (modo !== "nunca" && !eSerie) {
    const tarefa = catalogoGzip(PAINEL);
    estado.catalogo = tarefa.then(
      (r) => {
        if (r && r.motivo) console.log(`[BLZ] catalogo gzip nao entregou: ${r.motivo} — o shard do indice assume`);
        return r;
      },
      (e) => {
        console.log(`[BLZ] catalogo gzip falhou: ${e && e.message ? e.message : e} — o shard do indice assume`);
        return null;
      }
    );
  }
  return base(tmdbId, mediaType, season, episode, estado);
}

module.exports.getStreams = getStreams;
module.exports.modoDoCatalogo = modoDoCatalogo;
module.exports.CATALOGO = CATALOGO_FILME;
