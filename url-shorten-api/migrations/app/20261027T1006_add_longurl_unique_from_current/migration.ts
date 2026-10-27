#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/3a53cebad9451f5eca813b08c18f1f6bd6a97d45c0fb2446accb8e7634e89f24/contract';
import endContract from '../../snapshots/3a53cebad9451f5eca813b08c18f1f6bd6a97d45c0fb2446accb8e7634e89f24/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/fd5023a804ddc1a6268415b1ca190e52b72ed30b5e0d316383c7fc013a27aec9/contract';
import startContract from '../../snapshots/fd5023a804ddc1a6268415b1ca190e52b72ed30b5e0d316383c7fc013a27aec9/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
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
