# Classement padel FFT

Le classement des joueurs du club se met à jour **tout seul**, à partir de Ten'Up. C'est le
workflow n8n « Le Rebond — Classement FFT (Ten'Up) » qui s'en charge (sur n8n.wepe.fr, id
`ujn4VJKokQzKacu5`). L'import de fichier décrit plus bas ne sert plus qu'en secours.

## Source des données

Ten'Up affiche le classement padel publiquement sur `tenup.fft.fr/classement-joueurs/padel`.
Cette page s'appuie sur une API JSON :

```
POST https://tenup.fft.fr/api/back/public/v2/classements/recherche
{"pratique":"PADEL","sexe":"H"|"F", "nom":"…","prenom":"…"}   → page qui contient le joueur
{"pratique":"PADEL","sexe":"H"|"F", "idCrm":1234567890}        → idem, par identifiant FFT
filtres possibles : page, dateClassement, codeLigue, codesComites[], estFrancais, assimilation,
                    ageSportifMin/Max, afficheReferentiels (mois disponibles, codes ligues/comités)
```

- La recherche ne trouve que le **nom et le prénom exacts**, mais elle ignore la casse et les
  accents. Le joueur trouvé porte `utilisateurRecherche: true`.
- Les homonymes reviennent tous ensemble (`multiple: true`), chacun avec son club et son comité.
- L'identifiant FFT `idCrm` ne change pas d'un mois à l'autre : une fois qu'on l'a, la
  recherche se fait par identifiant.
- Un joueur non classé renvoie une erreur 400.
- Un joueur **anonyme** (qui a masqué son nom sur Ten'Up) arrive avec `nom: null`. On ne le
  stocke pas.

## Ce que fait le workflow

| Entrée | Rôle |
|---|---|
| `GET /webhook/rebond-fft?q=Prénom Nom[&genre=H\|F]` | Recherche en direct, utilisée par l'admin et `/tournois/` quand le cache ne connaît pas le joueur. Origine limitée à le-rebond.fr. Le résultat est mis en cache dans `fft_classement`. |
| Chaque matin à 7 h | Récupère le mois du dernier classement, puis revérifie jusqu'à 120 joueurs du club qui ne l'ont pas encore été pour ce mois (les joueurs engagés en tournoi passent en premier). La recherche se fait par identifiant FFT s'il est connu, sinon par nom. Le node s'arrête à 230 s et le reste est repris le lendemain. |
| `POST /webhook/rebond-fft-verifier` (header `X-Rebond-Jeton`, credential « Le Rebond — Jeton FFT ») | Lance la même vérification à la main, par exemple le jour de la sortie du classement. |

Statut de chaque joueur (`joueurs.fft_statut`) :
- `classe` : le joueur est rattaché à son identifiant FFT ;
- `homonymes` : plusieurs classés portent ce nom, il faut choisir le bon dans les suggestions de l'admin ;
- `non_classe` : aucun classé à ce nom.

Volume : une requête par joueur et par mois (deux si le genre est inconnu), à 0,8 s
d'intervalle. **On ne recopie pas le classement national** (environ 180 000 joueurs) :
extraire une partie substantielle de la base FFT n'est pas autorisé (droit des producteurs de
bases de données, mentions légales Ten'Up). On ne consulte que les joueurs qui passent par le
club, comme le ferait le staff à la main.

Code des nodes : `n8n/code-recherche.js` et `n8n/code-verification.js`. Pour reconstruire le
workflow : `python3 n8n/construire_workflow.py --credential-jeton <id>`, ce qui produit
`n8n/workflow.json`.

## Secours : import d'un fichier

Si Ten'Up change son API, on peut importer le fichier du classement (PDF tabulaire, XLSX ou
CSV) avec `importer_classement.py`.

```sh
cd scripts/fft
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python importer_classement.py classement_homme_2026_11.pdf --dry-run   # vérifier la lecture
export DATABASE_URL='postgresql://postgres:…@db.<projet>.supabase.co:5432/postgres'
.venv/bin/python importer_classement.py classement_homme_2026_11.pdf classement_femme_2026_11.pdf
```

Ensuite, dans l'annuaire de l'admin, cliquer sur **🔄 Actualiser les classements FFT**.

Tests : `python3 -m unittest test_importer_classement`
