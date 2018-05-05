import { EventEmitter } from "events";

export interface IGateConfig {
  maxInflight: number
}

export type Task = () => void

export class Gate extends EventEmitter {
  public config: Readonly<IGateConfig>

  private inflight = 0
  private queueSize = 0
  private queue: Task[] = []

  constructor(config: IGateConfig) {
    super()

    this.config = Object.assign({
      maxInflight: 4
    }, config)
  }

  public stats(): Readonly<{ inflight: number, queueSize: number }> {
    return {
      inflight: this.inflight,
      queueSize: this.queueSize
    }
  }

  public empty(): boolean {
    return this.inflight <= 0 && this.queue.length == 0
  }

  public lock(run: Task) {
    if (this.inflight == 0 || this.inflight < this.config.maxInflight) {
      this.inflight++
      run()
    } else {
      this.queue.push(run)
      this.queueSize = this.queue.length
    }
  }

  public release() {
    if (this.queue.length > 0) {
      const runner = this.queue.shift()
      this.queueSize = this.queue.length
      // yield the execution queue before running the next request
      setTimeout(runner, 0)
    } else {
      this.inflight--;
      if (this.inflight == 0) {
        this.emit('empty')
      } else if (this.inflight < 0) {
        throw new Error(`Invalid state! negative inflight requests`)
      }
    }
  }
}