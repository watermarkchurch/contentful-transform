import * as Listr from 'listr'
import {ListrTask} from 'listr'
import * as fs from 'fs-extra'
import * as path from 'path'
import * as JSONStream from 'JSONStream'
import { Transform, Stream } from 'stream';

import { pipeIt } from './utils';
import { FilterStream } from './filter';
import { TransformStream } from './transform';
import { IEntry } from './model';
import { CdnSource } from './cdn_source';

export interface ITransformArgs {
  source: string
  accessToken?: string,
  filter?: string
  raw?: boolean,
  contentType?: string
  query?: string,
  transform: string
  output?: string[]
  quiet?: boolean
}

export default async function Run(args: ITransformArgs): Promise<void> {
  const tasks: Array<ListrTask> = []

  const context = {
    output: null as fs.WriteStream | NodeJS.WritableStream
  }

  if (args.source == '-') {
    tasks.push({
      title: `Parse stdin${args.raw ? ' (raw mode)' : ''}`,
      task: pipeIt(
        process.stdin
          .pipe(JSONStream.parse(args.raw ? undefined : '..*'))
          .pipe(FilterStream((e) =>  e.sys && e.sys.type == 'Entry'))
      )
    })
  } else {
    try {
      await fs.access(args.source, fs.constants.R_OK)
      tasks.push({
        title: `Parse file ${args.source}${args.raw ? ' (raw mode)' : ''}`,
        task: pipeIt(
          fs.createReadStream(args.source)
          .pipe(JSONStream.parse(args.raw ? undefined : '..*'))
          .pipe(FilterStream((e) =>  e.sys && e.sys.type == 'Entry'))
        )
      })
    } catch {
    }
  }

  if (tasks.length == 0) {
    const source = new CdnSource({
      spaceId: args.source,
      accessToken: args.accessToken
    })
    tasks.push({
      title: `Download from space ${args.source}`,
      task: pipeIt(source.stream(args.contentType, args.query))
    })
  }

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

  if (args.raw && args.output.indexOf('-') < 0) {
    args.output.push('-')
  }

  args.output.forEach((o) => {
    if (o == '-') {
      tasks.push({
        title: 'write to stdout',
        task: stringifyTo(process.stdout, true)
      })
      // listr logs to stdout
      args.quiet = true
    } else if (path.extname(o) != '') {
      tasks.push({
        title: `write to file ${o}`,
        task: stringifyTo(fs.createWriteStream(o))
      })
    }
  })

  return new Listr(tasks, 
    {
      concurrent: true,
      renderer: args.quiet ? 'silent' : 'default'
    })
    .run(context)

  function stringifyTo(stream: Stream, isStdout?: boolean): (ctx: any, task: Listr.ListrTaskWrapper) => Promise<void> {
    return (ctx, task) => {
      const stringified =
        args.raw ?
          JSONStream.stringify(false) :
          JSONStream.stringify('{\n  "entries": [\n    ', ',\n    ', '\n  ]\n}\n')
      const ret = new Promise<void>((resolve, reject) => {
        let eventSource = stream
        if (isStdout) {
          // stdout doesn't have a close event, so listen to the jsonstream
          eventSource = stringified
        }
        eventSource.on('finish', () => {
          resolve()
        })
        eventSource.on('error', (err) => {
          console.error('stream error!', err)
          reject(new Error(err))
        })
      })
      ctx.stream.pipe(stringified).pipe(stream)
      return ret
    }
  }
}