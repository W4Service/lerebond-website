#!/bin/bash
# Tests du profil joueur, de l'annuaire et de la messagerie sur un Postgres jetable
# (Docker), sur le Mac.
#   ./lancer.sh    → applique stubs + migrations utiles + la migration du lot + scénarios
# Code de sortie ≠ 0 si un scénario échoue.
set -euo pipefail
ICI="$(cd "$(dirname "$0")" && pwd)"
M="$ICI/../../supabase/migrations"
# Migrations qui créent ce dont le lot a besoin (joueurs, contacts, notifications,
# notifier, alerter_staff, classement FFT, place finale). 20261022 (cron, net.http_post)
# est sautée : elle ne crée rien d'utile ici.
MIGRATIONS="$M/20260516_joueurs.sql
$M/20261017_tournois_calendrier.sql
$M/20261017_fft_classement.sql
$M/20261018_fft_tenup.sql
$M/20261019_fft_tenup_doublons.sql
$M/20261020_staff.sql
$M/20261021_inscriptions.sql
$M/20261023_resultats_poids_alertes.sql
$M/20261024_partenaires_licences.sql
$M/20261121_correctif_liens_inscription.sql
$M/20261121_profil_annuaire_messagerie.sql"
NOM="profil-test-$$"

docker run -d --rm --name "$NOM" -e POSTGRES_PASSWORD=test -e TZ=UTC postgres:17-alpine >/dev/null
trap 'docker stop "$NOM" >/dev/null' EXIT
until docker exec "$NOM" pg_isready -U postgres -q 2>/dev/null; do sleep 0.5; done
sleep 1

# Le correctif et la migration du lot sont rejoués deux fois : ils doivent être rejouables.
cat "$ICI/stubs.sql" $MIGRATIONS "$M/20261121_correctif_liens_inscription.sql" "$M/20261121_profil_annuaire_messagerie.sql" "$ICI/scenarios.sql" \
    | docker exec -i "$NOM" psql -U postgres -q -v ON_ERROR_STOP=1 -X 2>&1 | tee "$ICI/.dernier-resultat.txt"

! grep -q "FAIL\|ERROR" "$ICI/.dernier-resultat.txt"
