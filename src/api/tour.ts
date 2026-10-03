import axios from 'axios'
import type { Cue } from '../stores/workshop'

export type WritePayload = {
  batchId: string
  cueId: string
  cue: Cue
  /** 调用方要求本次写入失败（舞台监督模拟网络/磁盘故障，验证可恢复） */
  forceFail?: boolean
}

export type WriteResult = {
  batchId: string
  cueId: string
  writtenAt: string
  duplicate?: boolean
}

/**
 * 逐提示写入换城批次结果。
 * 开发环境走 MSW（带服务端幂等与失败注入）；生产无 mock 时退化为本地幂等模拟。
 */
export async function commitCueWrite(payload: WritePayload): Promise<WriteResult> {
  if (import.meta.env.DEV) {
    const res = await axios.post<WriteResult>('/api/tour/commit', payload)
    return res.data
  }
  return localCommit(payload)
}

const localDone = new Set<string>()

async function localCommit(payload: WritePayload): Promise<WriteResult> {
  await new Promise((resolve) => setTimeout(resolve, 180))
  const key = `${payload.batchId}:${payload.cueId}`
  if (payload.forceFail) throw new Error('本地模拟：写入被拒绝（网络中断）')
  const duplicate = localDone.has(key)
  localDone.add(key)
  return { batchId: payload.batchId, cueId: payload.cueId, writtenAt: new Date().toISOString(), duplicate }
}
