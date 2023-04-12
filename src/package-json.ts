import type { PackageJson } from "@npmcli/package-json";
import z from 'zod'
import { parseJsonFile } from "./json";

const UsablePackageJsonSchema = z.object({
	name: z.string(),
	version: z.string()
}).and(z.record(z.any()))

export type UsablePackageJson = PackageJson & z.infer<typeof UsablePackageJsonSchema>

export const parsePackageJson = (file: string): Promise<UsablePackageJson> => parseJsonFile(file, UsablePackageJsonSchema)
