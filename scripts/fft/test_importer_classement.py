"""Tests de l'import du classement FFT : python3 -m unittest test_importer_classement (depuis scripts/fft)."""
import unittest

import importer_classement as imp


class SeparerNomPrenom(unittest.TestCase):
    def test_nom_compose_en_capitales(self):
        self.assertEqual(imp.separer_nom_prenom('GUY DE CHAMISSO Olivier'), ('GUY DE CHAMISSO', 'Olivier'))

    def test_prenom_compose_et_apostrophe(self):
        self.assertEqual(imp.separer_nom_prenom("N'DIAYE Jean-Pierre"), ("N'DIAYE", 'Jean-Pierre'))

    def test_accents_dans_le_nom(self):
        self.assertEqual(imp.separer_nom_prenom('LEFÈVRE Théo'), ('LEFÈVRE', 'Théo'))

    def test_tout_en_capitales(self):
        self.assertEqual(imp.separer_nom_prenom('DUPONT JULIEN'), ('DUPONT', 'JULIEN'))

    def test_casse_mixte(self):
        self.assertEqual(imp.separer_nom_prenom('Dupont Julien'), ('Dupont', 'Julien'))

    def test_espaces_parasites(self):
        self.assertEqual(imp.separer_nom_prenom('  MARTIN   Théo '), ('MARTIN', 'Théo'))


class Entier(unittest.TestCase):
    def test_formats(self):
        self.assertEqual(imp.entier('1 280'), 1280)
        self.assertEqual(imp.entier('1 280'), 1280)
        self.assertEqual(imp.entier('15e'), 15)
        self.assertEqual(imp.entier(42.0), 42)
        self.assertIsNone(imp.entier('NC'))
        self.assertIsNone(imp.entier(''))
        self.assertIsNone(imp.entier(None))


class Entetes(unittest.TestCase):
    def test_variantes_reconnues(self):
        m = imp.mapper_colonnes(['Rang', 'Nom Prénom', 'Nationalité', 'Points', 'Ligue', 'Club'])
        self.assertEqual(m, {'rang': 0, 'nom_complet': 1, 'nationalite': 2, 'points': 3, 'ligue': 4, 'club': 5})

    def test_nom_et_prenom_separes(self):
        m = imp.mapper_colonnes(['Classement', 'NOM', 'PRÉNOM', 'Pts'])
        self.assertEqual(m, {'rang': 0, 'nom': 1, 'prenom': 2, 'points': 3})

    def test_ligne_de_donnees_n_est_pas_un_entete(self):
        self.assertIsNone(imp.mapper_colonnes(['1', 'DUPONT Julien', '12 000']))


class ExtraireJoueurs(unittest.TestCase):
    def test_pages_pdf_avec_entete_repete_et_page_sans_entete(self):
        page1 = [['Rang', 'Joueur', 'Points', 'Ligue'],
                 ['1', 'GUICHARD Dylan', '20 000', 'IDF'],
                 ['2', 'LEYGUE Thomas', '19 500', None]]
        page2 = [['3', 'FONTENY Timéo', '19 000', 'HDF']]          # suite sans en-tête
        page3 = [['Rang', 'Joueur', 'Points', 'Ligue'],             # en-tête répété
                 ['', '', '', ''],                                 # ligne vide
                 ['15', 'TISON Benjamin', '3 280', 'HDF'],
                 ['15', 'SCATENA Jeremy', '1 000', 'HDF']]        # ex aequo
        joueurs = imp.extraire_joueurs([page1, page2, page3])
        self.assertEqual([j['rang'] for j in joueurs], [1, 2, 3, 15, 15])
        self.assertEqual(joueurs[2]['prenom'], 'Timéo')
        self.assertEqual(joueurs[0]['points'], 20000)
        self.assertIsNone(joueurs[1]['ligue'])

    def test_sans_entete_erreur_explicite(self):
        with self.assertRaises(ValueError):
            imp.extraire_joueurs([[['1', 'DUPONT Julien', '100']]])


class Csv(unittest.TestCase):
    def test_point_virgule_et_bom(self):
        contenu = '﻿Rang;Nom;Prénom;Points;Assimilé\n1;DUPONT;Julien;1 200;Oui\n2;MARTIN;Théo;900;non\n'.encode('utf-8')
        joueurs = imp.extraire_joueurs(imp.lire_csv(contenu))
        self.assertEqual(len(joueurs), 2)
        self.assertEqual((joueurs[1]['nom'], joueurs[1]['prenom'], joueurs[1]['points']), ('MARTIN', 'Théo', 900))
        self.assertIs(joueurs[0]['assimile'], True)
        self.assertIs(joueurs[1]['assimile'], False)

    def test_virgule(self):
        joueurs = imp.extraire_joueurs(imp.lire_csv('rang,joueur,points\n7,DURAND Léa,500\n'))
        self.assertEqual((joueurs[0]['rang'], joueurs[0]['nom']), (7, 'DURAND'))

    def test_le_repli_ne_modifie_pas_csv_excel(self):
        imp.lire_csv('x')
        self.assertEqual(imp.csv.excel.delimiter, ',')


class GenreMois(unittest.TestCase):
    def test_noms_de_fichiers(self):
        self.assertEqual(imp.detecter_genre_mois('classement_padel_france_homme_2026_04_avril.pdf'), ('H', '2026-04-01'))
        self.assertEqual(imp.detecter_genre_mois('/x/Classement-Padel-Dames-2026-10.xlsx'), ('F', '2026-10-01'))
        self.assertEqual(imp.detecter_genre_mois('classement.pdf'), (None, None))


if __name__ == '__main__':
    unittest.main()
