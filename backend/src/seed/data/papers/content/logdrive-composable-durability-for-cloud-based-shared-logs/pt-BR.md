---
title: "O LogDrive: durabilidade componível para logs compartilhados em nuvem"
summary: O Conflux, da Confluent, replica um armazenamento de metadados sobre um log compartilhado que vive no armazenamento em nuvem, mantendo a durabilidade em uma camada minúscula, o LogDrive, que se compõe por striping e quorums, e deixando a ordenação para um AtomicLog separado acima dele.
researchArea: Sistemas distribuídos
keywords: log compartilhado, armazenamento em nuvem, LogDrive, durabilidade componível, replicação de máquina de estados, armazenamento de metadados, quorum
version: 1.0
updatedAt: 2026-11-07
---

## Visão geral

Uma família crescente de serviços mantém seus dados diretamente em armazenamento de objetos na nuvem e precisa de um serviço de metadados separado para o índice. Este artigo do OSDI 2026 (o 20º USENIX Symposium on Operating Systems Design and Implementation, de 13 a 15 de julho de 2026, em Seattle), da Confluent, pergunta qual deve ser esse serviço de metadados para o K2, um sistema de publish-subscribe compatível com o Kafka construído sobre o S3. Os autores encontraram duas opções ruins: um banco de dados com estado e gerenciado por conta própria é complexo e frágil de operar, enquanto um banco de dados na nuvem como o DynamoDB é simples mas, pela estimativa deles, consumiria cerca de 75% do custo total do K2, porque metadados significam muitas escritas pequenas e leituras repetidas.

A resposta deles é o Conflux, uma camada de replicação de máquina de estados (SMR) cujo log compartilhado é armazenado na nuvem, de modo que a durabilidade é delegada por inteiro ao provedor. O obstáculo que relatam é que logs compartilhados se compõem por encadeamento e striping, mas não por replicação, já que cada log atribui seus próprios timestamps a um append. O artigo divide então o log em dois: o LogDrive, um espaço de endereços de baixo nível que cuida da durabilidade, e o AtomicLog, um log compartilhado convencional que cuida do sequenciamento.

Vale conhecer antes: o [CORFU](/papers/corfu-shared-log-design-for-flash-clusters) e seu sequenciador de estado volátil, que o AtomicLog toma emprestado; o [Scalog](/papers/scalog-seamless-reconfiguration-and-total-order) e o [LazyLog](/papers/lazylog-shared-log-abstraction-for-low-latency-applications), que também separam ordenação e durabilidade; o [Raft](/papers/raft-understandable-consensus-algorithm) como alternativa guiada por líder; e o [Tango](/papers/tango-distributed-data-structures-over-a-shared-log), para estado replicado construído sobre um log (este artigo não o cita). O artigo também reaproveita a API Loglet e o VirtualLog do Delos (Balakrishnan et al., OSDI 2020), que não está nesta biblioteca.

## Contribuição

- **A abstração LogDrive.** Ela expõe `write(address, payload)`, `read(address)` e `weakTail(K)`. Os endereços são registradores de valor único, linearizáveis apenas enquanto um só valor for escrito neles. O `weakTail` devolve o tail não contíguo e o conjunto de buracos abaixo dele, e não é linearizável: basta que seja igual a uma função determinística de alguma varredura não ordenada e não atômica. Quem chama promete que no máximo K endereços estão em andamento, o que limita o conjunto de buracos.
- **Backends baratos.** A semântica fraca permite assentá-lo sobre qualquer armazenamento chave-valor, mesmo sem put condicional. No S3 os autores codificam os endereços de trás para frente para que a listagem devolva as últimas K escritas, no DynamoDB usam uma partition key por drive com o endereço como sort key, e no S3Express (que não lista em ordem lexicográfica) montam uma hierarquia parecida com diretórios e varrem K entradas para trás.
- **Composição por striping e replicação.** Um StripedLogDrive mapeia os endereços no estilo RAID-0 e pega o maior tail entre os stripes. Um QuorumLogDrive escreve em N réplicas e confirma após Qw, em uma ida e volta, com Qr = N - Qw + 1 e reparo de slots ambíguos durante o `weakTail`. Os dois podem ser empilhados em qualquer ordem (parecido com RAID-10 ou com RAID-01).
- **O AtomicLog.** Uma biblioteca de cliente sem estado mais um sequenciador de estado volátil (`acquireSlot` e `completeSlot`) implementa a API Loglet do Delos. Os appends bloqueiam quando a janela de K está cheia e são linearizados na ordem dos endereços, então um único `weakTail` produz um `checkTail` linearizável. Um bit de selo no armazenamento em nuvem dá o `seal`, e um caminho rápido pelo sequenciador atende o `checkTail` até o log ser selado.
- **Conflux e K2.** Um VirtualLog idêntico ao do Delos costura os Loglets, com a composição guardada em um registrador condicional no DynamoDB, então o Conflux pode trocar de backend sem indisponibilidade. O K2 guarda cada tópico como uma lista ordenada de referências a dados, um "log sobre um log" que reaproveita a mesma API nas duas camadas.

## Metodologia

A avaliação mistura benchmarks e dados de produção na AWS, com Kubernetes, discos EBS e monitoramento via Datadog. Nos testes em uma região há um servidor Conflux por zona de disponibilidade, e os testes multirregião espelham de forma síncrona para duas outras regiões a cerca de 60 ms e 120 ms de distância. Os benchmarks usam instâncias m6g.xlarge, timeout de batching de 100 ms, limite de lote de 60KB e K = 16, e os snapshots vão para o S3 a cada 10 minutos. Todas as latências são p99. Os registros têm em média 165 bytes em produção e a razão entre escritas e leituras costuma ser de 1 para 3. O modelo de custo precifica 3 instâncias EC2 mais discos contra um strawman hipotético em DynamoDB, com 2K escritas e 6K leituras por segundo, usando os preços sob demanda do DynamoDB em us-west-2. A correção se apoia em esboços de prova (provas completas em um apêndice) e em um framework de simulação que injeta falhas e atrasos e verifica a linearizabilidade.

## Resultados

Estes são os resultados relatados pelos autores.

- **Intercambiabilidade.** O Conflux roda sobre o S3, sobre o DynamoDB com striping e sobre o S3Express com quorums em três zonas. O código novo por backend é pequeno: 519 linhas para o S3, 528 para o DynamoDB, 525 para o S3Express, 194 para o striping e 325 para os quorums. Um engenheiro construiu um DynamoDBLogDrive com qualidade de produção em cerca de uma semana.
- **Reconfiguração e durabilidade.** Um serviço em execução passou de um quorum (3,3) de DynamoDB em três regiões para (2,3), depois para S3Express (3,3) e (2,3), sem indisponibilidade. A configuração S3Express (2,3) continuou funcionando durante uma queda emulada do S3Express em us-west-2.
- **Custo.** Na carga modelada, os metadados custam US$ 0,69 por hora no Conflux sobre DynamoDB contra US$ 7,20 do strawman (10×), e o custo total é de US$ 3,06 contra US$ 9,57 (mais de 3×, com um plano de dados de US$ 2,37 por hora). O Conflux sobre S3 soma US$ 3,47 e sobre S3Express US$ 3,22.
- **Latência.** O Conflux sobre DynamoDB tem p99 de cerca de 130 ms, o que os autores chamam de lentidão de 6,5× nas escritas em relação ao strawman, aceitável para o caso de uso deles.
- **Produção.** Um cluster K2 em três zonas de us-west-2, com 114 brokers (108 atendendo) e 20 shards Conflux de três servidores cada, sustentou 9GB/s de produce e 27GB/s de fetch. O p99 de produce foi de cerca de 600 ms, o de fetch de cerca de 300 ms, e os metadados comprimiram cerca de 6 a 7×.
- **Migração ao vivo.** Um cluster de acesso antecipado passou do S3 para o DynamoDB sem indisponibilidade, porque o S3 tinha custo e desempenho piores. Os limites de taxa nas partition keys do DynamoDB foram contornados com striping.
- **Testes.** A simulação expôs uma violação de linearizabilidade causada por paginação no drive do S3, o que levou os autores a concluir que o `weakTail` não precisa ser linearizável, e encontrou de forma independente um bug de ordem na checagem do selo no protocolo publicado do VirtualLog do Delos.

## Análise crítica

A separação é limpa, e o argumento de que a replicação só se compõe abaixo do sequenciador convence. O artigo admite vários custos.

- **K pequeno e appends que bloqueiam.** O `weakTail` só é prático para K pequeno, e um append precisa esperar enquanto a janela está cheia, então uma única escrita travada segura os escritores que vêm atrás.
- **Os appends não são altamente disponíveis.** A falha do sequenciador, ou de um cliente que travou depois de obter um slot, deixa o Loglet indisponível para appends até ele ser selado e substituído pelo VirtualLog.
- **A base de custo é hipotética.** Os autores dizem que um shim de produção sobre o DynamoDB exigiria engenharia não trivial, e tratam o strawman como um limite inferior de latência e custo. Os 10× vêm junto com a lentidão de 6,5× nas escritas, e o S3 se mostrou pior que o DynamoDB em custo e em desempenho.
- **O resharding ainda é convencional.** Ele usa um protocolo de transação com locks, e virtualizar um tópico entre shards está apenas sendo explorado.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **O ganho de custo vem mais do log do que do LogDrive.** A economia vem de agrupar escritas pequenas e atender leituras a partir de uma cópia local, algo que qualquer desenho de log mais visão materializada obtém. A contribuição própria do LogDrive é a portabilidade e a composição, e o artigo nunca precifica um desenho em DynamoDB com cache, embora a Seção 2 diga que o cache é o que evitaria o estouro do custo de leitura.
- **Uma carga, uma escala.** A tabela de custo modela 2K escritas e 6K leituras por segundo, com registros de 165 bytes e um fator de compressão de 5×. O cluster de produção tem 20 shards, mas nenhum custo de produção é informado.
- **A evidência de falhas é fina.** O teste de queda é um único evento emulado (controle de acesso desligado), e o artigo não dá o tempo de recuperação de uma falha do sequenciador, mostra a reconfiguração só como linhas do tempo de latência e não diz quantas execuções simuladas foram feitas.
- **A configuração de baixa latência não foi medida.** O artigo constrói um LogServer de nó único em SSD local sob quorums e striping, "para testar esta hipótese", e depois não relata número algum sobre ele.
- **Sem comparação direta com outros logs.** Não há comparação medida com o Loglet nativo do Delos, com o [Scalog](/papers/scalog-seamless-reconfiguration-and-total-order) ou com um armazenamento baseado em Raft. Em relação ao [LazyLog](/papers/lazylog-shared-log-abstraction-for-low-latency-applications) o contraste é conceitual, e o próprio artigo diz que o LazyLog muda quando um timestamp é atribuído, enquanto o Conflux muda qual camada o atribui.
- **Cada backend carrega seu próprio argumento.** As poucas centenas de linhas por drive escondem uma obrigação de prova sobre a semântica de listagem, como mostra o bug de paginação.

## Pesquisas futuras

- Fazer o resharding virtualizando o índice de um tópico entre shards, que o artigo está explorando, no lugar da transação com locks atual.
- Medir o desenho empilhado de baixa latência (LogServer com quorums e striping) contra logs compartilhados baseados em servidores e contra drives apoiados na nuvem, sob a mesma carga.
- Rodar diretamente sobre LogDrives os sistemas serverless e de stream baseados em log que o artigo cita, como o [Boki](/papers/boki-stateful-serverless-computing-with-shared-logs) e o [FlexLog](/papers/flexlog-shared-log-for-stateful-serverless-computing), como os autores sugerem.
- Precificar uma base DynamoDB com cache e testar correção e recuperação sob falhas injetadas no sequenciador, em partições e em vários backends, para separar o efeito do LogDrive do efeito do batching.
