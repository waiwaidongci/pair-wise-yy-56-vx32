# 钢结构焊缝台账、无损检测和返修闭环平台

源提示词编号：13。覆盖构件与图纸焊缝台账、二维定位、焊工资质和检测比例预警、批量检测计划、缺陷记录、返修/复检状态、Apollo GraphQL 数据层、版本快照、签字锁定和完整追溯。

## 技术栈

Angular、PrimeNG、NgRx、Angular Router、RxJS、Apollo Angular、GraphQL、TypeScript。

## 运行

```bash
npm install
npm run dev
```

开发地址：http://localhost:62056

```bash
npm run build
```

## 可修订检测批次规则

- 检测计划、焊缝、缺陷、返修、签字快照绑定为一份**可修订检测批次**（`src/app/types.ts`）。
- 离线每条结果携带 **操作号 opId（幂等键）、焊缝编号、批次修订、发生时间、检查点**；回站按操作号合并，重复操作不追加审计（`store/batch.model.ts: mergeOps`）。
- 两名检测员同时修改同一焊缝：工序只允许 缺陷登记→返修闭环→复检判定 向前推进，正常推进直接生效；**同阶段并发判定或工序倒退，先到版本生效，后到内容进入待裁决区**，质量负责人可采纳/驳回（`resolveArbitration`）。
- 已签字锁定的批次再补传，或焊工资质/检测比例改动命中该批次焊缝时，**该批次签字快照立即失效并回到待复核，其他批次不受影响**（`invalidateForRuleChange`）。
- 补传按检查点确认；失败后从**最后一个完整检查点**之后续传，检查点不全时拒绝提交，**半份批次不会出现在总览**。
- 总览、构件地图、审核页的待裁决数量与头修订版本取同一个选择器 `selectBatchSummary`。

```bash
npm run test:logic   # 25 项纯逻辑断言：幂等合并/冲突裁决/快照失效/半份提交
```
