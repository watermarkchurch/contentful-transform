import * as Listr from 'listr'
import { Stream, Writable, Readable } from 'stream';

export type StreamWrapper = (ctx?: any, task?: Listr.ListrTaskWrapper) => Stream

export function pipeIt(taskImpl: Stream | StreamWrapper, outputTask: boolean = false):
  (ctx: any, task: Listr.ListrTaskWrapper) => Promise<void> {

  return (ctx, task) => {
    let stream: Stream
    if (isStreamWrapper(taskImpl)) {
      stream = taskImpl(ctx, task)
    } else {
      stream = taskImpl
    }

    let entryCount = 0
    stream.on('data', () => {
      entryCount++;
      task.output = `processed entry #${entryCount}`
    })
    stream.on('ratelimit', (retrySeconds) => {
      task.output = `processed entry #${entryCount} Rate limited - retrying in ${retrySeconds * 1000}ms`
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

    if (ctx.stream) {
      ctx.stream.pipe(stream)
    }
    if (!outputTask) {
      ctx.stream = stream
    }
    return ret
  }
}

export function isPromiseLike<T>(arg: T | PromiseLike<T>): arg is PromiseLike<T> {
  if (arg && typeof (arg as any).then === 'function') {
    return true;
  }
  return false;
}

export function promisify<T>(result: T): PromiseLike<T> {
  if (isPromiseLike(result)) {
    return result;
  } else {
    return Promise.resolve(result)
  }
}

function isStreamWrapper(impl: Stream | StreamWrapper): impl is StreamWrapper {
  if (typeof impl == "function") {
    return true
  }
  return false
}

export function toReadable(entries: any[]): Readable {
  let index = 0;
  return new Readable({
    objectMode: true,
    read: function(size) {
      if(index >= entries.length) {
        // eof
        this.push(null)
      }
      while(index < entries.length){
        if (!this.push(entries[index++])) {
          break
        }
      }
    }
  })
}

export function collect(stream: Stream): Promise<any[]> {
  const result: any = []

  return new Promise((resolve, reject) => {
    stream.pipe(new Writable({
      objectMode: true,
      write: (chunk, encoding, callback) => {
        result.push(chunk)
        callback()
      }
    }))
      .on('error', (err) => {
        reject(err)
      })
      .on('finish', () => {
        resolve(result)
      })

    stream.on('error', (err) => reject(err))
  })
}