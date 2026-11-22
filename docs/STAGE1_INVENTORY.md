# 阶段 1：版本与云资产只读盘点

> 2026-11-21 后续证据更新。本报告主体保留当时的只读盘点结果。之后已完成本地配置及 ExportImport 隔离集合逻辑文档恢复，证据位于本机备份目录的 `restore-20261121-204605`，本轮重新比对保存的恢复前、恢复后及原集合事后快照，四集合内容一致。索引、权限、图片恢复及平台绑定仍待验证。可点击原型也已产出。当前状态及行动以 `当前进度与下一步行动.md` 为准。

盘点日期：2026-11-21（Asia/Shanghai）。本报告只记录实际证据；未测与未知不写为通过。环境标识和业务文件路径已缩略；不记录密码、私钥、令牌、临时下载地址或业务照片。

后续实施补充：已完成本机备份及独立测试集合的逻辑内容恢复比对，见 `STAGE1_BACKUP_RESTORE.md`；本报告下面“未执行恢复”等是首次只读盘点时的历史状态，后续结果以上述恢复报告为准。平台时间点恢复仍未通过，主体与绑定仍待核验。

## 环境与身份

|项目|实际结果|来源/限制|
|---|---|---|
|当前源码目录|`D:\transport-archive`|本地读取|
|Git 工作树|当前目录及父目录未识别到 Git 仓库|`git rev-parse --show-toplevel` 失败|
|旧提交|旧文档声称首次提交为 `55a5165`；用户已确认历史无法找回|`docs/PROGRESS.md:22` 及本聊天后续回复；以当前本地与云端快照作后续基线，不再等待原历史|
|旧远程|`COERMI/TWCP-mini` 查询退出码 0，但返回 0 条引用|`git -c credential.interactive=false ls-remote`；不能据此断言仓库被删除，也不能证明旧提交不存在于其他位置|
|已确认测试环境|`cloud1-…8ea74`，上海 `ap-shanghai`，传统 `baas`，状态 `NORMAL`|CloudBase CLI 查询；用户在本聊天确认“专用测试环境，无真实业务数据”|
|已确认生产环境|未发现|仅查询当前登录账号的默认可见环境；不代表其他账号或隐藏环境不存在|
|本机云登录|现有 CLI 登录态可用于查询，无需重新扫码|CloudBase CLI 3.9.4 的真实查询成功|
|小程序 AppID|用户提供 `wx2c993513e03bb60a`，已写入本地；平台绑定待核|`project.config.json` 及本聊天；初次盘点时为 `touristappid`|
|主体、管理员、审核与体验成员|未验证|需微信公众平台账号页面核实|
|套餐|CLI 返回个人版 `baas_personal`，非永久免费，未自动续费|`tcb env:list --json --skip-probe`；未修改套餐，不依据旧文档承诺免费|
|两端目标环境|初次盘点为占位符；收到 AppID 后，两端本地配置已统一为上述测试环境，后台地域为上海|`miniprogram/config.js`、`admin/public/config.js`、`cloudbaserc.json`；未部署|
|本地变量|`.env.local` 存在 `AI_DEFAULT_AGENT`、`ENV_ID`|仅登记变量名，不记录值；不等同于云函数变量已配置|

## 云函数：源码、调用者、部署与实际版本

云端当前版本均为 `$LATEST`、状态 Active、入口 `index.main`。下面的修改时间为 CLI 原始返回值，没有时区后缀，不将其误写成带时区的时间点。完整 SHA-256 见 `evidence/2026-11-21/source-hashes.json`；安全筛选后的云端配置及请求 ID 见 `cloud-functions.json`。

|函数|本地源码/调用者|清单|云端运行时 / 内存 MB / 超时秒|云端修改时间|源码比对|
|---|---|---|---|---|---|
|createRecord|`cloudfunctions/createRecord`；`miniprogram/pages/index/index.js:46`|有，Node18|Node18.15 / 256 / 10|2026-11-20 17:22:34|入口与 package.json 字节一致|
|getRecord|`cloudfunctions/getRecord`；`miniprogram/pages/record/record.js:41`|有，Node18|Node18.15 / 256 / 10|2026-11-20 17:22:33|入口与 package.json 一致|
|submitRecord|`cloudfunctions/submitRecord`；`miniprogram/pages/record/record.js:269`|有，Node18|Node18.15 / 256 / 10|2026-11-21 16:56:41|入口与 package.json 一致|
|uploadPhoto|`cloudfunctions/uploadPhoto`；`miniprogram/pages/record/record.js:176`|有，Node18|Node18.15 / 512 / 20|2026-11-21 18:22:52|入口有差异；package.json、中文字体一致|
|adminLogin|`cloudfunctions/adminLogin`；`admin/src/api/admin.js:7`|缺失|Node16.13 / 256 / 3|2026-11-21 16:58:33|入口、package.json、auth.js 一致|
|listRecords|`cloudfunctions/listRecords`；`admin/src/api/admin.js:12`|缺失|Node16.13 / 256 / 3|2026-11-21 16:56:34|入口、package.json、auth.js 一致|
|getRecordAdmin|`cloudfunctions/getRecordAdmin`；`admin/src/api/admin.js:17`|缺失|Node16.13 / 256 / 3|2026-11-21 16:56:29|入口、package.json、auth.js 一致|
|getEnvInfo|本地缺失；当前小程序及后台检索未找到调用者|有，Node18|Node18.15 / 256 / 20|2026-11-21 00:13:40|已下载独立副本，未写回业务目录|

`uploadPhoto` 的已识别差异仅在 `normalizePrivateKey`：云端提取 PEM 标记之间的正文、移除所有空白再重排；本地对带换行的文本直接返回，对标记与正文之间带空格的单行文本未做相同处理。已用 `git diff --no-index`核对，未覆盖任一版本。

找回的 `getEnvInfo` 是天气和逆地理函数，源码注释采用“客户端生成水印”的旧契约；当前页面走服务端 `uploadPhoto`。它还保留“记录有 token 才比较”的旧权限逻辑。保留副本，待版本契约决定后处理，不据当前无调用删除线上函数。

下载位置：`C:\Users\user\AppData\Local\Codex\mediaserver-audit-20261121\<函数名>`。这是当前云端代码快照，不是原 Git 历史，也不是完整数据库/存储备份。下载的依赖声明和字体已比对，但未声称比对所有云端安装后的依赖二进制。

## 云函数变量

以下仅为变量名和是否存在，不证明凭据有效或权限正确：

|函数|实际已配置变量名|差异|
|---|---|---|
|uploadPhoto|`QWEATHER_API_HOST`、`QWEATHER_ISS`、`QWEATHER_KID`、`QWEATHER_PRIVATE_KEY`、`QWEATHER_SUB`|无 `TENCENT_MAP_KEY`；天气路径、观测时刻与实际账户授权待试件验证|
|adminLogin|`ADMIN_USERNAME`、`ADMIN_PASSWORD`、`ADMIN_SECRET`|未尝试使用实际密码登录|
|listRecords|无|缺 `ADMIN_SECRET`，无法按当前实现正常验证登录签发的令牌|
|getRecordAdmin|无|缺 `ADMIN_SECRET`，同上|
|createRecord/getRecord/submitRecord/getEnvInfo|无|未修改|

## 数据、文件、权限与托管

|资产|只读结果|来源/未验证项|
|---|---|---|
|transport_records|2 条|数据库 count；未输出车牌和 token|
|transport_events|0 条|数据库 count|
|photo_records|0 条|数据库 count|
|counters|1 条|数据库 count|
|以上四集合索引|各只有 `_id_` 与 `_openid_1`|`listIndexes` 查询；无档案号唯一索引、业务复合索引或幂等索引|
|云存储|4 个 JPEG 路径：两个 orig、两个 wm；总大小 1,666,592 字节|`storage list --json`；文件名不证明水印合格|
|记录与文件一致性|当前照片记录为 0，但仍有 4 个文件，需纳入只读对账|未下载或删除业务照片；不能凭命名推断真实关联或失败原因|
|存储权限|CLI 显示“仅创建者和管理员可读写”|`storage get-acl`；未完成双司机、过期管理员或直接 fileID 下载测试|
|数据库权限/函数调用规则|未验证|未读取或修改业务安全规则；不能由存储权限推断数据库权限|
|Web 身份登录|AnonymousLogin=false，UserNameLogin=true|`env login get --json`|
|后台契约冲突|当前 `admin/src/api/cloudbase.js` 必须先匿名登录，但该环境未开启|代码与配置比对；尚未执行真实浏览器业务登录|
|静态托管|服务 Online，默认 index.html；仅发现认证资源与 `cloud-admin/index.html` 共 6 个对象|`hosting detail/list`；没有本地 Vue 构建对应资产的证据，不能把服务 Online 当作项目后台部署成功|
|后台依赖锁|`admin/package-lock.json` 存在，lockfileVersion=3|未在本批安装依赖或构建|

计数请求 ID：`80755ba3-181a-4ec4-a5f7-4b1910e9eae7`。索引请求 ID：`59369f58-622b-4b5f-b397-a1536146ea2c`。

一次索引请求因 PowerShell 无序 Hashtable 将 `cursor` 排到首项，服务端报 `CommandNotFound`；改用首项为 `listIndexes` 的显式 JSON 字符串后查询成功。失败请求未写数据。

## 备份与恢复

- `db nosql backup time --json` 返回一个可恢复点 `2026-11-21 04:04:16`，及区间 `2026-11-20 17:10:58` 至 `2026-11-21 19:25:21`（均为 CLI 原始时间文本，时区待核）。
- 该点的 `backup collection` 返回四个业务集合；请求 ID 为 `44525829-5fb8-4602-9a62-64c2fb7727a0`。
- 这只证明平台返回恢复来源，未执行恢复，也未导出完整集合和文件备份。不得写“恢复演练通过”。
- 后续恢复必须使用隔离副本或明确不同的新集合名，不能以当前业务集合为目标。需对导出数量、令牌保密、索引、权限和文件关联分别核验。

## 仍需补齐的验收证据

1. 原 Git 历史：用户已确认无法找回，此项以“历史缺失”结束追查；旧提交无法核验的限制永久保留。后续使用当前本地与云端快照作为基线，不冒充历史恢复。
2. 微信公众平台中的 AppID、主体、管理员、与环境绑定关系。具体入口为微信公众平台“小程序 → 设置 → 基本设置”；扫码由负责人本人完成。本机 CLI 不需要重登。
3. 隔离数据备份及恢复抽查；当前回退时间记录不代替实际恢复。
4. 完整安全规则、函数调用规则、安全域名以及真机身份验证。没有证据时不改成公开可读。

阶段结论：完成了本地与已确认测试环境的只读盘点和源码找回对照；阶段 1 整体验收尚未完成，后续阶段未实施。收到用户 AppID 后已更新本地 AppID 和两端测试环境配置；业务逻辑、云配置、数据、权限及线上函数均未修改。
