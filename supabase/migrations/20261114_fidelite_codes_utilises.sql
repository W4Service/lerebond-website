-- Fidélité : qui a utilisé son code, dans le suivi de l'admin (demande de Gaël, 01/11).
CREATE OR REPLACE FUNCTION public.fidelite_codes_utilises() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = fidelite, public AS $$
BEGIN
    IF NOT public.est_staff() THEN RAISE EXCEPTION 'réservé au staff' USING ERRCODE = '42501'; END IF;
    RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.utilise_le DESC) FROM (
        SELECT k.utilise_le, k.code, k.libelle, k.origine, k.choix, k.utilise_par, vp.prenom, vp.nom, vp.jeton
        FROM cadeaux k JOIN v_personnes vp ON vp.personne = k.personne
        WHERE k.statut = 'utilise' ORDER BY k.utilise_le DESC LIMIT 500) x), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.fidelite_codes_utilises() FROM public;
GRANT EXECUTE ON FUNCTION public.fidelite_codes_utilises() TO authenticated;
