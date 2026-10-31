#!/usr/bin/env python3
"""Construit le workflow n8n « Le Rebond — Fidélité (envoi) » (workflow.json).

Le moteur (`fidelite.calculer()`, pg_cron chez Supabase) dépose les messages dans
`fidelite.messages`. Toutes les 5 minutes, ce workflow prend jusqu'à 20 messages
« a_envoyer » dont l'envoi est autorisé maintenant (`fidelite.envoi_autorise` :
10 h–19 h à Paris, pas de SMS le dimanche, jamais en dry-run) et, en dry-run, les
messages « simule » pas encore prévisualisés quand `email_test` est renseigné (envoyés à
cette adresse seulement, objet « [TEST → client] ») :
  - e-mail : envoi via Microsoft Graph depuis la boîte de la config `expediteur`
    (contact@le-rebond.fr), credential « Microsoft account » ;
  - SMS    : pas de passerelle Le Rebond (celle du S8 est celle de Wuilhome) : marqué
    « echec / SMS non activé ». N'arrive pas tant que `canaux_actifs` = ["email"].
Un e-mail en erreur est retenté (5 tentatives au total), puis marqué « echec ».

    python3 construire_workflow.py   → workflow.json
"""
import json
import os

ICI = os.path.dirname(os.path.abspath(__file__))
PG = {'postgres': {'id': 'B35nAS73YaZAkrBk', 'name': 'Postgres account Le Rebond'}}
MS = {'microsoftOAuth2Api': {'id': 'b05FlvDa9smA6GSa', 'name': 'Microsoft account'}}

# Messages réels « a_envoyer », ou, en dry-run, aperçus des messages simulés envoyés à
# `email_test` (jamais au client).
PRENDRE = """UPDATE fidelite.messages SET tentatives = tentatives + 1
WHERE id IN (
    SELECT id FROM fidelite.messages
    WHERE tentatives < 5
      AND ((statut = 'a_envoyer' AND fidelite.envoi_autorise(canal))
        OR (statut = 'simule' AND apercu_envoye_le IS NULL AND fidelite.apercu_autorise(canal)))
    ORDER BY cree_le
    LIMIT 20
    FOR UPDATE SKIP LOCKED)
RETURNING id, canal, destinataire, sujet, corps, type, tentatives, statut, donnees,
          fidelite.cfg_txt('expediteur') AS expediteur,
          CASE WHEN statut = 'simule' THEN fidelite.cfg_txt('email_test') END AS email_test"""

# Bibliothèque QR (Kazuhiko Arase, MIT), copiée dans vendor/ : le node Code n'a pas accès
# aux modules npm. Elle définit la variable globale `qrcode`.
with open(os.path.join(ICI, 'vendor', 'qrcode-generator.js'), encoding='utf-8') as f:
    QRCODE_LIB = f.read()

MISE_EN_PAGE = r"""// Met le message en forme (charte Le Rebond) et prépare l'appel Graph :
// texte, échelle des paliers (validés / en cours / à débloquer en grisé), QR code de la
// fiche client (image jointe, affichée dans le corps), pied.
const n = $input.item.json;
const d = typeof n.donnees === 'string' ? JSON.parse(n.donnees) : (n.donnees || {});
const echapper = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const liens = s => s
    .replace(/(https:\/\/le-rebond\.fr\/desinscription\/\S+)/g,
        '<a href="$1" style="color:#8a7f75">me désinscrire</a>')
    .replace(/(https:\/\/lerebond\.mymobileapp\.fr\/\S*)/g,
        '<a href="$1" style="display:inline-block;margin:6px 0;padding:10px 18px;background:#efa707;color:#1a1a1a;border-radius:8px;text-decoration:none;font-weight:600">Réserver un terrain</a>');
// Le pied (à partir du tiret long) est affiché en petit, sous la carte.
const [texte, pied = ''] = echapper(n.corps).split('\n—\n');
const paragraphes = texte.trim().split(/\n{2,}/)
    .map(p => '<p style="margin:0 0 14px;line-height:1.5">' + liens(p).replace(/\n/g, '<br>') + '</p>').join('');

// Échelle des paliers, en escalier : une marche par palier à cadeau (la fin du tunnel,
// « régulier », n'est pas affichée). Atteints = couleurs du Rebond, de l'or au bordeaux ;
// celui qui vient d'être validé est entouré d'or ; à venir = teinte claire, en pointillés.
// [fond atteint, texte atteint, fond à venir, texte à venir]
const COULEURS = [['#f7c948', '#3b2400', '#fdf4d8', '#9a7a2a'], ['#efa707', '#2b1a00', '#fbe7bd', '#94671a'],
                  ['#b8322a', '#ffffff', '#f6d9d6', '#9b4a43'], ['#680920', '#ffffff', '#ecd2d8', '#7d3a4a']];
const parties = k => k + ' partie' + (k > 1 ? 's' : '');
let echelle = '';
const paliers = Array.isArray(d.paliers) ? d.paliers.filter(p => !p.fin) : [];
if (paliers.length) {
    const actuel = paliers.find(p => p.etat === 'actuel');
    const largeur = Math.floor(100 / paliers.length) + '%';
    const marches = paliers.map((p, i) => {
        const [fond, texte, fondClair, texteClair] = COULEURS[Math.min(i, COULEURS.length - 1)];
        const atteint = p.etat !== 'a_debloquer';
        const couleur = atteint ? texte : texteClair;
        const badge = p.etat === 'actuel' ? '🎁 À utiliser' : (atteint ? '✔ Gagné' : '🔒 Encore ' + parties(p.manque));
        const style = atteint
            ? 'background:' + fond + ';' + (p.etat === 'actuel' ? 'border:3px solid #680920;' : '')
            : 'background:' + fondClair + ';border:2px dashed ' + fond + ';';
        return '<td valign="bottom" width="' + largeur + '" style="padding:0 2px">'
            + '<div style="' + style + 'min-height:' + (135 + i * 30) + 'px;border-radius:8px 8px 0 0;padding:7px 5px;box-sizing:border-box;-webkit-hyphens:auto;hyphens:auto" lang="fr">'
            + '<div style="font-size:9px;font-weight:700;letter-spacing:.6px;color:' + couleur + ';opacity:.8">PALIER ' + p.rang + '</div>'
            + '<div style="font-size:12px;font-weight:700;color:' + couleur + ';margin-top:4px;line-height:1.15">' + echapper(p.titre || p.libelle) + '</div>'
            + '<div style="font-size:10px;color:' + couleur + ';margin-top:2px;line-height:1.3">' + echapper(p.detail || '') + '</div>'
            + '<div style="font-size:10px;font-weight:700;color:' + couleur + ';margin-top:7px">' + badge + '</div>'
            + '</div></td>';
    });
    echelle = '<div style="margin:6px 0 18px">'
        + (actuel ? '<div style="padding:12px 14px;background:#fff3d6;border:2px solid #efa707;border-radius:10px;margin-bottom:14px">'
            + '<div style="font-size:12px;font-weight:700;color:#680920;text-transform:uppercase;letter-spacing:.5px">Palier ' + actuel.rang + ' validé</div>'
            + '<div style="font-size:16px;font-weight:700;margin-top:2px">Tu as gagné : ' + echapper(actuel.libelle) + '</div>'
            + '<div style="font-size:13px;color:#5c5249;margin-top:2px">À utiliser à ta prochaine partie, d\'ici le ' + echapper(d.date_limite) + '.</div></div>' : '')
        + '<div style="font-weight:700;color:#680920;margin-bottom:8px">🎾 Ta progression</div>'
        + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;table-layout:fixed"><tr>'
        + marches.join('') + '</tr></table>'
        + '<div style="height:6px;background:#680920;border-radius:0 0 4px 4px"></div>'
        + '<div style="font-size:12px;color:#5c5249;margin-top:8px">Chaque partie jouée dans les 7 jours qui suivent la précédente te fait monter d\'une marche.</div></div>';
} else if (d.cadeau) {
    echelle = '<div style="margin:6px 0 18px;padding:12px 14px;background:#fff3d6;border:2px solid #efa707;border-radius:10px">'
        + '<div style="font-size:16px;font-weight:700">Ton cadeau : ' + echapper(d.cadeau) + '</div>'
        + '<div style="font-size:13px;color:#5c5249;margin-top:2px">Valable jusqu\'au ' + echapper(d.date_limite) + '.</div></div>';
}

// QR code de la fiche client, en image jointe (les images « data: » sont bloquées par Gmail).
let qrHtml = '', attachments = [];
if (d.qr_url) {
    const qr = qrcode(0, 'M');
    qr.addData(d.qr_url);
    qr.make();
    const gif = qr.createDataURL(5, 2).split(',')[1];
    attachments.push({ '@odata.type': '#microsoft.graph.fileAttachment', name: 'qr-le-rebond.gif',
                       contentType: 'image/gif', contentBytes: gif, isInline: true, contentId: 'qr-rebond' });
    qrHtml = '<div style="text-align:center;margin:8px 0 4px">'
        + '<img src="cid:qr-rebond" width="180" height="180" alt="QR code à montrer au bar" style="display:inline-block;border:8px solid #fff;border-radius:8px">'
        + '<div style="font-family:monospace;font-size:16px;letter-spacing:1px;margin-top:4px">' + echapper(d.code) + '</div>'
        + '<div style="font-size:13px;color:#5c5249">À montrer au bar</div></div>';
}

const html = '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>'
    + '<body style="margin:0;background:#f4f0e6;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a">'
    + '<div style="max-width:560px;margin:0 auto;padding:16px 10px">'
    + '<div style="background:#680920;color:#f4f0e6;padding:18px 22px;border-radius:12px 12px 0 0;font-size:20px;font-weight:700">Le Rebond — Padel</div>'
    + '<div style="background:#ffffff;padding:20px 14px;border-radius:0 0 12px 12px">' + paragraphes + echelle + qrHtml + '</div>'
    + '<p style="font-size:12px;color:#8a7f75;text-align:center;margin-top:14px;line-height:1.5">' + liens(pied).replace(/\n/g, '<br>') + '</p>'
    + '</div></body></html>';
// Aperçu (dry-run) : envoyé à l'adresse de test, avec le vrai destinataire dans l'objet.
const apercu = n.statut === 'simule' && n.email_test;
const message = {
    subject: (apercu ? '[TEST → ' + n.destinataire + '] ' : '') + (n.sujet || 'Le Rebond'),
    body: { contentType: 'HTML', content: html },
    toRecipients: [{ emailAddress: { address: apercu ? n.email_test : n.destinataire } }],
    replyTo: [{ emailAddress: { address: n.expediteur } }]
};
if (attachments.length) message.attachments = attachments;
return { json: { id: n.id, expediteur: n.expediteur, graph: { message, saveToSentItems: true } } };
"""


def construire():
    nodes = [
        {'parameters': {'rule': {'interval': [{'field': 'minutes', 'minutesInterval': 5}]}},
         'name': 'Toutes les 5 minutes', 'type': 'n8n-nodes-base.scheduleTrigger', 'typeVersion': 1.2, 'position': [0, 200]},
        {'parameters': {'operation': 'executeQuery', 'query': PRENDRE, 'options': {}},
         'name': 'Prendre un lot', 'type': 'n8n-nodes-base.postgres', 'typeVersion': 2.5, 'position': [220, 200], 'credentials': PG},
        {'parameters': {'conditions': {'options': {'caseSensitive': True, 'typeValidation': 'strict'},
                                       'conditions': [{'id': 'canal-email', 'leftValue': '={{ $json.canal }}', 'rightValue': 'email',
                                                       'operator': {'type': 'string', 'operation': 'equals'}}],
                                       'combinator': 'and'}, 'options': {}},
         'name': 'E-mail ?', 'type': 'n8n-nodes-base.if', 'typeVersion': 2.2, 'position': [440, 200]},
        {'parameters': {'mode': 'runOnceForEachItem', 'jsCode': QRCODE_LIB + '\n' + MISE_EN_PAGE},
         'name': 'Mettre en page', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [660, 100]},
        {'parameters': {'method': 'POST', 'url': '=https://graph.microsoft.com/v1.0/users/{{ $json.expediteur }}/sendMail',
                        'authentication': 'predefinedCredentialType', 'nodeCredentialType': 'microsoftOAuth2Api',
                        'sendBody': True, 'specifyBody': 'json', 'jsonBody': '={{ JSON.stringify($json.graph) }}',
                        # 1 e-mail par seconde : Graph refuse au-delà de 4 envois simultanés par boîte
                        # (« MailboxConcurrency »).
                        'options': {'batching': {'batch': {'batchSize': 1, 'batchInterval': 1000}}}},
         'name': 'Envoyer (Graph)', 'type': 'n8n-nodes-base.httpRequest', 'typeVersion': 4.2, 'position': [880, 100],
         'credentials': MS, 'onError': 'continueErrorOutput'},
        {'parameters': {'operation': 'executeQuery',
                        'query': "UPDATE fidelite.messages SET erreur = NULL, "
                                 "apercu_envoye_le = CASE WHEN statut = 'simule' THEN now() ELSE apercu_envoye_le END, "
                                 "envoye_le = CASE WHEN statut = 'simule' THEN envoye_le ELSE now() END, "
                                 "statut = CASE WHEN statut = 'simule' THEN 'simule' ELSE 'envoye' END "
                                 "WHERE id = $1::uuid",
                        'options': {'queryReplacement': "={{ [ $('Mettre en page').item.json.id ] }}"}},
         'name': 'Marquer envoyé', 'type': 'n8n-nodes-base.postgres', 'typeVersion': 2.5, 'position': [1100, 20], 'credentials': PG},
        {'parameters': {'operation': 'executeQuery',
                        'query': "UPDATE fidelite.messages SET statut = CASE WHEN statut = 'simule' THEN 'simule' "
                                 "WHEN tentatives >= 5 THEN 'echec' ELSE 'a_envoyer' END, "
                                 "erreur = left($2, 500) WHERE id = $1::uuid",
                        'options': {'queryReplacement': "={{ [ $('Mettre en page').item.json.id, "
                                                        "JSON.stringify($json.error || $json).slice(0, 500) ] }}"}},
         'name': 'Marquer erreur', 'type': 'n8n-nodes-base.postgres', 'typeVersion': 2.5, 'position': [1100, 180], 'credentials': PG},
        {'parameters': {'operation': 'executeQuery',
                        'query': "UPDATE fidelite.messages SET statut = 'echec', erreur = 'SMS non activé : pas encore de passerelle SMS Le Rebond' "
                                 "WHERE id = $1::uuid",
                        'options': {'queryReplacement': '={{ [ $json.id ] }}'}},
         'name': 'SMS non activé', 'type': 'n8n-nodes-base.postgres', 'typeVersion': 2.5, 'position': [660, 320], 'credentials': PG},
    ]
    connections = {
        'Toutes les 5 minutes': {'main': [[{'node': 'Prendre un lot', 'type': 'main', 'index': 0}]]},
        'Prendre un lot': {'main': [[{'node': 'E-mail ?', 'type': 'main', 'index': 0}]]},
        'E-mail ?': {'main': [[{'node': 'Mettre en page', 'type': 'main', 'index': 0}],
                              [{'node': 'SMS non activé', 'type': 'main', 'index': 0}]]},
        'Mettre en page': {'main': [[{'node': 'Envoyer (Graph)', 'type': 'main', 'index': 0}]]},
        'Envoyer (Graph)': {'main': [[{'node': 'Marquer envoyé', 'type': 'main', 'index': 0}],
                                     [{'node': 'Marquer erreur', 'type': 'main', 'index': 0}]]},
    }
    return {'name': 'Le Rebond — Fidélité (envoi)', 'nodes': nodes, 'connections': connections,
            'settings': {'executionOrder': 'v1', 'timezone': 'Europe/Paris', 'callerPolicy': 'workflowsFromSameOwner'}}


if __name__ == '__main__':
    with open(os.path.join(ICI, 'workflow.json'), 'w', encoding='utf-8') as f:
        json.dump(construire(), f, ensure_ascii=False, indent=1)
    print('workflow.json écrit')
