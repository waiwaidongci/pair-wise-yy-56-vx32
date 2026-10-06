import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { SelectModule } from 'primeng/select'
import { InputTextModule } from 'primeng/inputtext'
import { TextareaModule } from 'primeng/textarea'
import { SelectButtonModule } from 'primeng/selectbutton'
import { MessageService } from 'primeng/api'
import { WeldState } from '../store/weld.reducer'
import { WeldGraphqlService } from '../services/weld-graphql.service'
import { SyncService } from '../services/sync.service'
import { RevisionStripComponent } from '../components/revision-strip.component'
import { selectBatchSummary } from '../store/selectors'
import * as A from '../store/weld.actions'
import { timeLabel } from '../store/batch.model'
import type { BatchOp, OpKind } from '../types'

interface RecordForm {
  batchId: string
  weldId: string
  kind: OpKind
  inspector: string
  checkpoint: number
  summary: string
  targetLocked: boolean
}

@Component({
  selector:'app-inspections', standalone:true,
  imports:[CommonModule,FormsModule,TableModule,TagModule,ButtonModule,DialogModule,SelectModule,InputTextModule,TextareaModule,SelectButtonModule,RevisionStripComponent],
  template:`
    <main class="page">
      <div class="page-head"><div><p class="eyebrow">离线检测 / 回站补传</p><h1>检测批次与返修闭环</h1><p>每条结果带操作号、焊缝编号、批次修订与发生时间；回站按操作号合并，重复操作不追加审计，同焊缝先到版本生效。</p></div><p-button label="离线记一条结果" icon="pi pi-wifi-slash" (onClick)="openRecord()" /></div>
      <app-revision-strip />

      <div class="grid-2">
        <section class="card">
          <h2 class="panel-title">设备离线队列（待回站）</h2>
          <p-table [value]="state.offlineOps" [paginator]="true" [rows]="6">
            <ng-template #header><tr><th>操作号</th><th>焊缝</th><th>类型 / 检测员</th><th>发生时间</th><th>批次 · 检查点</th></tr></ng-template>
            <ng-template #body let-op>
              <tr><td><b>{{op.opId}}</b><small class="block">基线修订 v{{op.baseRevision}}</small></td>
                <td>{{op.weldId}}<small class="block">{{op.kind}}</small></td>
                <td>{{op.inspector}}<small class="block" [title]="op.summary">{{op.summary | slice:0:22}}…</small></td>
                <td>{{time(op.occurredAt)}}</td>
                <td>{{op.batchId}}<small class="block">CP{{op.checkpoint}}</small></td></tr>
            </ng-template>
          </p-table>
        </section>

        <aside class="card">
          <h2 class="panel-title">回站补传（检查点）</h2>
          <div class="upload-row">
            <div><label>批次</label>
              <p-select [options]="uploadBatchOptions" [(ngModel)]="uploadBatchId" optionLabel="label" optionValue="value" styleClass="w-full" />
            </div>
            <div><label>失败模拟</label>
              <p-select [options]="failOptions" [(ngModel)]="failAt" optionLabel="label" optionValue="value" styleClass="w-full" />
            </div>
          </div>
          <ng-container *ngIf="uploadBatch as b">
            <div class="cps">
              <span class="cp" *ngFor="let c of cpRange(b.checkpointsTotal || pendingCps)" [class.ack]="b.checkpointsAcked.includes(c)" [class.next]="c === (b.checkpointsAcked.length + 1)">检查点 {{c}}<i>{{ b.checkpointsAcked.includes(c) ? '已完整确认' : c === (b.checkpointsAcked.length + 1) ? '下一个续传点' : '等待' }}</i></span>
            </div>
            <p class="half" *ngIf="!b.complete && b.status === '传输中'"><i class="pi pi-exclamation-triangle"></i> 半份批次（{{b.checkpointsAcked.length}}/{{b.checkpointsTotal}}）保持传输态，不会出现在总览中</p>
            <p class="err" *ngIf="b.lastError"><i class="pi pi-times-circle"></i> {{b.lastError}}</p>
            <div class="btns">
              <p-button [label]="b.lastError ? '从最后完整检查点重试' : '回站补传'" [icon]="b.lastError ? 'pi pi-refresh' : 'pi pi-cloud-upload'" (onClick)="sync.upload(uploadBatchId, failAt)" />
              <p-button label="模拟两人同改一焊缝" icon="pi pi-users" severity="warn" [outlined]="true" (onClick)="openConflict()" />
            </div>
          </ng-container>
          <ng-container *ngIf="!uploadBatch">
            <p class="muted">新批次 {{uploadBatchId}} 尚未建批，补传时自动按检测计划 {{firstPlanId}} 绑定创建（修订从 v1 起）。</p>
            <p-button label="回站补传（自动建批）" icon="pi pi-cloud-upload" styleClass="w-full" (onClick)="sync.upload(uploadBatchId, failAt)" />
          </ng-container>
        </aside>
      </div>

      <section class="card mt-4">
        <h2 class="panel-title">检测批次结果（计划 · 焊缝 · 缺陷/返修 · 签字快照 绑定）</h2>
        <p-table [value]="batchRows" [paginator]="true" [rows]="7">
          <ng-template #header><tr><th>操作号</th><th>焊缝</th><th>结果</th><th>检测员 / 时间</th><th>修订</th><th>来源</th></tr></ng-template>
          <ng-template #body let-row>
            <tr><td><b>{{row.result.opId}}</b><small class="block">{{row.batch.id}} · {{row.batch.planId}}</small></td>
              <td>{{row.result.weldId}}</td>
              <td><p-tag [value]="row.result.kind" [severity]="row.result.kind === '复检判定' ? 'success' : row.result.kind === '返修闭环' ? 'info' : 'danger'" /><small class="block" [title]="row.result.summary">{{row.result.summary | slice:0:34}}</small></td>
              <td>{{row.result.inspector}}<small class="block">{{time(row.result.occurredAt)}}</small></td>
              <td><b>v{{row.result.revision}}</b></td>
              <td><span [class.arb]="row.result.source === '冲突裁决采纳'">{{row.result.source}}</span></td></tr>
          </ng-template>
        </p-table>
      </section>

      <section class="card mt-4">
        <h2 class="panel-title">返修状态流转（仅生效版本驱动台账）</h2>
        <div class="step" *ngFor="let weld of repairWelds">
          <div><b>{{weld.id}} · {{weld.component}}</b><small>{{weld.defects.length}} 个缺陷 · 已返修 {{weld.repairs}} 次<span *ngIf="isArbWeld(weld.id)" class="arb-flag"> · 有后到内容待裁决</span></small></div>
          <p-tag [value]="weld.status" [severity]="weld.status === '待复检' ? 'warn' : 'danger'" />
          <p-selectbutton [options]="['返修中','待复检','合格']" [ngModel]="weld.status" (ngModelChange)="advance(weld.id,$event)" />
        </div>
        <p class="muted" *ngIf="!repairWelds.length">当前无返修中/待复检焊缝。</p>
      </section>

      <p-dialog header="离线记录检测结果（回站前不锁批次）" [(visible)]="recordDialog" [modal]="true" [style]="{width:'600px'}">
        <div class="form" *ngIf="recordForm">
          <label>归属批次</label>
          <p-select [options]="allBatchOptions" [(ngModel)]="recordForm.batchId" optionLabel="label" optionValue="value" styleClass="w-full" (ngModelChange)="onBatchPick()" />
          <p class="warn-line" *ngIf="recordForm.targetLocked"><i class="pi pi-lock"></i> 该批次已签字锁定，补传并入后原快照立即失效、回到待复核；其他批次不受影响。</p>
          <label>焊缝编号</label>
          <p-select [options]="weldOptions" [(ngModel)]="recordForm.weldId" optionLabel="label" optionValue="value" styleClass="w-full" />
          <div class="two"><div><label>结果类型</label><p-select [options]="kindOptions" [(ngModel)]="recordForm.kind" styleClass="w-full" /></div>
            <div><label>检测员</label><p-select [options]="inspectors" [(ngModel)]="recordForm.inspector" styleClass="w-full" /></div></div>
          <div class="two"><div><label>检查点</label><input pInputText type="number" min="1" [(ngModel)]="recordForm.checkpoint" /></div>
            <div><label>发生时间（设备时钟）</label><input pInputText type="datetime-local" [(ngModel)]="occurredLocal" /></div></div>
          <label>缺陷 / 返修 / 复检 说明</label>
          <textarea pTextarea [(ngModel)]="recordForm.summary" rows="3"></textarea>
        </div>
        <ng-template #footer><p-button label="取消" severity="secondary" (onClick)="recordDialog=false" /><p-button label="存入设备（离线）" icon="pi pi-save" [disabled]="!canRecord" (onClick)="saveRecord()" /></ng-template>
      </p-dialog>

      <p-dialog header="模拟：两名检测员同时修改同一焊缝" [(visible)]="conflictDialog" [modal]="true" [style]="{width:'560px'}">
        <p class="muted">两条操作针对同一条焊缝，发生时间相隔 3 分钟。先到版本立即生效，后到版本进入待裁决区，由质量负责人在审核页裁决。</p>
        <div class="form"><label>焊缝</label><p-select [options]="weldOptions" [(ngModel)]="conflictWeldId" optionLabel="label" optionValue="value" styleClass="w-full" /></div>
        <ng-template #footer><p-button label="取消" severity="secondary" (onClick)="conflictDialog=false" /><p-button label="写入两条离线记录" icon="pi pi-users" severity="warn" (onClick)="seedConflict()" /></ng-template>
      </p-dialog>
    </main>
  `,
  styles:[`
    .block{display:block;color:#7a8798;margin-top:3px}
    .upload-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}.upload-row label{display:block;font-size:12px;color:#667085;margin-bottom:4px}
    .cps{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}.cp{flex:1;min-width:108px;border:1px solid #cbd5e1;border-radius:7px;padding:9px;font-size:13px;font-weight:700;display:flex;flex-direction:column;gap:3px}.cp i{font-style:normal;font-size:11px;color:#7a8798;font-weight:400}.cp.ack{border-color:#16a34a;background:#f0fdf4;color:#15803d}.cp.ack i{color:#15803d}.cp.next{border-color:#d97706;background:#fffbeb}.cp.next i{color:#b45309}
    .half{color:#b45309;font-size:13px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:9px;margin:8px 0}.err{color:#dc2626;font-size:13px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:9px;margin:8px 0}.muted{color:#7a8798;font-size:13px}
    .btns{display:flex;gap:9px;flex-wrap:wrap}.step{display:grid;grid-template-columns:1fr auto;gap:9px;padding:12px 0;border-bottom:1px solid #edf0f5}.step small{color:#7a8798;margin-top:4px}.step p-selectbutton{grid-column:1/-1}.arb-flag{color:#b45309;font-weight:700}.arb{color:#b45309;font-weight:700}
    .form{display:grid;gap:8px}.form label{font-size:12px;color:#667085}.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}.form input,.form textarea{padding:9px;border:1px solid #cbd5e1;border-radius:6px;width:100%}.warn-line{background:#fffbeb;border:1px solid #fde68a;color:#b45309;border-radius:6px;padding:9px;font-size:13px}
    .mt-4{margin-top:16px}
  `],
})
export class InspectionsComponent {
  private readonly store = inject(Store<{ welds: WeldState }>)
  private readonly api = inject(WeldGraphqlService)
  readonly sync = inject(SyncService)
  private readonly message = inject(MessageService)
  state!: WeldState
  time = timeLabel

  uploadBatchId = 'B-2026-0930-01'
  failAt = 0
  failOptions = [
    { label: '不失败（完整补传）', value: 0 },
    { label: '检查点 1 后断网', value: 1 },
    { label: '检查点 2 后断网', value: 2 },
  ]

  recordDialog = false
  conflictDialog = false
  recordForm: RecordForm | null = null
  occurredLocal = ''
  conflictWeldId = 'W-107'

  private opSeq = 7100

  constructor() {
    this.store.select('welds').subscribe((state) => { this.state = state })
    this.api.load().subscribe(({ welds, plans, batches, offlineOps }) =>
      this.store.dispatch(A.loadWeldsSuccess({ welds, plans, batches, offlineOps })))
  }

  get firstPlanId() { return this.state?.plans.find((p) => p.id === 'IP-2026-0930-A')?.id ?? 'IP-2026-0930-A' }
  get pendingCps() { return Math.max(1, ...(this.state?.offlineOps.filter((o) => o.batchId === this.uploadBatchId).map((o) => o.checkpoint) ?? [1])) }
  get uploadBatch() { return this.state?.batches.find((b) => b.id === this.uploadBatchId) }
  get uploadBatchOptions() {
    return [
      ...(this.state?.batches ?? []).map((b) => ({ label: `${b.id}（v${b.revision} · ${b.status}${b.snapshot?.valid ? ' · 已签字' : ''}）`, value: b.id })),
      { label: 'B-2026-0930-01（离线新批 · 待建批）', value: 'B-2026-0930-01' },
    ]
  }
  get allBatchOptions() {
    return [
      ...(this.state?.batches ?? []).map((b) => ({ label: `${b.id}（v${b.revision} · ${b.status}${b.snapshot?.valid ? ' · 已签字锁定' : ''}）`, value: b.id })),
      { label: 'B-2026-0930-01（离线新批）', value: 'B-2026-0930-01' },
    ]
  }
  get weldOptions() { return (this.state?.welds ?? []).map((w) => ({ label: `${w.id} · ${w.component}`, value: w.id })) }
  get kindOptions() { return ['缺陷登记', '返修闭环', '复检判定'].map((k) => ({ label: k, value: k })) }
  inspectors = ['陈锋', '赵岚'].map((name) => ({ label: name, value: name }))

  get repairWelds() { return (this.state?.welds ?? []).filter((w) => ['返修中', '待复检'].includes(w.status)) }
  get batchRows() {
    return (this.state?.batches ?? [])
      .filter((b) => b.complete)
      .flatMap((batch) => batch.results.map((result) => ({ batch, result })))
  }
  isArbWeld(weldId: string) {
    return (this.state?.batches ?? []).some((b) => b.arbitration.some((a) => a.weldId === weldId && a.state === '待裁决'))
  }
  cpRange(n: number) { return Array.from({ length: n }, (_, i) => i + 1) }

  advance(id: string, status: string) { this.store.dispatch(A.advanceWeld({ id, status: status as never })) }

  openRecord() {
    this.occurredLocal = new Date(Date.now() - 30 * 60000).toISOString().slice(0, 16)
    this.recordForm = {
      batchId: this.uploadBatchId, weldId: 'W-107', kind: '缺陷登记',
      inspector: '陈锋', checkpoint: this.pendingCps + 1, summary: '', targetLocked: false,
    }
    this.onBatchPick()
    this.recordDialog = true
  }

  onBatchPick() {
    if (!this.recordForm) return
    this.recordForm.targetLocked = this.state.batches.some((b) => b.id === this.recordForm!.batchId && b.snapshot?.valid)
  }

  get canRecord() {
    return !!this.recordForm?.summary.trim() && !!this.recordForm.weldId
  }

  saveRecord() {
    const f = this.recordForm
    if (!f) return
    const op: BatchOp = {
      opId: `OP-${this.opSeq++}`,
      batchId: f.batchId,
      weldId: f.weldId,
      kind: f.kind,
      inspector: f.inspector,
      occurredAt: new Date(this.occurredLocal).getTime() || Date.now(),
      baseRevision: this.state.batches.find((b) => b.id === f.batchId)?.revision ?? 0,
      checkpoint: Math.max(1, Number(f.checkpoint) || 1),
      summary: f.summary.trim(),
    }
    this.store.dispatch(A.recordOffline({ op }))
    this.message.add({ severity: 'success', summary: '已离线保存', detail: `${op.opId} 存入设备队列，回站后按检查点补传` })
    this.recordDialog = false
  }

  openConflict() { this.conflictDialog = true }

  seedConflict() {
    const weldId = this.conflictWeldId
    const base = Date.now()
    const batchId = this.uploadBatchId
    const baseRevision = this.state.batches.find((b) => b.id === batchId)?.revision ?? 0
    const cp = Math.max(1, this.pendingCps + 1)
    const a: BatchOp = {
      opId: `OP-${this.opSeq++}`, batchId, weldId, kind: '复检判定', inspector: '陈锋',
      occurredAt: base - 3 * 60000, baseRevision, checkpoint: cp,
      summary: `陈锋复测：${weldId} 35% 处仍有线性显示 14mm（Ⅲ级），判定不合格需返修`,
    }
    const b: BatchOp = {
      opId: `OP-${this.opSeq++}`, batchId, weldId, kind: '复检判定', inspector: '赵岚',
      occurredAt: base, baseRevision, checkpoint: cp,
      summary: `赵岚复测：${weldId} 同位置显示 6mm，评定合格，无需返修`,
    }
    this.store.dispatch(A.recordOffline({ op: a }))
    this.store.dispatch(A.recordOffline({ op: b }))
    this.conflictDialog = false
    this.message.add({ severity: 'warn', summary: '已写入两条离线记录', detail: `同焊缝 ${weldId}，补传后先到版本生效、后到进入待裁决区` })
  }
}
