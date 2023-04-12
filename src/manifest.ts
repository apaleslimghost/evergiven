import z from 'zod'
import { parseJsonFile } from './json'

const ManifestSchema = z.object({
	lastRelease: z.string()
})

export type Manifest = z.infer<typeof ManifestSchema>

export const parseManifest = (file: string) => parseJsonFile(file, ManifestSchema).catch(
	() => undefined
)
