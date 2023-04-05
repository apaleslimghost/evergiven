import simpleGit, { DefaultLogFields, ListLogLine, SimpleGit } from "simple-git";
import * as conventionalCommits from "@conventional-commits/parser";
import mapWorkspaces from '@npmcli/map-workspaces'
import fs from 'fs/promises'
import path from "path";

const enum BumpLevel {
	NONE = 0,
	PATCH,
	MINOR,
	MAJOR
}

const formatBumpLevel: Record<BumpLevel, string> = {
	[BumpLevel.NONE]: 'none',
	[BumpLevel.PATCH]: 'patch',
	[BumpLevel.MINOR]: 'minor',
	[BumpLevel.MAJOR]: 'major',
}

async function commitsSince(git: SimpleGit, root: string, sha: string) {
	const { all } = await git.log({
		from: sha,
		multiLine: true,
		'--topo-order': null,
		file: root
	})

	return all
}

const commitBumpLevel = (commit: DefaultLogFields & ListLogLine): BumpLevel => {
	try {
		const ast = conventionalCommits.parser(commit.body)
		const {type, notes} = conventionalCommits.toConventionalChangelogFormat(ast)

		if(notes.length && notes.some(note => note.title === 'BREAKING CHANGE')) {
			return BumpLevel.MAJOR
		}

		if(commit.body.match(/breaking/i)) {
			console.log(commit)
		}

		if(type === 'feat') {
			return BumpLevel.MINOR
		}

		if(type === 'fix') {
			return BumpLevel.PATCH
		}
	} catch(error) {
		// console.log({error, commit})
	}

	return BumpLevel.NONE
}

async function main() {
	const root = '/Users/kara.brightwell/Code/financial-times/cp-content-pipeline'
	const since = '343758b5d4dd9e63ad4c37b3a4770cb5a95f2aa3'

	const git = simpleGit(root)

	const workspaces = await mapWorkspaces({
		cwd: root,
		pkg: JSON.parse(await fs.readFile(path.resolve(root, 'package.json'), 'utf-8'))
	})

	const bumps = await Promise.all(
		Array.from(
			workspaces,
			async ([ workspaceName, workspaceRoot ]) => {
				const commits = await commitsSince(git, workspaceRoot, since)

				const changesetBumpLevel: BumpLevel = Math.max(...commits.map(commitBumpLevel))

				return { workspaceName, level: formatBumpLevel[changesetBumpLevel], commits: commits.map(c => c.message)}
			}
		)
	)

	console.dir(bumps, {depth: null, maxArrayLength: null})
}

main()
