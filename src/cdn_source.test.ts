import * as fs from 'fs-extra'
import * as path from 'path'
import {Readable, Writable, Stream, PassThrough} from 'stream'
import { expect } from 'chai'
import * as nock from 'nock'
import * as sinon from 'sinon'

import {toReadable, collect} from './utils'
import {IEntry} from './model'
import {CdnSource} from './cdn_source'
import { Client } from './client';

const responseHeaders = {
  'content-type': 'application/vnd.contentful.delivery.v1+json'
}

describe('cdn_source', () => {
  let clock: sinon.SinonFakeTimers
  let client: Client

  beforeEach(() => {
    client = new Client({host: 'https://cdn.contentful.com', spaceId: 'testspace', accessToken: 'CFPAT-test'})
    clock = sinon.useFakeTimers()
  })

  afterEach(() => {
    clock.restore()
    clock = undefined
  })


  it('reads a download of 999 entries', async () => {
    const entries = await makeEntries(999);
    nock('https://cdn.contentful.com')
      .get('/spaces/testspace/entries?limit=1000&skip=0&locale=*')
      .reply(200, {
        "sys": { "type": "Array" },
        "skip": 0,
        "limit": 1000,
        "total": 999,
        "items": entries
      },
      responseHeaders);
    
    const instance = new CdnSource({ client }) 

    // act
    const stream = instance.stream()

    // assert
    const results = <IEntry[]> await collect(stream)

    expect(results).to.have.length(999)
  })

  it('pages beyond 1k entries', async () => {
    const page1 = await makeEntries(1000);
    const page2 = await makeEntries(999)
    nock('https://cdn.contentful.com')
      .get('/spaces/testspace/entries?limit=1000&skip=0&locale=*')
      .reply(200, {
        "sys": { "type": "Array" },
        "skip": 0,
        "limit": 1000,
        "total": 1999,
        "items": page1
      },
      responseHeaders);

    nock('https://cdn.contentful.com')
      .get('/spaces/testspace/entries?limit=1000&skip=1000&locale=*')
      .reply(200, {
        "sys": { "type": "Array" },
        "skip": 1000,
        "limit": 1000,
        "total": 1999,
        "items": page2
      },
      responseHeaders);
    
    const instance = new CdnSource({ client }) 

    // act
    const stream = instance.stream()

    // assert
    const results = <IEntry[]> await collect(stream)

    expect(results).to.have.length(1999)
    for(var i = 0; i < 1000; i++) {
      expect(results[i]).to.deep.equal(page1[i])
    }
    for(var i = 1000; i < 1999; i++) {
      expect(results[i]).to.deep.equal(page2[i - 1000])
    }
  })

  it('raises an error on non-success response', async () => {
    const entries = await makeEntries(999);
    nock('https://cdn.contentful.com')
      .get('/spaces/testspace/entries?limit=1000&skip=0&locale=*')
      .reply(401, {
        "sys": {
          "type": "Error",
          "id": "AccessTokenInvalid"
        },
        "message": "The access token you sent could not be found or is invalid.",
        "requestId": "0a588771ad34cfb33fc73a84c7d5de8b"
      },
      responseHeaders);
    
    const instance = new CdnSource({ client }) 

    // act
    const stream = instance.stream()

    // assert
    try {
      await collect(stream)
      expect.fail(null, null, 'did not throw expected error')
    } catch(e) {
      //expected
    }
  })

  it('automatically retries when rate limited', async () => {
    const page1 = await makeEntries(1000);
    const page2 = await makeEntries(999)
    nock('https://cdn.contentful.com')
      .get('/spaces/testspace/entries?limit=1000&skip=0&locale=*')
      .reply(200, {
        "sys": { "type": "Array" },
        "skip": 0,
        "limit": 1000,
        "total": 1999,
        "items": page1
      },
      responseHeaders);
    
    // rate limited
    nock('https://cdn.contentful.com')
      .get('/spaces/testspace/entries?limit=1000&skip=1000&locale=*')
      .reply(429, null, Object.assign({
        'X-Contentful-RateLimit-Reset': 900
      }, responseHeaders))

    nock('https://cdn.contentful.com')
      .get('/spaces/testspace/entries?limit=1000&skip=1000&locale=*')
      .reply(200, {
        "sys": { "type": "Array" },
        "skip": 1000,
        "limit": 1000,
        "total": 1999,
        "items": page2
      },
      responseHeaders);
    
    const instance = new CdnSource({ client }) 

    // act
    const stream = instance.stream()
    const resultsPromise = collect(stream)

    // assert
    let count = 0;
    stream.on('data', () => {
      count++;
    })
    let rateLimitCount = 0;
    client.on('ratelimit', (retrySeconds) => {
      rateLimitCount++;
      expect(count).to.eq(1000)
      expect(retrySeconds).to.eq(900)

      clock.tick(retrySeconds * 1000 + 200)
    })

    const results = <IEntry[]> await resultsPromise

    expect(rateLimitCount).to.eq(1)

    expect(results).to.have.length(1999)
    for(var i = 0; i < 1000; i++) {
      expect(results[i]).to.deep.equal(page1[i])
    }
    for(var i = 1000; i < 1999; i++) {
      expect(results[i]).to.deep.equal(page2[i - 1000])
    }
  })
})

const fixturesDir = path.join(__dirname, '../fixtures')
async function makeEntries(number: number = 1000): Promise<IEntry[]> {
  const fixture = await fs.readFile(path.join(fixturesDir, 'contentful-export-4gyidsb2jx1u-2018-04-05T16-17-74.json'))
  const entries = JSON.parse(fixture.toString()).entries

  const ret = []
  for(var i = 0; i < number; i++) {
    ret.push(entries[Math.floor(Math.random() * entries.length)])
  }
  return ret
}