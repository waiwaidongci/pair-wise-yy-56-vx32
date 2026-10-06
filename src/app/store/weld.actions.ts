import { createAction, props } from '@ngrx/store'
import type { AdjudicationItem, BatchItem, InspectionPlan, Weld, WeldStatus } from '../types'

export const loadWelds = createAction('[Weld] Load')
export const loadWeldsSuccess = createAction('[Weld API] Load Success', props<{ welds: Weld[]; plans: InspectionPlan[] }>())
export const selectWeld = createAction('[Weld] Select', props<{ id: string }>())
export const filterStatus = createAction('[Weld] Filter Status', props<{ status: string }>())
export const advanceWeld = createAction('[Weld] Advance', props<{ id: string; status: WeldStatus }>())
export const createPlan = createAction('[Inspection] Create Plan', props<{ plan: InspectionPlan }>())
export const lockBaseline = createAction('[Approval] Lock Baseline')

/** 离线补传：按操作号合并；simulateFailure 时在应用前失败，批次回到检查点 */
export const uploadOfflineResults = createAction('[Sync] Upload Offline Results', props<{ batchId: string; items: BatchItem[]; simulateFailure?: boolean }>())
export const uploadOfflineResultsSuccess = createAction('[Sync] Upload Success', props<{ batchId: string; mergedCount: number; conflicts: AdjudicationItem[]; revision: number }>())
export const uploadOfflineResultsFailure = createAction('[Sync] Upload Failure', props<{ batchId: string; error: string; checkpoint: { revision: number; itemCount: number } }>())
/** 从最后一个完整检查点重试（合并幂等，已并入的操作号自动跳过） */
export const retryFromCheckpoint = createAction('[Sync] Retry From Checkpoint', props<{ batchId: string }>())

/** 待裁决：采纳后并入批次并升修订，驳回则放弃该操作 */
export const adjudicateItem = createAction('[Adjudication] Decide', props<{ id: string; decision: '采纳' | '驳回' }>())

/** 按批次签字锁定，生成签字快照 */
export const lockBatch = createAction('[Approval] Lock Batch', props<{ batchId: string; signer: string }>())

/** 焊工资质变更：仅失效包含该焊缝的锁定快照，其他批次不受影响 */
export const updateWeldQualification = createAction('[Weld] Update Qualification', props<{ id: string; valid: boolean }>())
/** 检测比例变更：仅失效包含该焊缝的锁定快照，其他批次不受影响 */
export const updateWeldRatio = createAction('[Weld] Update Ratio', props<{ id: string; ratio: number }>())
