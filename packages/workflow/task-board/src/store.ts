import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { TaskBoardState } from './types.ts'

export function getStoreFilePath(): string {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.deepseek-harness')
  const dir = join(dshHome, 'task-board')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return join(dir, 'data.json')
}

const DEFAULT_STATE: TaskBoardState = {
  autoFulfill: false,
  autoMerge: true,
  projects: [
    { id: 'proj-dsh', name: 'DeepSeek Harness', description: 'All-plugin Cordis agent harness workspace' },
  ],
  workers: [
    { id: 'worker-1', name: 'Worker Alpha', provider: 'deepseek-official', model: 'deepseek-v4-flash', status: 'idle' },
  ],
  tasks: [],
}

export function loadStoredState(): TaskBoardState {
  try {
    const file = getStoreFilePath()
    if (!existsSync(file)) return { ...DEFAULT_STATE }
    const raw = readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw) as Partial<TaskBoardState>
    return {
      autoFulfill: parsed.autoFulfill ?? false,
      autoMerge: parsed.autoMerge ?? true,
      projects: Array.isArray(parsed.projects) && parsed.projects.length > 0 ? parsed.projects : DEFAULT_STATE.projects,
      workers: Array.isArray(parsed.workers) ? parsed.workers : DEFAULT_STATE.workers,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

export function persistState(state: TaskBoardState): void {
  try {
    const file = getStoreFilePath()
    writeFileSync(file, JSON.stringify(state, null, 2), 'utf8')
  } catch (err) {
    console.error('Failed to persist task board state:', err)
  }
}
