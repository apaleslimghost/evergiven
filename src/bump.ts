import type { PackageJson } from "@npmcli/package-json";
import type { ReleaseType } from "semver"
import semver from 'semver'
import * as conventionalCommits from "@conventional-commits/parser";

import { Commit, Package } from "./package"

const enum BumpLevel {
	NONE = 0,
	PATCH,
	MINOR,
	MAJOR
}

export type PackageBump = {
	package: Package,
	bumpLevel: BumpLevel,
	nextVersion: string,
	changes: PackageJsonChange[]
}

export type PackageBumps = Record<string, PackageBump>

type PackageJsonChange = (json: PackageJson) => void

const formatBumpLevel: Record<BumpLevel, ReleaseType | undefined> = {
	[BumpLevel.NONE]: undefined,
	[BumpLevel.PATCH]: 'patch',
	[BumpLevel.MINOR]: 'minor',
	[BumpLevel.MAJOR]: 'major',
}

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

export function determinePackageBump(previousBumps: PackageBumps, pkg: Package): PackageBump | undefined {
	const { commits, workspaceDeps, packageJson } = pkg
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

		const bump: PackageBump = { package: pkg, bumpLevel, nextVersion, changes: [] }

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
