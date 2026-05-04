#!/bin/sh
case "$OSTYPE" in
darwin*)
        echo "Running pod install..."
        cd ios
        pod install
        cd ..
        ;;
esac
