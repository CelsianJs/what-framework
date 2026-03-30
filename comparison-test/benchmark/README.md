# Benchmark — Quick Reference

See [STUDY.md](./STUDY.md) for full study design.

## Run a benchmark round

```bash
# All 3 frameworks, random prompt
node comparison-test/benchmark/run.js

# Specific prompt
node comparison-test/benchmark/run.js --prompt expense-tracker

# Specific framework + model
node comparison-test/benchmark/run.js --prompt kanban-board --framework whatfw --model opus
```

## View results

```bash
# Scoreboard in terminal
node comparison-test/benchmark/run.js --scoreboard

# Dashboard with all apps (browse + open each app)
node comparison-test/benchmark/viewer/server.js
# → http://localhost:4000
```

## Available prompts

`pomodoro-timer`, `markdown-notepad`, `weather-dashboard`, `kanban-board`, `expense-tracker`, `real-time-chat`

## Available models

`opus` (Claude Opus 4.6), `sonnet` (Claude Sonnet 4.6), `gpt5` (Codex GPT-5.4), `deepseek` (OpenCode DeepSeek V3), `kimi` (OpenCode Kimi K2)
