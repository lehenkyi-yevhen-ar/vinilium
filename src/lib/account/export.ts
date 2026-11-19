import { EXPORT_COLUMNS, exportRow } from "@/lib/lists/export";
import type { StoredItemJson } from "@/lib/lists/rules";

/**
 * Everything the service holds about a person that is theirs to take with them: their profile fields and their lists.
 * A whitelist, not a dump of the user row: no password hash, no session, IP address or token ever appears here.
 * (No Discogs content either: titles and covers are not ours to hand out as a file; the release ids are enough to rebuild a list.)
 */
export interface AccountProfile {
  name: string;
  email: string;
  emailVerified: boolean;
  locale: string | null;
  createdAt: Date;
  /** The picture address Google provided (a password account has none). */
  image?: string | null;
}

export function buildAccountExport(profile: AccountProfile, items: StoredItemJson[], exportedAt = new Date()) {
  return {
    exportedAt: exportedAt.toISOString(),
    account: {
      name: profile.name,
      email: profile.email,
      emailVerified: profile.emailVerified,
      language: profile.locale ?? "en",
      pictureUrl: profile.image ?? null,
      createdAt: profile.createdAt.toISOString(),
    },
    lists: { columns: [...EXPORT_COLUMNS], items: items.map(exportRow) },
  };
}

export const accountExportJson = (profile: AccountProfile, items: StoredItemJson[], exportedAt?: Date) =>
  JSON.stringify(buildAccountExport(profile, items, exportedAt), null, 2) + "\n";
