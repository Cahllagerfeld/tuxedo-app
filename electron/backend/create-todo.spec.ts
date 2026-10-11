import { afterEach, expect, test } from "vitest";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSessionBackend } from "./session";

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
	);
});

async function setup(contents: string) {
	const directory = await mkdtemp(join(tmpdir(), "tuxedo-create-todo-"));
	directories.push(directory);
	const todoPath = join(directory, "todo.txt");
	await writeFile(todoPath, contents);
	const backend = createSessionBackend(join(directory, "workspaces.json"));
	const created = await backend.createWorkspace({ name: "Personal", color: "blue", todoPath });
	if (created.status !== "applied" || created.confirmed.session.status !== "ready")
		throw Error("Creation setup failed");
	return {
		backend,
		directory,
		todoPath,
		confirmed: created.confirmed,
		workspaceId: created.confirmed.session.catalogue.active_workspace_id!,
	};
}

function request(
	confirmed: Awaited<ReturnType<typeof setup>>["confirmed"],
	workspaceId: string,
	values: {
		description?: string;
		projects?: readonly string[];
		contexts?: readonly string[];
		creationDate?: null;
	} = {}
) {
	return {
		scope: confirmed.scope,
		revision: confirmed.revision,
		workspaceId,
		...values,
		description: values.description ?? "Plan the release",
		projects: [...(values.projects ?? [])],
		contexts: [...(values.contexts ?? [])],
	};
}

function today(): string {
	const date = new Date();
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

test("creates one open item with canonical field order, source casing, and completed-item state", async () => {
	const initial = "x 2026-10-08 Finished +Archive @Phone\r\n\nKeep this";
	const { backend, todoPath, confirmed, workspaceId } = await setup(initial);

	const outcome = await backend.createTodo(
		request(confirmed, workspaceId, {
			description: "  Plan   the\trelease  ",
			projects: ["Tuxedo", "Review"],
			contexts: ["Phone", "phone"],
		})
	);

	expect(outcome.status).toBe("applied");
	if (outcome.status !== "applied") throw Error(outcome.message);
	expect(await readFile(todoPath, "utf8")).toBe(
		`${initial}\r\n${today()} Plan the release +Tuxedo +Review @Phone @phone`
	);
	expect(outcome.confirmed).toMatchObject({
		scope: confirmed.scope,
		workspaceId,
		todo_file: {
			items: [
				{ completed: true, projects: ["Archive"], contexts: ["Phone"] },
				{ description: "Keep this" },
				{
					completed: false,
					creation_date: today(),
					description: "Plan the release",
					projects: ["Tuxedo", "Review"],
					contexts: ["Phone", "phone"],
					priority: null,
					completion_date: null,
					metadata: {},
				},
			],
		},
	});
});

test.each([
	["empty", ""],
	["no trailing newline", "Existing"],
	["CRLF trailing newline", "Existing\r\n"],
	["CRLF without trailing newline", "Existing\r\nLast"],
] as const)(
	"appends the final line while preserving %s newline convention",
	async (_name, initial) => {
		const { backend, todoPath, confirmed, workspaceId } = await setup(initial);
		const outcome = await backend.createTodo(
			request(confirmed, workspaceId, { description: "line" })
		);

		expect(outcome.status).toBe("applied");
		const newline = initial.match(/\r\n|\n/u)?.[0] ?? "\n";
		const expected =
			initial === ""
				? `${today()} line`
				: initial.endsWith("\n")
					? `${initial}${today()} line${newline}`
					: `${initial}${newline}${today()} line`;
		expect(await readFile(todoPath, "utf8")).toBe(expected);
	}
);

test.each([
	["blank description", { description: " \t ", creationDate: null }],
	["project token in description", { description: "Plan +Project" }],
	["context token in description", { description: "Plan @home" }],
	["metadata token in description", { description: "Plan due:tomorrow" }],
	["duplicate projects", { projects: ["Work", "Work"] }],
	["whitespace in context", { contexts: ["at home"] }],
	["Unicode whitespace in context", { contexts: ["at\u0085home"] }],
	["Unicode-separated project token", { description: "Call\u0085+Work" }],
	["Unicode blank description", { description: "\u0085", creationDate: null }],
] as const)("rejects %s without changing file bytes or confirmed data", async (_name, values) => {
	const initial = "Keep\r\n";
	const { backend, todoPath, confirmed, workspaceId } = await setup(initial);
	const outcome = await backend.createTodo(request(confirmed, workspaceId, values));

	expect(outcome.status).toBe("rejected");
	expect(await readFile(todoPath, "utf8")).toBe(initial);
	expect(await backend.readSession({})).toEqual(confirmed);
});

test("allows description tokens that the parser keeps as description text", async () => {
	const { backend, todoPath, confirmed, workspaceId } = await setup("Keep\n");
	const outcome = await backend.createTodo(
		request(confirmed, workspaceId, {
			description: "Plan + https://example.test/a:b:extra",
		})
	);

	expect(outcome.status).toBe("applied");
	expect(await readFile(todoPath, "utf8")).toContain(
		`${today()} Plan + https://example.test/a:b:extra`
	);
});

test("returns a conflict and confirms externally changed contents without appending", async () => {
	const { backend, todoPath, confirmed, workspaceId } = await setup("Original\n");
	const changed = "Changed externally\r\n";
	await writeFile(todoPath, changed);

	const outcome = await backend.createTodo(request(confirmed, workspaceId));

	expect(outcome.status).toBe("conflict");
	if (outcome.status !== "conflict") throw Error("Expected conflict");
	expect(await readFile(todoPath, "utf8")).toBe(changed);
	expect(outcome.confirmed.todo_file.items[0].description).toBe("Changed externally");
	expect((await backend.readSession({})).revision).toBe(outcome.confirmed.revision);
});

test("serializes duplicate creation intents so only one is applied", async () => {
	const { backend, todoPath, confirmed, workspaceId } = await setup("Existing");
	const input = request(confirmed, workspaceId, { description: "Once" });

	const outcomes = await Promise.all([backend.createTodo(input), backend.createTodo(input)]);

	expect(outcomes.map((outcome) => outcome.status)).toEqual(["applied", "rejected"]);
	expect((await readFile(todoPath, "utf8")).match(/Once/g)).toHaveLength(1);
});

test.each(["scope", "revision", "workspace"] as const)(
	"rejects a create request with an invalid %s",
	async (kind) => {
		const { backend, todoPath, confirmed, workspaceId } = await setup("Existing");
		const input = request(confirmed, workspaceId);
		if (kind === "scope") input.scope = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
		if (kind === "revision") input.revision++;
		if (kind === "workspace") input.workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

		expect((await backend.createTodo(input)).status).toBe("rejected");
		expect(await readFile(todoPath, "utf8")).toBe("Existing");
		expect(await backend.readSession({})).toEqual(confirmed);
	}
);

test("retains the confirmed snapshot and cleans temporary files when atomic replacement fails", async () => {
	const { backend, directory, todoPath, confirmed, workspaceId } = await setup("Existing\n");
	await chmod(directory, 0o500);
	let outcome;
	try {
		outcome = await backend.createTodo(request(confirmed, workspaceId));
	} finally {
		await chmod(directory, 0o700);
	}

	expect(outcome).toMatchObject({
		status: "rejected",
		message: expect.stringContaining("Cannot create Todo item"),
	});
	expect(await readFile(todoPath, "utf8")).toBe("Existing\n");
	expect(await backend.readSession({})).toEqual(confirmed);
	expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
});

test("creates full-format completed items and preserves priority as Metadata", async () => {
	const { backend, todoPath, confirmed, workspaceId } = await setup("Keep\n");
	const outcome = await backend.createTodo({
		...request(confirmed, workspaceId),
		priority: "Z",
		creationDate: "2026-10-01",
		completed: true,
		completionDate: "2026-10-09",
		metadata: ["due:2026-10-10", "custom:value"],
	});
	expect(outcome.status).toBe("applied");
	expect(await readFile(todoPath, "utf8")).toBe(
		"Keep\nx 2026-10-09 2026-10-01 Plan the release due:2026-10-10 custom:value pri:Z\n"
	);
	if (outcome.status !== "applied") throw Error(outcome.message);
	expect(outcome.confirmed.todo_file.items.at(-1)).toMatchObject({
		completed: true,
		creation_date: "2026-10-01",
		completion_date: "2026-10-09",
		priority: null,
		metadata: { due: "2026-10-10", custom: "value", pri: "Z" },
	});
});

test.each([
	[
		{ priority: "A", creationDate: null },
		"(A) Plan the release",
		{ priority: "A", creation_date: null },
	],
	[
		{ description: "", projects: ["+Work", "@Home"], creationDate: null },
		"++Work +@Home",
		{ projects: ["+Work", "@Home"], creation_date: null },
	],
	[
		{ description: "", priority: "B", creationDate: null },
		"(B) ",
		{ priority: "B", creation_date: null },
	],
	[{ description: "", creationDate: "2026-10-02" }, "2026-10-02", { creation_date: "2026-10-02" }],
] as const)("round-trips optional content and dates %#", async (values, line, parsed) => {
	const { backend, todoPath, confirmed, workspaceId } = await setup("");
	const outcome = await backend.createTodo({
		...request(confirmed, workspaceId),
		...values,
		projects: [...("projects" in values ? values.projects : [])],
	});
	expect(outcome.status).toBe("applied");
	expect(await readFile(todoPath, "utf8")).toBe(line);
	if (outcome.status !== "applied") throw Error(outcome.message);
	expect(outcome.confirmed.todo_file.items[0]).toMatchObject(parsed);
});

test.each([
	{ priority: "a" },
	{ priority: "AA" },
	{ creationDate: "2026-02-29" },
	{ completed: true, completionDate: null },
	{ completionDate: "2026-10-09" },
	{ metadata: ["bad:has space"] },
	{ metadata: ["+key:value"] },
	{ metadata: ["key:too:many"] },
	{ completed: true, completionDate: "2026-10-09", priority: "A", metadata: ["pri:B"] },
	{ creationDate: null, description: "x Completed" },
	{ creationDate: null, description: "x", projects: ["Work"] },
	{ creationDate: null, description: "(A)", contexts: ["Home"] },
	{
		creationDate: null,
		completed: true,
		completionDate: "2026-10-09",
		priority: "A",
		description: "(B) hello",
	},
	{ creationDate: null, description: "(A) Priority" },
	{ creationDate: null, description: "2026-10-09 Date" },
])("rejects ambiguous or invalid structured fields without writes %#", async (values) => {
	const { backend, todoPath, confirmed, workspaceId } = await setup("Keep");
	const outcome = await backend.createTodo({ ...request(confirmed, workspaceId), ...values });
	expect(outcome.status).toBe("rejected");
	expect(await readFile(todoPath, "utf8")).toBe("Keep");
	expect(await backend.readSession({})).toEqual(confirmed);
});

test("preserves repeated Metadata in the Todo file and confirms its last value", async () => {
	const { backend, todoPath, confirmed, workspaceId } = await setup("");
	const outcome = await backend.createTodo({
		...request(confirmed, workspaceId),
		creationDate: null,
		metadata: ["custom:first", "custom:last"],
	});
	expect(outcome.status).toBe("applied");
	expect(await readFile(todoPath, "utf8")).toBe("Plan the release custom:first custom:last");
	if (outcome.status !== "applied") throw Error(outcome.message);
	expect(outcome.confirmed.todo_file.items[0].metadata).toEqual({ custom: "last" });
});
