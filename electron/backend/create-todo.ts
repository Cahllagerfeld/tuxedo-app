import {
	normalizeTodoDescription,
	type ConfirmedTodo,
	type DesktopRequest,
	type TodoFile,
} from "../../src/lib/shared/desktop/contract";

export type CreateTodoRequest = DesktopRequest<"createTodo">;

function localDate(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function createTodoLine(request: CreateTodoRequest, date = new Date()): string {
	return [
		localDate(date),
		normalizeTodoDescription(request.description),
		...request.projects.map((tag) => `+${tag}`),
		...request.contexts.map((tag) => `@${tag}`),
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
