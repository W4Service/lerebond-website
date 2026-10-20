// Vidéos : voir celles diffusées sur le site, et couper celles qu'on ne veut
// plus afficher (droit à l'image). Les vidéos étant hébergées par LiveXperience,
// le test vérifie surtout deux choses : qu'on sait lire leur liste, et qu'une
// vidéo coupée ne peut pas réapparaître côté public.
var fs = require('fs');
var ko = 0;
function check(n, c) { console.log((c ? '  ok   ' : '  FAIL ') + n); if (!c) ko++; }

var source = fs.readFileSync('../js/videos-source.js', 'utf8');
var admin = fs.readFileSync('../js/videos-admin.js', 'utf8');
var pub = fs.readFileSync('../js/videos-public.js', 'utf8');
var sql = fs.readFileSync('../supabase/migrations/20261025_videos_bloquees.sql', 'utf8');
var sqlT = fs.readFileSync('../supabase/migrations/20261025_terrains_bloques.sql', 'utf8');
var pageAdmin = fs.readFileSync('../live/admin/index.html', 'utf8');
var pageReplays = fs.readFileSync('../videos/replays/index.html', 'utf8');
var pageLive = fs.readFileSync('../videos/live/index.html', 'utf8');

console.log('=== La liste des vidéos est lue chez LiveXperience ===');
check('on interroge list_videos.asp, la source de leur galerie',
      /master\/list_videos\.asp/.test(source));
check('les filtres date et terrain sont transmis',
      /date=.*encodeURIComponent/.test(source) && /id_terrain=.*encodeURIComponent/.test(source));
check('les terrains sont nommés (Padel 1-3, Five)',
      /'3119': 'Padel 1'/.test(source) && /'3122': 'Five'/.test(source));
check('le HTML est lu avec un parseur, pas à coups de regex sur le balisage',
      /new DOMParser\(\)/.test(source));

console.log('\n=== Chaque vidéo est identifiée de façon stable ===');
// L'id LiveXperience ('408_3122_1626_20261015070004') est la clé du blocage :
// sans lui, impossible de garder une vidéo coupée d'une visite à l'autre.
check('l\'id_video est extrait de loadVideo(nom, id)',
      /loadVideo\\\(/.test(source) || /loadVideo\\\(/.test(source.replace(/\\\\/g, '\\')));
check('les doublons image+titre sont dédoublonnés par id', /if \(!id \|\| vues\[id\]\) return;/.test(source));
check('titre, terrain, date, durée et vignette sont repris',
      /titre:/.test(source) && /terrain:/.test(source)
      && /duree:/.test(source) && /vignette:/.test(source));
check('une date illisible ne produit pas « Invalid Date »',
      /isNaN\(d\.getTime\(\)\) \? null : d/.test(source));

console.log('\n=== La table des vidéos coupées ===');
check('la table existe', /CREATE TABLE IF NOT EXISTS videos_bloquees/.test(sql));
check('l\'id LiveXperience est la clé primaire', /id_video\s+text PRIMARY KEY/.test(sql));
check('le motif est conservé (droit à l\'image, erreur de cadrage…)', /motif\s+text/.test(sql));
check('le titre est recopié pour relire la liste sans LiveXperience', /titre\s+text/.test(sql));
check('lecture publique : la galerie doit savoir quoi masquer',
      /FOR SELECT TO anon, authenticated USING \(true\)/.test(sql));
check('écriture réservée au staff', /est_staff\(\)/.test(sql));
check('le risque « motif lisible publiquement » est documenté',
      /lisible\s*\n?\s*--\s*publiquement|publiquement/.test(sql));

console.log('\n=== Couper une vidéo, depuis l\'administration ===');
check('un onglet Vidéos existe', /id="tab-videos"/.test(pageAdmin));
check('il est branché au switcher', /videos:\s*\{ section: 'videos-section'/.test(pageAdmin));
check('le module est initialisé à l\'ouverture de l\'onglet',
      /tab === 'videos' && window\.VideosAdmin/.test(pageAdmin));
check('les deux scripts sont chargés',
      /js\/videos-source\.js/.test(pageAdmin) && /js\/videos-admin\.js/.test(pageAdmin));
check('couper écrit dans videos_bloquees', /from\('videos_bloquees'\)\.upsert/.test(admin));
check('réafficher supprime la ligne',
      /from\('videos_bloquees'\)\.delete\(\)\.eq\('id_video'/.test(admin));
check('le motif est demandé au blocage',
      /prompt\(/.test(admin) && /Droit à l\\?'image/.test(admin));
check('les vidéos coupées sont listées en premier', /Coupées du site/.test(admin));
check('l\'interface dit que la vidéo reste chez LiveXperience',
      /reste(nt)? en ligne chez/.test(admin));

console.log('\n=== Une vidéo coupée disparaît du site ===');
check('la galerie publique remplace l\'iframe', /hote\.innerHTML = ''/.test(pub));
check('les vidéos bloquées sont retirées de l\'affichage',
      /filter\(function \(v\) \{ return !bloquees\[v\.id\]; \}\)/.test(pub));
// Le point sensible : si on ne sait pas quoi masquer, mieux vaut l'ancienne
// iframe que notre galerie affichant une vidéo censée être coupée.
check('sans la liste des blocages, on garde l\'iframe (pas de fuite)',
      /if \(!videos \|\| !videos\.length \|\| !bloquees\) return;/.test(pub));
check('un échec de lecture renvoie null, distinct de « rien de coupé »',
      /return null;/.test(pub) && /console\.error\('\[videos\] blocages illisibles/.test(pub));
check('la page replays charge la galerie',
      /js\/videos-public\.js/.test(pageReplays)
      && /VideosPublic\.init\("\.replay-iframe-wrapper"\)/.test(pageReplays));
check('la page live aussi, avec son propre conteneur',
      /js\/videos-public\.js/.test(pageLive)
      && /VideosPublic\.init\("\.live-replays-iframe"\)/.test(pageLive));
check('le SDK Supabase est chargé sur les pages publiques',
      /js\/vendor\/supabase\.min\.js/.test(pageReplays)
      && /js\/supabase-client\.js/.test(pageReplays));

console.log('\n=== La vignette d\'une vidéo coupée n\'est pas réaffichée ===');
// Côté admin, une vidéo coupée est rendue sans sa vignette : on ne remontre pas
// l'image d'une personne qui a demandé son retrait.
check('la carte « bloquée » n\'inclut pas de vignette',
      /function carteBloquee\(b\) \{[\s\S]*?\n    \}/.test(admin)
      && !/carteBloquee[\s\S]*?video-carte__vignette[\s\S]*?\n    \}/.test(
            admin.slice(admin.indexOf('function carteBloquee'))));

console.log('\n=== Couper la diffusion en direct d\'un terrain ===');
// Un direct n'a pas d'identifiant de video : on coupe le terrain entier.
check('la table terrains_bloques existe', /CREATE TABLE IF NOT EXISTS terrains_bloques/.test(sqlT));
check('la cle est l\'id de terrain utilise par la page live',
      /terrain_id\s+text PRIMARY KEY/.test(sqlT));
check('lecture publique, ecriture staff',
      /FOR SELECT TO anon, authenticated USING \(true\)/.test(sqlT) && /est_staff\(\)/.test(sqlT));
check('les 4 bornes sont listees cote admin',
      /'wuilhome'/.test(admin) && /'five'/.test(admin)
      && /'w4s'/.test(admin) && /'wepe'/.test(admin));
check('couper ecrit dans terrains_bloques',
      /from\('terrains_bloques'\)\s*\n?\s*\.upsert/.test(admin));
check('retablir supprime la ligne',
      /from\('terrains_bloques'\)\.delete\(\)\.eq\('terrain_id'/.test(admin));
check('un interrupteur par terrain est rendu', /function sectionTerrains/.test(admin));
check('l\'admin dit que la camera continue de filmer',
      /continue\s*\n?\s*(\+ ')?de filmer|continue de filmer/.test(admin));

console.log('\n=== Un terrain coupe ne diffuse rien ===');
check('la page live lit les terrains coupes',
      /from\('terrains_bloques'\)/.test(pageLive));
check('la borne n\'est meme pas interrogee si le terrain est coupe',
      /if \(estBloque\(t\.id\)\) return Promise\.resolve\(\{ status: 'bloque' \}\)/.test(pageLive));
// Le point sensible : si on ne sait pas quels terrains sont coupes, on ne
// diffuse rien, plutot que de diffuser un terrain censé etre coupé.
check('liste inconnue = tout est considere coupe',
      /if \(terrainsBloques === null\) return true;/.test(pageLive));
check('un terrain coupe n\'est jamais traite comme live',
      /var liveOn = result\.status === 'live' && !bloque;/.test(pageLive));
check('le plein ecran est verrouille aussi',
      /if \(estBloque\(t\.id\)\) return;/.test(pageLive));
check('la coupure prend effet sans rechargement (relu a chaque tick)',
      /chargerBlocages\(\)\.then\(function \(\) \{/.test(pageLive));
check('la carte annonce « non diffuse »',
      /Terrain non diffus/.test(pageLive) && /live-badge off">Non diffus/.test(pageLive));
check('un terrain coupe n\'est pas compte comme une borne en panne',
      /else if \(r\.status === 'bloque'\) bloques\+\+/.test(pageLive));
check('les replays restent proposes si tous les terrains sont coupes',
      /bloques > 0\)/.test(pageLive));

console.log(ko === 0 ? '\nTous les tests passent.' : '\n' + ko + ' test(s) en échec.');
process.exit(ko === 0 ? 0 : 1);
