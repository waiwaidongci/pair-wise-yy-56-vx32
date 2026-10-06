import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router'
import { ButtonModule } from 'primeng/button'
import { TagModule } from 'primeng/tag'
import { ToastModule } from 'primeng/toast'
import { Store } from '@ngrx/store'
import { map } from 'rxjs'
import { selectBatchSummary } from './store/selectors'

@Component({
  selector:'app-root', standalone:true,
  imports:[CommonModule,RouterOutlet,RouterLink,RouterLinkActive,ButtonModule,TagModule,ToastModule],
  template:`
    <p-toast position="top-right" />
    <header class="topbar"><div class="brand"><span>焊</span><div><b>钢结构焊缝质量平台</b><small>WELD & NDT CONTROL</small></div></div><nav><a routerLink="/overview" routerLinkActive="active">台账总览</a><a routerLink="/map" routerLinkActive="active">构件定位</a><a routerLink="/inspections" routerLinkActive="active">检测返修</a><a routerLink="/approvals" routerLinkActive="active">审核锁定</a></nav><span class="spacer"></span><a class="arb-badge" routerLink="/approvals" [class.hot]="(pending$ | async)!.length > 0"><i class="pi pi-gavel"></i> 待裁决 <b>{{ (pending$ | async)!.length }}</b><small>v{{ (pending$ | async)!.revision }}</small></a><p-tag value="项目：东海会展中心" severity="success" /></header>
    <router-outlet />
  `,
  styles:[`
    .topbar{height:68px;background:#0f172a;color:#fff;display:flex;align-items:center;gap:14px;padding:0 22px;position:sticky;top:0;z-index:50}.brand{display:flex;gap:10px;align-items:center;min-width:265px}.brand>span{display:grid;place-items:center;width:36px;height:36px;border-radius:7px;background:#2563eb;font-weight:900}.brand b,.brand small{display:block}.brand small{font-size:9px;color:#8290a7;letter-spacing:1px}nav{display:flex;gap:3px}nav a{color:#cbd5e1;text-decoration:none;padding:10px 12px;border-radius:6px;font-size:14px}nav a.active{background:#1e293b;color:#fff}.spacer{flex:1}
    .arb-badge{display:flex;align-items:center;gap:6px;color:#cbd5e1;text-decoration:none;border:1px solid #334155;border-radius:20px;padding:6px 12px;font-size:13px}.arb-badge b{color:#fbbf24;font-size:15px}.arb-badge small{color:#94a3b8;font-size:11px}.arb-badge.hot{border-color:#b45309;background:#78350f33;animation:pulse 1.6s infinite}@keyframes pulse{0%,100%{box-shadow:0 0 0 0 #b4530966}50%{box-shadow:0 0 0 6px #b4530900}}
    @media(max-width:950px){.topbar{height:auto;min-height:64px;padding:10px;flex-wrap:wrap}.brand{min-width:210px}nav{order:3;width:100%;overflow:auto}.topbar p-tag{display:none}}
  `],
})
export class AppComponent {
  private readonly store = inject(Store)
  readonly pending$ = this.store.select(selectBatchSummary).pipe(map((s) => ({ length: s.pendingArbitration, revision: s.headRevision })))
}
