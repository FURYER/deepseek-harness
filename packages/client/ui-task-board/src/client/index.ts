import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TaskBoardActions } from './TaskBoardView.tsx'
import type { TaskBoardState } from './types.ts'
import { en, zh, type TaskBoardKey } from './locales.ts'
import { TaskBoardModalWrapper, setTaskBoardOpen } from './TaskBoardModal.tsx'
import React from 'react'
import css from './TaskBoard.module.css'

export type { TaskBoardKey } from './locales.ts'
export type { TaskBoardState, BoardTask, BoardWorker, TaskStatus, WorkerStatus } from './types.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    taskBoard: TaskBoardKey
  }
}

const NS = 'taskBoard'

export const inject = ['slots', 'remote', 'remote.commands', 'remote.session', 'locale', 'sessions', 'workspaces']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-task-board: dictionaries')

  const executeIpc = async (actionObj: Record<string, unknown>): Promise<TaskBoardState | null> => {
    try {
      const snapshot = ctx.sessions.list.getSnapshot()
      let activeSessionId = snapshot.current
      if (!activeSessionId && snapshot.ids.length > 0) {
        activeSessionId = snapshot.ids[0]
      }
      if (!activeSessionId) {
        activeSessionId = await ctx.sessions.create()
      }
      if (!activeSessionId) {
        return null
      }
      const cmd = `/task-board ${JSON.stringify(actionObj)}`
      const res = await ctx.remote.commands.execute(activeSessionId, cmd, [])
      if (res.ok && res.value?.result.kind === 'success' && res.value.result.text) {
        return JSON.parse(res.value.result.text) as TaskBoardState
      }
    } catch (e) {
      console.error('TaskBoard IPC failed:', e)
    }
    return null
  }

  const actions: TaskBoardActions = {
    getState: () => executeIpc({ action: 'get' }),
    setAutoFulfill: enabled => executeIpc({ action: 'setAutoFulfill', enabled }),
    setAutoMerge: enabled => executeIpc({ action: 'setAutoMerge', enabled }),
    addTask: (text, attachments, projectId, projectName, autoMerge) => executeIpc({ action: 'addTask', text, attachments, projectId, projectName, autoMerge }),
    setTaskAutoMerge: (taskId, enabled) => executeIpc({ action: 'setTaskAutoMerge', taskId, enabled }),
    deleteTask: taskId => executeIpc({ action: 'deleteTask', taskId }),
    addAttachments: (taskId, attachments) => executeIpc({ action: 'addAttachments', taskId, attachments }),
    addProject: (name, description, path) => executeIpc({ action: 'addProject', name, description, path }),
    addWorker: (name, provider, model, reasoningEffort, fallbackModels) => executeIpc({ action: 'addWorker', name, provider, model, reasoningEffort, fallbackModels }),
    updateWorker: (id, updates) => executeIpc({ action: 'updateWorker', id, updates }),
    removeWorker: id => executeIpc({ action: 'removeWorker', id }),
    rework: (taskId, comment) => executeIpc({ action: 'rework', taskId, comment }),
    approve: taskId => executeIpc({ action: 'approve', taskId }),
    openSession: (sessionId) => {
      ctx.sessions.open(sessionId as SessionId)
    },
    getWorkspaces: () => {
      try {
        const wsService = ctx.get('workspaces') as IWorkspaces | undefined
        const items = wsService?.list.getSnapshot().items ?? []
        return items.map(w => ({
          id: String(w.workspaceId),
          name: w.title || w.path,
          path: w.path,
        }))
      } catch (e) {
        console.error('Failed to get client workspaces:', e)
        return []
      }
    },
    getModelCatalog: async () => {
      try {
        const res = await ctx.remote.session.modelCatalog()
        if (res.ok) {
          return res.value
        }
      } catch (e) {
        console.error('Failed to fetch model catalog:', e)
      }
      return null
    },
  }

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'task-board-trigger',
    order: 10,
    locale: NS,
  }, ({ wide }: PropsRuntime<'sidebar.footer.action'>) => {
    return React.createElement(
      'button',
      {
        type: 'button',
        className: `${css.sidebarTrigger} ${!wide ? css.rail : ''}`,
        title: 'Task Board',
        'aria-label': 'Task Board',
        onClick: () => setTaskBoardOpen(true),
      },
      React.createElement(
        'svg',
        { width: wide ? 16 : 18, height: wide ? 16 : 18, viewBox: '0 0 16 16', fill: 'currentColor' },
        React.createElement('path', { d: 'M1.5 2.5A1.5 1.5 0 0 1 3 1h10a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 13 15H3a1.5 1.5 0 0 1-1.5-1.5v-11zM3 2a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h10a.5.5 0 0 0 .5-.5v-11A.5.5 0 0 0 13 2H3z' }),
        React.createElement('path', { d: 'M4 4.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-5zm5 0a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-3z' }),
      ),
      wide && React.createElement('span', null, 'Task Board'),
    )
  }))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'task-board-modal',
    locale: NS,
  }, () => React.createElement(TaskBoardModalWrapper, { actions })))
}
