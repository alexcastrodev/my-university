---
version: 1.0
updatedAt: 2026-11-21
---
# Serviços de análise de dados: Athena, Glue, EMR, Kinesis, Redshift, OpenSearch e Amazon Quick

> Domínio do exame: **Tecnologia e serviços de nuvem (34%)**, objetivo 3.7 *Identificar os serviços de IA/ML e os serviços de análise de dados* (parte de análise de dados).

---

## O que o exame cobra

O guia cita Amazon Athena, Amazon Kinesis, AWS Glue e Amazon Quick como exemplos de serviços de análise de dados. A lista de análise de dados no escopo acrescenta **Amazon EMR, Amazon OpenSearch Service e Amazon Redshift**. As questões descrevem o que alguém quer fazer com os dados, e um substantivo no enunciado decide o serviço.

---

## O substantivo decide

| O enunciado diz | Serviço | Formato |
|-----------------|---------|---------|
| **Consultar** arquivos no S3 com SQL, ocasionalmente, pagando por consulta, sem servidores | **Amazon Athena** | SQL interativo sem servidor, cobrado pelos dados examinados |
| **Transformar**, limpar, catalogar e mover dados (ETL), descobrir esquemas | **AWS Glue** | Integração de dados sem servidor com um Data Catalog central |
| **Cluster** de Hadoop ou Spark para processamento de big data | **Amazon EMR** | Clusters gerenciados de frameworks de big data |
| **Fluxo** (stream) de registros em tempo real (clickstream, logs, IoT, pedidos) | **Amazon Kinesis** | Ingestão e entrega de streaming em tempo real |
| **Warehouse** com anos de dados estruturados para relatórios complexos | **Amazon Redshift** | Data warehouse em escala de petabytes |
| **Pesquisar** e analisar logs ou texto quase em tempo real | **Amazon OpenSearch Service** | Clusters OpenSearch gerenciados (mecanismo de busca e análise) |
| **Painel** ou visualização de BI para usuários de negócios | **Amazon Quick** | BI e análise com IA, painéis do Quick Sight |

```text
 Fontes --> Kinesis (stream) ---+
                                +--> data lake no S3 --> Glue (catálogo, ETL) --> Athena (SQL)
 Bancos --> Glue (ETL) ---------+                                      \--> Redshift (warehouse)
                                                                        \--> EMR (Spark, Hadoop)
                                       Redshift / Athena --> Amazon Quick (painéis)
```

---

## Amazon Athena

- Serviço de consulta interativa que analisa dados **diretamente no Amazon S3** com SQL padrão.
- **Sem servidor**: nenhuma infraestrutura para configurar, e você paga pelas consultas que executa. Para consultas SQL, a cobrança é baseada nos dados que cada consulta examina (em 21/11/2026), então uma consulta que examina menos dados custa menos.
- O Athena é a resposta para "SQL ad hoc ocasional em logs que estão no S3". O Redshift se encaixa quando os mesmos dados grandes são consultados o dia inteiro por muitos relatórios.

---

## AWS Glue

- **Integração de dados** sem servidor: descobrir, preparar, mover e integrar dados de muitas fontes.
- Cria pipelines de **ETL** (extrair, transformar, carregar) e mantém um **Data Catalog** central dos seus conjuntos de dados e de seus esquemas.
- O Glue é um serviço de ETL em lote e de catálogo, não a resposta para streaming em tempo real.

---

## Amazon EMR

- Antigo Elastic MapReduce: clusters gerenciados para **Hadoop, Spark** e frameworks de código aberto relacionados.
- Encaixa-se em "mover nossos jobs Hadoop ou Spark do ambiente local (on-premises) para a AWS sem gerenciar o software do cluster". O EMR também transforma e move grandes volumes de dados, então pode executar ETL.
- O escalonamento gerenciado adiciona ou remove instâncias do cluster conforme o workload.

---

## Amazon Kinesis

| Recurso | Use para |
|---------|----------|
| **Kinesis Data Streams** | Ingerir registros em tempo real para **as suas próprias aplicações consumidoras**, que os leem em menos de um segundo |
| **Kinesis Data Firehose** (agora chamado Amazon Data Firehose) | **Entregar** dados de streaming ao S3, ao Redshift, ao OpenSearch Service e a outros destinos **sem código de consumidor** |
| **Kinesis Video Streams** | Transmitir vídeo ao vivo de câmeras e celulares para análise |
| **Kinesis Data Analytics** (agora chamado Amazon Managed Service for Apache Flink) | Processar streams com SQL, Java, Scala ou Python |

Regra: **"processamento personalizado em tempo real" indica Data Streams; "apenas carregar o stream no S3 ou no Redshift" indica Firehose.**

> Material de estudo antigo usa "Kinesis Data Firehose", "Kinesis Data Analytics" e "Elasticsearch Service". A documentação atual os chama de Amazon Data Firehose, Amazon Managed Service for Apache Flink e Amazon OpenSearch Service. O guia do exame lista apenas "Amazon Kinesis" e "Amazon OpenSearch Service".

---

## Amazon Redshift

- **Data warehouse em escala de petabytes** totalmente gerenciado, para análise com SQL. O **Redshift Serverless** elimina o dimensionamento de clusters.
- O **Redshift Spectrum** consulta arquivos no S3 sem carregá-los em tabelas do Redshift.
- O Redshift serve para análise (OLAP) sobre grande histórico, não para as transações do dia a dia de uma aplicação (OLTP), que pertencem ao RDS, ao Aurora ou ao DynamoDB.

---

## Amazon OpenSearch Service

- Serviço gerenciado para implantar, operar e escalar clusters **OpenSearch** (chamados domínios). Ele também executa versões legadas do Elasticsearch.
- O OpenSearch é um mecanismo de busca e análise para casos de uso como **análise de logs, monitoramento de aplicações em tempo real e análise de clickstream**, com o OpenSearch Dashboards para visualização.

---

## Amazon Quick

- O guia do exame o chama de **Amazon Quick** (a documentação usa a marca AWS Quick). Ele substituiu o nome independente QuickSight.
- Um serviço com IA para analisar dados, automatizar tarefas e fazer pesquisas por meio de chat em linguagem natural sobre dados conectados.
- O recurso **Quick Sight** oferece painéis interativos, visualizações de BI e análise incorporada. Essa é a parte que o exame cobra: "usuários de negócios precisam de painéis compartilháveis com dados do Redshift ou do Athena".

> Material de estudo antigo diz "Amazon QuickSight". O guia do exame (versão 1.3) lista **Amazon Quick**, e os painéis do QuickSight agora são o recurso Quick Sight do Amazon Quick.

Não citados no guia do exame: AWS Lake Formation (permissões detalhadas em um data lake). Fora do escopo: Amazon MSK (Apache Kafka gerenciado) e AWS Data Exchange.

---

## Atenção

- **O Athena consulta no local, o Redshift carrega em um warehouse.** "Sem infraestrutura, pagamento por consulta, dados já no S3" indica Athena.
- **O Glue é ETL e catálogo, não streaming.** Um enunciado "em tempo real" quer Kinesis.
- **O Firehose entrega, o Data Streams permite criar consumidores.** "Sem código personalizado para carregar no S3" é Firehose.
- **O EMR é a resposta para Hadoop ou Spark.** Se o enunciado cita esses frameworks, escolha EMR em vez de Glue.
- **Painéis são Amazon Quick,** não o Athena (que retorna resultados de consultas) e não o OpenSearch (a menos que o enunciado seja sobre busca em logs).
- **O Redshift é OLAP.** Ele está na lista de Análise de dados, embora seja um banco de dados.
- **Use os nomes do guia nas respostas:** Amazon Quick, Amazon Kinesis, Amazon OpenSearch Service.

## Verificação rápida

1. Analistas executam algumas consultas SQL por semana em arquivos de log no S3 e não querem servidores. **Amazon Athena.**
2. Eventos de clickstream precisam chegar ao S3 a cada poucos minutos sem código de consumidor. **Kinesis Data Firehose (agora Amazon Data Firehose).**
3. Um cluster Spark no local (on-premises) passa para um serviço gerenciado. **Amazon EMR.**
4. Combinar cinco anos de dados de vendas de vários bancos de dados para relatórios complexos. **Amazon Redshift.**
5. Executivos querem painéis interativos sobre esse warehouse. **Amazon Quick (Quick Sight).**

## Documentação oficial

- [What is Amazon Athena](https://docs.aws.amazon.com/athena/latest/ug/what-is.html)
- [What is AWS Glue](https://docs.aws.amazon.com/glue/latest/dg/what-is-glue.html)
- [What is Amazon EMR](https://docs.aws.amazon.com/emr/latest/ManagementGuide/emr-what-is-emr.html)
- [Amazon Kinesis Data Streams](https://docs.aws.amazon.com/streams/latest/dev/introduction.html)
- [What is Amazon Data Firehose](https://docs.aws.amazon.com/firehose/latest/dev/what-is-this-service.html)
- [What is Amazon Redshift](https://docs.aws.amazon.com/redshift/latest/mgmt/welcome.html)
- [What is Amazon OpenSearch Service](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/what-is.html)
- [What is AWS Quick](https://docs.aws.amazon.com/quicksight/latest/user/welcome.html)
