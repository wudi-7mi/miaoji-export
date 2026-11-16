# 妙记导出

独立的 Edge / Chrome Manifest V3 扩展，将妙记右侧的文字记录导出为 Markdown、TXT 或 JSON。

当前版本：`0.1.1`。已通过本地模拟页面和真实 MV3 扩展测试，并于 2026-11-16 通过 Playwright MCP 在已登录的讯飞企业部署妙记页面验证提取器：采集到 589 段、24,128 个正文字符、4 位发言人，时间从 `00:00` 到 `01:31:29`；段落 ID 无重复、时间顺序正确、结束后恢复原滚动位置。Markdown、TXT、JSON 均可生成。此验证在页面内存中进行，没有将实际会议正文写入项目。实际账户中尚未安装本扩展，MV3 加载、面板及下载链路由隔离浏览器中的合成页面验证。

企业适配支持 `.transcript-paragraph-item`、以 `user-name-content` / `time-content` 属性展示的发言人和时间戳、嵌套 `data-zone-id` 段落标识，以及 `overflow: hidden` 的 `rc-virtual-list-holder` 虚拟滚动。无法识别的版本会明确提示，不会将整页摘要、菜单当作正文导出。

## 安装与使用

无需构建，运行文件就在项目根目录。

1. 打开 `edge://extensions/`，开启开发人员模式。
2. 点击「加载解压缩的扩展」，选择 `C:\Users\hanwang42\Documents\project\miaoji_export`。
3. 刷新已经打开的妙记页面，切换右侧「文字记录 / 逐字稿」。
4. 点击页面右下角「导出文字记录」，或工具栏插件图标中的「导出当前妙记」。
5. 点击「开始采集」，核对段落数量、预览和提示，选择格式后下载。

默认包含 `feishu.cn`、`feishuapp.cn`、`larksuite.com`、`larkoffice.com` 和本次使用的企业域 `xfchat.iflytek.com`，均匹配子域名。仅在 HTTPS `/minutes/<标识>` 详情页显示入口。

企业使用其他域名时，在设置的域名列表添加该域名，点击「保存并授权」。域名按标签边界匹配，`example.com.evil.com` 不会被当作 `example.com`。关闭功能、移除域名会移除已有页面的入口；重新开启会向已授权的已打开页面注入脚本。

## 采集范围

- 默认从文字区域顶部滚动到底部，收集虚拟列表加载出的段落，保留发言人、时间戳和原始正文。采集过程中请将妙记标签页保持在前台，避免操作文字区域或播放时自动跟随滚动。切换到后台时会停止采集并提示重新开始，防止后台虚拟列表暂停后产生错误的完整性判断。
- 支持取消；成功、取消、失败都会尝试恢复原滚动位置。切换妙记时停止采集并清除上一个页面的结果。
- 取消「滚动采集长记录」时，仅导出当前已渲染段落，文件内会携带范围提示。
- 连续到达底部只代表页面遍历结束。没有服务端段落总数，**不能保证页面没有延迟加载或遗漏**，文件内保留此提示。
- 缺失发言人或时间戳、到达 90 秒上限、滚动受阻会显示提示；超时结果可以预览后手动下载，不会伪装成完整记录。
- 原始正文不经过 AI 改写。Markdown 会转义原文里的格式符和 HTML，TXT 保留纯文本，JSON 保留全部结构与采集范围。

## 企业版本的高级适配

在插件设置展开「高级适配」，按需要填写 CSS 选择器。留空使用 `extractor.js` 中的自动规则。

| 字段 | 含义 | 本次企业页面使用的选择器 |
| --- | --- | --- |
| root | 右侧文字记录区域 | `.paragraphs-container` |
| row | 每个完整发言段落，相对 root | `.transcript-paragraph-item` |
| text | 纯正文，相对 row | `.paragraph-content-editor` |
| speaker | 发言人，相对 row | `.p-user-name` |
| time | 时间戳，相对 row | `.p-time` |

以上选择器已包含在自动规则中，正常使用无需手动填写。时间戳支持 `MM:SS`、`HH:MM:SS` 和小数秒，或明确以毫秒为单位的 `data-start-ms` 属性。稳定的 `data-paragraph-id` / `data-sentence-id` / `data-index`，以及 `.paragraph-content-editor` 的 `data-zone-id` 用于跨滚动去重；没有标识时结合时间戳、发言人、正文和同屏出现次数。无标识且无时间戳的跨屏相同发言可能无法可靠区分，需人工核对。隐藏的分栏不会被读取。内容位于跨域 iframe、封闭 Shadow DOM 或完全不同组件中的版本尚未适配。

## 项目结构

- `shared.js`：统一默认配置、域名校验、匹配与脚本清单。
- `background.js`：企业域名按需注册与已打开页面激活。
- `popup.*`：工具栏设置、生效状态、域名授权和高级适配组件。
- `extractor.js`：文字区域识别、段落提取、滚动采集、取消与范围提示。
- `exporter.js`：Markdown / TXT / JSON 格式化与安全文件名。
- `content.js`：Shadow DOM 导出入口、预览、复制和本地下载。
- `tests/`：纯函数回归、虚拟列表与真实 MV3 集成测试；全部使用合成内容，不连接真实账户。

设计参考同级 `feishu-to-markdown` 仓库的 MV3、企业域名按需授权、设置状态和动态注入方式；两个项目独立，不修改原仓库。

## 开发与打包

需要 Node.js 22 或更新版本，本地浏览器测试默认使用已安装的 Google Chrome。可通过 `CHROME_PATH` 指向其他支持 `Extensions.loadUnpacked` 的 Chromium 浏览器。

```powershell
npm ci
npm run check
npm test
npm run test:browser
npm run package
```

浏览器测试在独立临时配置中拦截并返回合成妙记页面，覆盖普通及企业虚拟列表、属性元信息、恢复滚动位置、取消、超时、后台切换、适配失败、重复发言、扩展开关、重复注入、本地下载和 SPA 导航。自动测试不会接入已有 Edge 配置。`test-results/` 中保存模拟页面的 UI 截图，不包含实际会议资料。

Windows 打包结果位于 `dist/miaoji-export-edge-0.1.1.zip`，Manifest 位于压缩包根目录。

实现所用的浏览器接口参考 [Chrome scripting 官方文档](https://developer.chrome.com/docs/extensions/reference/api/scripting) 和 [权限声明官方文档](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)。

## 隐私与许可

所有提取、预览、转换均在本地浏览器完成。仅将开关、域名和选择器写入扩展同步设置，不持久化会议正文，不读取 Cookie、不调用转写 API、不上传会议内容。点击复制才写剪贴板；点击下载才生成本地文件。详见 [PRIVACY.md](PRIVACY.md)。

本项目是独立第三方工具，与飞书、Lark、讯飞无隶属或背书关系。使用 MIT License，保留参考仓库的版权声明。
