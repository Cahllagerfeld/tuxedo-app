<script lang="ts">
	import { dev } from "$app/environment";
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { Button } from "$lib/shared/ui/button";
	let { onSwitch }: { onSwitch: () => void } = $props();
	const variants = ["panel", "sheet", "inline"];
	const current = $derived(page.url.searchParams.get("variant") ?? "panel");
	async function cycle(direction: number) {
		const url = new URL(page.url);
		url.searchParams.set(
			"variant",
			variants[
				(Math.max(0, variants.indexOf(current)) + direction + variants.length) % variants.length
			]
		);
		await goto(url, { replaceState: true, noScroll: true, keepFocus: true });
		onSwitch();
	}
	function keydown(event: KeyboardEvent) {
		if (event.defaultPrevented) return;
		if (
			event.target instanceof HTMLElement &&
			event.target.closest(
				'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="separator"]'
			)
		)
			return;
		if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
			event.preventDefault();
			cycle(event.key === "ArrowLeft" ? -1 : 1);
		}
	}
</script>

<svelte:window onkeydown={keydown} />
{#if dev}
	<div
		class="fixed bottom-10 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-full border bg-foreground px-3 py-2 text-background shadow-lg"
		aria-label="Prototype variants"
	>
		<Button
			variant="ghost"
			size="icon-sm"
			class="rounded-full hover:bg-background/20 hover:text-background"
			aria-label="Previous variant"
			onclick={() => cycle(-1)}>←</Button
		>
		<div class="min-w-36 text-center text-xs">
			<span class="opacity-60">PROTOTYPE</span>
			<p class="font-medium capitalize">
				{current} · {Math.max(0, variants.indexOf(current)) + 1}/3
			</p>
		</div>
		<Button
			variant="ghost"
			size="icon-sm"
			class="rounded-full hover:bg-background/20 hover:text-background"
			aria-label="Next variant"
			onclick={() => cycle(1)}>→</Button
		>
	</div>
{/if}
