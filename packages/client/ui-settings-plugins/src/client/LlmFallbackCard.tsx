/** LLM Fallback plugin card: automatic model failover on rate limits and quota errors. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SwitchField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { LlmFallbackCardFace } from './llm-fallback-card-controller.ts'
import type {} from './slot-contract.ts'

export type LlmFallbackCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<LlmFallbackCardFace>

export function LlmFallbackCard(props: LlmFallbackCardProps) {
  const { t } = props
  const state = props.useLlmFallbackCard(snapshot => snapshot)
  const disabled = !state.writable

  return (
    <PluginCard
      t={t}
      titleKey="llmFallbackTitle"
      descriptionKey="llmFallbackDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SwitchField
        id="plugin-config-llm-fallback-enabled"
        label={t('llmFallbackEnabled')}
        hint={t('llmFallbackEnabledHint')}
        overridden={state.enabled.overridden}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        disabled={disabled}
        enabled={state.enabled.enabled}
        onToggle={() => { props.toggle?.('enabled') }}
        onReset={() => { props.resetField('enabled') }}
      />
      <ValueField
        id="plugin-config-llm-fallback-cooldown"
        label={t('llmFallbackDefaultCooldownMs')}
        hint={t('llmFallbackDefaultCooldownMsHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled || !state.enabled.enabled}
        placeholder="60000"
        {...state.defaultCooldownMs}
        onEdit={(text) => { props.edit('defaultCooldownMs', text) }}
        onReset={() => { props.resetField('defaultCooldownMs') }}
      />
      <ValueField
        id="plugin-config-llm-fallback-models"
        label={t('llmFallbackModels')}
        hint={t('llmFallbackModelsHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled || !state.enabled.enabled}
        placeholder='[{"provider":"google","model":"gemini-2.5-flash"}]'
        {...state.fallbackModelsJson}
        onEdit={(text) => { props.edit('fallbackModels', text) }}
        onReset={() => { props.resetField('fallbackModels') }}
      />
    </PluginCard>
  )
}
