import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionBackend } from "../session-runtime";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
	);
});
async function setup(contents: string) {
	const directory = await mkdtemp(join(tmpdir(), "tuxedo-recurrence-"));
	directories.push(directory);
	const path = join(directory, "todo.txt");
	await writeFile(path, contents.replace("2026-13-01 Skipped", "Other"));
	const catalogue = join(directory, "workspaces.json");
	const backend = createSessionBackend(catalogue, undefined, undefined, {
		identity: { uuid: randomUUID, now: () => new Date(2028, 0, 31, 12).toISOString() },
	});
	const result = await backend.createWorkspace({ name: "Home", color: "blue", todoPath: path });
	if (result.status !== "applied" || result.confirmed.session.status !== "ready")
		throw Error(JSON.stringify(result));
	await writeFile(path, contents);
	const target = {
		scope: result.confirmed.scope,
		revision: result.confirmed.revision,
		workspaceId: result.confirmed.session.catalogue.active_workspace_id!,
		lineNumber: 1,
		expectedRaw: result.confirmed.session.todo_file.items[0].raw,
	};
	return { backend, path, target, catalogue };
}
test("completion inserts one successor, preserves other bytes, and undoes the entire change", async () => {
	const initial =
		"(A) 2020-01-01 Clean +Home @desk rec:1m due:old custom:first custom:last\r\n\n2026-13-01 Skipped\nLast";
	const { backend, path, target } = await setup(initial);
	const result = await backend.setTodoCompletion({ ...target, completed: true });
	expect(result.status).toBe("applied");
	if (result.status !== "applied") throw Error("completion failed");
	expect(result).toMatchObject({ notice: "Next occurrence due 2028-02-29." });
	expect(await readFile(path, "utf8")).toBe(
		"x 2028-01-31 2020-01-01 Clean +Home @desk rec:1m due:old custom:first custom:last pri:A tuxedo-generated:1\r\n(A) 2028-01-31 Clean +Home @desk rec:1m custom:first custom:last due:2028-02-29\r\n\n2026-13-01 Skipped\nLast"
	);
	expect(
		(
			await backend.undoTodo({
				scope: target.scope,
				workspaceId: target.workspaceId,
				revision: result.confirmed.revision,
			})
		).status
	).toBe("applied");
	expect(await readFile(path, "utf8")).toBe(initial);
});

test.each([
	["1d", "2028-02-01"],
	["2w", "2028-02-14"],
	["1m", "2028-02-29"],
	["13m", "2029-02-28"],
	["1y", "2029-01-31"],
])("checkbox completion calculates %s from local today", async (rule, due) => {
	const { backend, path, target } = await setup(`Clean rec:${rule}`);
	const result = await backend.setTodoCompletion({ ...target, completed: true });
	expect(result.status).toBe("applied");
	if (result.status !== "applied") throw Error("failed");
	expect(result.confirmed.todo_file.items[1]).toMatchObject({
		completed: false,
		creation_date: "2028-01-31",
		completion_date: null,
		metadata: { due, rec: rule },
	});
	expect(await readFile(path, "utf8")).toContain(`\n2028-01-31 Clean rec:${rule} due:${due}`);
});

test.each(["+1w", "0d", "-1d", "1D", "1.5m", "1b", "1w2d"])(
	"unsupported %s completes normally with a notice",
	async (rule) => {
		const { backend, path, target } = await setup(`Clean rec:${rule}`);
		const result = await backend.setTodoCompletion({ ...target, completed: true });
		expect(result).toMatchObject({
			status: "applied",
			notice: "Unsupported Repeat rule; no next occurrence generated.",
		});
		expect(await readFile(path, "utf8")).toBe(`x 2028-01-31 Clean rec:${rule}`);
	}
);

test.each(["999999999999999999999d", "9999y", "999999m", "999999999999999w"])(
	"supported rule %s exceeding bounds rejects with no write",
	async (rule) => {
		const initial = `Clean rec:${rule}`;
		const { backend, path, target } = await setup(initial);
		const before = await backend.readSession({});
		expect((await backend.setTodoCompletion({ ...target, completed: true })).status).toBe(
			"rejected"
		);
		expect(await readFile(path, "utf8")).toBe(initial);
		expect(await backend.readSession({})).toEqual(before);
	}
);

test.each(["\n", "\r\n", ""])(
	"recurrence respects EOF ending %j and last rule wins",
	async (ending) => {
		const { backend, path, target } = await setup(
			`Clean rec:+1w rec:1d due:first due:last${ending}`
		);
		const result = await backend.setTodoCompletion({ ...target, completed: true });
		expect(result.status).toBe("applied");
		expect(await readFile(path, "utf8")).toBe(
			`x 2028-01-31 Clean rec:+1w rec:1d due:first due:last tuxedo-generated:1${ending || "\n"}2028-01-31 Clean rec:+1w rec:1d due:2028-02-01${ending}`
		);
	}
);

test("bare rec: is description text and does not change the metadata grammar", async () => {
	const { backend, path, target } = await setup("Clean rec:");
	const result = await backend.setTodoCompletion({ ...target, completed: true });
	expect(result.status).toBe("applied");
	expect(await readFile(path, "utf8")).toBe("x 2028-01-31 Clean rec:");
	expect(result).not.toHaveProperty("notice");
});

test("editor completion uses saved content and backdated leap day, then a durable marker prevents regeneration", async () => {
	const { backend, path, target, catalogue } = await setup("(A) Clean rec:2w");
	const result = await backend.editTodo({
		...target,
		description: "New chore",
		projects: ["Home"],
		contexts: [],
		priority: "B",
		creationDate: null,
		completed: true,
		completionDate: "2024-02-29",
		metadata: ["rec:1y", "custom:yes"],
	});
	expect(result.status).toBe("applied");
	if (result.status !== "applied") throw Error("failed");
	expect(result.confirmed.todo_file.items[1]).toMatchObject({
		priority: "B",
		creation_date: "2028-01-31",
		metadata: { rec: "1y", due: "2025-02-28", custom: "yes" },
	});
	await backend.dispose();
	const restarted = createSessionBackend(catalogue);
	const restored = await restarted.restoreSession({});
	if (restored.session.status !== "ready") throw Error("restore failed");
	const original = restored.session.todo_file.items[0];
	const reopened = await restarted.setTodoCompletion({
		...target,
		scope: restored.scope,
		revision: restored.revision,
		expectedRaw: original.raw,
		completed: false,
	});
	if (reopened.status !== "applied") throw Error("reopening failed");
	const before = await readFile(path, "utf8");
	const recompleted = await restarted.setTodoCompletion({
		...target,
		scope: restored.scope,
		revision: reopened.confirmed.revision,
		expectedRaw: reopened.confirmed.todo_file.items[0].raw,
		completed: true,
	});
	expect(recompleted.status).toBe("applied");
	if (recompleted.status !== "applied") throw Error("recompletion failed");
	expect(recompleted.confirmed.todo_file.items).toHaveLength(2);
	expect((await readFile(path, "utf8")).split("\n")[1]).toBe(before.split("\n")[1]);
	await restarted.dispose();
});

test("editing preserves the app-owned marker even if the metadata draft omits it", async () => {
	const { backend, target } = await setup("Clean rec:1d tuxedo-generated:1");
	const edited = await backend.editTodo({
		...target,
		description: "Changed",
		projects: [],
		contexts: [],
		completed: false,
		completionDate: null,
		creationDate: null,
		metadata: ["rec:2w"],
	});
	if (edited.status !== "applied") throw Error("edit failed");
	expect(edited.confirmed.todo_file.items[0].metadata).toEqual({
		rec: "2w",
		"tuxedo-generated": "1",
	});
	const completed = await backend.setTodoCompletion({
		...target,
		revision: edited.confirmed.revision,
		expectedRaw: edited.confirmed.todo_file.items[0].raw,
		completed: true,
	});
	if (completed.status !== "applied") throw Error("completion failed");
	expect(completed.confirmed.todo_file.items).toHaveLength(1);
});

test("completed-history edits and already-completed creation generate nothing", async () => {
	const { backend, target } = await setup("x 2024-02-29 Clean rec:1y");
	const edited = await backend.editTodo({
		...target,
		description: "Changed",
		projects: [],
		contexts: [],
		completed: true,
		completionDate: "2024-02-29",
		creationDate: null,
		metadata: ["rec:2w"],
	});
	if (edited.status !== "applied") throw Error("edit failed");
	expect(edited.confirmed.todo_file.items).toHaveLength(1);
	const created = await backend.createTodo({
		scope: target.scope,
		workspaceId: target.workspaceId,
		revision: edited.confirmed.revision,
		description: "History",
		projects: [],
		contexts: [],
		completed: true,
		completionDate: "2024-02-29",
		metadata: ["rec:1d"],
	});
	if (created.status !== "applied") throw Error("create failed");
	expect(created.confirmed.todo_file.items).toHaveLength(2);
});

test("a supported rule without a recorded Completion date rejects the editor transition", async () => {
	const { backend, path, target } = await setup("Clean rec:1d");
	const result = await backend.editTodo({
		...target,
		description: "Clean",
		projects: [],
		contexts: [],
		completed: true,
		completionDate: null,
		creationDate: null,
		metadata: ["rec:1d"],
	});
	expect(result.status).toBe("rejected");
	expect(await readFile(path, "utf8")).toBe("Clean rec:1d");
});

test.each([null, "A"])(
	"successor Priority follows the open source (%s) rather than pri metadata",
	async (priority) => {
		const { backend, target } = await setup(
			`${priority ? `(${priority}) ` : ""}Clean pri:A rec:1d`
		);
		const result = await backend.setTodoCompletion({ ...target, completed: true });
		if (result.status !== "applied") throw Error("failed");
		expect(result.confirmed.todo_file.items[1].priority).toBe(priority);
		expect(result.confirmed.todo_file.items[1].metadata.pri).toBe(priority ? undefined : "A");
	}
);

test.each(["target conflict", "write failure"])(
	"recurrence %s leaves no partial original, marker, or successor",
	async (kind) => {
		const { chmod } = await import("node:fs/promises");
		const { dirname } = await import("node:path");
		const initial = "Clean rec:1d";
		const { backend, path, target } = await setup(initial);
		const before = await backend.readSession({});
		if (kind === "target conflict") await writeFile(path, "External change rec:1d");
		else await chmod(dirname(path), 0o500);
		let result;
		try {
			result = await backend.setTodoCompletion({ ...target, completed: true });
		} finally {
			if (kind === "write failure") await chmod(dirname(path), 0o700);
		}
		expect(result.status).toBe(kind === "target conflict" ? "conflict" : "rejected");
		expect(await readFile(path, "utf8")).toBe(
			kind === "target conflict" ? "External change rec:1d" : initial
		);
		if (kind === "write failure") expect(await backend.readSession({})).toEqual(before);
	}
);

test("completion carries Show from lead time onto the successor and undoes both lines", async () => {
	const initial = "Mow rec:1m due:2028-02-01 t:2028-01-29";
	const { backend, path, target } = await setup(initial);
	const result = await backend.setTodoCompletion({ ...target, completed: true });
	expect(result.status).toBe("applied");
	if (result.status !== "applied") throw Error("failed");
	expect(result.notice).toBe("Next occurrence due 2028-02-29. Show from 2028-02-26.");
	expect(result.confirmed.todo_file.items[0].metadata.t).toBe("2028-01-29");
	expect(result.confirmed.todo_file.items[1].metadata).toMatchObject({
		rec: "1m",
		due: "2028-02-29",
		t: "2028-02-26",
	});
	expect(await readFile(path, "utf8")).toBe(
		"x 2028-01-31 Mow rec:1m due:2028-02-01 t:2028-01-29 tuxedo-generated:1\n2028-01-31 Mow rec:1m t:2028-02-26 due:2028-02-29"
	);
	expect(
		(
			await backend.undoTodo({
				scope: target.scope,
				workspaceId: target.workspaceId,
				revision: result.confirmed.revision,
			})
		).status
	).toBe("applied");
	expect(await readFile(path, "utf8")).toBe(initial);
});

test("a valid Show from without a valid Due date is omitted from the successor", async () => {
	const initial = "Mow rec:1d t:+2d t:2099-01-01";
	const { backend, path, target } = await setup(initial);
	const result = await backend.setTodoCompletion({ ...target, completed: true });
	expect(result.status).toBe("applied");
	if (result.status !== "applied") throw Error("failed");
	expect(result.notice).toBe("Next occurrence due 2028-02-01.");
	expect(result.confirmed.todo_file.items[0].metadata.t).toBe("2099-01-01");
	expect(result.confirmed.todo_file.items[1].metadata).toEqual({
		rec: "1d",
		due: "2028-02-01",
		t: "+2d",
	});
	expect(await readFile(path, "utf8")).toBe(
		"x 2028-01-31 Mow rec:1d t:+2d t:2099-01-01 tuxedo-generated:1\n2028-01-31 Mow rec:1d t:+2d due:2028-02-01"
	);
});

test("completion keeps a Show from that falls after the Due date", async () => {
	const initial = "Mow rec:1d due:2028-01-28 t:2028-01-31";
	const { backend, path, target } = await setup(initial);
	const result = await backend.setTodoCompletion({ ...target, completed: true });
	expect(result.status).toBe("applied");
	expect(result).toMatchObject({
		notice: "Next occurrence due 2028-02-01. Show from 2028-02-04.",
	});
	expect(await readFile(path, "utf8")).toBe(
		"x 2028-01-31 Mow rec:1d due:2028-01-28 t:2028-01-31 tuxedo-generated:1\n2028-01-31 Mow rec:1d t:2028-02-04 due:2028-02-01"
	);
});

test("the last valid Show from is the one carried forward", async () => {
	const initial = "Mow rec:1m due:2028-02-01 t:2028-01-01 t:2028-01-29";
	const { backend, path, target } = await setup(initial);
	const result = await backend.setTodoCompletion({ ...target, completed: true });
	expect(result.status).toBe("applied");
	expect(await readFile(path, "utf8")).toBe(
		"x 2028-01-31 Mow rec:1m due:2028-02-01 t:2028-01-01 t:2028-01-29 tuxedo-generated:1\n2028-01-31 Mow rec:1m t:2028-01-01 t:2028-02-26 due:2028-02-29"
	);
});

test("a successor Show from on the completion date is kept and omitted from feedback", async () => {
	const initial = "Trim rec:1d due:2028-02-10 t:2028-02-09";
	const { backend, path, target } = await setup(initial);
	const result = await backend.setTodoCompletion({ ...target, completed: true });
	expect(result).toMatchObject({ notice: "Next occurrence due 2028-02-01." });
	expect(await readFile(path, "utf8")).toBe(
		"x 2028-01-31 Trim rec:1d due:2028-02-10 t:2028-02-09 tuxedo-generated:1\n2028-01-31 Trim rec:1d t:2028-01-31 due:2028-02-01"
	);
});

test("an unsupported effective Show from is copied unchanged", async () => {
	const initial = "Mow rec:1d due:2028-02-01 t:2099-01-01 t:+2d";
	const { backend, path, target } = await setup(initial);
	const result = await backend.setTodoCompletion({ ...target, completed: true });
	expect(result).toMatchObject({ notice: "Next occurrence due 2028-02-01." });
	expect(await readFile(path, "utf8")).toBe(
		"x 2028-01-31 Mow rec:1d due:2028-02-01 t:2099-01-01 t:+2d tuxedo-generated:1\n2028-01-31 Mow rec:1d t:2099-01-01 t:+2d due:2028-02-01"
	);
});

test.each(["due:soon", "due:2026-02-30"])(
	"invalid %s omits the absolute Show from and keeps malformed threshold metadata",
	async (due) => {
		const initial = `Mow rec:1d ${due} t:2026-02-30 t:2099-01-01`;
		const { backend, path, target } = await setup(initial);
		const result = await backend.setTodoCompletion({ ...target, completed: true });
		expect(result).toMatchObject({ notice: "Next occurrence due 2028-02-01." });
		expect(await readFile(path, "utf8")).toBe(
			`x 2028-01-31 Mow rec:1d ${due} t:2026-02-30 t:2099-01-01 tuxedo-generated:1\n2028-01-31 Mow rec:1d t:2026-02-30 due:2028-02-01`
		);
	}
);

test("editor completion anchors Show from lead time to the recorded Completion date", async () => {
	const { backend, target } = await setup("Mow rec:1y due:2024-03-01 t:2024-02-27");
	const result = await backend.editTodo({
		...target,
		description: "Mow",
		projects: [],
		contexts: [],
		priority: null,
		creationDate: null,
		completed: true,
		completionDate: "2024-02-29",
		metadata: ["rec:1y", "due:2024-03-01", "t:2024-02-27"],
	});
	expect(result.status).toBe("applied");
	if (result.status !== "applied") throw Error("failed");
	expect(result.notice).toBe("Next occurrence due 2025-02-28.");
	expect(result.confirmed.todo_file.items[0].metadata.t).toBe("2024-02-27");
	expect(result.confirmed.todo_file.items[1].metadata).toMatchObject({
		due: "2025-02-28",
		t: "2025-02-25",
	});
});

test.each(["Mow rec:1d due:2028-01-31 t:9999-12-31", "Mow rec:1d due:9999-12-31 t:0001-01-01"])(
	"Show from outside the supported range rejects %s with no write",
	async (initial) => {
		const { backend, path, target } = await setup(initial);
		const before = await backend.readSession({});
		const result = await backend.setTodoCompletion({ ...target, completed: true });
		expect(result).toMatchObject({
			status: "rejected",
			message: "The next Show from date is outside the supported date range.",
		});
		expect(await readFile(path, "utf8")).toBe(initial);
		expect(await backend.readSession({})).toEqual(before);
	}
);

test("editor completion rejects an out-of-range Show from with no write", async () => {
	const initial = "Mow rec:1d due:2028-01-31 t:9999-12-31";
	const { backend, path, target } = await setup(initial);
	const before = await backend.readSession({});
	const result = await backend.editTodo({
		...target,
		description: "Mow",
		projects: [],
		contexts: [],
		priority: null,
		creationDate: null,
		completed: true,
		completionDate: "2028-01-31",
		metadata: ["rec:1d", "due:2028-01-31", "t:9999-12-31"],
	});
	expect(result).toMatchObject({
		status: "rejected",
		message: "Cannot edit Todo item: The next Show from date is outside the supported date range.",
	});
	expect(await readFile(path, "utf8")).toBe(initial);
	expect(await backend.readSession({})).toEqual(before);
});

test("unsupported recurrence keeps Show from metadata and generates nothing", async () => {
	const initial = "Mow rec:+1w t:2099-01-01";
	const { backend, path, target } = await setup(initial);
	const result = await backend.setTodoCompletion({ ...target, completed: true });
	expect(result).toMatchObject({
		status: "applied",
		notice: "Unsupported Repeat rule; no next occurrence generated.",
	});
	expect(await readFile(path, "utf8")).toBe("x 2028-01-31 Mow rec:+1w t:2099-01-01");
});

test("Undo permits generation again, while deleting a successor and reopening does not", async () => {
	const { backend, path, target } = await setup("Clean rec:1d");
	const first = await backend.setTodoCompletion({ ...target, completed: true });
	if (first.status !== "applied") throw Error("complete");
	const undone = await backend.undoTodo({
		scope: target.scope,
		workspaceId: target.workspaceId,
		revision: first.confirmed.revision,
	});
	if (undone.status !== "applied") throw Error("undo");
	const second = await backend.setTodoCompletion({
		...target,
		revision: undone.confirmed.revision,
		completed: true,
	});
	if (second.status !== "applied") throw Error("complete again");
	expect(second.confirmed.todo_file.items).toHaveLength(2);
	const deleted = await backend.deleteTodo({
		...target,
		revision: second.confirmed.revision,
		lineNumber: 2,
		expectedRaw: second.confirmed.todo_file.items[1].raw,
	});
	if (deleted.status !== "applied") throw Error("delete");
	const reopened = await backend.setTodoCompletion({
		...target,
		revision: deleted.confirmed.revision,
		expectedRaw: deleted.confirmed.todo_file.items[0].raw,
		completed: false,
	});
	if (reopened.status !== "applied") throw Error("reopen");
	const recompleted = await backend.setTodoCompletion({
		...target,
		revision: reopened.confirmed.revision,
		expectedRaw: reopened.confirmed.todo_file.items[0].raw,
		completed: true,
	});
	if (recompleted.status !== "applied") throw Error("recomplete");
	expect(recompleted.confirmed.todo_file.items).toHaveLength(1);
	expect(await readFile(path, "utf8")).toContain("tuxedo-generated:1");
});
