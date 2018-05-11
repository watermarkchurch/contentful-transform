import * as yargs from 'yargs'

import Run from './main'

const argv = yargs
  .usage("$0 [options] <transform>")
  .command('transform', 'The transformation to apply')
  .option('source', {
    alias: 's',
    default: '-',
    describe: 'The source file, or space ID to load. "-" indicates stdin.'
  })
  .option('access-token', {
    alias: 'a',
    describe: 'The contentful access token to use'
  })
  .option('output', {
    alias: 'o',
    describe: 'The output file to write to.  Default stdout.'
  })
  .option('content-type', {
    alias: 'c',
    describe: 'The content type to query for when loading from a space ID'
  })  
  .option('query', {
    alias: 'q',
    describe: 'An entry filter query used when loading from a space ID',
    implies: 'content-type'
  })
  .option('draft', {
    alias: ['d', 'preview'],
    boolean: true,
    describe: 'Run the transform over draft (aka Preview) content',
    implies: 'access-token'
  })
  .option('filter', {
    alias: 'f',
    describe: 'A filtering function to apply after loading the data.'
  })
  .option('raw', {
    boolean: true,
    alias: 'r',
    describe: 'Accept input & write output as a newline-separated stream of objects rather than wrapped in the Contentful export/import format'
  })
  .option('quiet', {
    boolean: true,
    alias: 'x',
    describe: 'Do not output task progress'
  })
  .option('verbose', {
    boolean: true,
    alias: 'v',
    describe: 'Prints additional information and errors after the run finishes'
  })
  .option('validate', {
    boolean: true,
    describe: 'Validates the transformed entries against their content types'
  })
  .example("cat contentful-export.json | $0 'url=url.replace(/\/$/, \"\")'", "processes the file from stdin and trims trailing slashes from URLs")
  .example("$0 -s contentful-export.json -f 'sys.contentType.sys.id==\"foo\"' '_entry.fields.new_field[\"en-US\"]=\"something new\"", "adds a new field to every entry in the given file matching the 'foo' content type")
  .argv

if (!argv.output) {
  argv.output = []
}
else if (!Array.isArray(argv.output)) {
  argv.output = [argv.output]
}

Run({
  source: argv.source || '-',
  accessToken: argv.accessToken || process.env['CONTENTFUL_ACCESS_TOKEN'],
  transform: argv._[0],
  filter: argv.filter,
  raw: argv.raw,
  contentType: argv.contentType,
  query: argv.query,
  output: argv.output,
  draft: argv.draft,
  validate: argv.validate,
  verbose: argv.verbose,
  quiet: argv.quiet
})
  .catch((err) => {
    console.error(err)
  })