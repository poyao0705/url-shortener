#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/1041c9e0b822c0c8879350122e7b2d588d43461b0476ef1f1332552f3f90ca37/contract';
import endContract from '../../snapshots/1041c9e0b822c0c8879350122e7b2d588d43461b0476ef1f1332552f3f90ca37/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createTable({
        schema: 'public',
        table: 'Url',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('longUrl', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('shortUrl', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('uid', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('usedCount', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['shortUrl'])],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
