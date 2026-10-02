---
version: 1.0
updatedAt: 2026-08-20
title: "Coleções de Séries Temporais no MongoDB: Buckets, Granularidade e o Que Você Abre Mão"
summary: Uma coleção de séries temporais é um tipo de coleção do MongoDB 5.0 que transforma um documento por leitura em buckets colunares comprimidos, indexados por um metaField imutável mais uma janela de tempo arredondada. Ela traz ganhos reais de armazenamento e de consulta para dados de medição append-only ao custo de uma lista longa e específica de restrições: updates só no metaField, sem índices únicos ou de texto, sem change streams, sem escritas em transações e uma escolha de metaField que não pode ser mudada depois.
---
## Objective

Entender o que o MongoDB realmente faz quando você passa `timeseries: { timeField, metaField, granularity }` para `createCollection` (ele entrega uma view gravável e não materializada sobre uma coleção interna que agrupa muitas medições em buckets colunares comprimidos, indexados por `metaField` mais uma janela de tempo arredondada) e saber exatamente de quais comportamentos normais do MongoDB você abre mão em troca, porque a lista é longa e específica.

Este é um **recurso do MongoDB 5.0 (2021)**. A terceira edição do livro que serve de fonte para o restante deste lote de MongoDB é anterior a ele: as notas de versão mais recentes do livro param no MongoDB 4.2, então aqui não existe "o que o livro dizia" para contrastar. Toda afirmação abaixo foi conferida no manual atual do MongoDB, e os detalhes que dependem de versão importam mais que o normal: `bucketMaxSpanSeconds`/`bucketRoundingSeconds` chegaram na 6.3, o índice automático `metaField`+`timeField` chegou na 6.3, `$out` para uma coleção de séries temporais chegou na 7.0, o resharding chegou na 8.0.10 e a 8.3 endureceu as regras de `_id` e `timeField`.

## Use Cases

- **Telemetria de IoT / sensores**: milhares de dispositivos, cada um emitindo uma leitura em intervalo fixo, em que o `metaField` é a identidade do dispositivo e as métricas são as leituras. A própria tabela de casos de uso do MongoDB lista exatamente isso: "Dados de sensores (por exemplo, dispositivos de casa inteligente ou logística de frotas)."
- **Ticks financeiros e dados de mercado**: a documentação lista "Negociação de alta frequência", "Análise quantitativa financeira" e "Dados do mercado de ações", e os exemplos de agregação do manual rodam sobre uma coleção `dowJonesTickerData`, calculando o fechamento médio por mês com `$dateTrunc` e uma média móvel de 30 dias com `$setWindowFields`.
- **Monitoramento de infraestrutura e de aplicações**: a linha de DevOps da documentação é "Logging de aplicações; monitoramento de infraestrutura e de rede": séries append-only de alto volume em que você quase nunca atualiza um ponto passado e quase sempre consulta uma janela de tempo de uma única fonte.
- **Qualquer carga em que dados antigos devem simplesmente evaporar**: defina `expireAfterSeconds` na criação (ou depois, via `collMod`) e o MongoDB descarta buckets inteiros quando todos os documentos deles expiram, o que é muito mais barato que apagar documentos individuais de uma coleção comum.
- **Varejo/estoque e histórico de preços**: "Análise de transações, vendas e preços; gestão de estoque", segundo a tabela da documentação.
- **Quando *não* usar uma**, dito com todas as letras pelo manual: "Coleções de séries temporais não são indicadas para os seguintes tipos de dados: dados não ordenados; dados que não dependem do tempo." Se updates em pontos existentes forem rotina, ou se não houver uma identidade natural de série, uma coleção comum é o formato certo.

## Deep Dive

### O formato dos dados e os quatro nomes que o MongoDB usa

O manual decompõe dados de séries temporais em quatro partes, e os nomes dos parâmetros vêm diretamente delas:

- **Tempo**: "Indica quando o ponto de dado foi registrado." É o `timeField`, e seu valor "deve ser uma data BSON válida."
- **Metadados**: "Um rótulo ou tag que identifica uma série de dados e raramente muda. Os metadados ficam em um `metaField`. Metadados também são conhecidos como `source`."
- **Métricas**: "Pontos de dados individuais acompanhados em incrementos de tempo... Métricas também são conhecidas como valores."
- **Medições**: "Documentos que contêm dados de todas as métricas em um ponto específico no tempo. Uma medição inclui o tempo, os metadados e todas as métricas registradas naquele momento."

Então um documento inserido é uma medição, e a documentação é explícita sobre isso na página de insert: "Cada documento que você insere deve conter uma única medição." Você *não* deve montar o bucket à mão: esse é o trabalho do servidor, e é justamente o objetivo do recurso.

### Declarando uma

```js
db.createCollection(
  "weather",
  {
    timeseries: {
      timeField: "time",
      metaField: "sensor",
      granularity: "seconds"
    },
    expireAfterSeconds: 86400
  }
)
```

A referência de campos, literal no essencial:

| Campo | Obrigatório | O que o manual diz |
|---|---|---|
| `timeseries.timeField` | **Sim** | "O nome do campo que contém a data em cada documento de série temporal." Deve ser uma data BSON. |
| `timeseries.metaField` | Não | "Os metadados no campo especificado devem ser dados usados para rotular uma série única de documentos. Os metadados devem mudar raramente, se é que mudam." Não pode ser `_id` nem igual ao `timeField`; qualquer tipo de dado. "Se você não fornecer um valor para este campo, os dados são agrupados apenas com base no tempo." |
| `timeseries.granularity` | Não | `seconds` (padrão), `minutes`, `hours`. "Defina `granularity` com o valor que mais se aproxima do tempo entre timestamps consecutivos recebidos." |
| `timeseries.bucketMaxSpanSeconds` | Não | "Define o tempo máximo entre timestamps no mesmo bucket. Valores possíveis vão de 1 a 31536000." **Novo na 6.3.** |
| `timeseries.bucketRoundingSeconds` | Não | "Deve ser igual a `bucketMaxSpanSeconds`. Quando um documento exige um novo bucket, o MongoDB arredonda para baixo o timestamp do documento por esse intervalo para definir o tempo mínimo do bucket." **Novo na 6.3.** |
| `expireAfterSeconds` | Não | TTL: "o número de segundos depois do qual os documentos expiram." |

Os dois estilos de bucketing são mutuamente exclusivos: o manual os chama de **bucketing manual** (`granularity`) e **bucketing por intervalo** (`bucketMaxSpanSeconds` + `bucketRoundingSeconds`), e se você definir um dos dois parâmetros personalizados precisa definir o outro com o mesmo valor. Criar uma coleção de séries temporais exige `featureCompatibilityVersion` 5.0 ou maior.

`timeField` e `metaField` ficam congelados na criação. Você não pode redefinir depois qual campo é o `metaField` ("se você criar documentos de série temporal com o `metaField` definido como o campo `A`, não pode depois converter um campo `B` no `metaField`", embora, se `A` for um objeto, você possa acrescentar subcampos a ele), e não pode converter uma coleção comum em coleção de séries temporais nem o contrário. Errar aqui significa uma migração de dados, não um `collMod`.

### O que realmente fica no disco: buckets, não documentos

"O MongoDB trata coleções de séries temporais como **views** graváveis e não materializadas, apoiadas por uma coleção interna. Quando você insere dados, a coleção interna organiza automaticamente os dados de séries temporais em um formato de armazenamento otimizado." Esse formato é colunar: "O MongoDB usa um formato colunar especializado que agrupa os documentos de cada série temporal."

O agrupamento acontece sob duas condições, ambas obrigatórias:

- **Um valor de `metaField` idêntico.** "Se um `metaField` for um objeto ou array, o MongoDB só agrupa se todos os campos do objeto ou elementos do array coincidirem."
- **Valores de `timeField` próximos entre si**, em que "próximo" é definido pela `granularity` ou pelos parâmetros de bucketing personalizados.

O próprio exemplo do manual deixa a regra concreta. Com `granularity: "seconds"`, um bucket contendo `sensorA` em `2024-08-01T18:23:21Z` cobre de `18:00:00Z` a `18:59:59Z`; outra leitura de `sensorA` só entra nesse bucket se cair dentro dessa janela, e "um documento recebido com `metaField` igual a `sensorB` vai para um bucket separado, independentemente do tempo." Com bucketing por intervalo e `bucketRoundingSeconds: 14400`, um documento com timestamp `2023-03-27T16:24:35Z` abre um bucket com tempo mínimo `2023-03-27T16:00:00Z` e máximo `2023-03-27T19:59:59Z`: o timestamp arredondado *para baixo* até o intervalo.

A granularidade não é um ajuste livre. Ela corresponde a uma duração fixa de bucket:

| `granularity` | Intervalo máximo de tempo em um bucket |
|---|---|
| `seconds` (padrão) | 1 hora |
| `minutes` | 24 horas |
| `hours` | 30 dias |

E a orientação para escolhê-la corta para os dois lados: "Definir a `granularity` como `hours` agrupa até um mês de eventos de ingestão em um único bucket, resultando em tempos de travessia maiores e consultas mais lentas. Defini-la como `seconds` gera vários buckets por intervalo de coleta, muitos dos quais podem conter um único documento." A documentação sugere também alinhá-la ao formato das consultas: se você busca um dia por vez, `minutes` é o certo, porque `seconds` precisa de muitos buckets por dia e `hours` faz toda consulta puxar 30 dias e descartar a maior parte.

É uma catraca de mão única: você pode *aumentar* o intervalo coberto por um bucket via `collMod`, nunca diminuir. E o aumento vale só daqui para frente: "Isso atualiza a definição da view da coleção, mas não muda como os dados estão armazenados nos buckets existentes."

### O bucket catalog e o que fecha um bucket

Buckets abertos ficam em "um cache especializado em memória no WiredTiger" chamado **bucket catalog**, que "acompanha os buckets para minimizar a latência e coordenar escritas concorrentes" e guarda, para cada bucket aberto, o `metaField`, os escritores ativos, o intervalo de tempo coberto, a contagem de documentos, o tamanho e as operações recentes. Como os buckets são por `metaField`, normalmente muitos ficam abertos ao mesmo tempo.

O MongoDB fecha um bucket quando qualquer uma destas coisas acontece:

- Um timestamp recebido cai fora dos limites do bucket (para frente *ou* para trás).
- O bucket atinge o limite de documentos (**padrão de 1000**).
- Ele excede seu limite de tamanho de armazenamento: tamanho acima do máximo permitido (**padrão de 125 KiB**); ou menos que um número mínimo de documentos (**padrão de 10**) com tamanho abaixo de 12 MiB, "um limite interno fixo que otimiza o desempenho quando os dados consistem em menos documentos, porém maiores"; ou o conjunto de buckets ativos não cabe mais no cache do storage engine.
- O bucket catalog excede sua alocação total de memória: "por padrão, 2,5% da memória disponível do sistema."
- Uma operação conflitante, como uma migração de chunk ou um update, muda o estado de um bucket no disco.
- O `mongod` reinicia, o que "fecha todos os buckets e reinicia o bucket catalog."

A página de limitações declara o teto independentemente da configuração: "Para qualquer configuração dos parâmetros de granularidade, o tamanho máximo de um bucket é 1000 medições ou 125KB de dados, o que for menor. O MongoDB também pode impor um tamanho máximo menor para dados de alta cardinalidade com muitos valores únicos, para que o working set de buckets caiba no cache do WiredTiger."

### Por que a escolha do `metaField` é o jogo inteiro

Como o agrupamento exige igualdade exata de `metaField`, **o número de buckets acompanha o número de valores distintos de `metaField`**. A documentação é direta sobre o modo de falha: "Coleções com valores de `metaField` muito granulares ou dinâmicos podem gerar mais buckets, pouco preenchidos e de vida curta... Valores de `metaField` granulares e dinâmicos normalmente diminuem a eficiência de armazenamento e de consulta." Coloque um timestamp, um request id ou uma leitura que muda rápido dentro do `metaField` e você terá construído uma coleção de buckets de um documento só: todas as restrições, nenhuma compressão.

As boas práticas declaradas: escolha campos que mudam raramente ou nunca; prefira identificadores e outros valores estáveis que aparecem em expressões de filtro; e "evite escolher como parte do seu metaField campos que não são usados para filtrar. Em vez disso, use esses campos como medições." Arrays são apontados como arriscados: "usar um array como `metaField` pode causar comportamento inesperado na coleção, porque a igualdade de arrays depende da ordem específica."

Há uma consequência sutil da representação interna nas consultas: "O MongoDB reordena o `metaField` de coleções de séries temporais, o que pode fazer os servidores armazenarem dados em uma ordem de campos diferente da das aplicações." Então, quando o `metaField` for um objeto, consulte seus **subcampos escalares** (`{"metaField.sensorId": 5578, "metaField.type": "temperature"}`) em vez de comparar o objeto inteiro, o que "pode produzir resultados inconsistentes."

### Índices e consultas

Consultar é deliberadamente comum: "Você consulta uma coleção de séries temporais do mesmo jeito que consulta uma coleção padrão do MongoDB", com `find`, `findOne`, `aggregate`, tudo normal. É na indexação que as diferenças aparecem.

- **Índice automático**: "A partir do MongoDB 6.3: se você criar uma nova coleção de séries temporais, o MongoDB também gera um índice composto nos campos metaField e timeField", e ele "também usa o formato de armazenamento otimizado."
- **Sem índice em `_id`**: "O MongoDB não cria um índice no campo `_id` quando você cria uma coleção de séries temporais. Isso é diferente das coleções comuns." Por consequência, "os documentos não precisam de um campo `_id` único." Um `hint` em `_id` dá erro a menos que você mesmo crie esse índice, e a partir da **8.3** criar um índice chamado `"_id_"` ou usar o hint `"_id_"` retorna erro direto.
- **Tipos parcialmente suportados**: índices multikey, 2d e sparse só são permitidos **no `metaField`**.
- **Tipos não suportados**: índices de texto e **índices únicos**. Não há como garantir unicidade em uma coleção de séries temporais.
- **Datas estendidas**: se os timestamps caírem antes de `1970-01-01T00:00:00.000Z` ou depois de `2038-01-19T03:14:07.000Z`, "crie um índice no `timeField` para otimizar as consultas."

Estratégia de índices segundo a documentação: "Use o índice do metaField para filtragem e igualdade. Use o timeField e outros campos indexados para consultas por faixa." É a ordenação ESR do conceito de indexação, especializada para esse formato: igualdade na identidade da série, faixa no tempo.

Para análise, o manual destaca `$dateAdd`, `$dateDiff`, `$dateTrunc` e `$setWindowFields` como os operadores "frequentemente usados para analisar dados de séries temporais": window functions e truncamento de datas são a verdadeira superfície analítica, não uma sintaxe de consulta nova específica para séries temporais.

Duas pegadinhas do lado das consultas. `distinct` está fora: "Devido à estrutura de dados única das coleções de séries temporais, o MongoDB não consegue indexá-las de forma eficiente para valores distintos. Evite usar o comando `distinct`"; use uma agregação com `$group` no lugar. E o suporte geoespacial é estreito: só o estágio de agregação `$geoNear` sobre índices 2dsphere, sem `$near`/`$nearSphere`, sem campo `query` no `$geoNear`, e `key` é obrigatório.

### Escritas: inserts são o caminho feliz, updates não

As boas práticas de insert decorrem do modelo de buckets. Use um `insertMany()` em vez de muitas chamadas `insertOne()`; "se possível, insira dados com valores idênticos de `metaField` nos mesmos lotes"; e defina `ordered: false`. O retorno que a documentação descreve: um lote de seis documentos ordenado por sensor, com dois sensores, "custa apenas dois inserts (um por valor de `metaField`), porque os documentos estão ordenados por sensor."

A compressão é sensível ao formato dos documentos, de jeitos que não importariam nada em uma coleção comum:

- **Ordem de campos consistente** melhora o desempenho de insert e de compressão, e "a compressão exige ordem consistente dos campos aninhados." Dois documentos com os mesmos campos em ordens diferentes não comprimem tão bem.
- **Omita objetos, arrays e strings vazios.** Um `coordinates: []` entre dois arrays `coordinates` preenchidos "resulta em uma mudança de schema para o compressor. A mudança de schema faz com que o segundo e o terceiro documentos da sequência fiquem sem compressão." Deixar o campo de fora evita isso.
- **Arredonde dados numéricos** para a precisão de que a aplicação precisa: "Arredondar dados numéricos para menos casas decimais melhora a taxa de compressão."
- Campos aninhados não são problema: "O MongoDB usa compressão de coluna em cada campo aninhado individualmente, o que oferece a mesma qualidade de compressão que achatar os campos no nível superior." Só achate se a alta cardinalidade tornar isso mensuravelmente necessário.

Updates são a borda afiada. A página de limitações exige que todo comando de update satisfaça *todas* estas condições:

- "Você só pode fazer match no valor do campo `metaField`."
- "Você só pode modificar o valor do campo `metaField`."
- "Seu documento de update só pode conter expressões de operadores de update."
- Ele "não pode limitar o número de documentos a atualizar. Defina `multi: true` ou use o método `updateMany()`."
- Ele "não pode definir `upsert: true`."

Em outras palavras, uma medição registrada é, na prática, imutável: você pode renomear uma série, não corrigir uma leitura. O aviso do manual na página de visão geral diz o mesmo de forma mais direta: "Expressões de match em comandos de update só podem especificar o metaField. Você não pode atualizar outros campos em um documento de série temporal."

Deletes existem, mas não são o mecanismo de retenção pretendido. A página de bucketing lista duas formas de um bucket ser apagado: expiração por TTL, e "um comando `delete` ou `db.collection.deleteMany()` apagar o último documento do bucket." Para envelhecer o histórico, a documentação aponta para o TTL: "Para apagar dados antigos automaticamente, configure a remoção automática (TTL)."

E você não pode escrever em uma coleção de séries temporais dentro de uma transação: "O MongoDB suporta leituras de coleções de séries temporais em transações"; escritas estão fora.

### A semântica de TTL é diferente da de um índice TTL normal

`expireAfterSeconds` é definido na coleção, não por um índice TTL, e o limite é "o valor do campo `timeField` mais o número de segundos especificado." Altere ou desligue com `collMod` (`expireAfterSeconds: "off"`). O tempo é mais grosseiro do que a maioria espera, e a documentação explica por quê: a remoção é por bucket, então "quando todos os documentos de um bucket expiram, a tarefa em segundo plano que remove buckets expirados remove o bucket na próxima execução", e "a tarefa em segundo plano que remove buckets expirados roda a cada 60 segundos." Com `granularity: "hours"` um bucket pode cobrir 30 dias, então a medição mais nova de um bucket segura a remoção de todas as medições mais antigas dele. "Dados expirados podem continuar existindo por algum tempo além do período de 60 segundos."

### A lista completa do que não funciona

Direto da página de limitações, o MongoDB não suporta isto com coleções de séries temporais:

MongoDB Search (Atlas Search) · change streams · Client-Side Field Level Encryption · triggers de banco do Atlas · regras de validação de schema · `reIndex` · `renameCollection`. Como change streams não são suportados, uma coleção de séries temporais também não pode ser fonte para o Atlas Stream Processing.

Some-se a isso: `$merge` não consegue escrever *em* uma coleção de séries temporais (use `$out`, suportado para isso desde a **7.0**; `$merge` pode mover dados *para fora* de uma), o tamanho máximo de documento é **4 MB** em vez de 16 MB, elas não podem ser capped, e herdam as limitações gerais de views, já que *são* views.

Sharding tem seu próprio conjunto: shard keys só podem conter o `metaField`, seus subcampos e o `timeField`: "Nenhum outro campo, incluindo `_id`, é permitido no padrão da shard key." O `timeField` precisa ser por faixa e vir por último, e usá-lo sozinho é desaconselhado porque ele "cresce monotonicamente" e joga todas as escritas em um único chunk. A partir da **8.0**, shard keys contendo o `timeField` estão *deprecated*, e o servidor registra um aviso a cada 12 horas pedindo para fazer resharding no `metaField`. Fazer resharding de uma coleção de séries temporais passou a ser possível na **8.0.10** (todos os shards precisam estar na 8.0.10+). Zone sharding não é suportado: "O balancer sempre distribui os dados de coleções de séries temporais shardadas igualmente entre todos os shards." Você também "não pode rodar comandos de administração de sharding em coleções de séries temporais shardadas."

Por fim, adotar o recurso é uma porta de mão única em caso de downgrade: "Você precisa apagar as coleções de séries temporais antes de fazer downgrade: do MongoDB 6.0 ou posterior para o MongoDB 5.0.7 ou anterior; do MongoDB 5.3 para o MongoDB 5.0.5 ou anterior."

### Comparado a um banco de séries temporais dedicado

Vale dizer com clareza: **o manual do MongoDB nunca compara coleções de séries temporais com InfluxDB, TimescaleDB ou qualquer outro TSDB dedicado.** Não há benchmark, nem afirmação de posicionamento, nem taxa de compressão em lugar nenhum da documentação; os benefícios são listados de forma qualitativa ("Tamanhos menores de armazenamento e de índices; maior eficiência de consultas; menos I/O em leituras; maior uso do cache em memória do WiredTiger; menor complexidade"). Então qualquer veredito competitivo é uma inferência a partir da superfície de capacidades documentada, não uma citação. A partir dessa superfície:

O que o recurso entrega de fato é a metade de *storage engine* de um TSDB (buckets colunares, ordenados por tempo e por série, com compressão, mais retenção por TTL, mais window functions via `$setWindowFields`) dentro de um banco de propósito geral que você talvez já esteja rodando, com os mesmos drivers, o mesmo framework de agregação e nenhum segundo sistema para operar nem pipeline de ETL para manter sincronizado. Para uma aplicação em que a telemetria é uma carga entre muitas, essa é uma vantagem real e muitas vezes decisiva.

O que ele não entrega, a julgar pelo que a documentação *não* documenta, são as ferramentas operacionais que compõem boa parte de um TSDB maduro: não há recurso de agregados contínuos nem de downsampling automático (consolidar dados brutos em resumos por hora é um pipeline que você escreve e agenda, gravando o resultado via `$out`), não há política de retenção em camadas além de um único `expireAfterSeconds`, não há linguagem de consulta nativa para séries temporais, não há caminho de streaming saindo da coleção (change streams não são suportados) e não há nenhuma proteção de unicidade ou validação de schema. A leitura honesta é a segunda opção da pergunta: **uma escolha forte, "boa o bastante e melhor que uma coleção comum", se você já está no MongoDB; não um motivo para migrar de um TSDB dedicado para o MongoDB.**

## Trade-offs

- **Os ganhos de compressão e de consulta são reais, mas a documentação não quantifica nenhum deles.** O mecanismo descrito no manual é crível e específico (um bucket por série e janela de tempo, em vez de um documento por leitura; compressão colunar por campo; buckets pequenos o bastante, ≤1000 medições / ≤125 KB, para ficarem residentes no cache), e a comparação com uma coleção comum é concreta: uma coleção comum precisa de uma entrada de índice por ponto de dado mais um segundo índice em identificador e tempo, "e para ler esses dados o MongoDB precisa processar todos os blocos de banco e de disco que os contêm, mesmo que um bloco tenha um único documento relevante." Mas todo benefício declarado é uma direção, não um número. Reserve tempo para medir sua própria carga em vez de citar uma taxa.
- **Medições são, na prática, imutáveis, por design e por restrição.** Updates só podem fazer match e modificar o `metaField`, precisam ser `multi`, não podem fazer upsert e não podem rodar em uma transação. Isso se encaixa bem na premissa da documentação ("Operações de update são raras, já que cada documento representa um único ponto no tempo") e é um bloqueio sério se seu pipeline algum dia precisar retroalimentar correções em pontos já registrados. Somado à ausência de índices únicos, deduplicar uma leitura entregue duas vezes é problema da sua aplicação, não do banco.
- **A cardinalidade do `metaField` é a decisão de design dominante, e não dá para corrigi-la depois.** Existem buckets por valor distinto de `metaField`, então um `metaField` que muda muito ou é específico demais produz "muitos buckets pouco preenchidos e de vida curta": você fica com toda a lista de restrições e perde a compressão que as justificava. E como o `metaField` não pode ser redefinido depois da criação, errar significa migrar os dados, não rodar `collMod`.
- **A granularidade é uma catraca de mão única com custo real nas duas pontas.** Grossa demais, e as consultas atravessam até um mês de dados por bucket (com `hours`) para responder uma pergunta de um dia; fina demais, e você ganha muitos buckets quase vazios por intervalo de coleta. Você só pode aumentar a duração, o aumento não reescreve buckets existentes, e `bucketMaxSpanSeconds`/`bucketRoundingSeconds` (a versão precisa desse ajuste) só existem a partir da 6.3.
- **O TTL é grosseiro de um jeito que um índice TTL por documento não é.** A remoção acontece por bucket, só depois que *todos* os documentos do bucket expiraram, verificada por uma tarefa que roda a cada 60 segundos e pode atrasar sob carga. Com granularidade grossa, a medição mais nova de um bucket segura todas as mais antigas. Bom o bastante para "manter mais ou menos 30 dias"; não é um mecanismo para prazos precisos de exclusão de dados.
- **Você abre mão de uma lista específica e importante de recursos da plataforma.** Sem change streams (logo, sem CDC, sem fonte para o Atlas Stream Processing, sem pipeline reativo a partir da coleção), sem Atlas Search, sem CSFLE, sem triggers de banco, sem validação de schema, sem índices únicos ou de texto, sem `distinct`, sem `renameCollection`, sem `$merge` para dentro da coleção, documentos de 4 MB em vez de 16 MB e sem escritas em transações. Qualquer um desses itens pode ser o que desqualifica o recurso para um serviço; confira a lista contra seus requisitos *antes* de criar a coleção, porque não dá para converter de volta.
- **Deployments shardados carregam restrições extras, ainda em mudança.** Shard keys se limitam a `metaField`/seus subcampos/`timeField`; `_id` não é permitido; zone sharding não é suportado e o balancer espalha os dados igualmente, convenha isso a você ou não; comandos de administração de sharding não podem ser executados. A maturidade está visivelmente melhorando, não estabilizada: o resharding só chegou na 8.0.10, e shard keys contendo o `timeField` viraram *deprecated* na 8.0, o que significa que um cluster montado no padrão originalmente documentado agora registra um aviso pedindo resharding para o `metaField`.
- **O desempenho ideal de escrita exige que o produtor mude de formato.** Agrupe por `metaField` dentro de um único `insertMany`, defina `ordered: false`, mantenha a ordem dos campos idêntica entre documentos (incluindo a ordem aninhada, já que "a compressão exige ordem consistente dos campos aninhados"), omita arrays/objetos vazios em vez de enviá-los e arredonde floats. Nada disso importa em uma coleção comum; tudo isso importa aqui. É barato fazer ao escrever o caminho de ingestão e chato de adaptar depois.
- **Adotar o recurso é um compromisso de versão.** FCV 5.0 no mínimo para criar uma, 6.3 para o índice automático `metaField`+`timeField` e os parâmetros de bucketing personalizados, 7.0 para `$out` para dentro da coleção, 8.0.10 para resharding; e fazer downgrade através dos limites documentados exige *apagar* as coleções antes. Em um deployment mais antigo, uma coleção comum bem modelada com um bom índice composto pode ser simplesmente a resposta pragmática.

## Documentation Links

- [MongoDB Documentation: Time Series Collections](https://www.mongodb.com/docs/manual/core/timeseries-collections/): doc
- [MongoDB Documentation: Time Series Collection Limitations](https://www.mongodb.com/docs/manual/core/timeseries/timeseries-limitations/): doc
- [MongoDB Documentation: Set Granularity for Time Series Data](https://www.mongodb.com/docs/manual/core/timeseries/timeseries-granularity/): doc
- [MongoDB Documentation: About Time Series Data (bucketing e o bucket catalog)](https://www.mongodb.com/docs/manual/core/timeseries/timeseries-bucketing/): doc
- [MongoDB Documentation: Create and Query a Time Series Collection (referência de campos)](https://www.mongodb.com/docs/manual/core/timeseries/timeseries-procedures/): doc
- [MongoDB Documentation: Time Series Collections Considerations (metaField, cardinalidade, granularidade)](https://www.mongodb.com/docs/manual/core/timeseries/timeseries-considerations/): doc
- [MongoDB Documentation: Best Practices for Time Series Collections](https://www.mongodb.com/docs/manual/core/timeseries/timeseries-best-practices/): doc
- [MongoDB Documentation: Set up Automatic Removal for Time Series Collections (TTL)](https://www.mongodb.com/docs/manual/core/timeseries/timeseries-automatic-removal/): doc
- [MongoDB Documentation: Aggregation and Operator Considerations for Time Series](https://www.mongodb.com/docs/manual/core/timeseries/timeseries-aggregations-operators/): doc
