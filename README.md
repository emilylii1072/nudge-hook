# Nudge Hook

A folder that sets up Claude Code so that a nudger checks how actively you prompt. Open Claude Code in this folder and the nudger is on. There is nothing to install.

## What you will see

Each message you send is scored from 0 to 3 for how much of your own thinking it contains (the ICAP scale: passive, active, constructive, interactive). The score is used in three ways.

- **A warning before sending.** If your message is a simple acceptance, such as "ok" or "continue", and your messages so far average below 1.5, the message is held back with a short note. To send it as it is, submit the same message again. To change it, edit it and submit.
- **A nudge after sending.** If your last two messages average below 1.5, a short note suggests adding your own idea, a reason for a choice, or something you disagree with.
- **A nudge for silence.** If you send nothing for 5 minutes, the status line at the bottom suggests telling Claude what you think should happen next. Time while Claude is working does not count.

The status line also shows your average score.

A message that mostly repeats Claude's last reply is scored as pasted, which scores 0 when you add nothing to it.

## Set up

You need [Claude Code](https://claude.com/claude-code) and Node.js 20 or newer.

1. Copy `.env.example` to `.env` and put your Anthropic API key in it. The key is only used to score your messages. Without it, nothing is scored and nothing is blocked.
2. Open a terminal in this folder and run `claude`.
3. When Claude Code asks whether to trust this folder, say yes. The hooks only load in a trusted folder.

## What is sent and saved

- **Sent:** each message you type, with Claude's last reply for context, goes to the Anthropic API to be scored.
- **Saved on your computer:** every scored message, warning and nudge goes in `.nudge/events.jsonl`, with the score, the reason for it, and your averages at that moment. Run `node tools/export-csv.mjs > prompt_events.csv` for a CSV.

## It never gets in your way

If scoring fails for any reason (no key, no network, a slow reply, an error), your message goes through as if the nudger were not there. Slash commands such as `/clear` are never scored.

## How it works

The folder's `.claude/settings.json` registers three hooks.

| Hook | File | Job |
|---|---|---|
| `UserPromptSubmit` | `hooks/user-prompt-submit.mjs` | Scores the message, then holds it back with a warning or lets it through with a nudge. |
| `Stop` | `hooks/stop.mjs` | Notes when Claude finishes, so working time is not counted as silence. |
| status line | `hooks/statusline.mjs` | Shows your average, and the silence nudge after 5 minutes. |

The rules and thresholds are in `lib/engagement.mjs`, and the scoring rubric is `lib/rubric.md`. Change `ENGAGEMENT_THRESHOLD` or `SILENCE_MS` there to change when nudges appear. Set `NUDGE_SCORER_MODEL` in `.env` to use a different model for scoring.

## Things to know

- **No dialog.** A hook cannot show an "Edit / Send anyway" dialog, so the warning works by holding the message back once. Your original text is shown in the note so you can copy it.
- **Pasting.** A hook sees only text, so it cannot tell that you pasted. It can tell when your message repeats Claude's last reply, which is the case that matters here.
- **One status line.** This folder sets Claude Code's status line. If you use your own status line, this folder's replaces it while you work here.
- **Each session starts fresh.** Your average is per session. The log keeps every session.

## Checks

```sh
npm test
```
