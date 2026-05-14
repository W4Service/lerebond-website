-- Niveau padel d'une équipe, sur une échelle 1..10 (1 = débutant, 10 = expert).
-- Utilisé pour la répartition automatique en poules de niveau.
-- Plus tard on pourra mapper vers les classements FFT officiels.

ALTER TABLE equipes
    ADD COLUMN IF NOT EXISTS niveau smallint CHECK (niveau IS NULL OR (niveau BETWEEN 1 AND 10));
