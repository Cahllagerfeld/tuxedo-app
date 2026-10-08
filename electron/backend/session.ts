import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
	catalogueSchema,
	type ConfirmedSession,
	type DesktopAPI,
} from "../../src/lib/shared/desktop/contract";
export function createSessionBackend(cataloguePath: string): DesktopAPI {
	const scope = randomUUID();
	let revision = 0;
	let confirmed: ConfirmedSession | undefined;
	let queue: Promise<unknown> = Promise.resolve();
	const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
		const next = queue.then(operation, operation);
		queue = next.catch(() => undefined);
		return next;
	};
	const load = async (): Promise<ConfirmedSession> => {
		let session: ConfirmedSession["session"];
		try {
			const catalogue = catalogueSchema.parse(JSON.parse(await readFile(cataloguePath, "utf8")));
			session = {
				status: "empty",
				catalogue,
				warning: catalogue.active_workspace_id
					? "Active workspace restoration is not available in this migration slice."
					: null,
			};
		} catch (error) {
			if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
				session = {
					status: "empty",
					catalogue: { version: 1, workspaces: [], active_workspace_id: null },
					warning: null,
				};
			else
				session = {
					status: "unavailable",
					error: `Cannot read Workspace catalogue at ${cataloguePath}. Check its permissions or restore a valid version-1 backup. The file has been preserved.`,
				};
		}
		return { scope, revision: revision++, session };
	};
	return {
		readSession: () => serialize(async () => (confirmed ??= await load())),
		restoreSession: () => serialize(async () => (confirmed = await load())),
	};
}
