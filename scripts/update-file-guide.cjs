'use strict';
// Generate a complete human-readable guide from Git's non-ignored inventory.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const scripts = {
  'preview-watermark-styles.cjs':'生成两版水印的六张合成样例；只写本机证据，不部署、不读取真实司机照片',
  'admin-preview.cjs':'管理员核对本趟后调用微信工具生成独立测试二维码；会写私有工程并编译预览',
  'preview-admin.cjs':'启动本机总部网页和经过鉴权的云调用桥接；页面操作可以写测试数据',
  'preview-prototype.cjs':'启动本机业务原型；只提供本地演示页面',
  'prepare-stage3-probe.cjs':'准备独立图片试件，生成私有试件凭据和配置；不直接部署',
  'bundle-stage3-probe.cjs':'把已核对的字体和Linux图片依赖装入私有试件部署目录；不直接部署',
  'prepare-transport-v1.cjs':'准备新版云函数部署工程及带秘密变量的私有清单；不直接部署',
  'prepare-invitation-phone.cjs':'准备只测车牌确认和接续的旧手机试件，邀请放在私有工程',
  'prepare-workflow-phone.cjs':'准备当前整趟手机联调工程，沿用负责人已有测试邀请',
  'check-stage3-cloud.cjs':'调用真实云端图片试件处理合成图；会写测试图片',
  'check-transport-v1-cloud.cjs':'入口和身份检查；会创建TEST运输及修改测试目标，不作日常只读查询',
  'check-workflow-cloud.cjs':'整趟流程云检查；会建TEST运输、事件和合成照片',
  'check-workflow-storage.cjs':'检查归档文件读写权限；会上传/处理合成测试文件，执行前读源码',
  'check-workflow-native-upload.cjs':'通过微信工具自动化检查原生上传；会写合成照片',
  'check-admin-cloud.cjs':'总部兼容读和权限云检查；还会尝试准备查询索引，不能当作纯只读脚本',
  'check-dispatch-cloud.cjs':'总部建档云检查；会创建一条TEST运输并停用未领取入口',
  'verify-workflow-deployment.cjs':'读取部署配置、权限和索引，下载云端源码核对；不会新建运输',
  'verify-backup-restore.ps1':'备份和隔离恢复验证工具；会操作隔离恢复集合，须按恢复报告使用',
  'normalize-mongo-export.cjs':'规范化数据库导出的数值格式，便于比较备份与恢复结果',
  'check-publication.cjs':'只读检查准备上传的文件，阻止常见凭据、私有配置和本机实际秘密值进入仓库',
  'update-file-guide.cjs':'重新生成这份逐文件用途表；只修改说明文档',
};
const docs = {
  '司机体验优化实施说明.md':'本轮三步拍照、开关门自动保存、微信卡片和两版水印说明，含真机待验项目',
  'QUICK_START_FOR_OWNER.md':'负责人日常操作说明；不懂代码先看这份',
  '当前进度与下一步行动.md':'最新进展和接下来要做什么；优先看顶部',
  '文件用途说明.md':'本文件，逐个说明文件作用及新版/旧版位置',
  '阅读导航.md':'按使用者目的选择文档的入口',
  'GITHUB同步说明.md':'GitHub保存范围、排除内容和后续同步方法',
  'IMPLEMENTATION_STATUS.md':'当前分阶段实施表及历史补充，不能只看旧状态段落',
  'V1_ACCEPTED_SCOPE.md':'负责人已接受的第一版规则，是当前产品范围基线',
  'STAGE1_INVENTORY.md':'源码、云资产、账号状态和旧历史的盘点证据',
  'STAGE1_BACKUP_RESTORE.md':'隔离备份恢复的实测结果与限制',
  'STAGE3_IMAGE_PROBE.md':'水印图片试件、手机反馈、字体及尺寸验证',
  'STAGE4_INVITATION_API.md':'新版本趟入口、车牌确认和身份绑定接口报告',
  'STAGE4_PHOTO_WORKFLOW.md':'三项必拍、开关门、问题、完成及归档报告',
  'STAGE7_ADMIN_VIEW.md':'总部查图、建档、入口管理和测试二维码报告',
  '项目审查与重构方案.md':'项目审查及分阶段重构总方案；具体产品范围以已接受的第一版为准',
  '司机拍照流程优化建议.md':'前期使用体验建议，部分内容已被后续范围取代',
  'PROTOTYPE_REVIEW.md':'最初原型工程走查，保留历史过程',
  'PROTOTYPE_WORKFLOW_REVIEW.md':'现场流程原型较早版本的工程走查',
  'PROTOTYPE_DOOR_FLOW_REVIEW.md':'最终三项必拍和开关门原型的工程走查',
  'PROJECT_OVERVIEW.md':'早期项目概览，实际运行状态以当前实施记录为准',
  'REQUIREMENTS.md':'早期需求背景；有冲突时遵循V1_ACCEPTED_SCOPE',
  'TECHNICAL_ARCHITECTURE.md':'早期技术架构背景，新版实现还要对照阶段报告',
  'DATABASE_SCHEMA.md':'旧数据结构说明；新版集合/字段见新版接口报告和源码',
  'PAGE_PROTOTYPES.md':'前期页面草图，不能当作当前已发布页面',
  'DEVELOPMENT_PLAN.md':'早期开发排期和任务背景，非当前完成证明',
  'TEST_PLAN.md':'总体测试参考，具体通过范围看各批证据',
  'DECISIONS.md':'历史决策记录，后续已接受范围和实测补充优先',
  'DEPLOYMENT.md':'顶部说明当前正确部署入口；后文旧步骤不应直接批量执行',
  'PROGRESS.md':'前期开发历史，当前进度请看IMPLEMENTATION_STATUS',
};
const tests = {
  'driver-experience.test.cjs':'检查新司机交互、自动保存、分享选择和管理员令牌不进入卡片',
  'watermark-candidates.test.cjs':'真实渲染两种候选水印，核对运单页脚版正文像素与缺失字段',
  'admin-preview.test.cjs':'检查测试二维码生成隔离、并发和JPEG/PNG识别',
  'admin-review-bridge.test.cjs':'检查本机总部桥接鉴权、来源、大小和登录次数限制',
  'admin-workflow-view.test.cjs':'检查总部照片分组、排序和移除记录显示',
  'image-probe-handler.test.cjs':'检查图片试件入口的权限与失败边界',
  'prototype.workflow.test.cjs':'检查原型流程模型；包含前期规则，不代表正式页面测试',
  'server-watermark.test.cjs':'用真实Sharp渲染检查中文、方向、运单主体及异常图片',
  'transport-v1.admin.test.cjs':'检查总部新版/旧版兼容读、分页、日期和越权',
  'transport-v1.archive-identity.test.cjs':'检查归档工作线程只使用受限平台角色',
  'transport-v1.dispatch.test.cjs':'检查总部找回入口、拒绝重分配及建档草稿',
  'transport-v1.invitation.test.cjs':'检查建档、邀请、确认车牌、身份和幂等规则',
  'transport-v1.invitation-phone.test.cjs':'检查早期手机入口试件确认与重试',
  'transport-v1.upload-policy.test.cjs':'检查上传签名只允许指定对象、大小、期限与私有权限',
  'transport-v1.workflow-phone.test.cjs':'检查手机照片本地保存、失败重试、恢复和顺序显示',
  'transport-v1.workflow.test.cjs':'检查正式云端业务状态、开关门分组、照片计数和完成',
  'publication.test.cjs':'检查上传前凭据检测，避免漏检真实秘密或误拒绝正常PEM处理代码',
  'logic.test.js':'旧版业务逻辑测试',
  'token.test.js':'旧版管理员令牌测试',
  'watermark.test.js':'旧客户端水印文字和尺寸逻辑测试',
  'watermark.geometry.test.js':'旧客户端Canvas水印排版几何测试，使用桩并非真机绘制',
  'record.flow.test.js':'旧客户端双图契约测试；已知失败保留，不是新版全绿证明',
};
const transport = {
  'index.js':'云函数总入口：取得可信平台身份，装配数据库和图片服务',
  'service.js':'建档、邀请、车牌确认、停用入口和业务动作分发',
  'auth.js':'校验管理员令牌、可信司机身份和输入，不信任请求自报身份',
  'store.js':'实际文档数据库读写、事务及总部搜索适配',
  'workflow.js':'照片、三项顺序、开关门、问题和完成运输的核心规则',
  'admin.js':'总部新版/旧档案列表详情、分页与照片访问授权',
  'media.js':'图片下载、渲染、服务端归档与访问链接',
  'archive-upload.js':'启动隔离归档线程，只传入允许的平台角色环境',
  'archive-worker.js':'在线程中执行文件归档或上传签名操作',
  'upload-policy.js':'生成仅限本环境单个照片目标的COS上传策略',
};
const legacyCloud = {
  adminLogin:'既有管理员登录，当前本机总部沿用其登录结果',
  createRecord:'旧司机端建档接口，不是新版总部独立建档入口',
  getRecord:'旧司机端档案读取接口',
  submitRecord:'旧司机端基础资料提交接口',
  uploadPhoto:'旧照片上传、定位/天气及水印链路；不代表新版已接入定位天气',
  listRecords:'旧总部列表接口；新版总部调用transportV1',
  getRecordAdmin:'旧总部详情接口；新版总部调用transportV1',
};
const admin = {
  'index.html':'总部网页的HTML外壳，加载运行时配置',
  'vite.config.js':'总部开发与构建配置',
  'public/config.js':'公开云环境和地域参数；这里不能填密码或密钥',
  'src/main.js':'启动Vue应用并装配组件与路由',
  'src/App.vue':'总部网页外层和通用样式',
  'src/config.js':'读取并检查网页公开运行时配置',
  'src/router/index.js':'总部登录、列表、详情页面跳转',
  'src/api/admin.js':'总部登录、查档、创建和入口管理调用封装',
  'src/api/cloudbase.js':'选择Web SDK或本机鉴权桥接来调用云函数',
  'src/components/DispatchTrip.vue':'新建本趟、找回入口、生成测试二维码、停用发错入口的弹窗',
  'src/views/Login.vue':'管理员登录界面',
  'src/views/RecordList.vue':'总部运输列表、筛选、分页及入口操作',
  'src/views/RecordDetail.vue':'本趟事件分组、原图/水印图、纠正记录和翻图',
  'src/utils/auth.js':'本机令牌保存及北京时间格式化',
  'src/utils/dispatch.js':'建档草稿保存、稳定请求号和表单校验',
  'src/utils/workflow.js':'总部状态中文名称和事件分组规则',
};
function miniDescription(file) {
  const current = file.startsWith('tools/workflow-probe/');
  const family = current ? '当前整趟手机联调' : file.startsWith('tools/invitation-probe/') ? '早期入口手机试件' :
    file.startsWith('tools/image-probe/') ? '早期图片手机试件' : '旧司机主包';
  const name = path.posix.basename(file), extension = path.posix.extname(file);
  if (file.endsWith('/assets/share-card.png')) return '微信分享固定封面，只含公开操作提示，避免截图泄露管理员列表';
  if (name === 'project.config.json') return family+'的微信开发者工具项目配置；不包含私有邀请';
  if (name === 'app.js') return family+'的启动逻辑和云环境初始化';
  if (name === 'app.json') return family+'的页面清单和窗口设置';
  if (name === 'app.wxss') return family+'的全局外观样式';
  if (name === 'sitemap.json') return family+'的微信搜索收录配置';
  if (name === 'config.js') return '旧司机主包的公开环境及业务常量，不是管理员密钥';
  if (file.includes('/lib/')) return ({
    'photo-queue.js':'当前手机原图持久队列：先保存本机文件，断网/响应丢失后沿用原请求重试',
    'transport.js':'当前手机云调用和跨分页版本一致性检查',
    'view.js':'当前手机业务状态转成可显示的任务、照片和分组',
  })[name];
  if (file.includes('/utils/')) return ({
    'plate.js':'旧司机端车牌校验和键盘字符数据','cloud.js':'旧司机端云调用封装',
    'geo.js':'旧司机端定位封装；不能据此说新版已经采集定位',
    'date.js':'旧司机端日期处理','watermark.js':'旧客户端Canvas水印代码，当前新版采用服务端渲染',
  })[name];
  let screen = file.includes('/components/plate-keyboard/') ? '车牌键盘组件' :
    file.includes('/pages/entry/') ? '车牌核对和本趟入口页面' : file.includes('/pages/trip/') ? '整趟拍照、开关门和完成页面' :
    file.includes('/pages/capture/') ? '带有效内容取景框的相机页面' : file.includes('/pages/dispatch/') ? '管理员登录和发给司机页面' :
    file.includes('/pages/probe/') ? '图片试件操作页面' : file.includes('/pages/index/') ? '旧首页' :
    file.includes('/pages/record/') ? '旧拍照档案页面' : null;
  if (!screen) return null;
  return family+'：'+screen+'的'+({'.js':'交互逻辑','.wxml':'按钮与文字结构','.wxss':'颜色、字号和排版','.json':'页面/组件配置'})[extension];
}
function describe(file) {
  const name = path.posix.basename(file);
  if (file === 'README.md') return '仓库首页及负责人阅读入口';
  if (file === 'THIRD_PARTY_NOTICES.md') return '第三方字体许可、依赖说明及业务代码许可边界';
  if (name === '.gitignore') return 'Git上传排除规则：私人配置、依赖、日志和本机图片等不提交';
  if (file === '.gitattributes') return '统一代码换行规则，避免Windows与其他电脑产生无意义差异';
  if (file === 'cloudbaserc.json') return '历史部署清单，尚未覆盖新版；不要据此批量部署';
  if (file === 'project.config.json') return '微信主项目配置；已指向新版司机页面，AppID公开，私人设置另存且不上传';
  if (name === 'package.json') return '该子项目的依赖名称、版本和可执行命令';
  if (name === 'package-lock.json') return '锁定该子项目实际依赖版本，由npm维护，不要手工修改';
  if (file.startsWith('scripts/')) return scripts[name];
  if (file.startsWith('test/helpers/')) return '测试用内存数据库、合成图片和模拟身份工具，不是真实生产服务';
  if (file === 'test/wm_demo.jpg') return '旧水印布局的合成演示图片，不是真实现场或天气观测';
  if (file.startsWith('test/')) return tests[name];
  if (file.startsWith('admin/')) return admin[file.slice(6)];
  if (file.startsWith('cloudfunctions/transportV1/')) return '新版云端：'+transport[name];
  if (file.startsWith('cloudfunctions/imagePipelineProbe/')) {
    if (file.includes('/fonts/')) return name.endsWith('.ttc') ? '中文水印字体二进制；不要用文本编辑器修改' :
      name === 'README.txt' ? '字体上游作者、版权、许可和嵌入例外原文' : '字体上游许可原文，分发时保留';
    return ({'index.js':'隔离图片试件入口，受试件授权保护','renderer.js':'新版复用的中文水印与运单扩展页脚渲染器','styled-watermark.js':'两版候选水印：照片内叠加与照片外信息栏，尚未替换云端现用样式','fixtures.js':'生成各尺寸和方向的合成测试图，不含真实运单'})[name];
  }
  if (file.startsWith('cloudfunctions/')) {
    const group = file.split('/')[1];
    return (legacyCloud[group] || group)+'；'+(name==='auth.js'?'该旧接口的管理员验证实现':'云函数实现');
  }
  if (file.startsWith('miniprogram/') || file.startsWith('tools/')) return miniDescription(file);
  if (file.startsWith('legacy/fonts/')) return name.endsWith('.ttc') ? '旧客户端保留的字体副本，非新版入口' : '旧字体副本的用途及许可指引';
  if (file.startsWith('docs/prototype/')) return ({
    'index.html':'原型页面外壳','style.css':'原型视觉样式','app.js':'原型页面交互和演示操作','workflow.js':'原型本地流程模型和演示数据规则',
  })[name];
  if (file.startsWith('docs/evidence/')) {
    const purpose = {
      'source-hashes.json':'源文件哈希快照','cloud-functions.json':'脱敏云函数清单',
      'storage-backup-verification.json':'备份图片大小和摘要校验，不含图片本体',
      'backup-restore-verification.json':'隔离恢复逻辑文档比对结果','backup-restore-summary.json':'恢复范围和结论摘要',
      'local-tests.txt':'本批本地测试输出','probe-tests.txt':'图片试件本地测试输出',
      'cloud-checks.json':'本批真实云端检查结果','final-cloud-checks.json':'本批最终真实云端检查结果',
      'cloud-checks-before-storage-fix.json':'存储权限修复前的中间结果，不能当最终通过证明',
      'cloud-checks-before-scoped-policy.json':'精确上传策略修复前的中间结果',
      'deployment.json':'云端运行配置、权限、索引及部署源码哈希',
      'deployed-source.json':'已部署入口源码核对摘要','database-checks.json':'测试集合和数据库权限检查摘要',
      'phone-build.json':'手机预览编译和真机反馈状态，注意未测项',
      'phone-feedback.json':'负责人无报错反馈及该趟云端完成元数据',
      'upload-domain.json':'微信上传域名保存结果摘要，不含登录会话',
      'indexes.json':'本批真实索引名称与字段顺序',
      'browser-review.json':'工程浏览器操作检查摘要，非真实用户验收',
      'admin-build.txt':'总部前端构建结果及警告','admin-build-manifest.json':'总部构建文件大小和哈希',
      'results.json':'合成图片云端渲染测量结果','checks.json':'合成图片云端检查摘要',
    };
    return purpose[name];
  }
  if (file.startsWith('docs/')) return docs[name];
  return null;
}
function section(file) {
  if (!file.includes('/')) return '根目录：先看说明与配置';
  if (file.startsWith('admin/')) return '总部网页：当前新版';
  if (file.startsWith('cloudfunctions/transportV1/')) return '云端业务：当前新版';
  if (file.startsWith('cloudfunctions/imagePipelineProbe/')) return '图片渲染器、试件与字体';
  if (file.startsWith('cloudfunctions/')) return '既有云函数：保留兼容与登录';
  if (file.startsWith('tools/')) return '手机测试工程：并非正式发布包';
  if (file.startsWith('miniprogram/')) return '旧司机主包：尚未切换';
  if (file.startsWith('scripts/')) return '工具脚本：执行前看影响';
  if (file.startsWith('test/')) return '自动测试：供开发人员运行';
  if (file.startsWith('docs/prototype/')) return '交互原型：只作演示';
  if (file.startsWith('docs/evidence/')) return '验收文字摘要：不是业务数据';
  if (file.startsWith('docs/')) return '说明文档：按需要查阅';
  return '旧素材';
}
const files = execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,windowsHide:true})
  .toString('utf8').split('\0').filter(Boolean).map(f=>f.replaceAll('\\','/'));
files.push('docs/文件用途说明.md');
const unique = [...new Set(files)].sort();
const groups = new Map();
for (const file of unique) {
  const purpose=describe(file);
  if (!purpose || purpose.includes('undefined')) throw new Error('Missing file description: '+file);
  const group=section(file);
  if (!groups.has(group)) groups.set(group,[]);
  groups.get(group).push({file,purpose});
}
let text=`# 文件用途说明\n\n更新日期：2026-11-22。覆盖本次Git非忽略清单中的${unique.length}个文件；私人配置和本机照片不在此上传清单中。\n\n## 给代码小白的读法\n\n- 你日常只需要操作页面和阅读文档，不需要逐个修改代码。\n- 想找某个文件，用搜索功能查完整文件名；下面按角色分组逐个列出用途。\n- \`.js/.cjs\`是逻辑，\`.vue\`是总部界面，\`.wxml\`是微信页面结构，\`.wxss/.css\`是外观，\`.json\`是配置，\`.md\`是说明。\n- “旧版”“原型”“试件”已经明确标出；它们存在不代表当前正在正式使用。\n- 工具脚本可能写测试数据、图片或索引；不要因为名字有check/verify就自行运行。\n- 上传GitHub只保存版本，不执行页面发布、云部署或数据迁移。\n\n此表由\`node scripts/update-file-guide.cjs\`生成。开发人员新增文件时应补充用途映射再更新；命令只改本说明，不改业务数据。\n\n`;
for(const [group,rows] of groups){text+=`## ${group}\n\n|文件|作用|\n|---|---|\n`;for(const row of rows)text+=`|\`${row.file}\`|${row.purpose}|\n`;text+='\n';}
text+='## 为什么有些文件在GitHub里看不到\n\n`.env.local`、`project.private.config.json`、真实邀请`target.js`、试件访问凭据、二维码、平台截图、实拍照片、依赖目录和构建输出均按上传排除规则保留本机。它们没有被当作普通源码公开；详细范围见`GITHUB同步说明.md`。云端数据库和归档照片也不会随Git同步。\n';
fs.writeFileSync(path.join(root,'docs/文件用途说明.md'),text);
console.log(`文件用途说明已更新，逐项覆盖${unique.length}个文件。`);
