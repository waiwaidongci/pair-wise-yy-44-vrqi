// 换城批次相关类型定义
import type { Cue } from '../stores/workshop'

/** 参与字段合并的可编辑字段（走位、执行提示、灯光音响说明均覆盖） */
export const MERGE_FIELDS = [
  'scene',
  'time',
  'title',
  'department',
  'owner',
  'duration',
  'note',
  'entry',
  'exit',
  'route',
] as const satisfies readonly (keyof Cue)[]

export type MergeField = (typeof MERGE_FIELDS)[number]

export type FieldSource = '本地暂存' | '远端协作'

export type FieldStatus = '未改' | '本地已改' | '远端已改' | '已合并' | '冲突待裁决'

/** 单个字段的三路状态：旧值（冻结基线）/ 本地暂存 / 远端协作 / 裁决后生效值 */
export type FieldState = {
  status: FieldStatus
  base: unknown
  local: unknown
  remote: unknown
  resolved: unknown
  /** 冲突时保留的两版来源，裁决前缺一不可打印 */
  sources: FieldSource[]
  updatedAt: string
}

export type CueMergeStatus = '待处理' | '待写入' | '待裁决' | '已写入' | '写入失败'

/** 批次内每条提示的合并状态 */
export type CueMergeState = {
  cueId: string
  fields: Partial<Record<MergeField, FieldState>>
  status: CueMergeStatus
  /** 已成功写入的标记；恢复继续时据此跳过，保证不重复写 */
  written: boolean
  lastError: string
  updatedAt: string
}

/** 冻结的演出基线：定稿后不可变，永久可查 */
export type Baseline = {
  id: string
  batchId: string
  venueName: string
  widthM: number
  depthM: number
  label: string
  frozenAt: string
  cues: Cue[]
}

export type BatchPhase =
  | '待定稿' // 已建批次，场馆尺寸未确认，旧稿仍可读
  | '调整中' // 场馆已定稿、旧提示已冻结，离线/在线调整走位与提示
  | '待合并' // 刚恢复联网，尚未做字段合并
  | '待写入' // 合并完成（冲突已裁决），等待逐提示写入
  | '待裁决' // 合并后存在双改字段，等待舞台监督裁决
  | '写入中' // 正在把合并结果逐提示写入
  | '写入失败' // 至少一条提示写入失败，批次保留，可继续
  | '待确认' // 全部写入成功，等待舞台监督确认（场馆或字段一变即失效）
  | '已完成' // 已确认，新基线已生效
  | '已废弃'

/** 断网期间的本地暂存改动 */
export type StagedChange = {
  cueId: string
  field: MergeField
  value: unknown
  at: string
}

/** 场馆尺寸 */
export type VenueDims = {
  venueName: string
  widthM: number
  depthM: number
}

/** 换城批次主体 */
export type CityBatch = {
  id: string
  seq: number
  phase: BatchPhase
  fromBaselineId: string
  venue: VenueDims
  finalizedAt: string
  createdAt: string
  cueStates: Record<string, CueMergeState>
  staged: StagedChange[]
  /** 待写入/已写入的提示顺序，失败恢复时只补其中 written=false 的 */
  writeOrder: string[]
  remoteEditedAt: string
  completedAt: string
  signature: string
  confirmed: boolean
  /** 出表签名被确认时的快照；与当前签名不一致则确认/出表失效 */
  confirmedSignature: string
  error: string
}
