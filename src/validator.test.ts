import {Readable, Writable, Stream, PassThrough} from 'stream'
import { expect } from 'chai';

import { ValidatorStream } from './validator'
import {toReadable, collect, wait} from './utils'
import { IContentType } from './model'
import { watchFile } from 'fs';

describe('validator', () => {

  it('passes through a valid entry', async () => {
    const page = makeContentType('page')
    page.fields.push({
      id: 'slug',
      name: 'Slug',
      type: 'Symbol',
      validations: [
        {
          regexp: {
            pattern: '^\/'
          }
        }
      ]
    })

    const instance = new ValidatorStream({ contentTypeGetter: async () => page })

    const entries = [
      {
        sys: { id: 'test1', contentType: { sys: { id: 'page' }} },
        fields: { 
          name: { 'en-US': 'test1' },
          slug: { 'en-US': '/test1' }
        }
      }
    ]

    // act
    const stream = toReadable(entries).pipe(instance)
    const result = await collect(stream)

    // assert
    expect(result.length).to.equal(1)
    expect(result[0].sys.id).to.equal('test1')
  })

  it('rejects an invalid entry', async () => {
    const page = makeContentType('page')
    page.fields.push({
      id: 'slug',
      name: 'Slug',
      type: 'Symbol',
      validations: [
        {
          regexp: {
            pattern: '^\/'
          }
        }
      ]
    })

    const instance = new ValidatorStream({ contentTypeGetter: async () => page })

    const entries = [
      {
        sys: { id: 'test1', contentType: { sys: { id: 'page' }} },
        fields: { 
          name: { 'en-US': 'test1' },
          slug: { 'en-US': '#test1' }
        }
      }
    ]

    // act
    const stream = toReadable(entries).pipe(instance)
    const result = await collect(stream)

    // assert
    expect(result.length).to.equal(0)
  })

  it('raises "invalid" event on validation failure', async () => {
    const page = makeContentType('page')
    page.fields.push({
      id: 'slug',
      name: 'Slug',
      type: 'Symbol',
      validations: [
        {
          regexp: {
            pattern: '^\/'
          }
        }
      ]
    })

    const instance = new ValidatorStream({ contentTypeGetter: async () => page })

    const entries = [
      {
        sys: { id: 'test1', contentType: { sys: { id: 'page' }} },
        fields: { 
          name: { 'en-US': 'test1' },
          slug: { 'en-US': '#test1' }
        }
      }
    ]

    // act
    const stream = toReadable(entries).pipe(instance)

    let errors = []
    instance.on('invalid', (entry, err) => {
      errors.push({ entry, err })
    })

    const result = await collect(stream)

    // assert
    expect(errors.length).to.equal(1)
  })
})

function makeContentType(id: string): IContentType {
  return {
    sys: {
      space: {
        sys: {
          type: 'Link',
          linkType: 'Space',
          id: 'asdf',
        },
      },
      id: id,
      type: 'ContentType',
      createdAt: '',
      updatedAt: '',
      publishedCounter: 1,
      version: 1,
      publishedBy: {
        sys: {
          type: 'Link',
          linkType: 'User',
          id: 'asdf',
        },
      },
      publishedVersion: 1,
      firstPublishedAt: '',
      publishedAt: '',
    },
    displayField: 'name',
    name: id,
    description: '',
    fields: [
      {
        id: 'name',
        name: 'Name',
        type: 'Symbol'
      }
    ]
  }
}