#!/bin/sh
set -e

docker stack deploy -c .ci/stack-db.yml university-db
