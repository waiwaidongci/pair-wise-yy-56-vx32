import { inject, Injectable } from '@angular/core'
import { Store } from '@ngrx/store'
import type { BatchItem, Defect, WeldStatus } from '../types'
import * as A from '../store/weld.actions'

let seq = 0
const opId = () => `OP-${Date.now().toString().slice(-6)}-${seq++}`
const now = () => new Date().toLocaleString('zh-CN', { hour12: false })

/** 构造一条带操作号、焊缝编号、批次修订和发生时间的离线结果 */
export function makeOfflineItem(weldId: string, kind: BatchItem['kind'], patch: Partial<BatchItem> = {}): BatchItem {
  return { opId: opId(), weldId, revision: 1, time: now(), kind, ...patch }
}

export function makeDefect(weldId: string, defect: Partial<Defect>): BatchItem {
  return makeOfflineItem(weldId, '缺陷录入', {
    defect: { id: `D-${Date.now().toString().slice(-4)}`, position: 50, type: '气孔', length: 6, level: 'Ⅱ级', method: 'UT', report: 'UT-2026-补传', ...defect } as Defect,
  })
}

export function makeRepair(weldId: string, status: WeldStatus, note = '返修结果离线记录'): BatchItem {
  return makeOfflineItem(weldId, '返修记录', { status, note })
}

/**
 * 离线补传服务：检测班在无网端记录结果，回站后按操作号合并。
 * 失败时保留最后一批载荷，供“从最后完整检查点重试”。
 */
@Injectable({ providedIn: 'root' })
export class OfflineSyncService {
  private readonly store = inject(Store)
  private pending: { batchId: string; items: BatchItem[] } | null = null

  /** 补传一批离线结果；simulateFailure 模拟网络中断，事务整体回退 */
  upload(batchId: string, items: BatchItem[], simulateFailure = false) {
    this.pending = { batchId, items }
    this.store.dispatch(A.uploadOfflineResults({ batchId, items, simulateFailure }))
  }

  /** 从最后一个完整检查点重试：合并按操作号幂等，已并入的结果自动跳过 */
  retry() {
    if (!this.pending) return
    const { batchId, items } = this.pending
    this.store.dispatch(A.retryFromCheckpoint({ batchId }))
    this.store.dispatch(A.uploadOfflineResults({ batchId, items }))
  }

  get hasPending() { return this.pending !== null }
}
