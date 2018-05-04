import {Readable, Writable, Stream, PassThrough} from 'stream'
import { expect } from 'chai';

import { ValidatorStream } from './validator'
import {toReadable, collect} from './utils'
import { IContentType, IValidation } from './model'
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
            pattern: '^\/',
            flags: null
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
    expect(errors[0].entry.sys.id).to.equal('test1')
    expect(errors[0].err[0]).to.equal('slug expected to match /^\// but was #test1')
  })

  it('validates presence of required attributes', async () => {
    const page = makeContentType('page')
    page.fields.push({
      id: 'slug',
      name: 'Slug',
      type: 'Symbol',
      required: true
    })

    const instance = new ValidatorStream({ contentTypeGetter: async () => page })

    const entries = [
      {
        sys: { id: 'test1', contentType: { sys: { id: 'page' }} },
        fields: { 
          name: { 'en-US': 'test1' }
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
    expect(errors[0].entry.sys.id).to.equal('test1')
    expect(errors[0].err[0]).to.equal('missing required field slug')

    expect(result.length).to.equal(0)
  })

  it('validates array fields', async () => {
    const page = makeContentType('page')
    page.fields.push({
      id: 'states',
      name: 'States',
      type: 'Array',
      items: {
        type: 'Number',
        validations: [
          { in: [0, 1, 2] }
        ]
      }
    })

    const instance = new ValidatorStream({ contentTypeGetter: async () => page })

    const entries = [
      {
        sys: { id: 'test1', contentType: { sys: { id: 'page' }} },
        fields: { 
          name: { 'en-US': 'test1' },
          states: { 'en-US': [ 1, 9 ] }
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
    expect(errors[0].entry.sys.id).to.equal('test1')
    expect(errors[0].err[0]).to.equal('states[1] expected to be in [0,1,2] but was 9')

    expect(result.length).to.equal(0)
  })

  describe('validateField', () => {
    let instance: ValidatorStream
    beforeEach(() => {
      instance = new ValidatorStream({ contentTypeGetter: async () => null })
    })

    describe('regexp', () => {
      it('expects field to be a string', async () => {
        const validation: IValidation = {
          regexp: { pattern: '\d+' }
        }
  
        const result = await instance.validateField('test', validation, 1)
  
        expect(result).to.equal('test expected to be a string but was number')
      })
  
      it('expects field to match the pattern', async () => {
        const validation: IValidation = {
          regexp: { pattern: '\\d+' }
        }
  
        const result = await instance.validateField('test', validation, 'asdf')
  
        expect(result).to.equal('test expected to match /\\d+/ but was asdf')
      })
  
      it('succeeds when matching', async () => {
        const validation: IValidation = {
          regexp: { pattern: '[a-z]+', flags: 'i' }
        }
  
        const result = await instance.validateField('test', validation, 'asDf')
  
        expect(result).to.be.null
      })
    })
  
    describe('in', () => {
      it('expects to find value in array', async () => {
        const validation: IValidation = {
          in: [ 'a', 'b', 'c' ]
        }
  
        const result = await instance.validateField('test', validation, 'qwerty')
  
        expect(result).to.equal("test expected to be in [a,b,c] but was qwerty")
      })
  
      it('succeeds when matching', async () => {
        const validation: IValidation = {
          in: [ 'a', 'b', 'qwerty' ]
        }
  
        const result = await instance.validateField('test', validation, 'qwerty')
  
        expect(result).to.be.null
      })
    })
  
    describe('linkContentType', () => {
      it('expects linked values content type to be in')
    })
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