---
title: "Autobahn: BFT de alta velocidade e sem interrupção"
summary: O Autobahn separa a disseminação de dados, em que cada réplica faz crescer sua própria cadeia certificada, de um consenso no estilo PBFT que ordena instantâneos dessas cadeias, de modo que um líder parado não deixa um backlog que continue prejudicando a latência depois que o progresso volta, enquanto a latência fica próxima à do BFT tradicional e o throughput próximo ao dos protocolos DAG.
researchArea: Sistemas distribuídos
keywords: tolerância a falhas bizantinas, replicação de máquina de estados, sincronia parcial, bft baseado em dag, lanes de dados, hangovers, seamlessness
version: 1.0
updatedAt: 2026-11-07
---

## Visão geral

A replicação de máquina de estados (SMR) tolerante a falhas bizantinas (BFT) dá aos clientes a abstração de um único servidor confiável e sempre disponível, mesmo quando até f de 3f+1 réplicas se comportam mal. Ela está por baixo de blockchains, projetos de moedas digitais e sistemas de confiança distribuída. Os protocolos em produção assumem sincronia parcial: são sempre seguros, mas só prometem progresso depois de um Global Stabilization Time (GST) desconhecido, que os sistemas reais imitam com timeouts crescentes. Os autores argumentam que as implantações reais são parcialmente síncronas de forma intermitente, com intervalos bons interrompidos por blips (um timeout dispara, um líder é trocado, o progresso para), e que os protocolos existentes precisam escolher entre baixa latência nos intervalos bons e recuperação suave dos blips.

Este artigo do SOSP 2024 (Austin), de Neil Giridharan e Natacha Crooks (UC Berkeley), Florian Suri-Payer e Lorenzo Alvisi (Cornell University) e Ittai Abraham (Intel Labs), chama de hangover o dano que um blip deixa para trás. Protocolos tradicionais como o HotStuff amarram a disseminação de dados à ordenação, então uma parada forma um backlog que leva tempo para ser escoado. Protocolos baseados em DAG, como o Bullshark, se recuperam melhor, mas precisam de até 12 atrasos de mensagem (mds) para confirmar.

Termos principais: um **intervalo bom** é síncrono e tem um líder correto, e um **gracioso** também tem todas as réplicas corretas. Um **hangover** é uma degradação de desempenho causada por um blip que dura mais que o blip. Um protocolo é **seamless** (contínuo) se não tem hangovers induzidos pelo protocolo e não acrescenta nenhum mecanismo que o torne mais suscetível a blips. A camada de dados do Autobahn é feita de **lanes**, uma por réplica, construídas com **cars**, e seu consenso ordena **cortes** (cuts) das pontas das lanes.

Vale conhecer antes: SMR e interseção de quóruns, em [Paxos Made Simple](/papers/paxos-made-simple), e a eleição de líder por timeout como no [Raft](/papers/raft-understandable-consensus-algorithm). Os dois tratam apenas falhas por parada, e o artigo não cita nenhum deles, já que suas referências de consenso são o PBFT e o HotStuff. Também o [Scalog](/papers/scalog-seamless-reconfiguration-and-total-order), que o artigo cita como exemplo de separação entre disseminação e ordenação para falhas por parada.

## Contribuição

- **Hangovers e seamlessness.** A seamlessness exige disseminação responsiva (progresso no ritmo da rede) e um commit enxuto (toda proposta disseminada é confirmada em tempo limitado, com custo independente de quantas transações estão esperando). A camada de dados precisa oferecer referência instantânea, sync sem bloqueio (sem buscar dados antes de votar) e sync oportuno (a busca termina até a hora do commit).
- **Lanes e cars.** Cada réplica agrupa transações em lotes na sua própria lane, no seu próprio ritmo. Um car é uma troca de Propose e Vote, e f+1 votos formam uma Proof of Availability (PoA), então pelo menos uma réplica correta tem os dados. Uma proposta referencia a anterior, e as réplicas votam na posição i só depois de votar em i-1, de modo que uma ponta certificada prova todo o seu histórico. O Autobahn dispensa de propósito o reliable broadcast e não impede que lanes bizantinas façam fork.
- **Consenso sobre cortes.** O líder de um slot propõe um vetor de n pontas certificadas. O protocolo é no estilo PBFT: Prepare (2f+1 votos formam um PrepareQC) e depois Confirm (2f+1 confirmações formam um CommitQC), 5 mds no total. Se o líder reúne os n votos de Prepare, confirma após 3 mds (caminho rápido). Um líder só propõe depois de pelo menos n-f pontas novas (2f+1, ajustável, chamado de cobertura de lanes), e o custo não cresce com o backlog.
- **Sync fora do caminho crítico.** As réplicas votam sem ter os dados e depois pedem às f+1 réplicas que certificaram uma ponta o trecho que falta da lane, com um pedido e uma resposta, e intercalam as lanes em um único log com uma função determinística.
- **Troca de view e slots paralelos.** Após um certificado de timeout com 2f+1 reclamações, o novo líder repropõe o maior entre o PrepareQC mais alto e a proposta mais alta vista f+1 vezes, o que cobre os dois caminhos. Os slots se sobrepõem (o próximo começa no primeiro Prepare do anterior), são limitados a k simultâneos por tickets de CommitQC, e os calendários de eleição são deslocados por f.
- **Otimizações e garantias.** Pontas do líder e pontas otimistas (não certificadas) reduzem a latência de inclusão, com votos fracos e fortes para evitar paradas. O apêndice traz provas de segurança e de vivacidade, um argumento de seamlessness e um limite de f vezes o tamanho do lote para os dados de lanes bizantinas que nunca serão confirmados e que uma réplica correta pode guardar.

## Metodologia

Os autores escreveram um protótipo em Rust a partir do código aberto do Narwhal e do Bullshark, com TCP do Tokio, RocksDB e ed25519-dalek. As bases de comparação são o Bullshark, o BatchedHS (um protótipo de HotStuff que transmite lotes e propõe hashes, que os autores chamam de limite superior e não robusto) e o VanillaHS (a alteração deles para que os lotes viajem só com as propostas da própria réplica emissora).

Tudo rodou no Google Cloud em quatro regiões dos EUA (tempos de ida e volta entre regiões de 19 a 64 ms), em máquinas t2d-standard-16, com clientes na mesma região enviando transações no-op de 512 bytes, lotes de 500KB, líderes rotativos, timers de view de 1 s e rodadas de 60 s. A latência vai da chegada em uma réplica até estar pronta para executar, então o tempo de ida e volta do cliente fica de fora. Os testes de caso bom usam n = 4 e a escala vai até 20. Os testes de blip usam n = 4: uma falha única de líder (com um ou dois timeouts do HotStuff, e também um timeout de 5 s) e uma partição de 20 s em duas metades.

## Resultados

Estes são os resultados relatados pelos autores.

- **Intervalos bons.** O Autobahn iguala o throughput do Bullshark, cerca de 234K tx/s, e reduz a latência em 2,1× (de 592 ms para 280 ms), abaixo do BatchedHS (333 ms) e do VanillaHS (365 ms). Os autores contam 7 mds para o HotStuff, até 12 para o Bullshark (10,5 em média) e 4 para o Autobahn no caminho rápido, 6 nos demais casos (com pontas otimistas).
- **Throughput.** O Autobahn e o Bullshark ficam à frente do BatchedHS (cerca de 189K tx/s) por 1,23× e do VanillaHS (cerca de 15K tx/s) por 15,6×, e são limitados pelo custo de desserializar e armazenar dados. O BatchedHS sofre com muita sincronização de dados sob carga alta, às vezes com trocas de view.
- **Ablações.** Forçar o caminho lento soma 40 ms, e propor só pontas certificadas soma 33 ms. Os gráficos foram omitidos por falta de espaço.
- **Mais réplicas.** O Autobahn e o Bullshark escalam bem até n = 20, com a latência inalterada. O BatchedHS perde 16% do throughput em n = 12 e 41% em n = 20. Com a latência limitada a 2 s, o VanillaHS cai de 15K para 1,5K tx/s.
- **Falhas de líder.** Em um blip de 3 s, o VanillaHS chega a 6,2 s de latência e ainda está em 1,3 s três segundos depois do blip, contra 365 ms em regime estável. Os autores relatam hangovers de 1,2× a 1,6× a duração do blip nos vários cenários, e quase 7 s depois de um timeout de 5 s. O Autobahn, a 220K tx/s, se recupera imediatamente.
- **Partição.** As lanes continuam crescendo porque as réplicas alcançam f+1 outras, e um slot confirma todo o backlog assim que a partição se desfaz. Cerca de 1 s vai para mover e processar os dados que faltam, o que os autores chamam de hangover inevitável, não causado pelo protocolo. O Bullshark e o BatchedHS levam cerca de 9 s (o Bullshark não consegue avançar o DAG sem 2f+1 nós, e o BatchedHS precisa limitar as referências de lotes por proposta), e o VanillaHS sofre um hangover proporcional ao blip.

## Análise crítica

A ideia é clara e a avaliação responde às três perguntas que propõe. O artigo admite vários limites.

- **As pontas otimistas abrem mão da seamlessness.** A seção 5.5.2 e o apêndice dizem que elas podem colocar uma proposta de dados por lane no caminho crítico dos timeouts, e o argumento de seamlessness não as cobre. Os autores sugerem somar 2Δ ao timeout e um esquema de reputação local à réplica, que não foi implementado.
- **Nem todo hangover é evitado.** Largura de banda e recuperação depois de uma partição continuam, o consenso ainda pode parar durante um blip, e a cobertura de lanes é de melhor esforço, então um líder bizantino que a ignora se comporta como um líder parado.
- **Partes são discutidas, não construídas.** Cars em pipeline, ride sharing e reputação não estão no protótipo nem na avaliação.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **As configurações dos números de destaque podem diferir.** A latência de 280 ms usa pontas otimistas, que pela própria definição do artigo não são seamless, e o texto não diz se os experimentos de blip as usaram. O custo de só usar pontas certificadas é de 33 ms, então a diferença provavelmente é pequena, mas ela não é mostrada.
- **A evidência de blips é fina.** A figura de falha de líder mostra só o VanillaHS contra o Autobahn, dizendo que o Bullshark e o BatchedHS se comportam como o Autobahn, então a vantagem sobre os protocolos DAG repousa em um único teste de partição. O texto chama a recuperação deles de "um pouco mais longa" para cerca de 9 s contra cerca de 1 s. A introdução diz que o hangover do HotStuff após um blip de 3 s é 30% maior que o blip, enquanto a seção 6.2 lista 1,6×, 1,3× e 1,2× "respectivamente" sem ligar cada valor a um cenário, e o texto não concilia os dois.
- **As cargas variam.** O teste de partição roda todos os sistemas a 15K tx/s, menos de um décimo do pico do Autobahn, enquanto o teste de falha de líder roda o Autobahn a 220K e o VanillaHS a 15K. A recuperação de uma partição sob carga alta não é mostrada.
- **As falhas são leves.** Os testes de blip usam n = 4, uma falha de líder simulada e uma partição. Nenhuma rodada tem uma lane com equivocação, dados retidos ou inundação, embora a coleta de lixo de forks e o desperdício limitado sejam argumentados analiticamente e as pontas otimistas sejam a parte mais exposta a proponentes bizantinos.
- **A escala é plana, não crescente.** A carga total é mantida constante conforme n cresce, então os resultados mostram ausência de perda, enquanto o desenho afirma um throughput que cresce com as réplicas. Uma nota de rodapé diz que taxas constantes por réplica fariam o throughput subir com n, mas essa rodada não é mostrada. O texto também diz que o VanillaHS é "1,3 vez mais lento" com n = 4 e "mais de 6,6 vezes mais lento" com n = 20 sem nomear a métrica. Com n = 4, o valor bate com a razão de latência (365 ms contra 280 ms), não com a diferença de throughput de 15,6×.
- **Cenário estreito.** As transações são no-ops, então o custo de execução não aparece, e quatro regiões dos EUA estão longe de uma blockchain global. O texto não relata repetições nem variância, e o Shoal, a variante do Bullshark com 9 mds, não é executado.

## Pesquisas futuras

- Motorizar: o artigo diz que um consenso existente pode ser aumentado com lanes, cortes e a sua lógica de sync e ordenação, mas não o constrói nem o mede.
- Experimentos bizantinos, implantações maiores e mais amplas com execução real, e as opções ainda não construídas de reputação, ride sharing e cars em pipeline.
- Eliminar os timeouts, de que o Autobahn ainda precisa para a vivacidade. O [Ambulance](/papers/ambulance-saving-bft-through-racing) (OSDI 2026) tem autores em comum e usa o código e a camada de dados do Autobahn para substituí-los. O [Pesto](/papers/pesto-high-performance-bft-queries) (SOSP 2025) também tem autores em comum e pergunta se bancos de dados BFT precisam de ordem total. O Autobahn é anterior aos dois e não cita nenhum, só o Basil, predecessor do Pesto, para o cache de assinaturas repetidas.
- Uma forma mensurável de seamlessness, com uma métrica de hangover padrão entre protocolos, já que o argumento atual é informal e fica em um apêndice que os anais marcam como não revisado por pares.
