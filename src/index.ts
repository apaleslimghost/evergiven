import simpleGit, { SimpleGit } from "simple-git";

async function commitsSince(git: SimpleGit, sha: string) {
	const { all } = await git.log({
		from: sha,
		'--topo-order': null
	})

	return all
}

async function main() {
	const git = simpleGit('/Users/kara.brightwell/Code/financial-times/cp-content-pipeline')

	console.log(await commitsSince(git, '0db5d65'))
}

main()
