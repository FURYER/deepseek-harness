/** Sound notifications plugin card: audio cues for turns, questions, and approvals. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SwitchField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { SoundNotificationsCardFace } from './sound-notifications-card-controller.ts'
import type {} from './slot-contract.ts'

export type SoundNotificationsCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<SoundNotificationsCardFace>

export function SoundNotificationsCard(props: SoundNotificationsCardProps) {
  const { t } = props
  const state = props.useSoundNotificationsCard(snapshot => snapshot)
  const disabled = !state.writable

  return (
    <PluginCard
      t={t}
      titleKey="soundNotificationsTitle"
      descriptionKey="soundNotificationsDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SwitchField
        id="plugin-config-sound-enabled"
        label={t('soundNotificationsEnabled')}
        hint={t('soundNotificationsEnabledHint')}
        overridden={state.enabled.overridden}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        disabled={disabled}
        enabled={state.enabled.enabled}
        onToggle={() => { props.toggle?.('enabled') }}
        onReset={() => { props.resetField('enabled') }}
      />
      <SwitchField
        id="plugin-config-sound-turn-complete"
        label={t('soundNotificationsOnTurnComplete')}
        hint={t('soundNotificationsOnTurnCompleteHint')}
        overridden={state.onTurnComplete.overridden}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        disabled={disabled || !state.enabled.enabled}
        enabled={state.onTurnComplete.enabled}
        onToggle={() => { props.toggle?.('onTurnComplete') }}
        onReset={() => { props.resetField('onTurnComplete') }}
      />
      <SwitchField
        id="plugin-config-sound-question"
        label={t('soundNotificationsOnQuestion')}
        hint={t('soundNotificationsOnQuestionHint')}
        overridden={state.onQuestion.overridden}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        disabled={disabled || !state.enabled.enabled}
        enabled={state.onQuestion.enabled}
        onToggle={() => { props.toggle?.('onQuestion') }}
        onReset={() => { props.resetField('onQuestion') }}
      />
      <SwitchField
        id="plugin-config-sound-approval"
        label={t('soundNotificationsOnApproval')}
        hint={t('soundNotificationsOnApprovalHint')}
        overridden={state.onApproval.overridden}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        disabled={disabled || !state.enabled.enabled}
        enabled={state.onApproval.enabled}
        onToggle={() => { props.toggle?.('onApproval') }}
        onReset={() => { props.resetField('onApproval') }}
      />
      <ValueField
        id="plugin-config-sound-turn-sound"
        label={t('soundNotificationsTurnCompleteSound')}
        hint={t('soundNotificationsTurnCompleteSoundHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled || !state.enabled.enabled}
        placeholder="Asterisk"
        {...state.turnCompleteSound}
        onEdit={(text) => { props.edit('turnCompleteSound', text) }}
        onReset={() => { props.resetField('turnCompleteSound') }}
      />
      <ValueField
        id="plugin-config-sound-question-sound"
        label={t('soundNotificationsQuestionSound')}
        hint={t('soundNotificationsQuestionSoundHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled || !state.enabled.enabled}
        placeholder="Exclamation"
        {...state.questionSound}
        onEdit={(text) => { props.edit('questionSound', text) }}
        onReset={() => { props.resetField('questionSound') }}
      />
    </PluginCard>
  )
}
