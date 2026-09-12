const RELEASE_BRANCH = 'release-please--branches--main--components--ai-status';
const PENDING = 'autorelease: pending';
const TAGGED = 'autorelease: tagged';
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function isReleasePr(pr, repo) {
  return pr.user?.login === 'github-actions[bot]' && pr.head?.repo?.full_name === `${repo.owner}/${repo.repo}` &&
    pr.head.ref === RELEASE_BRANCH && pr.base?.ref === 'main' &&
    pr.labels?.some(({ name }) => name === PENDING || name === TAGGED);
}

async function optional(request) {
  try { return (await request()).data; }
  catch (error) { if (error.status === 404) return null; throw error; }
}

async function readJson(github, repo, path, ref) {
  const { data } = await github.rest.repos.getContent({ ...repo, path, ref });
  requireValue(data.type === 'file' && data.encoding === 'base64' && data.size < 1_000_000, `Fichier de version invalide : ${path}`);
  return JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
}

export function releaseVersion(pkg, lock, manifest) {
  const version = pkg.version;
  requireValue(typeof version === 'string' && SEMVER.test(version), 'Version SemVer invalide');
  requireValue(lock.version === version && lock.packages?.['']?.version === version && manifest['.'] === version, 'Versions de publication divergentes');
  return version;
}

function compareVersions(a, b) {
  const left = a.split('.').map(BigInt), right = b.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}

// Seul le commit de fusion effectivement testé peut produire une release
export async function publishRelease({ github, context, testsPassed }) {
  requireValue(testsPassed === true, 'Tests réussis requis pour publier');
  if (context.eventName !== 'push' || context.ref !== 'refs/heads/main') return null;
  const { repo, sha } = context;
  requireValue(/^[a-f0-9]{40}$/.test(sha), 'SHA testé invalide');
  const associated = await github.paginate(github.rest.repos.listPullRequestsAssociatedWithCommit, { ...repo, commit_sha: sha, per_page: 100 });
  const candidates = associated.filter(pr => isReleasePr(pr, repo) && pr.merged_at && pr.merge_commit_sha === sha);
  requireValue(candidates.length <= 1, 'Plusieurs PR de version pour le commit testé');
  if (!candidates.length) return null;
  const pr = candidates[0];
  const [pkg, lock, manifest] = await Promise.all(['package.json', 'package-lock.json', '.release-please-manifest.json'].map(path => readJson(github, repo, path, sha)));
  const version = releaseVersion(pkg, lock, manifest);
  requireValue(typeof pr.body === 'string' && pr.body.trim().length > 30 && pr.body.includes(version), 'Notes de version absentes ou incohérentes');
  const tag = `v${version}`;
  const ref = await optional(() => github.rest.git.getRef({ ...repo, ref: `tags/${tag}` }));
  if (ref) requireValue(ref.object.type === 'commit' && ref.object.sha === sha, 'Le tag existant vise un autre commit');
  const existing = await optional(() => github.rest.repos.getReleaseByTag({ ...repo, tag }));
  if (existing) {
    requireValue(ref && existing.target_commitish === sha && !existing.draft && !existing.prerelease, 'La release existante ne correspond pas au commit testé');
  } else {
    const latest = await optional(() => github.rest.repos.getLatestRelease(repo));
    if (latest) {
      const previous = latest.tag_name?.replace(/^v/, '');
      requireValue(SEMVER.test(previous) && compareVersions(version, previous) > 0, 'La version doit dépasser la dernière release');
    } else {
      requireValue(version === '0.1.2', 'La première release doit être 0.1.2');
    }
    if (!ref) await github.rest.git.createRef({ ...repo, ref: `refs/tags/${tag}`, sha });
    await github.rest.repos.createRelease({ ...repo, tag_name: tag, target_commitish: sha, name: tag, body: pr.body, draft: false, prerelease: false });
  }
  await github.rest.issues.addLabels({ ...repo, issue_number: pr.number, labels: [TAGGED] });
  if (pr.labels.some(({ name }) => name === PENDING)) {
    try { await github.rest.issues.removeLabel({ ...repo, issue_number: pr.number, name: PENDING }); }
    catch (error) { if (error.status !== 404) throw error; }
  }
  return { version, sha, tag };
}

// Un ancien run peut publier son propre commit, mais ne prépare pas une nouvelle PR
export async function canPrepareRelease({ github, context }) {
  if (context.eventName !== 'push' || context.ref !== 'refs/heads/main') return false;
  const { data } = await github.rest.git.getRef({ ...context.repo, ref: 'heads/main' });
  return data.object.sha === context.sha;
}

export async function dispatchReleaseTests({ github, context }) {
  if (!await canPrepareRelease({ github, context })) return null;
  const prs = await github.paginate(github.rest.pulls.list, { ...context.repo, state: 'open', base: 'main', per_page: 100 });
  const candidates = prs.filter(pr => isReleasePr(pr, context.repo));
  requireValue(candidates.length <= 1, 'Plusieurs PR de version ouvertes');
  if (!candidates.length) return null;
  const pr = candidates[0];
  requireValue(/^[a-f0-9]{40}$/.test(pr.head.sha), 'SHA de la PR invalide');
  const { data } = await github.rest.actions.listWorkflowRuns({ ...context.repo, workflow_id: 'tests.yml', event: 'workflow_dispatch', head_sha: pr.head.sha, per_page: 100 });
  if (data.workflow_runs.some(run => run.head_sha === pr.head.sha && (run.status !== 'completed' || run.conclusion === 'success'))) return null;
  await github.rest.actions.createWorkflowDispatch({ ...context.repo, workflow_id: 'tests.yml', ref: pr.head.ref, inputs: { expected_sha: pr.head.sha } });
  return pr.head.sha;
}
