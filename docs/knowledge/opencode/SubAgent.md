```typescript
  子 Agent 不是独立的进程或线程，而是一个共享同一套基础设施但权限受限的新 Session。
    

  核心链路：                                  
                                                                                                                               
  主 Session（Agent: build）
    │  LLM 决定调用 TaskTool(subagent_type="explore")                                                                          
    │                                                                                                                          
    ▼                                                                                                                          
  TaskTool.execute()                                                                                                           
    │  1. agent.get("explore") → 找到 subagent 定义                                                                            
    │  2. sessions.create({ parentID: 主SessionID })                                                                           
    │  3. ops.prompt({ sessionID: 子SessionID, agent: "explore" })                                                             
    │  4. 等待子 session 完成                                                                                                  
    │  5. 返回 <task_result>...</task_result>                                                                                  
    ▼                                                                                                                          
  主 Session 继续  
```



# Agent 的定义
```typescript
export const Info = Schema.Struct({
  
  // Agent 名称
  name: Schema.String,
  // Agent 的描述
  description: Schema.optional(Schema.String),
  
  // Agent 的模式：主 Agent/子 Agent
  mode: Schema.Literals(["subagent", "primary", "all"]), 
  // 是否内置（True：opencode 内置）
  native: Schema.optional(Schema.Boolean), 
  hidden: Schema.optional(Schema.Boolean),
  topP: Schema.optional(Schema.Number),
  temperature: Schema.optional(Schema.Number),
  color: Schema.optional(Schema.String),

  // 权限隔离
  permission: Permission.Ruleset,

  // 使用的模型
  model: Schema.optional(
    Schema.Struct({
      modelID: ModelID,
      providerID: ProviderID,
    }),
  ),
  variant: Schema.optional(Schema.String),

  //  自定义系统提示词
  prompt: Schema.optional(Schema.String),
  options: Schema.Record(Schema.String, Schema.Unknown),
  steps: Schema.optional(Schema.Number),
})
```

内置 8 个 Agent：与用户直接交互的 Agent 有 build、plan

<!-- 这是一张图片，ocr 内容为： -->
![](https://cdn.nlark.com/yuque/0/2026/png/46998893/1779348186315-03a25c29-0266-4f4d-9319-d42fbda914b4.png)



# SubAgent 权限来源
## 默认的权限
```typescript
const defaults = Permission.fromConfig({                                                                                     
  "*": "allow",                    // 默认所有工具允许                                                                       
  doom_loop: "ask",                // 死循环检测 → 询问                                                                      
  external_directory: {                                                                                                      
    "*": "ask",                    // 外部目录默认询问                                                                       
    ...whitelistedDirs,            // truncation 目录 + skill 目录 → allow                                                   
  },                                                                                                                         
  question: "deny",                // 反问用户 → 禁止                                                                        
  plan_enter: "deny",              // 进入计划模式 → 禁止                                                                    
  plan_exit: "deny",               // 退出计划模式 → 禁止                                                                    
  read: {                                                                                                                    
    "*": "allow",                  // 读文件默认允许                                                                         
    "*.env": "ask",                // .env 文件 → 询问                                                                       
    "*.env.*": "ask",                                                                                                        
    "*.env.example": "allow",     // 示例 env 文件除外                                                                       
  },                                                                                                                         
})
```



## 用户全局配置的权限
```typescript
const user = Permission.fromConfig(cfg.permission ?? {})
```



## 初始化内置 Agent 
以 explore 为例:

```typescript
explore: {
  name: "explore",

  // 权限合并
  permission: Permission.merge(
    defaults,
    Permission.fromConfig({
      "*": "deny", // ← 全部禁止（覆盖 defaults 的 "*": "allow"）
      grep: "allow", // 只允许以下的 Tool
      glob: "allow",
      list: "allow",
      bash: "allow",
      webfetch: "allow",
      websearch: "allow",
      codesearch: "allow",
      read: "allow",
      external_directory: {
        "*": "ask",
        ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
      },
    }),
    user,
  ),
```



## 创建子 Agent 
taskTool 中创建子 Agent 时，追加权限：

+ 子 Agent 没有 todowrite/task 的权限，防止无限生成子 Agent【防止无限嵌套】

```typescript
const nextSession =
  session ??
  (yield* sessions.create({
    // 父子关联
    parentID: ctx.sessionID,
    
    title: params.description + ` (@${next.name} subagent)`,
    
    permission: [
      // 子 agent 没有 todowrite 权限 → 追加 deny
      ...(canTodo
          ? []
          : [
            {
              permission: "todowrite" as const,
              pattern: "*" as const,
              action: "deny" as const,
            },
          ]),
      // 子 agent 没有 task 权限 → 追加 deny，防止无限嵌套
      ...(canTask
          ? []
          : [
            {
              permission: id,
              pattern: "*" as const,
              action: "deny" as const,
            },
          ]),
      // experimental: 强制开放 primary_tools 列表中的工具
      ...(cfg.experimental?.primary_tools?.map((item) => ({
        pattern: "*",
        action: "allow" as const,
        permission: item,
      })) ?? []),
    ],
  }))
```



## 权限合并顺序
```typescript
const rule = evaluate(request.permission, pattern, ruleset, approved)
```

```plain
其中 ruleset 是调用 ctx.ask() 时传入的，由 processor.ts 传入：                                                               

  session.permission   (来自 TaskTool 创建时)                                                                            
  +                                                                                                                     
  agent.permission     (来自 Agent 定义)                                                                   
  +                                                                                                                     
  approved             (来自数据库，用户之前选 "Always" 的规则)
```



## 权限完整的叠加顺序
```plain
  [defaults]                                                                                                                   
    "*": allow                                                                                                                 
    question: deny                                                                                                             
    plan_enter: deny                                                                                                           
    external_directory: { "*": ask, ...whitelist: allow }                                                                      
    read: { "*": allow, "*.env": ask, "*.env.*": ask }                                                                         
                                                                                                                               
  [explore 专属]                                                                                                               
    "*": deny           ← 覆盖 defaults 的 "*": allow                                                                          
    grep: allow                                                                                                                
    glob: allow                                                                                                                
    list: allow                                                                                                                
    bash: allow                                                                                                                
    webfetch: allow                                                                                                            
    websearch: allow                                                                                                           
    codesearch: allow                                                                                                          
    read: allow                                                                                                                
    external_directory: { "*": ask, ...whitelist: allow }                                                                      
                                                                                                                               
  [user 配置]           ← 用户可覆盖任何规则                                                                                   
                                                                                                                               
  [session 层]                                                                                                                 
    task: deny          ← 防止子 agent 再创建孙 agent
    todowrite: deny     ← 禁止 todo 工具                                                                                       
                                                                                                                               
  [approved]            ← 用户运行时选的 "Always allow"
```

最终效果：

+ explore 只能 `grep/glob/read/bash/webfetch/websearch/codesearch`              
+ 不能 `edit/write/task/todowrite/question/plan`





<!-- 这是一张图片，ocr 内容为： -->
![](https://cdn.nlark.com/yuque/0/2026/png/46998893/1779350233991-1601b4df-a3f6-4f92-898b-5c13634284a6.png)

各层在 `evaluate()` 的 `findLast` 匹配下，**越后面追加的规则优先级越高**



# TaskTool
TaskTool 本身不调用 LLM，通过 `TaskPromptOps` 接口委托给 `SessionPrompt.prompt()`

```typescript
import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
import { Effect, Schema } from "effect"

export interface TaskPromptOps {
  cancel(sessionID: SessionID): void
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<MessageV2.WithParts>
}

const id = "task"

export const Parameters = Schema.Struct({
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
})

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const next = yield* agent.get(params.subagent_type)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
      }

      const canTask = next.permission.some((rule) => rule.permission === id)
      const canTodo = next.permission.some((rule) => rule.permission === "todowrite")

      const taskID = params.task_id
      const session = taskID
        ? yield* sessions.get(SessionID.make(taskID)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${next.name} subagent)`,
          permission: [
            ...(canTodo
                ? []
                : [
                  {
                    permission: "todowrite" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(canTask
                ? []
                : [
                  {
                    permission: id,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(cfg.experimental?.primary_tools?.map((item) => ({
              pattern: "*",
              action: "allow" as const,
              permission: item,
            })) ?? []),
          ],
        }))

      const msg = yield* Effect.sync(() => MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }))
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))

      const model = next.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      yield* ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: nextSession.id,
          model,
        },
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))

      const messageID = MessageID.ascending()

      function cancel() {
        ops.cancel(nextSession.id)
      }

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", cancel)
        }),
        () =>
          // 通过 TaskPromptOps 接口委托给 SessionPrompt(具体实现在 session/prompt.ts)
          Effect.gen(function* () {
            const parts = yield* ops.resolvePromptParts(params.prompt)
            const result = yield* ops.prompt({
              messageID, // 新消息 ID
              sessionID: nextSession.id, // 子 session
              model: {
                modelID: model.modelID,
                providerID: model.providerID,
              },
              
              agent: next.name, // 子 agent 名（如 "explore"）
              tools: {
                ...(canTodo ? {} : { todowrite: false }),
                ...(canTask ? {} : { task: false }),
                ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
              },

              // 用户任务描述
              parts,
            })

            return {
              title: params.description,
              metadata: {
                sessionId: nextSession.id,
                model,
              },
              output: [
                // 子 Session ID，用于后续 resume（继续同一个子 Agent 会话，保持上下文）
                `task_id: ${nextSession.id} (for resuming to continue this task if needed)`,
                "",
                // 主 Agent 只需要读取最后一条 text part
                "<task_result>",
                result.parts.findLast((item) => item.type === "text")?.text ?? "",
                "</task_result>",
              ].join("\n"),
            }
          }),
        () =>
          Effect.sync(() => {
            ctx.abort.removeEventListener("abort", cancel)
          }),
      )
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)

```



## 并发控制
```typescript
 主 Session (Runner busy)
    │                                                                                                                          
    ├─ 调用 TaskTool                                                                                                           
    │    │                                                                                                                     
    │    ├─ 子 Session (另一个 Runner，独立 busy 状态)                                                                         
    │    │    ├─ 调用 LLM                                                                                                      
    │    │    ├─ 可能递归调用更多子 Agent                                                                                      
    │    │    └─ 完成，返回结果                                                                                                
    │    │                                                                                                                     
    │    └─ 子 Runner idle → 自动删除                                                                                          
    │                                                                                                                          
    └─ 主 Runner 继续处理 tool result                                                                                          
                                                                                                                               
  每个 SessionID 对应一个独立的 Runner（run-state.ts）：                                                                       
  - Singleton：同一个 Session 不能并发执行（BusyError）                                                                        
  - 父子独立：主 Session 和子 Session 的 Runner 互不干扰                                                                       
  - 自动销毁：onIdle 时自动从 Map 中删除 
```

Runner 会在任务完成后自动删除。但 **Session 本身（数据库记录）不会删**，保留在历史中（用于后续 resume）



```typescript
//run-state.ts:84-96：
const next = Runner.make<MessageV2.WithParts>(data.scope, {                                                                  
  onIdle: Effect.gen(function* () {
    // 任务结束 → 从 Map 中删除 Runner                                               
    data.runners.delete(sessionID)        
    yield* status.set(sessionID, { type: "idle" })                                                                           
  }),                                                                                                                        
  onBusy: status.set(sessionID, { type: "busy" }),                                                                           
  // ...                                                                                                                     
})

data.runners.set(sessionID, next)                                                                                            

子 Session 的 prompt() 执行完毕 → Runner 进入 idle 状态 → 
  onIdle 回调触发 → 从 runners Map 中删除 → Runner 实例可被 GC。
```





```typescript
┌─────────────┐    创建       ┌─────────────┐    完成       ┌─────────────┐                                              
│  session   │ ──────────→   │Runner busy   │ ──────────→ │  Runner idle │                                                   
│   不存在     │              │  Session 存在 │             │  Session 仍存在│                                                
└─────────────┘              └─────────────┘              └─────────────┘                                                    
                                    │                            │                                                           
                                    │  abort/cancel              │ resume (复用 Session，                                    
                                    ▼                            │ 创建新 Runner)                                            
                              ┌─────────────┐                                                                             
                              │  Runner 删除  │                                                                        
                              │  Session 仍在 │                                                                              
                              └─────────────┘  
```



## 中止传播
```typescript
  TaskTool 通过 Effect.acquireUseRelease 注册 abort 监听：                                                                     
                                                                                                                               
  // tool/task.ts                                                                                                      
  return yield* Effect.acquireUseRelease(                                                                                      
    Effect.sync(() => {      
      // 主 session 中止 → 取消子 session 
      ctx.abort.addEventListener("abort", cancel)                                          
    }),                                                                                                                        
    () => Effect.gen(function* () {                                                                                            
      // ... 执行子任务                                                                                                        
    }),                                                                                                                        
    () => Effect.sync(() => {                                                                                                  
      ctx.abort.removeEventListener("abort", cancel)  // 清理                                                                  
    }),                                                                                                                        
  )                                                                                                                            
                                                                                                                               
如果用户在主 Session 按 Ctrl+C，ctx.abort 触发 → ops.cancel(nextSession.id) → 
子 Session 的 Runner 被 cancel → 子 Agent执行中断
```



# 完整时序图
```plain
  ┌─────────────────────┐          ┌──────────────────────┐
  │   主 Session        │          │   子 Session          │                                                                  
  │   (agent: build)    │          │   (agent: explore)   │                                                                    
  └──────────┬──────────┘          └───────────┬──────────┘                                                                    
             │                                 │                                                                               
    LLM: TaskTool(                             │                                                                                 
      subagent_type="explore",                 │                                                                                
      prompt="find API routes"                 │                                                                                 
    )                                          │                                                                                
             │                                 │                                                                               
             ├─ agent.get("explore")           │                                                                               
             ├─ sessions.create({              │                                                                               
             │    parentID,                    │                                                                               
             │    permission: [task: deny]     │                                                                               
             │  })                             │                                                                               
             ├─ register abort listener ─────► │                                                                               
             ├─ ops.prompt({                   │                                                                               
             │    sessionID,                   │                                                                               
             │    agent: "explore",            │                                                                               
             │    model, parts, tools          │                                                                               
             │  })                             │                                                                               
             │───────── prompt() ──────────────►│                                                                              
             │                                 ├─ 创建 UserMessage                                                             
             │                                 ├─ loop() → runLoop()                                                           
             │                                 ├─ sys.skills("explore")                                                        
             │                                 ├─ ToolRegistry.tools(...)                                                      
             │                                 │  → explore 只能看到部分工具                                                   
             │                                 ├─ LLM: Read(), Grep(), Glob()...                                               
             │                                 ├─ 完成                                                                         
             │ ◄── return WithParts ──────────┤                                                                                
             │                                                                                                                
             ├─ 注销 abort listener                                                                                         
             ├─ 返回 <task_result>                                                                                           
             │                                                                                                                
    LLM 收到 tool result:                                                                                                     
    "task_id: xxx, <task_result>                                                                                              
     API routes in src/routes/..."                                                                                            
             │                                                                                                                
    LLM 继续回答用户                                     
```

+ 子 Agent 不是特殊实体，就是**另一个 Session 上跑了一次完整的 **`prompt() → loop() → runLoop()`。
+ 隔离完全靠 `agent.permission` 和 `tools` 参数的差异

