-- Présence et paiement par équipe pour le pointage d'accueil du tournoi.
ALTER TABLE equipes
    ADD COLUMN IF NOT EXISTS present boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS paye    boolean NOT NULL DEFAULT false;
