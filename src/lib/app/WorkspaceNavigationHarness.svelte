<script lang="ts">
	import { AppState } from "./app-state.svelte";
	import { createWorkspaceNavigation } from "./workspace-navigation.svelte";
	import { ElectronWorkspaceSessionState } from "$lib/modules/workspace/state/electron-workspace-session.svelte";
	import type { DesktopAPI } from "$lib/shared/desktop/contract";
	let {
		desktop,
		ready,
	}: {
		desktop: DesktopAPI;
		ready: (app: AppState, navigation: ReturnType<typeof createWorkspaceNavigation>) => void;
	} = $props();
	// svelte-ignore state_referenced_locally
	const app = new AppState(new ElectronWorkspaceSessionState(desktop));
	const navigation = createWorkspaceNavigation(app);
	// svelte-ignore state_referenced_locally
	ready(app, navigation);
</script>
