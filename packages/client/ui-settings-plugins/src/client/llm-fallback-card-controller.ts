/** The LLM fallback card controller over the `llm-fallback` settings namespace. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ModelProviderGroup } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
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
  fallbackModels: FallbackModelItem[]
  catalogGroups: readonly ModelProviderGroup[]
  catalogLoading: boolean
}

export interface LlmFallbackCardFace extends CardActions {
  hooks: {
    llmFallbackCard: SnapshotStore<LlmFallbackCardState>
  }
  addModel: (item: FallbackModelItem) => void
  removeModel: (index: number) => void
  moveModel: (fromIndex: number, toIndex: number) => void
}

export class LlmFallbackCardController {
  private readonly form: CardForm<LlmFallbackSettings>
  private readonly store: SnapshotStore<LlmFallbackCardState>
  private catalogGroups: readonly ModelProviderGroup[] = []
  private catalogLoading = false
  private draftModels: FallbackModelItem[] | null = null

  constructor(
    private readonly scope: SettingsScope<LlmFallbackSettings>,
    private readonly ctx: ClientContext,
  ) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
      numberField('defaultCooldownMs'),
    ])
    this.store = createSnapshotStore<LlmFallbackCardState>(this.projection())
    this.form.bind(() => {
      this.publish()
    })
    void this.loadCatalog()
  }

  private async loadCatalog(): Promise<void> {
    this.catalogLoading = true
    this.publish()
    try {
      const res = await this.ctx.remote.session.modelCatalog()
      if (res.ok && res.value?.groups) {
        this.catalogGroups = res.value.groups
      }
    } catch (e) {
      console.error('[llm-fallback-card] failed to load model catalog:', e)
    } finally {
      this.catalogLoading = false
      this.publish()
    }
  }

  private publish(): void {
    this.store.set(this.projection())
  }

  private getEffectiveModels(): FallbackModelItem[] {
    if (this.draftModels !== null) {
      return this.draftModels
    }
    const current = this.scope.getSnapshot().current
    return current?.fallbackModels ? [...current.fallbackModels] : []
  }

  private projection(): LlmFallbackCardState {
    const shell = this.form.shell()
    const models = this.getEffectiveModels()
    const isDirty = shell.dirty || this.draftModels !== null

    return {
      ...shell,
      dirty: isDirty,
      enabled: this.form.boolField('enabled', true),
      defaultCooldownMs: this.form.field('defaultCooldownMs'),
      fallbackModels: models,
      catalogGroups: this.catalogGroups,
      catalogLoading: this.catalogLoading,
    }
  }

  addModel(item: FallbackModelItem): void {
    const current = [...this.getEffectiveModels(), item]
    this.draftModels = current
    this.publish()
  }

  removeModel(index: number): void {
    const current = this.getEffectiveModels().filter((_, i) => i !== index)
    this.draftModels = current
    this.publish()
  }

  moveModel(fromIndex: number, toIndex: number): void {
    const current = [...this.getEffectiveModels()]
    const [moved] = current.splice(fromIndex, 1)
    if (moved) {
      current.splice(toIndex, 0, moved)
      this.draftModels = current
      this.publish()
    }
  }

  async save(): Promise<void> {
    if (this.draftModels !== null) {
      await this.scope.set('fallbackModels', this.draftModels)
      this.draftModels = null
    }
    await this.form.save()
    this.publish()
  }

  discard(): void {
    this.draftModels = null
    this.form.discard()
    this.publish()
  }

  inject(): LlmFallbackCardFace {
    return {
      hooks: { llmFallbackCard: this.store },
      ...this.form.actions(),
      save: () => { void this.save() },
      discard: () => { this.discard() },
      addModel: (item) => { this.addModel(item) },
      removeModel: (idx) => { this.removeModel(idx) },
      moveModel: (from, to) => { this.moveModel(from, to) },
    }
  }
}
