
export interface IGateConfig {
  maxInflight: number
}

export type Task = () => void

export class Gate {
  public config: Readonly<IGateConfig>

  public stats = {
    queueSize: 0
  }

  private inflight = 0
  private queue: Task[] = []

  constructor(config: IGateConfig) {
    this.config = Object.assign({
      maxInflight: 4
    }, config)
  }
  public lock(run: Task) {
    if (this.inflight == 0 || this.inflight < this.config.maxInflight) {
      this.inflight++
      run()
    } else {
      this.queue.push(run)
      this.stats.queueSize = this.queue.length
    }
  }

  public release() {
    if (this.queue.length > 0) {
      const runner = this.queue.shift()
      // yield the execution queue before running the next request
      setTimeout(runner, 0)
    } else {
      this.inflight--;
    }
  }
}