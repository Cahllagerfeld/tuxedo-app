import { resolve } from "$app/paths";
import * as Schema from "effect/Schema";
import { SavedViewFilters, type SavedViewFilterValues } from "@tuxedo/contracts";
import type { WorkspaceViewMode } from "#lib/modules/workspace/domain/workspace.js";

export function workspaceViewMode(routeId: string | null | undefined): WorkspaceViewMode {
	return routeId === "/workspaces/[id]/kanban" ? "kanban" : "list";
}

export function workspacePath(id: string, mode: WorkspaceViewMode): string {
	return mode === "kanban"
		? resolve("/workspaces/[id]/kanban", { id })
		: resolve("/workspaces/[id]", { id });
}

const noFilters: SavedViewFilterValues = {
	status: "all",
	search: "",
	project: null,
	context: null,
	priority: null,
	due: null,
};
const filterKeys = Object.keys(noFilters) as (keyof SavedViewFilterValues)[];

/** Encodes explicit filter selections; absent parameters keep each view's default. */
export function workspaceFilterQuery(filters: SavedViewFilterValues): string {
	const params = new URLSearchParams();
	for (const key of filterKeys) {
		const value = filters[key];
		if (value !== null && value !== noFilters[key]) params.set(key, value);
	}
	const query = params.toString();
	return query ? `?${query}` : "";
}

/** Decodes URL filters, ignoring each invalid value. */
export function workspaceFilters(params: Pick<URLSearchParams, "get">): SavedViewFilterValues {
	const filters: Record<string, unknown> = { ...noFilters };
	for (const key of filterKeys) {
		const value = params.get(key);
		if (value !== null && Schema.is(SavedViewFilters.fields[key])(value)) filters[key] = value;
	}
	const decoded = filters as SavedViewFilterValues;
	return decoded.status === "completed" ? { ...decoded, priority: null, due: null } : decoded;
}
