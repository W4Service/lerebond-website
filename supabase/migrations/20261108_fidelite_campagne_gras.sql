-- Fidélité : campagne « 5 € par joueur et par heure », dates et prix en gras (demande de
-- Gaël, 31/10/2026). Les **…** des modèles sont mis en gras par le workflow d'envoi.
UPDATE fidelite.config
SET valeur = valeur || '{"libelle": "Partie à 5 € par joueur et par heure", "formule": "la partie de padel à 5 € par joueur et par heure, pour toi et ton équipe"}'
WHERE cle = 'campagne_5e';

UPDATE fidelite.templates
SET sujet = '{prenom}, le padel à 5 € par joueur et par heure jusqu''au {date_limite}',
    corps = E'Salut {prenom},\n\nDu **{date_debut}** au **{date_limite}** inclus, la partie de padel au Rebond est à **5 € par joueur et par heure**, pour toi et ton équipe.\n\nComment en profiter :\n1. Réserve ton terrain en ligne comme d''habitude, avec ton empreinte bancaire.\n2. À ton arrivée, présente ce QR code (ou ton code {code}) à l''accueil : la réduction est faite sur place.\n\nPassé le **{date_limite}**, le code ne fonctionne plus.\n\nRéserve ici : {lien}'
WHERE code = 'campagne_5e' AND canal = 'email';
