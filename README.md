# cortico-world-qq-final

> 📦 **更名提示**：本包原名为 `cortico-world-qq-better`，自 `0.1.61` 起更名为 `cortico-world-qq-final`（代码完全一致，仅包名变化）。旧名已标记为废弃（deprecated），请改为安装本包。

Cortico 的 **QQ（OneBot v11 / NapCat）** World 扩展。以 `fat-fish` 仓库的 `qq_bot` 插件为**本体**，并增量吸收了 Cortico 内置 `qq` world 的特性。

- 包名：`cortico-world-qq-final`
- World id：`qqbot`（与内置 `qq` 区分，可并存；如需独占可禁用内置 world）
- 框架契约：`api: 6`

> 🧩 **情绪 / 好感度 / 外号** 自 `0.5.0` 起已拆到独立 Persona 扩展 **`cortico-bot-qq-persona`**（Bot 扩展，api=7）。如需这些能力，在部署里额外安装并启用该 bot 扩展即可；不装则本包不再提供 `qq_mood` / `qq_affinity_*` / `qq_alias_*` 工具。

> ⚠️ **本扩展的「语音」指语音消息（ASR+TTS）**：收发 QQ 语音消息并转写/合成，相对可用（见下「语音」章）。**不含实时通话功能**——OneBot/NapCat 无法接入运营商电话，本扩展不做「模拟通话」。

## 与 fat-fish / 内置 qq 的关系

| 能力 | fat-fish 插件 | 本扩展 | 说明 |
|---|---|---|---|
| 连接方式 | 反向 WS（Cortico 开服务端等 NapCat 连） | ✅ 反向（默认）+ 正向 | 配置 `mode` 切换 |
| 消息解析 | 文本/图片/语音(SILK)/视频、@判断、表情码、私聊聚合、群白名单、引用回复 | ✅ 全部移植 | fat-fish 的 `QQPlugin`/`QQAdapter` 逻辑 |
| 文本分句发送 | `split_for_sending` 按句拆分 + 发送限速 | ✅ 按句拆分（含表情包图片/中文表情名）+ 分片 `send_msg` + `sendIntervalMs` 间隔限速 | 单条仍超 `maxMessageBytes` 再按字节硬切 |
| 草稿-确认门 | — | ✅ 增量吸收 | `qq_send` 起草 + `qq_confirm_send` 确认 |
| 控制台面板 | — | ✅ 增量吸收 | 连接/监听名单/实时事件流 |
| 环境提示词 | — | ✅ 增量吸收 | `envPromptVars` + `ENV_PROMPT.md` |
| 通知事件 | 撤回/退群等 | ✅ 增量吸收 | recall / member / poke / emoji |
| 被动视觉(VLM) | — | ✅ 增量吸收（默认关） | 可选 OpenAI 兼容端点描述图片 |
| 历史查询 | — | ✅ 增量吸收 | `qq_history（action=recent）` / `qq_history（action=search）` |
| QQ 空间动态（说说） | — | ✅ 增量吸收 | 自动/手动发表、附图、回评、查看评论、删除（`qq_qzone（action=post/delete/reply/detail/feeds/status）`） |
| 群聊发言频率限制 | — | ✅ 增量吸收 | 每个群在滑动窗口内可发消息总量的硬上限（含主动与回复），防刷屏 |
| 话题自动结束 / 防死循环 | — | ✅ 增量吸收 | 单会话 bot 连续发言超上限、或对方长时间静默则自动收尾；主动说话还按话题相似度去重，防反复换汤不换药 |
| 情绪系统（全局心情） | `emotion.py` | ➡️ 已拆到 `cortico-bot-qq-persona` | 情绪/好感度/外号三块 bot 内部状态自 `0.5.0` 起迁移到独立 Persona 扩展 `cortico-bot-qq-persona`，装它即可获得 `qq_mood` / `qq_affinity_*` / `qq_alias_*` 工具与系统前缀注入 |
| AI 作息（睡眠/午休/活跃） | — | ✅ 增量吸收 | 按真实时间切换三段：睡眠段暂停主动冒泡（被动回复照常）、午休段放缓主动节奏、活跃段正常；时段切换时向可主动说话的会话推送一条播报提示，由主模型决定措辞并调用 qq_send 发出（无第二模型，生成失败才回退兜底文案） |
| 闹钟 / 记事本 | — | ✅ 新增 | 让智能体把"需要定时做的事 / 约定"记下来（`qq_reminder（action=add）`），到点自动在该会话提醒（`qq_reminder（action=list）` 查、`qq_reminder（action=cancel）` 删）；落盘持久化、跨重启不丢 |
| 好感度（关系分） | — | ✅ 新增 | 对**每个用户独立**维护一份好感度（-100~100，可正可负、随互动上下浮动，不是只增不减）；`qq_affinity_adjust` 加减、`qq_affinity_get` 查、`qq_affinity_list` 总览；当前用户好感度会**自动注入对话上下文**，影响语气与分寸 |
| 语音（ASR + TTS） | — | ✅ 新增 | 听语音（ASR 转文字）+ 说语音（TTS）。**供应商可插拔**，内置 `native`（OneBot 原生，零依赖）、`custom`（远程 OpenAI 兼容端点 + API Key）、`local`（本地/自建模型如 VoxCPM2 经 vLLM-Omni，免 Key、慢推理可加超时、支持额外参数透传）；是否说话由语义判定决定，并非每条都念 |

## 本分支：本地权限保护、QQ 笔记和启动入口

本分支基于 0.6.24，保留该版本的加群申请提示词和表情包扩展名修复。

**本地权限拦截需要配套宿主修改，不能只安装此插件就认为已阻止鼠标或文件工具。** 宿主须提供可信的本轮事件来源，并在普通和流式工具执行前调用 `World.checkToolCall`。参考补丁和适用边界见 [宿主集成说明](docs/host-tool-guard.md)。在宿主提供该能力前，本分支应按草稿审查。

- `allowLocalOperations` 默认关闭：有 QQ 来源的轮次拒绝通用文件、设置和电脑操作；独立桌面输入仍遵守原有授权规则。开关不会隔离共享对话上下文或保证隐私不泄露。
- `qq_memory` 提供固定数据文件中的追加、最近记录和关键词查询。保存需要宿主确认的 QQ 来源，不能由模型传文件路径、来源或权限；读回内容始终标为不可信资料。所有会话共享查询结果，不自动写入角色提示词。
- Windows 设置页“连接与监听”新增“启动 QQ 聊天”：先启用插件，再启动配置的 `NapCatWinBootMain.exe`。已连接或管理端口在监听时复用；需扫码时打开本机 QQ 登录页。启动动作不注册为 AI 工具，也不支持任意脚本或命令参数。
- 到点提醒按配置时区每天合计最多 5 次，可在自定义配置修改；超额时直接发送固定文字，每会话每天最多提示一次，不调用模型或语音合成。设置提醒和普通聊天仍按原流程使用 AI。
- 图片附件下载的 20 秒超时覆盖完整正文，并新增单张 8 MB 上限；异常图片停止下载后继续处理后续消息。辅助视觉和表情包收藏也按各自配置边读边检查大小，不再等整张图进内存才判断超限。

配置和测试详情见 [功能与验证说明](docs/local-features.md)。

## 连接模式

- `reverse`（默认，fat-fish 风格）：本扩展开一个 WebSocketServer（配置 `wsHost`/`wsPort`/`wsPath`），在 NapCat 里把「反向 WebSocket」指向 `ws://<host>:<port><path>`，NapCat 主动连入。
- `forward`（内置风格）：本扩展作为客户端，配置 `wsUrl` 指向 NapCat 暴露的 OneBot WebSocket 地址。

两种模式走同一套帧处理：带 `echo` 的是 API 回包，带 `post_type` 的是事件。

## 配置（`config.json` 的 `worlds.qqbot` 节）

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `false` | 启用本 world |
| `allowLocalOperations` | `false` | QQ 来源能否使用本地工具；拦截依赖配套宿主权限补丁，见上方说明 |
| `napcatLauncher` | `""` | Windows 本机 `NapCatWinBootMain.exe` 的绝对路径，只供设置页启动按钮使用 |
| `mode` | `reverse` | `reverse` / `forward` |
| `wsUrl` | `ws://127.0.0.1:3001` | 正向模式地址 |
| `wsHost` / `wsPort` / `wsPath` | `127.0.0.1` / `8080` / `/onebot/v11/ws` | 反向模式监听。**默认只绑回环**：绑 `0.0.0.0` 会让同网段任何机器连上来伪造事件，且无 Token 时直接拒绝启动 |
| `token` | `""` | OneBot access_token。反向模式留空时**自动生成随机 Token** 并持久化到 `dataDir/reverse-token.txt`（跨重启稳定），需把它填进协议端「设置反向客户端」；绝不退化成无鉴权监听 |
| `groups` / `privates` | `[]` | 监听群号 / 私聊 QQ；`groups` 为空=接入全部群 |
| `privateAggregationWindow` | `0` | 私聊连续消息聚合窗口(ms)，0=不聚合 |
| `maxMessageBytes` | `1500` | 长文本强制分片字节数 |
| `deliverImageAttachments` | `true` | 图片作为模型附件（需模型支持图像）。这是默认的看图路径 |
| `vision.enabled` | `false` | 辅助视觉：用另一个 VLM 描述图片。主模型本身能看图时不必开（两条路会重复花钱） |
| `vision.endpoint` / `vision.apiKeySecret` / `vision.model` | `""` | 开启辅助视觉后**三项必填**。密钥只写名字（如 `DEEPSEEK_API_KEY`），值放在部署密钥库（.env）里，由框架 `secret()` 读取 |
| `qzone.enabled` | `false` | 启用 QQ 空间动态（说说）功能（需重启生效） |
| `qzone.tickSec` / `qzone.chancePerTick` | `900` / `0.15` | 后台自动冒泡间隔(秒)与每次触发概率 |
| `qzone.dailyQuota` | `5` | 每日自动发表上限（0=不限） |
| `qzone.permission` | `1` | 动态可见权限 `ugc_right`：1=公开（默认）/4=好友/16=指定人/64=仅自己/128=黑名单（值随 NapCat/SnowLuma 版本） |
| `qzone.imageMode` | `none` | `none`=不附图 / `recent`=自动附上最近一条收到的 QQ 图片 |
| `qzone.autoReplyComments.enabled` | `false` | 收到空间评论时自动回复（需重启生效） |
| `qzone.autoReplyComments.dailyQuota` | `20` | 每日自动回评上限（0=不限） |
| `qzone.autoReplyComments.cooldownSec` | `30` | 两条自动回评之间的最小间隔(秒) |
| `qzone.commentAction` | `auto` | 回评所用的 OneBot action 名（NapCat/SnowLuma 为 `comment_qzone`；留 `auto` 即用内置默认值，可改）。**v0.6.0 起评论回复改为事件驱动（主模型经 qq_qzone（action=reply） 回复），不再用第二模型** |
| `proactive.endpoint` / `proactive.apiKeySecret` / `proactive.model` | 已移除 | **v0.6.0 起主动说话改为事件驱动**：不再单独调用 LLM，改由主模型在收到主动说话事件后生成并发送，这些第二模型配置项已删除 |
| `proactive.dailyQuota` | `20` | 每日主动消息上限（0=不限）。`topicSimilarity`/`tokenLimit` 等第二模型相关配置项已随 0.6.0 移除 |
| `groupSpeak.enabled` | `true` | 群聊发言频率限制开关（含主动与回复） |
| `groupSpeak.maxPerWindow` | `12` | 滑动窗口内每个群允许发出的消息上限 |
| `groupSpeak.windowSec` | `60` | 限速滑动窗口长度（秒） |
| `antiLoop.enabled` | `true` | 话题防死循环开关 |
| `antiLoop.maxConsecutiveBotTurns` | `5` | 单会话内 bot 连续发言上限（对方发来任意消息即清零），超过则本次发言被拦截并提示收尾 |
| `antiLoop.idleToEndSec` | `300` | 对方静默超过该秒数且 bot 已发过言，则自动收尾（0=关闭该规则） |
| `emotion.enabled` | `false` | 是否启用情绪感知与注入（移植自 fat-fish emotion）。**默认关闭**：开启后每条消息都会额外调一次模型，与主模型的工作重复 |
| `emotion.decayHours` | `2.0` | 心情值自然回落到中性（0）的半衰期（小时），越小忘得越快 |
| `emotion.labelMinutes` | `40` | 主导情绪标签冷却（分钟）；实际生效冷却为 `labelMinutes × 当前强度`，冷却期内不切换标签，避免来回横跳 |
| `emotion.model` | `""` | 用于分析用户消息情绪、抽取心情变化（情绪/强度/起因）的 chat 模型名（OpenAI 兼容）。开启情绪系统后必填 |
| `emotion.endpoint` | `""` | 情绪感知所用 chat 端点。开启情绪系统后必填 |
| `emotion.apiKeySecret` | `""` | 端点密钥名；值写在部署密钥库（.env）里，由框架 `secret()` 读取。开启情绪系统后必填 |
| `routine.enabled` | `false` | **AI 作息**开关（默认关）。开启后 bot 按真实时间切换睡眠/午休/活跃三段 |
| `routine.sleepStart` / `routine.sleepEnd` | `23:00` / `07:30` | 睡眠段起止（`HH:MM`，可跨午夜）。睡眠段内**自动暂停主动冒泡**（被动回复照常）|
| `routine.lazyStart` / `routine.lazyEnd` | `12:00` / `14:00` | 午休段起止。该段内主动说话节奏放缓（更短更随意）|
| `routine.greetSleep` / `routine.greetWake` / `routine.greetLazy` | 见源码默认值 | 时段切换时的**兜底**文案：正常播报由主模型根据推送的提示生成（每次说法不固定），仅当生成失败才回退到这几句；留空=无兜底直接跳过 |
| `reminder.enabled` | `true` | **到点提醒**开关。开启后到点自动把提醒发到对应会话；记录/查询/取消不受此开关影响（始终可用）|
| `reminder.dailyQuota` | `5` | 所有群和私聊共用的每日到点处理上限，最小 1；按配置时区零点恢复，重启保留已用次数 |
| `reminder.limitMessage` | 见默认配置 | 超额时直发的固定文字，`{limit}` 替换为上限；同会话每天最多提示一次，不顺延该条提醒 |
| `affinity.enabled` | `true` | **好感度系统**开关。开启后，与该用户对话时其当前好感度会自动注入上下文、影响态度与分寸；`qq_affinity_*` 工具始终可用 |
| `admin.enabled` | `false` | **群管理员能力**开关。开启后可在群里执行管理员操作（群撤回 / @全体成员 / 发群通知 / 审核进群 / 给予群头衔 / 禁言 / 全员禁言）。需要 bot 是群管理员或群主，否则 QQ 会拒绝操作；`qq_admin（action=recall/at_all/notice/join_*/title/ban/ban_all/kick）` 工具始终可用，关闭时返回「功能未开启」|
| `voice.enabled` | `false` | **语音（ASR+TTS）**开关 |
| `voice.provider` | `native` | 语音供应商（实现方式）。可选项由 `src/voice.ts` 注册表动态生成：`native`=OneBot 原生 `translate_record`/`tts`（零依赖、开箱即用）；`custom`=用「网址+API Key」对接远程 OpenAI 兼容音频服务（GLM/OpenAI/自建等）；`local`=本地/自建模型（OpenAI 兼容、免 API Key、慢推理可加超时、支持额外参数做声音克隆/设计，如 VoxCPM2 经 vLLM-Omni）；`voxcpm`=本地 VoxCPM2 TTS 服务（自有接口 `GET /health`+`POST /tts`，免 Key、音色用自然语言描述，仅做 TTS、收语音回退 `native` 识别，如 Fat-Fish 的 `vox_tts_server.py`）。新增供应商只需在 `voice.ts` 用 `registerVoiceProvider` 注册 |
| `voice.asr` | `true` | 开启语音识别（收到语音→转文字） |
| `voice.tts` | `true` | 开启语音合成（回复时念成语音） |
| `voice.semanticJudge` | `true` | 是否用 LLM 判断"这条回复要不要念出来"，避免每条都念 |
| `voice.audioFallback` | `true` | 当语音合成失败（如本地模型崩溃/超时）时，是否回退为纯文字发送，而不是吞掉这条回复 |
| `voice.judgeEndpoint` | `https://api.deepseek.com/v1` | 语义判定所用 OpenAI 兼容 chat 端点（**不绑定任何模型商**，可填你自己的） |
| `voice.judgeApiKeySecret` | `DEEPSEEK_API_KEY` | 语义判定端点密钥名；值写在部署密钥库（.env）里，由框架 `secret()` 读取 |
| `voice.judgeModel` | `deepseek-chat` | 语义判定所用 chat 模型名 |
| `voice.voiceBaseUrl` | `""` | 选 `custom` / `local` 时必填：OpenAI 兼容音频端点基址（远程如 `https://open.bigmodel.cn/api/paas/v4` 或 `https://api.openai.com/v1`；本地如 `http://localhost:8000/v1`）。ASR 走 `{网址}/audio/transcriptions`，TTS 走 `{网址}/audio/speech` |
| `voice.voiceApiKeySecret` | `VOICE_API_KEY` | `custom` 供应商 API Key 名；值写在部署密钥库（.env）里，由框架 `secret()` 读取。`local` 供应商免 Key，留空即可 |
| `voice.voiceVoice` | `""` | 音色（仅当所选语音模型支持时填写，如 `tongtong`）；留空用服务商默认 |
| `voice.voiceAsrModel` | `whisper-1` | 语音识别模型名（OpenAI 兼容 `/audio/transcriptions`，GLM 用 `glm-asr-2512`） |
| `voice.voiceTtsModel` | `tts-1` | 语音合成模型名（OpenAI 兼容 `/audio/speech`，GLM 用 `glm-tts`，VoxCPM2 一般为 `openbmb/VoxCPM2`） |
| `voice.voiceTimeout` | `120` | 请求超时（秒）：TTS/ASR 单次请求最长等待，`custom` 与 `local` 共用，本地推理慢可调大（1~1800） |
| `voice.voiceExtraTts` | `{}` | TTS 额外参数（JSON 字符串）：合并进 `/audio/speech` 请求体，用于本地模型高级特性（如 VoxCPM2 声音克隆 `{"reference_audio":"<url或base64>"}`、声音设计 `{"voice_design":"一个温柔的少年音"}`、或 `{"language":"zh"}`） |
| `asr.mode` | `local` | 语音识别后端：`local`（本地 FunASR / 自建服务）· `cloud`（OpenAI 兼容 `/audio/transcriptions`） |
| `asr.localEngine` | `funasr` | 本地引擎名（`funasr` 等），仅 `local` 生效 |
| `asr.localModelPath` | `""` | 本地模型目录；留空=用引擎默认 |
| `asr.localVenv` | `""` | 本地推理所用Python 虚拟环境路径 |
| `asr.localPort` | `8778` | 本地推理服务端口（仅 `local`） |
| `asr.cloudUrl` | `""` | OpenAI 兼容 ASR 基址（`cloud` 必填），如 `http://127.0.0.1:8000/v1` |
| `asr.cloudApiKeySecret` | `ASR_API_KEY` | 云端 ASR 密钥名；值写在部署密钥库（.env）里，由框架 `secret()` 读取 |
| `asr.cloudModel` | `glm-asr-2512` | 云端 ASR 模型名 |
| `asr.ffmpegPath` | `""` | ffmpeg 可执行文件路径（用于把 SILK/AMR 解码成 WAV）。空=依次找 PATH 与仓库 `node_modules/ffmpeg-static`（win 用 `ffmpeg.exe`）；找不到则语音识别不可用 |
| `asr.transcribeTimeout` | `60000` | 识别超时（毫秒）：单次 ffmpeg 解码 + 识别请求共用（1000~600000） |
| `voice.voxcpmUrl` | `http://127.0.0.1:8765` | 选 `voxcpm` 供应商时必填：本地 VoxCPM2 TTS 服务基址（如 Fat-Fish 的 `vox_tts_server.py`）。服务暴露 `GET /health`（就绪返回 `{"ready":true,"state":"ready"}`）与 `POST /tts`（返回 48kHz WAV） |
| `voice.voxcpmVoiceDesc` | `可爱傲娇少女音` | VoxCPM2 说话人音色（自然语言描述） |
| `voice.voxcpmSpeed` | `1.0` | VoxCPM2 合成语速（0.5~2） |
| `voice.voxcpmTimesteps` | `10` | VoxCPM2 推理步数（越小越快越夸张，1~50） |
| `voice.voxcpmSeed` | `0` | VoxCPM2 随机种子（0=随机，>0 固定音色/韵律可复现） |

> 连接类参数（mode/地址/端口/token）改动后需**整机重启**生效；监听名单（groups/privates）同理。群聊限速/防死循环/**主动相似度**/作息/闹钟均为热配置，控制台改完即时生效（`routine.*` / `reminder.*` 也是 `x-hot`）。

## AI 作息（routine）

让 bot 按真实时间过"作息"：

- **睡眠段**（`sleepStart`→`sleepEnd`，可跨午夜）：暂停"主动冒泡"定时器（不对着没找它的人发起话题），但被动回复照常——即"睡着了但被戳醒仍会回"。
- **午休段**（`lazyStart`→`lazyEnd`）：主动说话节奏放缓。
- **活跃段**：正常主动冒泡。
- 进入/离开某个时段时，会向所有可主动说话的会话**推送一条播报提示**：由主模型根据该提示决定措辞并调用 `qq_send` 发出（带人设+记忆），所以每次说法都不一样、不会念固定套话；只有在主模型生成/发送失败时才回退到 `routine.greetSleep/Wake/Lazy` 兜底文案。
- 时段状态与"上次切换到的段"会持久化到 `proactive-state.json`；首次上线（无存档）不会立刻补播报，从下一次真实切换开始播。

> 作息与情绪、记忆互不冲突：睡眠段只是收起"主动找人"，并不清空心情或记忆。

## 闹钟 / 记事本（reminder）

让智能体把"以后要做的事 / 约定"记下来，到点自动提醒，相当于它的随身备忘录 + 闹钟。

- **记提醒**：对话中用户说"提醒我三点开会""帮我记一下明天还书"，智能体调用 `qq_reminder（action=add）`，并给出时间（`when`）和内容（`text`）。时间支持多种写法：
  - 绝对 ISO：`2026-09-24T15:00`
  - `HH:MM`（今天；已过则顺延明天）、`明天 9:00`、`今天 21:30`
  - 相对：`in 30m`、`30分钟后`、`2小时后`、`3天后`
  - 调用成功会返回 `id` 与解析后的时间，智能体应把"已记好、几点提醒"回给用户。
- **到点自动提醒**：后台每 30 秒扫描一次。在每日额度内，向主模型推送带目标会话的提醒事件，由主模型决定措辞和是否发送。所有群和私聊每天共用 `reminder.dailyQuota` 次（默认 5），按到点处理次数计数；超额提醒结束并直发固定提示，不再向模型推事件，也不顺延次日。离线期间到期的提醒，重启后同样受当日额度限制。
- **发送位置**：省略 `address` 时，只使用本轮宿主实际投递的唯一 QQ 消息会话；多个会话混入或来源不可确认时要求明确地址，不再把主会话 id 当作 QQ 地址。显式目标也必须通过监听/发送权限检查。缺少可信来源的宿主只能明确填写地址。
- **查看 / 取消**：`qq_reminder（action=list）` 列出所有待提醒（id、内容、时间），`qq_reminder（action=cancel）` 按 id 取消。
- **持久化**：所有提醒落盘 `dataDir/reminders.json`，跨整机重启不丢。
- **开关**：`reminder.enabled`（默认开）只控制"到点自动发提醒"；记录/查询/取消始终可用。可在控制台实时开关（`x-hot`）。
- 控制台"闹钟/记事本"状态灯会显示当前待提醒条数。

> 约定时间以 bot 所在机器本地时区（`timezone`，默认 `Asia/Shanghai`）为准。

## 好感度（affinity）

对每个用户（按 QQ 号区分，跨群/私聊同一份）维护一份**关系分**，让 bot 像真人一样"亲疏有别"：

- **可正可负**：范围 `-100 ~ 100`，初始 `0 = 普通`。让人舒服/投缘就加，让人反感/越界就减——**不是只增不减**。
- **调整**：对话中 bot 判断互动质量后调用 `qq_affinity_adjust`，传 `delta`（正数加、负数减，如 `+5` / `-10`）与可选 `reason`（记一笔原因）；群聊需指定 `who`（对方 QQ 号），私聊省略则默认对方。
- **查询 / 总览**：`qq_affinity_get` 查某人，`qq_affinity_list` 按好感度从高到低列出所有人。
- **注入上下文影响聊天**：`affinity.enabled`（默认开）时，用户每条消息前会把"你对 TA 当前好感度 + 关系状态 + 该把握的分寸"作为内部上下文注入，bot 据此自然调节语气（高好感更亲昵放松、低/负好感更客气疏远保持距离）；不注入数字、不刻意强调关系分，避免生硬。
- **持久化**：落盘 `dataDir/affinity.json`，跨重启不丢。
- **控制台**："好感度"状态灯显示已记录人数；徽标显示人数。

> 说明：好感度是 bot 自发的"关系判断"，加不加、加多少由它在对话里自己拿捏（也可用工具显式调整）。开关 `affinity.enabled` 只控制是否自动注入上下文；`qq_affinity_*` 工具始终可用（`x-hot` 实时生效）。

## 语音（ASR + TTS）

让 bot 能**听语音**（ASR，语音消息转文字）也能**说语音**（TTS，文字回复念成语音）。设计目标是**供应商不写死、可插拔**，方便对接不同模型商或本地模型（例如 VoxCPM2）。

### 开关与基本行为

- `voice.enabled` 总开关；`voice.asr` / `voice.tts` 分别控制收语音转文字 / 发语音。
- **语义判定**：`voice.semanticJudge`（默认开）用 LLM 判断"这条回复要不要念出来"，避免每条都念。判定走独立的 `judgeEndpoint`/`judgeApiKeySecret`/`judgeModel`（**不绑定任何模型商**，可填你自己的 chat 端点）。关闭则"要发语音的回复一律念"。
- **失败回退**：`voice.audioFallback`（默认开）——当语音合成失败时（本地模型崩了 / 超时 / 端点挂了），回退为纯文字发送，而不是吞掉这条回复。

### 供应商（实现方式）

`voice.provider` 下拉项由 `src/voice.ts` 的**注册表**动态生成（不是写死），当前内置三档：

| 供应商 | 鉴权 | 协议 | 适用场景 |
|---|---|---|---|
| `native` | 无 | OneBot 原生 `translate_record` + `tts` | 零依赖、开箱即用；依赖 NapCat 服务端已解码 SILK 等格式 |
| `custom` | 需要 API Key | OpenAI 兼容 `/audio/transcriptions` + `/audio/speech` | 远程模型服务（OpenAI / GLM / 自建兼容服务），配 `voiceBaseUrl`+`voiceApiKeySecret` |
| `local` | **免 Key** | OpenAI 兼容 `/audio/transcriptions` + `/audio/speech` | 本地/自建模型（如 VoxCPM2 经 vLLM-Omni）；慢推理靠 `voiceTimeout` 加超时；高级特性靠 `voiceExtraTts` 额外参数透传 |
| `voxcpm` | **免 Key** | 自有接口 `GET /health` + `POST /tts`（返回 48kHz WAV） | 本机已有一份 **VoxCPM2 TTS 服务**（如 Fat-Fish 的 `vox_tts_server.py`）；音色用自然语言描述、免 Key、快；**仅做 TTS，收语音回退 `native` 识别** |

`native` / `custom` / `local` 三档共用同一套 OpenAI 兼容协议：`ASR`=`POST {baseUrl}/audio/transcriptions`（表单 `file`+`model`+额外参数），`TTS`=`POST {baseUrl}/audio/speech`（JSON `model`+`voice`+`input`+额外参数）。`voxcpm` 走自有协议（见下）。

### 接入本地模型（以 VoxCPM2 为例）

VoxCPM2（OpenBMB，2B 参数 TTS）经 **vLLM-Omni** 提供 OpenAI 兼容接口，启动后自带 `/audio/speech`：

```bash
# 启动本地服务（具体命令随 vLLM-Omni 版本，端口自定）
vllm serve openbmb/VoxCPM2 --omni --port 8000
```

然后在语音配置组里：

1. **实现方式**选 `local`
2. **语音模型网址**填 `http://localhost:8000/v1`（即上面的 `--port` 对应 base url）
3. **语音 API Key 变量**留空（`local` 免 Key）
4. **TTS 模型名**填 `openbmb/VoxCPM2`（或该服务暴露的模型 id）
5. **请求超时(秒)**按机器显卡调到合适值（本地推理慢，默认 120，可到几百）
6. **TTS 额外参数(JSON)**可选做声音克隆 / 声音设计：
   - 声音克隆：`{"reference_audio":"<音频 url 或 base64>"}`
   - 声音设计：`{"voice_design":"一个温柔的少年音"}`
   - 指定语言：`{"language":"zh"}`

> 说明：VoxCPM2 主要做 **TTS**，一般不做 ASR。需要本地语音识别时，可另跑一个本地 faster-whisper（同样暴露 OpenAI 兼容 `/audio/transcriptions`，与 TTS 同址即可），或把 ASR 保持 `native`（由 NapCat 服务端解码）。

### 接入本地 VoxCPM2 TTS 服务（voxcpm 供应商）

如果你的本地 VoxCPM2 不是经 vLLM-Omni 暴露，而是**自有一个 TTS 服务**（典型如 Fat-Fish 的 `vox_tts_server.py`，协议： `GET /health` 返回 `{"ready":true,"state":"ready"}` 即就绪、`POST /tts` 收 `{text, voice_desc?, speed?, inference_timesteps?, seed?}` 回 **48kHz WAV 字节**），选 `local` 会因为"不是 OpenAI 兼容"而失败。这时用 **`voxcpm`** 供应商直接对接：

```bash
# 启动本地 VoxCPM2 TTS 服务（举例：Fat-Fish 的 vox_tts_server.py）
python vox_tts_server.py --host 127.0.0.1 --port 8765
# 健康检查：curl http://127.0.0.1:8765/health  → {"ready":true,"state":"ready",...}
# 合成：     POST http://127.0.0.1:8765/tts {"text":"你好","voice_desc":"可爱傲娇少女音"}
```

然后在语音配置组里：

1. **实现方式**选 `voxcpm`
2. **VoxCPM 服务地址**填 `http://127.0.0.1:8765`（默认即此，与服务 `--host/--port` 对应）
3. **VoxCPM 音色描述**填说话人音色（自然语言），如 `可爱傲娇少女音`
4. **VoxCPM 语速**（0.5~2，默认 1.0）、**VoxCPM 推理步数**（默认 10，越小越快越夸张）、**VoxCPM 随机种子**（0=随机，>0 固定可复现）按需调
5. **无需 API Key**（本地服务免 Key）

行为要点：

- **TTS**：语义判定认为该念语音时，把文本 `POST /tts` 拿到 WAV，作为 `record` 语音段发出；若服务未就绪（`/health` 返回 `{ready:false}` 或 `state` 非 `ready`，例如刚启动还在加载模型）或合成失败，自动**回退文字**，不阻塞消息。
- **ASR（收语音）**：VoxCPM2 服务不含语音识别，`voxcpm` 供应商的收语音**回退到 `native`**（即 NapCat 的 `translate_record`）。若想用本地模型识别，改用 `asr.mode='local'`（见「语音识别（ASR 共享）」配置组）。
- 与 `local` 区别：`local` 走 OpenAI 兼容 `/audio/speech`（适合 VoxCPM2 经 vLLM-Omni 的场景）；`voxcpm` 走上述自有 `/tts` 接口（适合已有一个独立 TTS 服务的场景）。按你本地实际部署选其一。


### 新增自定义供应商（进阶）

若某模型接口不是 OpenAI 兼容（例如某厂商私有协议），在 `src/voice.ts` 实现 `VoiceProvider` 接口并 `registerVoiceProvider(...)` 即可，下拉项会自动出现，无需改 UI 代码：

```ts
interface VoiceProvider {
  id: string;                                  // 下拉项 key
  transcribe(ctx): Promise<string | null>;    // 返回转写文本；null=回退文字
  synthesize(ctx): Promise<RecordSeg | null>;  // 返回 { type:'record', data:{ file } }；null=回退文字
  checkDeps?(cfg, log): boolean;               // 可选：依赖检查/告警
}
```

## 工具

- `qq_send`：**发送一条消息**到当前会话（群或私聊）。默认立即发出；参数 `confirm=true` 时改为起草模式——内容先以「草稿」出现在回复里，等你下一轮说「确认/算了」再决定发不发。
- `qq_confirm_send`：确认并真正发送草稿（带 `barrierAfter`，防止连续误发）。
- `qq_history（action=recent）`：查询某群/私聊最近消息。
- `qq_history（action=search）`：按关键词检索历史消息。
- `qq_reminder（action=add）`：添加一条到点提醒（`content` 内容、`when` 如 `20:30` 或 ` tomorrow 8:00` 或 ISO 时间、可填 `who` 给指定人）。到点自动发到对应会话，带优雅超时控制。
- `qq_reminder（action=list）`：列出当前待触发的提醒。
- `qq_reminder（action=cancel）`：取消一条提醒（`id` 或 `all=true` 取消全部）。
- `qq_qzone（action=post）`：发表 QQ 空间动态（说说）。参数 `content`（正文，必填，由模型自行生成后传入）、`topic`（话题）、`images`（图片数组，仅限 http(s)/base64）、`permission`（可见权限 `ugc_right`，默认 1=公开）。后台自动冒泡由 `qzone.tickSec`/`chancePerTick` 触发主模型生成并发布，工具本身不自动生成文案。
- `qq_qzone（action=delete）`：删除指定 `tid` 的动态。
- `qq_qzone（action=reply）`：对某条动态发表评论（`tid` + `content`，`comment_id` 可留空；NapCat/SnowLuma 仅支持对整个动态评论，不支持按评论楼中楼回复。要回复某条评论时，在 `content` 里 @对方昵称 发在该动态下即可）。
- `qq_qzone（action=detail）`：查看一条动态的详情与全部评论（`tid` + `uin`=动态作者 QQ 号，均来自 `feeds` 返回；自家动态 `uin` 可省略）。评论已规整为 `{commentId, uin, name, time, content, replies[]}`，内联 @ 标记转为可读的 `@昵称(uin:xxx)`；模型拿到评论者 uin 后用 `action=reply` + content 里 @对方 即可回复。依赖 SnowLuma `get_qzone_msg_detail`（NapCat 不一定提供，失败会返回 error）。
- `qq_qzone（action=feeds）`：拉取 QQ 空间好友动态（feed）列表（`num`，默认 5）。返回每条动态的 `tid`（=feed 句柄 `key`）、`uin`、`nickname`、`time`、`text`（HTML 已剥为纯文本）；把 `tid`/`uin` 传给 `action=detail` 看评论、传给 `action=reply` 发评论。
- `qq_qzone（action=status）`：返回空间功能开关、今日已发数/配额、待回评等状态。
- 群聊发言限速 / 话题防死循环在 `qq_send` 发送环节统一生效：当某群达到窗口上限，或某会话 bot 连续发言超限/对方久未接话时，`qq_send` 会返回「未能发送：…（发言频率已达上限 / 话题自动收尾）」而不是真正发出。这是正常节流，不是报错。
- **语音工具 / 命令**：
  - 收语音：QQ 语音消息经 `voice.provider` 指定的 ASR 后（如 `native` 的 `translate_record`、或 OpenAI 兼容 `/audio/transcriptions`）转成文字进入对话；SILK 等编码能否被识别取决于所选供应商（QQ 语音多为 SILK，`native` 由 NapCat 服务端解码最稳，`custom`/`local` 一般要 wav/mp3/flac）。
  - 说语音：`voice.tts` 开启且语义判定认为该念时，回复文字经 TTS 合成成语音段（如 `native` 的 `tts` 或 OpenAI 兼容 `/audio/speech`，`local` 可透传 `voiceExtraTts` 做声音克隆/设计）发出；失败且 `voice.audioFallback` 开启时回退文字。
  - 运行时命令（聊天里即时生效，优先级高于控制台配置）：`/语音 开` / `/语音 关`（整体开关）、`/语音 asr 开|关`、`/语音 tts 开|关`、`/语音 判定 开|关`、`/语音 状态`（查看当前开关与所选供应商）。开关为运行时内存态，整机重启回到控制台 `voice.*` 默认值。
- **情绪系统（移植自 fat-fish `emotion.py`）**：
  - 每轮用户发言后，由 LLM 抽取本次心情变化（情绪/强度/起因），维护**全局一份**心情状态（多情绪叠加、自然衰减、主导情绪冷却）。
  - 把当前心情提示词（心情值 + 主导情绪 + 行为引导）注入 **Cortico 全局上下文**（`ENV_PROMPT.md` 的 `{{qq.emotion}}`），让模型在回复中带上情绪质感。
  - 用户问「你心情怎么样 / 你现在什么情绪 / /心情」时，自动把心情描述追加进 system 提示，让模型据实回答；`/心情 重置` 可把心情清零回平静。
  - **运行时开关（聊天命令，即时生效，优先级高于控制台配置）**：`/心情 开` 开启、`/心情 关` 关闭（关闭后不再感知新消息、不再把情绪注入上下文，但 `/心情` 仍可查当前残留状态）、`/心情 状态` 查看当前开/关。该开关是运行时内存态，整机重启后回到控制台 `emotion.enabled` 的默认值。控制台里 `emotion.enabled` 仍是持久默认开关（热保存）。
  - 迁怒防护：当检测到"别人骂你，但你却想对另一个人发火"时，提示里会加提醒，避免迁怒无辜。
- **好感度系统（affinity）**：
  - `qq_affinity_adjust`：调整某用户好感度。`who`（群聊必填、私聊可省）填对方 QQ 号；`delta` 正数加、负数减（如 `+5` / `-10`）；`reason` 可选，记一笔加减原因。调整后好感度会在该用户下条消息时自动注入上下文。
  - `qq_affinity_get`：查询某人当前好感度（`who` 规则同上）。
  - `qq_affinity_list`：按好感度从高到低列出所有人（qq / 昵称 / 分数 / 状态 / 上次原因）。
  - 当前用户好感度会以"关系备忘"形式自动注入对话上下文（受 `affinity.enabled` 控制），bot 据此调节语气分寸。

- **群管理员能力（admin）**：当 bot 账号是群管理员 / 群主时，可在群里执行后台管理操作。功能总开关 `admin.enabled`（默认关，控制台热开启）。开关仅控制是否真正执行，`qq_admin（action=recall/at_all/notice/join_*/title/ban/ban_all/kick）` 工具始终可用（关闭时返回「功能未开启」）。所有操作需要 bot 具备对应管理员权限，否则 QQ 会拒绝（返回具体错误）。
  - `qq_admin（action=recall）`：撤回一条群消息（`messageId` 为要撤回消息的 `message_id`，仅能撤回近 2 分钟内或自己发的消息）。
  - `qq_admin（action=at_all）`：在群里 **@全体成员** 并附正文（`text`）。需要群开启允许 @全体成员。
  - `qq_admin（action=notice）`：发布**群通知 / 群公告**（`content`）。底层 OneBot action 由 `admin.noticeAction` 配置（默认 `send_group_notice`；若你的 NapCat 版本用 `_send_group_notice`，在控制台改 `worlds.qqbot.admin.noticeAction` 即可）。
  - `qq_admin（action=join_list）`：列出当前**待审核的加群请求**（来自收到的加群申请 / 邀请事件），返回每条的 `flag`、群号、申请人 QQ、留言。
  - `qq_admin（action=join_approve）`：通过一条加群请求（`flag` 来自 `qq_admin（action=join_list）`）。
  - `qq_admin（action=join_reject）`：拒绝一条加群请求（`flag` + 可选 `reason`）。
  - `qq_admin（action=title）`：给成员设置**群专属头衔**（`who` + `title`，`title` 为空则清除）。
  - `qq_admin（action=ban）`：**禁言**某成员（`who` + `durationSec`，默认 600 秒，0 表示解禁）。
  - `qq_admin（action=ban_all）`：**全员禁言**开关（`enable` = true 开启、false 关闭）。
  - `qq_admin（action=kick）`：【群管理员·需授权】把某成员踢出群聊（踢人/飞机票）。`who` 填昵称、QQ 号或外号；省略则默认针对最近被引用或 @ 提及的人。`rejectRejoin=true`（默认）表示踢出并拒绝其再次加群。
  - 群参数 `group` 支持「群号」或 `group:<群号>`；不填则使用当前会话所在群。成员参数 `who` 支持昵称（自动按群内昵称解析）或 QQ 号。

## 外号记忆（alias）

`who` 类参数（禁言、设头衔、戳一戳、踢人、好感度…）除了昵称和 QQ 号，还能填你事先登记的**外号/代称**，由本扩展代为解析成对应的人：

- `qq_alias_set`：登记「外号 → QQ 号」（长期记忆，跨重启保留）。同名外号会被覆盖。
- `qq_alias_forget`：删除某个外号。
- `qq_alias_list`：列出当前记住的所有「外号 → QQ 号」对应关系。

## 戳一戳

- `qq_poke`：戳一戳某个人（群戳一戳或私聊戳一戳）。`target` 为会话地址 `group:<群号>` 或 `private:<QQ号>`；`user` 为要戳的人的 QQ 号或群内昵称（私聊时留空表示戳对话对象）。这是一个动作而非文字消息。

## 主动说话调度器

- `qq_proactive（action=status）`：查看调度器状态——运行态（暖场/稳定/静默）、今日已发/配额、各会话的未回复与静默情况、最近主动说过的话。
- `qq_proactive（action=trigger）`：手动触发一次主动说话（随机挑一个可主动的监听会话，或用 `address` 指定如 `private:123`），便于测试。

## 表情包与视觉

- `qq_sticker_stats`：查看已自动收藏的表情包统计——总数（及其中已同步到 QQ 收藏表情的张数）、按情感分布、最近若干条（含情感/用处/标签/文件名）。想给 QQ 回复发表情包图片时，**先调本工具拿到真实文件名**（返回里形如 `[表情包:xxx.jpg]`），再把整段 `[表情包:文件名]` 写进回复文本即可自动发出；不要编造不存在的文件名。
- `qq_sticker_to_favorites`：把已收藏但还没进 QQ 收藏表情的表情包（开启开关前攒下的历史表情）批量补推到登录账号的 QQ「收藏表情」（custom face），让你能在 QQ 客户端里直接看到/使用。需先在设置开启「同步到 QQ 收藏表情」，且协议端支持 `add_custom_face`（如 SnowLuma）。
- `qq_sticker_tag`：修改某张已收藏表情包的标注——情感 `emotion` / 用处 `usage` / 短标签 `tag` / 显示名 `label`（只传想改的字段），改完立即持久化保存。自动标注不准（如情感是「未知」）或想按自己的习惯整理表情库时用它；先用 `qq_sticker_stats` 拿到真实文件名再调用。
- `qq_view_image`：主动重新看一张刚收到的 QQ 图片（当被动视觉没拿到描述、或你想细看时）。不传 `url` 则看最近收到的一张，也可传 `url` 指定任意图片链接，返回图片的文字描述。

### 让 bot 收藏的表情在 QQ 里可见（同步到 QQ 收藏表情）
默认 bot 收藏表情包只是把图片**下载到本机目录**发图用，并不会写进 QQ 自己的「收藏表情」。若想让你在 SnowLuma 拉起的 QQ 客户端里也能看到这些表情，开启设置 **「同步到 QQ 收藏表情」**（`worlds.qqbot.sticker.addToQQFavorites`）：
- 此后每收藏一张表情包，会同时调协议端的 `add_custom_face` 把同一张图加入该登录账号的 QQ 收藏表情（custom face），你能在 QQ 的收藏表情面板里直接看到/使用，返回 `emoji_id` 记录在元数据里。
- 新收藏自动同步；开启前历史攒下的表情，调一次 `qq_sticker_to_favorites`（可带 `limit` 分批）即可一次性补推。
- 依赖协议端支持 `add_custom_face`（SnowLuma 支持；NapCat/Lagrange 等不一定有该扩展接口）。不支持时**自动降级**：图片照常存盘、能用，只是不进 QQ 收藏，不会报错。
- 注意 QQ 收藏表情有数量上限，超出会失败（结果里会告知失败张数），删掉一些 QQ 收藏表情后重试即可。

## 接入教程

首次接入、不知道从哪下手的话，看这份图文教程（含逐步截图）：

**[→ 桌宠接入 QQ 图文教程](docs/index.html)**

要点速记：

- **默认走反向连接**（`reverse`）：桌宠开监听、NapCat 主动连进来。
- **反向连接必须带 Token**（0.3.0 起）：桌宠会自动生成一串并保存到 `dataDir/reverse-token.txt`，需在 NapCat「设置反向客户端」填上**同一串**（在桌宠「连接与监听」页面顶部可见）。只有切成 `forward`（正向）才填 NapCat「设置正向服务器」里那个 Token。，只有切成 `forward`（正向）才填 NapCat「设置正向服务器」里那个 Token。
- 反向监听地址保持 `127.0.0.1`（只允许本机接入）。改成 `0.0.0.0` 会让同网段任何机器都能连上并伪造事件，未设 Token 时桌宠会拒绝启动。
- 装完扩岃要**完整重启进程**（控制台的进程内重启不会重载扩岃）。
- 只想拑连接参数的话，点「连接与监听」页皇**「重启连接」**，不必重启整个桌宠。
- 监听名单页改完点一下别处（失焦）就自动保存；清空输入框即取消监听。

## 控制台

- **面板「监听名单」**：直接编辑监听的群/私聊。**失焦或按 Enter 即自动保存**（实时生效，无需重启），清空输入框即取消监听。
- **面板「实时事件」**：订阅并实时回放 QQ 消息与通知流。
- **配置组「QQ · 连接与监听」**：在控制台编辑连接参数与监听名单（热保存，连接类需重启）。
- **配置组「QQ 空间动态」**：在控制台开关空间功能、调人设/概率/配额/附图模式（热保存）。
- **面板「QQ 空间动态」状态灯**：显示是否开启、今日已发/配额、待回评数徽章。
- **配置组「QQ · 语音（ASR/TTS）」**：在控制台切换供应商（`native`/`custom`/`local`）、开/关收发语音、调语义判定与回退、填模型网址/API Key/音色/ASR/TTS 模型名/超时/额外参数（热保存，改完一般即时生效；部分连接类无需重启）。
- **状态灯「语音」**：显示语音总开关、所选供应商、ASR/TTS/语义判定各自的开关状态。
- **状态灯「群聊限速/防死循环」**：显示群发言限速（窗口/上限）与防死循环（连续上限/静默收尾）的当前配置。
- **徽章「群限速」「防死循环」**：控制台顶栏实时显示两者开关与阈值。

## 部署

1. 把本目录装进部署副本：`Cortico/extensions/node_modules/cortico-world-qq-final/`（保留 `src/`、`package.json`、`README.md`、`ENV_PROMPT.md`）。
2. `cd` 到该副本，`corepack pnpm install --prod` 安装 `ws` 依赖。
3. 在部署的 `config.json` 写入：
   ```json
   { "worlds": { "qqbot": { "enabled": true, "mode": "reverse", "wsPort": 8080, "groups": [123456789] } } }
   ```
4. 整机重启 Cortico（`POST /api/run/restart` 或重启进程）。
5. 在 NapCat 配置反向/正向 WebSocket 指向本扩展。

## 与 cortico-world-memory 的关系（可选，非依赖）

长期记忆（笔记 / 记忆）请使用 [`cortico-world-memory`](https://www.npmjs.com/package/cortico-world-memory) 的 `mem_note` / `mem_notes` / `mem_forget_note`（常驻环境提示词 + 混合检索）。本扩展**不再自带笔记本工具**（原 `qq_note` 与之功能重复，已在评审 #104 中移除），避免两套记忆入口互相打架。

本扩展与记忆插件数据互不相通、也没有任何耦合：本扩展不 import、不探测、不调用该插件（认证评审 #104 明确要求 World 之间不得直接调用）。

## 已知限制 / 与原版的差异

- 语音解码：QQ 语音多为 **SILK** 编码。`native` 供应商由 NapCat 服务端（如 NapCat 的 `translate_record`）解码最稳；`custom`/`local` 供应商走 OpenAI 兼容接口，一般要求 wav/mp3/flac，对 SILK 支持不稳。若识别不了 SILK，可把 `asr.mode` 设为 `local`（本地 FunASR 自带 SILK 解码），需本机有 ffmpeg（见 `asr.ffmpegPath`）。本地/远程服务不可达或超时（`asr.transcribeTimeout` 控制）时不阻塞对话，回退文字。
- 合并转发展开、视频/文件等大二进制默认只做文本占位（不自动作为附件，避免撑爆上下文）。展开后的 `qq.forward` 事件头会标注「转发来源：群「<群名>(<号>)」/ 私聊「<昵称>(<QQ>)」/ 多个来源」，帮助模型判断语境；来源恰好就是收到转发的当前会话时不重复标注（从每个转发节点捕获 `group_id`/对方 QQ，由 SnowLuma `get_forward_msg` 返回）。
- **合并转发消息（不伪造身份）**：`qq_forward_by_id` 工具可按消息编号把本 bot 已接收/发出的多条消息合成**一张**合并转发卡片发出（卡片由本 bot 发出，node 身份只能是 bot 自己；卡片内每条消息用文本标注原始发送者昵称+QQ号并保留原文内容，不伪造任何身份）。需先开启设置 `worlds.qqbot.forwardByMessageId`（默认关闭），且仅能转发本 bot 本地记录内、属于目标会话的消息编号；依赖 OneBot 的 `send_forward_msg` 与 `get_msg`（NapCat/Lagrange/SnowLuma 等主流 OneBot v11 实现大多支持）。受 OneBot 限制，合并卡片无法把 node 身份设成原始发送者，故用「文本标注来源」保留出处。
- 群成员名片为空时尝试补一次 `get_group_member_info`，但离线名片仍以 NapCat 推送为准。
- 引用回复走实时 `get_msg`（与 fat-fish 一致），需要 NapCat 暴露该 API；引用库外消息也能正确拉取。
- 表情包图片通过 `[表情包:文件名]` 发送，文件需放在 `emojiDir` 配置目录（默认 `<扩展>/emoji`）。文件名会先精确匹配；漏写或写错 `.gif`/`.png`/`.jpg`/`.jpeg`/`.webp` 扩展名时会自动尝试修正，仍找不到则该标记被丢弃，不报错。
- 中文表情名（如 `[旺柴]`/`[笑哭]`）按 fat-fish 的 `FACE_MAP` 映射到 face id；未知方括号文本原样保留。
- 系统表情标记 `[表情22：白眼]` / `[表情22:白眼]`（数字为 QQ face id，支持全角/半角冒号与可选空格）会被解析成真正的 `face` 段发送。早期版本只认半角冒号，bot 照着入站的全角冒号写法输出时会变成"不存在的表情"文本，已于 0.1.8 修复。
- 辅助视觉默认关闭。开启需自备一个 OpenAI 兼容 VLM 服务：在配置里填好 `vision.endpoint` / `vision.apiKeySecret` / `vision.model` 三项（密钥值放部署密钥库）。注意这与默认开启的「图片作为模型附件」是**两条看图的路**，同时开会重复花钱——主模型本身能看图时，关掉辅助视觉即可。
- QQ 空间功能依赖 NapCat/SnowLuma 的 `send_qzone_msg` / `delete_qzone_msg` / `get_qzone_feeds` / `comment_qzone`；部分协议端版本未暴露空间 API，开启后调用会失败（可在控制台看错误）。
- 回评 action 名（NapCat/SnowLuma 为 `comment_qzone`，留 `auto` 即用内置默认）按版本不同可能变化，失败请在控制台改 `qzone.commentAction`。
- `qq_qzone（action=feeds）` 返回好友动态正文（不含评论）；用 `action=detail`（`tid`+`uin`）拉取单条动态的全部评论——走 SnowLuma 的 `get_qzone_msg_detail`（用户实测可用；NapCat 不一定提供该接口，失败时 detail 会返回 error 提示）。feed 句柄字段在协议端叫 `key`，本扩展已映射为工具里的 `tid`。
- 动态/评论文案由主模型（部署的 provider）生成，无独立配置项；开启自动动态/自动评论只需在控制台打开对应开关（需重启生效），由后台 tick / 评论事件触发主模型经本工具发布。
