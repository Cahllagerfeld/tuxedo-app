import { afterNavigate, goto } from "$app/navigation";
import { page } from "$app/state";
import type { TodoFilterState } from "#lib/modules/todo/state/todo-filter.svelte.js";
import { serializeWithInvalidations } from "#lib/modules/workspace/state/invalidate-displayed-data.js";
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
	// History is an external system: filter edits replace the current entry with the latest query,
	// once queued invalidations and committed destinations (which restore their own URL) settle.
	const replaceUrl = () =>
		serializeWithInvalidations(async () => {
			const url = currentUrl();
			const query = workspaceFilterQuery(filter.snapshot());
			if (!page.params.id || url.search === query) return;
			await goto(url.pathname + query, { shallow: true, replace: true, state: page.state });
		});
	$effect(() => {
		workspaceFilterQuery(filter.snapshot());
		void replaceUrl();
	});
}
