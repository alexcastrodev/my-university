---
title: "Antipode: garantindo consistência causal entre serviços em aplicações distribuídas"
summary: O Antipode rastreia, como um lineage, as escritas em datastores que uma única requisição de usuário causa em vários serviços, e deixa o desenvolvedor colocar chamadas barrier que esperam essas escritas ficarem visíveis, de modo que um leitor em outra região não veja uma notificação antes do post a que ela se refere.
researchArea: Sistemas distribuídos
keywords: consistência entre serviços, consistência causal, lineage, microsserviços, bolt-on, barrier, geo-replicação
version: 1.0
updatedAt: 2026-11-07
---

## Visão geral

Em uma aplicação de microsserviços, uma requisição de usuário escreve em vários datastores, por exemplo um armazém de posts e uma fila de notificações. Cada datastore está correto por si só e replica no seu próprio ritmo. A requisição implica uma ordem de visibilidade (o post deveria estar legível quando sua notificação estiver), mas os datastores ignoram uns aos outros, então nada a impõe. Um seguidor em outra região pode ser notificado de um post que ainda não chegou lá e ler "object not found". Os autores chamam isso de inconsistência entre serviços e citam um relato do Facebook sobre o mesmo problema.

Este artigo do SOSP 2023 (Koblenz) vem do INESC-ID, Instituto Superior Técnico, Universidade de Lisboa, mais Jonathan Mace, do Max Planck Institute for Software Systems e da Microsoft Research. Para mostrar que o cenário é comum, os autores analisam um trace público da Alibaba e relatam mais de 17 mil microsserviços, mais de 80% deles com estado, e mais da metade das requisições chamando cinco ou mais serviços com estado distintos.

Quatro termos sustentam o artigo. **XCY** é um modelo de consistência causal entre serviços. Um **lineage** é o conjunto de operações dependentes que nascem de uma requisição. Uma **barrier** é a chamada que bloqueia até as escritas de um lineage ficarem visíveis. Uma **shim layer** envolve um datastore para que os lineages viajem junto com os dados. O Antipode é a biblioteca construída com eles.

Vale conhecer antes: o happened-before de Lamport e a memória causal, o tracing distribuído com propagação de contexto (OpenTelemetry) e a consistência eventual em stores geo-replicados. O artigo cita o [Saturn](/papers/saturn-distributed-metadata-service-for-causal-consistency) entre os sistemas de consistência causal que reduzem os metadados e impõem visibilidade em leituras ou escritas. Para a coordenação fortemente consistente contra a qual os autores argumentam, o [Spanner](/papers/spanner-globally-distributed-database) serve de contraste (o artigo não o cita).

## Contribuição

- **XCY.** Uma operação a precede b se a aconteceu antes de b, se b lê um valor escrito por uma operação do mesmo lineage de a, ou por transitividade. A segunda regra torna o XCY mais forte que a causalidade de Lamport: ler uma escrita cria uma dependência de todo o lineage dessa escrita, e não só da escrita.
- **Lineages como identificadores de escrita.** Um lineage é um conjunto de identificadores, cada um nomeando uma escrita em um datastore. Ele viaja com as requisições aproveitando a propagação de contexto já existente (OpenTelemetry baggage) e dentro dos datastores porque a shim o guarda ao lado do valor. O datastore precisa expor chaves versionadas, o que, segundo os autores, muitos já fazem ou podem passar a fazer.
- **Imposição explícita com `barrier`.** Em vez de checar dependências em toda leitura ou escrita, o desenvolvedor coloca `barrier(L)`, que pede ao `wait` de cada datastore para bloquear até a escrita ficar visível. A posição decide quem paga pelo atraso. Há variantes com timeout e com callback assíncrono, e uma otimização que espera apenas as réplicas próximas do chamador.
- **Limitando o crescimento das dependências.** Um lineage é descartado quando a requisição termina. O desenvolvedor pode usar `append` ou `remove` nas dependências, e `transfer` leva o conjunto de um lineage para outro, como quando bloquear um usuário em uma lista de controle de acesso precisa vir antes da notificação desse usuário. Os autores admitem que isso enfraquece, por projeto, a regra de transitividade do XCY.
- **Implantação bolt-on.** O Antipode é uma biblioteca em nível de aplicação mais shims. Não exige mudanças nos datastores e funciona com qualquer nível de consistência, desde que o `wait` ofereça ao menos monotonic reads. Um modo dry-run mostra por quais lineages uma barrier teria de esperar.

## Metodologia

Três benchmarks, cada um com uma inconsistência identificada pelos autores. O Post-Notification é uma aplicação serverless no AWS Lambda sobre stores geo-replicados prontos (MySQL, DynamoDB, Redis e S3 para os posts, e SNS, AMQ e DynamoDB para as notificações), com 1000 posts escritos em Frankfurt e notificações lidas nos EUA. O DeathStarBench (rede social, mais de 30 microsserviços) foi estendido pelos autores com lógica de geo-replicação e roda no Google Cloud replicando de East US para Frankfurt ou Singapura. O TrainTicket (mais de 40 serviços em Java, sem replicação) é verificado quanto ao cancelamento de passagem cujo reembolso pode atrasar.

No DeathStarBench e no TrainTicket, os clientes rodaram por 5 minutos em malha aberta (de 50 a 150 requisições por segundo no DeathStarBench), e cada experimento foi repetido 15 vezes, com a média reportada. Os autores medem violações, throughput e latência, e uma janela de consistência, o tempo entre uma escrita e a leitura que precisa enxergá-la. Existem shims para oito datastores: MySQL, DynamoDB, Redis, S3, SNS, AMQ, MongoDB e RabbitMQ.

## Resultados

Estes são os resultados relatados pelos autores.

- **As violações são reais.** No Post-Notification (Tabela 1) com SNS como notificador, os autores observaram inconsistências em 88% a 100% dos casos. Com AMQ foram 7% a 13%, exceto 100% com S3. Com DynamoDB como notificador foram 0%, exceto 13% com S3. O DeathStarBench mostrou 0,1% de East US para Frankfurt e 34% para Singapura (desvio padrão de 42%). O TrainTicket mostrou 0,57%.
- **O Antipode as eliminou.** Em todos os benchmarks a inconsistência foi sempre corrigida.
- **Pouco esforço.** O Post-Notification mudou menos de 20 linhas, o DeathStarBench menos de 350 e o TrainTicket 10. Nenhuma shim passou de 50 linhas, e a API central tem 250 linhas de C++, 175 de Java e 40 de Python.
- **Metadados pequenos.** Os lineages ficaram abaixo de 200 bytes em todos os experimentos. Uma estimativa de pior caso a partir do dataset da Alibaba dá menos de 1 KB para 99% das requisições e cerca de 200 bytes em média. O tamanho dos objetos cresceu menos de 200 bytes na maioria dos stores, e 14 kB (1,5%) no MySQL, o que os autores atribuem à nova coluna e ao novo índice (a Tabela 3 também lista 320 bytes para o S3).
- **Custo no DeathStarBench.** No máximo 2% de perda de throughput. A barrier ficou do lado do leitor, fora do caminho do escritor, e alongou a janela de consistência em até 2 ms (Frankfurt) e 6 ms (Singapura) no pico de throughput.
- **Custo no TrainTicket.** A barrier precisou ficar no caminho crítico, custando pouco mais de 15% de throughput e 17% de latência (cerca de 4 ms).
- **Custo no Post-Notification.** A janela cresce com o atraso de replicação. Com um atraso artificial de 50 s, o S3 ainda mostrou 20% de violações, e a barrier esperou cerca de 18 s em média pelo S3.

## Análise crítica

A ideia é um bom meio-termo entre o rastreamento causal completo e as checagens escritas à mão. O artigo admite vários limites.

- **A prevenção depende dos desenvolvedores.** As barriers são colocadas à mão, então as que faltam deixam violações passar. Os autores sugerem relações do tipo chave estrangeira entre schemas como pistas e o modo dry-run como apoio a testes.
- **O truncamento é uma troca.** Por padrão as cadeias de dependências param no fim do lineage, então só o `transfer` restaura o XCY completo.
- **A espera é visível ao usuário quando fica no caminho crítico.** O TrainTicket paga 17% de latência, e o desenvolvedor decide se vai expô-la.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **A alegação de custo do resumo não bate com o corpo.** O resumo diz menos de 2% de impacto em latência e throughput, mas só o DeathStarBench fica em 2%. O TrainTicket mostra 15% e 17%. Da mesma forma, a introdução diz "merely tens of LoC", enquanto o DeathStarBench levou menos de 350 (incluindo shims de dois datastores). Vale usar os números do corpo.
- **A correção é mostrada em três casos conhecidos.** Os autores escolheram tanto a violação quanto o local da barrier, e sucesso significa que o erro "not found" desaparece. Se o Antipode ajuda a encontrar violações desconhecidas não é avaliado, e o modo dry-run também não. O apêndice traz o modelo de sistema e a definição de lineage, sem prova de que a biblioteca impõe o XCY.
- **Falhas e escala não foram testadas.** A tolerância a falhas é delegada ao datastore, e nenhuma rodada injeta uma falha ou uma réplica particionada, testa a variante com timeout ou informa o custo da barrier quando um lineage toca mais datastores. O tamanho dos metadados na escala da Alibaba é um cálculo sobre o trace, não uma implantação.
- **As taxas dependem da montagem.** Posts de 400 KB a 1 MB contra notificações de 120 bytes favorecem a corrida, e os autores escreveram a lógica de replicação do DeathStarBench. Os 34% de Singapura vêm com uma explicação "provável" sobre o MongoDB, não com um teste.
- **Não há comparação quantitativa.** Os trabalhos relacionados (FlightTracker, sagas, coordenação) são discutidos só em prosa. Uma checagem manual no notificador, que o artigo descarta como solução ingênua, não é medida.

## Pesquisas futuras

- Colocar barriers de forma automática ou semiautomática, usando relações de schema e o modo dry-run, e verificar quão bem isso encontra violações que os desenvolvedores não notaram.
- O comportamento sob falhas: timeouts, réplicas atrasadas ou particionadas, e o que uma barrier deveria fazer nesses casos.
- Medir o que o truncamento padrão deixa de fora, comparando as dependências mantidas com o conjunto XCY completo em traces como o da Alibaba.
- Inconsistências como a do TrainTicket, causadas por tarefas assíncronas sem ordem e não por corridas de replicação, como uma classe à parte que as barriers resolvem só no caminho crítico.
