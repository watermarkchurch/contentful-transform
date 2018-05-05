import { Transform } from "stream";
import { CoreOptions, Response } from "request";
import { IEntry } from "./model";
import { DeepPartial } from "./utils";

export interface IEntryAggregatorConfig {
  client?: EntryAggregatorClient
}

export type EntryAggregatorClient = { get(uri: string, options?: CoreOptions): Promise<Response> }

export type EntryMap = { 
  [id: string]: DeepPartial<IEntry> | EntryWaiter[]
}
export type EntryWaiter = (e: DeepPartial<IEntry>) => any

export class EntryAggregator extends Transform {
  public client: EntryAggregatorClient

  public entryMap: EntryMap = {}
  
  constructor(config: IEntryAggregatorConfig) {
    super({
      objectMode: true
    })

    this.client = config.client
  }

  _transform(chunk: IEntry, encoding: string, callback: (err?: any) => void) {
    // add more fields as necessary
    const existing = this.entryMap[chunk.sys.id]
    const entry = selectFields(chunk)
    if (existing && !isEntry(existing)) {
      existing.forEach((waiter) => waiter(entry))
    }
    this.entryMap[chunk.sys.id] = entry
    this.push(chunk)
    callback()
  }

  async getEntryInfo(id: string): Promise<DeepPartial<IEntry>> {
    const entry = this.entryMap[id]
    if (entry && isEntry(entry)) {
      return published(entry) ? entry : null
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
        (<EntryWaiter[]>this.entryMap[id]).push(
          (e) => resolve(e)
        )
      })
    }
  }
}

function isEntry(mapItem: DeepPartial<IEntry> | EntryWaiter[]): mapItem is DeepPartial<IEntry> {
  return !Array.isArray(mapItem)
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
  return {
    sys: {
      id: chunk.sys.id,
      contentType: {
        sys: chunk.sys.contentType.sys
      },
      revision: chunk.sys.revision,
      publishedVersion: chunk.sys.publishedVersion
    }
  }
}