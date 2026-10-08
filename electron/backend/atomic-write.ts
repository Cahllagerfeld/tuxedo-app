import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
export async function atomicWrite(path: string, contents: string): Promise<void> {
	const directory = dirname(path);
	await mkdir(directory, { recursive: true });
	const temporary = join(directory, `.tuxedo-${randomUUID()}.tmp`);
	try {
		const handle = await open(temporary, "wx", 0o600);
		try {
			await handle.writeFile(contents, "utf8");
			await handle.sync();
		} finally {
			await handle.close();
		}
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}
