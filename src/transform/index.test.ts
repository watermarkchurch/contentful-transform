import {Readable, Writable, Stream, PassThrough} from 'stream'
import { expect } from 'chai';

import { TransformStream } from './index'
import {toReadable, collect} from '../utils'

describe('transform', () => {
  describe('with func', () => {
    it('uses func directly', async () => {
      const func = (entry) => { 
        entry.fields.test['en-US'] = 'blah';
        return Promise.resolve(entry)
      }

      const instance = TransformStream(func)

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

      const instance = TransformStream(func)

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

      const instance = TransformStream(func)

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

      const instance = TransformStream(func)

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

  it('only outputs changed entries', async () => {

    const func = (entry) => { 
      entry.fields.test['en-US'] = 'blah';
      return Promise.resolve(entry)
    }

    const instance = TransformStream(func)

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

    const instance = TransformStream(func)

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