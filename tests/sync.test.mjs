import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { synchroniser, estExclu, genererReadme } from '../scripts/sync.mjs';

// ---- petit faux GitHub ---------------------------------------------------------

function fabriquerArchive() {
  const base = mkdtempSync(join(tmpdir(), 'fake-tar-'));
  const racine = join(base, 'roussetaubin-Jeu-abc123');
  for (const f of [
    'src/main.js', 'public/logo.svg', 'index.html', 'package.json', 'README.md',
    'AUDIT_FINAL_REPORT.md', 'CLAUDE.md', 'lancer-echo.bat', 'docs/plan.md',
    'node_modules/x/index.js', 'dist/app.js', '.github/workflows/ci.yml', 'echo-crazygames.zip',
  ]) {
    mkdirSync(join(racine, f, '..'), { recursive: true });
    writeFileSync(join(racine, f), `contenu de ${f}`);
  }
  const archive = join(base, 'a.tgz');
  execFileSync('tar', ['-czf', archive, '-C', base, 'roussetaubin-Jeu-abc123']);
  return readFileSync(archive);
}

function demarrerFauxGithub() {
  const archive = fabriquerArchive();
  const etat = { sha: 'sha-1', telechargements: 0, token: null, introuvable: new Set() };
  const serveur = http.createServer((req, rep) => {
    etat.token = req.headers.authorization;
    const url = req.url;
    const m = url.match(/^\/repos\/([^/]+\/[^/]+)(\/.*)?$/);
    if (!m || etat.introuvable.has(m[1])) { rep.writeHead(404).end('{}'); return; }
    const [, repo, suite = ''] = m;
    const json = (o) => { rep.writeHead(200, { 'content-type': 'application/json' }); rep.end(JSON.stringify(o)); };
    if (suite === '') {
      json({
        html_url: `https://github.com/${repo}`, description: `Description de ${repo}`, language: 'JavaScript',
        private: true, default_branch: 'main', pushed_at: '2026-11-21T15:13:30Z',
      });
    } else if (suite.startsWith('/commits/')) {
      json({ sha: etat.sha, commit: { message: 'Ajout | du niveau 51\n\ndétails', committer: { date: '2026-11-21T15:00:00Z' } } });
    } else if (suite.startsWith('/tarball/')) {
      etat.telechargements += 1;
      rep.writeHead(200, { 'content-type': 'application/gzip' });
      rep.end(archive);
    } else {
      rep.writeHead(404).end('{}');
    }
  });
  return new Promise((ok) => serveur.listen(0, '127.0.0.1', () => {
    ok({ etat, apiUrl: `http://127.0.0.1:${serveur.address().port}`, fermer: () => serveur.close() });
  }));
}

function creerRacine(jeux) {
  const racine = mkdtempSync(join(tmpdir(), 'hub-test-'));
  writeFileSync(join(racine, 'games.config.json'), JSON.stringify({
    jeux,
    exclure_par_defaut: ['.git', '.github', 'node_modules', 'dist', 'dist-*', 'docs', 'CLAUDE.md', 'AUDIT_*', '*.bat', '*.zip'],
  }));
  return racine;
}

// ---- tests ---------------------------------------------------------------------

test('estExclu : motifs simples, joker et chemins', () => {
  const m = ['node_modules', 'AUDIT_*', '*.bat', 'docs/brouillon'];
  assert.equal(estExclu('node_modules', m), true);
  assert.equal(estExclu('sous/dossier/AUDIT_X.md', m), true);
  assert.equal(estExclu('lancer.bat', m), true);
  assert.equal(estExclu('docs/brouillon', m), true);
  assert.equal(estExclu('docs/autre', m), false);
  assert.equal(estExclu('src/main.js', m), false);
  assert.equal(estExclu('audit.js', m), false);
});

test('jeu en cours : suivi sans copie de code', async () => {
  const faux = await demarrerFauxGithub();
  const racine = creerRacine([{ slug: 'echo', nom: 'ECHO', repo: 'roussetaubin/Jeu', statut: 'en-cours' }]);
  try {
    const r = await synchroniser({ racine, apiUrl: faux.apiUrl, token: 'jeton' });
    assert.equal(r.erreurs, 0);
    assert.equal(faux.etat.telechargements, 0);
    assert.equal(faux.etat.token, 'Bearer jeton');
    assert.equal(existsSync(join(racine, 'jeux', 'echo')), false);
    const donnees = JSON.parse(readFileSync(join(racine, 'games.json'), 'utf8'));
    assert.equal(donnees.jeux[0].code, null);
    assert.equal(donnees.jeux[0].derniere_activite, '2026-11-21T15:13:30Z');
    const readme = readFileSync(join(racine, 'README.md'), 'utf8');
    assert.match(readme, /\[ECHO\]\(https:\/\/github\.com\/roussetaubin\/Jeu\) \| En cours \| Ajout \\\| du niveau 51 \| 2026-11-21 \| — \|/);
  } finally { faux.fermer(); rmSync(racine, { recursive: true, force: true }); }
});

test('jeu fini : seul le code est copié, puis pas de re-téléchargement, puis retrait', async () => {
  const faux = await demarrerFauxGithub();
  const cfg = { slug: 'echo', nom: 'ECHO', repo: 'roussetaubin/Jeu', statut: 'fini' };
  const racine = creerRacine([cfg]);
  try {
    await synchroniser({ racine, apiUrl: faux.apiUrl, token: 't' });
    const dest = join(racine, 'jeux', 'echo');
    for (const garde of ['src/main.js', 'public/logo.svg', 'index.html', 'package.json', 'README.md']) {
      assert.equal(existsSync(join(dest, garde)), true, `${garde} doit être copié`);
    }
    for (const rejete of ['AUDIT_FINAL_REPORT.md', 'CLAUDE.md', 'lancer-echo.bat', 'docs', 'node_modules', 'dist', '.github', 'echo-crazygames.zip']) {
      assert.equal(existsSync(join(dest, rejete)), false, `${rejete} ne doit pas être copié`);
    }
    assert.equal(faux.etat.telechargements, 1);
    assert.match(readFileSync(join(racine, 'README.md'), 'utf8'), /\[jeux\/echo\]\(jeux\/echo\)/);

    // Même commit : rien à retélécharger.
    await synchroniser({ racine, apiUrl: faux.apiUrl, token: 't' });
    assert.equal(faux.etat.telechargements, 1);

    // Nouveau commit : copie refaite, un fichier ajouté à la main dans jeux/ disparaît.
    writeFileSync(join(dest, 'intrus.txt'), 'x');
    faux.etat.sha = 'sha-2';
    await synchroniser({ racine, apiUrl: faux.apiUrl, token: 't' });
    assert.equal(faux.etat.telechargements, 2);
    assert.equal(existsSync(join(dest, 'intrus.txt')), false);

    // distribution/ n'est jamais touché.
    mkdirSync(join(racine, 'distribution', 'echo'), { recursive: true });
    writeFileSync(join(racine, 'distribution', 'echo', 'fiche.md'), 'ma fiche');
    await synchroniser({ racine, apiUrl: faux.apiUrl, token: 't' });
    assert.equal(readFileSync(join(racine, 'distribution', 'echo', 'fiche.md'), 'utf8'), 'ma fiche');

    // Retour en cours : la copie est retirée.
    writeFileSync(join(racine, 'games.config.json'), JSON.stringify({ jeux: [{ ...cfg, statut: 'en-cours' }] }));
    await synchroniser({ racine, apiUrl: faux.apiUrl, token: 't' });
    assert.equal(existsSync(dest), false);
  } finally { faux.fermer(); rmSync(racine, { recursive: true, force: true }); }
});

test('un repo inaccessible n\'empêche pas les autres et garde ses dernières données', async () => {
  const faux = await demarrerFauxGithub();
  const racine = creerRacine([
    { slug: 'echo', nom: 'ECHO', repo: 'roussetaubin/Jeu', statut: 'en-cours' },
    { slug: 'chaos', nom: 'Chaos', repo: 'roussetaubin/Courrier-chaos', statut: 'en-cours' },
  ]);
  try {
    await synchroniser({ racine, apiUrl: faux.apiUrl });
    faux.etat.introuvable.add('roussetaubin/Courrier-chaos');
    const r = await synchroniser({ racine, apiUrl: faux.apiUrl });
    assert.equal(r.erreurs, 1);
    const [echo, chaos] = r.jeux;
    assert.equal(echo.erreur, undefined);
    assert.match(chaos.erreur, /404/);
    assert.equal(chaos.url, 'https://github.com/roussetaubin/Courrier-chaos'); // ancienne donnée gardée
    assert.match(readFileSync(join(racine, 'README.md'), 'utf8'), /Erreurs de la dernière synchronisation/);
  } finally { faux.fermer(); rmSync(racine, { recursive: true, force: true }); }
});

test('config invalide : statut inconnu et slug en double refusés', async () => {
  const racine = creerRacine([{ slug: 'a', repo: 'x/y', statut: 'termine' }]);
  await assert.rejects(synchroniser({ racine, apiUrl: 'http://127.0.0.1:1' }), /Statut inconnu/);
  const racine2 = creerRacine([{ slug: 'a', repo: 'x/y' }, { slug: 'a', repo: 'x/z' }]);
  await assert.rejects(synchroniser({ racine: racine2, apiUrl: 'http://127.0.0.1:1' }), /en double|ECONNREFUSED|fetch failed/);
});

test('genererReadme : cellule sans retour à la ligne', () => {
  const md = genererReadme([{
    slug: 'a', nom: 'A', statut: 'publie', url: 'https://x', derniere_activite: '2026-01-02T00:00:00Z',
    dernier_commit: { message: 'ligne 1\nligne 2' }, code: { dossier: 'jeux/a' },
  }]);
  assert.match(md, /\| \[A\]\(https:\/\/x\) \| Publié \| ligne 1 ligne 2 \| 2026-01-02 \| \[jeux\/a\]\(jeux\/a\) \|/);
});

test('genererReadme : section contexte', () => {
  const md = genererReadme([], [{ repo: 'roussetaubin/Apprentissage', role: 'méthode' }]);
  assert.match(md, /## Contexte lié/);
  assert.match(md, /\[roussetaubin\/Apprentissage\]\(https:\/\/github\.com\/roussetaubin\/Apprentissage\) : méthode/);
});
