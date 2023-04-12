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

const UsablePackageJsonSchema = z.object({
	name: z.string(),
	version: z.string()
}).and(z.record(z.any()))

type UsablePackageJson = PackageJson & z.infer<typeof UsablePackageJsonSchema>

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

async function commitsSince(git: SimpleGit, root: string, sha?: string) {
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

const parsePackageJson = (file: string): Promise<UsablePackageJson> => parseJsonFile(file, UsablePackageJsonSchema)

const setDependencyVersionIfPresent = (dependency: string, version: string): PackageJsonChange => pkg => {
	for(const dependencyType of ['dependencies', 'devDependencies'] as const) {
		const deps = pkg[dependencyType]
		const currentVersion = deps?.[dependency]

		if(currentVersion) {
			const extractVersion = semver.minVersion(currentVersion)?.format() ?? currentVersion
			deps[dependency] = currentVersion.replace(extractVersion, version)
		}
	}
}

type Context = {
	git: SimpleGit,
	manifest?: Manifest,
	workspaces: Map<string, string>
}

type Package = {
	commits: readonly Commit[],
	packageJson: UsablePackageJson,
	workspaceDeps: string[]
}

async function loadPackage(root: string, {git, manifest, workspaces}: Context): Promise<Package> {
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

	return { commits, packageJson, workspaceDeps }
}

type PackageBump = {
	bumpLevel: BumpLevel,
	nextVersion: string,
	changes: PackageJsonChange[]
}

type PackageBumps = Record<string, PackageBump>

type PackageJsonChange = (json: PackageJson) => void

function mapMap<K, A, B>(input: Map<K, A>, fn: (item: A, key: K) => B): Map<K, B> {
	const output = new Map<K, B>

	for(const [key, item] of input) {
		output.set(key, fn(item, key))
	}

	return output
}

async function promiseAllMap<K, V>(promises: Map<K, Promise<V>>): Promise<Map<K, V>> {
	return new Map(await Promise.all(
		Array.from(
			promises,
			async ([key, value]) => [key, await value] as const
		)
	))
}

function determinePackageBump(previousBumps: PackageBumps, { commits, workspaceDeps, packageJson }: Package): PackageBump | undefined {
	const dependenciesBumped = workspaceDeps.some(dep => dep in previousBumps)

	const bumpLevel: BumpLevel = Math.max(
		dependenciesBumped ? BumpLevel.PATCH : BumpLevel.NONE,
		...commits.map(commitBumpLevel),
	)

	if(bumpLevel > BumpLevel.NONE) {
		// TODO reduce level if major is zero
		const currentVersion = packageJson.version
		const releaseType = formatBumpLevel[bumpLevel]
		const nextVersion = currentVersion && releaseType ? semver.inc(currentVersion, releaseType)! : currentVersion

		const bump: PackageBump = { bumpLevel, nextVersion, changes: [] }

		bump.changes.push(
			json => json.version = nextVersion
		)

		for(const dependency of workspaceDeps) {
			const dependencyBump = previousBumps[dependency]

			if(dependencyBump) {
				bump.changes.push(
					setDependencyVersionIfPresent(dependency, dependencyBump.nextVersion)
				)
			}
		}

		return bump
	}
}

async function loadContext(root: string): Promise<Context> {
	const [manifest, pkg] = await Promise.all([
		parseJsonFile(path.resolve(root, '.evergiven-manifest.json'), ManifestSchema).catch(
			() => undefined
		),
		parsePackageJson(path.resolve(root, 'package.json'))
	])

	const git = simpleGit(root)

	const workspaces = await mapWorkspaces({
		cwd: root,
		pkg
	})

	return { manifest, workspaces, git }
}

async function main() {
	const context = await loadContext(process.cwd())

	const workspaceDetails = await promiseAllMap(
		mapMap(
			context.workspaces,
			workspaceRoot => loadPackage(workspaceRoot, context)
		)
	)

	const dependencyGraph = Array.from(workspaceDetails).flatMap(
		([workspaceName, { workspaceDeps }]) => (
			workspaceDeps.map((dep): [string, string] => [dep, workspaceName])
		)
	)

	const dependencyOrder = toposort(dependencyGraph)

	const bumps: PackageBumps = dependencyOrder.reduce(
		(bumps, pkgName) => {
			const details = workspaceDetails.get(pkgName)

			if(details) {
				const bump = determinePackageBump(bumps, details)

				if(bump) {
					return {
						...bumps,
						[pkgName]: bump
					}
				}
			}

			return bumps
		},
		{}
	)

	console.log(bumps)
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
