import * as core from '@actions/core'
import * as github from '@actions/github'
import { createComment, getComponentComments, minimizeComments } from './comments'
import { getInputs } from './config'
import { findPRForCommit } from './issues'
import { uploadSBOM } from './upload_sbom'

const run = async (): Promise<void> => {
  try {
    const {
      edgebitUrl,
      edgebitToken,
      repoToken,
      pullRequestNumber,
      commitSha,
      priorSha,
      owner,
      repo,
      sbomPath,
      imageId,
      imageTag,
      componentName,
      tags,
      postComment,
    } = await getInputs()

    const octokit = github.getOctokit(repoToken)

    let baseSha = priorSha
    let issueNumber: number | undefined

    if (pullRequestNumber) {
      core.info(`pull request number specified: ${pullRequestNumber}`)
      issueNumber = pullRequestNumber
      const { data: pullRequest } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: pullRequestNumber,
      })

      if (pullRequest) {
        core.info(`found PR #${pullRequestNumber}`)
        baseSha = priorSha || pullRequest.base.sha
      } else {
        core.info(`no PR found for ${pullRequestNumber}`)
      }
    } else {
      core.info(`attempting to locate PR for commit ${commitSha}...`)
      const pr = await findPRForCommit(octokit, owner, repo, commitSha)

      if (pr) {
        core.info(`found PR #${pr.number} for commit ${commitSha}`)
        issueNumber = pr.number
        baseSha = priorSha || pr.base
      } else {
        core.info(`no PR found for commit ${commitSha}`)
      }
    }

    core.info(`uploading SBOM for:`)
    core.info(`  repo: https://github.com/${owner}/${repo}`)
    core.info(`  commit: ${commitSha}`)
    core.info(`  base commit: ${baseSha}`)

    const result = await uploadSBOM({
      edgebitUrl: edgebitUrl,
      edgebitToken: edgebitToken,
      sbomPath: sbomPath,
      sourceRepoUrl: `https://github.com/${owner}/${repo}`,
      sourceCommitId: commitSha,
      baseCommitId: baseSha,
      imageId,
      imageTag,
      componentName,
      tags,
    })

    if (!issueNumber) {
      core.info(
        'no issue number found, skipping comment creation. This is expected if this is not a pull request.',
      )
      core.setOutput('comment-created', 'false')
      return
    }

    if (postComment) {
      if (!result.skipComment) {
        const comment = await createComment(octokit, owner, repo, issueNumber, result.commentBody)

        if (comment) {
          core.setOutput('comment-created', 'true')
          core.setOutput('comment-id', comment.id)

          if (componentName) {
            const componentComments = await getComponentComments(
              octokit,
              owner,
              repo,
              issueNumber,
              componentName,
            )
            core.info(`ComponentComments: ${componentComments}`)

            // Remove the comment with the same ID from componentComments
            const filteredComments = componentComments.filter(
              (componentComment) => componentComment.id !== comment.id,
            )

            minimizeComments(octokit, filteredComments)
          }
        } else {
          core.setOutput('comment-created', 'false')
          core.setOutput('comment-updated', 'false')
        }
      } else {
        core.info('skiped commented as skipComment was true.')

        if (componentName) {
          const componentComments = await getComponentComments(
            octokit,
            owner,
            repo,
            issueNumber,
            componentName,
          )
          core.info(`ComponentComments: ${componentComments}`)

          minimizeComments(octokit, componentComments)
        }
      }
    }
  } catch (err) {
    if (err instanceof Error) {
      core.setFailed(err.message)
    }
  }
}

// Don't auto-execute in the test environment
if (process.env['NODE_ENV'] !== 'test') {
  run()
}

export default run
