import {
	createTodoRequestSchema,
	type ConfirmedTodo,
	type DesktopRequest,
	type TodoFile,
} from "../../src/lib/shared/desktop/contract";

export type CreateTodoRequest = DesktopRequest<"createTodo">;
export type CreateTodoOutcome =
	| { status: "applied"; confirmed: ConfirmedTodo }
	| { status: "conflict"; confirmed: ConfirmedTodo; message: string }
	| { status: "rejected"; message: string };
export type CreateTodoOperation = (request: CreateTodoRequest) => Promise<CreateTodoOutcome>;

function normalizeDescription(value: string): string {
	const description = value.trim().replace(/\p{White_Space}+/gu, " ");
	if (!description) throw Error("Description is required.");
	for (const token of description.split(" ")) {
		if (token === "+" || token === "@" || /^[+@]\S+$/u.test(token) || /^\S+:\S+$/u.test(token))
			throw Error("Description cannot contain Project, Context, or metadata tokens.");
	}
	return description;
}

function normalizeTags(values: string[], prefix: "+" | "@", label: string): string[] {
	const normalized = values.map((value) => {
		let tag = value.trim();
		if (tag.startsWith(prefix)) tag = tag.slice(prefix.length);
		if (!tag || /\p{White_Space}/u.test(tag) || /^[+@]/u.test(tag))
			throw Error(`${label} must be a non-empty name without spaces.`);
		return tag;
	});
	if (new Set(normalized).size !== normalized.length)
		throw Error(`${label} values must be unique.`);
	return normalized;
}

function localDate(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function createTodoLine(request: CreateTodoRequest, date = new Date()): string {
	const description = normalizeDescription(request.description);
	const projects = normalizeTags(request.projects, "+", "Project");
	const contexts = normalizeTags(request.contexts, "@", "Context");
	return [
		localDate(date),
		description,
		...projects.map((tag) => `+${tag}`),
		...contexts.map((tag) => `@${tag}`),
	].join(" ");
}

function newlineFor(contents: string): string {
	return contents.match(/\r\n|\n/u)?.[0] ?? "\n";
}

/** Append one physical line while retaining every existing byte and line-ending convention. */
export function appendTodoLine(contents: string, line: string): string {
	if (!contents) return line;
	const newline = newlineFor(contents);
	return contents.endsWith("\n") ? `${contents}${line}${newline}` : `${contents}${newline}${line}`;
}

export function confirmedTodo(
	scope: string,
	revision: number,
	workspaceId: string,
	todo_file: TodoFile
): ConfirmedTodo {
	return { scope, revision, workspaceId, todo_file };
}
