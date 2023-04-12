import simpleGit, { DefaultLogFields, ListLogLine, SimpleGit } from "simple-git";
import * as conventionalCommits from "@conventional-commits/parser";
import mapWorkspaces from '@npmcli/map-workspaces'
import fs from 'fs/promises'
import path from "path";
import z from 'zod'
import type { PackageJson } from "@npmcli/package-json";
import semver from 'semver'
import { ReleaseType } from "semver";
import toposort from 'toposort'

const ManifestSchema = z.object({
	lastRelease: z.string()
})

type Manifest = z.infer<typeof ManifestSchema>

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

type Commit = DefaultLogFields & ListLogLine

const commitBumpLevel = (commit: Commit): BumpLevel => {
	try {
		const ast = conventionalCommits.parser(commit.body)
		const {type, notes} = conventionalCommits.toConventionalChangelogFormat(ast)

		if(notes.length && notes.some(note => note.title === 'BREAKING CHANGE')) {
			return BumpLevel.MAJOR
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

function setDependencyVersionIfPresent(pkg: PackageJson, dependency: string, version: string) {
	for(const dependencyType of ['dependencies', 'devDependencies'] as const) {
		const deps = pkg[dependencyType]

		if(deps && deps[dependency]) {
			const currentVersion = deps[dependency]

			if(currentVersion) {
				const extractVersion = semver.minVersion(currentVersion)?.format() ?? currentVersion
				deps[dependency] = currentVersion.replace(extractVersion, version)
			}
		}
	}
}

type Context = {
	git: SimpleGit,
	manifest: Manifest,
	workspaces: Map<string, string>
}

type Package = {
	commits: readonly Commit[],
	packageJson: PackageJson,
	workspaceDeps: string[]
}

async function loadPackage(root: string, {git, manifest, workspaces}: Context): Promise<Package> {
	const [
		commits,
		packageJson
	] = await Promise.all([
		commitsSince(git, root, manifest.lastRelease),
		parsePackageJson(path.resolve(root, 'package.json'))
	])

	const workspaceDeps = [
		...Object.keys(packageJson.dependencies ?? {}),
		...Object.keys(packageJson.devDependencies ?? {})
	].filter(dep => workspaces.has(dep))

	return { commits, packageJson, workspaceDeps }
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

	const context: Context = { manifest, workspaces, git }

	const workspaceDetails = Object.fromEntries(await Promise.all(
		Array.from(
			workspaces,
			async ([ workspaceName, workspaceRoot ]) => {
				const packageDetails = await loadPackage(root, context)
				return [workspaceName, packageDetails] as const
			}
		)
	))

	const dependencyGraph = Object.entries(workspaceDetails).flatMap(
		([workspaceName, {workspaceDeps}]) => (
			workspaceDeps .map((dep): [string, string] => [dep, workspaceName])
		)
	)

	const dependencyOrder = toposort(dependencyGraph)

	const bumps: Record<string, BumpLevel> = {}

	for(const pkg of dependencyOrder) {
		const details = workspaceDetails[pkg]

		if(details) {
			const { commits, workspaceDeps } = details
			const dependenciesBumped = workspaceDeps.some(dep => dep in bumps)

			bumps[pkg] = Math.max(
				dependenciesBumped ? BumpLevel.PATCH : BumpLevel.NONE,
				...commits.map(commitBumpLevel),
			)
		}
	}

	const packageActions = Object.fromEntries(Object.entries(workspaceDetails).flatMap(([workspaceName, {packageJson}]) => {
		let bump = bumps[workspaceName]

		if(bump && bump > BumpLevel.NONE) {
			// TODO reduce level if major is zero
			const currentVersion = packageJson.version!
			const releaseType = formatBumpLevel[bump]
			const nextVersion = currentVersion && releaseType ? semver.inc(currentVersion, releaseType)! : currentVersion

			return [[workspaceName, {workspaceName, currentVersion, nextVersion, releaseType}]]
		}

		return []
	}))

	for(const [workspaceName, {packageJson, workspaceDeps}] of Object.entries(workspaceDetails)) {
		const action = packageActions[workspaceName]
		if(action) {
			const {nextVersion} = action
			packageJson.version = nextVersion

			for(const dependency of workspaceDeps) {
				const dependencyAction = packageActions[dependency]
				if(dependencyAction) {
					setDependencyVersionIfPresent(packageJson, dependency, dependencyAction.nextVersion)
				}
			}

			console.log(packageJson)
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
