import { Transform } from "stream"
import * as path from 'path'

import { IEntry } from "./model"

export type FilterFunc = (entry: IEntry, context?: any) => boolean

export function FilterStream(filter: string | FilterFunc) {

  const filterFunc = load_filter_func(filter)

  return new Transform({
    objectMode: true,
    transform: (chunk, encoding, callback) => {
      const entry = (chunk as any) as IEntry

      if (filterFunc(entry)) {
        callback(null, entry)
      } else {
        callback()
      }
    }
  })
}

function load_filter_func(filter: string | FilterFunc): FilterFunc  {
  if (isFunc(filter)) {
    return filter
  }

  try {
    return require(path.resolve(filter))
  } catch {
    return (entry, context) => eval_filter(filter, entry, context)
  }
}

function isFunc(filter: string | FilterFunc): filter is FilterFunc {
  return typeof(filter) === 'function'
}

function eval_filter(filter: string, entry: IEntry, context: any): any {
  const fieldNames = Object.keys(entry.fields)

  let filterFunc: Function = null
  eval( `filterFunc = function (sys, ${fieldNames.join(', ')}) {
    return ${filter};
  }`)
  
  const fieldValues = [entry.sys]
  fieldValues.push(...fieldNames.map((f) => entry.fields[f]['en-US']))

  try {
    return filterFunc.apply(entry, fieldValues)
  } catch {
    return false;
  }
}