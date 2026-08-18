/**
 * Memberships — who may edit which site, and in what role.
 *
 * This is the whole of Mica's authorization model. Authentication says who
 * someone is; a membership says what that person may do here. Keeping the two
 * apart is what lets the identity provider own the first without owning the
 * second: an IdP can vouch for a person's whole company, and none of them get
 * into a site until somebody grants them a membership.
 *
 * A user with no membership on a site is not a user of that site. That is the
 * default, and it is why an unknown but correctly authenticated person cannot
 * simply appear in the admin.
 */

import type { SqlDatabase } from "../db/driver.js";
import { ulid } from "../lib/id.js";

export type Role = "admin" | "editor";

export interface MembershipRecord {
  id: string;
  siteId: string;
  userId: string;
  role: Role;
  createdAt: string;
}

/** A membership with the person attached — what the Users screen lists. */
export interface MemberRecord extends MembershipRecord {
  email: string;
  name: string;
  lastLoginAt: string | null;
}

interface MembershipRow {
  id: string;
  site_id: string;
  user_id: string;
  role: Role;
  created_at: string;
}

interface MemberRow extends MembershipRow {
  email: string;
  name: string;
  last_login_at: string | null;
}

const toMembership = (row: MembershipRow): MembershipRecord => ({
  id: row.id,
  siteId: row.site_id,
  userId: row.user_id,
  role: row.role,
  createdAt: row.created_at,
});

const toMember = (row: MemberRow): MemberRecord => ({
  ...toMembership(row),
  email: row.email,
  name: row.name,
  lastLoginAt: row.last_login_at,
});

export function createMembershipRepository(db: SqlDatabase) {
  return {
    /** The membership that decides what this person may do on this site. */
    find(siteId: string, userId: string): MembershipRecord | undefined {
      const row = db.get<MembershipRow>(
        "SELECT * FROM memberships WHERE site_id = ? AND user_id = ?",
        [siteId, userId],
      );
      return row && toMembership(row);
    },

    listMembers(siteId: string): MemberRecord[] {
      return db
        .all<MemberRow>(
          `SELECT m.*, u.email, u.name, u.last_login_at
             FROM memberships m
             JOIN users u ON u.id = m.user_id
            WHERE m.site_id = ?
            ORDER BY u.created_at ASC`,
          [siteId],
        )
        .map(toMember);
    },

    /** Sites this person can reach at all. Empty means no access anywhere. */
    listForUser(userId: string): MembershipRecord[] {
      return db
        .all<MembershipRow>("SELECT * FROM memberships WHERE user_id = ?", [userId])
        .map(toMembership);
    },

    count(siteId: string): number {
      return (
        db.get<{ count: number }>("SELECT COUNT(*) AS count FROM memberships WHERE site_id = ?", [
          siteId,
        ])?.count ?? 0
      );
    },

    /**
     * Administrators on a site.
     *
     * Checked before a demotion or a removal: a site with no administrator can
     * only be repaired from a shell, and nobody should be able to lock the
     * whole team out with one click.
     */
    countAdmins(siteId: string): number {
      return (
        db.get<{ count: number }>(
          "SELECT COUNT(*) AS count FROM memberships WHERE site_id = ? AND role = 'admin'",
          [siteId],
        )?.count ?? 0
      );
    },

    grant(input: { siteId: string; userId: string; role: Role }): MembershipRecord {
      db.run(
        `INSERT INTO memberships (id, site_id, user_id, role, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (site_id, user_id) DO UPDATE SET role = excluded.role`,
        [ulid(), input.siteId, input.userId, input.role, new Date().toISOString()],
      );

      return this.find(input.siteId, input.userId)!;
    },

    revoke(siteId: string, userId: string): boolean {
      return (
        db.run("DELETE FROM memberships WHERE site_id = ? AND user_id = ?", [siteId, userId])
          .changes > 0
      );
    },
  };
}

export type MembershipRepository = ReturnType<typeof createMembershipRepository>;
