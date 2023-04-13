import path from "path"
import { UsablePackageJson, parsePackageJson } from "./package-json"
import type { DefaultLogFields, ListLogLine, SimpleGit } from "simple-git"
import { Context } from "./context"
import { parser, ConventionalChangelogCommit, toConventionalChangelogFormat } from "@conventional-commits/parser"
import fs from 'fs/promises'

export type Commit = ConventionalChangelogCommit & { sha: string }

export type Package = {
	root: string,
	commits: Commit[],
	packageJson: UsablePackageJson,
	workspaceDeps: string[]
	changelog: string
}

async function commitsSince(git: SimpleGit, root: string, sha?: string) {
	const { all } = await git.log({
		from: sha,
		multiLine: true,
		'--topo-order': null,
		file: root
	})

	return all
}

const parseCommit = (rawCommit: DefaultLogFields & ListLogLine): Commit => {
	try {
		const ast = parser(rawCommit.body)
		return {
			...toConventionalChangelogFormat(ast),
			sha: rawCommit.hash
		}
	} catch(error) {
		if(rawCommit.message.startsWith('Merge ')) {
			return {
				sha: rawCommit.hash,
				type: 'merge',
				subject: rawCommit.message,
				header: rawCommit.message,
				body: rawCommit.body,
				merge: true,
				notes: [],
				references: [],
				mentions: [],
				revert: false,
				footer: null,
				scope: null,
			}
		}

		throw error
	}
}

const emptyChangelog = (pkg: string) => `# \`${pkg}\` changelog

`

export async function loadPackage(root: string, {git, manifest, workspaces}: Context): Promise<Package> {
	const [
		rawCommits,
		packageJson
	] = await Promise.all([
		commitsSince(git, root, manifest?.lastRelease),
		parsePackageJson(path.resolve(root, 'package.json')),
	])

	const changelog = await fs.readFile(
		path.resolve(root, 'CHANGELOG.md'), 'utf-8'
	).catch(
		() => emptyChangelog(packageJson.name)
	)

	const workspaceDeps = [
		...Object.keys(packageJson.dependencies ?? {}),
		...Object.keys(packageJson.devDependencies ?? {})
	].filter(dep => workspaces.has(dep))

	const commits = rawCommits.map(parseCommit)

	return { root, commits, packageJson, workspaceDeps, changelog }
}
