#!/usr/bin/env python3
"""Régénère les pages téléchargeables de la carte : menu/5.png à 9.png et menu/menu.pdf.

Les plats et les prix sont ceux de menu/index.html : tout changement de carte
se fait aux deux endroits, puis on relance ce script.
"""
import html
import os
import subprocess
import tempfile

from PIL import Image

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.dirname(os.path.dirname(ICI))
MENU = os.path.join(RACINE, "menu")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
L, H = 1414, 2000


def ligne(nom, prix, desc=None, sub=False):
    return ("sub" if sub else "item", nom, prix, desc)


PAGES = [
    [
        ("h2", "Nos Pizzas Maison"),
        ligne("Margherita", "9 €", "Mozzarella, sauce tomate"),
        ligne("Pepperoni", "10 €", "Mozzarella, sauce tomate, pepperoni"),
        ligne("Calzone", "10 €", "Sauce tomate, mozzarella, jambon fumé"),
        ligne("4 Fromages", "12 €", "Mozzarella, chèvre, roquefort, parmesan"),
        ligne("Américaine", "12 €", "Sauce tomate, mozzarella, viande hachée, cheddar, œuf"),
        ligne("Parma", "12 €", "Sauce tomate, mozzarella, jambon de pays, stracciatella"),
        ligne("Chèvre Miel", "13 €", "Mozzarella, chèvre, miel, cerneaux de noix"),
        ("h2", "Pâtes Fraîches & Sauces Maison"),
        ("note", "Au choix : Fusilli, Penne, Tagliatelle ou Gnocchi"),
        ligne("Bolognaise", "9,50 €"),
        ligne("Carbonara", "9,50 €"),
        ligne("Saumon fumé", "9,50 €"),
        ligne("Formule Pâtes + Soda", "11,50 €"),
        ("h2", "Frites Maison"),
        ligne("Portion de Frites Maison", "5 €"),
        ligne("Frites + Bière Le Rebond", "7,50 €"),
    ],
    [
        ("h2", "Paninis & Croque"),
        ligne("Poulet Emmental", "6 €"),
        ligne("3 Fromages", "6 €"),
        ligne("Croque Monsieur", "6 €"),
        ("h2", "Nos Menus"),
        ligne("Menu Panini + Frites/Salade", "9,50 €"),
        ligne("Menu Croque + Frites/Salade", "9,50 €"),
        ("h2", "Tenders de Poulet"),
        ligne("4 Tenders", "6 €"),
        ligne("6 Tenders", "9 €"),
        ligne("Supplément frites", "+ 3 €", sub=True),
        ligne("Supplément boisson et frites", "+ 5 €", sub=True),
        ("h2", "À Partager"),
        ligne("Planche Tex-Mex", "18 €", "Tenders, onion rings, mozza sticks, mini taquitos"),
        ligne("Saucisson à partager", "6,50 €", "Classique, Beaufort, Poivre"),
        ("h2", "Suppléments"),
        ("note", "À ajouter à n'importe quel plat de la carte"),
        ligne("Burrata", "+ 3 €"),
        ligne("Œuf", "+ 1 €"),
    ],
    [
        ("h2", "Desserts"),
        ligne("Panini Nutella", "4 €"),
        ligne("Gaufre Nutella", "4 €"),
        ligne("Gaufre Nutella Banane", "4,50 €"),
        ligne("Gaufre Nutella Banane Chantilly", "5 €"),
        ligne("Pizza Nutella Banane", "8 €"),
        ligne("Part de Flan", "3 €"),
        ligne("Supplément boule de glace", "+ 1,50 €", sub=True),
        ("h2", "Glaces Artisanales"),
        ("table", ["1 boule", "2 boules", "3 boules"], [
            ("Crèmes glacées", "Vanille • Chocolat • Café • Pistache • Caramel beurre salé • Pâte à tartiner • Nougat", ["2,50 €", "4,50 €", "6 €"]),
            ("Sorbets", "Fraise • Pêche • Ananas • Citron • Passion • Mangue • Noix de coco", ["2,50 €", "4,50 €", "6 €"]),
        ]),
        ("h3", "Suppléments"),
        ligne("Chantilly", "1 €"),
        ligne("Coulis", "0,50 €"),
        ("h3", "Coupes Glacées"),
        ligne("Dame Blanche", "7,50 €", "3 boules vanille, coulis chocolat, chantilly, amandes"),
        ligne("Coupe Exotique", "7,50 €", "Sorbet mangue, ananas, passion, coulis fruits rouges"),
        ligne("Coupe Fraîcheur", "7,50 €", "Sorbet fraise, citron et pêche, coulis fruits rouges"),
    ],
    [
        ("h2", "Boissons"),
        ligne("Café en capsule", "1 €"),
        ligne("Eau en bouteille (verre)", "3,50 €"),
        ligne("Eau en plastique (1,5 L)", "2 €"),
        ligne("Eau 50 cl", "1 €"),
        ("h2", "Softs"),
        ligne("Au choix", "2,50 €", "Coca-Cola • Coca Zéro • Coca Cherry • Oasis • Fuze Tea • Sprite"),
        ("h2", "Jus de Fruits Granini (25 cl)"),
        ligne("Au choix", "3,50 €", "ACE • Pomme bio • Ananas • Mangue • Abricot • Litchi • Orange bio • Multifruit • Fraise"),
        ("h2", "Red Bull (25 cl)"),
        ligne("Au choix", "3,50 €", "Classique • Zéro • Abricot-Fraise • Pêche Blanche"),
        ("h2", "Powerade (50 cl)"),
        ligne("Au choix", "3,50 €", "Bleu • Cerise"),
    ],
    [
        ("h2", "Bières Pression"),
        ("table", ["25 cl", "50 cl"], [
            ("Le Rebond Blonde", None, ["3,50 €", "6 €"]),
            ("Anosteké Blonde", None, ["4,50 €", "8 €"]),
            ("IPA", None, ["4,50 €", "8 €"]),
            ("Rouge", None, ["4 €", "7,50 €"]),
            ("Triple", None, ["4,50 €", "8 €"]),
        ]),
        ("h2", "Girafes & Bouteilles"),
        ligne("Le Rebond Blonde (girafe)", "30 €"),
        ligne("Anosteké Blonde (girafe)", "45 €"),
        ligne("IPA (girafe)", "45 €"),
        ligne("Chouffe sans alcool", "5 €"),
        ligne("Hoegaarden Blanche", "5 €"),
        ligne("Desperados", "6 €"),
        ("h2", "Vins"),
        ("table", ["Verre", "Bouteille"], [
            ("Uby N°3", None, ["4 €", "16 €"]),
            ("Uby N°4", None, ["5 €", "22 €"]),
            ("Côtes du Rhône", None, ["4 €", "6 €"]),
            ("Lussac St-Émilion", None, ["16 €", "27 €"]),
            ("Rosé", None, ["4 €", "14 €"]),
        ]),
        ("note", "Suppléments : Picon + 1 € • Sirop + 0,50 €"),
    ],
]

CSS = """
@font-face{font-family:Kanit;font-weight:400;src:url(%(f)s/Kanit-Regular.ttf)}
@font-face{font-family:Kanit;font-weight:400;font-style:italic;src:url(%(f)s/Kanit-Italic.ttf)}
@font-face{font-family:Kanit;font-weight:700;src:url(%(f)s/Kanit-Bold.ttf)}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1414px;height:2000px;overflow:hidden;font-family:Kanit,sans-serif;color:#111}
body{background:url(%(fond)s) 0 0/1414px 2000px no-repeat;position:relative}
#carte{position:absolute;left:67px;top:220px;width:1280px;height:1555px;background:#fff;border-radius:60px;padding:30px 70px;display:flex;flex-direction:column}
h2{font-weight:700;font-size:42px;line-height:1.2;padding-bottom:10px;margin-top:30px;border-bottom:2px solid #d9792b}
h2:first-child{margin-top:0}
h3{font-weight:700;font-size:32px;margin-top:24px}
.note{font-style:italic;font-size:26px;margin-top:8px}
.r{display:grid;grid-template-columns:1fr auto;column-gap:40px;align-items:baseline;font-size:32px;line-height:1.25;margin-top:13px}
.r.sub{font-size:28px;color:#444}
.r .p{white-space:nowrap}
.r .d{grid-column:1/-1;font-style:italic;font-size:26px;line-height:1.2}
.t{display:grid;column-gap:30px;row-gap:14px;align-items:baseline;font-size:32px;line-height:1.25;margin-top:14px}
.t .n{white-space:nowrap;text-align:right}
.t .h{font-weight:700;font-size:28px}
.t .d{display:block;font-style:italic;font-size:26px;line-height:1.2}
"""


def rendre_bloc(b):
    e = html.escape
    if b[0] == "h2":
        return f"<h2>{e(b[1])}</h2>"
    if b[0] == "h3":
        return f"<h3>{e(b[1])}</h3>"
    if b[0] == "note":
        return f'<p class="note">{e(b[1])}</p>'
    if b[0] == "table":
        _, tetes, lignes = b
        cols = f"1fr repeat({len(tetes)},130px)"
        cel = "<span></span>" + "".join(f'<span class="n h">{e(t)}</span>' for t in tetes)
        for nom, desc, prix in lignes:
            d = f'<span class="d">{e(desc)}</span>' if desc else ""
            cel += f"<span>{e(nom)}{d}</span>" + "".join(f'<span class="n">{e(p)}</span>' for p in prix)
        return f'<div class="t" style="grid-template-columns:{cols}">{cel}</div>'
    genre, nom, prix, desc = b
    d = f'<span class="d">{e(desc)}</span>' if desc else ""
    return f'<div class="r{" sub" if genre == "sub" else ""}"><span>{e(nom)}</span><span class="p">{e(prix)}</span>{d}</div>'


def main():
    fonts = "file://" + os.path.join(RACINE, "fonts")
    fond = "file://" + os.path.join(ICI, "fond.png")
    css = CSS % {"f": fonts, "fond": fond}
    pngs = []
    with tempfile.TemporaryDirectory() as tmp:
        for i, blocs in enumerate(PAGES):
            corps = "".join(rendre_bloc(b) for b in blocs)
            page = os.path.join(tmp, f"p{i}.html")
            with open(page, "w", encoding="utf-8") as f:
                f.write(f'<!doctype html><meta charset="utf-8"><style>{css}</style><div id="carte">{corps}</div>')
            sortie = os.path.join(MENU, f"{i + 5}.png")
            subprocess.run(
                [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files",
                 "--force-device-scale-factor=1", f"--window-size={L},{H}", "--virtual-time-budget=3000",
                 f"--screenshot={sortie}", f"file://{page}"],
                check=True, capture_output=True,
            )
            pngs.append(sortie)
    images = [Image.open(p).convert("RGB") for p in pngs]
    images[0].save(os.path.join(MENU, "menu.pdf"), save_all=True, append_images=images[1:], resolution=170, quality=88)
    print("\n".join(pngs))


if __name__ == "__main__":
    main()
