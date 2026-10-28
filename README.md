# Kit Rush 3D

Un jeu de plateforme 3D rapide qui se joue directement dans le navigateur, sur PC comme sur téléphone.
Tu incarnes **Kit**, un renard pressé, à travers deux actes :

- **Acte 1 — Collines Émeraude** : collines vertes, loopings, ressorts, ennemis robots et un combat contre le **Dr Boulon**.
- **Acte 2 — San Francisco** : une descente en skateboard dans les rues en pente, au milieu des voitures, des tramways et des chantiers. Au bout de la jetée, un bumper t'envoie voler comme un super-héros au-dessus de la baie, avec un ralenti et un tour de caméra à 360°.

![Écran titre](docs/screenshots/titre.jpg)

## Quoi de neuf dans la version 3

Le jeu (les niveaux, les commandes, les règles) est exactement le même que dans la version 2 : c'est le rendu qui
change complètement.

- **Nouveau moteur de rendu** : three.js r186 et son `WebGPURenderer`. Le jeu utilise **WebGPU** quand le navigateur
  le propose, et passe tout seul sur **WebGL 2** sinon. Tous les effets sont écrits en TSL (le langage de shaders de
  three.js), qui fonctionne sur les deux.
- **Kit** : corps lisse et sculpté, vraie fourrure (couches de poils qui bougent avec le vent et la vitesse), queue
  touffue, yeux avec iris, reflets et paupières qui clignent, écharpe tricotée, lumière qui traverse un peu la
  fourrure. Skateboard détaillé (plateau en érable, grip, trucks, roues).
- **Collines Émeraude** : ciel avec de vrais nuages, herbe en brins qui ondule, palmiers, tournesols et rochers
  détaillés, falaises en damier en roche et terre, eau avec reflets, caustiques et écume, ombres en cascade.
- **San Francisco** : maisons victoriennes en bois avec fenêtres qui montrent des pièces, rues en asphalte avec
  fissures, flaques qui reflètent le ciel, tramways et câbles, pont rouge détaillé, baie au coucher du soleil.
- **Véhicules** : berlines, taxis, camionnettes, bus, cable-car, tramway et barrières de chantier entièrement
  remodelés (carrosserie arrondie, vitres, jantes, phares qui brillent, peinture vernie à paillettes).
- **Anneaux, robots, ressorts, écrans bonus, boss** : métal poli, peinture vernie, yeux lumineux, dôme en verre.
- **Image de type « moteur de jeu moderne »** : occlusion ambiante, éclairage indirect (Ultra), réflexions à l'écran
  (eau, flaques, carrosseries), anti-crénelage temporel, halos lumineux, rayons de soleil et reflets d'objectif,
  profondeur de champ dans les cinématiques, flou de mouvement à grande vitesse, étalonnage de type film.
- **Textures générées** : toutes les textures (herbe, roche, sable, asphalte, bois, briques, fourrure…) sont
  calculées par nos propres scripts (`tools/tex/`), aucune image téléchargée.

## Jouer

- **En ligne** : https://dje2k1.github.io/Pat3d/
- **Navigateurs** : un navigateur récent (Chrome, Edge, Firefox ou Safari). Le menu Pause affiche le moteur utilisé
  (« Rendu : WebGPU » ou « Rendu : WebGL 2 »). Ajouter `?gl` à l'adresse force WebGL 2.
- **Version classique** : si le jeu ne démarre pas ou rame trop sur ton appareil, la version 2 (plus légère, three.js
  r128) reste disponible dans `legacy/`, via la ligne « Version classique » du menu Pause ou le lien de l'écran
  d'erreur.
- **En local** : les modules JavaScript ne se chargent pas depuis un fichier ouvert directement (`file://`), il faut un
  petit serveur : `node test/serve.js 8080` puis http://127.0.0.1:8080/ (n'importe quel serveur de fichiers statiques
  convient). Le jeu fonctionne aussi depuis un sous-dossier, comme `/Pat3d/` sur GitHub Pages.

Sur l'écran titre, choisis l'acte avec ← → puis appuie sur Espace. Finir l'acte 1 enchaîne directement sur l'acte 2.

## Commandes

| | Clavier | Téléphone | Manette |
|---|---|---|---|
| **Acte 1** — courir | ZQSD / WASD ou flèches | joystick | stick gauche |
| sauter, puis attaque téléguidée en l'air | Espace | SAUT | A |
| rouler / super élan | Maj / Maj + Espace | ROULER / ROULER + SAUT | B ou X |
| caméra | souris ou A / E (Q / E en QWERTY) | glisser l'écran | stick droit |
| **Acte 2** — se pencher, freiner | Q / D (A / D) ou flèches | joystick | stick gauche |
| ollie (maintenir = plus haut) | Espace | SAUT | A |
| figure en l'air | Espace en l'air (+ direction) | SAUT en l'air | A en l'air |
| se baisser | Maj | ROULER | B ou X |
| voler après le bumper | flèches | joystick | stick gauche |
| pause, réglages graphiques | Échap | bouton pause | Start |

Les textes d'aide du jeu s'adaptent à la disposition du clavier (AZERTY ou QWERTY) et à l'appareil utilisé.
Sur téléphone, joue en paysage.

## Graphismes : niveaux de qualité et Super Résolution

Le menu Pause propose quatre niveaux de qualité, mémorisés d'une partie à l'autre :

| Niveau | Pour qui | Ce qu'il contient |
|---|---|---|
| **Ultra** | PC puissant | tout : éclairage indirect et occlusion (SSGI), réflexions, ombres en cascade, fourrure à 16 couches, herbe dense, textures complètes |
| **Élevé** | PC (par défaut) | occlusion ambiante, réflexions, ombres en cascade, rayons de soleil, fourrure à 10 couches |
| **Moyen** | téléphone (par défaut) | occlusion ambiante, une ombre qui suit Kit, fourrure à 6 couches, moins d'herbe, textures allégées |
| **Économie** | petite configuration | rendu simple et rapide : halo léger, anti-crénelage FXAA, pas de fourrure ni de brins d'herbe |

**Super Résolution** (Oui / Non) : l'image est calculée en plus petit (de 60 à 85 % selon le niveau) puis agrandie et
ré-affinée avec AMD FSR 1, dans l'esprit du DLSS (le vrai DLSS ne fonctionne pas dans un navigateur). Activée par
défaut sur téléphone. Si ça rame, active-la ou descends d'un niveau.

| | |
|---|---|
| ![Départ de l'acte 1](docs/screenshots/acte1-depart.jpg) | ![Looping](docs/screenshots/acte1-looping.jpg) |
| ![Combat contre le Dr Boulon](docs/screenshots/acte1-boss.jpg) | ![Descente dans San Francisco](docs/screenshots/acte2-rue.jpg) |
| ![Chantier au milieu de la rue](docs/screenshots/acte2-chantier.jpg) | ![Bumper et tour de caméra](docs/screenshots/acte2-bumper-orbite.jpg) |
| ![Vol au-dessus de la baie](docs/screenshots/acte2-vol.jpg) | |

## Organisation du code

La page `index.html` est assemblée à partir des fichiers de `src/` (un seul module JavaScript) :

| Fichier | Rôle |
|---|---|
| `src/00-shell.html` | page, styles, interface (HUD, boutons tactiles), écran d'erreur avec le lien vers la version classique |
| `src/10-core.js` | moteur de rendu (WebGPU / WebGL 2), entrées clavier/tactile/manette, audio et musique générés |
| `src/12-tex.js` | chargement des textures générées (jeux complet et allégé) |
| `src/15-post.js` | post-traitement, niveaux de qualité, Super Résolution |
| `src/16-vfx.js` | particules et effets spéciaux |
| `src/20-world.js` | décor de l'acte 1 (terrain, ciel, herbe, végétation, eau, loopings) |
| `src/25-city.js` | ville de l'acte 2 (rues, maisons, pont, baie, circulation, jetée) |
| `src/26-vehicles.js` | modèles et matériaux des véhicules |
| `src/30-player.js` | Kit : physique, animations, fourrure, caméra |
| `src/35-board.js` | skateboard, figures et vol après le bumper |
| `src/40-entities.js` | anneaux, ennemis, ressorts, écrans bonus, boss |
| `src/90-main.js` | écrans, chargement, enchaînement des actes, menus, résultats, records |

Autres dossiers : `lib/three/` (three.js 0.186.1, copie locale : aucun CDN n'est utilisé à part la police),
`assets/tex/` (textures WebP générées), `tools/tex/` (les scripts Python qui les génèrent), `legacy/` (la version 2,
figée), `test/` (tests automatiques). `docs/SPEC.md`, `docs/SPEC2.md` et `docs/SPEC3.md` décrivent la conception en
détail (en anglais).

### Construire

```sh
./build.sh
```

Le script vérifie chaque fichier (modules valides, aucun reste de GLSL, imports présents dans `lib/`, aucune adresse
externe sauf la police) et produit :

- `index.html` : la page jouable (celle publiée sur GitHub Pages) ;
- `test.html` : une version pour les tests (non versionnée).

Pour régénérer toutes les textures (Python 3 avec numpy et Pillow) : `tools/tex/make.sh`.

### Tester

```sh
npm install
npx playwright install chromium
./build.sh
npm test              # tous les tests sur le moteur WebGL 2
npm run test:webgpu   # les tests WebGPU
```

`test/e2e.js` lance le jeu dans Chromium sans écran (rendu logiciel) et joue les deux actes : parcours, loopings,
boss, skateboard, vol, post-traitement et niveaux de qualité, budgets de performance, textures, téléphone, version
classique (__CHECKS__ vérifications, dont les 74 de la version 2). Compte environ __MINUTES__ minutes, car tout est
dessiné par le processeur.

## Activer GitHub Pages

Dans le dépôt sur GitHub : **Settings → Pages → Build and deployment**, choisis **Deploy from a branch**,
puis la branche **main** et le dossier **/ (root)**, et clique sur **Save**. Après une minute ou deux, le jeu est en
ligne à l'adresse https://dje2k1.github.io/Pat3d/.

## Crédits

- Personnages, niveaux, musique, effets sonores et textures originaux, créés avec Claude (Anthropic).
- [three.js](https://threejs.org) r186 (0.186.1), licence MIT (copie dans `lib/three/`) ; la version classique
  utilise three.js r128.
- AMD FidelityFX Super Resolution 1 (FSR 1), via les nœuds de post-traitement de three.js.
- Police [Lilita One](https://fonts.google.com/specimen/Lilita+One) via Google Fonts, licence SIL Open Font.
