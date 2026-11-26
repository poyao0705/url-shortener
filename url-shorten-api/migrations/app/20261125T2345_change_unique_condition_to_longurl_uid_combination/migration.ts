#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/3a53cebad9451f5eca813b08c18f1f6bd6a97d45c0fb2446accb8e7634e89f24/contract';
import startContract from '../../snapshots/3a53cebad9451f5eca813b08c18f1f6bd6a97d45c0fb2446accb8e7634e89f24/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/51546c31b9c051587fdade706c44c824779d963406788e53b1830f95568c4bc0/contract';
import endContract from '../../snapshots/51546c31b9c051587fdade706c44c824779d963406788e53b1830f95568c4bc0/contract.json' with { type: 'json' };
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
