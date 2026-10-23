import { expect, test } from "vitest";
import { catalogueDependency, workspaceDependency, readWorkspace } from "./workspace-route-data";
import { savedViewsDependency } from "./saved-views";

test("IPC dependencies are absolute under both native Home and nested destination URLs", () => {
	for (const base of [
		"tuxedo://app/",
		"tuxedo://app/workspaces/one",
		"http://127.0.0.1:1420/workspaces/two",
	]) {
		expect(new URL(catalogueDependency, base).href).toBe("tuxedodata:catalogue");
		expect(new URL(workspaceDependency("one"), base).href).toBe("tuxedodata:workspace:one");
		expect(new URL(savedViewsDependency("one"), base).href).toBe("tuxedodata:saved-views:one");
	}
});

test("a failed destination read never retains another Workspace's route value", async () => {
	const result = await readWorkspace(
		{
			readWorkspace: async () => {
				throw Error("Read failed");
			},
		},
		"two",
		() => ({ workspaceId: "one", value: null, error: "Earlier" })
	);
	expect(result).toEqual({ workspaceId: "two", value: null, error: "Read failed" });
});

test.each(["speculative", "older"] as const)(
	"a %s read retains the current matching confirmed route resource",
	async (kind) => {
		const value: NonNullable<import("./workspace-route-data").WorkspaceData["value"]> = {
			status: "ready",
			workspace: {
				id: "one",
				name: "Work",
				color: "blue",
				todo_path: "/tmp/todo.txt",
				created_at: "2026-10-21T00:00:00Z",
			},
			todo_file: { path: "/tmp/todo.txt", items: [], skipped: [] },
			provenance: {
				status: "confirmed",
				selection: { scope: "scope", revision: 5, workspaceId: "one", todoPath: "/tmp/todo.txt" },
			},
		};
		if (value.provenance.status !== "confirmed") throw Error("fixture");
		const incoming = {
			...value,
			provenance:
				kind === "speculative"
					? { status: "speculative" as const }
					: {
							status: "confirmed" as const,
							selection: { ...value.provenance.selection, revision: 4 },
						},
			todo_file: { ...value.todo_file, skipped: [{ line_number: 1, raw: "x", reason: "Invalid" }] },
		};
		const result = await readWorkspace({ readWorkspace: async () => incoming }, "one", () => ({
			workspaceId: "one",
			value,
			error: "",
		}));
		expect(result.value).toBe(value);
		expect(result.error).toContain("confirmed");
	}
);
