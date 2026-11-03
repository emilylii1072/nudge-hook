import type { Register } from 'claude-code'

import {
  average,
  echoesReply,
  parseScoreReply,
  recentAverage,
  shouldNudgeForRecent,
  shouldNudgeForSilence,
  shouldWarnBeforeSend,
} from './engagement'
import type { Scored } from './engagement'
import { FILLERS, GROUP_LABELS, pickFillers, randomFiller } from './fillers'
import type { FillerGroup } from './fillers'
import { RUBRIC } from './rubric'

const SEND = 'Send as it is'
// const CHOOSE = 'Choose a sentence starter' // selection dialog, switched off: a random starter is used instead
const EDIT = 'Write my own'
const TASK_QUESTION = 'While Claude works: what is the task you are doing?'
const WORKING_QUESTION_MS = 60_000 // how long Claude works before the question is asked
const MAX_REPLY_CHARS = 4000
const OLD_REPLY_CHARS = 1500
const WINDOW = 5 // exchanges the scorer sees
const MAX_EVENTS = 1500

type Row = {
  created: string
  session: string
  kind: 'prompt' | 'reply' | 'warning' | 'nudge' | 'question'
  action: string
  text: string
  score: number | null
  rationale: string
  model: string
  echo: boolean
  mean_all: number | null
  mean_recent: number | null
}

const means = (scores: readonly number[]) => ({ mean_all: average(scores), mean_recent: recentAverage(scores) })

async function log($: any, scores: readonly number[], event: Partial<Row> & Pick<Row, 'kind'>) {
  try {
    const row: Row = {
      created: new Date(await $.clock.now()).toISOString(),
      session: await $.session.id(),
      action: '',
      text: '',
      score: null,
      rationale: '',
      model: '',
      echo: false,
      ...means(scores),
      ...event,
    }
    const events = ((await $.store.get('events')) as Row[] | undefined) ?? []
    await $.store.set('events', [...events, row].slice(-MAX_EVENTS))
  } catch {
    // logging must never get in the way
  }
}

function showStatus($: any, scores: readonly number[]) {
  const avg = average(scores)
  $.ui.status(
    avg === null
      ? 'Nudge: no messages scored yet'
      : `Nudge: engagement ${avg.toFixed(1)} / 3 over ${scores.length} messages | last ${Math.min(2, scores.length)}: ${scores.slice(-2).join(', ')}`,
  )
}

const BACK = 'Back'

/** Two dialogs: the group of starter, then the starter. Null when the person backs out. */
async function chooseFiller($: any): Promise<string | null> {
  const groups = Object.keys(FILLERS) as FillerGroup[]
  try {
    for (;;) {
      const label = await $.ui.ask('Which kind of sentence starter?', {
        header: 'Starters',
        options: groups.map(g => GROUP_LABELS[g]),
      })
      const group = groups.find(g => GROUP_LABELS[g] === label)
      if (!group) return null
      const list = FILLERS[group]
      const filler = await $.ui.ask(`${GROUP_LABELS[group]}: pick a starter to fill in.`, {
        header: 'Starters',
        options: [...list, BACK],
      })
      if (list.includes(filler)) return filler
      if (filler !== BACK) return null
    }
  } catch (error) {
    $.ui.toast(`Nudge: the starter dialog failed: ${String(error)}`, { timeoutMs: 15_000 })
    return null
  }
}

async function score(
  $: any,
  model: string,
  history: unknown,
  prompt: string,
  pasted: boolean,
): Promise<(Scored & { model: string }) | null> {
  try {
    const r = await $.model.complete({
      model,
      system: RUBRIC,
      prompt: JSON.stringify({ history, prompt, pasted }),
      maxTokens: 1000,
      timeoutMs: 12_000,
    })
    if (!r.isAnswered) return null
    const parsed = parseScoreReply(r.text)
    return parsed ? { ...parsed, model } : null
  } catch {
    return null
  }
}

type Exchange = { user: string; assistant: string }

/** The last WINDOW exchanges as the scorer reads them: the latest reply in full, older ones cut. */
function historyOf(exchanges: readonly Exchange[]) {
  const recent = exchanges.slice(-WINDOW)
  return recent.flatMap((x, i) => {
    const cap = i === recent.length - 1 ? MAX_REPLY_CHARS : OLD_REPLY_CHARS
    const turns = [{ role: 'user', text: x.user }]
    if (x.assistant) turns.push({ role: 'assistant', text: x.assistant.slice(-cap) })
    return turns
  })
}

export const register: Register = (on, options) => {
  const model = String(options.scorerModel || 'claude-opus-5-5')
  const silenceMs = (Number(options.silenceMinutes) || 5) * 60_000

  // The scores of this session. A reload starts them over; the log in $.store stays.
  const scores: number[] = []
  // Every exchange of this session, oldest first; the scorer sees the last WINDOW of them.
  const exchanges: Exchange[] = []
  let quietSince = 0
  let working = false
  let workingSince = 0 // when the current turn started, while working
  let askedFor = -1 // the workingSince the task question was already asked for
  let asking = false
  let silenceShownFor = -1

  on('session.start', async ($, e, next) => {
    quietSince = await $.clock.now()

    // A reload starts the module's variables over: rebuild this session from the log.
    try {
      const sid = await $.session.id()
      const rows = ((await $.store.get('events')) as Row[] | undefined) ?? []
      scores.length = 0
      exchanges.length = 0
      for (const r of rows) {
        if (r.session !== sid) continue
        if (r.kind === 'prompt' && r.score !== null) {
          scores.push(r.score)
          exchanges.push({ user: r.text, assistant: '' })
        } else if (r.kind === 'reply' && exchanges.length > 0) {
          exchanges[exchanges.length - 1].assistant = r.text
        }
      }
    } catch {
      // start fresh
    }
    await $.command.register({
      name: 'nudge-export',
      description: 'Write every scored prompt, reply and nudge to nudge-events.jsonl',
    })
    await $.command.register({
      name: 'prompts',
      description: 'Pick a sentence starter and put it in your prompt box (/prompts list shows them all)',
    })
    showStatus($, scores)

    // Hooks only run on events, so a timer is what notices the clock.
    $.clock.every(30_000, async () => {
      try {
        const now = await $.clock.now()

        // While Claude works on a longer task, ask the person a question instead of leaving them to wait.
        if (working && !asking && askedFor !== workingSince && now - workingSince >= WORKING_QUESTION_MS) {
          asking = true
          askedFor = workingSince
          try {
            // Free text comes back through the dialog's "Other".
            const answer = await $.ui.ask(TASK_QUESTION, { header: 'Question', options: ['Not sure yet', 'Skip'] })
            if (answer !== 'Skip') await log($, scores, { kind: 'question', action: 'what_is_the_task', text: answer })
          } catch {
            // dismissed
          } finally {
            asking = false
          }
          return
        }

        if (working || silenceShownFor === quietSince || !shouldNudgeForSilence(now, quietSince, silenceMs)) return
        silenceShownFor = quietSince
        const starters = pickFillers(['steering', 'counterfactual', 'comprehension'], 3, scores.length)
        const text = `No message in ${Math.round(silenceMs / 60_000)} minutes. Tell Claude what you think should happen next. You could start with:\n${starters.map(f => `• ${f}`).join('\n')}`
        $.ui.toast(`Nudge: ${text}`, { timeoutMs: 12_000 })
        await log($, scores, { kind: 'nudge', action: 'no_prompt_silence', text })
      } catch {
        // a timer that fails should say nothing
      }
    })

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const prompt = e.text.trim()
    // Only what the person typed: not slash commands, injected turns or SDK runs.
    if (e.command || e.isMeta || e.origin.kind !== 'composer' || !prompt || prompt.startsWith('/')) return next(e)

    const now = await $.clock.now()
    const echo = echoesReply(prompt, exchanges.slice(-WINDOW).map(x => x.assistant).join('\n\n'))
    const scored = await score($, model, historyOf(exchanges), prompt, echo)

    // The person is active either way, so the silence clock restarts.
    quietSince = now
    working = true
    workingSince = now

    if (!scored) return next(e)

    let action = 'sent'
    if (shouldWarnBeforeSend(scores, scored.score)) {
      const overall = (average(scores) ?? 0).toFixed(1)
      await log($, scores, { kind: 'warning', action: 'shown', text: prompt, ...scored, echo })
      // A random sentence starter, put in the prompt box when the message is held back.
      const starter = randomFiller()
      let choice: string
      try {
        choice = await $.ui.ask(
          `This message looks like a simple acceptance, and your messages so far average ${overall} out of 3 for engagement. Send it as it is, or write your own. A sentence starter will be put in your prompt box: ${starter}`,
          // { header: 'Nudge', options: [SEND, CHOOSE, EDIT] }, // with the selection dialog
          { header: 'Nudge', options: [SEND, EDIT] },
        )
      } catch {
        choice = EDIT // dismissed
      }
      // let starter: string | null = null
      // if (choice === CHOOSE) {
      //   starter = await chooseFiller($)
      //   if (starter === null) choice = EDIT
      // }
      if (choice !== SEND) {
        working = false
        // A drop clears the prompt box, so fill in the starter once it has.
        const text = starter
        $.clock.after(300, async () => {
          try {
            await $.prompt.fill({ text })
          } catch {
            // if the box cannot take it, the reason below still shows the text
          }
        })
        return { drop: `Held back by the nudger. Fill in the sentence starter or edit your message, then send it again. Your message was: ${e.text}` }
      }
      action = 'sent_after_warning'
    }

    scores.push(scored.score)
    exchanges.push({ user: prompt, assistant: '' })
    await log($, scores, { kind: 'prompt', action, text: prompt, ...scored, echo })
    showStatus($, scores)

    if (shouldNudgeForRecent(scores)) {
      const recent = (recentAverage(scores) ?? 0).toFixed(1)
      const starters = pickFillers(['counterfactual', 'problem', 'steering'], 3, scores.length)
      const text = `Take a more active part: your last two messages average ${recent} out of 3. Try starting your next message with:\n${starters.map(f => `• ${f}`).join('\n')}`
      $.ui.toast(`Nudge: ${text}`, { timeoutMs: 12_000 })
      await log($, scores, { kind: 'nudge', action: 'low_recent_average', text })
    }

    return next(e)
  }).catch(($, e, next) => next(e)) // fail open: a nudger that breaks sending is worse than none

  on('turn.complete', async ($, e, next) => {
    // Only the main loop's reply; a subagent's run is not what the person reads.
    if (e.agentId === undefined) {
      if (exchanges.length > 0) exchanges[exchanges.length - 1].assistant = e.answer
      quietSince = await $.clock.now() // working time does not count as silence
      working = false
      workingSince = 0
      if (e.answer.trim()) await log($, scores, { kind: 'reply', action: e.reason, text: e.answer.slice(0, MAX_REPLY_CHARS) })
    }
    return next(e)
  })

  on('command.run', { command: 'prompts' }, async ($, e) => {
    if (e.args.trim() === 'list') {
      const lines = (Object.keys(FILLERS) as FillerGroup[]).flatMap(g => [
        `${GROUP_LABELS[g]}:`,
        ...FILLERS[g].map(f => `  • ${f}`),
        '',
      ])
      return { text: lines.join('\n') }
    }
    const starter = await chooseFiller($)
    if (starter === null) return { text: 'No sentence starter chosen.' }
    // Running a command clears the prompt box, so fill it once that has happened.
    $.clock.after(300, async () => {
      try {
        await $.prompt.fill({ text: starter })
      } catch {
        // the box could not take it
      }
    })
    return { text: 'Sentence starter added to your prompt box. Fill in the [brackets] and send it.' }
  })

  on('command.run', { command: 'nudge-export' }, async $ => {
    const events = ((await $.store.get('events')) as Row[] | undefined) ?? []
    const path = 'nudge-events.jsonl'
    await $.fs.write(path, events.map(row => JSON.stringify(row)).join('\n') + '\n')
    return { text: `Wrote ${events.length} events to ${path}.` }
  })
}
