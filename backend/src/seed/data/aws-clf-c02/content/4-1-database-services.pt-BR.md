---
version: 1.0
updatedAt: 2026-11-21
---
# Serviços de banco de dados: RDS, Aurora, DynamoDB, ElastiCache e a escolha pelo padrão de acesso

> Domínio do exame: **Tecnologia e serviços de nuvem (34%)**, objetivo 3.4 *Identificar os serviços de banco de dados da AWS*.

---

## O que o exame cobra

O guia lista quatro habilidades para o objetivo 3.4: distinguir um banco de dados **hospedado no EC2** de um **gerenciado pela AWS**, reconhecer os serviços **relacionais** (Amazon RDS, Amazon Aurora), o serviço **NoSQL** (Amazon DynamoDB) e o serviço **baseado em memória** (Amazon ElastiCache), e nomear as **ferramentas de migração** (AWS DMS, AWS SCT). A lista de bancos de dados no escopo inclui ainda Amazon DocumentDB e Amazon Neptune. O Amazon Redshift está classificado em Análise de dados, e aparece aqui como a opção de data warehouse.

A maioria das questões descreve um workload e pergunta qual banco de dados se encaixa. Leia o padrão de acesso, não os nomes das marcas.

---

## Escolha o banco de dados pelo padrão de acesso

| O enunciado diz | Serviço | Por quê |
|-----------------|---------|---------|
| Esquema relacional, joins, transações, mecanismo SQL padrão | **Amazon RDS** | Banco de dados relacional gerenciado: a AWS cuida da configuração, dos patches, dos backups e das tarefas de escalabilidade |
| Relacional, compatível com MySQL ou PostgreSQL, maior throughput e armazenamento distribuído em três AZs | **Amazon Aurora** | Mecanismo relacional criado pela AWS, compatível com MySQL e PostgreSQL |
| Itens chave-valor ou de documento, escala enorme, leituras em milissegundos de um dígito, sem servidor | **Amazon DynamoDB** | NoSQL sem servidor (serverless), sem servidores, sem versões, sem janelas de manutenção |
| Cache na frente de um banco de dados, sessões, leaderboards, leituras em microssegundos a partir da memória | **Amazon ElastiCache** | Cache em memória com os mecanismos Valkey, Memcached ou Redis OSS |
| Banco de dados de documentos compatível com MongoDB | **Amazon DocumentDB** | Mesmos drivers e ferramentas do MongoDB |
| Dados altamente conectados: grafo social, redes de fraude, recomendações por relacionamento | **Amazon Neptune** | Banco de dados de grafos gerenciado para bilhões de relacionamentos |
| Anos de dados de muitas fontes, relatórios complexos, análise em escala de petabytes | **Amazon Redshift** | Data warehouse gerenciado (análise, não transações) |

O DynamoDB não tem operador JOIN. Se o enunciado exige joins entre tabelas e transações em SQL padrão, ele aponta para um serviço relacional.

---

## Hospedado no EC2 vs gerenciado pela AWS

```text
                         Você gerencia no EC2     AWS gerencia no RDS
 Hardware                AWS                      AWS
 Instalação/patch do SO  Você                     AWS
 Patch do software BD    Você                     AWS
 Backups, HA, escala     Você                     AWS
 Ajuste de consultas,    Você                     Você
 esquema, design do app
```

- A AWS recomenda o RDS como padrão para a maioria das implantações relacionais.
- Escolha um banco de dados no EC2 quando precisar de controle total do sistema operacional do host (uma ferramenta de fornecedor que precisa rodar no servidor do banco de dados, um mecanismo ou uma versão sem suporte).
- O **RDS Custom** (Oracle e SQL Server) é um meio-termo gerenciado que permite acesso ao SO, voltado a aplicações legadas e empacotadas. O RDS padrão não oferece shell no host.
- O ajuste de consultas continua com você, mesmo no RDS. "Gerenciado" nunca significa que a AWS otimiza o seu SQL.

---

## Amazon RDS em poucos fatos

- Mecanismos (em 21/11/2026): **IBM Db2, MariaDB, Microsoft SQL Server, MySQL, Oracle Database, PostgreSQL**. O Aurora é documentado como um mecanismo à parte.
- Armazenamento: SSD de uso geral e SSD de IOPS provisionadas. Para OLTP em produção, a AWS recomenda **Multi-AZ mais IOPS provisionadas**.
- O ajuste automático de armazenamento (storage autoscaling) aumenta o armazenamento sem tempo de inatividade. Mudar a classe da instância (mais CPU e memória) causa uma breve interrupção, menor com Multi-AZ.
- Backups automáticos com **recuperação pontual** (point-in-time recovery): restaure para qualquer segundo dentro do período de retenção. Uma restauração sempre cria uma **nova** instância de banco de dados. Os snapshots manuais sobrevivem à exclusão da instância.

---

## Multi-AZ vs réplicas de leitura

Esta é a decisão de banco de dados mais cobrada. Uma serve para sobreviver a falhas, a outra para descarregar leituras.

| | Multi-AZ (instância de banco de dados) | Réplica de leitura |
|---|---|---|
| Finalidade | **Alta disponibilidade e failover automático** | **Escalabilidade de leitura** (relatórios, análises, aplicações com muita leitura) |
| Replicação | Síncrona para um standby em outra AZ | Cópia assíncrona |
| Atende leituras? | Não, o standby é passivo | Sim, somente leitura |
| Onde fica | Outra AZ na mesma Região | Mesma AZ, outra AZ ou outra Região |
| Tratamento de falhas | Failover automático para o standby | Promoção manual a um banco de dados independente (útil para recuperação de desastres) |

```text
 Multi-AZ:             [Primária AZ-a] ==sync==> [Standby AZ-b]   (sem leituras, assume em caso de falha)
 Réplica de leitura:   [Primária] --async--> [Réplica] <-- consultas de relatório
```

Um **cluster de banco de dados Multi-AZ** é uma variante mais nova: um gravador mais dois standbys legíveis em três AZs. No exame, quando o enunciado diz "standby", presuma a instância Multi-AZ clássica, que não atende leituras.

---

## Amazon Aurora

- Totalmente gerenciado, compatível com **MySQL e PostgreSQL**, com throughput maior que o dos mecanismos originais em hardware semelhante (a visão geral atualmente diz até 6x; aprenda "mais rápido que o MySQL e o PostgreSQL padrão", não o multiplicador).
- Armazenamento: cada gravação é replicada de forma síncrona para **seis nós de armazenamento em três AZs** de uma Região. O volume do cluster cresce automaticamente.
- Computação: **um gravador** mais até 15 **Réplicas do Aurora** somente leitura que compartilham o mesmo volume. Se o gravador falha, uma réplica é promovida automaticamente.
- **Aurora Global Database**: uma Região primária mais Regiões secundárias somente leitura, com replicação normalmente em menos de um segundo, para leituras globais e recuperação de desastres Regional.

> Material de estudo antigo diz que o Aurora é "multi-master" enquanto o RDS é "single-master". A documentação atual do Aurora descreve um único gravador com leitores, e a antiga página de multi-master agora redireciona. Não escolha "multi-master" como característica do Aurora.

---

## Amazon DynamoDB

- NoSQL totalmente gerenciado e sem servidor: modelos chave-valor e de documento, performance em milissegundos de um dígito em qualquer escala.
- Dados replicados em três AZs por padrão. As **tabelas globais** o tornam multi-Região e multi-ativo.
- Modos de capacidade: **sob demanda** (pagamento por requisição, escala instantaneamente) ou **provisionada**.
- Todos os dados são **criptografados em repouso** por padrão, com uma chave pertencente à AWS sem custo. Você pode mudar para uma chave gerenciada pela AWS ou gerenciada pelo cliente a qualquer momento.
- **DynamoDB Accelerator (DAX)**: um cache em memória que leva as leituras eventualmente consistentes de milissegundos para **microssegundos**, compatível com a API, de modo que a aplicação quase não muda.

---

## Amazon ElastiCache

- Cache em memória, sem servidor ou baseado em nós, com três mecanismos: **Valkey, Memcached e Redis OSS**.
- **Memcached**: o modelo mais simples, nós multithread, escala horizontal para mais e para menos, cache simples de objetos.
- **Valkey ou Redis OSS**: recursos mais ricos, como replicação, Multi-AZ, opções de persistência, pub/sub e conjuntos ordenados (**leaderboards** de jogos).
- Uso típico: colocá-lo na frente do RDS ou de outro armazenamento para reduzir a latência de leitura e a carga do banco de dados.

> Material de estudo antigo diz que o ElastiCache tem dois mecanismos, Redis e Memcached. A documentação atual lista três (Valkey, Memcached, Redis OSS). O Amazon MemoryDB é um banco de dados em memória durável à parte e está fora do escopo deste exame.

---

## Migração de bancos de dados: DMS e SCT

| Necessidade | Ferramenta |
|-------------|------------|
| Mover dados com tempo de inatividade mínimo, mantendo origem e destino sincronizados até a virada | **AWS Database Migration Service (DMS)** |
| Mesmo mecanismo dos dois lados (Oracle para RDS for Oracle) | Apenas o DMS |
| Mecanismos diferentes (Oracle para Aurora PostgreSQL): converter o esquema e o código primeiro | **AWS Schema Conversion Tool (SCT)** (ou o recurso DMS Schema Conversion), depois o DMS para os dados |

O DMS atende bancos de dados relacionais, data warehouses e armazenamentos NoSQL. O SCT é uma ferramenta que você baixa e executa localmente. Há mais sobre serviços de migração na lição 1-3.

Não citado no guia do exame: Amazon Timestream (banco de dados de séries temporais). O Amazon QLDB não é mais documentado pela AWS, então não trate um "banco de dados de livro-razão" como resposta atual.

---

## Atenção

- **Multi-AZ é para disponibilidade, réplicas de leitura são para escalabilidade de leitura.** "Relatórios deixam a produção lenta" indica uma réplica de leitura. "Sobreviver a uma falha de AZ automaticamente" indica Multi-AZ.
- **O standby do Multi-AZ não atende tráfego.** Adicionar Multi-AZ não acelera as leituras.
- **Multi-AZ não é backup.** Uma tabela descartada por engano é replicada para o standby também. Recupere com restauração pontual ou um snapshot.
- **RDS não significa que a AWS ajusta suas consultas.** O design do esquema e o ajuste de consultas continuam com o cliente.
- **O DynamoDB não é relacional.** Não há joins, então um enunciado que exige joins SQL entre várias tabelas quer RDS ou Aurora.
- **O DAX faz cache do DynamoDB, o ElastiCache faz cache de qualquer coisa.** "Microssegundos para uma tabela DynamoDB existente sem reescrever" significa DAX.
- **O SCT converte o esquema, o DMS move os dados.** Uma migração heterogênea usa os dois.
- **O Redshift é um data warehouse, não um banco de dados OLTP.** Ele responde a análises sobre grande histórico, não a transações de carrinho de compras.

## Verificação rápida

1. Consultas de relatório deixam lento um banco de dados RDS de produção que já roda em Multi-AZ. **Adicione uma réplica de leitura e aponte os relatórios para ela.**
2. Um banco de dados relacional deve continuar funcionando se uma AZ falhar, com failover automático. **RDS Multi-AZ.**
3. Um jogo para celular precisa de um armazenamento chave-valor sem servidor com leituras em milissegundos em qualquer escala. **DynamoDB.**
4. Quais mecanismos do ElastiCache oferecem suporte a conjuntos ordenados para leaderboards? **Valkey e Redis OSS.**
5. Oracle para Aurora PostgreSQL com a origem ativa até a virada. **SCT para o esquema, DMS para os dados.**

## Documentação oficial

- [What is Amazon RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html)
- [Multi-AZ DB instance deployments](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html)
- [Working with read replicas](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.html)
- [What is Amazon Aurora](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/CHAP_AuroraOverview.html)
- [What is Amazon DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html)
- [Choosing an ElastiCache engine](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/SelectEngine.html)
- [What is AWS DMS](https://docs.aws.amazon.com/dms/latest/userguide/Welcome.html)
- [What is Amazon Neptune](https://docs.aws.amazon.com/neptune/latest/userguide/intro.html)
