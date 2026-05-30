# Skill
Skill 是 Agent 的 “操作手册”，遇到特定领域的问题时，严格按照 SKILL.md 规定的顺序执行。

skill 存放目录：

+ <!-- 这是一张图片，ocr 内容为： -->
![](https://cdn.nlark.com/yuque/0/2026/png/46998893/1778735142009-b7d5a3f2-ec5d-4494-84bd-ddeb78036423.png)

```plain
# 不带资源的 skill 
skills/                    # ← 技能目录（自动检测）
├── pdf/
│   └── SKILL.md          # ← 必需文件
├── code-review/
│   └── SKILL.md
└── mcp-builder/
    └── SKILL.md

# 带资源的 skill
skills/
└── my-skill/
    ├── SKILL.md              # ← 必需：技能定义
    ├── scripts/              # ← 可选：脚本文件
    │   └── helper.py
    ├── references/           # ← 可选：参考文档
    │   └── guide.md
    ├── examples/             # ← 可选：示例代码
    │   └── demo.py
    └── assets/               # ← 可选：其他资源
        └── template.json
```



SKILL.md 格式：

```plain
---
name: 技能名称
description: 简短描述（< 100 字符）
---

# 技能标题

详细内容...

$ARGUMENTS
```



web-search 的 skill：

[SKILL.md](https://www.yuque.com/attachments/yuque/0/2026/md/46998893/1778735651750-b09d5523-1197-4836-9a8e-55f14fa4a5db.md)

[web_search.ts](https://www.yuque.com/attachments/yuque/0/2026/ts/46998893/1778736837395-466b7a4f-d8d8-4cb2-bc6d-69344963aa06.ts)

<!-- 这是一张图片，ocr 内容为： -->
![](https://cdn.nlark.com/yuque/0/2026/png/46998893/1778736830031-d2ff58e4-0cf8-4f55-b8b0-fe2ffd961f88.png)



# SkillTool
skill tool 技能工具，允许 Agent 按需加载领域知识。【本质：加载 SKILL.md 、相关的资源 】

SkillTool 工具参数：

+ skill：要加载的技能
+ args：skill 的参数，用于替换 SKILL.md 中的占位符

```plain
调用 run(parameters)
      │
      ▼
┌─────────────────────────────┐
│    提取 skill / args 参数   │
└───────────┬─────────────────┘
            │
    ┌───────┴───────┐
    │               │
  未指定技能     指定技能名称
    │               │
    ▼               ▼
┌──────────┐    ┌────────────────┐
│参数错误响应│    │加载指定技能 		 │
│          │    │get_skill(skillName)   │
└──────────┘    └───────┬────────┘
                        │
            ┌───────────┴───────────┐
            │                       │
        技能不存在              技能存在
            │                       │
            ▼                       ▼
        ┌──────────┐        ┌────────────────────┐
        │未找到响应 │         │替换$ARGUMENTS参数 │
        └──────────┘        └──────────┬─────────┘
                                     │
                                     ▼
                        ┌─────────────────────────┐
                        │   拼接资源提示+完整内容   │
                        └───────────┬─────────────┘
                                    │
                                    ▼
                        ┌─────────────────────────┐
                        │   返回成功ToolResponse   │
                        └───────────┬─────────────┘
                                    │
        ┌───────────────────────────┴─────────────┐
        │                                         │
  执行过程异常                                 正常结束
        │                                         │
        ▼                                         ▼
┌────────────────────┐                    ┌─────────────────┐
│  内部错误响应        │                    │  返回技能结果    │
└────────────────────┘                    └─────────────────┘
```





```python
"""Skill Tool - 技能工具

允许 Agent 按需加载领域知识。

特性：
- 渐进式披露：仅在需要时加载完整技能
- 缓存友好：作为 tool_result 注入，不修改 system_prompt
- 资源提示：自动列出可用的脚本、文档、示例等
- 参数替换：支持 $ARGUMENTS 占位符

"""


class SkillTool(Tool):
    def __init__(self, skill_loader: SkillLoader):
        """初始化技能工具

        Args:
            skill_loader: 技能加载器实例
        """
        # 生成动态描述
        descriptions = skill_loader.get_descriptions()

        super().__init__(
            name="Skill",
            description=f"""
                    加载技能获取专业知识。
                    
                    可用技能：
                    {descriptions}
                    
                    何时使用：
                    - 任务明确匹配某个技能描述时，立即使用
                    - 开始领域特定工作之前
                    - 需要模型不具备的专业知识时
                    
                    注意：加载技能后，请严格遵循技能说明来完成用户任务。""",
            expandable=False
        )
        self.skill_loader = skill_loader

    def get_parameters(self) -> List[ToolParameter]:
        return [
            ToolParameter(
                name="skill",
                type="string",
                description="要加载的技能名称",
                required=True
            ),
            ToolParameter(
                name="args",
                type="string",
                description="可选参数，将替换 SKILL.md 中的 $ARGUMENTS 占位符",
                required=False,
                default=""
            )
        ]

    def run(self, parameters: Dict[str, Any]) -> ToolResponse:
        """执行技能加载

        Args:
            parameters: 包含 skill 和可选 args 的参数字典

        Returns:
            ToolResponse: 包含完整技能内容的响应
        """
        skill_name = parameters.get("skill", "")
        args = parameters.get("args", "")

        try:
            # 按需加载技能
            skill = self.skill_loader.get_skill(skill_name)

            if not skill:
                available = ", ".join(self.skill_loader.list_skills())
                return ToolResponse.error(
                    code=ToolErrorCode.NOT_FOUND,
                    message=f"技能 '{skill_name}' 不存在。可用技能：{available}",
                    context={"params_input": parameters, "available_skills": self.skill_loader.list_skills()}
                )

            # 替换 $ARGUMENTS 占位符
            content = skill.body.replace("$ARGUMENTS", args)

            # 列出可用资源
            resources_hint = self._get_resources_hint(skill)

            #  <skill-loaded/> 是给模型看的
            # 构造完整技能内容（缓存友好的注入方式）
            full_content = f"""
                <skill-loaded name="{skill_name}">
                {content}
                {resources_hint}
                </skill-loaded>
                
                ✅ 技能已加载：{skill.name}
                📝 描述：{skill.description}
                
                请严格遵循上述技能说明来完成用户任务。
                """

            return ToolResponse.success(
                text=full_content,
                data={
                    "name": skill.name,
                    "description": skill.description,
                    "loaded": True,
                    "token_estimate": len(full_content),
                    "has_resources": bool(resources_hint)
                }
            )

        except Exception as e:
            return ToolResponse.error(
                code=ToolErrorCode.INTERNAL_ERROR,
                message=f"加载技能失败：{str(e)}",
                context={"params_input": parameters, "error": str(e)}
            )

    def _get_resources_hint(self, skill) -> str:
        """生成资源提示文本

        Args:
            skill: Skill 对象

        Returns:
            格式化的资源提示文本
        """
        resources = []

        for folder, label in [
            ("scripts", "脚本"),
            ("references", "参考文档"),
            ("assets", "资源"),
            ("examples", "示例")
        ]:
            folder_path = skill.dir / folder
            if folder_path.exists():
                files = list(folder_path.glob("*"))
                if files:
                    file_list = ", ".join(f.name for f in files[:5])  # 最多显示 5 个
                    if len(files) > 5:
                        file_list += f" 等 {len(files)} 个文件"
                    resources.append(f"  - {label}：{file_list}")

        if not resources:
            return ""

        return "\n\n**可用资源**：\n" + "\n".join(resources)
```





```xml
<skill-loaded name="excel_data_process">
  # Excel 数据处理技能
  ## 适用场景
  用户需要读取、分析、统计、筛选、查询 Excel 文件数据时启用。

  ## 约束规则
  1. 必须调用工具读取 Excel，禁止臆测数据。
  2. 必须按工具返回的真实数据作答。
  3. 不修改原文件，只做读取和分析。

  ## 执行步骤
  1. 从用户需求中提取文件路径、操作目标：$ARGUMENTS
  2. 调用 excel_reader 工具读取数据。
  3. 根据需求执行统计、筛选、求和、找最大值等操作。
  4. 返回清晰的结构化结果。

  **可用资源**：
  - 脚本：process_excel.py
  - 示例：sales_report.xlsx, demo.xlsx
</skill-loaded>

✅ 技能已加载：Excel 数据处理技能
📝 描述：读取、解析、分析 Excel 表格数据，支持筛选、统计、查询

请严格遵循上述技能说明来完成用户任务。
```



# SkillLoader
Skill 加载器，实现渐进式暴露 skill： 【不会一次性加载整个 SKILL.md。】

+ Layer 1: Metadata【name + descrption】（启动时加载，~100 tokens/skill）
+ Layer 2: SKILL.md body（按需加载，~2000+ tokens）
+ Layer 3: Resources（可选，按需）



## Skill 定义
<!-- 这是一张图片，ocr 内容为： -->
![](https://cdn.nlark.com/yuque/0/2026/png/46998893/1778736830031-d2ff58e4-0cf8-4f55-b8b0-fe2ffd961f88.png)

+ scripts：获取该 skill 的脚本
+ examples：获取该 skill 的示例代码
+ references：获取该 skill 的参考文档



```python
class Skill:

    name: str    		# skill 名称
    description: str 	# skill 描述
    body: str	 		# skill body
    path: Path 			# skill.md 路径
    dir: Path 			#skill.md 所在文件夹

    @property
    def scripts(self) -> List[Path]:
        """获取 scripts/ 目录下的所有文件"""
        scripts_dir = self.dir / "scripts"
        if not scripts_dir.exists():
            return []
        return [f for f in scripts_dir.rglob("*") if f.is_file()]

    @property
    def examples(self) -> List[Path]:
        """获取 examples/ 目录下的所有文件"""
        examples_dir = self.dir / "examples"
        if not examples_dir.exists():
            return []
        return [f for f in examples_dir.rglob("*") if f.is_file()]

    @property
    def references(self) -> List[Path]:
        """获取 references/ 目录下的所有文件"""
        references_dir = self.dir / "references"
        if not references_dir.exists():
            return []
        return [f for f in references_dir.rglob("*") if f.is_file()]
```



# SkillLoader Skill 加载器
Skill 加载器，实现渐进式暴露 skill： 【不会一次性加载整个 SKILL.md】

+ Layer 1: Metadata【name + descrption】（启动时加载，~100 tokens/skill）
+ Layer 2: SKILL.md body（按需加载，~2000+ tokens）
+ Layer 3: Resources（可选，按需）



Layer 1：初始化 SkillLoader，扫描并加载 skills/ 目录下所有 skill 的 name + desc

Layer 2: getSkill(skillName) ，加载完整的 skill.md 

Layer 3: HelloAgent 没有实现，需要自己实现加载资源逻辑



SkillLoaer 维护 2 个 map，一个维护了完整的 skill，另一个维护 skill 的 metadata【name + desc】



```python
class SkillLoader:
    """
    技能加载器

    特性：
    - 启动时仅加载元数据
    - 按需加载完整技能
    - 扫描 skills/ 目录
    - 支持热重载

    """

    def __init__(self, skills_dir: Path):
        """初始化技能加载器

        Args:
            skills_dir: 技能目录路径
        """
        self.skills_dir = Path(skills_dir)
        self.skills_dir.mkdir(parents=True, exist_ok=True)

        # 完整技能缓存
        self.skills_cache: Dict[str, Skill] = {}

        # 仅元数据缓存（启动时加载）
        self.metadata_cache: Dict[str, Dict] = {}

        # 启动时扫描并加载元数据
        self._scan_skills()

    def _scan_skills(self):
        """扫描 skills/ 目录，加载元数据"""
        for skill_dir in self.skills_dir.iterdir():
            if not skill_dir.is_dir():
                continue

            skill_md = skill_dir / "SKILL.md"
            if not skill_md.exists():
                continue

            # 只读取 frontmatter（元数据）
            metadata = self._parse_frontmatter_only(skill_md)
            if not metadata:
                continue

            name = metadata.get("name", skill_dir.name)
            self.metadata_cache[name] = {
                "name": name,
                "description": metadata.get("description", ""),
                "path": skill_md,
                "dir": skill_dir
            }

    def _parse_frontmatter_only(self, path: Path) -> Optional[Dict]:
        """仅解析 YAML frontmatter

        Args:
            path: SKILL.md 文件路径

        Returns:
            解析后的元数据字典，如果解析失败则返回 None
        """
        try:
            content = path.read_text(encoding='utf-8')
        except Exception:
            return None

        # 匹配 --- 分隔符之间的内容
        match = re.match(r'^---\s*\n(.*?)\n---\s*\n', content, re.DOTALL)

        if not match:
            return None

        yaml_str = match.group(1)

        # 解析 YAML
        try:
            metadata = yaml.safe_load(yaml_str) or {}
        except yaml.YAMLError:
            return None

        # 验证必需字段
        if "name" not in metadata or "description" not in metadata:
            return None

        return metadata

    def get_descriptions(self) -> str:
        """获取所有技能的元数据描述（用于系统提示词）

        Returns:
            格式化的技能描述列表
        """
        if not self.metadata_cache:
            return "（暂无可用技能）"

        return "\n".join(
            f"- {name}: {skill['description']}"
            for name, skill in self.metadata_cache.items()
        )

    def get_skill(self, name: str) -> Optional[Skill]:
        """
        按需加载完整技能

        Args:
            name: 技能名称

        Returns:
            Skill 对象，如果不存在则返回 None
        """
        # 检查缓存
        if name in self.skills_cache:
            return self.skills_cache[name]

        # 检查元数据
        if name not in self.metadata_cache:
            return None

        metadata = self.metadata_cache[name]

        # 读取完整内容
        try:
            content = metadata["path"].read_text(encoding='utf-8')
        except Exception:
            return None

        # 提取 frontmatter 和 body
        match = re.match(r'^---\s*\n(.*?)\n---\s*\n(.*)$', content, re.DOTALL)

        if not match:
            return None

        frontmatter, body = match.groups()

        # 解析 frontmatter（验证一致性）
        try:
            parsed_metadata = yaml.safe_load(frontmatter) or {}
        except yaml.YAMLError:
            return None

        # 创建 Skill 对象
        skill = Skill(
            name=parsed_metadata.get("name", name),
            description=parsed_metadata.get("description", ""),
            body=body.strip(),
            path=metadata["path"],
            dir=metadata["dir"]
        )

        # 缓存
        self.skills_cache[name] = skill

        return skill

    def list_skills(self) -> List[str]:
        """列出所有可用技能

        Returns:
            技能名称列表
        """
        return list(self.metadata_cache.keys())

    def reload(self):
        """重新扫描技能目录（热重载）"""
        self.skills_cache.clear()
        self.metadata_cache.clear()
        self._scan_skills()
```

