import type { SessionEffects } from "../session";

export const readConfirmation = (session: SessionEffects) => session.readSession({});
