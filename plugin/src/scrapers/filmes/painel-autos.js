const { criaFonte } = require("../../lib/fonte-painel");

// MEDIDO 07/10/2026: este e' o MESMO painel que vivia em `4x4u29c.autos` — a comparacao
// item a item entre os dois catalogos deu 31.677 de 31.677 com `stream_id` E nome
// iguais, e o `get_vod_info` dos dois lados devolve o mesmo `tmdb_id` (1138304 para
// "Licença para Enlouquecer", id 399954). O fornecedor trocou de host e de credencial.
//
// O host antigo saiu do ar: `4x4u29c.autos` resolve (38.100.202.66) mas nao abre TCP em
// 80 nem 443 — 3 tentativas, 12 s cada, e o worker tambem leva `Upstream 403` na midia.
// Era por isso que o ATO nao entregava link nenhum na bateria: o painel da API ainda
// respondia pelo worker (12,5 MB de catalogo) enquanto o servidor de midia estava fora.
//
// No host novo a midia responde: `GET /movie/<user>/<pass>/<id>.mp4` devolve 302 para um
// CDN com token JWT, e seguindo o redirect o `Range` de 160 KB vem `206 video/mp4` com a
// resolucao real legivel (1920x1080, 1920x816 e 1920x800 em tres filmes medidos). O
// `pegar` ja segue redirect por padrao, entao o link vai direto como o resto das fontes.
//
// O namespace do indice continua `ato`: o catalogo e' o mesmo item a item, entao os
// shards publicados em `/idx/ato/` continuam valendo e nao houve o que regerar.
const PAINEL = {
  sigla: "ATO",
  idx: "ato",
  servidor: "firetvcb.net",
  porta: "80",
  // SEM DEFAULT AQUI, de proposito — ver o comentario em painel-blaze.js: a
  // credencial embutida ficou publica num repositorio PUBLICO. Fonte hoje
  // INATIVA (nao sai do `chaves()` do registro), mas o arquivo continua no git.
  get usuario() { return globalThis.MIRROR_ATO_USER; },
  get senha() { return globalThis.MIRROR_ATO_PASS; }
};

module.exports.getStreams = criaFonte(PAINEL, { catalogo: false });
