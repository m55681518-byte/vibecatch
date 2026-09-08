const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = 'C:/Users/Mike-/Documents/new-vibemusic';
const DIST = path.join(ROOT, 'dist');
const OWNER = 'm55681518-byte';
const REPO = 'vibecatch';
const BRANCH = 'gh-pages';

function readPat() {
  const p = 'C:/Users/Mike-/Desktop/07_Credentials_Config/github and render.txt';
  const txt = fs.readFileSync(p, 'utf8');
  const m = txt.match(/github_pat_[A-Za-z0-9_]+/);
  if (!m) throw new Error('PAT not found');
  return m[0];
}

function gh(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const pat = readPat();
    const req = https.request(
      {
        host: 'api.github.com',
        path: urlPath,
        method,
        headers: {
          Authorization: `Bearer ${pat}`,
          'User-Agent': 'vibecatch-deploy',
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          let j = null;
          try { j = JSON.parse(d); } catch {}
          if (res.statusCode >= 400) return reject(new Error(`GH ${method} ${urlPath} -> ${res.statusCode}: ${d.slice(0, 400)}`));
          resolve(j);
        });
      },
    );
    req.on('error', reject);
    req.write(body ? JSON.stringify(body) : '');
    req.end();
  });
}

function walkDir(dir, prefix = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix + e.name;
    if (e.isDirectory()) out.push(...walkDir(path.join(dir, e.name), rel + '/'));
    else out.push({ rel: rel.replace(/\\/g, '/'), abs: path.join(dir, e.name) });
  }
  return out;
}

async function main() {
  const files = walkDir(DIST);
  console.log(`dist files: ${files.length}`);
  // Upload blobs
  const tree = [];
  for (const f of files) {
    const buf = fs.readFileSync(f.abs);
    const blob = await gh('POST', `/repos/${OWNER}/${REPO}/git/blobs`, { content: buf.toString('base64'), encoding: 'base64' });
    tree.push({ path: f.rel, mode: '100644', type: 'blob', sha: blob.sha });
    console.log(`blob ${f.rel} ${buf.length}B`);
  }
  // Get current HEAD of gh-pages
  const head = await gh('GET', `/repos/${OWNER}/${REPO}/commits/${BRANCH}`);
  const baseTree = head.commit.tree.sha;
  console.log(`base_tree ${baseTree}`);
  const newTree = await gh('POST', `/repos/${OWNER}/${REPO}/git/trees`, { base_tree: baseTree, tree });
  console.log(`tree ${newTree.sha}`);
  const commit = await gh('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
    message: `deploy: signer contract fix (build ${new Date().toISOString()})`,
    tree: newTree.sha,
    parents: [head.sha],
  });
  console.log(`commit ${commit.sha}`);
  const ref = await gh('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: true });
  console.log(`PATCH ref -> ${ref.object.sha}`);
  console.log('DEPLOY OK');
}

main().catch((e) => { console.error('DEPLOY FAIL', e.message); process.exit(1); });