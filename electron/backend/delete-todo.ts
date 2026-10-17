/** Remove target physical lines with their own endings, preserving all other bytes. */
export function deleteTodoLines(contents: string, lineNumbers: readonly number[]): string {
	const selected = new Set(lineNumbers);
	return (contents.match(/[^\n]*\n|[^\n]+$/g) ?? [])
		.filter((_line, index) => !selected.has(index + 1))
		.join("");
}

export function deleteTodoLine(contents: string, lineNumber: number): string {
	return deleteTodoLines(contents, [lineNumber]);
}
