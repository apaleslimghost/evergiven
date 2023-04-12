import path from "path"
import { UsablePackageJson, parsePackageJson } from "./package-json"
import type { DefaultLogFields, ListLogLine, SimpleGit } from "simple-git"
import { Context } from "./context"

export type Commit = DefaultLogFields & ListLogLine

export type Package = {
	root: string,
	commits: readonly Commit[],
	packageJson: UsablePackageJson,
	workspaceDeps: string[]
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

export async function loadPackage(root: string, {git, manifest, workspaces}: Context): Promise<Package> {
	const [
		commits,
		packageJson
	] = await Promise.all([
		commitsSince(git, root, manifest?.lastRelease),
		parsePackageJson(path.resolve(root, 'package.json'))
	])

	const workspaceDeps = [
		...Object.keys(packageJson.dependencies ?? {}),
		...Object.keys(packageJson.devDependencies ?? {})
	].filter(dep => workspaces.has(dep))

	return { root, commits, packageJson, workspaceDeps }
}
