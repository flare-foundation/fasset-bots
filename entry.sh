#!/bin/bash
source <(grep -v '^#' "./.env" | sed -E 's|^(.+)=(.*)$|: ${\1=\2}; export \1|g')

USAGE_MSG="usage: entry [run-bots|run-liquidator|run-challenger]"

if [[ $# -ne 1 ]]; then
    echo $USAGE_MSG
    exit 1
fi

case $1 in
    run-bots)
        echo 'starting back-end and run-agent'
        yarn run-agent &
        yarn start_agent_api &
        ;;
    run-liquidator)
        echo 'starting liquidator'
        yarn run-liquidator &
        ;;
    run-challenger)
        echo 'starting challenger'
        yarn run-challenger &
        ;;
    *)
        echo "invalid argument: '$1'"
        echo $USAGE_MSG
        exit 1
esac

trap "echo 'caught SIGTERM, killing children'; kill 0" TERM INT

wait