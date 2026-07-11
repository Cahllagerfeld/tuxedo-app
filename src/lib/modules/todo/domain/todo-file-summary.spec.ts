import { describe, expect, it } from "vitest";
import type { TodoFile, TodoItem } from "./todo";
import { summarizeTodoFile } from "./todo-file-summary";

function item(
	overrides: Pick<TodoItem, "line_number" | "completed" | "priority" | "projects" | "contexts">
): TodoItem {
	return {
		raw: "todo line",
		creation_date: null,
		completion_date: null,
		description: "A todo item",
		metadata: {},
		...overrides,
	};
}

const mixedTodoFile: TodoFile = {
	path: "/tmp/todo.txt",
	items: [
		item({
			line_number: 8,
			completed: false,
			priority: "B",
			projects: ["House", "Tuxedo"],
			contexts: ["Home"],
		}),
		item({
			line_number: 2,
			completed: true,
			priority: null,
			projects: ["House"],
			contexts: ["home"],
		}),
		item({
			line_number: 12,
			completed: false,
			priority: "A",
			projects: ["house"],
			contexts: ["computer", "Home"],
		}),
		item({
			line_number: 14,
			completed: false,
			priority: "a",
			projects: [],
			contexts: [],
		}),
	],
	skipped: [
		{ line_number: 4, raw: "not a todo", reason: "invalid todo" },
		{ line_number: 10, raw: "also invalid", reason: "invalid todo" },
	],
};

describe("summarizeTodoFile", () => {
	it("returns an empty summary when no Todo file is loaded", () => {
		expect(summarizeTodoFile(null)).toEqual({
			items: [],
			skipped: [],
			counts: {
				total: 0,
				open: 0,
				completed: 0,
				priority: 0,
				projects: 0,
				skipped: 0,
			},
			facets: { projects: [], contexts: [], priorities: [] },
		});
	});

	it("preserves parser order and derives counts and exact-spelling sorted facets", () => {
		expect(summarizeTodoFile(mixedTodoFile)).toEqual({
			items: mixedTodoFile.items,
			skipped: mixedTodoFile.skipped,
			counts: {
				total: 4,
				open: 3,
				completed: 1,
				priority: 2,
				projects: 3,
				skipped: 2,
			},
			facets: {
				projects: ["house", "House", "Tuxedo"],
				contexts: ["computer", "home", "Home"],
				priorities: ["A", "B"],
			},
		});
	});
});
