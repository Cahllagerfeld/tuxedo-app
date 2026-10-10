<script lang="ts">
	import { createHotkey } from "@tanstack/svelte-hotkeys";
	import { shortcuts, shortcutSurfaceOpen, shortcutPlatform } from "$lib/shared/shortcuts";
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
	const actions = {
		workspaceSwitcher: () => openSwitcher(),
		workspaceCreation: () => openCreation(),
		help: () => {
			helpTrigger?.focus();
			helpTrigger?.click();
		},
	};
	for (const id of ["workspaceSwitcher", "workspaceCreation", "help"] as const) {
		createHotkey(
			shortcuts[id].binding,
			(event) => {
				if (event.repeat || shortcutSurfaceOpen() || (id !== "help" && disabled)) return;
				event.preventDefault();
				actions[id]();
			},
			() => ({
				enabled: id === "help" || !disabled,
				platform,
				ignoreInputs: false,
				preventDefault: false,
				stopPropagation: false,
			})
		);
	}
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
				Keyboard shortcuts <ShortcutHint shortcut="help" {platform} />
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
			{#each Object.entries(shortcuts) as [id, shortcut]}
				<div class="flex items-center justify-between gap-4">
					<dt>{shortcut.label}</dt>
					<dd><ShortcutHint shortcut={id as keyof typeof shortcuts} {platform} /></dd>
				</div>
			{/each}
		</dl>
	</Dialog.Content>
</Dialog.Root>
