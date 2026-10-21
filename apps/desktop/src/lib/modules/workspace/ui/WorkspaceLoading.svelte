<script lang="ts">
	import * as Empty from "$lib/shared/ui/empty";
	import LoaderCircle from "@lucide/svelte/icons/loader-circle";
</script>

<Empty.Root aria-label="Opening workspace" class="flex-1 rounded-none border-0">
	<Empty.Media variant="icon"><LoaderCircle class="animate-spin" aria-hidden="true" /></Empty.Media>
	<Empty.Header><Empty.Title>Opening workspace…</Empty.Title></Empty.Header>
</Empty.Root>
