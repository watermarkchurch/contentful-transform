import { Stream, PassThrough } from "stream";
import * as request from 'request';
import * as JSONStream from 'JSONStream';

export interface ICdnConfig {
  host?: string,
  accessToken: string
  spaceId: string
}

export class CdnSource {
  private config: Readonly<ICdnConfig>

  constructor(config: ICdnConfig) {
    if (!config.accessToken) {
      throw new Error('No access token given')
    }
    if (!config.spaceId) {
      throw new Error('No space ID given')
    }

    this.config = Object.assign({
      host: 'https://cdn.contentful.com'
    }, config)
  }

  stream(contentType?: string, query?: string): Stream {
    contentType = contentType ? `&content_type=${contentType}` : ''
    query = query ? `&${query}` : ''
    const {host, spaceId, accessToken} = this.config 
  
    const ret = JSONStream.parse('items.*')
  
    
    function makeReq(skip: number) {
      const req = request(`${host}/spaces/${spaceId}/entries?limit=1000&skip=${skip}&locale=*${contentType}${query}`, {
        auth: {
          bearer: accessToken
        }
      })
  
      req.pipe(ret, { end: false })
      let counter = 0;
      ret.on('data', () => {
        counter++;
      })
      req.once('end', () => {
        if (counter >= 1000) {
          // get the next page
          makeReq(skip + 1000)
        } else {
          // perpetuate the end event
          ret.emit('end', skip + counter)
        }
      })
      req.on('error', (err) => {
        console.log('error!', err)
        ret.emit('error', `Error making request: ${err}`)
      })
      req.on('response', (resp) => {
        if (resp.statusCode != 200) {
          ret.emit('error', `Error making request: ${resp.statusCode}`)
        }
      })
    }
  
      // the input source is probably a space ID - try it
    let skip = 0
    makeReq(skip)
  
    return ret
  }
}