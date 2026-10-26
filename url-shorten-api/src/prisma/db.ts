import 'dotenv/config';
import postgres from '@prisma/orm-postgres/runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);

export function createDb() {
  return postgres({
    contract,
    url: process.env['DATABASE_URL']!,
  });
}

export type Database = ReturnType<typeof createDb>;
