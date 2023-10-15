import { Kysely, sql } from 'kysely'

// @TODO subject indexes, naming?
// @TODO drop indexes in down()?

export async function up(db: Kysely<unknown>): Promise<void> {
  // actor
  await db.schema
    .createTable('actor')
    .addColumn('did', 'varchar', (col) => col.primaryKey())
    .addColumn('handle', 'varchar', (col) => col.unique())
    .addColumn('indexedAt', 'varchar', (col) => col.notNull())
    .addColumn('takedownId', 'integer') // foreign key created in moderation-init migration
    .execute()
  await db.schema // Supports user search
    .createIndex(`actor_handle_tgrm_idx`)
    .on('actor')
    .using('gist')
    .expression(sql`"handle" gist_trgm_ops`)
    .execute()

  // actor sync state
  await db.schema
    .createTable('actor_sync')
    .addColumn('did', 'varchar', (col) => col.primaryKey())
    .addColumn('commitCid', 'varchar', (col) => col.notNull())
    .addColumn('commitDataCid', 'varchar', (col) => col.notNull())
    .addColumn('rebaseCount', 'integer', (col) => col.notNull())
    .addColumn('tooBigCount', 'integer', (col) => col.notNull())
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // actor
  await db.schema.dropTable('actor_sync').execute()
  await db.schema.dropTable('actor').execute()
}
