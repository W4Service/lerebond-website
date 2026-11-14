#!/usr/bin/env python3
"""Génère css/admin-pilotage.css : l'admin (thème sombre bordeaux) aux couleurs du pilotage
(fond crème, cartes claires, accents bordeaux), appliqué seulement en mode intégré (html.integre).

Les feuilles de l'admin n'ont pas de variables de couleur : on relit chaque règle de css/live.css et
css/tournoi.css et on réécrit ses couleurs selon une table de correspondance. À relancer après toute
modification de ces feuilles :  python3 scripts/admin-theme/generer.py
"""
import re, pathlib

RACINE = pathlib.Path(__file__).resolve().parents[2]
SOURCES = ["css/live.css", "css/tournoi.css", "css/americano.css"]
SORTIE = RACINE / "css/admin-pilotage.css"

ENCRE, ENCRE2, SURFACE, CREME = (42, 26, 30), (101, 86, 90), (255, 253, 248), (244, 240, 230)
BORDEAUX, BORDEAUX2, JAUNE = (138, 16, 48), (104, 9, 32), (244, 201, 65)

def rgba(c, a=1.0):
    a = max(0.0, min(1.0, a))
    return "#%02x%02x%02x" % c if a >= 0.999 else "rgba(%d,%d,%d,%.3g)" % (*c, a)

def lire(s):
    s = s.strip().lower()
    m = re.fullmatch(r"#([0-9a-f]{3,8})", s)
    if m:
        h = m.group(1)
        if len(h) in (3, 4): h = "".join(x * 2 for x in h)
        c = tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
        return c, (int(h[6:8], 16) / 255 if len(h) == 8 else 1.0)
    m = re.fullmatch(r"rgba?\(([^)]*)\)", s)
    if m:
        p = [x.strip() for x in re.split(r"[,/ ]+", m.group(1)) if x.strip()]
        c = tuple(int(float(x)) for x in p[:3])
        a = float(p[3].rstrip("%")) / (100 if p[3].endswith("%") else 1) if len(p) > 3 else 1.0
        return c, a
    return None

def lum(c): return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255

def famille(c):
    r, g, b = c
    if lum(c) > 0.82 and max(c) - min(c) < 40: return "clair"          # crème, blanc, gris clair
    if r > 200 and g > 140 and b < 120: return "jaune" if g > 180 else "orange"
    if r > 180 and g < 90 and b < 90: return "rouge"
    if g > 150 and r < 200 and b < 200 and g > r: return "vert"
    if lum(c) < 0.18: return "sombre"
    if max(c) - min(c) < 30: return "gris"
    return "autre"

def texte(c, a, fond_bordeaux):
    f = famille(c)
    if fond_bordeaux: return rgba((255, 255, 255), a)
    if f == "clair": return rgba(ENCRE, min(1, a + 0.15)) if a < 0.999 else rgba(ENCRE)
    if f in ("jaune", "orange"): return rgba(BORDEAUX, max(a, 0.85))
    if f == "rouge": return rgba((179, 38, 30), max(a, 0.9))
    if f == "vert": return rgba((30, 125, 79), max(a, 0.9))
    if f == "gris": return rgba(ENCRE2, a)
    return None                                                       # sombre / autre : inchangé

def fond(c, a):
    f = famille(c)
    if f == "clair": return rgba(SURFACE, a) if a >= 0.5 else rgba(BORDEAUX2, a * 0.55)
    if f == "sombre": return rgba(SURFACE, 1) if a >= 0.5 else rgba(ENCRE, a * 0.25)
    if c == BORDEAUX2 or (lum(c) < 0.25 and c[0] > c[1] + 40): return rgba(SURFACE, a) if a >= 0.5 else rgba(BORDEAUX2, a * 0.4)
    if f == "orange": return rgba(BORDEAUX, a) if a >= 0.5 else rgba(BORDEAUX, a * 0.6)
    if f == "jaune": return rgba(JAUNE, a) if a >= 0.5 else rgba(JAUNE, min(1, a * 1.6))
    return None

def bord(c, a):
    f = famille(c)
    if f == "clair": return rgba(BORDEAUX2, min(1, a * 1.3 + 0.08))
    if f in ("jaune", "orange"): return rgba(BORDEAUX, max(a, 0.5))
    if f == "sombre": return rgba((230, 223, 210), 1)
    return None

COULEUR = re.compile(r"#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)")

def convertir(prop, valeur, fond_bordeaux):
    def remp(fn):
        def f(m):
            l = lire(m.group(0))
            r = fn(*l) if l else None
            return r if r else m.group(0)
        return f
    if prop in ("color", "fill", "stroke", "caret-color", "-webkit-text-stroke-color"):
        fn = lambda c, a: texte(c, a, fond_bordeaux)
    elif prop in ("background", "background-color", "background-image"):
        fn = fond
    elif prop.startswith("border") or prop.startswith("outline"):
        fn = bord
    else:
        return None
    nv = COULEUR.sub(remp(fn), valeur)
    return nv if nv != valeur else None

def blocs(css):
    """Découpe en (entête, corps) en respectant les @media imbriqués."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    i, n, out = 0, len(css), []
    while i < n:
        j = css.find("{", i)
        if j < 0: break
        tete = css[i:j].strip()
        d, k = 1, j + 1
        while k < n and d:
            d += {"{": 1, "}": -1}.get(css[k], 0); k += 1
        out.append((tete, css[j + 1:k - 1])); i = k
    return out

def prefixer(sel):
    parts = []
    for s in sel.split(","):
        s = s.strip()
        if not s: continue
        if s in ("html", ":root"): parts.append("html.integre")
        elif s.startswith("html"): parts.append("html.integre" + s[4:])
        else: parts.append("html.integre " + s)
    return ", ".join(parts)

def regles(css):
    out = []
    for tete, corps in blocs(css):
        if tete.startswith("@media") or tete.startswith("@supports"):
            inner = regles(corps)
            if inner: out.append(tete + " {\n" + "\n".join("  " + r for r in inner) + "\n}")
            continue
        if tete.startswith("@"): continue
        decls = [d.strip() for d in corps.split(";") if ":" in d]
        props = {d.split(":", 1)[0].strip().lower(): d.split(":", 1)[1].strip() for d in decls}
        # fond orange/jaune vif converti en bordeaux : le texte de la règle passe en blanc
        bg = props.get("background", props.get("background-color", ""))
        fond_b = any((l := lire(m)) and famille(l[0]) == "orange" and l[1] >= 0.5 for m in COULEUR.findall(bg))
        nouv = []
        for p, v in props.items():
            v2 = convertir(p, v.replace("!important", "").strip(), fond_b)
            if v2: nouv.append(f"{p}: {v2} !important")
        if fond_b and "color" not in props: nouv.append("color: #fff !important")
        if nouv: out.append(prefixer(tete) + " { " + "; ".join(nouv) + "; }")
    return out

FIXES = """
/* Page : fond crème du pilotage, sans les décors du thème sombre */
html.integre, html.integre body.live-body { background: #f4f0e6 !important; color: #2a1a1e !important; }
html.integre .live-body::before, html.integre .live-body::after { display: none !important; }
html.integre .admin-topbar { background: transparent !important; border: 0 !important; box-shadow: none !important; }
html.integre input:not([type=checkbox]):not([type=radio]), html.integre select, html.integre textarea {
  background: #fff !important; color: #2a1a1e !important; border: 1px solid #cfc6b6 !important; }
html.integre ::placeholder { color: #8b7d80 !important; }
html.integre h1, html.integre h2, html.integre h3 { color: #680920 !important; }
/* Titres en Kanit, comme le pilotage (l'ancien admin utilisait Turret Road) */
html.integre h1, html.integre h2, html.integre h3, html.integre .live-title, html.integre .topbar-label,
html.integre [class*="titre"], html.integre [class*="title"] { font-family: Kanit, sans-serif !important; }
html.integre table th { color: #65565a !important; }
html.integre table td, html.integre table th { border-color: #e6dfd2 !important; }
/* Americano : la déconnexion passe par le pilotage */
html.integre #am-logout, html.integre #am-user-email { display: none !important; }
/* Styles écrits directement dans le code JavaScript (les plus fréquents) */
html.integre [style*="color:#efa707"], html.integre [style*="color: #efa707"] { color: #8a1030 !important; }
html.integre [style*="background:#efa707"], html.integre [style*="background: #efa707"] { background: #8a1030 !important; color: #fff !important; }
html.integre [style*="color:#f4f0e6"], html.integre [style*="color: #f4f0e6"],
html.integre [style*="color:rgba(244,240,230"], html.integre [style*="color:#eee"] { color: #2a1a1e !important; }
html.integre [style*="background:rgba(244,240,230"] { background: rgba(104,9,32,.05) !important; }
html.integre [style*="background:rgba(0,0,0"], html.integre [style*="background:#222"] { background: rgba(42,26,30,.05) !important; }
html.integre [style*="color:#8fd694"], html.integre [style*="color:#7ee06a"] { color: #1e7d4f !important; }
html.integre [style*="color:#ff9b8f"] { color: #b3261e !important; }
"""

if __name__ == "__main__":
    lignes = ["/* Généré par scripts/admin-theme/generer.py : ne pas modifier à la main. */",
              "/* Admin du site affiché dans le pilotage (html.integre) aux couleurs du pilotage. */"]
    for src in SOURCES:
        lignes.append(f"\n/* ---- d'après {src} ---- */")
        lignes += regles((RACINE / src).read_text(encoding="utf-8"))
    lignes.append(FIXES)
    SORTIE.write_text("\n".join(lignes) + "\n", encoding="utf-8")
    print(SORTIE, sum(1 for l in lignes if "{" in l), "règles")
