<script lang="ts">
	import type { HTMLButtonAttributes } from "svelte/elements";
	import { DateFormatter, getLocalTimeZone, parseDate } from "@internationalized/date";
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import X from "@lucide/svelte/icons/x";
	import { Button } from "#lib/shared/ui/button/index.js";
	import { Calendar } from "#lib/shared/ui/calendar/index.js";
	import * as Popover from "#lib/shared/ui/popover/index.js";
	import * as Tooltip from "#lib/shared/ui/tooltip/index.js";

	let {
		value = $bindable(""),
		disabled = false,
		label = "Creation date",
		clearable = !!value,
		...restProps
	}: Pick<HTMLButtonAttributes, "id" | "name" | "aria-describedby" | "aria-invalid"> & {
		value?: string;
		disabled?: boolean;
		label?: string;
		clearable?: boolean;
	} = $props();

	const dateFormatter = new DateFormatter("en-US", { dateStyle: "long" });
	const creationDate = $derived(value ? parseDate(value) : undefined);
	let dateButton = $state<HTMLButtonElement | null>(null);
</script>

<div class="flex items-center gap-1">
	<Popover.Root>
		<Popover.Trigger {disabled}>
			{#snippet child({ props: triggerProps })}
				<Button
					bind:ref={dateButton}
					{...triggerProps}
					{...restProps}
					type="button"
					variant="outline"
					data-empty={!creationDate}
					class="min-w-0 flex-1 justify-between gap-2 text-start font-normal data-[empty=true]:text-muted-foreground"
					{disabled}
				>
					<span class="truncate"
						>{creationDate
							? dateFormatter.format(creationDate.toDate(getLocalTimeZone()))
							: "Pick a date"}</span
					>
					<ChevronDownIcon data-icon="inline-end" />
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content class="w-auto p-0" align="start">
			<Calendar
				type="single"
				bind:value={() => creationDate, (date) => (value = date?.toString() ?? "")}
				{disabled}
			/>
		</Popover.Content>
	</Popover.Root>
	{#if clearable}
		<Tooltip.Provider>
			<Tooltip.Root disableHoverableContent>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-sm"
							{disabled}
							aria-label={`Clear ${label}`}
							onclick={() => {
								value = "";
								dateButton?.focus();
							}}
						>
							<X aria-hidden="true" />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>Clear {label}</Tooltip.Content>
			</Tooltip.Root>
		</Tooltip.Provider>
	{/if}
</div>
