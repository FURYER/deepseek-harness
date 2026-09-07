import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

export async function ensureGitBranch(branchName: string, cwd: string = process.cwd()): Promise<boolean> {
  try {
    const { stdout } = await execAsync('git branch --list ' + branchName, { cwd })
    if (stdout.trim().length > 0) {
      await execAsync('git checkout ' + branchName, { cwd })
    } else {
      await execAsync('git checkout -b ' + branchName, { cwd })
    }
    return true
  } catch (err) {
    console.warn('Failed to ensure git branch ' + branchName + ' at ' + cwd + ':', err)
    return false
  }
}

export async function checkoutBranch(branchName: string, cwd: string = process.cwd()): Promise<boolean> {
  try {
    await execAsync('git checkout ' + branchName, { cwd })
    return true
  } catch (err) {
    console.warn('Failed to checkout branch ' + branchName + ' at ' + cwd + ':', err)
    return false
  }
}

export async function getCurrentBranch(cwd: string = process.cwd()): Promise<string> {
  try {
    const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd })
    return stdout.trim()
  } catch {
    return 'master'
  }
}

export interface MergeResult {
  success: boolean
  conflict: boolean
  error?: string
}

export async function mergeBranch(
  sourceBranch: string,
  targetBranch: string = 'master',
  cwd: string = process.cwd(),
): Promise<MergeResult> {
  try {
    await execAsync('git checkout ' + targetBranch, { cwd })
    try {
      await execAsync('git merge --no-ff -m "Merge task branch ' + sourceBranch + '" ' + sourceBranch, { cwd })
      return { success: true, conflict: false }
    } catch (mergeErr: any) {
      const errMsg = mergeErr?.stderr || mergeErr?.stdout || String(mergeErr)
      const isConflict = errMsg.toLowerCase().includes('conflict') || errMsg.toLowerCase().includes('automatic merge failed')
      // Abort the broken merge state so repository is not left dirty
      try {
        await execAsync('git merge --abort', { cwd })
      } catch {
        // Ignore if merge --abort fails
      }
      return {
        success: false,
        conflict: isConflict,
        error: errMsg.trim(),
      }
    }
  } catch (err: any) {
    console.warn('Failed to checkout target branch ' + targetBranch + ' at ' + cwd + ':', err)
    return {
      success: false,
      conflict: false,
      error: err?.message || String(err),
    }
  }
}
