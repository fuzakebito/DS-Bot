const LANGUAGES = new Map([
  ['auto', undefined],
  ['ja', 'Japanese (日本語)'],
  ['en', 'English'],
  ['zh', 'Chinese (简体中文)'],
])

// Validate before installing any runtime module: a typo must not partly start a team.
export function reviewLanguage(value = 'auto') {
  if (!LANGUAGES.has(value)) throw new TypeError('reviewLanguage must be one of: auto, ja, en, zh')
  return LANGUAGES.get(value)
}
