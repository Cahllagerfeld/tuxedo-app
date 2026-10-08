import { readFile } from "node:fs/promises";
import type { TodoFile } from "../../src/lib/shared/desktop/contract";
function parseLine(line_number: number, raw: string): TodoFile["items"][number] {
	let rest = raw.trim();
	const completed = rest.startsWith("x ");
	if (completed) rest = rest.slice(2);
	const consumeDate = (): string | null => {
		const token = rest.trimStart().split(/\s/, 1)[0];
		if (token.length !== 10 || token[4] !== "-" || token[7] !== "-") return null;
		if (
			!/^\d{4}-\d{2}-\d{2}$/.test(token) ||
			Number(token.slice(5, 7)) < 1 ||
			Number(token.slice(5, 7)) > 12 ||
			Number(token.slice(8)) < 1 ||
			Number(token.slice(8)) >
				[
					31,
					Number(token.slice(0, 4)) % 4 === 0 &&
					(Number(token.slice(0, 4)) % 100 !== 0 || Number(token.slice(0, 4)) % 400 === 0)
						? 29
						: 28,
					31,
					30,
					31,
					30,
					31,
					31,
					30,
					31,
					30,
					31,
				][Number(token.slice(5, 7)) - 1]
		)
			throw Error("date must use YYYY-MM-DD format");
		rest = rest.trimStart().slice(10).trimStart();
		return token;
	};
	const completion_date = completed ? consumeDate() : null;
	rest = rest.trimStart();
	const match = /^\(([A-Z])\) /.exec(rest);
	const priority = match?.[1] ?? null;
	if (match) rest = rest.slice(4);
	const creation_date = consumeDate();
	const projects: string[] = [];
	const contexts: string[] = [];
	const metadata: Record<string, string> = {};
	const description: string[] = [];
	for (const token of rest.trim().split(/\s+/)) {
		if (token.startsWith("+") && token.length > 1) projects.push(token.slice(1));
		else if (token.startsWith("@") && token.length > 1) contexts.push(token.slice(1));
		else {
			const match = /^([^:]+):([^:]+)$/.exec(token);
			if (match)
				Object.defineProperty(metadata, match[1], {
					value: match[2],
					enumerable: true,
					configurable: true,
					writable: true,
				});
			else if (token) description.push(token);
		}
	}
	if (!description.length) throw Error("task description is empty");
	return {
		line_number,
		raw,
		completed,
		priority,
		creation_date,
		completion_date,
		description: description.join(" "),
		projects,
		contexts,
		metadata,
	};
}
export async function readTodoFile(path: string): Promise<TodoFile> {
	const contents = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path));
	const result: TodoFile = { path, items: [], skipped: [] };
	const lines = contents.split("\n");
	if (lines.at(-1) === "") lines.pop();
	lines.forEach((line, index) => {
		const raw =
			line.endsWith("\r") && (index < lines.length - 1 || contents.endsWith("\n"))
				? line.slice(0, -1)
				: line;
		if (!raw.trim()) return;
		try {
			result.items.push(parseLine(index + 1, raw));
		} catch (error) {
			result.skipped.push({
				line_number: index + 1,
				raw,
				reason: error instanceof Error ? error.message : String(error),
			});
		}
	});
	return result;
}
