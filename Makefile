.PHONY: help install compile watch lint package build install-ext clean

UID := $(shell id -u)
GID := $(shell id -g)
NODE = docker compose run --rm --user $(UID):$(GID) -e HOME=/tmp node sh -c
NODE_ROOT = docker compose run --rm node sh -c
VERSION := $(shell grep '"version"' package.json | head -1 | sed -E 's/.*"version": "([^"]+)".*/\1/')
VSIX = puthtotalk-$(VERSION).vsix

help:
	@echo "Available targets:"
	@echo "  make install      - install npm dependencies"
	@echo "  make compile      - compile TypeScript to out/"
	@echo "  make watch        - compile in watch mode"
	@echo "  make lint         - run ESLint on src/"
	@echo "  make package      - build $(VSIX)"
	@echo "  make build        - compile + package (alias)"
	@echo "  make install-ext  - install built .vsix into local VS Code"
	@echo "  make clean        - remove out/ and *.vsix"

install:
	$(NODE) "npm install"

compile:
	$(NODE) "./node_modules/.bin/tsc -p ./"

watch:
	$(NODE) "./node_modules/.bin/tsc -watch -p ./"

lint:
	$(NODE) "./node_modules/.bin/eslint src --ext ts"

package: compile
	$(NODE) "npx --yes @vscode/vsce package --out $(VSIX) --allow-missing-repository"

build: package

install-ext:
	code --install-extension $(VSIX)

clean:
	$(NODE_ROOT) "rm -rf out *.vsix"
