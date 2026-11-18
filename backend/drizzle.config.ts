import { defineConfig } from 'drizzle-kit';

// Drizzle schema generation is offline; a database URL is optional for that
// command. Commands that connect to PostgreSQL must receive explicit secret
// configuration rather than silently using hardcoded local credentials.
const databaseUrl = process.env.DATABASE_URL?.trim();

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/postgres/schema.ts',
  out: './migrations/drizzle',
  ...(databaseUrl ? { dbCredentials: { url: databaseUrl } } : {}),
  strict: true,
  verbose: true,
});
