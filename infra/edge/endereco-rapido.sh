#!/usr/bin/env bash
# ENDERECO DO TUNEL TEMPORARIO (decisao 150)
#
# O tunel e' o `trycloudflare`: nao tem dominio, nem zona, nem DNS, e o endereco e' NOVO toda vez que
# o servico reinicia. Serve para entrar no addon quando o endereco do BeamUp esta com problema, sem
# mexer em DNS.
#
# O ENDERECO MUDA A CADA REINICIO. Este e o objetivo, nao um defeito.
#
# USO
#   ./infra/edge/endereco-rapido.sh          mostra o endereco atual
#   ./infra/edge/endereco-rapido.sh --json   mostra em JSON, para um script
#   ./infra/edge/endereco-rapido.sh --novo   reinicia o servico e mostra o novo endereco
#
# PARA O DONO: o addon de verdade continua no endereco do BeamUp. Use este endereco temporario para
# DIAGNOSTICAR (ver o /health, abrir o painel), nao para assistir — o relay de TV monta a URL do
# segmento a partir do endereco do pedido, entao um player aberto por aqui passa a baixar os
# segmentos pela VPS. MEDIDO: um segmento do `rei:hbo` tem 5,2 MB a cada ~5,5s, o que da 2,6 GB por
# hora por pessoa.

set -uo pipefail

SERVICO="cloudflared-rapido"

mostrar() {
  local url
  url="$(sudo journalctl -u "$SERVICO" --no-pager -n 200 2>/dev/null \
    | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)"
  if [ -z "$url" ]; then
    echo "o servico $SERVICO ainda nao subiu (ou o endereco nao apareceu no log)" >&2
    return 1
  fi
  if [ "${1:-}" = "--json" ]; then
    printf '{"url":"%s","servico":"%s","ativo":"%s"}\n' \
      "$url" "$SERVICO" "$(systemctl is-active "$SERVICO" 2>/dev/null)"
  else
    echo "$url"
  fi
}

case "${1:-}" in
  --novo)
    # Reiniciar e' como se troca o endereco: o processo novo recebe um nome novo.
    sudo systemctl restart "$SERVICO"
    for _ in $(seq 1 30); do
      sleep 2
      url="$(sudo journalctl -u "$SERVICO" --no-pager -n 200 2>/dev/null \
        | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)"
      if [ -n "$url" ]; then
        echo "$url"
        exit 0
      fi
    done
    echo "o servico subiu mas o endereco nao apareceu em 60s" >&2
    exit 1
    ;;
  --json)
    mostrar --json
    ;;
  *)
    mostrar
    ;;
esac