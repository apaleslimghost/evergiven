import { PackageBump, PackageBumps } from "./bump"
import { Commit, Package } from "./package"

const formatCommit = (commit: Commit) => `- ${commit.subject} (${commit.sha.slice(0, 7)})`

const formatSection = (title: string, commits: Commit[]) => commits.length > 0 ? `#### ${title}
${commits.map(formatCommit).join('\n')}
` : ''

function formatCommitChangelog(commits: Commit[]): string {
	const features: Commit[] = []
	const fixes: Commit[] = []
	const breaking: Commit[] = []

	for(const commit of commits) {
		if(commit.notes.length && commit.notes.some(note => note.title === 'BREAKING CHANGE')) {
			breaking.push(commit)
		} else if(commit.type === 'feat') {
			features.push(commit)
		} else if(commit.type === 'fix') {
			fixes.push(commit)
		}
	}

	return `${formatSection('⚠ Breaking changes', breaking)}
${formatSection('Features', features)}
${formatSection('Bux fixes', fixes)}
`
}

const formatPRSection = (bump: PackageBump) => `<details>
<summary><h3><code>${bump.package.packageJson.name}</code> v${bump.nextVersion}</h3></summary>

${formatCommitChangelog(bump.package.commits).split('\n').map(line => `> ${line}`).join('\n')}

</details>
`

export const formatPRChangelog = (bumps: PackageBumps) => `# release
${Object.values(bumps).map(formatPRSection).join('\n\n')}
`

export const formatFileChangelog = (bump: PackageBump) => `## v${bump.nextVersion}
${formatCommitChangelog(bump.package.commits).replace(/^####/mg, '###')}
`
