<script lang="ts">
	import { getAppContext } from "$lib/app/app-context";
	import WorkspaceHome from "$lib/modules/workspace/ui/WorkspaceHome.svelte";
	const { app, navigation } = getAppContext();
</script>

<WorkspaceHome
	workspace={app.workspace}
	loading={navigation.busy}
	disabled={navigation.busy}
	openCreationDialog={app.openWorkspaceCreationDialog}
	retry={navigation.retry}
/>
