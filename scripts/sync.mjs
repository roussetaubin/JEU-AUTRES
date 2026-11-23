#!/usr/bin/env node
// Synchronise le hub avec les repos de jeux listés dans games.config.json :
//  1. met à jour games.json (données) et README.md (catalogue lisible) ;
//  2. pour chaque jeu « fini » ou « publie », copie SEULEMENT son code dans jeux/<slug>/ ;
//  3. retire jeux/<slug>/ si le jeu repasse « en-cours ».
// Aucune dépendance : Node 20+ et la commande `tar` (présente partout, y compris sur GitHub Actions).

import {
  readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, mkdtempSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, basename, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATUTS = ['en-cours', 'fini', 'publie'];
const LIBELLES = { 'en-cours': 'En cours', fini: 'Fini', publie: 'Publié' };

// --- filtres de fichiers ---------------------------------------------------

function globVersRegex(motif) {
  const echappe = motif.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${echappe}$`);
}

/** Vrai si le chemin relatif (ou son nom seul, quand le motif n'a pas de « / ») est exclu. */
export function estExclu(cheminRelatif, motifs) {
  const nom = basename(cheminRelatif);
  return motifs.some((m) => {
    const re = globVersRegex(m);
    return re.test(m.includes('/') ? cheminRelatif : nom);
  });
}

// --- API GitHub --------------------------------------------------------------

function creerClient(apiUrl, token) {
  const entetes = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'hub-jeux-sync',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  async function appeler(chemin) {
    const rep = await fetch(`${apiUrl}${chemin}`, { headers: entetes });
    if (!rep.ok) {
      const aide = rep.status === 404 || rep.status === 403
        ? ' (le jeton GAMES_TOKEN a-t-il accès à ce repo ?)' : '';
      throw new Error(`GitHub ${rep.status} sur ${chemin}${aide}`);
    }
    return rep;
  }
  return {
    json: async (chemin) => (await appeler(chemin)).json(),
    octets: async (chemin) => Buffer.from(await (await appeler(chemin)).arrayBuffer()),
  };
}

// --- cœur --------------------------------------------------------------------

function lireJson(chemin, secours) {
  return existsSync(chemin) ? JSON.parse(readFileSync(chemin, 'utf8')) : secours;
}

async function copierCode(client, jeu, exclusions, dossierCible) {
  const tmp = mkdtempSync(join(tmpdir(), 'hub-jeu-'));
  try {
    const archive = join(tmp, 'archive.tgz');
    const extrait = join(tmp, 'src');
    mkdirSync(extrait);
    writeFileSync(archive, await client.octets(`/repos/${jeu.repo}/tarball/${jeu.branche}`));
    execFileSync('tar', ['-xzf', archive, '-C', extrait, '--strip-components=1']);
    rmSync(dossierCible, { recursive: true, force: true });
    mkdirSync(dirname(dossierCible), { recursive: true });
    cpSync(extrait, dossierCible, {
      recursive: true,
      filter: (src) => {
        const rel = relative(extrait, src).split('\\').join('/');
        return rel === '' || !estExclu(rel, exclusions);
      },
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function echapperCellule(texte) {
  return String(texte ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
}

export function genererReadme(jeux, contexte = []) {
  const lignes = jeux.map((j) => {
    const message = echapperCellule(j.dernier_commit?.message).slice(0, 70) || '—';
    const activite = j.derniere_activite ? j.derniere_activite.slice(0, 10) : '—';
    const code = j.code ? `[jeux/${j.slug}](jeux/${j.slug})` : '—';
    const etat = j.erreur ? `${LIBELLES[j.statut]} ⚠ erreur` : LIBELLES[j.statut];
    const lien = j.url ? `[${echapperCellule(j.nom)}](${j.url})` : echapperCellule(j.nom);
    return `| ${lien} | ${etat} | ${message} | ${activite} | ${code} |`;
  });
  const erreurs = jeux.filter((j) => j.erreur).map((j) => `- **${j.nom}** : ${j.erreur}`);
  return [
    '# Jeux : le hub',
    '',
    '> Fichier généré automatiquement par `scripts/sync.mjs`. Ne le modifie pas à la main :',
    '> la liste des jeux et leur état sont dans `games.config.json`.',
    '',
    '| Jeu | État | Dernier changement | Dernière activité | Code ici |',
    '|---|---|---|---|---|',
    ...lignes,
    '',
    '- **En cours** : le code reste dans le repo du jeu, le hub ne fait que le suivre.',
    '- **Fini / Publié** : le code du jeu (sans rapports, scripts `.bat`, docs…) est copié dans `jeux/<jeu>/` et reste à jour.',
    '- Tout ce qui entoure le jeu (distribution, marketing, stratégie, fiches de stores) vit dans `distribution/`.',
    ...(contexte.length
      ? ['', '## Contexte lié', '', ...contexte.map((c) => `- [${c.repo}](https://github.com/${c.repo}) : ${c.role ?? ''}`.trimEnd())]
      : []),
    ...(erreurs.length ? ['', '## Erreurs de la dernière synchronisation', '', ...erreurs] : []),
    '',
  ].join('\n');
}

/**
 * @param {{ racine: string, apiUrl?: string, token?: string }} options
 * @returns {Promise<{ jeux: object[], erreurs: number, telechargements: number }>}
 */
export async function synchroniser({ racine, apiUrl = 'https://api.github.com', token = '' }) {
  const config = lireJson(join(racine, 'games.config.json'), null);
  if (!config?.jeux?.length) throw new Error('games.config.json : aucune entrée dans « jeux ».');
  const exclusionsDefaut = config.exclure_par_defaut ?? [];
  const precedent = lireJson(join(racine, 'games.json'), { jeux: [] });
  const client = creerClient(apiUrl, token);

  const slugs = new Set();
  const resultat = [];
  let erreurs = 0;
  let telechargements = 0;

  for (const cfg of config.jeux) {
    if (!cfg.repo || !cfg.slug) throw new Error(`Entrée invalide dans games.config.json : ${JSON.stringify(cfg)}`);
    if (slugs.has(cfg.slug)) throw new Error(`slug en double : ${cfg.slug}`);
    slugs.add(cfg.slug);
    const statut = cfg.statut ?? 'en-cours';
    if (!STATUTS.includes(statut)) {
      throw new Error(`Statut inconnu « ${statut} » pour ${cfg.slug} (attendu : ${STATUTS.join(', ')})`);
    }
    const nom = cfg.nom ?? cfg.slug;
    const avant = precedent.jeux.find((j) => j.slug === cfg.slug);
    const dossierCible = join(racine, 'jeux', cfg.slug);

    try {
      const repo = await client.json(`/repos/${cfg.repo}`);
      const branche = cfg.branche ?? repo.default_branch;
      const dernier = await client.json(`/repos/${cfg.repo}/commits/${encodeURIComponent(branche)}`);
      const jeu = {
        slug: cfg.slug,
        nom,
        repo: cfg.repo,
        statut,
        url: repo.html_url,
        description: repo.description ?? '',
        langage: repo.language ?? '',
        prive: Boolean(repo.private),
        branche,
        derniere_activite: repo.pushed_at ?? '',
        dernier_commit: {
          sha: dernier.sha,
          message: (dernier.commit?.message ?? '').split('\n')[0],
          date: dernier.commit?.committer?.date ?? '',
        },
        code: null,
      };

      if (statut === 'en-cours') {
        rmSync(dossierCible, { recursive: true, force: true });
      } else {
        const aJour = avant?.code?.sha === dernier.sha && existsSync(dossierCible);
        if (!aJour) {
          const exclusions = [...exclusionsDefaut, ...(cfg.exclure ?? [])];
          await copierCode(client, jeu, exclusions, dossierCible);
          telechargements += 1;
        }
        jeu.code = { dossier: `jeux/${cfg.slug}`, sha: dernier.sha };
      }
      resultat.push(jeu);
    } catch (e) {
      erreurs += 1;
      // On garde les dernières données connues pour ne rien perdre dans le catalogue.
      resultat.push({
        ...(avant ?? { slug: cfg.slug, nom, repo: cfg.repo, code: null }),
        nom,
        statut,
        erreur: e.message,
      });
    }
  }

  // Un jeu retiré de la config : on retire aussi sa copie de code.
  for (const ancien of precedent.jeux) {
    if (!slugs.has(ancien.slug)) rmSync(join(racine, 'jeux', ancien.slug), { recursive: true, force: true });
  }

  writeFileSync(join(racine, 'games.json'), `${JSON.stringify({ version: 1, jeux: resultat }, null, 2)}\n`);
  writeFileSync(join(racine, 'README.md'), genererReadme(resultat, config.contexte ?? []));
  return { jeux: resultat, erreurs, telechargements };
}

// --- lancement en ligne de commande ---------------------------------------------

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const token = process.env.GAMES_TOKEN || process.env.GITHUB_TOKEN || '';
  if (!process.env.GAMES_TOKEN) {
    console.warn('GAMES_TOKEN absent : les repos privés seront inaccessibles (voir CLAUDE.md, « Mise en place »).');
  }
  synchroniser({ racine, token })
    .then(({ jeux, erreurs, telechargements }) => {
      for (const j of jeux) console.log(`${j.erreur ? 'ERREUR' : 'ok    '} ${j.slug} [${j.statut}]${j.erreur ? ` ${j.erreur}` : ''}`);
      console.log(`${telechargements} code(s) copié(s), ${erreurs} erreur(s).`);
      if (erreurs) process.exitCode = 1;
    })
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
}
