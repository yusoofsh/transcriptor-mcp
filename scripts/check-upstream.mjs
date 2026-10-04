import { execFileSync } from 'node:child_process';
const repository = process.env.GITHUB_REPOSITORY;
if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Set GITHUB_REPOSITORY to owner/repository');
const response = await fetch('https://api.github.com/repos/' + repository, { headers: { Accept: 'application/vnd.github+json', ...(process.env.GH_TOKEN ? { Authorization: 'Bearer ' + process.env.GH_TOKEN } : {}) }, signal: AbortSignal.timeout(15000) });
if (!response.ok) throw new Error('Unable to verify registered upstream: HTTP ' + response.status);
const metadata = await response.json();
if (!metadata.fork) console.log(JSON.stringify({ repository, status: 'original-repository', upstream: null }));
else {
  const parent = metadata.parent;
  if (!parent || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(parent.full_name) || typeof parent.default_branch !== 'string') throw new Error('Invalid parent metadata');
  execFileSync('git', ['check-ref-format', 'refs/heads/' + parent.default_branch]);
  if (execFileSync('git', ['rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }).trim() === 'true') throw new Error('Use a full-history checkout');
  execFileSync('git', ['fetch', '--no-tags', 'https://github.com/' + parent.full_name + '.git', 'refs/heads/' + parent.default_branch], { timeout: 45000, stdio: 'pipe' });
  const upstream = execFileSync('git', ['rev-parse', 'FETCH_HEAD'], { encoding: 'utf8' }).trim();
  const [missing, custom] = execFileSync('git', ['rev-list', '--left-right', '--count', upstream + '...HEAD'], { encoding: 'utf8' }).trim().split(/\s+/).map(Number);
  console.log(JSON.stringify({ repository, parent: parent.full_name, upstream, missingUpstreamCommits: missing, forkOnlyCommits: custom }));
  if (missing !== 0) throw new Error('Merge and test upstream while preserving custom commits before release. No automatic branch write or reset was performed.');
}
