# Tunnel de bienvenue (fidélité padel)

Chaque fois qu'un **nouveau joueur de padel** revient jouer dans les 7 jours, il débloque un
cadeau pour sa partie suivante (raquettes → boisson → pizza/planche → tournée → « régulier »).
Rattrapage à J+14 (une fois), grand retour à J+60 (une fois par an). V1 : padel seulement,
e-mail seulement.

## Comment ça marche

```
LiveXperience ──(script Python, wepepc, 3 h : veille → J+30)──▶ Supabase livex.livex_*
                                                                     │
                     pg_cron 8 h et 9 h UTC (= 10 h Paris) ── fidelite.calculer()
                                                                     │  synchronise clients/parties,
                                                                     │  fait avancer le tunnel,
                                                                     ▼  crée cadeaux + messages
                                                              fidelite.messages
                                                                     │  (statut « simule » en dry-run)
              n8n « Le Rebond — Fidélité (envoi) », toutes les 5 min, 10 h–19 h
                                                                     ▼
                                                    Microsoft Graph (contact@le-rebond.fr)
```

| Élément | Où |
|---|---|
| Schéma, moteur, fonctions du site | `supabase/migrations/2026103*_fidelite*.sql` puis `202611*_fidelite*.sql` (schéma `fidelite`), à appliquer dans l'ordre |
| Tests du moteur (79 vérifications) | `tests/fidelite/` |
| Workflow n8n | `scripts/fidelite/construire_workflow.py` → `workflow.json` |
| Page bar (mobile) | `admin/cadeaux/` → https://le-rebond.fr/admin/cadeaux/ |
| Fiche client (ouverte par le QR code des e-mails) | `admin/client/?j=<jeton>` : réservations, paliers, cadeaux, passages en caisse, offre en cours |
| Admin (recherche, fiche client, suivi : conversions générées, effet contre le témoin, messages) | onglet **🎁 Fidélité** de https://le-rebond.fr/admin/ (`js/fidelite-admin.js`) ; `admin/cadeaux/`, `admin/fidelite/`, `admin/client/` ne font que rediriger |
| Désinscription / préférences | `desinscription/?t=<jeton>` (lien en pied de chaque e-mail) |

Aucun secret dans ce code. Les accès passent par l'existant : la base Supabase (`DATABASE_URL`
dans `~/liveXperience/.env` sur wepepc), la credential Postgres n8n `B35nAS73YaZAkrBk`, la
credential Microsoft n8n `b05FlvDa9smA6GSa`. La page bar et la page de suivi se connectent
avec un compte **staff** (table `staff`, voir la migration `20261020_staff.sql`).

## Règles appliquées (résumé)

- **Partie** = réservation de padel (pistes 3119-3121) passée, hors blocages « DIRECTION »
  et compte 146. Plusieurs parties le même jour comptent pour une. Une réservation annulée
  disparaît de LiveXperience, donc ne compte pas.
- **Client** = fiche LiveXperience (`ref` = « ID CLIENT ») ; les fiches qui partagent un
  téléphone ou un e-mail sont regroupées sous la plus petite ref.
- **Nouveau** = 1re partie de padel à partir de `date_lancement`, et aucune réservation
  (padel ou five) avant.
- Les cadeaux sont valables **à toute heure** (la condition « heures creuses » a été
  retirée le 31/10/2026).
- **Conversion** = client venu jouer au padel entre un message et la fin de validité de
  son offre (`fidelite.v_conversions`) ; CA = prix LiveXperience de ces réservations ;
  effet réel = écart de taux de retour entre ciblés et témoins × nombre de ciblés.
- Retour dans la fenêtre → palier suivant. Retour après la fenêtre → même palier, nouvelle
  fenêtre. Pas de retour → rattrapage à J+14 (une seule fois par client), puis « décroché ».
- **E-mails** : chaque message porte l'échelle des paliers (validé, en cours, suivants en
  grisé avec le nombre de réservations restantes) et un **QR code** qui ouvre la fiche
  client pour le staff (`messages.donnees`, mis en page par le workflow n8n).
- **Mode aperçu** : en dry-run, les messages simulés sont envoyés à `email_test`
  (objet « [TEST → client] »), jamais aux clients ; le passage en réel vide `email_test`.
- **Messages** : annonce à J+1 (toujours), rappel à J+5 (si rien de réservé),
  rattrapage J+14 et grand retour J+60 (si rien de réservé).
- **Plafond** : 1 message par client sur 7 jours, newsletter comprise (1er mardi du mois,
  pour les inscrits) ; l'annonce et son rappel comptent comme un seul envoi. Un message
  bloqué par le plafond attend, il n'est pas perdu (« au moins X jours et pas encore envoyé »).
- **Groupe témoin** : 10 % des clients, tirés de façon reproductible : suivis, jamais
  contactés, sans cadeau.
- **Grand retour** : au plus 40 par jour (au lancement, ~250 clients inactifs sont concernés).
- Un client désinscrit ou sans e-mail a quand même son cadeau au bar ; son message est
  journalisé « bloque ».

Tous les réglages sont dans `fidelite.config` (paliers dans `fidelite.paliers`, textes dans
`fidelite.templates`). Exemple : `UPDATE fidelite.config SET valeur = '15' WHERE cle = 'pourcentage_temoin';`

## Installation

Toutes les commandes SQL ci-dessous s'exécutent dans l'**éditeur SQL de Supabase** (projet
Le Rebond, `vabotavilswqtrevishs`), ou depuis **wepepc** avec `DATABASE_URL`.

1. **Base** : appliquer les migrations `*_fidelite*.sql` dans l'ordre des noms. La migration est
   rejouable. Elle crée le job pg_cron `fidelite-calcul`, mais sans `date_lancement`
   personne n'entre dans le tunnel.
2. **n8n** (sur le Mac) : `python3 scripts/fidelite/construire_workflow.py`, puis importer
   `scripts/fidelite/workflow.json` dans n8n et l'activer. En dry-run, il ne trouve rien à
   envoyer : `fidelite.envoi_autorise()` renvoie toujours faux.
3. **Pages** : un push sur `main` déploie `admin/cadeaux/`, `admin/fidelite/` et
   `desinscription/` (GitHub Actions).
4. **Sync LiveXperience** (déjà fait le 31/10/2026 sur wepepc) : `livexperience_export.py
   sync` prend les réservations de la veille à J+30 (variable `LIVEX_RESA_HORIZON_JOURS`).

## Lancement : une semaine en dry-run, puis en réel

```sql
-- 1. Démarrer le dry-run (les nouveaux clients à partir d'aujourd'hui entrent dans le tunnel)
SELECT fidelite.reinitialiser(current_date, false);
SELECT fidelite.calculer();          -- premier passage tout de suite (sinon demain 10 h)
```

Pendant la semaine, relire les messages générés sur **https://le-rebond.fr/admin/fidelite/**
(section *Messages*, filtre « simule »). Pour corriger un texte :
`UPDATE fidelite.templates SET corps = '…' WHERE code = 'annonce_1' AND canal = 'email';`
(les messages déjà simulés gardent l'ancien texte).

```sql
-- 2. Passer en réel : efface tout le dry-run, la date de lancement devient aujourd'hui
SELECT fidelite.reinitialiser(current_date, true);
SELECT fidelite.calculer();
```

`reinitialiser` est refusé dès qu'un vrai message existe, pour ne jamais effacer un historique réel.
Pour **couper l'envoi** en urgence : `UPDATE fidelite.config SET valeur = 'true' WHERE cle = 'dry_run';`
(les messages « a_envoyer » restent en file et partiront à la réactivation).

## Tests (sur le Mac, Docker)

```sh
tests/fidelite/lancer.sh
```

Le script lance un Postgres 17 jetable, applique une imitation minimale de Supabase
(`stubs.sql`), puis la migration, puis les scénarios (`scenarios.sql`) : retour en heures
creuses ou pleines, pas de retour, rattrapage et double rattrapage, plafond et newsletter,
groupe témoin, grand retour annuel et étalé, annulation, five contre padel, client existant,
dry-run et envoi réel, désinscription, page bar, retour tardif, régulier, doublons. Le
calcul est rejoué jour par jour à 10 h, heure de Paris. Le résultat est écrit dans
`tests/fidelite/.dernier-resultat.txt`.

## Plus tard

- **SMS** : ajouter `"sms"` à `canaux_actifs` et brancher une passerelle Le Rebond dans le
  workflow (les modèles SMS du cahier des charges sont déjà en base, avec le pied
  « STOP au {numero_stop} »). Il faudra aussi un workflow de réception des STOP qui appelle
  `fidelite.consentements` (source `stop_sms`).
- **Five** : ajouter des lignes `sport = 'five'` dans `paliers` et adapter le moteur, qui
  ne traite aujourd'hui que `sport = 'padel'`.
