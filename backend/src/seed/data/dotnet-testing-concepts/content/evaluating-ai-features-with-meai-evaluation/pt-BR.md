---
version: 1.0
updatedAt: 2026-11-12
title: "Avaliando recursos de IA com Microsoft.Extensions.AI.Evaluation"
summary: Avalie respostas de um modelo com evaluators de relevância, coerência e groundedness usando o próprio Ollama como juiz, some evaluators determinísticos sem LLM, grave as respostas em cache para rodar offline no MSTest 4, gere o relatório HTML, escreva asserções com limiar contra o não determinismo e saiba o custo.
---
## Objective

Um teste unitário diz "para esta entrada, esta saída". Um recurso de IA não devolve a mesma saída duas vezes, e
"correto" é um julgamento: a resposta é relevante, respeita a política que recebeu, lê bem? Conferir isso com
`Assert.AreEqual` no texto erra nos dois sentidos: falha numa reescrita inofensiva e passa numa mentira fluente.
`Microsoft.Extensions.AI.Evaluation` é a biblioteca da Microsoft que transforma esses julgamentos em código de
teste: um `IEvaluator` dá nota a uma resposta, um modelo de linguagem pode ser o juiz, as respostas ficam em cache
para a execução ser repetível e os resultados viram relatório. O objetivo: avaliar uma resposta com evaluators de
relevância, coerência e groundedness usando um Ollama local como juiz, somar um evaluator determinístico que não
precisa de modelo, gravar as respostas uma vez e reproduzi-las offline numa execução comum do MSTest 4, gerar o
relatório, escrever asserções com limiar que sobrevivem ao não determinismo e saber o que o julgamento custa.
Versões medidas: `Microsoft.Extensions.AI.Evaluation`, `.Quality` e `.Reporting` 11.0.0 (a linha estável, publicada
em 2026-11-10), `Microsoft.Extensions.AI.Abstractions` 11.0.0, `OllamaSharp` 5.5.0, `MSTest` 4.5.3, Ollama com
`qwen3:4b-instruct` como assistente e como juiz, no SDK .NET 10.0.100 e no alvo `net10.0`.

## Use Cases

- Um recurso que chama um modelo (assistente de suporte, resumo, classificador) e precisa de um portão no pull
  request que seja mais que "devolveu alguma coisa".
- Mudar o prompt, o modelo ou a recuperação de um recurso de RAG e querer saber se as respostas melhoraram ou pioraram
  antes de publicar.
- Uma suíte que precisa rodar offline e do mesmo jeito em qualquer máquina, mesmo que o objeto do teste seja um modelo.
- Acompanhar a qualidade ao longo do tempo: os mesmos cenários, um relatório por execução.

## Deep Dive

### Uma resposta, três notas

O lab tem um `ReturnsAssistant` que responde perguntas sobre uma política de devolução por um `IChatClient`, com a
política no prompt de sistema e a regra "se a política não diz, responda exatamente `I don't know, please contact
support.`". Para avaliar, um `ReportingConfiguration` junta os evaluators, o modelo que julga e onde ficam resultados
e cache, e um `ScenarioRun` é uma pergunta avaliada:

```csharp
IChatClient ollama = new OllamaApiClient(new Uri("http://localhost:11434"), "qwen3:4b-instruct");

var configuration = new ReportingConfiguration(
    [new RelevanceEvaluator(), new CoherenceEvaluator(), new GroundednessEvaluator()],
    new DiskBasedResultStore("eval-results"),
    new ChatConfiguration(ollama),                    // o juiz
    new DiskBasedResponseCacheProvider("eval-cache", TimeSpan.FromDays(3650)),
    executionName: "lab");

await using var run = await configuration.CreateScenarioRunAsync("refund-window");
var assistant = new ReturnsAssistant(run.ChatConfiguration!.ChatClient);   // passa pelo cache
var response = await assistant.AskAsync("How long do I have to return a jacket?");

var result = await run.EvaluateAsync(
    new ChatMessage(ChatRole.User, "How long do I have to return a jacket?"), response,
    [new GroundednessEvaluatorContext(ReturnsAssistant.Policy)]);   // a verdade de referência para groundedness
```

`EvaluateAsync` é um método de extensão em `Microsoft.Extensions.AI.Evaluation.Reporting`. A resposta foi "You have
30 days from delivery to return an unused jacket for a full refund." e o resultado tem uma métrica por evaluator:

```text
Relevance     4  Good         "The response directly and accurately answers the query with a clear time frame ..."
Groundedness  5  Exceptional  "The response correctly and fully answers the query using only information from the context ..."
Coherence     4  Good         "... a clear, logical, and complete statement, making the message easy to understand ..."
```

Cada uma é uma `NumericMetric` numa escala de 1 a 5, lida com `result.Get<NumericMetric>(RelevanceEvaluator.RelevanceMetricName)`,
com um `Reason` escrito pelo juiz e uma `Interpretation` (classificação e um flag `Failed`). A métrica também carrega
`Diagnostics`: o raciocínio passo a passo do juiz chega como diagnósticos `Informational`, e um problema que o
evaluator não consegue contornar (um veredito que não consegue interpretar, por exemplo) deve chegar como `Error`.
Não vi nenhum `Error` nas execuções gravadas, mas o lab afirma que não há nenhum, porque um teste que só lê `Value`
pode ler um nulo e passar.

O `Quality` tem mais que esses três: Fluency, Completeness, Equivalence, Retrieval, IntentResolution, TaskAdherence,
ToolCallAccuracy e RelevanceTruthAndCompleteness estão no pacote 11.0.0. Rodei só os três primeiros. Os que comparam
com uma referência ou com os trechos recuperados recebem um `EvaluationContext`, como o de groundedness.

### O juiz é um modelo, e pode errar

O mesmo modelo do Ollama julgou oito respostas. A execução gravada:

| Cenário | Relevance | Groundedness | Coherence |
| --- | --- | --- | --- |
| refund-window | 4 | 5 | 4 |
| refund-time | 4 | 5 | 4 |
| shipping-defective | 2 | 3 | 3 |
| shipping-regular | 4 | 5 | 5 |
| sale-items | 4 | 5 | 4 |
| pitched-tent | 4 | 5 | 4 |
| gift-card | 4 | 5 | 3 |
| unknown (uma recusa correta) | 1 | 1 | 3 |

Duas linhas ensinam mais que o resto. `shipping-defective` é uma resposta real do modelo: "The customer pays for return
shipping if the item arrived broken. Wait, correction: Returns policy states that return shipping is free for
defective items. Therefore, Brightside Outdoor pays ...". O fato está lá, uma checagem por palavra-chave fica verde, e
o juiz deu 2 de relevância. E `unknown` é a resposta *certa*, e o juiz deu 1 e 1: uma recusa não diz nada sobre a
pergunta nem nada do contexto, que é o que essas duas métricas penalizam. Nota de qualidade não pode ser portão para
recusa.

O juiz também deixa passar coisa. Para "You have 60 days to return a jacket, and return shipping is always free." o
juiz de 4B deu groundedness 3 e relevância 4: percebeu, mas menos alto que uma pessoa. Para "Our tents are made of
ripstop nylon and weigh 2 kg." deu 1 e 1. Um juiz é tão bom quanto o modelo por trás dele, e um modelo local pequeno é
um primeiro filtro barato, não um oráculo.

### Evaluators que não precisam de modelo

Tudo no pacote `Quality` usa o modelo. Os determinísticos estão em outro lugar:

- `Microsoft.Extensions.AI.Evaluation.NLP` tem `BLEUEvaluator`, `GLEUEvaluator` e `F1Evaluator`: similaridade de texto
  com uma ou mais respostas de referência, por n-gramas, sem modelo e sem custo. O pacote ainda é preview
  (`11.0.0-preview.1.26560.3` na época), então fixe a versão e espere mudanças. Medido contra a referência
  "You can return an unused item within 30 days of delivery for a full refund.":

```text
same:       BLEU=1.000  GLEU=1.000  F1=1.000
paraphrase: BLEU=0.352  GLEU=0.431  F1=0.750   "You have 30 days from delivery to return an unused jacket ..."
one-word:   BLEU=0.815  GLEU=0.828  F1=0.938   a referência com "30" trocado por "60"
wrong:      BLEU=0.023  GLEU=0.086  F1=0.312   "You have 60 days to return a jacket, and return shipping is always free."
off-topic:  BLEU=0.017  GLEU=0.034  F1=0.143
```

  A paráfrase correta tira 0,35 de BLEU, e a referência com um número trocado (uma resposta errada) tira 0,82,
  classificada como `Exceptional`. Sobreposição com uma referência mede palavras, não verdade: use onde há uma
  referência estável (tradução, extração) e não para respostas abertas, e nunca sozinha.
- Seu próprio `IEvaluator`: um método e uma lista de nomes de métrica. O evaluator do lab confere se a resposta contém
  um fato, escrito como expressão regular, e devolve uma `BooleanMetric`:

```csharp
public sealed class ExpectedFactEvaluator : IEvaluator
{
    public IReadOnlyCollection<string> EvaluationMetricNames => ["Expected fact"];

    public ValueTask<EvaluationResult> EvaluateAsync(IEnumerable<ChatMessage> messages, ChatResponse modelResponse,
        ChatConfiguration? chatConfiguration = null, IEnumerable<EvaluationContext>? additionalContext = null,
        CancellationToken cancellationToken = default)
    {
        var expected = additionalContext!.OfType<ExpectedFactContext>().First();
        var found = Regex.IsMatch(modelResponse.Text, expected.Pattern, RegexOptions.IgnoreCase);
        var metric = new BooleanMetric("Expected fact", found);
        metric.Interpretation = new EvaluationMetricInterpretation(
            found ? EvaluationRating.Good : EvaluationRating.Unacceptable, failed: !found);
        return ValueTask.FromResult(new EvaluationResult(metric));
    }
}
```

  Ele aparece no mesmo resultado e no mesmo relatório das métricas julgadas. Não fez nenhuma chamada ao modelo na
  execução (os 8 cenários fizeram 4 turnos cada: a resposta e três chamadas do juiz). Também tem um ponto cego, a
  resposta que se contradiz acima, e por isso os dois tipos são usados juntos: a checagem de fato é barata e rígida
  no que conhece, o juiz é amplo e mole.

### O cache torna a execução repetível

O `DiskBasedResponseCacheProvider` guarda cada requisição e resposta do modelo em disco, em `eval-cache/<cenário>/<iteração>/<hash>/`.
O `ChatClient` de um `ScenarioRun` é um cliente de cache na frente do modelo: a chamada do assistente e todas as
chamadas do juiz passam por ele. Rode uma vez com o Ollama e o cache guarda 32 entradas (8 cenários, 4 chamadas cada).
Rode de novo com um cliente que não consegue chamar nada e toda requisição é um acerto:

```csharp
public sealed class ReplayOnlyChatClient : IChatClient   // GetResponseAsync lança "Cache miss ..."
{
    public object? GetService(Type serviceType, object? serviceKey = null) =>
        serviceType == typeof(ChatClientMetadata)
            ? new ChatClientMetadata("ollama", new Uri("http://localhost:11434"), "qwen3:4b-instruct") : null;
    // ...
}
```

A suíte de 24 testes rodou então em 179 ms com o Ollama parado, e o resultado armazenado de cada cenário mostra
`CacheHit: true` nos quatro turnos. Quatro coisas sobre a chave que verifiquei, porque cada uma é um jeito de um
build verde ficar vermelho sem motivo:

- A chave é um hash da requisição inteira. Trocar uma palavra do prompt de sistema (`three sentences` por `two`) fez
  toda requisição virar erro de cache; desfazer fez voltar a acertar.
- O id do modelo que o cliente informa por `ChatClientMetadata` faz parte da chave. O cliente de replay acima precisa
  informar o mesmo do cliente gravado, ou nada acerta.
- As entradas expiram. Sem tempo de vida, o `entry.json` mostrou uma `expiration` 14 dias depois da `creation`; um
  cache commitado no repositório e lido um mês depois está vazio. O lab passa `TimeSpan.FromDays(3650)`.
- O texto da requisição é a chave, então as quebras de linha deveriam contar (não testei um checkout com CRLF). Uma
  raw string literal usa as quebras de linha do arquivo-fonte, e por isso o lab normaliza o texto da política com `ReplaceLineEndings("\n")`.

Os tokens da gravação ficam no cache, então um resultado reproduzido ainda informa o que a chamada custou, com
`Latency` zero. A regra que decorre disso: o cache é uma fixture. Faça commit, trate regravar como um ato deliberado
(apague a pasta, rode com o Ollama, revise a diferença de notas) e deixe o build do pull request só reproduzir.

### O relatório

O `ReportingConfiguration` grava cada execução no result store como um arquivo JSON. Duas formas de ler isso como relatório:

```csharp
var results = new List<ScenarioRunResult>();
await foreach (var r in configuration.ResultStore.ReadResultsAsync(executionName: "report")) results.Add(r);
await new HtmlReportWriter("report.html").WriteReportAsync(results);
```

```bash
dotnet tool install Microsoft.Extensions.AI.Evaluation.Console --version 11.0.0
dotnet aieval report -p eval-results -o report.html          # -f json para JSON; -n limita as execuções
```

As duas funcionaram. O relatório dos oito cenários é um único arquivo HTML autocontido de cerca de 1 MB; tem as
respostas, cada métrica com seu motivo e os diagnósticos do juiz (achei o texto do raciocínio dentro dele). A
ferramenta também tem `clean-results` e `clean-cache` (apaga entradas expiradas). O `aieval` envia dados de uso
anônimos, a menos que `DOTNET_AIEVAL_TELEMETRY_OPTOUT=1`. A mesma família de pacotes tem
`Microsoft.Extensions.AI.Evaluation.Reporting.Azure` para guardar cache e resultados num container do Azure Storage;
não usado aqui.

### Limiares, porque a mesma resposta não tem sempre a mesma nota

Três fontes de variação, cada uma medida:

- **O juiz numa requisição idêntica.** Cinco chamadas para cada uma de quatro respostas (boa, errada, fora do
  assunto, recusa), em groundedness e relevância: a mesma nota 5 de 5 vezes. Com temperatura 0 o juiz é repetível para
  a mesma requisição, então para o juiz o cache serve mais a custo e a trabalhar offline do que a estabilidade.
- **O assistente.** A pergunta do item quebrado com temperatura 0,8: 2 respostas diferentes em 6 execuções, relevância
  3 ou 4. A pergunta da jaqueta: 1 resposta distinta em 6, relevância 4 todas as vezes. O lab fixa `Temperature = 0` e
  uma seed, e grava mesmo assim: seed fixa é uma promessa do provedor, não da próxima versão do modelo.
- **O modelo ou o prompt.** A fonte real. Troque qualquer um e as notas se mexem.

Então um portão diz "pelo menos", nunca "igual", e é escrito para o conjunto, não para cada nota. A biblioteca já tem
uma opinião: na execução gravada a interpretação marcou 4 e 5 como aprovados e 3 ("average") como `Failed`. O portão
do lab sobre oito cenários é: para cada cenário respondível, nenhum diagnóstico `Error` e uma nota não nula; para toda
checagem de fato, verdadeiro; no conjunto, relevância média de pelo menos 3,5, groundedness médio de pelo menos 4,0 e
no máximo uma resposta com relevância abaixo de 3. Com os números gravados (relevância 4, 4, 2, 4, 4, 4, 4: média
3,71) isso fica verde. "Toda nota pelo menos 4" fica vermelho por causa de `shipping-defective`, e um portão vermelho
por um motivo conhecido é um portão que o time aprende a ignorar. Uma recusa é conferida como texto:
`Assert.AreEqual(ReturnsAssistant.Unknown, answer)`.

Depois, o teste do teste. Um portão que nenhuma resposta consegue reprovar não vale nada, então o lab passa pelos
evaluators duas respostas ruins escritas à mão e afirma que as notas caem: o número errado reprova na checagem de fato
e recebe groundedness abaixo de 4; a fora do assunto recebe relevância no máximo 2. Essas são as asserções a revisar
quando o modelo juiz mudar.

### O que custa

Para os oito cenários os resultados armazenados somam 29.489 tokens de entrada e 6.977 de saída em 32 turnos de
modelo, cerca de 3,7 mil de entrada e 0,9 mil de saída por cenário, para respostas de 20 a 50 palavras. O juiz lê a
política e a resposta e raciocina em voz alta, três vezes; a resposta é 1 das 4 chamadas. Dinheiro: zero num Ollama
local, e gravar o conjunto levou cerca de 90 s num notebook. Contra um modelo hospedado, multiplique essas contagens
de tokens pelo preço desse modelo (não medido aqui), pelo número de cenários e pelo de execuções. As alavancas, em
ordem: reproduzir do cache em todo pull request e gravar só quando o prompt, o modelo ou os cenários mudam; manter
pequeno o conjunto julgado por modelo e pôr o volume nos evaluators determinísticos; rodar a varredura grande julgada
por modelo em agenda, não a cada commit.

### O que fica só na documentação

`Microsoft.Extensions.AI.Evaluation.Safety` (`ProtectedMaterialEvaluator`, `ContentHarmEvaluator` e os demais) ainda é
`-preview` (`11.0.0-preview.1.26560.3`) e, segundo a página do Microsoft Learn, usa o serviço Microsoft Foundry
Evaluation em vez do seu modelo. Precisa de um recurso do Azure, então nada disso foi executado aqui. Os evaluators do
`Quality` além de relevância, coerência e groundedness, o `Reporting.Azure` e a avaliação online (publicar notas em
telemetria) estão documentados mas também não foram executados. Para a metade de recuperação de um recurso de RAG,
veja o conjunto de regressão no concept de RAG da trilha `dotnet-ai-concepts` (taxas de acerto e fatos da resposta à
mão); os evaluators daqui são a metade julgada da mesma ideia.

## Trade-offs

- **Um juiz local pequeno é barato e mole.** Deu 3 e 4 a uma resposta com o número errado, e 1 a uma recusa correta.
  É um primeiro filtro. Para um portão em que se confia, junte checagens determinísticas e, no que importa, um juiz
  mais forte e um olhar humano no relatório.
- **Limiares escondem regressões pequenas.** Uma média de 3,7 absorve uma resposta ruim, por projeto. Mantenha rígidos
  a contagem de respostas fracas e as checagens determinísticas, e leia o relatório quando uma nota se mexer.
- **O cache congela o problema que você gravou.** Um replay verde prova que os testes e os limiares são consistentes
  com a gravação, não que o modelo de hoje se comporta. Regrave de propósito e agende uma execução ao vivo.
- **A chave do cache é frágil de propósito.** Uma palavra do prompt, o id do modelo, uma atualização da biblioteca que
  mude os prompts dos próprios evaluators e as quebras de linha, tudo isso erra o cache. Fixe as versões dos pacotes e
  espere regravar quando subir.
- **LLM como juiz tem viés.** Premia texto fluente, penaliza recusa, e a escala (1 a 5) é grossa: o passo de 4 para 5
  é um julgamento. Não compare notas entre modelos juízes.
- **Os evaluators de segurança estão fora do caminho gratuito.** Precisam do Azure, e são preview.

## Lab

`ReturnsAssistant` e um cache gravado com um Ollama local já estão no repositório. Sua tarefa é escrever os testes que seguram o recurso: limiares, a checagem determinística ao lado do juiz, respostas sabidamente ruins e as verificações de cache e relatório. Os testes passam sem Ollama; o README mostra como gravar de novo.

**O que você vai praticar**

- Ler `NumericMetric`, `BooleanMetric`, interpretações e diagnósticos de um `EvaluationResult`.
- Escrever asserções com limiar, um portão sobre o conjunto todo e uma checagem determinística para uma recusa.
- Provar que o portão consegue falhar com respostas ruins escritas à mão.
- Verificar que um replay nunca chama o modelo, que todo turno é um acerto de cache e que tokens e relatório são produzidos.

**Pré-requisitos:** MSTest 4 Fundamentals: Lifecycle and TestContext, Microsoft.Extensions.AI: IChatClient and the Middleware Pipeline, .NET 10 SDK.

**Como funciona:** o código de produção e as classes de apoio (`EvalSupport`, `ReplayOnlyChatClient`, `ExpectedFactEvaluator`, `EvalRunner`) estão prontos. Doze métodos de teste (24 testes) falham com `TODO-NN` até você escrevê-los, e a solução passa 24 de 24 em cerca de 180 ms, sem modelo.

## Documentation Links

- [The Microsoft.Extensions.AI.Evaluation libraries, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/evaluation/libraries) (doc)
- [Evaluate a model's response, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/evaluation/evaluate-ai-response) (doc)
- [Tutorial: evaluate a response with response caching and reporting, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/tutorials/evaluate-with-reporting) (doc)
- [Safety evaluations, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/evaluation/evaluate-safety) (doc)
- [Microsoft.Extensions.AI.Evaluation 11.0.0 on NuGet](https://www.nuget.org/packages/Microsoft.Extensions.AI.Evaluation/11.0.0) (doc)
- [Microsoft.Extensions.AI.Evaluation.Console 11.0.0 on NuGet](https://www.nuget.org/packages/Microsoft.Extensions.AI.Evaluation.Console/11.0.0) (doc)
