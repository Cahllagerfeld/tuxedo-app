import { afterEach, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionBackend } from "../session-runtime";
import type { SavedViewFilterValues } from "@tuxedo/contracts";
const directories: string[] = [];
const backends: ReturnType<typeof createSessionBackend>[] = [];
afterEach(async () => {
	await Promise.all(backends.splice(0).map((backend) => backend.shutdown()));
	await Promise.all(
		directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
	);
});
const filters: SavedViewFilterValues = {
	status: "open",
	search: "invoice",
	project: "work",
	context: null,
	priority: "A",
	due: "today",
};
async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "tuxedo-views-"));
	directories.push(directory);
	const path = join(directory, "workspaces.json");
	const todoPath = join(directory, "todo.txt");
	await writeFile(todoPath, "Invoice +work\n");
	const backend = createSessionBackend(path);
	backends.push(backend);
	const created = await backend.createWorkspace({ name: "Work", color: "blue", todoPath });
	if (created.status !== "applied" || created.confirmed.session.status !== "ready")
		throw Error("Workspace fixture failed");
	const workspaceId = created.confirmed.session.catalogue.active_workspace_id!;
	return { directory, path, todoPath, backend, workspaceId };
}
test("saved views survive restart, remain Workspace-specific, and can be deleted without touching Todo files", async () => {
	const { backend, directory, path, todoPath, workspaceId } = await fixture();
	expect(await backend.readSavedViews({})).toEqual({ status: "applied", views: [] });
	await expect(readFile(join(directory, "saved-views.json"))).rejects.toMatchObject({
		code: "ENOENT",
	});
	const saved = await backend.saveView({ workspaceId, name: "Today at work", filters });
	expect(saved).toMatchObject({
		status: "applied",
		views: [{ workspace_id: workspaceId, name: "Today at work", filters }],
	});
	if (saved.status !== "applied") throw Error("Save failed");
	await backend.shutdown();
	const restarted = createSessionBackend(path);
	backends.push(restarted);
	expect(await restarted.readSavedViews({})).toEqual(saved);
	const secondPath = join(directory, "other.txt");
	await writeFile(secondPath, "Other\n");
	const other = await restarted.createWorkspace({
		name: "Other",
		color: "red",
		todoPath: secondPath,
	});
	if (other.status !== "applied" || other.confirmed.session.status !== "ready")
		throw Error("Other fixture failed");
	const otherId = other.confirmed.session.catalogue.active_workspace_id!;
	expect(
		await restarted.deleteView({ workspaceId: otherId, viewId: saved.views[0].id })
	).toMatchObject({ status: "rejected" });
	expect(
		await restarted.saveView({ workspaceId: otherId, name: "Today at work", filters })
	).toMatchObject({ status: "applied", views: expect.arrayContaining([{ ...saved.views[0] }]) });
	const deleted = await restarted.deleteView({ workspaceId, viewId: saved.views[0].id });
	expect(deleted).toMatchObject({ status: "applied", views: [{ workspace_id: otherId }] });
	expect(await readFile(todoPath, "utf8")).toBe("Invoice +work\n");
});
test.each(["{broken", '{"version":2,"views":[]}', '{"version":1,"views":[],"extra":true}'])(
	"invalid saved views are preserved without blocking Workspace restoration: %s",
	async (contents) => {
		const { backend, directory, workspaceId } = await fixture();
		const path = join(directory, "saved-views.json");
		await writeFile(path, contents);
		expect(await backend.readSavedViews({})).toMatchObject({
			status: "rejected",
			message: expect.stringContaining(path),
		});
		expect(await backend.saveView({ workspaceId, name: "Today", filters })).toMatchObject({
			status: "rejected",
		});
		expect(await backend.restoreSession({})).toMatchObject({ session: { status: "ready" } });
		expect(await readFile(path, "utf8")).toBe(contents);
	}
);
test("serialized saves retain both views and reject duplicate names and unknown Workspaces", async () => {
	const { backend, workspaceId } = await fixture();
	await Promise.all([
		backend.saveView({ workspaceId, name: "First", filters }),
		backend.saveView({ workspaceId, name: "Second", filters }),
	]);
	expect(await backend.saveView({ workspaceId, name: "first", filters })).toMatchObject({
		status: "rejected",
	});
	expect(
		await backend.saveView({
			workspaceId: "550e8400-e29b-41d4-a716-446655440000",
			name: "Unknown",
			filters,
		})
	).toMatchObject({ status: "rejected" });
	expect(await backend.readSavedViews({})).toMatchObject({
		status: "applied",
		views: [{ name: "First" }, { name: "Second" }],
	});
});
