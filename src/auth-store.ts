import type { DatabaseSync } from "node:sqlite";
import type { AuthStore, AuthUser } from "./app-kit/index.ts";
import { get, run } from "./db.js";

type Row = { id: string; name: string; email: string | null; email_verified_at: number | null };

const USER_COLUMNS = "u.id AS id, u.name AS name, u.email AS email, u.email_verified_at AS email_verified_at";

function toUser(row: Row | undefined): AuthUser | undefined {
  if (!row) return undefined;
  return { id: row.id, name: row.name, email: row.email, emailVerifiedAt: row.email_verified_at };
}

/** The kit's AuthStore on top of the existing users, devices and auth_links tables. Statements are prepared per call. */
export function sqliteAuthStore(db: DatabaseSync): AuthStore {
  return {
    insertUser(user) {
      run(
        db,
        "INSERT INTO users (id, name, recovery_hash, created_at, email, email_verified_at) VALUES (?, ?, ?, ?, ?, NULL)",
        user.id,
        user.name,
        user.recoveryHash,
        user.createdAt,
        user.email,
      );
    },
    findUserById(id) {
      return toUser(get<Row>(db, `SELECT ${USER_COLUMNS} FROM users u WHERE u.id = ?`, id));
    },
    findUserByRecoveryHash(hash) {
      return toUser(get<Row>(db, `SELECT ${USER_COLUMNS} FROM users u WHERE u.recovery_hash = ?`, hash));
    },
    findUserByVerifiedEmail(email) {
      return toUser(
        get<Row>(db, `SELECT ${USER_COLUMNS} FROM users u WHERE u.email = ? AND u.email_verified_at IS NOT NULL`, email),
      );
    },
    setRecoveryHash(userId, hash) {
      run(db, "UPDATE users SET recovery_hash = ? WHERE id = ?", hash, userId);
    },
    setEmail(userId, email) {
      run(db, "UPDATE users SET email = ?, email_verified_at = NULL WHERE id = ?", email, userId);
    },
    markEmailVerified(userId, email, at) {
      try {
        return run(db, "UPDATE users SET email_verified_at = ? WHERE id = ? AND email = ?", at, userId, email) === 1;
      } catch (error) {
        // The partial unique index on verified addresses says another user got there first.
        if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) return false;
        throw error;
      }
    },
    insertSession(session) {
      run(db, "INSERT INTO devices (token_hash, user_id, created_at) VALUES (?, ?, ?)", session.tokenHash, session.userId, session.createdAt);
    },
    findUserBySessionHash(tokenHash) {
      return toUser(
        get<Row>(db, `SELECT ${USER_COLUMNS} FROM devices d JOIN users u ON u.id = d.user_id WHERE d.token_hash = ?`, tokenHash),
      );
    },
    deleteSession(tokenHash) {
      run(db, "DELETE FROM devices WHERE token_hash = ?", tokenHash);
    },
    deleteSessionsForUser(userId, exceptTokenHash) {
      if (exceptTokenHash === undefined) run(db, "DELETE FROM devices WHERE user_id = ?", userId);
      else run(db, "DELETE FROM devices WHERE user_id = ? AND token_hash <> ?", userId, exceptTokenHash);
    },
    insertLink(link) {
      run(
        db,
        "INSERT INTO auth_links (token_hash, user_id, kind, email, expires_at) VALUES (?, ?, ?, ?, ?)",
        link.tokenHash,
        link.userId,
        link.kind,
        link.email,
        link.expiresAt,
      );
    },
    takeLink(tokenHash, kind, now) {
      // One DELETE ... RETURNING, so two requests with the same token cannot both win.
      const row = get<{ user_id: string; email: string; expires_at: number }>(
        db,
        "DELETE FROM auth_links WHERE token_hash = ? AND kind = ? RETURNING user_id, email, expires_at",
        tokenHash,
        kind,
      );
      if (!row || row.expires_at <= now) return undefined;
      return { userId: row.user_id, email: row.email };
    },
    deleteLinksForUser(userId, kind) {
      run(db, "DELETE FROM auth_links WHERE user_id = ? AND kind = ?", userId, kind);
    },
  };
}
