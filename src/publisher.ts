import { Writable } from "stream"
import * as request from 'request'

import { IEntry } from "./model"

export interface IPublisherConfig {
  host?: string,
  accessToken: string
  spaceId: string
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
    if (!config.spaceId) {
      throw new Error('No space ID given')
    }

    this.config = Object.assign({
      host: 'https://api.contentful.com'
    }, config)
  }

  _write(chunk: IEntry, encoding: string, callback: (err?: any) => void) {
    this.doReq(chunk, callback)
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
      this.doReq(chunk, (err, resp) => {
        if (err) {
          this.emit('error', err)
        }
        resolve()
      })
    })
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
        'x-contentful-version': chunk.sys.version.toString(),
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
              retrySeconds = parseInt(reset.toString())
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