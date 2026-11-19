---
title: "ZooKeeper: coordenação sem espera para sistemas em escala de Internet"
summary: O ZooKeeper, do Yahoo!, é um núcleo de coordenação replicado que expõe nós de dados sem espera (wait-free) com ordem FIFO por cliente e escritas linearizáveis, atende leituras em réplicas locais e deixa as aplicações construírem locks, barreiras, associação a grupos e eleição de líder no lado do cliente.
researchArea: Sistemas distribuídos
keywords: zookeeper, serviço de coordenação, wait-free, zab, difusão atômica, watches, eleição de líder, ordem FIFO por cliente
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Neste artigo, descrevemos o ZooKeeper, um serviço para coordenar processos de aplicações distribuídas. Como o ZooKeeper faz parte de infraestrutura crítica, ele busca oferecer um núcleo simples e de alto desempenho para construir primitivas de coordenação mais complexas no cliente. Ele incorpora elementos de mensagens em grupo, registradores compartilhados e serviços de lock distribuído em um serviço replicado e centralizado. A interface do ZooKeeper tem os aspectos wait-free de registradores compartilhados, com um mecanismo orientado a eventos parecido com as invalidações de cache de sistemas de arquivos distribuídos, e resulta em um serviço de coordenação simples, mas poderoso.

A interface permite uma implementação de alto desempenho. Além da propriedade wait-free, o ZooKeeper garante por cliente a execução FIFO das requisições e a linearizabilidade de todas as requisições que alteram o estado. Essas decisões permitem um pipeline de processamento de alto desempenho, com as leituras atendidas por servidores locais. Para as cargas-alvo, com razão de leitura para escrita de 2:1 a 100:1, mostramos que o ZooKeeper trata de dezenas a centenas de milhares de transações por segundo. Esse desempenho permite que as aplicações usem o ZooKeeper de forma intensa.

## Visão geral

Aplicações distribuídas grandes precisam de configuração, associação a grupos, eleição de líder e locks. O [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems), do Google, respondeu com um serviço de locks, e com locks se constrói o resto. Os autores do Yahoo! (Hunt, Konar, Junqueira e Reed) fizeram a escolha oposta no ATC 2010: em vez de primitivas no servidor, o ZooKeeper expõe uma pequena API parecida com a de um sistema de arquivos sobre objetos de dados wait-free e deixa cada aplicação montar suas próprias primitivas. Operações bloqueantes como locks ficaram fora da API porque um cliente lento ou defeituoso poderia atrasar os mais rápidos.

Ser wait-free, sozinho, não dá coordenação, então o artigo o combina com garantias de ordem. As escritas são linearizáveis, no sentido de [Herlihy e Wing](/papers/linearizability-correctness-condition-concurrent-objects). As requisições de cada cliente executam em ordem FIFO. As leituras não são linearizáveis: são atendidas pela réplica à qual o cliente está conectado. Por baixo, as escritas são totalmente ordenadas por um protocolo de difusão atômica, o Zab, no espírito da [abordagem de máquina de estados](/papers/state-machine-approach-fault-tolerant-services-tutorial) e aparentado ao [Paxos](/papers/paxos-made-simple).

Vale conhecer antes: máquinas de estados replicadas, quóruns e a diferença entre linearizabilidade e ordenações mais fracas.

## Contribuição

- **Um núcleo de coordenação.** Um espaço de nomes hierárquico de znodes (regulares ou efêmeros, opcionalmente sequenciais), com create, delete, exists, getData, setData, getChildren e sync, sem open nem close. As atualizações recebem uma versão esperada, o que permite escritas condicionais.
- **Duas garantias de ordem.** Escritas linearizáveis e ordem FIFO por cliente. O artigo chama sua variante de A-linearizabilidade: um cliente pode ter várias operações pendentes, e o sistema ainda respeita a ordem em que o cliente as emitiu.
- **Watches.** Gatilhos de uso único que avisam o cliente de que um dado mudou, sem entregar o novo valor, de modo que o cliente possa manter cache sem que o servidor gerencie esse cache.
- **Receitas.** Gerenciamento de configuração, associação a grupos, rendezvous, locks simples, locks sem efeito manada, locks de leitura e escrita e barreiras duplas, todos implementados no cliente.
- **Experiência.** Usos no Yahoo! (o Fetching Service e o Yahoo! Message Broker) e no Katta, um indexador distribuído de fora do Yahoo!, além de uma avaliação de desempenho.

## Metodologia

O artigo combina projeto de API, descrição da implementação e avaliação medida. O servidor mantém toda a árvore de dados em memória, replicada em cada servidor, com um log de escrita antecipada forçado em disco antes de as mudanças serem aplicadas e snapshots "fuzzy" periódicos, tirados sem travar a árvore. As escritas vão para um líder, que transforma cada requisição em uma transação idempotente e a difunde com o Zab. Como as transações são idempotentes, o Zab pode reentregar mensagens durante a recuperação, desde que preserve a ordem.

A avaliação rodou em um cluster de 50 servidores (Xeon dual-core de 2,1 GHz, 4 GB de RAM, ethernet gigabit, dois discos SATA). Trinta e cinco máquinas simularam 250 clientes simultâneos usando a API Java assíncrona, cada um com pelo menos 100 requisições pendentes, lendo ou escrevendo 1K de dados. Os experimentos cobrem a vazão de um sistema saturado, falhas injetadas (um ensemble de cinco servidores com 30% de escritas constantes), a latência das requisições com um benchmark modelado a partir do do Chubby e o desempenho de barreiras.

## Resultados

- **Leituras escalam com os servidores, escritas não.** Com 100% de leituras, a vazão foi de 87 mil operações por segundo com 3 servidores e 460 mil com 13. Com 0% de leituras, caiu de 21 mil com 3 servidores para 8 mil com 13, porque toda escrita passa pela difusão atômica.
- **A distribuição de carga importa.** Quando os clientes eram forçados a se conectar apenas ao líder, como no Chubby, a vazão ficou muito menor, mesmo em cargas dominadas por escrita.
- **Recuperação rápida.** No experimento de falhas, o ZooKeeper levou menos de 200 ms para eleger um novo líder, e a falha de um seguidor reduziu a vazão apenas na parcela de leituras que ele atendia.
- **Latência.** Um único worker viu latência média de 1,2 ms por requisição com três servidores e 1,4 ms com nove. A vazão de creates foi mais de 3 vezes a publicada para o Chubby.
- **Barreiras.** Com 50 a 200 clientes e 200 a 1600 barreiras, o tempo cresceu de forma aproximadamente linear com o número de barreiras, e a vazão de barreiras ficou entre 1.950 e 3.100 operações por segundo.
- **O pipeline compensa.** Atualizar 5000 znodes a cerca de 2 milissegundos cada leva 10 segundos uma a uma, mas menos de um segundo quando emitidas de forma assíncrona.
- **Cargas reais.** O Fetching Service teve razões de leitura para escrita entre 10:1 e 100:1 acima de 1.000 operações por segundo.

## Análise crítica

- **Leituras podem ser antigas.** O artigo afirma com clareza que uma leitura pode devolver um valor velho mesmo que uma atualização mais nova tenha sido confirmada. O remédio é sync seguido de leitura, que custa mais ou menos uma escrita leve. As aplicações precisam saber onde dependem disso.
- **As garantias foram escolhidas para a carga.** O projeto serve ao uso dominado por leitura nos tamanhos testados; os números de escrita mostram que ensembles maiores trocam vazão de escrita por tolerância a falhas.
- **O desempenho ainda não foi otimizado.** Os autores dizem que o foco até então foi correção e robustez, e citam cópias extras e serialização repetida como custos evidentes.
- **Modelo de falhas.** Supõe-se que os servidores falham por parada e se recuperam. Falhas bizantinas não são tratadas, embora checksums e verificações de sanidade peguem algumas não maliciosas, e os autores dizem não ter observado em produção falhas que um protocolo totalmente tolerante a bizantinos teria evitado. Para esse cenário, veja o [PBFT](/papers/practical-byzantine-fault-tolerance).
- **Escopo da avaliação.** Um tipo de cluster e uma família de benchmarks, com a comparação ao Chubby feita sobre números publicados, não em um teste direto.
- **Livro vs hoje.** A separação entre um núcleo de modelo de dados e receitas no cliente virou um padrão amplamente usado, enquanto sistemas posteriores baseados em [Raft](/papers/raft-understandable-consensus-algorithm) passaram a oferecer leituras consistentes como opção.

## Pesquisas futuras

- Eliminar o custo das leituras antigas sem perder as leituras locais, por exemplo com leases nas réplicas.
- Aumentar a vazão de escrita particionando os dados entre ensembles, um compromisso que o artigo menciona a partir de Gray et al.
- Um ZooKeeper totalmente tolerante a falhas bizantinas sem alterar o código do servidor, como o artigo cita.
- Substitutos mais fáceis de entender para o Zab, como variantes do [Paxos](/papers/paxos-made-simple) e o Raft.
- Receitas corretas de locks e barreiras no cliente, já que erros sutis são fáceis de cometer.
