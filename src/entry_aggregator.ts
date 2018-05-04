import { Writable } from "stream";
import { CoreOptions, Response } from "request";
import { IEntry } from "./model";
import { DeepPartial } from "./utils";

export interface IEntryAggregatorConfig {
  client?: EntryAggregatorClient
}

export type EntryAggregatorClient = { get(uri: string, options?: CoreOptions): Promise<Response> }

export class EntryAggregator extends Writable {
  private client: EntryAggregatorClient

  private entryMap: { [id: string]: DeepPartial<IEntry> }
  
  constructor(config: IEntryAggregatorConfig) {
    super({
      objectMode: true
    })

    this.client = config.client
  }

  _write(chunk: IEntry, encoding: string, callback: (err?: any) => void) {
    // add more fields as necessary
    this.entryMap[chunk.sys.id] = this.selectFields(chunk)
    callback()
  }

  async getEntryInfo(id: string): Promise<DeepPartial<IEntry>> {
    if (this.entryMap[id]) {
      return this.entryMap[id]
    }

    if (this.client) {
      const resp = await this.client.get(`/entries/${id}`)
      if (resp.statusCode == 404) {
        // entry missing
        return
      } if (resp.statusCode != 200) {
        throw new Error(`${resp.statusCode} when getting entry ${id} from Contentful:\n  ${resp.body}`)        
      }

      const chunk: IEntry = JSON.parse(resp.body)
      this.entryMap[chunk.sys.id] = this.selectFields(chunk)
    } else {
      // TODO: put this request in a queue and resolve it when the entry comes through the _write
      throw new Error(`Entry ${id} has not yet been processed and I don't have an access token to go get it.`)      
    }
  }

  private selectFields(chunk: IEntry): DeepPartial<IEntry> {
    return {
      sys: {
        id: chunk.sys.id,
        contentType: {
          sys: chunk.sys.contentType.sys
        }
      }
    }
  }
}