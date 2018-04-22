import * as fs from 'fs-extra'
import * as path from 'path'
import {Readable, Writable, Stream, PassThrough} from 'stream'
import { expect } from 'chai'
import * as nock from 'nock'
import * as sinon from 'sinon'

import {toReadable, collect} from './utils'
import {IEntry} from './model'
import {Publisher} from './publisher'

const responseHeaders = {
  'content-type': 'application/vnd.contentful.delivery.v1+json'
}

describe('publisher', () => {
  let clock: sinon.SinonFakeTimers
  beforeEach(() => {
    clock = sinon.useFakeTimers()
  })

  afterEach(() => {
    clock.restore()
    clock = undefined
  })

  const responseHeaders = {
    'content-type': 'application/vnd.contentful.delivery.v1+json'
  }

  it('publishes entries written to stream', async () => {
    const entries = await makeEntries(10)
    const scopes = entries.map((e) => {
      return nock(`https://api.contentful.com`)
        .put(`/spaces/testspace/entries/${e.sys.id}`,
        (body: IEntry) => {
          return true
        },
        {
          reqheaders: {
            'content-type': 'application/vnd.contentful.management.v1+json',
            'x-contentful-content-type': e.sys.contentType.sys.id,
            'x-contentful-version': e.sys.version.toString(),
            host: 'api.contentful.com',
            authorization: 'bearer test'
          }
        })
        .reply(200, e, responseHeaders)
    })
    const instance = new Publisher({spaceId: 'testspace', accessToken: 'test'})
    const readable = createReader(entries)

    // act
    await awaitDone(readable.pipe(instance))

    // assert
    scopes.forEach(s => {
      if(!s.isDone()) {
        throw new Error(s.pendingMocks().join(','))
      }
    })
  })

  it('raises error event when entry publish fails', async () => {
    const entry = (await makeEntries(1))[0]
    const s = nock(`https://api.contentful.com`)
      .put(`/spaces/testspace/entries/${entry.sys.id}`,
      (body: IEntry) => {
        return true
      },
      {
        reqheaders: {
          'content-type': 'application/vnd.contentful.management.v1+json',
          'x-contentful-content-type': entry.sys.contentType.sys.id,
          'x-contentful-version': entry.sys.version.toString(),
          host: 'api.contentful.com',
          authorization: 'bearer test'
        }
      })
      .reply(409, 'The version is wrong', responseHeaders)

    const instance = new Publisher({spaceId: 'testspace', accessToken: 'test'})
    const p = awaitDone(instance)

    // act
    instance.write(entry)

    // assert
    try {
      await p
      expect.fail(null, null, 'Should have thrown the error')
    } catch(e) {
    }

    if (!s.isDone()) {
      throw new Error(s.pendingMocks().join(','))
    }
  })

  it('retries on 429 too many requests')
})

const fixturesDir = path.join(__dirname, '../fixtures')
async function makeEntries(number: number = 1000): Promise<IEntry[]> {
  const fixture = await fs.readFile(path.join(fixturesDir, 'contentful-export-4gyidsb2jx1u-2018-04-05T16-17-74.json'))
  const entries = JSON.parse(fixture.toString()).entries

  const ret = []
  for(var i = 0; i < number; i++) {
    ret.push(entries[i % entries.length])
  }
  return ret
}

function createReader(entries: IEntry[]): NodeJS.ReadableStream {
  let i = 0;
  return new Readable({
    objectMode: true,
    read(size) {
      while(this.push(entries[i] || null)){
        i++
      }
    }
  })
}

function awaitDone(stream: NodeJS.WritableStream): Promise<void>{
  return new Promise<void>((resolve, reject) => {
    stream.on('error', (err) => reject(err))
    stream.on('finish', () => resolve())
  })
}