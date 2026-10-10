<script lang="ts">
	import { createAppShortcuts } from "./app-shortcuts.svelte";
	import { shortcutPlatform } from "$lib/shared/keyboard";
	import { shortcuts } from "./shortcuts";
	import ShortcutHint from "$lib/shared/ui/ShortcutHint.svelte";
	import { Button } from "$lib/shared/ui/button";
	import * as Dialog from "$lib/shared/ui/dialog";
	let {
		disabled,
		openSwitcher,
		openCreation,
		platform = shortcutPlatform,
	}: {
		disabled: boolean;
		openSwitcher: () => void;
		openCreation: () => void;
		platform?: typeof shortcutPlatform;
	} = $props();
	let helpTrigger = $state<HTMLButtonElement | null>(null);
	createAppShortcuts({
		get disabled() {
			return disabled;
		},
		get platform() {
			return platform;
		},
		get helpTrigger() {
			return helpTrigger;
		},
		get openSwitcher() {
			return openSwitcher;
		},
		get openCreation() {
			return openCreation;
		},
	});
</script>

<Dialog.Root>
	<Dialog.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				bind:ref={helpTrigger}
				variant="ghost"
				size="sm"
				class="[app-region:no-drag]"
			>
				Keyboard shortcuts <ShortcutHint binding={shortcuts.help.binding} {platform} />
			</Button>
		{/snippet}
	</Dialog.Trigger>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Keyboard shortcuts</Dialog.Title>
			<Dialog.Description
				>Use Tab to reach Todo items. Navigation does not wrap. Escape closes the current surface.</Dialog.Description
			>
		</Dialog.Header>
		<dl class="grid gap-3">
			{#each Object.entries(shortcuts) as [, shortcut]}
				<div class="flex items-center justify-between gap-4">
					<dt>{shortcut.label}</dt>
					<dd><ShortcutHint binding={shortcut.binding} {platform} /></dd>
				</div>
			{/each}
		</dl>
	</Dialog.Content>
</Dialog.Root>
