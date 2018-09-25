import { Transform } from "stream";
import { CoreOptions, Response } from "request";
import chalk from "chalk";

import { IEntry, IAsset } from "./model";
import { DeepPartial } from "./utils";

export interface IEntryAggregatorConfig {
  client?: EntryAggregatorClient
}

export type EntryAggregatorClient = { get(uri: string, options?: CoreOptions): Promise<Response> }

export type EntryMap = { 
  [id: string]: MapItem
}
export type MapItem = DeepPartial<IEntry> | EntryWaiter[] | Error
export type EntryWaiter = (error: Error, entry?: DeepPartial<IEntry>) => any

export class EntryAggregator extends Transform {
  public client: EntryAggregatorClient

  public entryMap: EntryMap = {}
  
  constructor(config: IEntryAggregatorConfig) {
    super({
      objectMode: true
    })

    this.client = config.client
  }

  _transform(chunk: IEntry | IAsset, encoding: string, callback: (err?: any) => void) {
    if (chunk.sys.type == 'Entry') {
      const existing = this.entryMap[chunk.sys.id]
      const entry = selectFields(<IEntry>chunk)
      if (existing && isWaiterArray(existing)) {
        existing.forEach((waiter) => waiter(null, entry))
      }
      this.entryMap[chunk.sys.id] = entry
    }

    this.push(chunk)
    callback()
  }

  async getEntryInfo(id: string): Promise<DeepPartial<IEntry>> {
    const entry = this.entryMap[id]
    if (entry && isEntry(entry)) {
      return published(entry) ? entry : null
    }
    if (entry && isError(entry)) {
      throw entry
    }

    if (this.client) {
      const resp = await this.client.get(`/entries/${id}?locale=*`)
      if (resp.statusCode == 404) {
        // entry missing
        return
      } if (resp.statusCode != 200) {
        throw new Error(`${resp.statusCode} when getting entry ${id} from Contentful:\n  ${resp.body}`)        
      }

      const chunk: IEntry = JSON.parse(resp.body)
      const result = this.entryMap[chunk.sys.id] = selectFields(chunk)
      return published(result) ? result : null
    } else {
      if (!this.entryMap[id]) {
        this.entryMap[id] = []
      }
      return new Promise((resolve, reject) => {
        let timeout: NodeJS.Timer
        (<EntryWaiter[]>this.entryMap[id]).push(
          (err, entry) => {
            if (err) {
              reject(err)
            } else {
              resolve(entry)
            }
            clearTimeout(timeout)
          }
        )
        timeout = setTimeout(() => {
          const existing = this.entryMap[id]
          if (isWaiterArray(existing)) {
            console.error(chalk.yellow(`\u26A0 Warning!  Entry ${id} did not come across the stream in over 10 seconds.\n` +
              `  This means we can't validate whether it is a broken link, or of the appropriate content type.\n` +
              `  To avoid this in the future, pass an authentication token on the command line using the '-a' parameter.`))
            const err = new Error('timeout')
            this.entryMap[id] = err
            existing.forEach(w => w(err))
          }
        }, 10000)
      })
    }
  }
}

function isEntry(mapItem: MapItem): mapItem is DeepPartial<IEntry> {
  return mapItem.hasOwnProperty('sys')
}

function isWaiterArray(mapItem: MapItem): mapItem is EntryWaiter[] {
  return Array.isArray(mapItem)
}

function isError(mapItem: MapItem): mapItem is Error {
  return mapItem.hasOwnProperty('message')
}

function published(entry: DeepPartial<IEntry>): boolean {
  // if it came from the CDN, then it's published.
  if (entry.sys.revision > 0) {
    return true
  }

  // the Management API lets us know it's published by setting 'publishedVersion'
  return entry.sys.publishedVersion > 0
}

export function selectFields(chunk: IEntry): DeepPartial<IEntry> {
  // add more fields as necessary
  return {
    sys: {
      id: chunk.sys.id,
      type: chunk.sys.type,
      contentType: {
        sys: chunk.sys.contentType.sys
      },
      revision: chunk.sys.revision,
      publishedVersion: chunk.sys.publishedVersion
    }
  }
}