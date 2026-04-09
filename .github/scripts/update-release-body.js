module.exports = async ({ github, context }) => {
  const workflowRunUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`;
  const pipelineLine = `Build pipeline: ${workflowRunUrl}`;
  const tag = context.ref.replace('refs/tags/', '');

  const release = await github.rest.repos.getReleaseByTag({
    owner: context.repo.owner,
    repo: context.repo.repo,
    tag,
  });

  const body = release.data.body || '';
  const updatedBody = body.match(/^Build pipeline: .*/m)
    ? body.replace(/^Build pipeline: .*/m, pipelineLine)
    : `${body}${body ? '\n\n' : ''}${pipelineLine}`;

  await github.rest.repos.updateRelease({
    owner: context.repo.owner,
    repo: context.repo.repo,
    release_id: release.data.id,
    body: updatedBody,
  });
};
