# 部署与上线说明（DEPLOYMENT）

## 当前部署入口（2026-11-22）

本文件后文是旧系统部署说明，保留作背景，**不要直接按旧步骤整批部署**。根目录`cloudbaserc.json`是历史清单，不完整，也不是当前新版函数的发布清单。

当前测试版的实际路径：

- 新版业务云函数：`cloudfunctions/transportV1/`，当前测试环境已部署`transport-v1-admin-2`。
- 图片渲染源：`cloudfunctions/imagePipelineProbe/renderer.js`及`fonts/`，打包时复制到新版函数的独立部署工程。
- 总部页面：`admin/`，构建后由`scripts/preview-admin.cjs`在本机提供联调服务；公网认证和托管尚未完成。
- 手机整趟联调：`tools/workflow-probe/`，准备脚本在源码目录外生成含本趟邀请的私有工程。根目录`miniprogram/`仍是旧页面。

开发人员先读`STAGE4_INVITATION_API.md`、`STAGE4_PHOTO_WORKFLOW.md`、`STAGE7_ADMIN_VIEW.md`，核对部署对象、环境、变量名称、依赖、备份和当前源码，再执行其中对应批次。准备或云检查脚本有些会创建测试数据，不能因为文件名有“check”就当作只读工具。

存储保持ADMINONLY，授权上传由新版服务端签发。不要为恢复旧直接上传而降低权限。GitHub代码同步不执行云端部署；生产发布仍需单独验收。

---

本文档说明如何把本项目部署到微信云开发环境并投入使用。

---

## 1. 前置准备

| 项 | 说明 | 是否必需 |
| --- | --- | --- |
| 微信开发者工具 | 最新稳定版 | 必需 |
| 小程序 AppID | 开发期个人 AppID 即可；上线期需企业/个体工商户 AppID | 必需 |
| 微信云开发环境 | 免费版（1 个环境）即可 | 必需 |
| 和风天气 API Key | 用于水印天气信息，免费版即可 | 可选（无则水印缺天气） |
| 腾讯位置服务 API Key | 用于经纬度转可读地址 | 可选（无则只存经纬度） |

---

## 2. 修改基础配置

1. `project.config.json`：把 `appid` 的 `touristappid` 换成你的小程序 AppID。
2. `miniprogram/config.js`：把 `CLOUD_ENV_ID` 换成你的云开发环境 ID（微信开发者工具 → 云开发 → 设置 → 环境 ID，形如 `cloud1-xxxxxxx`）。

---

## 3. 创建数据库集合

在微信开发者工具 → 云开发控制台 → 数据库，创建以下 4 个集合：

| 集合名 | 用途 | 权限建议 |
| --- | --- | --- |
| `transport_records` | 运输档案 | 所有用户不可读写（仅云函数访问） |
| `transport_events` | 运输事件 | 所有用户不可读写 |
| `photo_records` | 照片记录 | 所有用户不可读写 |
| `counters` | 档案编号计数器 | 所有用户不可读写 |

> 说明：小程序端所有读写均通过云函数完成（云函数拥有管理员权限，不受集合权限限制）。把集合权限设为「所有用户不可读写」最安全，可防止绕过云函数直连数据库。

### 集合字段（与代码一致）

**transport_records（运输档案）**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| record_no | string | 档案编号，如 TR2026120001（唯一） |
| plate_number | string | 车牌号 |
| status | string | `active`(进行中) / `submitted`(已提交) |
| created_at | date | 创建时间 |
| updated_at | date | 最近更新时间 |
| submitted_at | date/null | 提交时间 |
| access_token | string | 司机访问档案的安全令牌 |
| photo_count | number | 照片总数（冗余计数） |
| event_count | number | 事件总数（冗余计数） |

**transport_events（运输事件）**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| record_id | string | 所属档案 `_id` |
| event_no | number | 事件序号（同类型动态事件递增） |
| event_type | string | WAYBILL / CARGO_PHOTO / LOADED_COMPARTMENT / DOOR_OPEN / DOOR_CLOSE / OTHER |
| event_name | string | 事件显示名，如「第2次开门」 |
| remark | string | 备注（可选） |
| photo_count | number | 该事件照片数 |
| created_at / updated_at | date | 创建/更新时间 |

**photo_records（照片记录）**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| record_id | string | 所属档案 `_id` |
| event_id | string | 所属事件 `_id` |
| original_url | string | 原图云存储 fileID |
| watermarked_url | string | 水印图云存储 fileID |
| device_capture_time | date | 设备拍摄时间 |
| server_received_at | date | 服务器接收时间（标准时间） |
| latitude / longitude | number/null | 经纬度 |
| location_text | string/null | 可读地址 |
| location_accuracy | number/null | 定位精度 |
| weather | string/null | 天气状况 |
| temperature | number/null | 温度 |
| weather_fetched_at | date/null | 天气获取时间 |
| upload_status | string | `success` |
| is_appended | bool | 是否提交后追加 |
| created_at | date | 记录创建时间 |

**counters（编号计数器）**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| _id | string | 固定为 `record_seq` |
| year_month | string | 当前计数年月 YYYYMM |
| seq | number | 当月序号 |

---

## 4. 数据库索引（建议）

在云开发控制台为以下字段建立索引，提升查询效率：

| 集合 | 索引字段 | 用途 |
| --- | --- | --- |
| transport_records | record_no（唯一索引） | 按编号查档案 |
| transport_records | plate_number | 后台按车牌搜索 |
| transport_records | status + created_at | 后台状态/日期筛选 |
| transport_events | record_id + event_no | 档案下事件排序 |
| photo_records | event_id | 事件下照片列表 |
| photo_records | record_id | 档案下全部照片 |

---

## 5. 部署云函数

在微信开发者工具中，对 `cloudfunctions/` 下每个云函数目录执行：**右键 → 上传并部署：云端安装依赖**。

| 云函数 | 依赖 | 运行时建议 |
| --- | --- | --- |
| createRecord | wx-server-sdk | Nodejs 18.15 |
| getRecord | wx-server-sdk | Nodejs 18.15 |
| submitRecord | wx-server-sdk | Nodejs 18.15 |
| uploadPhoto | wx-server-sdk + sharp + axios | **Nodejs 18.15**（sharp 需要） |
| adminLogin | wx-server-sdk | Nodejs 18.15 |
| listRecords | wx-server-sdk | Nodejs 18.15 |
| getRecordAdmin | wx-server-sdk | Nodejs 18.15 |

> ⚠️ `uploadPhoto` 云函数目录内已包含 `fonts/wqy-microhei.ttc`（开源中文字体），部署时会随代码一起上传，用于水印中文渲染，请勿删除。该函数依赖较多（sharp 含原生二进制），首次部署请务必选择「云端安装依赖」并耐心等待显示成功。

---

## 6. 云函数环境变量

在云开发控制台 → 云函数 → 对应函数 → 配置 → 环境变量，添加：

**`uploadPhoto` 函数（天气 + 逆地理）：**

天气支持两种认证方式，**二选一即可**（推荐 JWT，和风天气官方推荐，2027 年起 API Key 受限）：

| 变量名 | 说明 | 必需 |
| --- | --- | --- |
| `QWEATHER_KID` | 和风天气 JWT 凭据 ID（控制台-项目-凭证里，10 位大写） | JWT 方式必需 |
| `QWEATHER_ISS` | 和风天气开发者 ID（Q 开头 10 位，控制台-设置-开发者信息） | JWT 方式必需 |
| `QWEATHER_SUB` | 和风天气项目 ID（控制台-项目里，10 位大写） | JWT 方式必需 |
| `QWEATHER_PRIVATE_KEY` | 和风天气 Ed25519 私钥（PEM，创建 JWT 凭据时生成的私钥） | JWT 方式必需 |
| `QWEATHER_API_HOST` | 和风天气 API Host（控制台-设置里，形如 `xxx.qweatherapi.com`） | JWT 方式必需 |
| `WEATHER_KEY` | 和风天气 API Key（**旧版方式**，仅当不用 JWT 时才配） | 可选 |
| `TENCENT_MAP_KEY` | 腾讯位置服务 API Key（逆地理编码，经纬度转可读地址） | 可选 |

> 两种天气方式都未配置时，水印天气显示「暂不可用」，不阻断上传；逆地理未配置时地点显示「定位未获取」。
> `QWEATHER_PRIVATE_KEY` 支持两种粘贴格式：多行 PEM，或去掉换行的单行（代码会自动恢复）。

**`adminLogin` 函数（后台登录必需）：**

| 变量名 | 说明 | 必需 |
| --- | --- | --- |
| `ADMIN_USERNAME` | 后台管理员账号 | **必需** |
| `ADMIN_PASSWORD` | 后台管理员密码 | **必需** |
| `ADMIN_SECRET` | 签发登录 token 的密钥（随意一串较长的随机字符，如 `tpa-2026-xxxxxx`） | **必需** |

> ⚠️ 这三个不配置，后台将无法登录（会提示「管理员账号尚未配置」）。`ADMIN_SECRET` 是 token 签名密钥，请设置成一段只有你知道的随机字符串，且务必与密码不同。

---

## 7. 天气接口的如实说明

- 和风天气**免费版提供「实时天气」**，不提供「历史天气」查询（历史天气为付费能力）。
- 本系统上传照片时调用**实时天气接口**，并记录「天气获取时间」。由于司机拍照后立即上传，实时天气可近似视为拍摄时天气。
- 水印中天气信息与「天气获取时间」一并体现，**不冒充历史天气**。若将来客户要求精确历史天气，需升级和风天气付费版。

---

## 8. 云存储权限

- 云存储目录 `transport-records/` 用于存放原图与水印图。
- 司机端通过 `wx.cloud.uploadFile` 直传原图（需云存储对小程序用户开放写权限，建议「仅创建者可读写」）。
- 后台/云函数通过管理员权限读取任意图片，不依赖公开链接。

---

## 9. 后台管理页面部署（静态托管）

后台是纯静态页面，构建产物已打包为 `admin-dist.zip`（或自行在 `admin/` 目录运行 `npm install && npm run build` 生成 `admin/dist/`）。

1. **改配置**：部署前先用记事本打开 `dist/config.js`，把 `envId` 的 `your-cloud-env-id` 改成你的云环境 ID，保存。region 一般留空（默认上海）。
2. **开通静态托管**：云开发控制台 →「静态网站托管」→ 开通（免费）。
3. **上传文件**：把 `dist/` 目录下所有文件上传到托管根目录（含 `index.html`、`config.js`、`assets/` 文件夹）。
4. **记录域名**：记下托管的访问域名（形如 `https://xxx.tcloudbaseapp.com`），用浏览器打开即可访问后台。
5. **开启匿名登录**：云开发控制台 →「登录授权」，确认「匿名登录」已开启（后台 Web 端调用云函数需要）。
6. **添加 Web 安全域名**：云开发控制台 →「安全配置 / Web 安全域名」，把第 4 步的访问域名添加进去，否则浏览器调用云函数会被判定为非法来源。

> 后台登录账号密码见第 6 节 `adminLogin` 的环境变量 `ADMIN_USERNAME` / `ADMIN_PASSWORD`。修改密码 = 改对应环境变量后保存即可，无需改代码。

---

## 10. 本地逻辑测试

```bash
node test/logic.test.js
```

覆盖：车牌校验、键盘类型切换、事件名生成、档案编号格式、水印行内容。共 23 项断言，应全部通过。

---

## 11. 上线切换清单（个人 AppID → 企业 AppID）

开发期用个人 AppID，上线前切换为企业/个体工商户主体时：

1. 用企业资质注册新小程序，获取**新 AppID**。
2. 在新 AppID 下**重新开通云开发环境**（个人环境的云资源不会自动迁移）。
3. 修改 `project.config.json` 的 `appid`、`miniprogram/config.js` 的 `CLOUD_ENV_ID`。
4. 重新创建 4 个数据库集合与索引（见第 3、4 节）。
5. 重新部署 4 个云函数，并重新配置环境变量。
6. 代码逻辑无需任何改动。
7. 开发期测试数据保留在个人环境，正式上线使用干净的新环境。

---

## 12. 常见故障排查

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| 水印中文乱码/方框 | 字体文件缺失或未上传 | 确认 `uploadPhoto/fonts/wqy-microhei.ttc` 存在并已随函数部署 |
| 天气始终「暂不可用」 | 未配置 WEATHER_KEY 或超免费额度 | 检查环境变量、和风天气控制台用量 |
| 定位失败 | 未授权或室内信号差 | 检查小程序定位权限声明、真机重试 |
| 上传照片失败 | 云函数未部署或权限错误 | 检查云函数日志、集合权限设置 |
| 档案编号重复 | counters 集合未创建 | 确认 counters 集合存在（云函数会自动写入） |
