---
title: "Replicação em cadeia para suportar alta vazão e disponibilidade"
summary: Van Renesse e Schneider organizam as réplicas de um objeto numa cadeia em que a cabeça recebe as atualizações e a cauda responde às consultas, e mostram por simulação que isso dá consistência forte com vazão e disponibilidade pelo menos iguais às do primário/backup.
researchArea: Sistemas distribuídos
keywords: replicação em cadeia, consistência forte, servidores fail-stop, primário/backup, serviços de armazenamento, posicionamento de réplicas, recuperação de dados
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Chain replication is a new approach to coordinating clusters of fail-stop storage servers. The approach is intended for supporting large-scale storage services that exhibit high throughput and availability without sacrificing strong consistency guarantees. Besides outlining the chain replication protocols themselves, simulation experiments explore the performance characteristics of a prototype implementation. Throughput, availability, and several object-placement strategies (including schemes based on distributed hash table routing) are discussed.

## Visão geral

Em 2004, grandes serviços online (o paper cita Amazon.com, Google e a FAST, a empresa de busca dos próprios autores) precisavam de um armazenamento a meio caminho entre um sistema de arquivos e um banco de dados: objetos com consultas sobre um único objeto e atualizações atômicas de um único objeto. Quem projetava esses sistemas muitas vezes abria mão da consistência forte para manter vazão e disponibilidade, e o paper usa o [Google File System](/papers/google-file-system) como exemplo dessa escolha. Os autores argumentam que essa troca não é obrigatória.

A replicação em cadeia é apresentada como uma forma de primário/backup, que por sua vez é uma instância da [abordagem de máquina de estados](/papers/state-machine-approach-fault-tolerant-services-tutorial) (Schneider escreveu aquele tutorial e é coautor deste paper). O protótipo também usa Paxos, citado como [O parlamento de meio período](/papers/paxos-part-time-parliament), para tornar tolerante a falhas o seu serviço de configuração, então [Paxos simplificado](/papers/paxos-made-simple) é uma boa leitura de apoio. Para o vocabulário de consistência forte, veja [linearizabilidade](/papers/linearizability-correctness-condition-concurrent-objects). Este paper define a sua própria garantia em duas partes (as operações sobre um objeto rodam em alguma ordem sequencial e as atualizações aparecem nas consultas seguintes), que para objetos individuais é próxima da linearizabilidade, embora o paper não use essa palavra.

Vale saber antes: o modelo de falhas fail-stop (o servidor para em vez de se comportar de forma errada, e a parada pode ser detectada), a ideia de replicação primário/backup e por que uma réplica precisa aplicar as atualizações numa única ordem.

## Contribuição

- **A cadeia.** Os servidores que guardam um objeto ficam em ordem linear. As atualizações vão para a cabeça e percorrem enlaces FIFO confiáveis até a cauda. Toda resposta é gerada pela cauda, e toda consulta é enviada à cauda e processada lá.
- **Consistência forte por construção.** Consultas e atualizações são processadas em série por um único servidor, a cauda. O novo valor é calculado uma vez, pela cabeça, e repassado, então as outras réplicas só fazem uma escrita e a atualização pode ser não determinística.
- **Um mestre para a reconfiguração.** Um serviço mestre detecta falhas de servidores, informa a cada servidor seu novo predecessor ou sucessor e informa aos clientes quem é a cabeça e quem é a cauda. Na exposição o paper trata o mestre como um único processo que nunca falha, e diz que o protótipo o replica usando Paxos.
- **Tratamento de falhas com dois invariantes.** O Update Propagation Invariant diz que o histórico de cada servidor é prefixo do histórico do seu predecessor. O Inprocess Requests Invariant diz que o histórico de um servidor é igual ao do seu sucessor mais a lista de atualizações que ele repassou e a cauda ainda não confirmou. Juntos, cobrem a remoção da cabeça, da cauda ou de um servidor do meio e a adição de uma nova cauda.
- **Uma comparação com o primário/backup** em atrasos de mensagem e em simulação, além de um estudo de como o posicionamento das réplicas afeta a disponibilidade.

## Metodologia

O argumento tem duas partes. A primeira é uma especificação: a visão do cliente sobre um objeto é um histórico de atualizações e um conjunto de requisições pendentes, com três transições (requisição chega, requisição ignorada, requisição processada). O paper então mostra que toda ação de um servidor na cadeia é uma não operação ou uma dessas transições, incluindo cada caso de reconfiguração. A nota de rodapé 2 diz que uma implementação real guardaria o valor atual em vez da sequência de atualizações, e que a sequência serve para facilitar o argumento de consistência.

A segunda parte é a simulação. O protótipo rodou numa rede simulada com largura de banda infinita e 1 ms por mensagem, com um "serviço nulo". A latência de consulta num servidor foi fixada em 5 ms, a de atualização na cabeça em 50 ms e a de processar uma mensagem de diferença de objeto em 20 ms, valores que o paper diz vir de um índice de busca na web. Foram comparadas quatro variantes: chain, p/b, weak-chain e weak-p/b (nas fracas, as consultas vão para um servidor qualquer). Os experimentos seguintes usaram 5000 volumes com 3 réplicas, injeção de falhas com 24 servidores e um estudo do tempo médio entre indisponibilidades de três estratégias de posicionamento.

## Resultados

- **Uma cadeia, sem falhas.** A replicação em cadeia tem vazão igual ou melhor que a do primário/backup para toda porcentagem de atualizações e para t igual a 2, 3 e 10, porque cabeça e cauda dividem um trabalho que o primário faz sozinho. Com 3 servidores uma atualização leva 94 ms e uma consulta 7 ms. A vazão das duas não depende de t quando há requisições suficientes em pipeline.
- **Variantes fracas.** Ganham em cargas dominadas por consultas, mas ficam piores que a cadeia acima de 15% de atualizações, porque as consultas atendidas na cabeça competem com o trabalho lento de atualização. O paper vê poucos cenários em que seriam preferíveis.
- **Interrupção após uma falha, em atrasos de mensagem.** Falha da cabeça: atualizações indisponíveis por 2 atrasos. Falha da cauda: consultas e atualizações indisponíveis por 2 atrasos. Falha no meio não causa interrupção, mas atrasa uma atualização (4 atrasos). No primário/backup, a falha do primário custa 5 atrasos e a de um backup, no máximo 1. O pior caso da cadeia é menor que o pior caso do primário/backup.
- **Várias cadeias.** Com 5000 volumes replicados três vezes, as quatro variantes mostraram pouca ou nenhuma diferença.
- **Falhas sob carga.** Com 24 servidores e 150 GB por servidor, o mestre simulado levou um pouco mais de 10 segundos para detectar a falha e remover o servidor, e a vazão ficou em zero por esse tempo. Depois disso a vazão de atualização ficou melhor que a inicial, porque algumas cadeias encolheram para tamanho 2. A vazão de consulta continuou menor após a recuperação, porque o servidor recuperado é a cauda de toda cadeia em que entra e a carga deixa de ser equilibrada.
- **Posicionamento.** Com MTBF de 24 horas por servidor, o posicionamento em anel (estilo DHT) exigia cadeias mais longas conforme o número de servidores crescia, aproximadamente de forma logarítmica. O posicionamento aleatório com recuperação paralela limitada (rndseq) foi pior que o anel para t acima de 1, mas o aleatório com recuperação paralela total (rndpar) acabou superando os dois.
- **Tamanho.** O protótipo tem 1500 linhas de Java, mais 2300 linhas de Java para uma biblioteca de Paxos.

## Análise crítica

A ideia é simples e o paper é honesto sobre seus limites, mas alguns pontos merecem atenção.

- **Tudo depende da detecção de falhas.** O modelo é fail-stop e o mestre é suposto nunca falhar. Sistemas reais têm servidores lentos e partições de rede, e o paper diz que a replicação em cadeia não trata bem a operação particionada. Remover servidores da cadeia por uma suspeita errada é o que torna o mestre delicado na prática.
- **Os números são simulados.** Largura de banda infinita, serviço nulo e latências fixas mostram o formato do protocolo, não o comportamento em produção. Não há experimento em hardware real.
- **A disseminação serial custa latência.** O paper admite que uma atualização espera a soma dos saltos, contra o máximo no primário/backup paralelo. As simulações mostram vazão pelo menos igual à do primário/backup mesmo assim.
- **A cauda é um ponto quente.** Todas as consultas de uma cadeia vão para um só servidor, e o próprio experimento de falhas do paper mostra desequilíbrio de carga causado pelas caudas.
- **Só operações sobre um objeto,** sem transações entre objetos (nota de rodapé 1).
- **Prova informal.** Os invariantes são argumentados em prosa, não mecanizados.

Literatura posterior, que não faz parte deste paper: o CRAQ, de Terrace e Freedman (USENIX ATC 2009), parte exatamente do gargalo da cauda. Ele deixa qualquer nó responder leituras de versões limpas de um objeto e manda a leitura de uma versão suja para a cauda, e usa o ZooKeeper para gerenciar a composição da cadeia. Compare também como o [serviço de locks Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems) e o [ZooKeeper](/papers/zookeeper-wait-free-coordination-internet-scale-systems) cumprem o papel que aqui é do mestre, e como o [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) e a [conjectura de Brewer](/papers/brewers-conjecture-cap-feasibility-web-services) enquadram a escolha deste paper (consistência em vez de tolerância a partições).

## Pesquisas futuras

- Implantações em área ampla ou heterogêneas, onde os autores dizem que o posicionamento dependeria de padrões de acesso, proximidade de rede e confiabilidade observada dos hosts, e onde protocolos para reordenar uma cadeia seriam necessários.
- Balancear leituras entre as réplicas sem perder a consistência forte, como faz o CRAQ.
- Trocar o detector fail-stop suposto e o mestre que nunca falha por um serviço de configuração tolerante a falhas totalmente especificado.
- Suporte a operações sobre vários objetos.
- Comparar a replicação em cadeia com protocolos baseados em consenso, como o [Raft](/papers/raft-understandable-consensus-algorithm), em hardware real.
