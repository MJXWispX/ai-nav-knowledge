# HelloAgent 介绍
Agent 开发框架，类似 LangChain、LangGraph 等 Agent 框架。

通俗的讲，HelloAgent 框架就是对原生 LLM 的响应包了一层，如 Function-Call。让开发人员更专注于业务的开发。

我更深刻认识到 **LLM 只有判断和决策能力，并没有执行工具的能力**。执行工具由 HelloAgent 等 Agent 开发框架完成。

遵循 Agent 设计模式，内置了 SimpleAgent、ReActAgent、ReflectionAgent、PlanSloveAgent 常用 Agent。



# Agent
Agent 父类核心方法：`run()、arun()、arun_stream()` （异步方法提供对应的钩子函数）

PS：

+ 同步流程**串行可控**，无需生命周期钩子
+ 异步流程**延迟、异步、状态多变**，钩子函数就是为了**管控异步任务的完整生命周期**（启动、进度、成功、失败、终止）。

```python
class Agent(ABC):
    """Agent基类

    集成能力：
    - HistoryManager: 历史管理与压缩
    - ObservationTruncator: 工具输出截断
    - TraceLogger: 可观测性（JSONL + HTML）
    - ToolRegistry: 工具管理（可选）
    - SkillLoader: 知识外化（可选）
    """

    def __init__(
        self,
        name: str,
        llm: HelloAgentsLLM,
        system_prompt: Optional[str] = None,
        config: Optional[Config] = None,
        tool_registry: Optional['ToolRegistry'] = None
    ):
        pass
    
    @abstractmethod
    def run(self, input_text: str, **kwargs) -> str:
        """运行Agent（同步版本）"""
        pass
        
    async def arun(
        self,
        input_text: str,
        on_start: LifecycleHook = None,
        on_step: LifecycleHook = None,
        on_finish: LifecycleHook = None,
        on_error: LifecycleHook = None,
        **kwargs
    ) -> str:
        """
        异步执行 Agent（基础版本）
        
        默认实现：在线程池中运行同步 run() 方法
        子类可以覆盖此方法实现更复杂的异步逻辑（如工具并行）
        
        Args:
            input_text: 输入文本
            on_start: Agent 开始执行时的钩子
            on_step: 每个推理步骤的钩子
            on_finish: Agent 执行完成时的钩子
            on_error: 发生错误时的钩子
            **kwargs: 其他参数
            
        Returns:
            执行结果
        
        Example:
            >>> agent = SimpleAgent(...)
            >>> result = await agent.arun("Hello", on_start=my_hook)
        """
        # 触发开始事件
        await self._emit_event(EventType.AGENT_START,...)

        try:
            # 默认实现：在线程池中运行同步 run()
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                lambda: self.run(input_text, **kwargs)
            )

            # 触发完成事件
            await self._emit_event(EventType.AGENT_FINISH,...)

            return result

        except Exception as e:
            # 触发错误事件
            await self._emit_event(EventType.AGENT_ERROR,...)
            raise

    async def arun_stream(
        self,
        input_text: str,
        **kwargs
    ) -> AsyncGenerator[AgentEvent, None]:
        
    """
    流式执行 Agent（基础版本）
    
    默认实现：执行 arun() 并返回开始/完成事件
    子类应该覆盖此方法实现真正的流式输出
    
    Args:
        input_text: 输入文本
        **kwargs: 其他参数
    
    Yields:
        AgentEvent: 生命周期事件
    
    Example:
        >>> async for event in agent.arun_stream("Hello"):
        ...print(event.type, event.data)
    """
    # 开始事件
    yield AgentEvent.create(EventType.AGENT_START,...)
    
    # 执行
    try:
        result = await self.arun(input_text, **kwargs)
    
        # 完成事件
        yield AgentEvent.create(EventType.AGENT_FINISH,...)
    except Exception as e:
        # 错误事件
        yield AgentEvent.create(EventType.AGENT_ERROR,...)
        raise
            
    async def _emit_event(
        self,
        event_type: EventType,
        hook: LifecycleHook,
        **data
    ):
        """触发事件并调用钩子

        Args:
            event_type: 事件类型
            hook: 生命周期钩子（可选）
            **data: 事件数据
        """
        event = AgentEvent.create(event_type, self.name, **data)

        if hook:
            try:
                # 使用 asyncio.wait_for 设置超时
                timeout = getattr(self.config, 'hook_timeout_seconds', 5.0)
                await asyncio.wait_for(hook(event), timeout=timeout)
            except asyncio.TimeoutError:
                # 钩子超时不应中断主流程
                if hasattr(self, 'trace_logger') and self.trace_logger:
                    self.trace_logger.log_event(
                        "hook_timeout",
                        {"event_type": event_type.value, "timeout": timeout}
                    )
            except Exception as e:
                # 钩子异常不应中断主流程
                if hasattr(self, 'trace_logger') and self.trace_logger:
                    self.trace_logger.log_event(
                        "hook_error",
                        {"event_type": event_type.value, "error": str(e)}
                    )
```

## SimpleAgent 
SimpleAgent：简单的对话Agent，支持可选的工具调用

```python
class SimpleAgent(Agent):
    """简单的对话Agent，支持可选的工具调用

    特性：
        - 纯对话模式（无工具）
        - Function Calling 工具调用（可选）
        - 自动多轮工具调用
    """

    def run(self, input_text: str, **kwargs) -> str:
        """
        运行 SimpleAgent（基于 Function Calling）

        Args:
            input_text: 用户输入
            **kwargs: 其他参数

        Returns:
            最终回复
        """
        from datetime import datetime
        from hello_agents.observability import TraceLogger

        session_start_time = datetime.now()

        # 为每次 run 创建新的 TraceLogger（避免多轮对话时文件已关闭的问题）
        trace_logger = None
        if self.config.trace_enabled:
            # 创建 trace_logger
            trace_logger = TraceLogger(...)
            # 记录session_start日志
            trace_logger.log_event(...)

        # 构建消息列表
        messages = self._build_messages(input_text)

        # 记录用户消息
        if trace_logger:
            trace_logger.log_event(...)

        # 如果没有启用工具调用，直接返回 LLM 响应
        if not self.enable_tool_calling or not self.tool_registry:
            llm_response = self.llm.invoke(messages, **kwargs)
            response_text = llm_response.content if hasattr(llm_response, 'content') else str(llm_response)

            # 保存到历史记录
            self.add_message(Message(input_text, "user"))
            self.add_message(Message(response_text, "assistant"))

            if trace_logger:
                duration = (datetime.now() - session_start_time).total_seconds()
                trace_logger.log_event(...)
                # 日志持久化到文件
                trace_logger.finalize()

            return response_text

        # 启用工具调用模式
        tool_schemas = self._build_tool_schemas()

        current_iteration = 0
        final_response = ""

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
                if trace_logger:
                    trace_logger.log_event(...)
                break

            # 获取响应消息
            # response 现在是 LLMToolResponse 对象

            # 记录模型输出
            if trace_logger:
                trace_logger.log_event(...)

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

            # 执行所有工具调用
            for tool_call in tool_calls:
                tool_name = tool_call.name
                tool_call_id = tool_call.id

                try:
                    arguments = json.loads(tool_call.arguments)
                except json.JSONDecodeError as e:
                    print(f"❌ 工具参数解析失败: {e}")
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": f"错误：参数格式不正确 - {str(e)}"
                    })
                    continue

                # 记录工具调用
                if trace_logger:
                    trace_logger.log_event(...)

                # 执行工具（复用基类方法）
                result = self._execute_tool_call(tool_name, arguments)

                # 记录工具结果
                if trace_logger:
                    trace_logger.log_event(...)

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

        if trace_logger:
            trace_logger.log_event(...)
            trace_logger.finalize()

        return final_response

    def stream_run(self, input_text: str, **kwargs) -> Iterator[str]:
        """
        流式运行Agent
        
        Args:
            input_text: 用户输入
            **kwargs: 其他参数
            
        Yields:
            Agent响应片段
        """
        # 构建消息列表
        messages = []
        
        if self.system_prompt:
            messages.append({"role": "system", "content": self.system_prompt})
        
        for msg in self._history:
            messages.append({"role": msg.role, "content": msg.content})
        
        messages.append({"role": "user", "content": input_text})
        
        # 流式调用LLM
        full_response = ""
        for chunk in self.llm.stream_invoke(messages, **kwargs):
            full_response += chunk
            yield chunk
        
        # 保存完整对话到历史记录
        self.add_message(Message(input_text, "user"))
        self.add_message(Message(full_response, "assistant"))

    async def arun_stream(
        self,
        input_text: str,
        on_start: LifecycleHook = None,
        on_finish: LifecycleHook = None,
        on_error: LifecycleHook = None,
        **kwargs
    ) -> AsyncGenerator[StreamEvent, None]:
        """
        SimpleAgent 真正的流式执行

        实时返回 LLM 输出的每个文本块

        Args:
            input_text: 用户输入
            on_start: 开始钩子
            on_finish: 完成钩子
            on_error: 错误钩子
            **kwargs: 其他参数

        Yields:
            StreamEvent: 流式事件
        """
        # 发送开始事件
        yield StreamEvent.create(StreamEventType.AGENT_START,...)

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
                yield StreamEvent.create(StreamEventType.LLM_CHUNK,...)

            # 发送完成事件
            yield StreamEvent.create( StreamEventType.AGENT_FINISH...)

            # 保存到历史
            self.add_message(Message(input_text, "user"))
            self.add_message(Message(full_response, "assistant"))

        except Exception as e:
            # 发送错误事件
            yield StreamEvent.create(StreamEventType.ERROR,...)
            raise

```





## ReActAgent
思考-行动-观察

ReActAgent 内置了 Thougt 思考工具，业务工具，Finish 工具（设计出来专门用于判断任务是否结束的）。 

ReAct 使用 Finish 工具判断这次任务是否完成。如，ReAct 判断需要使用 Finish 工具，说明这次任务已经完成。



```python

DEFAULT_REACT_SYSTEM_PROMPT = 
"""你是一个具备推理和行动能力的 AI 助手。

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
class ReActAgent(Agent):
    """
    ReAct Agent - 基于 Function Calling 的推理与行动

    核心改进：
    - 使用 OpenAI Function Calling（结构化输出）
    - 支持 Thought 工具（显式推理）
    - 支持 Finish 工具（结束流程）
    - 无需正则解析，解析成功率 99%+
    """
    def _run_impl(self, input_text: str, session_start_time, **kwargs) -> str:
        """
        ReAct Agent 主逻辑实现

        Args:
            input_text: 用户问题
            session_start_time: 会话开始时间
            **kwargs: 其他参数

        Returns:
            最终答案
        """
        # 构建消息列表
        messages = self._build_messages(input_text)

        # 构建工具 schemas（包含内置工具和用户工具）
        tool_schemas = self._build_tool_schemas()

        current_step = 0
        total_tokens = 0

        # 记录用户消息
        if self.trace_logger:
            self.trace_logger.log_event(...)

        print(f"\n🤖 {self.name} 开始处理问题: {input_text}")

        while current_step < self.max_steps:
            current_step += 1
            print(f"\n--- 第 {current_step} 步 ---")

            # 保存当前步数（用于异常时保存）
            self._current_step = current_step

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
                if self.trace_logger:
                    self.trace_logger.log_event(
                        "error",
                        {"error_type": "LLM_ERROR", "message": str(e)},
                        step=current_step
                    )
                break

            # 获取响应消息
            # response 现在是 LLMToolResponse 对象

            # 累计 tokens
            if response.usage:
                total_tokens += response.usage.get("total_tokens", 0)
                self._total_tokens = total_tokens

            # 记录模型输出
            if self.trace_logger:
                self.trace_logger.log_event(...)

            # 处理工具调用
            tool_calls = response.tool_calls
            if not tool_calls:
                # 没有工具调用，直接返回文本响应
                final_answer = response.content or "抱歉，我无法回答这个问题。"
                print(f"💬 直接回复: {final_answer}")

                # 保存到历史记录
                self.add_message(Message(input_text, "user"))
                self.add_message(Message(final_answer, "assistant"))

                if self.trace_logger:
                    duration = (datetime.now() - session_start_time).total_seconds()
                    self.trace_logger.log_event(...)
                    self.trace_logger.finalize()

                return final_answer

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

                try:
                    arguments = json.loads(tool_call.arguments)
                except json.JSONDecodeError as e:
                    print(f"❌ 工具参数解析失败: {e}")
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": f"错误：参数格式不正确 - {str(e)}"
                    })
                    continue

                # 记录工具调用
                if self.trace_logger:
                    self.trace_logger.log_event(...)

                # 检查是否是内置工具
                if tool_name in self._builtin_tools:
                    result = self._handle_builtin_tool(tool_name, arguments)
                    print(f"🔧 {tool_name}: {result['content']}")

                    # 记录工具结果
                    if self.trace_logger:
                        self.trace_logger.log_event(...)

                    # 检查是否是 Finish
                    if tool_name == "Finish" and result.get("finished"):
                        final_answer = result["final_answer"]
                        print(f"🎉 最终答案: {final_answer}")

                        # 保存到历史记录
                        self.add_message(Message(input_text, "user"))
                        self.add_message(Message(final_answer, "assistant"))

                        if self.trace_logger:
                            duration = (datetime.now() - session_start_time).total_seconds()
                            self.trace_logger.log_event(
                                "session_end",
                                {
                                    "duration": duration,
                                    "total_steps": current_step,
                                    "final_answer": final_answer,
                                    "status": "success"
                                }
                            )
                            self.trace_logger.finalize()

                        return final_answer

                    # 添加工具结果到消息
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": result['content']
                    })
                else:
                    # 用户工具
                    print(f"🎬 调用工具: {tool_name}({arguments})")

                    # 执行工具（使用基类方法，支持字典参数）
                    result = self._execute_tool_call(tool_name, arguments)

                    # 记录工具结果
                    if self.trace_logger:
                        self.trace_logger.log_event(...)

                    # 检查是否是错误
                    if result.startswith("❌"):
                        print(result)
                    else:
                        print(f"👀 观察: {result}")

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

        # 记录会话结束（超时）
        if self.trace_logger:
            duration = (datetime.now() - session_start_time).total_seconds()
            self.trace_logger.log_event(...)
            self.trace_logger.finalize()

        return final_answer

    def run(self, input_text: str, **kwargs) -> str:
        """
        运行 ReAct Agent

        Args:
            input_text: 用户问题
            **kwargs: 其他参数

        Returns:
            最终答案
        """
        session_start_time = datetime.now()

        try:
            # 执行主逻辑
            final_answer = self._run_impl(input_text, session_start_time, **kwargs)

            # 更新元数据
            self._session_metadata["total_steps"] = getattr(self, '_current_step', 0)
            self._session_metadata["total_tokens"] = getattr(self, '_total_tokens', 0)

            return final_answer

        except KeyboardInterrupt:
            # Ctrl+C 时自动保存
            print("\n⚠️ 用户中断，自动保存会话...")
            if self.session_store:
                try:
                    filepath = self.save_session("session-interrupted")
                    print(f"✅ 会话已保存: {filepath}")
                except Exception as e:
                    print(f"❌ 保存失败: {e}")
            raise

        except Exception as e:
            # 错误时也尝试保存
            print(f"\n❌ 发生错误: {e}")
            if self.session_store:
                try:
                    filepath = self.save_session("session-error")
                    print(f"✅ 会话已保存: {filepath}")
                except Exception as save_error:
                    print(f"❌ 保存失败: {save_error}")
            raise

    
    async def arun(
        self,
        input_text: str,
        on_start: LifecycleHook = None,
        on_step: LifecycleHook = None,
        on_tool_call: LifecycleHook = None,
        on_finish: LifecycleHook = None,
        on_error: LifecycleHook = None,
        **kwargs
    ) -> str:
        """
        异步执行 ReAct Agent（完整版本）

        支持：
        - 工具并行执行（独立工具）
        - 生命周期钩子
        - 异步 LLM 调用

        Args:
            input_text: 用户问题
            on_start: Agent 开始执行时的钩子
            on_step: 每个推理步骤的钩子
            on_tool_call: 工具调用时的钩子
            on_finish: Agent 执行完成时的钩子
            on_error: 发生错误时的钩子
            **kwargs: 其他参数

        Returns:
            最终答案
        """
        session_start_time = datetime.now()

        # 触发开始事件
        await self._emit_event(
            EventType.AGENT_START,...
        )

        try:
            # 构建消息列表
            messages = self._build_messages(input_text)
            tool_schemas = self._build_tool_schemas()

            current_step = 0
            total_tokens = 0

            # 记录用户消息
            if self.trace_logger:
                self.trace_logger.log_event(...)

            print(f"\n🤖 {self.name} 开始处理问题: {input_text}")

            while current_step < self.max_steps:
                current_step += 1
                print(f"\n--- 第 {current_step} 步 ---")

                # 触发步骤开始事件
                await self._emit_event(
                    EventType.STEP_START,...)

                # 异步调用 LLM
                try:
                    response = await self.llm.ainvoke_with_tools(
                        messages=messages,
                        tools=tool_schemas,
                        tool_choice="auto",
                        **kwargs
                    )
                except Exception as e:
                    print(f"❌ LLM 调用失败: {e}")
                    await self._emit_event(
                        EventType.AGENT_ERROR,
                        on_error,
                        error=str(e),
                        step=current_step
                    )
                    break

                # 累计 tokens
                if response.usage:
                    total_tokens += response.usage.get("total_tokens", 0)

                # 记录模型输出
                # 记录模型输出
                if self.trace_logger:
                    self.trace_logger.log_event(...)

                # 处理工具调用
                tool_calls = response.tool_calls
                if not tool_calls:
                    # 没有工具调用，直接返回
                    final_answer = response.content or "抱歉，我无法回答这个问题。"
                    print(f"💬 直接回复: {final_answer}")

                    self.add_message(Message(input_text, "user"))
                    self.add_message(Message(final_answer, "assistant"))

                    await self._emit_event(
                        EventType.AGENT_FINISH,...)

                    if self.trace_logger:
                        duration = (datetime.now() - session_start_time).total_seconds()
                        self.trace_logger.log_event(...)
                        self.trace_logger.finalize()

                    return final_answer

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

                # 异步并行执行工具
                tool_results = await self._execute_tools_async(
                    tool_calls,
                    current_step,
                    on_tool_call
                )

                # 检查是否有 Finish 工具
                for tool_name, tool_call_id, result in tool_results:
                    if tool_name == "Finish" and result.get("finished"):
                        final_answer = result["final_answer"]
                        print(f"🎉 最终答案: {final_answer}")

                        self.add_message(Message(input_text, "user"))
                        self.add_message(Message(final_answer, "assistant"))

                        await self._emit_event(
                            EventType.AGENT_FINISH,...)

                        if self.trace_logger:
                            duration = (datetime.now() - session_start_time).total_seconds()
                            self.trace_logger.log_event(...)
                            self.trace_logger.finalize()

                        return final_answer

                    # 添加工具结果到消息
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": result.get('content', str(result))
                    })

                # 触发步骤完成事件
                await self._emit_event(
                    EventType.STEP_FINISH,...)

            # 达到最大步数
            print("⏰ 已达到最大步数，流程终止。")
            final_answer = "抱歉，我无法在限定步数内完成这个任务。"

            self.add_message(Message(input_text, "user"))
            self.add_message(Message(final_answer, "assistant"))

            await self._emit_event(
                EventType.AGENT_FINISH,...)

            if self.trace_logger:
                duration = (datetime.now() - session_start_time).total_seconds()
                self.trace_logger.log_event(...)
                self.trace_logger.finalize()

            return final_answer

        except Exception as e:
            await self._emit_event(
                EventType.AGENT_ERROR,...)
            raise

    async def arun_stream(
        self,
        input_text: str,
        on_start: LifecycleHook = None,
        on_step: LifecycleHook = None,
        on_tool_call: LifecycleHook = None,
        on_finish: LifecycleHook = None,
        on_error: LifecycleHook = None,
        **kwargs
    ) -> AsyncGenerator[StreamEvent, None]:
        """
        ReActAgent 真正的流式执行

        实时返回：
        - LLM 输出的每个文本块
        - 工具调用的开始和结束
        - 步骤的开始和结束

        Args:
            input_text: 用户问题
            on_start: 开始钩子
            on_step: 步骤钩子
            on_tool_call: 工具调用钩子
            on_finish: 完成钩子
            on_error: 错误钩子
            **kwargs: 其他参数

        Yields:
            StreamEvent: 流式事件
        """
        session_start_time = datetime.now()

        # 发送开始事件
        yield StreamEvent.create(
            StreamEventType.AGENT_START,...)

        await self._emit_event(EventType.AGENT_START, on_start, input_text=input_text)

        try:
            # 构建消息列表
            messages = self._build_messages(input_text)
            tool_schemas = self._build_tool_schemas()

            current_step = 0
            final_answer = None

            print(f"\n🤖 {self.name} 开始处理问题: {input_text}")

            while current_step < self.max_steps:
                current_step += 1

                # 发送步骤开始事件
                yield StreamEvent.create(
                    StreamEventType.STEP_START,...
                )

                await self._emit_event(EventType.STEP_START, on_step, step=current_step)

                print(f"\n--- 第 {current_step} 步 ---")

                # LLM 流式调用
                full_response = ""
                tool_calls_data = []

                try:
                    # 使用 LLM 的异步流式方法
                    async for chunk in self.llm.astream_invoke(messages, **kwargs):
                        full_response += chunk

                        # 发送 LLM 输出块
                        yield StreamEvent.create(
                            StreamEventType.LLM_CHUNK,...
                        )

                        print(chunk, end="", flush=True)

                    print()  # 换行

                except Exception as e:
                    error_msg = f"LLM 调用失败: {str(e)}"
                    print(f"❌ {error_msg}")

                    yield StreamEvent.create(
                        StreamEventType.ERROR,...
                    )

                    await self._emit_event(EventType.AGENT_ERROR, on_error, error=error_msg)
                    break

                # 解析工具调用（需要完整响应）
                # 注意：流式输出后需要重新调用 LLM 获取 tool_calls
                # 这里简化处理：使用非流式调用获取工具调用
                try:
                    response = self.llm.invoke_with_tools(
                        messages=messages,
                        tools=tool_schemas,
                        tool_choice="auto",
                        **kwargs
                    )

                    tool_calls = response.tool_calls

                    if not tool_calls:
                        # 没有工具调用，直接返回
                        final_answer = response.content or full_response or "抱歉，我无法回答这个问题。"

                        yield StreamEvent.create(
                            StreamEventType.AGENT_FINISH,...
                        )

                        await self._emit_event(EventType.AGENT_FINISH, on_finish, result=final_answer)

                        # 保存到历史
                        self.add_message(Message(input_text, "user"))
                        self.add_message(Message(final_answer, "assistant"))

                        return

                    # 添加助手消息到历史
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

                    # 执行工具调用
                    tool_results = await self._execute_tools_async_stream(
                        tool_calls,
                        current_step,
                        on_tool_call
                    )

                    # 发送工具结果事件并添加到消息
                    for tool_name, tool_call_id, result_dict in tool_results:
                        yield StreamEvent.create(
                            StreamEventType.TOOL_CALL_FINISH,...
                        )

                        messages.append({
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "content": result_dict["content"]
                        })

                        # 检查是否是 Finish 工具
                        if tool_name == "Finish":
                            try:
                                args = json.loads(tool_calls[0].arguments)
                                final_answer = args.get("answer", result_dict["content"])
                            except:
                                final_answer = result_dict["content"]

                            yield StreamEvent.create(
                                StreamEventType.AGENT_FINISH,
                                self.name,
                                result=final_answer,
                                total_steps=current_step
                            )

                            await self._emit_event(EventType.AGENT_FINISH, on_finish, result=final_answer)

                            # 保存到历史
                            self.add_message(Message(input_text, "user"))
                            self.add_message(Message(final_answer, "assistant"))

                            return

                    # 发送步骤完成事件
                    yield StreamEvent.create(
                        StreamEventType.STEP_FINISH,...
                    )

                except Exception as e:
                    error_msg = f"工具执行失败: {str(e)}"
                    print(f"❌ {error_msg}")

                    yield StreamEvent.create(
                        StreamEventType.ERROR,...
                    )

                    await self._emit_event(EventType.AGENT_ERROR, on_error, error=error_msg)
                    break

            # 达到最大步数
            if not final_answer:
                final_answer = "抱歉，已达到最大步数限制，无法完成任务。"

                yield StreamEvent.create(
                    StreamEventType.AGENT_FINISH,...
                )

                await self._emit_event(EventType.AGENT_FINISH, on_finish, result=final_answer)

                # 保存到历史
                self.add_message(Message(input_text, "user"))
                self.add_message(Message(final_answer, "assistant"))

        except Exception as e:
            error_msg = f"Agent 执行失败: {str(e)}"

            yield StreamEvent.create(
                StreamEventType.ERROR,...
            )

            await self._emit_event(EventType.AGENT_ERROR, on_error, error=error_msg)
            raise
    
```

## ReflectionAgent
执行-评估-优化

```python
class ReflectionAgent(Agent):
    """
    Reflection Agent - 自我反思与迭代优化的智能体

    这个Agent能够：
    1. 执行初始任务
    2. 对结果进行自我反思
    3. 根据反思结果进行优化
    4. 迭代改进直到满意
    5. 支持工具调用（可选）

    特别适合代码生成、文档写作、分析报告等需要迭代优化的任务。

    使用标准 Function Calling 格式，通过 system_prompt 定义角色和行为。
    """

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

    def run(self, input_text: str, **kwargs) -> str:
        """
            运行Reflection Agent
    
            Args:
                input_text: 任务描述
                **kwargs: 其他参数
    
            Returns:
                最终优化后的结果
        """
        print(f"\n🤖 {self.name} 开始处理任务: {input_text}")

        # 重置记忆
        self.memory = Memory()

        # 1. 初始执行
        print("\n--- 正在进行初始尝试 ---")
        initial_result = self._execute_task(input_text, **kwargs)
        self.memory.add_record("execution", initial_result)

        # 2. 迭代循环：反思与优化
        for i in range(self.max_iterations):
            print(f"\n--- 第 {i+1}/{self.max_iterations} 轮迭代 ---")

            # a. 反思
            print("\n-> 正在进行反思...")
            last_result = self.memory.get_last_execution()
            feedback = self._reflect_on_result(input_text, last_result, **kwargs)
            self.memory.add_record("reflection", feedback)

            # b. 检查是否需要停止
            if "无需改进" in feedback or "no need for improvement" in feedback.lower():
                print("\n✅ 反思认为结果已无需改进，任务完成。")
                break

            # c. 优化
            print("\n-> 正在进行优化...")
            refined_result = self._refine_result(input_text, last_result, feedback, **kwargs)
            self.memory.add_record("execution", refined_result)

        final_result = self.memory.get_last_execution()
        print(f"\n--- 任务完成 ---\n最终结果:\n{final_result}")

        # 保存到历史记录
        self.add_message(Message(input_text, "user"))
        self.add_message(Message(final_result, "assistant"))

        return final_result

      async def arun_stream(
        self,
        input_text: str,
        on_start: LifecycleHook = None,
        on_finish: LifecycleHook = None,
        on_error: LifecycleHook = None,
        **kwargs
    ) -> AsyncGenerator[StreamEvent, None]:
        """
        ReflectionAgent 真正的流式执行 
            - 使用模型供应商提供 SDK 中的流式方法

        实时返回：
            - 初始执行阶段的 LLM 输出
            - 反思阶段的思考过程
            - 优化阶段的 LLM 输出

        Args:
            input_text: 用户输入
            on_start: 开始钩子
            on_finish: 完成钩子
            on_error: 错误钩子
            **kwargs: 其他参数

        Yields:
            StreamEvent: 流式事件
        """
        # 发送开始事件
        yield StreamEvent.create(
            StreamEventType.AGENT_START,...
        )

        try:
            # 阶段 1：初始执行
            yield StreamEvent.create(
                StreamEventType.STEP_START,...
            )

            messages = []
            if self.system_prompt:
                messages.append({"role": "system", "content": self.system_prompt})

            for msg in self._history:
                messages.append({"role": msg.role, "content": msg.content})

            messages.append({"role": "user", "content": input_text})

            # 流式获取初始回答
            initial_response = ""
            async for chunk in self.llm.astream_invoke(messages, **kwargs):
                initial_response += chunk
                yield StreamEvent.create(
                    StreamEventType.LLM_CHUNK,...
                )

            yield StreamEvent.create(
                StreamEventType.STEP_FINISH,...
            )

            # 阶段 2：反思与优化循环
            current_response = initial_response

            for iteration in range(self.max_iterations):
                # 反思阶段
                yield StreamEvent.create(
                    StreamEventType.STEP_START,...
                )

                reflection_prompt = self._build_reflection_prompt(input_text, current_response)
                reflection_messages = [{"role": "user", "content": reflection_prompt}]

                reflection = ""
                async for chunk in self.llm.astream_invoke(reflection_messages, **kwargs):
                    reflection += chunk
                    yield StreamEvent.create(
                        StreamEventType.THINKING,...
                    )

                yield StreamEvent.create(
                    StreamEventType.STEP_FINISH,...
                )

                # 优化阶段
                yield StreamEvent.create(
                    StreamEventType.STEP_START,...
                )

                refinement_prompt = self._build_refinement_prompt(
                    input_text,
                    current_response,
                    reflection
                )
                refinement_messages = [{"role": "user", "content": refinement_prompt}]

                refined_response = ""
                async for chunk in self.llm.astream_invoke(refinement_messages, **kwargs):
                    refined_response += chunk
                    yield StreamEvent.create(
                        StreamEventType.LLM_CHUNK,...
                    )

                yield StreamEvent.create(
                    StreamEventType.STEP_FINISH,...
                )

                current_response = refined_response

            # 发送完成事件
            yield StreamEvent.create(
                StreamEventType.AGENT_FINISH,...
            )

            # 保存到历史
            self.add_message(Message(input_text, "user"))
            self.add_message(Message(current_response, "assistant"))

        except Exception as e:
            # 发送错误事件
            yield StreamEvent.create(
                StreamEventType.ERROR,...
            )
            raise
    
```

## PlanSloveAgent
先进行规划将复杂大问题分解为简单步骤，在按照规划一步一步的执行

适合多步骤推理、数学问题、复杂分析等任务

```python

class Planner:
    """规划器 - 负责将复杂问题分解为简单步骤（使用 Function Calling）"""

    def __init__(self, llm_client: HelloAgentsLLM, system_prompt: Optional[str] = None):
        self.llm_client = llm_client
        self.system_prompt = system_prompt or """你是一个顶级的AI规划专家。你的任务是将用户提出的复杂问题分解成一个由多个简单步骤组成的行动计划。
请确保计划中的每个步骤都是一个独立的、可执行的子任务，并且严格按照逻辑顺序排列。"""

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

        try:
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

        except Exception as e:
            print(f"❌ 生成计划时发生错误: {e}")
            return []

class Executor:
    """执行器 - 负责按计划逐步执行（支持 Function Calling）"""

    def __init__(
        self,
        llm_client: HelloAgentsLLM,
        system_prompt: Optional[str] = None,
        tool_registry: Optional['ToolRegistry'] = None,
        enable_tool_calling: bool = True,
        max_tool_iterations: int = 3
    ):
        self.llm_client = llm_client
        self.system_prompt = system_prompt or """你是一位顶级的AI执行专家。你的任务是严格按照给定的计划，一步步地解决问题。
请专注于解决当前步骤，并输出该步骤的最终答案。"""
        self.tool_registry = tool_registry
        self.enable_tool_calling = enable_tool_calling and tool_registry is not None
        self.max_tool_iterations = max_tool_iterations

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
            print(f"\n-> 正在执行步骤 {i}/{len(plan)}: {step}")

            # 构建上下文消息
            context = f"""# 原始问题:
{question}

# 完整计划:
{self._format_plan(plan)}

# 历史步骤与结果:
{self._format_history(history) if history else "无"}

# 当前步骤:
{step}

请执行当前步骤并给出结果。"""

            # 执行单个步骤（支持工具调用）
            response_text = self._execute_step(context, **kwargs)

            history.append({"step": step, "result": response_text})
            final_answer = response_text
            print(f"✅ 步骤 {i} 已完成，结果: {final_answer}")

        return final_answer

    def _format_plan(self, plan: List[str]) -> str:
        """格式化计划列表"""
        return "\n".join([f"{i}. {step}" for i, step in enumerate(plan, 1)])

    def _format_history(self, history: List[Dict[str, str]]) -> str:
        """格式化历史记录"""
        return "\n\n".join([f"步骤 {i}: {h['step']}\n结果: {h['result']}"
                           for i, h in enumerate(history, 1)])

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
        from .simple_agent import SimpleAgent
        # 临时创建一个 SimpleAgent 实例来复用工具调用逻辑
        temp_agent = SimpleAgent(
            name="temp_executor",
            llm=self.llm_client,
            tool_registry=self.tool_registry
        )
        tool_schemas = temp_agent._build_tool_schemas()

        current_iteration = 0

        while current_iteration < self.max_tool_iterations:
            current_iteration += 1

            try:
                response = self.llm_client.invoke_with_tools(
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

                try:
                    arguments = json.loads(tool_call.arguments)
                except json.JSONDecodeError as e:
                    print(f"❌ 工具参数解析失败: {e}")
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": f"错误：参数格式不正确 - {str(e)}"
                    })
                    continue

                # 执行工具（复用基类方法）
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

class PlanSolveAgent(Agent):
    """
    Plan and Solve Agent - 分解规划与逐步执行的智能体

    这个Agent能够：
    1. 将复杂问题分解为简单步骤（使用 Function Calling）
    2. 按照计划逐步执行
    3. 维护执行历史和上下文
    4. 得出最终答案
    5. 支持工具调用（可选）

    特别适合多步骤推理、数学问题、复杂分析等任务。
    """

    def run(self, input_text: str, **kwargs) -> str:
        """
        运行Plan and Solve Agent
        
        Args:
            input_text: 要解决的问题
            **kwargs: 其他参数
            
        Returns:
            最终答案
        """
        print(f"\n🤖 {self.name} 开始处理问题: {input_text}")
        
        # 1. 生成计划
        plan = self.planner.plan(input_text, **kwargs)
        if not plan:
            final_answer = "无法生成有效的行动计划，任务终止。"
            print(f"\n--- 任务终止 ---\n{final_answer}")
            
            # 保存到历史记录
            self.add_message(Message(input_text, "user"))
            self.add_message(Message(final_answer, "assistant"))
            
            return final_answer
        
        # 2. 执行计划
        final_answer = self.executor.execute(input_text, plan, **kwargs)
        print(f"\n--- 任务完成 ---\n最终答案: {final_answer}")
        
        # 保存到历史记录
        self.add_message(Message(input_text, "user"))
        self.add_message(Message(final_answer, "assistant"))

        return final_answer

    async def arun_stream(
        self,
        input_text: str,
        on_start: LifecycleHook = None,
        on_finish: LifecycleHook = None,
        on_error: LifecycleHook = None,
        **kwargs
    ) -> AsyncGenerator[StreamEvent, None]:
        """
        PlanAgent 真正的流式执行

        实时返回：
        - 规划阶段的计划生成
        - 执行阶段的每个步骤输出

        Args:
            input_text: 用户输入
            on_start: 开始钩子
            on_finish: 完成钩子
            on_error: 错误钩子
            **kwargs: 其他参数

        Yields:
            StreamEvent: 流式事件
        """
        # 发送开始事件
        yield StreamEvent.create(
            StreamEventType.AGENT_START,...
        )

        try:
            # 阶段 1：规划
            yield StreamEvent.create(
                StreamEventType.STEP_START,...
            )

            print(f"\n🤖 {self.name} 开始处理问题: {input_text}")

            # 生成计划（同步方法，暂时保持）
            plan = self.planner.plan(input_text, **kwargs)

            if not plan:
                error_msg = "无法生成有效的行动计划，任务终止。"

                yield StreamEvent.create(
                    StreamEventType.ERROR,...
                )

                yield StreamEvent.create(
                    StreamEventType.AGENT_FINISH,...
                )

                self.add_message(Message(input_text, "user"))
                self.add_message(Message(error_msg, "assistant"))
                return

            yield StreamEvent.create(
                StreamEventType.STEP_FINISH,...
            )

            # 阶段 2：执行计划
            step_results = []

            for i, step_description in enumerate(plan):
                step_num = i + 1

                # 步骤开始
                yield StreamEvent.create(
                    StreamEventType.STEP_START,...
                )

                print(f"\n--- 步骤 {step_num}/{len(plan)} ---")
                print(f"📋 {step_description}")

                # 构建执行提示
                context = "\n".join([
                    f"步骤 {j+1}: {plan[j]} -> {step_results[j]}"
                    for j in range(len(step_results))
                ])

                prompt = f"""原始问题: {input_text}

完整计划:
{chr(10).join([f"{j+1}. {s}" for j, s in enumerate(plan)])}

已完成的步骤:
{context if context else "无"}

当前步骤: {step_description}

请执行当前步骤并给出结果。"""

                messages = [{"role": "user", "content": prompt}]

                # 流式执行步骤
                step_result = ""
                async for chunk in self.llm.astream_invoke(messages, **kwargs):
                    step_result += chunk

                    yield StreamEvent.create(
                        StreamEventType.LLM_CHUNK,...
                    )

                    print(chunk, end="", flush=True)

                print()  # 换行

                step_results.append(step_result)

                # 步骤完成
                yield StreamEvent.create(
                    StreamEventType.STEP_FINISH,...
                )

            # 生成最终答案
            yield StreamEvent.create(
                StreamEventType.STEP_START,...
            )

            final_prompt = f"""原始问题: {input_text}

执行计划和结果:
{chr(10).join([f"{i+1}. {plan[i]} -> {step_results[i]}" for i in range(len(plan))])}

请基于以上步骤的执行结果，给出原始问题的最终答案。"""

            final_messages = [{"role": "user", "content": final_prompt}]

            final_answer = ""
            async for chunk in self.llm.astream_invoke(final_messages, **kwargs):
                final_answer += chunk

                yield StreamEvent.create(
                    StreamEventType.LLM_CHUNK,...
                )

            # 发送完成事件
            yield StreamEvent.create(
                StreamEventType.AGENT_FINISH,...
            )

            print(f"\n--- 任务完成 ---\n最终答案: {final_answer}")

            # 保存到历史
            self.add_message(Message(input_text, "user"))
            self.add_message(Message(final_answer, "assistant"))

        except Exception as e:
            # 发送错误事件
            yield StreamEvent.create(
                StreamEventType.ERROR,...
            )
            raise

```



# LLM
## LLM
## LLMAdapter
## LLMResponse


# ContextEngineering
<font style="color:rgb(0, 0, 0);background-color:rgba(0, 0, 0, 0);">解决长对话中的上下文爆窗、Token 成本爆炸和缓存失效问题</font>



## HistoryManager
```python
"""HistoryManager - 历史消息管理器

职责：
- 消息追加（只追加，不编辑，缓存友好）
- 历史压缩（生成 summary + 保留最近轮次）
- 会话序列化/反序列化
- 轮次边界检测
"""

class HistoryManager:
    """历史管理器
    
    特性：
    - 只追加，不编辑（缓存友好）
    - 自动压缩历史（summary + 保留最近轮次）
    - 支持会话保存/加载
    
    """
    
    def __init__(
        self,
        min_retain_rounds: int = 10,
        compression_threshold: float = 0.8
    ):
        """初始化历史管理器
        
        Args:
            min_retain_rounds: 压缩时保留的最小完整轮次数
            compression_threshold: 压缩阈值（暂未使用，预留）
        """
        self._history: List[Message] = []
        self.min_retain_rounds = min_retain_rounds
        self.compression_threshold = compression_threshold
    
    def append(self, message: Message) -> None:
        """追加消息（只追加，不编辑）
        
        Args:
            message: 要追加的消息
        """
        self._history.append(message)
    
    def get_history(self) -> List[Message]:
        """获取历史副本
        
        Returns:
            历史消息列表的副本
        """
        return self._history.copy()
    
    def clear(self) -> None:
        """清空历史"""
        self._history.clear()
    
    def estimate_rounds(self) -> int:
        """预估完整轮次数
        
        一轮定义：1 user 消息 + N 条 assistant/tool/summary 消息
        
        Returns:
            完整轮次数
        """
        rounds = 0
        i = 0
        while i < len(self._history):
            if self._history[i].role == "user":
                rounds += 1
                # 跳过这一轮的后续消息
                i += 1
                while i < len(self._history) and self._history[i].role != "user":
                    i += 1
            else:
                i += 1
        return rounds
    
    def find_round_boundaries(self) -> List[int]:
        """查找每轮的起始索引
        
        Returns:
            每轮起始索引列表，例如 [0, 3, 7, 10]
        """
        boundaries = []
        for i, msg in enumerate(self._history):
            if msg.role == "user":
                boundaries.append(i)
        return boundaries
    
    def compress(self, summary: str) -> None:
        """压缩历史
        
        将旧历史替换为 summary 消息，保留最近 N 轮完整对话
        
        Args:
            summary: 历史摘要文本
        """
        # 检查是否有足够的轮次需要压缩
        rounds = self.estimate_rounds()
        if rounds <= self.min_retain_rounds:
            return
        
        # 找到所有轮次边界
        boundaries = self.find_round_boundaries()
        
        # 计算要保留的起始位置（保留最近 min_retain_rounds 轮）
        if len(boundaries) > self.min_retain_rounds:
            keep_from_index = boundaries[-self.min_retain_rounds]
        else:
            # 不足最小轮次，不压缩
            return
        
        # 生成 summary 消息
        summary_msg = Message(
            content=f"## Archived Session Summary\n{summary}",
            role="summary",
            metadata={"compressed_at": datetime.now().isoformat()}
        )
        
        # 替换历史：summary + 保留的最近轮次
        self._history = [summary_msg] + self._history[keep_from_index:]
    
    def to_dict(self) -> Dict[str, Any]:
        """序列化为字典（用于会话保存）
        
        Returns:
            包含历史和元数据的字典
        """
        return {
            "history": [msg.to_dict() for msg in self._history],
            "created_at": datetime.now().isoformat(),
            "rounds": self.estimate_rounds()
        }
    
    def load_from_dict(self, data: Dict[str, Any]) -> None:
        """从字典加载（用于会话恢复）
        
        Args:
            data: 序列化的历史数据
        """
        self._history = [
            Message.from_dict(msg_data)
            for msg_data in data.get("history", [])
        ]


```



## TokenCounter
```python
"""TokenCounter - Token 计数器

职责：
- 本地预估 Token 数（无需 API 调用）
- 缓存机制（避免重复计算）
- 增量计算（只计算新增消息）
- 降级方案（tiktoken 不可用时使用字符估算）
"""

class TokenCounter:
    """Token 计数器
    
    特性：
    - 本地预估（无需 API 调用）
    - 缓存机制（避免重复计算）
    - 增量计算（只计算新增消息）
    - 降级方案（tiktoken 不可用时使用字符估算）
    
    """
    
    def __init__(self, model: str = "gpt-4"):
        """初始化 Token 计数器
        
        Args:
            model: 模型名称（用于选择 tiktoken 编码器）
        """
        self.model = model
        self._encoding = self._get_encoding()
        self._cache: Dict[str, int] = {}  # 消息内容 -> Token 数
    
    def _get_encoding(self):
        """获取 tiktoken 编码器
        
        Returns:
            tiktoken 编码器实例，失败时返回 None
        """
        try:
            # 尝试根据模型名称获取编码器
            return tiktoken.encoding_for_model(self.model)
        except KeyError:
            # 降级到通用编码器
            try:
                return tiktoken.get_encoding("cl100k_base")
            except Exception:
                return None
        except Exception:
            # tiktoken 不可用
            return None
    
    def count_messages(self, messages: List[Message]) -> int:
        """计算消息列表的 Token 数
        
        Args:
            messages: 消息列表
        
        Returns:
            Token 数
        """
        total = 0
        for msg in messages:
            total += self.count_message(msg)
        return total
    
    def count_message(self, message: Message) -> int:
        """计算单条消息的 Token 数（带缓存）
        
        Args:
            message: 消息对象
        
        Returns:
            Token 数
        """
        # 使用消息内容作为缓存键
        cache_key = f"{message.role}:{message.content}"
        
        if cache_key in self._cache:
            return self._cache[cache_key]
        
        # 计算 Token 数
        tokens = self._count_text(message.content)
        
        # 添加角色标记的开销（约 4 tokens）
        tokens += 4
        
        # 缓存结果
        self._cache[cache_key] = tokens
        
        return tokens
    
    def count_text(self, text: str) -> int:
        """计算文本的 Token 数（无缓存）
        
        Args:
            text: 文本内容
        
        Returns:
            Token 数
        """
        return self._count_text(text)
    
    def _count_text(self, text: str) -> int:
        """内部 Token 计算方法
        
        Args:
            text: 文本内容
        
        Returns:
            Token 数
        """
        if self._encoding:
            # 使用 tiktoken 精确计算
            try:
                return len(self._encoding.encode(text))
            except Exception:
                # tiktoken 编码失败，降级到字符估算
                return len(text) // 4
        else:
            # 降级方案：粗略估算（1 token ≈ 4 字符）
            return len(text) // 4
    

    def clear_cache(self):
        """清空缓存"""
        self._cache.clear()

    def get_cache_size(self) -> int:
        """获取缓存大小

        Returns:
            缓存的消息数量
        """
        return len(self._cache)

    def get_cache_stats(self) -> Dict[str, int]:
        """获取缓存统计信息

        Returns:
            缓存统计字典
        """
        return {
            "cached_messages": len(self._cache),
            "total_cached_tokens": sum(self._cache.values())
        }


```



## ObservationTruncator
```python
"""ObservationTruncator - 工具输出截断器

职责：
- 统一截断工具输出（避免每个工具自己实现）
- 支持多种截断方向（head/tail/head_tail）
- 返回 ToolResponse.partial() 状态
- 保存完整输出到文件
"""


class ObservationTruncator:
    """工具输出截断器
    
    特性：
    - 多方向截断（head/tail/head_tail）
    - 自动保存完整输出
    - 返回标准 ToolResponse.partial() 响应
    
    """
    
    def __init__(
        self,
        max_lines: int = 2000,
        max_bytes: int = 51200,
        truncate_direction: str = "head",
        output_dir: str = "tool-output"
    ):
        """初始化截断器
        
        Args:
            max_lines: 最大保留行数
            max_bytes: 最大保留字节数
            truncate_direction: 截断方向 (head/tail/head_tail)
            output_dir: 完整输出保存目录
        """
        self.max_lines = max_lines
        self.max_bytes = max_bytes
        self.truncate_direction = truncate_direction
        self.output_dir = output_dir
        
        # 确保输出目录存在
        os.makedirs(self.output_dir, exist_ok=True)
    
    def truncate(
        self,
        tool_name: str,
        output: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """截断工具输出
        
        Args:
            tool_name: 工具名称
            output: 原始输出
            metadata: 元数据（可选）
        
        Returns:
            截断结果字典，包含：
            - truncated: bool - 是否被截断
            - preview: str - 预览内容
            - full_output_path: str - 完整输出路径（如果被截断）
            - stats: dict - 统计信息
        """
        start = time.time()
        lines = output.splitlines()
        bytes_size = len(output.encode('utf-8'))
        
        # 检查是否需要截断
        if len(lines) <= self.max_lines and bytes_size <= self.max_bytes:
            # 无需截断
            return {
                "truncated": False,
                "preview": output,
                "full_output_path": None,
                "stats": {
                    "original_lines": len(lines),
                    "original_bytes": bytes_size,
                    "time_ms": int((time.time() - start) * 1000)
                }
            }
        
        # 需要截断
        truncated_lines = self._truncate_lines(lines)
        preview = "\n".join(truncated_lines)
        truncated_bytes = len(preview.encode('utf-8'))
        
        # 保存完整输出
        output_path = self._save_full_output(tool_name, output, metadata)
        
        return {
            "truncated": True,
            "preview": preview,
            "full_output_path": output_path,
            "stats": {
                "direction": self.truncate_direction,
                "original_lines": len(lines),
                "original_bytes": bytes_size,
                "kept_lines": len(truncated_lines),
                "kept_bytes": truncated_bytes,
                "time_ms": int((time.time() - start) * 1000)
            }
        }
    
    def _truncate_lines(self, lines: list) -> list:
        """根据方向截断行
        
        Args:
            lines: 原始行列表
        
        Returns:
            截断后的行列表
        """
        if self.truncate_direction == "head":
            return lines[:self.max_lines]
        elif self.truncate_direction == "tail":
            return lines[-self.max_lines:]
        elif self.truncate_direction == "head_tail":
            half = self.max_lines // 2
            return lines[:half] + ["...(中间省略)..."] + lines[-half:]
        else:
            # 默认 head
            return lines[:self.max_lines]
    
    def _save_full_output(
        self,
        tool_name: str,
        output: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> str:
        """保存完整输出到文件
        
        Args:
            tool_name: 工具名称
            output: 完整输出
            metadata: 元数据
        
        Returns:
            保存的文件路径
        """
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        filename = f"tool_{timestamp}_{tool_name}.json"
        filepath = os.path.join(self.output_dir, filename)
        
        data = {
            "tool": tool_name,
            "output": output,
            "timestamp": datetime.now().isoformat(),
            "metadata": metadata or {}
        }
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        return filepath


```



# Tool 
## Tool
```python
def tool_action(name: str = None, description: str = None):
    """装饰器：标记一个方法为可展开的工具 action

    用法:
        @tool_action("memory_add", "添加新记忆")
        def _add_memory(self, content: str, importance: float = 0.5) -> str:
            '''添加记忆

            Args:
                content: 记忆内容
                importance: 重要性分数
            '''
            ...

    Args:
        name: 工具名称（如果不提供，从方法名自动生成）
        description: 工具描述（如果不提供，从 docstring 提取）
    """
    def decorator(func: Callable):
        func._is_tool_action = True
        func._tool_name = name
        func._tool_description = description
        return func
    return decorator


class ToolParameter(BaseModel):
    """工具参数定义"""
    name: str
    type: str
    description: str
    required: bool = True
    default: Any = None


class Tool(ABC):
    """工具基类 - 新协议版本

    支持两种使用模式：
    1. 普通模式：工具作为单一实体使用
    2. 可展开模式：工具可以展开为多个独立的子工具（每个子工具对应一个功能）

    展开模式支持两种实现方式：
    - 手动定义子工具类（传统方式）
    - 使用 @tool_action 装饰器自动生成（推荐）

    新协议特性：
    - run() 方法返回 ToolResponse 对象（而非字符串）
    - 提供 run_with_timing() 自动添加时间统计
    - 支持结构化的状态、数据和错误信息
    """

    @abstractmethod
    def get_parameters(self) -> List[ToolParameter]:
        """获取工具参数定义"""
        pass

    @abstractmethod
    def run(self, parameters: Dict[str, Any]) -> ToolResponse:
        """执行工具，返回 ToolResponse 对象

        使用便捷方法创建响应：
        - ToolResponse.success(text="...", data={...})
        - ToolResponse.partial(text="...", data={...})
        - ToolResponse.error(code="NOT_FOUND", message="...")

        Args:
            parameters: 工具参数字典

        Returns:
            ToolResponse: 标准化的工具响应对象
        """
        pass

    async def arun(self, parameters: Dict[str, Any]) -> ToolResponse:
        """异步执行工具

        默认实现：在线程池中运行同步 run() 方法
        子类可以重写此方法实现真正的异步执行

        Args:
            parameters: 工具参数字典

        Returns:
            ToolResponse: 标准化的工具响应对象
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self.run(parameters)
        )
```



## ToolResponse
ToolResponse 统一使用完 Tool 之后格式。

```python
"""工具响应协议

标准化的工具响应格式，提供结构化的状态、数据和错误信息。
"""

class ToolStatus(Enum):
    """工具执行状态枚举"""
    SUCCESS = "success"  # 任务完全按预期执行
    PARTIAL = "partial"  # 结果可用但存在折扣（截断、回退、部分失败）
    ERROR = "error"      # 无有效结果（致命错误）


@dataclass
class ToolResponse:
    """工具响应数据类

    标准化的工具响应格式，包含：
    - status: 执行状态（success/partial/error）
    - text: 给 LLM 阅读的格式化文本
    - data: 结构化数据载荷
    - error_info: 错误信息（仅 status=error 时）
    - stats: 运行统计（时间、token等）
    - context: 上下文信息（参数、环境等）

    """

    status: ToolStatus
    text: str
    data: Dict[str, Any] = field(default_factory=dict)
    error_info: Optional[Dict[str, str]] = None
    stats: Optional[Dict[str, Any]] = None
    context: Optional[Dict[str, Any]] = None
    
    @classmethod
    def success(
        cls,
        text: str,
        data: Optional[Dict[str, Any]] = None,
        stats: Optional[Dict[str, Any]] = None,
        context: Optional[Dict[str, Any]] = None
    ) -> 'ToolResponse':
        """快速创建成功响应
        
        Args:
            text: 给 LLM 阅读的文本
            data: 结构化数据
            stats: 运行统计
            context: 上下文信息
        """
        return cls(
            status=ToolStatus.SUCCESS,
            text=text,
            data=data or {},
            stats=stats,
            context=context
        )
    
    @classmethod
    def partial(
        cls,
        text: str,
        data: Optional[Dict[str, Any]] = None,
        stats: Optional[Dict[str, Any]] = None,
        context: Optional[Dict[str, Any]] = None
    ) -> 'ToolResponse':
        """快速创建部分成功响应
        
        Args:
            text: 给 LLM 阅读的文本（应说明部分成功的原因）
            data: 结构化数据
            stats: 运行统计
            context: 上下文信息
        """
        return cls(
            status=ToolStatus.PARTIAL,
            text=text,
            data=data or {},
            stats=stats,
            context=context
        )
    
    @classmethod
    def error(
        cls,
        code: str,
        message: str,
        stats: Optional[Dict[str, Any]] = None,
        context: Optional[Dict[str, Any]] = None
    ) -> 'ToolResponse':
        """快速创建错误响应

        Args:
            code: 错误码（来自 ToolErrorCode）
            message: 错误消息
            stats: 运行统计
            context: 上下文信息
        """
        return cls(
            status=ToolStatus.ERROR,
            text=message,
            data={},
            error_info={"code": code, "message": message},
            stats=stats,
            context=context
        )


```



## ToolRegistry
可展开的工具：一个复杂工具里面有多个工具，可以将里面的多个工具都进行注册。

```python
"""工具注册表 - HelloAgents原生工具系统"""

class ToolRegistry:
    """
    HelloAgents工具注册表

    提供工具的注册、管理和执行功能。
    支持两种工具注册方式：
    1. Tool对象注册（推荐）
    2. 函数直接注册（简便）
    """

    def __init__(self, circuit_breaker: Optional[CircuitBreaker] = None):
        self._tools: dict[str, Tool] = {}
        self._functions: dict[str, dict[str, Any]] = {}

        # 文件元数据缓存（用于乐观锁机制）
        self.read_metadata_cache: Dict[str, Dict[str, Any]] = {}

        # 熔断器（默认启用）
        self.circuit_breaker = circuit_breaker or CircuitBreaker()

    def register_tool(self, tool: Tool, auto_expand: bool = True):
        """
        注册Tool对象

        Args:
            tool: Tool实例
            auto_expand: 是否自动展开可展开的工具（默认True）
        """
        # 检查工具是否可展开
        if auto_expand and hasattr(tool, 'expandable') and tool.expandable:
            expanded_tools = tool.get_expanded_tools()
            if expanded_tools:
                # 注册所有展开的子工具
                for sub_tool in expanded_tools:
                    if sub_tool.name in self._tools:
                        print(f"⚠️ 警告：工具 '{sub_tool.name}' 已存在，将被覆盖。")
                    self._tools[sub_tool.name] = sub_tool
                print(f"✅ 工具 '{tool.name}' 已展开为 {len(expanded_tools)} 个独立工具")
                return

        # 普通工具或不展开的工具
        if tool.name in self._tools:
            print(f"⚠️ 警告：工具 '{tool.name}' 已存在，将被覆盖。")

        self._tools[tool.name] = tool
        print(f"✅ 工具 '{tool.name}' 已注册。")

    def register_function(
        self,
        func: Callable,
        name: Optional[str] = None,
        description: Optional[str] = None
    ):
        """
        直接注册函数作为工具（简便方式）

        支持两种调用方式：
        1. 传统方式：register_function(name, description, func)
        2. 新方式：register_function(func, name=None, description=None)
           - 自动从函数名和 docstring 提取信息

        """
        # 兼容旧的调用方式：register_function(name, description, func)
        if isinstance(func, str) and callable(description):
            # 旧方式：第一个参数是 name，第二个是 description，第三个是 func
            name, description, func = func, name, description

        # 自动提取名称
        if name is None:
            name = func.__name__

        # 自动提取描述
        if description is None:
            import inspect
            doc = inspect.getdoc(func)
            if doc:
                # 提取第一行作为描述
                description = doc.split('\n')[0].strip()
            else:
                description = f"执行 {name}"

        if name in self._functions:
            print(f"⚠️ 警告：工具 '{name}' 已存在，将被覆盖。")

        self._functions[name] = {
            "description": description,
            "func": func
        }
        print(f"✅ 函数工具 '{name}' 已注册。")

    def unregister(self, name: str):
        """注销工具"""
        if name in self._tools:
            del self._tools[name]
            print(f"🗑️ 工具 '{name}' 已注销。")
        elif name in self._functions:
            del self._functions[name]
            print(f"🗑️ 工具 '{name}' 已注销。")
        else:
            print(f"⚠️ 工具 '{name}' 不存在。")

    def execute_tool(self, name: str, input_text: str) -> ToolResponse:
        """
        执行工具，返回 ToolResponse 对象（带熔断器保护）

        Args:
            name: 工具名称
            input_text: 输入参数

        Returns:
            ToolResponse: 标准化的工具响应对象
        """
        # 检查熔断器
        if self.circuit_breaker.is_open(name):
            status = self.circuit_breaker.get_status(name)
            return ToolResponse.error(
                code=ToolErrorCode.CIRCUIT_OPEN,
                message=f"工具 '{name}' 当前被禁用，由于连续失败。{status['recover_in_seconds']} 秒后可用。",
                context={
                    "tool_name": name,
                    "circuit_status": status
                }
            )

        # 执行工具
        response = None

        # 优先查找Tool对象（新协议）
        if name in self._tools:
            tool = self._tools[name]
            try:
                # 解析参数（支持 JSON 字符串或字典）
                import json
                if isinstance(input_text, str):
                    try:
                        parameters = json.loads(input_text)
                    except json.JSONDecodeError:
                        # 如果不是 JSON，作为普通字符串处理
                        parameters = {"input": input_text}
                elif isinstance(input_text, dict):
                    parameters = input_text
                else:
                    parameters = {"input": str(input_text)}

                # 使用 run_with_timing 自动添加时间统计
                response = tool.run_with_timing(parameters)
            except Exception as e:
                response = ToolResponse.error(
                    code=ToolErrorCode.EXECUTION_ERROR,
                    message=f"执行工具 '{name}' 时发生异常: {str(e)}",
                    context={"tool_name": name, "input": input_text}
                )

        # 查找函数工具（自动包装为新协议）
        elif name in self._functions:
            func = self._functions[name]["func"]
            start_time = time.time()

            try:
                result = func(input_text)
                elapsed_ms = int((time.time() - start_time) * 1000)

                # 包装为 ToolResponse
                response = ToolResponse.success(
                    text=str(result),
                    data={"output": result},
                    stats={"time_ms": elapsed_ms},
                    context={"tool_name": name, "input": input_text}
                )
            except Exception as e:
                elapsed_ms = int((time.time() - start_time) * 1000)
                response = ToolResponse.error(
                    code=ToolErrorCode.EXECUTION_ERROR,
                    message=f"函数执行失败: {str(e)}",
                    stats={"time_ms": elapsed_ms},
                    context={"tool_name": name, "input": input_text}
                )

        # 工具不存在
        else:
            response = ToolResponse.error(
                code=ToolErrorCode.NOT_FOUND,
                message=f"未找到名为 '{name}' 的工具",
                context={"tool_name": name}
            )

        # 记录熔断器结果
        self.circuit_breaker.record_result(name, response)

        return response

    def clear(self):
        """清空所有工具"""
        self._tools.clear()
        self._functions.clear()
        print("🧹 所有工具已清空。")

    # ==================== 乐观锁机制支持 ====================

    def cache_read_metadata(self, file_path: str, metadata: Dict[str, Any]):
        """缓存 Read 工具获取的文件元数据

        Args:
            file_path: 文件路径（相对于 project_root）
            metadata: 文件元数据字典，包含：
                - file_mtime_ms: 文件修改时间（毫秒时间戳）
                - file_size_bytes: 文件大小（字节）
        """
        self.read_metadata_cache[file_path] = metadata

    def get_read_metadata(self, file_path: str) -> Optional[Dict[str, Any]]:
        """获取缓存的文件元数据

        Args:
            file_path: 文件路径

        Returns:
            文件元数据字典，如果不存在则返回 None
        """
        return self.read_metadata_cache.get(file_path)

    def clear_read_cache(self, file_path: Optional[str] = None):
        """清空文件元数据缓存

        Args:
            file_path: 指定文件路径，如果为 None 则清空所有缓存
        """
        if file_path:
            self.read_metadata_cache.pop(file_path, None)
        else:
            self.read_metadata_cache.clear()

# 全局工具注册表
global_registry = ToolRegistry()

```



## CircuitBreaker
```python
"""熔断器机制 - 防止工具连续失败导致的死循环"""

class CircuitBreaker:
    """
    工具熔断器

    特性：
    - 连续失败自动禁用工具
    - 超时自动恢复
    - 基于 ToolResponse 协议判断错误

    状态机：
    Closed (正常) → Open (熔断) → Closed (恢复)
    """

    def __init__(
        self,
        failure_threshold: int = 3,
        recovery_timeout: int = 300,
        enabled: bool = True
    ):
        """
        初始化熔断器

        Args:
            failure_threshold: 连续失败多少次后熔断（默认 3）
            recovery_timeout: 熔断后恢复时间（秒，默认 300）
            enabled: 是否启用熔断器（默认 True）
        """
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.enabled = enabled

        # 失败计数（每个工具）
        self.failure_counts: Dict[str, int] = defaultdict(int)

        # 熔断开启时间
        self.open_timestamps: Dict[str, float] = {}

    def is_open(self, tool_name: str) -> bool:
        """
        检查工具是否被熔断

        Args:
            tool_name: 工具名称

        Returns:
            True: 工具被禁用
            False: 工具可用
        """
        if not self.enabled:
            return False

        # 检查是否在熔断列表
        if tool_name not in self.open_timestamps:
            return False

        # 检查是否可以恢复
        open_time = self.open_timestamps[tool_name]
        if time.time() - open_time > self.recovery_timeout:
            # 自动恢复
            self.close(tool_name)
            return False

        return True

    def record_result(self, tool_name: str, response: ToolResponse):
        """
        记录工具执行结果

        Args:
            tool_name: 工具名称
            response: 工具响应对象
        """
        if not self.enabled:
            return

        # 判断是否是错误
        is_error = response.status == ToolStatus.ERROR

        if is_error:
            self._on_failure(tool_name)
        else:
            self._on_success(tool_name)

    def _on_failure(self, tool_name: str):
        """处理失败"""
        # 增加失败计数
        self.failure_counts[tool_name] += 1

        # 检查是否达到阈值
        if self.failure_counts[tool_name] >= self.failure_threshold:
            self.open_timestamps[tool_name] = time.time()
            print(f"🔴 Circuit Breaker: 工具 '{tool_name}' 已熔断（连续 {self.failure_counts[tool_name]} 次失败）")

    def _on_success(self, tool_name: str):
        """处理成功"""
        # 重置失败计数
        self.failure_counts[tool_name] = 0

    def open(self, tool_name: str):
        """手动开启熔断"""
        if not self.enabled:
            return

        self.open_timestamps[tool_name] = time.time()
        print(f"🔴 Circuit Breaker: 工具 '{tool_name}' 已手动熔断")

    def close(self, tool_name: str):
        """关闭熔断，恢复工具"""
        self.failure_counts[tool_name] = 0
        self.open_timestamps.pop(tool_name, None)
        print(f"🟢 Circuit Breaker: 工具 '{tool_name}' 已恢复")

    def get_status(self, tool_name: str) -> Dict[str, any]:
        """
        获取工具的熔断状态

        Args:
            tool_name: 工具名称

        Returns:
            状态字典，包含：
            - state: "open" | "closed"
            - failure_count: 失败次数
            - open_since: 熔断开始时间（仅 open 状态）
            - recover_in_seconds: 恢复倒计时（仅 open 状态）
        """
        is_open = tool_name in self.open_timestamps

        if is_open:
            open_time = self.open_timestamps[tool_name]
            time_since_open = time.time() - open_time
            time_to_recover = max(0, self.recovery_timeout - time_since_open)

            return {
                "state": "open",
                "failure_count": self.failure_counts[tool_name],
                "open_since": open_time,
                "recover_in_seconds": int(time_to_recover)
            }
        else:
            return {
                "state": "closed",
                "failure_count": self.failure_counts[tool_name]
            }

    def get_all_status(self) -> Dict[str, Dict]:
        """
        获取所有工具的熔断状态

        Returns:
            工具名称 -> 状态字典
        """
        # 收集所有已知的工具名
        all_tools = set(self.failure_counts.keys()) | set(self.open_timestamps.keys())

        return {
            tool_name: self.get_status(tool_name)
            for tool_name in all_tools
        }


```



## ToolFilter
```python
"""工具过滤器

用于子代理机制（子 Agent），控制不同类型的 Agent 可以访问哪些工具。
"""

class ToolFilter(ABC):
    """工具过滤器基类
    
    用于在子代理运行时限制可用工具集合。
    """
    
    @abstractmethod
    def filter(self, all_tools: List[str]) -> List[str]:
        """过滤工具列表
        
        Args:
            all_tools: 所有可用工具名称列表
            
        Returns:
            过滤后的工具名称列表
        """
        pass
    
    @abstractmethod
    def is_allowed(self, tool_name: str) -> bool:
        """检查单个工具是否允许
        
        Args:
            tool_name: 工具名称
            
        Returns:
            是否允许使用该工具
        """
        pass


class ReadOnlyFilter(ToolFilter):
    """只读工具过滤器
    
    只允许使用只读工具，适用于：
    - explore（探索代码库）
    - plan（规划任务）
    - summary（归纳信息）
    """
    
    # 只读工具白名单
    READONLY_TOOLS: Set[str] = {
        "Read", "ReadTool",
        "LS", "LSTool",
        "Glob", "GlobTool",
        "Grep", "GrepTool",
        "Skill", "SkillTool",
    }
    
    def __init__(self, additional_allowed: Optional[List[str]] = None):
        """初始化只读过滤器
        
        Args:
            additional_allowed: 额外允许的工具名称列表
        """
        self.allowed_tools = self.READONLY_TOOLS.copy()
        if additional_allowed:
            self.allowed_tools.update(additional_allowed)
    
    def filter(self, all_tools: List[str]) -> List[str]:
        """只保留只读工具"""
        return [tool for tool in all_tools if self.is_allowed(tool)]
    
    def is_allowed(self, tool_name: str) -> bool:
        """检查是否为只读工具"""
        return tool_name in self.allowed_tools


class FullAccessFilter(ToolFilter):
    """完全访问过滤器
    
    允许使用所有工具（除了明确禁止的危险工具），适用于：
    - code（代码实现）
    """
    
    # 危险工具黑名单
    DENIED_TOOLS: Set[str] = {
        "Bash", "BashTool",
        "Terminal", "TerminalTool",
        "Execute", "ExecuteTool",
    }
    
    def __init__(self, additional_denied: Optional[List[str]] = None):
        """初始化完全访问过滤器
        
        Args:
            additional_denied: 额外禁止的工具名称列表
        """
        self.denied_tools = self.DENIED_TOOLS.copy()
        if additional_denied:
            self.denied_tools.update(additional_denied)
    
    def filter(self, all_tools: List[str]) -> List[str]:
        """排除危险工具"""
        return [tool for tool in all_tools if self.is_allowed(tool)]
    
    def is_allowed(self, tool_name: str) -> bool:
        """检查是否允许（不在黑名单中）"""
        return tool_name not in self.denied_tools


class CustomFilter(ToolFilter):
    """自定义工具过滤器
    
    用户可以明确指定允许或禁止的工具列表。
    """
    
    def __init__(
        self,
        allowed: Optional[List[str]] = None,
        denied: Optional[List[str]] = None,
        mode: str = "whitelist"
    ):
        """初始化自定义过滤器
        
        Args:
            allowed: 允许的工具名称列表（白名单模式）
            denied: 禁止的工具名称列表（黑名单模式）
            mode: 过滤模式，"whitelist"（白名单）或 "blacklist"（黑名单）
        """
        self.allowed = set(allowed) if allowed else set()
        self.denied = set(denied) if denied else set()
        self.mode = mode
        
        if mode not in ("whitelist", "blacklist"):
            raise ValueError(f"Invalid mode: {mode}. Must be 'whitelist' or 'blacklist'")
    
    def filter(self, all_tools: List[str]) -> List[str]:
        """根据模式过滤工具"""
        return [tool for tool in all_tools if self.is_allowed(tool)]
    
    def is_allowed(self, tool_name: str) -> bool:
        """检查是否允许"""
        if self.mode == "whitelist":
            return tool_name in self.allowed
        else:  # blacklist
            return tool_name not in self.denied


```



Agent 父类中提供 run_as_subagent，作为子 Agent 运行

```python
 def run_as_subagent(
        self,
        task: str,
        tool_filter: Optional['ToolFilter'] = None,
        return_summary: bool = True,
        max_steps_override: Optional[int] = None
    ) -> Dict[str, Any]:
        """作为子代理运行（上下文隔离模式）

        特性：
        - 上下文隔离：创建独立的历史记录，不污染主 Agent 上下文
        - 工具过滤：可选的工具访问控制
        - 摘要返回：返回结构化摘要而非完整历史
        - 状态恢复：执行后自动恢复原始状态

        Args:
            task: 子任务描述
            tool_filter: 工具过滤器（可选），用于限制可用工具
            return_summary: 是否返回摘要（True）或完整结果（False）
            max_steps_override: 覆盖最大步数（可选）

        Returns:
            {
                "success": bool,           # 是否成功完成
                "summary": str,            # 任务摘要（如果 return_summary=True）
                "result": str,             # 完整结果（如果 return_summary=False）
                "metadata": {              # 执行元数据
                    "steps": int,          # 执行步数
                    "tokens": int,         # 消耗 Token 数（估算）
                    "duration_seconds": float,  # 执行时长
                    "tools_used": List[str],    # 使用的工具列表
                    "error": Optional[str]      # 错误信息（如果失败）
                }
            }
        """
        from datetime import datetime
        import time

        # 1. 保存当前状态
        original_history = self.history_manager.get_history().copy()
        original_tools = None
        original_max_steps = None

        # 2. 创建隔离的新历史
        self.history_manager.clear()

        # 3. 应用工具过滤（如果提供）
        if tool_filter and self.tool_registry:
            original_tools = self._apply_tool_filter(tool_filter)

        # 4. 覆盖最大步数（如果提供）
        if max_steps_override is not None and hasattr(self, 'max_steps'):
            original_max_steps = self.max_steps
            self.max_steps = max_steps_override

        # 记录开始时间
        start_time = time.time()
        success = False
        result = ""
        error_msg = None

        try:
            # 5. 执行任务
            result = self.run(task)
            success = True

        except KeyboardInterrupt:
            error_msg = "用户中断"
            raise

        except Exception as e:
            error_msg = str(e)
            result = f"执行失败: {error_msg}"

        finally:
            # 记录执行时长
            duration = time.time() - start_time

            # 6. 收集元数据
            metadata = self._get_subagent_metadata(duration, error_msg)

            # 7. 生成摘要（如果需要）
            if return_summary:
                summary = self._generate_subagent_summary(task, result, metadata)

            # 8. 恢复原始状态
            self.history_manager.clear()
            for msg in original_history:
                self.history_manager.append(msg)

            if original_tools is not None:
                self._restore_tools(original_tools)

            if original_max_steps is not None:
                self.max_steps = original_max_steps

        # 9. 返回结果
        if return_summary:
            return {
                "success": success,
                "summary": summary,
                "metadata": metadata
            }
        else:
            return {
                "success": success,
                "result": result,
                "metadata": metadata
            }

    def _apply_tool_filter(self, tool_filter: 'ToolFilter') -> List[str]:
        """应用工具过滤器

        Args:
            tool_filter: 工具过滤器实例

        Returns:
            原始工具列表（用于恢复）
        """
        if not self.tool_registry:
            return []

        # 保存原始工具列表
        original_tools = self.tool_registry.list_tools()

        # 获取过滤后的工具列表
        filtered_tools = tool_filter.filter(original_tools)

        # 临时移除不允许的工具
        for tool_name in original_tools:
            if tool_name not in filtered_tools:
                self.tool_registry._temp_disabled_tools = getattr(
                    self.tool_registry, '_temp_disabled_tools', {}
                )
                tool = self.tool_registry.get_tool(tool_name)
                if tool:
                    self.tool_registry._temp_disabled_tools[tool_name] = tool
                    # 从注册表中临时移除
                    if tool_name in self.tool_registry._tools:
                        del self.tool_registry._tools[tool_name]

        return original_tools
```



## 内置的工具
### TaskTool
### SkillTool
### TodoWriteTool
### FileTool


# 其他设计
## Agent 异步生命周期事件系统
```python
"""Agent 异步生命周期事件系统

提供事件驱动的 Agent 执行流程，支持：
- 生命周期钩子（on_start, on_step, on_finish, on_error）
- 流式事件输出（SSE/WebSocket 场景）
- 异步执行与并行优化
"""

class EventType(Enum):
    """Agent 生命周期事件类型"""
    
    # Agent 级别事件
    AGENT_START = "agent_start"           # Agent 开始执行
    AGENT_FINISH = "agent_finish"         # Agent 执行完成
    AGENT_ERROR = "agent_error"           # Agent 执行错误
    
    # 步骤级别事件
    STEP_START = "step_start"             # 推理步骤开始
    STEP_FINISH = "step_finish"           # 推理步骤完成
    
    # LLM 调用事件
    LLM_START = "llm_start"               # LLM 调用开始
    LLM_CHUNK = "llm_chunk"               # LLM 流式输出片段
    LLM_FINISH = "llm_finish"             # LLM 调用完成
    
    # 工具调用事件
    TOOL_CALL = "tool_call"               # 工具调用开始
    TOOL_RESULT = "tool_result"           # 工具调用结果
    TOOL_ERROR = "tool_error"             # 工具调用错误
    
    # 特殊事件
    THINKING = "thinking"                 # 推理过程（o1/deepseek-reasoner）
    REFLECTION = "reflection"             # 反思过程
    PLAN = "plan"                         # 计划生成


@dataclass
class AgentEvent:
    """Agent 生命周期事件
    
    所有事件的基础数据结构，包含：
    - type: 事件类型
    - timestamp: 时间戳
    - agent_name: Agent 名称
    - data: 事件数据（灵活扩展）
    """
    
    type: EventType
    timestamp: float
    agent_name: str
    data: Dict[str, Any] = field(default_factory=dict)
    
    @classmethod
    def create(
        cls,
        event_type: EventType,
        agent_name: str,
        **data
    ) -> 'AgentEvent':
        """创建事件的便捷方法
        
        Args:
            event_type: 事件类型
            agent_name: Agent 名称
            **data: 事件数据（键值对）
            
        Returns:
            AgentEvent 实例
            
        Example:
            >>> event = AgentEvent.create(
            ...     EventType.TOOL_CALL,
            ...     "my_agent",
            ...     tool_name="search",
            ...     tool_args={"query": "hello"}
            ... )
        """
        return cls(
            type=event_type,
            timestamp=time.time(),
            agent_name=agent_name,
            data=data
        )
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典（用于序列化）
        
        Returns:
            字典表示
        """
        return {
            "type": self.type.value,
            "timestamp": self.timestamp,
            "agent_name": self.agent_name,
            "data": self.data
        }
    
    def __str__(self) -> str:
        """字符串表示"""
        return f"[{self.type.value}] {self.agent_name} @ {self.timestamp:.2f}: {self.data}"


# 类型别名：生命周期钩子
LifecycleHook = Optional[Callable[[AgentEvent], Awaitable[None]]]


@dataclass
class ExecutionContext:
    """Agent 执行上下文
    
    在异步执行过程中传递的上下文信息，包含：
    - 输入文本
    - 当前步骤
    - 累计 token 数
    - 自定义元数据
    """
    
    input_text: str
    current_step: int = 0
    total_tokens: int = 0
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def increment_step(self):
        """步骤计数器 +1"""
        self.current_step += 1
    
    def add_tokens(self, tokens: int):
        """累加 token 数"""
        self.total_tokens += tokens
    
    def set_metadata(self, key: str, value: Any):
        """设置元数据"""
        self.metadata[key] = value
    
    def get_metadata(self, key: str, default: Any = None) -> Any:
        """获取元数据"""
        return self.metadata.get(key, default)


```



## 会话存储
```python
"""SessionStore - 会话持久化存储

职责：
- 保存会话到文件（原子写入）
- 从文件恢复会话
- 环境一致性检查
- 会话列表管理
"""

class SessionStore:
    """会话存储器
    
    功能：
    - 保存会话到 JSON 文件
    - 从文件恢复会话
    - 环境一致性检查
    - 原子写入保证数据完整性
    
    """
    
    def __init__(self, session_dir: str = "memory/sessions"):
        """初始化会话存储器
        
        Args:
            session_dir: 会话文件保存目录
        """
        self.session_dir = Path(session_dir)
        self.session_dir.mkdir(parents=True, exist_ok=True)
    
    def _generate_session_id(self) -> str:
        """生成唯一的会话 ID
        
        格式：s-{timestamp}-{uuid}
        
        Returns:
            会话 ID
        """
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        unique_suffix = uuid.uuid4().hex[:8]
        return f"s-{timestamp}-{unique_suffix}"
    
    def save(
        self,
        agent_config: Dict[str, Any],
        history: List[Any],
        tool_schema_hash: str,
        read_cache: Dict[str, Dict],
        metadata: Dict[str, Any],
        session_name: Optional[str] = None
    ) -> str:
        """保存会话
        
        Args:
            agent_config: Agent 配置信息
            history: 消息历史列表
            tool_schema_hash: 工具 Schema 哈希值
            read_cache: Read 工具的元数据缓存
            metadata: 会话元数据（tokens、steps、duration 等）
            session_name: 自定义会话名称（可选）
        
        Returns:
            保存的文件路径
        """
        # 生成会话 ID（只生成一次）
        session_id = self._generate_session_id()

        # 生成文件名
        if session_name:
            filename = f"{session_name}.json"
        else:
            filename = f"session-{session_id}.json"

        filepath = self.session_dir / filename

        # 构建会话数据
        session_data = {
            "session_id": session_id,
            "created_at": metadata.get("created_at", datetime.now().isoformat()),
            "saved_at": datetime.now().isoformat(),
            "agent_config": agent_config,
            "history": [
                msg.to_dict() if hasattr(msg, 'to_dict') else msg 
                for msg in history
            ],
            "tool_schema_hash": tool_schema_hash,
            "read_cache": read_cache,
            "metadata": metadata
        }
        
        # 原子写入（临时文件 + 重命名）
        temp_path = str(filepath) + ".tmp"
        with open(temp_path, 'w', encoding='utf-8') as f:
            json.dump(session_data, f, indent=2, ensure_ascii=False)
        
        # 原子重命名
        os.replace(temp_path, filepath)
        
        return str(filepath)
    
    def load(self, filepath: str) -> Dict[str, Any]:
        """加载会话
        
        Args:
            filepath: 会话文件路径
        
        Returns:
            会话数据字典
        
        Raises:
            FileNotFoundError: 文件不存在
            json.JSONDecodeError: 文件格式错误
        """
        with open(filepath, 'r', encoding='utf-8') as f:
            session_data = json.load(f)

        return session_data

    def list_sessions(self) -> List[Dict[str, Any]]:
        """列出所有会话

        Returns:
            会话信息列表，按保存时间倒序排列
        """
        sessions = []

        for filepath in self.session_dir.glob("*.json"):
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)

                sessions.append({
                    "filename": filepath.name,
                    "filepath": str(filepath),
                    "session_id": data.get("session_id"),
                    "created_at": data.get("created_at"),
                    "saved_at": data.get("saved_at"),
                    "metadata": data.get("metadata", {})
                })
            except Exception as e:
                print(f"⚠️ 警告：无法读取 {filepath}: {e}")

        # 按保存时间倒序
        sessions.sort(key=lambda x: x.get("saved_at", ""), reverse=True)

        return sessions

    def delete(self, session_name: str) -> bool:
        """删除会话

        Args:
            session_name: 会话名称（不含 .json 后缀）

        Returns:
            是否删除成功
        """
        filepath = self.session_dir / f"{session_name}.json"
        if filepath.exists():
            os.remove(filepath)
            return True
        return False

    def check_config_consistency(
        self,
        saved_config: Dict[str, Any],
        current_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """检查配置一致性

        Args:
            saved_config: 保存的配置
            current_config: 当前配置

        Returns:
            检查结果字典，包含 warnings 列表
        """
        warnings = []

        # 检查 LLM 提供商
        if saved_config.get("llm_provider") != current_config.get("llm_provider"):
            warnings.append(
                f"LLM 提供商变化: {saved_config.get('llm_provider')} → {current_config.get('llm_provider')}"
            )

        # 检查模型
        if saved_config.get("llm_model") != current_config.get("llm_model"):
            warnings.append(
                f"模型变化: {saved_config.get('llm_model')} → {current_config.get('llm_model')}"
            )

        # 检查 max_steps
        if saved_config.get("max_steps") != current_config.get("max_steps"):
            warnings.append(
                f"最大步数变化: {saved_config.get('max_steps')} → {current_config.get('max_steps')}"
            )

        return {
            "consistent": len(warnings) == 0,
            "warnings": warnings
        }

    def check_tool_schema_consistency(
        self,
        saved_hash: str,
        current_hash: str
    ) -> Dict[str, Any]:
        """检查工具 Schema 一致性

        Args:
            saved_hash: 保存的工具 Schema 哈希
            current_hash: 当前工具 Schema 哈希

        Returns:
            检查结果字典
        """
        changed = saved_hash != current_hash

        return {
            "changed": changed,
            "saved_hash": saved_hash,
            "current_hash": current_hash,
            "recommendation": "建议重新读取文件" if changed else "可以安全恢复"
        }


```



## Message 系统
```python
"""消息系统"""

MessageRole = Literal["user", "assistant", "system", "tool", "summary"]

class Message(BaseModel):
    """消息类"""

    content: str
    role: MessageRole
    timestamp: datetime = None
    metadata: Optional[Dict[str, Any]] = None

    def __init__(self, content: str, role: MessageRole, **kwargs):
        super().__init__(
            content=content,
            role=role,
            timestamp=kwargs.get('timestamp', datetime.now()),
            metadata=kwargs.get('metadata', {})
        )

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式（OpenAI API格式）"""
        return {
            "role": self.role,
            "content": self.content,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "metadata": self.metadata
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Message":
        """从字典创建消息对象"""
        timestamp = data.get("timestamp")
        if timestamp and isinstance(timestamp, str):
            timestamp = datetime.fromisoformat(timestamp)

        return cls(
            content=data["content"],
            role=data["role"],
            timestamp=timestamp,
            metadata=data.get("metadata")
        )

    def to_text(self) -> str:
        """格式化为文本（用于上下文构建）"""
        return f"[{self.role}] {self.content}"

    def __str__(self) -> str:
        return f"[{self.role}] {self.content}"

```

