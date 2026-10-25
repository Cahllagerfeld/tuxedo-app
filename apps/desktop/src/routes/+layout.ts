import type { LayoutLoad } from "./$types";

// The Electron renderer is a static SvelteKit SPA.
export const ssr = false;

export const load: LayoutLoad = async ({ params }) => {
	try {
		return {
			destination: params.id,
			session: { value: await window.desktop.readSession({}), error: "" },
		};
	} catch (error) {
		return {
			destination: params.id,
			session: { value: null, error: error instanceof Error ? error.message : String(error) },
		};
	}
};
