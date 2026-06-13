<script lang="ts">
	import type { SkippedLine } from "$lib/modules/todo/domain/todo";
	import CircleAlert from "@lucide/svelte/icons/circle-alert";

	type SkippedLineDiagnosticsProps = {
		skipped: SkippedLine[];
	};

	let { skipped }: SkippedLineDiagnosticsProps = $props();
</script>

{#if skipped.length > 0}
	<section
		class="rounded-lg border border-amber-500/30 bg-amber-50 p-4 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100"
		aria-labelledby="skipped-line-diagnostics-title"
	>
		<div class="flex items-start gap-3">
			<CircleAlert class="mt-0.5 h-4 w-4 shrink-0" />
			<div class="min-w-0 flex-1 space-y-3">
				<div>
					<h2 id="skipped-line-diagnostics-title" class="text-sm font-medium">
						{skipped.length}
						{skipped.length === 1 ? "line was skipped" : "lines were skipped"}
					</h2>
					<p class="text-sm opacity-80">
						These todo.txt lines could not be parsed, but valid tasks are still shown.
					</p>
				</div>

				<ul class="space-y-2">
					{#each skipped as skippedLine (skippedLine.line_number)}
						<li class="rounded-md bg-background/70 p-3">
							<div class="flex flex-wrap gap-x-2 gap-y-1 text-xs font-medium">
								<span>Line {skippedLine.line_number}</span>
								<span class="opacity-70">{skippedLine.reason}</span>
							</div>
							<code class="mt-2 block overflow-x-auto font-mono text-xs whitespace-pre">
								{skippedLine.raw}
							</code>
						</li>
					{/each}
				</ul>
			</div>
		</div>
	</section>
{/if}
