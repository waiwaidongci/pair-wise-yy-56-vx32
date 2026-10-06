import { createSelector } from '@ngrx/store'
import type { WeldState } from './weld.reducer'

export interface BatchSummary {
  headRevision: number
  pendingArbitration: number
  lockedCount: number
  invalidSnapshotCount: number
  halfCount: number
  completeCount: number
  arbitrationWeldIds: string[]
}

const empty: BatchSummary = {
  headRevision: 0,
  pendingArbitration: 0,
  lockedCount: 0,
  invalidSnapshotCount: 0,
  halfCount: 0,
  completeCount: 0,
  arbitrationWeldIds: [],
}

/** 总览 / 构件地图 / 审核页统一取数：同一个待裁决数量、同一个头修订号 */
export const selectBatchSummary = createSelector(
  (state: { welds: WeldState }) => state.welds,
  (welds): BatchSummary => {
    if (!welds.batches.length) return empty
    const items = welds.batches.flatMap((b) => b.arbitration.filter((a) => a.state === '待裁决'))
    return {
      headRevision: Math.max(...welds.batches.map((b) => b.revision)),
      pendingArbitration: items.length,
      lockedCount: welds.batches.filter((b) => b.status === '已锁定' && b.snapshot?.valid).length,
      invalidSnapshotCount: welds.batches.filter((b) => b.snapshot && !b.snapshot.valid).length,
      halfCount: welds.batches.filter((b) => b.status === '传输中' && !b.complete).length,
      completeCount: welds.batches.filter((b) => b.complete).length,
      arbitrationWeldIds: [...new Set(items.map((i) => i.weldId))],
    }
  },
)
