import type {
	PendingWorkspaceSessionOperation,
	WorkspaceSessionActionResult,
	WorkspaceSessionOperation,
	WorkspaceSessionOperationTarget,
} from "./workspace-session-types";

/** A command rejected before its RPC; it never leaves a saved change awaiting recovery. */
export class CommandValidationError extends Error {}

export type CommandAdmission = {
	target?: WorkspaceSessionOperationTarget | null;
	/** Committed navigation reconciliation runs while SvelteKit still reports navigation. */
	committed?: boolean;
};

export class WorkspaceCommandGate {
	private pending = $state<PendingWorkspaceSessionOperation | null>(null);
	/** A lost or unconfirmed write response; only a read-only Retry clears it. */
	failure = $state("");
	private completion = Promise.resolve();
	private readonly settled = new Set<() => void>();

	constructor(private readonly navigating: () => boolean) {}

	get pendingOperation() {
		return this.pending?.operation ?? null;
	}
	get pendingTarget() {
		return this.pending?.target ?? null;
	}
	get isPending() {
		return this.pending !== null;
	}
	get isOperating() {
		return this.pending !== null || this.navigating();
	}
	async whenIdle() {
		while (this.pending) await this.completion;
	}
	onSettled(listener: () => void) {
		this.settled.add(listener);
		return () => this.settled.delete(listener);
	}
	async run(
		operation: WorkspaceSessionOperation,
		action: () => Promise<WorkspaceSessionActionResult>,
		{ target = null, committed = false }: CommandAdmission = {}
	): Promise<WorkspaceSessionActionResult> {
		if (this.pending || (!committed && this.navigating()))
			return { status: "rejected", message: "A Workspace session operation is already running." };
		this.pending = { operation, target };
		let finish!: () => void;
		this.completion = new Promise<void>((resolve) => {
			finish = resolve;
		});
		try {
			return await action();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!(error instanceof CommandValidationError)) this.failure = message;
			return { status: "rejected", message };
		} finally {
			this.pending = null;
			finish();
			for (const listener of this.settled) listener();
		}
	}
}
