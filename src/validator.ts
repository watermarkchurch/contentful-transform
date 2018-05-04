import { Transform } from "stream";
import { IEntry, IContentType, IValidation, IField } from "./model";
import {} from './utils'

export interface IValidatorStreamConfig {
  contentTypeGetter: (ct: string) => Promise<IContentType>
}

type ContentTypeMap = { [id: string]: IContentType }

export class ValidatorStream extends Transform {
  private config: Readonly<IValidatorStreamConfig>

  private contentTypes: ContentTypeMap = {}

  constructor(config: IValidatorStreamConfig) {
    super({
      objectMode: true
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
    let errors = contentType.fields.flatMap(fieldDef => {
      const field = chunk.fields[fieldDef.id]
      if (fieldDef.required) {
        if (!field) {
          return [`missing required field ${fieldDef.id}`]
        }
      }

      if (!field) {
        return null
      }

      if(fieldDef.validations) {
        return fieldDef.validations
          .map(v => validateField(fieldDef.id, v, field['en-US']))          
      }
      if (fieldDef.type == 'Array') {
        return validateArray(fieldDef, field['en-US'])
      }
      return null
    }).filter(e => e)

    if (errors.length > 0) {
      console.log('emit event')
      this.emit('invalid', chunk, errors)
    }
    return errors.length == 0
  }
}

function validateField(id: string, validation: IValidation, field: any): string {
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
  }
  return null
}

function validateArray(fieldDef: IField, field: any): string[] {
  if (!Array.isArray(field)) {
    return [`${fieldDef.id} expected to be an array but was ${typeof(field)}`]
  }

  if (fieldDef.required) {
    if (field.length == 0) {
      return [`${fieldDef.id} is required but was empty`]
    }
  }

  if (!fieldDef.items.validations || fieldDef.items.validations.length == 0) {
    return null
  }

  return field.flatMap((item, index) => 
    fieldDef.items.validations.map((v) => 
      validateField(fieldDef.id + '[' + index + ']', v, item)
    )
  )
}