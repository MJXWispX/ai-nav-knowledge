HelloAgent 中的 context 管理有 HistoryManager、TokenCounter、ObservationTruncator



# HistoryManager
HistoryManager 使用 list 维护 message。



压缩策略：之前的 message 生成摘要 + 保留最近 N 轮完整消息

+ 其中生成摘要可以生成简单摘要（统计一些信息），也可以生成智能摘要（把需要压缩的 message 给到 LLM，让 LLM 进行总结）

```python
summary_prompt = f"""请将以下对话历史压缩为结构化摘要，保留关键信息：

## 对话历史
{history_text}

## 摘要要求
1. **任务目标**：用户想要完成什么？
2. **关键决策**：做了哪些重要决定？
3. **已完成工作**：完成了哪些任务？（列表形式）
4. **待处理事项**：还有什么未完成？
5. **重要发现**：有哪些关键信息或问题？

请用简洁的中文输出，每部分不超过 3 行。"""
```



压缩对话时机：基于缓存的 token 数进行判断。  （每次向 list 添加 msg 时都做判断）

+ 缓存的 token 数 > 上下文窗口大小 * 阈值

```python
def _should_compress(self) -> bool:
    """
    判断是否需要压缩历史
    
    基于缓存的 Token 数判断（高性能）
    使用增量计算，避免重复遍历历史
    
    Returns:
        是否需要压缩
    """
    threshold = int(self.config.context_window * self.config.compression_threshold)
    return self._history_token_count > threshold
```





```python
"""HistoryManager - 历史消息管理器

职责：
- 消息追加（只追加，不编辑，缓存友好）
- 历史压缩（生成 summary + 保留最近轮次）
- 轮次边界检测
"""


class HistoryManager:
    
    def __init__(
        self,
        min_retain_rounds: int = 10,
        compression_threshold: float = 0.8
    ):
        """初始化历史管理器
        
        Args:
            min_retain_rounds: 压缩时保留的最小完整轮次数
        """
        self._history: List[Message] = []
        self.min_retain_rounds = min_retain_rounds
    
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



```



# ObservationTruncator
设计 Truncator 是为了避免 LLM 调用 Tool 返回的结果太多

截断策略：只保留头、只保留尾、保留头尾中间省略

截断条件：Tool 的输出超过了规定的阈值。

```python
"""ObservationTruncator - 工具输出截断器

职责：
- 统一截断工具输出（避免每个工具自己实现）
- 支持多种截断方向（head/tail/head_tail）
- 返回 ToolResponse.partial() 状态
"""

class ObservationTruncator:
   
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



```





# TokenCounter
Token 计数器缓存已消耗的 Token 数。

缓存 user/assistant 每一条消息的 token 数，`cache_key = f"{message.role}:{message.content}"`

计算 token 方式：根据不同的模型使用不同的 token 编码器

```python
"""TokenCounter - Token 计数器

职责：
- 本地预估 Token 数（无需 API 调用）
- 缓存机制（避免重复计算）
- 增量计算（只计算新增消息）
- 降级方案（tiktoken 不可用时使用字符估算）
"""

class TokenCounter:

    
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

