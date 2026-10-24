import type { ConfigGroup } from 'cortico/core/types.ts';
import type { WorldSection } from 'cortico/world.ts';
import type { QZoneConfig } from './qzone.ts';
import type { RoutineConfig } from './proactive.ts';
import { voiceProviderIds } from './voice.ts';

/** fat-fish qq_bot 的关键参数 + Cortico 内置 world 的可选项，统一为一份配置。 */


/** 语音识别（ASR）共享配置：语音收发（收语音）用同一套 ASR，避免重复配置。
 *  实现由 asrLocalEngine 决定（侧车 asr_sidecar.py 的 load_engine 分支），类型开放为 string，新增引擎无需改类型。
 *  默认 local + funasr（SenseVoiceSmall，中文更准，自动从 ModelScope 下载），后续可切 228MB 的 sherpa-onnx 版。 */
export interface QQAsrConfig {
  /** ASR 模式：off=关闭（仅 TTS 播报/单向，听不到对方）；local=本扩展自动拉起的本地侧车（默认 funasr）；cloud=远程 OpenAI 兼容端点。 */
  mode: 'off' | 'cloud' | 'local';
  /** 本地 ASR 引擎：funasr（默认，SenseVoiceSmall，自动从 ModelScope 下载）；sherpaOnnx（228MB int8，省内存更快，后续接入）。
   *  类型开放为 string，新增引擎（vosk/fasterWhisper 等）只需在侧车 load_engine 加分支，无需改此处类型。 */
  localEngine: string;
  /** 本地模型/权重目录绝对路径：留空则运行时自动下载/缓存（funasr 自动从 ModelScope 拉 iic/SenseVoiceSmall）。
   *  vosk/fasterWhisper 等需本地目录的引擎必须填。 */
  localModelPath: string;
  /** 本地侧车 python 依赖所在 venv 目录绝对路径；空=自动探测 <扩展>/venv_vox。 */
  localVenv: string;
  /** 本地侧车监听端口。 */
  localPort: number;
  /** 云端 ASR 端点基址（POST {url}/asr 或 {url}/audio/transcriptions 收音频→{text}）。 */
  cloudUrl: string;
  /** 云端 ASR 的 API Key 环境变量名；留空=不带鉴权头（本地/免密服务）。 */
  cloudApiKeySecret: string;
  /** 云端 ASR 模型名（OpenAI 兼容 /audio/transcriptions 用，如 whisper-1 / glm-asr-2512）。 */
  cloudModel: string;
  /** ffmpeg 可执行文件路径（把 QQ 原生 SILK/AMR 解码成 WAV 送识别）；空=依次找 PATH 与仓库 ffmpeg-static。 */
  ffmpegPath: string;
  /** 识别单次超时（毫秒，默认 60000）：解码与 /asr 请求共用。 */
  transcribeTimeout: number;
}

export interface QQWorldConfig {
  /** 连接模式：reverse=Cortico 开 WS 服务端等 NapCat 连（fat-fish 风格）；forward=Cortico 连 NapCat 的 wsUrl（内置风格）。 */
  mode: 'reverse' | 'forward';
  /** forward 模式：NapCat 暴露的 WebSocket 地址。 */
  wsUrl: string;
  /** reverse 模式：Cortico 在哪个 host/port/path 监听 NapCat 反向连接。 */
  wsHost: string;
  wsPort: number;
  wsPath: string;
  /** NapCat 接入 Token（OneBot access_token），二选一生效。 */
  token: string;
  /** 监听中的群（fat-fish 的 GROUP_WHITELIST / 内置的 activeGroupIds）；控制台以空格/逗号分隔字符串编辑。 */
  groups: string | number[];
  /** 监听中的私聊对方 QQ（activePrivatePeers）；同上，字符串或数组皆可。 */
  privates: string | number[];
  /** 私聊聚合窗口（ms），fat-fish PRIVATE_AGGREGATION_WINDOW。 */
  privateAggregationWindow: number;
  /** 连续消息最大间隔（ms），超出视为新主题（fat-fish MAX_SEQUENCE_GAP）。 */
  maxSequenceGap: number;
  /** 引用回看窗口（秒），fat-fish REPLY_MAX_GAP_SEC。 */
  replyMaxGapSec: number;
  /** 长文本按此字节数强制分句（fat-fish IMAGE_URL_MAX_CHARS 思路复用）。 */
  maxMessageBytes: number;
  /** 合并转发消息最多展开条数。 */
  forwardExpandLimit: number;
  /** 是否允许「按消息 id 合并转发」：把本 bot 已接收/已发出的多条消息，用 send_forward_msg 合成一张合并转发卡片发出（卡片身份是 bot 自己，卡片内每条用文本标注原始发送者并保留原文，不伪造）。依赖 OneBot 的 send_forward_msg 与 get_msg。 */
  forwardByMessageId: boolean;
  /** 本地表情包图片目录（相对扩展或绝对路径），供发送 `[表情包:文件名]` 标记使用。 */
  emojiDir: string;
  /** 是否把图片作为附件交给模型（需要模型支持图像）。 */
  deliverImageAttachments: boolean;
  /** 发送时按句拆分多条（fat-fish SPLIT_REPLY_BY_SENTENCE）。 */
  splitReplyBySentence: boolean;
  /** 每条消息最多容纳句数（fat-fish SENTENCES_PER_MESSAGE）。 */
  sentencesPerMessage: number;
  /** 逐条发送之间的间隔毫秒（fat-fish SEND_INTERVAL_SECONDS），0 表示不限速。 */
  sendIntervalMs: number;
  /** 被动视觉：自动用 VLM 描述图片（off 则不调用外部 API，仅留占位）。 */
  vision: {
    enabled: boolean;
    endpoint: string;
    apiKeySecret: string;
    model: string;
    maxConcurrent: number;
    maxBytes: number;
    timeoutMs: number;
  };
  /** 表情包自动收藏：下载 + 情感/用处标注 + 内容去重。 */
  sticker: {
    /** 是否自动收藏表情包。 */
    enabled: boolean;
    /** 采集范围：sticker=仅 OneBot sticker/image.subType=sticker；allImages=所有图片都当表情候选。 */
    captureMode: 'sticker' | 'allImages';
    /** 表情包落盘目录（相对扩展或绝对），空则复用 emojiDir。 */
    dir: string;
    /** 是否在收藏表情包的同时把它加入 QQ 的「收藏表情」（custom face）。需协议端支持 add_custom_face（如 SnowLuma）；不支持时自动降级（仍存盘，但不进 QQ）。开启后 bot 收藏的表情会直接出现在你 QQ 客户端里。 */
    addToQQFavorites: boolean;
  };
  /** 主动说话调度器：后台按状态机向监听会话主动冒泡闲聊（事件驱动：只推 nudge，由主模型生成发送，不再用第二模型）。 */
  proactive: {
    enabled: boolean;
    mode: 'private' | 'group' | 'both';
    tickSec: number;
    warmupMin: number;
    stableChancePerTick: number;
    warmupChance: number;
    privateCooldownSec: number;
    groupCooldownSec: number;
    unrepliedThreshold: number;
    silentHours: number;
    dailyQuota: number;
    dedupWindow: number;
    /** 主动说话是否带对象昵称/称呼；关闭后不称呼对方具体名字，直接用「你」。默认 true。 */
    withNickname: boolean;
  };
  /** QQ 空间（动态/说说）：按对话与记忆发表自己的看法/吐槽/简介，可附图与@，支持删除与评论回复。 */
  qzone: QZoneConfig;
  /** 群聊发言频率限制：限制每个群在单位时间窗口内被 bot 主动+回复发出的消息总量，防止刷屏。 */
  groupSpeak: {
    /** 是否启用群聊发言频率限制。 */
    enabled: boolean;
    /** 滑动窗口内允许发出的最大消息条数。 */
    maxPerWindow: number;
    /** 滑动窗口长度（秒）。 */
    windowSec: number;
  };
  /** 话题自动结束 / 防死循环：统计单会话内 bot 连续发言次数，超过阈值或对方长时间未接话则自动收尾。 */
  antiLoop: {
    /** 是否启用防死循环。 */
    enabled: boolean;
    /** 单会话内 bot 连续发言上限（对方发来任意消息即清零），超过则本次发言被拦截并提示收尾。 */
    maxConsecutiveBotTurns: number;
    /** 对方静默超过该秒数且 bot 已发过言，则自动收尾（0=关闭该规则）。 */
    idleToEndSec: number;
  };
  /** 时区，用于时间戳与 env 提示。 */
  timezone: string;
  /** 作息功能：按真实时间切换「睡眠/午休/活跃」状态，睡眠段暂停主动冒泡并到点播报。 */
  routine: RoutineConfig;
  /** 闹钟 / 记事本：记录需要定时做的事或约定，到点自动提醒。 */
  reminder: {
    /** 是否启用“到点自动发提醒”。记录 / 查询 / 取消不受此开关影响（始终可用）。 */
    enabled: boolean;
    /** 按配置时区的自然日、所有 QQ 会话合计的到点处理上限。 */
    dailyQuota: number;
    /** 超额时直接发文字，不调用模型；{limit} 替换为当前上限。 */
    limitMessage: string;
  };
  /** 自称（第一人称昵称）：用于主动说话调度器与作息状态文本。
   *  - 留空（默认）：回退到登录 QQ 昵称，再不行回退「我」。
   *  - 填了：强制用这个值（如「小鱼」），换称呼零改码。 */
  selfName: string;
  /** 语音收发：发语音(TTS)+收语音(ASR)。ASR 统一走顶层 asr.* 配置（共享识别引擎，默认 funasr），
   *  此处只管 TTS 与供应商选择；实现由 voice.ts 注册表供应商决定（当前内置 native/custom/local/voxcpm，可扩展）。 */
  voice: {
    /** 总开关。 */
    enabled: boolean;
    /** 实现方式（语音供应商 id）：当前内置 native=OneBot 原生 tts(零依赖)；custom=远程 OpenAI 兼容 TTS（填语音模型网址+API Key）；local=本地/自建 TTS（免 Key）；voxcpm=本地 VoxCPM2 TTS 服务。可在 voice.ts 注册更多供应商。ASR 不在本处配置（见顶层 asr）。 */
    provider: string;
    /** 收：把用户语音转成文字进入对话（走顶层 asr.* 引擎）。 */
    asr: boolean;
    /** 发：用语音回复（受 semanticJudge 控制是否触发）。 */
    tts: boolean;
    /** 语义判定：通过 LLM 判断本次回复是否应当说语音（对齐 qq_bot _judge_voice）。 */
    semanticJudge: boolean;
    /** ASR 失败且无文字时的回退：把音频作为 blob 丢给多模态模型听（需模型支持 audio/wav）。 */
    audioFallback: boolean;
    /** 语义判定所用 chat 端点（OpenAI 兼容）。 */
    judgeEndpoint: string;
    /** 端点密钥的环境变量名。 */
    judgeApiKeySecret: string;
    /** 判定模型。 */
    judgeModel: string;
    /** 自定义(custom/local)语音供应商的 OpenAI 兼容音频端点基址（仅 TTS 用）；选 custom/local 供应商时必填。 */
    voiceBaseUrl: string;
    /** 自定义语音供应商 API Key 的环境变量名（控制台密钥库填写）。 */
    voiceApiKeySecret: string;
    /** 音色/声音名：仅当所选语音模型支持时填写（如 tongtong）；留空用默认音色。 */
    voiceVoice: string;
    /** 自定义供应商 TTS 模型名（/audio/speech 用，缺省 tts-1）。 */
    voiceTtsModel: string;
    /** TTS 请求超时（秒）：单次合成最长等待，本地推理慢可调大（默认 120）。custom 与 local 共用。ASR 超时见顶层 asr.transcribeTimeout。 */
    voiceTimeout: number;
    /** TTS 额外参数(JSON 字符串)：合并进 /audio/speech 请求体，用于本地模型的声音克隆/声音设计等高级特性（如 VoxCPM2 的 reference_audio / voice_design / language）。留空 {} 表示无。 */
    voiceExtraTts: string;
    /** VoxCPM 本地 TTS 服务基址（provider 选 voxcpm 时必填），如 http://127.0.0.1:8765。 */
    voxcpmUrl: string;
    /** VoxCPM 音色描述（自然语言），如「温柔女声」。 */
    voxcpmVoiceDesc: string;
    /** VoxCPM 语速（0.5~2），默认 1.0。 */
    voxcpmSpeed: number;
    /** VoxCPM 推理步数（越小越快越夸张），默认 10。 */
    voxcpmTimesteps: number;
    /** VoxCPM 随机种子（0=随机，>0 固定可复现）。 */
    voxcpmSeed: number;
  };
  /** 语音识别（ASR）共享配置：语音收发（收语音）用同一套 ASR，避免重复配置。
   *  默认 local + funasr（SenseVoiceSmall，中文更准，自动从 ModelScope 下载）；后续可切 228MB 的 sherpa-onnx 版（更省内存）。 */
  asr: QQAsrConfig;
  /** 群管理员能力：群撤回 / @全体成员 / 发群通知 / 审核进群 / 给予群头衔 / 禁言（及全员禁言）/ 踢出群聊。
   *  需要 bot 账号是对应群的管理员或群主，否则 QQ 会拒绝操作。qq_admin 工具始终可用（用一个 action 选子功能），此开关决定是否生效。 */
  admin: {
    /** 是否启用群管理员能力。关闭则qq_admin 工具返回“功能未开启”，不执行任何操作。 */
    enabled: boolean;
    /** 发群通知（公告）使用的 OneBot action 名。不同 NapCat 版本可能为 send_group_notice 或 _send_group_notice。 */
    noticeAction: string;
    /**
     * 授权指挥官白名单：允许通过对话命令 bot 执行管理员操作的 QQ 号数组。
     * 在名单内的人，无论群内身份，都能命令 bot 撤消息/禁言等。空数组表示不单独授权任何人。
     */
    allowlist: string[];
    /**
     * 是否允许群内管理员/群主通过对话命令 bot 执行管理员操作。
     * 默认 true：群管/群主在群里发话即可指挥 bot。设为 false 则只有 allowlist 里的人能指挥。
     */
    allowGroupAdmins: boolean;
    /**
     * 仅群主可指挥：为 true 时，即便 allowGroupAdmins 开启，也只有群主（外加 allowlist）能命令 bot，
     * 普通管理员不行。默认 false（群主+管理员均可）。
     */
    ownerOnly: boolean;
    /**
     * 保护群主：禁止任何人（含管理员）用 bot 撤回/禁言群主。默认 true。
     */
    protectOwner: boolean;
    /**
     * 保护管理员：只有群主能用 bot 撤回/禁言另一名管理员。默认 true。
     */
    protectAdmins: boolean;
    /**
     * 允许 bot 自行处理加群请求（通过/拒绝），而无需某个人在对话里指挥。默认 true。
     * 设为 false 则 qq_admin（action=join_approve/reject） 返回“未开启自动审核”。
     */
    allowJoin: boolean;
    /**
     * 允许 AI（bot 自身）主动执行管理操作：当 bot 自行判断需要撤消息/禁言/发公告等时，
     * 无需某个人下令即可执行。默认 true。设为 false 则仅「授权指挥官」（白名单/群管/群主）能触发，
     * 普通成员无法让 bot 行动，但 bot 自身也不会在有人刚发言的会话里自主行动。
     */
    allowSelf: boolean;
    /**
     * 允许 AI（bot 自身）自主踢人：踢人比禁言更重且不可逆，默认 false，
     * 即只有「授权指挥官」（白名单/群管/群主）明确下令才能踢。设为 true 则 bot 可自行判断踢人。
     */
    allowSelfKick: boolean;
    /**
     * 踢人时是否同时拒绝对方再次加群（OneBot reject_add_request）。默认 true。
     * 说明：这不等于拉黑名单，只是让本次踢出附带「拒绝加群」；对方仍可能通过其他方式进群。
     */
    kickRejectRejoin: boolean;
  };
  /**
   * 允许 AI 在群里判断话题涉及隐私/尴尬/敏感时，把回复改为私聊发送给当事人（而非群里公开）。
   * 开启后，qq_send 对 private:<QQ> 目标跳过私聊监听名单限制，可向任意群成员发起私聊分流。默认 true。
   */
  allowPrivateRedirect?: boolean;
  /** 允许 QQ 来源使用电脑控制、文件等本地工具；默认关闭。 */
  allowLocalOperations: boolean;
  /** 本机界面启动 NapCat 使用的固定 EXE 路径，不提供给模型工具。 */
  napcatLauncher: string;
}


export const QQ_DEFAULTS: QQWorldConfig = {
  mode: 'reverse',
  allowLocalOperations: false,
  napcatLauncher: '',
  // 默认关闭：qq_send 发 private:<QQ> 时一律查监听名单，群里任何人无法让 bot 私聊任意 QQ 号。
  // 仅当你确实需要 bot 主动私聊「非监听会话里的某个人」时再开（此时仍受监听/授权约束保护）。
  allowPrivateRedirect: false,
  wsUrl: 'ws://127.0.0.1:3001',
  // 反向监听默认只绑回环：绑 0.0.0.0 会让同网段任何机器都能连进来，
  // 拿到 bot 要发的消息、伪造事件，甚至借群管鉴权接口越权。要对外监听请显式改这一项。
  wsHost: '127.0.0.1',
  wsPort: 8080,
  wsPath: '/onebot/v11/ws',
  // 反向模式下留空会自动生成并持久化一个随机 token（见 world.ts 的 ensureReverseToken），
  // 不会退化成「无鉴权监听」。正向连接留空表示不校验。
  token: '',
  groups: [],
  privates: [],
  privateAggregationWindow: 0,
  maxSequenceGap: 8000,
  replyMaxGapSec: 600,
  maxMessageBytes: 1500,
  forwardExpandLimit: 20,
  forwardByMessageId: false,
  emojiDir: 'emoji',
  deliverImageAttachments: true,
  splitReplyBySentence: true,
  sentencesPerMessage: 1,
  sendIntervalMs: 600,
  vision: {
    enabled: false,
    // 开启辅助视觉后这三项必填：密钥只写名字，值放密钥库（部署 .env），由框架 secret() 读。
    // 主模型本身能看图时不必开本功能——图片已作为附件直达主模型。
    endpoint: '',
    apiKeySecret: '',
    model: '',
    maxConcurrent: 3,
    maxBytes: 8_000_000,
    timeoutMs: 30000,
  },
  sticker: {
    enabled: true,
    captureMode: 'sticker',
    dir: '',
    addToQQFavorites: false,
  },
  proactive: {
    enabled: false,
    mode: 'private',
    tickSec: 45,
    warmupMin: 2,
    stableChancePerTick: 0.2,
    warmupChance: 0.7,
    privateCooldownSec: 120,
    groupCooldownSec: 20,
    unrepliedThreshold: 3,
    silentHours: 6,
    dailyQuota: 20,
    dedupWindow: 12,
    withNickname: true,
  },
  qzone: {
    enabled: false,
    tickSec: 900,
    chancePerTick: 0.15,
    dailyQuota: 5,
    permission: 1,
    imageMode: 'none',
    autoReplyComments: {
      enabled: false,
      dailyQuota: 20,
      cooldownSec: 30,
    },
    commentAction: 'auto',
  },
  groupSpeak: {
    enabled: true,
    maxPerWindow: 12,
    windowSec: 60,
  },
  antiLoop: {
    enabled: true,
    maxConsecutiveBotTurns: 5,
    idleToEndSec: 300,
  },
  timezone: 'Asia/Shanghai',
  routine: {
    enabled: false,
    sleepStart: '23:00',
    sleepEnd: '07:30',
    lazyStart: '12:00',
    lazyEnd: '14:00',
    greetSleep: '时间不早啦，我先去睡一会儿，你们也别熬太狠~有事留言，我醒了回。',
    greetWake: '早呀，我醒啦，今天也要好好摸鱼。',
    greetLazy: '中午啦，我去扒口饭眯一眯，有事儿留言~',
  },
  reminder: {
    enabled: true,
    dailyQuota: 5,
    limitMessage: '今天的提醒次数已达上限（每天最多 {limit} 次，各群和私聊合计），这条提醒不再发送。',
  },
  selfName: '',
  voice: {
    enabled: false,
    provider: 'native',
    asr: true,
    tts: true,
    semanticJudge: true,
    audioFallback: true,
    // 默认留空：不跟随主模型密钥。用户必须显式填好 judgeEndpoint + 对应的 judgeApiKeySecret（在密钥里配置好名字）
    // 才启用语音语义判定；否则语音只做 ASR，不做「是否想说话」的语义判断。
    judgeEndpoint: '',
    judgeApiKeySecret: '',
    judgeModel: 'deepseek-chat',
    voiceBaseUrl: '',
    voiceApiKeySecret: 'VOICE_API_KEY',
    voiceVoice: '',
    voiceTtsModel: 'tts-1',
    voiceTimeout: 120,
    voiceExtraTts: '{}',
    voxcpmUrl: 'http://127.0.0.1:8765',
    voxcpmVoiceDesc: '一个可爱的二次元萌妹，声音娇俏甜美软糯，语速轻快活泼，带点撒娇黏人的语气，像游戏里的吉祥物少女',
    voxcpmSpeed: 1.0,
    voxcpmTimesteps: 10,
    voxcpmSeed: 0,
  },
  // 语音识别（ASR）共享配置：语音收发（收语音）用同一套 ASR。默认 local + funasr。
  asr: {
    mode: 'local',
    localEngine: 'funasr',
    localModelPath: '',
    localVenv: '',
    localPort: 8778,
    cloudUrl: '',
    cloudApiKeySecret: 'ASR_API_KEY',
    cloudModel: 'glm-asr-2512',
    ffmpegPath: '',
    transcribeTimeout: 60000,
  },
  admin: {
    enabled: false,
    noticeAction: 'send_group_notice',
    allowlist: [],
    allowGroupAdmins: true,
    ownerOnly: false,
    protectOwner: true,
    protectAdmins: true,
    allowJoin: true,
    allowSelf: true,
    allowSelfKick: false,
    kickRejectRejoin: true,
  },
};

// 本扩展真正用到的密钥：反向 WS 鉴权 token（QQ_ACCESS_TOKEN）与语音服务密钥（VOICE_API_KEY）。
// 原先的 OPENROUTER_API_KEY / DEEPSEEK_API_KEY 已随第二模型移除而无处使用，删除。
export const QQ_SECRETS = ['QQ_ACCESS_TOKEN', 'VOICE_API_KEY'];

/** worlds.qq 配置段：业务参数 + 必需的 enabled 开关。 */
export type QQConfigSection = QQWorldConfig & WorldSection;

export function qqDefaults(): QQConfigSection {
  return { ...QQ_DEFAULTS, enabled: false };
}

/** 控制台可编辑的连接/监听配置组（JSON Schema 形态）。 */
export const QQ_CONFIG_GROUP: ConfigGroup = {
  id: 'world:qqbot',
  owner: 'world:qqbot',
  schema: {
    type: 'object',
    title: 'QQ · 连接与监听',
    description: 'OneBot v11 / NapCat 连接参数与监听名单；连接类改动需重启生效。',
    properties: {
      'worlds.qqbot.napcatLauncher': {
        type: 'string', title: 'NapCat 启动器路径', 'x-hot': true,
        description: '填写本机 NapCatWinBootMain.exe 的完整路径，供上方启动按钮使用。只从本机界面启动，不接受聊天命令。',
      },
      'worlds.qqbot.allowLocalOperations': {
        type: 'boolean',
        title: '允许 QQ 消息调用本地操作',
        'x-hot': true,
        description: '需配套宿主权限保护补丁，仅更新插件不能阻止本地工具。默认关闭：QQ 消息、提醒和主动事件只能使用 QQ 工具，禁止截图、键鼠、窗口操作、本地设置及通用文件工具；保留聊天、历史查询和已有共享上下文。本机直接输入的请求可正常使用本地工具。同一轮混入 QQ 事件时仍限制本地操作。开启后监听到的 QQ 消息可使用本地能力，仍遵循桌面助手原有的授权规则。',
      },
      'worlds.qqbot.mode': {
        type: 'string',
        title: '连接模式',
        enum: ['reverse', 'forward'],
        'x-hot': false,
        description: 'reverse=Cortico 开 WS 服务端等 NapCat 反向连（fat-fish 风格）；forward=Cortico 主动连 NapCat 的 wsUrl。',
      },
      'worlds.qqbot.timezone': {
        type: 'string',
        title: '时区',
        'x-options': 'qq-timezone',
        'x-hot': true,
        description: '注入到提示词「现在时间」与事件时间戳的时区（按 UTC 偏移标注，默认中国 UTC+8）。改完即时生效，无需重启。',
      },
      'worlds.qqbot.wsUrl': { type: 'string', title: '正向 WS 地址', 'x-hot': false, description: '仅当连接模式为 forward（正向）时使用：桌宠主动去连协议端，填协议端「设置正向服务器」里给的地址（默认 ws://127.0.0.1:3001）。' },
      'worlds.qqbot.wsHost': { type: 'string', title: '反向监听地址', 'x-hot': false, description: '默认 127.0.0.1，只允许本机接入。改成 0.0.0.0 会让同网段任何机器都能连上并伪造事件——若确需对外监听，必须同时设置下面的 OneBot Token，否则桌宠会拒绝启动。' },
      'worlds.qqbot.wsPort': { type: 'integer', title: '反向监听端口', minimum: 1, maximum: 65535, 'x-hot': false, description: '需与协议端「设置反向客户端」里填的端口一致（出厂默认 8080）。' },
      'worlds.qqbot.wsPath': { type: 'string', title: '反向监听路径', 'x-hot': false, description: '需与协议端「设置反向客户端」里填的路径一致，默认 /onebot/v11/ws。注意结尾的 /ws 不能少。' },
      'worlds.qqbot.token': { type: 'string', title: 'OneBot Token', 'x-hot': false, description: '【反向连接必填】桌宠启动时会自动生成一串随机 Token 并保存到 dataDir/reverse-token.txt（跨重启不变），就显示在下方输入框里。把它整串复制到协议端「设置反向客户端」的鉴权 Token，然后在协议端点「保存连接」，即可连上。仅当连接模式为 forward（正向）时，才改填协议端「设置正向服务器」里那个 Token。' },
      'worlds.qqbot.groups': { type: 'string', title: '监听群', 'x-hot': true, description: '监听的群号，用空格或逗号分隔；空=全部群。改完即时生效，不用重启。' },
      'worlds.qqbot.privates': { type: 'string', title: '监听私聊', 'x-hot': true, description: '监听的私聊对方 QQ 号，用空格或逗号分隔。改完即时生效，不用重启。' },
      'worlds.qqbot.deliverImageAttachments': { type: 'boolean', title: '图片作为模型附件', 'x-hot': true, description: '开启时把收到的图片直接作为附件喂给主模型（主模型需支持看图）。这是默认的看图路径；「辅助视觉」是另一条用独立 VLM 描述图片的路，两条同时开会重复花钱，主模型能看图时就留着这个、关掉辅助视觉。' },
      'worlds.qqbot.emojiDir': { type: 'string', title: '表情包目录', 'x-hot': false, description: '本地表情包图片目录（相对扩展或绝对路径），供发送 [表情包:文件名] 标记。' },
      'worlds.qqbot.splitReplyBySentence': { type: 'boolean', title: '按句拆分发送', 'x-hot': true, description: '开启后回复按句标拆成多条消息（对齐 fat-fish）。' },
      'worlds.qqbot.forwardByMessageId': { type: 'boolean', title: '允许按消息 id 合并转发', 'x-hot': false, description: '开启后可使用 qq_forward_by_id 工具：把本 bot 已接收或已发出的多条消息，用 send_forward_msg 合成「一张合并转发卡片」发出（卡片由本 bot 发出，node 身份只能是 bot 自己；卡片内每条消息用文本标注原始发送者昵称+QQ号并保留原文内容，不伪造任何身份）。需要协议端支持 send_forward_msg 与 get_msg（NapCat/Lagrange/SnowLuma 等 OneBot v11 实现大多支持）。只能转发本 bot 见过的消息（message id 必须在本地记录内），无法转发从未见过的消息。' },
      'worlds.qqbot.sentencesPerMessage': { type: 'integer', title: '每条句数', minimum: 1, maximum: 10, 'x-hot': true },
      'worlds.qqbot.sendIntervalMs': { type: 'integer', title: '发送间隔(ms)', minimum: 0, maximum: 5000, 'x-hot': true, description: '逐条发送之间的间隔，0 表示不限速。' },
      'worlds.qqbot.vision.enabled': { type: 'boolean', title: '开启辅助视觉', 'x-hot': false, description: '用另一个 VLM 描述图片。主模型本身能看图时不必开（图片已作为附件直达主模型，见「图片作为模型附件」）；仅当主模型不支持图片、或想用专门的视觉模型时才开。' },
            'worlds.qqbot.vision.endpoint': { type: 'string', title: '辅助视觉·模型地址', 'x-hot': false, description: 'VLM 的 OpenAI 兼容地址（如 https://api.deepseek.com/v1）。开启辅助视觉后必填。' },
      'worlds.qqbot.vision.apiKeySecret': { type: 'string', title: '辅助视觉·密钥名', 'x-hot': false, description: '密钥在密钥库（部署 .env）里的名字，如 DEEPSEEK_API_KEY；值由框架 secret() 读取，不写在本插件里。开启辅助视觉后必填。' },
'worlds.qqbot.vision.model': { type: 'string', title: 'VLM 模型', 'x-hot': false, description: '描述图片用的视觉模型名。开启辅助视觉后必填。' },
      'worlds.qqbot.sticker.enabled': { type: 'boolean', title: '自动收藏表情包', 'x-hot': false, description: '开启后自动下载消息里的表情包并标注情感/用处、内容去重。' },
      'worlds.qqbot.sticker.captureMode': {
        type: 'string',
        title: '采集范围',
        enum: ['sticker', 'allImages'],
        'x-hot': false,
        description: 'sticker=仅 OneBot 表情包段；allImages=所有图片都当表情候选收藏。',
      },
      'worlds.qqbot.sticker.addToQQFavorites': { type: 'boolean', title: '同步到 QQ 收藏表情', 'x-hot': true, description: '开启后，bot 每收藏一张表情包都会同时加入登录账号的 QQ「收藏表情」（custom face），你能在 QQ 客户端里直接看到/使用。依赖协议端支持 add_custom_face（如 SnowLuma）；不支持时自动降级（仍存盘，但不进 QQ）。注意 QQ 收藏表情有数量上限，超出会失败（可用 qq_sticker_to_favorites 的结果看到哪些没加进去）。' },
      'worlds.qqbot.proactive.enabled': { type: 'boolean', title: '主动说话调度器', 'x-hot': false, description: '开启后后台按状态机向监听会话主动冒泡闲聊（移植自 fat-fish ProactiveSpeaker）。' },
      'worlds.qqbot.proactive.mode': {
        type: 'string',
        title: '主动范围',
        enum: ['private', 'group', 'both'],
        'x-hot': true,
        description: 'private=仅私聊；group=仅群；both=都主动。',
      },
      'worlds.qqbot.proactive.dailyQuota': { type: 'integer', title: '每日上限', minimum: 0, maximum: 200, 'x-hot': true, description: '每日主动消息条数上限（0=不限）。' },
      'worlds.qqbot.qzone.enabled': { type: 'boolean', title: 'QQ空间动态', 'x-hot': false, description: '开启后可在 QQ 空间发动态、自动冒泡、回复评论。需重启生效。' },
      'worlds.qqbot.qzone.dailyQuota': { type: 'integer', title: '每日自动动态上限', minimum: 0, maximum: 50, 'x-hot': true, description: '后台自动发动态的每日条数上限（0=不限）。' },
      'worlds.qqbot.qzone.permission': { type: 'integer', title: '动态可见权限', minimum: 1, maximum: 128, 'x-hot': true, description: 'ugc_right：1=公开（默认）/4=好友/16=指定人/64=仅自己/128=黑名单（值随 NapCat/SnowLuma 版本）。' },
      'worlds.qqbot.qzone.imageMode': { type: 'string', title: '自动附图', enum: ['none', 'recent'], 'x-hot': true, description: 'none=不附图；recent=自动附上最近一条 QQ 图片。' },
      'worlds.qqbot.qzone.autoReplyComments.enabled': { type: 'boolean', title: '自动回复空间评论', 'x-hot': false, description: '收到空间评论时自动生成并回复。需重启生效。' },
      'worlds.qqbot.qzone.commentAction': { type: 'string', title: '评论回复 action', 'x-hot': true, description: '回复评论用的 OneBot action（NapCat/SnowLuma 为 `comment_qzone`；不同版本可能不同，留 `auto` 即用内置默认值）。' },
      'worlds.qqbot.proactive.withNickname': { type: 'boolean', title: '主动说话带昵称/称呼', 'x-hot': true, description: '开启时主动消息会称呼对方昵称；关闭后不称呼对方具体名字，直接用「你」即可。改完即时生效。' },
      'worlds.qqbot.groupSpeak.enabled': { type: 'boolean', title: '群聊发言限速', 'x-hot': true, description: '开启后限制每个群在单位窗口内被 bot 发出的消息总量，防止刷屏/死循环灌水。' },
      'worlds.qqbot.groupSpeak.maxPerWindow': { type: 'integer', title: '窗口内最大条数', minimum: 1, maximum: 200, 'x-hot': true, description: '滑动窗口内允许发出的群消息上限（含主动与回复）。' },
      'worlds.qqbot.groupSpeak.windowSec': { type: 'integer', title: '窗口长度(秒)', minimum: 1, maximum: 3600, 'x-hot': true, description: '限速滑动窗口长度。' },
      'worlds.qqbot.antiLoop.enabled': { type: 'boolean', title: '话题自动结束', 'x-hot': true, description: '开启后统计单会话 bot 连续发言次数与对方静默时长，超限自动收尾，避免话题死循环。' },
      'worlds.qqbot.antiLoop.maxConsecutiveBotTurns': { type: 'integer', title: '连续发言上限', minimum: 1, maximum: 50, 'x-hot': true, description: '单会话内 bot 连续发言达到该次数（对方发消息即清零），下次发言被拦截并提示收尾。' },
      'worlds.qqbot.antiLoop.idleToEndSec': { type: 'integer', title: '对方静默收尾(秒)', minimum: 0, maximum: 86400, 'x-hot': true, description: '对方静默超过该秒数且 bot 已发过言则自动收尾；0=关闭该规则。' },
      'worlds.qqbot.routine.enabled': { type: 'boolean', title: '作息功能', 'x-hot': true, description: '开启后按真实时间切换「睡眠/午休/活跃」状态：睡眠段暂停主动冒泡并到点播报，午休段仅在语气里体现。改完即时生效。' },
      'worlds.qqbot.routine.sleepStart': { type: 'string', title: '睡眠开始(HH:MM)', 'x-hot': true, description: '进入睡眠时段的时间（24h，可早于 sleepEnd 形成跨午夜，如 23:00）。睡眠段内不主动冒泡，但仍能被动回复。' },
      'worlds.qqbot.routine.sleepEnd': { type: 'string', title: '睡眠结束(HH:MM)', 'x-hot': true, description: '离开睡眠时段的时间（24h）。离开时主动说「醒来」播报文案。' },
      'worlds.qqbot.routine.lazyStart': { type: 'string', title: '午休开始(HH:MM)', 'x-hot': true, description: '进入午休/打盹时段的时间；仅作为状态注入，不影响主动冒泡是否发出。' },
      'worlds.qqbot.routine.lazyEnd': { type: 'string', title: '午休结束(HH:MM)', 'x-hot': true, description: '离开午休时段的时间。' },
      'worlds.qqbot.routine.greetSleep': { type: 'string', title: '去睡播报(兜底)', 'x-hot': true, description: '进入睡眠段的兜底文案：正常播报由 LLM 现场生成（每次说法不固定），仅当生成失败才回退到这句。空=无兜底直接跳过。' },
      'worlds.qqbot.routine.greetWake': { type: 'string', title: '醒来播报(兜底)', 'x-hot': true, description: '离开睡眠段的兜底文案：正常由 LLM 生成，失败才回退。空=无兜底。' },
      'worlds.qqbot.routine.greetLazy': { type: 'string', title: '午休播报(兜底)', 'x-hot': true, description: '进入午休段的兜底文案：正常由 LLM 生成，失败才回退。空=无兜底。' },
      'worlds.qqbot.reminder.enabled': { type: 'boolean', title: '到点提醒', 'x-hot': true, description: '开启后，记下的定时提醒会在到点时自动发到对应会话；记录/查询/取消不受此开关影响（始终可用）。' },
      'worlds.qqbot.reminder.dailyQuota': { type: 'integer', title: '每日提醒总次数上限', minimum: 1, 'x-hot': true, description: '默认每天 5 次，所有群和私聊共用；按上方配置时区每天零点重置，重启保留计数。限制到点处理次数，不限制设置数量。超额时直接发送固定提示，不调用 AI，也不把该提醒顺延到次日。最小为 1；要停用提醒请关闭“到点提醒”。' },
      'worlds.qqbot.reminder.limitMessage': { type: 'string', title: '提醒超限提示', 'x-hot': true, description: '超额提醒到点时由程序直接发送的普通文字，不调用模型或语音合成；{limit} 自动替换为当前上限。同一会话每天最多提示一次，避免刷屏。设置提醒和普通聊天仍按原流程使用 AI。' },
      'worlds.qqbot.admin.enabled': { type: 'boolean', title: '群管理员能力', 'x-hot': true, description: '开启后可在群里执行管理员操作：群撤回 / @全体成员 / 发群通知 / 审核进群 / 给予群头衔 / 禁言（及全员禁言）/ 踢出群聊。需要 bot 是群管理员或群主，否则 QQ 会拒绝。qq_admin 工具始终可用（action 选子功能：recall/at_all/notice/join_*/title/ban/ban_all/kick），关闭则提示“功能未开启”。' },
      'worlds.qqbot.admin.allowlist': { type: 'string', title: '授权指挥官(QQ号,逗号分隔)', 'x-hot': true, description: '白名单：这些 QQ 号的人可在对话里命令 bot 执行管理员操作（撤消息/禁言等），不受群身份限制。多个用逗号分隔，如 123456,654321。留空=不单独授权任何人。' },
      'worlds.qqbot.admin.allowGroupAdmins': { type: 'boolean', title: '允许群管/群主指挥', 'x-hot': true, description: '为 true 时，群里的管理员/群主在对话里发话即可指挥 bot 执行管理操作。设为 false 则只有白名单里的人能指挥。' },
      'worlds.qqbot.admin.ownerOnly': { type: 'boolean', title: '仅群主可指挥', 'x-hot': true, description: '为 true 时，即便“允许群管指挥”开启，也只有群主（外加白名单）能命令 bot，普通管理员不行。' },
      'worlds.qqbot.admin.protectOwner': { type: 'boolean', title: '保护群主(禁撤/禁言)', 'x-hot': true, description: '为 true 时，任何人（含管理员）都不能用 bot 撤回/禁言群主。' },
      'worlds.qqbot.admin.protectAdmins': { type: 'boolean', title: '保护管理员(仅群主可动)', 'x-hot': true, description: '为 true 时，只有群主能用 bot 撤回/禁言另一名管理员。' },
      'worlds.qqbot.admin.allowJoin': { type: 'boolean', title: 'bot自动审加群', 'x-hot': true, description: '为 true 时 bot 可自行通过/拒绝加群请求（qq_admin（action=join_*） 可用）；为 false 则这两个工具返回“未开启自动审核”。' },
      'worlds.qqbot.admin.allowSelf': { type: 'boolean', title: 'AI可自主管理', 'x-hot': true, description: '为 true 时，bot（AI 本人）可自行判断并执行管理操作（撤回/禁言/公告等），无需某个人下令。为 false 则仅“授权指挥官”（白名单/群管/群主）能触发，普通成员无法让 bot 行动，但 bot 也不会在有人刚发言的会话里自主管理。群主/管理员始终受 protectOwner/protectAdmins 保护。注意：踢人（qq_admin 的 action=kick）不受此项放行，由“AI可自主踢人”单独控制。' },
      'worlds.qqbot.admin.allowSelfKick': { type: 'boolean', title: 'AI可自主踢人', 'x-hot': true, description: '为 true 时，bot 可自行判断把成员踢出群（无需人下令）。默认 false：踢人不可逆，只认“授权指挥官”（白名单/群管理员/群主）在对话里明确下令，普通成员与 AI 自主都不行。群主/管理员仍受 protectOwner/protectAdmins 保护。' },
      'worlds.qqbot.admin.kickRejectRejoin': { type: 'boolean', title: '踢人时拒绝再加群', 'x-hot': true, description: '为 true（默认）时，踢出群聊的同时附带“拒绝该用户再次加群”。为 false 则只踢出，对方仍可重新申请（能否进来取决于审核设置）。' },
      'worlds.qqbot.allowPrivateRedirect': { type: 'boolean', title: '允许私聊分流', 'x-hot': true, description: '为 true 时，群里若话题涉及隐私 / 尴尬 / 敏感，bot 可把回复改为私聊发送给当事人（而非群里公开）：qq_send 对 private:<QQ> 目标会跳过监听名单限制，直接向该群成员私聊。默认关闭：为 false 时只能在群里回复，无法私聊分流（private 目标仍须先经监听名单）。' },
      'worlds.qqbot.selfName': { type: 'string', title: '自称(第一人称)', 'x-hot': true, description: '主动说话调度器与作息状态文本里使用的自称。留空=回退到登录 QQ 昵称、再回退「我」；填了则强制用此值，换称呼零改码。' },
  },
  },
  };

  /** 语音收发配置分组：收语音转文字、发语音，两种实现可切。路径/模型均不写死，由下方各字段或环境变量决定。 */
  export const QQ_VOICE_GROUP: ConfigGroup = {
  id: 'world:qqbot-voice',
  owner: 'world:qqbot',
  schema: {
  type: 'object',
  title: 'QQ · 语音收发',
  description: '发语音(TTS)+收语音(ASR)。ASR（识别引擎）已统一到「语音识别（ASR 共享）」配置组，此处只管 TTS 与供应商选择。「实现方式」下拉选择供应商：native=OneBot 原生 tts（零依赖，开箱即用）；custom=用「模型网址+API Key」对接远程 OpenAI 兼容音频 TTS 服务（GLM/OpenAI/自建等）；local=对接本地/自建 TTS 模型（OpenAI 兼容，免 API Key，慢推理可加超时，支持额外参数做声音克隆/设计，如 VoxCPM2 经 vLLM-Omni）；voxcpm=对接本地 VoxCPM2 TTS 服务（自有接口，如 Fat-Fish 的 vox_tts_server.py：GET /health + POST /tts 返回 48kHz WAV，免 API Key，音色用自然语言描述）。是否说语音由语义判定决定。改完需重启生效。',
  properties: {
  'worlds.qqbot.voice.enabled': { type: 'boolean', title: '启用语音', 'x-hot': true, description: '总开关：关闭则完全不处理语音（收按原方式、发只文字）。控制台「语音收发」面板可实时切换。' },
  'worlds.qqbot.voice.provider': {
    type: 'string', title: '实现方式', enum: voiceProviderIds(), 'x-hot': false,
    description: '语音供应商（实现方式）：下拉项由 voice.ts 注册的供应商动态生成。native=OneBot 原生 translate_record/tts（零依赖）；custom=用配置页填写的模型网址+API Key 对接远程 OpenAI 兼容音频服务；local=本地/自建模型（免 API Key，慢推理可加超时，支持额外参数做声音克隆/设计，如 VoxCPM2 经 vLLM-Omni）；voxcpm=本地 VoxCPM2 TTS 服务（自有接口，音色用自然语言描述，免 API Key，收语音回退 native 识别）。新增供应商只需在 voice.ts 用 registerVoiceProvider 注册。',
  },
  'worlds.qqbot.voice.asr': { type: 'boolean', title: '收语音转文字', 'x-hot': false, description: '开启后，用户发语音会被转成文字进入对话（文字更可靠、可检索）。' },
  'worlds.qqbot.voice.tts': { type: 'boolean', title: '发语音', 'x-hot': false, description: '开启后，当语义判定认为应当说语音时，回复发成语音。' },
  'worlds.qqbot.voice.semanticJudge': { type: 'boolean', title: '语义判定是否说语音', 'x-hot': false, description: '开启后通过 LLM 判断用户是否想听语音（对齐 qq_bot _judge_voice）；关闭则仅当用户显式要求时才说语音。' },
  'worlds.qqbot.voice.audioFallback': { type: 'boolean', title: 'ASR 失败回退音频', 'x-hot': false, description: 'ASR 取不到文字时，把音频作为 blob 丢给多模态模型听（需模型支持 audio/wav）。' },
  'worlds.qqbot.voice.judgeModel': { type: 'string', title: '语义判定模型', 'x-hot': false, description: '判定“是否说语音”用的轻量 chat 模型（OpenAI 兼容端点）。' },
  'worlds.qqbot.voice.voiceBaseUrl': { type: 'string', title: '语音模型网址', 'x-hot': false, description: '选 custom / local 供应商时必填：OpenAI 兼容音频端点基址。远程如 https://open.bigmodel.cn/api/paas/v4 或 https://api.openai.com/v1；本地如 http://localhost:8000/v1（VoxCPM2 经 vLLM-Omni）。ASR 走 {网址}/audio/transcriptions，TTS 走 {网址}/audio/speech。' },
  'worlds.qqbot.voice.voiceApiKeySecret': { type: 'string', title: '语音 API Key 变量', 'x-hot': false, description: 'custom 供应商 API Key 所在的环境变量名（密钥在控制台密钥库填写，默认 VOICE_API_KEY）。local 供应商免 API Key，留空即可。' },
  'worlds.qqbot.voice.voiceVoice': { type: 'string', title: '音色', 'x-hot': false, description: '仅当所选语音模型支持音色时填写（如 tongtong）；留空使用服务商默认音色。' },
  'worlds.qqbot.voice.voiceTtsModel': { type: 'string', title: 'TTS 模型名', 'x-hot': false, description: '语音合成模型名（OpenAI 兼容 /audio/speech 用，缺省 tts-1；GLM 用 glm-tts；VoxCPM2 一般为 openbmb/VoxCPM2）。' },
  'worlds.qqbot.voice.voiceTimeout': { type: 'integer', title: 'TTS 请求超时(秒)', minimum: 1, maximum: 1800, 'x-hot': false, description: 'TTS 单次请求最长等待秒数（默认 120）。本地模型推理慢可调大，超时则回退。custom 与 local 共用。ASR 识别超时单独在「语音识别」配置组设置。' },
  'worlds.qqbot.voice.voiceExtraTts': { type: 'string', title: 'TTS 额外参数(JSON)', 'x-hot': false, description: '合并进 /audio/speech 请求体的额外 JSON，用于本地模型高级特性：如 VoxCPM2 声音克隆传 {"reference_audio":"<音频url或base64>"}, 或声音设计传 {"voice_design":"一个温柔的少年音"}。留空 {} 表示无。' },
  'worlds.qqbot.voice.voxcpmUrl': { type: 'string', title: 'VoxCPM 服务地址', 'x-hot': false, description: '选 voxcpm 供应商时必填：本地 VoxCPM2 TTS 服务基址，如 http://127.0.0.1:8765。服务暴露 GET /health（就绪返回 {"ready":true,"state":"ready"}）与 POST /tts（返回 48kHz WAV）。' },
  'worlds.qqbot.voice.voxcpmVoiceDesc': { type: 'string', title: 'VoxCPM 音色描述', 'x-hot': false, description: 'VoxCPM2 说话人音色（自然语言描述），如「温柔女声」「温柔御姐音」。' },
  'worlds.qqbot.voice.voxcpmSpeed': { type: 'number', title: 'VoxCPM 语速', minimum: 0.5, maximum: 2, 'x-hot': false, description: 'VoxCPM2 合成语速（0.5~2，默认 1.0）。' },
  'worlds.qqbot.voice.voxcpmTimesteps': { type: 'integer', title: 'VoxCPM 推理步数', minimum: 1, maximum: 50, 'x-hot': false, description: 'VoxCPM2 推理步数（越小越快越夸张，默认 10）。' },
  'worlds.qqbot.voice.voxcpmSeed': { type: 'integer', title: 'VoxCPM 随机种子', minimum: 0, maximum: 2147483647, 'x-hot': false, description: 'VoxCPM2 随机种子（0=随机，>0 固定音色/韵律可复现）。' },
  },
  },
  };



/** 语音识别（ASR）共享配置组：语音收发（收语音）用同一套识别引擎，只在此处配置一次。 */
export const QQ_ASR_GROUP: ConfigGroup = {
  id: 'world:qqbot-asr',
  owner: 'world:qqbot',
  schema: {
    type: 'object',
    title: '语音识别（ASR 共享）',
    description: '语音收发（收语音）用同一套识别引擎，只在此处配置一次。默认 local + funasr（SenseVoiceSmall，中文更准，自动从 ModelScope 下载）；可切 228MB 的 sherpa-onnx 版（int8 量化，更省内存更快，已接入）——先在控制台「语音模型」面板点「下载」拉取模型，再切引擎。改完需重启生效。',
    properties: {
    'worlds.qqbot.asr.mode': {
      type: 'string', title: 'ASR 模式', enum: ['off', 'cloud', 'local'], 'x-hot': true,
      description: "'off'=关闭实时听写（仅单向播报，听不到对方）；'cloud'=远程 OpenAI 兼容转写端点；'local'=本地侧车（默认 funasr，由扩展自动拉起）。",
    },
    'worlds.qqbot.asr.localEngine': {
      type: 'string', title: '本地 ASR 引擎', 'x-hot': true,
      description: 'funasr（默认，SenseVoiceSmall，自动从 ModelScope 下载）；sherpaOnnx（228MB int8 量化版，省内存更快，已支持）。sherpaOnnx 需先在控制台「语音模型」面板点「下载」（从 ModelScope xiaowangge/sherpa-onnx-sense-voice-small 取 model_q8.onnx + tokens.txt），或手动在 asr.localModelPath 指向含二者的目录。新增引擎只需在侧车 load_engine 加分支，无需改此处类型。',
    },
    'worlds.qqbot.asr.localModelPath': {
      type: 'string', title: '本地模型路径', 'x-hot': true,
      description: '本地 ASR 模型/权重目录绝对路径。funasr/sherpaOnnx 留空则默认 <扩展>/models/<模型名>（sherpaOnnx 默认 sherpa-onnx-sense-voice，需先下载）；填了则以指定目录优先。vosk/fasterWhisper 等需本地目录的引擎必须填。',
    },
    'worlds.qqbot.asr.localVenv': {
      type: 'string', title: '本地依赖 venv 路径', 'x-hot': true,
      description: '装了 ASR 依赖的虚拟环境目录绝对路径；空=自动探测 <扩展>/venv_vox。',
    },
    'worlds.qqbot.asr.localPort': {
      type: 'number', title: '本地侧车端口', 'x-hot': true,
      description: 'asr.mode=local 时由本扩展拉起 asr_sidecar.py 监听此端口（默认 8778）。',
    },
    'worlds.qqbot.asr.cloudUrl': {
      type: 'string', title: '云端 ASR 网址', 'x-hot': true,
      description: 'OpenAI 兼容转写端点基址（POST {url}/asr 或 /audio/transcriptions 收音频→{text}）。asr.mode=cloud 时填。',
    },
    'worlds.qqbot.asr.cloudApiKeySecret': {
      type: 'string', title: '云端 ASR 密钥变量名', 'x-hot': true,
      description: 'API Key 的环境变量名；实际密钥在控制台「密钥库」填写。留空=不带鉴权头（本地/免密服务）。',
    },
    'worlds.qqbot.asr.cloudModel': {
      type: 'string', title: '云端 ASR 模型名', 'x-hot': true,
      description: '智谱 GLM 用 glm-asr-2512；OpenAI 用 whisper-1。',
    },
    'worlds.qqbot.asr.ffmpegPath': {
      type: 'string', title: 'ffmpeg 路径', 'x-hot': false,
      description: '解码语音用的 ffmpeg 可执行文件路径（把 SILK/AMR 解码成 WAV 送识别）。空=依次找 PATH 与仓库 node_modules/ffmpeg-static（win 用 ffmpeg.exe）。',
    },
    'worlds.qqbot.asr.transcribeTimeout': {
      type: 'integer', title: '识别超时(毫秒)', minimum: 1000, maximum: 600000, 'x-hot': false,
      description: '单次识别（ffmpeg 解码 + /asr 请求）最长等待毫秒数（默认 60000）。超时回退文字。',
    },
    },
  },
};

/**
 * 原地补全缺省值并保持对象身份：让 World 持有的 this.config 就是 ctx.cfg 的同一引用，
 * 这样控制台的 x-hot 配置改动（groups / privates / 发送节奏等）能即时对 World 生效，无需重启。
 */
/**
 * 把“空格/逗号分隔字符串”或“数字数组”统一成数字数组。控制台以字符串编辑，运行时以数组使用。
 *
 * **只收正整数**：群号与 QQ 号恒为正，`Number("")` 却得到 0（`isFinite(0)` 为真），所以
 * 「留空 = 不监听」会被解析成「监听 0 号」——面板清空后读回来永远是个 0，表现为“保存不了”。
 * （同文件的 `parseNumberSeq` 靠 `filter(Boolean)` 先滤空串，等效；这里额外拒掉 0/负数/小数。）
 */
export function toIds(raw: unknown): number[] {
  const ok = (n: number): boolean => Number.isInteger(n) && n > 0;
  if (Array.isArray(raw)) return raw.map(Number).filter(ok);
  if (typeof raw === 'string') return raw.split(/[\s,]+/).map(Number).filter(ok);
  return [];
}

export function normalizeConfig(raw: QQConfigSection): QQWorldConfig {
  const c = raw as unknown as QQWorldConfig & Record<string, unknown>;
  for (const [k, v] of Object.entries(QQ_DEFAULTS)) {
    if (c[k] === undefined) c[k] = v;
  }
  c.allowLocalOperations = c.allowLocalOperations === true;
  if (typeof c.napcatLauncher !== 'string') c.napcatLauncher = '';
  c.groups = toIds(c.groups);
  c.privates = toIds(c.privates);
  if (typeof c.privateAggregationWindow !== 'number') c.privateAggregationWindow = QQ_DEFAULTS.privateAggregationWindow;
  if (typeof c.maxSequenceGap !== 'number') c.maxSequenceGap = QQ_DEFAULTS.maxSequenceGap;
  if (typeof c.replyMaxGapSec !== 'number') c.replyMaxGapSec = QQ_DEFAULTS.replyMaxGapSec;
  if (typeof c.maxMessageBytes !== 'number') c.maxMessageBytes = QQ_DEFAULTS.maxMessageBytes;
  if (typeof c.forwardExpandLimit !== 'number') c.forwardExpandLimit = QQ_DEFAULTS.forwardExpandLimit;
  if (typeof c.forwardByMessageId !== 'boolean') c.forwardByMessageId = QQ_DEFAULTS.forwardByMessageId;
  if (typeof c.splitReplyBySentence !== 'boolean') c.splitReplyBySentence = true;
  if (typeof c.sentencesPerMessage !== 'number') c.sentencesPerMessage = 1;
  if (typeof c.sendIntervalMs !== 'number') c.sendIntervalMs = QQ_DEFAULTS.sendIntervalMs;
  if (typeof c.deliverImageAttachments !== 'boolean') c.deliverImageAttachments = QQ_DEFAULTS.deliverImageAttachments;
  if (typeof c.emojiDir !== 'string' || !c.emojiDir) c.emojiDir = QQ_DEFAULTS.emojiDir;
  if (typeof c.timezone !== 'string' || !c.timezone) c.timezone = QQ_DEFAULTS.timezone;
  if (typeof c.mode !== 'string') c.mode = 'reverse';
  if (typeof c.token !== 'string') c.token = '';
  if (typeof c.wsUrl !== 'string') c.wsUrl = QQ_DEFAULTS.wsUrl;
  if (typeof c.wsHost !== 'string') c.wsHost = QQ_DEFAULTS.wsHost;
  if (typeof c.wsPort !== 'number') c.wsPort = QQ_DEFAULTS.wsPort;
  if (typeof c.wsPath !== 'string') c.wsPath = QQ_DEFAULTS.wsPath;
  // vision 子对象原地合并，保持引用身份（x-hot 生效）
  c.vision = c.vision ?? {};
  Object.assign(c.vision, { ...QQ_DEFAULTS.vision, ...(c.vision as object) });
  // sticker 子对象原地合并
  c.sticker = c.sticker ?? {};
  Object.assign(c.sticker, { ...QQ_DEFAULTS.sticker, ...(c.sticker as object) });
  if (typeof c.sticker.enabled !== 'boolean') c.sticker.enabled = true;
  if (c.sticker.captureMode !== 'sticker' && c.sticker.captureMode !== 'allImages') c.sticker.captureMode = 'sticker';
  if (typeof c.sticker.dir !== 'string') c.sticker.dir = '';
  if (typeof c.sticker.addToQQFavorites !== 'boolean') c.sticker.addToQQFavorites = false;
  // proactive 子对象原地合并
  c.proactive = c.proactive ?? {};
  Object.assign(c.proactive, { ...QQ_DEFAULTS.proactive, ...(c.proactive as object) });
  const p = c.proactive as Record<string, unknown>;
  if (typeof p.enabled !== 'boolean') p.enabled = false;
  if (p.mode !== 'private' && p.mode !== 'group' && p.mode !== 'both') p.mode = 'private';
  if (typeof p.tickSec !== 'number') p.tickSec = QQ_DEFAULTS.proactive.tickSec;
  if (typeof p.warmupMin !== 'number') p.warmupMin = QQ_DEFAULTS.proactive.warmupMin;
  if (typeof p.stableChancePerTick !== 'number') p.stableChancePerTick = QQ_DEFAULTS.proactive.stableChancePerTick;
  if (typeof p.warmupChance !== 'number') p.warmupChance = QQ_DEFAULTS.proactive.warmupChance;
  if (typeof p.privateCooldownSec !== 'number') p.privateCooldownSec = QQ_DEFAULTS.proactive.privateCooldownSec;
  if (typeof p.groupCooldownSec !== 'number') p.groupCooldownSec = QQ_DEFAULTS.proactive.groupCooldownSec;
  if (typeof p.unrepliedThreshold !== 'number') p.unrepliedThreshold = QQ_DEFAULTS.proactive.unrepliedThreshold;
  if (typeof p.silentHours !== 'number') p.silentHours = QQ_DEFAULTS.proactive.silentHours;
  if (typeof p.dailyQuota !== 'number') p.dailyQuota = QQ_DEFAULTS.proactive.dailyQuota;
  if (typeof p.dedupWindow !== 'number') p.dedupWindow = QQ_DEFAULTS.proactive.dedupWindow;
  if (typeof p.withNickname !== 'boolean') p.withNickname = QQ_DEFAULTS.proactive.withNickname;
  // qzone 子对象原地合并
  c.qzone = c.qzone && typeof c.qzone === 'object' ? c.qzone : {};
  Object.assign(c.qzone, { ...QQ_DEFAULTS.qzone, ...(c.qzone as Record<string, unknown>) });
  const q = c.qzone as Record<string, unknown>;
  if (typeof q.enabled !== 'boolean') q.enabled = false;
  if (typeof q.tickSec !== 'number') q.tickSec = QQ_DEFAULTS.qzone.tickSec;
  if (typeof q.chancePerTick !== 'number') q.chancePerTick = QQ_DEFAULTS.qzone.chancePerTick;
  if (typeof q.dailyQuota !== 'number') q.dailyQuota = QQ_DEFAULTS.qzone.dailyQuota;
  if (typeof q.permission !== 'number') q.permission = QQ_DEFAULTS.qzone.permission;
  if (q.imageMode !== 'none' && q.imageMode !== 'recent') q.imageMode = 'none' as const;
  const ar = (q.autoReplyComments ??= {}) as Record<string, unknown>;
  Object.assign(ar, { ...QQ_DEFAULTS.qzone.autoReplyComments, ...ar });
  if (typeof ar.enabled !== 'boolean') ar.enabled = false;
  if (typeof ar.dailyQuota !== 'number') ar.dailyQuota = QQ_DEFAULTS.qzone.autoReplyComments.dailyQuota;
  if (typeof ar.cooldownSec !== 'number') ar.cooldownSec = QQ_DEFAULTS.qzone.autoReplyComments.cooldownSec;
  if (typeof q.commentAction !== 'string' || !q.commentAction) q.commentAction = QQ_DEFAULTS.qzone.commentAction;
  // groupSpeak / antiLoop 子对象原地合并
  c.groupSpeak = c.groupSpeak ?? {};
  Object.assign(c.groupSpeak, { ...QQ_DEFAULTS.groupSpeak, ...(c.groupSpeak as object) });
  const gs = c.groupSpeak as Record<string, unknown>;
  if (typeof gs.enabled !== 'boolean') gs.enabled = true;
  if (typeof gs.maxPerWindow !== 'number' || (gs.maxPerWindow as number) < 1) gs.maxPerWindow = QQ_DEFAULTS.groupSpeak.maxPerWindow;
  if (typeof gs.windowSec !== 'number' || (gs.windowSec as number) < 1) gs.windowSec = QQ_DEFAULTS.groupSpeak.windowSec;
  c.antiLoop = c.antiLoop ?? {};
  Object.assign(c.antiLoop, { ...QQ_DEFAULTS.antiLoop, ...(c.antiLoop as object) });
  const al = c.antiLoop as Record<string, unknown>;
  if (typeof al.enabled !== 'boolean') al.enabled = true;
  if (typeof al.maxConsecutiveBotTurns !== 'number' || (al.maxConsecutiveBotTurns as number) < 1) al.maxConsecutiveBotTurns = QQ_DEFAULTS.antiLoop.maxConsecutiveBotTurns;
  if (typeof al.idleToEndSec !== 'number' || (al.idleToEndSec as number) < 0) al.idleToEndSec = QQ_DEFAULTS.antiLoop.idleToEndSec;
  // routine 子对象原地合并
  c.routine = c.routine && typeof c.routine === 'object' ? c.routine : {};
  Object.assign(c.routine, { ...QQ_DEFAULTS.routine, ...(c.routine as object) });
  const rt = c.routine as Record<string, unknown>;
  if (typeof rt.enabled !== 'boolean') rt.enabled = false;
  if (typeof rt.sleepStart !== 'string' || !/^\d{1,2}:\d{2}$/.test(rt.sleepStart as string)) rt.sleepStart = QQ_DEFAULTS.routine.sleepStart;
  if (typeof rt.sleepEnd !== 'string' || !/^\d{1,2}:\d{2}$/.test(rt.sleepEnd as string)) rt.sleepEnd = QQ_DEFAULTS.routine.sleepEnd;
  if (typeof rt.lazyStart !== 'string' || !/^\d{1,2}:\d{2}$/.test(rt.lazyStart as string)) rt.lazyStart = QQ_DEFAULTS.routine.lazyStart;
  if (typeof rt.lazyEnd !== 'string' || !/^\d{1,2}:\d{2}$/.test(rt.lazyEnd as string)) rt.lazyEnd = QQ_DEFAULTS.routine.lazyEnd;
  if (typeof rt.greetSleep !== 'string') rt.greetSleep = QQ_DEFAULTS.routine.greetSleep;
  if (typeof rt.greetWake !== 'string') rt.greetWake = QQ_DEFAULTS.routine.greetWake;
  if (typeof rt.greetLazy !== 'string') rt.greetLazy = QQ_DEFAULTS.routine.greetLazy;
  // reminder 子对象原地合并
  c.reminder = c.reminder && typeof c.reminder === 'object' ? c.reminder : { ...QQ_DEFAULTS.reminder };
  Object.assign(c.reminder, { ...QQ_DEFAULTS.reminder, ...(c.reminder as object) });
  const rm = c.reminder as Record<string, unknown>;
  if (typeof rm.enabled !== 'boolean') rm.enabled = true;
  if (!Number.isSafeInteger(rm.dailyQuota) || (rm.dailyQuota as number) < 1) rm.dailyQuota = QQ_DEFAULTS.reminder.dailyQuota;
  if (typeof rm.limitMessage !== 'string' || !rm.limitMessage.trim()) rm.limitMessage = QQ_DEFAULTS.reminder.limitMessage;
  // voice 子对象原地合并
  c.voice = c.voice && typeof c.voice === 'object' ? c.voice : {};
  Object.assign(c.voice, { ...QQ_DEFAULTS.voice, ...(c.voice as object) });
  const vc = c.voice as Record<string, unknown>;
  if (typeof vc.enabled !== 'boolean') vc.enabled = false;
  if (!voiceProviderIds().includes(vc.provider as string)) vc.provider = 'native';
  if (typeof vc.asr !== 'boolean') vc.asr = true;
  if (typeof vc.tts !== 'boolean') vc.tts = true;
  if (typeof vc.semanticJudge !== 'boolean') vc.semanticJudge = true;
  if (typeof vc.audioFallback !== 'boolean') vc.audioFallback = true;
  if (typeof vc.judgeEndpoint !== 'string' || !vc.judgeEndpoint) vc.judgeEndpoint = QQ_DEFAULTS.voice.judgeEndpoint;
  if (typeof vc.judgeApiKeySecret !== 'string' || !vc.judgeApiKeySecret) vc.judgeApiKeySecret = QQ_DEFAULTS.voice.judgeApiKeySecret;
  if (typeof vc.judgeModel !== 'string' || !vc.judgeModel) vc.judgeModel = QQ_DEFAULTS.voice.judgeModel;
  if (typeof vc.voiceBaseUrl !== 'string') vc.voiceBaseUrl = QQ_DEFAULTS.voice.voiceBaseUrl;
  if (typeof vc.voiceApiKeySecret !== 'string' || !vc.voiceApiKeySecret) vc.voiceApiKeySecret = QQ_DEFAULTS.voice.voiceApiKeySecret;
  if (typeof vc.voiceVoice !== 'string') vc.voiceVoice = QQ_DEFAULTS.voice.voiceVoice;
  if (typeof vc.voiceTtsModel !== 'string' || !vc.voiceTtsModel) vc.voiceTtsModel = QQ_DEFAULTS.voice.voiceTtsModel;
  if (typeof vc.voiceTimeout !== 'number' || !(vc.voiceTimeout > 0)) vc.voiceTimeout = QQ_DEFAULTS.voice.voiceTimeout;
  if (typeof vc.voiceExtraTts !== 'string') vc.voiceExtraTts = QQ_DEFAULTS.voice.voiceExtraTts;
  if (typeof vc.voxcpmUrl !== 'string' || !vc.voxcpmUrl) vc.voxcpmUrl = QQ_DEFAULTS.voice.voxcpmUrl;
  if (typeof vc.voxcpmVoiceDesc !== 'string' || !vc.voxcpmVoiceDesc) vc.voxcpmVoiceDesc = QQ_DEFAULTS.voice.voxcpmVoiceDesc;
  if (typeof vc.voxcpmSpeed !== 'number' || !(vc.voxcpmSpeed > 0)) vc.voxcpmSpeed = QQ_DEFAULTS.voice.voxcpmSpeed;
  if (typeof vc.voxcpmTimesteps !== 'number' || !(vc.voxcpmTimesteps > 0)) vc.voxcpmTimesteps = QQ_DEFAULTS.voice.voxcpmTimesteps;
  if (typeof vc.voxcpmSeed !== 'number' || vc.voxcpmSeed < 0) vc.voxcpmSeed = QQ_DEFAULTS.voice.voxcpmSeed;
  // asr 子对象原地合并（语音收发与语音通话共用的识别配置）
  c.asr = c.asr && typeof c.asr === 'object' ? c.asr : {};
  Object.assign(c.asr, { ...QQ_DEFAULTS.asr, ...(c.asr as object) });
  const ac = c.asr as Record<string, unknown>;
  if (!['off', 'cloud', 'local'].includes(ac.mode as string)) ac.mode = 'local';
  if (typeof ac.localEngine !== 'string' || !ac.localEngine) ac.localEngine = 'funasr';
  if (typeof ac.localModelPath !== 'string') ac.localModelPath = '';
  if (typeof ac.localVenv !== 'string') ac.localVenv = '';
  if (typeof ac.localPort !== 'number' || (ac.localPort as number) <= 0) ac.localPort = 8778;
  if (typeof ac.cloudUrl !== 'string') ac.cloudUrl = '';
  if (typeof ac.cloudApiKeySecret !== 'string') ac.cloudApiKeySecret = 'ASR_API_KEY';
  if (typeof ac.cloudModel !== 'string' || !(ac.cloudModel as string).trim()) ac.cloudModel = 'glm-asr-2512';
  if (typeof ac.ffmpegPath !== 'string') ac.ffmpegPath = '';
  if (typeof ac.transcribeTimeout !== 'number' || (ac.transcribeTimeout as number) < 1000) ac.transcribeTimeout = 60000;
  // admin 子对象原地合并：先摊平默认，再被用户配置覆盖（模式同 voice/routine）
  const adm = c.admin && typeof c.admin === 'object' ? (c.admin as Record<string, unknown>) : {};
  Object.assign(adm, { ...QQ_DEFAULTS.admin, ...adm });
  if (typeof adm.enabled !== 'boolean') adm.enabled = false;
  if (typeof adm.noticeAction !== 'string' || !adm.noticeAction) adm.noticeAction = QQ_DEFAULTS.admin.noticeAction;
  // allowlist 在控制台里是逗号分隔字符串，运行时统一规整成字符串数组
  if (typeof adm.allowlist === 'string') {
    adm.allowlist = adm.allowlist.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (!Array.isArray(adm.allowlist)) adm.allowlist = [];
  if (typeof adm.allowGroupAdmins !== 'boolean') adm.allowGroupAdmins = true;
  if (typeof adm.ownerOnly !== 'boolean') adm.ownerOnly = false;
  if (typeof adm.protectOwner !== 'boolean') adm.protectOwner = true;
  if (typeof adm.protectAdmins !== 'boolean') adm.protectAdmins = true;
  if (typeof adm.allowJoin !== 'boolean') adm.allowJoin = true;
  if (typeof adm.allowSelf !== 'boolean') adm.allowSelf = true;
  if (typeof adm.allowSelfKick !== 'boolean') adm.allowSelfKick = false;
  if (typeof adm.kickRejectRejoin !== 'boolean') adm.kickRejectRejoin = true;
  c.admin = adm as QQWorldConfig['admin'];
  if (typeof c.allowPrivateRedirect !== 'boolean') c.allowPrivateRedirect = false; // 默认关闭：private 目标须先经监听名单
  return c;
}

export function parseNumberSeq(v: unknown): number[] {
  if (Array.isArray(v)) return v.map((x) => Number(x)).filter((x) => Number.isFinite(x));
  if (typeof v === 'string') {
    return v
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n));
  }
  return [];
}

/**
 * 常见国家/地区时区预设。value 为 IANA 时区名（供 Intl 使用），
 * flag+country 用于控制台下拉展示。默认中国（UTC+8）。
 */
export interface TzPreset {
  flag: string;
  country: string;
  iana: string;
}

export const TZ_PRESETS: TzPreset[] = [
  { flag: '🇨🇳', country: '中国', iana: 'Asia/Shanghai' },
  { flag: '🇭🇰', country: '中国香港', iana: 'Asia/Hong_Kong' },
  { flag: '🇯🇵', country: '日本', iana: 'Asia/Tokyo' },
  { flag: '🇰🇷', country: '韩国', iana: 'Asia/Seoul' },
  { flag: '🇸🇬', country: '新加坡', iana: 'Asia/Singapore' },
  { flag: '🇮🇳', country: '印度', iana: 'Asia/Kolkata' },
  { flag: '🇦🇪', country: '阿联酋', iana: 'Asia/Dubai' },
  { flag: '🇷🇺', country: '俄罗斯', iana: 'Europe/Moscow' },
  { flag: '🇬🇧', country: '英国', iana: 'Europe/London' },
  { flag: '🇫🇷', country: '法国', iana: 'Europe/Paris' },
  { flag: '🇩🇪', country: '德国', iana: 'Europe/Berlin' },
  { flag: '🇺🇸', country: '美国东部', iana: 'America/New_York' },
  { flag: '🇺🇸', country: '美国西部', iana: 'America/Los_Angeles' },
  { flag: '🇧🇷', country: '巴西', iana: 'America/Sao_Paulo' },
  { flag: '🇦🇺', country: '澳大利亚', iana: 'Australia/Sydney' },
  { flag: '🇳🇿', country: '新西兰', iana: 'Pacific/Auckland' },
  { flag: '🌐', country: 'UTC（协调世界时）', iana: 'UTC' },
];

/** 默认时区：中国 UTC+8（与 QQ_DEFAULTS.timezone 一致）。 */
export const TZ_DEFAULT_IANA = 'Asia/Shanghai';

/**
 * 返回某 IANA 时区当前的 UTC 偏移标签，如 "UTC+8" / "UTC+5:30" / "UTC-4"。
 * 自动反映夏令时；非法时区返回空串。
 */
export function tzOffsetLabel(iana: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: iana, timeZoneName: 'shortOffset' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName');
    const raw = parts?.value ?? '';
    // raw 形如 "GMT+8" / "GMT+5:30" / "GMT"；去掉 "GMT" 前缀换成 "UTC"。
    return raw ? 'UTC' + raw.slice(3) : '';
  } catch {
    return '';
  }
}

/**
 * 给 x-options 下拉（kind='qq-timezone'）提供「国家 (UTC偏移)」友好选项。
 * 存储值仍为 IANA 名，供 Intl 直接使用。
 */
export function qqTimezoneOptions(): Array<{ value: string; label: string }> {
  return TZ_PRESETS.map((p) => ({
    value: p.iana,
    label: `${p.flag} ${p.country} (${tzOffsetLabel(p.iana)})`,
  }));
}
