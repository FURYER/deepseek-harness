import { useCallback, useEffect, useRef, useState } from 'react'
import type { BoardProject, BoardWorker, FallbackModel, TaskAttachment, TaskBoardState } from './types.ts'
import css from './TaskBoard.module.css'

export interface TaskBoardActions {
  getState: () => Promise<TaskBoardState | null>
  setAutoFulfill: (enabled: boolean) => Promise<TaskBoardState | null>
  setAutoMerge: (enabled: boolean) => Promise<TaskBoardState | null>
  addTask: (text: string, attachments?: TaskAttachment[], projectId?: string, projectName?: string, autoMerge?: boolean) => Promise<TaskBoardState | null>
  setTaskAutoMerge: (taskId: string, enabled: boolean) => Promise<TaskBoardState | null>
  deleteTask: (taskId: string) => Promise<TaskBoardState | null>
  addAttachments: (taskId: string, attachments: TaskAttachment[]) => Promise<TaskBoardState | null>
  addProject: (name: string, description?: string, path?: string) => Promise<TaskBoardState | null>
  addWorker: (name: string, provider: string, model: string, reasoningEffort?: string, fallbackModels?: FallbackModel[]) => Promise<TaskBoardState | null>
  updateWorker: (id: string, updates: Partial<{ name: string; provider: string; model: string; reasoningEffort?: string; fallbackModels?: FallbackModel[] }>) => Promise<TaskBoardState | null>
  removeWorker: (id: string) => Promise<TaskBoardState | null>
  rework: (taskId: string, comment: string) => Promise<TaskBoardState | null>
  approve: (taskId: string) => Promise<TaskBoardState | null>
  openSession: (sessionId: string) => void
  getModelCatalog: () => Promise<any>
  getWorkspaces?: () => Array<{ id: string; name: string; path?: string }>
}

export function TaskBoardView({
  isOpen,
  onClose,
  actions,
}: {
  isOpen: boolean
  onClose: () => void
  actions: TaskBoardActions
}) {
  const [state, setState] = useState<TaskBoardState>({
    autoFulfill: false,
    autoMerge: true,
    workers: [],
    tasks: [],
    projects: [{ id: 'proj-dsh', name: 'DeepSeek Harness', description: 'All-plugin Cordis agent harness workspace' }],
  })
  const [showAddWorker, setShowAddWorker] = useState(false)
  const [showAddTask, setShowAddTask] = useState(false)
  const [showReworkDialog, setShowReworkDialog] = useState<string | null>(null)
  const [reworkComment, setReworkComment] = useState('')

  // Model Catalog from Harness Host
  const [catalog, setCatalog] = useState<{ groups: Array<{ id: string; name: string; models: Array<{ id: string; name: string; reasoning?: { efforts: Array<{ id: string; name: string }>; defaultEffort?: string } }> }> } | null>(null)

  // Add Worker Form state
  const [workerName, setWorkerName] = useState('')
  const [workerProvider, setWorkerProvider] = useState('')
  const [workerModel, setWorkerModel] = useState('')
  const [workerReasoningEffort, setWorkerReasoningEffort] = useState('')
  const [workerFallbacks, setWorkerFallbacks] = useState<FallbackModel[]>([])
  // Picker state for adding a fallback
  const [newFallbackProvider, setNewFallbackProvider] = useState('')
  const [newFallbackModel, setNewFallbackModel] = useState('')
  const [newFallbackReasoningEffort, setNewFallbackReasoningEffort] = useState('')
  const [editNewFallbackProvider, setEditNewFallbackProvider] = useState('')
  const [editNewFallbackModel, setEditNewFallbackModel] = useState('')
  const [editNewFallbackReasoningEffort, setEditNewFallbackReasoningEffort] = useState('')

  // Load live catalog on open
  useEffect(() => {
    if (!isOpen) return
    let active = true
    void actions.getModelCatalog().then((cat) => {
      if (active && cat) {
        setCatalog(cat)
        if (cat.groups && cat.groups.length > 0) {
          const firstGroup = cat.groups[0]
          setWorkerProvider(firstGroup.id)
          if (firstGroup.models && firstGroup.models.length > 0) {
            const firstModel = firstGroup.models[0]
            setWorkerModel(firstModel.id)
            setWorkerReasoningEffort(firstModel.reasoning?.defaultEffort || '')
          }
        }
      }
    })
    return () => { active = false }
  }, [isOpen, actions])

  // Current selected provider group and model in dialog
  const currentGroup = catalog?.groups.find(g => g.id === workerProvider) || catalog?.groups[0]
  const currentModel = currentGroup?.models.find(m => m.id === workerModel) || currentGroup?.models[0]
  const modelReasoning = currentModel?.reasoning

  // Handle provider change
  const handleProviderChange = (providerId: string) => {
    setWorkerProvider(providerId)
    const grp = catalog?.groups.find(g => g.id === providerId)
    if (grp && grp.models.length > 0 && grp.models[0]) {
      const firstM = grp.models[0]
      setWorkerModel(firstM.id)
      setWorkerReasoningEffort(firstM.reasoning?.defaultEffort || '')
    } else {
      setWorkerModel('')
      setWorkerReasoningEffort('')
    }
  }

  // Handle model change
  const handleModelChange = (modelId: string) => {
    setWorkerModel(modelId)
    const m = currentGroup?.models.find(mod => mod.id === modelId)
    setWorkerReasoningEffort(m?.reasoning?.defaultEffort || '')
  }

  // Add Task Form state
  const [taskText, setTaskText] = useState('')
  const [taskAttachments, setTaskAttachments] = useState<TaskAttachment[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string>(() => {
    try {
      return localStorage.getItem('dsh_task_board_last_project') || 'proj-dsh'
    } catch {
      return 'proj-dsh'
    }
  })
  const [taskAutoMerge, setTaskAutoMerge] = useState<boolean>(true)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Attach to existing task dialog state
  const [attachTaskId, setAttachTaskId] = useState<string | null>(null)
  const [existingTaskAttachments, setExistingTaskAttachments] = useState<TaskAttachment[]>([])
  const [isExistingDragging, setIsExistingDragging] = useState(false)
  const existingFileInputRef = useRef<HTMLInputElement>(null)

  const processFiles = (files: FileList | File[], isExisting = false) => {
    const list = Array.from(files)
    for (const file of list) {
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          const item: TaskAttachment = {
            name: file.name,
            type: file.type || 'application/octet-stream',
            dataUrl: reader.result as string,
          }
          if (isExisting) {
            setExistingTaskAttachments(prev => [...prev, item])
          } else {
            setTaskAttachments(prev => [...prev, item])
          }
        }
      }
      reader.readAsDataURL(file)
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
      processFiles(e.clipboardData.files, false)
    }
  }

  const handleExistingPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
      processFiles(e.clipboardData.files, true)
    }
  }

  const handleRemoveAttachment = (index: number) => {
    setTaskAttachments(prev => prev.filter((_, i) => i !== index))
  }

  const handleRemoveExistingAttachment = (index: number) => {
    setExistingTaskAttachments(prev => prev.filter((_, i) => i !== index))
  }

  const handleSaveAttachmentsToExisting = async () => {
    if (!attachTaskId || existingTaskAttachments.length === 0) return
    const s = await actions.addAttachments(attachTaskId, existingTaskAttachments)
    if (s) setState(s)
    setAttachTaskId(null)
    setExistingTaskAttachments([])
  }

  const refresh = useCallback(async () => {
    const s = await actions.getState()
    const clientWs = actions.getWorkspaces ? actions.getWorkspaces() : []
    if (s) {
      // Merge projects: client workspaces take priority, supplemented by state projects
      const projectMap = new Map<string, BoardProject>()
      for (const w of clientWs) {
        projectMap.set(w.id, {
          id: w.id,
          name: w.name,
          ...(w.path !== undefined ? { path: w.path } : {}),
        })
      }
      for (const p of s.projects || []) {
        if (!projectMap.has(p.id)) {
          projectMap.set(p.id, p)
        }
      }
      const mergedProjects = Array.from(projectMap.values())
      if (mergedProjects.length > 0) {
        s.projects = mergedProjects
      }
      setState(s)
      if (s.projects && s.projects.length > 0) {
        setSelectedProjectId((prev) => {
          let candidate = prev
          try {
            const saved = localStorage.getItem('dsh_task_board_last_project')
            if (saved && s.projects.some(p => p.id === saved)) {
              candidate = saved
            }
          } catch {}
          if (!candidate || !s.projects.some(p => p.id === candidate)) {
            return s.projects[0]!.id
          }
          return candidate
        })
      }
    }
  }, [actions])

  useEffect(() => {
    if (!isOpen) return
    void refresh()
    const interval = setInterval(() => {
      void refresh()
    }, 2500)
    return () => clearInterval(interval)
  }, [isOpen, refresh])

  if (!isOpen) return null

  const handleToggleAuto = async () => {
    const s = await actions.setAutoFulfill(!state.autoFulfill)
    if (s) setState(s)
  }

  // Edit Worker Form state
  const [editingWorkerId, setEditingWorkerId] = useState<string | null>(null)
  const [editWorkerName, setEditWorkerName] = useState('')
  const [editWorkerProvider, setEditWorkerProvider] = useState('')
  const [editWorkerModel, setEditWorkerModel] = useState('')
  const [editWorkerReasoningEffort, setEditWorkerReasoningEffort] = useState('')
  const [editWorkerFallbacks, setEditWorkerFallbacks] = useState<FallbackModel[]>([])

  const startEditWorker = (worker: BoardWorker) => {
    setEditingWorkerId(worker.id)
    setEditWorkerName(worker.name)
    setEditWorkerProvider(worker.provider)
    setEditWorkerModel(worker.model)
    setEditWorkerReasoningEffort(worker.reasoningEffort || '')
    setEditWorkerFallbacks(worker.fallbackModels ? [...worker.fallbackModels] : [])
  }

  const cancelEditWorker = () => {
    setEditingWorkerId(null)
    setEditWorkerName('')
    setEditWorkerProvider('')
    setEditWorkerModel('')
    setEditWorkerReasoningEffort('')
    setEditWorkerFallbacks([])
  }

  const handleEditProviderChange = (providerId: string) => {
    setEditWorkerProvider(providerId)
    const grp = catalog?.groups.find(g => g.id === providerId)
    if (grp && grp.models.length > 0 && grp.models[0]) {
      const firstM = grp.models[0]
      setEditWorkerModel(firstM.id)
      setEditWorkerReasoningEffort(firstM.reasoning?.defaultEffort || '')
    } else {
      setEditWorkerModel('')
      setEditWorkerReasoningEffort('')
    }
  }

  const handleEditModelChange = (modelId: string) => {
    setEditWorkerModel(modelId)
    const grp = catalog?.groups.find(g => g.id === editWorkerProvider)
    const m = grp?.models.find(mod => mod.id === modelId)
    setEditWorkerReasoningEffort(m?.reasoning?.defaultEffort || '')
  }

  const handleSaveWorkerEdit = async () => {
    if (!editingWorkerId || !editWorkerName.trim()) return
    const s = await actions.updateWorker(editingWorkerId, {
      name: editWorkerName.trim(),
      provider: editWorkerProvider,
      model: editWorkerModel,
      ...(editWorkerReasoningEffort ? { reasoningEffort: editWorkerReasoningEffort } : {}),
      fallbackModels: editWorkerFallbacks,
    })
    if (s) setState(s)
    cancelEditWorker()
  }

  const handleCreateWorker = async () => {
    if (!workerName.trim()) return
    const effort = workerReasoningEffort || undefined
    const s = await actions.addWorker(workerName.trim(), workerProvider, workerModel, effort, workerFallbacks)
    if (s) setState(s)
    setWorkerName('')
    setWorkerReasoningEffort('')
    setWorkerFallbacks([])
    setShowAddWorker(false)
  }

  const handleCreateTask = async () => {
    if (!taskText.trim()) return
    const atts = taskAttachments.length > 0 ? [...taskAttachments] : undefined
    const project = state.projects?.find(p => p.id === selectedProjectId) || state.projects?.[0]
    const projId = project?.id || selectedProjectId || 'proj-dsh'
    const projName = project?.name || (projId === 'proj-dsh' ? 'DeepSeek Harness' : undefined)
    const s = await actions.addTask(taskText.trim(), atts, projId, projName, taskAutoMerge)
    if (s) setState(s)
    setTaskText('')
    setTaskAttachments([])
    setTaskAutoMerge(true)
    setShowAddTask(false)
  }

  const handleDeleteTask = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const s = await actions.deleteTask(taskId)
    if (s) setState(s)
  }

  const handleSendRework = async () => {
    if (!showReworkDialog || !reworkComment.trim()) return
    const s = await actions.rework(showReworkDialog, reworkComment.trim())
    if (s) setState(s)
    setReworkComment('')
    setShowReworkDialog(null)
  }

  const handleApprove = async (taskId: string) => {
    const s = await actions.approve(taskId)
    if (s) setState(s)
  }

  const todoTasks = state.tasks.filter(t => t.status === 'todo')
  const inProgressTasks = state.tasks.filter(t => t.status === 'in_progress')
  const reviewTasks = state.tasks.filter(t => t.status === 'review')
  const approvedTasks = state.tasks.filter(t => t.status === 'approved')

  return (
    <div className={css.overlay}>
      <div className={css.mask} onClick={onClose} />
      <div className={css.modal}>
        {/* Header */}
        <div className={css.header}>
          <div className={css.titleArea}>
            <h2 className={css.title}>Multi-Agent Task Board</h2>
            <label className={css.autoToggle}>
              <input
                type="checkbox"
                checked={state.autoFulfill}
                onChange={handleToggleAuto}
              />
              <span>Auto-Fulfill Mode</span>
            </label>
          </div>

          <div className={css.headerActions}>
            <button
              type="button"
              className={css.btn}
              onClick={() => setShowAddWorker(true)}
            >
              Manage Workers ({state.workers.length})
            </button>
            <button
              type="button"
              className={`${css.btn} ${css.btnPrimary}`}
              onClick={() => setShowAddTask(true)}
            >
              + Add Task
            </button>
            <button
              type="button"
              className={css.closeBtn}
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Kanban Columns */}
        <div className={css.board}>
          {/* Column 1: Queue / To Do */}
          <div className={css.column}>
            <div className={css.columnHeader}>
              <span>Queue (To Do)</span>
              <span className={css.countBadge}>{todoTasks.length}</span>
            </div>
            <div className={css.cardList}>
              {todoTasks.map(task => (
                <div key={task.id} className={css.card}>
                  <div className={css.cardHeader}>
                    <div className={css.cardText}>{task.text}</div>
                    <button
                      type="button"
                      className={css.cardDeleteBtn}
                      title="Delete task"
                      onClick={e => handleDeleteTask(task.id, e)}
                    >
                      ✕
                    </button>
                  </div>
                  {task.attachments && task.attachments.length > 0 && (
                    <div className={css.cardAttachments}>
                      {task.attachments.map((att, i) => (
                        <div key={i} className={css.attachmentBadge} title={att.name}>
                          {att.dataUrl.startsWith('data:image/') ? (
                            <img src={att.dataUrl} alt={att.name} className={css.attachmentBadgeImg} />
                          ) : (
                            <span>📄</span>
                          )}
                          <span>{att.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {task.feedbackHistory && task.feedbackHistory.length > 0 && (
                    <div className={css.feedbackBox}>
                      <strong>Rework note:</strong> {task.feedbackHistory[task.feedbackHistory.length - 1]?.text}
                    </div>
                  )}
                  <div className={css.cardMeta}>
                    <span className={css.projectTag}>📁 {task.projectName || 'DeepSeek Harness'}</span>
                    {task.assignedWorkerId && (
                      <span className={css.workerTag}>Assigned: {state.workers.find(w => w.id === task.assignedWorkerId)?.name || task.assignedWorkerId}</span>
                    )}
                    {task.branchName && (
                      <span className={css.branchTag}>{task.branchName}</span>
                    )}
                    <span>{new Date(task.createdAt).toLocaleTimeString()}</span>
                  </div>
                  <div className={css.cardActions}>
                    <button
                      type="button"
                      className={css.btn}
                      style={{ padding: '3px 8px', fontSize: 11 }}
                      onClick={() => {
                        setAttachTaskId(task.id)
                        setExistingTaskAttachments([])
                      }}
                    >
                      📎 Attach Files
                    </button>
                  </div>
                </div>
              ))}
              {todoTasks.length === 0 && (
                <div style={{ textAlign: 'center', color: '#71717a', padding: 24, fontSize: 13 }}>
                  No tasks queued
                </div>
              )}
            </div>
          </div>

          {/* Column 2: In Progress */}
          <div className={css.column}>
            <div className={css.columnHeader}>
              <span>In Progress</span>
              <span className={css.countBadge}>{inProgressTasks.length}</span>
            </div>
            <div className={css.cardList}>
              {inProgressTasks.map(task => (
                <div key={task.id} className={css.card} style={{ borderColor: 'var(--dsw-alias-state-business-primary, #3b82f6)' }}>
                  <div className={css.cardHeader}>
                    <div className={css.cardText}>{task.text}</div>
                    <button
                      type="button"
                      className={css.cardDeleteBtn}
                      title="Delete task"
                      onClick={e => handleDeleteTask(task.id, e)}
                    >
                      ✕
                    </button>
                  </div>
                  {task.attachments && task.attachments.length > 0 && (
                    <div className={css.cardAttachments}>
                      {task.attachments.map((att, i) => (
                        <div key={i} className={css.attachmentBadge} title={att.name}>
                          {att.dataUrl.startsWith('data:image/') ? (
                            <img src={att.dataUrl} alt={att.name} className={css.attachmentBadgeImg} />
                          ) : (
                            <span>📄</span>
                          )}
                          <span>{att.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className={css.cardMeta}>
                    <span className={css.projectTag}>📁 {task.projectName || 'DeepSeek Harness'}</span>
                    <span className={css.workerTag}>In Progress</span>
                    {task.assignedWorkerId && (
                      <span>Worker: {state.workers.find(w => w.id === task.assignedWorkerId)?.name || task.assignedWorkerId}</span>
                    )}
                    {task.branchName && (
                      <span className={css.branchTag}>{task.branchName}</span>
                    )}
                  </div>
                  <div className={css.cardActions}>
                    <button
                      type="button"
                      className={css.btn}
                      style={{ padding: '3px 8px', fontSize: 11 }}
                      onClick={() => {
                        setAttachTaskId(task.id)
                        setExistingTaskAttachments([])
                      }}
                    >
                      📎 Attach Files
                    </button>
                    {task.sessionId && (
                      <button
                        type="button"
                        className={css.btn}
                        style={{ padding: '3px 8px', fontSize: 11 }}
                        onClick={() => {
                          actions.openSession(task.sessionId!)
                          onClose()
                        }}
                      >
                        Open Chat
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {inProgressTasks.length === 0 && (
                <div style={{ textAlign: 'center', color: '#71717a', padding: 24, fontSize: 13 }}>
                  No active tasks
                </div>
              )}
            </div>
          </div>

          {/* Column 3: Review / Ready to Merge */}
          <div className={css.column}>
            <div className={css.columnHeader}>
              <span>Review (Ready to Merge)</span>
              <span className={css.countBadge}>{reviewTasks.length}</span>
            </div>
            <div className={css.cardList}>
              {reviewTasks.map(task => (
                <div key={task.id} className={css.card} style={{ borderColor: task.mergeConflict ? 'var(--dsw-alias-state-error-primary, #ef4444)' : 'var(--dsw-alias-state-warn-primary, #f59e0b)' }}>
                  <div className={css.cardHeader}>
                    <div className={css.cardText}>{task.text}</div>
                    <button
                      type="button"
                      className={css.cardDeleteBtn}
                      title="Delete task"
                      onClick={e => handleDeleteTask(task.id, e)}
                    >
                      ✕
                    </button>
                  </div>
                  {task.attachments && task.attachments.length > 0 && (
                    <div className={css.cardAttachments}>
                      {task.attachments.map((att, i) => (
                        <div key={i} className={css.attachmentBadge} title={att.name}>
                          {att.dataUrl.startsWith('data:image/') ? (
                            <img src={att.dataUrl} alt={att.name} className={css.attachmentBadgeImg} />
                          ) : (
                            <span>📄</span>
                          )}
                          <span>{att.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {task.mergeConflict && (
                    <div className={css.conflictBox}>
                      <span className={css.conflictTag}>⚠️ Merge Conflict Detected</span>
                      <span>Conflict occurred merging into main branch. Sent to agent to resolve!</span>
                    </div>
                  )}
                  {task.error && !task.mergeConflict && (
                    <div className={css.feedbackBox}>
                      <strong>Error:</strong> {task.error}
                    </div>
                  )}
                  <div className={css.cardMeta}>
                    <span className={css.projectTag}>📁 {task.projectName || 'DeepSeek Harness'}</span>
                    {task.assignedWorkerId && (
                      <span className={css.workerTag}>Done by: {state.workers.find(w => w.id === task.assignedWorkerId)?.name || task.assignedWorkerId}</span>
                    )}
                    {task.branchName && (
                      <span className={css.branchTag}>{task.branchName}</span>
                    )}
                  </div>
                  <div className={css.cardActions}>
                    <button
                      type="button"
                      className={css.btn}
                      style={{ padding: '3px 8px', fontSize: 11 }}
                      onClick={() => {
                        setAttachTaskId(task.id)
                        setExistingTaskAttachments([])
                      }}
                    >
                      📎 Attach Files
                    </button>
                    {task.sessionId && (
                      <button
                        type="button"
                        className={css.btn}
                        onClick={() => {
                          actions.openSession(task.sessionId!)
                          onClose()
                        }}
                      >
                        Inspect Chat
                      </button>
                    )}
                    <button
                      type="button"
                      className={`${css.btn} ${css.btnDanger}`}
                      onClick={() => setShowReworkDialog(task.id)}
                    >
                      Rework
                    </button>
                    <button
                      type="button"
                      className={`${css.btn} ${css.btnSuccess}`}
                      onClick={() => handleApprove(task.id)}
                    >
                      {task.mergeConflict ? 'Retry Merge' : 'Approve & Merge'}
                    </button>
                  </div>
                </div>
              ))}
              {reviewTasks.length === 0 && (
                <div style={{ textAlign: 'center', color: '#71717a', padding: 24, fontSize: 13 }}>
                  No tasks to review
                </div>
              )}
            </div>
          </div>

          {/* Column 4: Merged (Main Branch) */}
          <div className={css.column}>
            <div className={css.columnHeader}>
              <span>Merged (Main Branch)</span>
              <span className={css.countBadge}>{approvedTasks.length}</span>
            </div>
            <div className={css.cardList}>
              {approvedTasks.map(task => (
                <div key={task.id} className={css.card} style={{ opacity: 0.85 }}>
                  <div className={css.cardHeader}>
                    <div className={css.cardText}>{task.text}</div>
                    <button
                      type="button"
                      className={css.cardDeleteBtn}
                      title="Delete task"
                      onClick={e => handleDeleteTask(task.id, e)}
                    >
                      ✕
                    </button>
                  </div>
                  {task.attachments && task.attachments.length > 0 && (
                    <div className={css.cardAttachments}>
                      {task.attachments.map((att, i) => (
                        <div key={i} className={css.attachmentBadge} title={att.name}>
                          {att.dataUrl.startsWith('data:image/') ? (
                            <img src={att.dataUrl} alt={att.name} className={css.attachmentBadgeImg} />
                          ) : (
                            <span>📄</span>
                          )}
                          <span>{att.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className={css.cardMeta}>
                    <span className={css.projectTag}>📁 {task.projectName || 'DeepSeek Harness'}</span>
                    {task.assignedWorkerId && (
                      <span className={css.workerTag}>{state.workers.find(w => w.id === task.assignedWorkerId)?.name || task.assignedWorkerId}</span>
                    )}
                    {task.completedAt && (
                      <span>Merged {new Date(task.completedAt).toLocaleTimeString()}</span>
                    )}
                  </div>
                  <div className={css.cardActions}>
                    <button
                      type="button"
                      className={css.btn}
                      style={{ padding: '3px 8px', fontSize: 11 }}
                      onClick={() => {
                        setAttachTaskId(task.id)
                        setExistingTaskAttachments([])
                      }}
                    >
                      📎 Attach Files
                    </button>
                    {task.sessionId && (
                      <button
                        type="button"
                        className={css.btn}
                        style={{ padding: '3px 8px', fontSize: 11 }}
                        onClick={() => {
                          actions.openSession(task.sessionId!)
                          onClose()
                        }}
                      >
                        View Chat History
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {approvedTasks.length === 0 && (
                <div style={{ textAlign: 'center', color: '#71717a', padding: 24, fontSize: 13 }}>
                  No merged tasks yet
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Add Task Dialog */}
        {showAddTask && (
          <div className={css.dialogOverlay}>
            <div className={css.dialog}>
              <h3 style={{ margin: 0, fontSize: 16 }}>Create New Task</h3>
              <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>
                Enter the prompt instructions for the agent worker. No title needed.
              </p>

              <div className={css.formGroup}>
                <label className={css.formLabel}>Project</label>
                <select
                  className={css.select}
                  value={selectedProjectId}
                  onChange={(e) => {
                    const val = e.target.value
                    setSelectedProjectId(val)
                    try {
                      localStorage.setItem('dsh_task_board_last_project', val)
                    } catch {}
                  }}
                >
                  {(state.projects && state.projects.length > 0
                    ? state.projects
                    : [{ id: 'proj-dsh', name: 'DeepSeek Harness' }]
                  ).map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className={css.formGroup}>
                <label className={css.formLabel}>Task Prompt Instructions</label>
                <textarea
                  className={css.textarea}
                  placeholder="Describe what needs to be implemented or changed... (Supports Ctrl+V to paste images/files)"
                  value={taskText}
                  onChange={e => setTaskText(e.target.value)}
                  onPaste={handlePaste}
                  autoFocus
                />
              </div>

              <div className={css.formGroup}>
                <label className={css.formLabel}>Attachments (Optional)</label>
                <div
                  className={`${css.dropZone} ${isDragging ? css.dropZoneActive : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setIsDragging(true)
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setIsDragging(false)
                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                      processFiles(e.dataTransfer.files)
                    }
                  }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        processFiles(e.target.files)
                      }
                    }}
                  />
                  <span>📎 Click or drag & drop files/images here, or paste with <strong>Ctrl + V</strong></span>
                </div>

                {taskAttachments.length > 0 && (
                  <div className={css.attachmentThumbnails}>
                    {taskAttachments.map((att, idx) => (
                      <div key={idx} className={css.attachmentChip} title={att.name}>
                        {att.dataUrl.startsWith('data:image/') ? (
                          <img src={att.dataUrl} alt={att.name} />
                        ) : (
                          <span>📄</span>
                        )}
                        <span className={css.attachmentChipName}>{att.name}</span>
                        <button
                          type="button"
                          className={css.removeAttachmentBtn}
                          onClick={() => handleRemoveAttachment(idx)}
                          title="Remove attachment"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className={css.dialogButtons}>
                <button
                  type="button"
                  className={css.btn}
                  onClick={() => {
                    setShowAddTask(false)
                    setTaskText('')
                    setTaskAttachments([])
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={`${css.btn} ${css.btnPrimary}`}
                  onClick={handleCreateTask}
                  disabled={!taskText.trim()}
                >
                  Add to Queue
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Attach to Existing Task Dialog */}
        {attachTaskId && (
          <div className={css.dialogOverlay}>
            <div className={css.dialog}>
              <h3 style={{ margin: 0, fontSize: 16 }}>Add Attachments to Task</h3>
              <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>
                Attach files, screenshots, or code images to this task.
              </p>

              <div
                className={`${css.dropZone} ${isExistingDragging ? css.dropZoneActive : ''}`}
                tabIndex={0}
                onDragOver={(e) => {
                  e.preventDefault()
                  setIsExistingDragging(true)
                }}
                onDragLeave={() => setIsExistingDragging(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setIsExistingDragging(false)
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    processFiles(e.dataTransfer.files, true)
                  }
                }}
                onPaste={handleExistingPaste}
                onClick={() => existingFileInputRef.current?.click()}
              >
                <input
                  ref={existingFileInputRef}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      processFiles(e.target.files, true)
                    }
                  }}
                />
                <span>📎 Click or drag & drop files here, or paste with <strong>Ctrl + V</strong></span>
              </div>

              {existingTaskAttachments.length > 0 && (
                <div className={css.attachmentThumbnails}>
                  {existingTaskAttachments.map((att, idx) => (
                    <div key={idx} className={css.attachmentChip} title={att.name}>
                      {att.dataUrl.startsWith('data:image/') ? (
                        <img src={att.dataUrl} alt={att.name} />
                      ) : (
                        <span>📄</span>
                      )}
                      <span className={css.attachmentChipName}>{att.name}</span>
                      <button
                        type="button"
                        className={css.removeAttachmentBtn}
                        onClick={() => handleRemoveExistingAttachment(idx)}
                        title="Remove attachment"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className={css.dialogButtons}>
                <button
                  type="button"
                  className={css.btn}
                  onClick={() => {
                    setAttachTaskId(null)
                    setExistingTaskAttachments([])
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={`${css.btn} ${css.btnPrimary}`}
                  onClick={handleSaveAttachmentsToExisting}
                  disabled={existingTaskAttachments.length === 0}
                >
                  Save Attachments
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Rework Dialog */}
        {showReworkDialog && (
          <div className={css.dialogOverlay}>
            <div className={css.dialog}>
              <h3 style={{ margin: 0, fontSize: 16 }}>Send Task Back for Rework</h3>
              <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>
                Provide feedback or instructions. The same agent will pick this up in the same chat.
              </p>
              <div className={css.formGroup}>
                <label className={css.formLabel}>Feedback / Change Request</label>
                <textarea
                  className={css.textarea}
                  placeholder="Explain what needs to be adjusted..."
                  value={reworkComment}
                  onChange={e => setReworkComment(e.target.value)}
                  autoFocus
                />
              </div>
              <div className={css.dialogButtons}>
                <button
                  type="button"
                  className={css.btn}
                  onClick={() => {
                    setShowReworkDialog(null)
                    setReworkComment('')
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={`${css.btn} ${css.btnDanger}`}
                  onClick={handleSendRework}
                  disabled={!reworkComment.trim()}
                >
                  Send to Rework
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Manage Workers Dialog */}
        {showAddWorker && (
          <div className={css.dialogOverlay}>
            <div className={`${css.dialog} ${css.dialogLarge}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: 16 }}>Agent Worker Pool</h3>
                <button
                  type="button"
                  className={css.closeBtn}
                  onClick={() => setShowAddWorker(false)}
                >
                  ✕
                </button>
              </div>

              {/* Existing workers */}
              <div className={css.workerList}>
                {state.workers.map(worker => (
                  <div key={worker.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className={css.workerItem}>
                      <div className={css.workerInfo}>
                        <span className={`${css.workerStatusDot} ${worker.status === 'busy' ? css.workerBusy : css.workerIdle}`} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{worker.name}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>
                            Primary: <strong>{worker.provider} / {worker.model}</strong>
                            {worker.reasoningEffort && ` (Effort: ${worker.reasoningEffort})`}
                          </div>
                          {worker.fallbackModels && worker.fallbackModels.length > 0 && (
                            <div style={{ fontSize: 11, color: '#38bdf8', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                              <span>🔄 Fallbacks:</span>
                              {worker.fallbackModels.map((fb, idx) => (
                                <span key={idx} style={{
                                  background: 'rgba(56, 189, 248, 0.15)',
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                  border: '1px solid rgba(56, 189, 248, 0.3)',
                                }}>
                                  #{idx + 1} {fb.provider}/{fb.model}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12, color: worker.status === 'busy' ? '#f59e0b' : '#22c55e', textTransform: 'capitalize' }}>
                          {worker.status}
                        </span>
                        <button
                          type="button"
                          className={css.btn}
                          style={{ padding: '2px 8px', fontSize: 11 }}
                          onClick={() => {
                            if (editingWorkerId === worker.id) {
                              cancelEditWorker()
                            } else {
                              startEditWorker(worker)
                            }
                          }}
                        >
                          {editingWorkerId === worker.id ? 'Cancel' : 'Edit'}
                        </button>
                        <button
                          type="button"
                          className={css.btn}
                          style={{ padding: '2px 8px', fontSize: 11 }}
                          onClick={async () => {
                            const s = await actions.removeWorker(worker.id)
                            if (s) setState(s)
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    {/* Inline Worker Edit Form */}
                    {editingWorkerId === worker.id && (() => {
                      const editGroup = catalog?.groups.find(g => g.id === editWorkerProvider) || catalog?.groups[0]
                      const editModel = editGroup?.models.find(m => m.id === editWorkerModel) || editGroup?.models[0]
                      const editModelReasoning = editModel?.reasoning

                      return (
                        <div style={{
                          padding: 12,
                          background: 'rgba(255, 255, 255, 0.04)',
                          borderRadius: 8,
                          border: '1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.15))',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 10,
                        }}>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>Edit Worker Configuration</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <div className={css.formGroup}>
                              <label className={css.formLabel}>Worker Name</label>
                              <input
                                type="text"
                                className={css.input}
                                value={editWorkerName}
                                onChange={e => setEditWorkerName(e.target.value)}
                              />
                            </div>
                            <div className={css.formGroup}>
                              <label className={css.formLabel}>Provider</label>
                              {catalog && catalog.groups && catalog.groups.length > 0 ? (
                                <select
                                  className={css.select}
                                  value={editWorkerProvider}
                                  onChange={e => handleEditProviderChange(e.target.value)}
                                >
                                  {catalog.groups.map(g => (
                                    <option key={g.id} value={g.id}>{g.name || g.id}</option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  type="text"
                                  className={css.input}
                                  value={editWorkerProvider}
                                  onChange={e => setEditWorkerProvider(e.target.value)}
                                />
                              )}
                            </div>
                            <div className={css.formGroup}>
                              <label className={css.formLabel}>Model</label>
                              {editGroup && editGroup.models && editGroup.models.length > 0 ? (
                                <select
                                  className={css.select}
                                  value={editWorkerModel}
                                  onChange={e => handleEditModelChange(e.target.value)}
                                >
                                  {editGroup.models.map(m => (
                                    <option key={m.id} value={m.id}>{m.name || m.id}</option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  type="text"
                                  className={css.input}
                                  value={editWorkerModel}
                                  onChange={e => setEditWorkerModel(e.target.value)}
                                />
                              )}
                            </div>
                            <div className={css.formGroup}>
                              <label className={css.formLabel}>Reasoning Effort</label>
                              {editModelReasoning && editModelReasoning.efforts && editModelReasoning.efforts.length > 0 ? (
                                <select
                                  className={css.select}
                                  value={editWorkerReasoningEffort}
                                  onChange={e => setEditWorkerReasoningEffort(e.target.value)}
                                >
                                  <option value="">Provider Default ({editModelReasoning.defaultEffort || 'None'})</option>
                                  {editModelReasoning.efforts.map(eff => (
                                    <option key={eff.id} value={eff.id}>{eff.name || eff.id}</option>
                                  ))}
                                </select>
                              ) : (
                                <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--dsw-alias-label-secondary, #94a3b8)', background: 'rgba(255, 255, 255, 0.04)', borderRadius: 6, border: '1px dashed rgba(255, 255, 255, 0.1)' }}>
                                  Not supported by this model
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Fallback Models Priority Chain */}
                          <div style={{ marginTop: 6, padding: '10px 12px', background: 'rgba(0, 0, 0, 0.2)', borderRadius: 6, border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                              <span style={{ fontSize: 12, fontWeight: 600, color: '#38bdf8' }}>🔄 Fallback Models (Priority Chain)</span>
                              <span style={{ fontSize: 11, color: '#94a3b8' }}>Auto-switched on rate limit (429 / RPM exceeded)</span>
                            </div>

                            {editWorkerFallbacks.length > 0 ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                                {editWorkerFallbacks.map((fb, idx) => (
                                  <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255, 255, 255, 0.05)', padding: '4px 8px', borderRadius: 4, fontSize: 12 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <span style={{ fontWeight: 700, color: '#38bdf8' }}>#{idx + 1}</span>
                                      <span><strong>{fb.provider}</strong> / {fb.model}</span>
                                      {fb.reasoningEffort && <span style={{ color: '#94a3b8', fontSize: 11 }}>({fb.reasoningEffort})</span>}
                                    </div>
                                    <div style={{ display: 'flex', gap: 4 }}>
                                      {idx > 0 && (
                                        <button
                                          type="button"
                                          className={css.btn}
                                          style={{ padding: '2px 6px', fontSize: 10 }}
                                          title="Move Up"
                                          onClick={() => {
                                            setEditWorkerFallbacks((prev) => {
                                              const copy = [...prev]
                                              const item = copy.splice(idx, 1)[0]!
                                              copy.splice(idx - 1, 0, item)
                                              return copy
                                            })
                                          }}
                                        >
                                          ▲
                                        </button>
                                      )}
                                      {idx < editWorkerFallbacks.length - 1 && (
                                        <button
                                          type="button"
                                          className={css.btn}
                                          style={{ padding: '2px 6px', fontSize: 10 }}
                                          title="Move Down"
                                          onClick={() => {
                                            setEditWorkerFallbacks((prev) => {
                                              const copy = [...prev]
                                              const item = copy.splice(idx, 1)[0]!
                                              copy.splice(idx + 1, 0, item)
                                              return copy
                                            })
                                          }}
                                        >
                                          ▼
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        className={css.btn}
                                        style={{ padding: '2px 6px', fontSize: 10, color: '#ef4444' }}
                                        title="Remove Fallback"
                                        onClick={() => {
                                          setEditWorkerFallbacks(prev => prev.filter((_, i) => i !== idx))
                                        }}
                                      >
                                        ✕
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div style={{ fontSize: 11, color: '#71717a', marginBottom: 8, fontStyle: 'italic' }}>
                                No fallback models added. Click below to add a backup model.
                              </div>
                            )}

                            {/* Add fallback picker */}
                            {catalog && catalog.groups && catalog.groups.length > 0 && (() => {
                              const activeP = editNewFallbackProvider || catalog.groups[0]!.id
                              const grp = catalog.groups.find(g => g.id === activeP) || catalog.groups[0]
                              const activeM = editNewFallbackModel || grp?.models[0]?.id || ''
                              const mod = grp?.models.find(m => m.id === activeM)
                              const rEfforts = mod?.reasoning?.efforts

                              return (
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                  <select
                                    className={css.select}
                                    style={{ flex: 1, minWidth: 120, fontSize: 11, padding: '4px 8px' }}
                                    value={activeP}
                                    onChange={(e) => {
                                      setEditNewFallbackProvider(e.target.value)
                                      const g = catalog.groups.find(x => x.id === e.target.value)
                                      if (g && g.models.length > 0) {
                                        setEditNewFallbackModel(g.models[0]!.id)
                                        setEditNewFallbackReasoningEffort(g.models[0]!.reasoning?.defaultEffort || '')
                                      }
                                    }}
                                  >
                                    {catalog.groups.map(g => (
                                      <option key={g.id} value={g.id}>{g.name || g.id}</option>
                                    ))}
                                  </select>
                                  <select
                                    className={css.select}
                                    style={{ flex: 1, minWidth: 140, fontSize: 11, padding: '4px 8px' }}
                                    value={activeM}
                                    onChange={(e) => {
                                      setEditNewFallbackModel(e.target.value)
                                      const m = grp?.models.find(x => x.id === e.target.value)
                                      setEditNewFallbackReasoningEffort(m?.reasoning?.defaultEffort || '')
                                    }}
                                  >
                                    {grp?.models.map(m => (
                                      <option key={m.id} value={m.id}>{m.name || m.id}</option>
                                    ))}
                                  </select>
                                  {rEfforts && rEfforts.length > 0 && (
                                    <select
                                      className={css.select}
                                      style={{ minWidth: 110, fontSize: 11, padding: '4px 8px' }}
                                      value={editNewFallbackReasoningEffort}
                                      onChange={e => setEditNewFallbackReasoningEffort(e.target.value)}
                                    >
                                      <option value="">Thinking: Default</option>
                                      {rEfforts.map(eff => (
                                        <option key={eff.id} value={eff.id}>{eff.name || eff.id}</option>
                                      ))}
                                    </select>
                                  )}
                                  <button
                                    type="button"
                                    className={css.btn}
                                    style={{ padding: '4px 10px', fontSize: 11 }}
                                    onClick={() => {
                                      if (activeP && activeM) {
                                        setEditWorkerFallbacks(prev => [
                                          ...prev,
                                          {
                                            provider: activeP,
                                            model: activeM,
                                            ...(editNewFallbackReasoningEffort ? { reasoningEffort: editNewFallbackReasoningEffort } : {}),
                                          },
                                        ])
                                        setEditNewFallbackReasoningEffort('')
                                      }
                                    }}
                                  >
                                    + Add Fallback
                                  </button>
                                </div>
                              )
                            })()}
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                            <button
                              type="button"
                              className={css.btn}
                              onClick={cancelEditWorker}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className={`${css.btn} ${css.btnPrimary}`}
                              onClick={handleSaveWorkerEdit}
                              disabled={!editWorkerName.trim()}
                            >
                              Save Changes
                            </button>
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                ))}
                {state.workers.length === 0 && (
                  <div style={{ textAlign: 'center', color: '#71717a', padding: 16, fontSize: 12 }}>
                    No workers configured. Add one below so tasks can be fulfilled!
                  </div>
                )}
              </div>

              {/* Add new worker */}
              <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: 14 }}>
                <h4 style={{ margin: '0 0 10px 0', fontSize: 14 }}>Add New Worker</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className={css.formGroup}>
                    <label className={css.formLabel}>Worker Name</label>
                    <input
                      type="text"
                      className={css.input}
                      placeholder="e.g. Coder-1"
                      value={workerName}
                      onChange={e => setWorkerName(e.target.value)}
                    />
                  </div>
                  <div className={css.formGroup}>
                    <label className={css.formLabel}>Provider</label>
                    {catalog && catalog.groups && catalog.groups.length > 0 ? (
                      <select
                        className={css.select}
                        value={workerProvider}
                        onChange={e => handleProviderChange(e.target.value)}
                      >
                        {catalog.groups.map(g => (
                          <option key={g.id} value={g.id}>{g.name || g.id}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        className={css.input}
                        placeholder="e.g. deepseek"
                        value={workerProvider}
                        onChange={e => setWorkerProvider(e.target.value)}
                      />
                    )}
                  </div>
                  <div className={css.formGroup}>
                    <label className={css.formLabel}>Model</label>
                    {currentGroup && currentGroup.models && currentGroup.models.length > 0 ? (
                      <select
                        className={css.select}
                        value={workerModel}
                        onChange={e => handleModelChange(e.target.value)}
                      >
                        {currentGroup.models.map(m => (
                          <option key={m.id} value={m.id}>{m.name || m.id}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        className={css.input}
                        placeholder="e.g. deepseek-chat"
                        value={workerModel}
                        onChange={e => setWorkerModel(e.target.value)}
                      />
                    )}
                  </div>
                  <div className={css.formGroup}>
                    <label className={css.formLabel}>Reasoning Effort</label>
                    {modelReasoning && modelReasoning.efforts && modelReasoning.efforts.length > 0 ? (
                      <select
                        className={css.select}
                        value={workerReasoningEffort}
                        onChange={e => setWorkerReasoningEffort(e.target.value)}
                      >
                        <option value="">Provider Default ({modelReasoning.defaultEffort || 'None'})</option>
                        {modelReasoning.efforts.map(eff => (
                          <option key={eff.id} value={eff.id}>{eff.name || eff.id}</option>
                        ))}
                      </select>
                    ) : (
                      <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--dsw-alias-label-secondary, #94a3b8)', background: 'rgba(255, 255, 255, 0.04)', borderRadius: 6, border: '1px dashed rgba(255, 255, 255, 0.1)' }}>
                        Not supported by this model
                      </div>
                    )}
                  </div>
                </div>

                {/* Fallback Models Priority Chain for New Worker */}
                <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(0, 0, 0, 0.2)', borderRadius: 6, border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#38bdf8' }}>🔄 Fallback Models (Priority Chain)</span>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>Auto-switched on rate limit (429 / RPM exceeded)</span>
                  </div>

                  {workerFallbacks.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                      {workerFallbacks.map((fb, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255, 255, 255, 0.05)', padding: '4px 8px', borderRadius: 4, fontSize: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontWeight: 700, color: '#38bdf8' }}>#{idx + 1}</span>
                            <span><strong>{fb.provider}</strong> / {fb.model}</span>
                            {fb.reasoningEffort && <span style={{ color: '#94a3b8', fontSize: 11 }}>({fb.reasoningEffort})</span>}
                          </div>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {idx > 0 && (
                              <button
                                type="button"
                                className={css.btn}
                                style={{ padding: '2px 6px', fontSize: 10 }}
                                title="Move Up"
                                onClick={() => {
                                  setWorkerFallbacks((prev) => {
                                    const copy = [...prev]
                                    const item = copy.splice(idx, 1)[0]!
                                    copy.splice(idx - 1, 0, item)
                                    return copy
                                  })
                                }}
                              >
                                ▲
                              </button>
                            )}
                            {idx < workerFallbacks.length - 1 && (
                              <button
                                type="button"
                                className={css.btn}
                                style={{ padding: '2px 6px', fontSize: 10 }}
                                title="Move Down"
                                onClick={() => {
                                  setWorkerFallbacks((prev) => {
                                    const copy = [...prev]
                                    const item = copy.splice(idx, 1)[0]!
                                    copy.splice(idx + 1, 0, item)
                                    return copy
                                  })
                                }}
                              >
                                ▼
                              </button>
                            )}
                            <button
                              type="button"
                              className={css.btn}
                              style={{ padding: '2px 6px', fontSize: 10, color: '#ef4444' }}
                              title="Remove Fallback"
                              onClick={() => {
                                setWorkerFallbacks(prev => prev.filter((_, i) => i !== idx))
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: '#71717a', marginBottom: 8, fontStyle: 'italic' }}>
                      No fallback models added yet. Choose a model below and click "+ Add Fallback".
                    </div>
                  )}

                  {/* Add fallback picker for New Worker */}
                  {catalog && catalog.groups && catalog.groups.length > 0 && (() => {
                    const activeP = newFallbackProvider || catalog.groups[0]!.id
                    const grp = catalog.groups.find(g => g.id === activeP) || catalog.groups[0]
                    const activeM = newFallbackModel || grp?.models[0]?.id || ''
                    const mod = grp?.models.find(m => m.id === activeM)
                    const rEfforts = mod?.reasoning?.efforts

                    return (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <select
                          className={css.select}
                          style={{ flex: 1, minWidth: 120, fontSize: 11, padding: '4px 8px' }}
                          value={activeP}
                          onChange={(e) => {
                            setNewFallbackProvider(e.target.value)
                            const g = catalog.groups.find(x => x.id === e.target.value)
                            if (g && g.models.length > 0) {
                              setNewFallbackModel(g.models[0]!.id)
                              setNewFallbackReasoningEffort(g.models[0]!.reasoning?.defaultEffort || '')
                            }
                          }}
                        >
                          {catalog.groups.map(g => (
                            <option key={g.id} value={g.id}>{g.name || g.id}</option>
                          ))}
                        </select>
                        <select
                          className={css.select}
                          style={{ flex: 1, minWidth: 140, fontSize: 11, padding: '4px 8px' }}
                          value={activeM}
                          onChange={(e) => {
                            setNewFallbackModel(e.target.value)
                            const m = grp?.models.find(x => x.id === e.target.value)
                            setNewFallbackReasoningEffort(m?.reasoning?.defaultEffort || '')
                          }}
                        >
                          {grp?.models.map(m => (
                            <option key={m.id} value={m.id}>{m.name || m.id}</option>
                          ))}
                        </select>
                        {rEfforts && rEfforts.length > 0 && (
                          <select
                            className={css.select}
                            style={{ minWidth: 110, fontSize: 11, padding: '4px 8px' }}
                            value={newFallbackReasoningEffort}
                            onChange={e => setNewFallbackReasoningEffort(e.target.value)}
                          >
                            <option value="">Thinking: Default</option>
                            {rEfforts.map(eff => (
                              <option key={eff.id} value={eff.id}>{eff.name || eff.id}</option>
                            ))}
                          </select>
                        )}
                        <button
                          type="button"
                          className={css.btn}
                          style={{ padding: '4px 10px', fontSize: 11 }}
                          onClick={() => {
                            if (activeP && activeM) {
                              setWorkerFallbacks(prev => [
                                ...prev,
                                {
                                  provider: activeP,
                                  model: activeM,
                                  ...(newFallbackReasoningEffort ? { reasoningEffort: newFallbackReasoningEffort } : {}),
                                },
                              ])
                              setNewFallbackReasoningEffort('')
                            }
                          }}
                        >
                          + Add Fallback
                        </button>
                      </div>
                    )
                  })()}
                </div>

                <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className={`${css.btn} ${css.btnPrimary}`}
                    onClick={handleCreateWorker}
                    disabled={!workerName.trim()}
                  >
                    Add Worker
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
