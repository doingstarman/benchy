import { describe, it, expect } from 'vitest'
import { FACTORY_RUN_DEFAULTS } from './runDefaults'
import { DEFAULT_PROVIDER_SETTINGS } from '../../src/config'

// The frontend cannot value-import src/config.ts at runtime — it pulls node:fs,
// which is why api.ts takes only its types. So the factory defaults exist twice,
// and a drift between them is silent: the run-settings panel would promise a
// temperature the server never uses.
//
// A test file can import it, because vitest runs in Node even for jsdom specs.
describe('factory run defaults', () => {
  it('match the server values they are a copy of', () => {
    expect(FACTORY_RUN_DEFAULTS).toEqual(DEFAULT_PROVIDER_SETTINGS)
  })
})
