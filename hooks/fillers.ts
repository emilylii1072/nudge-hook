// Sentence fillers (see nudge-hook/sentence_fillers.md). Replace each [part] with your own words.
export type FillerGroup = 'counterfactual' | 'comprehension' | 'problem' | 'steering'

export const FILLERS: Record<FillerGroup, readonly string[]> = {
  counterfactual: [
    'Could you be wrong because [reason]',
    'How about strategies of [alternative strategy(ies)] instead of [current strategy] because of [reason]',
    'I do not understand why [LLM output] because of [your concern]',
  ],
  comprehension: [
    'Can you explain [LLM output] to help me understand…',
    'What is [LLM output]?',
    'Why are we using [LLM output]?',
  ],
  problem: ["I think [problem with current output] is wrong because [reason it's wrong]; you should [proposed solution]"],
  steering: [
    'You should now [plan of next subtask you want to work on]',
    'You should evaluate your work with respect to [evaluation criteria for LLM]',
  ],
}

export const GROUP_LABELS: Record<FillerGroup, string> = {
  counterfactual: 'Counterfactual reasoning',
  comprehension: 'Comprehension',
  problem: 'Problem identification',
  steering: 'Steering',
}

/** One starter picked at random from all the groups. */
export function randomFiller(): string {
  const all = ([] as string[]).concat(...Object.values(FILLERS))
  return all[Math.floor(Math.random() * all.length)]
}

/** n starters, one per group in the order given, rotating through each group as `turn` grows. */
export function pickFillers(groups: readonly FillerGroup[], n: number, turn: number): string[] {
  const picked: string[] = []
  for (let i = 0; i < n; i++) {
    const list = FILLERS[groups[i % groups.length]]
    const filler = list[(turn + i) % list.length]
    if (!picked.includes(filler)) picked.push(filler)
  }
  return picked
}
