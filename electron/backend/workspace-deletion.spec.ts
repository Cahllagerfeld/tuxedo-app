import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm, writeFile, readFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionBackend } from "./session";
const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
	);
});
async function setup() {
	const directory = await mkdtemp(join(tmpdir(), "tuxedo-delete-"));
	directories.push(directory);
	const path = join(directory, "workspaces.json"),
		firstPath = join(directory, "first.todo"),
		secondPath = join(directory, "second.todo");
	await writeFile(firstPath, "First\r\n");
	await writeFile(secondPath, "Second\n");
	const backend = createSessionBackend(path);
	const first = await backend.createWorkspace({
		name: "First",
		color: "blue",
		todoPath: firstPath,
	});
	const second = await backend.createWorkspace({
		name: "Second",
		color: "green",
		todoPath: secondPath,
	});
	if (
		first.status !== "applied" ||
		second.status !== "applied" ||
		first.confirmed.session.status !== "ready" ||
		second.confirmed.session.status !== "ready"
	)
		throw Error("Setup failed");
	return {
		directory,
		path,
		firstPath,
		secondPath,
		backend,
		firstId: first.confirmed.session.catalogue.active_workspace_id!,
		secondId: second.confirmed.session.catalogue.active_workspace_id!,
		confirmed: second.confirmed,
	};
}
test("deleting the Active workspace clears selection and preserves both Todo files", async () => {
	const f = await setup();
	const result = await f.backend.deleteWorkspace({ workspaceId: f.secondId });
	expect(result).toMatchObject({
		status: "applied",
		confirmed: {
			session: {
				status: "empty",
				warning: null,
				catalogue: { active_workspace_id: null, workspaces: [{ id: f.firstId }] },
			},
		},
	});
	expect(await readFile(f.firstPath, "utf8")).toBe("First\r\n");
	expect(await readFile(f.secondPath, "utf8")).toBe("Second\n");
	expect(JSON.parse(await readFile(f.path, "utf8")).workspaces).toHaveLength(1);
});
test("inactive deletion rereads the remaining Active workspace and retains its selection", async () => {
	const f = await setup();
	await writeFile(f.secondPath, "Changed +Current\n2026-02-30 Skipped\n");
	const result = await f.backend.deleteWorkspace({ workspaceId: f.firstId });
	expect(result).toMatchObject({
		status: "applied",
		confirmed: {
			session: {
				status: "ready",
				catalogue: { active_workspace_id: f.secondId, workspaces: [{ id: f.secondId }] },
				todo_file: {
					items: [{ description: "Changed", projects: ["Current"] }],
					skipped: [{ line_number: 2 }],
				},
			},
		},
	});
});
test("a missing remaining Active Todo file warns without undoing catalogue deletion", async () => {
	const f = await setup();
	await rm(f.secondPath);
	const result = await f.backend.deleteWorkspace({ workspaceId: f.firstId });
	expect(result).toMatchObject({
		status: "applied",
		confirmed: {
			session: {
				status: "empty",
				warning: expect.stringContaining(f.secondPath),
				catalogue: { active_workspace_id: f.secondId, workspaces: [{ id: f.secondId }] },
			},
		},
	});
	expect(
		JSON.parse(await readFile(f.path, "utf8")).workspaces.map((w: { id: string }) => w.id)
	).toEqual([f.secondId]);
	expect(await readFile(f.firstPath, "utf8")).toBe("First\r\n");
});
test.each(["unknown", "invalid", "write-failure"])(
	"rejected deletion (%s) preserves persisted and confirmed state",
	async (failure) => {
		const f = await setup();
		const before = await readFile(f.path, "utf8");
		if (failure === "write-failure") await chmod(f.directory, 0o500);
		try {
			expect(
				await f.backend.deleteWorkspace({
					workspaceId:
						failure === "unknown"
							? "550e8400-e29b-41d4-a716-446655440099"
							: failure === "invalid"
								? "bad"
								: f.secondId,
				})
			).toMatchObject({
				status: "rejected",
				message: expect.stringContaining("Cannot delete Workspace"),
			});
		} finally {
			if (failure === "write-failure") await chmod(f.directory, 0o700);
		}
		expect(await f.backend.readSession({})).toEqual(f.confirmed);
		expect(await readFile(f.path, "utf8")).toBe(before);
	}
);
