import * as yargs from 'yargs'

import Run from './main'

const argv = yargs
  .usage("$0 [options] <transform>")
  .command('transform', 'The transformation to apply')
  .alias('s', 'source').describe('source', 'The source file to load (default reads from stdin)')
  .default('source', '-')
  .alias('o', 'output').describe('output', 'The output file to write to.  Default stdout.')
  .alias('f', 'filter').describe('filter', 'A filtering function to apply')
  .alias('q', 'quiet').describe('quiet', 'Do not output task progress')
  .demandCommand(1)
  .example("cat contentful-export.json | $0 'url=url.replace(/\/$/, \"\")'", "processes the file from stdin and trims trailing slashes from URLs")
  .example("$0 -s contentful-export.json -f 'sys.contentType.sys.id==\"foo\"' '_entry.fields.new_field[\"en-US\"]=\"something new\"", "adds a new field to every entry in the given file matching the 'foo' content type")
  .argv

Run({
  source: argv.source || '-',
  transform: argv._[0],
  filter: argv.filter,
  output: argv.output,
  quiet: argv.quiet
})