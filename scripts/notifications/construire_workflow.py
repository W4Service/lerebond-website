#!/usr/bin/env python3
"""Construit le workflow n8n « Le Rebond — Notifications tournois » (workflow.json).

Toutes les 2 minutes, il prend jusqu'à 20 messages « a_envoyer » de la table
`notifications` (déposés par les inscriptions, convocations, rappels…) et :
  - e-mail : envoi via Microsoft Graph, même compte que les réservations de table
    (credential « Microsoft account », adresse $env.MS_SENDER_EMAIL) ;
  - SMS    : pas de passerelle Le Rebond pour l'instant (celle du S8 est celle de
    Wuilhome) : le message est marqué « echec / SMS non activé » plutôt que de
    s'accumuler et partir d'un coup le jour où on branche une passerelle.
Un e-mail en erreur est retenté (5 tentatives au total), puis marqué « echec ».

    python3 construire_workflow.py   → workflow.json
"""
import json
import os

ICI = os.path.dirname(os.path.abspath(__file__))
PG = {'postgres': {'id': 'B35nAS73YaZAkrBk', 'name': 'Postgres account Le Rebond'}}
MS = {'microsoftOAuth2Api': {'id': 'b05FlvDa9smA6GSa', 'name': 'Microsoft account'}}

PRENDRE = """UPDATE notifications SET tentatives = tentatives + 1
WHERE id IN (
    SELECT id FROM notifications
    WHERE statut = 'a_envoyer' AND tentatives < 5
    ORDER BY cree_le
    LIMIT 20
    FOR UPDATE SKIP LOCKED)
RETURNING id, canal, destinataire, sujet, corps, type, tentatives"""

MISE_EN_PAGE = r"""// Met le texte brut du message en forme (charte Le Rebond) et prépare l'appel Graph.
const n = $input.item.json;
const echapper = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const lienner = s => s.replace(/(https:\/\/le-rebond\.fr\/[^\s<]+)/g,
    '<a href="$1" style="display:inline-block;margin:6px 0;padding:10px 18px;background:#efa707;color:#1a1a1a;border-radius:8px;text-decoration:none;font-weight:600">Ouvrir mon espace joueur</a>');
const paragraphes = echapper(n.corps).split(/\n{2,}/)
    .map(p => '<p style="margin:0 0 14px;line-height:1.5">' + lienner(p).replace(/\n/g, '<br>') + '</p>').join('');
const html = '<!DOCTYPE html><html lang="fr"><body style="margin:0;background:#f4f0e6;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a">'
    + '<div style="max-width:560px;margin:0 auto;padding:24px">'
    + '<div style="background:#680920;color:#f4f0e6;padding:18px 22px;border-radius:12px 12px 0 0;font-size:20px;font-weight:700">Le Rebond — Tournois de padel</div>'
    + '<div style="background:#ffffff;padding:22px;border-radius:0 0 12px 12px">' + paragraphes + '</div>'
    + '<p style="font-size:12px;color:#8a7f75;text-align:center;margin-top:14px">Le Rebond · 403 rue de l\'Europe, 60400 Noyon · 09 60 35 42 05</p>'
    + '</div></body></html>';
return { json: {
    id: n.id,
    graph: {
        message: {
            subject: n.sujet || 'Le Rebond — tournoi de padel',
            body: { contentType: 'HTML', content: html },
            toRecipients: [{ emailAddress: { address: n.destinataire } }],
            replyTo: [{ emailAddress: { address: $env.MS_SENDER_EMAIL } }]
        },
        saveToSentItems: true
    }
} };
"""


def construire():
    nodes = [
        {'parameters': {'rule': {'interval': [{'field': 'minutes', 'minutesInterval': 2}]}},
         'name': 'Toutes les 2 minutes', 'type': 'n8n-nodes-base.scheduleTrigger', 'typeVersion': 1.2, 'position': [0, 200]},
        {'parameters': {'operation': 'executeQuery', 'query': PRENDRE, 'options': {}},
         'name': 'Prendre un lot', 'type': 'n8n-nodes-base.postgres', 'typeVersion': 2.5, 'position': [220, 200], 'credentials': PG},
        {'parameters': {'conditions': {'options': {'caseSensitive': True, 'typeValidation': 'strict'},
                                       'conditions': [{'id': 'canal-email', 'leftValue': '={{ $json.canal }}', 'rightValue': 'email',
                                                       'operator': {'type': 'string', 'operation': 'equals'}}],
                                       'combinator': 'and'}, 'options': {}},
         'name': 'E-mail ?', 'type': 'n8n-nodes-base.if', 'typeVersion': 2.2, 'position': [440, 200]},
        {'parameters': {'mode': 'runOnceForEachItem', 'jsCode': MISE_EN_PAGE},
         'name': 'Mettre en page', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [660, 100]},
        {'parameters': {'method': 'POST', 'url': '=https://graph.microsoft.com/v1.0/users/{{ $env.MS_SENDER_EMAIL }}/sendMail',
                        'authentication': 'predefinedCredentialType', 'nodeCredentialType': 'microsoftOAuth2Api',
                        'sendBody': True, 'specifyBody': 'json', 'jsonBody': '={{ JSON.stringify($json.graph) }}', 'options': {}},
         'name': 'Envoyer (Graph)', 'type': 'n8n-nodes-base.httpRequest', 'typeVersion': 4.2, 'position': [880, 100],
         'credentials': MS, 'onError': 'continueErrorOutput'},
        {'parameters': {'operation': 'executeQuery',
                        'query': "UPDATE notifications SET statut = 'envoye', envoye_le = now(), erreur = NULL WHERE id = $1::uuid",
                        'options': {'queryReplacement': "={{ [ $('Mettre en page').item.json.id ] }}"}},
         'name': 'Marquer envoyé', 'type': 'n8n-nodes-base.postgres', 'typeVersion': 2.5, 'position': [1100, 20], 'credentials': PG},
        {'parameters': {'operation': 'executeQuery',
                        'query': "UPDATE notifications SET statut = CASE WHEN tentatives >= 5 THEN 'echec' ELSE 'a_envoyer' END, "
                                 "erreur = left($2, 500) WHERE id = $1::uuid",
                        'options': {'queryReplacement': "={{ [ $('Mettre en page').item.json.id, "
                                                        "JSON.stringify($json.error || $json).slice(0, 500) ] }}"}},
         'name': 'Marquer erreur', 'type': 'n8n-nodes-base.postgres', 'typeVersion': 2.5, 'position': [1100, 180], 'credentials': PG},
        {'parameters': {'operation': 'executeQuery',
                        'query': "UPDATE notifications SET statut = 'echec', erreur = 'SMS non activé : pas encore de passerelle SMS Le Rebond' "
                                 "WHERE id = $1::uuid",
                        'options': {'queryReplacement': '={{ [ $json.id ] }}'}},
         'name': 'SMS non activé', 'type': 'n8n-nodes-base.postgres', 'typeVersion': 2.5, 'position': [660, 320], 'credentials': PG},
    ]
    connections = {
        'Toutes les 2 minutes': {'main': [[{'node': 'Prendre un lot', 'type': 'main', 'index': 0}]]},
        'Prendre un lot': {'main': [[{'node': 'E-mail ?', 'type': 'main', 'index': 0}]]},
        'E-mail ?': {'main': [[{'node': 'Mettre en page', 'type': 'main', 'index': 0}],
                              [{'node': 'SMS non activé', 'type': 'main', 'index': 0}]]},
        'Mettre en page': {'main': [[{'node': 'Envoyer (Graph)', 'type': 'main', 'index': 0}]]},
        'Envoyer (Graph)': {'main': [[{'node': 'Marquer envoyé', 'type': 'main', 'index': 0}],
                                     [{'node': 'Marquer erreur', 'type': 'main', 'index': 0}]]},
    }
    return {'name': 'Le Rebond — Notifications tournois', 'nodes': nodes, 'connections': connections,
            'settings': {'executionOrder': 'v1', 'timezone': 'Europe/Paris', 'callerPolicy': 'workflowsFromSameOwner'}}


if __name__ == '__main__':
    with open(os.path.join(ICI, 'workflow.json'), 'w', encoding='utf-8') as f:
        json.dump(construire(), f, ensure_ascii=False, indent=1)
    print('workflow.json écrit')
