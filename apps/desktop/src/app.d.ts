// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		interface PageState {
			todoPanel?: import("./lib/modules/workspace/ui/todo-panel-routing.svelte.js").PanelEvidence;
		}
		// interface Platform {}
	}
}

export {};
