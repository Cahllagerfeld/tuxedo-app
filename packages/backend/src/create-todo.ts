import { normalizeTodoDescription, type DesktopRequest } from "@tuxedo/contracts";

export type CreateTodoRequest = DesktopRequest<"createTodo">;

function localDate(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function createTodoLine(
	request: Omit<CreateTodoRequest, "scope" | "revision" | "workspaceId">,
	date = new Date()
): string {
	const metadata = [...(request.metadata ?? [])];
	if (request.completed && request.priority) metadata.push(`pri:${request.priority}`);
	const line = [
		request.completed ? "x" : "",
		request.completed ? request.completionDate : "",
		!request.completed && request.priority ? `(${request.priority})` : "",
		request.creationDate === undefined ? localDate(date) : request.creationDate,
		normalizeTodoDescription(request.description),
		...request.projects.map((tag) => `+${tag}`),
		...request.contexts.map((tag) => `@${tag}`),
		...metadata,
	]
		.filter((value) => value !== null && value !== undefined && value !== "")
		.join(" ");
	return (request.completed && line === "x") ||
		(request.priority && !request.completed && line === `(${request.priority})`)
		? `${line} `
		: line;
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
