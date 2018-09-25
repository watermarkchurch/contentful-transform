import * as fs from 'fs-extra'
import * as path from 'path'
import {Readable, Writable, Stream, PassThrough} from 'stream'
import { expect } from 'chai'
import * as nock from 'nock'
import * as sinon from 'sinon'

import {IEntry} from './model'
import {Publisher} from './publisher'
import {Client} from './client'

describe('publisher', () => {
  let clock: sinon.SinonFakeTimers
  function useFakeTimers() {
    clock = sinon.useFakeTimers()
  }
  
  let client: Client

  beforeEach(() => {
    client = new Client({host: 'https://api.contentful.com', spaceId: 'testspace', accessToken: 'CFPAT-test'})
  })

  afterEach(() => {
    if (clock) {
      clock.restore()
      clock = undefined
    }
  })

  const responseHeaders = {
    'content-type': 'application/vnd.contentful.delivery.v1+json'
  }

  it('publishes entries written to stream', async () => {
    const entries = await makeEntries(10)
    const scopes = entries.map((e) => {
      return [
        nock(`https://api.contentful.com`)
          .put(`/spaces/testspace/entries/${e.sys.id}`,
          (body: IEntry) => {
            return body.fields
          },
          {
            reqheaders: {
              'content-type': 'application/vnd.contentful.management.v1+json',
              'x-contentful-content-type': e.sys.contentType.sys.id,
              'x-contentful-version': e.sys.version.toString(),
              host: 'api.contentful.com',
              authorization: 'bearer CFPAT-test'
            }
          })
          .reply(200, e, responseHeaders),
        nock(`https://api.contentful.com`)
          .put(`/spaces/testspace/entries/${e.sys.id}/published`,
          '',
          {
            reqheaders: {              
              'x-contentful-version': (e.sys.version + 1).toString(),
              host: 'api.contentful.com',
              authorization: 'bearer CFPAT-test',
              'content-length': '0'
            }
          })
          .reply(200, e, responseHeaders),
      ]
    })
    const instance = new Publisher({ client })
    const readable = createReader(entries)

    let published = 0
    instance.on('data', (chunk) => {
      published++
    })

    // act
    await awaitDone(readable.pipe(instance))

    // assert
    scopes.flatMap(a => a).forEach(s => {
      if(!s.isDone()) {
        throw new Error(s.pendingMocks().join(','))
      }
    })
    expect(published).to.eq(10)
  })

  it('raises error event when entry publish fails', async () => {
    const entry = (await makeEntries(1))[0]
    const s = nock(`https://api.contentful.com`)
      .put(`/spaces/testspace/entries/${entry.sys.id}`,
      (body: IEntry) => true,
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

    const instance = new Publisher({ client })
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

  it('retries on 429 too many requests', async () => {
    const entries = await makeEntries(10)
    entries.forEach(e => e.sys.publishedVersion = undefined)
    const scopes = entries.map((e) => {
      nock('https://api.contentful.com')
        .put(`/spaces/testspace/entries/${e.sys.id}`)
        .reply(429, null, Object.assign({
          'X-Contentful-RateLimit-Reset': 0.1
        }, responseHeaders))
        
      return nock(`https://api.contentful.com`)
        .put(`/spaces/testspace/entries/${e.sys.id}`,
        (body: IEntry) => true,
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
    const instance = new Publisher({ client })
    const readable = createReader(entries)

    let rateLimitCount = 0;
    client.on('ratelimit', (retrySeconds) => {
      rateLimitCount++;
      expect(retrySeconds).to.eq(0.1)
    })

    // act
    await awaitDone(readable.pipe(instance))

    // assert
    scopes.forEach(s => {
      if(!s.isDone()) {
        throw new Error(s.pendingMocks().join(','))
      }
    })
    expect(rateLimitCount).to.equal(entries.length)
  })

  it('uploads but does not publish entry that was in a draft state', async () => {
    const entries = await makeEntries(2)
      // a never-published entry
    entries[0].sys.publishedVersion = undefined
      // an updated entry
    entries[1].sys.version = entries[1].sys.publishedVersion + 2
    const scopes = entries.map((e) => {
      return [
        nock(`https://api.contentful.com`)
          .put(`/spaces/testspace/entries/${e.sys.id}`,
          (body: IEntry) => true,
          {
            reqheaders: {
              'content-type': 'application/vnd.contentful.management.v1+json',
              'x-contentful-content-type': e.sys.contentType.sys.id,
              'x-contentful-version': e.sys.version.toString(),
              host: 'api.contentful.com',
              authorization: 'bearer CFPAT-test'
            }
          })
          .reply(200, e, responseHeaders)
      ]
    })
    const instance = new Publisher({ client })
    const readable = createReader(entries)

    let published = 0
    instance.on('data', (chunk) => {
      published++
    })

    // act
    await awaitDone(readable.pipe(instance))

    // assert
    scopes.flatMap(a => a).forEach(s => {
      if(!s.isDone()) {
        throw new Error(s.pendingMocks().join(','))
      }
    })
    expect(published).to.eq(2)
  })
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