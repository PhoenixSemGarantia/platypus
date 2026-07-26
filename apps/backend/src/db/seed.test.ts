import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `eq` and `count` are replaced with introspectable markers so the in-memory
 * fake database below can interpret a Drizzle condition without parsing SQL.
 * Everything else (`pgTable` and friends, used by the schema module) comes from
 * the real package.
 */
vi.mock("drizzle-orm", async () => {
  const actual =
    await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (column: { name: string }, value: unknown) => ({
      column: column.name,
      value,
    }),
    count: () => ({ isCount: true }),
  };
});

// Reaches the real implementation through the `...actual` spread above.
import { getTableName } from "drizzle-orm";
import {
  seedFirstBoot,
  NonRetryableSeedError,
  type SeedDatabase,
  type AdminSignUp,
} from "./seed.ts";
import { logger } from "../logger.ts";

type Row = Record<string, unknown>;

/** The four tables the seed touches, keyed by their Postgres table name. */
type Store = {
  organization: Row[];
  user: Row[];
  organization_member: Row[];
  workspace: Row[];
};

/** Snake-cased column names from `eq` map back onto camel-cased row keys. */
const toCamel = (name: string) =>
  name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

type Condition = { column: string; value: unknown } | undefined;

const matches = (row: Row, condition: Condition) =>
  !condition ||
  row[condition.column] === condition.value ||
  row[toCamel(condition.column)] === condition.value;

/**
 * A minimal in-memory stand-in for the Drizzle handle covering only what the
 * seed uses: counting, lookups by column, inserts, updates, deletes and — the
 * reason this exists rather than the chainable mock in `test-utils` — a
 * `transaction` that actually rolls back. Prior art in this repo mocks queries
 * or mirrors logic in plain JS, neither of which can express "after a failed
 * boot the database is back where it started", which is the assertion issue
 * #369 turns on.
 *
 * `transaction` hands the callback a handle bound to a *staging copy* that is
 * only merged back on success, mirroring the property that matters in
 * production: writes issued against the outer handle inside the callback go to
 * a different connection and survive the rollback. A refactor that used `db`
 * where it means `tx` fails these tests rather than passing quietly.
 */
const createFakeDb = (options: { onInsert?: (table: string) => void } = {}) => {
  const committed: Store = {
    organization: [],
    user: [],
    organization_member: [],
    workspace: [],
  };

  const nameOf = (table: unknown) =>
    getTableName(table as Parameters<typeof getTableName>[0]);

  const makeHandle = (store: Store) => {
    const rowsFor = (table: unknown): Row[] => {
      const name = nameOf(table);
      const rows = store[name as keyof Store];
      if (!rows) throw new Error(`Fake db has no table "${name}"`);
      return rows;
    };

    return {
      select(selection?: Record<string, unknown>) {
        let table: unknown;
        let condition: Condition;
        let take = Infinity;
        const builder = {
          from(t: unknown) {
            table = t;
            return builder;
          },
          where(c: Condition) {
            condition = c;
            return builder;
          },
          limit(n: number) {
            take = n;
            return builder;
          },
          then(
            onFulfilled: (rows: Row[]) => unknown,
            onRejected?: () => unknown,
          ) {
            const rows = rowsFor(table)
              .filter((row) => matches(row, condition))
              .slice(0, take);
            const isCount = Object.values(selection ?? {}).some(
              (value) => (value as { isCount?: boolean })?.isCount,
            );
            const result = isCount
              ? [
                  Object.fromEntries(
                    Object.keys(selection ?? {}).map((key) => [
                      key,
                      rows.length,
                    ]),
                  ),
                ]
              : rows.map((row) => ({ ...row }));
            return Promise.resolve(result).then(onFulfilled, onRejected);
          },
        };
        return builder;
      },
      insert(table: unknown) {
        return {
          values(values: Row) {
            const name = nameOf(table);
            options.onInsert?.(name);
            // The real `user.email` is unique; model it so a leftover User
            // makes a second sign-up fail the way Postgres would.
            if (
              name === "user" &&
              store.user.some((row) => row.email === values.email)
            ) {
              throw new Error("duplicate key value violates unique constraint");
            }
            rowsFor(table).push({ ...values });
            return Promise.resolve();
          },
        };
      },
      update(table: unknown) {
        let patch: Row = {};
        const builder = {
          set(values: Row) {
            patch = values;
            return builder;
          },
          where(condition: Condition) {
            for (const row of rowsFor(table)) {
              if (matches(row, condition)) Object.assign(row, patch);
            }
            return Promise.resolve();
          },
        };
        return builder;
      },
      delete(table: unknown) {
        return {
          where(condition: Condition) {
            const rows = rowsFor(table);
            const kept = rows.filter((row) => !matches(row, condition));
            rows.length = 0;
            rows.push(...kept);
            return Promise.resolve();
          },
        };
      },
      async transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
        const staged = structuredClone(store);
        const result = await callback(makeHandle(staged));
        for (const [name, rows] of Object.entries(staged)) {
          const target = store[name as keyof Store];
          target.length = 0;
          target.push(...rows);
        }
        return result;
      },
    };
  };

  return { handle: makeHandle(committed), tables: committed };
};

const asSeedDb = (fake: { handle: unknown }) => fake.handle as SeedDatabase;

/**
 * Stands in for better-auth's `signUpEmail`: it writes the User row through its
 * own database access, outside any transaction the seed opens — which is the
 * whole reason the seed has to compensate rather than rely on rollback.
 */
const createSignUp = (
  tables: Store,
  behaviour: { fail?: Error } = {},
): AdminSignUp => {
  let n = 0;
  return vi.fn(({ email, name }) => {
    if (behaviour.fail) return Promise.reject(behaviour.fail);
    if (tables.user.some((row) => row.email === email)) {
      return Promise.reject(
        new Error("duplicate key value violates unique constraint"),
      );
    }
    const id = `user-${++n}`;
    tables.user.push({
      id,
      email,
      name,
      role: "user",
      emailVerified: false,
    });
    return Promise.resolve({ id });
  });
};

const VALID_ENV = {
  ADMIN_EMAIL: "admin@example.com",
  ADMIN_PASSWORD: "s3cret!",
};

describe("seedFirstBoot", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("seeds an organization, admin user, membership and workspace on an empty database", async () => {
    const fake = createFakeDb();
    const signUpAdmin = createSignUp(fake.tables);

    const result = await seedFirstBoot(asSeedDb(fake), {
      signUpAdmin,
      env: VALID_ENV,
    });

    expect(result.seeded).toBe(true);
    expect(fake.tables.organization).toHaveLength(1);
    expect(fake.tables.user).toHaveLength(1);
    expect(fake.tables.organization_member).toHaveLength(1);
    expect(fake.tables.workspace).toHaveLength(1);

    const [admin] = fake.tables.user;
    expect(admin).toMatchObject({
      email: VALID_ENV.ADMIN_EMAIL,
      role: "admin",
      emailVerified: true,
    });
    expect(fake.tables.organization_member[0]).toMatchObject({
      organizationId: fake.tables.organization[0].id,
      userId: admin.id,
      role: "admin",
    });
    expect(fake.tables.workspace[0]).toMatchObject({
      organizationId: fake.tables.organization[0].id,
      ownerId: admin.id,
      name: "Default Workspace",
    });
  });

  it("writes nothing and names the missing variable when ADMIN_EMAIL is unset", async () => {
    const fake = createFakeDb();
    const signUpAdmin = createSignUp(fake.tables);

    await expect(
      seedFirstBoot(asSeedDb(fake), {
        signUpAdmin,
        env: { ADMIN_PASSWORD: "s3cret!" },
      }),
    ).rejects.toThrow(/ADMIN_EMAIL/);

    expect(fake.tables.organization).toHaveLength(0);
    expect(fake.tables.user).toHaveLength(0);
    expect(signUpAdmin).not.toHaveBeenCalled();
  });

  it("names ADMIN_PASSWORD when it is the unset one, and does not retry", async () => {
    const fake = createFakeDb();

    const error = await seedFirstBoot(asSeedDb(fake), {
      signUpAdmin: createSignUp(fake.tables),
      env: { ADMIN_EMAIL: "admin@example.com" },
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NonRetryableSeedError);
    expect((error as Error).message).toMatch(/ADMIN_PASSWORD/);
    expect(fake.tables.organization).toHaveLength(0);
  });

  it("leaves no organization behind when a write after the organization insert fails", async () => {
    const fake = createFakeDb({
      onInsert: (table) => {
        if (table === "workspace") throw new Error("connection terminated");
      },
    });

    await expect(
      seedFirstBoot(asSeedDb(fake), {
        signUpAdmin: createSignUp(fake.tables),
        env: VALID_ENV,
      }),
    ).rejects.toThrow(/connection terminated/);

    expect(fake.tables.organization).toHaveLength(0);
    expect(fake.tables.organization_member).toHaveLength(0);
    expect(fake.tables.workspace).toHaveLength(0);
    // The User is written by better-auth outside the transaction, so rollback
    // cannot remove it — the seed compensates explicitly.
    expect(fake.tables.user).toHaveLength(0);
  });

  it("seeds successfully on a retry after a failed attempt (regression: #369)", async () => {
    let failing = true;
    const fake = createFakeDb({
      onInsert: (table) => {
        if (failing && table === "workspace") {
          throw new Error("connection terminated");
        }
      },
    });
    const signUpAdmin = createSignUp(fake.tables);

    await expect(
      seedFirstBoot(asSeedDb(fake), { signUpAdmin, env: VALID_ENV }),
    ).rejects.toThrow(/connection terminated/);

    failing = false;

    const result = await seedFirstBoot(asSeedDb(fake), {
      signUpAdmin,
      env: VALID_ENV,
    });

    expect(result.seeded).toBe(true);
    expect(fake.tables.organization).toHaveLength(1);
    expect(fake.tables.user).toHaveLength(1);
    expect(fake.tables.organization_member).toHaveLength(1);
    expect(fake.tables.workspace).toHaveLength(1);
  });

  it("refuses to promote a User that already holds ADMIN_EMAIL", async () => {
    const fake = createFakeDb();
    // Compensation can itself fail — the database is the thing that broke — so
    // a leftover User is reachable. Promoting whoever holds the address would
    // be an escalation; the seed stops and says which row to delete.
    fake.tables.user.push({
      id: "leftover-user",
      email: VALID_ENV.ADMIN_EMAIL,
      name: "Admin User",
      role: "user",
      emailVerified: false,
    });
    const signUpAdmin = createSignUp(fake.tables);

    const error = await seedFirstBoot(asSeedDb(fake), {
      signUpAdmin,
      env: VALID_ENV,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NonRetryableSeedError);
    expect((error as Error).message).toMatch(VALID_ENV.ADMIN_EMAIL);
    expect((error as Error).message).toMatch(/Delete that user/);
    expect(signUpAdmin).not.toHaveBeenCalled();
    expect(fake.tables.user[0]).toMatchObject({ role: "user" });
    expect(fake.tables.organization).toHaveLength(0);
    expect(fake.tables.organization_member).toHaveLength(0);
  });

  it("is a quiet no-op against an already-seeded database", async () => {
    const fake = createFakeDb();
    const signUpAdmin = createSignUp(fake.tables);
    await seedFirstBoot(asSeedDb(fake), { signUpAdmin, env: VALID_ENV });

    const warn = vi.spyOn(logger, "warn");
    const error = vi.spyOn(logger, "error");

    const result = await seedFirstBoot(asSeedDb(fake), {
      signUpAdmin,
      env: VALID_ENV,
    });

    expect(result).toEqual({ seeded: false });
    expect(fake.tables.organization).toHaveLength(1);
    expect(fake.tables.user).toHaveLength(1);
    expect(fake.tables.workspace).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("requires no admin config to skip an already-seeded database", async () => {
    const fake = createFakeDb();
    await seedFirstBoot(asSeedDb(fake), {
      signUpAdmin: createSignUp(fake.tables),
      env: VALID_ENV,
    });

    await expect(
      seedFirstBoot(asSeedDb(fake), {
        signUpAdmin: createSignUp(fake.tables),
        env: {},
      }),
    ).resolves.toEqual({ seeded: false });
  });

  it("reports a deterministic better-auth rejection as non-retryable", async () => {
    const fake = createFakeDb();
    const rejection = Object.assign(new Error("Password too short"), {
      statusCode: 400,
    });

    const error = await seedFirstBoot(asSeedDb(fake), {
      signUpAdmin: createSignUp(fake.tables, { fail: rejection }),
      env: VALID_ENV,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NonRetryableSeedError);
    expect((error as Error).message).toMatch(/Password too short/);
    expect(fake.tables.organization).toHaveLength(0);
    expect(fake.tables.user).toHaveLength(0);
  });

  it("retries a transient better-auth failure rather than giving up", async () => {
    const fake = createFakeDb();

    const error = await seedFirstBoot(asSeedDb(fake), {
      signUpAdmin: createSignUp(fake.tables, {
        fail: new Error("socket hang up"),
      }),
      env: VALID_ENV,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(NonRetryableSeedError);
    expect(fake.tables.organization).toHaveLength(0);
  });

  it("flags a database left half-seeded by an older release", async () => {
    const fake = createFakeDb();
    fake.tables.organization.push({
      id: "org-1",
      name: "Default Organization",
    });
    const error = vi.spyOn(logger, "error");

    const result = await seedFirstBoot(asSeedDb(fake), {
      signUpAdmin: createSignUp(fake.tables),
      env: VALID_ENV,
    });

    expect(result).toEqual({ seeded: false });
    expect(error).toHaveBeenCalled();
    expect(fake.tables.organization).toHaveLength(1);
    expect(fake.tables.user).toHaveLength(0);
  });
});
