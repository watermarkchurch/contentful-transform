import * as Listr from 'listr'
import { Stream } from 'stream';

export type StreamWrapper = (ctx?: any, task?: Listr.ListrTaskWrapper) => Stream

export function pipeIt(taskImpl: Stream | StreamWrapper):
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