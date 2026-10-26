#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/1041c9e0b822c0c8879350122e7b2d588d43461b0476ef1f1332552f3f90ca37/contract';
import startContract from '../../snapshots/1041c9e0b822c0c8879350122e7b2d588d43461b0476ef1f1332552f3f90ca37/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/fd5023a804ddc1a6268415b1ca190e52b72ed30b5e0d316383c7fc013a27aec9/contract';
import endContract from '../../snapshots/fd5023a804ddc1a6268415b1ca190e52b72ed30b5e0d316383c7fc013a27aec9/contract.json' with { type: 'json' };
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
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
