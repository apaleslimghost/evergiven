import simpleGit, { DefaultLogFields, ListLogLine, SimpleGit } from "simple-git";
import * as conventionalCommits from "@conventional-commits/parser";
import mapWorkspaces from '@npmcli/map-workspaces'
import fs from 'fs/promises'
import path from "path";
import z from 'zod'
import type { PackageJson } from "@npmcli/package-json";
import semver from 'semver'
import { ReleaseType } from "semver";

const ManifestSchema = z.object({
	lastRelease: z.string()
})

const enum BumpLevel {
	NONE = 0,
	PATCH,
	MINOR,
	MAJOR
}

const formatBumpLevel: Record<BumpLevel, ReleaseType | undefined> = {
	[BumpLevel.NONE]: undefined,
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

async function parseJsonFile<OutputSchema extends z.ZodType>(file: string, schema: OutputSchema): Promise<z.infer<OutputSchema>> {
	const content = await fs.readFile(file, 'utf8')
	const data = JSON.parse(content)
	return schema.parse(data)
}

const parsePackageJson = (file: string): Promise<PackageJson> => parseJsonFile(file, z.any())

type DepGraph = Record<string, string[]>

function ancestors (from: string, dependencyGraph: DepGraph): Set<string> {
	function ancestorsInner(from: string, dependencyGraph: DepGraph): string[] {
		return [
			...dependencyGraph[from],
			...dependencyGraph[from].flatMap(dep => ancestorsInner(dep, dependencyGraph))
		]
	}

	return new Set(ancestorsInner(from, dependencyGraph))
}

function setDependencyVersionIfPresent(pkg: PackageJson, dependency: string, version: string) {
	for(const dependencyType of ['dependencies', 'devDependencies'] as const) {
		const deps = pkg[dependencyType]

		if(deps && deps[dependency]) {
			const currentVersion = deps[dependency]
			const extractVersion = semver.minVersion(currentVersion)?.format() ?? currentVersion
			deps[dependency] = deps[dependency].replace(extractVersion, version)
		}
	}
}

async function main() {
	const root = process.cwd()

	const [manifest, pkg] = await Promise.all([
		parseJsonFile(path.resolve(root, '.evergiven-manifest.json'), ManifestSchema),
		parsePackageJson(path.resolve(root, 'package.json'))
	])

	const git = simpleGit(root)

	const workspaces = await mapWorkspaces({
		cwd: root,
		pkg
	})

	const workspaceDetails = await Promise.all(
		Array.from(
			workspaces,
			async ([ workspaceName, workspaceRoot ]) => {
				const [
					commits,
					workspacePkg
				] = await Promise.all([
					commitsSince(git, workspaceRoot, manifest.lastRelease),
					parsePackageJson(path.resolve(workspaceRoot, 'package.json'))
				])

				return { workspaceName, workspaceRoot, commits, workspacePkg }
			}
		)
	)

	const dependencyGraph = Object.fromEntries(workspaceDetails.map(({workspaceName, workspacePkg}) => [
		workspaceName, [
		...Object.keys(workspacePkg.dependencies ?? {}),
		...Object.keys(workspacePkg.devDependencies ?? {})
	].filter(dep => workspaces.has(dep))]))

	const bumps = Object.fromEntries(workspaceDetails.map(({ commits, workspacePkg, workspaceName }) => {
		const changesetBumpLevel: BumpLevel = Math.max(BumpLevel.NONE, ...commits.map(commitBumpLevel))

		return [ workspaceName, changesetBumpLevel ]
	}))

	const packageActions = Object.fromEntries(workspaceDetails.flatMap(({workspaceName, workspacePkg}) => {
		const workspaceAncestors = ancestors(workspaceName, dependencyGraph)
		let bump = bumps[workspaceName]

		// force a patch bump if dependents need bumping
		if (bump > BumpLevel.NONE && Array.from(workspaceAncestors).some(ancestor => bumps[ancestor] > BumpLevel.NONE)) {
			bump = BumpLevel.PATCH
		}

		if(bump > BumpLevel.NONE) {
			// TODO reduce level if major is zero
			const currentVersion = workspacePkg.version!
			const releaseType = formatBumpLevel[bump]
			const nextVersion = currentVersion && releaseType ? semver.inc(currentVersion, releaseType)! : currentVersion

			return [[workspaceName, {workspaceName, currentVersion, nextVersion, releaseType}]]
		}

		return []
	}))

	for(const {workspaceName, workspacePkg} of workspaceDetails) {
		if(packageActions[workspaceName]) {
			const {nextVersion} = packageActions[workspaceName]
			workspacePkg.version = nextVersion

			for(const dependency of dependencyGraph[workspaceName]) {
				setDependencyVersionIfPresent(workspacePkg, dependency, packageActions[dependency].nextVersion)
			}

			console.log(workspacePkg)
		}
	}
}

// TODO
// generating the changelog
// writing latest commit to manifest
// writing and committing the package.json, changelogs and manifest
// creating PR
// creating releases on merge
// overriding commit types for commit SHAs in manifest, deleting them when they've been used
// CLI args?
// tests
// docs
// Tool Kit plugin?
// 🔮

main()
