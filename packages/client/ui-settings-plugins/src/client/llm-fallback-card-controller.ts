/** The LLM fallback card controller over the `llm-fallback` settings namespace. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  booleanField, CardForm, numberField, type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

export const LLM_FALLBACK_NS = 'llm-fallback'

export interface FallbackModelItem {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface LlmFallbackSettings {
  enabled?: boolean
  defaultCooldownMs?: number
  fallbackModels?: FallbackModelItem[]
}

export interface LlmFallbackCardState extends CardShell {
  enabled: { enabled: boolean; overridden: boolean; invalid: boolean }
  defaultCooldownMs: CardFieldState
  fallbackModelsJson: CardFieldState
}

export interface LlmFallbackCardFace extends CardActions {
  hooks: {
    llmFallbackCard: SnapshotStore<LlmFallbackCardState>
  }
}

export class LlmFallbackCardController {
  private readonly form: CardForm<LlmFallbackSettings>
  private readonly store: SnapshotStore<LlmFallbackCardState>

  constructor(scope: SettingsScope<LlmFallbackSettings>) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
      numberField('defaultCooldownMs'),
      {
        field: 'fallbackModels',
        format: (val) => {
          if (!val || !Array.isArray(val) || val.length === 0) return ''
          return JSON.stringify(val, null, 2)
        },
        parse: (text) => {
          const trimmed = text.trim()
          if (!trimmed) return { kind: 'clear' }
          try {
            const parsed = JSON.parse(trimmed)
            if (Array.isArray(parsed)) {
              return { kind: 'set', value: parsed }
            }
            return undefined
          } catch {
            return undefined
          }
        },
      },
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): LlmFallbackCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.boolField('enabled', true),
      defaultCooldownMs: this.form.field('defaultCooldownMs'),
      fallbackModelsJson: this.form.field('fallbackModels'),
    }
  }

  inject(): LlmFallbackCardFace {
    return {
      hooks: { llmFallbackCard: this.store },
      ...this.form.actions(),
    }
  }
}
