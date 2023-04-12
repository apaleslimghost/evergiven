import path from "path"
import { Manifest, parseManifest } from "./manifest"
import { parsePackageJson } from "./package-json"
import simpleGit, { SimpleGit } from "simple-git"
import mapWorkspaces from "@npmcli/map-workspaces"

export type Context = {
	commit: string,
	root: string,
	git: SimpleGit,
	manifest?: Manifest,
	workspaces: Map<string, string>
}


export async function loadContext(root: string): Promise<Context> {
	const [manifest, pkg] = await Promise.all([
		parseManifest(path.resolve(root, '.evergiven-manifest.json')),
		parsePackageJson(path.resolve(root, 'package.json'))
	])

	const git = simpleGit(root)

	const commit = await git.revparse('head')

	const workspaces = await mapWorkspaces({
		cwd: root,
		pkg
	})

	return { commit, root, manifest, workspaces, git }
}
