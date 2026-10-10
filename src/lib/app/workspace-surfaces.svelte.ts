import { tick } from "svelte";

export function createWorkspaceSurfaces() {
	let sidebarOpen = $state(true);
	let switcherTrigger = $state<HTMLButtonElement | null>(null);
	let creationTrigger: HTMLElement | null = null;

	return {
		get sidebarOpen() {
			return sidebarOpen;
		},
		set sidebarOpen(value: boolean) {
			sidebarOpen = value;
		},
		get switcherTrigger() {
			return switcherTrigger;
		},
		set switcherTrigger(value: HTMLButtonElement | null) {
			switcherTrigger = value;
		},
		async openSwitcher() {
			sidebarOpen = true;
			await tick();
			switcherTrigger?.click();
		},
		onCreationOpenAutoFocus() {
			creationTrigger =
				document.activeElement instanceof HTMLElement ? document.activeElement : null;
		},
		onCreationCloseAutoFocus(event: Event) {
			event.preventDefault();
			(creationTrigger?.isConnected ? creationTrigger : switcherTrigger)?.focus();
		},
	};
}
