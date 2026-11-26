#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/51546c31b9c051587fdade706c44c824779d963406788e53b1830f95568c4bc0/contract';
import startContract from '../../snapshots/51546c31b9c051587fdade706c44c824779d963406788e53b1830f95568c4bc0/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/a9a832343db3c13d1bf7f646341b5a951fba4b388ab52f0d6024df9ef691e92f/contract';
import endContract from '../../snapshots/a9a832343db3c13d1bf7f646341b5a951fba4b388ab52f0d6024df9ef691e92f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [];
  }
}

MigrationCLI.run(import.meta.url, M);
