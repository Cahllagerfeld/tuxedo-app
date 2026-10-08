/** Remove the target physical line with its own ending, preserving all other bytes. */
export function deleteTodoLine(contents: string, lineNumber: number): string {
	return (contents.match(/[^\n]*\n|[^\n]+$/g) ?? [])
		.filter((_line, index) => index + 1 !== lineNumber)
		.join("");
}
