#!/usr/bin/env python3
"""Construit le workflow n8n « Le Rebond — Classement FFT (Ten'Up) » à partir des nodes Code
de ce dossier, et l'écrit dans workflow.json (importable dans n8n).

    python3 construire_workflow.py [--credential-jeton ID]

Deux entrées :
  - GET  /webhook/rebond-fft?q=… | nom=…&prenom=… [&genre=H|F]  recherche en direct (admin + site)
  - chaque matin à 7 h (ou POST /webhook/rebond-fft-verifier, header X-Rebond-Jeton) :
    revérifie un lot de joueurs du club dès qu'un nouveau classement est publié.
"""
import argparse
import json
import os

ICI = os.path.dirname(os.path.abspath(__file__))
PG = {'postgres': {'id': 'B35nAS73YaZAkrBk', 'name': 'Postgres account Le Rebond'}}


def code(fichier):
    with open(os.path.join(ICI, fichier), encoding='utf-8') as f:
        return f.read()


def construire(credential_jeton=None):
    mois_code = """// Mois du dernier classement publié (une seule requête, petite réponse).
const r = await this.helpers.httpRequest({
    method: 'POST', json: true, timeout: 15000,
    url: 'https://tenup.fft.fr/api/back/public/v2/classements/recherche',
    headers: { 'User-Agent': 'LeRebondNoyon/1.0 (+https://le-rebond.fr)', Accept: 'application/json' },
    body: { pratique: 'PADEL', sexe: 'F', page: 1, codeLigue: 56, codesComites: ['5660'], afficheReferentiels: true }
});
const mois = r.referentiels && r.referentiels.datesClassement && r.referentiels.datesClassement[0];
if (!mois) throw new Error('Mois du classement introuvable dans la réponse Ten\\'Up');
return [{ json: { mois } }];
"""
    webhook_verif = {
        'parameters': {'httpMethod': 'POST', 'path': 'rebond-fft-verifier', 'responseMode': 'onReceived', 'options': {}},
        'name': 'Déclenchement manuel', 'type': 'n8n-nodes-base.webhook', 'typeVersion': 2.1,
        'position': [0, 480], 'webhookId': '5c1f3c0e-6f1e-4b0e-9d1f-0a1b2c3d4e5f',
    }
    if credential_jeton:
        webhook_verif['parameters']['authentication'] = 'headerAuth'
        webhook_verif['credentials'] = {'httpHeaderAuth': {'id': credential_jeton, 'name': 'Le Rebond — Jeton FFT'}}

    nodes = [
        # ----- Recherche en direct -----
        {'parameters': {'path': 'rebond-fft', 'responseMode': 'responseNode',
                        'options': {'allowedOrigins': 'https://le-rebond.fr'}},
         'name': 'Recherche (webhook)', 'type': 'n8n-nodes-base.webhook', 'typeVersion': 2.1,
         'position': [0, 0], 'webhookId': '9b2f6a51-3c4d-4e8f-a1b2-c3d4e5f6a7b8'},
        {'parameters': {'jsCode': code('code-recherche.js')},
         'name': "Recherche Ten'Up", 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [240, 0]},
        {'parameters': {'respondWith': 'json',
                        'responseBody': '={{ JSON.stringify({ mois: $json.mois, joueurs: $json.joueurs }) }}',
                        'options': {'responseHeaders': {'entries': [
                            {'name': 'Cache-Control', 'value': 'public, max-age=3600'}]}}},
         'name': 'Répondre', 'type': 'n8n-nodes-base.respondToWebhook', 'typeVersion': 1.1, 'position': [480, 0]},
        {'parameters': {'operation': 'executeQuery',
                        'query': 'SELECT fft_enregistrer_tenup($1::date, $2::jsonb) AS lignes',
                        'options': {'queryReplacement':
                                    "={{ [ $('Recherche Ten\\'Up').first().json.mois, "
                                    "JSON.stringify($('Recherche Ten\\'Up').first().json.brut) ] }}"}},
         'name': 'Mettre en cache', 'type': 'n8n-nodes-base.postgres', 'typeVersion': 2.5,
         'position': [720, 0], 'credentials': PG, 'onError': 'continueRegularOutput'},

        # ----- Vérification quotidienne -----
        {'parameters': {'rule': {'interval': [{'triggerAtHour': 7}]}},
         'name': 'Chaque matin', 'type': 'n8n-nodes-base.scheduleTrigger', 'typeVersion': 1.2, 'position': [0, 300]},
        webhook_verif,
        {'parameters': {'jsCode': mois_code},
         'name': 'Mois du classement', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [240, 380]},
        {'parameters': {'operation': 'executeQuery',
                        'query': 'SELECT * FROM fft_joueurs_a_verifier($1::date, 120)',
                        'options': {'queryReplacement': '={{ [ $json.mois ] }}'}},
         'name': 'Joueurs à vérifier', 'type': 'n8n-nodes-base.postgres', 'typeVersion': 2.5,
         'position': [480, 380], 'credentials': PG},
        {'parameters': {'jsCode': code('code-verification.js')},
         'name': "Vérifier sur Ten'Up", 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [720, 380]},
        {'parameters': {'operation': 'executeQuery',
                        'query': 'SELECT fft_enregistrer_tenup($1::date, $2::jsonb) AS lignes_cache, '
                                 'fft_appliquer_verifications($1::date, $3::jsonb) AS bilan',
                        'options': {'queryReplacement':
                                    '={{ [ $json.mois, JSON.stringify($json.lignes), JSON.stringify($json.resultats) ] }}'}},
         'name': 'Enregistrer', 'type': 'n8n-nodes-base.postgres', 'typeVersion': 2.5,
         'position': [960, 380], 'credentials': PG},
    ]
    connections = {
        'Recherche (webhook)': {'main': [[{'node': "Recherche Ten'Up", 'type': 'main', 'index': 0}]]},
        "Recherche Ten'Up": {'main': [[{'node': 'Répondre', 'type': 'main', 'index': 0}]]},
        'Répondre': {'main': [[{'node': 'Mettre en cache', 'type': 'main', 'index': 0}]]},
        'Chaque matin': {'main': [[{'node': 'Mois du classement', 'type': 'main', 'index': 0}]]},
        'Déclenchement manuel': {'main': [[{'node': 'Mois du classement', 'type': 'main', 'index': 0}]]},
        'Mois du classement': {'main': [[{'node': 'Joueurs à vérifier', 'type': 'main', 'index': 0}]]},
        'Joueurs à vérifier': {'main': [[{'node': "Vérifier sur Ten'Up", 'type': 'main', 'index': 0}]]},
        "Vérifier sur Ten'Up": {'main': [[{'node': 'Enregistrer', 'type': 'main', 'index': 0}]]},
    }
    return {
        'name': "Le Rebond — Classement FFT (Ten'Up)",
        'nodes': nodes,
        'connections': connections,
        'settings': {'executionOrder': 'v1', 'timezone': 'Europe/Paris', 'callerPolicy': 'workflowsFromSameOwner'},
    }


if __name__ == '__main__':
    a = argparse.ArgumentParser()
    a.add_argument('--credential-jeton', help='id de la credential httpHeaderAuth du déclenchement manuel')
    args = a.parse_args()
    wf = construire(args.credential_jeton)
    with open(os.path.join(ICI, 'workflow.json'), 'w', encoding='utf-8') as f:
        json.dump(wf, f, ensure_ascii=False, indent=1)
    print('workflow.json écrit :', len(wf['nodes']), 'nodes')
