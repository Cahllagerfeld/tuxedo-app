import { describe, expect, it } from "vitest";
import { boardAssignment } from "./board";

describe("board assignments", () => {
	it.each([
		["Plan", "unassigned", false],
		["Plan board:to-do", "to-do", false],
		["Plan board:to-do board:in-progress/2", "in-progress", false],
		["Plan board:to-do board:unknown", "unassigned", true],
		["Plan board:to-do board:", "unassigned", true],
		["Plan board:in-progress/x", "unassigned", true],
		["Plan board:in-progress/9007199254740992", "unassigned", true],
		["Plan board:unknown board:unassigned", "unassigned", false],
	])("reads the last value in %s", (raw, column, invalid) => {
		expect(boardAssignment(raw)).toEqual({ column, invalid });
	});
});
