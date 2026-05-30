# OpenCode 启动流程 
OpenCod 有 2 种启动方式：

+ 交互式运行（opencode）：交互式 TUI，持续对话   
+ 一次性运行(opencode run "question")：一次性执行，完事退出



关键实现：

```plain
关键在于 index.ts 中注册的两个命令：                                                                            
                                                                                                                  
  ┌──────────────────┬─────────────────────────────────────────┬─────────────────────────────┐                    
  │       命令        │                注册位置                 │          触发条件           │
  ├──────────────────┼─────────────────────────────────────────┼─────────────────────────────┤                    
  │ TuiThreadCommand │ thread.ts:75 → command: "$0 [project]"  │ opencode 无子命令时（默认） │
  ├──────────────────┼─────────────────────────────────────────┼─────────────────────────────┤                    
  │ RunCommand       │ run.ts:218 → command: "run [message..]" │ opencode run "..." 时       │                    
  └──────────────────┴─────────────────────────────────────────┴─────────────────────────────┘     
```



## 一次性运行代码链路
### 代码链路流程
终端输入 opencode run "question"  代码链路：

```plain
终端: opencode run "帮我写代码"
          │                                                                                                       
          ▼                                                                                                       
  ┌─────────────────────────────────────────────────────────────────┐                                             
  │ ① bin/opencode → 启动 Bun 二进制                                │                                             
  └─────────────────────────────────────────────────────────────────┘                                             
          │                                                                                                       
          ▼                                                                                                       
  ┌─────────────────────────────────────────────────────────────────┐                                             
  │ ② index.ts → yargs 匹配 "run" → RunCommand.handler()            │                                             
  │    a. 解析参数: message, --file, --model, --agent ...            │                                            
  │    b. 构造 PromptInput parts                                     │                                            
  │    c. 配置默认权限 (deny question/plan_enter/plan_exit)           │                                           
  └─────────────────────────────────────────────────────────────────┘                                             
          │                                                                                                       
          │ args.attach 有值? → 连接远程服务器                                                                    
          │ args.attach 无值? → 本地启动                                                                          
          ▼                                                                                                       
  ┌─────────────────────────────────────────────────────────────────┐                                             
  │ ③ bootstrap(process.cwd(), ...)                                 │                                             
  │    → Instance.provide()                                         │                                             
  │    → InstanceBootstrap (加载所有服务: Provider/Agent/Tool/...)     │                                          
  │    → 创建 SDK 客户端 (in-memory fetch)                           │                                            
  └─────────────────────────────────────────────────────────────────┘                                             
          │                                                                                                       
          ▼                                                                                                       
  ┌─────────────────────────────────────────────────────────────────┐                                             
  │ ④ execute(sdk)                                                  │                                             
  │    a. 校验 Agent (--agent) / 解析 Model (--model)                │                                            
  │    b. 创建 Session → sdk.session.create()                        │                                            
  │    c. 订阅 SSE 事件流 → loop() 渲染 TUI                          │                                            
  │    d. 发送请求:                                                  │                                            
  │       ┌─ --command → sdk.session.command()                      │                                             
  │       └─ 普通对话   → sdk.session.prompt()                       │                                            
  │                         │                                       │                                             
  │                         ▼  (HTTP POST /:sessionID/prompt)       │                                             
  │                    SessionPrompt.prompt()                        │                                            
  │                    → createUserMessage()                         │                                            
  │                    → loop() → runLoop()                          │                                            
  │                    → while(true) { processor.process() }         │                                            
  │                    → llm.stream() → streamText()                 │                                            
  └─────────────────────────────────────────────────────────────────┘                                             
          │                                                                                                       
          │ SSE 事件流实时渲染工具调用 (bash/edit/read/write/...)                                                 
          │ session.status → "idle" → 退出事件循环                                                                
          ▼                                                                                                       
  ┌─────────────────────────────────────────────────────────────────┐                                             
  │ ⑤ 任务完成 → Instance.dispose() → process.exit()                 │                                            
  │    进程退出，不保留交互状态                                       │                                           
  └─────────────────────────────────────────────────────────────────┘   
```



### 具体链路
启动 open code 时，cli 进行一些设置，注册 run 等其他命令。

opencode run "question" 匹配到 runCommand

```typescript
// CLI 构建与中间件
const cli = yargs(args)
  // 全局选项
  .option(...)
  // 中间件 全局拦截所有命令， argv在命令回调执行之前执行
  .middleware(...)
  // 命令注册
  .usage("")
  .completion("completion", "generate shell completion script") // Shell 自动补全
  .command(AcpCommand)
  .command(McpCommand)
  .command(TuiThreadCommand) // TUI 线程命令
  .command(AttachCommand)// TUI 附加命令
  .command(RunCommand)// 运行命令 ⭐
  // 其他命令
  // 错误处理与清理
  .fail(...)
  .strict()// 严格模式，拒绝未知参数
```



runCommand：默认本地启动 bootstrap

```typescript
export const RunCommand = cmd({
  command: "run [message..]",  // 命令：opencode run
  describe: "run opencode with a message",
  builder: (yargs: Argv) => {
    // 配置该命令专属参数
    return yargs,
  handler: async (args) => {
 
    // 处理 --dir 参数
    const directory = (() => {...})()

    // 处理 --file 参数
    if (args.file) {...}
    
    // 处理其他参数 ...
   
    
    // 默认权限
    const rules: Permission.Ruleset = [
      {
        permission: "question",
        action: "deny",
        pattern: "*",
      },
      {
        permission: "plan_enter",
        action: "deny",
        pattern: "*",
      },
      {
        permission: "plan_exit",
        action: "deny",
        pattern: "*",
      },
    ]

    // 有绑定，创建SDK连接远程OpenCode服务器
    if (args.attach) {
      const headers = (() => {
        const password = args.password ?? process.env.OPENCODE_SERVER_PASSWORD
        if (!password) return undefined
        const username = process.env.OPENCODE_SERVER_USERNAME ?? "opencode"
        const auth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
        return { Authorization: auth }
      })()
      const sdk = createOpencodeClient({ baseUrl: args.attach, directory, headers })
      return await execute(sdk)
    }

    // 默认本地启动
    await bootstrap(process.cwd(), async () => {
      const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        return Server.Default().app.fetch(request)
      }) as typeof globalThis.fetch
      const sdk = createOpencodeClient({ baseUrl: "http://opencode.internal", fetch: fetchFn })
      await execute(sdk)
    })
  },
})
```



bootstrap 启动函数：初始化 Effect-TS 依赖注入容器，加载所有服务:

```typescript
/**
 * CLI 启动函数
 * @param directory 当前工作目录（项目根目录）
 * @param cb 真正要执行的CLI命令逻辑（如 run hello）
 */
export async function bootstrap<T>(directory: string, cb: () => Promise<T>) {
  // 1. 创建并挂载应用实例（上下文管理器）
  return Instance.provide({
    // 指定当前工作目录（所有配置/文件/会话都基于此）
    directory,
    // 2. 【初始化】初始化所有服务
    init: () => AppRuntime.runPromise(InstanceBootstrap),
    // 3. 【执行】运行用户的命令逻辑
    fn: async () => {
      try {
        const result = await cb()
        return result
      } finally {
        // 4. 【清理】无论成功/失败，最终一定释放资源
        await Instance.dispose()
      }
    },
  })
}

```



execute

```typescript
async function execute(sdk: OpencodeClient) {

      // TUI 渲染工具，把 AI 的所有操作（读 / 写 / 改代码、执行命令、搜索）渲染成你看到的彩色终端日志
      function tool(part: ToolPart) {...}
      
      // 事件循环,实时监听AI的所有动作进行渲染：
      async function loop() {...}

      // Validate agent if specified
      // 校验 Agent：响应 --agent 参数：指定用哪个 AI 助手（build/plan/explore）
      // 校验你指定的 --agent 是否存在
      // 不能使用子代理（subagent）作为主代理
      const agent = await (async () => {...})()

      // 创建 session
      const sessionID = await session(sdk)
      
      loop().catch((e) => {
        console.error(e)
        process.exit(1)
      })

      // 与 LLM 交互，开始执行任务
      if (args.command) {
        // 执行命令
        await sdk.session.command({
          sessionID,
          agent,
          model: args.model,
          command: args.command,
          arguments: message,
          variant: args.variant,
        })
      } else {
        const model = args.model ? Provider.parseModel(args.model) : undefined
        // 普通对话,后端调用 SessionPrompt.prompt()
        await sdk.session.prompt({
          sessionID,
          agent,
          model,
          variant: args.variant,
          parts: [...files, { type: "text", text: message }],
        })
      }
    }

```



执行 SessionPrompt.prompt() 【核心代码】

最后清理阶段

+ Instance.dispose() → 释放所有资源
+ process.exit()     → 杀掉所有子进程 



## TUI 交互运行代码链路
TUI 交互式运行是**前后端分离**的设计。

thread 主线程负责前端 TUI 的渲染；woker 子线程是完整的后端服务，负责处理主线程的请求。

<!-- 这是一张图片，ocr 内容为： -->
![](https://cdn.nlark.com/yuque/0/2026/png/46998893/1778822974104-1736ddaa-abb5-4323-b673-e6a7b144521f.png)





### 代码链路流程
```plain
    终端: opencode  
          │                                                                                                       
          ▼                                                                                                       
  ┌─────────────────────────────────────────────────────────────────┐                                             
  │ ① bin/opencode → 启动 Bun 二进制                                │                                             
  └─────────────────────────────────────────────────────────────────┘                                             
          │                                                                                                       
          ▼                                                                                                       
  ┌─────────────────────────────────────────────────────────────────┐                                             
  │ ② index.ts → yargs 无子命令匹配 → TuiThreadCommand ($0 default) │                                             
  │    a. 确定工作目录 (--project)                                   │                                            
  │    b. 读取管道输入 (如果有)                                       │                                           
  │    c. 解析网络配置选项                                            │                                           
  └─────────────────────────────────────────────────────────────────┘                                             
          │                                                                                                       
          │ 🔑 关键：启动 Worker 线程分离前后端 （默认使用 rpc 通信）                                                                  
          ▼                                                                                                       
  ┌─────────────────────────────────────────────────────────────────┐                                             
  │ ③ 主线程 (TuiThread) 启动 Worker 线程                             │                                           
  │                                                                 │                                             
  │    new Worker(worker.ts)  ←── 子线程                              │                                           
  │                                                                 │                                             
  │    ┌─ 主线程 (thread.ts) ────────────────────────────────────┐  │                                             
  │    │                                                         │  │                                             
  │    │  Rpc.client(worker) → 通过 RPC 与 Worker 通信             │  │                                           
  │    │                                                         │  │                                             
  │    │  createWorkerFetch(client)                              │  │                                             
  │    │    → fetch 请求通过 RPC 转发到 Worker 线程                  │  │                                         
  │    │                                                         │  │                                             
  │    │  createEventSource(client)                              │  │                                             
  │    │    → SSE 事件通过 RPC 从 Worker 转发到主线程               │  │                                          
  │    │                                                         │  │                                             
  │    │  tui({ url, fetch, events, config, ... })               │  │                                             
  │    │    → 启动 Solid.js TUI 渲染器                             │  │                                           
  │    │    → app.tsx: 完整交互界面                                │  │                                           
  │    └─────────────────────────────────────────────────────────┘  │                                             
  │                                                                 │                                             
  │    ┌─ Worker 线程 (worker.ts) ───────────────────────────────┐  │                                             
  │    │                                                         │  │                                             
  │    │  InstanceBootstrap → 加载所有服务                        │  │                                            
  │    │  Server.listen() → 启动 HTTP 服务器                       │  │                                           
  │    │  Rpc.listen(rpc) → 监听主线程 RPC 调用                    │  │                                           
  │    │                                                         │  │                                             
  │    │  rpc.fetch()     → Server.fetch() 处理 HTTP 请求         │  │                                            
  │    │  rpc.server()    → 管理 HTTP 服务器生命周期               │  │                                           
  │    │  rpc.snapshot()  → 堆快照                                │  │                                            
  │    │  rpc.shutdown()  → 清理资源                               │  │                                           
  │    └─────────────────────────────────────────────────────────┘  │                                             
  └─────────────────────────────────────────────────────────────────┘                                             
          │                                                                                                       
          ▼                                                                                                       
  ┌─────────────────────────────────────────────────────────────────┐                                             
  │ ④ TUI 界面 (app.tsx → Solid.js)                                  │                                            
  │                                                                 │                                             
  │    ┌──────────────────────────────────────────────────────┐    │                                              
  │    │  RouteProvider (路由系统)                              │    │                                            
  │    │    ├── home   → Home 组件 (会话列表 + 输入框)          │    │                                            
  │    │    └── session → Session 组件 (对话界面)               │    │                                            
  │    └──────────────────────────────────────────────────────┘    │                                              
  │                                                                 │                                             
  │    用户操作:                                                      │                                           
  │    - 输入问题 → 回车                                             │                                            
  │    - /models → 切换模型                                          │                                            
  │    - /agents → 切换 Agent                                        │                                            
  │    - /sessions → 切换会话                                        │                                            
  │    - /exit   → 退出                                              │                                            
  │    - Ctrl+C  → 取消当前操作                                      │                                            
  └─────────────────────────────────────────────────────────────────┘                                             
          │                                                                                                       
          │ 用户在TUI中输入问题                                                                                   
          ▼                                                                                                       
  ┌─────────────────────────────────────────────────────────────────┐                                             
  │ ⑤ SDK 调用 → HTTP API → SessionPrompt.prompt()                   │                                            
  │                                                                 │                                             
  │    sdk.session.prompt({ sessionID, parts })                     │                                             
  │      → main thread fetch()                                      │                                             
  │      → RPC call "fetch" → worker thread                         │                                             
  │      → Server.fetch() → Hono routes                             │                                             
  │      → POST /:sessionID/prompt                                  │                                             
  │      → SessionPrompt.prompt()                                   │                                             
  │      → while(true) { processor.process() → llm.stream() }       │                                             
  │      → SSE 事件流返回                                            │                                            
  │      → worker thread → RPC emit "global.event" → main thread    │                                             
  │      → TUI 实时渲染工具调用                                       │                                           
  └─────────────────────────────────────────────────────────────────┘                                             
          │                                                                                                       
          │ 任务完成后 → session.status idle                                                                      
          │ TUI 不退出，显示结果，等待下一次输入                                                                  
          ▼                                                                                                       
  ┌─────────────────────────────────────────────────────────────────┐                                             
  │ ⑥ 持续交互模式                                                   │                                            
  │    - 用户可以继续输入 → 再次触发 SessionPrompt.prompt()           │                                           
  │    - 可以切换会话 → 查看/恢复历史对话                              │                                          
  │    - 可以切换模型 → 更改使用的 LLM                                 │                                          
  │    - 直到用户输入 /exit 或 Ctrl+C → 退出 TUI                      │                                           
  │                                                                 │                                             
  │    退出时: stop() → RPC shutdown() → Instance.disposeAll()       │                                            
  │          → Server.stop() → worker.terminate() → process.exit()  │                                             
  └─────────────────────────────────────────────────────────────────┘
```



### 具体链路
终端输入 opencode，cli 匹配到 TuiThreadCommand

 TuiThreadCommand，主线程（packages/opencode/src/cli/cmd/tui/thread.ts）

+ 负责渲染 TUI 界面，没有任何业务逻辑
+ 用 Solid.js 渲染 TUI（路由、输入框、对话列表、对话框）                                                       
+ 接收用户输入（键盘、鼠标）
+ 所有 fetch / SSE 订阅都通过 RPC 转发给 Worker，自己不做任何业务逻辑                               
+ 退出时通知 Worker 清理                                 

```typescript
export const TuiThreadCommand = cmd({
  command: "$0 [project]",
  describe: "start opencode tui",
  builder: (yargs) => {...}, // 可以解析的参数
  handler: async (args) => {

    // 确定工作目录
    const root = Filesystem.resolve(process.env.PWD ?? process.cwd())
    const next = args.project
      ? Filesystem.resolve(path.isAbsolute(args.project) ? args.project : path.join(root, args.project))
      : Filesystem.resolve(process.cwd())
    const file = await target()
    process.chdir(next) 
    const cwd = Filesystem.resolve(process.cwd())
    const env = sanitizedProcessEnv({
      [OPENCODE_PROCESS_ROLE]: "worker",
      [OPENCODE_RUN_ID]: ensureRunID(),
    })


    // 创建 woker 子线程
    const worker = new Worker(file, {
      env,
    })


    // 创建 RPC 客户端，包装 Worker 通信
    const client = Rpc.client<typeof rpc>(worker)
    const reload = () => {...}

    const prompt = await input(args.prompt)
    const config = await TuiConfig.get()

    // 确定数据通道
    // 如果指定了 --port/--hostname，Worker 启动独立 HTTP Server（外部可访问）；
    // 否则走 RPC 内部转发（零网络开销）
    const network = resolveNetworkOptionsNoConfig(args)
    const external =
      process.argv.includes("--port") ||
      process.argv.includes("--hostname") ||
      process.argv.includes("--mdns") ||
      network.mdns ||
      network.port !== 0 ||
      network.hostname !== "127.0.0.1"
    const transport = external
      ? {
        // HTTP 模式
        url: (await client.call("server", network)).url,
        fetch: undefined,		// SDK 走真实的 fetch
        events: undefined, 	// SDK 走真实的 SSE
      }
      : {
        // rpc 模式
        url: "http://opencode.internal",
        fetch: createWorkerFetch(client),		// fetch 请求通过 RPC 转发到 Worker
        events: createEventSource(client),	// SSE 事件通过 RPC 从 Worker 转发
      }

    // 校验会话
    // 检查 --session/--continue 指定的会话是否存在
    await validateSession(...)

    try {
      // 启动 TUI, 进入 Solid.js 交互界面
      await tui(...)
    } finally {
      // 退出清理 — TUI 关闭后
      await stop()
    }
    process.exit(0)
  },
})
```



woker 子线程(packages/opencode/src/cli/cmd/tui/worker.ts)

一个完整的后台服务器，但不监听网络（默认走 RPC 内部通信）

+ InstanceBootstrap → 加载所有服务（Config、Provider、Agent、Tool、Session 等）
+ Server.Default().app.fetch() → 处理 HTTP 请求，路由到 SessionPrompt、Permission 等业务逻辑
+ Rpc.listen(rpc) → 暴露 fetch / server / shutdown 等方法供主线程调用
+ GlobalBus.on("event") → 把 SSE 事件通过 Rpc.emit 推回主线程

```typescript
// L41-L43: Worker 中订阅 GlobalBus，事件通过 RPC 发送到主线程                                                  
GlobalBus.on("event", (event) => {                                                                              
  Rpc.emit("global.event", event)                                                                               
})                                                                                                              

// L48-L95: Worker 暴露的 RPC 方法                                                                              
export const rpc = {
  async fetch(input) { ... },      // 处理 HTTP 请求                                                            
  async server(input) { ... },     // 启动 HTTP 服务器                                                          
  snapshot() { ... },             // 堆快照                                                                     
  async reload() { ... },         // 重新加载配置                                                               
  async shutdown() { ... },       // 关闭服务                                                                   
} 

// Worker 开始监听 RPC 调用
Rpc.listen(rpc)
```



**主线程是渲染器，Worker 是服务器。** 

两者通过 **postMessage** 走 RPC，默认不走网络栈。

主线程只负责把 UI 画出来，所有   LLM 调用、工具执行、会话管理都在 Worker 里完成。



rpc 通信机制 （packages/opencode/src/util/rpc.ts）

```typescript
// Worker 端: listen() - 监听主线程发来的请求                                                                   
export function listen(rpc) {                                                                                   
  onmessage = async (evt) => {                                                                                  
    const parsed = JSON.parse(evt.data)                                                                         
    if (parsed.type === "rpc.request") {                                                                        
      const result = await rpc[parsed.method](parsed.input)                                                     
      postMessage(JSON.stringify({ type: "rpc.result", result, id: parsed.id }))                                
    }                                                                                                           
  }                                                                                                             
}                                                                                                               

// Worker → Main: emit() - 推送事件到主线程                                                                     
export function emit(event, data) {                                                                             
  postMessage(JSON.stringify({ type: "rpc.event", event, data }))                                               
}                                                                                                               

// Main 端: client() - 调用 Worker 方法 + 监听 Worker 事件                                                      
export function client(target) {                                                                                
  // call("fetch", params) → postMessage("rpc.request") → 等待 "rpc.result"                                     
  // on("global.event", handler) → 监听 "rpc.event"                                                             
} 
```



数据流转过程

```plain
                                                                                                               
  主线程 (thread.ts)                    Worker 线程 (worker.ts)                                                   
  ─────────────────                    ──────────────────────                                                     
                                                                                                                  
  sdk.session.prompt()                                                                                            
    │                                                                                                             
    ▼                                                                                                             
  fetch(url, body)                                                                                                
    │                                                                                                             
    ▼                                                                                                             
  createWorkerFetch                                                                                               
    │                                                                                                             
    ▼                                                                                                             
  client.call("fetch", {url, body})                                                                               
    │                                                                                                             
    │  ──postMessage──►  rpc.request ──►  onmessage 接收                                                          
    │                                     │                                                                       
    │                                     ▼                                                                       
    │                                   rpc.fetch()                                                               
    │                                     │                                                                       
    │                                     ▼                                                                       
    │                                   Server.fetch()                                                            
    │                                     │                                                                       
    │                                     ▼                                                                       
    │                                   SessionPrompt.prompt()                                                    
    │                                     │                                                                       
    │                                     ▼                                                                       
    │                                   SSE 事件产生                                                              
    │                                     │                                                                       
    │                                     ▼                                                                       
    │                                   GlobalBus.emit("event")                                                   
    │                                     │                                                                       
    │                                     ▼                                                                       
    │                                   Rpc.emit("global.event", data)                                            
    │                                     │                                                                       
    │  ◄──postMessage── rpc.event ◄──────┘                                                                        
    │                                                                                                             
    ▼                                                                                                             
  client.on("global.event", handler)                                                                              
    │                                                                                                             
    ▼                                                                                                             
  TUI 渲染 (app.tsx)
```





# OpenCode Loop
OpenCode 核心方法 session/prompt.ts。

while(true) 循环，只有满足退出条件时才 break。

```plain
  ┌─────────────────────────────────────────────────────────────────────────────────────┐                         
  │                              完整调用链路 (单次用户请求)                                │                     
  ├─────────────────────────────────────────────────────────────────────────────────────┤                         
  │                                                                                      │                        
  │  用户输入 "帮我写代码"                                                                 │                      
  │       │                                                                              │                        
  │       ▼                                                                              │                        
  │  SessionPrompt.prompt()                                                               │                       
  │       │                                                                              │                        
  │       ├── sessions.get()          → 获取会话信息                                      │                       
  │       ├── revert.cleanup()        → 清理回退状态                                      │                       
  │       ├── createUserMessage()     → 解析输入，构建 UserMessage + Parts                 │                      
  │       │     ├── 文件解析 → Read 工具执行                                               │                      
  │       │     ├── MCP 资源 → MCP.readResource()                                        │                        
  │       │     ├── Agent 引用 → 权限检查                                                  │                      
  │       │     └── 保存到 Session 存储                                                   │                       
  │       └── loop(sessionID)                                                             │                       
  │             │                                                                        │                        
  │             ▼                                                                        │                        
  │       runLoop()                                                                       │                       
  │             │                                                                        │                        
  │             ├── while (true) ◄──────────────────────────────────────┐                │                        
  │             │                                                        │                │                       
  │             ├── ① 获取过滤后的消息历史                                  │                │                    
  │             ├── ② 找到 lastUser / lastAssistant / lastFinished       │                │                       
  │             ├── ③ 退出条件判断 → 满足则 break                          │                │                     
  │             ├── ④ 处理 subtask/compaction 任务 → continue             │                │                      
  │             ├── ⑤ Token 溢出检查 → 创建 compaction → continue         │                │                      
  │             ├── ⑥ 解析 Agent / 插入提醒                               │                │                      
  │             ├── ⑦ 创建 AssistantMessage                               │                │                      
  │             ├── ⑧ resolveTools() → 获取所有可用工具                    │                │                     
  │             ├── ⑨ 构建 SystemPrompt                                   │                │                      
  │             │                                                        │                │                       
  │             ├── ⑩ processor.process() ──────────────────────────┐    │                │                       
  │             │     │                                              │    │                │                      
  │             │     ├── llm.stream(input)                          │    │                │                      
  │             │     │     │                                         │    │                │                     
  │             │     │     ├── provider.getLanguage(model)           │    │                │                     
  │             │     │     │   → 加载厂商 SDK (OpenAI/Anthropic/...) │    │                │                     
  │             │     │     ├── 构建 options (temperature/topP/...)   │    │                │                     
  │             │     │     ├── wrapLanguageModel(middleware)         │    │                │                     
  │             │     │     └── streamText(messages, tools, ...)     │    │                │                      
  │             │     │         → Vercel AI SDK 流式调用 LLM          │    │                │                     
  │             │     │                                              │    │                │                      
  │             │     ├── Stream.tap(handleEvent) ─── SSE 事件处理    │    │                │                     
  │             │     │     ├── text-delta      → 实时文本输出          │    │                │                   
  │             │     │     ├── tool-call       → 工具调用 (运行)       │    │                │                   
  │             │     │     ├── tool-result     → 工具结果 (完成)       │    │                │                   
  │             │     │     └── finish-step     → Token 统计 + Patch   │    │                │                    
  │             │     │                                              │    │                │                      
  │             │     ├── Stream.takeUntil(needsCompaction)           │    │                │                     
  │             │     └── Stream.runDrain                             │    │                │                     
  │             │                                                    │    │                │                      
  │             │     返回: "compact" | "stop" | "continue"           │    │                │                     
  │             │                                                        │                │                       
  │             └── ⑪ 结果判断 ─────────────────────────────────────────┘                │                        
  │                   ├── "stop"    → break                                             │                         
  │                   ├── "compact" → 创建 compaction → continue ───────────────────────┘                         
  │                   └── "continue"→ continue ─────────────────────────────────────────┘                         
  │                                                                                      │                        
  │  最终: compaction.prune() → lastAssistant() → 返回 AI 最终回复                        │                       
  │                                                                                      │                        
  └─────────────────────────────────────────────────────────────────────────────────────┘    
```



ession/prompt.ts 中的 runLoop 方法

```typescript
function* (sessionID: SessionID) {

        // 资源初始化
        const ctx = yield* InstanceState.context
        const slog = elog.with({ sessionID })
        let structured: unknown | undefined
        let step = 0
        const session = yield* sessions.get(sessionID)

        // loop
        while (true) {
          yield* status.set(sessionID, { type: "busy" })
          yield* slog.info("loop", { step })

          // 获取历史 message
          let msgs = yield* MessageV2.filterCompactedEffect(sessionID)

          // 找最后的 message
          // 最近的 User 消息
          let lastUser: MessageV2.User | undefined
          // 最近的 AI 消息
          let lastAssistant: MessageV2.Assistant | undefined
          // 最近带有 Finish 标识的 AI 消息
          let lastFinished: MessageV2.Assistant | undefined
          // 未完成的 compact/subtask 消息
          let tasks: (MessageV2.CompactionPart | MessageV2.SubtaskPart)[] = []
          for (let i = msgs.length - 1; i >= 0; i--) {
            const msg = msgs[i]
            if (!lastUser && msg.info.role === "user") lastUser = msg.info
            if (!lastAssistant && msg.info.role === "assistant") lastAssistant = msg.info
            if (!lastFinished && msg.info.role === "assistant" && msg.info.finish) lastFinished = msg.info
            if (lastUser && lastFinished) break
            const task = msg.parts.filter((part) => part.type === "compaction" || part.type === "subtask")
            if (task && !lastFinished) tasks.push(...task)
          }

          if (!lastUser) throw new Error("No user message found in stream. This should never happen.")

          const lastAssistantMsg = msgs.findLast(
            (msg) => msg.info.role === "assistant" && msg.info.id === lastAssistant?.id,
          )
          // Some providers return "stop" even when the assistant message contains tool calls.
          // Keep the loop running so tool results can be sent back to the model.
          // Skip provider-executed tool parts — those were fully handled within the
          // provider's stream (e.g. DWS Agent Platform) and don't need a re-loop.
          const hasToolCalls =
            lastAssistantMsg?.parts.some((part) => part.type === "tool" && !part.metadata?.providerExecuted) ?? false

          // 循环推出条件
          if (
            lastAssistant?.finish && // finish：stop
            !["tool-calls"].includes(lastAssistant.finish) && // finish 不是 tool-calls 返回的，而是 LLM 返回的
            !hasToolCalls && // Tool 全部执行完毕
            lastUser.id < lastAssistant.id // userID < AIId
          ) {
            yield* slog.info("exiting loop")
            break
          }

          step++
          if (step === 1)
            // 异步生成标题（异步调用小模型）
            yield* title({
              session,
              modelID: lastUser.model.modelID,
              providerID: lastUser.model.providerID,
              history: msgs,
            }).pipe(Effect.ignore, Effect.forkIn(scope))

          const model = yield* getModel(lastUser.model.providerID, lastUser.model.modelID, sessionID)
          const task = tasks.pop()

          // 处理子任务
          if (task?.type === "subtask") {
            yield* handleSubtask({ task, model, lastUser, sessionID, session, msgs })
            // 完成后进入下一轮循环
            continue
          }

          // 处理会话压缩
          if (task?.type === "compaction") {
            const result = yield* compaction.process({
              messages: msgs,
              parentID: lastUser.id,
              sessionID,
              auto: task.auto,
              overflow: task.overflow,
            })
            // 压缩失败，退出
            if (result === "stop") break
            // 压缩成功，进入下一轮循环
            continue
          }

          // Token 溢出检查
          if (
            lastFinished &&
            lastFinished.summary !== true &&
            (yield* compaction.isOverflow({ tokens: lastFinished.tokens, model }))
          ) {
            // 创建一个 compaction task，下一轮循环处理
            yield* compaction.create({ sessionID, agent: lastUser.agent, model: lastUser.model, auto: true })
            continue
          }

          // Agent 配置
          const agent = yield* agents.get(lastUser.agent)
          if (!agent) {
            const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
            const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
            const error = new NamedError.Unknown({ message: `Agent not found: "${lastUser.agent}".${hint}` })
            yield* bus.publish(Session.Event.Error, { sessionID, error: error.toObject() })
            throw error
          }
          const maxSteps = agent.steps ?? Infinity // 最大步骤
          const isLastStep = step >= maxSteps // 是否是最后一步
          // 注入特殊提示
          msgs = yield* insertReminders({ messages: msgs, agent, session })

          // 创建 AI 消息（tokens / cost / finish 等字段在流式过程中逐步填充  ）
          const msg: MessageV2.Assistant = {
            id: MessageID.ascending(),
            parentID: lastUser.id,
            role: "assistant",
            mode: agent.name,
            agent: agent.name,
            variant: lastUser.model.variant,
            path: { cwd: ctx.directory, root: ctx.worktree },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: model.id,
            providerID: model.providerID,
            time: { created: Date.now() },
            sessionID,
          }
          yield* sessions.updateMessage(msg)
          // 创建 processHandler
          const handle = yield* processor.create({
            assistantMessage: msg, // AI 消息
            sessionID,
            model,
          })

          // Effect.gen 内部
          const outcome: "break" | "continue" = yield* Effect.gen(function* () {
            const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
            const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false

            // 解析 Tool
            //（获取内置、自定义、MCP的Tool，做 2 层过滤【agent权限，用户手动禁用】）
            const tools = yield* resolveTools({
              agent,
              session,
              model,
              tools: lastUser.tools,
              processor: handle,
              bypassAgentCheck,
              messages: msgs,
            })

            // 用户要求 JSON 格式输出
            if (lastUser.format?.type === "json_schema") {
              // 注入 StructuredOutput 工具
              tools["StructuredOutput"] = createStructuredOutputTool({
                schema: lastUser.format.schema,
                onSuccess(output) {
                  structured = output
                },
              })
            }

            if (step === 1)
              yield* summary.summarize({ sessionID, messageID: lastUser.id }).pipe(Effect.ignore, Effect.forkIn(scope))

            // 处理用户中途消息（step > 1）
            if (step > 1 && lastFinished) {
              for (const m of msgs) {
                if (m.info.role !== "user" || m.info.id <= lastFinished.id) continue
                for (const p of m.parts) {
                  if (p.type !== "text" || p.ignored || p.synthetic) continue
                  if (!p.text.trim()) continue
                  // 将用户新消息包裹在 <system-reminder> 中  
                  p.text = [
                    "<system-reminder>",
                    "The user sent the following message:",
                    p.text,
                    "",
                    "Please address this message and continue with your tasks.",
                    "</system-reminder>",
                  ].join("\n")
                }
              }
            }

            yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })

            // 构建 Prompt
            const [skills, env, instructions, modelMsgs] = yield* Effect.all([
              sys.skills(agent), // skill
              Effect.sync(() => sys.environment(model)), // 环境
              instruction.system().pipe(Effect.orDie), // 用户指令
              MessageV2.toModelMessagesEffect(msgs, model), //模型消息
            ])
            // 拼接 systemPrompt：env + skills + instructions 
            const system = [...env, ...(skills ? [skills] : []), ...instructions]
            const format = lastUser.format ?? { type: "text" as const }
            if (format.type === "json_schema") system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)

            // 调用 LLM，处理工具调用【核心】
            const result = yield* handle.process({
              user: lastUser,
              agent,
              permission: session.permission,
              sessionID,
              parentSessionID: session.parentID,
              system, // systemPrompt
              messages: [ // 历史消息
                ...modelMsgs, 
                ...(isLastStep ? [{ role: "assistant" as const, content: MAX_STEPS }] : [])
              ],
              tools, // 可用 Tool
              model,
              toolChoice: format.type === "json_schema" ? "required" : undefined,
            })

            //  结构化输出成功 → break
            if (structured !== undefined) {
              handle.message.structured = structured
              handle.message.finish = handle.message.finish ?? "stop"
              yield* sessions.updateMessage(handle.message)
              return "break" as const
            }

            // 正常完成（finish 不是 tool-calls/unknown）且无错误 → 正常退出
            const finished = handle.message.finish && !["tool-calls", "unknown"].includes(handle.message.finish)
            if (finished && !handle.message.error) {
              // 如果要求了 json_schema 但没拿到 → 标记错误   
              if (format.type === "json_schema") {
                handle.message.error = new MessageV2.StructuredOutputError({
                  message: "Model did not produce structured output",
                  retries: 0,
                }).toObject()
                yield* sessions.updateMessage(handle.message)
                return "break" as const
              }
            }

            // processor 返回 "stop" → break
            if (result === "stop") return "break" as const
            // processor 返回 "compact" → 创建 compaction task → 下轮处理
            if (result === "compact") {
              yield* compaction.create({
                sessionID,
                agent: lastUser.agent,
                model: lastUser.model,
                auto: true,
                overflow: !handle.message.finish,
              })
            }
            return "continue" as const
          }).pipe(Effect.ensuring(instruction.clear(handle.message.id)))
          
          if (outcome === "break") break
          continue
        }

        // 清理过期的 compaction 消息
        yield* compaction.prune({ sessionID }).pipe(Effect.ignore, Effect.forkIn(scope))
        // 返回最终的 assistant 消息
        return yield* lastAssistant(sessionID)
      },
```



## 小结
+ **while(true)** **不是死循环** —— 退出条件（finish=stop + 无 pending tools）确保最终一定会退出        
+ **每轮循环 = 一次 LLM round-trip** —— 如果 LLM 返回 tool-call，执行完工具后 **continue**，把工具结果发回 LLM
+ **subtask/compaction 优先级最高** —— 在调用 LLM 之前先处理队列中的任务                         
+ **step 计数器保护** —— Agent 可配置 **steps** 上限，防止无限循环，最后一步注入 **MAX_STEPS** 警告
+ **用户中断是 soft** —— 用户在 AI 执行中发的消息被包装为 `<system-reminder>`，AI 自行决定何时响应

