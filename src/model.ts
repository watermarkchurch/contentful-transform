

export interface IEntry { 
  sys: { 
    space: { sys: any },
    id: string,
    type: 'Entry',
    createdAt: string,
    updatedAt: string,
    createdBy: { sys: any },
    updatedBy: { sys: any },
    publishedCounter: number,
    version: number,
    publishedBy: { sys: any },
    publishedVersion: number,
    firstPublishedAt: string,
    publishedAt: string,
    contentType: { sys: any } 
 },
 fields: {
  [name: string]: {
    [locale: string]: any
  }
 }
}