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

  _write(chunk: IEntry, encoding: string, callback: (err?: Error) => void) {
    const { host, spaceId, accessToken } = this.config
    const req = request.put(`${host}/spaces/${spaceId}/entries/${chunk.sys.id}`, {
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
        callback(error)
      } else {
        callback()
      }
    })
  }
}