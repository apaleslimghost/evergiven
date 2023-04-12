import { PackageBump, PackageBumps } from "./bump"
import { Context } from "./context"
import { Octokit } from "@octokit/rest";
import * as suggester from 'code-suggester'
import path from "path";

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

	await suggester.createPullRequest(octokit, changes, {
		title: 'release',
		message: 'chore: release main',
		description: 'TODO',
		branch: 'evergiven-release',
		upstreamOwner: 'financial-times',
		upstreamRepo: 'evergiven-test', //TODO
		fork: false
	})
}
