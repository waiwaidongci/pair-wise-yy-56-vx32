import { Component, OnInit, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Store } from '@ngrx/store'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { ButtonModule } from 'primeng/button'
import { SelectModule } from 'primeng/select'
import { FormsModule } from '@angular/forms'
import { WeldGraphqlService } from '../services/weld-graphql.service'
import { WeldState } from '../store/weld.reducer'
import { RevisionStripComponent } from '../components/revision-strip.component'
import { selectBatchSummary } from '../store/selectors'
import * as A from '../store/weld.actions'
import { timeLabel } from '../store/batch.model'
import type { BatchStatus, Weld } from '../types'

@Component({
  selector:'app-overview', standalone:true,
  imports:[CommonModule,TableModule,TagModule,ButtonModule,SelectModule,FormsModule,RevisionStripComponent],
  template:`
    <main class="page">
      <div class="page-head"><div><p class="eyebrow">焊缝、资质与检测比例</p><h1>焊缝台账总览</h1><p>只展示完整批次；半份补传留在传输态，不进入此总览。修订版本与待裁决数量与构件地图、审核页同源。</p></div><p-button label="批量导入焊缝" icon="pi pi-upload" severity="secondary" /></div>
      <app-revision-strip />
      <div class="grid-4">
        <article class="card metric"><span>焊缝总数</span><strong>{{state.welds.length}}</strong><small>已建地图定位 {{state.welds.length}} 条</small></article>
        <article class="card metric"><span>待检测 / 返修</span><strong class="warning">{{pending}}</strong><small>{{(summary$ | async)?.completeCount ?? 0}} 个完整批次</small></article>
        <article class="card metric" [class.hot]="(summary$ | async)?.pendingArbitration"><span>待裁决冲突</span><strong class="danger">{{(summary$ | async)?.pendingArbitration ?? 0}}</strong><small>后到记录等待质量负责人裁决</small></article>
        <article class="card metric"><span>头修订 / 签字</span><strong>v{{(summary$ | async)?.headRevision ?? 0}}</strong><small>有效快照 {{(summary$ | async)?.lockedCount ?? 0}} · 失效 {{(summary$ | async)?.invalidSnapshotCount ?? 0}}</small></article>
      </div>

      <section class="card">
        <h2 class="panel-title">检测批次（计划 · 焊缝结果 · 签字快照）</h2>
        <p class="half-note" *ngIf="(summary$ | async)?.halfCount"><i class="pi pi-exclamation-triangle"></i> {{(summary$ | async)?.halfCount}} 个批次检查点不完整，已排除在总览之外</p>
        <p-table [value]="visibleBatches" [paginator]="true" [rows]="6">
          <ng-template #header><tr><th>批次 / 检测计划</th><th>焊缝结果</th><th>修订</th><th>签字快照</th><th>待裁决</th><th>状态</th></tr></ng-template>
          <ng-template #body let-batch>
            <tr>
              <td><b>{{batch.id}}</b><small class="block">{{batch.plan.id}} · {{batch.plan.date}} · {{batch.plan.method}} · {{batch.plan.inspector}}</small></td>
              <td>{{batch.results.length}} 条结果<small class="block">{{batch.welds.length}} 条焊缝 · CP {{batch.checkpointsAcked.length}}/{{batch.checkpointsTotal}}</small></td>
              <td><b>v{{batch.revision}}</b></td>
              <td>
                <ng-container *ngIf="batch.snapshot as s">
                  <span [class.danger]="!s.valid"><i class="pi" [class.pi-lock]="s.valid" [class.pi-unlock]="!s.valid"></i> {{s.signer}}</span>
                  <small class="block" [class.danger]="!s.valid">{{s.valid ? 'v' + s.revision + ' · ' + s.hash : '已失效：' + (s.invalidReason || '')}}</small>
                  <small class="block">{{time(s.signedAt)}}</small>
                </ng-container>
                <span class="muted" *ngIf="!batch.snapshot">尚未签字</span>
              </td>
              <td><b [class.danger]="arbCount(batch.id) > 0">{{arbCount(batch.id)}}</b></td>
              <td><p-tag [value]="batch.status" [severity]="statusSeverity(batch.status)" /></td>
            </tr>
          </ng-template>
        </p-table>
      </section>

      <div class="grid-2 mt-4">
        <section class="card">
          <div class="toolbar"><p-select [options]="statusOptions" [(ngModel)]="filter" (ngModelChange)="applyFilter($event)" placeholder="筛选状态" styleClass="w-full md:w-40" /><span class="spacer"></span><p-button label="导出焊缝台账" icon="pi pi-file-excel" severity="secondary" /></div>
          <p-table [value]="filtered" [paginator]="true" [rows]="6" selectionMode="single" (onRowSelect)="select($event.data)" dataKey="id">
            <ng-template #header><tr><th>焊缝 / 构件</th><th>方法与焊工</th><th>检测</th><th>返修</th><th>状态</th></tr></ng-template>
            <ng-template #body let-weld>
              <tr [class.arb-row]="isArbWeld(weld.id)"><td><b>{{weld.id}}</b><span class="arb-dot" *ngIf="isArbWeld(weld.id)" title="有待裁决的后到记录"></span><small class="block">{{weld.drawing}} · {{weld.component}}</small></td>
                <td>{{weld.method}} · {{weld.welder}}<small class="block" [class.danger]="!weld.qualificationValid">{{weld.qualificationValid ? '资质有效' : '资质失效/到期'}}</small></td>
                <td><b [class.danger]="weld.inspectionRatio < weld.requiredRatio">{{weld.inspectionRatio}}% / {{weld.requiredRatio}}%</b><small class="block">要求检测比例</small></td>
                <td>{{weld.repairs}} 次<small class="block" *ngIf="weld.repairs >= 2">重复返修关注</small></td>
                <td><p-tag [value]="weld.status" [severity]="weld.status === '合格' || weld.status === '已关闭' ? 'success' : weld.status === '返修中' ? 'danger' : 'warn'" /></td></tr>
            </ng-template>
          </p-table>
        </section>
        <aside class="card">
          <h2 class="panel-title">规则预警</h2>
          <div class="warning-row"><i class="red"></i><div><b>W-109 焊工资质已到期</b><p>孙鹏证书 2026-10-01 到期；改动资质后，含该焊缝的锁定快照立即失效。</p></div></div>
          <div class="warning-row"><i class="amber"></i><div><b>W-109 检测比例不足</b><p>当前 10%，规范要求 20%；比例调整同样触发相关快照失效。</p></div></div>
          <div class="warning-row"><i class="amber"></i><div><b>W-104 同一位置二次返修</b><p>需质量负责人确认返修工艺；补传并入已锁批次会使快照回到待复核。</p></div></div>
          <p-button label="前往审核页处理" icon="pi pi-check-square" styleClass="w-full" routerLink="/approvals" />
        </aside>
      </div>
    </main>
  `,
  styles:[`
    .block{display:block;color:#7a8798;margin-top:3px}.muted{color:#98a2b3;font-size:13px}
    .half-note{background:#fffbeb;border:1px solid #fde68a;color:#b45309;border-radius:6px;padding:9px;font-size:13px;margin-bottom:12px}
    .warning-row{display:flex;gap:10px;padding:12px 0;border-bottom:1px solid #edf0f5}.warning-row i{width:6px;border-radius:5px;background:#f59e0b}.warning-row i.red{background:#ef4444}.warning-row div{flex:1}.warning-row p{margin:4px 0 0;font-size:13px}
    .arb-row{background:#fffbeb}.arb-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#f59e0b;margin-left:6px;animation:pulse 1.4s infinite}@keyframes pulse{50%{opacity:.25}}
    .metric.hot strong{animation:none}.mt-4{margin-top:16px}
  `],
})
export class OverviewComponent implements OnInit {
  private readonly store = inject(Store<{ welds: WeldState }>)
  private readonly api = inject(WeldGraphqlService)
  state!: WeldState
  filter = '全部'
  readonly summary$ = this.store.select(selectBatchSummary)
  statusOptions = ['全部','待检测','合格','返修中','待复检','已关闭']
  time = timeLabel

  ngOnInit() {
    this.store.select('welds').subscribe((state) => { this.state = state })
    this.api.load().subscribe(({ welds, plans, batches, offlineOps }) =>
      this.store.dispatch(A.loadWeldsSuccess({ welds, plans, batches, offlineOps })))
  }

  /** 半份批次（检查点不完整）不能留在总览 */
  get visibleBatches() { return (this.state?.batches ?? []).filter((b) => b.complete) }
  get filtered() { return this.filter === '全部' ? this.state?.welds ?? [] : (this.state?.welds ?? []).filter((w) => w.status === this.filter) }
  get pending() { return (this.state?.welds ?? []).filter((w) => ['待检测','返修中','待复检'].includes(w.status)).length }
  arbCount(batchId: string) {
    return this.state?.batches.find((b) => b.id === batchId)?.arbitration.filter((a) => a.state === '待裁决').length ?? 0
  }
  isArbWeld(weldId: string) {
    return (this.state?.batches ?? []).some((b) => b.arbitration.some((a) => a.weldId === weldId && a.state === '待裁决'))
  }
  statusSeverity(status: BatchStatus) {
    return status === '已锁定' ? 'success' : status === '待复核' ? 'warn' : 'info'
  }
  applyFilter(status: string) { this.store.dispatch(A.filterStatus({ status })) }
  select(weld: Weld | Weld[] | undefined) { if (weld && !Array.isArray(weld)) this.store.dispatch(A.selectWeld({ id: weld.id })) }
}
