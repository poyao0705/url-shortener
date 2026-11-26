#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/3a53cebad9451f5eca813b08c18f1f6bd6a97d45c0fb2446accb8e7634e89f24/contract';
import startContract from '../../snapshots/3a53cebad9451f5eca813b08c18f1f6bd6a97d45c0fb2446accb8e7634e89f24/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/a9a832343db3c13d1bf7f646341b5a951fba4b388ab52f0d6024df9ef691e92f/contract';
import endContract from '../../snapshots/a9a832343db3c13d1bf7f646341b5a951fba4b388ab52f0d6024df9ef691e92f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropConstraint({ schema: 'public', table: 'Url', constraint: 'Url_longUrl_key' }),
      this.addUnique({
        schema: 'public',
        table: 'Url',
        constraint: 'Url_longUrl_uid_key',
        columns: ['longUrl', 'uid'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
