import { PackageBump, PackageBumps } from "./bump"
import { Context } from "./context"
import { Octokit } from "@octokit/rest";
import * as suggester from 'code-suggester'
import path from "path";
import { formatPRChangelog } from "./changelog";

function applyChanges(bump: PackageBump) {
	for(const change of bump.changes) {
		change(bump.package.packageJson)
	}
}

export async function createPullRequest(bumps: PackageBumps, { root, commit }: Context) {
	const octokit = new Octokit({
		auth: process.env.GITHUB_TOKEN
	})

	const changes: suggester.Changes = new Map([
		['.evergiven-manifest.json', {
			mode: '100644',
			content: JSON.stringify({
				lastRelease: commit,
			}, null, 2)
		}]
	])

	for(const [pkg, bump] of Object.entries(bumps)) {
		applyChanges(bump)

		changes.set(
			path.join(path.relative(root, bump.package.root), 'package.json'),
			{
				mode: '100644',
				content: JSON.stringify(bump.package.packageJson, null, 2)
			}
		)
	}

	// TODO
	const owner = 'Financial-Times'
	const repo = 'evergiven-test'
	const branch = 'evergiven-release'

	const { data: pulls } = await octokit.pulls.list({
		owner,
		repo
	})

	const existingPr = pulls.find(pr => pr.head.label === `${owner}:${branch}`)

	const title = 'release'
	const body = formatPRChangelog(bumps)

	const prNumber = await suggester.createPullRequest(octokit, changes, {
		title,
		message: 'chore: release main',
		description: body,
		branch,
		upstreamOwner: owner,
		upstreamRepo: repo,
		fork: false,
		force: true
	})

	if(existingPr) {
		await octokit.pulls.update({
			owner,
			repo,
			pull_number: existingPr.number,
			title,
			body
		})
	}
}
