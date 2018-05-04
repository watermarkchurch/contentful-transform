import { PassThrough } from "stream";
import * as request from 'request';
import * as JSONStream from 'JSONStream';

export interface ICdnConfig {
  client: CdnSourceClient
}

export type CdnSourceClient = { stream(url: string): NodeJS.ReadableStream }

export class CdnSource {
  private client: CdnSourceClient

  constructor(config: ICdnConfig) {
    if (!config.client) {
      throw new Error('No client given')
    }

    this.client = config.client
  }

  stream(contentType?: string, query?: string): NodeJS.ReadableStream {
    contentType = contentType ? `&content_type=${contentType}` : ''
    query = query ? `&${query}` : ''
  
    const ret = JSONStream.parse('items.*')
  
    
    const makeReq = (skip: number) => {
      const req = this.client.stream(`/entries?limit=1000&skip=${skip}&locale=*${contentType}${query}`)

      req.pipe(ret, { end: false })

      let counter = 0;
      let status = 0;
      ret.on('data', () => {
        counter++;
      })
      req.once('end', () => {
        if (status == 200 && counter >= 1000) {
          // get the next page
          makeReq(skip + 1000)
        } else if (status != 429) {
          // perpetuate the end event
          ret.emit('end', skip + counter)
        }
      })
      req.on('error', (err) => {
        ret.emit('error', new Error(`Error making request: ${err}`))
      })
      req.on('response', (resp) => {
        status = resp.statusCode
        if (resp.statusCode != 200) {
          ret.emit('error', new Error(`Error making request: ${resp.statusCode}`))
        }
      })
    }

    let skip = 0
    makeReq(skip)
  
    return ret
  }
}