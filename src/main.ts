import * as Listr from 'listr'
import {ListrTask} from 'listr'
import * as fs from 'fs-extra'
import * as path from 'path'
import * as JSONStream from 'JSONStream'
import { Transform, Stream } from 'stream';
import { deepEqual } from 'assert';

export interface ITransformArgs {
  source: string
  filter?: string
  transform: string
  output?: string
  quiet?: boolean
}

export default async function Run(args: ITransformArgs): Promise<void> {
  const tasks: Array<ListrTask> = []

  const context = {
    stream: null as fs.ReadStream | NodeJS.ReadableStream,
    output: null as fs.WriteStream | NodeJS.WritableStream
  }

  if (args.source == '-') {
    context.stream = process.stdin
  } else {
    try {
      await fs.access(args.source, fs.constants.R_OK)
      context.stream = fs.createReadStream(args.source)
    } catch (err) {
      console.log('not a file:', args.source)
    }
  }

  // todo: download from space

  tasks.push({
    title: 'parse stream',
    task: pipeIt(() => JSONStream.parse('entries.*'))
  })

  if (args.filter) {
    const filterFunc = load_filter_func(args.filter)

    tasks.push({
      title: 'filter stream',
      task: pipeIt(() => new Transform({
        objectMode: true,
        transform: (chunk, encoding, callback) => {
          const entry = (chunk as any) as IEntry

          if (filterFunc(entry)) {
            callback(null, entry)
          } else {
            callback(null, null)
          }
        }
      }))
    })
  }

  const transformFunc = load_xform_func(args.transform)

  tasks.push({
    title: 'transform stream',
    task: pipeIt(() => new Transformer(transformFunc))
  })

  if (args.output && args.output != '-') {
    context.output = fs.createWriteStream(args.output)
  } else {
    context.output = process.stdout
    // listr logs to stdout
    args.quiet = true
  }

  tasks.push({
    title: 'write output',
    task: (ctx, task) => {
      const stringified = JSONStream.stringify('{\n  "entries": [\n    ', ',\n    ', '\n  ]\n}\n')
      const ret = new Promise<void>((resolve, reject) => {
        const stream = context.output as Stream;

        stream.on('end', () => {
          resolve()
        })
        stream.on('error', (err) => {
          console.error('stream error!', err)
          reject(new Error(err))
        })
      })
      ctx.stream.pipe(stringified).pipe(context.output)
    }
  })

  return new Listr(tasks, 
    {
      concurrent: true,
      renderer: args.quiet ? 'silent' : 'default'
    })
    .run(context)
}

export type TransformFunc = (e: IEntry) => IEntry | PromiseLike<IEntry>

const identityXform: TransformFunc = (e: IEntry) => {
  return new Promise<IEntry>((resolve, reject) => {
    setTimeout(() => resolve(e), 10)
  })
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

export interface IEntry { 
  sys: { 
    space: { sys: any },
    id: string,
    type: 'Entry',
    createdAt: string,
    updatedAt: string,
    createdBy: { sys: any },
    updatedBy: { sys: any },
    publishedCounter: number,
    version: number,
    publishedBy: { sys: any },
    publishedVersion: number,
    firstPublishedAt: string,
    publishedAt: string,
    contentType: { sys: any } 
 },
 fields: {
  [name: string]: {
    [locale: string]: any
  }
 }
}

function pipeIt(taskImpl: (ctx?: any, task?: Listr.ListrTaskWrapper) => Stream):
    (ctx: any, task: Listr.ListrTaskWrapper) => Promise<void> {

  return (ctx, task) => {
    const stream = taskImpl(ctx)

    let entryCount = 0
    stream.on('data', () => { 
      entryCount++;
      task.output = `processed entry #${entryCount}`
    })
    const ret = new Promise<void>((resolve, reject) => {
      stream.on('end', () => {
        task.title += ` (${entryCount} entries)`
        resolve()
      })
      stream.on('error', (err) => {
        reject(new Error(err))
      })
    })

    ctx.stream = ctx.stream.pipe(stream)
    return ret
  }
}

function isPromiseLike<T>(arg: T | PromiseLike<T>): arg is PromiseLike<T> {
  if (arg && typeof (arg as any).then === 'function') {
    return true;
  }
  return false;
}

function promisify<T>(result: T): PromiseLike<T> {
  if (isPromiseLike(result)) {
    return result;
  } else {
    return Promise.resolve(result)
  }
}

function load_filter_func(filter: string): (entry: IEntry, context?: any) => boolean {
  try {
    return require(path.resolve(filter))
  } catch {
    return (entry, context) => eval_filter(filter, entry, context)
  }
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

function load_xform_func(xform: string): (entry: IEntry, context?: any) => undefined | IEntry | PromiseLike<IEntry> {
  try {
    return require(path.resolve(xform))
  } catch {
    return (entry, context) => eval_xform(xform, entry, context)
  }
}

function eval_xform(xform: string, entry: IEntry, context: any): any {
  const fieldNames = Object.keys(entry.fields)

  let xformFunc: Function = null
  eval(`xformFunc = function (_entry, sys, ${fieldNames.join(', ')}) {
    ${xform}

    ${fieldNames.map((f) => `_entry.fields["${f}"]["en-US"] = ${f}`).join(';\n')}
    return _entry;
  }`)
  
  const fieldValues = [entry, entry.sys]
  fieldValues.push(...fieldNames.map((f) => entry.fields[f]['en-US']))

  try {
    return xformFunc.apply(entry, fieldValues)
  } catch(e) {
    console.log('error!', e)
    return undefined;
  }
}