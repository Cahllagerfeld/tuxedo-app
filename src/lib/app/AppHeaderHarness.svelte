<script lang="ts">
	import AppHeader from "./AppHeader.svelte";
	let { disabled = false }: { disabled?: boolean } = $props();
	let workspaceSwitcherOpen = $state(false);
	let workspaceCreationOpen = $state(false);
	let shortcutHelpOpen = $state(false);
</script>

<AppHeader
	bind:workspaceSwitcherOpen
	bind:workspaceCreationOpen
	bind:shortcutHelpOpen
	workspaceActionsDisabled={disabled}
/>
<output aria-label="Workspace switcher state">{workspaceSwitcherOpen ? "open" : "closed"}</output>
<output aria-label="Workspace creation state">{workspaceCreationOpen ? "open" : "closed"}</output>
