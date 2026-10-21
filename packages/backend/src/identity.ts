import { Context, Layer } from "effect";
import { randomUUID } from "node:crypto";

export class Identity extends Context.Service<
	Identity,
	{
		uuid: () => string;
		now: () => string;
	}
>()("tuxedo/backend/Identity") {}

export const identityLayer = Layer.succeed(Identity, {
	uuid: randomUUID,
	now: () => new Date().toISOString(),
});
