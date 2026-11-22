# 第三方材料说明

## 文泉驿微米黑字体

用途：服务端在照片水印中显示中文。

文件：

- `cloudfunctions/imagePipelineProbe/fonts/wqy-microhei.ttc`：新版渲染器使用的字体。
- `legacy/fonts/wqy-microhei.ttc`：保留的旧副本；同样适用下述字体许可。

上游材料保存在`cloudfunctions/imagePipelineProbe/fonts/`：

- `README.txt`：上游作者、版权、版本、许可及字体嵌入例外说明。
- `LICENSE_Apache2.txt`：上游提供的Apache 2.0许可原文。
- `LICENSE_GPLv3.txt`：上游提供的GPLv3许可原文。

上游说明将字体作为Apache 2.0或带字体嵌入例外的GPLv3双许可提供；完整条件以附带原文为准。保留Google及文泉驿项目等原版权声明；本项目没有修改字体文件。

核对来源：`anthonyfok/fonts-wqy-microhei`的Debian字体包源码镜像。通过GitHub文件元数据核对，上游字体Git blob与本地新版字体一致；本地SHA-256：

```text
e4bca8df123ce01b104780f576ea1a58b9a5ff1662a91124b6d3180cb6c88212
```

## npm依赖

Vue、Element Plus、CloudBase SDK、Sharp等依赖通过各子项目的`package.json`及锁文件安装。`node_modules/`不提交仓库；各依赖自己的许可证及声明随依赖包提供。正式分发打包产物前应保留所分发依赖要求的声明。

## 业务代码

本文件只记录第三方材料，不为整个业务项目新增开源许可。公开仓库的可访问性与业务代码许可范围是不同事项。
