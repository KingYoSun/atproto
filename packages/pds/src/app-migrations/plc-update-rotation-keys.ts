import { Keypair } from '@atproto/crypto'
import * as plc from '@did-plc/lib'
import Database from '../db'
import { appMigration } from '../db/leader'

export const plcRotationKeysMigration = async (
  db: Database,
  opts: {
    plcUrl: string
    oldSigningKey: Keypair
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
    oldSigningKey: Keypair
    plcRotationKey: Keypair
    repoSigningKey: Keypair
    recoveryKey: string
  },
) => {
  const plcClient = new plc.Client(opts.plcUrl)
  const { oldSigningKey, plcRotationKey, repoSigningKey, recoveryKey } = opts
  const res = await db.db.selectFrom('did_handle').select('did').execute()
  const dids = res.map((row) => row.did)
  let failed = 0
  let success = 0
  console.log(`All ${dids.length} users rotation keys will change`)
  for (const did of dids) {
    try {
      await plcClient.updateData(did, oldSigningKey, (lastOp) => ({
        ...lastOp,
        rotationKeys: [recoveryKey, plcRotationKey.did()],
        verificationMethods: {
          atproto: repoSigningKey.did(),
        },
      }))
      success++
      console.log(`success: ${success}`)
    } catch {
      failed++
      console.log(`failed: ${failed}`)
    }
  }
  console.log(`all: ${dids.length}, failed: ${failed}, success: ${success}`)
}
