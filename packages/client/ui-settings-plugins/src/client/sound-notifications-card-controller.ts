/** The sound-notifications card's staged form over the `sound-notifications` settings namespace. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  booleanField, CardForm, textField, type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

export const SOUND_NOTIFICATIONS_NS = 'sound-notifications'

export interface SoundNotificationsSettings {
  enabled?: boolean
  onTurnComplete?: boolean
  onQuestion?: boolean
  onApproval?: boolean
  turnCompleteSound?: string
  questionSound?: string
}

export interface SoundNotificationsCardState extends CardShell {
  enabled: { enabled: boolean; overridden: boolean; invalid: boolean }
  onTurnComplete: { enabled: boolean; overridden: boolean; invalid: boolean }
  onQuestion: { enabled: boolean; overridden: boolean; invalid: boolean }
  onApproval: { enabled: boolean; overridden: boolean; invalid: boolean }
  turnCompleteSound: CardFieldState
  questionSound: CardFieldState
}

export interface SoundNotificationsCardFace extends CardActions {
  hooks: {
    soundNotificationsCard: SnapshotStore<SoundNotificationsCardState>
  }
}

export class SoundNotificationsCardController {
  private readonly form: CardForm<SoundNotificationsSettings>
  private readonly store: SnapshotStore<SoundNotificationsCardState>

  constructor(scope: SettingsScope<SoundNotificationsSettings>) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
      booleanField('onTurnComplete'),
      booleanField('onQuestion'),
      booleanField('onApproval'),
      textField('turnCompleteSound'),
      textField('questionSound'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): SoundNotificationsCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.boolField('enabled', true),
      onTurnComplete: this.form.boolField('onTurnComplete', true),
      onQuestion: this.form.boolField('onQuestion', true),
      onApproval: this.form.boolField('onApproval', true),
      turnCompleteSound: this.form.field('turnCompleteSound'),
      questionSound: this.form.field('questionSound'),
    }
  }

  inject(): SoundNotificationsCardFace {
    return {
      hooks: { soundNotificationsCard: this.store },
      ...this.form.actions(),
    }
  }
}
