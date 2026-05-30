HelloAgent 分别实现了 SimpleAgent，ReactAgent，PlanSolveAgent，ReflectionAgent。



# LLM 调用的请求、响应
```json
{
  "model": "gpt-3.5-turbo",
  "messages": [
    {
      "role": "system",
      "content": "你是一个智能助手"
    },
    {
      "role": "user",
      "content": "今天天气怎么样？"
    }
  ],
  "temperature": 0.7,
  "stream":false # 非流式调用
}
```

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "今天天气晴朗，温度25度。"
      },
      "finish_reason": "stop"
    }
  ]
}
```



```json
{
  "model": "gpt-3.5-turbo",
  "messages": [
    {
      "role": "user",
      "content": "帮我查一下北京今天的天气"
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "获取城市天气",
        "parameters": {
          "type": "object",
          "properties": {
            "city": {
              "type": "string",
              "description": "城市名称"
            }
          },
          "required": ["city"]
        }
      }
    }
  ],
  "tool_choice": "auto"
}
```

```json
{
  "id": "chatcmpl-xxx",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          {
            "id": "call_001",
            "type": "function",
            "function": {
              "name": "get_weather",
              "arguments": "{\"city\":\"北京\"}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ]
}
```





```json
{
  "model": "gpt-3.5-turbo",
  "messages": [
    {
      "role": "system",
      "content": "你是一个智能助手"
    },
    {
      "role": "user",
      "content": "介绍一下Python"
    }
  ],
  "stream": true, # 流式请求
}
```

```json
# 流式响应会返回很多 chunk，程序需要解析这些 chunk
{"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Python"},"finish_reason":null}]}
{"id":"chatcmpl-2","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"是"},"finish_reason":null}]}
{"id":"chatcmpl-3","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"一门"},"finish_reason":null}]}
{"id":"chatcmpl-4","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"优雅的编程语言。"},"finish_reason":"stop"}]}
```



# SimpleAgent
简单的对话Agent，支持可选的工具调用

+ 纯对话模式（无工具）
+ Function Calling 工具调用（可选）
+ 自动多轮工具调用



## 非流式调用
```plain
用户输入 input_text
      │
      ▼
┌─────────────────────────────┐
│     SimpleAgent.run()       │  ← 非流式工具调用入口
│                             │
│  检查是否启用工具调用？         │
└─────────────────────────────┘
      │
      ├─────────────────────────────────────────────┐
      │ 否                                          │ 是
      ▼                                             ▼
┌─────────────────────┐               ┌─────────────────────────────┐
│ 直接调用普通LLM接口 		│               │ 构建工具参数Schema           │
│ (llm.invoke)        │               │ 初始化迭代计数器=0           │
└─────────────────────┘               └─────────────────────────────┘
      │                                             │
      │                                             ▼
      │                           ┌─────────────────────────────────────────────┐
      │                           │        工具调用主循环（最多N次迭代）         │
      │                           │                                             │
      │                           │  ┌────────────────┐    ┌────────────────┐   │
      │                           │  │ 调用带工具的LLM  │───▶│ 解析工具调用请求  │   │
      │                           │  │ (invoke_with_tools) │    │ (tool_calls)   │   
      │                           │  └────────────────┘    └────────────────┘   │
      │                           │           │                      │          │
      │                           │           │                      ▼          │
      │                           │           │              ┌────────────────┐ │
      │                           │           │              │  执行工具函数  │ │
      │                           │           │              │ (_execute_tool)│ │
      │                           │           │              └────────────────┘ │
      │                           │           │                      │          │
      │                           │           │                      ▼          │
      │                           │           │              ┌────────────────┐ │
      │                           │           │              │ 添加工具结果到 │ │
      │                           │           │              │    消息历史    │ │
      │                           │           │              └────────────────┘ │
      │                           │           │                      │          │
      │                           │           └──────────────────────┘          │
      │                           │                                             │
      │                           │  终止条件：                                  │
      │                           │  • LLM不再返回工具调用                       │
      │                           │  • 达到最大迭代次数max_tool_iterations      │
      │                           │  • LLM调用发生异常                          │
      │                           └─────────────────────────────────────────────┘
      │                                             │
      └─────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────┐
│     统一收尾处理             │
│                             │
│  1. 保存用户输入到历史       │
│  2. 保存助手响应到历史       │
│  3. 返回最终响应文本         │
└─────────────────────────────┘
```



```json
"messages": [
  {
    "role": "user",
    "content": "帮我查一下北京今天的天气"
  }
],


# 多了 2 条（ai、tool执行结果）
"messages": [
    {
      "role": "user",
      "content": "帮我查一下北京今天的天气"
    },
    {
      "role": "assistant",
      "content": null,
      "tool_calls": [
        {
          "id": "call_001",
          "type": "function",
          "function": {
            "name": "get_weather",
            "arguments": "{\"city\":\"北京\"}"
          }
        }
      ]
    },
    {
      "role": "tool",
      "tool_call_id": "call_001",
      "content": "北京今天天气：晴，25℃"
    }
  ],

```



```python
def run(self, input_text: str, **kwargs) -> str:
    """
        非流式运行 SimpleAgent（基于 Function Calling）

        Args:
            input_text: 用户输入
            **kwargs: 其他参数

        Returns:
            最终回复
        """

    # 没有启用工具调用，直接返回 LLM 响应
    if not self.enable_tool_calling or not self.tool_registry:
        llm_response = self.llm.invoke(messages, **kwargs)
        response_text = llm_response.content if hasattr(llm_response, 'content') else str(llm_response)

        # 保存到历史记录
        self.add_message(Message(input_text, "user"))
        self.add_message(Message(response_text, "assistant"))
        return response_text

    # 启用工具调用模式
    
    tool_schemas = self._build_tool_schemas() # 构建 tool 参数的 schema
    current_iteration = 0 # 循环的次数
    final_response = "" # 最终结构

    while current_iteration < self.max_tool_iterations:
        current_iteration += 1
    
        # 调用 LLM（Function Calling）
        try:
            response = self.llm.invoke_with_tools(
                messages=messages,
                tools=tool_schemas,
                tool_choice="auto",
                **kwargs
            )
        except Exception as e:
            print(f"❌ LLM 调用失败: {e}")
            break
    
        # 处理工具调用
        tool_calls = response.tool_calls
        if not tool_calls:
            # 没有工具调用，直接返回文本响应
            final_response = response.content or "抱歉，我无法回答这个问题。"
            break
    
        # 将助手消息添加到历史
        messages.append({
            "role": "assistant",
            "content": response.content,
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.name,
                        "arguments": tc.arguments
                    }
                }
                for tc in tool_calls
            ]
        })
    
        # 处理工具调用
        for tool_call in tool_calls:
            tool_name = tool_call.name
            tool_call_id = tool_call.id

            # 执行工具
            arguments = json.loads(tool_call.arguments)
            result = self._execute_tool_call(tool_name, arguments)

            # 添加工具结果到消息
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call_id,
                "content": result
            })

        # 如果超过最大迭代次数，获取最后一次回答
        if current_iteration >= self.max_tool_iterations and not final_response:
            llm_response = self.llm.invoke(messages, **kwargs)
            final_response = llm_response.content if hasattr(llm_response, 'content') else str(llm_response)

    # 保存到历史记录
    self.add_message(Message(input_text, "user"))
    self.add_message(Message(final_response, "assistant"))
    
    return final_response

```



## 流式调用
底层使用厂商提供的 SDK

```python
async def arun_stream(
    self,
    input_text: str
    **kwargs
) -> AsyncGenerator[StreamEvent, None]:
    """
        SimpleAgent 真正的流式执行

        实时返回 LLM 输出的每个文本块

        Args:
            input_text: 用户输入
            **kwargs: 其他参数

        Yields:
            StreamEvent: 流式事件
        """
    # 发送开始事件
    yield StreamEvent.create(
        StreamEventType.AGENT_START,
        self.name,
        input_text=input_text
    )

    try:
        # 构建消息列表
        messages = []

        if self.system_prompt:
            messages.append({"role": "system", "content": self.system_prompt})

            for msg in self._history:
                messages.append({"role": msg.role, "content": msg.content})

        messages.append({"role": "user", "content": input_text})

        # LLM 流式调用
        full_response = ""
        async for chunk in self.llm.astream_invoke(messages, **kwargs):
            full_response += chunk

            # 发送 LLM 输出块
            yield StreamEvent.create(
                StreamEventType.LLM_CHUNK,
                self.name,
                chunk=chunk
            )

            # 发送完成事件
            yield StreamEvent.create(
                StreamEventType.AGENT_FINISH,
                self.name,
                result=full_response
            )

        # 保存到历史
        self.add_message(Message(input_text, "user"))
        self.add_message(Message(full_response, "assistant"))

    except Exception as e:
        # 发送错误事件
        yield StreamEvent.create(
            StreamEventType.ERROR,
            self.name,
            error=str(e),
            error_type=type(e).__name__
        )
        raise
```



```python
    async def astream_invoke(self, messages: List[Dict], **kwargs) -> AsyncIterator[str]:
        """真正的异步流式调用（使用 OpenAI 原生异步客户端）"""
        if not self._async_client:
            self._async_client = self.create_async_client()
        
        try:
            // 调用 LLM
            response = await self._async_client.chat.completions.create(
                model=self.model,
                messages=messages,
                stream=True,
                **kwargs
            )

            collected_content = []
            reasoning_content = None
            usage = {}

            // 解析 chunk（将chunk封装成实体）
            async for chunk in response:
                if chunk.choices and len(chunk.choices) > 0:
                    delta = chunk.choices[0].delta

                    # 提取内容
                    if delta.content:
                        collected_content.append(delta.content)
                        yield delta.content

                    # Thinking model的推理过程
                    if self._is_thinking_model(self.model):
                        if hasattr(delta, 'reasoning_content') and delta.reasoning_content:
                            if reasoning_content is None:
                                reasoning_content = ""
                            reasoning_content += delta.reasoning_content

                # 提取usage（流式最后一个chunk可能包含）
                if hasattr(chunk, 'usage') and chunk.usage:
                    usage = {
                        "prompt_tokens": chunk.usage.prompt_tokens,
                        "completion_tokens": chunk.usage.completion_tokens,
                        "total_tokens": chunk.usage.total_tokens,
                    }
        except Exception as e:
            raise HelloAgentsException(f"OpenAI API异步流式调用失败: {str(e)}")
```





# ReActAgent
```plain
用户输入 input_text
      │
      ▼
┌─────────────────────────────┐
│     ReActAgent.run()        │  ← ReAct 智能体入口
│                             │
│  1. 构建对话消息              │
│  2. 构建工具Schema（含内置工具）│
│  3. 初始化循环步数计数器       │
└─────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────┐
│        ReAct 主循环（最多max_steps步）        │
│                                             │
│  ┌────────────────┐    ┌────────────────┐   │
│  │  循环步数自增   │───▶ │调用带工具LLM接口 │   │
│  └────────────────┘    └────────────────┘   │
│                                   │             │
│                                   ▼             │
│                           ┌────────────┐       │
│                           │ 解析工具调用 │       │
│                           └────────────┘       │
│              ┌────────────────────┴────────────┐│
│              │                                 ││
│              ▼                                 ││
│     ┌─────────────────┐               ┌────────────────┐│
│     │无工具调用        │               │有工具调用        ││
│     │→ 赋值最终答案    │               │→ 添加助手消息到历史││
│     └────────┬────────┘               └────────┬───────┘│
│              │                                 │        │
│              │                                 ▼        │
│              │                         ┌────────────────────┐│
│              │                         │ 遍历执行所有工具      ││
│              │                         │                     ││
│              │                         │  1.内置工具          ││
│              │                         │  - Thought：记录推理  ││
│              │                         │  - Finish：生成最终答案││
│              │                         │    → 触发流程结束  ││
│              │                         │  2.业务工具：执行任务 ││
│              │                         │  3.工具结果写入消息队列││
│              │                         └────────────────┘│
│              │                                      │    │
│              └──────────────────────────────────────┘    │
│                                             │             │
│  终止条件：                                    │             │
│  • 调用 Finish 工具                            │             │
│  • LLM 无任何工具调用                          │             │
│  • 达到最大循环步数 max_steps                  │             │
└─────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────┐
│        流程终止处理          │
│                             │
│  1. 超步数：返回任务失败提示   │
│  2. 正常结束：返回推理最终答案 │
└─────────────────────────────┘
      │
      ▼
┌─────────────────────────────┐
│     统一保存对话历史          │
│                             │
│  1. 保存用户输入消息          │
│  2. 保存助手最终回答          │
└─────────────────────────────┘
      │
      ▼
      返回最终答案
```





```python
# 新的系统提示词
DEFAULT_REACT_SYSTEM_PROMPT = """你是一个具备推理和行动能力的 AI 助手。

## 工作流程
你可以通过调用工具来完成任务：

1. **Thought 工具**：用于记录你的推理过程和分析
   - 在需要思考时调用
   - 参数：reasoning（你的推理内容）

2. **业务工具**：用于获取信息或执行操作
   - 根据任务需求选择合适的工具
   - 可以多次调用不同工具

3. **Finish 工具**：用于返回最终答案
   - 当你有足够信息得出结论时调用
   - 参数：answer（最终答案）

## 重要提醒
- 主动使用 Thought 工具记录推理过程
- 可以多次调用工具获取信息
- 只有在确信有足够信息时才调用 Finish
"""

def run(self, input_text: str, **kwargs) -> str:
    """
        运行 ReAct Agent

        Args:
            input_text: 用户问题
            **kwargs: 其他参数

        """

    final_answer = ""
    # 构建消息列表
    messages = self._build_messages(input_text)

    # 构建工具 schemas（包含内置工具和用户工具）
    tool_schemas = self._build_tool_schemas()

    current_step = 0
    total_tokens = 0


    while current_step < self.max_steps:
        current_step += 1
        print(f"\n--- 第 {current_step} 步 ---")
    
        # 保存当前步数（用于异常时保存）
        self._current_step = current_step
    
        # 调用 LLM（Function Calling）
        response = self.llm.invoke_with_tools(
            messages=messages,
            tools=tool_schemas,
            tool_choice="auto",
            **kwargs
        )
    
        # 累计 tokens
        if response.usage:
            total_tokens += response.usage.get("total_tokens", 0)
            self._total_tokens = total_tokens
    
        # 处理工具调用
        tool_calls = response.tool_calls
        if not tool_calls:
            # 没有工具调用，直接返回文本响应
            final_answer = response.content or "抱歉，我无法回答这个问题。"
    
        # 保存到历史记录
        self.add_message(Message(input_text, "user"))
        self.add_message(Message(final_answer, "assistant"))
    
        # 将助手消息添加到历史
        messages.append({
            "role": "assistant",
            "content": response.content,
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.name,
                        "arguments": tc.arguments
                    }
                }
                for tc in tool_calls
            ]
        })
    
        # 执行所有工具调用
        for tool_call in tool_calls:
            tool_name = tool_call.name
            tool_call_id = tool_call.id
            arguments = json.loads(tool_call.arguments)
        
            # 检查是否是内置工具
            if tool_name in self._builtin_tools:
                # 执行工具
                result = self._handle_builtin_tool(tool_name, arguments)
        
                # 检查是否是 Finish
                if tool_name == "Finish" and result.get("finished"):
                    # 是 Finish 工具 -> 说明流程结束了
                    final_answer = result["final_answer"]
        
                    # 保存到历史记录
                    self.add_message(Message(input_text, "user"))
                    self.add_message(Message(final_answer, "assistant"))
        
                    # 添加工具结果到消息
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": result['content']
                    })
                    return final_answer
            else:
               
                # 执行工具
                result = self._execute_tool_call(tool_name, arguments)
        
                # 添加工具结果到消息
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "content": result
                })
    
    # 达到最大步数
    print("⏰ 已达到最大步数，流程终止。")
    final_answer = "抱歉，我无法在限定步数内完成这个任务。"
    
    # 保存到历史记录
    self.add_message(Message(input_text, "user"))
    self.add_message(Message(final_answer, "assistant"))
    
    return final_answer
```



# ReflectionAgent
```plain
用户输入 input_text
      │
      ▼
┌─────────────────────────────┐
│   ReflectionAgent.run()     │  ← 反思智能体入口
└─────────────────────────────┘
      │
      ▼
┌─────────────────────────────┐
│      1. 初始执行任务         │
│  → 调用_execute_task        │
│  → 结果存入记忆(memory)      │
└─────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────┐
│    反思优化循环（最多max_iterations轮迭代）    │
│                                             │
│  ┌────────────────┐    ┌────────────────┐   │
│  │ 获取上一轮执行结果 │───▶│    反思生成反馈    │   │
│  └────────────────┘    │  → 调用_reflect_on_result │
│                       └────────────────┘   │
│                                   │             │
│                                   ▼             │
│                       ┌────────────────────┐    │
│                       │  反馈存入记忆(memory) │    │
│                       └────────────────────┘    │
│                                   │             │
│                       ┌────────────────────┐    │
│                       │ 检查是否无需改进？   │    │
│                       └────────┬───────────┘    │
│                                │                │
│                           是 → 终止循环          │
│                                │                │
│                           否 → 执行优化         │
│                      ┌────────────────────┐    │
│                      │  优化生成新结果     │    │
│                      │ → 调用_refine_result │    │
│                      └────────────────────┘    │
│                                │                │
│                      ┌────────────────────┐    │
│                      │  优化结果存入记忆    │    │
│                      └────────────────────┘    │
│                                             │
└─────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────┐
│      获取记忆中最终结果      │
└─────────────────────────────┘
      │
      ▼
┌─────────────────────────────┐
│     统一保存对话历史          │
│  1. 保存用户输入             │
│  2. 保存助手最终优化结果      │
└─────────────────────────────┘
      │
      ▼
      返回最终优化结果
```



```python
def run(self, input_text: str, **kwargs) -> str:
    """
        运行Reflection Agent

        Args:
            input_text: 任务描述
            **kwargs: 其他参数

        Returns:
            最终优化后的结果
        """
   

    # 1. 初始执行
    initial_result = self._execute_task(input_text, **kwargs)
    self.memory.add_record("execution", initial_result)

    # 2. 迭代循环：反思与优化
    for i in range(self.max_iterations):
        print(f"\n--- 第 {i+1}/{self.max_iterations} 轮迭代 ---")

        # a. 反思
        last_result = self.memory.get_last_execution()
        feedback = self._reflect_on_result(input_text, last_result, **kwargs)
        self.memory.add_record("reflection", feedback)

        # b. 检查是否需要停止
        if "无需改进" in feedback or "no need for improvement" in feedback.lower():
            print("\n✅ 反思认为结果已无需改进，任务完成。")
            break

        # c. 优化
        refined_result = self._refine_result(input_text, last_result, feedback, **kwargs)
        self.memory.add_record("execution", refined_result)

        final_result = self.memory.get_last_execution()

    # 保存到历史记录
    self.add_message(Message(input_text, "user"))
    self.add_message(Message(final_result, "assistant"))

    return final_result


def _execute_task(self, task: str, **kwargs) -> str:
        """执行初始任务"""
    messages = [
        {"role": "system", "content": self.system_prompt},
        {"role": "user", "content": f"请完成以下任务：\n\n{task}"}
    ]
    return self._get_llm_response(messages, **kwargs)

def _reflect_on_result(self, task: str, result: str, **kwargs) -> str:
     """对结果进行反思"""
    messages = [
        {"role": "system", "content": self.system_prompt},
        {"role": "user", "content": f"""请仔细审查以下回答，并找出可能的问题或改进空间：

# 原始任务:
{task}

# 当前回答:
{result}

请分析这个回答的质量，指出不足之处，并提出具体的改进建议。
如果回答已经很好，请回答"无需改进"。"""}
        ]
        return self._get_llm_response(messages, **kwargs)

def _refine_result(self, task: str, last_attempt: str, feedback: str, **kwargs) -> str:
    """根据反馈优化结果"""
    messages = [
        {"role": "system", "content": self.system_prompt},
        {"role": "user", "content": f"""请根据反馈意见改进你的回答：

# 原始任务:
{task}

# 上一轮回答:
{last_attempt}

# 反馈意见:
{feedback}

请提供一个改进后的回答。"""}
        ]
    return self._get_llm_response(messages, **kwargs)

def _get_llm_response(self, messages: List[Dict[str, str]], **kwargs) -> str:
    """
    调用LLM并获取完整响应（支持 Function Calling）

    Args:
        messages: 消息列表
        **kwargs: 其他参数

    Returns:
        LLM响应文本
    """
    
    # 如果没有启用工具调用，直接返回
    if not self.enable_tool_calling or not self.tool_registry:
        llm_response = self.llm.invoke(messages, **kwargs)
        return llm_response.content if hasattr(llm_response, 'content') else str(llm_response)

        # 启用工具调用模式
        tool_schemas = self._build_tool_schemas()
        current_iteration = 0

    while current_iteration < self.max_tool_iterations:
        current_iteration += 1

        response = self.llm.invoke_with_tools(
            messages=messages,
            tools=tool_schemas,
            tool_choice="auto",
            **kwargs)

        # 处理工具调用
        tool_calls = response.tool_calls
        if not tool_calls:
            # 没有工具调用，返回文本响应
            return response.content or ""

        # 将助手消息添加到历史
        messages.append({
            "role": "assistant",
            "content": response.content,
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.name,
                        "arguments": tc.arguments
                    }
                }
                for tc in tool_calls
            ]
        })

        # 执行所有工具调用
        for tool_call in tool_calls:
            tool_name = tool_call.name
            tool_call_id = tool_call.id

            # 执行工具
            arguments = json.loads(tool_call.arguments)
            result = self._execute_tool_call(tool_name, arguments)

            # 添加工具结果到消息
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call_id,
                "content": result
            })

    # 如果超过最大迭代次数，获取最后一次回答
    if current_iteration >= self.max_tool_iterations:
        llm_response = self.llm.invoke(messages, **kwargs)
        return llm_response.content if hasattr(llm_response, 'content') else str(llm_response)

        return ""


```





# PlanSloveAgent
```plain
用户输入 input_text
      │
      ▼
┌─────────────────────────────┐
│  PlanAndSolveAgent.run()    │  ← 规划求解智能体入口
└─────────────────────────────┘
      │
      ▼
┌─────────────────────────────┐
│        1. 生成计划           │
│  → 调用LLM+工具生成步骤列表   │
└─────────────────────────────┘
      │
      ▼
┌─────────────────────────────┐
│        2. 执行计划           │
│  → 遍历计划中的每一个步骤     │
└─────────────────────────────┘
      │
      ▼
┌─────────────────────────────┐
│      执行单个步骤（循环）     │
│  ┌─────────────────────────┐ │
│  │  调用LLM（支持工具调用）  │ │
│  │  工具调用→执行→返回结果   │ │
│  └─────────────────────────┘ │
└─────────────────────────────┘
      │
      ▼
┌─────────────────────────────┐
│     记录步骤执行结果         │
└─────────────────────────────┘
      │
      ▼
┌─────────────────────────────┐
│   所有步骤执行完毕，得到答案  │
└─────────────────────────────┘
      │
      ▼
┌─────────────────────────────┐
│     保存对话历史记录         │
└─────────────────────────────┘
      │
      ▼
  返回最终答案
```





```python
def run(self, input_text: str, **kwargs) -> str:
    """
    运行Plan and Solve Agent
    
    Args:
        input_text: 要解决的问题
        **kwargs: 其他参数
        
    Returns:
        最终答案
    """
    
    # 1. 生成计划
    plan = self.planner.plan(input_text, **kwargs)
    
    # 2. 执行计划
    final_answer = self.executor.execute(input_text, plan, **kwargs)
    
    # 保存到历史记录
    self.add_message(Message(input_text, "user"))
    self.add_message(Message(final_answer, "assistant"))
    
    return final_answer

def plan(self, question: str, **kwargs) -> List[str]:
    """
    生成执行计划（使用 Function Calling）

    Args:
        question: 要解决的问题
        **kwargs: LLM调用参数

    Returns:
        步骤列表
    """
    print("--- 正在生成计划 ---")

    # 定义计划生成工具
    plan_tool = {
        "type": "function",
        "function": {
            "name": "generate_plan",
            "description": "生成解决问题的分步计划",
            "parameters": {
                "type": "object",
                "properties": {
                    "steps": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "按顺序排列的执行步骤列表"
                    }
                },
                "required": ["steps"]
            }
        }
    }

    messages = [
        {"role": "system", "content": self.system_prompt},
        {"role": "user", "content": f"请为以下问题生成详细的执行计划：\n\n{question}"}
    ]


    response = self.llm_client.invoke_with_tools(
        messages=messages,
        tools=[plan_tool],
        tool_choice={"type": "function", "function": {"name": "generate_plan"}},
        **kwargs
    )

    # 提取工具调用结果
    if response.tool_calls:
        tool_call = response.tool_calls[0]
        arguments = json.loads(tool_call.arguments)
        plan = arguments.get("steps", [])

        print(f"✅ 计划已生成:")
        for i, step in enumerate(plan, 1):
            print(f"  {i}. {step}")

        return plan
    else:
        print("❌ 模型未返回计划工具调用")
        return []


def execute(self, question: str, plan: List[str], **kwargs) -> str:
    """
    按计划执行任务（支持 Function Calling）

    Args:
        question: 原始问题
        plan: 执行计划
        **kwargs: LLM调用参数

    Returns:
        最终答案
    """
    history = []
    final_answer = ""

    print("\n--- 正在执行计划 ---")
    for i, step in enumerate(plan, 1):
      
        # 构建上下文消息
        context = f"""
                # 原始问题:
                {question}
                
                # 完整计划:
                {self._format_plan(plan)}
                
                # 历史步骤与结果:
                {self._format_history(history) if history else "无"}
                
                # 当前步骤:
                {step}
                
                请执行当前步骤并给出结果。
                """

        # 执行单个步骤（支持工具调用）（与 LLM 交互）
        response_text = self._execute_step(context, **kwargs)

        history.append({"step": step, "result": response_text})
        final_answer = response_text
        print(f"✅ 步骤 {i} 已完成，结果: {final_answer}")

    return final_answer


def _execute_step(self, context: str, **kwargs) -> str:
    """
    执行单个步骤（支持 Function Calling）

    Args:
        context: 上下文信息
        **kwargs: 其他参数

    Returns:
        步骤执行结果
    """
    messages = [
        {"role": "system", "content": self.system_prompt},
        {"role": "user", "content": context}
    ]

    # 如果没有启用工具调用，直接返回
    if not self.enable_tool_calling or not self.tool_registry:
        llm_response = self.llm_client.invoke(messages, **kwargs)
        return llm_response.content if hasattr(llm_response, 'content') else str(llm_response)

    # 启用工具调用模式
    tool_schemas = t_build_tool_schemas()
    current_iteration = 0
    while current_iteration < self.max_tool_iterations:
        current_iteration += 1

       
        response = self.llm_client.invoke_with_tools(
            messages=messages,
            tools=tool_schemas,
            tool_choice="auto",
            **kwargs)
  
        # 处理工具调用
        tool_calls = response.tool_calls
        if not tool_calls:
            # 没有工具调用，返回文本响应
            return response.content or ""

        # 将助手消息添加到历史
        messages.append({
            "role": "assistant",
            "content": response.content,
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.name,
                        "arguments": tc.arguments
                    }
                }
                for tc in tool_calls
            ]
        })

        # 执行所有工具调用
        for tool_call in tool_calls:
            tool_name = tool_call.name
            tool_call_id = tool_call.id

            # 执行工具（复用基类方法）
            arguments = json.loads(tool_call.arguments)
            result = temp_agent._execute_tool_call(tool_name, arguments)

            # 添加工具结果到消息
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call_id,
                "content": result
            })

    # 如果超过最大迭代次数，获取最后一次回答
    if current_iteration >= self.max_tool_iterations:
        llm_response = self.llm_client.invoke(messages, **kwargs)
        return llm_response.content if hasattr(llm_response, 'content') else str(llm_response)

    return ""

```





# 总结
1. SimpleAgent 基础的**通用工具调用版 Agent**
+ 逻辑：LLM 自由决策「直接回答 / 调用工具」，自动完成**调用 LLM→解析工具→执行工具→回填消息**闭环
+ 特点：无固定范式、无内置特殊工具、轻量化、完全依赖 LLM 自发工具调用
+ 终止：LLM 不再发起工具调用 / 达到最大迭代次数 / LLM 调用异常



2. ReActAgent **ReAct 思考 - 行动** 规范的结构化智能体
+ 逻辑：强制规范流程，内置 `Thought`（显性推理）、`Finish`（强制收尾）工具；区分**内置工具 / 业务工具**分别处理
+ 特点：强约束、显性推理过程、不允许随意结束，**必须通过 Finish 工具正常收尾**
+ 终止：调用 Finish 工具 / 无工具调用 / 达到最大执行步数



3. ReflectionAgent 具备 **自我反思 + 迭代优化** 能力的打磨型智能体
+ 逻辑：每轮「读取上一轮结果→LLM 反思生成反馈→判断是否无需改进→无需改进则终止，否则优化结果并更新记忆」
+ 特点：不侧重多工具串联，侧重**结果自省、多轮迭代打磨优化**；依赖记忆存储每轮执行 / 反思记录
+ 终止：反思判定无需改进 / 达到最大迭代轮数



4. PlanAndSolveAgent先整体规划、再分步执行 的分治拆解型智能体
+ 流程：入口分两大阶段 → ①规划阶段：LLM + 工具生成**分步任务计划列表**；②执行阶段：遍历计划每一个步骤，**逐步独立调用 LLM + 工具执行**
+ 特点：前置任务拆解、串行分步落地、复杂任务化整为零，每步可独立使用工具

