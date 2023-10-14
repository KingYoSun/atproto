import fs from 'fs/promises'
import { gzipSync } from 'zlib'
import AtpAgent from '@atproto/api'
import { Database } from '../src'
import DiskBlobStore from '../src/storage/disk-blobstore'
import * as uint8arrays from 'uint8arrays'
import { randomBytes } from '@atproto/crypto'
import { BlobRef } from '@atproto/lexicon'
import { ids } from '../src/lexicon/lexicons'
import { TestNetworkNoAppView } from '@atproto/dev-env'

const alice = {
  email: 'alice@test.com',
  handle: 'alice.test',
  did: '',
  password: 'alice-pass',
}
const bob = {
  email: 'bob@test.com',
  handle: 'bob.test',
  did: '',
  password: 'bob-pass',
}

describe('file uploads', () => {
  let network: TestNetworkNoAppView
  let aliceAgent: AtpAgent
  let bobAgent: AtpAgent
  let blobstore: DiskBlobStore
  let db: Database

  beforeAll(async () => {
    network = await TestNetworkNoAppView.create({
      dbPostgresSchema: 'file_uploads',
    })
    blobstore = network.pds.ctx.blobstore as DiskBlobStore
    db = network.pds.ctx.db
    aliceAgent = network.pds.getClient()
    bobAgent = network.pds.getClient()
  })

  afterAll(async () => {
    await network.close()
  })

  it('registers users', async () => {
    const res = await aliceAgent.createAccount({
      email: alice.email,
      handle: alice.handle,
      password: alice.password,
    })
    alice.did = res.data.did
    const res2 = await bobAgent.createAccount({
      email: bob.email,
      handle: bob.handle,
      password: bob.password,
    })
    bob.did = res2.data.did
  })

  let smallBlob: BlobRef
  let smallFile: Uint8Array

  it('handles client abort', async () => {
    const abortController = new AbortController()
    const _putTemp = network.pds.ctx.blobstore.putTemp
    network.pds.ctx.blobstore.putTemp = function (...args) {
      // Abort just as processing blob in packages/pds/src/services/repo/blobs.ts
      process.nextTick(() => abortController.abort())
      return _putTemp.call(this, ...args)
    }
    const response = fetch(
      `${network.pds.url}/xrpc/com.atproto.repo.uploadBlob`,
      {
        method: 'post',
        body: Buffer.alloc(5000000), // Enough bytes to get some chunking going on
        signal: abortController.signal,
        headers: {
          'content-type': 'image/jpeg',
          authorization: `Bearer ${aliceAgent.session?.accessJwt}`,
        },
      },
    )
    await expect(response).rejects.toThrow('operation was aborted')
    // Cleanup
    network.pds.ctx.blobstore.putTemp = _putTemp
    // This test would fail from an uncaught exception: this grace period gives time for that to surface
    await new Promise((res) => setTimeout(res, 10))
  })

  it('uploads files', async () => {
    smallFile = await fs.readFile('tests/sample-img/key-portrait-small.jpg')
    const res = await aliceAgent.api.com.atproto.repo.uploadBlob(smallFile, {
      encoding: 'image/jpeg',
    })
    smallBlob = res.data.blob

    const found = await db.db
      .selectFrom('blob')
      .selectAll()
      .where('cid', '=', smallBlob.ref.toString())
      .executeTakeFirst()

    expect(found?.mimeType).toBe('image/jpeg')
    expect(found?.size).toBe(smallFile.length)
    expect(found?.tempKey).toBeDefined()
    expect(found?.width).toBe(87)
    expect(found?.height).toBe(150)
    expect(await blobstore.hasTemp(found?.tempKey as string)).toBeTruthy()
  })

  it('can reference the file', async () => {
    await updateProfile(aliceAgent, {
      displayName: 'Alice',
      avatar: smallBlob,
    })
  })

  it('after being referenced, the file is moved to permanent storage', async () => {
    const found = await db.db
      .selectFrom('blob')
      .selectAll()
      .where('cid', '=', smallBlob.ref.toString())
      .executeTakeFirst()

    expect(found?.tempKey).toBeNull()
    expect(await blobstore.hasStored(smallBlob.ref)).toBeTruthy()
    const storedBytes = await blobstore.getBytes(smallBlob.ref)
    expect(uint8arrays.equals(smallFile, storedBytes)).toBeTruthy()
  })

  it('can fetch the file after being referenced', async () => {
    const { headers, data } = await aliceAgent.api.com.atproto.sync.getBlob({
      did: alice.did,
      cid: smallBlob.ref.toString(),
    })
    expect(headers['content-type']).toEqual('image/jpeg')
    expect(headers['content-security-policy']).toEqual(
      `default-src 'none'; sandbox`,
    )
    expect(headers['x-content-type-options']).toEqual('nosniff')
    expect(uint8arrays.equals(smallFile, new Uint8Array(data))).toBeTruthy()
  })

  let largeBlob: BlobRef
  let largeFile: Uint8Array

  it('does not allow referencing a file that is outside blob constraints', async () => {
    largeFile = await fs.readFile('tests/sample-img/hd-key.jpg')
    const res = await aliceAgent.api.com.atproto.repo.uploadBlob(largeFile, {
      encoding: 'image/jpeg',
    })
    largeBlob = res.data.blob

    const profilePromise = updateProfile(aliceAgent, {
      avatar: largeBlob,
    })

    await expect(profilePromise).rejects.toThrow()
  })

  it('does not make a blob permanent if referencing failed', async () => {
    const found = await db.db
      .selectFrom('blob')
      .selectAll()
      .where('cid', '=', largeBlob.ref.toString())
      .executeTakeFirst()

    expect(found?.tempKey).toBeDefined()
    expect(await blobstore.hasTemp(found?.tempKey as string)).toBeTruthy()
    expect(await blobstore.hasStored(largeBlob.ref)).toBeFalsy()
  })

  it('permits duplicate uploads of the same file', async () => {
    const file = await fs.readFile('tests/sample-img/key-landscape-small.jpg')
    const { data: uploadA } = await aliceAgent.api.com.atproto.repo.uploadBlob(
      file,
      {
        encoding: 'image/jpeg',
      } as any,
    )
    const { data: uploadB } = await bobAgent.api.com.atproto.repo.uploadBlob(
      file,
      {
        encoding: 'image/jpeg',
      } as any,
    )
    expect(uploadA).toEqual(uploadB)

    await updateProfile(aliceAgent, {
      displayName: 'Alice',
      avatar: uploadA.blob,
    })
    const profileA = await aliceAgent.api.app.bsky.actor.profile.get({
      repo: alice.did,
      rkey: 'self',
    })
    expect((profileA.value as any).avatar.cid).toEqual(uploadA.cid)
    await updateProfile(bobAgent, {
      displayName: 'Bob',
      avatar: uploadB.blob,
    })
    const profileB = await bobAgent.api.app.bsky.actor.profile.get({
      repo: bob.did,
      rkey: 'self',
    })
    expect((profileB.value as any).avatar.cid).toEqual(uploadA.cid)
    const { data: uploadAfterPermanent } =
      await aliceAgent.api.com.atproto.repo.uploadBlob(file, {
        encoding: 'image/jpeg',
      } as any)
    expect(uploadAfterPermanent).toEqual(uploadA)
    const blob = await db.db
      .selectFrom('blob')
      .selectAll()
      .where('cid', '=', uploadAfterPermanent.blob.ref.toString())
      .executeTakeFirstOrThrow()
    expect(blob.tempKey).toEqual(null)
  })

  it('supports compression during upload', async () => {
    const { data: uploaded } = await aliceAgent.api.com.atproto.repo.uploadBlob(
      gzipSync(smallFile),
      {
        encoding: 'image/jpeg',
        headers: {
          'content-encoding': 'gzip',
        },
      } as any,
    )
    expect(uploaded.blob.ref.equals(smallBlob.ref)).toBeTruthy()
  })

  it('corrects a bad mimetype', async () => {
    const file = await fs.readFile('tests/sample-img/key-landscape-large.jpg')
    const res = await aliceAgent.api.com.atproto.repo.uploadBlob(file, {
      encoding: 'video/mp4',
    } as any)

    const found = await db.db
      .selectFrom('blob')
      .selectAll()
      .where('cid', '=', res.data.blob.ref.toString())
      .executeTakeFirst()

    expect(found?.mimeType).toBe('image/jpeg')
    expect(found?.width).toBe(1280)
    expect(found?.height).toBe(742)
  })

  it('handles pngs', async () => {
    const file = await fs.readFile('tests/sample-img/at.png')
    const res = await aliceAgent.api.com.atproto.repo.uploadBlob(file, {
      encoding: 'image/png',
    })

    const found = await db.db
      .selectFrom('blob')
      .selectAll()
      .where('cid', '=', res.data.blob.ref.toString())
      .executeTakeFirst()

    expect(found?.mimeType).toBe('image/png')
    expect(found?.width).toBe(554)
    expect(found?.height).toBe(532)
  })

  it('handles unknown mimetypes', async () => {
    const file = await randomBytes(20000)
    const res = await aliceAgent.api.com.atproto.repo.uploadBlob(file, {
      encoding: 'test/fake',
    } as any)

    const found = await db.db
      .selectFrom('blob')
      .selectAll()
      .where('cid', '=', res.data.blob.ref.toString())
      .executeTakeFirst()

    expect(found?.mimeType).toBe('test/fake')
  })
})

async function updateProfile(agent: AtpAgent, record: Record<string, unknown>) {
  return await agent.api.com.atproto.repo.putRecord({
    repo: agent.session?.did ?? '',
    collection: ids.AppBskyActorProfile,
    rkey: 'self',
    record,
  })
}
