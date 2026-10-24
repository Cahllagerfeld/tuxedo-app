<script lang="ts">
	import { tick } from "svelte";
	import type { HTMLInputAttributes } from "svelte/elements";
	import { Button } from "#lib/shared/ui/button/index.js";
	import { Input } from "#lib/shared/ui/input/index.js";

	let {
		value = $bindable("none"),
		disabled = false,
		"aria-labelledby": labelledby,
		...restProps
	}: Pick<
		HTMLInputAttributes,
		"id" | "name" | "aria-describedby" | "aria-invalid" | "aria-labelledby"
	> & { value?: string; disabled?: boolean } = $props();

	let otherDraft = $state("");
	let otherPriorityInput = $state<HTMLInputElement | null>(null);
	const otherPriority = $derived(!["none", "A", "B", "C"].includes(value));
	const priorities = [
		{ value: "none", label: "None", color: "" },
		{
			value: "A",
			label: "A",
			color: "text-[var(--priority-a)] aria-pressed:bg-[var(--priority-a-muted)]",
		},
		{
			value: "B",
			label: "B",
			color: "text-[var(--priority-b)] aria-pressed:bg-[var(--priority-b-muted)]",
		},
		{
			value: "C",
			label: "C",
			color: "text-[var(--priority-c)] aria-pressed:bg-[var(--priority-c-muted)]",
		},
	];
</script>

<div role="group" aria-labelledby={labelledby} class="flex gap-1">
	{#each priorities as priority (priority.value)}
		<Button
			type="button"
			size="sm"
			variant={!otherPriority && value === priority.value ? "secondary" : "outline"}
			id={!otherPriority && priority.value === "none" ? restProps.id : undefined}
			aria-label={priority.label}
			aria-pressed={!otherPriority && value === priority.value}
			class={`flex-1 ${priority.color}`}
			{disabled}
			onclick={() => {
				value = priority.value;
			}}
		>
			{priority.label}
		</Button>
	{/each}
	<Button
		type="button"
		size="sm"
		variant={otherPriority ? "secondary" : "outline"}
		aria-pressed={otherPriority}
		{disabled}
		onclick={() => {
			if (!otherPriority) {
				otherDraft = "";
				value = "";
			}
			void tick().then(() => otherPriorityInput?.focus());
		}}>Other</Button
	>
</div>
{#if otherPriority}
	<Input
		{...restProps}
		bind:ref={otherPriorityInput}
		value={value || otherDraft}
		aria-label="Other priority"
		placeholder="D–Z"
		maxlength={1}
		autocomplete="off"
		{disabled}
		oninput={(event) => {
			otherDraft = event.currentTarget.value.toUpperCase();
			value = /^[D-Z]$/u.test(otherDraft) ? otherDraft : "";
		}}
	/>
{/if}
