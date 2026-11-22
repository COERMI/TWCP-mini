# 阶段 1：备份与隔离内容恢复验证

日期：2026-11-21，Asia/Shanghai。仅针对负责人确认的专用测试环境。

## 结果

**本地导出备份 → 独立测试集合导入 → 全文逻辑内容比对通过。** 四个原业务集合在演练前后内容一致。平台时间点恢复因套餐限制被拒绝，未标记通过，未升级或购买服务。

|集合|原集合条数|恢复条数|逻辑全文比对|原集合演练前后|
|---|---:|---:|---|---|
|transport_records|2|2|一致|未改变|
|transport_events|0|0|一致|未改变|
|photo_records|0|0|一致|未改变|
|counters|1|1|一致|未改变|

证据：`evidence/2026-11-21/backup-restore-verification.json`、`backup-restore-summary.json`。字段名排序后计算 SHA-256；数字的 Mongo Extended JSON 类型包装先归一化，再比较逻辑值。不把 int/double 序列化差异宣称为字节一致。日期、ID、令牌及其他字段参与完整比对，但不输出值。

## 本机备份

位置：`C:\Users\user\AppData\Local\Codex\mediaserver-backup-20261121-202821`。

- `transport_records/`、`counters/`：平台导出的 JSONL。
- `transport_events/`、`photo_records/`：查询确认零条后的 `[]`。平台导出空集合报错，保留诊断，不单凭导出退出码推断数据丢失。
- `storage/`：4 个图片对象，总计 1,666,592 字节。逐个大小及 MD5 与清单 ETag 比对通过，另存 SHA-256；公开证据用 image-1 至 image-4 代称。
- `cloud-source/`：先前独立下载的8个函数源码快照。
- `cloud-config/`：8个函数完整配置，**可能含敏感变量，禁止提交仓库或公开**。
- `local-source.tar`：本地源码快照，排除 node_modules、dist、.git；是演练期间的快照，不冒充旧 Git 历史。
- `restore-*`：各次诊断、原集合前后快照和恢复读回结果，也含档案令牌，不复制进源码。

图片证据：`evidence/2026-11-21/storage-backup-verification.json`。

## 隔离范围

成功恢复目标：

- `audit_1121204605_transport_records`
- `audit_1121204605_transport_events`
- `audit_1121204605_photo_records`
- `audit_1121204605_counters`

创建时请求 `ADMINONLY`，由管理 API 导入；未将原业务集合设为公开。规则生效与双司机访问实测尚未验证，不把创建参数等同权限测试通过。

首次导入失败留下空集合 `audit_1121204152_transport_records`，已登记保留，未自动删除。其他恢复尝试未创建集合。集合清单请求 ID：`3d778e97-1617-4a5b-abef-41cf15f6d334`。

## 命令与异常

1. `tcb db nosql dump <collection> --output-dir <本机独立目录> -e <测试环境> --json`。
2. `tcb storage list/download` 保存文件并比对大小、MD5。
3. 尝试 `tcb db nosql backup restore` 到全新集合，平台返回 `OperationDenied`：“该功能需升级到标准版及以上即可支持。”请求 ID：`1b411896-f892-4090-abe4-76a59d264200`。没有升级，原集合未作为恢复目标。
4. `CreateTable` 新建独立集合，仅对新集合执行 `INSERT`。第一次导入宽松 Extended JSON 的 ISO 日期被拒绝（请求 ID `8249a08f-bc33-426b-a4c7-c1c5d1f9a95a`），改为 canonical Extended JSON 日期后成功。
5. `scripts/verify-backup-restore.ps1 -BackupRoot <备份目录> -Method ExportImport`：查询原数据、导入备份、读回比对，再确认原集合未改。`scripts/normalize-mongo-export.cjs` 仅转换导出日期格式，不输出数据。

脚本限制：仅允许已确认测试环境；备份须在源码目录外；目标前缀不能已存在；当前试点每集合最多100条，超出停止；失败保留证据、不自动删除。每次执行创建新的隔离集合，不能作为周期任务反复运行。

## 未验证与边界

- 这是**导出备份的逻辑内容恢复**，不是平台时间点恢复或完整灾难恢复演练。
- 两个集合为空，尚不能证明多事件、多照片关联恢复正确；后续需要完整关联样本。
- 图片已备份且哈希核对，尚未重新上传到新存储位置并验证 fileID 重建。
- 索引、安全规则、函数调用权限与安全域名尚未完成导出恢复和角色访问测试。
- 本机备份尚无异机验证；平台主体和 AppID 与环境绑定仍待核验。
