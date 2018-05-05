import * as fs from 'fs-extra'
import * as path from 'path'
import { expect } from 'chai'
import * as nock from 'nock'
import * as request from 'request'
import { CoreOptions, Response } from "request";

import { IEntry } from './model'
import { EntryAggregator, selectFields } from './entry_aggregator'
import {toReadable, collect, DeepPartial} from './utils'

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
          contentType: { sys: { id: 'ct1' } },
          revision: 1
        }
      },
      {
        sys: {
          id: 'test2',
          contentType: { sys: { id: 'ct2' } },
          revision: 2
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
      const entry: IEntry = {
        "sys": {
          "space": {
            "sys": {
              "type": "Link",
              "linkType": "Space",
              "id": "testspace"
            }
          },
          "id": "test1",
          "type": "Entry",
          "createdAt": "2018-04-05T21:37:35.115Z",
          "updatedAt": "2018-05-05T04:37:53.140Z",
          "environment": {
            "sys": {
              "id": "master",
              "type": "Link",
              "linkType": "Environment"
            }
          },
          "revision": 3,
          "contentType": {
            "sys": {
              "type": "Link",
              "linkType": "ContentType",
              "id": "author"
            }
          }
        },
        "fields": {
          "name": {
            "en-US": "KJ"
          },
          "displayName": {
            "en-US": "kj"
          }
        }
      }

      nock('https://test.contentful.com')
        .get('/spaces/testspace/entries/test1?locale=*')
        .reply(200, entry, responseHeaders);

      const instance = new EntryAggregator({
        client: { get: clientGet }
      })

      // act
      const got1 = await instance.getEntryInfo('test1')

      // assert
      expect(got1).to.deep.equal(selectFields(entry))
    })

    it('gets an entry from the management API', async () => {
      const entry: IEntry = {
        "sys": {
          "space": {
            "sys": {
              "type": "Link",
              "linkType": "Space",
              "id": "testspace"
            }
          },
          "id": "test1",
          "type": "Entry",
          "createdAt": "2018-04-05T21:30:49.750Z",
          "updatedAt": "2018-05-05T04:37:53.140Z",
          "environment": {
            "sys": {
              "id": "master",
              "type": "Link",
              "linkType": "Environment"
            }
          },
          "createdBy": {
            "sys": {
              "type": "Link",
              "linkType": "User",
              "id": "0SUbYs2vZlXjVR6bH6o83O"
            }
          },
          "updatedBy": {
            "sys": {
              "type": "Link",
              "linkType": "User",
              "id": "0SUbYs2vZlXjVR6bH6o83O"
            }
          },
          "publishedCounter": 3,
          "version": 6,
          "publishedBy": {
            "sys": {
              "type": "Link",
              "linkType": "User",
              "id": "0SUbYs2vZlXjVR6bH6o83O"
            }
          },
          "publishedVersion": 5,
          "firstPublishedAt": "2018-04-05T21:37:35.115Z",
          "publishedAt": "2018-05-05T04:37:53.140Z",
          "contentType": {
            "sys": {
              "type": "Link",
              "linkType": "ContentType",
              "id": "author"
            }
          }
        },
        "fields": {
          "name": {
            "en-US": "KJ"
          },
          "displayName": {
            "en-US": "kj"
          }
        }
      }

      nock('https://test.contentful.com')
        .get('/spaces/testspace/entries/test1?locale=*')
        .reply(200, entry, responseHeaders);

      const instance = new EntryAggregator({
        client: { get: clientGet }
      })

      // act
      const got1 = await instance.getEntryInfo('test1')

      // assert
      expect(got1).to.deep.equal(selectFields(entry))
    })

    it('returns nil when an entry doesnt exist on the CDN', async () => {
      nock('https://test.contentful.com')
        .get('/spaces/testspace/entries/test1?locale=*')
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

    it('returns nil when entry is not published', async () => {
      const entry: IEntry = {
        "sys": {
          "space": {
            "sys": {
              "type": "Link",
              "linkType": "Space",
              "id": "testspace"
            }
          },
          "id": "test1234",
          "type": "Entry",
          "createdAt": "2018-04-05T21:30:49.750Z",
          "updatedAt": "2018-05-05T04:33:24.051Z",
          "environment": {
            "sys": {
              "id": "master",
              "type": "Link",
              "linkType": "Environment"
            }
          },
          "createdBy": {
            "sys": {
              "type": "Link",
              "linkType": "User",
              "id": "0SUbYs2vZlXjVR6bH6o83O"
            }
          },
          "updatedBy": {
            "sys": {
              "type": "Link",
              "linkType": "User",
              "id": "0SUbYs2vZlXjVR6bH6o83O"
            }
          },
          "publishedCounter": 2,
          "version": 5,
          "firstPublishedAt": "2018-04-05T21:37:35.115Z",
          "contentType": {
            "sys": {
              "type": "Link",
              "linkType": "ContentType",
              "id": "author"
            }
          }
        },
        "fields": {
          "name": {
            "en-US": "Johnny Test"
          },
          "displayName": {
            "en-US": "jtest"
          }
        }
      }

      nock('https://test.contentful.com')
        .get('/spaces/testspace/entries/test1234?locale=*')
        .reply(200, entry, responseHeaders);

      const instance = new EntryAggregator({
        client: { get: clientGet }
      })

      // act
      const got1 = await instance.getEntryInfo('test1234')

      // assert
      expect(got1).to.not.exist
    })

    it('waits until an entry comes across the stream if it doesnt have a client', (done) => {
      const entry = {
        sys: {
          id: 'test1',
          contentType: { sys: { id: 'ct1' } },
          revision: 1,
          publishedVersion: undefined
        }
      }

      const instance = new EntryAggregator({})

      // act
      const promise1 = instance.getEntryInfo('test1')

      let got: DeepPartial<IEntry>
      promise1.then((e) =>
        got = e
      )
      promise1.catch((err) => done(err))
      expect(got).to.not.exist

      instance.write(entry, () => {
        setTimeout(() => {
          expect(got).to.deep.eq(entry)
          done()
        }, 0)
      })
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
    request.get('https://test.contentful.com/spaces/testspace' + uri, options,
      (err, resp) => {
        if (err) {
          reject(err)
        } else {
          resolve(resp)
        }
      })
  })
}