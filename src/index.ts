import simpleGit, { DefaultLogFields, ListLogLine, SimpleGit } from "simple-git";
import * as conventionalCommits from "@conventional-commits/parser";

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

async function commitsSince(git: SimpleGit, sha: string) {
	const { all } = await git.log({
		from: sha,
		multiLine: true,
		'--topo-order': null
	})

	return all
}

const commitBumpLevel = (commit: DefaultLogFields & ListLogLine): BumpLevel => {
	if(commit.message.startsWith('Merge ')) {
		return BumpLevel.NONE
	}

	const ast = conventionalCommits.parser(commit.body)
	const {type} = conventionalCommits.toConventionalChangelogFormat(ast)

	if(type.endsWith('!')) {
		return BumpLevel.MAJOR
	}

	if(type === 'feat') {
		return BumpLevel.MINOR
	}

	if(type === 'fix') {
		return BumpLevel.PATCH
	}

	return BumpLevel.NONE
}

async function main() {
	const git = simpleGit('/Users/kara.brightwell/Code/financial-times/cp-content-pipeline')
	const commits = await commitsSince(git, 'ce562a1')

	const changesetBumpLevel: BumpLevel = Math.max(...commits.map(commitBumpLevel))

	console.log({
		commits: commits.map(commit => commit.message),
		level: formatBumpLevel[changesetBumpLevel]
	})
}

main()
