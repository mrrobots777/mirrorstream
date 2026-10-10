const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);
const RAW = new Set(["script", "style", "textarea"]);
const ENTIDADES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
  "#x27": "'",
  "#160": " ",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  laquo: "\xAB",
  raquo: "\xBB",
  copy: "\xA9",
  reg: "\xAE",
  trade: "\u2122",
  deg: "\xB0",
  euro: "\u20AC",
  pound: "\xA3",
  yen: "\xA5",
  middot: "\xB7",
  bull: "\u2022",
  times: "\xD7",
  divide: "\xF7",
  plusmn: "\xB1",
  frac12: "\xBD",
  frac14: "\xBC",
  shy: "",
  zwnj: "",
  zwj: "",
  lrm: "",
  rlm: "",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  aacute: "\xE1",
  agrave: "\xE0",
  acirc: "\xE2",
  atilde: "\xE3",
  auml: "\xE4",
  aring: "\xE5",
  aelig: "\xE6",
  ccedil: "\xE7",
  eacute: "\xE9",
  egrave: "\xE8",
  ecirc: "\xEA",
  euml: "\xEB",
  iacute: "\xED",
  igrave: "\xEC",
  icirc: "\xEE",
  iuml: "\xEF",
  oacute: "\xF3",
  ograve: "\xF2",
  ocirc: "\xF4",
  otilde: "\xF5",
  ouml: "\xF6",
  oslash: "\xF8",
  uacute: "\xFA",
  ugrave: "\xF9",
  ucirc: "\xFB",
  uuml: "\xFC",
  Aacute: "\xC1",
  Agrave: "\xC0",
  Acirc: "\xC2",
  Atilde: "\xC3",
  Auml: "\xC4",
  AElig: "\xC6",
  Ccedil: "\xC7",
  Eacute: "\xC9",
  Egrave: "\xC8",
  Ecirc: "\xCA",
  Euml: "\xCB",
  Iacute: "\xCD",
  Oacute: "\xD3",
  Ocirc: "\xD4",
  Otilde: "\xD5",
  Ouml: "\xD6",
  Uacute: "\xDA",
  Uuml: "\xDC"
};
function desescapa(s) {
  if (!s || s.indexOf("&") < 0) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (todo, nome) => {
    if (ENTIDADES[nome] !== void 0) return ENTIDADES[nome];
    if (nome[0] === "#") {
      const n = nome[1] === "x" || nome[1] === "X" ? parseInt(nome.slice(2), 16) : parseInt(nome.slice(1), 10);
      if (Number.isFinite(n) && n > 0 && n <= 1114111) {
        try {
          return String.fromCodePoint(n);
        } catch (_) {
          return todo;
        }
      }
    }
    return todo;
  });
}
function elemento(name, attrs) {
  return { type: "element", name, attrs, children: [], parent: null };
}
function parseAtributos(fonte) {
  const attrs = {};
  const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>`]*)))?/g;
  let m;
  while ((m = re.exec(fonte)) !== null) {
    const nome = m[1].toLowerCase();
    if (!nome || nome === "/") continue;
    const valor = m[2] !== void 0 ? m[2] : m[3] !== void 0 ? m[3] : m[4] !== void 0 ? m[4] : "";
    if (!(nome in attrs)) attrs[nome] = desescapa(valor);
  }
  return attrs;
}
function parse(html) {
  const fonte = String(html == null ? "" : html);
  const raiz = elemento("#raiz", {});
  const pilha = [raiz];
  const topo = () => pilha[pilha.length - 1];
  const anexa = (no) => {
    const pai = topo();
    no.parent = pai;
    pai.children.push(no);
  };
  const texto = (t) => {
    if (!t) return;
    anexa({ type: "text", text: desescapa(t) });
  };
  let i = 0;
  while (i < fonte.length) {
    const lt = fonte.indexOf("<", i);
    if (lt < 0) {
      texto(fonte.slice(i));
      break;
    }
    if (lt > i) texto(fonte.slice(i, lt));
    if (fonte.startsWith("<!--", lt)) {
      const fim = fonte.indexOf("-->", lt + 4);
      i = fim < 0 ? fonte.length : fim + 3;
      continue;
    }
    if (fonte.startsWith("<!", lt) || fonte.startsWith("<?", lt)) {
      const fim = fonte.indexOf(">", lt);
      i = fim < 0 ? fonte.length : fim + 1;
      continue;
    }
    const gt = fonte.indexOf(">", lt);
    if (gt < 0) {
      texto(fonte.slice(lt));
      break;
    }
    const bruto = fonte.slice(lt + 1, gt);
    i = gt + 1;
    if (bruto[0] === "/") {
      const nome2 = bruto.slice(1).trim().toLowerCase().split(/[\s/]/)[0];
      if (!nome2) continue;
      let alvo = -1;
      for (let k = pilha.length - 1; k > 0; k--) {
        if (pilha[k].name === nome2) {
          alvo = k;
          break;
        }
      }
      if (alvo > 0) pilha.length = alvo;
      continue;
    }
    const autoFechando = bruto.endsWith("/");
    const corpo = autoFechando ? bruto.slice(0, -1) : bruto;
    const espaco = corpo.search(/[\s/]/);
    const nome = (espaco < 0 ? corpo : corpo.slice(0, espaco)).toLowerCase();
    if (!nome || !/^[a-z][a-z0-9-]*$/.test(nome)) {
      texto(`<${bruto}>`);
      continue;
    }
    const attrs = parseAtributos(espaco < 0 ? "" : corpo.slice(espaco));
    const no = elemento(nome, attrs);
    anexa(no);
    if (VOID.has(nome) || autoFechando) continue;
    if (RAW.has(nome)) {
      const fecha = new RegExp(`</${nome}\\s*>`, "i");
      const resto = fonte.slice(i);
      const achado = resto.search(fecha);
      const corpo2 = achado < 0 ? resto : resto.slice(0, achado);
      if (corpo2) no.children.push({ type: "text", text: corpo2, parent: no });
      i = achado < 0 ? fonte.length : i + achado + nome.length + 3;
      continue;
    }
    pilha.push(no);
  }
  return raiz;
}
function casaSimples(no, sel) {
  if (no.type !== "element") return false;
  if (sel === "*") return true;
  const re = /([.#]?[\w-]+)|(\[[^\]]+\])/g;
  let m;
  while ((m = re.exec(sel)) !== null) {
    const pedaco = m[0];
    if (pedaco[0] === ".") {
      if (!(no.attrs.class || "").split(/\s+/).includes(pedaco.slice(1))) return false;
    } else if (pedaco[0] === "#") {
      if (no.attrs.id !== pedaco.slice(1)) return false;
    } else if (pedaco[0] === "[") {
      const dentro = pedaco.slice(1, -1);
      const partes = dentro.match(/^\s*([\w-]+)\s*([~^$*|]?=)?\s*(.*?)\s*$/);
      if (!partes) return false;
      const nome = partes[1].toLowerCase();
      const op = partes[2] ? partes[2][0] : null;
      const alvo = desescapa(partes[3].replace(/^["']|["']$/g, ""));
      if (!(nome in no.attrs)) return false;
      if (!op) continue;
      const real = no.attrs[nome];
      if (op === "=") {
        if (real !== alvo) return false;
      } else if (op === "*=") {
        if (!real.includes(alvo)) return false;
      } else if (op === "^=") {
        if (!real.startsWith(alvo)) return false;
      } else if (op === "$=") {
        if (!real.endsWith(alvo)) return false;
      } else if (op === "~=") {
        if (!real.split(/\s+/).includes(alvo)) return false;
      } else if (!real.includes(alvo)) return false;
    } else if (pedaco !== no.name) {
      return false;
    }
  }
  return true;
}
function grupoDe(sel) {
  const passos = [];
  for (const parte of String(sel).trim().split(/\s+/)) {
    if (!parte) continue;
    if (parte === ">") {
      if (passos.length) passos[passos.length - 1][1] = true;
      continue;
    }
    passos.push([parte, false]);
  }
  return passos;
}
function bate(no, grupo) {
  const ultimo = grupo[grupo.length - 1];
  if (!casaSimples(no, ultimo[0])) return false;
  if (grupo.length === 1) return true;
  let pai = no.parent;
  for (let k = grupo.length - 2; k >= 0; k--) {
    const [sel, direto] = grupo[k];
    if (direto) {
      if (!pai || !casaSimples(pai, sel)) return false;
    } else {
      while (pai && !casaSimples(pai, sel)) pai = pai.parent;
      if (!pai) return false;
    }
    pai = pai.parent;
  }
  return true;
}
function seleciona(raiz, seletor) {
  const grupos = String(seletor || "").split(",").map(grupoDe).filter((g) => g.length);
  if (!grupos.length) return [];
  const achados = [];
  const anda = (no) => {
    for (const filho of no.children) {
      if (filho.type !== "element") continue;
      if (grupos.some((g) => bate(filho, g))) achados.push(filho);
      anda(filho);
    }
  };
  anda(raiz.type === "element" ? raiz : raiz);
  return achados;
}
function um(raiz, seletor) {
  const achados = seleciona(raiz, seletor);
  return achados.length ? achados[0] : null;
}
function textoDe(no) {
  if (!no) return "";
  if (no.type === "text") return no.text;
  let s = "";
  for (const filho of no.children) s += textoDe(filho);
  return s;
}
function atributosDe(no, seletor) {
  return seleciona(no, seletor).map((x) => x.attrs);
}
module.exports = { parse, seleciona, um, textoDe, atributosDe, desescapa };
