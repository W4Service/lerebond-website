/*
 * Repli « gap » pour les vieux moteurs web des box TV (Chrome 66 sur la box cuisine,
 * Chrome 80 aux vestiaires) : ils ne gèrent pas `gap` dans les boîtes flex (Chrome ≥ 84),
 * les éléments se collent. Si le navigateur ne le gère pas, on remplace le gap par des
 * marges sur les enfants, y compris pour le contenu ajouté plus tard en JS.
 * Sur un navigateur récent, ce script ne fait rien.
 */
(function () {
  function supporte() {
    var d = document.createElement('div');
    d.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden';
    d.appendChild(document.createElement('div'));
    d.appendChild(document.createElement('div'));
    document.body.appendChild(d);
    var ok = d.scrollHeight === 1;
    document.body.removeChild(d);
    return ok;
  }

  function px(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }

  function appliquer() {
    var tous = document.body.getElementsByTagName('*');
    for (var i = 0; i < tous.length; i++) {
      var el = tous[i], cs = getComputedStyle(el);
      if (cs.display !== 'flex' && cs.display !== 'inline-flex') continue;
      var col = cs.flexDirection.indexOf('column') === 0;
      var g = px(col ? (cs.rowGap || cs.gridRowGap) : (cs.columnGap || cs.gridColumnGap));
      if (!g) continue;
      var premier = true;
      for (var k = 0; k < el.children.length; k++) {
        var c = el.children[k], ccs = getComputedStyle(c);
        if (ccs.display === 'none' || ccs.position === 'absolute' || ccs.position === 'fixed') continue;
        var prop = col ? 'marginTop' : 'marginLeft';
        if (c.getAttribute('data-fg') === null) c.setAttribute('data-fg', String(px(ccs[prop])));
        var base = px(c.getAttribute('data-fg'));
        c.style[prop] = (premier ? base : base + g) + 'px';
        premier = false;
      }
    }
  }

  function demarrer() {
    if (supporte()) return;
    document.documentElement.className += ' no-flexgap';
    appliquer();
    var t = null;
    new MutationObserver(function () {
      clearTimeout(t); t = setTimeout(appliquer, 150);
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer);
  else demarrer();
})();
