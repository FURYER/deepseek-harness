/** LLM Fallback plugin card: interactive picker for provider, model, and reasoning effort. */

import { useState } from 'react'
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

  const [selectedProvider, setSelectedProvider] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedReasoning, setSelectedReasoning] = useState('')

  const groups = state.catalogGroups || []
  const activeProvider = selectedProvider || groups[0]?.id || ''
  const currentGroup = groups.find(g => g.id === activeProvider) || groups[0]

  const activeModel = selectedModel || currentGroup?.models[0]?.id || ''
  const currentModel = currentGroup?.models.find(m => m.id === activeModel) || currentGroup?.models[0]
  const reasoningEfforts = currentModel?.reasoning?.efforts

  const handleAdd = () => {
    if (!activeProvider || !activeModel) return
    props.addModel({
      provider: activeProvider,
      model: activeModel,
      reasoningEffort: selectedReasoning || undefined,
    })
  }

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

      <div style={{ marginTop: 14, padding: '12px 14px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: 8, border: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #38bdf8)' }}>
            🔄 {t('llmFallbackModels')}
          </span>
          <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-secondary, #94a3b8)' }}>
            {t('llmFallbackModelsHint')}
          </span>
        </div>

        {/* Existing models list */}
        {state.fallbackModels && state.fallbackModels.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            {state.fallbackModels.map((item, idx) => (
              <div
                key={`${item.provider}/${item.model}/${idx}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: 'rgba(255, 255, 255, 0.05)',
                  padding: '6px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700, color: '#38bdf8' }}>#{idx + 1}</span>
                  <span><strong>{item.provider}</strong> / {item.model}</span>
                  {item.reasoningEffort && (
                    <span style={{ color: '#94a3b8', fontSize: 11 }}>({item.reasoningEffort})</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {idx > 0 && (
                    <button
                      type="button"
                      disabled={disabled || !state.enabled.enabled}
                      style={{ padding: '2px 8px', fontSize: 11, cursor: 'pointer', borderRadius: 4 }}
                      title="Move Up"
                      onClick={() => { props.moveModel(idx, idx - 1) }}
                    >
                      ▲
                    </button>
                  )}
                  {idx < state.fallbackModels.length - 1 && (
                    <button
                      type="button"
                      disabled={disabled || !state.enabled.enabled}
                      style={{ padding: '2px 8px', fontSize: 11, cursor: 'pointer', borderRadius: 4 }}
                      title="Move Down"
                      onClick={() => { props.moveModel(idx, idx + 1) }}
                    >
                      ▼
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={disabled || !state.enabled.enabled}
                    style={{ padding: '2px 8px', fontSize: 11, color: '#ef4444', cursor: 'pointer', borderRadius: 4 }}
                    title="Remove"
                    onClick={() => { props.removeModel(idx) }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary, #94a3b8)', marginBottom: 12, fontStyle: 'italic' }}>
            No fallback models configured. Add models below to create a priority failover chain.
          </div>
        )}

        {/* Add Model Picker */}
        {groups.length > 0 ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              disabled={disabled || !state.enabled.enabled}
              style={{ flex: 1, minWidth: 120, padding: '6px 8px', borderRadius: 6, fontSize: 12 }}
              value={activeProvider}
              onChange={(e) => {
                setSelectedProvider(e.target.value)
                const grp = groups.find(g => g.id === e.target.value)
                if (grp && grp.models.length > 0 && grp.models[0]) {
                  setSelectedModel(grp.models[0].id)
                  setSelectedReasoning(grp.models[0].reasoning?.defaultEffort || '')
                }
              }}
            >
              {groups.map(g => (
                <option key={g.id} value={g.id}>{g.name || g.id}</option>
              ))}
            </select>

            <select
              disabled={disabled || !state.enabled.enabled}
              style={{ flex: 1, minWidth: 140, padding: '6px 8px', borderRadius: 6, fontSize: 12 }}
              value={activeModel}
              onChange={(e) => {
                setSelectedModel(e.target.value)
                const m = currentGroup?.models.find(x => x.id === e.target.value)
                setSelectedReasoning(m?.reasoning?.defaultEffort || '')
              }}
            >
              {currentGroup?.models.map(m => (
                <option key={m.id} value={m.id}>{m.name || m.id}</option>
              ))}
            </select>

            {reasoningEfforts && reasoningEfforts.length > 0 && (
              <select
                disabled={disabled || !state.enabled.enabled}
                style={{ minWidth: 110, padding: '6px 8px', borderRadius: 6, fontSize: 12 }}
                value={selectedReasoning}
                onChange={e => setSelectedReasoning(e.target.value)}
              >
                <option value="">Default thinking</option>
                {reasoningEfforts.map(eff => (
                  <option key={eff.id} value={eff.id}>{eff.name || eff.id}</option>
                ))}
              </select>
            )}

            <button
              type="button"
              disabled={disabled || !state.enabled.enabled}
              style={{
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: 600,
                background: '#38bdf8',
                color: '#0f172a',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
              }}
              onClick={handleAdd}
            >
              + Add Fallback
            </button>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            {state.catalogLoading ? 'Loading models catalog...' : 'No model providers available'}
          </div>
        )}
      </div>
    </PluginCard>
  )
}
