import { Transform } from "stream";
import * as path from 'path';

import { IEntry } from "../model";
import { promisify } from "../utils";
import { deepEqual } from "assert";

export type TransformFunc = (e: IEntry) => IEntry | PromiseLike<IEntry>

export function TransformStream(transform: string | TransformFunc): Transform {
  const transformFunc = load_xform_func(transform)

  return new Transformer(transformFunc)
}

const identityXform: TransformFunc = (e: IEntry) => {
  return e
}

class Transformer extends Transform {
  xformFunc: TransformFunc

  constructor(xform: TransformFunc) {
    super({
      objectMode: true
    })

    this.xformFunc = xform
  }

  async _transform(chunk: IEntry, encoding: string, cb: Function) {
    try {
      const clone = JSON.parse(JSON.stringify(chunk))
      let xformed = await promisify(
        this.xformFunc(clone)
      )

      if (xformed === undefined) { xformed = clone }

      try {
        deepEqual(chunk, xformed)
        cb(null, null)
      } catch {
        // not deep equal - that means we need to write it out.
        // We also need to update it's version to reflect that a change was made
        xformed.sys.version = xformed.sys.version + 1
        xformed.sys.publishedVersion = xformed.sys.version
        xformed.sys.publishedCounter = xformed.sys.publishedCounter + 1

        cb(null, xformed)
      }
    } catch(err) {
      cb(err)
    }
  }
}

function load_xform_func(xform: string | TransformFunc): (entry: IEntry, context?: any) => undefined | IEntry | PromiseLike<IEntry> {
  if (!xform || xform == '') {
    return identityXform;
  }

  if (isFunc(xform)) {
    return xform;
  }

  try {
    return require(path.resolve(xform))
  } catch {
    return (entry, context) => eval_xform(xform, entry, context)
  }
}

function isFunc(filter: string | TransformFunc): filter is TransformFunc {
  return typeof(filter) === 'function'
}

function eval_xform(xform: string, entry: IEntry, context: any): any {
  const fieldNames = Object.keys(entry.fields)

  let xformFunc: Function = null
  const xformSrc = `xformFunc = function (_entry, sys, ${fieldNames.join(', ')}) {
    ${xform}

    ${fieldNames.map((f) => `_entry.fields["${f}"]["en-US"] = ${f}`).join(';\n')}
    return _entry;
  }`
  eval(xformSrc)
  
  const fieldValues = [entry, entry.sys]
  fieldValues.push(...fieldNames.map((f) => entry.fields[f]['en-US']))

  try {
    return xformFunc.apply(entry, fieldValues)
  } catch(e) {
    return undefined;
  }
}