// MEDIDO 07/10/2026: o `parseMpegTs` de `src/lib/video-probe.js` devolvia `null` num
// segmento MPEG-TS que a origem entregou com 200 — a fonte saia sem `quality` e o Nuvio
// escrevia "Desconhecido" na linha 1. Nao era bloqueio, nem link morto: eram tres erros
// de leitura do container.
//
// 1. `section_length` era lido em `payload[1..2]`. O payload de um pacote PSI tem o
//    `pointer_field` ANTES da section: `[0]` ponteiro, `[1]` `table_id`, `[2..3]`
//    `section_length`. No segmento real do DGO, `[1..2]` dava 176 e o verdadeiro dava 13 —
//    a varredura do PAT andava dentro do preenchimento `0xff`, o `pmt_pid` saia errado e o
//    PMT nunca era aberto.
// 2. O `program_info_length` do PMT tinha o mesmo deslocamento, e `stream_type` 0x02
//    (MPEG-2) nao era reconhecido como video. O DGO entrega MPEG-2.
// 3. `assembleVideoStream` montava a stream com SO os pacotes cujo payload COMECA com
//    start code e descartava os de continuacao. No segmento do DGO, 905 dos 958 pacotes do
//    pid de video eram descartados: 9 KB em vez de 173 KB, e o SPS estava nos perdidos.
//
// Os tres juntos faziam `parseMpegTs` devolver `null` em fonte que responde. Este arquivo
// trava a correcao com segmentos montados aqui — sem rede, sem depender de origem viva.

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseMpegTs, detectResolution } = require("../src/lib/video-probe");

// Monta um pacote TS de 188 bytes. Cabecalho: 4 bytes fixos + 1 byte de
// `adaptation_field_length` + o adaptation field + o payload. Um payload de 184 bytes
// (o PSI) ocupa o pacote inteiro, sem adaptation field — por isso `adaptation_control`
// vale 1 (payload so). Um payload menor deixa espaco, e o adaptation field esse espaco
// com `0xff`, como as origens medidas fazem.
function pacote(pid, payload, pusi = false, fill = false) {
  const p = new Uint8Array(188);
  p[0] = 0x47;
  p[1] = ((pusi ? 0x40 : 0) | ((pid >> 8) & 0x1f)) & 0xff;
  p[2] = pid & 0xff;
  const sobra = 188 - 4 - payload.length;
  const adaptation = sobra >= 1 ? sobra - 1 : 0;
  p[3] = (((adaptation > 0 ? 0x03 : 0x01) << 4) & 0xf0);
  let cursor = 4;
  if (adaptation > 0) {
    p[4] = adaptation;
    cursor = 5 + adaptation;
  }
  p.set(payload, cursor);
  if (fill) for (let i = cursor + payload.length; i < 188; i++) p[i] = 0xff;
  return p;
}

function concat(partes) {
  const total = partes.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of partes) { out.set(p, o); o += p.length; }
  return out;
}

// PSI: `pointer_field` + secao. O `section_length` conta o que vem DEPOIS dele — o
// `transport_stream_id`, os numeros de secao, as entradas e o CRC32 de 4 bytes no fim.
// Sem o CRC a contagem sai curta e a varredura de `parseMpegTs` (`end = 3 + section_length`)
// para antes da primeira entrada: e' o que a fixture precisa acertar para parecer com a
// origem. MEDIDO no PAT real do DGO: `section_length` 13 = 2 (tsid) + 3 (version e
// numeros) + 4 (entrada) + 4 (CRC).
const CRC_PSI = 4;

function psi(tableId, corpo) {
  // O payload PSI ocupa o pacote INTEIRO (184 bytes): a origem preenche o resto com
  // `0xff` depois da secao. E' essa forma que o pacote precisa ter — uma secao curta
  // sem preenchimento nao caberia em 188 bytes e o `set` truncaria o fim do
  // `pmt_pid`, que e' justamente o campo lido.
  const sec = new Uint8Array(184).fill(0xff);
  sec[0] = 0x00;                    // pointer_field
  sec[1] = tableId;
  const tamanho = corpo.length + CRC_PSI;
  sec[2] = 0xb0 | ((tamanho >> 8) & 0x0f);
  sec[3] = tamanho & 0xff;
  sec.set(corpo, 4);
  return sec;
}

function pat(pmtPid) {
  return psi(0x00, new Uint8Array([
    0x00, 0x01,                       // transport_stream_id
    0xc1, 0x00, 0x00,                 // version / section_number / last_section_number
    0x00, 0x01, 0xe0 | ((pmtPid >> 8) & 0x1f), pmtPid & 0xff
  ]));
}

function pmt(videoPid, streamType, programInfoLength = 0) {
  const desc = new Uint8Array(programInfoLength).fill(0xff);
  const es = new Uint8Array([
    streamType, 0xe0 | ((videoPid >> 8) & 0x1f), videoPid & 0xff, 0xf0, 0x00
  ]);
  return psi(0x02, new Uint8Array([
    0x00, 0x01,                       // program_number
    0xc1, 0x00, 0x00,                 // version / section_number / last_section_number
    0xe0 | ((0x100 >> 8) & 0x1f), 0x00,   // PCR_PID
    0xf0 | ((programInfoLength >> 8) & 0x0f), programInfoLength & 0xff,
    ...desc, ...es
  ]));
}

// H.264 SPS minimo e valido. `profile_idc` 66 (baseline) NAO entra na lista de perfis
// com `chroma_format_idc`, entao o SPS cabe no caminho curto e o RBSP pode ser escrito
// inteiro aqui. As dimensoes precisam ser multiplas de 16 — o que o parser le e'
// `pic_width_in_mbs_minus1`/`pic_height_in_map_units_minus1`, sem `frame_cropping_flag`
// para recortar: 1920x1080 leria 1920x1072, entao os casos usam alturas multiplas de 16.
function spsH264(width, height) {
  const rbsp = new Uint8Array(16);
  let r = 0;
  const bit = (v) => { rbsp[r >> 3] |= (v & 1) << (7 - (r & 7)); r += 1; };
  const bits = (v, n) => { for (let i = n - 1; i >= 0; i--) bit((v >> i) & 1); };
  const ue = (v) => { const n = v + 1; const len = Math.floor(Math.log2(n)); bits(0, len); bits(n, len + 1); };
  // O byte `0x67` e' o CABECALHO do NAL (`forbidden_zero_bit` + `nal_ref_idc` +
// `nal_unit_type` 7) e fica logo depois do start code — `spsFromStream` casa o
// prefixo, le o tipo em `i + 3` e entrega a `parseSps` os bytes a partir de `i + 4`,
// que ja sao o RBSP. Por isso `0x67` entra aqui como byte do prefixo e NAO como
// primeiro byte do RBSP.
const cab = new Uint8Array([0, 0, 1, 0x67]);
  bits(66, 8);     // profile_idc baseline
  bits(0x00, 8);   // constraint_set flags + reserved_zero_2bits
  bits(0x0a, 8);   // level_idc 1.0 — `parseSps` le profile, constraints e level como
                   // tres bytes separados; faltar um deles desalinha todo o resto
  ue(0);           // seq_parameter_set_id
  ue(0);           // log2_max_frame_num_minus4
  ue(2);           // pic_order_cnt_type
  ue(1);           // max_num_ref_frames
  bit(0);          // gaps_in_frame_num_value_allowed_flag
  ue(width / 16 - 1);
  ue(height / 16 - 1);
  bit(1);          // frame_mbs_only_flag
  // O RBSP ocupa o resto do buffer mesmo depois do ultimo campo lido: numa origem real
  // ele continua com `rbsp_trailing_bits`, o slice seguinte e o que fecha o NAL. Sem
  // essa folga o `BitReader` de `parseSps` chega ao fim dos bytes nos ultimos bits de
  // `frame_mbs_only_flag` e lanca `sps: fim dos dados` — o parse falha por falta de
  // byte, nao por campo errado. 16 bytes cobrem o SPS mais o que o leitor consome.
  return new Uint8Array([...cab, ...rbsp]);
}

// MPEG-2: cabecalho de sequencia `00 00 01 B3` com 12 bits de largura e 12 de altura.
function sequenciaMpeg2(width, height) {
  return new Uint8Array([
    0x00, 0x00, 0x01, 0xb3,
    ((width >> 4) & 0xff), (((width & 0x0f) << 4) | ((height >> 8) & 0x0f)), height & 0xff,
    0x23, 0xff, 0xff, 0xe0
  ]);
}

// Segmento com N pacotes do pid de video. O primeiro traz o cabecalho de video (o
// `nals` que a passagem precisa encontrar) e os outros sao continuacao — que e'
// exatamente o que a versao anterior descartava.
//
// O preenchimento e' `0xaa`, e nao `0x00`: `0x00 0x00 0x01` e' o start code, entao
// bytes zero fabricatingo NALs onde nao existe nenhum. Depois do `nals` vai um start code
// de fatia (`0x65`), como numa origem de verdade: e ele que fecha o NAL do SPS na varredura.
function segmento({ videoPid, pmtPid, streamType, nals, pacotesDeVideo }) {
  const partes = [];
  partes.push(pacote(0, pat(pmtPid), true, true));
  partes.push(pacote(pmtPid, pmt(videoPid, streamType), false, true));
  const pedaco = 184;
  for (let i = 0; i < pacotesDeVideo; i++) {
    partes.push(pacote(videoPid, new Uint8Array(pedaco).fill(0xaa), i === 0, true));
  }
  const primeiro = partes[2];
  primeiro.set(nals, 4);
  primeiro.set([0x00, 0x00, 0x01, 0x65], 4 + nals.length);
  return concat(partes);
}

test("parseMpegTs le a resolucao de um segmento H.264 pelo PAT e pelo PMT corretos", () => {
  const bytes = segmento({
    videoPid: 256, pmtPid: 4096, streamType: 0x1b,
    nals: spsH264(1280, 720), pacotesDeVideo: 40
  });
  assert.deepEqual(parseMpegTs(bytes), { width: 1280, height: 720 });
  assert.deepEqual(detectResolution(bytes), { width: 1280, height: 720 });
});

test("o section_length do PAT e' lido depois do pointer_field (MEDIDO: 176 vs 13)", () => {
  // Com o payload real do DGO (`pointer 00 | 00 b0 0d`), ler em [1..2] daria 176.
  // Um `section_length` certo mantem o caminho andando pelos bytes certos.
  const bytes = segmento({
    videoPid: 256, pmtPid: 4096, streamType: 0x1b,
    nals: spsH264(1920, 1088), pacotesDeVideo: 40
  });
  const patPacket = bytes.slice(0, 188);
  assert.equal(patPacket[4], 0x00, "pointer_field");
  assert.equal(patPacket[5], 0x00, "table_id do PAT");
  assert.equal(((patPacket[6] & 0x0f) << 8) | patPacket[7], 13, "section_length verdadeiro");
  assert.equal(((patPacket[5] & 0x0f) << 8) | patPacket[6], 0xb0, "leitura no offset errado");
  assert.deepEqual(parseMpegTs(bytes), { width: 1920, height: 1088 });
});

test("o program_info_length do PMT nao e' lido no offset do PAT (MEDIDO: 240 vs 0)", () => {
  // Descritores de programa antes dos streams: sem o offset certo, a varredura de
  // `stream_type` anda por cima deles e nao acha video nenhum.
  const comDescritor = segmento({
    videoPid: 256, pmtPid: 4096, streamType: 0x1b,
    nals: spsH264(1280, 720), pacotesDeVideo: 40
  });
  const semDescritor = segmento({
    videoPid: 256, pmtPid: 4096, streamType: 0x1b,
    nals: spsH264(1280, 720), pacotesDeVideo: 40
  });
  assert.deepEqual(parseMpegTs(comDescritor), parseMpegTs(semDescritor));
});

test("stream_type 0x02 (MPEG-2) e' reconhecido como video — e' o que o DGO entrega", () => {
  const bytes = segmento({
    videoPid: 256, pmtPid: 4096, streamType: 0x02,
    nals: sequenciaMpeg2(640, 480), pacotesDeVideo: 40
  });
  assert.deepEqual(parseMpegTs(bytes), { width: 640, height: 480 });
});

test("os pacotes de CONTINUACAO entram na stream (905 de 958 foram descartados no DGO)", () => {
  // 8 e 200 pacotes de video: a versao anterior montava a stream so com os pacotes
  // cujo payload COMECA com start code, o que deixava a leitura depender de o SPS cair
  // (ou nao) na fronteira de um pacote. Aqui a resolucao tem de ser a mesma nos dois.
  const comPoucos = segmento({
    videoPid: 256, pmtPid: 4096, streamType: 0x1b,
    nals: spsH264(1280, 720), pacotesDeVideo: 8
  });
  const comMuitos = segmento({
    videoPid: 256, pmtPid: 4096, streamType: 0x1b,
    nals: spsH264(1280, 720), pacotesDeVideo: 200
  });
  assert.deepEqual(parseMpegTs(comPoucos), { width: 1280, height: 720 });
  assert.deepEqual(parseMpegTs(comMuitos), parseMpegTs(comPoucos));
});

test("uma resolucao abaixo de 320x180 e' rejeitada — o SPS lixo do DGO dava 32x16", () => {
  const bytes = segmento({
    videoPid: 256, pmtPid: 4096, streamType: 0x1b,
    nals: spsH264(32, 16), pacotesDeVideo: 40
  });
  assert.equal(parseMpegTs(bytes), null, "32x16 nao vira 'quality'");
});

test("sem PAT legivel a varredura cai para os pids do segmento, sem inventar pid", () => {
  // Sem PAT nao ha `pmt_pid`, entao `parseMpegTs` varre os pids presentes. Aqui o
  // unico pid com payload e' o de video, e ele traz o SPS: a resposta tem de ser a
  // resolucao real, nao um erro por falta de PAT nem um pid adivinhado.
  const partes = [pacote(256, new Uint8Array(184).fill(0xaa), true, true)];
  for (let i = 0; i < 30; i++) partes.push(pacote(256, new Uint8Array(184).fill(i & 0xff), false, true));
  partes[0].set(spsH264(1280, 720), 4);
  assert.deepEqual(parseMpegTs(concat(partes)), { width: 1280, height: 720 });
});

test("um segmento sem nenhum start code devolve null", () => {
  // So' o piso: a origem respondeu, mas nao veio quadro. `null` e' a resposta honesta —
  // `qualifica` marca `sem-video` e a linha 1 do app repete o que ela ja escrevia.
  const partes = [];
  for (let i = 0; i < 40; i++) partes.push(pacote(256, new Uint8Array(184).fill(0xaa), i === 0, true));
  assert.equal(parseMpegTs(concat(partes)), null);
});