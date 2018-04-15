import * as fs from 'fs-extra'
import * as path from 'path'
import {Readable, Writable, Stream, PassThrough} from 'stream'
import { expect } from 'chai'
import * as nock from 'nock'

import {toReadable, collect} from './utils'
import {IEntry} from './model'
import {CdnSource} from './cdn_source'

const responseHeaders = {
  'content-type': 'application/vnd.contentful.delivery.v1+json'
}

describe('cdn_source', () => {
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
    
    const instance = new CdnSource({spaceId: 'testspace', accessToken: 'test'}) 

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
    
    const instance = new CdnSource({spaceId: 'testspace', accessToken: 'test'}) 

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
    
    const instance = new CdnSource({spaceId: 'testspace', accessToken: 'test'}) 

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

  it('automatically retries when rate limited')
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