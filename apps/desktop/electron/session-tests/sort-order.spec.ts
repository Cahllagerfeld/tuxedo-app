import { activateWorkspace, readConfirmation } from "./testing/read-confirmation";
import { afterEach, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionBackend } from "../session-runtime";
import type { ConfirmedSession } from "@tuxedo/contracts";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const target = (current: ConfirmedSession) => {
	if (current.session.status !== "ready") throw Error("Expected Ready");
	return {
		scope: current.scope,
		revision: current.revision,
		workspaceId: current.session.catalogue.active_workspace_id!,
	};
};
async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "tuxedo-sort-"));
	cleanups.push(() => rm(directory, { recursive: true, force: true }));
	const path = join(directory, "workspaces.json");
	const backend = createSessionBackend(path);
	cleanups.push(() => backend.dispose());
	const todoPath = join(directory, "todo.txt");
	await writeFile(todoPath, "Later due:2026-11-01\r\nEarlier due:2026-10-14\r\n");
	const created = await backend.createWorkspace({ name: "Work", color: "blue", todoPath });
	if (created.status !== "applied") throw Error(created.message);
	return { directory, path, todoPath, backend, current: created.confirmed };
}
test("sort choices survive Workspace switches and a backend restart without rewriting Todo files", async () => {
	const { directory, path, todoPath, backend, current } = await fixture();
	expect(
		current.session.status === "ready" && current.session.catalogue.workspaces[0].sort_order
	).toBeUndefined();
	const original = await readFile(todoPath, "utf8");
	const outcome = await backend.setWorkspaceSortOrder({ ...target(current), sortOrder: "due" });
	expect(outcome.status).toBe("applied");
	const otherPath = join(directory, "other.txt");
	await writeFile(otherPath, "Other");
	const other = await backend.createWorkspace({
		name: "Personal",
		color: "green",
		todoPath: otherPath,
	});
	if (other.status !== "applied") throw Error(other.message);
	const switched = await backend.switchWorkspace({ workspaceId: target(current).workspaceId });
	expect(switched).toMatchObject({
		status: "applied",
		confirmed: {
			session: {
				catalogue: {
					workspaces: [
						expect.objectContaining({ sort_order: "due" }),
						expect.not.objectContaining({ sort_order: "due" }),
					],
				},
			},
		},
	});
	await backend.dispose();
	const restarted = createSessionBackend(path);
	cleanups.push(() => restarted.dispose());
	expect(await activateWorkspace(restarted, target(current).workspaceId)).toMatchObject({
		session: {
			catalogue: {
				active_workspace_id: target(current).workspaceId,
				workspaces: [
					expect.objectContaining({ sort_order: "due" }),
					expect.not.objectContaining({ sort_order: "due" }),
				],
			},
		},
	});
	const reset = await restarted.setWorkspaceSortOrder({
		...target(await readConfirmation(restarted)),
		sortOrder: "file",
	});
	expect(reset.status).toBe("applied");
	expect(JSON.parse(await readFile(path, "utf8")).workspaces[0].sort_order).toBe("file");
	expect(await readFile(todoPath, "utf8")).toBe(original);
});
test("saving sort order preserves Undo and rejects stale targets without changing the catalogue", async () => {
	const { path, backend, current } = await fixture();
	const created = await backend.createTodo({
		...target(current),
		description: "New",
		projects: [],
		contexts: [],
	});
	if (created.status !== "applied") throw Error("Expected creation");
	const outcome = await backend.setWorkspaceSortOrder({
		...target(await readConfirmation(backend)),
		sortOrder: "due",
	});
	expect(outcome).toMatchObject({ status: "applied", confirmed: { undoLabel: "Undo creation" } });
	const contents = await readFile(path, "utf8");
	expect(
		await backend.setWorkspaceSortOrder({ ...target(current), sortOrder: "file" })
	).toMatchObject({ status: "rejected" });
	expect(await readFile(path, "utf8")).toBe(contents);
	expect(await backend.undoTodo(target(await readConfirmation(backend)))).toMatchObject({
		status: "applied",
	});
});
test("a corrupt catalogue is preserved and a failed save leaves confirmed sort order unchanged", async () => {
	const { path, backend, current } = await fixture();
	const original = await readFile(path, "utf8");
	await writeFile(path, "{broken");
	expect(
		await backend.setWorkspaceSortOrder({ ...target(current), sortOrder: "due" })
	).toMatchObject({ status: "rejected" });
	expect(await backend.refreshSession({})).toMatchObject({
		session: { status: "unavailable" },
	});
	expect(await readFile(path, "utf8")).toBe("{broken");
	await writeFile(path, original);
	expect((await backend.refreshSession({})).session).toEqual(current.session);
});
