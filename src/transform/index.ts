import { Transform } from "stream";
import * as path from 'path';

import { IEntry, IContentType } from "../model";
import { promisify } from "../utils";
import { deepEqual } from "assert";

export type TransformFunc = (entry: IEntry, contentType?: IContentType) => IEntry | PromiseLike<IEntry>

const identityXform: TransformFunc = (e: IEntry) => {
  return e
}

export class TransformStream extends Transform {
  xformFunc: TransformFunc
  contentTypeGetter: (id: string) => Promise<IContentType>
  verbose: boolean

  constructor(xform: string | TransformFunc, contentTypeGetter?: (id: string) => Promise<IContentType>, verbose?: boolean) {
    super({
      objectMode: true
    })

    this.xformFunc = this.load_xform_func(xform)
    this.contentTypeGetter = contentTypeGetter || (id => Promise.resolve(null))
    this.verbose = verbose
  }

  async _transform(chunk: IEntry, encoding: string, cb: (err: any, entry?: IEntry) => void) {
    try {
      const contentType = chunk.sys.contentType && await this.contentTypeGetter(chunk.sys.contentType.sys.id)

      const clone = JSON.parse(JSON.stringify(chunk))
      let xformed = await promisify(
        this.xformFunc(clone, contentType)
      )

      if (xformed === undefined) { xformed = clone }

      try {
        deepEqual(chunk, xformed)
        cb(null, null)
      } catch {
        // not deep equal - that means we need to write it out.
        cb(null, xformed)
      }
    } catch(err) {
      cb(err)
    }
  }

  private load_xform_func(xform: string | TransformFunc): TransformFunc {
    if (!xform || xform == '') {
      return identityXform;
    }
  
    if (isFunc(xform)) {
      return xform;
    }
  
    try {
      return require(path.resolve(xform))
    } catch {
      return (entry, contentType) => this.eval_xform(xform, entry, contentType)
    }
  }
  
  private eval_xform(xform: string, entry: IEntry, contentType: IContentType): IEntry {
    let fieldNames
    if (contentType) {
      fieldNames = contentType.fields.map(f => f.id)
    } else {
      fieldNames = Object.keys(entry.fields)
    }
    
    let xformFunc: Function = null
    const xformSrc = `xformFunc = function (_entry, sys, ${fieldNames.join(', ')}) {
      ${xform}
  
      ${fieldNames.map((f) => `
      if (${f} !== undefined) {
        _entry.fields["${f}"] = Object.assign(_entry.fields["${f}"] || {}, {
          ["en-US"]: ${f}
        })
      } else {
        delete(_entry.fields["${f}"]["en-US"]);
      }
  `)
        .join('\n')
      }
      return _entry;
    }`
    try {
      eval(xformSrc)
    } catch(e) {
      console.error(xformSrc)
      console.error(e)
      throw e
    }
    
    const fieldValues = [entry, entry.sys]
    fieldValues.push(...fieldNames.map((f) => entry.fields[f] ? entry.fields[f]['en-US'] : null))
  
    try {
      return xformFunc.apply(entry, fieldValues)
    } catch(e) {
      if (this.verbose) {
        console.error(e.message)
      }
      return undefined;
    }
  }
}



function isFunc(filter: string | TransformFunc): filter is TransformFunc {
  return typeof(filter) === 'function'
}
