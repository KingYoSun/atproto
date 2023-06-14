import stream from 'stream'
import { AtUri } from '@atproto/uri'
import { cidForRecord } from '@atproto/repo'
import { dedupe, getFieldsFromRecord } from './util'
import { labelerLogger as log } from '../logger'
import { resolveBlob } from '../api/blob-resolver'
import Database from '../db'
import { IdResolver } from '@atproto/identity'
import { ServerConfig } from '../config'
import { BackgroundQueue } from '../background'

export abstract class Labeler {
  public backgroundQueue: BackgroundQueue
  constructor(
    protected ctx: {
      db: Database
      idResolver: IdResolver
      cfg: ServerConfig
      backgroundQueue: BackgroundQueue
    },
  ) {
    this.backgroundQueue = ctx.backgroundQueue
  }

  processRecord(uri: AtUri, obj: unknown) {
    this.backgroundQueue.add(() =>
      this.createAndStoreLabels(uri, obj).catch((err) => {
        log.error(
          { err, uri: uri.toString(), record: obj },
          'failed to label record',
        )
      }),
    )
  }

  async createAndStoreLabels(uri: AtUri, obj: unknown): Promise<void> {
    const labels = await this.labelRecord(uri, obj)
    if (labels.length < 1) return
    const cid = await cidForRecord(obj)
    const rows = labels.map((val) => ({
      src: this.ctx.cfg.labelerDid,
      uri: uri.toString(),
      cid: cid.toString(),
      val,
      neg: false,
      cts: new Date().toISOString(),
    }))

    await this.ctx.db.db
      .insertInto('label')
      .values(rows)
      .onConflict((oc) => oc.doNothing())
      .execute()
  }

  async labelRecord(uri: AtUri, obj: unknown): Promise<string[]> {
    const { text, imgs } = getFieldsFromRecord(obj)
    const txtLabels = await this.labelText(text.join(' '))
    const imgLabels = await Promise.all(
      imgs.map(async (cid) => {
        const { stream } = await resolveBlob(uri.host, cid, this.ctx)
        return this.labelImg(stream)
      }),
    )
    return dedupe([...txtLabels, ...imgLabels.flat()])
  }

  abstract labelText(text: string): Promise<string[]>
  abstract labelImg(img: stream.Readable): Promise<string[]>

  async processAll() {
    await this.backgroundQueue.processAll()
  }
}
