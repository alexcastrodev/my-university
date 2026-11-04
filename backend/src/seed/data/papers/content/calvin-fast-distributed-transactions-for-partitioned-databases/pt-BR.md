---
title: "Calvin: transações distribuídas rápidas para sistemas de banco de dados particionados"
summary: O Calvin é uma camada de escalonamento e replicação sobre um armazenamento não transacional que define uma ordem global de transações antes de qualquer lock, o que elimina os protocolos de commit distribuído e permite que transações ACID em várias partições escalem em máquinas comuns.
researchArea: Sistemas distribuídos
keywords: bancos de dados determinísticos, transações distribuídas, two-phase commit, locking determinístico, replicação, paxos, tpc-c
version: 1.0
updatedAt: 2026-11-03
---

## Visão geral

O two-phase commit é caro principalmente pelo que faz com os locks. Uma transação precisa manter seus locks durante várias idas e voltas de rede, e em registros populares esse tempo extra prejudica o throughput. Os autores, de Yale, chamam o tempo total em que uma transação mantém seus locks de contention footprint, e muitos sistemas da época evitavam o problema eliminando ou limitando as transações.

Este artigo do SIGMOD 2012 muda o lugar do acordo. As máquinas concordam sobre o que fazer "outside of transactional boundaries" (fora dos limites da transação), antes de pegar os locks. Todos os nós concordam sobre quais transações tentar e em que ordem, e cada réplica executa esse plano de forma determinística. A falha de um nó não precisa mais abortar uma transação, porque uma réplica pode terminá-la, e a lógica que pode abortar de forma determinística precisa apenas de mensagens de mão única. Assim, o protocolo de commit pode sair. O Calvin também elimina duas restrições do trabalho anterior do grupo: um sequenciador de um só nó e dados inteiramente em memória principal.

Vale conhecer antes: two-phase locking, two-phase commit, Paxos e equivalência serial. Uma nota de rodapé deixa claro que alta disponibilidade aqui significa fazer failover para uma réplica ativa, não o sentido do teorema CAP.

## Contribuição

- **Três camadas.** Um sequenciador fixa a ordem global e a replica, um escalonador executa as transações com locking determinístico, e o armazenamento é qualquer engine com interface CRUD.
- **Um sequenciador distribuído.** Cada máquina reúne pedidos em épocas de 10 ms e replica seu lote. Cada escalonador então monta a ordem global intercalando os lotes de todos os sequenciadores em um round-robin determinístico.
- **Replicação de entradas.** Entradas, não efeitos, são replicadas de forma assíncrona a partir de uma réplica mestre ou de forma síncrona com Paxos, por meio do ZooKeeper.
- **Locking determinístico.** Uma única thread pede os locks de cada transação na ordem global, e os locks são concedidos estritamente na ordem dos pedidos. Por isso, as transações precisam declarar antes todo o seu conjunto de leitura e escrita.
- **OLLP.** Uma transação que precisa ler para descobrir seus conjuntos de leitura e escrita é precedida por uma consulta de reconhecimento, e é reiniciada de forma determinística se esses conjuntos tiverem mudado.
- **Prefetching e checkpointing.** O sequenciador atrasa uma transação que pode tocar o disco enquanto seus registros são aquecidos. Uma variante do Zig-Zag faz checkpoint em um ponto da ordem global sem parar o banco, e registrar as entradas substitui o log físico de REDO.

## Metodologia

Os experimentos rodaram no Amazon EC2, com até 100 nós. A implementação do TPC-C roda apenas transações New Order, com 10 warehouses por partição. Cerca de 10% delas acessam um segundo warehouse, sempre em outra máquina. Um microbenchmark usa um índice de contenção, a fração de registros quentes que cada transação atualiza em uma máquina.

Os modos de replicação foram comparados a 10.000 transações por segundo por nó, 10% multipartição, com três réplicas de 4 máquinas. O comportamento com disco foi testado a 10.000 transações por segundo por máquina, com um engine simples de sistema de arquivos e com um engine que simula o atraso de armazenamento usando a memória de outra máquina. Nenhum sistema tradicional foi executado: a linha de two-phase commit no experimento de alta contenção vem de um modelo simples, com throughput limitado a 1 / (C * D), em que C é o índice de contenção e D é um tempo esperado de lock de cerca de 8 ms, supondo uma base de 27.000 transações por segundo por máquina.

## Resultados

Estes são os resultados relatados pelos autores.

- **TPC-C New Order.** Cerca de 5.000 transações por segundo por nó em clusters com mais de 10 nós, e quase meio milhão em 100 nós. Os autores colocam isso ao lado do recorde da Oracle, de 504.161 transações New Order por segundo em hardware muito superior.
- **Forma da escalabilidade.** O throughput por nó cai fortemente de uma máquina para duas, por causa do custo de CPU do trabalho multipartição. Depois ele se estabiliza por volta de 10 máquinas com índice de contenção 0,0001 e declina mais gradualmente com 0,01, o que os autores atribuem ao desvio de progresso na execução: uma máquina pode ter de esperar outra alcançá-la.
- **Custo de multipartição.** Com 100% de transações multipartição e baixa contenção, o microbenchmark cai de 27.000 para cerca de 5.000 (4 nós) ou 4.000 (8 nós) transações por segundo, uma desaceleração de cerca de 5x a 7x.
- **Alta contenção.** Com contenção muito alta, o modelo de two-phase commit desacelera significativamente mais que o Calvin, mesmo ignorando vários custos. Os autores leem isso como evidência de que o protocolo de commit é um obstáculo importante ao suporte ACID e de que o Calvin o atenua.
- **Replicação.** O throughput total não foi afetado pelo modo de replicação, incluindo Paxos entre três regiões com ping de 100 a 170 ms.
- **Disco.** Com o engine de sistema de arquivos, o throughput se manteve enquanto no máximo 0,9% das transações tocavam o disco, limite que os autores atribuem a discos de baixo custo. Com índice de contenção 0,01, isso exigiu um atraso artificial de 40 ms. O engine simulado sustentou 10.000 transações por segundo por máquina, não importando quantas tocassem dados frios.

## Análise crítica

O argumento central é forte: manter locks durante o acordo custa caro sob contenção, e o acordo pode acontecer antes. As evidências são mais estreitas que as afirmações de destaque.

O próprio artigo declara vários limites. Locks de intervalo e proteção contra fantasmas ficam para trabalho futuro. O determinismo proíbe reordenar, então uma transação parada bloqueia as sucessoras em conflito. Rastrear quais chaves estão em memória em todos os nós "is not a scalable solution" (não é uma solução escalável). Depois de um crash, o throughput no restante da réplica "is apt to slow or halt" (tende a cair ou parar) até o fim da recuperação. Os autores chamam o modelo de 2PC de "somewhat naïve" (um tanto ingênuo), e o apresentam como um limite inferior para a desaceleração de um concorrente.

O restante é uma leitura das evidências, não uma afirmação dos autores.

- **A comparação com 2PC é aritmética.** O artigo anuncia "a detailed comparison to a traditional system" (uma comparação detalhada com um sistema tradicional), mas nenhum sistema assim rodou. A fórmula dá 125 transações por segundo com C = 1, resultado que depende das entradas de 8 ms e 27.000.
- **Remover o 2PC não torna barato o trabalho multipartição.** A desaceleração de 5x a 7x do próprio Calvin aparece com baixa contenção, e o artigo a liga ao custo de CPU do trabalho multipartição e ao desvio de execução.
- **A equiparação com o TPC-C é parcial.** O Calvin rodou um tipo de transação, e um desempenho semelhante no benchmark completo é uma expectativa, então a comparação com um recorde publicado envolve cargas diferentes. Isso também deixa o OLLP sem medição: o exemplo do artigo, o Payment do TPC-C, não está na carga, e as taxas de reinício são argumentadas a partir da raridade com que campos indexados mudam.
- **A ausência de custo foi testada em uma única carga.** Os modos de replicação foram comparados a uma taxa fixa de 10.000 transações por segundo por nó, e o texto não diz quão perto do pico essa taxa está. A seção 6 não informa um modo de replicação para os testes de escala, então escala e replicação geográfica não aparecem juntas. A latência é o preço admitido.
- **O tratamento de falhas é argumentado, não medido.** A avaliação não relata tempo de failover nem de recuperação, então não ter ponto único de falha é uma propriedade do projeto, não um resultado medido.
- **Sequenciadores lentos não são avaliados.** O artigo documenta o desvio de execução, não o efeito de um sequenciador lento no round-robin. O [artigo posterior do Scalog](/papers/scalog-seamless-reconfiguration-and-total-order) descreve sua própria intercalação como uma generalização dessa ideia que não é sensível a servidores lentos. Essa afirmação é do Scalog, não do Calvin.

## Pesquisas futuras

- Pontos em aberto citados pelo artigo: locks de intervalo por meio de recursos virtuais, atrasar transações multipartição sem rastreamento global de chaves, o compromisso entre latência e contenção ao prever a latência de disco, e um failover mais transparente.
- Um experimento direto contra um sistema real e bem ajustado de two-phase commit.
- A mistura completa do TPC-C, com taxas de reinício do OLLP medidas em cargas nas quais os campos indexados mudam de fato.
- Escala e replicação Paxos entre regiões medidas juntas, em saturação, com falhas injetadas.
