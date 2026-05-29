import { describe, expect, it } from "vitest";
import { parseTodoFileResponse, todoFileSchema, type TodoFile } from "./todo";

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
		const response = structuredClone(validTodoFileResponse);
		response.items[0].line_number = "1" as unknown as number;

		const result = todoFileSchema.safeParse(response);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.path).toEqual(["items", 0, "line_number"]);
		}
	});

	it("rejects schema drift in skipped lines", () => {
		const response = structuredClone(validTodoFileResponse);
		response.skipped[0].reason = null as unknown as string;

		const result = todoFileSchema.safeParse(response);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.path).toEqual(["skipped", 0, "reason"]);
		}
	});
});

describe("parseTodoFileResponse", () => {
	it("returns the parsed response when validation succeeds", () => {
		const parsed = parseTodoFileResponse(validTodoFileResponse);

		expect(parsed.items).toHaveLength(2);
		expect(parsed.items[0]?.projects).toEqual(["TuxedoApp"]);
		expect(parsed.skipped[0]?.line_number).toBe(3);
	});

	it("throws a readable error when validation fails", () => {
		const response = { ...validTodoFileResponse, path: 123 };

		expect(() => parseTodoFileResponse(response)).toThrow(
			/Unexpected todo file response from Rust: path:/
		);
	});
});
