---
title: "TiDB: um banco de dados HTAP baseado em Raft"
summary: Um banco SQL distribuído que atende transações e análises sobre os mesmos dados replicando logs do Raft para um armazenamento colunar por meio de nós learner.
researchArea: Bancos de dados
keywords: htap, raft, consenso, transações distribuídas, armazenamento colunar, newsql
version: 1.2
updatedAt: 2026-10-31
---

## Visão geral

Bancos HTAP (processamento transacional e analítico híbrido) tentam executar transações curtas e consultas analíticas pesadas sobre os mesmos dados. A parte difícil é o isolamento: as consultas analíticas devem ler dados recentes e consistentes sem deixar as transações mais lentas.

Este artigo do VLDB 2020, da PingCAP, apresenta o TiDB, um banco SQL distribuído de código aberto feito para isso. Sua ideia central é estender o Raft, o algoritmo de consenso, para que um mesmo conjunto de dados tenha uma cópia em formato de linhas para transações e uma cópia em formato de colunas para análises, ambas consistentes.

## Contribuição

A contribuição central é o papel de **learner** acrescentado ao Raft. Um learner recebe o log replicado de forma assíncrona, não vota em eleições e não faz parte do quórum, então não acrescenta espera a uma escrita. Os learners transformam linhas em colunas e formam um armazenamento colunar (TiFlash) que pode ser atualizado em tempo real e implantado em recursos separados do armazenamento de linhas (TiKV).

Em volta disso o artigo descreve uma camada SQL sem estado, com um otimizador baseado em custo que pode escolher entre a réplica de linhas e a de colunas para cada consulta, e o TiSpark para conectar ao ecossistema Hadoop.

## Metodologia

O sistema tem quatro partes: os servidores SQL do TiDB, o armazenamento de linhas TiKV, o armazenamento colunar TiFlash e o Placement Driver (PD), que gerencia as regiões, balanceia a carga e atua como oráculo de timestamps.

Os dados são divididos em Regions, cada uma um grupo Raft (multi-Raft). As transações usam um commit em duas fases baseado no Percolator, com timestamps de início e de commit pedidos ao PD, e oferecem isolamento por snapshot. As leituras nos líderes do TiKV são linearizáveis, e o artigo descreve read index, lease read e follower read para acelerá-las.

Uma leitura no TiFlash pede ao líder o read index mais recente e espera até o learner ter aplicado aquela posição do log, que é como a consistência é garantida na hora da leitura e não na da escrita. A avaliação usa o CH-benCHmark num cluster de seis servidores (dois processadores Xeon E5-2630 v4 e 188 GB de memória cada).

## Resultados

Estes são os resultados relatados pelos autores.

- O atraso de replicação do log entre TiKV e TiFlash ficou abaixo de 300 ms com 10 warehouses, na maior parte abaixo de 100 ms, e na maior parte abaixo de 1.000 ms com 100 warehouses.
- Obter timestamps do PD não é gargalo: os autores medem mais de 600.000 timestamps por segundo por servidor, mais de 100 vezes o que o TPC-C exige.
- Em cargas OLTP, o TiDB teve vazão maior que o CockroachDB na maioria dos casos, principalmente com bloqueio otimista em conjuntos de dados maiores.
- No CH-benCHmark, os autores relatam que o TiDB mantém alto desempenho tanto para o trabalho transacional quanto para o analítico enquanto os dois rodam isolados um do outro. O artigo também compara seu motor analítico com Greenplum, Presto e SparkSQL nas consultas analíticas do benchmark.

## Análise crítica

O projeto deixa claro por que replicação assíncrona mais uma verificação na hora da leitura dá frescor e isolamento ao mesmo tempo, e a ideia do learner é simples o bastante para ser reaproveitada.

Pontos para ler com cuidado:

- Os autores são os desenvolvedores do sistema, e os experimentos usam o CH-benCHmark, uma mistura sintética. Como o isolamento se comporta com dados desbalanceados, mudanças de esquema ou varreduras analíticas muito grandes é menos visível.
- O frescor tem uma espera: uma leitura no TiFlash pode precisar esperar a aplicação do log, então o atraso de replicação aparece como latência de leitura sob carga.
- A comparação com o CockroachDB cobre OLTP, e o próprio artigo observa que o CockroachDB oferece serializabilidade, um nível de isolamento mais forte que o isolamento por snapshot do TiDB, e não tem motor analítico dedicado, então os dois não miram a mesma coisa.
- Manter uma cópia em linhas e uma em colunas acrescenta armazenamento e o trabalho de mantê-las em sincronia, um custo a pesar contra um projeto de motor único.

## Pesquisas futuras

- Lidar com taxas de escrita maiores e mudanças de esquema na transformação do log em colunas sem aumentar o atraso.
- Posicionar réplicas de linhas e de colunas para equilibrar custo, isolamento e frescor automaticamente.
- Um benchmark HTAP e uma metodologia justos, já que os resultados dependem muito da mistura de cargas.
- Comparar um projeto baseado em learners com sistemas que mantêm um único formato de armazenamento e usam outras técnicas de isolamento.
