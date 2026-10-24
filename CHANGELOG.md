# 更新日志

本文件记录 cortico-world-qq-final 每个版本的改动，供扩展市场的「更新说明」直接读取。

## 未发布（本分支，基于 0.6.24）

- 新增默认关闭的 QQ 本地操作开关，配合宿主可信事件来源和工具前置检查限制 QQ 触发的本地工具；宿主改动见 `docs/host-tool-guard.md`，不能仅凭插件开关声称已完成隔离。
- 新增固定文件的 `qq_memory` 专用笔记，支持追加、最近和关键词查询，保留来源及不可信标记，不允许指定路径或修改角色文件。
- 新增全会话每日到点提醒额度（默认 5 次）和不调用模型的超额固定提示；修复中文分钟/小时倍率和默认提醒地址来源；提醒错误返回符合宿主工具回执格式。
- Windows 设置页新增一键启用插件并启动固定 NapCat EXE，拒绝任意命令和参数，不暴露为 AI 工具。
- 修复图片附件收到响应头就提前清除超时的问题；完整正文读取维持 20 秒截止，单张默认最多 8 MB，并让附件、辅助视觉及表情包下载共用按实际字节数限制的流式读取，失败及时取消且不阻塞后续消息。
- 补充便携回归测试和宿主参考补丁，控制台构建使用内容哈希文件名，并支持 `CORTICO_DIR` 指定宿主源码。

## 0.6.24

- 修复：`qq_send` 的 `[表情包:文件名]` 在漏写或写错常见图片扩展名时不再静默丢弃；会在表情包目录内尝试匹配 `.gif`、`.png`、`.jpg`、`.jpeg`、`.webp`，并保留原有路径越界与符号链接校验。

## 0.6.23

- 安全修复：加群申请事件不再把申请人留言拼进 `origin: 'internal'` 的事件提示词。事件只提示有新的申请，详情改由 `qq_admin（action=join_list）` 查询。

## 0.6.22

- 新增 `qq_qzone（action=detail）`：查看一条动态的详情与全部评论（用户实测反馈 SnowLuma 有 `get_qzone_msg_detail` 接口，推翻 0.6.19「协议端无读评论接口」的判断——基于旧 bundle 静态分析有误，致歉）。
  - `qzone.ts` 新增 `getDetail(tid, uin?)`：调 `get_qzone_msg_detail`（参数 `{tid, target_uin}`；查好友动态时 uin 必传，自家动态可省略），带类型/值校验 + try/catch（driver 已解包）。
  - 返回规整省 token：`{tid, content, commentNum, comments[{commentId,uin,name,time,content,replies[]}]}`；评论里 QQ 空间的内联 @ 标记 `@{uin:xxx,nick:yyy,...}` 自动转成可读的 `@yyy(uin:xxx)`。
  - `world.ts` 工具 enum 加 `detail`、新增 `uin` 参数；`case 'detail'` 把评论渲染成 `名字(uin:xxx)：内容（↩ 回复：…）` 的可读文本；引导模型用 `action=reply` + content 里 @对方昵称 回复评论（SnowLuma 的 comment_qzone 仅支持对整个动态评论）。
  - `feeds` 输出提示更新：tid/uin 可接 `action=detail` 查评论。
  - README：特性表/工具列表加 detail；**修正 0.6.19 写错的已知限制**（SnowLuma 实际有读评论接口 `get_qzone_msg_detail`；NapCat 不一定提供）。

## 0.6.21

- 修复主动说话（proactive）四处 bug（用户实测反馈，原报于 0.6.5，0.6.20 复核仍存在）：
  - Bug1「私聊 undefined」：`proactive.ts` 的 `label()` 读 `t.name`/`t.qq`，但 `world.ts proactiveTargets()` 只推 `{address,kind,label}`（无 name/qq）→ 拼出 `私聊 undefined`，主模型拼不出私聊地址。`proactiveTargets()` 现补 `name`/`qq`（取自 `conv.label`/`conv.id`）并过滤掉号码缺失的会话；`label()` 改为多级兜底（label/name/qq/address）。
  - Bug2「空号码也进候选」：`proactiveTargets()` 现过滤 `id` 为空/`undefined`/`null` 的会话；新增 `usable(t)` 并在 `pick()`/`announceRoutine()` 候选过滤、`emit()` 开头跳过。
  - Bug3「qq_proactive_status 抛 Cannot convert undefined or null to object」：handler 读 `s.perAddr`/`s.runState`/`s.dailyQuota`，但 `status()` 返回 `{enabled,dailyCount,quota,recent,targets}`。改用真实字段，不再崩溃。
  - Bug4「qq_proactive_trigger 传字符串却签名要对象」：`trigger()` 现兼容 `string`（按 address 在监听列表里查找），手动触发不再静默失效。
  - 附带：控制台状态灯 `主动` 原本读不存在的 `status().runState`（总显示"关"），改为 `enabled`；`proactive.ts` 失效的 `import { ActiveGroup, ActivePrivate } from './world.ts'`（world 未导出，契约脱节）改为显式 `ProactiveTarget` 接口。

## 0.6.20

- 修复 README/代码不同步（用户约定 README 须与代码一致）：
  - `config.ts` qzone.permission schema 原 `maximum: 10`，但代码合法集为 `{1,4,16,64,128}`（见 `qzone.ts` resolveUgcRight），导致用户在控制台设不了 `64=仅自己 / 128=黑名单`；改为 `maximum: 128` 并补全合法值说明。
  - `world.ts` envPrompt 内嵌文案仍写旧工具名 `qq_qzone_post/delete/reply/status`，但当前是单一 `qq_qzone` 工具 + `action` 参数，会误导模型调用不存在的工具；改为 `qq_qzone(action=post/delete/reply/feeds/status)` 并去掉不实的"@人"。
  - README 特性表去掉 qq_qzone 不支持的"@人"；已知限制补齐 4 个真实 qzone action（send_qzone_msg / delete_qzone_msg / get_qzone_feeds / comment_qzone）。

## 0.6.19

- 修复 QQ空间（qzone）所有功能「无返回值」的致命 bug（用户实测反馈：发动态/拉动态/评论/删除全部拿不到结果）。
  - 根因：`driver.callApi` 已在收包处把 OneBot 回包的 `data` 字段解包（成功 resolve `msg.data`、失败 `reject`），但 `qzone.ts` 仍按旧约定访问 `res.data` 与 `res.error`。于是 `res` 本身就是 data、`res.data` 变成 `data.data`（空），且失败时被 reject 而非返回 `{error}`，导致 `post`/`getFeeds`/`replyComment`/`delete` 全部无返回值甚至 `null.data` 抛错。
  - 修复：`qzone.ts` 四个 callApi 调用改为直接使用已解包的返回值，并用 `try/catch` 捕获 `reject` 转成 `{ok:false, error}`。
  - 附带：`getFeeds` 现正确返回真实 feed（剥 HTML → 纯文本），并把协议端的 feed 句柄字段 `key` 映射为工具里的 `tid`，供 `action=reply` 对好友动态评论。
  - 已知限制（协议端）：SnowLuma/NapCat 当前**未提供读取评论的接口**（仅有发表评论 `comment_qzone`、自家说说 `get_qzone_msg_list` 带 `comment_num` 计数），故 `feeds` 返回动态正文但不含评论内容；读取某条动态的全部评论需协议端侧补齐 detail/get_comment 能力。
  - 同步 README 与代码（用户约定）。

## 0.6.18

- 重发 0.6.17 的内容（0.6.17 在 npm 端发布时进入 staged 卡死状态、tarball 不可取，无法覆盖重发，故升一版）。代码与 0.6.17 完全一致。

## 0.6.17

- 同步 README 与代码（用户约定：README 必须与代码一致），修正若干过时描述并清理死参数：
  - 删除 README 里已随 0.6.0 事件驱动重构移除的 `qzone.systemPrompt` / `qzone.endpoint` / `qzone.apiKeySecret` / `qzone.model` 配置项说明（qzone 现已用主模型，无独立第二模型配置）。
  - `qzone.permission` 语义修正：实为 `ugc_right`（1=公开/4=好友/16=指定人/64=仅自己/128=黑名单），旧 README「0=公开/1=好友」错误。
  - `qzone.commentAction` 默认值修正为 `auto`（旧 README 误写 `comment_qzone`）。
  - `qzone.autoReplyComments.chance`（不存在）替换为真实存在的 `dailyQuota` / `cooldownSec`。
  - `qq_qzone（action=post）`：说明 `content` 为必填（工具不再自动生成文案），删除并不存在的 `ats`（@）参数；`reply` 说明 `comment_id` 可留空（NapCat/SnowLuma 仅支持对整个动态评论）。
  - 已知限制里 `get_qzone_msg_list` → 正确的 `get_qzone_feeds`。
  - 代码侧：移除 `qq_qzone` 工具里透传给 `post` 但 `post` 从不接收的死参数 `ats`；`qzone.imageMode` 类型收窄为 `'none' | 'recent'`（与 schema/normalize 一致）。

规则：每版本一个二级标题，标题里的第一个版本号即为本节版本。

## 0.6.16

- 修复 QQ空间（qzone）四个 OneBot action 全部调用失败（retcode=1404 UNKNOWN_ACTION）。
  - 根因：`qzone.ts` 用了点号命名空间名（`qzone.publish` / `qzone.replyComment` / `qzone.feeds` / `qzone.delete`），但 NapCat / SnowLuma 内核只注册扁平名，故全部 1404。
  - 改用协议端真实扁平名：`send_qzone_msg`（发动态）、`comment_qzone`（评论）、`get_qzone_feeds`（列动态）、`delete_qzone_msg`（删动态）。
  - 顺带修掉几个相关错误：
    - 发动态参数：`send_qzone_msg` 用 `ugc_right`（仅 1/4/16/64/128 合法），旧代码的 `content_type` 与 `visible.type`（2/8 非法）会被拒；`permission` 配置项类型由字符串联合改为数字 ugc_right（与 config 默认值 `1` 及工具参数的"数字"语义一致，避免模型传入的可见权限永远落到非法值）。
    - 评论：`comment_qzone` 只能对整个动态发表新评论，不支持按 comment_id 回楼中楼（已据此修正 qq_qzone 工具描述与校验，并去掉误导的回执文案）；`qzone.commentAction` 配置此前从没接到 `callApi`，现已真正生效（`auto`→内置 `comment_qzone`，也可直接填协议端 action 名）。
    - 列动态：`get_qzone_feeds` 参数为 `{ page_num, count }`（旧 `{ num }` 无效）；返回的是 HTML 片段，现剥标签后给模型可读文本。
  - 同步：README「配置项 / 已知限制」里写错的旧 action 名 `send_qzone_comment` → `comment_qzone`；`config.ts` 的 `qzone.commentAction` schema 说明同步。

## 0.6.15

- 安全加固：`allowPrivateRedirect` 的有效默认值修正为关闭。
  - 根因：`QQWorldConfig` 默认值里写的是 `false`（注释也写"默认关闭"），但 `normalizeConfig()` 里有一句 `if (typeof c.allowPrivateRedirect !== 'boolean') c.allowPrivateRedirect = true;` 把缺省值强行翻成 `true`，导致实际默认是"开启"——群里任何人都能让 bot 私聊任意 QQ 号（跳过监听名单）。现改为 `= false`，与文档/默认对象一致。
  - 同步把 schema 描述里"默认 true 可用"改为"默认关闭"。
  - 注：本轮审计里其余安全/清理项（qzone 附图 http(s)/base64 白名单、qzone 外部内容走 `origin:'external'`、回复禁用 @all、ASR 只扫本包+stop 结束孤儿进程+最小 env、去掉 onTurnEnded 直接发、提醒改推事件、语音判定密钥默认空+上报用量、删未用 QQ_SECRETS 密钥、去重 qq_note、beta 弃用、qzone.ts 导入/replyComment 签名/proactive `this.routine`、README 对齐）均已在 0.6.10–0.6.13 完成，本次经核对代码确认无回归；`tsc` 现存报错均为预存且 tsx 运行期会被擦除的 `import type` 或 cortico 类型不导出问题，非本次引入、不影响 tsx 运行时。

## 0.6.14

- 给合并转发（`qq.forward`）事件加「转发来源群/人」可见标签，帮助模型判断语境。
  - 在 `renderForwardNode` 里从每个转发节点捕获原始会话：`group_id`（群转发）/ 对方 QQ（私聊转发，排除自己），即 SnowLuma `get_forward_msg` 节点已携带的 `group_id` / `user_id` / `message_type`。
  - 新增 `forwardSource()`：由节点推断来源——单一群标 `群「<群名>(<id>)」`、单一私聊标 `私聊「<昵称>(<QQ>)」`、跨群/跨人则标 `多个来源（…）`；并把结构化 `forward_source` 写入事件 `meta`。
  - 来源恰好等于收到转发的当前会话（如把本群聊天记录转发回本群）时自动抑制，避免重复噪声。
  - 标签直接渲染进事件正文头（`[系统] #编号 引用的转发消息展开如下（转发来源：…）：`），因为事件 `meta` 不会进入模型上下文、只有正文头才会被模型看到。

## 0.6.13

- 修合并转发（聊天记录卡片）读不到的根因：别人发来的合并转发 bot 一直展开失败、看不到内容。
  - 根因：`driver.getForwardMessages` 只接受裸数组（`if (!Array.isArray(r)) return []`），但 OneBot `get_forward_msg` 的真实返回是 `{ messages: [...] }`（对象），导致永远返回空、静默失败。
  - 修法：`getForwardMessages` 兼容多种返回形状——`{ messages: [...] }` / `{ message: [...] }` / 裸数组（`callApi` 已剥掉 OneBot 应答最外层的 data）。
  - 同步对齐 `renderForwardNode` 与内置 `qq` world：兼容 NapCat 记录形态 `{ type:'node', data:{ name, uin, content } }`（下沉到 data 取正文/身份），正文来源兼容 `content` / `message` / `raw_message`，昵称兼容 `sender.card`。
  - 已确认协议端 SnowLuma 实现 `get_forward_msg`（返回 `{ messages: [...] }`，每节点带 `sender` + `message` 段数组），本修复后 bot 可正常展开并读入会话。

## 0.6.12

- 修本地 ASR 侧车「找不到 asr_sidecar.py」的根因（用户反馈 2026-10-22：Coopanion 启动时刷三条 `[asr-sidecar]` WARN、语音识别不可用）。
  - 根因：`resolveAsrSidecar` 只按框架给的 `packageDir` 找脚本，而框架有时把 `packageDir` 指向 `bots/<bot>` 而非扩展目录，导致随包发布的 `asr_sidecar.py`（在扩展包根）找不到。
  - 修法：新增 `EXT_ROOT`（`fileURLToPath(new URL('..', import.meta.url))`，从模块自身位置推算的扩展包根）作为查找**主锚点**，`packageDir` 降级为兜底候选。脚本/venv/python/model 四类候选都先查 `EXT_ROOT` 再查 `packageDir`。仍保持「只查本扩展自身目录、不跨包/跨目录扫描」的安全属性（避免别的扩展放同名文件被误执行）。
  - 说明：这是源码修复，用户不再需要把脚本手动复制到 `bots/<bot>`；但 Python venv（funasr+torch，约 1.3GB）仍需自行准备——`asr.mode=local` 默认需要它，放 `<扩展>/venv_vox` 或配置 `asr.localVenv` 即可。

## 0.6.11

- 安全加固（纵深防御）：QQ 空间发说说/评论的附图在真正调 API 的边界（`QZonePoster.post`）补一层协议白名单——仅收 `http(s)://` 与 `base64://` / `data:` 图片数据，拒绝 `file://` 等本地/任意协议，避免模型经 `qq_qzone(action=post)` 传入本地文件路径把本机任意文件上传出去。`world` 层已过滤一次，这里再挡一道。bot 自己收到的本地图片（`collectImages`）是可信内部来源，不经此过滤。
- 修测试：修掉 0.6.9 起就挂、与本轮无关的两处预存在失败：
  - `tests/normalize.test.ts`：原断言基于过时假设，把 `proactive`/`qzone`/`emotion` 当成「跟随主模型的辅助模型配置段」并断言其 `endpoint/apiKeySecret/model` 留空。实际只有 `vision` 是辅助模型配置段；`proactive`/`qzone` 是走主模型的调度器、没有这些字段，`emotion` 不是配置段（只是表情包标注）。断言列表收敛为真实结构 `['vision']`。
  - `tests/security.test.ts`：原断言 grep 的是 `src/qzone.ts` 里的附图白名单，但那段校验实际在 `world.ts`。已在 `qzone.ts` 边界补齐白名单，断言随之成立。

## 0.6.10

- 认证评审（#104）收尾：
  - 移除 `qq_note` 工具（原 save/list/get/forget 四个子功能）。它与 `cortico-world-memory` 的 `mem_note`/`mem_notes`/`mem_forget_note` 功能重复，两个都装会让模型同时面对两套记忆入口、互相打架。长期记忆请改用记忆扩展（常驻环境提示词 + 混合检索）。`definition.ts`/`describe.json`/`README` 同步移除相关描述，`notebook.ts` 本地后端保留但不再对外暴露工具。
  - 安全加固：`@all` / `@全体成员` / `@everyone` 在普通回复正文里不再被解析成「at 全体」段。at 全体是 `qq_admin`（action=at_all）+ `admin.enabled` 授权保护的高危操作，不能靠在正文里写 `@all` 绕过鉴权。
  - 安全加固：QQ 空间评论回复 / 主动发说说 的 nudge 不再把不可信的外部内容（评论者昵称、评论原文、最近聊天取材）拼进 prompt 文本，改为放进事件 meta，由主模型按需读取。
  - 安全加固：`allowPrivateRedirect` 默认改为 `false`（群里任何人无法借 `qq_send` 让 bot 私聊任意 QQ 号）；语音语义判定的 `judgeEndpoint`/`judgeApiKeySecret` 默认留空（须显式配置才启用，不再跟随主模型密钥）；`QQ_SECRETS` 删除已无处使用的 `OPENROUTER_API_KEY`/`DEEPSEEK_API_KEY`。
  - 语音语义判定（`judgeVoiceWish`）补上 `reportUsage` 用量上报，控制台可看到语音判定模型的 token 消耗（认证评审 #104 要求自有模型调用须上报用量）。

## 0.6.9

- 修复：启用作息功能后「总览面板」崩溃加载不出来。
  - 根因：配置重命名（`config.ts` 真实字段为 `sleepStart/sleepEnd/lazyStart/lazyEnd/greetSleep/greetWake/greetLazy`）未同步到读取处，`proactive.ts` 的 `Routine` 类与 `world.ts` 的 `routineSegmentText()` 仍使用旧字段名 `silentStart/silentEnd/noonStart/noonEnd/...`。启用后 `inRange(undefined, undefined)` 触发 `undefined.split` 抛错，环境提示（qq.routine）构建失败，导致面板拉取失败。
  - 受影响处全部改为真实字段：`RoutineConfig` 接口、`Routine.isSleep/isLunchBreak/announceText`、`routineSegment()` 模块函数、`ProactiveSpeaker.buildNudge/tick` 的时段判定、`world.routineSegmentText()`。
  - `announceText()` 改为优先使用配置里的问候语（greetSleep/greetLazy/greetWake），缺省时回退内置文案。

## 0.6.8

- 修复：宠物没有任何把标签写回表情包索引的通道——`sticker.ts` 里 `emotion/usage/tag` 只在收货那一刻由自动标注写入，此后无代码路径可改；对外只有只读的 `qq_sticker_stats` 与只同步的 `qq_sticker_to_favorites`，宠物想修正/补充标注（尤其「未知」）没有任何接口，手工改 `sticker-index.json` 又会被内存里的旧 map 在下次落盘时悄悄覆盖。
- 新增工具 `qq_sticker_tag`：按文件名（来自 `qq_sticker_stats`，也接受 `[表情包:xxx]` 写法）修改某张表情包的 `emotion/usage/tag/label`（只传想改的字段），`StickerStore` 新增 `updateMeta()` 走既有 debounce 落盘，不再有覆盖问题。
- bot 可见工具 13 -> 14；describe.json / README / TOOL_SUMMARIES 同步更新。

## 0.6.7

工具合并（减少 bot 可见工具数量、降低模型选工具负担；框架原生支持 `action` 枚举参数）：
- 把 6 个「同族」工具各自合并为单个工具，子功能用 `action` 枚举参数暴露（保留全部原有行为/鉴权/保护逻辑）：
  - `qq_qzone_*`（post/delete/reply/feeds/status）-> `qq_qzone`，新增 `action` 参数。
  - `qq_reminder_*`（add/list/cancel）-> `qq_reminder`。
  - `qq_note_*`（save/list/get/forget）-> `qq_note`。
  - `qq_admin_*`（recall/at_all/notice/join_list/join_approve/join_reject/title/ban/ban_all/kick）-> `qq_admin`，新增 `action` 参数；授权指挥官/白名单/protectOwner/protectAdmins 保护全部保留。
  - `qq_proactive_*`（status/trigger）-> `qq_proactive`。
  - `qq_recent` + `qq_search` -> `qq_history`（action=recent/search）。
- bot 可见工具：33 -> 13（`qq_send` / `qq_confirm_send` / `qq_view_image` / `qq_sticker_stats` / `qq_sticker_to_favorites` / `qq_forward_by_id` / `qq_poke` 保持不变）。
- 重新生成 describe.json（tools 13, events 8, prompts 1）；README 工具文档同步更新为 action 写法。

## 0.6.6

新增「表情包同步到 QQ 收藏表情」能力（用户诉求：在 SnowLuma 拉起的 QQ 客户端里也能看到 bot 收藏的表情包）：
- 新增设置 **`worlds.qqbot.sticker.addToQQFavorites`**（默认关闭，控制台标题「同步到 QQ 收藏表情」）。开启后，bot 每收藏一张表情包，会同时调协议端的 `add_custom_face` 把同一张图加入登录账号的 QQ「收藏表情」（custom face），你能在 QQ 客户端的收藏表情面板里直接看到/使用；返回的 `emoji_id` 记入表情元数据。
- 实现：在 `StickerStore` 落盘后调用注入的 `addToFavorites` 回调（由 world 经 `driver.callApi('add_custom_face', { file: 'base64://...' })` 实现，用 base64 直传，不依赖协议端进程读本机磁盘）；`StickerMeta` 新增 `emojiId` 字段持久化。
- 新增工具 **`qq_sticker_to_favorites`**：把开启开关前就已攒下、尚未进 QQ 收藏表情的历史表情批量补推（带 `limit` 分批）。`qq_sticker_stats` 统计里增加「已同步到 QQ 收藏表情」张数。
- 兼容性/健壮性：依赖协议端支持 `add_custom_face`（SnowLuma 支持；NapCat/Lagrange 等不一定有该扩展接口）。不支持时**自动降级**——图片照常存盘、可发，只是不进 QQ 收藏，不会崩溃或报错；QQ 收藏表情数量上限导致的失败仅在结果里提示，可删减后重试。

## 0.6.5

修复作息/主动说话模块（proactive.ts + world.ts）三处运行期崩溃与持久化失效（用户 2026-10-21 bug 报告确认，0.6.0→0.6.4 一直存在）：
- **Bug 1（主循环崩溃）**：`world.ts` 的 `routineSegmentText()` 调了未导入的 `routineSegment()`，上下文交接（handoff）时抛 `ReferenceError: routineSegment is not defined` 拖垮主循环。改为直接按 `inRange` 计算真实作息相位（sleep/lazy/active），既消除崩溃，又修复「返回值被错当相位、永远走活跃分支」的逻辑错误。
- **Bug 2（主动说话整条失效）**：`proactive.ts` 对 `RoutineConfig`（纯配置）调 `this.routine.isLunchBreak()/isSleep()`（实例方法），每 2 分钟 tick 抛 `TypeError`。改为用配置字段 + `inRange` 直接判定午休/睡眠；tick 相位判断同理改用真实相位。
- **Bug 3（save failed ×106）**：`proactive.ts` 用了 `fs.*`/`path.*` 命名空间但只按需导入了 `existsSync/readFileSync/writeFileSync/join`，`fs` 与 `path` 根本未导入 → 每个 `load()/save()` 抛 `ReferenceError`。改为 `import * as fs` / `import * as path`；并给 `load/save` 加 `dataDir` 空守卫（没有可写目录时静默跳过，不再每 30s 刷 "save failed"），失败日志补全 `err` 与完整文件路径。
- 附带修正 `announceRoutine` 引用了 `RoutineConfig` 上不存在的 `greetSleep/greetLazy/greetWake`（始终 undefined），改为用 `Routine.announceText(scene)` 兜底，作息切换播报文案恢复正常。

## 0.6.4

`qq_forward_by_id` 改为「合并成一张卡片」转发（落实用户诉求）：多条消息合成**一张**合并转发卡片发出，而不是一条条发。
- 行为变更：之前每条选中消息各自成一张卡片；现在用 OneBot 的 `send_forward_msg` 把多条消息合成一张合并转发卡片（node 的 `user_id` 只能是 bot 自己，这是 OneBot 限制），卡片内每条消息用「文本标注原始发送者昵称+QQ号」+ 保留原文内容（图片/引用等富媒体原样内嵌）来体现来源，**绝不伪造他人身份**。
- 实现：逐条经 `get_msg` 取回原文与发送者，再组装成节点数组一次性 `send_forward_msg`。某条取不到（已撤回/不可读/`get_msg` 失败）时跳过并提示，不会静默失败。
- 依赖：协议端需支持 OneBot 的 `send_forward_msg` 与 `get_msg`（NapCat/Lagrange/SnowLuma 等主流实现大多支持，不支持会如实报错）。其余安全约束（只能转发本 bot 见过的消息、仅限目标会话、默认关闭开关）不变。

## 0.6.3

修复 0.6.1 引入的回归：`qq_forward_by_id` 工具虽已实现，但遗漏加入 `tools()` 的返回数组，导致运行时框架拿不到该工具、主模型「找不到合并转发工具」。本次将 `forwardById` 加入工具列表并重新生成 describe.json（工具数 31 -> 32），模型现可在开启 `forwardByMessageId` 后正常调用。

## 0.6.2

修复防死循环（antiLoop）的私聊误伤：原来「话题自动收尾」只按**私聊会话内**对方最后发言时间判定，导致「人在群里一直活跃、只是没在私聊说话」时，私聊被永久收尾拦截（反馈现象：私聊发不出去、提示「对方已静默 Ns，话题自动收尾」并反复重试被拦）。
- 改为：新增按 QQ 号的全局最近发言时间（入站消息处对所有会话记录，含其所在群），私聊 idle 收尾判定改用该全局活跃度——只要该用户在任意会话（含群）近期活跃，私聊就不会被 idle 收尾误拦。
- 群聊会话维持原会话级 idle 收尾（群组维度，按会话更合理）；连续发言防刷（streak）仍按会话维度，逻辑不变。

## 0.6.1

新增「原样转发消息」能力（不伪造身份）：新增工具 `qq_forward_by_id`，按消息编号把本 bot 已接收/已发出的消息**逐条原样转发**到指定群/私聊。
- 行为：每条选中消息各自成为一张合并转发卡片，卡片内保留原始发送者的头像/昵称/内容（非 bot 伪造）。依赖 NapCat 扩展接口 `forward_group_single_msg` / `forward_friend_single_msg`（非 NapCat 协议端会如实报错）。
- 安全约束：只能转发本 bot 本地记录内存在、且属于目标会话的消息编号（防止转发从未见过的消息或串台到其他会话）；未命中/跨会话的编号会被跳过并提示，不会静默失败。
- 功能开关：`worlds.qqbot.forwardByMessageId`（默认 `false`，需重启生效）。默认关闭，避免误用；开启后 `qq_forward_by_id` 方可调用，否则提示先开启。
- 说明：受 QQ/NapCat 合并转发机制限制，无法把多条选中消息塞进「一张」卡片且同时保留各自原始发送者身份；逐条各自成卡片是官方接口下的合规实现。

## 0.6.0

事件驱动改造（落实认证建议第 3 类）：主动说话 / 作息播报 / QQ空间动态·评论回复**不再单独调用第二模型**，改为推内部事件由主模型生成并发送。
- 删除 `proactive.*` 与 `qzone.*` 的 `endpoint` / `apiKeySecret` / `model` / `systemPrompt`（及 `proactive.topicSimilarity` / `proactive.tokenLimit`）配置项与控制台面板项；这些「独立 LLM」配置已无意义。
- 主动说话 / 作息播报：`ProactiveSpeaker` 只决定「要不要说、对谁说、说什么方向」，把 nudge 交给主模型；经 `host.pushEvent({origin:'internal'})` + `markPendingReply` 复用「主模型生成 → 自动发到该会话」链路。
- QQ空间：`qq_qzone_post` 的 `content` 改为必填（不再自动生成动态文字）；评论回复经 `qq_qzone_reply` 由主模型完成。`qzone.*` 第二模型配置项移除。
- 行为变化：主动冒泡 / 动态 / 评论的内容与语气现在完全由主模型决定（与正常对话一致），风格受人格影响；若主模型「决定不说」则不会发送（可能比旧版更安静，符合「main model decides」）。
- 配套：cortico-bot-qq-persona（情绪/好感度/外号）已在 0.5.0 拆分完成。

## 0.5.1

修复：0.5.0 拆分后，默认环境模板 `ENV_PROMPT.md` 仍残留 `{{qq.affinity}}` / `{{qq.emotion}}` 两节（已随拆分迁到 `cortico-bot-qq-persona`），而 `envPromptVars()` / `promptDocs.vars` 不再声明这两个变量，导致控制台「QQ 环境描述」编辑器对这两处报「未提供值」红字。本版删除模板中这两节，红字消除。运行时无需其他改动。

## 0.5.0

拆分：情绪 / 好感度 / 外号三大内部状态迁移到独立 bot 人格扩展 **`cortico-bot-qq-persona`**（api=7）。qq-final 本体不再内嵌这些状态，功能经装该人格获得。

- 移除 `qq_affinity_adjust` / `qq_affinity_get` / `qq_affinity_list` / `qq_alias_set` / `qq_alias_forget` / `qq_alias_list` / `qq_mood` 七个工具及其背后的 `EmotionEngine` / `AffinityStore` / 外号存储。
- 移除 world 侧「情绪系统」「好感度」配置项（`worlds.qqbot.emotion.*` / `worlds.qqbot.affinity.enabled`）、对应控制台面板与 prompt 占位符（`qq.affinity` / `qq.emotion`）。
- 关系分与时间戳刷新改由人格扩展的 `onDelivery` 负责；`qq_send` / `qq_recent` 的「who」解析不再走本地外号，外号 → QQ 号映射改由人格扩展托管。
- 配套：cortico-bot-qq-persona 0.1.0（新包）。

## 0.4.0

安全整改（响应认证评审 Pal-AI-Lab/cortico-extensions#104），四项均为**破坏性变更**，升级后需检查配置。

### 密钥一律走框架 `ctx.secret()`，不再自行读部署文件

- 删除 `resolveSecret` 里的目录扫描逻辑：不再从 `dataDir` 往上推算、读取部署 `config.json` 与 `providers/*/config.json`、也不再用自复制的正则解析各 provider 的 `.env`。这既绕开了框架「密钥按部署隔离、provider 密钥只交给 provider」的安全措施，自复制的正则还踩过「`NAME=` 留空会读到下一行」的坑（Cortico#268）——空值行会把下一个密钥整行当成 Bearer 发出去。
- 密钥统一经 `WorldContext.secret(name)` 解析（读部署 `.env`，解析规则随框架修复）。涉及：辅助视觉、表情包标注、主动说话、动态生成、情绪感知、语音判定/合成/ASR 全部密钥。

### 辅助 AI 任务改为纯配置驱动，不再跟随主模型密钥

- 删除 `detectActiveProvider()` 与 `autoEndpoint`/`autoApiKey`/`autoModel` 三个缓存字段。曾经的「配置留空 = 自动跟随部署主模型」已移除：那需要自行读部署配置与 provider 目录，且存在「地址填了、密钥名留空时把主模型密钥发到用户所填地址」的隐患。
- `resolveHelperModel()` 改为逐项检查：**模型地址 / 密钥名 / 模型名三项必填**，缺任一项返回失败并给出可操作的提示（写清缺哪项、密钥该写什么名字、值放哪），绝不借用别的密钥、绝不静默重试。
- `vision` / `proactive` / `qzone` / `emotion` 四段的配置描述同步更新：密钥只写名字，值放在部署密钥库（`.env`）里由框架读取。
- `emotion.enabled` 默认由 `true` 改为 `false`：情绪感知每条消息都会额外调一次模型，与主模型的工作重复；真需要时填好三项再开。

### 去掉与其他 World 的桥接（qq_note_*）

- `notebook.ts` 删除经 `globalThis` 桥接 `cortico-world-memory` 的逻辑，只写本地 `dataDir/notebook.jsonl`。`qq_note_*` 与记忆扩展自带的 `mem_note`/`mem_notes`/`mem_forget_note` 功能重复，两个都装时模型应优先用后者（常驻环境提示词 + 混合检索）；工具描述里已写明。
- 本扩展不 import、不探测、不调用任何其他 World。

### 自有模型调用上报用量

- `completeChat`（主动说话/动态/情绪）、辅助视觉 `describe`、表情包标注 `annotate` 三处自有模型调用，成功后经 `host.reportUsage()` 上报，用户可在控制台看到用量。

### 其他

- `qzone.ts` 删除未使用的 `resolveSecret` 选项。
- `vision.enabled` 描述补充其与默认开启的「图片作为模型附件」的关系（两条看图的路，不建议同开）；README 同步说明。
- README 修正多处与代码不一致：`wsHost`/`wsPath` 默认值、`token` 自动生成说明、`privateAggregationWindow` 默认 0、`emotion.enabled` 默认值、`qq_send` 发送语义、工具清单补齐 `qq_reminder_*` 三项、配置项全部对齐源码。

## 0.3.8

修复 0.3.7 的自动探测路径层级错误。

- `detectActiveProvider()` 把**部署配置**和 **provider 目录**按同一层级去找了：两者都按「`dataDir` 往上两级」计算，于是部署配置被找成 `<DATA>/home/config.json`（实际在 `<DATA>/home/companion/config.json`）→探测静默失败 → 四个辅助 AI 任务全部报「未能自动确定要用的模型」。
- 正确层级：`dataDir = <DATA>/home/companion/data`，**上一级**是 `companion`（部署配置在这），**上两级**是 `home`（各 provider 目录在这）。现按这两个层级分别取。
- 新增回归测试锁住该路径推导，避免再犯。

## 0.3.7

辅助 AI 任务改为**默认跟随主模型**，做到零配置。

起因：装桌宠时用户配好的是自己的模型（如 DeepSeek），但「主动说话 / QQ空间动态 / 情绪感知 / 辅助视觉」这四项任务各自写死了 OpenRouter，于是装完一开主动说话就刷「缺少 API Key」——默认值让人先失败一次很不友好。更糟的是四处默认值本就不一致（视觉/主动/动态指向 OpenRouter，情绪指向 DeepSeek），且 `endpoint` 与 `apiKeySecret` 压根没注册到配置面板，用户无法自行修改。

改动：

- `vision` / `proactive` / `qzone` / `emotion` 四段的 `endpoint`、`apiKeySecret`、`model` **默认值改为空串**，含义是「自动跟随部署里当前启用的主模型」。
- 新增 `QQWorld.resolveHelperModel()`：逐项判断——填了就用填的，没填就从 `config.json` 的 `activeProvider` 取 `baseUrl` / `secret` / 模型名，密钥交给既有的 `resolveSecret`（进程环境变量 → provider 目录下的 .env）。
- 新增 `QQWorld.detectActiveProvider()`，在 `start()` 里探测一次并记入日志（含实际使用的 provider、模型与地址），便于用户确认「到底在用哪个模型」。
- 显式填了密钥名但找不到时，告警会直接给出可操作的下一步（去哪个 .env 写什么，或留空以跟随主模型），不再只丢一个名字。
- 四段的 `endpoint` / `apiKeySecret` **注册到配置面板**（各段新增「模型地址」「密钥名」两项），用户可在界面自行指定；`model` 字段描述补充「留空=跟随主模型」。
- `Vision` 接受注入的模型解析器，复用同一套逻辑；此前它只查 `process.env`，拿不到 provider 目录下的 .env 密钥。
- 回归测试：新增「四项任务默认留空」与「normalizeConfig 不会把留空字段回填成默认值」两条，防止以后又被写死。

升级后**什么都不用配**即可使用主动说话等四项功能；若想单独指定某个 OpenAI 兼容服务，在对应面板填「模型地址 / 密钥名 / 模型名」即可。

## 0.3.6

修正连接相关提示文案——0.3.0 起反向连接已强制带鉴权 Token，但界面与文档里还残留着「反向不用填 Token」的旧说法，会让人漏配而连不上。

- **「连接与监听」面板**：删掉「OneBot Token 留空即可」的说法，改为「Token 必填」。原先的提示框只有一行灰字，现在把三步流程做成醒目卡片（红框）：① 在协议端打开「设置反向客户端」② 粘贴 Token ③ **点「保存连接」**，并注明「填完不保存 → 协议端不重连 → 桌宠一直显示未连接，尽管 Token 明明填对了」。
- **配置项说明**：`token` 字段改为「【反向连接必填】…就显示在下方输入框里，整串复制到协议端的鉴权 Token 并保存」；`wsHost` / `wsPort` / `wsPath` 统一改用「协议端」统称（NapCat / SnowLuma 都适用），并强调路径结尾 `/ws` 不能少；`wsUrl` 补上「仅正向模式使用」的说明。
- **图文教程**：第 2 步新增醒目提示「别忘了点保存连接」并解释其症状；检查清单补「并点了保存连接」；全文把操作对象改称「协议端」，避免与实际使用的 SnowLuma 混淆。
- 顺带修掉 `qq_qzone_post` 工具描述里残留的 `file://`（0.3.0 已移除该支持，描述漏改）。

## 0.3.5

修正 0.3.4 那张「设置反向客户端」配图：红框位置不准（偏左约 260px、没裁剪、边缘混入了桌面背景）。

- 改用**像素级颜色分层扫描**定位控件边界（遮罩灰 `151,149,147` / 弹窗米白 `255,248,240` / 输入框白 `254,253,251`），实测两个输入框均为 `x 576–1343`，URL 框 `y 395–440`、Token 框 `y 732–777`，弹窗本体 `x 540–1379, y 172–960`。
- 按实测坐标重新画框并裁到弹窗边界，编号 ① 服务端 WebSocket URL、② 鉴权 Token。
- 单文件离线版重新生成（3.11MB，较上一版更小——裁掉了多余背景）。

> 此前用「网格叠加 + 目测读数」标定坐标不可靠：标签密集时会重叠误读。这次改用像素扫描直接测边界。

## 0.3.4

修正图文教程里会导致「连不上」的错误。

- **反向客户端的服务端地址补上了结尾的 `/ws`**。此前写成 `.../onebot/v11`，而桌宠的路径默认是 `/onebot/v11/ws`，少这段会一直连不上，且多数实现不给出明显报错。
- 该步配图换成实测截图，红框标出**服务端 WebSocket URL** 与**鉴权 Token** 两个输入框。
- Token 说明改用界面的真实叫法「鉴权 Token」，并说明桌宠同时接受 `Authorization` 请求头与 URL Query 两种传参。
- 检查清单与「连不上怎么排查」FAQ 同步补上 `/ws` 这一条。
- 新增一张标注图 `docs/img/step-17.png`（共 20 张）。

## 0.3.3

修复 0.3.0 引入鉴权后 NapCat 完全连不上的问题（用户实测反馈）。

- **反向服务端现在按 OneBot v11 标准校验 `Authorization: Bearer <token>` 请求头**。此前只从 query 读 `?access_token=` / `?token=`，而 NapCat / Lagrange 等实现默认把 token 放在 `Authorization` 头里（框架内置的 qq world 也是这么发的，见 `src/worlds/qq/driver.ts`），于是每一次接入都被判「Token 不匹配」——NapCat 反复重连、桌宠一直显示未连接，且日志看不出真正原因。
- 仍然兼容 query 传参（`?access_token=` / `?token=`），因为反向监听地址是 NapCat 侧手填的，用法不统一。
- 拒绝日志改为只记录 `presented: boolean`，不再回显实际 token 值。

## 0.3.2

修复 0.3.1 引入的两个问题（都是用户实际反馈的）：

- **自动生成的 token 在重启进程后可能读不到**：`ensureReverseToken()` 原先只在 `createDriver()` 里调用，而面板与工具在 `start()` 之后、driver 建立之前也可能读取 token，那段时间拿到的是空串。现在 `start()` 开头无条件调用一次，`createDriver()` 里保留一次兜底。
- **图文教程把端口写死成 `8080`**：用户实际配置的端口可能不同（实例上就是 `8090`），照着教程填会一直连不上且原因难查。教程改为**以「连接与监听」面板显示的端口/路径为准**，并新增一条提示说明端口不一致是最常见原因、检查清单与 FAQ 同步修正。

同时说明：token 只持久化到 `dataDir/reverse-token.txt`，`config.json` 里的 `token` 字段仍保持用户自填值（默认为空）。因为 `World` 契约不提供配置写入 API，扩展无法自行落盘；每次启动从该文件读回同一串，因此跨重启稳定。

## 0.3.1

修正文档：0.3.0 引入了反向连接强制 Token，但图文教程仍写着「Token 留空」，会让人照着做却连不上。

- `docs/guide.md`：第 2 步「设置反向客户端」补充说明 Token 要填桌宠生成的那串，并加了两个 Token 的对照表（正向那个 vs 反向这个）；第 13 步改为「Token 要填到 NapCat」，说明 Token 在「连接与监听」页面顶部、两边必须一致；检查清单新增一条；FAQ 重写「Token 弄丢怎么办」并新增「反向连不上怎么排查」。
- `docs/index.html` 与单文件离线版同步上述修正。
- README 要点速记同步（反向连接必须带 Token、监听地址保持 `127.0.0.1`）。

## 0.3.0

安全修复（认证评审 `Pal-AI-Lab/cortico-extensions#104` 要求）。**含行为变更，升级前请读**：

- **反向监听默认改为 `127.0.0.1`**，不再是 `0.0.0.0`。原来默认监听所有网卡，同网段任何机器都能连入、读取 bot 下行消息并伪造入站事件（含 `get_group_member_info` 等管理接口）。若你确实需要对外监听，须显式改 `wsHost` **并设置 OneBot Token**，否则会拒绝启动。
- **反向连接必须带鉴权**：token 留空时自动生成随机 token 并持久化到 `dataDir/reverse-token.txt`（跨重启稳定），控制台「连接与监听」页与启动日志会显示，请填进 NapCat「设置反向客户端」。driver 侧新增安全闸：对外监听且无 token 时直接拒绝启动。
- **修复表情包路径穿越**：`[表情包:文件名]` 过去直接 `join(emojiDir, fname)`，群友发 `..\..\` 即可让 bot 读取并外传本机任意文件。现做三重收敛——拒绝绝对路径与 `..`、解析后必须仍在表情包目录内、符号链接按真实路径复验、必须是普通文件；越界一律静默丢弃。
- **QQ 空间附图不再接受 `file://`**：该协议会让 NapCat 直接读取本机文件上传，等于把「读取并外传本机文件」交给任何能影响模型输出的人（如群消息提示词注入）。现只接受 `http(s)://` 与 `base64://`。
- 新增 `tests/security.test.ts`（7 项）固化上述修复，防止回退。

文档修正（与代码对齐）：

- `api: 5` → `api: 6`（此前写错）。
- 移除「语音电话（call）」整章与 `voice.voiceTranscribeUrl` / `voice.voiceExtraAsr` / `voice.voiceFfmpegPath` / `voice.voiceTranscribeTimeout` 等**代码里并不存在的配置项**（`call.*` 与 `audio_bridge_poc` 从未包含在发布包内）。语音相关配置改为如实描述现有的 `asr.*` 段。
- 补齐文档中漏写的 9 个工具：`qq_admin_kick`、`qq_alias_set/forget/list`、`qq_poke`、`qq_proactive_status/trigger`、`qq_sticker_stats`、`qq_view_image`。现README 覆盖全部 37 个工具。
- 新增「与 cortico-world-memory 的关系」一节，说明笔记本是**可选增强而非依赖**（未装该插件时回退原生 JSONL，功能完整），并说明框架 `World` 契约没有 World 间发布/订阅通道，故采用最小能力协商而非事件流。

## 0.2.12

- 声明市场标签 `im` / `qq` / `external-setup`，便于在市场里按平台筛选（`external-setup` 表示需先装好 NapCat）。
- `CHANGELOG.md` 加入 `files`，随包分发，市场可直接显示各版本更新说明。

## 0.2.11

- 新增 `CHANGELOG.md`，记录各版本改动，供市场「更新说明」读取。

## 0.2.10

- 接入教程改为 Markdown（`docs/guide.md`），GitHub 上直接渲染成图文教程；文件名改用 ASCII，避免中文名在 URL 里需编码。
- 面板顶部新增「使用教程」入口与「重启连接」按钮（`restartConnection`），改完连接参数不用重启整个桌宠。

- 接入教程改为 Markdown（`docs/guide.md`），GitHub 上直接渲染成图文教程；文件名改用 ASCII，避免中文名在 URL 里需编码。
- 面板顶部新增「使用教程」入口与「重启连接」按钮（`restartConnection`），改完连接参数不用重启整个桌宠。

## 0.2.9

- 新增图文接入教程（安装 NapCatQQ、建 Bot、建正向/反向连接、装扩展、配监听名单、提示词生效）。

## 0.2.8

- 教程抽图瘦身，HTML 从 3.3MB 降到 39KB，图片改为独立文件。
- README 新增「接入教程」章节与要点速记。

## 0.2.7

- 面板顺序调整：连接与监听 → 监听名单 → 其余模块 → 实时事件。
- 「连接与监听」页新增「使用教程」链接与「重启连接」按钮。

## 0.2.6

- 监听名单面板改为与配置栏一致：输入框失焦或按 Enter 即自动保存，保存后不再重建表单（原先会把用户输入的 `111,222` 改写成 `111 222`，看起来像没保存）。

## 0.2.5

- 修复表情映射两套编号体系打架：`QQ_FACE_NAMES` 按 NapCat QSid 重建，`QQ_FACE_IDS` 改为由正向表反向生成。此前收到表情会显示错名字（如真实 QSid 210「飙泪」被显示成「玫瑰」）、`[笑哭]` 会解析成「偷笑」。
- 新增往返恒等测试与 NapCat QSid 抽查。

## 0.2.4

- 修复监听名单清空后无法保存：空串被解析成 `[0]`（`Number("")===0` 且 `isFinite(0)`），表现为清空后读回来永远显示「0」。`toIds` 改为只收正整数。
- 配置栏输入框支持 Enter 提交（原先只有失焦才保存）。
- 修复扩展根目录推断的层级错位，以及中文路径下 `import.meta.url` 的解码错误。

## 0.2.3

- 发布到 npm，可从扩展市场安装。
