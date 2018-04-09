import * as Listr from 'listr'
import {ListrTask} from 'listr'
import * as fs from 'fs-extra'
import * as path from 'path'
import * as JSONStream from 'JSONStream'
import { Transform, Stream } from 'stream';
import { deepEqual } from 'assert';

import { pipeIt, promisify } from './utils';
import { FilterStream } from './filter';
import { TransformStream } from './transform';
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

  tasks.push({
    title: 'transform stream',
    task: pipeIt(TransformStream(args.transform))
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