/**
 * Task Board plugin for DeepSeek Harness.
 *
 * @module @deepseek-ai/dsh-task-board
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { loadStoredState, persistState } from './store.ts'
import { checkoutBranch, ensureGitBranch, getCurrentBranch, mergeBranch } from './git.ts'
import type { BoardProject, BoardTask, BoardWorker, FallbackModel, TaskAttachment, TaskBoardState, TaskFeedback } from './types.ts'

export * from './types.ts'

export const name = 'task-board'
export const inject = ['agents', 'sessions', 'commands', 'workspaceRegistry', 'agentPresets', 'llm']

declare module '@deepseek-ai/cordis' {
  interface Context {
    taskBoard: TaskBoardService
  }
  interface Events {
    'task-board/updated'(state: TaskBoardState): void
  }
}

export class TaskBoardService {
  private state: TaskBoardState
  private baseBranch = 'master'
  private dispatching = false
  // Cooldown map: `${provider}/${model}` -> cooldown expiry timestamp (ms)
  private modelCooldowns = new Map<string, number>()

  constructor(private readonly ctx: Context) {
    this.state = loadStoredState()
    void this.init()
  }

  private async init(): Promise<void> {
    this.baseBranch = await getCurrentBranch()

    // Register LLM waterfall to intercept rate limit (429/RPM) errors and fallback dynamically
    this.ctx.on('llm/stream', async function* (options, next) {
      const self = this as any
      const boardService = self.ctx?.taskBoard as TaskBoardService | undefined
      const sessionId = options.sessionId ? String(options.sessionId) : undefined

      // Find if this session belongs to a task-board worker with fallback models configured
      let worker: BoardWorker | undefined
      if (sessionId && boardService) {
        const task = boardService.state.tasks.find(t => t.sessionId === sessionId)
        if (task && task.assignedWorkerId) {
          worker = boardService.state.workers.find(w => w.id === task.assignedWorkerId)
        }
      }

      // If no fallback models configured on worker, proceed with default flow
      if (!worker?.fallbackModels || worker.fallbackModels.length === 0) {
        yield* next()
        return
      }

      // Build model chain: primary worker model + configured fallback models in priority order
      const chain: Array<{ provider: string; model: string; reasoningEffort?: string | undefined }> = [
        {
          provider: worker.provider,
          model: worker.model,
          ...(worker.reasoningEffort !== undefined ? { reasoningEffort: worker.reasoningEffort } : {}),
        },
        ...worker.fallbackModels.map(f => ({
          provider: f.provider,
          model: f.model,
          ...(f.reasoningEffort !== undefined ? { reasoningEffort: f.reasoningEffort } : {}),
        })),
      ]

      // Filter chain to prioritize models not currently on cooldown
      const now = Date.now()
      const activeChain = chain.filter((m) => {
        const expiry = boardService?.modelCooldowns.get(`${m.provider}/${m.model}`) ?? 0
        return now >= expiry
      })
      const candidates = activeChain.length > 0 ? activeChain : chain

      // Try calling candidates sequentially if rate limits or quota errors occur
      let lastFailure: any = null
      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i]!
        const reqOptions = {
          ...options,
          provider: candidate.provider,
          model: candidate.model,
          ...(candidate.reasoningEffort ? { reasoningEffort: candidate.reasoningEffort as any } : {}),
        }

        let chunkCount = 0
        let rateLimitError = false
        let terminalError: any = null

        try {
          const stream = self.stream(reqOptions)
          for await (const chunk of stream) {
            chunkCount++
            if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
              const code = chunk.reason.failure.code
              const msg = chunk.reason.failure.message || ''
              if (
                code === 'RATE_LIMIT' ||
                code === 'QUOTA_EXCEEDED' ||
                /\b429\b|rate.?limit|quota|resource.?exhausted|too many requests/i.test(msg)
              ) {
                rateLimitError = true
                terminalError = chunk.reason.failure
                break
              }
            }
            yield chunk
          }
        } catch (err: any) {
          const errMsg = String(err?.message || err)
          if (
            err?.code === 'RATE_LIMIT' ||
            err?.code === 'QUOTA_EXCEEDED' ||
            /\b429\b|rate.?limit|quota|resource.?exhausted|too many requests/i.test(errMsg)
          ) {
            rateLimitError = true
            terminalError = err
          } else {
            throw err
          }
        }

        if (rateLimitError) {
          // Dynamically detect provider retry delay if present in failure/error
          let retryDelayMs = 60_000 // default fallback if no explicit delay is reported
          if (terminalError && typeof terminalError === 'object') {
            if (typeof terminalError.providerRetryAfterMs === 'number' && terminalError.providerRetryAfterMs > 0) {
              retryDelayMs = terminalError.providerRetryAfterMs
            } else if (typeof terminalError.retryAfter === 'number' && terminalError.retryAfter > 0) {
              retryDelayMs = terminalError.retryAfter * 1000
            } else {
              const msg = String(terminalError.message || terminalError)
              const match = /(?:please retry in|retry in|retry after|resets in)\s*(\d+(?:\.\d+)?)\s*s\b/i.exec(msg)
                ?? /"retryDelay":\s*"(\d+(?:\.\d+)?)s?"/i.exec(msg)
                ?? /retry-after:\s*(\d+)/i.exec(msg)
              if (match?.[1]) {
                const s = parseFloat(match[1])
                if (Number.isFinite(s) && s > 0) {
                  retryDelayMs = Math.ceil(s * 1000)
                }
              }
            }
          }

          const retrySeconds = Math.round(retryDelayMs / 1000)
          console.warn(`[TaskBoard Fallback] Model ${candidate.provider}/${candidate.model} hit rate limit. Setting ${retrySeconds}s cooldown.`)
          // Put this model in cooldown for the detected delay
          boardService?.modelCooldowns.set(`${candidate.provider}/${candidate.model}`, Date.now() + retryDelayMs)
          lastFailure = terminalError
          // If chunks were already yielded, we cannot replay cleanly from mid-stream, but for 429 it almost always fails immediately
          if (i + 1 < candidates.length && chunkCount <= 1) {
            console.info(`[TaskBoard Fallback] Seamlessly switching to fallback model: ${candidates[i + 1]!.provider}/${candidates[i + 1]!.model}`)
            continue
          }
        }

        return
      }

      // If all candidates failed with rate limits
      if (lastFailure) {
        yield {
          type: 'finish',
          reason: { kind: 'error', failure: lastFailure },
        } as any
      }
    })

    this.ctx.on('session/event', (_session, event: SessionEvent) => {
      if (event.type === 'turn/start') {
        this.onTurnStarted(_session.id)
      } else if (event.type === 'turn/end') {
        const reason = (event.data as { reason?: { kind?: string } })?.reason
        if (reason?.kind === 'completed') {
          this.onTurnCompleted(_session.id)
        }
      }
    })

    if (this.state.autoFulfill) {
      void this.checkAndDispatch()
    }
  }

  public getState(): TaskBoardState {
    const liveWorkspaces = this.ctx.workspaceRegistry?.list() ?? []
    let projects: BoardProject[] = []

    if (liveWorkspaces.length > 0) {
      projects = liveWorkspaces.map((ws: Workspace) => ({
        id: ws.id,
        name: ws.title || ws.path,
        path: ws.path,
      }))
    } else {
      projects = this.state.projects.length > 0 ? [...this.state.projects] : [
        {
          id: 'proj-dsh',
          name: 'DeepSeek Harness',
          description: 'All-plugin Cordis agent harness workspace',
          path: process.cwd(),
        },
      ]
    }

    return {
      autoFulfill: this.state.autoFulfill,
      autoMerge: this.state.autoMerge,
      projects,
      workers: [...this.state.workers],
      tasks: [...this.state.tasks],
    }
  }

  public async setAutoFulfill(enabled: boolean): Promise<void> {
    this.state.autoFulfill = enabled
    this.commit()
    if (enabled) {
      await this.checkAndDispatch()
    }
  }

  public setAutoMerge(enabled: boolean): void {
    this.state.autoMerge = enabled
    this.commit()
  }

  public addTask(text: string, attachments?: TaskAttachment[], projectId?: string, projectName?: string, autoMerge?: boolean): BoardTask {
    const state = this.getState()
    const proj = projectId ? state.projects.find(p => p.id === projectId) : state.projects[0]
    const task: BoardTask = {
      id: 'task-' + randomUUID().slice(0, 8),
      text,
      projectId: proj?.id ?? projectId ?? 'proj-dsh',
      projectName: proj?.name ?? projectName ?? 'DeepSeek Harness',
      attachments,
      status: 'todo',
      autoMerge: autoMerge ?? this.state.autoMerge ?? true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.state.tasks.unshift(task)
    this.commit()
    if (this.state.autoFulfill) {
      void this.checkAndDispatch()
    }
    return task
  }

  public setTaskAutoMerge(taskId: string, enabled: boolean): boolean {
    const task = this.state.tasks.find(t => t.id === taskId)
    if (!task) return false
    task.autoMerge = enabled
    task.updatedAt = Date.now()
    this.commit()
    return true
  }

  public addProject(name: string, description?: string, path?: string): BoardProject {
    const project: BoardProject = {
      id: 'proj-' + randomUUID().slice(0, 8),
      name,
      description,
      path,
    }
    this.state.projects.push(project)
    this.commit()
    return project
  }

  public deleteTask(taskId: string): boolean {
    const index = this.state.tasks.findIndex(t => t.id === taskId)
    if (index === -1) return false
    const [removed] = this.state.tasks.splice(index, 1)
    if (removed && removed.assignedWorkerId) {
      const worker = this.state.workers.find(w => w.id === removed.assignedWorkerId)
      if (worker && worker.currentTaskId === taskId) {
        worker.status = 'idle'
        worker.currentTaskId = undefined
      }
    }
    this.commit()
    return true
  }

  public addWorker(name: string, provider: string, model: string, reasoningEffort?: string, fallbackModels?: FallbackModel[]): BoardWorker {
    const worker: BoardWorker = {
      id: 'worker-' + randomUUID().slice(0, 6),
      name,
      provider,
      model,
      reasoningEffort,
      fallbackModels: fallbackModels && fallbackModels.length > 0 ? fallbackModels : undefined,
      status: 'idle',
    }
    this.state.workers.push(worker)
    this.commit()
    if (this.state.autoFulfill) {
      void this.checkAndDispatch()
    }
    return worker
  }

  public removeWorker(id: string): boolean {
    const index = this.state.workers.findIndex(w => w.id === id)
    if (index === -1) return false
    this.state.workers.splice(index, 1)
    this.commit()
    return true
  }

  public updateWorker(id: string, updates: Partial<Omit<BoardWorker, 'id'>>): boolean {
    const worker = this.state.workers.find(w => w.id === id)
    if (!worker) return false
    Object.assign(worker, updates)
    this.commit()
    return true
  }

  public addAttachmentsToTask(taskId: string, attachments: TaskAttachment[]): boolean {
    const task = this.state.tasks.find(t => t.id === taskId)
    if (!task) return false
    task.attachments = [...(task.attachments ?? []), ...attachments]
    task.updatedAt = Date.now()
    this.commit()
    return true
  }

  public async sendToRework(taskId: string, comment: string): Promise<boolean> {
    const task = this.state.tasks.find(t => t.id === taskId)
    if (!task) return false
    const feedback: TaskFeedback = { text: comment, createdAt: Date.now() }
    task.feedbackHistory = [...(task.feedbackHistory ?? []), feedback]
    task.status = 'todo'
    task.updatedAt = Date.now()
    this.commit()
    if (this.state.autoFulfill) {
      await this.checkAndDispatch()
    }
    return true
  }

  public async approveTask(taskId: string): Promise<boolean> {
    const task = this.state.tasks.find(t => t.id === taskId)
    if (!task) return false

    // Execute merge
    const project = this.getState().projects.find(p => p.id === task.projectId)
    const cwd = project?.path ?? process.cwd()
    const branch = task.branchName ?? ('task/' + task.id)

    const mergeRes = await mergeBranch(branch, this.baseBranch, cwd)

    if (mergeRes.success) {
      task.status = 'approved'
      task.mergeConflict = false
      task.error = undefined
      task.completedAt = Date.now()
      task.updatedAt = Date.now()
    } else {
      task.status = 'review'
      task.mergeConflict = mergeRes.conflict
      task.error = mergeRes.error || (mergeRes.conflict ? 'Merge conflict detected with ' + this.baseBranch : 'Failed to merge branch')
      task.updatedAt = Date.now()

      // Send prompt to the session chat so the agent can resolve the conflict with full context
      if (task.sessionId) {
        try {
          const agent = this.ctx.agents.get(task.sessionId as SessionId)
          if (agent) {
            agent.followup({
              id: 'msg-' + randomUUID(),
              role: 'user',
              content: [{
                type: 'text',
                text: `⚠️ Git merge conflict detected when attempting to merge branch \`${branch}\` into \`${this.baseBranch}\`:\n\n`
                  + `\`\`\`\n${mergeRes.error || 'Automatic merge failed; fix conflicts and then commit the result.'}\n\`\`\`\n\n`
                  + `Please checkout your branch \`${branch}\`, merge or rebase \`${this.baseBranch}\`, resolve all conflict markers, verify that tests and builds pass, and commit your changes.`,
              }],
              source: { kind: 'user' },
            } as any)
          }
        } catch (postErr) {
          console.warn('Failed to notify agent of merge conflict:', postErr)
        }
      }
    }

    this.commit()
    return mergeRes.success
  }

  private async onTurnStarted(sessionId: string): Promise<void> {
    // If user sends a message in a session belonging to an approved task (or review task),
    // reactivate the task so subsequent edits stay isolated in its branch.
    const task = this.state.tasks.find(t => t.sessionId === sessionId && (t.status === 'approved' || t.status === 'review'))
    if (!task) return

    task.status = 'in_progress'
    task.updatedAt = Date.now()

    const liveWs = this.ctx.workspaceRegistry?.get(task.projectId as any)
    const project = this.getState().projects.find(p => p.id === task.projectId)
    const cwd = liveWs?.path ?? project?.path ?? process.cwd()
    const branch = task.branchName ?? ('task/' + task.id)

    // Switch back to the task's feature branch
    await checkoutBranch(branch, cwd)

    if (task.assignedWorkerId) {
      const worker = this.state.workers.find(w => w.id === task.assignedWorkerId)
      if (worker) {
        worker.status = 'busy'
        worker.currentTaskId = task.id
      }
    }
    this.commit()
  }

  private onTurnCompleted(sessionId: string): void {
    const task = this.state.tasks.find(t => t.sessionId === sessionId && t.status === 'in_progress')
    if (!task) return
    task.status = 'review'
    task.updatedAt = Date.now()
    if (task.assignedWorkerId) {
      const worker = this.state.workers.find(w => w.id === task.assignedWorkerId)
      if (worker) {
        worker.status = 'idle'
        worker.currentTaskId = undefined
      }
    }

    this.commit()

    if (this.state.autoFulfill) {
      void this.checkAndDispatch()
    }
  }

  public async checkAndDispatch(): Promise<void> {
    if (this.dispatching) return
    this.dispatching = true
    try {
      const pendingTasks = this.state.tasks.filter(t => t.status === 'todo')
      for (const task of pendingTasks) {
        let worker: BoardWorker | undefined
        if (task.assignedWorkerId) {
          worker = this.state.workers.find(w => w.id === task.assignedWorkerId && w.status === 'idle')
          if (!worker) continue
        } else {
          worker = this.state.workers.find(w => w.status === 'idle')
          if (!worker) break
        }
        await this.dispatchTask(task, worker)
      }
    } finally {
      this.dispatching = false
    }
  }

  private async dispatchTask(task: BoardTask, worker: BoardWorker): Promise<void> {
    task.assignedWorkerId = worker.id
    task.status = 'in_progress'
    task.updatedAt = Date.now()
    worker.status = 'busy'
    worker.currentTaskId = task.id

    const liveWs = this.ctx.workspaceRegistry?.get(task.projectId as any)
    const project = this.getState().projects.find(p => p.id === task.projectId)
    const cwd = liveWs?.path ?? project?.path ?? process.cwd()

    const branchName = task.branchName ?? ('task/' + task.id)
    task.branchName = branchName
    await ensureGitBranch(branchName, cwd)

    this.commit()

    try {
      let agent: Agent | undefined
      if (task.sessionId) {
        agent = this.ctx.agents.get(task.sessionId as SessionId)
      }
      if (!agent) {
        const sessionId = (task.sessionId ?? ('session-' + randomUUID())) as SessionId
        task.sessionId = sessionId

        const presets = this.ctx.get('agentPresets')
        let presetId: string | undefined
        try {
          presetId = (await presets?.resolve(undefined))?.id
        } catch {
          // Ignore if no default preset
        }

        const handle = await this.ctx.agents.create({
          sessionId,
          agentOptions: {
            provider: worker.provider,
            model: worker.model,
            ...(worker.reasoningEffort ? { reasoningEffort: worker.reasoningEffort as any } : {}),
          },
          meta: {
            cwd,
            ...(presetId ? { agentPreset: presetId } : {}),
          },
          setup: async (agentCtx) => {
            if (presetId && presets) {
              await presets.mount(agentCtx, presetId)
            }
          },
        })
        agent = handle.agent

        // Attach session to workspace so it appears grouped under the project
        try {
          if (task.projectId && this.ctx.workspaceRegistry) {
            const ws = this.ctx.workspaceRegistry.get(task.projectId as any)
            if (ws) {
              await ws.attachSession(sessionId)
            }
          }
        } catch (wsErr) {
          console.warn('Failed to attach session to workspace:', wsErr)
        }
      }

      let promptText = task.feedbackHistory && task.feedbackHistory.length > 0
        ? task.feedbackHistory[task.feedbackHistory.length - 1]!.text
        : task.text

      const contentBlocks: any[] = []
      if (task.attachments && task.attachments.length > 0) {
        const fileSummaries: string[] = []
        for (const att of task.attachments) {
          if (att.dataUrl.startsWith('data:image/')) {
            contentBlocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: att.type || 'image/png',
                data: att.dataUrl.split(',')[1] ?? att.dataUrl,
              },
            })
            fileSummaries.push(`[Attached image: ${att.name}]`)
          } else {
            fileSummaries.push(`[Attached file: ${att.name} (${att.type || 'unknown'})]`)
          }
        }
        if (fileSummaries.length > 0) {
          promptText += `\n\nAttachments:\n${fileSummaries.join('\n')}`
        }
      }

      contentBlocks.unshift({ type: 'text', text: promptText })

      agent.followup({
        id: 'msg-' + randomUUID(),
        role: 'user',
        content: contentBlocks,
        source: { kind: 'user' },
      } as any)
      this.commit()
    } catch (err) {
      console.error('Failed to dispatch task: ', err)
      task.error = String(err)
      task.status = 'todo'
      worker.status = 'idle'
      worker.currentTaskId = undefined
      this.commit()
    }
  }

  private commit(): void {
    persistState(this.state)
    this.ctx.emit('task-board/updated', this.getState())
  }
}

export function apply(ctx: Context): void {
  const service = new TaskBoardService(ctx)
  ctx.provide('taskBoard', service)

  ctx.commands.register({
    name: 'task-board',
    description: 'Multi-agent task board IPC bridge',
    input: { hint: '<json-action>' },
    recordInput: false,
    handler: async (invocation: CommandInvocation) => {
      try {
        const raw = invocation.rawInput.trim()
        if (!raw) {
          return { kind: 'success', text: JSON.stringify(service.getState()) }
        }
        const parsed = JSON.parse(raw) as {
          action: string
          [key: string]: any
        }

        switch (parsed.action) {
          case 'get':
            return { kind: 'success', text: JSON.stringify(service.getState()) }
          case 'setAutoFulfill':
            await service.setAutoFulfill(Boolean(parsed.enabled))
            return { kind: 'success', text: JSON.stringify(service.getState()) }
          case 'setAutoMerge':
            service.setAutoMerge(Boolean(parsed.enabled))
            return { kind: 'success', text: JSON.stringify(service.getState()) }
          case 'addTask':
            service.addTask(parsed.text, parsed.attachments, parsed.projectId, parsed.projectName, parsed.autoMerge)
            return { kind: 'success', text: JSON.stringify(service.getState()) }
          case 'setTaskAutoMerge':
            service.setTaskAutoMerge(parsed.taskId, Boolean(parsed.enabled))
            return { kind: 'success', text: JSON.stringify(service.getState()) }
          case 'addProject':
            service.addProject(parsed.name, parsed.description, parsed.path)
            return { kind: 'success', text: JSON.stringify(service.getState()) }
          case 'addWorker':
            service.addWorker(parsed.name, parsed.provider, parsed.model, parsed.reasoningEffort, parsed.fallbackModels)
            return { kind: 'success', text: JSON.stringify(service.getState()) }
          case 'removeWorker':
            service.removeWorker(parsed.id)
            return { kind: 'success', text: JSON.stringify(service.getState()) }
          case 'updateWorker':
            service.updateWorker(parsed.id, parsed.updates)
            return { kind: 'success', text: JSON.stringify(service.getState()) }
          case 'deleteTask':
            service.deleteTask(parsed.taskId)
            return { kind: 'success', text: JSON.stringify(service.getState()) }
          case 'addAttachments':
            service.addAttachmentsToTask(parsed.taskId, parsed.attachments)
            return { kind: 'success', text: JSON.stringify(service.getState()) }
          case 'rework':
            await service.sendToRework(parsed.taskId, parsed.comment)
            return { kind: 'success', text: JSON.stringify(service.getState()) }
          case 'approve':
            await service.approveTask(parsed.taskId)
            return { kind: 'success', text: JSON.stringify(service.getState()) }
          default:
            return { kind: 'error', text: `Unknown task-board action: ${parsed.action}` }
        }
      } catch (err: any) {
        return { kind: 'error', text: err?.message || String(err) }
      }
    },
  })
}
