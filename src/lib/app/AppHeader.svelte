<script lang="ts">
	import { createHotkeys } from "@tanstack/svelte-hotkeys";
	import CircleHelp from "@lucide/svelte/icons/circle-help";
	import { Button } from "$lib/shared/ui/button";
	import * as Dialog from "$lib/shared/ui/dialog";
	import ShortcutHint from "./ShortcutHint.svelte";
	import { shortcutList, shortcuts } from "./shortcuts";

	type Props = {
		workspaceSwitcherOpen?: boolean;
		workspaceCreationOpen?: boolean;
		shortcutHelpOpen?: boolean;
		workspaceActionsDisabled?: boolean;
	};
	let {
		workspaceSwitcherOpen = $bindable(false),
		workspaceCreationOpen = $bindable(false),
		shortcutHelpOpen = $bindable(false),
		workspaceActionsDisabled = false,
	}: Props = $props();
	let helpTrigger = $state<HTMLButtonElement | null>(null);

	function modalOpen() {
		return (
			workspaceCreationOpen ||
			shortcutHelpOpen ||
			document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]') !== null
		);
	}

	createHotkeys(() => [
		{
			hotkey: shortcuts.workspaceSwitcher.hotkey,
			callback: () => {
				if (!workspaceActionsDisabled && !modalOpen()) workspaceSwitcherOpen = true;
			},
			options: { enabled: !workspaceActionsDisabled, ignoreInputs: false },
		},
		{
			hotkey: shortcuts.createWorkspace.hotkey,
			callback: () => {
				if (!workspaceActionsDisabled && !modalOpen()) workspaceCreationOpen = true;
			},
			options: { enabled: !workspaceActionsDisabled, ignoreInputs: false },
		},
		{
			hotkey: shortcuts.shortcutHelp.hotkey,
			callback: () => {
				if (!modalOpen()) {
					helpTrigger?.focus();
					shortcutHelpOpen = true;
				}
			},
			options: { ignoreInputs: false },
		},
	]);
</script>

<header class="flex h-10 shrink-0 items-center justify-between border-b border-border bg-card px-4">
	<span class="font-mono text-sm font-semibold tracking-tight">Tuxedo</span>
	<Dialog.Root bind:open={shortcutHelpOpen}>
		<Dialog.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					bind:ref={helpTrigger}
					variant="ghost"
					size="icon-sm"
					aria-label="Keyboard shortcuts"
				>
					<CircleHelp aria-hidden="true" />
				</Button>
			{/snippet}
		</Dialog.Trigger>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>Keyboard shortcuts</Dialog.Title>
				<Dialog.Description>Navigate Tuxedo without reaching for the mouse.</Dialog.Description>
			</Dialog.Header>
			<ul class="grid gap-3">
				{#each shortcutList as shortcut (shortcut.id)}
					<li class="flex items-center justify-between gap-6 text-sm">
						<span>{shortcut.label}</span><ShortcutHint hotkey={shortcut.hotkey} />
					</li>
				{/each}
				<li class="flex items-center justify-between gap-6 text-sm">
					<span>Navigate Todo items</span><span class="flex gap-1"
						><ShortcutHint hotkey="ArrowUp" /><ShortcutHint hotkey="ArrowDown" /></span
					>
				</li>
				<li class="flex items-center justify-between gap-6 text-sm">
					<span>First or last Todo item</span><span class="flex gap-1"
						><ShortcutHint hotkey="Home" /><ShortcutHint hotkey="End" /></span
					>
				</li>
				<li class="flex items-center justify-between gap-6 text-sm">
					<span>Toggle focused Todo item</span><ShortcutHint hotkey="Space" />
				</li>
			</ul>
		</Dialog.Content>
	</Dialog.Root>
</header>
