# Everything runs in Docker by default, so the only thing you need is Docker.
# LOCAL=1 runs on the host instead (Node 22+; `npx playwright install chromium`
# for the browser targets).

NODE_IMAGE   := node:22
PW_IMAGE     := mcr.microsoft.com/playwright:v1.64.1-noble
DEMO_IMAGE   := ops-console-demo
PORT         ?= 8080

ifdef LOCAL
NODE :=
PW   :=
else
DOCKER := docker run --rm -u $$(id -u):$$(id -g) -e HOME=/tmp -e NG_CLI_ANALYTICS=false -v "$(CURDIR)":/w -w /w
NODE := $(DOCKER) $(NODE_IMAGE)
PW   := $(DOCKER) --ipc=host $(PW_IMAGE)
endif

.PHONY: install build test e2e check run perf perf-check soak chart demo clean

install:
	$(NODE) npm ci

build: install
	$(NODE) npm run build

## Unit tests (Vitest, through the Angular CLI), server and colour-contrast tests (node:test).
test: install
	$(NODE) npm test

## Playwright: keyboard-only tests, axe in both themes, every store mode.
e2e: build
	$(PW) npx playwright test

check: test e2e

## The app at http://localhost:$(PORT)
run: build
ifdef LOCAL
	PORT=$(PORT) node server/server.mjs
else
	docker run --rm -it -p $(PORT):8080 -e HOST=0.0.0.0 -v "$(CURDIR)":/w -w /w $(NODE_IMAGE) node server/server.mjs
endif

## The full comparison in the README (about 12 minutes).
perf: build
	$(PW) node perf/run.mjs --rates 10000,20000,40000 --seconds 20 --warmup 5 --out perf/results-desktop.json
	$(PW) node perf/run.mjs --throttle 4 --rates 2000,5000,10000 --seconds 20 --warmup 5 --out perf/results-throttled.json
	$(NODE) node perf/chart.mjs

## The quick check CI runs: the batched store at 10,000 events/s, loose thresholds.
perf-check: build
	$(PW) node perf/run.mjs --modes batched --rates 10000 --seconds 15 --warmup 5 --out perf/check.json --check

## Ten minutes at 10,000 events/s; fails if the heap or the DOM keeps growing.
soak: build
	$(PW) node perf/soak.mjs --minutes 10 --check

chart:
	$(NODE) node perf/chart.mjs

## Records docs/demo.gif (needs ffmpeg, hence its own image).
demo: build
	docker build -q -f docker/demo.Dockerfile -t $(DEMO_IMAGE) .
	docker run --rm -u $$(id -u):$$(id -g) -e HOME=/tmp --ipc=host -v "$(CURDIR)":/w -w /w $(DEMO_IMAGE) node scripts/demo.mjs

clean:
	rm -rf dist .angular tmp test-results playwright-report perf/check.json
