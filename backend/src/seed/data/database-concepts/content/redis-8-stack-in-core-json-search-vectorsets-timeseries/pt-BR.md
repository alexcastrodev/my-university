---
version: 1.0
updatedAt: 2026-08-20
title: "Redis 8: JSON, Search, Vector Sets e Time Series no Core"
summary: O Redis 8 (maio de 2025) dobrou cinco módulos do Redis Stack antes separados e com licenciamento separado para dentro do core do Redis de graça, documentos JSON nativos, busca full-text/vetorial via o Redis Query Engine (FT.CREATE/FT.SEARCH), Time Series (TS.*), e cinco estruturas probabilísticas além do HyperLogLog (Bloom, Cuckoo, Count-min sketch, Top-K, t-digest), mais um tipo de dado nativo totalmente novo, Vector Sets (VADD/VSIM), para busca por similaridade de embeddings, a resposta do Redis para a mesma necessidade de IA/RAG que o MongoDB endereça com Atlas Vector Search.
---
## Objective

Entender o que mudou no **Redis 8** (GA em maio de 2025): cinco coisas que costumavam ser módulos separados e separadamente licenciados do Redis Stack (**JSON** nativo, busca full-text e vetorial (o Redis Query Engine, antes RediSearch), **Time Series**, e cinco **estruturas de dados probabilísticas** além do HyperLogLog) agora vêm empacotadas diretamente no core "Redis Open Source", mais um tipo de dado genuinamente novo, **Vector Sets**, lançado pela primeira vez na 8.0. Este conceito não tem fonte de livro nenhuma: os dois livros por trás dos outros conceitos de Redis deste lote (2013 e 2015) antecedem cada um desses recursos em aproximadamente uma década, e RediSearch, RedisJSON e RedisTimeSeries ainda não existiam como produtos. Tudo aqui foi verificado diretamente contra a documentação atual do redis.io em vez de presumido a partir de conhecimento de treinamento, porque as superfícies exatas de comando e os números de versão são recentes o suficiente (alguns tão tardios quanto Redis 8.6 e 8.8) para ser fácil errar.

## Use Cases

- **Dados de sessão e perfil como um documento de verdade, não um blob serializado.** Uma sessão de usuário com arrays e objetos aninhados (itens do carrinho, preferências, ações recentes) pode viver como um único documento JSON nativo com atualizações atômicas de subcaminho, em vez de uma chave String guardando uma string codificada em JSON que precisa ser lida por completo, desserializada, mutada e reescrita a cada mudança.
- **Busca de produtos sem um cluster Elasticsearch parafusado por fora.** `FT.CREATE`/`FT.SEARCH` constroem um índice secundário sobre documentos Hash ou JSON já morando no Redis (correspondência full-text, filtros de tag, faixas numéricas, raio geográfico e destaque de trecho), então "busca" não exige sincronizar dados para um segundo sistema.
- **Recuperação para RAG e busca semântica sobre embeddings**, o mesmo problema que o MongoDB endereça com `$vectorSearch`/Atlas Vector Search (coberto no conceito irmão `mongodb-atlas-search-and-vector-search`) e o Postgres endereça com `pgvector`. O Redis 8 responde isso de duas formas ao mesmo tempo: um campo `VECTOR` dentro de um índice do Query Engine (`FT.CREATE ... SCHEMA embedding VECTOR ...`), e o novo tipo de dado independente **Vector Sets** (`VADD`/`VSIM`): a mesma necessidade subjacente de IA/RAG, atendida pela resposta nativa de um produto diferente, e no caso do Redis, por duas respostas nativas diferentes dentro do mesmo produto.
- **Métricas com timestamp (sensores de IoT, telemetria de sistema, cotações de ações/câmbio)** armazenadas com retenção e downsampling automáticos em vez de sorted sets de pares timestamp/valor feitos à mão. `TS.CREATERULE` mantém um rollup horário ou diário pré-agregado em sincronia com os dados brutos conforme chegam.
- **"Já vi isso antes" e "quantas vezes" a um custo de memória fixo**, além do que o HyperLogLog responde. Um filtro Bloom ou Cuckoo responde "esse item exato já apareceu antes" (nomes de modelo duplicados, cupons de desconto usados, impressões de anúncio já vistas); um Count-min sketch responde "aproximadamente quantas vezes esse item apareceu"; Top-K responde "quais são os K itens mais frequentes agora" (hashtags em alta, IPs de origem de DDoS); t-digest responde "que fração dos valores fica abaixo de X" (dashboards de latência p50/p90/p99): cinco perguntas diferentes que o HyperLogLog (que só responde "quantas coisas *distintas*") não consegue responder de jeito nenhum.

## Deep Dive

### JSON nativo: um tipo de documento de verdade, não uma String guardando texto

O Redis JSON não é uma convenção em cima do tipo String; é seu próprio perfil de resposta/complexidade com seu próprio armazenamento: "Documentos armazenados como dados binários em uma estrutura de árvore, permitindo acesso rápido a subelementos", com "suporte completo ao padrão JSON" e "operações atômicas tipadas para todos os tipos de valor JSON". Valores são endereçados por **JSONPath** (`$` para raiz, `$.field`, `$[1].crashes`, `$..val` para descida recursiva), não reenviando o documento inteiro.

A superfície de comando tem 26 comandos, divididos por tipo de valor JSON:

| Grupo | Comandos |
|---|---|
| Documento inteiro | `JSON.SET`, `JSON.GET`, `JSON.MGET`, `JSON.MSET`, `JSON.DEL`, `JSON.FORGET`, `JSON.TYPE`, `JSON.CLEAR`, `JSON.MERGE` |
| Strings | `JSON.STRLEN`, `JSON.STRAPPEND` |
| Números | `JSON.NUMINCRBY`, `JSON.NUMMULTBY` |
| Arrays | `JSON.ARRAPPEND`, `JSON.ARRINDEX`, `JSON.ARRINSERT`, `JSON.ARRLEN`, `JSON.ARRPOP`, `JSON.ARRTRIM` |
| Objetos | `JSON.OBJKEYS`, `JSON.OBJLEN` |
| Booleanos / diversos | `JSON.TOGGLE`, `JSON.RESP`, `JSON.DEBUG` |

Essa é a diferença concreta em relação a "só guardar uma string JSON em uma chave String comum". Com uma String, incrementar um contador aninhado significa `GET`, parsear no lado do cliente, mutar, serializar, dar `SET` no blob inteiro de volta: não é atômico, e um segundo escritor disputando a mesma leitura-modificação-escrita perde uma atualização silenciosamente. Com JSON nativo, `JSON.NUMINCRBY crashes $ 1` muta um caminho no lugar, atomicamente, sem nunca transferir o resto do documento:

```
> JSON.SET crashes $ 0
OK
> JSON.NUMINCRBY crashes $ 1
"[1]"
> JSON.NUMINCRBY crashes $ 1.5
"[2.5]"
```

Cirurgia em arrays funciona do mesmo jeito: `JSON.ARRINSERT riders $ 1 '"Prickett"' '"Royce"'` insere em um array em um índice, e `JSON.ARRTRIM`/`JSON.ARRPOP` removem sem nunca buscar o array de volta ao cliente primeiro. E criticamente para a metade de busca deste conceito: "o Redis JSON também funciona perfeitamente com o Redis Search para deixar você indexar e consultar documentos JSON": um índice `FT.CREATE ... ON JSON` pode mirar em uma expressão JSONPath diretamente, algo que um blob JSON tipado como String não consegue oferecer de jeito nenhum, porque não há nada dentro de uma String para um índice secundário endereçar.

Uma adição recente e específica que vale a pena sinalizar precisamente porque é fácil errar a versão: "A partir do Redis 8.8, o tipo de dado JSON suporta a capacidade de forçar um tipo específico ao armazenar arrays homogêneos de ponto flutuante (FPHAs) usando a opção `FPHA BF16|FP16|FP32|FP64` no comando `JSON.SET`": um controle de formato de armazenamento mirado diretamente em arrays de embedding, ligando esse recurso de volta aos casos de uso de vetor/IA abaixo.

### Busca full-text e secundária: `FT.CREATE` / `FT.SEARCH`, agora chamado de Redis Query Engine

RediSearch é o módulo; **Redis Query Engine** é o nome de produto atual para o que ele faz, e a renomeação importa para quem lê material mais antigo: "Com o Redis 8 você pode criar um índice secundário de dados que residem em hashes e estruturas de dados JSON. Alguns dos usos mais comuns do Redis Query Engine incluem busca vetorial, consultas de dados que retornam correspondências exatas por um critério ou tag, e consultas de busca que retornam as melhores correspondências por palavras-chave ou significado semântico."

`FT.CREATE` declara um índice sobre chaves Hash ou JSON existentes; ele não cria um novo armazenamento de documentos, ele indexa o que já está lá:

```
FT.CREATE index [ON HASH|JSON] [PREFIX count prefix ...]
  SCHEMA field_name [AS alias] <TEXT|TAG|NUMERIC|GEO|GEOSHAPE|VECTOR> [options...]
```

Tipos de campo mapeiam diretamente para capacidade de consulta: `TEXT` para full-text (com `WEIGHT`, `NOSTEM`, correspondência `PHONETIC` por campo, e suporte a suffix-trie para consultas `*foo*`), `TAG` para valores categóricos de correspondência exata (separados por vírgula por padrão, `CASESENSITIVE` opcional), `NUMERIC` para consultas de faixa, `GEO`/`GEOSHAPE` para consultas de raio e polígono, e `VECTOR` para busca por similaridade embutida dentro de um índice por outro lado comum. Para JSON, o identificador é uma expressão JSONPath em vez de um nome de campo plano: `FT.CREATE idx ON JSON SCHEMA $.title AS title TEXT $.categories AS categories TAG` indexa direto para dentro da estrutura aninhada.

`FT.SEARCH` é o lado de leitura, e sua superfície de opções é grande: `NOCONTENT` para retornar só IDs, `WITHSCORES`/`EXPLAINSCORE` para depuração de relevância, `HIGHLIGHT`/`SUMMARIZE` para marcar texto correspondido, `SORTBY`, `LIMIT`, `RETURN` para projetar campos específicos (ou caminhos JSON, apelidados com `AS`), e `SLOP`/`INORDER` para consultas de frase sensíveis à proximidade. Uma consulta representativa:

```
FT.SEARCH books-idx "@title:space @categories:{science}" LIMIT 0 10 RETURN 2 title price
```

A busca por similaridade vetorial acompanha o *mesmo* comando como uma cláusula `KNN` em vez de um estágio separado:

```
FT.SEARCH books-idx "*=>[KNN 10 @title_embedding $query_vec AS title_score]"
  PARAMS 2 query_vec <embedding-blob> SORTBY title_score DIALECT 2
```

Este é um dos dois caminhos distintos de busca vetorial que o Redis 8 agora oferece (o outro são os Vector Sets, cobertos a seguir), e a diferença é arquitetural: um campo `VECTOR` vive dentro de um índice do Query Engine junto com campos `TEXT`/`TAG`/`NUMERIC` nos mesmos documentos Hash ou JSON, então uma única consulta pode combinar filtragem léxica e similaridade vetorial em uma passada. A complexidade do `FT.SEARCH` é documentada como "O(n) para consultas de uma palavra", onde `n` é o tamanho do conjunto de resultados: encontrar postings de termo correspondentes é O(1), mas carregar e retornar os documentos correspondidos os varre.

### Vector Sets: um novo tipo de dado nativo, não um campo dentro de outro índice

Vector Sets são a segunda resposta independente do Redis 8 para similaridade vetorial, e são uma primitiva genuinamente nova em vez de uma reembalagem do tipo de campo `VECTOR` do Query Engine: "Vector sets são um tipo de dado parecido com sorted sets, mas em vez de um score, elementos de vector set têm uma representação em string de um vetor." O comando `TYPE` retorna `vectorset` para essas chaves, confirmando status de tipo de dado de primeira classe junto com String, Hash, Set, Sorted Set e o resto. Segundo o próprio anúncio do Redis, foi "desenvolvido por Salvatore Sanfilippo, o criador original do Redis", tira "inspiração do sorted set", e "complementa a capacidade de busca vetorial já existente no Redis Query Engine" em vez de substituí-la, e foi lançado explicitamente como **beta**: "Podemos mudar, ou até quebrar, os recursos e a API em versões futuras."

A superfície de comando, toda introduzida na 8.0.0 salvo indicação:

| Comando | Faz |
|---|---|
| `VADD key [REDUCE dim] VALUES num val [val...] element` (ou blob `FP32`) | Adiciona/atualiza o vetor de um elemento |
| `VSIM key (ELE element \| VALUES num val...) [WITHSCORES] [COUNT n] [FILTER expr]` | Busca por similaridade, por elemento ou por vetor bruto |
| `VREM` / `VCARD` / `VDIM` | Remove um elemento / conta elementos / lê a dimensionalidade do vetor |
| `VEMB key element` | Retorna o vetor armazenado (quantizado) para um elemento |
| `VSETATTR` / `VGETATTR` | Anexa ou lê um blob de atributo JSON por elemento, para filtragem |
| `VLINKS` | Retorna os vizinhos de um elemento em cada camada do grafo HNSW |
| `VINFO` | Metadados sobre o set |
| `VISMEMBER` (8.2.0), `VRANGE` (8.4.0) | Checagem de pertencimento; leitura de faixa lexicográfica |

O algoritmo de indexação é o HNSW, confirmado diretamente pela própria descrição do `VLINKS` ("vizinhos de um elemento em cada camada do grafo HNSW") e por comandos de debug como `DEBUG DUMP_HNSW`. A quantização vem ligada por padrão por eficiência de armazenamento, e é lossy de um jeito que a documentação declara explicitamente: adicionar `VALUES 2 1.0 1.0` e lê-lo de volta com `VEMB` retorna `0.9999999403953552, 0.9999999403953552`: "os valores tipicamente não serão os valores exatos que você forneceu... porque quantização é aplicada para melhorar o desempenho". Busca por similaridade filtrada funciona anexando um blob de atributo JSON a elementos e expressando um predicado em tempo de consulta: `VSIM points ELE pt:A FILTER '.size == "large" && .price > 20.00'`.

Colocado contra o conceito irmão do MongoDB, o contraste é estrutural, não só cosmético. O Atlas/MongoDB Vector Search do MongoDB roda o `mongot`, um **processo Apache Lucene separado** sincronizado a partir do `mongod` via change streams, com seu próprio armazenamento, seu próprio orçamento de memória, e indexação eventualmente consistente. O Vector Set do Redis é um **tipo de dado nativo no próprio core**: sem segundo processo, sem camada de armazenamento separada, sem atraso de sincronização, atualizado e consultado no mesmo caminho de requisição que qualquer outro comando Redis. Isso compra imediatismo ao custo da restrição usual do Redis: tudo vive na memória do mesmo processo que o resto do dataset, sem uma opção de isolamento em nó dedicado como os nós de busca dedicados do MongoDB oferecem.

### Time Series: `TS.*` para dados numéricos com timestamp

"O tipo de dado time series do Redis deixa você armazenar pontos de dados de valor real junto com o horário em que foram coletados. Você pode combinar os valores de uma seleção de séries temporais e consultá-los por faixa de tempo ou valor. Você também pode computar agregadores dos dados ao longo de períodos de tempo e criar novas séries temporais a partir dos resultados." Dezessete comandos `TS.*` se dividem claramente em escrita, leitura e gerenciamento de rollup:

| Grupo | Comandos |
|---|---|
| Escrita | `TS.CREATE`, `TS.ADD`, `TS.MADD`, `TS.INCRBY`, `TS.DECRBY`, `TS.ALTER`, `TS.DEL` |
| Leitura | `TS.GET`, `TS.RANGE`, `TS.REVRANGE`, `TS.MGET`, `TS.MRANGE`, `TS.MREVRANGE`, `TS.QUERYINDEX`, `TS.INFO` |
| Rollups | `TS.CREATERULE`, `TS.DELETERULE` |

Retenção é uma configuração por série avaliada em relação à amostra mais nova: "você pode especificar um período máximo de retenção para os dados, relativo ao último timestamp reportado. Um período de retenção zero significa que os dados não expiram": definido via `TS.ADD key ts value RETENTION 100` (milissegundos) ou `TS.CREATE`. **Labels** são pares nome/valor de string usados puramente para seleção e agrupamento entre séries: `TS.ADD thermometer:3 1 10.4 LABELS location UK type Mercury`, e então `TS.MGET FILTER location=us` lê a amostra mais recente de toda série marcada dessa forma sem nomear cada chave individualmente.

Downsampling acontece de duas formas. Ad hoc, `TS.RANGE key from to AGGREGATION avg bucketDuration` agrupa um resultado de consulta na hora, com agregadores `avg`, `sum`, `min`, `max`, `range`, `count`, `first`, `last`, `std.p`, `std.s`, `var.p`, `var.s`, `twa` (média ponderada por tempo), mais `countNaN` e `countAll` adicionados no Redis 8.6. Permanente, `TS.CREATERULE sourceKey destKey AGGREGATION aggregator bucketDuration` mantém uma série reduzida continuamente sincronizada: "regras de compactação processam dados incrementalmente, computando agregados para buckets completos conforme novos dados chegam": então uma série bruta de alta frequência e um rollup horário permanecem consistentes sem um cron job externo. O tratamento de NaN é em si um detalhe sensível a versão: "A partir do Redis 8.6, séries temporais suportam valores NaN... que permitem representar medições ausentes ou inválidas", e a partir dessa versão, "todos os agregadores existentes ignoram valores NaN ao computar resultados": uma mudança de comportamento que não existia da 8.0 até a 8.5.

### Estruturas probabilísticas além do HyperLogLog

O conceito irmão `redis-advanced-data-types-sets-sortedsets-bitmaps-hyperloglog` já cobre a troca de estimativa de cardinalidade do HyperLogLog (fixo em ~12 KB, ~0,81% de erro, sem recall de pertencimento) e sinaliza que o Redis 8.0 adicionou mais cinco estruturas probabilísticas conforme o antigo conteúdo do módulo RedisBloom foi dobrado para dentro do core. Este conceito vai um nível mais fundo no que cada uma de fato faz e sua superfície de comando real, porque "probabilístico" cobre cinco perguntas genuinamente diferentes:

**Filtro Bloom**: "esse item exato já apareceu antes", com falsos positivos possíveis mas falsos negativos impossíveis: "Um filtro Bloom consegue garantir a ausência de um item de um set, mas só consegue dar uma estimativa sobre sua presença." O dimensionamento é explícito na criação: `BF.RESERVE key error_rate capacity [EXPANSION n] [NONSCALING]`. Uma taxa de erro de 0,1% custa 14,378 bits/item, contra aproximadamente 320 bits/item para o Set do Redis equivalente de endereços IP. Comandos principais: `BF.ADD`, `BF.MADD`, `BF.EXISTS`, `BF.MEXISTS`, `BF.INSERT`, `BF.CARD`, `BF.INFO`, mais `BF.SCANDUMP`/`BF.LOADCHUNK` para backup incremental. **Nenhuma exclusão é possível**: um filtro Bloom só consegue crescer.

**Filtro Cuckoo**: a mesma pergunta de pertencimento, respondida diferentemente: buckets de fingerprints de item em vez de um array de bits invertidos, encontrado via `CF.RESERVE key capacity [BUCKETSIZE n] [MAXITERATIONS n] [EXPANSION n]`, depois `CF.ADD`/`CF.EXISTS`/`CF.DEL`/`CF.COUNT`/`CF.INSERT`. A única capacidade que filtros Bloom categoricamente não têm: "Filtros Cuckoo são mais rápidos em operações de checagem e também permitem exclusões": `CF.DEL` de fato remove um item, que é por isso que um fluxo de "esse cupom já foi resgatado" (adiciona na emissão, exclui no resgate) precisa de Cuckoo, não de Bloom.

**Count-min sketch**: não pertencimento, mas frequência: "estimar a frequência de eventos/elementos em um fluxo de dados", dimensionado via `CMS.INITBYDIM key width depth` ou `CMS.INITBYPROB key error probability`, depois atualizado com `CMS.INCRBY` e lido com `CMS.QUERY`. A ressalva documentada é afiada: resultados só são confiáveis acima de um `threshold = error * total_count` calculado: "resultados... menores do que um certo limiar... devem ser ignorados e muitas vezes até aproximados para zero", tornando o CMS uma ferramenta para encontrar itens de alta frequência, não para contagens baixas precisas.

**Top-K**: "os `K` elementos de maior rank de um fluxo", construído sobre o algoritmo HeavyKeepers (uma tabela hash de contagens mais um min-heap dos K primeiros atuais), via `TOPK.RESERVE key k [width depth decay]`, depois `TOPK.ADD`/`TOPK.QUERY`/`TOPK.LIST`/`TOPK.COUNT`. `TOPK.ADD` retorna o item removido da lista quando um item novo o desloca: um sinal ao vivo de "quem acabou de sair do trending" que um Sorted Set não consegue dar de graça.

**t-digest**: percentis e quantis sobre um fluxo sem armazenar cada observação: "Que fração dos valores no fluxo de dados é menor/maior que um dado valor?" Construído com `TDIGEST.CREATE key [COMPRESSION c]` (compressão mais alta = mais precisão, mais memória), alimentado com `TDIGEST.ADD`, e consultado nas duas direções: `TDIGEST.QUANTILE key .5` retorna o valor no percentil 50, `TDIGEST.CDF key 50` retorna que fração de observações fica abaixo de 50, `TDIGEST.RANK`/`TDIGEST.BYRANK` convertem entre um valor e sua posição, e `TDIGEST.TRIMMED_MEAN` retorna uma média excluindo caudas outlier: a ferramenta clássica para um dashboard de latência p50/p90/p99 que não pode se dar ao luxo de ordenar cada amostra.

### "Um só Redis": a história de licenciamento e empacotamento

Vale a pena declarar isso claramente porque é uma história real e verificável, não trivia incidental. RediSearch, RedisJSON, RedisTimeSeries e RedisBloom começaram como módulos independentes, cada um versionado separadamente do core do Redis e um do outro, uma dor de cabeça o bastante de "casar a versão certa do módulo com a versão do Redis" para a Redis Inc. empacotá-los em uma única distribuição **Redis Stack**. O Redis Stack, e (depois de março de 2024) o próprio core do Redis, passaram a vir sob a **Redis Source Available License (RSALv2)** e a **Server Side Public License (SSPLv1)**, uma mudança de licença dupla se afastando da licença BSD original do Redis, que foi "amplamente criticada pela comunidade open source" e disparou diretamente o fork Valkey apoiado pela Linux Foundation (e o Redict) como continuações licenciadas sob BSD.

O Redis 8.0 (maio de 2025) mudou duas coisas ao mesmo tempo, e a conexão entre elas é real: "Hoje, estamos combinando nossas ofertas do Redis Stack e da comunidade em uma única distribuição Redis Open Source. Todos os módulos já estão incluídos neste pacote"; e simultaneamente, "o Redis 8 está disponível no Redis Open Source sob a licença open source AGPLv3, além das licenças duplas RSALv2 e SSPLv1 para as quais migramos no ano passado. Ouvimos de alguns clientes que é mais fácil para eles operar sob uma licença aprovada pela OSI, então adicionamos essa opção." Salvatore Sanfilippo (antirez), o autor original do Redis, voltou à Redis Inc. em novembro de 2024 e é creditado por empurrar a opção AGPLv3. O resultado prático para este conceito: JSON, o Query Engine, Time Series e os tipos probabilísticos não são mais módulos separados e quase pagos com sua própria cadência de release; eles vêm em todo binário Redis Open Source, sob escolha de três licenças (RSALv2, SSPLv1, ou AGPLv3), de graça.

## Trade-offs

- **Vector Sets são explicitamente beta.** A própria linguagem de lançamento do Redis é inequívoca: "Podemos mudar, ou até quebrar, os recursos e a API em versões futuras." Construir um pipeline de RAG de produção sobre `VADD`/`VSIM` hoje significa aceitar que sintaxe de comando, comportamento padrão, ou até o formato de dado podem mudar em um release 8.x posterior: uma postura de risco materialmente diferente do tipo de campo `VECTOR` dentro do `FT.CREATE`, que se apoia no código de indexação há muito estável do RediSearch.
- **O Redis 8 agora oferece duas formas não relacionadas de fazer busca vetorial, e escolher errado custa um redesign.** Um campo `VECTOR` dentro de um índice do Query Engine deixa uma consulta combinar filtragem léxica/tag/numérica com busca por similaridade sobre documentos Hash ou JSON já carregando outros campos indexados. Um Vector Set é um tipo de dado independente com sua própria chave, sua própria minilinguagem `FILTER` sobre atributos JSON anexados, e nenhuma capacidade de fazer join contra um campo `TEXT` ou `TAG` como um índice do Query Engine consegue. Escolher o errado cedo (Vector Set para uma carga de trabalho que na verdade precisava de busca híbrida léxica+semântica, ou um campo `VECTOR` do Query Engine para o que na verdade era um armazenamento de embedding simples e independente) significa migrar tipos de dado, não só ajustar uma consulta.
- **Fragmentação de versão dentro de "Redis 8" é real e fácil de perder de vista.** Vários recursos referenciados acima não foram lançados simultaneamente com a 8.0.0: `VISMEMBER` (8.2.0), `VRANGE` (8.4.0), suporte a NaN em time series e os agregadores `countNaN`/`countAll` (8.6), e a opção `FPHA` do JSON (8.8) todos chegaram em releases de ponto 8.x posteriores. "Redis 8" em um post de blog ou uma tag Docker não é um conjunto de recursos único e fixo: a versão minor exata na sua frente determina o que de fato é chamável.
- **No core significa sem isolamento, diferente do processo de busca dedicado do MongoDB.** Todo recurso aqui (armazenamento JSON, índices do Query Engine, Vector Sets, time series, e todo sketch probabilístico) vive dentro do mesmo processo Redis e do mesmo orçamento de memória que chaves comuns. Não há um daemon separado estilo `mongot` para escalar, proteger, ou reiniciar independentemente, o que remove uma categoria inteira do overhead operacional de busca autogerenciada do MongoDB (veja os Trade-offs do conceito irmão), mas também significa que um índice de busca fora de controle ou um vector set superdimensionado compete diretamente com dados de cache e sessão pela mesma RAM, sem opção de nó dedicado para tirá-lo do caminho quente.
- **Toda estrutura probabilística abre mão de um tipo específico de correção, permanentemente, e as cinco não são intercambiáveis.** Filtros Bloom nunca conseguem excluir; filtros Cuckoo conseguem, a um custo por item ligeiramente maior e um piso documentado mínimo de ~0,78% de falso positivo mesmo na melhor configuração de bucket. Resultados de Count-min sketch abaixo de um limiar calculado precisam ser descartados como ruído; ele é estruturalmente inadequado para fluxos uniformemente distribuídos onde nenhum item é um "heavy hitter" claro. O viés `HeavyKeepers` do Top-K é deliberado: "enviesado contra fluxos mouse (pequenos)", então é a ferramenta errada se sinais pequenos mas reais importam. O t-digest troca ordenação exata por um sketch compacto da forma da distribuição, controlado por um único valor `COMPRESSION`: baixo demais, e as duas caudas de uma estimativa de latência p99 ficam menos confiáveis. Recorrer a "uma estrutura probabilística" sem escolher a que casa com a pergunta real é um erro de modelagem tão concreto quanto a decisão Set-vs-Bitmap-vs-HyperLogLog que o conceito irmão percorre.
- **O pacote de licença é mais amigável, não simples.** O Redis Open Source agora está disponível sob AGPLv3, uma licença aprovada pela OSI: uma melhoria real e verificada em relação a apenas RSAL/SSPL para quem precisava marcar essa caixinha. Mas ele vem como uma de *três* opções de licença (RSALv2, SSPLv1, AGPLv3), e os termos de copyleft de rede do AGPLv3 carregam suas próprias obrigações para quem constrói um serviço hospedado por cima do Redis; escolher "a opção grátis" ainda significa escolher uma licença específica e entender o que ela exige, não presumir que o Redis voltou aos seus termos permissivos BSD originais.
- **Essa é uma superfície ampla e em movimento rápido: verifique o comando exato antes de colocar em produção.** Cinco áreas de recurso, dezenas de comandos, vários deles adicionados em releases minor no último ano, é muita coisa para tratar como conhecimento assentado. As especificidades aqui (nomes de comando, versões de "desde", valores padrão como o `EXPANSION 2` do Bloom ou o piso mínimo de ~0,78% de erro do Cuckoo) são exatamente o tipo de detalhe que fica obsoleto mais rápido; trate este conceito como um mapa do que existe e reconfira a documentação ao vivo antes de depender de uma flag ou padrão específico em produção.

## Documentation Links

- [Redis Documentation: JSON](https://redis.io/docs/latest/develop/data-types/json/) - doc
- [Redis Documentation: Redis Query Engine (RediSearch)](https://redis.io/docs/latest/develop/ai/search-and-query/) - doc
- [Redis Documentation: FT.CREATE](https://redis.io/docs/latest/commands/ft.create/) - doc
- [Redis Documentation: FT.SEARCH](https://redis.io/docs/latest/commands/ft.search/) - doc
- [Redis Documentation: Vector sets](https://redis.io/docs/latest/develop/data-types/vector-sets/) - doc
- [Redis Documentation: Time series](https://redis.io/docs/latest/develop/data-types/timeseries/) - doc
- [Redis Documentation: Bloom filter](https://redis.io/docs/latest/develop/data-types/probabilistic/bloom-filter/) - doc
- [Redis Documentation: Cuckoo filter](https://redis.io/docs/latest/develop/data-types/probabilistic/cuckoo-filter/) - doc
- [Redis Documentation: Count-min sketch](https://redis.io/docs/latest/develop/data-types/probabilistic/count-min-sketch/) - doc
- [Redis Documentation: Top-K](https://redis.io/docs/latest/develop/data-types/probabilistic/top-k/) - doc
- [Redis Documentation: t-digest](https://redis.io/docs/latest/develop/data-types/probabilistic/t-digest/) - doc
- [Redis Blog: Redis 8 is now GA, loaded with new features and more than 30 performance improvements](https://redis.io/blog/redis-8-ga/) - doc
- [Redis Blog: Redis is now available under the AGPLv3 open source license](https://redis.io/blog/agplv3/) - doc
- [Redis Open Source 8.0 release notes](https://redis.io/docs/latest/operate/oss_and_stack/stack-with-enterprise/release-notes/redisce/redisos-8.0-release-notes/) - doc
