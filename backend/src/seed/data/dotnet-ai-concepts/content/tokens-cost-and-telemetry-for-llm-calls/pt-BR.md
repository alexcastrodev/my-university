---
version: 1.0
updatedAt: 2026-11-12
title: "Tokens, Custo e Telemetria de Chamadas a LLMs"
summary: UsageDetails no ChatResponse, contagem de tokens com Microsoft.ML.Tokenizers e a distância até a contagem do modelo, custo como cálculo em decimal com preços em configuração, UseOpenTelemetry com os nomes reais de métricas e spans gen_ai.*, o efeito de UseDistributedCache nos tokens medidos e custo, e os limites da janela de contexto com um Ollama local.
---
## Objective

Toda chamada a um modelo de linguagem é cobrada, limitada e retardada por
tokens, e o número que você calcula antes da chamada não é o que o modelo
informa depois. A lição mede os dois contra um Ollama local: `UsageDetails` no
`ChatResponse`, a contagem com `Microsoft.ML.Tokenizers` e a distância até a
contagem do próprio modelo, a conversão de tokens em dinheiro como cálculo em
`decimal` com preços em configuração, os spans e as métricas que
`UseOpenTelemetry` emite (com os nomes reais), o que `UseDistributedCache` faz
com os tokens que você mede e a janela de contexto. Versões:
`Microsoft.Extensions.AI` 10.11.0, `Microsoft.ML.Tokenizers` 3.0.0 com
`Microsoft.ML.Tokenizers.Data.O200kBase` 3.0.0, `OllamaSharp` 5.5.0, Ollama
0.40.13 com `qwen3:4b-instruct`, .NET 10. Os preços dos exemplos são números
redondos inventados, não a tabela de nenhum fornecedor.

## Use Cases

- Orçar e alertar tokens por funcionalidade, por usuário ou por modelo.
- Recusar ou aparar um prompt antes de ele chegar a um modelo que o rejeitaria.
- Um painel de latência e tokens alimentado por métricas padrão, sem log
  escrito à mão.
- Saber se um cache de respostas realmente economiza, sem contar duas vezes os
  tokens que ele poupou.

## Deep Dive

### O que o modelo informa: UsageDetails

`ChatResponse.Usage` é um `UsageDetails`: `InputTokenCount`, `OutputTokenCount`,
`TotalTokenCount`, `CachedInputTokenCount`, `ReasoningTokenCount` e um
dicionário `AdditionalCounts`, todos anuláveis. Três prompts no Ollama, opções
padrão:

```text
"Name the capital of France in one word."                    in=17  out=2    total=19
"Olá, tudo bem? Quanto custa uma chamada ao modelo?"          in=24  out=214  total=238
"public static int Sum(int a, int b) => a + b;"              in=23  out=401  total=424
AdditionalCounts = null nos três
```

As mesmas contagens voltaram em todas as execuções. O Ollama preenche entrada,
saída e total; as contagens de cache e de raciocínio ficam `null`, então quem
soma precisa tratar `null` como "não informado", não como zero tokens. Repare na
coluna de saída: um prompt curto pode gerar 400 tokens, e os provedores muitas
vezes cobram o token de saída acima do de entrada, então o tamanho da resposta,
não o da pergunta, pode dominar a conta. Em um stream o uso chega uma vez, como
item `UsageContent`, e `ToChatResponse()` o move para `Usage` (lição anterior).

### Contando antes de enviar: Microsoft.ML.Tokenizers

`TiktokenTokenizer` conta tokens localmente, sem modelo e sem rede:

```csharp
Tokenizer tok = TiktokenTokenizer.CreateForModel("gpt-4o");        // precisa de ...Data.O200kBase
int n = tok.CountTokens("Name the capital of France in one word.");
int cut = tok.GetIndexByTokenCount(text, 5, out _, out int count);  // índice do caractere após 5 tokens
```

```text
"Name the capital of France in one word."   tiktoken 9    Ollama in=17
"Olá, tudo bem? Quanto custa uma chamada…"  tiktoken 12   Ollama in=24
"public static int Sum(int a, int b) …"     tiktoken 15   Ollama in=23
400 palavras "word1 word2 ..."               tiktoken 800  Ollama in=1504
GetIndexByTokenCount(text, 5) = 14 -> "Olá, tudo bem?"     GetIndexByTokenCountFromEnd(text, 5) = 27
a mesma frase em português: o200k = 12 tokens, cl100k = 16 tokens
```

O tokenizer não é o do modelo: o `qwen3` tem vocabulário próprio e o Ollama ainda
conta o template de chat. Prompts minúsculos mostram o template: `"a"` e
`"Hello"` informaram `in=9` cada, `"Hello world"` `in=10`, e acrescentar a
mensagem de sistema "Be brief." (3 tokens no tiktoken) levou `"a"` de 9 para 17.
Cerca de 8 tokens de sobra por requisição mais cerca de 5 por mensagem extra, e
por cima disso a diferença de vocabulário: o texto de 400 palavras foi 1,9 vez
maior para o modelo. Outro vocabulário tiktoken também muda a conta (12 contra
16). Use o tokenizer para orçamento, margem e corte (`GetIndexByTokenCount`
corta o texto num limite de token); use `Usage` para a verdade depois da
chamada.

Os dados do vocabulário ficam em pacotes separados. Pedir o nome `gpt-4`
(cl100k) sem `Microsoft.ML.Tokenizers.Data.Cl100kBase` lançou
`InvalidOperationException: The tokenizer data file Microsoft.ML.Tokenizers.Data.Cl100kBase.dll
could not be loaded. Please reference the package Microsoft.ML.Tokenizers.Data.Cl100kBase in your project.`
O nome `gpt-4o` precisa do pacote `O200kBase` do mesmo modo.

### De tokens a dinheiro

Custo é aritmética sobre `UsageDetails`. Mantenha os preços fora do código: eles
mudam e variam por modelo:

```csharp
public sealed record ModelPrice(decimal InputPerMillionTokens, decimal OutputPerMillionTokens);

public static decimal Estimate(UsageDetails? u, ModelPrice p) =>
    u is null ? 0m
    : ((u.InputTokenCount ?? 0) * p.InputPerMillionTokens + (u.OutputTokenCount ?? 0) * p.OutputPerMillionTokens) / 1_000_000m;
```

Com um `ModelPrice(3m, 15m)` inventado, 1000 tokens de entrada e 500 de saída
custam `0.0105`; os testes do lab fixam esse valor. Use `decimal`: `double`
acumula erro binário em somas que precisam fechar com uma fatura. Ligue o
`ModelPrice` à configuração (um dicionário por id de modelo, casado com
`ChatResponse.ModelId`) e trate o resultado como estimativa: o provedor cobra
pelas regras dele, e este modelo no Ollama não custa dinheiro nenhum, então o
mesmo código ali precifica um modelo que você rodaria na nuvem, ou informa zero.

### O que UseOpenTelemetry emite

```csharp
IChatClient c = new ChatClientBuilder(ollama)
    .UseOpenTelemetry(sourceName: "lab.llm", configure: o => o.EnableSensitiveData = false)
    .Build();
```

O decorator cria um `ActivitySource` e um `Meter`, ambos com o nome de
`sourceName`. Sem um SDK do OpenTelemetry nada sai do processo, mas um
`MeterListener` e um `ActivityListener` enxergam tudo, que é como esta lição (e
o lab) leu os dados. Instrumentos do meter depois de uma chamada em stream e uma
sem stream:

```text
gen_ai.client.token.usage                    {token}   histogram   tags: gen_ai.token.type = input | output
gen_ai.client.operation.duration             s         histogram
gen_ai.client.operation.time_to_first_chunk  s         histogram   (só streaming)
gen_ai.client.operation.time_per_output_chunk s        histogram   (só streaming)
```

Chamada sem stream: `token.usage = 17` (`input`), `= 2` (`output`),
`operation.duration = 2.490` na primeira chamada da execução e entre 0,02 e 0,09
com o modelo aquecido. Toda medição leva as tags `gen_ai.operation.name=chat`,
`gen_ai.request.model`, `gen_ai.provider.name=ollama`, `server.address`,
`server.port` e `gen_ai.response.model`. Cada update do stream somou um
`time_per_output_chunk` de cerca de 0,01 s. O span:

```text
activity name = "chat qwen3:4b-instruct"   kind = Client
gen_ai.operation.name=chat  gen_ai.request.model=qwen3:4b-instruct  gen_ai.provider.name=ollama
server.address=localhost  server.port=11434  gen_ai.request.seed=42  gen_ai.request.temperature=0
gen_ai.response.finish_reasons=["stop"]  gen_ai.response.id=...  gen_ai.response.model=qwen3:4b-instruct
gen_ai.usage.input_tokens=17  gen_ai.usage.output_tokens=2
```

Um span de streaming acrescenta `gen_ai.request.stream=True` e
`gen_ai.response.time_to_first_chunk`. Uma falha (porta 11999 fechada) pôs o
status em `Error` com a descrição `Connection refused (localhost:11999)`, a tag
`error.type=System.Net.Http.HttpRequestException`, e registrou a
`operation.duration` com a mesma tag `error.type`. O `HttpClient` por baixo tem
o próprio span `System.Net.Http` e a métrica `http.client.request.duration`,
outra camada.

Prompts e respostas não são gravados por padrão. Com `EnableSensitiveData = true`
o span passou a levar `gen_ai.input.messages` e `gen_ai.output.messages` em
JSON e, nesta execução, as propriedades extras da resposta do provedor
(`load_duration`, `total_duration`, `prompt_eval_duration`, `eval_duration`)
como tags. Trate isso como dado pessoal: prompts contêm o que o usuário digitou.
Para exportar os dados, registre os nomes num SDK do OpenTelemetry
(`AddSource("lab.llm")` e `AddMeter("lab.llm")`, conforme a documentação do
OpenTelemetry para .NET; não executado aqui). Os nomes seguem as convenções
semânticas GenAI do OpenTelemetry, para as quais a documentação da extensão
aponta.

### O cache, e de quem são os tokens que você conta

`UseDistributedCache` devolve a resposta guardada para uma requisição idêntica,
e a resposta guardada continua com seu `Usage`. Cinco chamadas idênticas
passando por ele chegaram ao modelo uma vez:

```text
chamadas ao modelo = 1
soma ingênua de response.Usage:  in = 85, out = 10  -> 0.000405 com ModelPrice(3, 15)
tokens realmente gastos:         in = 17, out = 2   -> 0.000081
```

Qualquer coisa que some `response.Usage` fora do cache superestima o custo em
cinco vezes aqui. A telemetria tem a mesma armadilha, e a posição das camadas
decide. Com `UseOpenTelemetry` fora do cache, o hit emitiu de novo `token.usage`
17 e 2 (e um span, com `operation.duration` de 0,002 s contra 0,087 s do miss):
2 spans e 4 medições de tokens para 1 chamada ao modelo. Com o cache por fora e
`UseOpenTelemetry` por dentro, foi 1 span e 2 medições. Regra: a camada que
conta o que o usuário pediu fica fora do cache, a que conta o que foi pago fica
dentro. O lab monta `cache -> OpenTelemetry -> UsageMeter -> modelo`, então um
hit não chega ao medidor nem às métricas, e ainda assim devolve um `Usage`.

### A janela de contexto

Dois números importam: o máximo do modelo (`/api/show` informou
`qwen3.context_length = 262144`) e o contexto que o servidor aloca, que aqui
veio com 4096 tokens por padrão. Um prompt de 60905 tokens falhou:

```text
OllamaSharp.Models.Exceptions.OllamaException: request (60905 tokens) exceeds the available context size (4096 tokens), try increasing it
```

O contexto guarda o prompt e a resposta, então o orçamento é a janela menos o
espaço reservado para a saída. `num_ctx` é uma opção do Ollama, alcançada pela
requisição bruta (`ChatOptions.RawRepresentationFactory`, devolvendo um
`ChatRequest` do OllamaSharp com `Options = new RequestOptions { NumCtx = ... }`).
Um prompt que o modelo contou como 1504 tokens falhou com `num_ctx` 512 e 1024
com a mesma mensagem, e rodou com 2048 e 4096 (`in=1504 out=5 finish=length`
com `MaxOutputTokens = 5`). Aqui o servidor recusou; a lição de embeddings achou
truncamento silencioso em outro caminho, então confira o que o seu provedor faz.
Um `ContextGuard` baseado no tokenizer, como o do lab, descarta as mensagens
não-sistema mais antigas até a estimativa caber, e com os 8 mais 5 tokens de
sobra do template acima ele precisa manter margem. Cada turno de um chat sem
estado reenvia o histórico inteiro, e as definições de ferramentas vão em toda
requisição (lição de tool calling): os dois comem a mesma janela.

## Trade-offs

- **Estimar antes, saber depois.** Um tokenizer local dá um orçamento, nunca a
  contagem exata de um modelo de outro fornecedor. Mantenha margem e deixe o
  `Usage` corrigir a contabilidade.
- **A posição do medidor decide os números.** O mesmo cache gerou 1 ou 2 spans
  para uma chamada ao modelo conforme a ordem das camadas. Decida se o número
  significa "pedido" ou "pago".
- **Dado sensível na telemetria.** A captura de prompt e resposta vem desligada
  por um motivo. Se ligar, ponha atrás de flag, com amostragem e regra de
  retenção.
- **Preço envelhece.** Preços pertencem à configuração, com data. Uma taxa fixa
  no código vira um relatório silenciosamente errado.
- **Token em cache não é token grátis na contabilidade.** Hits de cache mantêm o
  `Usage`. Subtraia-os, ou meça abaixo do cache.
- **Antes versus hoje.** As convenções semânticas GenAI ainda evoluem, então
  nomes de tags e de instrumentos podem mudar entre versões do pacote. Fixe a
  versão do `Microsoft.Extensions.AI` e reconfira os nomes ao atualizar.

## Documentation Links

- [Use the IChatClient interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/ichatclient) (doc)
- [UsageDetails class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.extensions.ai.usagedetails) (doc)
- [Understanding tokens, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/conceptual/understanding-tokens) (doc)
- [Microsoft.ML.Tokenizers, NuGet](https://www.nuget.org/packages/Microsoft.ML.Tokenizers) (doc)
- [Semantic conventions for generative AI metrics, OpenTelemetry](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/) (doc)
- [Semantic conventions for generative AI spans, OpenTelemetry](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/) (doc)
- [Collect metrics, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/metrics-collection) (doc)
- [Context length, Ollama docs](https://docs.ollama.com/context-length) (doc)
