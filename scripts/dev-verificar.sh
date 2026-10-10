#!/usr/bin/env bash
# Verificación de punta a punta (Fase 7 del plan): levanta todo desde cero, dispara una corrida
# y comprueba salud, datos en la BD, feedback y métricas. Uso: scripts/dev-verificar.sh [--keep]
#   --keep   no borra los volúmenes (conserva la BD actual)
set -u
cd "$(dirname "$0")/.."

PORT=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2); PORT=${PORT:-3000}
BASE="http://localhost:${PORT}"
fallos=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; fallos=$((fallos+1)); }
psqlc() { docker compose exec -T postgres psql -U "$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2)" -d "$(grep -E '^POSTGRES_DB=' .env | cut -d= -f2)" -At -c "$1"; }

echo "1) docker compose $( [ "${1:-}" = --keep ] && echo 'up --build -d' || echo 'down -v && up --build -d')"
if [ "${1:-}" != --keep ]; then docker compose down -v >/dev/null 2>&1; fi
docker compose up --build -d || { fail "compose up"; exit 1; }

echo "2) esperando /api/health"
for i in $(seq 1 60); do
  if curl -sf "$BASE/api/health" >/dev/null; then break; fi
  sleep 2
done
salud=$(curl -s "$BASE/api/health")
echo "$salud" | grep -q '"ok":true' && ok "health ok: $salud" || fail "health: $salud"

echo "3) corrida del pipeline (RUN_ON_START la dispara sola; si no, POST /api/pipeline/run)"
sleep 8
curl -s -X POST "$BASE/api/pipeline/run" -H 'Content-Type: application/json' -d '{}' >/dev/null
for i in $(seq 1 360); do   # hasta 60 min: el análisis en CPU es lento
  estado=$(curl -s "$BASE/api/pipeline/estado")
  if echo "$estado" | grep -q '"enCurso":false' && echo "$estado" | grep -q '"ultimaCorrida":{'; then break; fi
  sleep 10
done
echo "$estado" | python3 -c 'import json,sys; d=json.load(sys.stdin); u=d.get("ultimaCorrida") or {}; print("   última corrida:", {k:u.get(k) for k in ["origen","estado","rss_total","candidatos","scrapeados","analizados","errores"]})' 2>/dev/null
n_err=$(docker compose logs --no-log-prefix app 2>/dev/null | grep -c -E '"level":(50|60)')
[ "${n_err:-0}" -eq 0 ] && ok "sin errores en los logs del contenedor" || fail "$n_err líneas de error en los logs (docker compose logs app | grep '\"level\":50')"

echo "4) base de datos"
n_ll=$(psqlc "select count(*) from llamados"); [ "${n_ll:-0}" -gt 0 ] && ok "llamados: $n_ll" || fail "llamados = 0"
n_an=$(psqlc "select count(*) from analisis_ia where es_relevante is not null"); [ "${n_an:-0}" -gt 0 ] && ok "analisis_ia: $n_an" || fail "analisis_ia = 0"
n_bad=$(psqlc "select count(*) from analisis_ia where confianza < 0 or confianza > 100"); [ "${n_bad:-0}" -eq 0 ] && ok "confianza siempre en 0-100" || fail "confianza fuera de rango: $n_bad"

echo "5) feedback y métricas"
id=$(psqlc "select llamado_id from v_llamados_dashboard where es_relevante is not null order by confianza desc nulls last limit 1")
if [ -n "$id" ]; then
  fb=$(curl -s -X POST "$BASE/api/feedback" -H 'Content-Type: application/json' -d "{\"llamado_id\":\"$id\",\"es_relevante_real\":true,\"estado_seguimiento\":\"en_progreso\",\"comentario\":\"verificación automática\"}")
  echo "$fb" | grep -q "\"llamado_id\":\"$id\"" && ok "feedback guardado para $id" || fail "feedback: $fb"
  met=$(curl -s "$BASE/api/metricas")
  echo "$met" | grep -q '"revisados":[1-9]' && ok "métricas reflejan la revisión: $(echo "$met" | cut -c1-160)…" || fail "métricas: $met"
else
  fail "no hay llamado con análisis para probar el feedback"
fi

echo
[ "$fallos" -eq 0 ] && echo "TODO OK → abrir $BASE" || echo "$fallos verificaciones fallaron"
exit $fallos
