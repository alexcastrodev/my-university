---
title: "Narwhal e Tusk: um mempool baseado em DAG e consenso BFT eficiente"
summary: O Narwhal tira a disseminação de transações do caminho crítico do líder e a coloca num DAG de blocos certificados, de modo que o consenso ordena apenas certificados pequenos. O Tusk lê esse DAG com uma moeda aleatória para obter consenso assíncrono sem nenhuma mensagem extra.
researchArea: Sistemas distribuídos
keywords: tolerância a falhas bizantinas, mempool, dag, consenso assíncrono, moeda aleatória, difusão confiável, hotstuff, scale-out
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

Os autores propõem separar a disseminação confiável de transações da ordenação delas, para viabilizar consenso baseado em quóruns, tolerante a falhas bizantinas e de alto desempenho. Projetam e avaliam o Narwhal, um mempool especializado em disseminação e armazenamento, com alta vazão e confiabilidade, dos históricos causais de transações; ele tolera rede assíncrona, mantém o desempenho apesar de falhas e escala com vários workers por validador. Combinado com um consenso parcialmente síncrono (Narwhal-HotStuff), entrega vazão bem melhor mesmo com falhas ou perdas intermitentes de vivacidade, mas essa perda pode elevar a latência. Para ter bom desempenho sob falhas, projetam o Tusk, um consenso assíncrono sem custo extra de mensagens que trabalha sobre o Narwhal.

## Visão geral

É o artigo do EuroSys '22 (Rennes, França, abril de 2022), de George Danezis, Lefteris Kokoris-Kogias, Alberto Sonnino e Alexander Spiegelman, feito em boa parte no time Novi do Facebook. Texto lido: o PDF do arXiv v4 (16 de março de 2022, 17 páginas), a última revisão, e não a versão da ACM.

O problema: o HotStuff (Yin et al., PODC 2019) alcança complexidade linear de mensagens fazendo um líder coletar, agregar e difundir as mensagens, mas os autores argumentam que contar mensagens é o alvo errado. Um líder que também propõe as transações em bloco vira gargalo, e as mensagens de consenso (cerca de 100 B) são minúsculas perto dos blocos (cerca de 10 MB). A hipótese deles: um mempool melhor, que distribua as transações de forma confiável, é a chave para um ledger de alto desempenho, deixando ao consenso apenas a ordenação de referências pequenas e de tamanho fixo.

Contexto nesta biblioteca: [Practical Byzantine Fault Tolerance](/papers/practical-byzantine-fault-tolerance), que o artigo cita (a versão de periódico de 2002), e [The Byzantine Generals Problem](/papers/byzantine-generals-problem) para o modelo de falhas. O [FLP](/papers/flp-impossibility-of-distributed-consensus) explica por que consenso assíncrono precisa de aleatoriedade, e [Paxos Made Simple](/papers/paxos-made-simple) e o [Raft](/papers/raft-understandable-consensus-algorithm) dão a ascendência para falhas por parada. O artigo não cita nenhum desses três, nem o artigo dos Generais Bizantinos; esses links são contexto da biblioteca, não dos autores. O HotStuff em si não está no catálogo.

## Contribuição

- **Mempool Narwhal.** A cada rodada, cada validador difunde um bloco com transações e 2f+1 certificados de disponibilidade da rodada anterior. 2f+1 assinaturas sobre um bloco formam um certificado, então pelo menos f+1 validadores honestos o guardam. O artigo lista as propriedades Integrity, Block-Availability, Containment, 2/3-Causality e 1/2-Chain Quality, e o modelo é de n partes com f < n/3 bizantinas e enlaces assíncronos eventualmente confiáveis.
- **Narwhal-HotStuff.** O líder propõe um ou mais certificados em vez de transações. No commit, o histórico causal ainda não commitado é ordenado de forma determinística.
- **Tusk.** Extensão do DAG-Rider: ondas de 3 rodadas (propor, votar, revelar uma moeda aleatória). Um bloco líder é commitado se f+1 blocos da segunda rodada o referenciam, e líderes anteriores são ordenados recursivamente por caminhos no DAG. A moeda vem de uma assinatura de limiar adaptativamente segura. O Tusk não adiciona mensagens além das do Narwhal.
- **Engenharia.** Difusão confiável por pull com memória limitada, coleta de lixo acordada via consenso e uma arquitetura primary-worker de scale-out, em que os workers transmitem lotes de transações e o primary só lida com os hashes dos lotes.

## Metodologia

Uma implementação em Rust (cerca de 4.000 linhas mais 2.000 de testes unitários, Tokio, ed25519-dalek, RocksDB) foi medida em instâncias AWS m5.8xlarge (10 Gbps, 32 vCPUs) em 5 regiões: N. Virginia, N. California, Sydney, Estocolmo e Tóquio. Parâmetros-base: 4 validadores com um worker, lotes de 500 KB, blocos de 1 KB, transações de 512 B, um cliente por worker a taxa fixa por 5 minutos, cada ponto a média de 2 execuções. A latência vai da submissão pelo cliente até o commit. Sistemas comparados: Baseline-HS (transações por gossip, como no Bitcoin ou no Libra), Batched-HS (lotes disseminados fora do caminho crítico, como no Prism) e os baseados em Narwhal. As falhas são por parada.

## Resultados

Todos os números são dos autores e vêm do texto, salvo marcação.

- **Baseline-HS** nunca passa de 1.800 tx/s com 10 ou 20 validadores, com cerca de 1 s de latência.
- **Batched-HS** chega a 70.000 tx/s com 10 nós e até 50.000 com 20, com cerca de 2 s antes de saturar. O texto chama isso de "quase 20x" sobre o baseline, enquanto a introdução diz "até 50x".
- **Narwhal-HotStuff** atinge 140.000 tx/s (Seção 7.1) abaixo de 2 s. O abstract e a conclusão dizem "mais de 130.000", e a conclusão associa isso a 50 validadores.
- **Tusk** fica estável em cerca de 3 s, com pico de 170.000 tx/s com 50 validadores na Seção 7.1, enquanto o abstract diz 160.000. O artigo o chama de protocolo totalmente assíncrono mais performático e cerca de 20x mais rápido que o Dumbo2 (5.000 tx/s, 8 nós, transações de 250 B).
- **Scale-out.** A vazão cresce linearmente com os workers, até cerca de 600.000 tx/s, sem aumento de latência. A introdução descreve a Fig. 1 como mais de 500.000 tx/s com latência abaixo de 3,5 s.
- **Falhas** (10 validadores, 1 e 3 paradas). A vazão do Baseline-HS cai 5x a partir de 800 tx/s e a latência sobe 40x. O Batched-HS cai 30x (de 70 mil para 2,5 mil tx/s) e a latência sobe 10x. O Tusk fica abaixo de 4 s com 1 falha e abaixo de 6 s com 3. O Narwhal-HotStuff fica abaixo de 7 s com 1 e em torno de 10 s com 3, contra 35 a 40 s dos baselines.
- **Teoria.** A Tabela 1 dá a latência esperada de commit em RTTs: HotStuff 3, Narwhal-HS 4, Tusk 4,5, e 7 para o Tusk sob assincronia. O Lemma 4 dá probabilidade de commit do líder acima de 1/3 por onda contra um adversário assíncrono. O Lemma 5 dá 4,5 rodadas com atrasos aleatórios, e 7 rodadas no pior caso. Segurança e vivacidade são provadas ou argumentadas na Seção 5 e no Apêndice A.

## Análise crítica

O que o artigo não afirma: não dá limite formal de complexidade de mensagens para Narwhal ou Tusk além de "zero overhead de mensagens" no Tusk e O(1) requisições de pull em média, O(n) no pior caso, por bloco. Deixa mecanismos de justiça para trabalho futuro e avisa que um validador honesto lento é indistinguível de um defeituoso, então suas transações podem ser commitadas bem mais tarde. Entrega 1/2-Chain Quality, não controle da ordem das transações contra o adversário. Os clientes precisam reenviar transações que não forem sequenciadas. O motor de execução, e os clientes leves que precisam localizar lotes entre workers, ficam em aberto. Os autores também notam que avaliar protocolos BFT sob falhas bizantinas reais é questão em aberto, e as falhas medidas são paradas.

Condições a ter em mente: transações de 512 B, 5 regiões da AWS com máquinas de 10 Gbps, comitês de 4 a 50, carga de clientes a taxa fixa e sem execução. Os números não são previsão para outros tamanhos ou redes. A conclusão de que o custo principal é a disseminação, e não o consenso, é uma afirmação forte tirada desses cenários. Os próprios números do artigo divergem em alguns pontos (130.000 contra 140.000; 160.000 contra 170.000; 20x contra 50x).

Literatura posterior (fora deste artigo): a página do catálogo do [Autobahn](/papers/autobahn-seamless-high-speed-bft), que li como entrada do catálogo e não o artigo original, relata que ele parte do código do Narwhal e do Bullshark e argumenta que protocolos em DAG como o Bullshark precisam de até 12 atrasos de mensagem para commitar. Não abri o Bullshark, o Sui nem outros trabalhos posteriores.

## Pesquisas futuras

Os autores apontam como trabalho em aberto justiça e incentivos, reenvio de transações pelo cliente e deduplicação (citam a técnica de hashing do Mir-BFT), um motor de execução à altura da vazão, clientes leves, um primary mais escalável (por exemplo uma raiz de Merkle dos hashes de lotes) e interfaces com sharding. Uma verificação natural é uma implantação com validadores ativamente bizantinos, e não apenas com paradas.
