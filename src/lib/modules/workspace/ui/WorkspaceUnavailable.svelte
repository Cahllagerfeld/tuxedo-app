<script lang="ts">
	import { resolve } from "$app/paths";
	import * as Alert from "$lib/shared/ui/alert";
	import { Button } from "$lib/shared/ui/button";
	import * as Empty from "$lib/shared/ui/empty";
	import LoaderCircle from "@lucide/svelte/icons/loader-circle";

	let { loading, message, retry }: { loading: boolean; message: string; retry: () => void } =
		$props();
</script>

{#if loading}
	<Empty.Root aria-label="Opening workspace" class="flex-1 rounded-none border-0">
		<Empty.Media variant="icon"
			><LoaderCircle class="animate-spin" aria-hidden="true" /></Empty.Media
		>
		<Empty.Header><Empty.Title>Opening workspace…</Empty.Title></Empty.Header>
	</Empty.Root>
{:else}
	<Empty.Root aria-label="Workspace unavailable" class="flex-1 rounded-none border-0">
		<Alert.Root variant="destructive">
			<Alert.Title>Workspace unavailable</Alert.Title>
			<Alert.Description>{message}</Alert.Description>
		</Alert.Root>
		<div class="flex gap-2">
			<Button onclick={retry}>Retry</Button>
			<Button variant="outline" href={resolve("/")}>Home</Button>
		</div>
	</Empty.Root>
{/if}
