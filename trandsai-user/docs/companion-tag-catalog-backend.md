# 伴侣自动生成 — 标签 / 枚举目录（后端对齐前端）

> 前端**不会改**。后端一键生成、落库、回传时，请只使用本文目录里的值。  
> 不要发明目录外的性格标签（例如「高冷」「甜妹」），前端芯片对不上，取消选中后还会消失。

前端源文件：

| 内容 | 文件 |
|------|------|
| 性格标签（芯片） | `utils/personalityTags.js` |
| 性格目录组装 / 互斥 | `utils/createPersonality.js` |
| 人设维度下拉 | `data/createCompanion/personaAxesCatalog.js` |
| 创建提交 / 一键生成 | `pages-sub/create/index.vue`、`utils/createCompanionForm.js` |

---

## 1. 性别 `gender`

前端表单与 **POST `/companions`、POST `/companions/generate`** 传：

| 合法值 | 含义 |
|--------|------|
| `male` | 男 |
| `female` | 女 |

兼容读入：`男` / `male` / `m` → 男；其余当女。

展示层（朋友圈头像旁图标）认库里的 `男` / `女`。若库内仍存中文，接口读写建议同时接受 `male|female` 与 `男|女`，**生成接口请回传 `male` 或 `female`**。

没有第三性别枚举，不要回 `other` / `secret`。

---

## 2. 性格标签 `personality`（最重要）

### 2.1 传什么

- **字段名**：`personality`（string）
- **条数**：至少 2、最多 4
- **分隔符**：中文顿号 `、`（不要用英文逗号当主分隔）
- **取值**：必须是下表 **key**，或该 key 在对应语言下的**展示文案**（前端会反查成 key）
- **推荐写法（生成接口）**：按请求里的 `lang` 输出展示文案，用 `、` 拼接

```text
冷静、幽默、独立
calm、humorous、independent
```

两种前端都能认。**不要**输出目录外的词。

### 2.2 生成规则

1. 只从「标准 key 列表」抽 2～4 个，去重。
2. 避开互斥对（见 2.4）。抽到互斥就换一个。
3. 不要用历史别名当输出（`quiet` / `warm` / `oneesan` / `aloof` / `clingy` / `obedient`），它们会归一到标准 key。
4. 折叠列表默认只展示「推荐 key」；非推荐 key 也可以生成，但必须仍在标准列表里。

### 2.3 标准 key 与中英展示（完整目录）

`group`：气质 temperament / 社交 social / 情绪 emotion / 风格 style  
`bucket`：neutral / soft / hard（前端分类用，生成可不传）

| key | group | bucket | zh | en |
|-----|-------|--------|----|----|
| calm | temperament | neutral | 冷静 | calm |
| humorous | style | neutral | 幽默 | humorous |
| independent | temperament | neutral | 独立 | independent |
| rational | temperament | neutral | 理性 | rational |
| straightforward | social | neutral | 直率 | straightforward |
| mature | temperament | neutral | 成熟 | mature |
| cool | style | neutral | 酷 | cool |
| artsy | style | neutral | 文艺 | artsy |
| passionate | emotion | neutral | 热情 | passionate |
| reserved | social | neutral | 内敛 | reserved |
| sarcastic | style | neutral | 毒舌 | sarcastic |
| lazy | style | neutral | 慵懒 | laid-back |
| casual | style | neutral | 随性 | casual |
| rebellious | temperament | hard | 叛逆 | rebellious |
| elegant | style | neutral | 优雅 | elegant |
| scheming | style | neutral | 腹黑 | scheming |
| sunny | temperament | soft | 阳光 | sunny |
| lively | social | soft | 活泼 | lively |
| emotional | emotion | soft | 感性 | emotional |
| delicate | emotion | soft | 细腻 | sensitive |
| gentle | temperament | soft | 温柔 | gentle |
| cute | style | soft | 可爱 | cute |
| affectionate | emotion | soft | 重感情 | affectionate |
| mild | temperament | soft | 温和 | mild |
| healing | emotion | soft | 治愈 | healing |
| tsundere | style | soft | 傲娇 | tsundere |
| yandere | emotion | soft | 病娇 | yandere |
| commanding | style | hard | 气场强 | commanding |
| airheaded | style | soft | 天然呆 | airheaded |
| mysterious | style | neutral | 神秘 | mysterious |
| steady | temperament | hard | 沉稳 | steady |
| cheerful_blunt | social | hard | 爽朗 | bluntly cheerful |
| taciturn | social | hard | 寡言 | taciturn |
| protective | emotion | hard | 护短 | protective |
| competitive | temperament | hard | 好胜 | competitive |
| reliable | temperament | hard | 可靠 | reliable |
| hardcore | style | hard | 硬核 | hardcore |
| geeky | style | hard | 极客 | geeky |
| sporty | style | hard | 运动 | sporty |
| ambitious | temperament | hard | 野心 | ambitious |
| zen | temperament | neutral | 佛系 | zen |
| fierce | emotion | hard | 狠厉 | fierce |
| particular | style | neutral | 讲究 | particular |
| unbridled | style | hard | 不羁 | unbridled |
| social_butterfly | social | neutral | 社牛 | social butterfly |
| social_anxious | social | neutral | 社恐 | socially anxious |
| few_words | social | hard | 话少 | man of few words |
| meticulous | temperament | neutral | 细心 | meticulous |
| carefree | temperament | neutral | 大大咧咧 | carefree |
| slow_warm | emotion | neutral | 慢热 | slow-to-warm |
| impulsive | emotion | hard | 冲动 | impulsive |
| neat_freak | style | neutral | 洁癖 | neat freak |
| procrastinator | style | neutral | 拖延 | procrastinator |
| perfectionist | temperament | hard | 完美主义 | perfectionist |
| pragmatic | temperament | hard | 务实 | pragmatic |
| idealistic | temperament | soft | 理想主义 | idealistic |
| worldly | style | neutral | 玩世 | worldly |
| loyal | emotion | neutral | 忠诚 | loyal |
| freedom_loving | temperament | neutral | 自由 | freedom-loving |
| brotherly | style | hard | 哥哥感 | brotherly |
| youthful | style | neutral | 少年感 | youthful |
| assertive | social | hard | 有主见 | assertive |
| warm_steady | emotion | neutral | 暖而稳 | warmly steady |

ja / ko / pt / es / id / ar 的展示文案与上面同一套 key，见 `utils/personalityTags.js` 的 `personalityTagTranslations`。

### 2.4 互斥对（不能同时出现）

```
yandere + cute
yandere + commanding
cute + commanding
social_butterfly + social_anxious
social_butterfly + taciturn
social_anxious + cheerful_blunt
impulsive + steady
zen + ambitious
zen + competitive
```

### 2.5 推荐芯片（折叠态默认展示，生成不必受限）

```
calm, humorous, independent, rational, straightforward, steady, reliable,
cheerful_blunt, sarcastic, geeky, sporty, ambitious, zen, social_butterfly,
social_anxious, slow_warm, pragmatic, loyal, hardcore, mature, cool,
protective, assertive, warm_steady
```

### 2.6 历史别名（只用于读入归一，不要作为生成结果）

| 别名 | 标准 key |
|------|----------|
| oneesan | commanding |
| clingy | affectionate |
| obedient | mild |
| quiet | calm |
| warm | gentle |
| aloof | cool |

---

## 3. 性取向 `sexual_orientation`

只允许：

```
heterosexual | homosexual | bisexual | pansexual | asexual | secret
```

---

## 4. MBTI `mbti`

只允许 16 型（大写）：

```
INTJ INTP ENTJ ENTP
INFJ INFP ENFJ ENFP
ISTJ ISFJ ESTJ ESFJ
ISTP ISFP ESTP ESFP
```

---

## 5. 人设维度 `persona_axes`

对象，5 个轴都要有 **key**（不要传展示文案）：

```json
{
  "career_class": "student",
  "attachment": "secure",
  "conflict_style": "direct",
  "life_pace": "slow",
  "interest_domain": "sports"
}
```

| 轴 | 合法 key |
|----|----------|
| career_class | `student` `entry_white_collar` `skilled_trade` `creative` `tech` `service_hospitality` `public_sector` `entrepreneur` `finance_pro` |
| attachment | `secure` `anxious` `avoidant` `fearful` |
| conflict_style | `direct` `cool_down` `compromise` `competitive` `withdraw` |
| life_pace | `slow` `steady` `fast` `irregular` |
| interest_domain | `sports` `arts` `tech_gadgets` `food` `outdoors` `gaming` `music` `reading` `markets` `travel` |

多语言文案见 `data/createCompanion/personaAxesCatalog.js`。

---

## 6. 一键生成接口应对齐的字段

### 请求 `POST /companions/generate`

前端会带上种子（后端按这些写长文，**性格请仍落在目录内**）：

| 字段 | 说明 |
|------|------|
| name | 名字，≤20 |
| age | 18–65 |
| gender | `male` / `female` |
| sexual_orientation | 见第 3 节 |
| city | 城市名 |
| personality | 已是合法标签、顿号拼接 |
| mbti | 见第 4 节 |
| lang | `zh` `en` `ja` `ko` `pt` `es` `id` `ar`（可带 `zh-CN` 等，取 `-` 前） |
| country | 国家 |
| region_key | 地区目录 key |
| region_label | 展示用地区文案 |
| persona_axes | 见第 5 节 |
| expand_user_input | 前端传 `false` |

### 响应（前端会读的字段）

长文按 `lang` 写；**不要改写 `personality` 成目录外的词**。若回传性格，必须仍是 2～4 个目录标签、`、` 拼接。

| 字段 | 前端用途 | 建议上限 |
|------|----------|----------|
| appearance | 外貌 | 300 |
| description | 简介 | 300 |
| background | 背景 | 300 |
| speech_style | 说话风格 | 300 |
| hobbies | 爱好 | 300 |
| values | 价值观 | 500 |
| fears | 恐惧 | 500 |
| love_view | 恋爱观 | 500 |
| daily_routine | 作息 | 500 |
| favorite_things | 喜欢的事物 | 500 |
| life_story | 人生故事 | 1000 |
| cultural_values | 文化三观 | 800 |
| gender_perspective | 性别观念（长文，不是芯片） | 800 |
| region_key / country / region_label | 地区回填 | — |
| persona_axes | 维度回填，必须是第 5 节的 key | — |

创建提交 `POST /companions` 的 `personality` / `gender` / `sexual_orientation` / `mbti` / `persona_axes` 规则与上面相同。

---

## 7. 错误示例 vs 正确示例

**错误**（前端芯片对不上）：

```text
personality: "高冷、甜妹、姐感、班味"
```

**正确**（zh）：

```text
personality: "冷静、毒舌、独立、佛系"
```

**正确**（en）：

```text
personality: "calm、sarcastic、independent、zen"
```

**正确 JSON 片段**：

```json
{
  "gender": "female",
  "sexual_orientation": "heterosexual",
  "mbti": "INFJ",
  "personality": "温柔、慢热、细心",
  "persona_axes": {
    "career_class": "creative",
    "attachment": "anxious",
    "conflict_style": "cool_down",
    "life_pace": "steady",
    "interest_domain": "arts"
  }
}
```
