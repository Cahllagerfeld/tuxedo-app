import { describe, expect, it } from "vitest";
import { parseTodoFile } from "./todo-file";

describe("todo.txt parser", () => {
	it("parses the canonical todo.txt examples", () => {
		const file = parseTodoFile(
			"/tmp/todo.txt",
			[
				"(A) Thank Mom for the meatballs @phone",
				"2011-03-02 Document +TodoTxt task format",
				"(A) 2011-03-02 Call Mom",
				"x 2011-03-03 Call Mom",
				"x 2011-03-02 2011-03-01 Review Tim's pull request +TodoTxtTouch @github",
				"Really gotta call Mom (A) @phone @someday",
				"(b) Get back to the boss",
				"(B)->Submit TPS report",
			].join("\n")
		);

		expect(file.skipped).toEqual([]);
		expect(file.items).toMatchObject([
			{
				priority: "A",
				creation_date: null,
				completion_date: null,
				description: "Thank Mom for the meatballs",
				projects: [],
				contexts: ["phone"],
			},
			{
				priority: null,
				creation_date: "2011-03-02",
				completion_date: null,
				description: "Document task format",
				projects: ["TodoTxt"],
				contexts: [],
			},
			{
				priority: "A",
				creation_date: "2011-03-02",
				completion_date: null,
				description: "Call Mom",
			},
			{
				priority: null,
				creation_date: null,
				completion_date: "2011-03-03",
				completed: true,
				description: "Call Mom",
			},
			{
				priority: null,
				creation_date: "2011-03-01",
				completion_date: "2011-03-02",
				completed: true,
				description: "Review Tim's pull request",
				projects: ["TodoTxtTouch"],
				contexts: ["github"],
			},
			{
				priority: null,
				creation_date: null,
				completion_date: null,
				completed: false,
				description: "Really gotta call Mom (A)",
				projects: [],
				contexts: ["phone", "someday"],
			},
			{
				priority: null,
				creation_date: null,
				completion_date: null,
				description: "(b) Get back to the boss",
			},
			{
				priority: null,
				creation_date: null,
				completion_date: null,
				description: "(B)->Submit TPS report",
			},
		]);
	});

	it("treats non-ASCII date-like text as an ordinary description", () => {
		expect(parseTodoFile("/tmp/todo.txt", "éab-12-34 Invalid date\n")).toMatchObject({
			items: [{ description: "éab-12-34 Invalid date" }],
			skipped: [],
		});
	});

	it("skips date-shaped tokens with impossible calendar values", () => {
		const file = parseTodoFile(
			"/tmp/todo.txt",
			"2026-02-30 Impossible\n(A) 2026-13-01 Impossible\nx 2026-01-01 2026-02-29 Impossible\n"
		);

		expect(file.items).toEqual([]);
		expect(file.skipped.map(({ line_number, reason }) => ({ line_number, reason }))).toEqual([
			{ line_number: 1, reason: "date must use YYYY-MM-DD format" },
			{ line_number: 2, reason: "date must use YYYY-MM-DD format" },
			{ line_number: 3, reason: "date must use YYYY-MM-DD format" },
		]);
	});
});
