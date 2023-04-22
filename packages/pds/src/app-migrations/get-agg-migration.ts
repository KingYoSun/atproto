import AppContext from '../context'
import Database from '../db'
import { appMigration } from '../db/leader'
import { sql } from 'kysely'

const MIGRATION_NAME = '2023-04-22-get-gg-migration'
const SHORT_NAME = 'get-agg-migration'

export async function removeScenesMigration(ctx: AppContext) {
  await appMigration(ctx.db, MIGRATION_NAME, (tx) => main(ctx, tx))
}

async function main(ctx: AppContext, tx: Database) {
  console.log(SHORT_NAME, 'beginning')
  tx.assertTransaction()

  const { ref } = tx.db.dynamic
  const excluded = (col: string) => ref(`excluded.${col}`)

  const countAll = sql<number>`count(*)`

  // likeCountQb
  await tx.db
    .insertInto('post_agg')
    .columns(['uri', 'likeCount'])
    .expression((exp) =>
      exp
        .selectFrom('like')
        .groupBy('like.subject')
        .select(['like.subject as uri', countAll.as('likeCount')]),
    )
    .onConflict((oc) =>
      oc
        .column('uri')
        .doUpdateSet({ likeCount: sql`${excluded('likeCount')}` }),
    )
    .execute()

  // replyCountQb
  await tx.db
    .insertInto('post_agg')
    .columns(['uri', 'replyCount'])
    .expression((exp) =>
      exp
        .selectFrom('post')
        .where('replyParent', 'is not', null)
        .groupBy('post.replyParent')
        .select(['post.replyParent as uri', countAll.as('replyCount')]),
    )
    .onConflict((oc) =>
      oc
        .column('uri')
        .doUpdateSet({ replyCount: sql`${excluded('replyCount')}` }),
    )
    .execute()

  // repostCountQb
  await tx.db
    .insertInto('post_agg')
    .columns(['uri', 'repostCount'])
    .expression((exp) =>
      exp
        .selectFrom('repost')
        .groupBy('repost.subject')
        .select(['repost.subject as uri', countAll.as('repostCount')]),
    )
    .onConflict((oc) =>
      oc
        .column('uri')
        .doUpdateSet({ repostCount: sql`${excluded('repostCount')}` }),
    )
    .execute()

  // followersCountQb
  await tx.db
    .insertInto('profile_agg')
    .columns(['did', 'followersCount'])
    .expression((exp) =>
      exp
        .selectFrom('follow')
        .groupBy('follow.subjectDid')
        .select(['follow.subjectDid as did', countAll.as('followersCount')]),
    )
    .onConflict((oc) =>
      oc
        .column('did')
        .doUpdateSet({ followersCount: sql`${excluded('followersCount')}` }),
    )
    .execute()

  // followsCountQb
  await tx.db
    .insertInto('profile_agg')
    .columns(['did', 'followsCount'])
    .expression((exp) =>
      exp
        .selectFrom('follow')
        .groupBy('follow.creator')
        .select(['follow.creator as did', countAll.as('followsCount')]),
    )
    .onConflict((oc) =>
      oc
        .column('did')
        .doUpdateSet({ followsCount: sql`${excluded('followsCount')}` }),
    )
    .execute()

  // postsCountQb
  await tx.db
    .insertInto('profile_agg')
    .columns(['did', 'postsCount'])
    .expression((exp) =>
      exp
        .selectFrom('post')
        .groupBy('post.creator')
        .select(['post.creator as did', countAll.as('postsCount')]),
    )
    .onConflict((oc) =>
      oc
        .column('did')
        .doUpdateSet({ postsCount: sql`${excluded('postsCount')}` }),
    )
    .execute()
}
