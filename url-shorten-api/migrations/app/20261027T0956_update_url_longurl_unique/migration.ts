#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/1041c9e0b822c0c8879350122e7b2d588d43461b0476ef1f1332552f3f90ca37/contract';
import startContract from '../../snapshots/1041c9e0b822c0c8879350122e7b2d588d43461b0476ef1f1332552f3f90ca37/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/3a53cebad9451f5eca813b08c18f1f6bd6a97d45c0fb2446accb8e7634e89f24/contract';
import endContract from '../../snapshots/3a53cebad9451f5eca813b08c18f1f6bd6a97d45c0fb2446accb8e7634e89f24/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.setDefault({
        schema: 'public',
        table: 'Url',
        column: col('usedCount', 'int4', { default: lit(0), codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'Url',
        constraint: 'Url_longUrl_key',
        columns: ['longUrl'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
