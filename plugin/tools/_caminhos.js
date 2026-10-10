// A UNICA fonte de "onde eu estou" para os CLIs de `tools/`.
//
// Os CLIs vivem um nivel abaixo de `tools/` (`medicao/`, `validacao/`, `publicacao/`).
// Montar caminho com `path.join(__dirname, "..")` aqui dentro resolve para `tools/` — que
// EXISTE — entao um erro desses nao lanca: o script le o arquivo errado e segue. Foi o que
// motivou este helper: uma raiz resolvida uma vez, num lugar so.
//
// `__dirname` aparece aqui e em nenhum outro arquivo de `tools/` — e' regra do
// `test/layout-repo.test.js`.

const path = require("path");

// `plugin/` — onde ficam `src/`, `dist/`, `config/`, `test/` e o proprio `tools/`.
const RAIZ = path.join(__dirname, "..");

// A raiz do repositorio, dois niveis acima de `plugin/`. Aqui vivem `infra/` e `docs/`,
// que o plugin nao empacota mas o time de operacao precisa alcancar a partir de um CLI.
const RAIZ_REPO = path.join(__dirname, "..", "..");

module.exports = { RAIZ, RAIZ_REPO };