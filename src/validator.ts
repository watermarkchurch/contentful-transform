import { Transform } from "stream";
import { IEntry, IContentType, IValidation, IField } from "./model";
import { DeepPartial } from './utils'
import { Gate } from "./gate";
import chalk from "chalk";

export interface IValidatorStreamConfig {
  contentTypeGetter: (ct: string) => Promise<IContentType>,
  entryInfoGetter?: (id: string) => Promise<DeepPartial<IEntry>>,

  maxConcurrentEntries?: number
}

type ContentTypeMap = { [id: string]: IContentType }

export class ValidatorStream extends Transform {
  private config: Readonly<IValidatorStreamConfig>

  private contentTypes: ContentTypeMap = {}

  private gate: Gate

  constructor(config: IValidatorStreamConfig) {
    super({
      objectMode: true,
      highWaterMark: 250
    })

    config = Object.assign({
      maxConcurrentEntries: 4
    }, config)

    this.config = config
    this.gate = new Gate({ maxInflight: this.config.maxConcurrentEntries })
  }

  _transform(chunk: IEntry, encoding: string, callback: (err?: any) => void) {
    this.gate.lock(() => {
      // since up to 4 entries can be processed simultaneously, we can tell the
      // transform stream that it can accept more data now.
      callback()

      this.validate(chunk)
        .then(valid => {
          if (valid) {
            this.push(chunk)
          }
          this.gate.release()
        })
        .catch(err => {
          this.gate.release()
          this.emit('error', err)
        })
    })
  }

  _flush(callback: (err?: any) => void) {
    // we need to push any remaining inflight chunks before the stream closes
    if (this.gate.empty()) {
      callback()
    } else {
      this.gate.once('empty', () => callback())
    }
  }

  async validate(chunk: IEntry): Promise<boolean> {
    const contentTypeId = chunk.sys.contentType.sys.id
    let contentType = this.contentTypes[contentTypeId]
    if (!contentType) {
      contentType = await this.config.contentTypeGetter(contentTypeId)
      this.contentTypes[contentTypeId] = contentType
    }
    if (!contentType) {
      console.error(chalk.yellow(`\u26A0 Warning!  Cannot get content type ${contentTypeId} for entry ${chunk.sys.id}.` +
              `  This means we can't validate it!\n` +
              `  To avoid this in the future, pass an authentication token on the command line using the '-a' parameter` +
              ` or ensure\n  that your export contains content types.`))
      return
    }

    // check the validations against each field
    const promises = 
      contentType.fields.flatMap<Promise<string>>(fieldDef => {
        const field = chunk.fields[fieldDef.id]
        if (fieldDef.required) {
          if (!field) {
            return [Promise.resolve(`missing required field ${fieldDef.id}`)]
          }
        }

        if (!field) {
          return
        }

        if(fieldDef.validations) {
          return fieldDef.validations
            .map(v => this.validateField(fieldDef.id, v, field['en-US']))
        }
        if (fieldDef.type == 'Array') {
          return this.validateArray(fieldDef, field['en-US'])
        }
        return
      })

    // check for broken links
    if (this.config.contentTypeGetter) {
      promises.push(...contentType.fields
        .filter(f => f.required && f.linkType == 'Entry')
        .map(async fieldDef => {
          const field = chunk.fields[fieldDef.id]
          if (!field) {
            return
          }

          return this.validateLink(fieldDef.id, field['en-US'].sys.id)
      }))

      // broken links in arrays should always be reported
      // because you end up with a 'nil' element in the array
      promises.push(...contentType.fields
        .filter(f => f.type == 'Array' && f.items.linkType == 'Entry')
        .flatMap(fieldDef => {
          const array = chunk.fields[fieldDef.id]
          if (!array) {
            return
          }

          return (array['en-US'] as any[]).map(async (field) => {
            return this.validateLink(fieldDef.id, field.sys.id)
          })
      }))
    }
    
    const errors = (await Promise.all(promises)).filter(e => e)

    if (errors.length > 0) {
      this.emit('invalid', chunk, errors)
    }
    return errors.length == 0
  }

  async validateField(id: string, validation: IValidation, field: any): Promise<string> {
    if (validation.regexp) {
      if (typeof(field) !== 'string') {
        return `${id} expected to be a string but was ${typeof(field)}`
      } else {
        if (!field.match(new RegExp(validation.regexp.pattern, validation.regexp.flags || ''))) {
          return `${id} expected to match /${validation.regexp.pattern}/${validation.regexp.flags || ''} but was ${field}`
        }
      }
  
    } else if (validation.in) {
      if (validation.in.indexOf(field) == -1) {
        return `${id} expected to be in [${validation.in}] but was ${field}`
      }

    } else if (validation.linkContentType) {
      // field is a link
      /* {
              "sys": {
                "type": "Link",
                "linkType": "Entry",
                "id": "DAvzFFa4Gy6KEgyi4EImU"
              }
            }
      */
      if (!field.sys || !field.sys.linkType || field.sys.linkType != 'Entry') {
        return `${id} expected to be a link to an entry but was a ${(field.sys && field.sys.linkType) || typeof(field)}`
      }

      if (!this.config.entryInfoGetter) {
        return
      }

      return await this.validateLink(id, field.sys.id, (linkedEntry) => {
        if (!linkedEntry) {
          // validation message added above
          return
        }
        if (validation.linkContentType.indexOf(linkedEntry.sys.contentType.sys.id) == -1) {
          return `${id} expected to link to one of [${validation.linkContentType}] but was a ${linkedEntry.sys.contentType.sys.id}`
        }
      })
    }

    return null
  }
  
  validateArray(fieldDef: IField, field: any): Promise<string>[] {
    if (!Array.isArray(field)) {
      return [Promise.resolve(`${fieldDef.id} expected to be an array but was ${typeof(field)}`)]
    }
  
    if (fieldDef.required) {
      if (field.length == 0) {
        return [Promise.resolve(`${fieldDef.id} is required but was empty`)]
      }
    }
  
    if (!fieldDef.items.validations || fieldDef.items.validations.length == 0) {
      return null
    }

    return field.flatMap((item, index) => 
        fieldDef.items.validations.map((v) => 
          this.validateField(fieldDef.id + '[' + index + ']', v, item)
        )
      )
  }

  private async validateLink(fieldId: string, id: string, cb?: (linkedEntry: DeepPartial<IEntry>) => string): Promise<string> {
    try {
      const linked = await this.config.entryInfoGetter(id)
      if (cb) {
        return cb(linked)
      } else if (!linked) {
        // just validate whether the link exists
        return `${fieldId} is a broken link!`
      }
    } catch(e) {
      // we're OK with timeouts
      if (e.message !== 'timeout') {
        throw e
      }
    }
  }
}