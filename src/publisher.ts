import { Writable } from "stream"
import * as request from 'request'

import { IEntry } from "./model"

export interface IPublisherConfig {
  host?: string,
  accessToken: string
  spaceId: string
  maxInflightRequests?: number
}

export class Publisher extends Writable {
  private config: Readonly<IPublisherConfig>

  constructor(config: IPublisherConfig) {
    super({
      objectMode: true
    })

    if (!config.accessToken) {
      throw new Error('No access token given')
    }
    if (config.accessToken.indexOf('CFPAT-') != 0) {
      throw new Error('The access token must be a management token starting with "CFPAT-"')
    }
    if (!config.spaceId) {
      throw new Error('No space ID given')
    }

    this.config = Object.assign({
      host: 'https://api.contentful.com',
      maxInflightRequests: 4,
    }, config)
  }

  _write(chunk: IEntry, encoding: string, callback: (err?: any) => void) {
    this.gateInflightRequests(() => {
      this.doReq(chunk, (err) => {
        this.releaseNextRequest()
        if (err) {
          this.emit('error', err)
        } else {
          this.emit('data', chunk)
        }
        callback()
      })
    })
  }

  _writev(chunks: { chunk: IEntry, encoding: string}[], callback: (err?: any) => void) {
    const promises = chunks.map(c => this.writevImpl(c.chunk))
    Promise.all(promises)
      .then(() => callback(null))
      .catch((err) => callback(err))
  }

  private async writevImpl(chunk: IEntry): Promise<void> {
    const { host, spaceId, accessToken } = this.config

    return new Promise<void>((resolve, reject) => {
      this.gateInflightRequests(() => { 
        this.doReq(chunk, (err, resp) => {
          this.releaseNextRequest()
          if (err) {
            this.emit('error', err)
          } else {
            this.emit('data', chunk)
          }
          resolve()
        })
      })
    })
  }

  private inflight = 0
  private queue = [] as (() => void)[]
  private gateInflightRequests(run: () => void) {
    if (this.inflight == 0 || this.inflight < this.config.maxInflightRequests) {
      this.inflight++
      run()
    } else {
      this.queue.push(run)
    }
  }

  private releaseNextRequest() {
    if (this.queue.length > 0) {
      const runner = this.queue.shift()
      // yield the execution queue before running the next request
      setTimeout(runner, 0)
    } else {
      this.inflight--;
    }
  }

  private doReq(chunk: IEntry, cb: (err: any, resp?: request.Response) => void) {
    const { host, spaceId, accessToken } = this.config

    request.put(`${host}/spaces/${spaceId}/entries/${chunk.sys.id}`, {
      auth: {
        bearer: accessToken
      },
      headers: {
        'content-type': 'application/vnd.contentful.management.v1+json',
        'x-contentful-content-type': chunk.sys.contentType.sys.id,
        'x-contentful-version': (chunk.sys.version - 1).toString(),
      },
      body: JSON.stringify(chunk)
    }, (error, response, body) => {
      if (error) {
        cb(error)
      } else {
        if (response.statusCode == 429) {
          let retrySeconds = 1
          try {
            const reset = response.headers['x-contentful-ratelimit-reset']
            if (reset) {
              retrySeconds = parseFloat(reset.toString())
            }
          } catch {
            // couldn't parse the header - default wait is 1 second
          }

          setTimeout(
            () => this.doReq(chunk, cb),
            retrySeconds * 1000 + 100
          )
          this.emit('ratelimit', retrySeconds)
        } else if (response.statusCode != 200) {
          cb(new Error(`${response.statusCode} ${response.body}`))
        } else {
          cb(null, response)
        }
      }
    })
  }
}