module.exports = function (entry) {
  if(entry.sys.contentType.sys.id == "submenu") {
    entry.fields.newField = { 'en-US': 'asdf' }
  } else if (entry.sys.contentType.sys.id == 'MenuItem') {
    entry.fields.title['en-US'] = entry.fields.title['en-US'] + '1'
  }
}