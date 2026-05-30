# 整体设计
opencode 中 session 设计有：session、message、part。

注意：以下的架构逻辑上是这样的，实现方式是依靠 sessionID/messageID 联系起来的。

+ session 实体中没有 message 字段，message 中也没有 part 字段。
+ 三个实体之间相互独立，依靠外键（SessionID、MessageID）建立联系

```plain
  Session ←── Message.sessionID (1:N)    
  
  Message ←── Part.messageID   (1:N)                                                                                           
              Part.sessionID (冗余)
```



```python
Session → MessageV2 → Part 三层架构                                                                       
                                                                                                            
  Session (会话)                                                                                            
    ├── MessageV2 (消息)                                                                                    
    │     ├── Part (片段)                                                                                   
    │     │     ├── type: "text"       ← LLM 输出的文本                                                     
    │     │     ├── type: "tool"       ← 工具调用（状态机）                                                 
    │     │     ├── type: "reasoning"  ← 推理过程                                                           
    │     │     ├── type: "file"       ← 图片/附件                                                          
    │     │     ├── type: "subtask"    ← 子任务                                                             
    │     │     ├── type: "step-start" / "step-finish" ← 步骤边界                                           
    │     │     ├── type: "compaction" ← 压缩标记                                                           
    │     │     └── ...                                                                                     
    │     └── More Parts...                                                                                 
    └── More Messages...                     
```



# Session
```typescript
export const Info = Schema.Struct({
  id: SessionID, 				// 唯一表示 id
  slug: Schema.String, 	// 分享连接
  
  projectID: ProjectID, // 所属的项目 id
  workspaceID: optionalOmitUndefined(WorkspaceID), // 工作目录id
  
  directory: Schema.String, // 工作目录
  path: optionalOmitUndefined(Schema.String),
  
  parentID: optionalOmitUndefined(SessionID), // 父对话（用于 fork）
  
  summary: optionalOmitUndefined(Summary), // 代码修改统计（增删行数/文件数）
  
  share: optionalOmitUndefined(Share),
  
  title: Schema.String, // 会话标题
  
  version: Schema.String, // openCode 版本
  
  time: Time, // 时间戳（创建/更新/归档）
  
  permission: optionalOmitUndefined(Permission.Ruleset), // 会话权限
  
  revert: optionalOmitUndefined(Revert), // 回滚快照（消息ID/代码diff）
})
```

<!-- 这是一张图片，ocr 内容为： -->
![](https://cdn.nlark.com/yuque/0/2026/png/46998893/1779344081244-e375c988-59a8-4e32-94fd-3440c8451841.png)



# MessageV2
```typescript
const messageBase = {
  id: MessageID,
  sessionID: SessionID,
}

// User Message
export const User = Schema.Struct({
  ...messageBase,
  role: Schema.Literal("user"), // role 区分 user、ai
  
  time: Schema.Struct({
    created: Schema.Number,
  }),

  // 输出格式要求：（text/json_schema）
  format: Schema.optional(_Format), 

  // 摘要总结
  summary: Schema.optional(
    Schema.Struct({
      title: Schema.optional(Schema.String),
      body: Schema.optional(Schema.String),
      diffs: Schema.Array(Snapshot.FileDiff),
    }),
  ),
  
  agent: Schema.String, // 使用的 Agent 
  
  model: Schema.Struct({ // 使用的 模型
    providerID: ProviderID,
    modelID: ModelID,
    variant: Schema.optional(Schema.String),
  }),

   // 系统提示词（首次消息时携带）
  system: Schema.optional(Schema.String),

  // 禁用的工具列表 
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)), 
})

// AI Message
export const Assistant = Schema.Struct({
  ...messageBase,
  role: Schema.Literal("assistant"), // role 区分 user、ai
  
  time: Schema.Struct({
    created: Schema.Number,
    completed: Schema.optional(Schema.Number),
  }),

  // 错误信息
  error: Schema.optional(Schema.Any.annotate({ [ZodOverride]: AssistantErrorZod })),

  // 对应的 User 消息 ID（一对一的问答关系）
  parentID: MessageID,
  
  modelID: ModelID,
  providerID: ProviderID,
  /**
   * @deprecated
   */
  mode: Schema.String,
  agent: Schema.String,

  // 执行时的目录
  path: Schema.Struct({
    cwd: Schema.String,
    root: Schema.String,
  }),
  summary: Schema.optional(Schema.Boolean),

  // 费用
  cost: Schema.Number,

  // token 统计
  tokens: Schema.Struct({
    total: Schema.optional(Schema.Number),
    input: Schema.Number,
    output: Schema.Number,
    reasoning: Schema.Number,
    cache: Schema.Struct({
      read: Schema.Number,
      write: Schema.Number,
    }),
  }),

  // 结构化结果
  structured: Schema.optional(Schema.Any),
  variant: Schema.optional(Schema.String),
  finish: Schema.optional(Schema.String),
})
```



系统中的 Message 不单独使用，配合 part 一起使用。

```typescript
export type Info = User | Assistant

export type WithParts = {
  info: Info
  parts: Part[]
}
```



# Part
part 是最小交互的片段，通过 type 字段区分不同的 Part

```typescript
export type Part =
  | TextPart
  | SubtaskPart
  | ReasoningPart
  | FilePart
  | ToolPart
  | StepStartPart
  | StepFinishPart
  | SnapshotPart
  | PatchPart
  | AgentPart
  | RetryPart
  | CompactionPart

// 所有 Part 共享基础字段
const partBase = {
  id: PartID,
  sessionID: SessionID,
  messageID: MessageID,
}

// TextPart —— 文本内容
export const TextPart = Schema.Struct({
  ...partBase,
  type: Schema.Literal("text"),
  text: Schema.String,

// 系统自动插入的文本（如 <system-reminder>）   
  synthetic: Schema.optional(Schema.Boolean),

  // 标记为不发送给模型（如 system reminder 的历史记录）
  ignored: Schema.optional(Schema.Boolean),
  
  time: Schema.optional(
    Schema.Struct({
      start: Schema.Number,
      end: Schema.optional(Schema.Number),
    }),
  ),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
})

// ToolPart —— 工具调用
export const ToolPart = Schema.Struct({
  ...partBase,
  type: Schema.Literal("tool"),
  
  callID: Schema.String,
  tool: Schema.String,

  // 内置状态机
  state: _ToolState,
  
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
})
// Tool 的状态机
const _ToolState = Schema.Union([
  ToolStatePending, /*等待执行*/
  ToolStateRunning, /*执行中*/
  ToolStateCompleted,  /*执行成功*/
  ToolStateError /*执行失败*/
])

// ReasoningPart —— 推理过程 
export const ReasoningPart = Schema.Struct({
  ...partBase,
  type: Schema.Literal("reasoning"),
  
  text: Schema.String,
  
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
  time: Schema.Struct({
    start: Schema.Number,
    end: Schema.optional(Schema.Number),
  }),
})

// FilePart —— 文件附件
export const FilePart = Schema.Struct({
  ...partBase,
  type: Schema.Literal("file"),
  mime: Schema.String,
  filename: Schema.optional(Schema.String),
  url: Schema.String,
  source: Schema.optional(_FilePartSource),
})
//source 有三种：                                                                                           
//  - FileSource: 来自文件路径                                                                                
//  - SymbolSource: 来自代码符号（通过 LSP）                                                                  
//  - ResourceSource: 来自 MCP 资源



export const SnapshotPart = Schema.Struct({
  ...partBase,
  type: Schema.Literal("snapshot"),
  snapshot: Schema.String,
})

export const PatchPart = Schema.Struct({
  ...partBase,
  type: Schema.Literal("patch"),
  hash: Schema.String,
  files: Schema.Array(Schema.String),
})
```

<!-- 这是一张图片，ocr 内容为： -->
![](https://cdn.nlark.com/yuque/0/2026/png/46998893/1779345855680-75c60f00-66ac-47b9-8e24-de6a5e0cc3a6.png)



# 整体架构
```plain
               Session.Service
                       │                                                                          
            ┌──────────┼──────────┐                                                               
            │          │          │                                                               
         create()   fork()    messages()                                                          
            │          │          │                                                               
            ▼          ▼          ▼                                                               
       SyncEvent  + BusEvent   stream()                                                           
            │                   │                                                                 
            ▼                   ▼                                                                 
      SQLite DB           page() → hydrate()                                                      
      (3 tables)              │                                                                   
            │                 ▼                                                                   
            └──────→  WithParts[]  ←── 唯一对外数据结构                                           
                            │                                                                     
                            ▼                                                                     
                  { info: User | Assistant,                                                       
                    parts: [TextPart | ToolPart | ...] }                                          
                            │                                                                     
                            ▼                                                                     
                 toModelMessagesEffect()  
    【将 WithParts[] 转换为 Vercel AI SDK 的 ModelMessage[]】
                            │                                                                     
                            ▼                                                                     
                  ModelMessage[]  (Vercel AI SDK)                                                 
                            │                                                                     
                            ▼                                                                     
                      LLM Provider   
```

