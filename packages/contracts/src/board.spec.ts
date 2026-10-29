import { describe, expect, it } from "vitest";
import { boardAssignment } from "./board";

describe("board assignments", () => {
	it.each([
		[undefined, "unassigned", false],
		["to-do", "to-do", false],
		["in-progress/2", "in-progress", false],
		["unknown", "unassigned", true],
		["", "unassigned", true],
		["in-progress/x", "unassigned", true],
		["in-progress/9007199254740992", "unassigned", true],
		["unassigned", "unassigned", false],
	])("decodes the effective value %s", (value, column, invalid) => {
		expect(boardAssignment(value)).toEqual({ column, invalid });
	});
});
