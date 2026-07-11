import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { summarizeTodoFile } from "$lib/modules/todo/domain/todo-file-summary";
import ReaderStatusBar from "./ReaderStatusBar.svelte";

const workspace = {
	id: "550e8400-e29b-41d4-a716-446655440000",
	name: "Work",
	color: "blue" as const,
	todo_path: "/tmp/work.todo",
	created_at: "2026-07-10T10:00:00+00:00",
};

const todoFile = {
	path: workspace.todo_path,
	skipped: [{ line_number: 2, raw: "not a todo", reason: "Unrecognized format" }],
	items: [
		{
			line_number: 1,
			raw: "Plan release",
			completed: false,
			priority: null,
			creation_date: null,
			completion_date: null,
			description: "Plan release",
			projects: [],
			contexts: [],
			metadata: {},
		},
		{
			line_number: 3,
			raw: "x Ship release",
			completed: true,
			priority: null,
			creation_date: null,
			completion_date: null,
			description: "Ship release",
			projects: [],
			contexts: [],
			metadata: {},
		},
	],
};

describe("ReaderStatusBar", () => {
	it("shows reader-true Workspace and Todo-file counts, including skipped lines when present", async () => {
		render(ReaderStatusBar, {
			activeWorkspace: workspace,
			todoFile,
			todoSummary: summarizeTodoFile(todoFile),
		});

		const status = page.getByLabelText("Reader status");
		await expect.element(status).toHaveTextContent("Workspace: Work");
		await expect.element(status).toHaveTextContent("Todo file: work.todo");
		await expect.element(status).toHaveTextContent("2 parsed");
		await expect.element(status).toHaveTextContent("1 completed");
		await expect.element(status).toHaveTextContent("1 pending");
		await expect.element(status).toHaveTextContent("1 skipped line");
	});

	it("omits skipped-line detail when the Todo file has no skipped lines", async () => {
		const todoFileWithoutSkippedLines = { ...todoFile, skipped: [] };
		render(ReaderStatusBar, {
			activeWorkspace: workspace,
			todoFile: todoFileWithoutSkippedLines,
			todoSummary: summarizeTodoFile(todoFileWithoutSkippedLines),
		});

		await expect
			.element(page.getByLabelText("Reader status"))
			.not.toHaveTextContent("skipped line");
	});
});
