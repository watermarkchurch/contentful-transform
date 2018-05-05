import * as fs from 'fs-extra'
import * as path from 'path'
import { expect } from 'chai'
import * as nock from 'nock'
import * as request from 'request'
import { CoreOptions, Response } from "request";

import { IEntry } from './model'
import { EntryAggregator } from './entry_aggregator'
import {toReadable, collect} from './utils'

const responseHeaders = {
  'content-type': 'application/vnd.contentful.delivery.v1+json'
}

describe('EntryAggregator', () => {
  it('passes entries through and stores them', async () => {
    const entries = await makeEntries(10)

    const instance = new EntryAggregator({})

    // act
    const stream = toReadable(entries).pipe(instance)
    const result = await collect(stream)

    // assert
    expect(result.length).to.equal(10)
    entries.forEach(e => {
      expect(instance.entryMap[e.sys.id]).to.exist
    })
  })

  it('stores content type data for entries', async () => {
    const entries = await makeEntries(4)

    const instance = new EntryAggregator({})

    // act
    const stream = toReadable(entries).pipe(instance)
    const result = await collect(stream)

    // assert
    entries.forEach(e => {
      const stored = instance.entryMap[e.sys.id]
      expect(stored.sys.contentType.sys.id)
        .to.equal(e.sys.contentType.sys.id)
    })
  })

  describe('getEntryInfo', () => {
    it('fetches entry info out of the entry map', async () => {
      const entries = [{
        sys: {
          id: 'test1',
          contentType: { sys: { id: 'ct1' } }
        }
      },
      {
        sys: {
          id: 'test2',
          contentType: { sys: { id: 'ct2' } }
        }
      }]

      const instance = new EntryAggregator({})
      entries.forEach(e => instance.entryMap[e.sys.id] = e)

      // act
      const got1 = await instance.getEntryInfo('test1')
      const got2 = await instance.getEntryInfo('test2')

      // assert
      expect(got1).to.equal(entries[0])
      expect(got2).to.equal(entries[1])
    })

    it('gets an entry from the CDN if it doesnt already have it', async () => {
      const entry = {
        sys: {
          id: 'test1',
          contentType: { sys: { id: 'ct1' } }
        }
      }

      nock('https://cdn.contentful.com')
        .get('/spaces/testspace/entries/test1')
        .reply(200, entry, responseHeaders);

      const instance = new EntryAggregator({
        client: { get: clientGet }
      })

      // act
      const got1 = await instance.getEntryInfo('test1')

      // assert
      expect(got1).to.deep.equal(entry)
    })

    it('returns nil when an entry doesnt exist on the CDN', async () => {
      const entry = {
        sys: {
          id: 'test1',
          contentType: { sys: { id: 'ct1' } }
        }
      }

      nock('https://cdn.contentful.com')
        .get('/spaces/testspace/entries/test1')
        .reply(404, {
          "sys": {
            "type": "Error",
            "id": "NotFound"
          },
          "message": "The resource could not be found.",
          "details": {
            "id": "notfound",
            "type": "Entry",
            "space": "testspace",
            "environment": "master"
          },
          "requestId": "f077742bb3623ec5cccc8b11f38e2d7c"
        }, responseHeaders);

      const instance = new EntryAggregator({
        client: { get: clientGet }
      })

      // act
      const got1 = await instance.getEntryInfo('test1')

      // assert
      expect(got1).to.not.exist
    })
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

function clientGet(uri: string, options?: CoreOptions): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    request.get('https://cdn.contentful.com/spaces/testspace' + uri, options,
      (err, resp) => {
        if (err) {
          reject(err)
        } else {
          resolve(resp)
        }
      })
  })
}