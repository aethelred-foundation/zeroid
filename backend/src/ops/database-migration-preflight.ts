import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const DATABASE_PREFLIGHT_BLOCKED_EXIT_CODE = 78;

export interface DatabaseSchemaObject {
  objectKind: string;
  objectName: string;
}

export interface DatabaseSchemaInspection {
  databaseName: string;
  schemaName: string;
  hasMigrationTable: boolean;
  migrationCount: number;
  unfinishedMigrationCount: number;
  objects: DatabaseSchemaObject[];
  historyProblems: string[];
  schemaHistoryProblems: string[];
}

export interface ExpectedMigration {
  migrationName: string;
  checksum: string;
}

export type AppliedMigration = ExpectedMigration;

export interface MigrationEffectState {
  migrationName: string;
  hasAnyEffect: boolean;
  hasAllEffects: boolean;
}

export type DatabasePreflightDecision =
  | {
      kind: 'empty';
      inspection: DatabaseSchemaInspection;
    }
  | {
      kind: 'tracked';
      inspection: DatabaseSchemaInspection;
    }
  | {
      kind: 'blocked-untracked';
      inspection: DatabaseSchemaInspection;
    }
  | {
      kind: 'blocked-unfinished';
      inspection: DatabaseSchemaInspection;
    }
  | {
      kind: 'blocked-divergent';
      inspection: DatabaseSchemaInspection;
    };

interface DatabaseInspectionClient {
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
}

interface DatabaseMetadataRow {
  databaseName: string;
  schemaName: string | null;
  hasMigrationTable: boolean;
}

interface MigrationHistoryRow {
  migrationCount: number;
  unfinishedMigrationCount: number;
}

export async function loadExpectedMigrations(
  migrationsDirectory = resolve(process.cwd(), 'prisma', 'migrations'),
): Promise<ExpectedMigration[]> {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const migrationNames = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (migrationNames.length === 0) {
    throw new Error(`No committed Prisma migrations found in ${migrationsDirectory}.`);
  }

  return Promise.all(
    migrationNames.map(async (migrationName) => {
      const sql = await readFile(
        resolve(migrationsDirectory, migrationName, 'migration.sql'),
      );
      return {
        migrationName,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    }),
  );
}

export function findMigrationHistoryProblems(
  appliedMigrations: AppliedMigration[],
  expectedMigrations: ExpectedMigration[],
): string[] {
  const problems: string[] = [];
  if (appliedMigrations.length > expectedMigrations.length) {
    problems.push('database has more applied migrations than this release');
  }

  for (let index = 0; index < appliedMigrations.length; index += 1) {
    const applied = appliedMigrations[index];
    const expected = expectedMigrations[index];
    if (!expected) {
      problems.push(`unexpected applied migration ${JSON.stringify(applied.migrationName)}`);
      continue;
    }
    if (applied.migrationName !== expected.migrationName) {
      problems.push(
        `applied migration ${index + 1} is ${JSON.stringify(
          applied.migrationName,
        )}; expected ${JSON.stringify(expected.migrationName)}`,
      );
      continue;
    }
    if (applied.checksum !== expected.checksum) {
      problems.push(
        `checksum mismatch for applied migration ${JSON.stringify(
          applied.migrationName,
        )}`,
      );
    }
  }
  return problems;
}

export function findSchemaHistoryProblems(
  effectStates: MigrationEffectState[],
  expectedMigrations: ExpectedMigration[],
  appliedMigrationCount: number,
): string[] {
  const effectsByMigration = new Map(
    effectStates.map((state) => [state.migrationName, state]),
  );
  const problems: string[] = [];

  for (let index = 0; index < expectedMigrations.length; index += 1) {
    const expected = expectedMigrations[index];
    const effects = effectsByMigration.get(expected.migrationName);
    if (!effects) {
      problems.push(
        `release has no schema-effect preflight for ${JSON.stringify(
          expected.migrationName,
        )}`,
      );
      continue;
    }

    if (index < appliedMigrationCount && !effects.hasAllEffects) {
      problems.push(
        `applied migration ${JSON.stringify(
          expected.migrationName,
        )} is missing expected schema effects`,
      );
    } else if (index >= appliedMigrationCount && effects.hasAnyEffect) {
      problems.push(
        `pending migration ${JSON.stringify(
          expected.migrationName,
        )} already has schema effects (possible db push or partial manual change)`,
      );
    }
  }
  return problems;
}

function quotePostgresIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export async function inspectDatabaseSchema(
  client: DatabaseInspectionClient,
  expectedMigrations: ExpectedMigration[],
): Promise<DatabaseSchemaInspection> {
  const metadataRows = await client.$queryRawUnsafe<DatabaseMetadataRow[]>(`
    SELECT
      current_database() AS "databaseName",
      current_schema() AS "schemaName",
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS migration_table
        JOIN pg_catalog.pg_namespace AS migration_namespace
          ON migration_namespace.oid = migration_table.relnamespace
        WHERE migration_namespace.nspname = current_schema()
          AND migration_table.relname = '_prisma_migrations'
          AND migration_table.relkind IN ('r', 'p')
      ) AS "hasMigrationTable"
  `);
  const metadata = metadataRows[0];

  if (!metadata || !metadata.schemaName) {
    throw new Error(
      'PostgreSQL did not resolve a current schema for DATABASE_URL.',
    );
  }

  const objects = await client.$queryRawUnsafe<DatabaseSchemaObject[]>(`
    SELECT
      relation.relname AS "objectName",
      CASE relation.relkind
        WHEN 'r' THEN 'table'
        WHEN 'p' THEN 'partitioned table'
        WHEN 'v' THEN 'view'
        WHEN 'm' THEN 'materialized view'
        WHEN 'S' THEN 'sequence'
        WHEN 'f' THEN 'foreign table'
        ELSE 'relation'
      END AS "objectKind"
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS relation_namespace
      ON relation_namespace.oid = relation.relnamespace
    WHERE relation_namespace.nspname = current_schema()
      AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      AND relation.relname <> '_prisma_migrations'

    UNION ALL

    SELECT
      database_type.typname AS "objectName",
      CASE database_type.typtype
        WHEN 'e' THEN 'enum'
        WHEN 'd' THEN 'domain'
        WHEN 'r' THEN 'range'
        WHEN 'm' THEN 'multirange'
        ELSE 'type'
      END AS "objectKind"
    FROM pg_catalog.pg_type AS database_type
    JOIN pg_catalog.pg_namespace AS type_namespace
      ON type_namespace.oid = database_type.typnamespace
    WHERE type_namespace.nspname = current_schema()
      AND database_type.typtype IN ('e', 'd', 'r', 'm')

    ORDER BY "objectKind", "objectName"
  `);

  const effectStates = await client.$queryRawUnsafe<MigrationEffectState[]>(`
    WITH effects AS (
      SELECT
        to_regclass(format('%I.%I', current_schema(), 'identities')) IS NOT NULL AS baseline_identities,
        to_regclass(format('%I.%I', current_schema(), 'oid4vci_token_sessions')) IS NOT NULL AS baseline_oid4vci,
        to_regclass(format('%I.%I', current_schema(), 'ai_agents')) IS NOT NULL AS baseline_agents,
        to_regclass(format('%I.%I', current_schema(), 'audit_logs')) IS NOT NULL AS baseline_audit,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'oid4vci_token_sessions'
            AND column_name = 'claimId'
        ) AS issuance_claim_id,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'oid4vci_token_sessions'
            AND column_name = 'claimExpiresAt'
        ) AS issuance_claim_expiry,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'ai_agents'
            AND column_name = 'agentProtocol'
        ) AS durable_agent_protocol,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'ai_agents'
            AND column_name = 'publicKeyHash'
        ) AS durable_agent_key_hash,
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_enum enum_value
          JOIN pg_catalog.pg_type enum_type ON enum_type.oid = enum_value.enumtypid
          JOIN pg_catalog.pg_namespace enum_namespace
            ON enum_namespace.oid = enum_type.typnamespace
          WHERE enum_namespace.nspname = current_schema()
            AND enum_type.typname = 'AuditAction'
            AND enum_value.enumlabel = 'SCHEMA_VOTE_CAST'
        ) AS schema_vote_action,
        to_regclass(format('%I.%I', current_schema(), 'agent_delegations')) IS NOT NULL AS durable_delegations,
        to_regclass(format('%I.%I', current_schema(), 'agent_approval_requests')) IS NOT NULL AS durable_approvals,
        to_regclass(format('%I.%I', current_schema(), 'agent_authorization_operations')) IS NOT NULL AS durable_operations,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'ai_agents'
            AND column_name = 'authorizationVersion'
        ) AS durable_authorization_version,
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class index_relation
          JOIN pg_catalog.pg_namespace index_namespace
            ON index_namespace.oid = index_relation.relnamespace
          JOIN pg_catalog.pg_index index_metadata
            ON index_metadata.indexrelid = index_relation.oid
          WHERE index_namespace.nspname = current_schema()
            AND index_relation.relname = 'audit_logs_previousHash_key'
            AND index_metadata.indisunique
        ) AS linear_audit_index
    )
    SELECT
      '20260718000000_zeroid_baseline' AS "migrationName",
      (baseline_identities OR baseline_oid4vci OR baseline_agents OR baseline_audit) AS "hasAnyEffect",
      (baseline_identities AND baseline_oid4vci AND baseline_agents AND baseline_audit) AS "hasAllEffects"
    FROM effects
    UNION ALL
    SELECT
      '20260718010000_oid4vci_atomic_issuance',
      (issuance_claim_id OR issuance_claim_expiry),
      (issuance_claim_id AND issuance_claim_expiry)
    FROM effects
    UNION ALL
    SELECT
      '20260718020000_ai_agent_durable_identity',
      (durable_agent_protocol OR durable_agent_key_hash),
      (durable_agent_protocol AND durable_agent_key_hash)
    FROM effects
    UNION ALL
    SELECT
      '20260718030000_schema_vote_audit_action',
      schema_vote_action,
      schema_vote_action
    FROM effects
    UNION ALL
    SELECT
      '20260718040000_agent_delegation_approval_durability',
      (
        durable_delegations OR durable_approvals OR durable_operations
        OR durable_authorization_version
      ),
      (
        durable_delegations AND durable_approvals AND durable_operations
        AND durable_authorization_version
      )
    FROM effects
    UNION ALL
    SELECT
      '20260718041000_audit_chain_linearization',
      linear_audit_index,
      linear_audit_index
    FROM effects
  `);

  let migrationCount = 0;
  let unfinishedMigrationCount = 0;
  let appliedMigrations: AppliedMigration[] = [];
  if (metadata.hasMigrationTable) {
    const migrationTable = `${quotePostgresIdentifier(
      metadata.schemaName,
    )}.${quotePostgresIdentifier('_prisma_migrations')}`;
    const migrationRows = await client.$queryRawUnsafe<MigrationHistoryRow[]>(`
      SELECT
        COUNT(*) FILTER (
          WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        )::integer AS "migrationCount",
        COUNT(*) FILTER (
          WHERE finished_at IS NULL AND rolled_back_at IS NULL
        )::integer AS "unfinishedMigrationCount"
      FROM ${migrationTable}
    `);
    migrationCount = migrationRows[0]?.migrationCount ?? 0;
    unfinishedMigrationCount =
      migrationRows[0]?.unfinishedMigrationCount ?? 0;
    appliedMigrations = await client.$queryRawUnsafe<AppliedMigration[]>(`
      SELECT
        migration_name AS "migrationName",
        checksum
      FROM ${migrationTable}
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY started_at, id
    `);
  }

  const historyProblems = findMigrationHistoryProblems(
    appliedMigrations,
    expectedMigrations,
  );
  if (migrationCount !== appliedMigrations.length) {
    historyProblems.push('applied migration count changed during preflight');
  }
  const schemaHistoryProblems =
    historyProblems.length === 0
      ? findSchemaHistoryProblems(
          effectStates,
          expectedMigrations,
          appliedMigrations.length,
        )
      : [];

  return {
    databaseName: metadata.databaseName,
    schemaName: metadata.schemaName,
    hasMigrationTable: metadata.hasMigrationTable,
    migrationCount,
    unfinishedMigrationCount,
    objects,
    historyProblems,
    schemaHistoryProblems,
  };
}

export function classifyDatabaseSchema(
  inspection: DatabaseSchemaInspection,
): DatabasePreflightDecision {
  if (inspection.unfinishedMigrationCount > 0) {
    return { kind: 'blocked-unfinished', inspection };
  }

  if (
    inspection.historyProblems.length > 0 ||
    inspection.schemaHistoryProblems.length > 0
  ) {
    return { kind: 'blocked-divergent', inspection };
  }

  if (inspection.migrationCount > 0) {
    return { kind: 'tracked', inspection };
  }

  if (inspection.objects.length === 0) {
    return { kind: 'empty', inspection };
  }

  return { kind: 'blocked-untracked', inspection };
}

function describeLocation(inspection: DatabaseSchemaInspection): string {
  return `schema ${JSON.stringify(inspection.schemaName)} in database ${JSON.stringify(
    inspection.databaseName,
  )}`;
}

function objectSummary(objects: DatabaseSchemaObject[]): string {
  const visibleObjects = objects
    .slice(0, 12)
    .map(
      ({ objectKind, objectName }) =>
        `${objectKind} ${JSON.stringify(objectName)}`,
    );
  const remaining = objects.length - visibleObjects.length;
  if (remaining > 0) visibleObjects.push(`and ${remaining} more`);
  return visibleObjects.join(', ');
}

export function formatDatabasePreflightDecision(
  decision: DatabasePreflightDecision,
): string[] {
  const { inspection } = decision;
  const location = describeLocation(inspection);

  if (decision.kind === 'empty') {
    return [
      `Database migration preflight passed: ${location} has no application objects or applied migrations.`,
    ];
  }

  if (decision.kind === 'tracked') {
    return [
      `Database migration preflight passed: ${location} has ${inspection.migrationCount} applied Prisma migration record(s).`,
    ];
  }

  if (decision.kind === 'blocked-unfinished') {
    return [
      'DATABASE MIGRATION PREFLIGHT BLOCKED',
      `${location} has ${inspection.unfinishedMigrationCount} unfinished Prisma migration record(s).`,
      'No migration was run and no schema or data change was made.',
      'Inspect `npx prisma migrate status` and the failed migration logs, then follow a reviewed Prisma failed-migration recovery. Do not delete migration history or mark a migration applied without verifying its SQL effects.',
      'See backend/README.md#safe-database-migration-and-p3005-recovery.',
    ];
  }

  if (decision.kind === 'blocked-divergent') {
    return [
      'DATABASE MIGRATION PREFLIGHT BLOCKED (history/schema divergence)',
      `${location} does not match this release's committed Prisma migration prefix.`,
      ...inspection.historyProblems.map((problem) => `History: ${problem}.`),
      ...inspection.schemaHistoryProblems.map(
        (problem) => `Schema: ${problem}.`,
      ),
      'No migration was run and no schema or data change was made.',
      'Back up and audit the database. Do not run migrate deploy or resolve additional migrations until the history and live schema are reconciled on a restored copy.',
      'See backend/README.md#safe-database-migration-and-p3005-recovery.',
    ];
  }

  return [
    'DATABASE MIGRATION PREFLIGHT BLOCKED (Prisma P3005 prevention)',
    `${location} contains ${inspection.objects.length} application object(s) but has no applied Prisma migration history.`,
    `Detected objects: ${objectSummary(inspection.objects)}.`,
    'No migration was run and no schema or data change was made.',
    'Choose an operator-reviewed path: create a new empty public-testnet database in the same PostgreSQL volume, or back up and audit this database before explicitly baselining only migrations whose SQL effects are already present.',
    'See backend/README.md#safe-database-migration-and-p3005-recovery.',
  ];
}

export async function runDatabaseMigrationPreflight(
  client: DatabaseInspectionClient,
  expectedMigrations: ExpectedMigration[],
  writeLine: (line: string) => void = console.log,
): Promise<DatabasePreflightDecision> {
  const decision = classifyDatabaseSchema(
    await inspectDatabaseSchema(client, expectedMigrations),
  );
  for (const line of formatDatabasePreflightDecision(decision)) {
    writeLine(line);
  }
  return decision;
}

function redactDatabaseUrls(message: string): string {
  return message.replace(
    /\bpostgres(?:ql)?:\/\/\S+/gi,
    '[REDACTED_DATABASE_URL]',
  );
}

async function main(): Promise<void> {
  const client = new PrismaClient();
  try {
    const expectedMigrations = await loadExpectedMigrations();
    const decision = await runDatabaseMigrationPreflight(
      client,
      expectedMigrations,
    );
    if (decision.kind.startsWith('blocked-')) {
      process.exitCode = DATABASE_PREFLIGHT_BLOCKED_EXIT_CODE;
    }
  } finally {
    await client.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : 'Unknown database inspection error';
    console.error(
      'Database migration preflight failed before any migration was run.',
    );
    console.error(redactDatabaseUrls(message));
    process.exitCode = 1;
  });
}
