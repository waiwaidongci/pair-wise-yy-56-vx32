import type { AuditEvent, BatchOp, InspectionBatch, InspectionPlan } from '../types'

const T_0928 = new Date('2026-09-28T17:20:00+08:00').getTime()

export const seedPlans: InspectionPlan[] = [
  { id: 'IP-2026-0930-A', date: '2026-09-30', method: 'UT + MT', weldIds: ['W-104', 'W-107'], inspector: '陈锋', state: '执行中' },
  { id: 'IP-2026-0928-C', date: '2026-09-28', method: 'UT', weldIds: ['W-101', 'W-112'], inspector: '赵岚', state: '已完成' },
  { id: 'IP-2026-0929-B', date: '2026-09-29', method: 'UT', weldIds: ['W-104'], inspector: '赵岚', state: '执行中' },
]

export const seedOfflineOps: BatchOp[] = [
  { opId: 'OP-7001', batchId: 'B-2026-0930-01', weldId: 'W-104', kind: '缺陷登记', inspector: '陈锋', occurredAt: Date.parse('2026-09-30T09:12:00+08:00'), baseRevision: 0, checkpoint: 1, summary: 'UT 复验：端部 42% 处反射波，疑似未熔合 8mm（Ⅱ级）' },
  { opId: 'OP-7002', batchId: 'B-2026-0930-01', weldId: 'W-107', kind: '缺陷登记', inspector: '陈锋', occurredAt: Date.parse('2026-09-30T10:05:00+08:00'), baseRevision: 0, checkpoint: 1, summary: 'MT：腹板 68% 处线性显示 18mm（Ⅲ级），通知返修' },
  { opId: 'OP-7003', batchId: 'B-2026-0930-01', weldId: 'W-107', kind: '返修闭环', inspector: '赵岚', occurredAt: Date.parse('2026-09-30T14:40:00+08:00'), baseRevision: 0, checkpoint: 2, summary: '碳弧气刨清除后重焊，返修 1 次，焊后外观合格待复检' },
  { opId: 'OP-7004', batchId: 'B-2026-0930-01', weldId: 'W-104', kind: '复检判定', inspector: '赵岚', occurredAt: Date.parse('2026-09-30T15:26:00+08:00'), baseRevision: 0, checkpoint: 2, summary: '返修区 UT 复检符合 NB/T 47013.3 Ⅰ级，判合格' },
]

export const seedBatches: InspectionBatch[] = [
  {
    id: 'B-2026-0928-02',
    planId: 'IP-2026-0928-C',
    plan: seedPlans[1],
    welds: ['W-101', 'W-112'],
    revision: 2,
    status: '已锁定',
    complete: true,
    checkpointsTotal: 2,
    checkpointsAcked: [1, 2],
    lastError: null,
    appliedOpIds: ['OP-6001', 'OP-6002', 'OP-6003'],
    results: [
      { opId: 'OP-6003', weldId: 'W-112', revision: 2, occurredAt: T_0928, inspector: '赵岚', kind: '复检判定', summary: '抽检 50% UT 合格，批次关闭', source: '合并生效' },
      { opId: 'OP-6002', weldId: 'W-101', revision: 2, occurredAt: T_0928 - 1200000, inspector: '赵岚', kind: '缺陷登记', summary: '100% UT 无超标显示', source: '合并生效' },
      { opId: 'OP-6001', weldId: 'W-101', revision: 1, occurredAt: T_0928 - 3600000, inspector: '赵岚', kind: '缺陷登记', summary: '24% 处点状显示 3mm，评定合格', source: '合并生效' },
    ],
    effective: {
      'W-101': { opId: 'OP-6002', inspector: '赵岚', occurredAt: T_0928 - 1200000, revision: 2 },
      'W-112': { opId: 'OP-6003', inspector: '赵岚', occurredAt: T_0928, revision: 2 },
    },
    arbitration: [],
    snapshot: {
      signer: '周敏（质量负责人）',
      signedAt: Date.parse('2026-09-28T17:46:00+08:00'),
      revision: 2,
      hash: 'SHA-256:9f2c…b41a',
      valid: true,
    },
    createdAt: Date.parse('2026-09-28T08:30:00+08:00'),
    updatedAt: Date.parse('2026-09-28T17:46:00+08:00'),
  },
]

export const seedAudit: AuditEvent[] = [
  { id: 'AE-1', time: '09-28 17:46', actor: '周敏', action: '签字锁定', target: 'B-2026-0928-02', detail: '修订 v2 只读快照 SHA-256:9f2c…b41a，含计划 IP-2026-0928-C / 2 条焊缝结果' },
  { id: 'AE-2', time: '09-30 15:26', actor: '赵岚', action: '离线记录', target: 'OP-7004', detail: 'W-104 复检判定（设备离线，等待回站补传，检查点 2）' },
  { id: 'AE-3', time: '09-30 14:40', actor: '赵岚', action: '离线记录', target: 'OP-7003', detail: 'W-107 返修闭环（检查点 2）' },
]
