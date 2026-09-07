import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { apply } from '../src/index.ts'

describe('sound-notifications', () => {
  it('triggers questionSound on user-questions/request', async () => {
    const ctx = new Context()
    const played: string[] = []
    apply(ctx, {}, { play: s => played.push(s) })

    const result = await ctx.waterfall('user-questions/request', {} as never, () => Promise.resolve({ answers: [] }))
    expect(played).toEqual(['Exclamation'])
    expect(result).toEqual({ answers: [] })
  })

  it('triggers questionSound on approval/request', async () => {
    const ctx = new Context()
    const played: string[] = []
    apply(ctx, {}, { play: s => played.push(s) })

    const result = await ctx.waterfall('approval/request', {} as never, () => Promise.resolve('allowed-once'))
    expect(played).toEqual(['Exclamation'])
    expect(result).toBe('allowed-once')
  })

  it('triggers turnCompleteSound on turn/end with completed kind', () => {
    const ctx = new Context()
    const played: string[] = []
    apply(ctx, {}, { play: s => played.push(s) })

    ctx.emit('session/event', {} as never, {
      type: 'turn/end',
      data: { reason: { kind: 'completed' } },
    } as unknown as SessionEvent)
    expect(played).toEqual(['Asterisk'])
  })

  it('does not trigger on turn/end when reason is error or aborted', () => {
    const ctx = new Context()
    const played: string[] = []
    apply(ctx, {}, { play: s => played.push(s) })

    ctx.emit('session/event', {} as never, {
      type: 'turn/end',
      data: { reason: { kind: 'error' } },
    } as unknown as SessionEvent)
    expect(played).toEqual([])
  })

  it('honors enabled: false', async () => {
    const ctx = new Context()
    const played: string[] = []
    apply(ctx, { enabled: false }, { play: s => played.push(s) })

    await ctx.waterfall('user-questions/request', {} as never, () => Promise.resolve({ answers: [] }))
    ctx.emit('session/event', {} as never, {
      type: 'turn/end',
      data: { reason: { kind: 'completed' } },
    } as unknown as SessionEvent)
    expect(played).toEqual([])
  })

  it('honors custom sound configuration', async () => {
    const ctx = new Context()
    const played: string[] = []
    apply(ctx, {
      turnCompleteSound: 'tada.wav',
      questionSound: 'notify.wav',
    }, { play: s => played.push(s) })

    await ctx.waterfall('user-questions/request', {} as never, () => Promise.resolve({ answers: [] }))
    ctx.emit('session/event', {} as never, {
      type: 'turn/end',
      data: { reason: { kind: 'completed' } },
    } as unknown as SessionEvent)
    expect(played).toEqual(['notify.wav', 'tada.wav'])
  })
})
