#!/bin/bash
# Tests du moteur fidélité sur un Postgres jetable (Docker), sur le Mac.
#   ./lancer.sh    → applique stubs + migration + scénarios, affiche le bilan
# Code de sortie ≠ 0 si un scénario échoue.
set -euo pipefail
ICI="$(cd "$(dirname "$0")" && pwd)"
MIGRATION="$ICI/../../supabase/migrations/20261031_fidelite.sql $ICI/../../supabase/migrations/20261031_fidelite_apercu.sql"
NOM="fidelite-test-$$"

docker run -d --rm --name "$NOM" -e POSTGRES_PASSWORD=test -e TZ=UTC postgres:17-alpine >/dev/null
trap 'docker stop "$NOM" >/dev/null' EXIT
until docker exec "$NOM" pg_isready -U postgres -q 2>/dev/null; do sleep 0.5; done
sleep 1

cat "$ICI/stubs.sql" $MIGRATION "$ICI/scenarios.sql" \
    | docker exec -i "$NOM" psql -U postgres -q -v ON_ERROR_STOP=1 -X 2>&1 | tee "$ICI/.dernier-resultat.txt"

! grep -q "FAIL\|ERROR" "$ICI/.dernier-resultat.txt"
