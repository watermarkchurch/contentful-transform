import * as request from 'request'
import { CoreOptions, RequestCallback, Response } from 'request'
import { EventEmitter } from 'events'
import * as path from 'path'
import { PassThrough } from 'stream';
import { Gate } from './gate';

// require('request-debug')(request)

export interface IClientConfig {
  host?: string,
  accessToken: string
  spaceId: string
  maxInflightRequests?: number
}

export class Client extends EventEmitter {
  public config: Readonly<IClientConfig>

  public stats = {
    requests: 0,
    rateLimits: 0,
    maxQueueSize: 0
  }

  private gate: Gate

  constructor(config: IClientConfig) {
    super()

    if (!config.accessToken) {
      throw new Error('No access token given')
    }
    if (config.accessToken.indexOf('CFPAT-') != 0) {
      throw new Error('The access token must be a management token starting with "CFPAT-"')
    }
    if (!config.spaceId) {
      throw new Error('No space ID given')
    }
    
    const host = config.accessToken.startsWith('CFPAT-') ? 
      'https://api.contentful.com' :
      'https://cdn.contentful.com'
    this.config = Object.assign({
      host,
      maxInflightRequests: 4,
    }, config)
    this.gate = new Gate({ maxInflight: this.config.maxInflightRequests })
  }

  stream(uri: string, options?: CoreOptions): NodeJS.ReadableStream {
    const ret = new PassThrough()

    this._doReq((cb) => {
      let response: Response
      let error: any

      const req = request.get(
          this.getUrl(uri),
          this.getOptions(options)
        )

      // stream the request
      req.pipe(ret, { end: false })

      // pass the request back through to the rate limit logic
      req.on('response', (resp) => response = resp)
      req.on('error', (err) => {
        error = err
        cb(err, response, undefined)
      })
      req.once('end', () => {
        if (!error) {
          cb(undefined, response, undefined)
        }
      })
    }, (err, response) => {
      // done after rate limiting - propagate end event to the child stream
      ret.emit('response', response)
      if (err) {
        ret.emit('error', err)
      }
      ret.emit('end')
    })

    return ret
  }

  async get(uri: string, options?: CoreOptions): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
      this._doReq(cb => 
        request.get(
          this.getUrl(uri),
          this.getOptions(options),
          cb),
        (error, response) => {
          if (error) {
            reject(error)
          } else {
            resolve(response)
          }
        })
    })
  }

  async put(uri: string, options?: CoreOptions): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
      this._doReq(cb => 
        request.put(
          this.getUrl(uri),
          this.getOptions(options),
          cb),
        (error, response) => {
          if (error) {
            reject(error)
          } else {
            resolve(response)
          }
        })
    })
  }

  private getOptions(options?: CoreOptions): CoreOptions {
    const {accessToken} = this.config
    return Object.assign({
      auth: {
        bearer: accessToken
      }
    }, options)
  }

  private getUrl(url: string): string {
    const {host, spaceId} = this.config
    return host + path.join(`/spaces/${spaceId}`, url)
  }

  private _doReq(req: (cb: RequestCallback) => void, cb?: RequestCallback): void {
    this.gate.lock(() => {
      this.stats.requests++

      req((error, response, body) => {
        this.gate.release()
        if (error) {
          cb(error, response, body)
        } else {
          if (response.statusCode == 429) {
            this.stats.rateLimits++

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
              () => this._doReq(req, cb),
              retrySeconds * 1000 + 100
            )
            this.emit('ratelimit', retrySeconds)
          } else {
            cb(error, response, body)
          }
        }
      })
    })
    this.stats.maxQueueSize = Math.max(this.stats.maxQueueSize, this.gate.stats().queueSize)
  }
}