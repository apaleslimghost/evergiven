import toposort from 'toposort'
import { loadContext } from "./context";
import { loadPackage } from "./package";
import { PackageBumps, determinePackageBump } from "./bump";
import { createPullRequest } from "./pull-request";


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

	const dependencyOrder = toposort.array(Array.from(workspaceDetails.keys()), dependencyGraph)

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

	await createPullRequest(bumps, context)
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
