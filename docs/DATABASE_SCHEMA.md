# 数据库设计初稿（DATABASE_SCHEMA）

> 采用微信云开发「云数据库」（文档型，集合对应表）。字段为初稿，开发阶段可微调，但必须保留三级关联关系。

## 1. 关系总览

```
transport_records (运输档案)  1 ──── N  transport_events (运输事件)  1 ──── N  photo_records (照片)
```

## 2. transport_records（运输档案表）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| _id | string | 数据库主键（云数据库自动） |
| record_no | string | 运输档案编号，全局唯一（如 TR2026120001） |
| plate_number | string | 车牌号 |
| status | string | 档案状态：IN_PROGRESS（进行中）/ SUBMITTED（已提交）/ ARCHIVED（已归档，可选） |
| access_token | string | 司机访问当前档案的安全令牌（随机、唯一） |
| created_at | Date | 创建时间（标准 UTC，展示转 Asia/Shanghai） |
| updated_at | Date | 最近更新时间（最近一次照片/事件写入） |
| submitted_at | Date | 提交时间 |
| photo_count | number | 照片数量（冗余计数，便于列表展示） |
| event_count | number | 事件数量（冗余计数） |
| creator_openid | string | 创建档案的司机 openid（云开发自动获取） |

索引：`record_no`（唯一）、`plate_number`、`status`、`created_at`。

## 3. transport_events（运输事件表）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| _id | string | 事件主键 |
| record_id | string | 所属运输档案 _id |
| record_no | string | 冗余档案编号，便于查询 |
| event_no | number | 事件序号（同档案内递增） |
| event_type | string | 事件类型（见枚举） |
| event_name | string | 展示名称（如「第2次开门」） |
| remark | string | 备注（可选，任何事件类型可填，如「第2次开门：中途卸货」；后台可见） |
| created_at | Date | 事件创建时间 |
| updated_at | Date | 更新时间 |

事件类型枚举：
`CARGO_PHOTO` 货物照片 / `LOADED_COMPARTMENT` 装箱完成 / `WAYBILL` 货运运单 / `DOOR_OPEN` 开门 / `DOOR_CLOSE` 关门 / `OTHER` 其他

索引：`record_id`、`record_no`、`event_type`；联合查询按 `record_id + event_no` 排序。

## 4. photo_records（照片记录表）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| _id | string | 照片主键 |
| record_id | string | 所属运输档案 _id |
| event_id | string | 所属运输事件 _id |
| record_no | string | 冗余档案编号 |
| event_type | string | 冗余事件类型 |
| original_file_id | string | 原图云存储 fileID |
| watermarked_file_id | string | 水印图云存储 fileID |
| device_capture_time | Date | 设备拍摄时间（可获取时） |
| server_received_at | Date | 服务器接收时间（系统标准时间） |
| latitude | number | 纬度 |
| longitude | number | 经度 |
| location_accuracy | number | 定位精度（米） |
| location_text | string | 可读地址 |
| location_status | string | 定位状态：OK / FAILED / NOT_AVAILABLE |
| weather | string | 天气状况 |
| temperature | string/number | 温度 |
| weather_status | string | 天气获取状态：OK / FAILED / NOT_AVAILABLE |
| upload_status | string | 上传状态：UPLOADING / SUCCESS / FAILED |
| is_appended | boolean | 是否为档案提交后追加的照片（区分初始/追加） |
| created_at | Date | 记录创建时间 |

索引：`record_id`、`event_id`、`upload_status`。

## 5. admins（后台管理员表）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| _id | string | 主键 |
| username | string | 登录名（唯一） |
| password_hash | string | 密码哈希（bcrypt/scrypt，禁止明文） |
| created_at | Date | 创建时间 |

> 管理员账号通过一次性初始化脚本创建，密码哈希后入库；前端不出现任何账号明文。

## 6. 编号生成规则（初稿）

- 档案编号：`TR` + `YYYYMM` + 4 位序号，如 `TR2026120001`；用云函数内的原子计数器或按当月现有数量 + 1 生成，保证全局唯一（并发下需唯一约束兜底）。
- 事件序号：同档案内自增（第 N 次开门/关门）。
- 照片编号：数据库 `_id` 保证唯一。

## 7. 文件存储路径（初稿）

```
transport-records/{record_no}/{event_id}/original.jpg
transport-records/{record_no}/{event_id}/watermarked.jpg
```

实际以云存储 fileID 为准，数据库保存 fileID；文件名不暴露车牌等隐私。

## 8. 待确认/可调整项

1. 是否需要 `ARCHIVED` 状态（第一阶段建议只用 IN_PROGRESS / SUBMITTED）。
2. 天气温度字段存 number 还是 string（不同服务可能返回区间）。
3. 冗余计数字段（photo_count/event_count）是否保留（用于列表页性能）。

## 8. 固定节点顺序与严格锁定引导（数据支撑说明）

- 固定节点引导顺序：`WAYBILL`（第1步）→ `CARGO_PHOTO`（第2步）→ `LOADED_COMPARTMENT`（第3步）。
- **严格顺序锁定**由前端实现：某一步"已完成"的判定 = 该事件已存在且至少 1 张照片上传成功；未完成前，下一步按钮置灰不可点。
- 该逻辑**无需额外数据库字段**，通过查询 `transport_events` + `photo_records` 状态即可判断；引导进度可存前端本地缓存，非关键数据。
- 动态节点（开门/关门）不参与步骤序号，随时可拍。
