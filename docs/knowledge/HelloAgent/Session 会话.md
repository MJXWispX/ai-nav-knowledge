Session 由许多条 Message 组成，在看 Session 之前先来看一下 Message。



# Message
消息有 5 种类型：user、assistant、system、tool、summary

```python
MessageRole = Literal["user", "assistant", "system", "tool", "summary"]
```



```python
class Message(BaseModel):
    """消息类"""

    content: str # 消息内容
    role: MessageRole # 消息角色
    timestamp: datetime = None # 时间戳
    metadata: Optional[Dict[str, Any]] = None # 元数据
```



# Session
HelloAgent 中没有严格意义上的 Session，而是持久化时使用 Session。

持久化会话：原子写入（临时文件 + 重命名） 指定文件夹

加载会话：加载指定文件的 session

```python
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
        # 生成会话 ID
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

        """
        with open(filepath, 'r', encoding='utf-8') as f:
            session_data = json.load(f)

        return session_data

```

