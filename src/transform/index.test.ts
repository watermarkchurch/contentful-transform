import {Readable, Writable, Stream, PassThrough} from 'stream'
import { expect } from 'chai';

import { TransformStream } from './index'
import {toReadable, collect} from '../utils'
import { IContentType } from '../model';

describe('transform', () => {
  describe('with func', () => {
    it('uses func directly', async () => {
      const func = (entry) => { 
        entry.fields.test['en-US'] = 'blah';
        return Promise.resolve(entry)
      }

      const instance = new TransformStream(func)

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
      expect(result.length).to.equal(2)
      result.forEach(e => {
        expect(e.fields.test['en-US']).to.equal('blah')
      })
    })
  })

  describe('with module', () => {
    it('requires module', async () => {
      const func = './fixtures/transform_test'

      const instance = new TransformStream(func)

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
      const func = 'test = test.replace(/\\d/, "X")'

      const instance = new TransformStream(func)

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
          fields: { test: { 'en-US': 'foo22' } }
        }
      ]

      // act
      const stream = toReadable(entries).pipe(instance)
      const result = await collect(stream)

      // assert
      expect(result.length).to.equal(1)
      expect(result[0].sys.id).to.equal('test3')
      expect(result[0].fields.test['en-US']).to.equal('fooX2')
    })

    it('handles missing fields in expression', async () => {
      const func = 'bar = 1'

      const instance = new TransformStream(func)

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
      expect(result[0].fields.bar['en-US']).to.equal(1)
    })
  })


  it('uses content type to populate missing fields if available', async () => {
    const func = 'baz = "blah"';

    const contentType = {
      sys: { id: 'test' },
      fields: [
        { id: 'test', type: 'Symbol' },
        { id: 'bar', type: 'Number' },
        { id: 'baz', type: 'Text' },
      ]
    }

    const instance = new TransformStream(func, async (id) => id == 'test' && <IContentType>contentType)

    const entries = [
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
    expect(result[0].fields.baz['en-US']).to.equal('blah')
  })

  it('only outputs changed entries', async () => {

    const func = (entry) => { 
      entry.fields.test['en-US'] = 'blah';
      return Promise.resolve(entry)
    }

    const instance = new TransformStream(func)

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
    expect(result.length).to.equal(2)
    expect(result[0].sys.id).to.equal('test2')
    expect(result[1].sys.id).to.equal('test3')
  })

  it('modifies published counter for changed entries', async () => {

    const func = (entry) => { 
      entry.fields.test['en-US'] = 'blah';
      return Promise.resolve(entry)
    }

    const instance = new TransformStream(func)

    const entries = [
      {
        sys: { 
          id: 'test1',
          version: 1,
          publishedVersion: 1,
          publishedCounter: 1
        },
        fields: { test: { 'en-US': 'blah' } }
      },
      {
        sys: { 
          id: 'test2',
          version: 1,
          publishedVersion: 1,
          publishedCounter: 1
        },
        fields: { test: { 'en-US': 'foo' } }
      },
      {
        sys: {
          id: 'test3',
          version: 3,
          publishedVersion: 2,
          publishedCounter: 2
        },
        fields: { test: { 'en-US': 'bar' } }
      }
    ]

    // act
    const stream = toReadable(entries).pipe(instance)
    const result = await collect(stream)

    // assert
    expect(result.length).to.equal(2)
    expect(result[0].sys.version).to.equal(2)
    expect(result[0].sys.publishedVersion).to.equal(2)
    expect(result[0].sys.publishedCounter).to.equal(2)

    expect(result[1].sys.version).to.equal(4)
    expect(result[1].sys.publishedVersion).to.equal(4)
    expect(result[1].sys.publishedCounter).to.equal(3)
  })
})