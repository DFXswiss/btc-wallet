const assert = require('node:assert/strict');
const { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const YAML = require('js-yaml');

const ROOT = join(__dirname, '../..');

function workflowRun(relativePath, jobName, stepName) {
  const workflow = YAML.load(readFileSync(join(ROOT, relativePath), 'utf8'));
  const step = workflow.jobs[jobName].steps.find(({ name }) => name === stepName);
  assert.ok(step && step.run, `${relativePath} is missing ${jobName}/${stepName}`);
  return step.run.replace(/\$\{\{\s*github\.repository\s*\}\}/g, 'DFXswiss/bitcoin-wallet');
}

function runWithGhDouble(run, { draft = 'false', failView = 'false', allowUpload = 'true' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'release-guard-regression-'));
  const bin = join(root, 'bin');
  const assets = join(root, 'assets');
  mkdirSync(bin);
  mkdirSync(assets);
  for (const name of [
    'DFX-Btc-Wallet-v1.2.3.apk',
    'DFX-Btc-Wallet-v1.2.3.apk.idsig',
    'DFX-Btc-Wallet-v1.2.3.aab',
    'DFX-Btc-Wallet-v1.2.3-transparency-cert.pem',
    'SHA256SUMS',
  ])
    writeFileSync(join(assets, name), 'fixture');
  const log = join(root, 'gh.log');
  const gh = join(bin, 'gh');
  writeFileSync(
    gh,
    `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$GH_LOG"
if [ "$1" = release ] && [ "$2" = view ]; then
  [ "$GH_FAIL_VIEW" = true ] && exit 1
  case "$*" in *"--json isDraft"*) printf '%s\\n' "$GH_DRAFT";; esac
  exit 0
fi
if [ "$1" = release ] && [ "$2" = upload ]; then
  [ "$GH_ALLOW_UPLOAD" = true ] || exit 91
  exit 0
fi
if [ "$1" = release ] && { [ "$2" = edit ] || [ "$2" = create ]; }; then exit 0; fi
echo "unknown gh command" >&2
exit 90
`,
  );
  chmodSync(gh, 0o700);
  try {
    const result = spawnSync('/bin/bash', ['-euo', 'pipefail', '-c', run], {
      cwd: ROOT,
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        GH_LOG: log,
        GH_DRAFT: draft,
        GH_FAIL_VIEW: failView,
        GH_ALLOW_UPLOAD: allowUpload,
        GITHUB_REF_NAME: 'v1.2.3',
        GITHUB_REPOSITORY: 'DFXswiss/bitcoin-wallet',
        TAG: 'v1.2.3',
        PRERELEASE: 'false',
        RELEASE_ASSETS_DIR: assets,
      },
      encoding: 'utf8',
    });
    return { result, log: readFileSync(log, 'utf8') };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

it('update-release-body rejects published releases before update', async () => {
  const updateReleaseBody = require('../../.github/scripts/update-release-body');
  let updates = 0;
  const github = {
    rest: {
      repos: {
        getReleaseByTag: async () => ({ data: { id: 7, draft: false, body: '' } }),
        updateRelease: async () => {
          updates += 1;
        },
      },
    },
  };
  await assert.rejects(
    updateReleaseBody({
      github,
      context: { serverUrl: 'https://github.test', repo: { owner: 'o', repo: 'r' }, runId: 1, ref: 'refs/tags/v1.2.3' },
    }),
    /Refusing to update non-draft release/,
  );
  assert.equal(updates, 0);
});

it('draft release body update remains the allowed path', async () => {
  const updateReleaseBody = require('../../.github/scripts/update-release-body');
  let updates = 0;
  const github = {
    rest: {
      repos: {
        getReleaseByTag: async () => ({ data: { id: 7, draft: true, body: 'notes' } }),
        updateRelease: async ({ release_id, body }) => {
          updates += 1;
          assert.equal(release_id, 7);
          assert.match(body, /build-pipeline:start/);
        },
      },
    },
  };
  await updateReleaseBody({
    github,
    context: { serverUrl: 'https://github.test', repo: { owner: 'o', repo: 'r' }, runId: 1, ref: 'refs/tags/v1.2.3' },
  });
  assert.equal(updates, 1);
});

const uploadScenarios = [
  ['draft', { draft: 'true', allowUpload: 'true' }, true],
  ['published', { draft: 'false', allowUpload: 'true' }, false],
  ['lookup failure', { failView: 'true', allowUpload: 'true' }, false],
];

it.each(uploadScenarios)('actual APK upload YAML block handles %s', (_name, options, uploads) => {
  const run = workflowRun('.github/workflows/build-release-apk.yml', 'buildReleaseApk', 'Upload release assets');
  const outcome = runWithGhDouble(run, options);
  expect(outcome.result.status === 0).toBe(uploads);
  expect(outcome.log.includes('release upload')).toBe(uploads);
});

it.each(uploadScenarios)('actual Android deploy attachment handles %s', (_name, options, uploads) => {
  const run = workflowRun('.github/workflows/release.yml', 'android-deploy', 'Attach attested assets to GitHub Release');
  const outcome = runWithGhDouble(run, options);
  expect(outcome.result.status === 0).toBe(uploads);
  expect(outcome.log.includes('release upload')).toBe(uploads);
});

function expectPublishedUploadRejected(run) {
  const outcome = runWithGhDouble(run, { draft: 'false', allowUpload: 'true' });
  expect(outcome.result.status).not.toBe(0);
  expect(outcome.log).not.toMatch(/release upload/);
}

it('actual APK upload YAML block rejects a published release before mutation', () => {
  const run = workflowRun('.github/workflows/build-release-apk.yml', 'buildReleaseApk', 'Upload release assets');
  expectPublishedUploadRejected(run);
});

it('actual final release YAML block rejects a published release before edit', () => {
  const run = workflowRun('.github/workflows/release.yml', 'github-release', 'Create / update release');
  const outcome = runWithGhDouble(run, { draft: 'false' });
  expect(outcome.result.status).not.toBe(0);
  expect(outcome.log).not.toMatch(/release edit/);
});

it('actual final release YAML block publishes only after a draft check', () => {
  const run = workflowRun('.github/workflows/release.yml', 'github-release', 'Create / update release');
  const outcome = runWithGhDouble(run, { draft: 'true' });
  expect(outcome.result.status).toBe(0);
  const lines = outcome.log.split('\n');
  const draftCheck = lines.findIndex(line => line.includes('release view') && line.includes('--json isDraft'));
  const publish = lines.findIndex(line => line.includes('release edit') && line.includes('--draft=false'));
  expect(draftCheck).toBeGreaterThanOrEqual(0);
  expect(publish).toBeGreaterThan(draftCheck);
});

it('the guard mutant fails the same published-release assertion', () => {
  const run = workflowRun('.github/workflows/build-release-apk.yml', 'buildReleaseApk', 'Upload release assets');
  const mutant = run.replace('!= "true"', '= "true"');
  assert.notEqual(mutant, run);
  expect(() => expectPublishedUploadRejected(mutant)).toThrow();
});
