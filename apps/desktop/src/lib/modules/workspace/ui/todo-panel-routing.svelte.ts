import { getContext, setContext } from "svelte";
import type { TodoItem } from "#lib/modules/todo/domain/todo.js";

export type PanelSelection = {
	todo: Pick<TodoItem, "line_number" | "raw">;
	scope: { workspaceId: string | undefined; path: string | undefined };
};
export type PanelHistory = {
	url: () => URL;
	state: () => App.PageState;
	update: (url: URL, state: App.PageState) => Promise<void>;
};
export type PanelEvidence = PanelSelection & {
	lifetime: string;
};
const context = Symbol("Todo-item panel routing");
// History from another renderer lifetime cannot establish Todo-item identity.
const lifetime = crypto.randomUUID();

export function panelRouting(history: PanelHistory, blocked: () => boolean) {
	function evidence(): PanelEvidence | null {
		const value = history.state().todoPanel;
		const line = history.url().searchParams.get("item");
		if (
			history.url().searchParams.getAll("item").length !== 1 ||
			!value ||
			value.lifetime !== lifetime ||
			!value.scope ||
			typeof value.scope.workspaceId !== "string" ||
			typeof value.scope.path !== "string" ||
			!value.todo ||
			!Number.isSafeInteger(value.todo.line_number) ||
			value.todo.line_number < 1 ||
			String(value.todo.line_number) !== line ||
			typeof value.todo.raw !== "string"
		)
			return null;
		return value;
	}
	async function set(selection: PanelSelection | null) {
		if (blocked()) return;
		const url = new URL(history.url());
		const state = { ...history.state() };
		url.searchParams.delete("item");
		if (selection) {
			state.todoPanel = {
				scope: selection.scope,
				todo: { line_number: selection.todo.line_number, raw: selection.todo.raw },
				lifetime,
			};
			url.searchParams.set("item", String(selection.todo.line_number));
		} else delete state.todoPanel;
		await history.update(url, state);
	}
	return {
		selection: evidence,
		set,
		get hasSelection() {
			return history.url().searchParams.has("item") || !!history.state().todoPanel;
		},
	};
}
export type PanelRouting = ReturnType<typeof panelRouting>;
export const setPanelRouting = (routing: PanelRouting) => setContext(context, routing);
export const getPanelRouting = () => getContext<PanelRouting | undefined>(context);
