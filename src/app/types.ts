export type WeldStatus = '待检测' | '合格' | '返修中' | '待复检' | '已关闭'
export type DefectLevel = 'Ⅰ级' | 'Ⅱ级' | 'Ⅲ级' | 'Ⅳ级'

export interface Defect {
  id: string
  position: number
  type: string
  length: number
  level: DefectLevel
  method: string
  report: string
}

export interface Weld {
  id: string
  drawing: string
  component: string
  joint: string
  method: string
  welder: string
  qualification: string
  qualificationValid: boolean
  inspectionRatio: number
  requiredRatio: number
  status: WeldStatus
  x: number
  y: number
  repairs: number
  defects: Defect[]
}

export interface InspectionPlan {
  id: string
  date: string
  method: string
  weldIds: string[]
  inspector: string
  state: '待执行' | '执行中' | '已完成'
}

// ── 可修订检测批次：计划 + 焊缝结果(缺陷/返修/复检) + 签字快照 ──

export type OpKind = '缺陷登记' | '返修闭环' | '复检判定'
export type BatchStatus = '传输中' | '待复核' | '已锁定'

/** 离线记录的每条结果：操作号(幂等键)、焊缝编号、批次修订、发生时间 */
export interface BatchOp {
  opId: string
  batchId: string
  weldId: string
  kind: OpKind
  inspector: string
  occurredAt: number
  /** 离线记录时设备所知道的批次修订 */
  baseRevision: number
  /** 所属补传检查点 */
  checkpoint: number
  summary: string
}

/** 回站合并后生效的结果行 */
export interface BatchResult {
  opId: string
  weldId: string
  revision: number
  occurredAt: number
  inspector: string
  kind: OpKind
  summary: string
  source: '合并生效' | '冲突裁决采纳'
}

export interface EffectiveVersion {
  opId: string
  inspector: string
  occurredAt: number
  revision: number
}

export interface SignatureSnapshot {
  signer: string
  signedAt: number
  revision: number
  hash: string
  valid: boolean
  invalidReason?: string
}

export interface ArbitrationItem {
  id: string
  batchId: string
  weldId: string
  revision: number
  winOpId: string
  loseOpId: string
  winnerInspector: string
  loserInspector: string
  loserOp: BatchOp
  reason: string
  arrivedAt: number
  state: '待裁决' | '已采纳' | '已驳回'
}

export interface InspectionBatch {
  id: string
  planId: string
  /** 检测计划快照，与批次绑定 */
  plan: InspectionPlan
  welds: string[]
  revision: number
  status: BatchStatus
  /** 检查点全部完整才为 true；半份批次不进总览 */
  complete: boolean
  checkpointsTotal: number
  checkpointsAcked: number[]
  lastError: string | null
  appliedOpIds: string[]
  results: BatchResult[]
  /** 每条焊缝当前生效版本（先到先得） */
  effective: Record<string, EffectiveVersion>
  arbitration: ArbitrationItem[]
  snapshot: SignatureSnapshot | null
  createdAt: number
  updatedAt: number
}

export interface AuditEvent {
  id: string
  time: string
  actor: string
  action: string
  target: string
  detail: string
}
