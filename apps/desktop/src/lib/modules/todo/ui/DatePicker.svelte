<script lang="ts">
	import type { HTMLButtonAttributes } from "svelte/elements";
	import { DateFormatter, getLocalTimeZone, parseDate } from "@internationalized/date";
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import { Button } from "#lib/shared/ui/button/index.js";
	import { Calendar } from "#lib/shared/ui/calendar/index.js";
	import * as Popover from "#lib/shared/ui/popover/index.js";
	import * as Form from "#lib/shared/ui/form/index.js";

	let {
		value = $bindable(""),
		disabled = false,
		label = "Creation date",
		...restProps
	}: Pick<HTMLButtonAttributes, "id" | "name" | "aria-describedby" | "aria-invalid"> & {
		value?: string;
		disabled?: boolean;
		label?: string;
	} = $props();

	const dateFormatter = new DateFormatter("en-US", { dateStyle: "long" });
	const creationDate = $derived(value ? parseDate(value) : undefined);
</script>

<Popover.Root>
	<Popover.Trigger {disabled}>
		{#snippet child({ props: triggerProps })}
			<Button
				{...triggerProps}
				{...restProps}
				type="button"
				variant="outline"
				data-empty={!creationDate}
				class="w-full justify-between text-start font-normal data-[empty=true]:text-muted-foreground"
				{disabled}
			>
				{creationDate
					? dateFormatter.format(creationDate.toDate(getLocalTimeZone()))
					: "Pick a date"}
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
<Form.Description>
	<Button
		type="button"
		variant="link"
		class="h-auto p-0 font-normal text-muted-foreground"
		{disabled}
		onclick={() => (value = "")}>Clear {label}</Button
	> to omit it.
</Form.Description>
