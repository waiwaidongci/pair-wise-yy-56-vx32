import { createAction, props } from '@ngrx/store'
import type { BatchOp, InspectionBatch, InspectionPlan, Weld, WeldStatus } from '../types'

export const loadWeldsSuccess = createAction('[Weld API] Load Success', props<{ welds: Weld[]; plans: InspectionPlan[]; batches: InspectionBatch[]; offlineOps: BatchOp[] }>())
export const selectWeld = createAction('[Weld] Select', props<{ id: string }>())
export const filterStatus = createAction('[Weld] Filter Status', props<{ status: string }>())
export const advanceWeld = createAction('[Weld] Advance', props<{ id: string; status: WeldStatus }>())

// ── 离线记录 ──
export const recordOffline = createAction('[Batch] Record Offline Op', props<{ op: BatchOp }>())

// ── 补传检查点（最后一个完整检查点之后重试） ──
export const beginUpload = createAction('[Batch] Begin Upload', props<{ batchId: string; checkpointsTotal: number }>())
export const ackCheckpoint = createAction('[Batch] Ack Checkpoint', props<{ batchId: string; checkpoint: number }>())
export const uploadFailed = createAction('[Batch] Upload Failed', props<{ batchId: string; checkpoint: number; error: string }>())
/** 一组检查点全部确认后，整批原子并入；半份批次不会被提交 */
export const commitUpload = createAction('[Batch] Commit Upload', props<{ batchId: string; ops: BatchOp[]; checkpointsTotal: number }>())
/** 演示：重放同一操作号（重复操作不追加审计） */
export const replayOp = createAction('[Batch] Replay Op', props<{ batchId: string; op: BatchOp }>())

// ── 裁决 ──
export const resolveArbitration = createAction('[Batch] Resolve Arbitration', props<{ batchId: string; itemId: string; accept: boolean; signer: string }>())

// ── 签字 ──
export const signBatch = createAction('[Batch] Sign', props<{ batchId: string; signer: string }>())

// ── 焊工资质 / 检测比例改动（相关锁定快照立即失效，其他批次不受影响） ──
export const ruleChanged = createAction('[Batch] Rule Changed', props<{ weldId: string; patch: Partial<Pick<Weld, 'qualificationValid' | 'inspectionRatio' | 'requiredRatio'>>; reason: string }>())
