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

export interface AuditEvent {
  id: string
  time: string
  actor: string
  action: string
  target: string
  detail: string
}

/** 检测班离线补传的一条结果：操作号 + 焊缝编号 + 批次修订 + 发生时间，四者齐全才可合并 */
export interface BatchItem {
  opId: string
  weldId: string
  revision: number
  time: string
  kind: '缺陷录入' | '返修记录' | '检测结果'
  defect?: Defect
  status?: WeldStatus
  note?: string
}

export type BatchState = '待执行' | '执行中' | '待复核' | '已锁定' | '已失效'

/** 签字快照：锁定时固化批次修订；资质/比例变更或新结果并入后立即失效 */
export interface SignatureSnapshot {
  id: string
  batchId: string
  revision: number
  signer: string
  signedAt: string
  status: '已锁定' | '已失效'
  reason?: string
}

/** 可修订检测批次：检测计划、焊缝、缺陷、返修结果与签字快照绑在一起 */
export interface InspectionBatch {
  id: string
  planId: string
  revision: number
  state: BatchState
  items: BatchItem[]
  snapshot: SignatureSnapshot | null
  /** 最后一个完整检查点：补传失败后从这里重试，半份批次不留总览 */
  checkpoint: { revision: number; itemCount: number; at: string }
}

export type AdjudicationStatus = '待裁决' | '已采纳' | '已驳回'

/** 待裁决区：两名检测员同时改同一焊缝，先到版本生效，后到内容放入此处 */
export interface AdjudicationItem {
  id: string
  batchId: string
  opId: string
  weldId: string
  incoming: BatchItem
  winnerOpId: string
  reason: string
  time: string
  status: AdjudicationStatus
}
