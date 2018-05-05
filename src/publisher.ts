import { Writable } from "stream"
import * as request from 'request'
import { CoreOptions, Response } from "request"

import { IEntry } from "./model"

export interface IPublisherConfig {
  client: PublisherClient
}

export type PublisherClient = { put(uri: string, options?: CoreOptions): Promise<Response> }

export class Publisher extends Writable {
  private client: PublisherClient

  constructor(config: IPublisherConfig) {
    super({
      objectMode: true,
      highWaterMark: 250
    })

    if (!config.client) {
      throw new Error('No client given')
    }
    this.client = config.client
  }

  _write(chunk: IEntry, encoding: string, callback: (err?: any) => void) {
    this.doReq(chunk)
      .then((resp) => callback())
      .catch((err) => callback(err))
  }

  _writev(chunks: { chunk: IEntry, encoding: string}[], callback: (err?: any) => void) {
    const promises = chunks.map(c => this.doReq(c.chunk))
    Promise.all(promises)
      .then(() => callback())
      .catch((err) => callback(err))
  }

  private async doReq(chunk: IEntry): Promise<any> {
    const response = await this.client.put(`/entries/${chunk.sys.id}`, {
      headers: {
        'content-type': 'application/vnd.contentful.management.v1+json',
        'x-contentful-content-type': chunk.sys.contentType.sys.id,
        'x-contentful-version': (chunk.sys.version - 1).toString(),
      },
      body: JSON.stringify(chunk)
    })

    if (response.statusCode != 200) {
      this.emit('error', new Error(`${response.statusCode} ${response.body}`))
    } else {
      this.emit('data', chunk)
    }
  }
}