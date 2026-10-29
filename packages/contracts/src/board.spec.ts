import { describe, expect, it } from "vitest";
import { boardAssignment, sortBoardColumn } from "./board";

describe("board assignments", () => {
	it.each([
		[undefined, { column: "unassigned", invalid: false }],
		["to-do", { column: "to-do", invalid: false }],
		["in-progress/2", { column: "in-progress", position: 2, invalid: false }],
		["unknown", { column: "unassigned", invalid: true }],
		["", { column: "unassigned", invalid: true }],
		["in-progress/x", { column: "unassigned", invalid: true }],
		["in-progress/9007199254740992", { column: "unassigned", invalid: true }],
		["unassigned", { column: "unassigned", invalid: false }],
	])("decodes the effective value %s", (value, expected) => {
		expect(boardAssignment(value)).toEqual(expected);
	});

	it("orders explicit positions first and resolves ties, stale, and absent positions by Todo-file order", () => {
		const item = (line_number: number, metadata: Record<string, string>, completed = false) => ({
			line_number,
			completed,
			metadata,
		});
		expect(
			sortBoardColumn([
				item(1, {}),
				item(2, { board: "to-do/7" }),
				item(3, { board: "unknown" }),
				item(4, { board: "to-do/3" }),
				item(5, { board: "to-do/3" }),
			]).map((value) => value.line_number)
		).toEqual([4, 5, 2, 1, 3]);
		expect(
			sortBoardColumn([
				item(1, { board: "to-do/0" }, true),
				item(2, { "board-done": "1" }, true),
				item(3, { "board-done": "x" }, true),
				item(4, { "board-done": "0" }, true),
			]).map((value) => value.line_number)
		).toEqual([4, 2, 1, 3]);
	});
});
