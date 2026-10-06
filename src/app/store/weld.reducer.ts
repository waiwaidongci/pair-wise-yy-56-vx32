import { createReducer, on } from '@ngrx/store'
import type { AdjudicationItem, AuditEvent, BatchItem, InspectionBatch, InspectionPlan, Weld } from '../types'
import * as A from './weld.actions'

export interface WeldState {
  welds: Weld[]
  plans: InspectionPlan[]
  selectedId: string
  statusFilter: string
  locked: boolean
  version: number
  audit: AuditEvent[]
  /** 可修订检测批次（计划 + 焊缝 + 结果 + 签字快照） */
  batches: InspectionBatch[]
  /** 待裁决区：并发冲突中后到的内容 */
  adjudication: AdjudicationItem[]
  /** 离线补传状态机 */
  syncStatus: 'idle' | 'uploading' | 'success' | 'failed'
  syncError: string
  lastCheckpoint: { batchId: string; revision: number; itemCount: number } | null
}

const now = () => new Date().toLocaleString('zh-CN', { hour12: false })
const today = () => new Date().toLocaleDateString('zh-CN')

const audit: AuditEvent[] = [
  { id: 'AE-1', time: '16:38', actor: '赵岚', action: '提交复检', target: 'W-104', detail: '返修后 UT 复检合格，等待审核签字' },
  { id: 'AE-2', time: '15:12', actor: '陈锋', action: '录入缺陷', target: 'W-107', detail: '翼缘板端部夹渣，长度 12mm，Ⅱ级' },
  { id: 'AE-3', time: '14:20', actor: '系统', action: '资质预警', target: 'W-109', detail: '焊工证书 2026-10-01 到期，不得列入后续检测计划' },
]

/** 初始批次：每个检测计划绑一个批次，B-01/B-02 已签字锁定 */
const batches: InspectionBatch[] = [
  {
    id: 'B-01', planId: 'IP-2026-0929-B', revision: 2, state: '已锁定',
    items: [
      { opId: 'OP-1001', weldId: 'W-104', revision: 1, time: '2026-09-29 09:12', kind: '检测结果', status: '待复检', note: 'UT 复检' },
      { opId: 'OP-1002', weldId: 'W-104', revision: 2, time: '2026-09-29 15:38', kind: '返修记录', status: '待复检', note: '二次返修完成' },
    ],
    snapshot: { id: 'SNAP-01', batchId: 'B-01', revision: 2, signer: '质量负责人', signedAt: '2026-09-29 17:00', status: '已锁定' },
    checkpoint: { revision: 2, itemCount: 2, at: '2026-09-29 15:38' },
  },
  {
    id: 'B-02', planId: 'IP-2026-0930-A', revision: 1, state: '已锁定',
    items: [
      { opId: 'OP-2001', weldId: 'W-107', revision: 1, time: '2026-09-30 10:05', kind: '缺陷录入', defect: { id: 'D-32', position: 68, type: '未熔合', length: 18, level: 'Ⅲ级', method: 'MT', report: 'MT-2026-0921' }, note: '腹板未熔合' },
    ],
    snapshot: { id: 'SNAP-02', batchId: 'B-02', revision: 1, signer: '质量负责人', signedAt: '2026-09-30 11:00', status: '已锁定' },
    checkpoint: { revision: 1, itemCount: 1, at: '2026-09-30 10:05' },
  },
  {
    id: 'B-03', planId: 'IP-2026-0930-A', revision: 0, state: '执行中',
    items: [], snapshot: null,
    checkpoint: { revision: 0, itemCount: 0, at: today() },
  },
]

export const initialState: WeldState = {
  welds: [], plans: [], selectedId: '', statusFilter: '全部', locked: false, version: 12, audit,
  batches, adjudication: [], syncStatus: 'idle', syncError: '', lastCheckpoint: null,
}

/** 把一条结果应用到焊缝（缺陷追加 / 状态流转） */
function applyItem(welds: Weld[], item: BatchItem): Weld[] {
  return welds.map((w) => {
    if (w.id !== item.weldId) return w
    let next = w
    if (item.defect && !w.defects.some((d) => d.id === item.defect!.id)) {
      next = { ...next, defects: [...next.defects, item.defect!] }
    }
    if (item.status && item.status !== w.status) {
      next = { ...next, status: item.status }
    }
    return next
  })
}

/** 合并一条离线结果：操作号幂等去重；同焊缝并发 → 待裁决 */
function mergeOne(batch: InspectionBatch, item: BatchItem, seq: number): {
  batch: InspectionBatch
  applied: BatchItem | null
  conflict: AdjudicationItem | null
  auditEvent: AuditEvent | null
} {
  // 重复操作号：不追加审计
  if (batch.items.some((m) => m.opId === item.opId)) {
    return { batch, applied: null, conflict: null, auditEvent: null }
  }
  // 并发：已有先到版本 → 后到内容进待裁决区
  const winner = batch.items.find((m) => m.weldId === item.weldId)
  if (winner) {
    return {
      batch,
      applied: null,
      conflict: {
        id: `ADJ-${Date.now()}-${seq}`,
        batchId: batch.id,
        opId: item.opId,
        weldId: item.weldId,
        incoming: item,
        winnerOpId: winner.opId,
        reason: `检测员同时修改焊缝 ${item.weldId}，先到版本 ${winner.opId} 已生效`,
        time: item.time,
        status: '待裁决',
      },
      auditEvent: null,
    }
  }
  const revision = batch.revision + 1
  const merged: BatchItem = { ...item, revision }
  const next: InspectionBatch = {
    ...batch,
    revision,
    items: [...batch.items, merged],
    checkpoint: { revision, itemCount: batch.items.length + 1, at: item.time },
    // 锁定批次收到新结果 → 快照失效，回到待复核
    state: batch.state === '已锁定' ? '待复核' : batch.state,
    snapshot: batch.state === '已锁定' && batch.snapshot
      ? { ...batch.snapshot, status: '已失效' as const, reason: '收到新的补传结果，需重新签字' }
      : batch.snapshot,
  }
  return {
    batch: next,
    applied: merged,
    conflict: null,
    auditEvent: {
      id: `AE-${Date.now()}-${seq}`,
      time: item.time,
      actor: '检测班离线端',
      action: '补传合并',
      target: item.weldId,
      detail: `操作号 ${item.opId} 已并入批次 ${batch.id} · 批次修订 v${revision}`,
    },
  }
}

export const weldReducer = createReducer(
  initialState,
  on(A.loadWeldsSuccess, (state, { welds, plans }) => ({ ...state, welds, plans, selectedId: state.selectedId || welds[0]?.id || '' })),
  on(A.selectWeld, (state, { id }) => ({ ...state, selectedId: id })),
  on(A.filterStatus, (state, { status }) => ({ ...state, statusFilter: status })),
  on(A.advanceWeld, (state, { id, status }) => ({ ...state, version: state.version + 1, welds: state.welds.map((weld) => weld.id === id ? { ...weld, status } : weld), audit: [{ id: `AE-${Date.now()}`, time: now(), actor: '当前审核人', action: '状态流转', target: id, detail: `状态变更为 ${status}` }, ...state.audit] })),
  on(A.createPlan, (state, { plan }) => ({ ...state, plans: [plan, ...state.plans], version: state.version + 1 })),

  // 离线补传：原子事务 —— 失败在应用前整体回退，半份批次不留总览
  on(A.uploadOfflineResults, (state, { batchId, items, simulateFailure }) => {
    const batch = state.batches.find((b) => b.id === batchId)
    if (!batch) return state
    if (simulateFailure) {
      return {
        ...state,
        syncStatus: 'failed' as const,
        syncError: '补传中断：网络异常，事务已回退到最后完整检查点',
        lastCheckpoint: { batchId, revision: batch.checkpoint.revision, itemCount: batch.checkpoint.itemCount },
      }
    }
    let current = batch
    const conflicts: AdjudicationItem[] = []
    const newAudit: AuditEvent[] = []
    const appliedItems: BatchItem[] = []
    items.forEach((item, i) => {
      const result = mergeOne(current, item, i)
      current = result.batch
      if (result.conflict) conflicts.push(result.conflict)
      if (result.auditEvent) newAudit.push(result.auditEvent)
      if (result.applied) appliedItems.push(result.applied)
    })
    if (!appliedItems.length && !conflicts.length) {
      // 全部为重复操作号：幂等，不追加审计
      return { ...state, syncStatus: 'success' as const, syncError: '', lastCheckpoint: { batchId, revision: current.revision, itemCount: current.items.length } }
    }
    const welds = appliedItems.reduce((ws, item) => applyItem(ws, item), state.welds)
    return {
      ...state,
      welds,
      batches: state.batches.map((b) => b.id === batchId ? current : b),
      adjudication: [...conflicts, ...state.adjudication],
      audit: [...newAudit, ...state.audit],
      syncStatus: 'success' as const,
      syncError: '',
      version: state.version + appliedItems.length,
      lastCheckpoint: { batchId, revision: current.revision, itemCount: current.items.length },
    }
  }),

  on(A.uploadOfflineResultsSuccess, (state, { batchId, mergedCount, revision }) => ({
    ...state,
    syncStatus: 'success' as const,
    syncError: '',
    audit: [{ id: `AE-${Date.now()}`, time: now(), actor: '检测班离线端', action: '补传完成', target: batchId, detail: `${mergedCount} 条结果已合并 · 批次修订 v${revision}` }, ...state.audit],
  })),

  on(A.uploadOfflineResultsFailure, (state, { batchId, error, checkpoint }) => ({
    ...state,
    syncStatus: 'failed' as const,
    syncError: error,
    lastCheckpoint: { batchId, revision: checkpoint.revision, itemCount: checkpoint.itemCount },
  })),

  on(A.retryFromCheckpoint, (state, { batchId }) => {
    const batch = state.batches.find((b) => b.id === batchId)
    if (!batch) return state
    return {
      ...state,
      syncStatus: 'uploading' as const,
      syncError: '',
      audit: [{ id: `AE-${Date.now()}`, time: now(), actor: '检测班离线端', action: '检查点重试', target: batchId, detail: `从最后完整检查点 v${batch.checkpoint.revision}（${batch.checkpoint.itemCount} 条）重试，重复操作号自动跳过` }, ...state.audit],
    }
  }),

  // 待裁决：采纳 → 并入并升修订；驳回 → 标记放弃
  on(A.adjudicateItem, (state, { id, decision }) => {
    const item = state.adjudication.find((a) => a.id === id)
    if (!item || item.status !== '待裁决') return state
    if (decision === '驳回') {
      return {
        ...state,
        adjudication: state.adjudication.map((a) => a.id === id ? { ...a, status: '已驳回' as const } : a),
        audit: [{ id: `AE-${Date.now()}`, time: now(), actor: '质量负责人', action: '驳回冲突', target: item.weldId, detail: `操作号 ${item.opId} 的后到内容已驳回，保持先到版本 ${item.winnerOpId} 生效` }, ...state.audit],
      }
    }
    const batch = state.batches.find((b) => b.id === item.batchId)
    if (!batch) return state
    const revision = batch.revision + 1
    const merged: BatchItem = { ...item.incoming, revision }
    const next: InspectionBatch = {
      ...batch,
      revision,
      items: [...batch.items, merged],
      checkpoint: { revision, itemCount: batch.items.length + 1, at: now() },
      state: batch.state === '已锁定' ? '待复核' : batch.state,
      snapshot: batch.state === '已锁定' && batch.snapshot
        ? { ...batch.snapshot, status: '已失效' as const, reason: '裁决采纳了新结果，需重新签字' }
        : batch.snapshot,
    }
    return {
      ...state,
      welds: applyItem(state.welds, merged),
      batches: state.batches.map((b) => b.id === item.batchId ? next : b),
      adjudication: state.adjudication.map((a) => a.id === id ? { ...a, status: '已采纳' as const } : a),
      version: state.version + 1,
      audit: [{ id: `AE-${Date.now()}`, time: now(), actor: '质量负责人', action: '裁决采纳', target: item.weldId, detail: `操作号 ${item.opId} 已采纳并入批次 ${item.batchId} · 批次修订 v${revision}` }, ...state.audit],
    }
  }),

  // 按批次签字锁定
  on(A.lockBatch, (state, { batchId, signer }) => {
    const batch = state.batches.find((b) => b.id === batchId)
    if (!batch || batch.state === '已锁定') return state
    const revision = batch.revision + 1
    const snapshot = { id: `SNAP-${Date.now()}`, batchId, revision, signer, signedAt: now(), status: '已锁定' as const }
    return {
      ...state,
      locked: state.batches.every((b) => b.id === batchId || b.state === '已锁定'),
      batches: state.batches.map((b) => b.id === batchId ? { ...b, revision, state: '已锁定' as const, snapshot, checkpoint: { revision, itemCount: b.items.length, at: now() } } : b),
      audit: [{ id: `AE-${Date.now()}`, time: now(), actor: signer, action: '签字锁定', target: batchId, detail: `批次修订 v${revision} 已固化为签字快照，含 ${batch.items.length} 条结果` }, ...state.audit],
    }
  }),

  // 一键锁定全部待复核批次
  on(A.lockBaseline, (state) => {
    const signer = '质量负责人'
    const targets = state.batches.filter((b) => b.state === '待复核' || b.state === '执行中')
    if (!targets.length) return { ...state, locked: true }
    const targetIds = new Set(targets.map((b) => b.id))
    const auditEvents: AuditEvent[] = targets.map((b, i) => ({ id: `AE-${Date.now()}-${i}`, time: now(), actor: signer, action: '签字锁定', target: b.id, detail: `批次修订 v${b.revision + 1} 已固化为签字快照` }))
    return {
      ...state,
      locked: true,
      batches: state.batches.map((b) => targetIds.has(b.id) ? { ...b, revision: b.revision + 1, state: '已锁定' as const, snapshot: { id: `SNAP-${Date.now()}-${b.id}`, batchId: b.id, revision: b.revision + 1, signer, signedAt: now(), status: '已锁定' as const }, checkpoint: { revision: b.revision + 1, itemCount: b.items.length, at: now() } } : b),
      audit: [...auditEvents, ...state.audit],
    }
  }),

  // 焊工资质变更：仅失效包含该焊缝的锁定快照，其他批次不受影响
  on(A.updateWeldQualification, (state, { id, valid }) => {
    const affected = state.batches.filter((b) => b.snapshot?.status === '已锁定' && b.items.some((i) => i.weldId === id))
    const affectedIds = new Set(affected.map((b) => b.id))
    return {
      ...state,
      welds: state.welds.map((w) => w.id === id ? { ...w, qualificationValid: valid } : w),
      batches: state.batches.map((b) => affectedIds.has(b.id)
        ? { ...b, state: '待复核' as const, snapshot: { ...b.snapshot!, status: '已失效' as const, reason: `焊缝 ${id} 焊工资质变更，快照失效` } }
        : b),
      audit: affected.map((b, i) => ({ id: `AE-${Date.now()}-${i}`, time: now(), actor: '系统', action: '快照失效', target: b.id, detail: `焊缝 ${id} 资质变更，锁定快照失效，批次回到待复核` })).concat(state.audit),
    }
  }),

  // 检测比例变更：仅失效包含该焊缝的锁定快照，其他批次不受影响
  on(A.updateWeldRatio, (state, { id, ratio }) => {
    const affected = state.batches.filter((b) => b.snapshot?.status === '已锁定' && b.items.some((i) => i.weldId === id))
    const affectedIds = new Set(affected.map((b) => b.id))
    return {
      ...state,
      welds: state.welds.map((w) => w.id === id ? { ...w, inspectionRatio: ratio } : w),
      batches: state.batches.map((b) => affectedIds.has(b.id)
        ? { ...b, state: '待复核' as const, snapshot: { ...b.snapshot!, status: '已失效' as const, reason: `焊缝 ${id} 检测比例变更，快照失效` } }
        : b),
      audit: affected.map((b, i) => ({ id: `AE-${Date.now()}-${i}`, time: now(), actor: '系统', action: '快照失效', target: b.id, detail: `焊缝 ${id} 检测比例变更为 ${ratio}%，锁定快照失效，批次回到待复核` })).concat(state.audit),
    }
  }),
)

/** 待裁决数量：总览、构件地图、审核页共用同一口径 */
export const pendingAdjudicationCount = (state: WeldState) => state.adjudication.filter((a) => a.status === '待裁决').length
