# Tests

Tests sans dépendance, lancés avec Node :

```sh
cd tests && for f in test-*.js; do node "$f" || echo "ÉCHEC : $f"; done
```

- `test-fft-officiel.js` — conformité du classement de poule au Guide de la
  compétition padel FFT, chapitre I (MAJ février 2026) : barème 2/1/−1/−2 et
  cascade de départage. Les passages du règlement sont cités dans le test.
- `test-tirage.js` — tirage au sort : 2 têtes de série par poule, placement
  d'office des TS, déterminisme et vérifiabilité d'un tirage à partir de sa graine.

Référence : https://padelmagazine.fr/wp-content/uploads/2026/01/CHAPITRE-I-Regles-Generales-2026.pdf
