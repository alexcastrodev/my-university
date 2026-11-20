---
title: "Amazon Aurora: considerações de projeto para bancos relacionais nativos de nuvem de alta vazão"
summary: O Aurora mantém o motor MySQL/InnoDB, mas leva o redo logging, a materialização de páginas e a recuperação de falhas para um serviço de armazenamento distribuído, de modo que só registros de redo cruzam a rede e a durabilidade vem de um quórum de escrita 4 de 6 em três zonas de disponibilidade.
researchArea: Bancos de dados
keywords: banco nativo de nuvem, redo log, replicação por quórum, armazenamento estruturado em log, recuperação de falhas, réplicas de leitura, mysql, separação de armazenamento
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

O Amazon Aurora é um serviço de banco de dados relacional para cargas OLTP oferecido como parte da Amazon Web Services (AWS). Neste artigo, descrevemos a arquitetura do Aurora e as considerações de projeto que levaram a ela. Acreditamos que a restrição central no processamento de dados de alta vazão deixou de ser computação e armazenamento e passou a ser a rede. O Aurora traz uma arquitetura nova ao banco relacional para tratar essa restrição, principalmente ao levar o processamento de redo para um serviço de armazenamento multi-inquilino e escalável horizontalmente, construído sob medida para o Aurora. Descrevemos como isso não só reduz o tráfego de rede, mas também permite recuperação rápida de falhas, failover para réplicas sem perda de dados e armazenamento tolerante a falhas e com autorreparo. Em seguida descrevemos como o Aurora alcança consenso sobre o estado durável em vários nós de armazenamento com um esquema assíncrono eficiente, evitando protocolos de recuperação caros e verbosos. Por fim, depois de operar o Aurora como serviço de produção por mais de 18 meses, compartilhamos lições aprendidas com clientes sobre o que aplicações modernas de nuvem esperam da camada de banco de dados.

## Visão geral

Este artigo do SIGMOD 2017, da Amazon Web Services, descreve um banco em produção, não um protótipo de pesquisa: o Aurora entrou em disponibilidade geral em julho de 2015. O ponto de partida é que, numa frota de nuvem, o I/O se espalha por muitos nós e discos, então discos individuais deixam de ser o ponto quente. O gargalo passa para a rede entre a camada do banco e a camada de armazenamento, e replicar entre zonas as escritas de um banco tradicional multiplica os pacotes por segundo e coloca etapas síncronas no caminho crítico.

O Aurora é uma resposta dentro da família de bancos de nuvem do catálogo. O [TiDB](/papers/tidb-raft-based-htap-database) e o [FoundationDB](/papers/foundationdb-unbundled-transactional-kv-store) também separam componentes e replicam, mas com grupos Raft ou uma camada de transações desacoplada. O [Spanner](/papers/spanner-globally-distributed-database), que o Aurora cita e descreve como dependente de two-phase commit e two-phase locking nas transações de leitura e escrita, segue outro caminho: o Aurora mantém um único escritor e um único log ordenado. Contexto útil: a ideia do [sistema de arquivos estruturado em log](/papers/log-structured-file-system) de que o log é o registro primário, e a replicação por quórum como no [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) (o próprio artigo usa o serviço DynamoDB apenas como armazém de metadados do plano de controle do armazenamento).

## Contribuição

O artigo lista três contribuições: raciocinar sobre durabilidade em escala de nuvem com quóruns que sobrevivem a falhas correlacionadas; delegar o quarto inferior de um kernel de banco tradicional a um armazenamento inteligente; e eliminar sincronização em várias fases, recuperação de falhas e checkpoints do armazenamento distribuído.

- **Quórum dimensionado para a falha de uma zona.** Cada item é replicado 6 vezes em 3 zonas de disponibilidade (2 cópias por zona), com quórum de escrita Vw = 4 e de leitura Vr = 3. O artigo argumenta que um quórum 2 de 3 é inadequado, porque perder uma zona mais qualquer falha concorrente de nó o quebra. O Aurora tolera perder uma zona e mais um nó sem perder dados, e perder uma zona sem perder a capacidade de escrever.
- **O log é o banco.** As únicas escritas que cruzam a rede a partir da camada do banco são registros de redo. Nenhuma página é escrita em escritas de fundo, checkpoints ou despejo de cache. Os nós de armazenamento aplicam o log para produzir páginas em segundo plano ou sob demanda, e as páginas são descritas como "um cache de aplicações do log".
- **Consenso assíncrono sobre o estado durável.** Em vez de 2PC, o banco avança pontos de consistência e de durabilidade conforme chegam as confirmações.

## Metodologia

**Segmentos.** O volume é cortado em segmentos de 10 GB, cada um replicado 6 vezes em um Protection Group (PG). O artigo diz que um segmento de 10 GB pode ser reparado em 10 segundos num link de 10 Gbps, o que encurta a janela para uma falha dupla. Os volumes podem crescer até 64 TB.

**Nó de armazenamento.** De oito atividades, só receber o registro na fila e persisti-lo com confirmação ficam no caminho de primeiro plano. Detecção de lacunas, gossip com os pares para preencher registros faltantes, junção de registros em páginas, envio ao S3, coleta de lixo e verificação de CRC são trabalho de fundo.

**Contabilidade de LSN.** Cada registro tem um LSN crescente. Um segmento acompanha o SCL (Segment Complete LSN) usando backlinks por PG. O serviço de armazenamento calcula o VCL (Volume Complete LSN), o maior LSN com todos os registros anteriores disponíveis. O banco marca o último registro de cada mini-transação como CPL (Consistency Point LSN). O VDL (Volume Durable LSN) é o maior CPL que não passa do VCL, e os registros acima dele são truncados. No exemplo do artigo: completo até 1007, mas com CPLs em 900, 1000 e 1100, só há durabilidade até 1000. A alocação de LSN é limitada ao VDL mais o LSN Allocation Limit (10 milhões), para criar contrapressão.

**Commit e leituras.** O commit é assíncrono: a transação espera numa lista até o VDL alcançar seu LSN de commit, e as threads de trabalho não bloqueiam. As leituras usam um único segmento a partir de um ponto de leitura, não leituras por quórum. Uma página só é despejada se seu page LSN for pelo menos o VDL.

**Recuperação.** Não há checkpoint nem replay de redo na partida. Depois de uma queda, o banco lê um quórum de leitura por PG, recalcula o VDL e grava faixas de truncamento versionadas por números de época. A recuperação de undo roda com o banco já online.

**Réplicas.** Um escritor e até 15 réplicas de leitura montam o mesmo volume. O fluxo de log também vai para as réplicas, que aplicam só registros com LSN até o VDL e aplicam cada mini-transação de forma atômica.

## Resultados

São resultados reportados pelos autores. Os testes rodaram em instâncias r3.8xlarge, salvo indicação, com o MySQL em EBS com 30K IOPS provisionados; o Aurora era baseado no MySQL 5.6.

- **I/O de rede (Tabela 1).** SysBench só de escrita, 100 GB, 30 minutos: o MySQL espelhado executou 780.000 transações com 7,4 I/Os por transação, o Aurora 27.378.000 com 0,95. O artigo relata 35 vezes mais transações, 7,7 vezes menos I/Os por transação no nó do banco apesar da amplificação de seis vezes nas escritas, e 46 vezes menos I/Os na camada de armazenamento.
- **Tamanho da instância (Figuras 6 e 7).** A vazão dobra a cada tamanho. Na r3.8xlarge o texto dá ao Aurora 121.000 escritas/s e 600.000 leituras/s, 5x o MySQL 5.7. O texto atribui ao MySQL 5.7 "20.000 leituras/s e 125.000 escritas/s", o que parece trocado em relação aos gráficos (lendo o gráfico, cerca de 125.000 leituras e 20.000 escritas: leitura de gráfico).
- **Tamanho dos dados (Tabela 2), escritas/s no teste só de escrita.** Aurora 107.000 / 107.000 / 101.000 / 41.000 contra MySQL 8.400 / 2.400 / 1.500 / 1.200 para 1 GB, 10 GB, 100 GB e 1 TB: até 67x com 100 GB e 34x com 1 TB.
- **Conexões (Tabela 3), escritas/s.** Com 50, 500 e 5.000 conexões, Aurora 40.000, 71.000, 110.000 contra MySQL 10.000, 21.000, 13.000.
- **Atraso de réplica (Tabela 4), ms.** De 1.000 a 10.000 escritas/s, o Aurora vai de 2,62 a 5,38 contra o MySQL de menos de 1.000 a 300.000.
- **Variante do TPC-C (Tabela 5).** O Aurora sustenta de 2,3x a 16,3x o tpmC do MySQL 5.7; por exemplo 73.955 contra 25.289 com 500 conexões e 10 GB, e 42.181 contra 2.592 com 5.000 conexões e 10 GB.
- **Recuperação.** Só uma frase, sem figura nem tabela: a recuperação leva "geralmente menos de 10 segundos" mesmo após queda sob mais de 100.000 comandos de escrita por segundo.
- **Clientes.** O tempo médio de resposta de uma empresa de jogos caiu de 15 ms para 5,5 ms. Numa empresa de educação, as latências P95 (40 a 80 ms) ficaram próximas das P50 (cerca de 1 ms); o atraso de réplica, que chegava a 12 minutos no MySQL, ficou abaixo de 20 ms em 4 réplicas Aurora.

## Análise crítica

O argumento central é claro e bem sustentado: quando a rede é o gargalo, escrever só registros de redo e replicar na camada de armazenamento reduz o tráfego mesmo com seis cópias. Manter o controle de concorrência e o isolamento no motor, como se fosse disco local, limita o quanto muda. Pontos para ler com cuidado:

- Os autores operam o serviço, e ele é de código fechado. Os números não podem ser reproduzidos a partir do artigo.
- A base de comparação é o MySQL 5.6 e 5.7 sobre EBS espelhado. O trabalho relacionado discute Deuteronomy, Hyder, Sinfonia e Yesquel só em prosa: não há comparação medida com outros bancos nativos de nuvem ou distribuídos.
- O argumento de durabilidade (falhas duplas "suficientemente improváveis") é qualitativo, sem dados de taxa de falha. Os mecanismos de reparo e de gossip são descritos, não avaliados, e a recuperação tem uma frase de evidência.
- O projeto supõe um único escritor com LSNs de um só domínio ordenado, o que também permite ao Aurora oferecer os mesmos níveis de isolamento do MySQL. Vários escritores não são tratados. Compare com os trade-offs de consistência do [PACELC](/papers/consistency-tradeoffs-in-modern-distributed-database-system-design), do [CAP](/papers/brewers-conjecture-cap-feasibility-web-services) e das [Highly Available Transactions](/papers/highly-available-transactions-virtues-and-limitations), que o artigo cita.
- Pequenas inconsistências: os valores do 5.7 acima, e a seção 6.2.2 diz uma vez "P99" para o percentil 95 enquanto as figuras dizem P95. Os casos de clientes são migrações isoladas de antes e depois, sem experimento controlado.

## Pesquisas futuras

- Trabalho posterior da mesma equipe: o artigo do SIGMOD 2018 "Amazon Aurora: On Avoiding Distributed Consensus for I/Os, Commits, and Membership Changes" (o Crossref confirma autores, venue e título; literatura posterior, não lida).
- Temas que o artigo levanta em Lessons Learned: evolução de esquema com DDL online, patching sem downtime e consolidação multi-inquilino.
- Outro banco de nuvem com armazenamento separado, o Socrates (SIGMOD 2019, "The New SQL Server in the Cloud"): literatura posterior, só título e metadados conferidos, não lido.
- Uma comparação reproduzível com outros projetos desagregados, medindo tempo de recuperação e reparo, que o artigo apenas descreve.
