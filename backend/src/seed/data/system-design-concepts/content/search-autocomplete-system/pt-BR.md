---
title: "Projetando um Sistema de Autocomplete de Busca"
description: Como uma caixa de busca com sugestões (typeahead) retorna cinco sugestões ranqueadas em menos de 100ms a cada tecla digitada — uma trie anotada com resultados top-k pré-computados, construída offline por um pipeline de agregação em batch, particionada, cacheada e protegida por debouncing no cliente.
difficulty: Intermediate
readingTime: 11
tags:
  - Estruturas de Dados
  - Caching
  - Processamento em Batch
  - Escalabilidade
prerequisites:
  - Estrutura de dados trie
  - Fundamentos de caching
related:
  - label: Caching Strategies and CDNs
    slug: caching-strategies-and-cdns
  - label: Batch Processing in Distributed Systems
    slug: batch-processing-in-distributed-systems
  - label: Load Balancing Strategies
    slug: load-balancing-strategies
---

## Visão Geral

Autocomplete — typeahead, busca-enquanto-digita, busca incremental — parece um problema de algoritmos de string e é, na maior parte, um problema de infraestrutura. Um usuário digitando `dinner` dispara seis requisições independentes, uma por tecla, e cada uma delas precisa voltar com cinco sugestões ranqueadas antes que o próximo caractere seja digitado, ou a lista de sugestões visivelmente engasga. O núcleo algorítmico é uma **trie**, mas uma trie simples é lenta demais para esse orçamento de latência; o que faz o sistema funcionar é uma trie que foi *pré-computada*, *anotada*, *congelada em snapshot*, *particionada* e *cacheada* por um pipeline que roda bem longe do caminho da requisição.

## Requisitos

**Funcionais:**

- Casar apenas com o **prefixo** — `tw` casa com `twitter`, não com `retweet`. Casamento por substring ou fuzzy é um problema diferente (e muito mais caro).
- Retornar as **top 5** sugestões para um prefixo.
- Ranquear por **popularidade**, derivada da frequência histórica de consultas.
- Sem correção ortográfica, sem autocorreção; apenas ASCII minúsculo no design base.

**Não funcionais:**

- **Tempo de resposta abaixo de 100ms.** Qualquer coisa mais lenta e a lista de sugestões fica atrasada em relação à digitação do usuário, o que parece quebrado em vez de apenas lento.
- **Busca rápida, não apenas armazenamento rápido** — o caminho de leitura precisa ser praticamente O(1) por requisição, porque não há espaço no orçamento para uma varredura ou uma ordenação.
- **Escalável para alto QPS.** Com 10M de usuários ativos diários, 10 buscas por usuário por dia e ~20 caracteres por consulta, isso dá `10M × 10 × 20 / 86.400 ≈ 24.000 QPS` sustentado, e aproximadamente **48.000 QPS no pico**. Note de onde vem o multiplicador de 20×: não é o número de buscas, é o número de *teclas digitadas*. Autocomplete é, por construção, um sistema dominado por leitura.
- **Alta disponibilidade.** Sugestões são um aprimoramento, não a busca em si — um autocomplete parcialmente degradado deve retornar resultados obsoletos, nunca uma página de erro.

O crescimento de armazenamento é modesto em comparação: assumindo 20 bytes por string de consulta e que 20% das consultas diárias são novas, isso dá `10M × 10 × 20B × 20% ≈ 0,4 GB` de dados novos por dia. A pressão nesse sistema recai inteiramente sobre latência de leitura e volume de requisições, não sobre disco.

## A Estrutura de Dados Central: Uma Trie com Top-K Cacheado em Cada Nó

Uma trie (árvore de prefixos, de *retrieval*) armazena strings por caminho em vez de por valor: a raiz é a string vazia, cada aresta é um caractere, e cada nó representa o prefixo formado pelo caminho da raiz até ele. Marcar os nós terminais com uma frequência produz um dicionário ranqueado.

O algoritmo ingênuo de top-k nessa trie é:

1. Descer até o nó do prefixo — `O(p)`, onde `p` é o comprimento do prefixo.
2. Percorrer toda a subárvore abaixo dele para coletar cada consulta válida — `O(c)`, onde `c` é o número de descendentes.
3. Ordenar esses candidatos por frequência e pegar os top `k` — `O(c log c)`.

Total: `O(p) + O(c) + O(c log c)`. Isso é ótimo para `tr`, e catastrófico para `a` — a subárvore sob um prefixo de um único caractere é essencialmente a trie inteira, e uma única tecla digitada percorreria e ordenaria milhões de nós. O passo 2 é o vilão, e é pior exatamente nos prefixos que os usuários mais digitam (os curtos).

A solução é **pré-computar a resposta em cada nó**. Em vez de armazenar apenas um caractere e uma frequência, cada nó guarda as top 5 consultas de sua própria subárvore, já ranqueadas:

```
node "be"  → [best: 35, bet: 29, bee: 20, be: 15, beer: 10]
node "bee" → [bee: 20, beer: 10, beef: 8]
node "bes" → [best: 35, bestbuy: 12, bestseller: 6]
```

Agora o algoritmo de consulta é:

1. Descer até o nó do prefixo — limitado a `O(1)` ao limitar o comprimento do prefixo a, digamos, 50 caracteres, já que ninguém digita um prefixo de 500 caracteres.
2. Retornar a lista armazenada — `O(1)`.

A busca inteira é `O(1)`, sem travessia e sem ordenação no momento da requisição. Isso é uma troca clássica de espaço por tempo: cada nó agora carrega `k` strings de consulta completas mais suas contagens, o que multiplica várias vezes a pegada de memória da trie. Com um orçamento de 100ms num caminho dominado por leitura, essa troca é obviamente correta — memória é barata e recomprável, latência no caminho crítico não é.

Exemplo prático com a tabela de frequências `tree: 10, try: 29, true: 35, toy: 14, wish: 25, win: 50` e `k = 2`: o nó no prefixo `tr` armazena `[true: 35, try: 29]`. Um usuário digitando `tr` recebe ambas as sugestões dessa única leitura de nó — o sistema nunca visita `tree`, nunca ordena nada, e nunca toca em um banco de dados.

## O Serviço de Coleta de Dados

As frequências que anotam a trie vêm de logs de busca, não de um contador ao vivo. O pipeline é um [job em batch](batch-processing-in-distributed-systems) de livro-texto:

- **Logs de analytics** — registros brutos, append-only e não indexados de cada busca: `(query, timestamp)`. Baratos de escrever, inúteis para consultar diretamente.
- **Agregadores** — jobs que consolidam o log bruto em tuplas `(query, week_start, frequency)`. O log bruto é enorme e no formato errado; a agregação é o que transforma "5 bilhões de linhas de eventos" em "alguns milhões de linhas de contagens."
- **Tabela de dados agregados** — a tabela compacta e consultável de frequências a partir da qual a trie é construída.
- **Workers** — servidores rodando em um cronograma que leem a tabela agregada, constroem a trie (incluindo a lista top-k em cada nó) e a escrevem no **Trie DB**.
- **Trie Cache** — um cache distribuído em memória que guarda o snapshot atual da trie, que é o que o serviço de consulta realmente lê.

Nesse volume, **amostragem** é uma ferramenta legítima: logar 1 a cada N requisições de busca corta o custo de ingestão e processamento por um fator de N, e para um sinal de ranqueamento construído sobre popularidade agregada, uma amostra uniforme preserva a ordenação que importa. Você está computando um placar, não uma trilha de auditoria.

```mermaid
flowchart LR
    Users["Tráfego de busca<br/>(~48k QPS no pico)"] --> Logs["Logs de Analytics<br/>append-only (query, ts)"]
    Logs --> Agg["Agregadores<br/>consolidação semanal em batch"]
    Agg --> AggData[("Dados Agregados<br/>(query, semana, frequência)")]
    AggData --> Workers["Workers<br/>constroem trie + top-k por nó"]
    Workers --> TrieDB[("Trie DB<br/>snapshot serializado")]
    TrieDB -->|carga do snapshot| Cache[("Trie Cache<br/>distribuído, em memória")]
    Cache --> API["Servidores de API<br/>busca de prefixo O(1)"]
    API --> Client["Cliente<br/>5 sugestões"]
```

O Trie DB tem duas formas razoáveis. Um **document store** guarda a trie serializada como um blob — natural, já que a estrutura inteira é reconstruída e substituída atomicamente de qualquer forma. Um **key-value store** a achata: cada prefixo vira uma chave, a lista top-k de cada nó vira o valor, então `"be" → [best, bet, bee, be, beer]`. A forma key-value é trivialmente particionável e não precisa de nenhuma travessia de árvore no lado da leitura — a "trie" existe apenas como uma convenção de nomenclatura sobre o espaço de chaves.

## Por Que a Trie É Reconstruída Offline, Não Atualizada ao Vivo

O design óbvio atualiza a trie a cada busca. Ele não sobrevive ao contato com os números.

Bilhões de consultas por dia significam bilhões de escritas na estrutura exata da qual 48.000 leituras por segundo dependem — e cada escrita não é uma atualização de um nó, mas uma subida de volta até a raiz, porque cada ancestral guarda uma lista top-k que agora pode estar errada. Mudar `beer: 10` para `beer: 30` obriga `bee`, `be`, `b` e a raiz a reavaliarem suas listas cacheadas. Uma única consulta popular pode sujar um caminho de nós disputados exatamente no caminho de leitura mais quente do sistema.

Mais importante ainda, isso compra quase nada. As top 5 sugestões para `fa` não mudam de forma significativa entre terça e quarta — a cabeça de uma distribuição de consultas é extremamente estável. Pagar contenção de escrita contínua no caminho de leitura para manter um ranking que quase não se move é uma troca ruim. Em vez disso, workers reconstroem a trie inteira em um cronograma (semanalmente é um padrão razoável; um produto em tempo real como um feed social rodaria isso com muito mais frequência), e a nova trie **substitui atomicamente** a antiga. Leitores sempre veem um snapshot consistente e nunca observam uma estrutura pela metade.

Atualizações diretas de nó não são proibidas — elas são apenas reservadas para tries pequenas onde a cascata de ancestrais é barata, e para o caminho de **exclusão**, que não pode esperar uma semana. Sugestões odiosas, violentas ou de outra forma inaceitáveis são removidas por uma **camada de filtro na frente do Trie Cache**, de modo que uma mudança de regra tem efeito na próxima requisição; as linhas subjacentes são removidas dos dados agregados de forma assíncrona para que a próxima build agendada produza uma trie limpa. Filtrar no momento da leitura e purgar no momento da build é o que permite que a política se mova mais rápido que o pipeline.

O custo honesto desse design é que ele não consegue fazer trending. Um evento de notícia que dispara uma consulta nova às 15h não aparecerá até a próxima build — e mesmo que você disparasse uma build imediatamente, construir a trie leva tempo demais para fazer diferença. Trending em tempo real precisa de um substrato diferente: processamento de stream sobre o firehose de consultas (Kafka, Spark Streaming, Flink) alimentando uma camada de ranking separada ponderada por recência que é mesclada com a trie em batch no momento de servir.

## Particionando uma Trie Grande Demais para Uma Máquina

Assim que a trie anotada ultrapassa a memória de um único servidor, ela precisa ser dividida. A divisão ingênua é pelo **primeiro caractere**: `a`–`m` no servidor 1, `n`–`z` no servidor 2; com 26 letras você chega a até 26 partições, e o particionamento de segundo nível (`aa`–`ag`, `ah`–`an`, …) vai ainda mais fundo.

Isso distribui o *espaço de chaves* de forma uniforme e a *carga* de forma terrível. Há muito mais consultas em inglês começando com `c` ou `s` do que com `x` ou `z`, então a partição `c` derrete enquanto a partição `x` fica ociosa. A solução é particionar com os dados que você já tem: rodar a distribuição histórica de frequências — os mesmos dados agregados usados para construir a trie — e atribuir faixas de forma que cada partição receba tráfego comparável. Um **shard map manager** guarda essa correspondência faixa-de-prefixo → servidor e é consultado em cada requisição. Se `s` sozinho carrega tanto volume quanto `u` até `z` combinados, então `s` ganha sua própria partição e `u`–`z` compartilham uma.

O shard map é uma tabela pequena e de mudança lenta que cada servidor de API lê constantemente — cacheie-a agressivamente na memória de cada servidor e atualize-a fora de banda, exatamente como faria com qualquer tabela de roteamento na frente de uma frota. As requisições chegam a esses servidores de API através de um load balancer; veja [Load Balancing Strategies](load-balancing-strategies) para como essa camada distribui tráfego entre eles.

## Cacheando Prefixos Quentes

O Trie Cache não é uma otimização adicionada no final — é o caminho de leitura primário. Servidores de API leem do cache, e o Trie DB existe principalmente para repopular o cache depois que um nó é reiniciado, evicted, ou fica sem memória. Em um miss, o servidor carrega do Trie DB e escreve de volta no cache para que requisições subsequentes para aquele prefixo acertem quente.

As taxas de acerto de cache aqui são incomumente boas, porque prefixos de consulta seguem uma lei de potência acentuada: um pequeno conjunto de prefixos curtos responde por uma fração enorme de todas as buscas, e — criticamente — toda consulta longa *passa por* esses prefixos curtos no caminho de ser digitada. Todo usuário buscando `dinner`, `dinosaur` ou `dining table` passa primeiro pelo nó `di`. As chaves mais quentes também são o menor conjunto, que é a forma ideal para um cache. Veja [Caching Strategies and CDNs](caching-strategies-and-cdns) para política de evicção e mecânica de write-back.

Geografia agrava isso: se as consultas mais populares diferem por país, construa uma trie separada por país e envie cada uma para uma borda de CDN próxima de seus usuários, para que a leitura seja servida perto do usuário em vez de de uma região central.

## Empurrando Trabalho para o Navegador

Os 48.000 QPS mais baratos são os que você nunca recebe. Duas técnicas no lado do cliente cortam substancialmente o volume real de requisições:

**Debouncing.** Uma requisição por tecla digitada é a leitura ingênua de "busca-enquanto-digita." Esperar ~50ms após a última tecla antes de disparar — e cancelar a requisição em andamento quando um novo caractere chega — colapsa a rajada de seis requisições de um digitador rápido em uma ou duas, sem que o usuário perceba diferença alguma. Digitadores rápidos, os usuários que geram mais requisições, são exatamente os que o debouncing mais ajuda.

**Cache do navegador.** Resultados de autocomplete são estáveis por horas, então são seguros de cachear no navegador. O Google os serve com `Cache-Control: private, max-age=3600`: `private` mantém uma resposta personalizada fora de proxies compartilhados e CDNs, e `max-age=3600` a torna válida por uma hora localmente. Um usuário que apaga de `dinner` para `din` e digita de novo recebe os prefixos intermediários diretamente do cache do navegador, gerando zero tráfego. As próprias requisições saem como chamadas AJAX/`fetch`, então não há navegação de página envolvida.

Entre as duas, uma fração significativa do volume teórico de teclas digitadas nunca atravessa a rede — que é por isso que o número de QPS estimado de cabeça é um limite superior da carga, não um alvo para provisionar cegamente.

## Trade-offs

- **Cachear top-k em cada nó compra leituras O(1) a um alto custo de memória** — cada nó carrega `k` strings de consulta completas e suas contagens em vez de um único inteiro, multiplicando a pegada da trie. Troca correta para um caminho dominado por leitura com orçamento de 100ms; errada se a estrutura for dominada por escrita ou limitada por memória.
- **Reconstruções offline dão snapshots atômicos limpos mas deixam o sistema cego a consultas em trending** — uma sugestão não pode aparecer até o próximo ciclo de build, então termos de notícias urgentes são estruturalmente invisíveis. Trending em tempo real exige um caminho separado de processamento de stream mesclado no momento de servir, não um job em batch mais rápido.
- **Particionar pelo primeiro caractere é trivial de implementar e produz carga muito desbalanceada** — a frequência de letras em inglês está longe de ser uniforme. Um shard map derivado de frequência balanceia o tráfego mas adiciona um serviço de busca do qual toda requisição depende e que precisa ser mantido sincronizado com os dados que descreve.
- **Amostrar o log de consultas corta o custo de ingestão proporcionalmente e perde a cauda** — para um placar de popularidade, uma amostra uniforme preserva o ranking da cabeça, que é tudo que o top-5 precisa. Isso significa que consultas raras-mas-reais podem nunca acumular contagens amostradas suficientes para aparecer.
- **Cache do navegador remove idas e voltas de rede e atrasa a correção de sugestões ruins** — uma sugestão filtrada no servidor ainda pode aparecer no navegador de um usuário até que sua cópia cacheada expire, então o TTL é uma decisão de política sobre tolerância a dados obsoletos, não apenas um botão de performance.
- **Filtrar no momento da leitura mantém a política rápida mas paga um custo em cada requisição** — a camada de filtro fica na frente do cache no caminho quente, então sua avaliação de regras está dentro do orçamento de latência para todos os 48.000 QPS, não apenas para as requisições que seriam de fato filtradas.

## Perguntas de Entrevista

- Por que o algoritmo ingênuo "percorrer a subárvore e ordenar" performa pior exatamente nos prefixos que os usuários mais digitam?
- Atualizar a frequência de um único nó exige atualizar todos os seus ancestrais. Por quê, e o que isso implica sobre fazer isso no caminho de leitura ao vivo?
- O sistema lida com ~48.000 QPS no pico mas apenas ~2.400 buscas reais por segundo. De onde vem o multiplicador de 20×, e como isso molda a arquitetura?
- Particionar pela primeira letra distribui prefixos uniformemente mas não a carga. Que dados você já tem que produziriam um shard map melhor, e que nova dependência usá-lo introduz?
- A trie é reconstruída semanalmente, mas uma sugestão ofensiva precisa desaparecer em minutos. Como você reconcilia essas duas escalas de tempo?

## Referências

- [Alex Xu, "System Design Interview – An Insider's Guide, Volume 1" (ByteByteGo, 2020) — Capítulo 13, "Design A Search Autocomplete System"](https://bytebytego.com)
- [Prefixy Team, "How We Built Prefixy: A Scalable Prefix Search Service for Powering Autocomplete"](https://medium.com/@prefixyteam/how-we-built-prefixy-a-scalable-prefix-search-service-for-powering-autocomplete-c20f98e2eff1)
- [Elasticsearch Reference — Suggesters (completion suggester for search-as-you-type)](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/search-suggesters)
- [MDN Web Docs — `Cache-Control` header (`private`, `max-age`)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control)
