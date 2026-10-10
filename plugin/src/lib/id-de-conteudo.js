// NORMALIZACAO DO ID DE CONTEUDO — o ponto por onde passa o id que o Nuvio entrega.
//
// MEDIDO 02/10/2026 (a origem do defeito): o dono definiu que o MirrorStream NAO tem catalogo —
// ele e' chamado quando o usuario abre um vod do **Cinemeta**, e as fontes sao buscadas por IMDb.
// O id que chega em `getStreams` e' entao `tt0133093`, nao `603`.
//
// As 7 fontes de VOD tinham o mesmo `idDe()`, e ele fazia:
//
//     valor.replace(/^tmdb:/i, "").replace(/:\d+:\d+$/, "").replace(/[^0-9]/g, "")
//
// Para `tt0133093` isso devolve `0133093` — que o TMDB resolve como **"Strings" (2012)**, nao
// "The Matrix". A fonte buscava o catalogo do filme errado, o portao de correspondencia
// (`portao-correspondencia.js`) reprovava tudo, e ela devolvia `[]` **sem lancar erro** — que o
// Nuvio le como "esta fonte nao tem este titulo". Medido antes/depois, no mesmo instante:
//
//     SPT  tt0133093 -> 0   603 -> 1        RTD  tt0133093 -> 0   603 -> 1
//     VZR  tt0133093 -> 0   603 -> 1        BLZ  tt0133093 -> 0   603 -> 1
//     SPC  tt0133093 -> 0   603 -> 2
//
// E o log do BLZ dizia o defeito inteiro numa linha, sem ninguem ler:
//
//     [BLZ] 1584 item(s) lidos, nenhum casa com "Strings" — [] de proposito
//
// A REGRA DESTE MODULO: um id so' vira id de TMDB se ele JA' for id de TMDB. IMDb
// (`tt` + 7 digitos) e' reconhecido e devolvido como `null`, porque quem converte IMDb -> TMDB e'
// o `tmdb.js`, por `find/{external_source=imdb_id}` (medido: `tt0133093` -> 603,
// `tt0903747` -> 1396). Nenhuma fonte faz essa conversao por conta propria: sao 7 lugares
// fazendo a mesma coisa, e cada um erra de um jeito.

// O prefixo do id do Cinemeta: `tt` + digitos. Com o sufixo de serie (`tt0903747:1:1`) o
// `tt` continua no comeco.
//
// MEDIDO 02/10/2026: a PRIMEIRA versao deste regex era `^tt\d{7}$` — "tt mais 7 digitos",
// que e' o formato classico. Falha em `tt13274038` ("Beleza Verdadeira"), que tem **8**: o
// `pareceImdb` dava false, nenhuma ida ao TMDB acontecia, e `tmdbIdDe` devolvia `null` em
// ~2 ms. O sintoma era IDENTICO ao do defeito original (fonte devolve `[]`, o Nuvio le
// "nenhuma fonte") com outra causa — por isso o numero de digitos nao pode ser literal aqui.
//
// O intervalo e' de 7 (o classico, `tt0133093`) a 10 (o maximo que o IMDb emite hoje).
// Fixar 7 funciona ate o proximo id de 8 digitos aparecer, e o proximo ja apareceu.
const IMDB = /^tt\d{7,10}(?::\d+:\d+)?$/i;

// `603`, `tmdb:603`. O `tmdb:` e' o prefixo que o proprio app usa para os ids que ELE resolveu.
const TMDB = /^(?:tmdb:)?(\d+)$/i;

function limpa(valor) {
  return String(valor == null ? "" : valor).trim();
}

/** O id e' do Cinemeta/IMDb? (o caso que o dono definiu como o caminho real) */
function pareceImdb(valor) {
  return IMDB.test(limpa(valor));
}

/** O id e' de TMDB, com ou sem o prefixo `tmdb:`? */
function pareceTmdb(valor) {
  return TMDB.test(limpa(valor));
}

/**
 * Devolve o id de TMDB (string de digitos), ou `null`.
 *
 * `null` significa "isto nao e' um id de TMDB" — e NAO e' erro nem "a fonte nao tem o
 * titulo". Quem chama decide: as fontes que sabem resolver IMDb passam por `tmdb.js` primeiro;
 * as que nao sabem, devolvem `[]`.
 */
function idDe(valor) {
  const bruto = limpa(valor);
  const semSufixo = bruto.replace(/:\d+:\d+$/, "");
  const m = semSufixo.match(TMDB);
  return m ? m[1] : null;
}

module.exports = { idDe, pareceImdb, pareceTmdb, IMDB, TMDB };