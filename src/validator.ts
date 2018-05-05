import { Transform } from "stream";
import { IEntry, IContentType, IValidation, IField } from "./model";
import { DeepPartial } from './utils'

export interface IValidatorStreamConfig {
  contentTypeGetter: (ct: string) => Promise<IContentType>,
  entryInfoGetter?: (id: string) => Promise<DeepPartial<IEntry>>
}

type ContentTypeMap = { [id: string]: IContentType }

export class ValidatorStream extends Transform {
  private config: Readonly<IValidatorStreamConfig>

  private contentTypes: ContentTypeMap = {}

  constructor(config: IValidatorStreamConfig) {
    super({
      objectMode: true,
      highWaterMark: 250
    })
    this.config = config
  }

  _transform(chunk: IEntry, encoding: string, callback: (err?: any) => void) {
    this.validate(chunk)
      .then(valid => {
        if (valid) {
          this.push(chunk)
        }
        callback()
      })
      .catch(err => callback(err))
  }

  async validate(chunk: IEntry): Promise<boolean> {
    const contentTypeId = chunk.sys.contentType.sys.id
    let contentType = this.contentTypes[contentTypeId]
    if (!contentType) {
      contentType = await this.config.contentTypeGetter(contentTypeId)
      this.contentTypes[contentTypeId] = contentType
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

      const entryInfo = await this.config.entryInfoGetter(field.sys.id)
      if (!entryInfo) {
        return `${id} is a broken link!`
      }
      if (validation.linkContentType.indexOf(entryInfo.sys.contentType.sys.id) == -1) {
        return `${id} expected to link to one of [${validation.linkContentType}] but was a ${entryInfo.sys.contentType.sys.id}`
      }
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
}