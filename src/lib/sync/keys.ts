/** localStorage keys that belong to sync. Kept apart from the engine so the store can name them without importing it. */
export const SYNC_KEYS = {
  outbox: "extrack:outbox:v1",
  cursor: "extrack:cursor:v1",
  owner: "extrack:owner:v1",
  /** A copy of this phone's own data, taken just before a first sign-in replaces it with the account's. */
  backup: "extrack:backup:v1",
} as const;
