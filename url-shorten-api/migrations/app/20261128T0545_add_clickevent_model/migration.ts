#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/7e15d7a6120361085ab99fde4294bb7baaadb6fb6f94bea1bb66f4b2b4ebed71/contract';
import endContract from '../../snapshots/7e15d7a6120361085ab99fde4294bb7baaadb6fb6f94bea1bb66f4b2b4ebed71/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/a9a832343db3c13d1bf7f646341b5a951fba4b388ab52f0d6024df9ef691e92f/contract';
import startContract from '../../snapshots/a9a832343db3c13d1bf7f646341b5a951fba4b388ab52f0d6024df9ef691e92f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'ClickEvent',
        columns: [
          col('clickedAt', 'timestamptz', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('referrer', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('shortUrl', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'ClickEvent',
        index: 'ClickEvent_shortUrl_idx_26a79b9d',
        columns: ['shortUrl'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'ClickEvent',
        foreignKey: {
          name: 'ClickEvent_shortUrl_fkey',
          columns: ['shortUrl'],
          references: { schema: 'public', table: 'Url', columns: ['shortUrl'] },
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
