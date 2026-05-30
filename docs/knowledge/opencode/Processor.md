OpenCode 的核心处理器，负责：

+ **事件翻译** — 把 Vercel AI SDK 的流式事件翻译成 OpenCode 内部的 `MessageV2.Part`，让 TUI 能渲染、让 MessageV2 能持久化
+ **决策信号** — 返回 `compact / stop / continue` 三个信号，驱动 runLoop 的下一步行为
+ **状态管理** — 管理 LLM 调用过程中的临时状态（工具调用、文本、推理、快照、token统计），保证无论成功/失败/中断都能正确收尾



# runLoop、processor 交互
```plain
runLoop (prompt.ts)                        Processor (processor.ts)
  ─────────────────                          ──────────────────────

  step 1: 创建 handle
    handle = processor.create(msg)
      ← 返回 Handle { message, process, updateToolCall, completeToolCall }

    构建 system prompt
    构建 tools → 传入 handle (工具执行时写回状态)
    
    调用 handle.process(input)
      │                                       llm.stream(input)
      │                                         │
      │                                       handleEvent("text-delta")
      │                                         → 写入 TextPart
      │                                         → TUI 实时显示
      │                                         │
      │                                       handleEvent("tool-call")
      │                                         → 创建 ToolPart(running)
      │                                         → doom loop 检测
      │                                         │
      │                                       handleEvent("finish-step")
      │                                         → assistant.finish = "tool-calls"
      │                                         → token/cost 统计
      │                                         │
      │                                       handleEvent("tool-result")
      │                                         → ToolPart(completed)
      │                                         │
      │                                       流结束
      │                                         │
      返回 "continue" ←──────────────────────── cleanup()

    runLoop 读取 handle.message
      → finish="tool-calls"
      → hasToolCalls=true
      → 不退出，continue 下一轮 while

  step 2: (新 assistant message，新 handle)
    ... 同上 ...

    调用 handle.process(input)
      │                                       handleEvent("finish-step")
      │                                         → assistant.finish = "stop"
      │                                         → isOverflow? → needsCompaction
      │                                         │
      返回 "stop" ←── 或 ──→ 返回 "compact" ────┘

    runLoop:
      "stop"    → break (正常退出)
      "compact" → create compaction → continue
      "continue"→ 下一轮 while (工具结果)


```



# processor 核心逻辑
```typescript
// 核心数据结构
interface ProcessorContext {
  assistantMessage   // 当前的 assistant 消息（引用，直接修改）
  toolcalls          // 活跃的工具调用 { callID → { partID, done: Deferred } }
  shouldBreak        // 权限拒绝时是否 break（vs continue）
  snapshot           // 代码快照（用于计算 diff patch）
  blocked            // 是否被权限/问题拒绝
  needsCompaction    // Token 溢出标记
  currentText        // 当前正在接收的 text part
  reasoningMap       // 正在接收的 reasoning parts
}
```



```typescript
// 会话处理器
const process = Effect.fn("SessionProcessor.process")(function* (streamInput: LLM.StreamInput) {
  slog.info("process")
  // 初始化 state
  ctx.needsCompaction = false
  ctx.shouldBreak = (yield* config.get()).experimental?.continue_loop_on_deny !== true

  return yield* Effect.gen(function* () {
    yield* Effect.gen(function* () {
      ctx.currentText = undefined
      ctx.reasoningMap = {}

      // LLM 流
      const stream = llm.stream(streamInput)

      yield* stream.pipe(
        Stream.tap((event) => handleEvent(event)),   // 处理流式事件
        Stream.takeUntil(() => ctx.needsCompaction), // 溢出时截断
        Stream.runDrain,
      )
    }).pipe(
      Effect.onInterrupt(() =>
        Effect.gen(function* () {
          aborted = true
          if (!ctx.assistantMessage.error) {
            yield* halt(new DOMException("Aborted", "AbortError"))
          }
        }),
                        ),
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterruptsOnly(cause),
        (cause) => Effect.fail(Cause.squash(cause)),
      ),
      Effect.retry(
        SessionRetry.policy({
          parse,
          set: (info) =>
            status.set(ctx.sessionID, {
              type: "retry",
              attempt: info.attempt,
              message: info.message,
              next: info.next,
            }),
        }),
      ),
      Effect.catch(halt),
      Effect.ensuring(cleanup()),
    )

    // 返回结果
    if (ctx.needsCompaction) return "compact"
    if (ctx.blocked || ctx.assistantMessage.error) return "stop"
    return "continue"
  })
```



processor.process() 流程图：

```plain
  runLoop 调用 handle.process(input)
           │
           ▼
  ┌─────────────────────────────────────────────────────┐
  │ ① 重置状态: needsCompaction=false, currentText=null │
  │ ② llm.stream(streamInput) → Stream<SSE Event>      │
  │ ③ Stream.tap(handleEvent) → 逐个处理事件             │
  │ ④ Stream.takeUntil(needsCompaction) → 溢出时截断     │
  │ ⑤ Stream.runDrain → 等待流结束或截断                 │
  └─────────────────────────────────────────────────────┘
           │
           │ 流处理过程中可能发生中断/错误
           ▼
  ┌─────────────────────────────────────────────────────┐
  │ 错误处理链 (由外向内):                                │
  │                                                     │
  │ Effect.ensuring(cleanup())     ← 无论成败最终执行     │
  │   Effect.catch(halt)           ← 转为 error state    │
  │     Effect.retry(SessionRetry) ← 可重试错误自动重试   │
  │       Effect.catchCauseIf(...)  ← 非中断错误向上抛    │
  │         Effect.onInterrupt(...) ← Ctrl+C 中断处理    │
  │                                                     │
  │ (内层)  llm.stream → handleEvent → runDrain          │
  └─────────────────────────────────────────────────────┘
           │
           ▼
  ┌─────────────────────────────────────────────────────┐
  │ ② 返回 Result 给 runLoop:                            │
  │   needsCompaction=true? → "compact"                  │
  │   blocked || error?      → "stop"                    │
  │   其他                   → "continue"                 │
  └─────────────────────────────────────────────────────┘
```



返回的 **Result** 直接决定 runLoop 的下一步：

+ process 返回 "continue" → runLoop 下一步 while → 工具结果发回 LLM
+ process 返回 "compact"  → runLoop 创建 compaction → continue
+ process 返回 "stop"     → runLoop break → 退出 while



## HandleEvent
将  Vercel AI SDK 的流式事件转化为 OpenCode 内部的 MessageV2.Part.

事件路由转发：针对不同的 AI SDK 的流式事件，进行不同的处理。

```typescript
// 事件处理器
const handleEvent = Effect.fnUntraced(function* (value: StreamEvent) {
  switch (value.type) {
    case "start":
      yield* status.set(ctx.sessionID, { type: "busy" })
      return

    case "reasoning-start":
      if (value.id in ctx.reasoningMap) return
      ctx.reasoningMap[value.id] = {
        id: PartID.ascending(),
        messageID: ctx.assistantMessage.id,
        sessionID: ctx.assistantMessage.sessionID,
        type: "reasoning",
        text: "",
        time: { start: Date.now() },
        metadata: value.providerMetadata,
      }
      yield* session.updatePart(ctx.reasoningMap[value.id])
      return

    case "reasoning-delta":
      if (!(value.id in ctx.reasoningMap)) return
      ctx.reasoningMap[value.id].text += value.text
      if (value.providerMetadata) ctx.reasoningMap[value.id].metadata = value.providerMetadata
      yield* session.updatePartDelta({
        sessionID: ctx.reasoningMap[value.id].sessionID,
        messageID: ctx.reasoningMap[value.id].messageID,
        partID: ctx.reasoningMap[value.id].id,
        field: "text",
        delta: value.text,
      })
      return

    case "reasoning-end":
      if (!(value.id in ctx.reasoningMap)) return
      // oxlint-disable-next-line no-self-assign -- reactivity trigger
      ctx.reasoningMap[value.id].text = ctx.reasoningMap[value.id].text
      ctx.reasoningMap[value.id].time = { ...ctx.reasoningMap[value.id].time, end: Date.now() }
      if (value.providerMetadata) ctx.reasoningMap[value.id].metadata = value.providerMetadata
      yield* session.updatePart(ctx.reasoningMap[value.id])
      delete ctx.reasoningMap[value.id]
      return

    case "tool-input-start":
      if (ctx.assistantMessage.summary) {
        throw new Error(`Tool call not allowed while generating summary: ${value.toolName}`)
      }
      const part = yield* session.updatePart({
        id: ctx.toolcalls[value.id]?.partID ?? PartID.ascending(),
        messageID: ctx.assistantMessage.id,
        sessionID: ctx.assistantMessage.sessionID,
        type: "tool",
        tool: value.toolName,
        callID: value.id,
        state: { status: "pending", input: {}, raw: "" },
        metadata: value.providerExecuted ? { providerExecuted: true } : undefined,
      } satisfies MessageV2.ToolPart)
      ctx.toolcalls[value.id] = {
        done: yield* Deferred.make<void>(),
        partID: part.id,
        messageID: part.messageID,
        sessionID: part.sessionID,
      }
      return

    case "tool-input-delta":
      return

    case "tool-input-end":
      return

    case "tool-call": {
      // Doom Loop 检测
      if (ctx.assistantMessage.summary) {
        throw new Error(`Tool call not allowed while generating summary: ${value.toolName}`)
      }
      yield *
        updateToolCall(value.toolCallId, (match) => ({
          ...match,
          tool: value.toolName,
          state: {
            ...match.state,
            status: "running",
            input: value.input,
            time: { start: Date.now() },
          },
          metadata: match.metadata?.providerExecuted
            ? { ...value.providerMetadata, providerExecuted: true }
            : value.providerMetadata,
        }))

      // 检查最近 3 个工具调用
      const parts = MessageV2.parts(ctx.assistantMessage.id)
      const recentParts = parts.slice(-DOOM_LOOP_THRESHOLD)

      if (
        recentParts.length !== DOOM_LOOP_THRESHOLD ||
        !recentParts.every(
          (part) =>
            part.type === "tool" &&
            part.tool === value.toolName &&
            part.state.status !== "pending" &&
            JSON.stringify(part.state.input) === JSON.stringify(value.input),
        )
      ) {
        return
      }

      // 如果都是同一个工具 + 相同输入
      const agent = yield * agents.get(ctx.assistantMessage.agent)
      // 触发权限询
      yield *
        permission.ask({
          permission: "doom_loop",
          patterns: [value.toolName],
          sessionID: ctx.assistantMessage.sessionID,
          metadata: { tool: value.toolName, input: value.input },
          always: [value.toolName],
          ruleset: agent.permission,
        })
      return
    }

    case "tool-result": {
      yield* completeToolCall(value.toolCallId, value.output)
      return
    }

    case "tool-error": {
      yield* failToolCall(value.toolCallId, value.error)
      return
    }

    case "error":
      throw value.error

    case "start-step":
      if (!ctx.snapshot) ctx.snapshot = yield* snapshot.track()
      yield* session.updatePart({
        id: PartID.ascending(),
        messageID: ctx.assistantMessage.id,
        sessionID: ctx.sessionID,
        snapshot: ctx.snapshot,
        type: "step-start",
      })
      return

    case "finish-step": {
      const usage = Session.getUsage({
        model: ctx.model,
        usage: value.usage,
        metadata: value.providerMetadata,
      })
      // runLoop 是否结束
      ctx.assistantMessage.finish = value.finishReason
      ctx.assistantMessage.cost += usage.cost // 花费
      ctx.assistantMessage.tokens = usage.tokens // token 数
      yield* session.updatePart({
        id: PartID.ascending(),
        reason: value.finishReason,
        snapshot: yield* snapshot.track(),
        messageID: ctx.assistantMessage.id,
        sessionID: ctx.assistantMessage.sessionID,
        type: "step-finish",
        tokens: usage.tokens,
        cost: usage.cost,
      })
      yield* session.updateMessage(ctx.assistantMessage)
      if (ctx.snapshot) {
        const patch = yield* snapshot.patch(ctx.snapshot)
        if (patch.files.length) {
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: ctx.assistantMessage.id,
            sessionID: ctx.sessionID,
            type: "patch",
            hash: patch.hash,
            files: patch.files,
          })
        }
        ctx.snapshot = undefined
      }
      yield* summary
        .summarize({
          sessionID: ctx.sessionID,
          messageID: ctx.assistantMessage.parentID,
        })
        .pipe(Effect.ignore, Effect.forkIn(scope))
      
      if (
        !ctx.assistantMessage.summary &&
        isOverflow({ cfg: yield* config.get(), tokens: usage.tokens, model: ctx.model })
      ) {
        // 需要压缩 -> 下一轮 runLoop 会创建 compaction
        ctx.needsCompaction = true
      }
      return
    }

    case "text-start":
      ctx.currentText = {
        id: PartID.ascending(),
        messageID: ctx.assistantMessage.id,
        sessionID: ctx.assistantMessage.sessionID,
        type: "text",
        text: "",
        time: { start: Date.now() },
        metadata: value.providerMetadata,
      }
      yield* session.updatePart(ctx.currentText)
      return

    case "text-delta":
      if (!ctx.currentText) return
      ctx.currentText.text += value.text
      if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
      yield* session.updatePartDelta({
        sessionID: ctx.currentText.sessionID,
        messageID: ctx.currentText.messageID,
        partID: ctx.currentText.id,
        field: "text",
        delta: value.text,
      })
      return

    case "text-end":
      if (!ctx.currentText) return
      // oxlint-disable-next-line no-self-assign -- reactivity trigger
      ctx.currentText.text = ctx.currentText.text
      ctx.currentText.text = (yield* plugin.trigger(
        "experimental.text.complete",
        {
          sessionID: ctx.sessionID,
          messageID: ctx.assistantMessage.id,
          partID: ctx.currentText.id,
        },
        { text: ctx.currentText.text },
      )).text
      {
        const end = Date.now()
        ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
      }
      if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
      yield* session.updatePart(ctx.currentText)
      ctx.currentText = undefined
      return

    case "finish":
      return

    default:
      slog.info("unhandled", { event: value.type, value })
      return
  }
})

```



```plain
    SSE 事件                    Processor 动作                 runLoop 可见
  ─────────                   ──────────────                 ────────────
  start                       → 状态设为 busy
  reasoning-start/delta/end   → 创建/更新 ReasoningPart       (TUI 可渲染)
  text-start/delta/end        → 创建/更新 TextPart            handle.message.parts
  tool-input-start            → 创建 ToolPart(pending)       handle.message.parts
  tool-call                   → 更新 ToolPart(running)       handle.message.parts
                                 + doom loop 检测
  tool-result                 → 更新 ToolPart(completed)     handle.message.parts
  tool-error                  → 更新 ToolPart(error)         handle.message.parts
  start-step                  → 创建 StepStartPart           代码快照
  finish-step                 → 设置 assistant.finish        ← runLoop 退出判断依据
                                 + 计算 token/cost
                                 + 生成代码 patch (diff)
                                 + 检查 overflow → needsCompaction
  error                       → throw error (进入重试链)
```



## DoomLoop 检测
AI SDK 返回的事件类型为 "tool-call"时，进行 DoomLoop 检测，防止 AI 死循环，反复调用一个 Tool

```plain
Doom Loop 检测 (L336-365)

  最近 3 个 tool call 都是:
    同一个工具 + 相同参数 + 状态不是 pending?
      │
      YES → permission.ask("doom_loop")
      │       → 用户批准 → 继续执行
      │       → 用户拒绝 → 工具调用失败 (failToolCall)
      │
      NO  → 正常执行

  防止 AI 陷入死循环（反复调同一个工具、同样的参数），一旦检测到就拉起权限询问用户。
```



```typescript
case "tool-call": {
  if (ctx.assistantMessage.summary) {
    throw new Error(`Tool call not allowed while generating summary: ${value.toolName}`)
  }
  yield *
    updateToolCall(value.toolCallId, (match) => ({
      ...match,
      tool: value.toolName,
      state: {
        ...match.state,
        status: "running",
        input: value.input,
        time: { start: Date.now() },
      },
      metadata: match.metadata?.providerExecuted
        ? { ...value.providerMetadata, providerExecuted: true }
        : value.providerMetadata,
    }))

  // 检查最近 3 个工具调用（检查工具数量由 DOOM_LOOP_THRESHOLD 控制）
  const parts = MessageV2.parts(ctx.assistantMessage.id)
  const recentParts = parts.slice(-DOOM_LOOP_THRESHOLD)

  // 最近 parts 数不够 3 个 ||
  // !(最近 parts 都是 "tool" && 最近每个part的toolName相同 &&
  // 最近part的状态都不是 "pending" && 最近每个part的参数都相同)
  if (
    recentParts.length !== DOOM_LOOP_THRESHOLD ||
    !recentParts.every(
      (part) =>
        part.type === "tool" &&
        part.tool === value.toolName &&
        part.state.status !== "pending" &&
        JSON.stringify(part.state.input) === JSON.stringify(value.input),
    )
  ) {
    // 最近使用的不是同一个工具
    return
  }

  // 到这里说明 都是同一个工具 + 相同输入
  // 拉起权限询问用户
  const agent = yield * agents.get(ctx.assistantMessage.agent)
  yield *
    permission.ask({
      permission: "doom_loop",
      patterns: [value.toolName],
      sessionID: ctx.assistantMessage.sessionID,
      metadata: { tool: value.toolName, input: value.input },
      always: [value.toolName],
      ruleset: agent.permission,
    })
  return
}
```



## Tool 生命周期
```typescript
工具调用生命周期(OpenCode的状态机)

  LLM 决定调工具
    │
    ▼
  tool-input-start  → 创建 ToolPart (pending)
    │                  → ctx.toolcalls[callID] = { done: Deferred }
    │
    ▼
  tool-call         → ToolPart 状态变为 running
    │                 → AI SDK 同步或 prompt.ts 异步执行工具
    │                   工具执行时会调 handle.updateToolCall / completeToolCall
    ▼
  tool-result       → ToolPart 状态变为 completed
    │                  → Deferred.succeed(done) 唤醒
    │
    或
    ▼
  tool-error        → ToolPart 状态变为 error
                       → Deferred.succeed(done) 唤醒
```

Deferred** 的作用**：工具执行是异步的（在 prompt.ts 的 **resolveTools** 中启动），Processor 需要知道工具何时执行完毕。

+ **Deferred** 是一种 Effect 中的 Promise，**cleanup()** 会等待所有 Deferred（超时250ms），确保工具结果被正确写入。

