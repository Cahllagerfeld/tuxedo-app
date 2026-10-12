/** Replace physical lines while preserving each position's ending and all other bytes. */
export function replaceTodoLines(
	contents: string,
	replacements: readonly { lineNumber: number; raw: string }[]
): string {
	const lines = contents.match(/[^\n]*\n|[^\n]+$/g) ?? [];
	for (const { lineNumber, raw } of replacements) {
		const line = lines[lineNumber - 1];
		const ending = line.endsWith("\r\n") ? "\r\n" : line.endsWith("\n") ? "\n" : "";
		lines[lineNumber - 1] = raw + ending;
	}
	return lines.join("");
}
