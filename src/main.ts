import * as Listr from 'listr'
import {ListrTask} from 'listr'
import * as fs from 'fs-extra'
import * as path from 'path'
import * as JSONStream from 'JSONStream'
import { Transform, Stream } from 'stream';

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
    const filterFunc = require(path.resolve(args.filter))
    console.log('filter func:', filterFunc)

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

  let transformFunc = identityXform
  if (args.transform) {
    transformFunc = require(path.resolve(args.transform))
  }

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

  _transform(chunk: IEntry, encoding: string, cb: Function) {
    const xformed = this.xformFunc(chunk)
    if (isPromiseLike(xformed)) {
      xformed.then((result: any) => {
        cb(null, result)
      })

      if (typeof (xformed as any).catch === 'function') {
        (xformed as any).catch((err: any) => cb(err))
      }
    } else {
      cb(null, xformed)
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
    publishedCounter: 1,
    version: 2,
    publishedBy: { sys: any },
    publishedVersion: 1,
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
  if (typeof (arg as any).then === 'function') {
    return true;
  }
  return false;
}