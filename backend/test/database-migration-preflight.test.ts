import {
  classifyDatabaseSchema,
  findMigrationHistoryProblems,
  findSchemaHistoryProblems,
  formatDatabasePreflightDecision,
  inspectDatabaseSchema,
  type ExpectedMigration,
  type DatabaseSchemaInspection,
} from '../src/ops/database-migration-preflight';

const baselineMigration: ExpectedMigration = {
  migrationName: '20260718000000_zeroid_baseline',
  checksum: 'baseline-checksum',
};

const baseInspection = (
  overrides: Partial<DatabaseSchemaInspection> = {},
): DatabaseSchemaInspection => ({
  databaseName: 'zeroid',
  schemaName: 'public',
  hasMigrationTable: false,
  migrationCount: 0,
  unfinishedMigrationCount: 0,
  objects: [],
  historyProblems: [],
  schemaHistoryProblems: [],
  ...overrides,
});

describe('database migration preflight', () => {
  it('allows a fresh empty schema', () => {
    const decision = classifyDatabaseSchema(baseInspection());

    expect(decision.kind).toBe('empty');
    expect(formatDatabasePreflightDecision(decision)[0]).toMatch(
      /preflight passed/i,
    );
  });

  it('allows a database with applied Prisma migration history', () => {
    const decision = classifyDatabaseSchema(
      baseInspection({
        hasMigrationTable: true,
        migrationCount: 6,
        objects: [{ objectKind: 'table', objectName: 'identities' }],
      }),
    );

    expect(decision.kind).toBe('tracked');
    expect(formatDatabasePreflightDecision(decision)[0]).toContain(
      '6 applied Prisma migration record(s)',
    );
  });

  it('blocks a non-empty schema without migration history before P3005', () => {
    const decision = classifyDatabaseSchema(
      baseInspection({
        objects: [
          { objectKind: 'enum', objectName: 'IdentityStatus' },
          { objectKind: 'table', objectName: 'identities' },
        ],
      }),
    );
    const output = formatDatabasePreflightDecision(decision).join('\n');

    expect(decision.kind).toBe('blocked-untracked');
    expect(output).toContain('Prisma P3005 prevention');
    expect(output).toContain('No migration was run');
    expect(output).toContain('new empty public-testnet database');
    expect(output).toContain('back up and audit');
  });

  it('does not trust an empty migration table beside application objects', () => {
    const decision = classifyDatabaseSchema(
      baseInspection({
        hasMigrationTable: true,
        migrationCount: 0,
        objects: [{ objectKind: 'table', objectName: 'identities' }],
      }),
    );

    expect(decision.kind).toBe('blocked-untracked');
  });

  it('does not treat rolled-back-only migration history as applied', () => {
    const decision = classifyDatabaseSchema(
      baseInspection({
        hasMigrationTable: true,
        migrationCount: 0,
        objects: [{ objectKind: 'table', objectName: 'legacy_identity' }],
      }),
    );

    expect(decision.kind).toBe('blocked-untracked');
  });

  it('blocks an unfinished migration history for reviewed recovery', () => {
    const decision = classifyDatabaseSchema(
      baseInspection({
        hasMigrationTable: true,
        migrationCount: 2,
        unfinishedMigrationCount: 1,
      }),
    );
    const output = formatDatabasePreflightDecision(decision).join('\n');

    expect(decision.kind).toBe('blocked-unfinished');
    expect(output).toContain('unfinished Prisma migration');
    expect(output).toContain('No migration was run');
  });

  it('rejects unrelated or checksum-mismatched applied history', () => {
    expect(
      findMigrationHistoryProblems(
        [{ migrationName: '20200101000000_other_app', checksum: 'x' }],
        [baselineMigration],
      ),
    ).toEqual(
      expect.arrayContaining([expect.stringContaining('expected')]),
    );
    expect(
      findMigrationHistoryProblems(
        [{ ...baselineMigration, checksum: 'modified' }],
        [baselineMigration],
      ),
    ).toEqual([
      expect.stringContaining('checksum mismatch'),
    ]);
  });

  it('blocks pending migrations whose db-push effects already exist', () => {
    const problems = findSchemaHistoryProblems(
      [
        {
          migrationName: baselineMigration.migrationName,
          hasAnyEffect: true,
          hasAllEffects: true,
        },
        {
          migrationName: '20260718010000_oid4vci_atomic_issuance',
          hasAnyEffect: true,
          hasAllEffects: true,
        },
      ],
      [
        baselineMigration,
        {
          migrationName: '20260718010000_oid4vci_atomic_issuance',
          checksum: 'issuance-checksum',
        },
      ],
      1,
    );

    expect(problems).toEqual([
      expect.stringContaining('possible db push'),
    ]);
  });

  it('inspects migration counts only when the migration table exists', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        {
          databaseName: 'zeroid',
          schemaName: 'public',
          hasMigrationTable: false,
        },
      ])
      .mockResolvedValueOnce([
        { objectKind: 'table', objectName: 'identities' },
      ])
      .mockResolvedValueOnce([
        {
          migrationName: baselineMigration.migrationName,
          hasAnyEffect: true,
          hasAllEffects: true,
        },
      ]);

    const inspection = await inspectDatabaseSchema({
      $queryRawUnsafe: query,
    }, [baselineMigration]);

    expect(query).toHaveBeenCalledTimes(3);
    expect(inspection.migrationCount).toBe(0);
    expect(inspection.objects).toEqual([
      { objectKind: 'table', objectName: 'identities' },
    ]);
  });

  it('quotes the active schema before reading migration history', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        {
          databaseName: 'zeroid',
          schemaName: 'tenant"one',
          hasMigrationTable: true,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          migrationName: baselineMigration.migrationName,
          hasAnyEffect: true,
          hasAllEffects: true,
        },
      ])
      .mockResolvedValueOnce([
        { migrationCount: 1, unfinishedMigrationCount: 0 },
      ])
      .mockResolvedValueOnce([
        baselineMigration,
      ]);

    const inspection = await inspectDatabaseSchema({
      $queryRawUnsafe: query,
    }, [baselineMigration]);

    expect(query.mock.calls[3][0]).toContain(
      'FROM "tenant""one"."_prisma_migrations"',
    );
    expect(query.mock.calls[3][0]).toContain(
      'finished_at IS NOT NULL AND rolled_back_at IS NULL',
    );
    expect(query.mock.calls[4][0]).toContain(
      'ORDER BY started_at, id',
    );
    expect(inspection.migrationCount).toBe(1);
  });
});
