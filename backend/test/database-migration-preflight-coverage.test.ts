/*
 * Every committed migration must be registered with the schema-effect
 * preflight.
 *
 * The preflight grades each migration in the release against a hand-written
 * list of the schema effects it should produce, and refuses to deploy when a
 * migration has no entry — correctly, since it cannot tell an applied
 * migration from a pending one without knowing what to look for. That list is
 * maintained by hand, so adding a migration and forgetting the entry blocks
 * every deployment, on a fresh database as much as an existing one.
 *
 * That is exactly what happened with 20260902120000_identity_registry_evidence:
 * it shipped without an entry and operators could not start the stack at all.
 * This test fails at the moment a migration is added without registering it,
 * rather than at the moment someone tries to deploy.
 */

import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';

const MIGRATIONS_DIR = resolve(__dirname, '..', 'prisma', 'migrations');
const PREFLIGHT_SOURCE = resolve(
  __dirname,
  '..',
  'src',
  'ops',
  'database-migration-preflight.ts',
);

describe('migration schema-effect coverage', () => {
  const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const preflight = readFileSync(PREFLIGHT_SOURCE, 'utf8');

  it('finds committed migrations to check', () => {
    // Guards the guard: an empty list would make every assertion below vacuous.
    expect(migrations.length).toBeGreaterThan(0);
  });

  it.each(migrations)(
    'registers a schema-effect preflight for %s',
    (migrationName) => {
      expect(preflight).toContain(`'${migrationName}'`);
    },
  );

  it('registers no migration that is not committed', () => {
    // The other direction: a stale entry for a deleted or renamed migration
    // would make the preflight grade against something that cannot exist.
    const registered = Array.from(
      // The first entry carries `AS "migrationName"`; the rest are bare.
      preflight.matchAll(
        /^\s*'(\d{14}_[a-z0-9_]+)'(?:\s+AS\s+"migrationName")?,?$/gm,
      ),
      (match) => match[1],
    );
    expect(registered.length).toBeGreaterThan(0);
    expect([...new Set(registered)].sort()).toEqual(migrations);
  });
});
