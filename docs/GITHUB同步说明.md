# GitHub同步说明

更新日期：2026-11-22。对应仓库：`COERMI/TWCP-mini`，分支：`main`。

## 本次同步记录

2026-11-22，当前源码和文档已首次推送到`main`。新基线提交为`1f7997cae67ec986e029d67e26877c9d655b8dd8`，共222个文件；已核对远程`main`与该提交一致。后续记录提交可继续更新本说明，新基线不是找回的旧历史。

本次本地相关测试108项通过；README文档链接、上传内容检查和暂存差异检查通过。常见凭据格式、本机真实密钥值和已知邀请值均未在待上传内容中检出。旧教程中与本机实际秘密值相同的示例已在提交前移至本机私有备份；没有进入本次Git提交或推送。

本次只同步代码与说明，没有执行新的云部署、改变权限、上传小程序正式版本或导出真实业务资料。

## GitHub在这里是做什么的

它保存代码和说明文档的版本。以后能知道哪天改了什么，出问题时也能比较差异。**上传GitHub不会自动发布小程序，不会自动部署云函数，也不会同步云端照片或数据库。**

本次核对时该仓库公开且为空，本机具备上传权限。以前记载的Git提交历史没有找回；本次从当前经过整理的源码建立新基线，不把它说成恢复了旧历史。

## 上传哪些，不上传哪些

|内容|处理方式|
|---|---|
|业务源码、界面、自动测试、工具脚本|上传|
|README、负责人操作说明、文件用途表|上传|
|依赖版本锁文件|上传，便于按相同版本安装|
|脱敏的文字验收摘要|上传；每批说明测试范围和未测项|
|管理员密码、签名密钥、云端临时凭据|不上传|
|`.env.local`、`project.private.config.json`、`*.private.*`|忽略，不上传|
|手机目标邀请`target.js`、试件访问凭据|忽略，在私有测试工程中生成|
|邀请码、测试二维码、实拍照片、平台截图|不上传；截图中的二维码也不上传|
|`node_modules/`、构建输出`dist/`、日志|忽略，可按锁文件重新生成|

AppID、云环境ID是项目连接参数，不是管理员密钥；公开代码不意味着别人取得管理员账号或本趟司机权限。

`docs/evidence/`中只有经过检查的文字摘要进入仓库。部分报告提到本机图片路径，因此在GitHub查看时可能看不到这些图片；这是有意保留在本机，不代表图片或真实测试记录被删除。

## 文件说明怎样找

- GitHub仓库首页打开`README.md`，先看“不懂代码，从这里看”。
- 按`docs/文件用途说明.md`查具体文件；表中明确区分新版、旧版、演示和测试。
- 日常操作看`docs/QUICK_START_FOR_OWNER.md`顶部。
- 当前未完成项看`docs/IMPLEMENTATION_STATUS.md`和`docs/STAGE7_ADMIN_VIEW.md`。

## 后续怎样同步

由实施人员完成检查、提交和推送，负责人不需要手工复制整个目录上传。

```powershell
git status --short
git add README.md docs admin cloudfunctions miniprogram scripts test tools legacy .gitignore .gitattributes cloudbaserc.json project.config.json THIRD_PARTY_NOTICES.md
node scripts/update-file-guide.cjs
git add docs/文件用途说明.md
node scripts/check-publication.cjs --staged
git diff --cached --stat
git commit -m "说明本次改了什么"
git push origin main
```

检查脚本会核对暂存文件中的敏感文件名、常见凭据格式及真实本机密钥值，只报告文件与行号，不输出秘密内容。它是上传前的辅助检查，仍需人工核对改动范围。不要使用强制推送覆盖远程历史；出现别人已经更新的情况，先拉取并处理差异。

仓库未为整个业务项目新增MIT等开源授权。第三方字体有独立许可，见根目录`THIRD_PARTY_NOTICES.md`；这份字体许可不会改变业务代码的许可范围。
