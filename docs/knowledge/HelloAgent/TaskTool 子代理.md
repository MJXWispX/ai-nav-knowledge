TaskTool 子代理，将子代理作为 Tool，允许主 Agent 启动隔离的子代理来处理子任务。

TaskTool 工具的参数：

+ task(子 Agent 需要完成的任务)、
+ agentType（哪种类型 Agent 的做这个任务）、
+ toolFilter（子代理允许使用的 Tool），
+ maxStep（运行最大步骤）

上下文隔离（子代理有独立历史）：当前 Agent 的状态存一个副本，清空 Agent 的状态，运行子任务，执行完毕后恢复之前的状态

```python
class TaskTool(Tool):
    """子代理工具
    - 上下文隔离（子代理有独立历史）
    - 工具过滤（控制子代理可用工具）
    - 摘要返回（避免污染主上下文）
    """

    def __init__(
        self,
        agent_factory: Callable[[str], Agent],
        tool_registry: Optional['ToolRegistry'] = None,
        config: Optional[Config] = None
    ):
        """初始化 TaskTool
        
        Args:
            agent_factory: Agent 工厂函数，接受 agent_type 返回 Agent 实例
            tool_registry: 工具注册表（传递给子代理）
            config: 配置对象
        """
        super().__init__(
            name="Task",
            description="启动子代理处理特定的子任务，使用隔离的上下文。适用于：探索代码库、规划任务、实现功能等需要独立上下文的场景。",
            expandable=False
        )
        self.agent_factory = agent_factory
        self.tool_registry = tool_registry
        self.config = config or Config()

    def get_parameters(self) -> List[ToolParameter]:
        return [
            ToolParameter(
                name="task",
                type="string",
                description="子任务的详细描述，告诉子代理具体要做什么",
                required=True
            ),
            ToolParameter(
                name="agent_type",
                type="string",
                description="子代理类型：react（推理行动）、reflection（反思）、plan（规划）、simple（简单对话）",
                required=False,
                default="react"
            ),
            ToolParameter(
                name="tool_filter",
                type="string",
                description="工具过滤策略：readonly（只读工具）、full（完全访问）、none（无过滤）",
                required=False,
                default="none"
            ),
            ToolParameter(
                name="max_steps",
                type="integer",
                description="最大步数限制（覆盖默认配置）",
                required=False
            )
        ]

    def run(self, parameters: Dict[str, Any]) -> ToolResponse:
        """执行子代理任务"""
        import time
        start_time = time.time()

        # 1. 解析参数
        task = parameters.get("task", "")
        agent_type = parameters.get("agent_type", "react").lower()
        tool_filter_type = parameters.get("tool_filter", "none").lower()
        max_steps = parameters.get("max_steps")

        # 2. 创建子代理实例
        subagent = self.agent_factory(agent_type)

        # 3. 创建工具过滤器
        tool_filter = self._create_tool_filter(tool_filter_type)

        # 4. 运行子代理（隔离模式）
        result = subagent.run_as_subagent(
            task=task,
            tool_filter=tool_filter,
            return_summary=True,
            max_steps_override=max_steps
        )

        # 5. 计算执行时间
        elapsed_ms = int((time.time() - start_time) * 1000)

        # 6. 返回标准 ToolResponse
        return ToolResponse.success(
            text=f"[SubAgent-{agent_type}] 任务完成\n\n{result['summary']}",
            data={
                "agent_type": agent_type,
                "task": task,
                **result["metadata"]
            },
            stats={"time_ms": elapsed_ms}
        )
```



# 子代理机制
```plain
调用 run_as_subagent(task)
      │
      ▼
┌─────────────────────────────┐
│      保存当前代理状态        │
│  (对话历史、工具、最大步数)   │
└─────────────────────────────┘
      │
      ▼
┌─────────────────────────────┐
│      创建隔离上下文          │
│  清空历史 / 应用工具过滤     │
│  覆盖最大步数                │
└─────────────────────────────┘
      │
      ▼
┌─────────────────────────────┐
│      执行主任务 run(task)    │
└───────────┬─────────────────┘
            │
    ┌───────┴───────┐
    │               │
  执行成功        异常/中断
    │               │
    ▼               ▼
┌──────────┐    ┌──────────┐
│记录结果   │    │记录错误信息│
└──────────┘    └──────────┘
    │               │
    └───────┬───────┘
            │
            ▼
┌─────────────────────────────┐
│      收集执行元数据          │
│  (步数、Token、耗时、工具)    │
└─────────────────────────────┘
      │
      ▼
┌─────────────────────────────┐
│      生成任务总结（可选）     │
└─────────────────────────────┘
      │
      ▼
┌─────────────────────────────┐
│      恢复代理原始状态        │
│  (历史、工具、最大步数复原)   │
└─────────────────────────────┘
      │
      ▼
┌─────────────────────────────┐
│   返回结构化结果（成功/总结/元数据） │
└─────────────────────────────┘
```



子代理机制：

```python
    def run_as_subagent(
        self,
        task: str,
        tool_filter: Optional['ToolFilter'] = None,
        return_summary: bool = True,
        max_steps_override: Optional[int] = None
    ) -> Dict[str, Any]:
        """作为子代理运行（上下文隔离模式）
        
        Args:
            task: 子任务描述
            tool_filter: 工具过滤器（可选），用于限制可用工具
            return_summary: 是否返回摘要（True）或完整结果（False）
            max_steps_override: 覆盖最大步数（可选）
        """

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

```



# ToolFilter 工具过滤
用于子代理机制，控制不同类型的 Agent 可以访问哪些工具。

```plain
filter(list[tool]): 过滤工具
- tools: 待过滤的工具名称列表
- Returns: 过滤后的工具名称列表

is_allowed( tool_name) -> bool: 检查单个工具是否允许
-tool_name: 工具名称
- Returns: True 允许使用，False 禁止使用
```



## ReadOnlyFilter
```python
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

```



## FullAccessFilter 
```python
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

```



## CustomFilter
```python
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

