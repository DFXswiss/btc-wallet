module.exports = async ({ github, context }) => {
  const workflowRunUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`;
  const markerStart = '<!-- build-pipeline:start -->';
  const markerEnd = '<!-- build-pipeline:end -->';
  const pipelineBlock = `${markerStart}\nBuild pipeline: ${workflowRunUrl}\n${markerEnd}`;
  const tag = context.ref.replace('refs/tags/', '');

  const release = await github.rest.repos.getReleaseByTag({
    owner: context.repo.owner,
    repo: context.repo.repo,
    tag,
  });

  const body = release.data.body || '';
  const pipelineBlockRegex =
    /<!-- build-pipeline:start -->[\s\S]*?<!-- build-pipeline:end -->/m;
  const updatedBody = pipelineBlockRegex.test(body)
    ? body.replace(pipelineBlockRegex, pipelineBlock)
    : `${body.trimEnd()}${body ? '\n\n' : ''}${pipelineBlock}`;

  await github.rest.repos.updateRelease({
    owner: context.repo.owner,
    repo: context.repo.repo,
    release_id: release.data.id,
    body: updatedBody,
  });
};
