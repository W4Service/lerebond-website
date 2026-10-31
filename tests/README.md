# Tests

Tests sans dépendance, lancés avec Node :

```sh
cd tests && for f in test-*.js; do node "$f" || echo "ÉCHEC : $f"; done
```

- `fidelite/lancer.sh` — moteur du tunnel de bienvenue (schéma `fidelite`), sur un
  Postgres jetable (Docker) : paliers, heures creuses, rattrapage, plafond hebdo, témoin,
  grand retour, annulation, page bar, désinscription. Voir `scripts/fidelite/README.md`.
- `test-fft-officiel.js` — conformité du classement de poule au Guide de la
  compétition padel FFT, chapitre I (MAJ février 2026) : barème 2/1/−1/−2 et
  cascade de départage. Les passages du règlement sont cités dans le test.
- `test-tirage-deroule.js` — déroulé complet d'un tirage tel qu'il s'affiche sur
  l'écran TV : ordre des étapes, remplissage progressif des poules, traçabilité.
- `test-tableau8.js` — tableau direct de 8 équipes (quarts, demies, finale,
  consolation) : placement d'office des TS 1 et 2 « de part et d'autre du
  Tableau », tirage des TS 3 et 4, reproductibilité du tirage par sa graine,
  et simulation complète des 12 matchs vérifiant les 3 matchs par paire et le
  classement de 1 à 8 (chapitre III.4).
- `test-temps.js` — temps de repos réglementaire par format (1h30 / 1h / 30 min /
  15 min) et contrôle du repos écoulé.
- `test-partenaires-licences.js` — recherche de partenaire (confidentialité, anti-abus,
  fermeture à l'inscription), demandes de licence, initialisation unique de l'admin.
- `test-resultats-poids.js` — résultats et podiums, poids FFT des non classés et des dames
  en tableau messieurs, alertes staff, choix des homonymes.
- `test-inscriptions.js` — inscriptions en ligne : cuts et équivalences FFT (chapitre II),
  barème des points, liste d'attente, données personnelles, rôle staff, tâches planifiées.
- `test-calendrier-fft.js` — calendrier public des tournois et rattachement au
  classement FFT : c'est le rang (pas les points) qui fait le poids de paire, pas de
  rapprochement par nom en cas d'homonyme.
- `test-tirage.js` — tirage au sort : 2 têtes de série par poule, placement
  d'office des TS, déterminisme et vérifiabilité d'un tirage à partir de sa graine.

Référence : https://padelmagazine.fr/wp-content/uploads/2026/01/CHAPITRE-I-Regles-Generales-2026.pdf
