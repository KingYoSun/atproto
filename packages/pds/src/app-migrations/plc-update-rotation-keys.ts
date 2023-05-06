import { Keypair } from '@atproto/crypto'
import * as plc from '@did-plc/lib'
import Database from '../db'
import { appMigration } from '../db/leader'

export const plcRotationKeysMigration = async (
  db: Database,
  opts: {
    plcUrl: string
    plcRotationKey: Keypair
    repoSigningKey: Keypair
    recoveryKey: string
  },
) => {
  await appMigration(
    db,
    `${new Date().toISOString()}-plc-update-rotation-keys`,
    async (dbTxn) => {
      await doMigration(dbTxn, opts)
    },
  )
}

export const doMigration = async (
  db: Database,
  opts: {
    plcUrl: string
    plcRotationKey: Keypair
    repoSigningKey: Keypair
    recoveryKey: string
  },
) => {
  const plcClient = new plc.Client(opts.plcUrl)
  const { plcRotationKey, repoSigningKey, recoveryKey } = opts
  const res = await db.db.selectFrom('did_handle').select('did').execute()
  const dids = res.map((row) => row.did)
  for (const did of dids) {
    await plcClient.updateData(did, repoSigningKey, (lastOp) => ({
      ...lastOp,
      rotationsKeys: [recoveryKey, plcRotationKey.did()],
      verificationMethods: {
        atproto: repoSigningKey.did(),
      },
    }))
  }
}
