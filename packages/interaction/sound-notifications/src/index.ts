/**
 * Host audio notifications for agent turn completions, user questions, and approvals.
 *
 * @module @deepseek-ai/dsh-sound-notifications
 */

import { spawn } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-user-approval'

export const name = 'sound-notifications'
export const SOUND_NOTIFICATIONS_SETTINGS_NAMESPACE = 'sound-notifications'

export interface SoundNotificationsConfig {
  /** Whether sound notifications are enabled (default true). */
  enabled?: boolean
  /** Whether to play sound on turn completion (default true). */
  onTurnComplete?: boolean
  /** Whether to play sound on user questions (default true). */
  onQuestion?: boolean
  /** Whether to play sound on user approval requests (default true). */
  onApproval?: boolean
  /** Sound type or command for turn completion ('Asterisk' on Windows by default). */
  turnCompleteSound?: string
  /** Sound type or command for question/approval ('Exclamation' on Windows by default). */
  questionSound?: string
}

export const Config: z<SoundNotificationsConfig> = z.object({
  enabled: z.boolean().default(true),
  onTurnComplete: z.boolean().default(true),
  onQuestion: z.boolean().default(true),
  onApproval: z.boolean().default(true),
  turnCompleteSound: z.string().default('Asterisk'),
  questionSound: z.string().default('Exclamation'),
})

export interface SoundNotificationsInternals {
  /** Test hook for sound playback. */
  play?: (sound: string) => void
}

/**
 * Play a host audio notification asynchronously without blocking the event loop.
 *
 * @param sound - System sound identifier or path to a sound file.
 */
export function playHostSound(sound: string): void {
  try {
    if (process.platform === 'win32') {
      const psCommand = sound.endsWith('.wav')
        ? `(New-Object System.Media.SoundPlayer '${sound.replaceAll("'", "''")}').PlaySync()`
        : `[System.Media.SystemSounds]::${sound}.Play(); Start-Sleep -Milliseconds 600`
      const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCommand], {
        stdio: 'ignore',
        windowsHide: true,
        detached: false,
      })
      proc.on('error', () => {})
      proc.unref()
    } else if (process.platform === 'darwin') {
      const proc = spawn('afplay', ['/System/Library/Sounds/Glass.aiff'], {
        stdio: 'ignore',
        detached: true,
      })
      proc.on('error', () => {})
      proc.unref()
    } else {
      const proc = spawn('paplay', ['/usr/share/sounds/freedesktop/stereo/complete.oga'], {
        stdio: 'ignore',
        detached: true,
      })
      proc.on('error', () => {
        try {
          process.stdout.write('\x07')
        } catch {}
      })
      proc.unref()
    }
  } catch {
    // Audio playback failures must never disrupt agent lifecycle.
  }
}

/**
 * Install listeners for turn completions, user questions, and approvals.
 *
 * @param ctx - Cordis context.
 * @param config - Plugin configuration.
 * @param internals - Test internals for deterministic hooks.
 */
export function apply(
  ctx: Context,
  config: SoundNotificationsConfig = {},
  internals: SoundNotificationsInternals = {},
): void {
  const play = internals.play ?? playHostSound
  let currentConfig: SoundNotificationsConfig = { ...config }

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(
      ctx,
      SOUND_NOTIFICATIONS_SETTINGS_NAMESPACE,
      Config,
      config,
      {
        setSource: (source) => {
          currentConfig = source()
        },
        onChange: () => {},
      },
    )
  })

  ctx.on('user-questions/request', (_request, next) => {
    if (currentConfig.enabled !== false && currentConfig.onQuestion !== false) {
      play(currentConfig.questionSound ?? 'Exclamation')
    }
    return next()
  })

  ctx.on('approval/request', (_request, next) => {
    if (currentConfig.enabled !== false && currentConfig.onApproval !== false) {
      play(currentConfig.questionSound ?? 'Exclamation')
    }
    return next()
  })

  ctx.on('session/event', (_session, event: SessionEvent) => {
    if (currentConfig.enabled === false || currentConfig.onTurnComplete === false) return
    if (event.type === 'turn/end') {
      const reason = (event.data as { reason?: { kind?: string } })?.reason
      if (reason?.kind === 'completed') {
        play(currentConfig.turnCompleteSound ?? 'Asterisk')
      }
    }
  })
}
