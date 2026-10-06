import { createReducer, on } from '@ngrx/store'
import type { AuditEvent, BatchOp, InspectionBatch, InspectionPlan, Weld } from '../types'
import * as A from './weld.actions'
import { seedAudit, seedBatches, seedOfflineOps } from './seed'
import {
  event, invalidateForRuleChange, mergeOps, resolveArbitration, signBatch,
} from './batch.model'

export interface WeldState {
  welds: Weld[]
  plans: InspectionPlan[]
  batches: InspectionBatch[]
  offlineOps: BatchOp[]
  selectedId: string
  statusFilter: string
  audit: AuditEvent[]
}

export const initialState: WeldState = {
  welds: [],
  plans: [],
  batches: seedBatches,
  offlineOps: seedOfflineOps,
  selectedId: '',
  statusFilter: '全部',
  audit: seedAudit,
}

function touchWeld(welds: Weld[], op: BatchOp): Weld[] {
  return welds.map((w) => {
    if (w.id !== op.weldId) return w
    const repairs = op.kind === '返修闭环' ? w.repairs + 1 : w.repairs
    const status: Weld['status'] = op.kind === '复检判定' && /合格/.test(op.summary)
      ? '合格'
      : op.kind === '返修闭环' ? '待复检' : op.kind === '缺陷登记' ? '返修中' : w.status
    return { ...w, repairs, status }
  })
}

export const weldReducer = createReducer(
  initialState,
  on(A.loadWeldsSuccess, (state, { welds, plans, batches, offlineOps }) => ({
    ...state,
    welds,
    plans,
    batches: batches.length ? batches : state.batches,
    offlineOps: offlineOps.length ? offlineOps : state.offlineOps,
    selectedId: state.selectedId || welds[0]?.id || '',
  })),
  on(A.selectWeld, (state, { id }) => ({ ...state, selectedId: id })),
  on(A.filterStatus, (state, { status }) => ({ ...state, statusFilter: status })),
  on(A.advanceWeld, (state, { id, status }) => ({
    ...state,
    welds: state.welds.map((w) => (w.id === id ? { ...w, status } : w)),
    audit: [event('当前审核人', '状态流转', id, `状态变更为 ${status}`), ...state.audit],
  })),

  on(A.recordOffline, (state, { op }) => ({
    ...state,
    offlineOps: state.offlineOps.some((o) => o.opId === op.opId) ? state.offlineOps : [op, ...state.offlineOps],
    audit: state.offlineOps.some((o) => o.opId === op.opId)
      ? state.audit
      : [event(op.inspector, '离线记录', op.opId, `${op.batchId} · ${op.weldId}（检查点 ${op.checkpoint}）：${op.summary}`), ...state.audit],
  })),

  on(A.beginUpload, (state, { batchId, checkpointsTotal }) => {
    const exists = state.batches.some((b) => b.id === batchId)
    if (!exists) {
      const ops = state.offlineOps.filter((o) => o.batchId === batchId)
      const opWelds = new Set(ops.map((o) => o.weldId))
      const plan = state.plans.find((p) => p.weldIds.some((w) => opWelds.has(w)))
        ?? state.plans.find((p) => p.state === '执行中')
      if (!plan) return state
      const now = Date.now()
      const batch: InspectionBatch = {
        id: batchId,
        planId: plan.id,
        plan,
        welds: [],
        revision: 0,
        status: '传输中',
        complete: false,
        checkpointsTotal,
        checkpointsAcked: [],
        lastError: null,
        appliedOpIds: [],
        results: [],
        effective: {},
        arbitration: [],
        snapshot: null,
        createdAt: now,
        updatedAt: now,
      }
      return { ...state, batches: [...state.batches, batch] }
    }
    return {
      ...state,
      batches: state.batches.map((b) => (
        b.id === batchId
          ? { ...b, status: '传输中' as const, complete: false, checkpointsTotal, checkpointsAcked: b.checkpointsAcked.filter((c) => c <= checkpointsTotal), lastError: null }
          : b
      )),
    }
  }),
  on(A.ackCheckpoint, (state, { batchId, checkpoint }) => ({
    ...state,
    batches: state.batches.map((b) => (
      b.id === batchId && !b.checkpointsAcked.includes(checkpoint)
        ? { ...b, checkpointsAcked: [...b.checkpointsAcked, checkpoint].sort((x, y) => x - y) }
        : b
    )),
  })),
  on(A.uploadFailed, (state, { batchId, checkpoint, error }) => ({
    ...state,
    batches: state.batches.map((b) => (
      b.id === batchId ? { ...b, complete: false, lastError: `检查点 ${checkpoint} 传输失败：${error}（保留 ${b.checkpointsAcked.length} 个完整检查点，可断点重试）` } : b
    )),
    audit: [event('系统', '补传失败', batchId, `检查点 ${checkpoint} 未确认，半份批次留在传输态，不进入总览`), ...state.audit],
  })),
  on(A.commitUpload, (state, { batchId, ops, checkpointsTotal }) => {
    const idx = state.batches.findIndex((b) => b.id === batchId)
    if (idx < 0) return state
    const target = state.batches[idx]
    const allAcked = Array.from({ length: checkpointsTotal }, (_, i) => i + 1)
    const complete = allAcked.every((c) => target.checkpointsAcked.includes(c))
    if (!complete) return state // 半份批次不得并入

    const outcome = mergeOps(target, ops, checkpointsTotal, allAcked)
    const batches = state.batches.map((b, i) => (i === idx ? outcome.batch : b))
    // 仅生效版本（先到或被裁决采纳）驱动焊缝台账状态，待裁决内容不改台账
    const oldApplied = new Set(target.appliedOpIds)
    const mergedOps = ops.filter((o) => !oldApplied.has(o.opId))
    const effectiveOpIds = new Set(Object.values(outcome.batch.effective).map((e) => e.opId))
    let welds = state.welds
    for (const op of mergedOps.filter((o) => effectiveOpIds.has(o.opId)).sort((a, b) => a.occurredAt - b.occurredAt)) {
      welds = touchWeld(welds, op)
    }
    return {
      ...state,
      batches,
      welds,
      offlineOps: state.offlineOps.filter((o) => !(o.batchId === batchId && outcome.batch.appliedOpIds.includes(o.opId))),
      audit: [...outcome.events, ...state.audit],
    }
  }),
  on(A.replayOp, (state, { batchId, op }) => {
    const target = state.batches.find((b) => b.id === batchId)
    if (target?.appliedOpIds.includes(op.opId)) {
      return {
        ...state,
        audit: state.audit, // 重复操作：不追加审计
      }
    }
    const outcome = target
      ? mergeOps(target, [op], Math.max(target.checkpointsTotal, op.checkpoint), [...target.checkpointsAcked, op.checkpoint])
      : null
    return {
      ...state,
      batches: outcome ? state.batches.map((b) => (b.id === batchId ? outcome.batch : b)) : state.batches,
      audit: outcome ? [...outcome.events, ...state.audit] : state.audit,
    }
  }),

  on(A.resolveArbitration, (state, { batchId, itemId, accept, signer }) => {
    const target = state.batches.find((b) => b.id === batchId)
    if (!target) return state
    const outcome = resolveArbitration(target, itemId, accept, signer)
    return {
      ...state,
      batches: state.batches.map((b) => (b.id === batchId ? outcome.batch : b)),
      audit: [...outcome.events, ...state.audit],
    }
  }),

  on(A.signBatch, (state, { batchId, signer }) => {
    const target = state.batches.find((b) => b.id === batchId)
    if (!target) return state
    const outcome = signBatch(target, signer)
    return {
      ...state,
      batches: state.batches.map((b) => (b.id === batchId ? outcome.batch : b)),
      audit: [...outcome.events, ...state.audit],
    }
  }),

  on(A.ruleChanged, (state, { weldId, patch, reason }) => {
    const welds = state.welds.map((w) => (w.id === weldId ? { ...w, ...patch } : w))
    let batches = state.batches
    const events: AuditEvent[] = []
    state.batches.forEach((b) => {
      const { batch, events: evs } = invalidateForRuleChange(b, [weldId], reason)
      if (batch) {
        batches = batches.map((x) => (x.id === b.id ? batch : x))
        events.push(...evs)
      }
    })
    events.push(event('系统', '规则变更', weldId, reason))
    return { ...state, welds, batches, audit: [...events, ...state.audit] }
  }),
)
