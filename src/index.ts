import * as yargs from 'yargs'

import Run from './main'

const argv = yargs
  .argv

Run(argv as any)