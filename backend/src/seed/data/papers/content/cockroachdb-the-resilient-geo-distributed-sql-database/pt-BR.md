---
title: "CockroachDB: o banco de dados SQL geodistribuído e resiliente"
summary: O CockroachDB guarda tabelas SQL como ranges ordenados de pares chave-valor, replica cada range com Raft e executa transações MVCC serializáveis sobre relógios lógicos híbridos, de modo que um cluster espalhado por regiões precisa só de relógios no nível do NTP, e não de relógios atômicos.
researchArea: Bancos de dados
keywords: SQL distribuído, isolamento serializável, relógios lógicos híbridos, Raft, leases de range, geo-particionamento, MVCC, intervalo de incerteza
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

Vivemos em um mundo cada vez mais interconectado, com muitas organizações operando em vários países ou até continentes. Para atender a base global de usuários, as organizações estão trocando seus SGBDs legados por sistemas em nuvem capazes de escalar cargas OLTP para milhões de usuários. O CockroachDB é um SGBD SQL escalável, construído desde o início para sustentar essas cargas OLTP globais com alta disponibilidade e consistência forte. Como o inseto que lhe dá o nome, ele resiste a desastres por meio de replicação e mecanismos de recuperação automática. Este artigo apresenta o projeto do CockroachDB e seu novo modelo de transações, que oferece transações consistentes e geodistribuídas em hardware comum. Descrevemos como o CockroachDB replica e distribui os dados para obter tolerância a falhas e alto desempenho, e como sua camada SQL distribuída escala automaticamente com o tamanho do cluster, mantendo a interface SQL padrão que os usuários esperam. Por fim, apresentamos uma avaliação de desempenho abrangente e alguns estudos de caso de usuários. Concluímos com as lições aprendidas ao construir o CockroachDB ao longo de cinco anos.

## Visão geral

Este é um artigo de indústria (SIGMOD 2020, 17 páginas), de 17 autores da Cockroach Labs. O problema é um banco SQL transacional de código aberto (Business Source License, que vira Apache 2.0 após três anos), serializável, que sobreviva a falhas de disco, rack, datacenter e região, deixe o usuário fixar dados em locais por latência e regulação (a GDPR é o exemplo do texto) e rode em servidores comuns com sincronização de relógio no estilo NTP. O [Spanner](/papers/spanner-globally-distributed-database) oferece as garantias mais fortes, mas, segundo o artigo, só é prático onde hardware especializado limita a incerteza do relógio a poucos milissegundos.

O projeto tem cinco camadas dentro de cada nó (shared-nothing, qualquer nó atende clientes): SQL (parser, otimizador, executor); KV transacional (atomicidade e isolamento); Distribuição (um único espaço de chaves ordenado, cortado em "Ranges" de ~64 MiB); Replicação (cada Range é um grupo [Raft](/papers/raft-understandable-consensus-algorithm), com três réplicas por padrão); Armazenamento (um KV local em disco; RocksDB na época, tratado como caixa-preta, com uma camada redesenhada anunciada). Tabelas e índices secundários viram pares chave-valor ordenados, e um lease de Range escolhe uma réplica, o leaseholder, para servir leituras e propor escritas.

Vale conhecer antes: MVCC, serializabilidade versus snapshot isolation (veja [Critique of ANSI SQL Isolation Levels](/papers/critique-of-ansi-sql-isolation-levels)) e os relógios de [Hybrid Logical Clocks](/papers/logical-physical-clocks).

## Contribuição

- **Protocolo de transações sem hardware especial.** Transações leem e escrevem num timestamp de commit vindo de um relógio lógico híbrido. Conflitos podem empurrar esse timestamp para a frente, e um "read refresh" confere se as leituras anteriores continuam válidas no novo valor; se não, a transação reinicia. O isolamento padrão é SERIALIZABLE.
- **Write intents e registro da transação.** As escritas são valores MVCC provisórios que apontam para um registro por transação (pending, staging, committed, aborted), cuja mudança vira todos os intents de uma vez.
- **Write Pipelining e Parallel Commits.** O coordenador responde sem esperar cada escrita replicar, e um status "staging" deixa o commit replicar em paralelo com as escritas, de modo que muitas transações com vários comandos terminam em uma rodada de consenso. Os autores verificaram atomicidade e durabilidade do Parallel Commits com TLA+.
- **Relógios e leases.** O HLC, com desvio máximo configurável (padrão 500 ms) e um intervalo de incerteza, dá linearizabilidade de chave única. Os leases são mantidos disjuntos, e cada escrita no Raft leva o número de sequência do lease, o que protege o isolamento mesmo quando o limite de desvio é violado.
- **Políticas de posicionamento.** Geo-Partitioned Replicas, Geo-Partitioned Leaseholders e Duplicated Indexes, mais leituras em seguidores (`AS OF SYSTEM TIME`) a partir de closed timestamps. O artigo não traz a sintaxe REGIONAL BY ROW.
- **Camada SQL.** Otimizador estilo Cascades (mais de 200 regras, escritas na DSL Optgen, ciente do particionamento), execução distribuída só de leitura, motor vetorizado e mudanças de esquema online no estilo do F1.

## Metodologia

CockroachDB v19.2 na AWS e no GCP. Parallel Commits: microbenchmark de escritas de uma linha em três servidores de três regiões. Escalabilidade: Sysbench de point selects e inserts (3 nós com 2 a 36 vCPUs, depois 3 a 48 nós c5d.9xlarge) e TPC-C com percentual variável de transações remotas e fator de replicação. O TPC-C com 1.000, 10.000 e 100.000 warehouses é comparado com números do Amazon Aurora publicados pela AWS. Disponibilidade: TPC-C 1.000 em 9 máquinas do GCP em três regiões dos EUA, com falhas induzidas de AZ e de região sob quatro políticas de posicionamento. A comparação com o Spanner usa YCSB A a F em uma região com três AZs. Dois estudos de caso de clientes fecham a avaliação.

## Resultados

Todos os números abaixo são dos próprios autores; "leitura de gráfico" marca valores que o texto não informa.

- **Parallel Commits.** Até 72% mais vazão e até 47% menos latência p50 em escritas de uma linha com índices secundários, e o perfil de latência fica estável ao adicionar índices.
- **Escalabilidade.** A vazão por vCPU fica quase constante de 6 a 1.728 vCPUs (dito no texto; o gráfico não traz números por ponto). A replicação custa até 48% da vazão do TPC-C com três réplicas e 57% com cinco, as transações distribuídas até mais 46%, e mesmo assim todas as variantes escalam linearmente com o tamanho do cluster (10.000 warehouses são 800 GB).
- **TPC-C contra o Aurora (Tabela 1).** O CockroachDB chega a 12.474 tpmC (1.000 warehouses, 3 nós), 124.036 (10.000, 15 nós) e 1.245.462 (100.000, 81 nós, ~8 TB), com p90 de NewOrder de 39,8, 436,2 e 486,5 ms. A eficiência impressa é 97,0%, 96,5% e 98,8%. O Aurora aparece com 12.582 tpmC (97,8%) e 9.406 (7,3%), sem latência nem hardware informados.
- **Falhas e posicionamento.** As quatro políticas toleram a falha de uma AZ; só Geo-Partitioned Leaseholders sobrevive à falha de uma região, com p90 maior em operação estável. Duplicated Indexes tem o menor p90 em condições estáveis (leitura de gráfico, Fig. 6).
- **Contra o Spanner.** O CockroachDB mostra maior vazão no YCSB na maioria das cargas, exceto a carga A (alta contenção), e menor latência em todos os percentis com carga leve, o que os autores atribuem em parte ao commit-wait do Spanner. O texto não traz números de latência.
- **Desvio de relógio.** Além do limite de desvio, a serializabilidade se mantém, mas a linearizabilidade de chave única pode quebrar, e um nó com relógio longe demais da maioria se encerra sozinho.

## Análise crítica

O artigo mesmo declara alguns limites.

- **Não é serializabilidade estrita.** Transações em chaves disjuntas podem ficar ordenadas diferente do tempo real, e leituras obsoletas são possíveis se o desvio passar do limite. Só o caso que respeita o limite dá linearizabilidade de chave única.
- **Contenção.** A carga A não escala, e os autores esperam que o bloqueio de leitura opcional da versão 20.1 ajude. Os read refreshes podem dar falsos positivos, e os clientes ainda precisam tratar retentativas.
- **O SQL distribuído é só de leitura.** As escritas rodam só no gateway. O snapshot isolation virou apelido de SERIALIZABLE, e o "Follow the Workload" quase não é usado.

Leitura minha, não afirmações do artigo:

- **Evidência de fornecedor.** Uma empresa, com seus benchmarks e suas escolhas de implantação. As comparações com Spanner, Aurora, TiDB e F1 são em boa parte qualitativas. Os números do Aurora vêm da AWS, com outro hardware e ajuste desconhecido, e o hardware do Spanner não é divulgado, então a equivalência é só por custo (0,2%).
- **A Tabela 1 não fecha.** Com 100.000 warehouses, 1.245.462 tpmC divididos por 12,86 tpmC por warehouse dão cerca de 96,8%, não 98,8%. Provavelmente é erro de digitação, mas o texto não diz.
- **Escopo formal.** O TLA+ cobre só o Parallel Commits (atomicidade e durabilidade). As proteções contra desvio de relógio, o argumento do HLC e o restante são argumentados em prosa, sem prova nem verificação de modelo relatadas.
- **Literatura posterior, lida só pelo catálogo.** A análise do Pesto neste catálogo diz que o CockroachDB serviu ali como baseline sem replicação e em memória, e a análise do [TiDB](/papers/tidb-raft-based-htap-database) diz que o TiDB foi mais rápido na maioria das execuções OLTP, enquanto o CockroachDB é serializável. Não li os originais, e eles não testam as afirmações deste artigo.

## Pesquisas futuras

- Contenção sob SERIALIZABLE: quanto os bloqueios pessimistas de leitura e os read refreshes mudam a taxa de retentativas em cargas enviesadas?
- Custo medido do desvio máximo: com que frequência nuvens reais violam 500 ms e quantos reinícios por incerteza ocorrem?
- Testes independentes das afirmações de isolamento e linearizabilidade sob desvio e partições, por exemplo com o [Elle](/papers/elle-inferring-isolation-anomalies-from-experimental-observations) (não verifiquei se isso já foi feito).
- Comparar com projetos determinísticos ([Calvin](/papers/calvin-fast-distributed-transactions-for-partitioned-databases)), baseados em timestamp ([Tiga](/papers/tiga-accelerating-geo-distributed-transactions-with-synchronized-clocks)) e desagregados ([FoundationDB](/papers/foundationdb-unbundled-transactional-kv-store)) sob a mesma carga.
- Write intents mais um registro por transação lembram o commit baseado em locks do [Percolator](/papers/percolator-large-scale-incremental-processing). O artigo não o cita, então esta ligação é leitura minha.
