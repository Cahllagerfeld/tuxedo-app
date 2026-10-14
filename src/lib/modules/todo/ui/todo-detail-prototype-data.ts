import type { TodoFile, TodoItem } from "../domain/todo";

// Throwaway fixtures: no desktop API or Todo-file writes.
function item(line: number, description: string, fields: Partial<TodoItem> = {}): TodoItem {
	return {
		line_number: line,
		raw: description,
		description,
		completed: false,
		priority: null,
		creation_date: null,
		completion_date: null,
		projects: [],
		contexts: [],
		metadata: {},
		edit: { description, metadata: [] },
		...fields,
	};
}

export const prototypeTodoFile: TodoFile = {
	path: "/sample/work/todo.txt",
	skipped: [],
	items: [
		item(
			1,
			"Prepare the launch checklist and review every remaining release blocker with the team before sending the final handover",
			{
				raw: "(A) 2026-10-10 Prepare the launch checklist and review every remaining release blocker with the team before sending the final handover +Tuxedo +Launch @work @team due:2026-10-16 estimate:45m",
				priority: "A",
				creation_date: "2026-10-10",
				projects: ["Tuxedo", "Launch"],
				contexts: ["work", "team"],
				metadata: { due: "2026-10-16", estimate: "45m" },
			}
		),
		item(2, "Send the revised proposal to Alex", {
			raw: "(B) 2026-10-12 Send the revised proposal to Alex +Website @email due:2026-10-14",
			priority: "B",
			creation_date: "2026-10-12",
			projects: ["Website"],
			contexts: ["email"],
			metadata: { due: "2026-10-14" },
		}),
		item(4, "Book a table for Friday", {
			raw: "Book a table for Friday @phone @personal",
			contexts: ["phone", "personal"],
		}),
		item(5, "Read the chapter about designing deep modules"),
		item(6, "Check the renewal date", {
			raw: "Check the renewal date  +Admin @work due:next-week ref:INV-204",
			projects: ["Admin"],
			contexts: ["work"],
			metadata: { due: "next-week", ref: "INV-204" },
		}),
		item(7, "Publish the first preview", {
			raw: "x 2026-10-13 2026-10-08 Publish the first preview +Tuxedo @work pri:B",
			completed: true,
			creation_date: "2026-10-08",
			completion_date: "2026-10-13",
			projects: ["Tuxedo"],
			contexts: ["work"],
			metadata: { pri: "B" },
		}),
	],
};
