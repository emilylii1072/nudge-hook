# Nudge

Nudge is a Claude Code plugin that checks how much of your own thinking goes into each message you send to Claude, and nudges you when you are only accepting its work.

## What you will see

Each message you send is scored from 0 to 3 for how much thinking of your own it contains. The scale is ICAP: 0 passive, 1 active, 2 constructive, 3 interactive. The scorer reads your new message together with up to your last 5 exchanges with Claude, so it can tell whether you are repeating yourself or responding to something Claude said earlier. Repeating a question or point you already made scores 0.

- **A dialog before sending.** If your message is a simple acceptance, such as "ok" or "continue", and your messages so far average below 1.5, the message is held back. You can send it as it is, choose a sentence starter, or write your own. Choosing a sentence starter first asks for a kind (counterfactual reasoning, comprehension, problem identification or steering), then shows the starters of that kind. The one you pick goes into your prompt box with `[brackets]` for you to fill in.
- **A popup after sending.** If your last two messages average below 1.5, a popup in the top right suggests sentence starters.
- **A popup for silence.** If you send nothing for 5 minutes, a popup suggests telling Claude what you think should happen next. Time while Claude is working does not count.
- **The status line.** It shows your overall average and your last two scores, for example `Nudge: engagement 1.7 / 3 over 4 messages | last 2: 2, 1`.

## Install

In a Claude Code terminal session:

```
/plugin install nudge --marketplace emilylii1072/nudge-hook
```

Answer `y` to add the marketplace, then pick a scope. The plugin is active as soon as it is installed. This repository is private, so you need to be invited on GitHub, and your computer needs a git credential for github.com (an SSH key, or run `gh auth login` and then `gh auth setup-git`).

The plugin uses Claude Code's plugin API, which is in early access. If it stops working after a Claude Code update, tell the person who gave it to you.

## Settings

Both settings are in the plugin's section of `/config`.

- **Scorer model.** The model that scores your messages. The default is `claude-opus-5-5`.
- **Silence nudge (minutes).** How long before the silence popup. The default is 5.

## What is sent and saved

- **Sent for scoring:** each message you type, with the last 5 exchanges for context, goes to the scorer model through your own Claude Code session. No separate API key is needed, and the calls count toward your own usage.
- **Saved on your computer:** every scored message, Claude reply, warning and nudge is kept in the plugin's local store, with its score and the reason for it. Nothing is uploaded anywhere.
- **Export:** run `/nudge-export` to write everything to `nudge-events.jsonl` in the folder where you started Claude Code.

## It never gets in your way

If scoring fails for any reason, your message goes through as if the plugin were not there. Slash commands are never scored.

## Files

- `hooks/register.ts` registers the hooks and shows the dialogs and popups.
- `hooks/engagement.ts` holds the rules for when to warn or nudge.
- `hooks/rubric.ts` holds the scoring rubric.
- `hooks/fillers.ts` holds the sentence starters.
- `lib/rubric.md` is the original rubric, which the analysis scripts read. `rubric_with_history.md` is the rubric the plugin uses, and `hooks/rubric.ts` is generated from it. `sentence_fillers.md` is the list that `hooks/fillers.ts` copies.

## License

MIT. See `LICENSE`.
