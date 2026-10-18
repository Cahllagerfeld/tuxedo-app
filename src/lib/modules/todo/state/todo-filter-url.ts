import * as Schema from "effect/Schema";
import { SavedViewFilters, type SavedViewFilterValues } from "$lib/shared/desktop/contract";

export const emptyTodoFilters = (): SavedViewFilterValues => ({
	status: "all",
	search: "",
	project: null,
	context: null,
	priority: null,
	due: null,
});

const isStatus = Schema.is(SavedViewFilters.fields.status);
const isProject = Schema.is(SavedViewFilters.fields.project);
const isContext = Schema.is(SavedViewFilters.fields.context);
const isPriority = Schema.is(SavedViewFilters.fields.priority);
const isDue = Schema.is(SavedViewFilters.fields.due);

export function readTodoFilters(url: URL): SavedViewFilterValues {
	const params = url.searchParams;
	const status = params.get("status");
	const project = params.get("project");
	const context = params.get("context");
	const priority = params.get("priority");
	const due = params.get("due");
	return {
		status: isStatus(status) ? status : "all",
		search: params.get("search") ?? "",
		project: isProject(project) ? project : null,
		context: isContext(context) ? context : null,
		priority: status !== "completed" && isPriority(priority) ? priority : null,
		due: status !== "completed" && isDue(due) ? due : null,
	};
}

export function writeTodoFilters(current: URL, filters: SavedViewFilterValues): URL {
	const url = new URL(current);
	for (const key of ["status", "search", "project", "context", "priority", "due"] as const) {
		const value = filters[key];
		if (value === null || value === "" || (key === "status" && value === "all"))
			url.searchParams.delete(key);
		else url.searchParams.set(key, value);
	}
	return url;
}
