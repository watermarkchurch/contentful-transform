import { Writable } from "stream"
import * as request from 'request'
import { CoreOptions, Response } from "request"

import { IEntry, IAsset } from "./model"

export interface IPublisherConfig {
  client: PublisherClient,
  publish?: boolean | 'all'
}

export type PublisherClient = { put(uri: string, options?: CoreOptions): Promise<Response> }

export class Publisher extends Writable {
  private client: PublisherClient
  private publish: string | boolean

  constructor(config: IPublisherConfig) {
    super({
      objectMode: true,
      highWaterMark: 250
    })

    if (!config.client) {
      throw new Error('No client given')
    }
    this.client = config.client
    this.publish = config.publish
  }

  _write(chunk: IEntry | IAsset, encoding: string, callback: (err?: any) => void) {
    this.doReq(chunk)
      .then((resp) => callback())
      .catch((err) => callback(err))
  }

  _writev(chunks: { chunk: IEntry | IAsset, encoding: string}[], callback: (err?: any) => void) {
    const promises = chunks.map(c => this.doReq(c.chunk))
    Promise.all(promises)
      .then(() => callback())
      .catch((err) => callback(err))
  }

  private async doReq(chunk: IEntry | IAsset): Promise<any> {
    const headers = {
      'content-type': 'application/vnd.contentful.management.v1+json',
      'x-contentful-version': (chunk.sys.version - 1).toString(),
    }
    if (chunk.sys.type == 'Entry') {
      Object.assign(headers, {
        'x-contentful-content-type': chunk.sys.contentType.sys.id
      })
    }

    let response = await this.client.put(`/${this.apiCollection(chunk)}/${chunk.sys.id}`, {
      headers: headers,
      body: JSON.stringify(chunk)
    })

    if (response.statusCode != 200) {
      this.emit('error', new Error(`${response.statusCode} ${response.body}`))
      return
    }

    if (this.shouldPublish(chunk)) {
      response = await this.client.put(`/${this.apiCollection(chunk)}/${chunk.sys.id}/published`, {
        headers: {
          'x-contentful-version': chunk.sys.version.toString(),
        }
      })

      if (response.statusCode != 200) {
        this.emit('error', new Error(`${response.statusCode} ${response.body}`))
        return
      }
    }

    this.emit('data', chunk)
  }

  private shouldPublish(chunk: IEntry | IAsset): boolean {
    if (chunk.sys.type != 'Entry' && chunk.sys.type != 'Asset') {
      return
    }
    switch(this.publish) {
      case false:
        return false
      case "all":
        return true
      default:
        return chunk.sys.publishedVersion == chunk.sys.version - 1;
    }
  }

  private apiCollection(chunk: IEntry | IAsset): string {
    switch(chunk.sys.type) {
      case 'Entry':
        return 'entries'
      case 'Asset':
        return 'assets'
      default:
        const c = <any>(chunk)
        throw new Error(`Chunk ${c.sys.id} has unknown type '${c.sys.type}'`)
    }
  }
}