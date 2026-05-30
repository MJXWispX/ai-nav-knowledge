# Tool 定义
```python
class Tool(ABC):
    def __init__(self, name: str, description: str, expandable: bool = False):
        """初始化工具

        Args:
            name: 工具名称
            description: 工具描述
            expandable: 是否可展开为多个子工具
        """
        self.name = name
        self.description = description
        self.expandable = expandable

    
    def get_parameters(self) -> List[ToolParameter]:
        """获取工具参数"""
        pass
    
    def run(self, parameters: Dict[str, Any]) -> ToolResponse:
        """执行工具，返回统一响应（ToolResponse）"""
        pass

```



```python
用户提问
    ↓
Agent →(问题+工具【ToolParameter】)→ LLM
                        ↘
                           需要调用工具
                        ↙
Agent ←(工具调用指令) LLM
    ↓
执行工具（得到结果【ToolResponse】）
    ↓
Agent →(工具结果)→ LLM
                    ↓
Agent ←(最终回答)← LLM
    ↓
返回给用户
```



```python
class ToolParameter(BaseModel):
    """工具参数定义（给 LLM 看的）"""
    name: str # 参数名称
    type: str # 参数类型
    description: str # 参数描述
    required: bool = True # 参数是否必须
    default: Any = None
```

```python
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
```



# CircuitBreaker 熔断器
工具熔断器，工具多次调用失败时进行熔断，避免无意义的重试。

状态机：Closed (正常) → Open (熔断) → Closed (恢复)

CircuitBreaker 使用 map 记录每个工具失败的次数、熔断开启的时间。

```python
class CircuitBreaker:
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

        # 失败计数（key:toolName value:失败的次数） 
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
```





# Tool 的注册
将 Tool 给到 Agent

```python
class ToolRegistry:
    """
    HelloAgents工具注册表

    提供工具的注册、管理和执行功能。
    支持两种工具注册方式：
        1. Tool对象注册（推荐）
        2. 函数直接注册（简便）
    """

    def __init__(self, circuit_breaker: Optional[CircuitBreaker] = None):
        self._tools: dict[str, Tool] = {} # 注册的工具
        self._functions: dict[str, dict[str, Any]] = {}  # 注册的函数

        
        # 文件元数据缓存（用于乐观锁机制）
        self.read_metadata_cache: Dict[str, Dict[str, Any]] = {}

        # 熔断器（默认启用）
        self.circuit_breaker = circuit_breaker or CircuitBreaker()


    def register_tool(self, tool: Tool):
        """
        注册Tool对象

        Args:
            tool: Tool实例
        """
         
        # 普通工具
        if tool.name in self._tools:
            print(f"⚠️ 警告：工具 '{tool.name}' 已存在，将被覆盖。")

        # 注册工具 
        self._tools[tool.name] = tool
        print(f"✅ 工具 '{tool.name}' 已注册。")

    
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

        # 优先查找Tool对象
        if name in self._tools:
            tool = self._tools[name]
            try:
                # 解析参数（支持 JSON 字符串或字典）
                parameters = json.loads(input_text)
                
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
```





```plain
      用户调用 execute_tool(name, input_text)
                │
                ▼
    ┌─────────────────────────────┐
    │   检查熔断器是否开启         │
    └────────────────┬────────────┘
                     │
        ┌────────────┴────┐
        │                 │
    是 → 返回熔断错误    否 → 继续执行
        │                 │
        │                 ▼
        │     ┌─────────────────────────┐
        │     │     匹配工具类型         │
        │     └──────────┬──────────────┘
        │                │
        │     ┌──────────┴──────────┐
        │     │                     │
        │  存在Tool对象        存在函数工具
        │     │                     │
        │     ▼                     ▼
        │  解析参数为字典       直接执行函数
        │     │                     │
        │     ▼                     │
        │  执行tool.run_with_timing │
        │     │                     │
        │     └─────────┬───────────┘
        │               │
        │               ▼
        │     ┌─────────────────────────┐
        │     │    执行成功/失败捕获      │
        │     └─────────────────────────┘
        │               │
        │               ▼
        │     ┌─────────────────────────┐
        │     │    包装为ToolResponse    │
        │     └─────────────────────────┘
        │               │
        └───────────────┼───────────────┐
                        │               │
                        ▼               ▼
        ┌─────────────────────────┐    工具不存在
        │   记录熔断器执行结果     │◄───返回NOT_FOUND
        └─────────────────────────┘
                        │
                        ▼
              返回最终 ToolResponse
```





# FileTool
## ReadTool
```python
class ReadTool(Tool):
    def __init__(
        self,
        project_root: str = ".",
        working_dir: Optional[str] = None,
        registry: Optional['ToolRegistry'] = None
    ):
        super().__init__(
            name="Read",
            description="读取文件内容或列出目录内容，支持行号范围和元数据缓存"
        )
        self.project_root = Path(project_root).resolve()
        self.working_dir = Path(working_dir).resolve() if working_dir else self.project_root
        self.registry = registry

    # 获取参数
    def get_parameters(self) -> List[ToolParameter]:
        return [
            ToolParameter(
                name="path",
                type="string",
                description="要读取的文件路径或目录路径（相对项目根目录）。如果是目录，将列出目录内容",
                required=True
            ),
            ToolParameter(
                name="offset",
                type="integer",
                description="起始行号（从 0 开始，仅读取文件时有效）",
                required=False,
                default=0
            ),
            ToolParameter(
                name="limit",
                type="integer",
                description="最大行数（仅读取文件时有效）",
                required=False,
                default=2000
            )
        ]

    # 执行工具
    def run(self, parameters: Dict[str, Any]) -> ToolResponse:
        """执行文件读取或目录列表（简要实现）"""

        # 获取 tool 需要的参数
        path = parameters.get("path")
        offset = parameters.get("offset", 0)
        limit = parameters.get("limit", 2000)

        # 解析路径
        full_path = self._resolve_path(path)
        # 读取文件
        with open(full_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        # 应用 offset 和 limit
        total_lines = len(lines)
        if offset > 0:
            lines = lines[offset:]
        if limit > 0:
            lines = lines[:limit]

        content = ''.join(lines)
        return ToolResponse.success(data=content)
```

