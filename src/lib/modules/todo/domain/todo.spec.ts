import { describe, expect, it } from "vitest";
import { todoFileSchema, type TodoFile } from "./todo";

const validTodoFileResponse: TodoFile = {
	path: "/tmp/todo.txt",
	items: [
		{
			line_number: 1,
			raw: "(A) 2026-05-24 Review parser +TuxedoApp @computer due:2026-05-25",
			completed: false,
			priority: "A",
			creation_date: "2026-05-24",
			completion_date: null,
			description: "Review parser",
			projects: ["TuxedoApp"],
			contexts: ["computer"],
			metadata: { due: "2026-05-25" },
		},
		{
			line_number: 2,
			raw: "x Completed task without date +Inbox @home",
			completed: true,
			priority: null,
			creation_date: null,
			completion_date: null,
			description: "Completed task without date",
			projects: ["Inbox"],
			contexts: ["home"],
			metadata: {},
		},
	],
	skipped: [
		{
			line_number: 3,
			raw: "2026-99-99 Bad date",
			reason: "date must use YYYY-MM-DD format",
		},
	],
};

describe("todoFileSchema", () => {
	it("accepts the Rust todo file response shape", () => {
		const result = todoFileSchema.safeParse(validTodoFileResponse);

		expect(result.success).toBe(true);
	});

	it("rejects schema drift in nested todo items", () => {
		const response = {
			...validTodoFileResponse,
			items: validTodoFileResponse.items.map((item, index) =>
				index === 0 ? { ...item, line_number: "1" } : item
			),
		};

		const result = todoFileSchema.safeParse(response);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.path).toEqual(["items", 0, "line_number"]);
		}
	});

	it("rejects schema drift in skipped lines", () => {
		const response = {
			...validTodoFileResponse,
			skipped: validTodoFileResponse.skipped.map((line, index) =>
				index === 0 ? { ...line, reason: null } : line
			),
		};

		const result = todoFileSchema.safeParse(response);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.path).toEqual(["skipped", 0, "reason"]);
		}
	});
});
