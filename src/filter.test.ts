import {Readable, Writable, Stream, PassThrough} from 'stream'
import { expect } from 'chai';

import { FilterStream } from './filter'

describe('filter', () => {
  describe('with func', () => {
    it('uses func directly', async () => {
      const func = (entry) => entry.fields.test['en-US'] == 'blah'

      const instance = FilterStream(func)

      const entries = [
        {
          sys: { id: 'test1' },
          fields: { test: { 'en-US': 'blah' } }
        },
        {
          sys: { id: 'test2' },
          fields: { test: { 'en-US': 'foo' } }
        },
        {
          sys: { id: 'test3' },
          fields: { test: { 'en-US': 'bar' } }
        }
      ]

      // act
      const stream = toReadable(entries).pipe(instance)
      const result = await collect(stream)

      // assert
      expect(result.length).to.equal(1)
      expect(result[0].sys.id).to.equal('test1')
    })
  })

  describe('with module', () => {
    it('requires module', async () => {
      const func = './fixtures/filter_test'

      const instance = FilterStream(func)

      const entries = [
        {
          sys: { id: 'test1', contentType: { sys: { id: 'submenu' }} },
          fields: { test: { 'en-US': 'foo' } }
        },
        {
          sys: { id: 'test2', contentType: { sys: { id: 'test' }} },
          fields: { test: { 'en-US': 'blah' } }
        },
        {
          sys: { id: 'test3', contentType: { sys: { id: 'submenu' }} },
          fields: { test: { 'en-US': 'bar' } }
        }
      ]

      // act
      const stream = toReadable(entries).pipe(instance)
      const result = await collect(stream)

      // assert
      expect(result.length).to.equal(2)
      expect(result[0].sys.id).to.equal('test1')
      expect(result[1].sys.id).to.equal('test3')
    })
  })

  describe('with inline expression', () => {
    it('evals expression', async () => {
      const func = '/^foo/.exec(test)'

      const instance = FilterStream(func)

      const entries = [
        {
          sys: { id: 'test1', contentType: { sys: { id: 'submenu' }} },
          fields: { test: { 'en-US': 'foo' } }
        },
        {
          sys: { id: 'test2', contentType: { sys: { id: 'test' }} },
          fields: { test: { 'en-US': 'blah' } }
        },
        {
          sys: { id: 'test3', contentType: { sys: { id: 'submenu' }} },
          fields: { test: { 'en-US': 'foo2' } }
        }
      ]

      // act
      const stream = toReadable(entries).pipe(instance)
      const result = await collect(stream)

      // assert
      expect(result.length).to.equal(2)
      expect(result[0].sys.id).to.equal('test1')
      expect(result[1].sys.id).to.equal('test3')
    })

    it('handles missing fields in expression', async () => {
      const func = 'bar'

      const instance = FilterStream(func)

      const entries = [
        {
          sys: { id: 'test1', contentType: { sys: { id: 'submenu' }} },
          fields: { test: { 'en-US': 'foo' } }
        },
        {
          sys: { id: 'test2', contentType: { sys: { id: 'test' }} },
          fields: { 
            test: { 'en-US': 'blah' },
            bar: { 'en-US': 'asdf' }
          }
        },
        {
          sys: { id: 'test3', contentType: { sys: { id: 'submenu' }} },
          fields: { test: { 'en-US': 'foo2' } }
        }
      ]

      // act
      const stream = toReadable(entries).pipe(instance)
      const result = await collect(stream)

      // assert
      expect(result.length).to.equal(1)
      expect(result[0].sys.id).to.equal('test2')
    })
  })
})

function toReadable(entries: any[]): Readable {
  let index = 0;
  return new Readable({
    objectMode: true,
    read: function(size) {
      if(index >= entries.length) {
        // eof
        this.push(null)
      }
      while(index < entries.length){
        if (!this.push(entries[index++])) {
          break
        }
      }
    }
  })
}

function collect(stream: Stream): Promise<any[]> {
  const result = []

  return new Promise((resolve, reject) => {
    stream.pipe(new Writable({
      objectMode: true,
      write: (chunk, encoding, callback) => {
        console.log('collecting entry', chunk.sys.id)
        result.push(chunk)
        callback()
      }
    }))
      .on('error', (err) => {
        reject(err)
      })
      .on('finish', () => {
        resolve(result)
      })
  })
}