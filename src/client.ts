import * as request from 'request'
import { CoreOptions, RequestCallback, Response } from 'request'
import { EventEmitter } from 'events'
import * as path from 'path'
import { PassThrough } from 'stream';
import { Gate } from './gate';
import { wait } from './utils';
import { Url } from 'url';

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

  private keys: string[] = []

  private gate: Gate

  constructor(config: IClientConfig) {
    super()

    if (!config.accessToken) {
      throw new Error('No access token given')
    }
    if (config.host && config.host.match(/api\.contentful\.com/)) {
      if(config.accessToken.indexOf('CFPAT-') != 0) {
        throw new Error('The access token must be a management token starting with "CFPAT-"')
      }
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

  async getCdnClient(): Promise<Client> {
    if (this.config.host != 'https://api.contentful.com') {
      return this
    }
    const {host, spaceId} = this.config

    const response = await this._doReq(cb => request.post(host + `/spaces/${spaceId}/api_keys`,
        this.getOptions({
          headers: {
            'content-type': 'application/vnd.contentful.management.v1+json'
          },
          body: JSON.stringify({
            "name": "contentful-transform temporary CDN key",
            "environments": [
              {
                "sys": {
                  "type": "Link",
                  "linkType": "Environment",
                  "id": "master"
                }
              }
            ]
          })
        }),
        cb
      ),
      201)
    const key = JSON.parse(response.body)
    this.keys.push(key.sys.id)

    const client = new Client(Object.assign({}, 
      this.config, 
      { host: 'https://cdn.contentful.com', accessToken: key.accessToken }
    ))

    // wait until the CDN key becomes available on the CDN
    let retries = 0
    while(true) {
      await wait(100)
      const resp = await client.get('/content_types?limit=1')
      if (resp.statusCode == 200) {
        break
      } else if (resp.statusCode != 401) {
        throw new Error(`${resp.statusCode} polling for new CDN key to be ready`)
      }
      retries++
      if (retries > 100) {
        throw new Error(`CDN key ${key.sys.id} in space ${spaceId} was not ready after 10 seconds`)
      }
    }

    return client
  }

  async cleanup(): Promise<any> {
    return Promise.all(this.keys.map((k) => 
      this._doReq(cb => request.delete(this.config.host + `/spaces/${this.config.spaceId}/api_keys/${k}`,
          this.getOptions(),
          cb
        ),
        204
      )
    ))
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

  private _doReq(req: (cb: RequestCallback) => void, expect?: number): Promise<Response>
  private _doReq(req: (cb: RequestCallback) => void, cb?: RequestCallback): void
  private _doReq(req: (cb: RequestCallback) => void, expect?: number, cb?: RequestCallback): void

  private _doReq(req: (cb: RequestCallback) => void, expect?: number | RequestCallback, callback?: RequestCallback): void | Promise<Response> {
    let cb = callback
    if (!cb && typeof(expect) != 'number') {
      cb = expect as RequestCallback
      expect = null
    }
    if (!cb) {
      return new Promise<Response>((resolve, reject) => 
        this._doReq(req, expect as number, (err, response, body) => {
          if (err) {
            reject(err)
            return
          }
          if (expect && response.statusCode != expect) {
            reject(new Error(`${response.statusCode} ${formatUri(response.request.uri)} - expected ${expect}`))
            return
          }
          resolve(response)
        })
      )
    }

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
              () => this._doReq(req, expect as number, cb),
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

function formatUri(uri: Url & { href: string, pathname: string }): string {
  const {protocol, host, path} = uri
  return `${protocol}//${host}${path}`
}