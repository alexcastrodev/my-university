---
title: "FoundationDB: um armazenamento chave-valor transacional, distribuído e desagregado"
summary: Um banco chave-valor transacional que separa processamento de transações, armazenamento e configuração em partes que escalam de forma independente, e que se testa com simulação determinística.
researchArea: Bancos de dados
keywords: banco de dados desagregado, oltp, serializabilidade estrita, controle de concorrência multiversão, controle de concorrência otimista, testes por simulação
version: 1.2
updatedAt: 2026-10-31
---

## Visão geral

O FoundationDB é um banco chave-valor ordenado, de código aberto, que oferece transações ACID sobre chaves arbitrárias e roda em produção na Apple, na Snowflake e em outras empresas. Este artigo da trilha industrial do SIGMOD 2021 descreve o projeto depois de mais de dez anos de desenvolvimento.

A pergunta por trás dele é prática: como manter a escalabilidade de um sistema NoSQL oferecendo serializabilidade estrita às aplicações, e como manter correto um sistema tão difícil de acertar enquanto ele continua mudando?

## Contribuição

O artigo defende três decisões que funcionam juntas.

- **Desagregação (unbundling).** Um sistema de transações em memória, um sistema de armazenamento distribuído e um sistema de configuração são papéis separados, cada um provisionado e escalado por conta própria.
- **Um conjunto pequeno de recursos.** O núcleo oferece chaves ordenadas e transações, e nada além disso. Modelos de dados mais ricos (semirrelacional, documentos, grafos) são construídos como camadas por cima.
- **Recuperação e testes como objetivos de projeto.** Em vez de mascarar falhas com quóruns, o sistema de transações é substituído por inteiro quando algo falha, e cada nova funcionalidade é exercitada numa simulação determinística do cluster com falhas injetadas.

## Metodologia

O artigo é uma descrição de sistema sustentada por medições em produção.

O plano de controle guarda sua configuração nos Coordinators (um grupo Paxos em disco) e executa papéis únicos: um ClusterController, um Sequencer que distribui versões, um DataDistributor e um Ratekeeper para proteção contra sobrecarga. O plano de dados tem Proxies, Resolvers, LogServers e StorageServers.

Uma transação lê numa versão, guarda suas escritas no cliente e, no commit, recebe uma versão de commit do Sequencer. Os Resolvers então verificam conflitos de leitura e escrita (controle de concorrência otimista sobre armazenamento multiversão), e a transação é confirmada quando todos os LogServers designados a persistiram. Os StorageServers puxam os logs e os aplicam. As transações são limitadas a 10 MB e a janela multiversão é de cerca de 5 segundos.

Para testar, o cluster inteiro roda num único processo como uma simulação determinística de eventos discretos, escrita em Flow (uma extensão do C++ com atores), com cargas aleatórias e injeção de falhas. A avaliação mede um cluster de produção georreplicado da Apple e um teste sintético de escalabilidade.

## Resultados

Estes são os resultados relatados pelos autores.

- Tolerar f falhas exige f + 1 réplicas, e não as 2f + 1 dos projetos baseados em quórum, porque as falhas são tratadas por reconfiguração.
- O cluster de produção medido tem 58 máquinas, 862 processos do FDB e 292 TB de dados. As leituras levam cerca de 1 ms em média (percentil 99,9 em cerca de 19 ms) e os commits cerca de 22 ms em média (percentil 99,9 em cerca de 281 ms). A taxa média de conflitos no mês foi de 0,73%.
- Em agosto de 2020 esse cluster teve uma recuperação do sistema de transações, que levou 8,61 segundos. Os autores relacionam isso a cinco noves de disponibilidade.
- No teste de escalabilidade (de 4 a 24 máquinas), a vazão de escrita para transações de 100 operações cresceu 5,84x e as operações por segundo com 90% de leitura e 10% de escrita cresceram 4,69x. As escritas saturaram os LogServers e o tráfego misto saturou Resolvers e Proxies.

## Análise crítica

O ponto mais forte é a franqueza do artigo sobre os custos: a simulação não consegue detectar de forma confiável problemas de desempenho, como um algoritmo fraco de balanceamento de carga, e alguns bugs vieram de o contrato do sistema operacional ser mais fraco do que se supunha.

Pontos para ler com cuidado:

- Os números de escalabilidade vêm de uma carga sintética com valores pequenos e de um único desenho de cluster, e não há comparação direta com outros bancos. Eles mostram como o FoundationDB escala, não como ele se posiciona.
- Concorrência otimista, uma janela de 5 segundos e um limite de 10 MB combinam com transações curtas e pouca contenção. Cargas de longa duração ou muito disputadas ficam fora do que é mostrado.
- O número de disponibilidade se apoia em um único mês e em uma única recuperação, então é mais uma anedota sobre um ambiente do que uma garantia medida.
- A abordagem de simulação não consegue testar bibliotecas e dependências de terceiros, nem código próprio que não esteja escrito em Flow, por isso os autores evitaram em grande parte depender de sistemas externos.

## Pesquisas futuras

- Aplicar simulação determinística a sistemas que não foram escritos para ela, sem reescrevê-los.
- Detectar regressões de desempenho em simulação, que o artigo aponta como uma lacuna.
- Transações que duram mais que a janela multiversão sem abrir mão da serializabilidade.
- Uma comparação justa entre projetos desagregados e fortemente integrados, com as mesmas cargas e o mesmo hardware.
