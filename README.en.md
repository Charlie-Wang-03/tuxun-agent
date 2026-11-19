# TuXun Agent

A Windows-local experiment for developers studying visual agents. The agent reads a street view, compass and map, places a guess, and records the observations and actions that led to submission. Use it only for classic five-round games in the map library. Daily challenges, matchmaking and other competitive modes are outside the project scope.

[简体中文](README.md) · [Code and tests](CONTRIBUTING.md) · [License](LICENSE) · [Documentation index for LLMs](llms.txt)

## Try it offline

From the project root on Windows with Node.js 22 or later, run:

```powershell
npm test
```

Offline tests run without installing dependencies. The tests use synthetic records and local interfaces without contacting TuXun or a model. For an example of what the agent records, the [replay test](test/review.test.mjs) shows how a missing round remains unknown even when a later round has a score.

## Run a game

1. Install Google Chrome and run `npm install --ignore-scripts` in the project directory. Both entry points use the project-local Codex CLI 0.170.0. Run `npm run doctor` to verify the executable and version. To sign in if needed, use `.\node_modules\.bin\codex.cmd login`. It does not verify login. Set `CHROME_PATH` for a nonstandard Chrome installation.
2. Run `npm run browser`. In the dedicated Chrome window, sign in to the [map library](https://tuxun.fun/map), choose the mode and timer, and manually start the first game. Keep only the game tab open.
3. Run `npm run dashboard` and open the local address it prints. Match the dashboard settings to the website before starting. Defaults are one game, five minutes and 35 actions per round, and 30 minutes per game.

The dashboard and CLI default to `gpt-6-astra` with `high` reasoning effort. Set both before starting in the dashboard or pass `--model gpt-5.6-sol --reasoning-effort low` to the run command. Each model attempt records the requested pair in `events.jsonl` under `request_config`, including failed attempts. The `codex_cli` field records the checked executable and version. Older logs may omit it.

On 2026-11-19, both the default pair and `gpt-6.2-astra / high` correctly identified a synthetic green image on the tested account. All ten tested models accepted `low`, `medium`, `high` and `xhigh`. All rejected `minimal`. [Compatibility matrix and comparison with CLI 0.150.1](CONTRIBUTING.md#模型与推理强度兼容性)

**Starting the run submits real guesses.** Decision screenshots, observations, action history and verification targets go to the signed-in Codex CLI backend and may incur charges. Stop from the dashboard or with Ctrl+C in the CLI. After the run exits, `npm run stop` closes the dedicated browser. Already dispatched inputs may still complete. [Data handling](SECURITY.md)

Fixed mode allows looking around and zooming. Move mode also allows movement. Fixed-view mode locks the street view. All three allow map zoom and selection and prohibit dragging the map. The user must distinguish fixed from fixed-view on the website. At the end of a round the agent may submit an existing pin or the visible map center as a fallback. Exhausted budgets, failed captures and uncertain input confirmations take priority.

## Review a run

With a local run already recorded, use `npm run review` for the latest summary, or select the run directory in the dashboard to step through events and screenshots. Neither path calls a model. Raw screenshots, browser profiles and logs can contain sensitive information. The CLI option `--verify-current` **submits** a guess and advances the game if confirmed.

Historical live runs cover all three modes on a limited selection of maps. Later prompt and safety changes were checked offline. The redesigned dashboard has simulated layout coverage across 340 combinations; live usability remains unverified. See the [Chinese operating guide](README.md#模式与边界), [validation guide](CONTRIBUTING.md#按改动选择验证), [UI acceptance record](test/UI_UX_ACCEPTANCE.md), and [design decisions](docs/DECISIONS.md).
