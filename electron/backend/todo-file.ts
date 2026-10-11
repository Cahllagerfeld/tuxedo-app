import { readFile } from "node:fs/promises";
import { todoDateSchema, type TodoFile } from "../../src/lib/shared/desktop/contract";
// Rust's char::is_whitespace uses Unicode White_Space; a BOM is source content.
const trimStart = (value: string) => value.replace(/^\p{White_Space}+/u, "");
const trim = (value: string) => trimStart(value).replace(/\p{White_Space}+$/u, "");
const dateTokenPattern = /^\d{4}-\d{2}-\d{2}$/;

function parseLine(line_number: number, raw: string): TodoFile["items"][number] {
	let rest = raw;
	const completed = rest.startsWith("x ");
	if (completed) rest = rest.slice(2);
	const consumeDate = (): string | null => {
		const token = rest.split(/\p{White_Space}/u, 1)[0];
		if (!dateTokenPattern.test(token)) return null;
		if (!todoDateSchema.safeParse(token).success) throw Error("date must use YYYY-MM-DD format");
		rest = rest.slice(token.length).replace(/^\p{White_Space}/u, "");
		return token;
	};
	const completion_date = completed ? consumeDate() : null;
	const match = /^\(([A-Z])\) /.exec(rest);
	const priority = match?.[1] ?? null;
	if (match) rest = rest.slice(4);
	const creation_date = consumeDate();
	const projects: string[] = [];
	const contexts: string[] = [];
	const metadata: Record<string, string> = {};
	const description: string[] = [];
	const metadataTokens: string[] = [];
	for (const token of trim(rest).split(/\p{White_Space}+/u)) {
		if (token.startsWith("+") && token.length > 1) projects.push(token.slice(1));
		else if (token.startsWith("@") && token.length > 1) contexts.push(token.slice(1));
		else {
			const match = /^([^:\p{White_Space}]+):([^:\p{White_Space}]+)$/u.exec(token);
			if (match) {
				metadataTokens.push(token);
				Object.defineProperty(metadata, match[1], {
					value: match[2],
					enumerable: true,
					configurable: true,
					writable: true,
				});
			} else if (token) description.push(token);
		}
	}
	return {
		line_number,
		raw,
		completed,
		priority,
		creation_date,
		completion_date,
		description: description.join(" ") || trim(rest) || trim(raw),
		edit: { description: description.join(" "), metadata: metadataTokens },
		projects,
		contexts,
		metadata,
	};
}
export async function readTodoContents(path: string): Promise<string> {
	return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await readFile(path));
}
export function parseTodoFile(path: string, contents: string): TodoFile {
	const result: TodoFile = { path, items: [], skipped: [] };
	const lines = contents.split("\n");
	if (lines.at(-1) === "") lines.pop();
	lines.forEach((line, index) => {
		const raw =
			line.endsWith("\r") && (index < lines.length - 1 || contents.endsWith("\n"))
				? line.slice(0, -1)
				: line;
		if (!trim(raw)) return;
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
