import { untrack } from "svelte";
import { afterNavigate, goto } from "$app/navigation";
import { page, navigating } from "$app/state";
import type { TodoFilterState } from "#lib/modules/todo/state/todo-filter.svelte.js";
import { workspaceFilterQuery, workspaceFilters } from "./workspace-paths.js";

/** Keeps explicit filter selections in the Workspace destination URL. Call during component initialisation. */
export function syncWorkspaceFilterUrl(filter: TodoFilterState) {
	// Shallow filter edits change the visible URL without updating `page.url`.
	const currentUrl = () => page.shallow?.url ?? page.url;
	const restore = () => {
		const id = page.params.id;
		if (id) filter.restore(id, workspaceFilters(currentUrl().searchParams));
	};
	restore();
	afterNavigate((event) => {
		if (!(event.shallow && event.type === "goto")) restore();
	});
	// History is an external system: filter edits replace the current entry.
	$effect(() => {
		const query = workspaceFilterQuery(filter.snapshot());
		untrack(() => {
			const url = currentUrl();
			// A committed destination restores its own URL filters.
			if (!page.params.id || (navigating.to && !navigating.shallow) || url.search === query) return;
			void goto(url.pathname + query, { shallow: true, replace: true, state: page.state });
		});
	});
}
