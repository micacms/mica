/**
 * The mapping from an identity provider's subject to a Mica user.
 *
 * Keyed by `(issuer, subject)` and never by email. An email address is a
 * display attribute that most providers let a person change, and some let two
 * people hold in turn; binding an account to whoever holds an address today is
 * a well-trodden route to account takeover.
 *
 * The subject is opaque and stable for the life of the account at that issuer,
 * which is exactly the property an account key needs. Mica stores the email
 * alongside it, and updates it when the provider says so — but the email is
 * something to display, never something to authenticate on.
 */

import type { SqlDatabase } from "../db/driver.js";

export interface IdentityRecord {
  issuer: string;
  subject: string;
  userId: string;
  createdAt: string;
}

interface IdentityRow {
  issuer: string;
  subject: string;
  user_id: string;
  created_at: string;
}

const toRecord = (row: IdentityRow): IdentityRecord => ({
  issuer: row.issuer,
  subject: row.subject,
  userId: row.user_id,
  createdAt: row.created_at,
});

export function createIdentityRepository(db: SqlDatabase) {
  return {
    find(issuer: string, subject: string): IdentityRecord | undefined {
      const row = db.get<IdentityRow>(
        "SELECT * FROM oidc_identities WHERE issuer = ? AND subject = ?",
        [issuer, subject],
      );
      return row && toRecord(row);
    },

    listForUser(userId: string): IdentityRecord[] {
      return db
        .all<IdentityRow>("SELECT * FROM oidc_identities WHERE user_id = ?", [userId])
        .map(toRecord);
    },

    link(input: { issuer: string; subject: string; userId: string }): IdentityRecord {
      db.run(
        `INSERT INTO oidc_identities (issuer, subject, user_id, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (issuer, subject) DO NOTHING`,
        [input.issuer, input.subject, input.userId, new Date().toISOString()],
      );

      return this.find(input.issuer, input.subject)!;
    },
  };
}

export type IdentityRepository = ReturnType<typeof createIdentityRepository>;
