# Tests

Tests sans dépendance, lancés avec Node :

```sh
cd tests && for f in test-*.js; do node "$f" || echo "ÉCHEC : $f"; done
```

- `test-fft-officiel.js` — conformité du classement de poule au Guide de la
  compétition padel FFT, chapitre I (MAJ février 2026) : barème 2/1/−1/−2 et
  cascade de départage. Les passages du règlement sont cités dans le test.
- `test-tirage-deroule.js` — déroulé complet d'un tirage tel qu'il s'affiche sur
  l'écran TV : ordre des étapes, remplissage progressif des poules, traçabilité.
- `test-temps.js` — temps de repos réglementaire par format (1h30 / 1h / 30 min /
  15 min) et contrôle du repos écoulé.
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
