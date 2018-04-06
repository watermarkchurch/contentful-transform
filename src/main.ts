import * as Listr from 'listr'
import {ListrTask} from 'listr'
import * as fs from 'fs-extra'
import * as path from 'path'
import * as JSONStream from 'JSONStream'
import { Transform, Stream } from 'stream';
import { deepEqual } from 'assert';

import { pipeIt, promisify } from './utils';
import { FilterStream } from './filter';
import { IEntry } from './model';

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
    } catch {
    }
  }

  // todo: download from space

  tasks.push({
    title: 'parse stream',
    task: pipeIt(() => JSONStream.parse('entries.*'))
  })

  if (args.filter) {

    tasks.push({
      title: 'filter stream',
      task: pipeIt(FilterStream(args.filter))
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
    return undefined;
  }
}