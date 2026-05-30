OpenCode 中的 Tool 有 3 层：**定义抽象** → **注册中心** → **具体实现**

```plain
Tool.define(id, init)  ──→  Tool.Info  ──→  Tool.init()  ──→  Tool.Def
       工厂函数              懒加载定义                   具体工具实例
```



# Tool 的设计
## Tool 的定义
OpenCode 中一个标准的 Tool 定义如下：

```typescript
// Tool 工具的标准接口
export interface Def<
  Parameters extends Schema.Decoder<unknown> = Schema.Decoder<unknown>,
  M extends Metadata = Metadata,
  > {
  
  id: string // 唯一标识，如 "read", "bash"
  description: string // LLM 可见的工具描述
  parameters: Parameters // 工具参数
  
  execute(args, ctx): Effect.Effect<ExecuteResult<M>> // 核心执行逻辑，返回 Effect<ExecuteResult>
}
```



## Tool 的 Info、Init
```typescript
// Tool.Info
export interface Info<
  Parameters extends Schema.Decoder<unknown> = Schema.Decoder<unknown>,
  M extends Metadata = Metadata,
> {
  id: string
  init: () => Effect.Effect<DefWithoutID<Parameters, M>>
}

// Tool.Init
type Init<Parameters extends Schema.Decoder<unknown>, M extends Metadata> =
  | DefWithoutID<Parameters, M>
  | (() => Effect.Effect<DefWithoutID<Parameters, M>>)
```

Tool.Info：懒加载包装 `init()` 在首次使用时才被调用，避免启动时加载所有工具的依赖。



## ToolContex 工具执行上下文
```typescript
// 工具执行上下文
export type Context<M extends Metadata = Metadata> = {
  // 当前对话信息
  sessionID: SessionID 
  messageID: MessageID
  agent: string // 当前会话绑定的 Agent

  abort: AbortSignal // 中止信号
  callID?: string // 调用 Tool ID
  
  extra?: { [key: string]: unknown }
  messages: MessageV2.WithParts[]

  // 推送实时元数据到 TUI（如 bash 实时输出预览）
  metadata(input: { title?: string; metadata?: M }): Effect.Effect<void>
  
  // 向用户申请权限（如读文件前申请 read 权限）
  ask(input: Omit<Permission.Request, "id" | "sessionID" | "tool">): Effect.Effect<void>
}
```



## wrap 包装 Tool （切面）
wrap 函数为每个工具注入 2 个功能：参数校验，输出截断

```typescript
function wrap<Parameters extends Schema.Decoder<unknown>, Result extends Metadata>(
  id: string,
  init: Init<Parameters, Result>,
  truncate: Truncate.Interface,
  agents: Agent.Interface,
) {
  return () =>
    Effect.gen(function* () {
      const toolInfo = typeof init === "function" ? { ...(yield* init()) } : { ...init }

      // Compile the parser closure once per tool init; `decodeUnknownEffect`
      // allocates a new closure per call, so hoisting avoids re-closing it for
      // every LLM tool invocation.
      // 参数校验
      const decode = Schema.decodeUnknownEffect(toolInfo.parameters)

      // 执行工具逻辑
      const execute = toolInfo.execute
      toolInfo.execute = (args, ctx) => {
        const attrs = {
          "tool.name": id,
          "session.id": ctx.sessionID,
          "message.id": ctx.messageID,
          ...(ctx.callID ? { "tool.call_id": ctx.callID } : {}),
        }
        return Effect.gen(function* () {
          const decoded = yield* decode(args).pipe(
            Effect.mapError((error) =>
              toolInfo.formatValidationError
              ? new Error(toolInfo.formatValidationError(error), { cause: error })
              : new Error(
                `The ${id} tool was called with invalid arguments: ${error}.\nPlease rewrite the input so it satisfies the expected schema.`,
                { cause: error },
              ),
                           ),
          )
          const result = yield* execute(decoded as Schema.Schema.Type<Parameters>, ctx)
          if (result.metadata.truncated !== undefined) {
            return result
          }

          // 输出截断
          const agent = yield* agents.get(ctx.agent)
          const truncated = yield* truncate.output(result.output, {}, agent)
          return {
            ...result,
            output: truncated.content,
            metadata: {
              ...result.metadata,
              truncated: truncated.truncated,
              ...(truncated.truncated && { outputPath: truncated.outputPath }),
            },
          }
        }).pipe(Effect.orDie, Effect.withSpan("Tool.execute", { attributes: attrs }))
      }
      
      return toolInfo
    })
}

```



# ToolRegistry 注册中心
ToolRegistry.layer 启动时，加载所有工具

```plain
InstanceState.make<State>()  —— 按工作区隔离，单例管理
    ├── 内置工具 (16个)
    │     invalid, bash, read, glob, grep, edit, write,
    │     task, webfetch, todowrite, websearch, codesearch,
    │     skill, apply_patch, question*, lsp*, plan*
    │     (* 条件启用)
    │
    ├── 自定义工具
    │     {tool,tools}/*.{js,ts} 文件 → dynamic import
    │
    └── 插件工具
          plugin.list() → p.tool
```



Registry 对外披露的接口：

```typescript
export interface Interface {
  // 返回 builtin + custom 全部工具 
  readonly ids: () => Effect.Effect<string[]> 

  // 获取所有的工具定义
  readonly all: () => Effect.Effect<Tool.Def[]>

  // 获取特定 TaskTool 和 ReadTool 实例
  readonly named: () => Effect.Effect<{ task: TaskDef; read: ReadDef }>

  // 过滤后的工具列表（根据模型、权限规则），并注入动态描述（TaskTool/SkillTool）    
  readonly tools: (model: { providerID: ProviderID; modelID: ModelID; agent: Agent.Info }) => Effect.Effect<Tool.Def[]>
}
```



## Tool 实现
以 ReadTool 为例子，看看具体的 Tool 是怎么实现的

```typescript
  export const ReadTool = Tool.define("read", Effect.gen(function* () {
    // 1. 获取依赖服务
    const fs = yield* AppFileSystem.Service

    // 2. 定义内部 Effect 函数
    const run = Effect.fn("ReadTool.execute")(function* (params, ctx) {
      // 3. 参数校验
      if (params.offset < 1) return yield* Effect.fail(...)

      // 4. 权限申请
      yield* ctx.ask({ permission: "read", patterns: [filepath], ... })

      // 5. 业务逻辑
      const content = yield* fs.readFile(filepath)

      // 6. 返回结果
      return { title, output, metadata: { preview, truncated, loaded } }
    })

    return {
      description: DESCRIPTION,  // 来自 .txt 文件
      parameters: Parameters,    // Schema.Struct({...})
      execute: (params, ctx) => run(params, ctx).pipe(Effect.orDie),
    }
  }))
```



```plain
Read a file or directory from the local filesystem. If the path does not exist, an error is returned.

Usage:
- The filePath parameter should be an absolute path.
- By default, this tool returns up to 2000 lines from the start of the file.
- The offset parameter is the line number to start from (1-indexed).
- To read later sections, call this tool again with a larger offset.
- Use the grep tool to find specific content in large files or files with long lines.
- If you are unsure of the correct file path, use the glob tool to look up filenames by glob pattern.
- Contents are returned with each line prefixed by its line number as `<line>: <content>`. For example, if a file has contents "foo\n", you will receive "1: foo\n". For directories, entries are returned one per line (without line numbers) with a trailing `/` for subdirectories.
- Any line longer than 2000 characters is truncated.
- Call this tool in parallel when you know there are multiple files you want to read.
- Avoid tiny repeated slices (30 line chunks). If you need more context, read a larger window.
- This tool can read image files and PDFs and return them as file attachments.

```

# Tool 完整调用链路
```plain
 ToolRegistry.layer 启动
    → Tool.init() 懒加载所有工具
    → InstanceState 按工作区缓存到内存
      → resolveTools() (prompt.ts) 调用 registry.tools(model)
        → 过滤 + 注入动态描述 + 触发 plugin hook "tool.definition"
          → 每个工具包裹 ctx.ask() / ctx.metadata() / run.promise()
            → LLM 选择工具调用
              → execute(args, ctx)
                → wrap() 自动解码参数
                → ctx.ask() 权限检查
                → 业务逻辑
                → truncate.output() 截断
                → 返回 ExecuteResult
```



## resolveTools
解析工具定义

+ 收集 — 从 ToolRegistry 和 MCP 收集所有可用工具
+ 包装 — 为每个工具注入 OpenCode 的运行时上下文（权限、状态回调、插件钩子、Schema 转换）
+ 桥接 — 把 OpenCode 的 Effect 异步模型桥接到 AI SDK 的 async/Promise 模

```typescript

const resolveTools = Effect.fn("SessionPrompt.resolveTools")(function* (input: {
  agent: Agent.Info
  model: Provider.Model
  session: Session.Info
  tools?: Record<string, boolean>
  processor: Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall">
  bypassAgentCheck: boolean
  messages: MessageV2.WithParts[]
}) {
  using _ = log.time("resolveTools")
  const tools: Record<string, AITool> = {}
  const run = yield* runner()
  const promptOps = yield* ops()

  const context = (args: any, options: ToolExecutionOptions): Tool.Context => ({
    sessionID: input.session.id,
    abort: options.abortSignal!,
    messageID: input.processor.message.id,
    callID: options.toolCallId,
    extra: { model: input.model, bypassAgentCheck: input.bypassAgentCheck, promptOps },
    agent: input.agent.name,
    messages: input.messages,
    metadata: (val) =>
      input.processor.updateToolCall(options.toolCallId, (match) => {
        if (!["running", "pending"].includes(match.state.status)) return match
        return {
          ...match,
          state: {
            title: val.title,
            metadata: val.metadata,
            status: "running",
            input: args,
            time: { start: Date.now() },
          },
        }
      }),
    ask: (req) =>
      permission
      .ask({
        ...req,
        sessionID: input.session.id,
        tool: { messageID: input.processor.message.id, callID: options.toolCallId },
        ruleset: Permission.merge(input.agent.permission, input.session.permission ?? []),
      })
      .pipe(Effect.orDie),
  })

  // 内置、自定义工具
  for (const item of yield* registry.tools({
    modelID: ModelID.make(input.model.api.id),
    providerID: input.model.providerID,
    agent: input.agent,
  })) {
    // OpenCode 工具格式转化为 AI SDK 的工具格式
    const schema = ProviderTransform.schema(input.model, EffectZod.toJsonSchema(item.parameters))
    tools[item.id] = tool({
      description: item.description,
      inputSchema: jsonSchema(schema),
      execute(args, options) {
        return run.promise(// Effect → Promise 桥接
          Effect.gen(function* () {
            const ctx = context(args, options)
            // 执行前钩子
            yield* plugin.trigger(
              "tool.execute.before",
              { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID },
              { args },
            )
            // 真正执行 Tool
            const result = yield* item.execute(args, ctx)
            const output = {
              ...result,
              attachments: result.attachments?.map((attachment) => ({
                ...attachment,
                id: PartID.ascending(),
                sessionID: ctx.sessionID,
                messageID: input.processor.message.id,
              })),
            }
            // 后置钩子
            yield* plugin.trigger(
              "tool.execute.after",
              { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID, args },
              output,
            )
            // 如果已被中断，直接写入结果
            if (options.abortSignal?.aborted) {
              yield* input.processor.completeToolCall(options.toolCallId, output)
            }
            return output
          }),
        )
      },
    })
  }

  // MCP 工具
  for (const [key, item] of Object.entries(yield* mcp.tools())) {
    const execute = item.execute
    if (!execute) continue

    const schema = yield* Effect.promise(() => Promise.resolve(asSchema(item.inputSchema).jsonSchema))
    const transformed = ProviderTransform.schema(input.model, schema)
    item.inputSchema = jsonSchema(transformed)
    item.execute = (args, opts) =>
      run.promise(
        Effect.gen(function* () {
          const ctx = context(args, opts)
          yield* plugin.trigger(
            "tool.execute.before",
            { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId },
            { args },
          )
          // MCP 工具默认需要权限
          yield* ctx.ask({ permission: key, metadata: {}, patterns: ["*"], always: ["*"] })
          const result: Awaited<ReturnType<NonNullable<typeof execute>>> = yield* Effect.promise(() =>
            execute(args, opts),
                                                                                                )
          yield* plugin.trigger(
            "tool.execute.after",
            { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId, args },
            result,
          )

          const textParts: string[] = []
          const attachments: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[] = []
          for (const contentItem of result.content) {
            if (contentItem.type === "text") textParts.push(contentItem.text)
            else if (contentItem.type === "image") {
              attachments.push({
                type: "file",
                mime: contentItem.mimeType,
                url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
              })
            } else if (contentItem.type === "resource") {
              const { resource } = contentItem
              if (resource.text) textParts.push(resource.text)
              if (resource.blob) {
                attachments.push({
                  type: "file",
                  mime: resource.mimeType ?? "application/octet-stream",
                  url: `data:${resource.mimeType ?? "application/octet-stream"};base64,${resource.blob}`,
                  filename: resource.uri,
                })
              }
            }
          }

          const truncated = yield* truncate.output(textParts.join("\n\n"), {}, input.agent)
          const metadata = {
            ...result.metadata,
            truncated: truncated.truncated,
            ...(truncated.truncated && { outputPath: truncated.outputPath }),
          }

          const output = {
            title: "",
            metadata,
            output: truncated.content,
            attachments: attachments.map((attachment) => ({
              ...attachment,
              id: PartID.ascending(),
              sessionID: ctx.sessionID,
              messageID: input.processor.message.id,
            })),
            content: result.content,
          }
          if (opts.abortSignal?.aborted) {
            yield* input.processor.completeToolCall(opts.toolCallId, output)
          }
          return output
        }),
      )
    tools[key] = item
  }

  return tools
})
```



# OpenCode 的安全模型
OpenCode 执行工具时，不能给工具敏感操作的权限，如：不经过用户同意直接删掉了文件



OpenCode 采用的是**规则驱动的权限系统** + **工作区目录边界感知**，而非进程级隔离

```typescript
目录边界(external_directory.ts)

Instance.containsPath(filepath)
├── 在 project.directory 内 → 放行
├── 在 git worktree 内     → 放行
└── 都不在                  → 触发 external_directory 权限申请


任何工具读写文件前，都会调用 assertExternalDirectoryEffect()
检查目标路径是否在工作区外。外部路径会弹权限确认。
```



```typescript
Bash 命令解析 (bash.ts + arity.ts)

  用户执行: rm /etc/nginx/nginx.conf

  tree-sitter 解析 AST
    → 识别 rm 属于 FILES 集合（会修改文件）
    → 提取 /etc/nginx/nginx.conf 为受影响路径
    → 不在工作区内 → 触发 external_directory 权限
    → BashArity.prefix("rm") → "rm *" 作为 always 模式

  但 bash 进程本身直接运行在宿主机上，拥有用户完整权限。
  权限系统只是"闸门"，一旦通过，命令就在真实 OS 环境中执行。
```



```typescript
Protected 目录 (file/protected.ts)

  // macOS: 跳过扫描这些目录（TCC 隐私保护相关）
  DARWIN_HOME = ["Music", "Pictures", "Movies", "Downloads", "Desktop",
  "Documents", ...]
  DARWIN_LIBRARY = ["Mail", "Messages", "Safari", "Cookies", "AddressBook", ...]

  这不是沙箱，只是扫描时主动避开 macOS 的 TCC（Transparency, Consent, and
  Control）保护目录，避免触发系统权限弹窗。

  ---
  "sandboxes" 在代码中的含义

  project.ts 中的 sandboxes: string[] 并不是容器，而是 git worktree 目录列表：

  // project.ts
  sandboxes: Schema.Array(Schema.String),  // 就是目录路径数组

  // worktree/index.ts
  yield* project.addSandbox(ctx.project.id, info.directory)
  // 当 EnterWorktree 创建新的 git worktree 时，加入 project 的 sandbox 列表

  它用于追踪"这个 project 有哪些 worktree 目录"，目的是让
  Instance.containsPath() 识别这些 worktree 也属于工作区内。
```

