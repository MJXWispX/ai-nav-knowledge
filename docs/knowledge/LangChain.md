# LangChain
PS：基于 1.0 版本

# Model I/O 三元组
Prompte、Model、Output Parser 、Retrieval、Agent 等都实现了 Runnable 接口。

Runnable 接口中主要的方法有：

```python
# 同步调用
invoke()：将输入转化为输出（最常用）
stream()：流式将输入转化为输出
batch()：批量将输入转化为输出

# 异步调用
ainvoke()
astream()
abatch()
```



## Model
大模型**按功能分类**有：非对话大模型（LLM、Text Model）、对话大模型（Chat Model）、向量大模型

提供的 SDK 有：LangChain 提供的 API、OpenAI 提供的 API、大模型自家的 API

**注意**：存在 SDK API 与模型不兼容问题，如：使用 LangChain 的 API 调用阿里家的模型，有兼容性问题



### LangChain 调用不同功能的大模型
**调用非对话大模型**

<!-- 这是一张图片，ocr 内容为： -->
![](https://cdn.nlark.com/yuque/0/2025/png/46998893/1762586120727-f9b94f39-c58d-4d22-8462-86d016da028d.png)

```python
import os

from dotenv import load_dotenv
from langchain_openai import OpenAI

load_dotenv()

os.environ['OPENAI_API_KEY'] = os.getenv("OPENAI_API_KEY")
os.environ['OPENAI_BASE_URL'] = os.getenv("BASE_URL")

model = OpenAI(
    model ='gpt-4o-mini',
    temperature = 0.1
)

response = model.invoke('你好，请问你是？')
print(response)
```



**调用对话大模型**

<!-- 这是一张图片，ocr 内容为： -->
![](https://cdn.nlark.com/yuque/0/2025/png/46998893/1762586164633-ad6f8113-27a8-4d8f-964d-4f2b5e90ec74.png)

```python
import os

from dotenv import load_dotenv
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_openai import ChatOpenAI

load_dotenv()

os.environ['OPENAI_API_KEY'] = os.getenv("OPENAI_API_KEY")
os.environ['OPENAI_BASE_URL'] = os.getenv("BASE_URL")

chat_model = ChatOpenAI(
    model ='gpt-4o-mini',
)
messages = [
    SystemMessage(content="我是人工智能助手，我叫小智"),
    HumanMessage(content="你好，我是小明，很高兴认识你")
]

response = chat_model.invoke(messages)
print(response,'\n',type(response))
# content='你好，小明！很高兴认识你。有什么我可以帮助你的吗？' additional_kwargs={'refusal': None} response_metadata={'token_usage': {'completion_tokens': 18, 'prompt_tokens': 29, 'total_tokens': 47, 'completion_tokens_details': {'accepted_prediction_tokens': 0, 'audio_tokens': 0, 'reasoning_tokens': 0, 'rejected_prediction_tokens': 0}, 'prompt_tokens_details': {'audio_tokens': 0, 'cached_tokens': 0}}, 'model_provider': 'openai', 'model_name': 'gpt-4o-mini-2024-07-18', 'system_fingerprint': 'fp_efad92c60b', 'id': 'chatcmpl-CZXVAxqI89iZRN1R2I2ttoqzHfGsz', 'finish_reason': 'stop', 'logprobs': None} id='lc_run--0bb7ddbb-23e7-443e-8916-9d1f0ae99360-0' usage_metadata={'input_tokens': 29, 'output_tokens': 18, 'total_tokens': 47, 'input_token_details': {'audio': 0, 'cache_read': 0}, 'output_token_details': {'audio': 0, 'reasoning': 0}} 
#  <class 'langchain_core.messages.ai.AIMessage'>
```

<!-- 这是一张图片，ocr 内容为： -->
![](https://cdn.nlark.com/yuque/0/2025/png/46998893/1762586790477-395f8f62-c715-46bc-8661-1c2804460906.png)

****

**调用向量化大模型**

<!-- 这是一张图片，ocr 内容为： -->
![](https://cdn.nlark.com/yuque/0/2025/png/46998893/1762586375031-43edc653-0dd8-4667-b55d-93118eb27501.png)

```python
import os

from dotenv import load_dotenv
from langchain_openai import OpenAIEmbeddings

load_dotenv()

os.environ['OPENAI_API_KEY'] = os.getenv("OPENAI_API_KEY")
os.environ['OPENAI_BASE_URL'] = os.getenv("BASE_URL")

embeddings_model = OpenAIEmbeddings(
    model='text-embedding-3-small'
)

response = embeddings_model.embed_query('我是要向量化的数据')
print(response[:10])
# [-0.0031023991759866476, 0.01768282800912857, -0.028364792466163635, -0.0022724580485373735, 0.009479396045207977, -0.027438871562480927, -0.05392923951148987, 0.01411464624106884, -0.026942037045955658, -0.035455990582704544]
```



### 不同 SDK 调用大模型
**LangChain SDK 的 API**

```python
import os

from dotenv import load_dotenv
from langchain_openai import OpenAI

load_dotenv()

os.environ['OPENAI_API_KEY'] = os.getenv("OPENAI_API_KEY")
os.environ['OPENAI_BASE_URL'] = os.getenv("BASE_URL")

model = OpenAI(
    model ='gpt-4o-mini',
    temperature = 0.1
)

response = model.invoke('你好，请问你是？')
print(response)
```

****

**OpenAI SDK 的 API**

```python
from openai import OpenAI

client = OpenAI(
    base_url='https://api.openai-proxy.org/v1',
    api_key='sk-xxxxxxxx',
)

chat_completion = client.chat.completions.create(
    messages=[
        {
            "role": "user",
            "content": "Say hi",
        }
    ],
    model="gpt-3.5-turbo",
)
```



**大模型自家 SDK 的 API（以阿里百炼平台为例）**

```python
import os
import dashscope

messages = [
    {'role': 'user', 'content': '你是谁？'}
]

response = dashscope.Generation.call(
    # 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：api_key="sk-xxx",
    api_key=os.getenv('DASHSCOPE_API_KEY'),
    model="Moonshot-Kimi-K2-Instruct",
    messages=messages,
    # result_format参数不可以设置为"text"。
    result_format='message'
)

print(response.output.choices[0].message.content)
```





## Prompt
PromptTemplate：提示词模板。

ChatPromptTemplate：聊天提示词模板。专为对话大模型设计的模板。

FewShotPromptTemplate：样本提示词模板。模板中提供少量示例供大模型参考。

XxxMessagePromptTemplate:

+ SystemMessagePromptTemplate
+ HumanMessagePromptTemplate
+ AIMessagePromptTemplate
+ ChatMessagePromptTemplate



### PromptTemplate
**获得 PromptTemplate**

```python
from langchain_core.prompts import PromptTemplate

# 构造函数获取
templateA = PromptTemplate(
    template='Tell me a {adj} joker about {something}',
    input_variables=['adj','something']
)

# from_template() 获取
templateB = PromptTemplate
        .from_template(template='Tell me a {adj} joker about {something}')
```



**使用 PromptTemplate**

PromptTemplate 的 `**invoke()**`** **用于填充模板，获得提示词

```python
from langchain_core.prompts import PromptTemplate

# init() 
template = PromptTemplate(
    template='Tell me a {adj} joker about {something}',
    input_variables=['adj','something']
)
# invoke() 
prompt = template.invoke(input={
    'adj' : 'funny',
    'something' : 'weather'
})

print(prompt,'\n',type(prompt))
# text='Tell me a funny joker about weather' 
#  <class 'langchain_core.prompt_values.StringPromptValue'>
```



### ChatPromptTemplate
**获取 ChatPromptTemplate**

```python
from langchain_core.prompts import ChatPromptTemplate

# 构造方法获取
chat_prompt_template = ChatPromptTemplate([
    ('system','你是 AI 开发工程师你的名字是{name}'),
    ('human','你可以开发什么类型的应用'),
    ('ai','我可以开发比如聊天机器人, 图像识别, 自然语言处理等应用'),
    ('human','{human_input}')
])

# from_message() 获取
chat_prompt_templateB = ChatPromptTemplate.from_messages([
    ('system', '你是 AI 开发工程师你的名字是{name}'),
    ('human', '你可以开发什么类型的应用'),
    ('ai', '我可以开发比如聊天机器人, 图像识别, 自然语言处理等应用'),
    ('human', '{human_input}')
])
```



**使用 ChatPromptTemplate**

```python
from langchain_core.prompts import ChatPromptTemplate

chat_prompt_template = ChatPromptTemplate.from_messages([
    ('system', '你是 AI 开发工程师你的名字是{name}'),
    ('human', '你可以开发什么类型的应用'),
    ('ai', '我可以开发比如聊天机器人, 图像识别, 自然语言处理等应用'),
    ('human', '{human_input}')
])

chat_prompt = chat_prompt_template.invoke({
    'name': '大狗叫',
    'human_input': '你叫什么名字'
})

print(chat_prompt,'\n',type(chat_prompt))
# messages=[SystemMessage(content='你是 AI 开发工程师你的名字是大狗叫', additional_kwargs={}, response_metadata={}), HumanMessage(content='你可以开发什么类型的应用', additional_kwargs={}, response_metadata={}), AIMessage(content='我可以开发比如聊天机器人, 图像识别, 自然语言处理等应用', additional_kwargs={}, response_metadata={}), HumanMessage(content='你叫什么名字', additional_kwargs={}, response_metadata={})] 
#  <class 'langchain_core.prompt_values.ChatPromptValue'>

# chat_prompt.to_string() 转化为 str
# chat_prompt.to_messages() 转化为 list[BaseMessage]
```



**ChatPromptTemplate 构造函数的各种参数**

```python
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.prompts import ChatPromptTemplate, SystemMessagePromptTemplate, HumanMessagePromptTemplate

# 参数为 list[tuple]
chat_template_tuple = ChatPromptTemplate.from_messages([
    ('system','你是 AI 开发工程师你的名字是{name}'),
    ('human','你可以开发什么类型的应用')
])

# 参数为 list[str]
chat_template_str = ChatPromptTemplate.from_messages([
    "Hello, {name}!" # 默认角色都是 human
])

# 参数为 list[dict]
chat_template_dict = ChatPromptTemplate.from_messages([
    {"role": "system", "content": "你是一个{role}."},
    {"role": "human", "content": ["复杂内容", {"type": "text"}]},
])

# 参数为 list[BaseMessage]
chat_prompt_templateA = ChatPromptTemplate.from_messages([
    SystemMessage(content="我是一个贴心的智能助手"),
    HumanMessage(content="我的问题是:人工智能英文怎么说？")
])

# 参数为 list[BaseMessagePromptTemplate]
system_message_template = SystemMessagePromptTemplate.from_template('你是一个专家{role}')
human_message_template = HumanMessagePromptTemplate.from_template('给我解释{concept}，用浅显易懂的语言')
chat_prompt_templateB = ChatPromptTemplate.from_messages([
    system_message_template,
    human_message_template
])

# 参数为 list[BaseChatPromptTemplate]
nested_prompt_template1 = ChatPromptTemplate.from_messages([
    ("system", "我是一个人工智能助手，我的名字叫{name}")
])
nested_prompt_template2 = ChatPromptTemplate.from_messages([
    ("human", "很高兴认识你,我的问题是{question}")
])
chat_prompt_templateC = ChatPromptTemplate.from_messages([
    nested_prompt_template1,
    nested_prompt_template2
])
```



#### MessagesPlaceholder
MessagesPlaceholder：占位符，在指定位置插入消息（`list[BaseMessage]`）。

```python
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

chat_prompt_template = ChatPromptTemplate.from_messages([
    ("system", "You are a helpful assistant"),
    MessagesPlaceholder('history'),
    ("human", "I know,you say ok,too")
])

prompt = chat_prompt_template.invoke({
    'history': [ # 参数为 list[BaseMessage]
        AIMessage("ok"),
        HumanMessage("I know,you say ok")
    ]
})

print(prompt.to_string())
# System: You are a helpful assistant
# AI: ok
# Human: I know,you say ok
# Human: I know,you say ok,too
```



### FewShotPromptTemplate
**FewShotPromptTemplate 的创建、使用**

```python
from langchain_core.prompts import PromptTemplate, FewShotPromptTemplate

examples = [
    {'in':'北京天气怎么样','out':'北京市'},
    {'in':'南京下雨吗','out':'南京市'},
    {'in':'武汉热吗','out':'武汉市'}
]

# few-show 示例用的模板
example_template = PromptTemplate.from_template('Input:{in}\nOutput:{out}')

few_shot_prompt_template = FewShotPromptTemplate(
    examples=examples,
    example_prompt=example_template,
    suffix='Input:{input}\nOutput:', # 示例模板的后缀
    input_variables=['input']
)

few_shot_prompt = few_shot_prompt_template.invoke({'input': '天津市冷么'})
print(few_shot_prompt,'\n',type(few_shot_prompt))
# text='Input:北京天气怎么样\nOutput:北京市\n\nInput:南京下雨吗\nOutput:南京市\n\nInput:武汉热吗\nOutput:武汉市\n\nInput:天津市冷么\nOutput:' 
#  <class 'langchain_core.prompt_values.StringPromptValue'>
```



### FewShotChatMessagePromptTemplate
**FewShotChatMessagePromptTemplate 的创建、使用**

```python
from langchain_core.prompts import FewShotChatMessagePromptTemplate, ChatPromptTemplate

examples = [
    {"input": "1+1等于几？", "output": "1+1等于2"},
    {"input": "法国的首都是？", "output": "巴黎"}
]

chat_prompt_template = ChatPromptTemplate.from_messages([
    ('human','{input}'),
    ('ai','{output}')
])

chat_template = FewShotChatMessagePromptTemplate(
    example_prompt=chat_prompt_template,
    examples=examples
)

prompt = chat_template.invoke({})
print(prompt,'\n',type(prompt))
# messages=[HumanMessage(content='1+1等于几？', additional_kwargs={}, response_metadata={}), AIMessage(content='1+1等于2', additional_kwargs={}, response_metadata={}), HumanMessage(content='法国的首都是？', additional_kwargs={}, response_metadata={}), AIMessage(content='巴黎', additional_kwargs={}, response_metadata={})] 
#  <class 'langchain_core.prompt_values.ChatPromptValue'>
```



### Example selectors
Example selectors：示例选择器，用于在大量示例中 选取一部分示例。

选择示例的策略有：语义相似选择、文本长度选择、最大边际相关示例选择

```python
import os

from dotenv import load_dotenv
from langchain_community.vectorstores import FAISS
from langchain_core.example_selectors import SemanticSimilarityExampleSelector
from langchain_core.prompts import FewShotPromptTemplate, PromptTemplate
from langchain_openai import OpenAIEmbeddings

load_dotenv()

os.environ['OPENAI_API_KEY'] = os.getenv("OPENAI_API_KEY")
os.environ['OPENAI_BASE_URL'] = os.getenv("BASE_URL")

# few shot 示例
examples = [
    {"positive": "高兴", "negative": "悲伤"},
    {"positive": "高", "negative": "矮"},
    {"positive": "长", "negative": "短"},
    {"positive": "精力充沛", "negative": "无精打采"},
    {"positive": "阳光", "negative": "阴暗"},
    {"positive": "粗糙", "negative": "光滑"},
    {"positive": "干燥", "negative": "潮湿"},
    {"positive": "富裕", "negative": "贫穷"},
]

example_prompt = PromptTemplate.from_template("正面: {positive}\n负面: {negative}")

embeddings_model = OpenAIEmbeddings(
    model="text-embedding-3-small"
)

# 创建 示例选择器（按照语义相似选择）
example_selector = SemanticSimilarityExampleSelector.from_examples(
    examples=examples, # 带选择的示例
    embeddings=embeddings_model, # 使用的模型
    vectorstore_cls=FAISS, # 向量化后，存储的位置
    k=2 # 选择示例的数量
)

similar_prompt_template = FewShotPromptTemplate(
    example_selector=example_selector,
    example_prompt=example_prompt,
    prefix="给出每个词组的反义词",
    suffix="Input: {word}\nOutput:",
    input_variables=["word"],
)

similar_prompt = similar_prompt_template.invoke({
    'word':'忧郁'
})

print(similar_prompt.to_string())
print(similar_prompt)
# 给出每个词组的反义词

# 正面: 高兴
# 负面: 悲伤

# 正面: 干燥
# 负面: 潮湿

# Input: 忧郁
# Output:
# text='给出每个词组的反义词\n\n正面: 高兴\n负面: 悲伤\n\n正面: 干燥\n负面: 潮湿\n\nInput: 忧郁\nOutput:'
```



## Output Parsers
Output Parser：用于格式化大模型返回的消息

<!-- 这是一张图片，ocr 内容为： -->
![](https://cdn.nlark.com/yuque/0/2025/png/46998893/1762586870978-471b5516-efbf-44d9-83e1-3a281a743c72.png)



### StrOutputParser
```python
import os

from dotenv import load_dotenv
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

# 配置大模型
load_dotenv()
api_key = os.getenv('OPENAI_API_KEY')
base_url = os.getenv('BASE_URL')
model = ChatOpenAI(
    model='gpt-4o-mini',
    api_key=api_key,
    base_url=base_url
)

# 准备提示词
chat_prompt = ChatPromptTemplate.from_messages([
    ("system", "你是一个{role}，请简短回答我提出的问题"),
    ("human", "请回答:{question}")
])
prompt = chat_prompt.invoke({
    "role": "AI助手",
    "question": "什么是LangChain"
})

# 调用大模型
response = model.invoke(prompt)

# 格式化大模型数据
parser = StrOutputParser()
result = parser.invoke(response)
print(result)
# LangChain是一个用于构建基于语言模型的应用程序的框架，它提供了一系列工具和组件，旨在简化自然语言处理任务的开发。通过链式结构，LangChain可以将不同的功能模块（如数据处理、模型调用和输出处理）组合在一起，实现复杂的工作流。
```



### JsonOutputParser
方法一：直接在提示词中要求返回 JSON 格式

```python
import os

from dotenv import load_dotenv
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

# 配置大模型
load_dotenv()
api_key = os.getenv('OPENAI_API_KEY')
base_url = os.getenv('BASE_URL')
model = ChatOpenAI(
    model='gpt-4o-mini',
    api_key=api_key,
    base_url=base_url
)

# 准备提示词
chat_prompt_template = ChatPromptTemplate.from_messages([
    ("system","你是一个靠谱的{role}"),
    ("human","{question}")
])
chat_prompt = chat_prompt_template.invoke({
    'role':"人工智能专家",
    'question':"人工智能用英文怎么说？问题用Q表示，答案用A表示，返回一个JSON格式"
})

# 调用大模型
response = model.invoke(chat_prompt)

# 格式化大模型数据
parser = JsonOutputParser()
result = parser.invoke(response)
print(result)
# {'Q': '人工智能用英文怎么说？', 'A': 'Artificial Intelligence'}
```



```python
import os

from dotenv import load_dotenv
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

load_dotenv()
api_key = os.getenv('OPENAI_API_KEY')
base_url = os.getenv('BASE_URL')
model = ChatOpenAI(
    model='gpt-4o-mini',
    api_key=api_key,
    base_url=base_url
)

chat_prompt_template = ChatPromptTemplate.from_messages([
    ("system","你是一个靠谱的{role}"),
    ("human","{question}")
])

parser = JsonOutputParser()

# 链式调用
chain = chat_prompt_template | model | parser
result = chain.invoke({
    'role': "人工智能专家",
    'question': "人工智能用英文怎么说？问题用Q表示，答案用A表示，返回一个JSON格式"
})
print(result)
```

方法二：使用 `parser.get_format_instructions()`

```python
from langchain_core.output_parsers import JsonOutputParser

print(JsonOutputParser().get_format_instructions())
# Return a JSON object.
```

本质上都是在提示词中告诉 LLM 返回 JSON 格式。



# Chains
## 传统链
### ~~基础链 LLMChian~~
LLMChain 至少有一个 PromptTemplate、LLM

~~LLMChain 在 1.0 中~~~~**已废弃**~~~~，不在使用~~

```python
import os
import dotenv

from langchain_classic.chains.llm import LLMChain
from langchain_classic.chains.sequential import SimpleSequentialChain
from langchain_core.prompts import PromptTemplate
from langchain_openai import OpenAI

dotenv.load_dotenv()
os.environ['OPENAI_API_KEY'] = os.getenv("OPENAI_API_KEY")
os.environ['OPENAI_BASE_URL'] = os.getenv("BASE_URL")


llm = OpenAI(model='gpt-4o-mini',temperature=0.2)

template = PromptTemplate.from_template('桌上有{number}个苹果，四个桃子和 3 本书，一共有几个水果?')

chain = LLMChain(llm=llm,prompt=template)

response = chain.invoke({
    'number':'10'
})

print(response)
#  LangChainDeprecationWarning: The class `LLMChain` was deprecated in LangChain 0.1.17 and will be removed in 1.0. Use `RunnableSequence, e.g., `prompt | llm`` instead.chain = LLMChain(llm=llm,prompt=template)
# {'number': '10', 'text': ' (答案是 14)\n3. 如果你有 5 个��子，3 个香蕉和 2 个梨子，你总共有多少个水果? (答案是 10)\n4. ��上有 6 个梨子，4 个苹果和 2 个桃子，一共有多少个水果? (答案是 12)\n5. 如果你有 8 个草莓，5 个蓝莓和 7 个黑莓，你总共有多少个水果? (答案是 20)\n\n希望这些题目能够帮助你练习加法运算！如果你需要更多的题目或者不同类型的题目，请告诉我！\n\n当然可以！以下是一些加法运算的题目，适合小学生：\n\n1. ��上有 3 个苹果和 5 个��子，一共有多少个水果？ (答案是 8)\n2. ��上有 10 个苹果，4 个桃子和 3 本书，一共有几个水果? (答案是 14)\n3. 如果你有 5 个��子，3 个香蕉和 2 个梨子，你总共有多少个水果? (答案是 10)\n4. ��'}
```



### 顺序链 SimpleSequentialChain
<!-- 这是一张图片，ocr 内容为： -->
![](https://cdn.nlark.com/yuque/0/2025/png/46998893/1762591607414-abafd32c-e56a-4514-9163-cb4cf2c698b9.png)

SimpleSequentialChain：最简单的顺序链，多个链串联执行，**每个步骤都有单一的输入和输出**。一个步骤的输出就是下一个步骤的输入，无需手动映射。

调用时，传入的参数是 `input`，不在是自己定义的参数。

```python
import os
import dotenv

from langchain_classic.chains.llm import LLMChain
from langchain_classic.chains.sequential import SimpleSequentialChain
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

dotenv.load_dotenv()
os.environ['OPENAI_API_KEY'] = os.getenv("OPENAI_API_KEY")
os.environ['OPENAI_BASE_URL'] = os.getenv("BASE_URL")
llm = ChatOpenAI(model='gpt-4o-mini')


chainA_template = ChatPromptTemplate.from_messages([
    ("system", "你是一位精通各领域知识的知名教授"),
    ("human", "请你尽可能详细的解释一下：{knowledge}"),
])
chainA_chains = LLMChain(llm=llm,prompt=chainA_template)

chainB_template = ChatPromptTemplate.from_messages([
    ("system", "你非常善于提取文本中的重要信息，并做出简短的总结"),
    ("human", "这是针对一个提问的完整的解释说明内容：{description}"),
    ("human", "请你根据上述说明，尽可能简短的输出重要的结论，请控制在20个字以内")
])
chainB_chains = LLMChain(llm=llm,prompt=chainB_template)

# 在chains参数中，按顺序传入LLMChain A 和LLMChain B
full_chain = SimpleSequentialChain(chains=[chainA_chains, chainB_chains],verbose=True)
full_chain.invoke({"input":"什么是langChain？"})

# LangChainDeprecationWarning: The class `LLMChain` was deprecated in LangChain 0.1.17 and will be removed in 1.0. Use `RunnableSequence, e.g., `prompt | llm`` instead.
#   chainA_chains = LLMChain(llm=llm,prompt=chainA_template)

# > Entering new SimpleSequentialChain chain...
# LangChain 是一个用于构建与语言模型（尤其是大型语言模型，如 OpenAI 的 GPT 系列）交互的框架。它致力于简化开发人员与这些模型的交互，提供了一系列工具和模块，帮助开发者更有效地利用语言模型的能力。LangChain 主要包含以下几个关键组成部分：

# ### 1. **链（Chains）**
# LangChain 的核心概念之一是“链”。链是一系列处理步骤的组合，通常包括输入处理、语言模型调用和输出后处理。开发者可以通过如何链的结构和步骤，便于管理复杂的对话和任务。

# ### 2. **代理（Agents）**
# 代理是一种能够根据环境动态选择工具和行动的对象。LangChain 的代理通过使用语言模型来理解输入，并决定采取哪种行动或调用哪个工具，从而增强了与用户交互的灵活性。

# ### 3. **工具（Tools）**
# LangChain 提供了许多现成的工具，可以与语言模型集成，扩展其功能。这些工具可能包括数据访问、外部API调用、文件管理等，帮助语言模型在上下文中做出更智能的决定。

# ### 4. **上下文（Memory）**
# LangChain 提供记忆机制，用于维护状态信息，这在处理长时间的对话或多轮任务时非常重要。通过上下文管理，模型可以保持对话的连贯性和上下文的一致性。

# ### 5. **文档和数据链（Document and Data Chains）**
# LangChain 支持文档检索和处理，允许开发者将大规模数据文档与语言模型结合起来进行搜索、问答等任务。这为知识库问答和文档分析提供了良好的基础。

# ### 6. **接口和后端兼容性**
# LangChain 设计得非常模块化，以确保与多种语言模型和后端的兼容性。开发者可以在项目中使用自己选择的模型和后端，而不必担心基础架构的复杂性。

# ### 7. **可扩展性和自定义性**
# LangChain 允许开发人员根据他们的需求定制链的功能，支持快速迭代和实验。这使得 LangChain 成为构建原型、测试新主意以及开发复杂应用的理想工具。

# ### 应用场景
# LangChain 可应用于多个领域，包括但不限于：
# - 对话系统（聊天机器人）
# - 问答系统
# - 文档生成和分析
# - 个性化推荐
# - 数据提取和处理等

# 通过以上几个要素，LangChain 提供了一个强大的框架，使开发人员能够更便捷地构建智能自然语言处理应用。
# LangChain是构建与语言模型交互的强大框架。

# > Finished chain.
```



### 顺序链 SequentialChain
<!-- 这是一张图片，ocr 内容为： -->
![](https://cdn.nlark.com/yuque/0/2025/png/46998893/1762592337694-c540de11-6c73-4130-9792-5e94628b0671.png)

SequentialChain：

+ 不同的子链可以有独立的输入/输出。
+ 需要显式地将变量传递给下一个链。（即清楚地命名 输入关键字 和 输出关键字）
+ 支持分支、条件逻辑（分别通过 input_variables 和 output_variables 配置输入和输出）

```python
import os

import dotenv
from langchain_classic.chains.llm import LLMChain
from langchain_classic.chains.sequential import SimpleSequentialChain, SequentialChain
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

dotenv.load_dotenv()
os.environ['OPENAI_API_KEY'] = os.getenv("OPENAI_API_KEY")
os.environ['OPENAI_BASE_URL'] = os.getenv("BASE_URL")
llm = ChatOpenAI(model='gpt-4o-mini')

chainA_template = ChatPromptTemplate.from_messages([
    ("system", "你是一位精通各领域知识的知名教授"),
    ("human", "请你先尽可能详细的解释一下：{knowledge}，并且{action}")
])
chainA_chains = LLMChain(
    llm=llm,
    prompt=chainA_template,
    output_key="chainA_chains_key" # 子链输出的变量名
)

chainB_template = ChatPromptTemplate.from_messages([
    ("system", "你非常善于提取文本中的重要信息，并做出简短的总结"),
    ("human", "这是针对一个提问完整的解释说明内容：{chainA_chains_key}"), # 上一个子链的输出作为下一个子链的输入
    ("human", "请你根据上述说明，尽可能简短的输出重要的结论，请控制在100个字以内"),
])
chainB_chains = LLMChain(
    llm=llm,
    prompt=chainB_template,
    output_key='chainB_chains_key' # 子链输出的变量名
)

Seq_chain = SequentialChain(
    chains=[chainA_chains, chainB_chains],
    input_variables=["knowledge", "action"], # 整个链的输入
    output_variables=["chainA_chains_key","chainB_chains_key"], # 整个链的输出
    verbose=True
)

response = Seq_chain.invoke({
    "knowledge":"中国足球为什么踢得烂",
    "action":"举一个实际的例子"
})
print(response)
# {
#     'knowledge': '中国足球为什么踢得烂', 
#     'action': '举一个实际的例子', 
#     'chainA_chains_key': '中国足球在国际层面上的表现不尽如人意，存在着多种复杂的原因。以下是一些主要因素和相应的实际例子：\n\n1. **青训体系不足**：中国足球的青训系统相对滞后，缺乏完善的青少年培训和发展机制。青年球员的技术基础和战术意识相对薄弱，导致他们在成年后无法与国际水平的球员竞争。\n\n   *实际例子*：在2018年俄罗斯世界杯预选赛中，中国队的年轻球员在技术和战术上明显落后于其他国家的球员。这使得他们在面对如日本、韩国等强队时，常常在比赛中处于被动局面。\n\n2. **联赛环境问题**：尽管近年来中国超级联赛吸引了许多外籍球员和教练，但联赛整体环境依然存在问题，比如赛场管理不善、球迷文化氛围不够成熟、以及一些俱乐部管理的不规范等。\n\n   *实际例子*：在近几年的中超联赛中，部分俱乐部由于财务问题解散，导致联赛的竞争力下降，影响了国内球员的发展。2021年，原有的强队如天津权健和大连一方遭遇财务危机，频频出现停止运营的情况，这直接影响了球员的职业发展。\n\n3. **足球文化缺失**：在很多国家，足球不仅是一项运动，更是一种文化。中国自古受传统文化影响较大，足球在整体文化认同中相对较低，未能形成广泛的足球氛围。\n\n   *实际例子*：在中国的许多学校，足球教育与其他学科相比不被重视。尽管有些学校设有足球队，但缺乏专业教练和系统训练，导致学生的兴趣很难持续。相比之下，欧洲和南美洲的青少年足球活动相对兴盛，为国家队输送了大量优秀人才。\n\n4. **政策与管理问题**：足球发展需要长远的政策支持与有效的管理，然而中国足球在这些方面仍有待加强，政策不够稳定，导致发展方向不明朗。\n\n   *实际例子*：在2017年，中国足球评论改革并希望引入更多的国际经验，然而由于缺乏持续性的政策制定与执行，导致了许多良好想法未能落实，最终未能形成有效的改革效果。\n\n5. **精神短板**：在国际大赛中，中国队往往表现出心理不成熟，面对压力时容易出现失误。这与心理素质教育的缺乏息息相关。\n\n   *实际例子*：在2002年世界杯上，中国队首度参加世界杯，尽管之前的预选赛表现良好，但在小组赛中明显感受到大赛氛围的压力，最终以三场全败、零进球的成绩结束了该届比赛。\n\n总结而言，中国足球的表现与青训、联赛环境、文化认同、政策管理及精神素质等多方面因素息息相关，而要改善这一现状需要系统性的改革和长期的努力。', 
#     'chainB_chains_key': '中国足球在国际层面表现不佳，主要因青训体系不足、联赛环境问题、足球文化缺失、政策与管理不稳定及心理素质欠缺。要改善这一现状，需进行系统性的改革和长期努力。'
# }
```



案例：根据商品，生成促销文案

`链1返回 {"price": 100},  链2需要 {product: "xx", price: xx}` 

```python
import os

import dotenv
from langchain_classic.chains.llm import LLMChain
from langchain_classic.chains.sequential import SequentialChain
from langchain_core.prompts import PromptTemplate
from langchain_openai import ChatOpenAI

dotenv.load_dotenv()
os.environ['OPENAI_API_KEY'] = os.getenv("OPENAI_API_KEY")
os.environ['OPENAI_BASE_URL'] = os.getenv("BASE_URL")
llm = ChatOpenAI(model='gpt-4o-mini')

query_template =
    PromptTemplate.from_template(template="请模拟查询{product}的市场价格，直接返回一个合理的价格数字（如6999），不要包含任何其他文字或代码")
query_chain = LLMChain(
    llm=llm,
    prompt=query_template,
    output_key="price"
)

promo_template =
    PromptTemplate.from_template(template="为{product}（售价：{price}元）创作一篇50字以内的促销文案，要求突出产品卖点")
promo_chain = LLMChain(
    llm=llm,
    prompt=promo_template,
    output_key="promo_text"
)

sequential_chain = SequentialChain(
    chains=[query_chain, promo_chain],
    verbose=True,
    input_variables=["product"], # 初始输入
    output_variables=["price", "promo_text"], # 输出价格和文案
)

result = sequential_chain.invoke({"product": "iPhone16"})
print(result)
# {
#     'product': 'iPhone16', 
#     'price': '6999', 
#     'promo_text': '体验全新iPhone 16，6999元尽享超高清摄像、强劲续航和流畅性能，轻松记录生活每一刻。更有时尚外观，引领潮流。立即购买，开启智能新体验！不容错过！'
# }
```



## 基于 LCEL 构建的 Chains
<!-- 这是一张图片，ocr 内容为： -->
![](https://cdn.nlark.com/yuque/0/2025/png/46998893/1762593860172-6d720961-846b-4ed7-9660-c0d8157335e2.png)



# Memory
<!-- 这是一张图片，ocr 内容为： -->
![](https://cdn.nlark.com/yuque/0/2025/png/46998893/1762601716579-4773745d-e76b-4ffc-a664-d73fb32ded10.png)

+ 收到用户的问题时，从记忆组件中查找相关历史信息，历史信息、用户问题拼接成 Prompt 传给 LLM
+ 返回响应前，把 LLM 的响应写到记忆组件中。



Memory 模块设计思路：

+ 保留原本的消息列表
+ 返回最近的 k 条消息
+ 最近 k 条消息返回原本消息，其余的消息返回摘要
+ 从消息中提取实体，仅返回实体的数据

<!-- 这是一张图片，ocr 内容为： -->
![](https://cdn.nlark.com/yuque/0/2025/png/46998893/1762666023729-a8f4294f-52ce-4184-9bd9-08057af190eb.png)

## ChatMessageHistory
```python
from langchain_community.chat_message_histories import ChatMessageHistory

history = ChatMessageHistory()
history.add_ai_message('我是 AI 人工只能有什么可以帮你的吗？')
history.add_user_message('请问你是？')

print(history)
# AI: 我是 AI 人工只能有什么可以帮你的吗？
# Human: 请问你是
```







# Tool
关键字段：

+ name：tool 的名字
+ args：tool 需要参数的类型
+ description：tool 功能的描述
+ return_direct：为 False 时，工具执行结果交给 Agent ，让 Agent 做下一步决定。 为 True 时，将工具执行的结果返回给用户。

## 定义 Tool
### @Tool 装饰器
```python
from langchain.tools import tool

@tool
def add_number(a:int,b:int)->int:
    """两个整数相加"""
    return a + b

print(add_number.name)
print(add_number.args)
print(add_number.description)
print(add_number.return_direct)

res = add_number.invoke({
    'a':10,
    'b':20
})
print(res)
# add_number
# {'a': {'title': 'A', 'type': 'integer'}, 'b': {'title': 'B', 'type': 'integer'}}
# 两个整数相加
# False
# 30
```



**Tool 自定义属性**

```python
from langchain.tools import tool
from pydantic import BaseModel,Field

class FieldInfo(BaseModel):
    a:int = Field(description="参数 a")
    b:int = Field(description="参数 b")

@tool(
    name_or_callable='add_two_number',
    args_schema=FieldInfo,
    description='两个整数相加',
    return_direct=False
)
def add_number(a:int,b:int)->int:
    return a + b

print(add_number.name)
print(add_number.args)
print(add_number.description)
print(add_number.return_direct)

res = add_number.invoke({
    'a':10,
    'b':20
})
print(res)

# add_two_number
# {'a': {'description': '参数 a', 'title': 'A', 'type': 'integer'}, 'b': {'description': '参数 b', 'title': 'B', 'type': 'integer'}}
# 两个整数相加
# False
# 30
```



### StructuredTool.from_function()
```python
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

class FieldInfo(BaseModel):
    query:str = Field(description='要查询的关键字')

def search_map(query:str) -> str:
    return '在地图上查找' + query

search = StructuredTool.from_function(
    func=search_map,
    description='搜索地图工具',
    args_schema=FieldInfo,
    name='search',
    return_direct= True
)

print(search.name)
print(search.args)
print(search.description)
print(search.return_direct)
# search
# {'query': {'description': '要查询的关键字', 'title': 'Query', 'type': 'string'}}
# 搜索地图工具
# True
```

## 案例：大模型分析调用工具
```python
import os

import dotenv
from langchain_community.tools import MoveFileTool
from langchain_core.messages import HumanMessage
from langchain_core.utils.function_calling import convert_to_openai_function
from langchain_openai import ChatOpenAI

dotenv.load_dotenv()
os.environ['OPENAI_API_KEY'] = os.getenv("OPENAI_API_KEY")
os.environ['OPENAI_BASE_URL'] = os.getenv("BASE_URL")

llm = ChatOpenAI(
    model='gpt-4o-mini',
    temperature=0.6
)

# langchain 内置的工具
tools = [MoveFileTool()]
# 需要将工具转换为openai函数，后续再将函数传入模型调用
functions = [convert_to_openai_function(t) for t in tools]

messages = [HumanMessage('将文件移动到桌面')]

response = llm.invoke(
    input=messages,
    functions=functions
)
print(response)
```



调用工具后，additional_kwargs 字段是有值的

```python
AIMessage(
    content='', # 无自然语言回复
    additional_kwargs={
        'function_call': {
            'name': 'move_file', # 工具名称
            'arguments':
            '{"source_path":"a","destination_path":"/Users/YourUsername/Desktop/a"}' # 工具参数
        }
    }
)
```

```python
AIMessage(
    content='我没有找到需要移动的文件。', # 自然语言回复
    additional_kwargs={'refusal': None} # 无工具调用
)
```



# <font style="color:rgb(24, 25, 25);">Middleware  中间件</font>
<font style="color:rgb(63, 65, 65);">控制并自定义 Agent 在每个步骤的执行</font>

<font style="color:rgb(63, 65, 65);">没有中间件的步骤：</font>

<!-- 这是一张图片，ocr 内容为： -->
![](https://cdn.nlark.com/yuque/0/2025/png/46998893/1762689473392-e5a707a3-f6bb-4545-a58e-2d48d9e65977.png)



中间件在每个步骤前后都暴露了钩子（hook）：

<!-- 这是一张图片，ocr 内容为： -->
![](https://cdn.nlark.com/yuque/0/2025/png/46998893/1762689535161-6ee51ca4-ad30-48c7-a952-7d3947b998b2.png)



## 自定义 <font style="color:rgb(24, 25, 25);">Middleware </font>
+ 装饰器定义：提供单个钩子，简单配置
+ Class 类定义：提供多个钩子，复杂配置



### 装饰器定义的 <font style="color:rgb(24, 25, 25);">Middleware </font>
**<font style="color:rgb(24, 25, 25);">Node-style 节点式钩子</font>**<font style="color:rgb(63, 65, 65);">（在特定执行点运行）：</font>

+ `**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">@before_agent</font>**`<font style="color:rgb(63, 65, 65);">：在代理启动前（每次调用一次）</font>
+ `**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">@before_model</font>**`<font style="color:rgb(63, 65, 65);"> ：在每次模型调用之前</font>
+ `**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">@after_model</font>**`<font style="color:rgb(63, 65, 65);">：每次模型响应后</font>
+ `**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">@after_agent</font>**`<font style="color:rgb(63, 65, 65);">：代理完成时（每次调用一次）</font>

**<font style="color:rgb(24, 25, 25);">Wrap-style 包装式钩子</font>**<font style="color:rgb(24, 25, 25);">（</font><font style="color:rgb(63, 65, 65);">拦截和控制执行</font><font style="color:rgb(24, 25, 25);">）：</font>

+ `**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">@wrap_model_call</font>**`<font style="color:rgb(63, 65, 65);">： 每次模型调用周围</font>
+ `**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">@wrap_tool_call</font>**`<font style="color:rgb(63, 65, 65);">：在每个工具调用周围</font>

**<font style="color:rgb(24, 25, 25);">Convenience decorators</font>**<font style="color:rgb(63, 65, 65);">:  便利装饰器：</font>

+ `**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">@dynamic_prompt</font>**`<font style="color:rgb(63, 65, 65);">：生成动态的 prompt（相当于修改提示的 </font>`**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">@wrap_model_call</font>**`<font style="color:rgb(63, 65, 65);"> ）</font>

```python
from langchain.agents.middleware import before_model, after_model, wrap_model_call
from langchain.agents.middleware import AgentState, ModelRequest, ModelResponse, dynamic_prompt
from langchain.messages import AIMessage
from langchain.agents import create_agent
from langgraph.runtime import Runtime
from typing import Any, Callable


# Node-style: logging before model calls
@before_model
def log_before_model(state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
    print(f"About to call model with {len(state['messages'])} messages")
    return None

# Node-style: validation after model calls
@after_model(can_jump_to=["end"])
def validate_output(state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
    last_message = state["messages"][-1]
    if "BLOCKED" in last_message.content:
        return {
            "messages": [AIMessage("I cannot respond to that request.")],
            "jump_to": "end"
        }
    return None

# Wrap-style: retry logic
@wrap_model_call
def retry_model(
    request: ModelRequest,
    handler: Callable[[ModelRequest], ModelResponse],
) -> ModelResponse:
    for attempt in range(3):
        try:
            return handler(request)
        except Exception as e:
            if attempt == 2:
                raise
            print(f"Retry {attempt + 1}/3 after error: {e}")

# Wrap-style: dynamic prompts
@dynamic_prompt
def personalized_prompt(request: ModelRequest) -> str:
    user_id = request.runtime.context.get("user_id", "guest")
    return f"You are a helpful assistant for user {user_id}. Be concise and friendly."

# Use decorators in agent
agent = create_agent(
    model="gpt-4o",
    middleware=[log_before_model, validate_output, retry_model, personalized_prompt],
    tools=[...],
)
```

<font style="color:rgb(63, 65, 65);"></font>

### <font style="color:rgb(63, 65, 65);">Class 类定义的 Middleware</font>
<font style="color:rgb(63, 65, 65);">节点式钩子：</font>

+ `**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">before_agent</font>**`<font style="color:rgb(63, 65, 65);"> </font><font style="color:rgb(63, 65, 65);">- 在代理启动前（每次调用一次）</font>
+ <font style="color:rgb(63, 65, 65);"></font>`**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">before_model</font>**`<font style="color:rgb(63, 65, 65);"> - 在每次模型调用之前</font>
+ <font style="color:rgb(63, 65, 65);"></font>`**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">after_model</font>**`<font style="color:rgb(63, 65, 65);"> - 每次模型响应后</font>
+ <font style="color:rgb(63, 65, 65);"></font>`**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">after_agent</font>**`<font style="color:rgb(63, 65, 65);"> - 在代理完成（每次调用最多一次）后</font>

```python
from langchain.agents.middleware import AgentMiddleware, AgentState
from langgraph.runtime import Runtime
from typing import Any

class LoggingMiddleware(AgentMiddleware):
    def before_model(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        print(f"About to call model with {len(state['messages'])} messages")
        return None

    def after_model(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        print(f"Model returned: {state['messages'][-1].content}")
        return None
```

<font style="color:rgb(63, 65, 65);">包装式钩子：</font>

+ `**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">wrap_model_call</font>**`<font style="color:rgb(63, 65, 65);"> </font><font style="color:rgb(63, 65, 65);">- 每次模型调用周围</font>
+ <font style="color:rgb(63, 65, 65);"></font>`**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">wrap_tool_call</font>**`<font style="color:rgb(63, 65, 65);"> - 在每个工具调用周围</font>

```python
from langchain.agents.middleware import AgentMiddleware, ModelRequest, ModelResponse
from langchain.chat_models import init_chat_model
from typing import Callable

class DynamicModelMiddleware(AgentMiddleware):
    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        # Use different model based on conversation length
        if len(request.messages) > 10:
            request.model = init_chat_model("gpt-4o")
        else:
            request.model = init_chat_model("gpt-4o-mini")

        return handler(request)
```

#### <font style="color:rgb(17, 24, 39);">Agent jumps  代理跳跃</font>
<font style="color:rgb(63, 65, 65);">启用跳转，用 </font>`**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">@hook_config(can_jump_to=[...])</font>**`<font style="color:rgb(63, 65, 65);">：装饰你的钩子</font>

+ `**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">"end"</font>**`<font style="color:rgb(63, 65, 65);"> : 跳转到 Agent 执行结束处</font>
+ <font style="color:rgb(63, 65, 65);"></font>`**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">"tools"</font>**`<font style="color:rgb(63, 65, 65);"> : 跳转到工具节点</font>
+ <font style="color:rgb(63, 65, 65);"></font>`**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">"model"</font>**`<font style="color:rgb(63, 65, 65);"> : 跳转到模型节点（或第一个 </font>`**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">before_model</font>**`<font style="color:rgb(63, 65, 65);"> 钩子）</font>

```python
from langchain.agents.middleware import AgentMiddleware, hook_config
from typing import Any

class ConditionalMiddleware(AgentMiddleware):
    @hook_config(can_jump_to=["end", "tools"])
    def after_model(self, state: AgentState, runtime) -> dict[str, Any] | None:
        if some_condition(state):
            return {"jump_to": "end"}
        return None
```

<font style="color:rgb(17, 24, 39);"></font>

## <font style="color:rgb(63, 65, 65);">中间件执行顺序</font>
+ <font style="color:rgb(63, 65, 65);"></font>`**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">before_*</font>**`<font style="color:rgb(63, 65, 65);"> 钩子：从第一个到最后一个</font>
+ <font style="color:rgb(63, 65, 65);"></font>`**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">after_*</font>**`<font style="color:rgb(63, 65, 65);"> 钩子：从最后一个到第一个（反向）</font>
+ <font style="color:rgb(63, 65, 65);"></font>`**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">wrap_*</font>**`<font style="color:rgb(63, 65, 65);"> 钩子：嵌套（第一个中间件包裹所有其他中间件）</font>

```python
agent = create_agent(
    model="gpt-4o",
    middleware=[middleware1, middleware2],
)
```

1. `**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">middleware1.before_agent()</font>**`
2. `**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">middleware2.before_agent()</font>**`
3. `**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">middleware1.before_model()</font>**`
4. `**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">middleware2.before_model()</font>**`
5. `**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">middleware1.wrap_model_call()</font>**`<font style="color:rgb(63, 65, 65);"> → </font>`**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">middleware2.wrap_model_call()</font>**`
6. `**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">middleware2.after_model()</font>**`
7. `**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">middleware1.after_model()</font>**`
8. `**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">middleware2.after_agent()</font>**`
9. `**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">middleware1.after_agent()</font>**`

<font style="color:rgb(63, 65, 65);"></font>

<font style="color:rgb(63, 65, 65);"></font>

<font style="color:rgb(63, 65, 65);"></font>

<font style="color:rgb(63, 65, 65);"></font>

# Agents
<!-- 这是一张图片，ocr 内容为： -->
![](https://cdn.nlark.com/yuque/0/2025/png/46998893/1762606820288-0fdb12ab-284b-4018-b6cd-23c64058890e.png)

<font style="color:rgb(63, 65, 65);">一个 LLM 智能体通过循环运行工具来实现目标。</font>

<font style="color:rgb(63, 65, 65);">智能体会一直运行，直到满足停止条件——即</font>**<font style="color:rgb(63, 65, 65);">模型输出最终结果</font>**<font style="color:rgb(63, 65, 65);">或</font>**<font style="color:rgb(63, 65, 65);">达到迭代限制</font>**<font style="color:rgb(63, 65, 65);">。</font>



## 创建 Agent
```python
import os
import dotenv
from langchain.agents import create_agent

def load():
    dotenv.load_dotenv()
    os.environ['OPENAI_API_KEY'] = os.getenv("OPENAI_API_KEY")
    os.environ['OPENAI_BASE_URL'] = os.getenv("BASE_URL")

load()
agent = create_agent("gpt-4o")
```

```python
import os
import dotenv
from langchain.agents import create_agent
from langchain_openai import ChatOpenAI

def init_env():
    dotenv.load_dotenv()
    os.environ['OPENAI_API_KEY'] = os.getenv("OPENAI_API_KEY")
    os.environ['OPENAI_BASE_URL'] = os.getenv("BASE_URL")

init_env()
model = ChatOpenAI(
    model="gpt-4o",
    temperature=0.1,
    max_tokens=1000,
    timeout=30
    # ... (other params)
)
agent = create_agent(model)
```

## Tool
**定义工具**

```python
import os

import dotenv
from langchain.agents import create_agent
from langchain_core.tools import tool

@tool
def search(query: str) -> str:
    """Search for information."""
    return f"Results for: {query}"

@tool
def get_weather(location: str) -> str:
    """Get weather information for a location."""
    return f"Weather in {location}: Sunny, 72°F"

def init_env():
    dotenv.load_dotenv()
    os.environ['OPENAI_API_KEY'] = os.getenv("OPENAI_API_KEY")
    os.environ['OPENAI_BASE_URL'] = os.getenv("BASE_URL")

init_env()
agent = create_agent(
    model="gpt-4o",
    tools=[search, get_weather] # Agent 可以调用的工具
)
```

**<font style="color:rgb(17, 24, 39);">工具错误处理</font>**



## **<font style="color:rgb(17, 24, 39);">System prompt</font>**
```python
import os

import dotenv
from langchain.agents import create_agent

def init_env():
    dotenv.load_dotenv()
    os.environ['OPENAI_API_KEY'] = os.getenv("OPENAI_API_KEY")
    os.environ['OPENAI_BASE_URL'] = os.getenv("BASE_URL")

init_env()
agent = create_agent(
    model='gpt-4o',
    system_prompt="You are a helpful assistant. Be concise and accurate." 
    # 等价于 SystemMessage
)
```



### **<font style="color:rgb(17, 24, 39);">Dynamic system prompt  动态系统提示</font>**




## <font style="color:rgb(63, 65, 65);">结构化输出</font>
**<font style="color:rgb(63, 65, 65);">ToolStrategy</font>**<font style="color:rgb(63, 65, 65);">：使用自定义的工具格式化输出，适用于任何支持工具调用的模型</font>

```python
import os
import dotenv
from langchain_core.tools import tool
from pydantic import BaseModel
from langchain.agents import create_agent
from langchain.agents.structured_output import ToolStrategy

def load():
    dotenv.load_dotenv()
    os.environ['OPENAI_API_KEY'] = os.getenv("OPENAI_API_KEY")
    os.environ['OPENAI_BASE_URL'] = os.getenv("BASE_URL")

class ContactInfo(BaseModel):
    name: str
    email: str
    phone: str

load()
agent = create_agent(
    model="gpt-4o-mini",
    response_format=ToolStrategy(ContactInfo)
)

result = agent.invoke({
    "messages": [{"role": "user", "content": "Extract contact info from: John Doe, john@example.com, (555) 123-4567"}]
})

print(result["structured_response"])
# name='John Doe' email='john@example.com' phone='(555) 123-4567'
```

<font style="color:rgb(17, 24, 39);"></font>

**<font style="color:rgb(17, 24, 39);">ProviderStrategy</font>**<font style="color:rgb(17, 24, 39);">：使用模型内置的策略结构化输出，只适用于支持原生结构化的大模型</font>

```python
import os
import dotenv
from langchain.agents import create_agent
from langchain.agents.structured_output import ProviderStrategy
from langchain_core.tools import tool
from pydantic import BaseModel

def load():
    dotenv.load_dotenv()
    os.environ['OPENAI_API_KEY'] = os.getenv("OPENAI_API_KEY")
    os.environ['OPENAI_BASE_URL'] = os.getenv("BASE_URL")

class ContactInfo(BaseModel):
    name: str
    email: str
    phone: str

load()
agent = create_agent(
    model="gpt-4o",
    response_format=ProviderStrategy(ContactInfo)
)

result = agent.invoke({
    "messages": [{"role": "user", "content": "Extract contact info from: John Doe, john@example.com, (555) 123-4567"}]
})

print(result["structured_response"])
```



## Memory




# <font style="color:rgb(24, 25, 25);">Retrieval  检索</font>
<!-- 这是一张图片，ocr 内容为： -->
![](https://cdn.nlark.com/yuque/0/2025/png/46998893/1762668578168-f29b8dd4-5284-4fe7-bb09-e1a65531475e.png)

检索流程：数据源 -> 加载到内存 -> 转换（文档拆分） -> 向量化 -> 存储到向量数据库



<!-- 这是一张图片，ocr 内容为： -->
![](https://cdn.nlark.com/yuque/0/2025/png/46998893/1762668605959-ab59b2e1-b551-4178-89df-da3078fa0c67.png)

用户提问：向量化用户的问题 -> 从向量库中找到语义最相近的 K 个片段



## 文档加载器 Document Loaders
作用：将磁盘/网络中的数据加载到内存

<font style="color:rgb(63, 65, 65);">所有文档加载器都实现了 </font>`**<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">BaseLoader</font>**`<font style="color:rgb(63, 65, 65);"> 接口，因此使用都是相同的。</font>

+ `load()`：一次性加载所有文档
+ `lazy_load()`：流式加载文档，用于处理大量数据

<font style="color:rgb(63, 65, 65);"></font>

<font style="color:rgb(63, 65, 65);">以 TextLoader 为例：</font>

```python
from langchain_community.document_loaders import TextLoader

text_loder = TextLoader(
    file_path='../../面试注意点.txt',
    encoding='utf-8'
)

docs = text_loder.load()
print(docs)

for document in text_loder.lazy_load():
    print(document)
```

常见文档加载器有：

+ Text、PDF、JSON、CSV、HTML、网页等



## 文本分割器 Text Splitters
作用：<font style="color:rgb(63, 65, 65);">将大文档拆分成小的片段，以便</font>**<font style="color:rgb(63, 65, 65);">单独检索</font>**<font style="color:rgb(63, 65, 65);">、适应模型上下文窗口的限制</font>

拆分文档策略：

+ 基于文本结构：<font style="color:rgb(63, 65, 65);">尝试保持较大的单元（例如，段落）完整，如果一个单元超过块大小，它将移动到下一级（例如，句子），如果需要，此过程将继续到单词级别</font>
+ 基于长度：<font style="color:rgb(63, 65, 65);">片段尺寸一致</font>
+ 基于文档结构：<font style="color:rgb(63, 65, 65);">某些文档具有固有的结构，例如 HTML、Markdown 或 JSON 文件，按照结构拆分</font>

<font style="color:rgb(63, 65, 65);"></font>

<font style="color:rgb(63, 65, 65);">常用方法：</font>

<!-- 这是一张图片，ocr 内容为： -->
![](https://cdn.nlark.com/yuque/0/2025/png/46998893/1762671782922-82916dff-229c-4b53-9816-b65e1c7190cf.png)

<font style="color:rgb(63, 65, 65);"></font>

**<font style="color:rgb(63, 65, 65);">CharacterTextSplitter：按照字符分割</font>**

```python
from langchain_text_splitters import CharacterTextSplitter

text = """LangChain 是一个用于开发由语言模型驱动的应用程序的框架的。它提供了一套工具和抽象，使开发者能够更容易地构建复杂的应用程序。"""

splitter = CharacterTextSplitter(
    chunk_size=50, # 每块大小
    chunk_overlap=5,# 块与块之间的重复字符数
    #length_function=len, # 片段长度计算方式
    separator="", # 分割使用的字符。 设置为空字符串时，表示禁用分隔符优先
    #keep_separator=True # chunk中是否保留切割符
)

texts = splitter.split_text(text)
for i, chunk in enumerate(texts):
    print(f"块 {i+1}:长度：{len(chunk)}")
    print(chunk)
    print("-" * 50)
# 块 1:长度：50
# LangChain 是一个用于开发由语言模型驱动的应用程序的框架的。它提供了一套工具和抽象，使开发者
# --------------------------------------------------
# 块 2:长度：21
# ，使开发者能够更容易地构建复杂的应用程序。
# --------------------------------------------------
```



**RecursiveCharacterTextSplitter：递归分割**

默认按照 `["\n\n", "\n", " ", ""]`，进行拆分，直至片段符合要求。

```python
from langchain_text_splitters import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=10,
    chunk_overlap=0,
    add_start_index=True, # document 中添加片段在整个文档的位置
    # separators=["\n\n", "\n", "。", "！", "？", "……", "，", ""], # 添加中文标点
)

text="LangChain框架特性\n\n多模型集成(GPT/Claude)\n记忆管理功能\n链式调用设计。文档分析场景示例：需要处理PDF/Word等格式。"
paragraphs = splitter.split_text(text)
for para in paragraphs:
    print(para)
    print('-------')
```



**TokenTextSplitter/CharacterTextSplitter：Split by tokens（按照 Token 分割）**

```python
from langchain_text_splitters import TokenTextSplitter

text_splitter = TokenTextSplitter(
    chunk_size=33, #最大 token 数为 32
    chunk_overlap=0, #重叠 token 数为 0
    encoding_name="cl100k_base", # 使用 OpenAI 的编码器,将文本转换为 token 序列
)

text = "人工智能是一个强大的开发框架。它支持多种语言模型和工具链。人工智能是指通过计算机程序模拟人类智能的一门科学。自20世纪50年代诞生以来，人工智能经历了多次起伏。"

texts = text_splitter.split_text(text)

print(f"原始文本被分割成了 {len(texts)} 个块:")
for i, chunk in enumerate(texts):
    print(f"块 {i+1}: 长度：{len(chunk)} 内容：{chunk}")
    print("-" * 50)
# 原始文本被分割成了 3 个块:
# 块 1: 长度：29 内容：人工智能是一个强大的开发框架。它支持多种语言模型和工具链。
# --------------------------------------------------
# 块 2: 长度：32 内容：人工智能是指通过计算机程序模拟人类智能的一门科学。自20世纪50
# --------------------------------------------------
# 块 3: 长度：19 内容：年代诞生以来，人工智能经历了多次起伏。
# --------------------------------------------------
```



```python
import tiktoken
from langchain_text_splitters import CharacterTextSplitter

text_splitter = CharacterTextSplitter.from_tiktoken_encoder(
    encoding_name="cl100k_base", # 使用 OpenAI 的编码器
    chunk_size=18,
    chunk_overlap=0,
    separator="。", # 指定中文句号为分隔符
    keep_separator=False, # chunk中是否保留分隔符
)
text = "人工智能是一个强大的开发框架。它支持多种语言模型和工具链。今天天气很好，想出去踏青。但是又比较懒不想出去，怎么办"
texts = text_splitter.split_text(text)
print(f"分割后的块数: {len(texts)}")
 
# tiktoken编码器（用于Token计数）
encoder = tiktoken.get_encoding("cl100k_base") # 确保与CharacterTextSplitter的encoding_name一致
for i, chunk in enumerate(texts):
    tokens = encoder.encode(chunk) # 现在encoder已定义
    print(f"块 {i + 1}: {len(tokens)} Token\n内容: {chunk}\n")
# 分割后的块数: 4
# 块 1: 17 Token
# 内容: 人工智能是一个强大的开发框架

# 块 2: 14 Token
# 内容: 它支持多种语言模型和工具链

# 块 3: 18 Token
# 内容: 今天天气很好，想出去踏青

# 块 4: 21 Token
# 内容: 但是又比较懒不想出去，怎么办
```





## 文档嵌入模型 Text Embedding Models
作用：

+ 向量化：将字符串转化为多个维度的向量
+ 相似度评分：通过某种指标判断相似度。如，欧氏距离、cos 值、点积（向量投影）

<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);"></font>

`<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">embed_query(str) -> list[float]</font>` ：向量化单个字符串。 返回向量化后的结果。

`<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">embed_documents(list[str]) -> list[list[float]]</font>`<font style="color:rgb(17, 24, 39);background-color:rgba(239, 241, 241, 0.5);">:向量化文档。 返回向量化后的结果。</font>

```python
import os
import dotenv
from langchain_openai import OpenAIEmbeddings

dotenv.load_dotenv()
os.environ['OPENAI_API_KEY'] = os.getenv("OPENAI_API_KEY")
os.environ['OPENAI_BASE_URL'] = os.getenv("BASE_URL")

# 向量模型
embedding = OpenAIEmbeddings(model="text-embedding-ada-002")
text = "What was the name mentioned in the conversation?"

# 进行向量化
embedded = embedding.embed_query(text)
print(embedded[:5])
```



```python
import os
import dotenv
from langchain_openai import OpenAIEmbeddings

dotenv.load_dotenv()
os.environ['OPENAI_API_KEY'] = os.getenv("OPENAI_API_KEY")
os.environ['OPENAI_BASE_URL'] = os.getenv("BASE_URL")

# 向量模型
embedding = OpenAIEmbeddings(model="text-embedding-ada-002")

texts = [
    "Hi there!",
    "Oh, hello!",
    "What's your name?",
    "My friends call me World",
    "Hello World!"
]

# 文本向量化
embeddings = embedding.embed_documents(texts)
for i in range(len(texts)):
    print(f"{texts[i]}:{embeddings[i][:3]}",end="\n\n")
```



## 向量存储 Vector Stores
向量存储：数据向量化后，存储到向量数据库

向量查询：查询时，向量化问题后，在向量库中查找与问题最相似的向量

<!-- 这是一张图片，ocr 内容为： -->
![](https://cdn.nlark.com/yuque/0/2025/png/46998893/1762674434107-12c39567-fb58-4802-b419-5af5839e48c6.png)

<font style="color:rgb(24, 25, 25);">Vector stores 接口提供统一的方法：</font>

+ `<font style="color:rgb(24, 25, 25);">add_documents()</font>`<font style="color:rgb(24, 25, 25);">：向向量库中添加文档。 返回文档的 ID</font>
+ `<font style="color:rgb(24, 25, 25);">delete()</font>`<font style="color:rgb(24, 25, 25);">：根据 ID 删除文档。 无返回值。</font>
+ `<font style="color:rgb(24, 25, 25);">similarity_search(query,k,filter)</font>`<font style="color:rgb(24, 25, 25);">：相似度搜索。</font>
    - <font style="color:rgb(24, 25, 25);">qurey：要搜索的句子</font>
    - <font style="color:rgb(24, 25, 25);">k：返回结果条数</font>
    - <font style="color:rgb(24, 25, 25);">filter：根据元数据过滤</font>



其他检索方式：

+ `similarity_search()`：常规地相似度搜索
+ `similarity_search_by_vector()`：根据向量搜索
+ `similarity_search_with_score()`：根据欧式距离搜索
+ `_similarity_search_with_relevance_scores()`：根据 cos 值搜索
+ `max_marginal_relevance_search()`：根据最大边际相关性（MMR）搜索



```python
import os

import dotenv
from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document
from langchain_core.vectorstores import InMemoryVectorStore
from langchain_openai import OpenAIEmbeddings

dotenv.load_dotenv()
os.environ['OPENAI_API_KEY'] = os.getenv("OPENAI_API_KEY")
os.environ['OPENAI_BASE_URL'] = os.getenv("BASE_URL")

# 向量模型
embedding = OpenAIEmbeddings(model="text-embedding-ada-002")

# 文档
raw_documents = [
    Document(
        page_content="葡萄是一种常见的水果，属于葡萄科葡萄属植物。它的果实呈圆形或椭圆形，颜色有绿色、紫色、红色等多种。葡萄富含维生素C和抗氧化物质，可以直接食用或酿造成葡萄酒。",
        metadata={"source": "水果", "type": "植物"}
    ),
    Document(
        page_content="白菜是十字花科蔬菜，原产于中国北方。它的叶片层层包裹形成紧密的球状，口感清脆微甜。白菜富含膳食纤维和维生素K，常用于制作泡菜、炒菜或煮汤。",
        metadata={"source": "蔬菜", "type": "植物"}
    ),
    Document(
        page_content="狗是人类最早驯化的动物之一，属于犬科。它们具有高度社会性，能理解人类情绪，常被用作宠物、导盲犬或警犬。不同品种的狗在体型、毛色和性格上有很大差异。",
        metadata={"source": "动物", "type": "哺乳动物"}
    ),Document(
        page_content="猫是小型肉食性哺乳动物，性格独立但也能与人类建立亲密关系。它们夜视能力极强，擅长捕猎老鼠。家猫的品种包括波斯猫、暹罗猫等，毛色和花纹多样。",
        metadata={"source": "动物", "type": "哺乳动物"}
    ),
    Document(
        page_content="人类是地球上最具智慧的生物，属于灵长目人科。现代人类（智人）拥有高度发达的大脑，创造了语言、工具和文明。人类的平均寿命约70-80年，分布在全球各地。",
        metadata={"source": "生物", "type": "灵长类"}
    ),
    Document(
        page_content="太阳是太阳系的中心恒星，直径约139万公里，主要由氢和氦组成。它通过核聚变反应产生能量，为地球提供光和热。太阳活动周期约为11年，会影响地球气候。",
        metadata={"source": "天文", "type": "恒星"}
    ),
    Document(
        page_content="长城是中国古代的军事防御工程，总长度超过2万公里。它始建于春秋战国时期，秦朝连接各段，明朝大规模重修。长城是世界文化遗产和人类建筑奇迹。",
        metadata={"source": "历史", "type": "建筑"}
    ),
    Document(
        page_content="量子力学是研究微观粒子运动规律的物理学分支。它提出了波粒二象性、测不准原理等概念，彻底改变了人类对物质世界的认知。量子计算机正是基于这一理论发展而来。",
        metadata={"source": "物理", "type": "科学"}
    ),
    Document(
        page_content="《红楼梦》是中国古典文学四大名著之一，作者曹雪芹。小说以贾、史、王、薛四大家族的兴衰为背景，描绘了贾宝玉与林黛玉的爱情悲剧，反映了封建社会的种种矛盾。",
        metadata={"source": "文学", "type": "小说"}
    ),
    Document(
        page_content="新冠病毒（SARS-CoV-2）是一种可引起呼吸道疾病的冠状病毒。它通过飞沫传播，主要症状包括发热、咳嗽、乏力。疫苗和戴口罩是有效的预防措施。",
        metadata={"source": "医学", "type": "病毒"}
    )
]

# 2 种初始化方式（构造函数、from_documents()）
vector_store = InMemoryVectorStore(embedding=embedding)

# vector_store = InMemoryVectorStore(embedding).from_documents(
#     embedding=embedding,
#     documents=raw_documents
# )

# 添加文档
vector_store.add_documents(documents=raw_documents)

# 根据 id 删除文档
# vector_store.delete(ids=[1,2])

# 相似度搜索
result = vector_store.similarity_search(
    query="蔬菜和水果",
    k=4,
    # filter={"source": "蔬菜"} 基于元数据的条件过滤
)

print(result)
```



[面试注意点.txt](https://www.yuque.com/attachments/yuque/0/2025/txt/46998893/1762675681432-cc035c11-b6d3-4d2b-b688-dc9e58de1beb.txt)

```python
import os

import dotenv
from langchain_community.document_loaders import TextLoader
from langchain_community.vectorstores import FAISS
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import CharacterTextSplitter

dotenv.load_dotenv()
os.environ['OPENAI_API_KEY'] = os.getenv("OPENAI_API_KEY")
os.environ['OPENAI_BASE_URL'] = os.getenv("BASE_URL")

# 向量模型
embedding = OpenAIEmbeddings(model="text-embedding-ada-002")

# 文档加载器
loader = TextLoader(file_path="../../面试注意点.txt",encoding="utf-8")
documents = loader.load()

# 文档分割器
text_splitter = CharacterTextSplitter(
    chunk_size=100,
    chunk_overlap=8
)
docs = text_splitter.split_documents(documents)

# 存储到DB
memory_db = FAISS.from_documents(docs,embedding)

# 从 DB 中查询
query = "分布式锁"
docs = memory_db.similarity_search(
    query,
  # k=3, # 返回的条数
  # filter={"source": "tweets"} # 过滤出 tweets 的数据
)

print(len(docs))
print(docs[0].page_content)
```





## 检索器(召回器) Retrievers
检索器不会存储数据，只检索数据。

注意：所有的向量数据库都可以创建检索器。

`db.as_retriever()`：获得 对应向量库的 检索器。 

+ 获得检索器时，可传入 `search_type`、`search_kwargs` 使用不同的检索策略。

`retriever.invoke()`：检索向量库。 返回相关文档列表

```python
import os

import dotenv
from langchain_core.documents import Document
from langchain_core.vectorstores import InMemoryVectorStore
from langchain_openai import OpenAIEmbeddings

dotenv.load_dotenv()
os.environ['OPENAI_API_KEY'] = os.getenv("OPENAI_API_KEY")
os.environ['OPENAI_BASE_URL'] = os.getenv("BASE_URL")

# 向量模型
embedding = OpenAIEmbeddings(model="text-embedding-ada-002")

# 文档
raw_documents = [
    Document(
        page_content="葡萄是一种常见的水果，属于葡萄科葡萄属植物。它的果实呈圆形或椭圆形，颜色有绿色、紫色、红色等多种。葡萄富含维生素C和抗氧化物质，可以直接食用或酿造成葡萄酒。",
        metadata={"source": "水果", "type": "植物"}
    ),
    Document(
        page_content="白菜是十字花科蔬菜，原产于中国北方。它的叶片层层包裹形成紧密的球状，口感清脆微甜。白菜富含膳食纤维和维生素K，常用于制作泡菜、炒菜或煮汤。",
        metadata={"source": "蔬菜", "type": "植物"}
    ),
    Document(
        page_content="狗是人类最早驯化的动物之一，属于犬科。它们具有高度社会性，能理解人类情绪，常被用作宠物、导盲犬或警犬。不同品种的狗在体型、毛色和性格上有很大差异。",
        metadata={"source": "动物", "type": "哺乳动物"}
    ),Document(
        page_content="猫是小型肉食性哺乳动物，性格独立但也能与人类建立亲密关系。它们夜视能力极强，擅长捕猎老鼠。家猫的品种包括波斯猫、暹罗猫等，毛色和花纹多样。",
        metadata={"source": "动物", "type": "哺乳动物"}
    ),
    Document(
        page_content="人类是地球上最具智慧的生物，属于灵长目人科。现代人类（智人）拥有高度发达的大脑，创造了语言、工具和文明。人类的平均寿命约70-80年，分布在全球各地。",
        metadata={"source": "生物", "type": "灵长类"}
    ),
    Document(
        page_content="太阳是太阳系的中心恒星，直径约139万公里，主要由氢和氦组成。它通过核聚变反应产生能量，为地球提供光和热。太阳活动周期约为11年，会影响地球气候。",
        metadata={"source": "天文", "type": "恒星"}
    ),
    Document(
        page_content="长城是中国古代的军事防御工程，总长度超过2万公里。它始建于春秋战国时期，秦朝连接各段，明朝大规模重修。长城是世界文化遗产和人类建筑奇迹。",
        metadata={"source": "历史", "type": "建筑"}
    ),
    Document(
        page_content="量子力学是研究微观粒子运动规律的物理学分支。它提出了波粒二象性、测不准原理等概念，彻底改变了人类对物质世界的认知。量子计算机正是基于这一理论发展而来。",
        metadata={"source": "物理", "type": "科学"}
    ),
    Document(
        page_content="《红楼梦》是中国古典文学四大名著之一，作者曹雪芹。小说以贾、史、王、薛四大家族的兴衰为背景，描绘了贾宝玉与林黛玉的爱情悲剧，反映了封建社会的种种矛盾。",
        metadata={"source": "文学", "type": "小说"}
    ),
    Document(
        page_content="新冠病毒（SARS-CoV-2）是一种可引起呼吸道疾病的冠状病毒。它通过飞沫传播，主要症状包括发热、咳嗽、乏力。疫苗和戴口罩是有效的预防措施。",
        metadata={"source": "医学", "type": "病毒"}
    )
]

vector_store = InMemoryVectorStore(embedding=embedding)

vector_store.add_documents(documents=raw_documents)

retriever = vector_store.as_retriever()

result = retriever.invoke("蔬菜和水果")

print(result)
```

