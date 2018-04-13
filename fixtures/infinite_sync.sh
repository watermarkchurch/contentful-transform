#! /usr/bin/env bash

COLOR_NC='\033[0m' # No Color
COLOR_LGREEN='\033[1;32m'
COLOR_GRAY='\033[1;30m'
COLOR_LGRAY='\033[0;37m'
COLOR_RED='\033[0;31m'

logv() {
  [[ -z "$VERBOSE" ]] && return 0;

  local msg=$(echo "$@" | sed "s/$CONTENTFUL_ACCESS_TOKEN/\*\*\*\*\*/" )
  >&2 echo -e "${COLOR_GRAY}$msg${COLOR_NC}" || true
}

logerr() {
  >&2 echo -e "${COLOR_RED}$@${COLOR_NC}"
}

curlv() {
  execv curl "$@"
}

execv() {
  logv "$@"
  "$@"
}

# Write your usage
usage() {
  echo "$0
  Uses the Contentful Sync API to generate an infinite stream of entries,
  separated by newlines.  As data is modified, new entry data is written to
  stdout.
  " && \
  grep " .)\ #" $0; exit 0;
}

# Parse additional args here
while getopts ":hvs:a:" arg; do
  case $arg in
    v) # Verbose mode - extra output
      VERBOSE=true
      ;;
    s) # Contentful Space ID - overrides env var CONTENTFUL_SPACE_ID
      export CONTENTFUL_SPACE_ID=$OPTARG
      ;;
    a) # Contentful Access Token - overrides env var CONTENTFUL_ACCESS_TOKEN
      export CONTENTFUL_ACCESS_TOKEN=$OPTARG
      ;;
    h | *) # Display help.
      usage
      exit 0
      ;;
  esac
done

shift $(($OPTIND - 1))

command -v jq >/dev/null 2>&1 || (logerr "I require 'jq' but it's not installed.  Please run 'brew install jq'"; exit -1)

# Exec initial sync
page=$(curlv -s -H "Authorization: Bearer $CONTENTFUL_ACCESS_TOKEN" https://cdn.contentful.com/spaces/$CONTENTFUL_SPACE_ID/sync\?initial=true\&type=Entry)

while true
do
  # write the items to stdout
  echo "$page" | jq -c .items[]

  # if we have more data available right now, it's in `.nextPageUrl`, otherwise it's in `.nextSyncUrl`
  nextUrl=$(echo "$page" | jq -r .nextPageUrl)
  [[ "$nextUrl" == "null" ]] && nextUrl=$(echo "$page" | jq -r .nextSyncUrl)
  logv "next URL: $nextUrl"
  
  numItems=$(echo "$page" | jq -r '.items | length')
  logv "numItems: ${numItems}"

  # If we didn't get a full page, sleep 10 seconds before trying the sync againg
  if [[ $numItems -lt 100 ]]; then
    sleep 10
  fi

  # exec next page or sync
  page=$(curlv -s -H "Authorization: Bearer $CONTENTFUL_ACCESS_TOKEN" $nextUrl)
done