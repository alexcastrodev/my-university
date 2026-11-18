---
title: "AgileLog: um log compartilhado com forks para agentes sobre streams de dados"
summary: O AgileLog adiciona forks baratos e isolados ao log compartilhado que fica sob os sistemas de streaming de dados, incluindo forks que continuam herdando os novos registros do pai, para que agentes de LLM analisem, testem e proponham escritas num stream sem atrasar os consumidores de produção nem corromper o log principal, e o Bolt o implementa numa arquitetura diskless com um índice hierárquico de log e atualizações preguiçosas de cauda.
researchArea: Sistemas distribuídos
keywords: log compartilhado, streaming de dados, agentes de ia, forks, arquitetura diskless, armazenamento de objetos, camada de metadados
version: 1.0
updatedAt: 2026-11-18
---

## Visão geral

Um log compartilhado é a sequência durável e totalmente ordenada de registros que fica sob sistemas de streaming de dados como o Kafka. Produtores anexam registros a ele e consumidores os leem para análise, busca, inferência e monitoramento de fraude. Um novo tipo de cliente agora lê e escreve nesses streams: agentes movidos por LLMs, que decidem seus passos em tempo de execução e chamam ferramentas, em geral pelo Model Context Protocol.

Os autores, da University of Illinois Urbana-Champaign, argumentam que os agentes quebram duas suposições de um sistema de streaming. Eles são exploratórios, então muitos deles emitem muitas leituras e escritas especulativas ao mesmo tempo e interferem nos consumidores de produção sensíveis à latência. E suas escritas podem estar erradas, porque as ações de um LLM podem ser imprecisas, então precisam ser validadas antes que as aplicações a jusante as vejam. Agentes de código e de teste também querem um sandbox com dados reais de produção, o que hoje significa um stream separado e sintético.

A proposta é dar ao próprio log compartilhado uma operação de fork, como alguns bancos de dados, armazenamentos de objetos e lakehouses já têm para agentes. Este artigo do SOSP 2026 (Praga) define a abstração, o AgileLog, e uma implementação, o Bolt.

Termos para não confundir: fork é uma cópia filha logicamente separada de um log, que pode ser lida e anexada, fork severed (sFork) é o que deixa de ver o pai depois do ponto de fork, fork contínuo (cFork) é o que continua herdando os appends posteriores do pai, e promoção faz um cFork virar o pai.

Vale conhecer antes: o que é um log compartilhado e como os metadados que ordenam os registros podem ser separados dos dados. O [CORFU](/papers/corfu-shared-log-design-for-flash-clusters) é o projeto clássico, o [Scalog](/papers/scalog-seamless-reconfiguration-and-total-order) e o [Boki](/papers/boki-stateful-serverless-computing-with-shared-logs) são os dois com que o artigo se compara, e a camada de metadados roda sobre o [Raft](/papers/raft-understandable-consensus-algorithm). O [FuzzyLog](/papers/fuzzylog-partially-ordered-shared-log) é o único log anterior que o artigo diz permitir históricos bifurcados, apenas de forma implícita durante partições.

## Contribuição

- **A abstração AgileLog.** A API do log (read, append) ganha `cFork`, `sFork`, `squash` e `promote`. Cada fork é ele mesmo uma instância de AgileLog e pode ser bifurcado de novo. Um cFork compartilha o histórico até o ponto de fork e depois herda todo append posterior do pai, enquanto seus próprios appends ficam privados, o que os autores chamam de isolamento unidirecional de escrita. Os appends num cFork são intercalados de forma linearizável com os registros herdados do pai, então um registro anexado ao cFork depois que um append do pai terminou sempre cai depois dele. Um sFork pode partir de um offset passado.
- **Escritas de agentes com segurança.** Um agente escreve num cFork promovível, uma cópia do consumidor principal valida o resultado nesse fork, e então o fork é promovido (ou descartado se a validação falha). Os autores preferem isso a um log temporário porque a validação pode ter estado e vê os registros do pai intercalados na ordem certa. Um cFork promovível restringe o pai enquanto existe: leituras além do ponto de fork ficam bloqueadas, os appends no pai deixam de devolver seu índice, e cForks não promovíveis também não passam do ponto de fork. Vários cForks promovíveis podem competir, e só a primeira promoção vence.
- **Bolt numa arquitetura diskless.** Copiar dados deixa os forks lentos, e hospedar os forks nos mesmos brokers com disco do pai os faz interferir. O Bolt parte então de logs compartilhados diskless: brokers sem estado gravam objetos em lote num armazenamento de objetos na nuvem, e uma camada de metadados replicada com Raft sequencia os registros e mantém um índice das posições do log para os objetos. Um fork é um novo log cujo metadado aponta para os mesmos objetos, atendido por outro broker, então não copia dados e fica isolado.
- **Índice hierárquico de log (HLI).** Um fork novo começa com índice vazio e a cauda do pai, e a busca de uma posição abaixo da primeira entrada do filho recorre ao pai, então nenhuma entrada de índice é copiada. O índice de um log também guarda uma contagem acumulada de registros anexados localmente, que permite traduzir uma posição do filho numa posição do pai.
- **Atualização de cauda e propagação preguiçosa.** Para implementar cForks, um append no pai atualiza só as caudas dos descendentes, não os índices, e a atualização é aplicada de forma preguiçosa quando alguém consulta a cauda de um descendente. Uma árvore de cauda preguiçosa guarda a árvore de herança como um passeio de Euler numa árvore de busca balanceada, então a atualização de uma subárvore vira uma atualização de intervalo em tempo logarítmico. Um lease também pode descartar um cFork promovível deixado sem resolução por um agente fora de controle.
- **Tamanho.** O Bolt tem cerca de 21 mil linhas de C++, com eRPC, o MinIO como armazenamento de objetos e uma implementação de Raft já existente.

## Metodologia

Os experimentos rodam em nós xl170 do CloudLab: nove nós para o MinIO, três réplicas de metadados, um nó por broker e registros de 4 KB. Como nenhum log compartilhado existente tem forks, o Bolt é comparado sobretudo com variantes próprias: BoltMetaCpy (copia o metadado do pai para criar um fork), BoltNaiveCF (copia entradas de índice para todo descendente a cada append) e Bolt-ET (atualiza caudas de forma ansiosa, sem a árvore de cauda preguiçosa). Para isolamento ele também é comparado com o Kafka com disco e com o Inkless, o Kafka diskless da Aiven, em que um fork somente leitura é simulado por um novo broker diskless sobre o tópico de produção.

Os testes medem a latência de criação de fork contra o tamanho do log, a latência de uma carga sensível à latência ao lado de uma carga de análise e ao lado de forks que anexam, o desempenho do log raiz com 0, 10 e 100 cForks (também com 32 logs raiz), a vazão da camada de metadados com 10, 100 e 1000 cForks, a memória de metadados, o custo das buscas recursivas por profundidade de aninhamento, a latência de inserção no pai em hierarquias em estrela, balanceada, em cadeia e irregular de 100 a 1 milhão de logs, e a latência do promote. A vazão da camada de metadados é medida isoladamente com brokers emulados, porque os autores não tinham máquinas para gerar essa carga de ponta a ponta. Três agentes construídos sobre o OpenCode com Gemini-2.5-Pro exercitam a interface inteira: um agente de análise ad hoc de dados IoT (sFork), um agente que testa processadores de stream (cFork não promovível) e um agente de reabastecimento de cadeia de suprimentos (cFork promovível). Um agente fora de controle que nunca resolve um cFork promovível testa o lease.

## Resultados

Estes são os resultados reportados pelos autores.

- **Criação de fork.** O Bolt cria um fork em cerca de 50 microssegundos seja qual for o tamanho do pai, enquanto o BoltMetaCpy leva cerca de 100 ms com 25 milhões de entradas, três ordens de grandeza mais lento. Durante a criação de 100 forks a vazão do pai não muda no Bolt e cai no BoltMetaCpy.
- **Isolamento.** Uma tarefa de análise em massa não afeta a carga sensível à latência no Bolt e no Inkless, enquanto no Kafka com disco a latência dela piora 2 vezes por contenção no broker. A vazão e a latência de append do log raiz não degradam com 10 ou 100 cForks, inclusive com 32 logs raiz com essa quantidade de cForks cada.
- **Escalabilidade dos metadados.** O BoltNaiveCF vira gargalo com 100 e 1000 cForks, e o Bolt-ET com 1000, enquanto o Bolt continua escalando. Com 1000 cForks de um log raiz com 1 milhão de registros, o BoltNaiveCF precisa de 4,4 GB de metadados e o Bolt de 8 MB.
- **Buscas recursivas.** Com 1 milhão de registros por nível, uma busca na profundidade 7 é 5,2% mais lenta (no máximo 2 microssegundos a mais). A latência de inserção no pai varia menos de 0,5 microssegundo entre os formatos de hierarquia e cresce de forma logarítmica com o número de logs, até 1 milhão.
- **Promote.** Um promote por cópia de metadados leva de dezenas a centenas de microssegundos, muito menos que a abordagem de cópia de dados no Kafka, que também não tem validação com estado nem intercalação linearizável.
- **Aplicações com agentes.** Durante as consultas do agente de análise, a carga sensível à latência no Kafka vê latência média 14 vezes maior e p99 130 vezes maior, e o Bolt não mostra interferência. O agente de testes roda testes de janelas tumbling em cForks sem degradação de latência na carga em tempo real. No caso da cadeia de suprimentos, um erro de esquema injetado derruba o consumidor a jusante no Kafka, enquanto no Bolt o fork ruim é barrado antes da promoção, com quedas de vazão enquanto as leituras ficam bloqueadas. Um lease de 500 ms descarta um cFork promovível travado e a vazão do consumidor se recupera.

## Análise crítica

O artigo declara vários limites por conta própria.

- **A promoção tem preço.** Um cFork promovível bloqueia leituras além do seu ponto de fork e esconde os índices de append, causando as quedas de vazão vistas no teste da cadeia de suprimentos. Os autores sugerem adiar sua criação até que as escritas propostas estejam calculadas e fazer análises longas em cForks não promovíveis.
- **O promote é um merge restrito.** Só um filho bifurcado é mesclado no pai. Um merge geral de vários forks não preservaria a ordenação linearizável, e os casos de uso dos autores não precisaram dele. Eles também notam que um espaço de endereços global poderia remover a restrição dos índices de append, mas não a das leituras.
- **Sem linha de base com forks.** Como não existe log com forks, a maioria das comparações é com variantes dos próprios autores.

Os pontos a seguir são uma leitura da evidência, não afirmações do artigo.

- **A evidência com agentes são três aplicações construídas.** Cada uma é uma aplicação de agente único sobre um LLM, e para obter determinismo os autores reproduzem um único trace capturado nos dois sistemas, então não se mede o quanto agentes reais variam nem quantos forks uma frota deles criaria. O destaque "14 vezes e 130 vezes" vale para uma carga roteirizada.
- **Parte da escalabilidade é argumentada, não medida.** A camada de metadados é testada isoladamente com brokers emulados, e um único grupo Raft sequencia todos os logs. O armazenamento de objetos é um MinIO de nove nós, e o número de vazão do S3 usado para argumentar que as leituras escalam é citado de fora, não medido aqui.
- **A comparação com o Kafka mistura dois efeitos.** O Kafka com disco difere do Bolt tanto por não ter forks quanto por ter brokers com estado, então a degradação de 2 vezes mostra o custo de brokers com disco local, como os autores dizem, e não algo específico de forks. O Inkless, a linha de base diskless, é a comparação mais justa e também não mostra interferência.
- **A validação fica por conta da aplicação.** A promoção só é tão segura quanto a checagem feita no fork, e o artigo avalia um caso de erro de esquema. O custo também está ausente: requisições e armazenamento no object store para muitos forks, o custo de rodar uma cópia do consumidor a cada validação e a retenção quando objetos antigos do pai ainda são referenciados por forks não são discutidos no texto que li.
- **O controle de acesso é raso.** O lease é configurado por uma entidade autenticada, mas quem pode criar forks, com que cota e quantos forks um mesmo locatário pode criar não é tratado.

## Pesquisas futuras

- Merge geral entre vários forks e um projeto de espaço de endereços global com tags, que os autores esboçam como outro ponto do espaço de projeto.
- Retenção, compactação e coleta de lixo dos objetos em armazenamento compartilhado enquanto há forks apontando para eles, e o custo dos forks na nuvem.
- Cotas, autorização e multilocação para agentes que podem criar forks, e avaliação com frotas de agentes concorrentes e variados em vez de traces reproduzidos.
- Particionar a camada de metadados e medir a vazão de ponta a ponta num object store real da nuvem, com mais brokers.
