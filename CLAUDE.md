# Hub des jeux : mémoire du repo

À lire au début de chaque session qui touche à la distribution, au marketing ou au suivi des jeux.

## Rôle de ce repo

Ce repo (`Jeu-Autres`) sert à tout ce qui est **autour** des jeux : distribution, marketing, stratégie de sortie et de
croissance. Claude y lit l'état de tous les jeux (catalogue ci-dessous) pour conseiller King sur la stratégie à adopter
pour chacun. Avant tout travail de ce type, lire dans `roussetaubin/Apprentissage` : `CLAUDE.md`, `promotion.md`,
`marche-et-succes.md`, `echo.md` (section règles de plateformes).

- Vue d'ensemble de tous les jeux de King (`README.md` = catalogue, `games.json` = mêmes données pour les machines).
- Les deux sont **générés** par `scripts/sync.mjs` (GitHub Action toutes les 6 h, ou à la demande). Ne pas les éditer à la main.
- `jeux/<slug>/` : le **code seul** des jeux « fini » ou « publie ». Réécrit par la synchronisation : ne rien y modifier ici,
  les corrections se font dans le repo du jeu.
- `distribution/<slug>/` : tout ce qui n'est pas le jeu (stores, fiches, marketing, lancement). C'est **notre** espace,
  la synchronisation n'y touche jamais.
- La construction des jeux elle-même se fait dans les discussions et repos de chaque jeu, pas ici.
  Contexte et méthode de création : repo `roussetaubin/Apprentissage` (listé dans `games.config.json`, rubrique `contexte`).
- Objectif de King : des jeux publiés, populaires, qui rapportent. Les conseils de stratégie visent ça, avec des chiffres
  et des sources quand ils existent, et sans jamais de faux avis, faux comptes ni promesse absente du jeu.

## Changer l'état d'un jeu

Tout est dans `games.config.json`, champ `statut` :

| Statut | Effet |
|---|---|
| `en-cours` | suivi dans le catalogue, pas de code copié |
| `fini` | son code est copié dans `jeux/<slug>/` et reste à jour |
| `publie` | comme `fini` (sorti sur au moins une plateforme) |

- Ajouter un jeu : une entrée de plus (`slug`, `nom`, `repo`, `statut`). Option `branche` si ce n'est pas la branche par défaut,
  option `exclure` pour retirer des fichiers en plus de `exclure_par_defaut`.
- Repasser un jeu en `en-cours` retire sa copie de `jeux/`. Retirer un jeu de la liste aussi.

## Mise en place (une seule fois, côté GitHub : Claude ne peut pas le faire)

1. ✔ Repo `roussetaubin/Jeu-Autres` créé (privé, vide).
2. Créer un jeton GitHub **fine-grained** : repos = les repos de jeux, permission « Contents : Read-only ».
3. Dans `Jeu-Autres` → Settings → Secrets and variables → Actions → New repository secret : nom `GAMES_TOKEN`, valeur = le jeton.
4. Onglet Actions → « Synchroniser les jeux » → Run workflow, pour vérifier.

Instantané optionnel : `templates/notify-hub.yml` (voir le fichier) fait réagir le hub à chaque push d'un jeu.

## Règles de travail

- Répondre en français, simplement, sans formules de politesse. King débute en code : expliquer chaque mot technique.
- Petites étapes, plan court validé avant de faire. Rien hors du plan sans demander.
- Le plaisir du joueur et la qualité passent avant la vitesse (voir `Apprentissage`).
- Pour fusionner dans `main` depuis une session Claude : pousser une branche, King ouvre la demande de fusion sur GitHub.
- Tester le script : `npm test` (fausse API GitHub, aucun accès réseau nécessaire).
