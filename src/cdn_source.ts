import { PassThrough } from "stream";
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

    if (config.accessToken.indexOf('CFPAT-') == 0 && !config.host) {
      // for a management token we need to hit api.contentful.com
      config.host = 'https://api.contentful.com'
    }

    this.config = Object.assign({
      host: 'https://cdn.contentful.com'
    }, config)
  }

  stream(contentType?: string, query?: string): NodeJS.ReadableStream {
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
        if (resp.statusCode == 429) {
          let retrySeconds = 1
          try {
            const reset = resp.headers['x-contentful-ratelimit-reset']
            if (reset) {
              retrySeconds = parseFloat(reset.toString())
            }
          } catch {
            // couldn't parse the header - default wait is 1 second
          }

          setTimeout(
            () => makeReq(skip + counter),
            retrySeconds * 1000 + 100
          )
          ret.emit('ratelimit', retrySeconds)
        } else if (resp.statusCode != 200) {
          ret.emit('error', new Error(`Error making request: ${resp.statusCode}`))
        }
      })
    }

    let skip = 0
    makeReq(skip)
  
    return ret
  }
}