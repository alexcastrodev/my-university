---
version: 1.0
updatedAt: 2026-08-20
title: "Monitoramento do Cassandra: nodetool, Tabelas Virtuais, JMX e Métricas"
summary: Como de fato olhar para dentro de um nó Cassandra em execução, a camada JMX/MBean (StorageServiceMBean, CompactionManagerMBean, GossiperMBean) que expõe estado interno, os comandos nodetool construídos sobre ela (status, info, tpstats, compactionstats, tablestats), e o recurso de tabelas virtuais (system_views, system_virtual_schema) que permite consultar esse mesmo estado com CQL puro, além de métricas Dropwizard, configuração de log, e logging completo de query.
---
## Objective

Entender como de fato olhar para dentro de um cluster Cassandra em execução: a camada JMX/MBean que expõe o estado interno, os comandos `nodetool` construídos por cima dela que você vai rodar durante qualquer incidente, e o recurso de tabelas virtuais que permite consultar esse mesmo estado interno com CQL puro, em vez de uma ferramenta separada. Os conceitos companheiros sobre internos do motor de armazenamento e arquitetura distribuída descrevem o que compaction, memtables, gossip, e tokens *são*; este conceito é sobre como você *observa* esses mecanismos em um nó ao vivo: qual comando diz que um nó está desbalanceado, qual diz que a compaction está atrasada, e qual diz que um cliente está se comportando mal.

## Use Cases

- Rodar `nodetool status` depois de um deploy ou um evento de hardware, para confirmar que todo nó está `UN` (up/normal) antes de assumir que o cluster está saudável: um nó preso em `Leaving` ou inacessível não vai aparecer de nenhuma outra forma.
- Ler `nodetool tpstats` quando a latência visível para o cliente sobe, para diferenciar entre "o nó está ocioso e algo upstream está lento" e "o `MutationStage` está congestionado e este nó genuinamente não consegue acompanhar as escritas."
- Usar `nodetool compactionstats` e `nodetool tablestats` (antigamente `cfstats`) juntos para decidir se uma tabela com latência de leitura degradando tem um backlog real de compaction ou só precisa de uma estratégia de compaction diferente: o passo de diagnóstico que a seção de compaction do conceito de motor de armazenamento assume que você já sabe fazer.
- Consultar `system_views.sstable_tasks`, `system_views.max_partition_size`, ou `system_views.settings` diretamente por uma conexão CQL a partir de código de aplicação ou um script de monitoramento, sem entrar no nó via shell ou abrir uma porta JMX.
- Checar `system_views.clients` para confirmar quais instâncias de aplicação estão de fato conectadas a um nó, e em que volume de requisição, quando um time de cliente reporta "não conseguimos alcançar o Cassandra" e você precisa saber se o problema está do lado deles ou do nó.
- Conectar as métricas JMX baseadas em Dropwizard do Cassandra ao Prometheus e Grafana para dashboards de todo o cluster, em vez de depender da saída pontual do `nodetool` de um nó de cada vez.
- Habilitar logging completo de query com `nodetool enablefullquerylog` para capturar e depois reproduzir tráfego CQL exato quando um incidente de produção precisa ser reproduzido contra um cluster de teste.

## Deep Dive

### JMX e MBeans: a camada sobre a qual tudo o resto se apoia

O Cassandra expõe seus internos através de Java Management Extensions. "JMX é uma API Java que fornece gerenciamento de aplicações de duas formas principais. Primeiro, permite entender a saúde e a performance geral da sua aplicação em termos de memória, threads, e uso de CPU... Segundo, permite trabalhar com aspectos específicos da sua aplicação que você instrumentou." O Cassandra é fortemente instrumentado: "Muitas classes no Cassandra são expostas como MBeans, o que em termos práticos significa que elas implementam uma interface customizada que descreve atributos que expõem e operações que precisam ser implementadas, e para as quais o agente JMX vai fornecer hooks."

O `CompactionManagerMBean` é um exemplo representativo que o livro percorre diretamente:

```java
public interface CompactionManagerMBean
{
    public List<Map<String, String>> getCompactions();
    public List<String> getCompactionSummary();
    public TabularData getCompactionHistory();

    public void forceUserDefinedCompaction(String dataFiles);
    public void stopCompaction(String type);
    public void stopCompactionById(String compactionId);
    public int getCoreCompactorThreads();
    public void setCoreCompactorThreads(int number);
    ...
}
```

"Alguns valores simples na aplicação são expostos como atributos... outros atributos que são somente leitura são as compactions em progresso atuais, o compactionSummary, e o compactionHistory... MBeans também podem disponibilizar operações ao agente JMX que permitem executar alguma ação útil." Esse é o mecanismo, e quase tudo a jusante (`nodetool`, JConsole, dashboards Grafana alimentados por exportadores JMX) é um cliente lendo esses mesmos atributos e invocando essas mesmas operações remotamente: "na maioria dos casos, as operações e atributos expostos pelos MBeans são acessíveis via comandos do nodetool discutidos ao longo deste livro."

Um punhado de MBeans mapeia diretamente para os diagnósticos mais usados:

- `StorageServiceMBean`: reporta `OperationMode` (`normal`, `leaving`, `joining`, `decommissioned`, `client`), os conjuntos de nós vivos e inalcançáveis, e `getLoadMapWithPort()` para carga de armazenamento por nó. Isso sustenta `nodetool status`, `describecluster`, e `ring`.
- `StorageProxyMBean`: valores de timeout de leitura/escrita e estatísticas de hinted handoff (`getTotalHints()`, `getHintsInProgress()`), sustentando `enablehandoff`/`disablehandoff`/`statushandoff`.
- `ColumnFamilyStoreMBean`: uma instância por tabela (e por índice secundário, já que índices são tabelas), expondo `getSSTableCountPerLevel()`, `estimateKeys()`, e `forceMajorCompaction()`. Esse é o conjunto de atributos por trás de `tablestats` e compaction manual.
- `CompactionManagerMBean`: histórico de compaction e a capacidade de forçar ou parar uma compaction específica, por trás de `compact`, `compactionhistory`, e `compactionstats`.
- `GossiperMBean`: `getEndpointDowntime()` e `getCurrentGenerationNumber()`; o número de geração "é incluído em mensagens de gossip trocadas entre nós e é usado para distinguir o estado atual de um nó do estado anterior a um reinício", incrementando a cada reinício. A mecânica de gossip do conceito de arquitetura distribuída aparece aqui como estado diretamente consultável, e `assassinateEndpoint()` ("parecido com o conceito de 'assassinato de personagem' na fofoca humana") é a operação JMX por trás de `nodetool assassinate`, um passo de manutenção de último recurso para um nó que não vai sair do anel normalmente.

Por padrão o JMX é apenas local; habilitar acesso remoto significa editar `cassandra-env.sh` para abrir a porta JMX e, em implantações na nuvem, sobrescrever `java.rmi.server.hostname` para que clientes remotos consigam de fato alcançá-la.

### nodetool: o cliente JMX de linha de comando que você vai usar diariamente

`nodetool` vem em `<cassandra-home>/bin` e é um wrapper fino, feito sob medida: "por trás dos panos, o nodetool usa JMX para acessar os MBeans descritos anteriormente usando uma classe auxiliar chamada `org.apache.cassandra.tools.NodeProbe`." Todo comando (exceto `help`) precisa de um nó alvo; `-h` escolhe o endereço, e sem endereço ele se conecta à porta padrão local. `bin/nodetool help` lista tudo o que está disponível; `help <command>` dá detalhe sobre um.

**Status no nível do cluster.**

`describecluster` imprime o nome do cluster, o snitch, o partitioner, e, criticamente, o acordo de versão de schema entre nós: "a parte de Schema versions da saída é especialmente importante para identificar quaisquer desacordos nas definições de tabela... quaisquer diferenças de schema persistentes geralmente correspondem a um nó que está fora do ar ou inacessível e precisa ser reiniciado."

`status` é a checagem de saúde do dia a dia:

```
Datacenter: datacenter1
=======================
Status=Up/Down
|/ State=Normal/Leaving/Joining/Moving
-- Address     Load        Tokens Owns (effective)           Host ID   Rack
UN 127.0.0.1 251.77 KiB 256        48.7%                     d23716cb... rack1
UN 127.0.0.2 250.28 KiB 256        50.0%                     635f2ab7... rack1
```

"O status de cada nó é identificado por um código de dois caracteres: o primeiro caractere indica se o nó está de pé... ou fora do ar, e o segundo caractere indica o estado ou modo operacional do nó." `UN` é o código que você quer ver em toda linha: essa é a forma mais rápida de confirmar que o quadro de vnode/intervalo de token do conceito de arquitetura distribuída está de fato saudável na prática.

`info`, rodado contra um nó, dá um retrato de nó único mais denso: memória heap e off-heap, uptime, número de geração, e o estado atual dos caches de key/row/counter/chunk, cada um reportado com entradas, tamanho, capacidade, taxa de acerto, e (para caches de key/row/counter) período de salvamento. `ring` mostra o mesmo quadro de up/down e carga organizado por token de vnode, em vez de por nó físico, e `describering` o mostra organizado por intervalo de token.

**Pools de threads e mensagens descartadas: `tpstats`.**

"A ferramenta tpstats nos dá informação sobre os pools de threads que o Cassandra mantém. O Cassandra é altamente concorrente, e otimizado para máquinas multiprocessadas/multicore, então entender o comportamento e a saúde dos pools de threads é importante para uma boa manutenção do Cassandra."

```
Pool Name              Active    Pending    Completed    Blocked   All time blocked
ReadStage                   0           0         399          0   0
MiscStage                   0           0           0          0   0
CompactionExecutor          0           0       95541          0   0
MutationStage               0           0           0          0   0
...

Message type     Dropped     Latency waiting in queue (micros)
                              50%       95%       99%       Max
READ_RSP                0    0.00      0.00      0.00      0.00
```

A seção superior é contagem de tarefas por estágio: "revisando o número de tarefas ativas no MutationStage, você pode aprender quantas escritas estão em andamento." A seção inferior reporta mensagens entre nós descartadas, que acontecem quando "mensagens entre nós que são recebidas por um nó, mas não processadas dentro do rpc_timeout, são descartadas, em vez de processadas, já que o nó coordenador não vai mais estar esperando por uma resposta." A própria leitura do livro sobre os números: "ver muitos zeros na saída para tarefas bloqueadas e mensagens descartadas significa que você tem muito pouca atividade no servidor ou que o Cassandra está fazendo um trabalho excepcional em acompanhar a carga. Muitos valores não-zero são indicativos de situações em que o Cassandra está tendo dificuldade em acompanhar."

**Detalhe por tabela: `tablestats` (antigamente `cfstats`).**

"Para ver estatísticas gerais de keyspaces e tabelas, você pode usar o comando tablestats. Você também pode reconhecer esse comando pelo seu nome anterior, cfstats." Por tabela ele reporta contagem e latência de leitura/escrita, `SSTable count`, `Old SSTable count`, espaço vivo e total usado, taxa de falso positivo do Bloom filter, contagem de células e tamanho de dados da memtable, e médias de tombstone/célula viva por slice. Rodá-lo apenas com um nome de keyspace restringe a esse keyspace; sem argumentos restringe a toda tabela no cluster. Esse é o comando que transforma as abstrações do conceito de motor de armazenamento (memtables, SSTables, Bloom filters, tombstones) em números que você pode de fato acompanhar ao longo do tempo em uma tabela específica.

**Comandos específicos de compaction.** `compactionstats` e `compactionhistory` leem diretamente do `CompactionManagerMBean`; `compact` dispara a compaction major/full desencorajada que o conceito de motor de armazenamento já avisa contra para uso em produção.

### Tabelas virtuais: consultando internos do nó com CQL, em vez de uma ferramenta separada

O Cassandra 4.0 adicionou tabelas virtuais: "tabelas virtuais são assim chamadas porque não são tabelas reais armazenadas usando o caminho de escrita típico do Cassandra, com dados escritos em memtables e SSTables. Em vez disso, essas tabelas virtuais são views que fornecem metadados sobre nós e tabelas via CQL padrão." Três propriedades importam antes de mexer nelas: "você não pode definir suas próprias tabelas virtuais. O escopo de tabelas virtuais é o nó local... ao interagir com tabelas virtuais através do cqlsh, os resultados vão vir do nó ao qual o cqlsh se conectou... tabelas virtuais não são persistidas, então quaisquer estatísticas serão resetadas quando o nó reiniciar."

Dois keyspaces as guardam. `system_virtual_schema` descreve o schema das próprias tabelas virtuais: suas tabelas `keyspaces`, `tables`, e `columns` permitem introspeccionar nomes de coluna, tipos, e papéis de chave primária da mesma forma que `DESCRIBE` faria para uma tabela normal; de fato "o cqlsh tradicionalmente varria tabelas no keyspace system para implementar essas operações, mas foi atualizado na versão 4.0 para usar tabelas virtuais."

`system_views` guarda os dados reais. O livro lista 17 tabelas na versão 4.0: `caches`, `clients`, `coordinator_read_latency`, `coordinator_scan_latency`, `coordinator_write_latency`, `disk_usage`, `internode_inbound`, `internode_outbound`, `local_read_latency`, `local_scan_latency`, `local_write_latency`, `max_partition_size`, `rows_per_read`, `settings`, `sstable_tasks`, `thread_pools`, `tombstones_per_read`. Duas são destacadas como especialmente diagnósticas: "as tabelas max_partition_size e tombstones_per_read são particularmente úteis para ajudar a identificar algumas das situações que levam a má performance em clusters Cassandra": partições largas e acúmulo de tombstones são exatamente os dois modos de falha que a seção de trade-offs do conceito de motor de armazenamento nomeia diretamente.

`clients` te dá, por cliente conectado, endereço, porta, hostname, e contagem de requisições: "essa tabela fornece informação sobre cada cliente com uma conexão ativa ao nó, incluindo sua localização e número de requisições... útil para garantir que a lista de clientes e seu nível de uso está de acordo com o que você espera para sua aplicação." `settings` expõe todo parâmetro configurável do `cassandra.yaml` como atualmente em vigor naquele nó, incluindo qualquer coisa sobrescrita ao vivo via JMX, consultável pelo mesmo protocolo nativo CQL que sua aplicação já usa: "o valor das tabelas virtuais é que elas podem ser acessadas através de qualquer cliente usando o protocolo nativo CQL, incluindo aplicações que você escreve usando os DataStax Java Drivers."

### Métricas e arquivos de log

Além de `nodetool` e tabelas virtuais, o Cassandra registra uma ampla gama de métricas Dropwizard (contadores, gauges, meters, histogramas, timers) sob o domínio JMX `org.apache.cassandra.metrics`, cobrindo pools de buffer, execução de declaração CQL, caches, conexões de cliente, commit log, compaction, gossip/conexões entre nós, mensagens descartadas, read repair, hints, streaming, pools de threads, e histogramas de latência por tabela/keyspace em intervalos de 1, 5, e 15 minutos. `tpstats`, `tablehistograms`, e `proxyhistograms` são todos apenas apresentações curadas desse mesmo registro de métricas. Uma ressalva que vale a pena lembrar durante um incidente: "em versões do Cassandra até a 4.0, as métricas reportadas são métricas de vida útil desde que o nó foi iniciado. Para resetar as métricas em um nó, você precisa reiniciá-lo."

Para visibilidade em todo o cluster, essas métricas alimentam ferramental padrão de agregação: "as métricas do Cassandra também podem se encaixar em uma estratégia de observabilidade mais ampla para suas aplicações... frameworks de agregação de métricas como o Prometheus e ferramentas de visualização de métricas como o Grafana." Uma integração publicada fornece quatro dashboards Grafana embutidos: visão geral do cluster, métricas do cluster (carga e latência de leitura/escrita, tarefas ativas/pendentes/bloqueadas por nó), métricas de tabela (fatiadas por keyspace e tabela), e métricas de sistema (computação do SO do host), que é a resposta prática para a maior limitação do `nodetool`: ele só mostra um nó de cada vez.

Logging é a ferramenta complementar, mais granular. O Cassandra usa SLF4J com Logback, configurado em `<cassandra-home>/conf/logback.xml`, com a progressão de nível padrão `ALL < DEBUG < INFO < WARN < ERROR < FATAL < OFF` e appenders padrão escrevendo `system.log` (INFO+), `debug.log` (DEBUG+), e `gc.log`. Vários gatilhos de nível WARN são diretamente ajustáveis via `cassandra.yaml`: `tombstone_warn_threshold` (padrão 1.000 tombstones varridos por uma única leitura), `batch_size_warn_threshold_in_kb` (padrão 5 KB), e `gc_warn_threshold_in_ms` (padrão 1.000 ms, com um `gc_log_threshold_in_ms` separado de 200 ms para logging de pausa de GC no nível INFO). Níveis de log podem ser vistos e mudados em um nó ao vivo sem reinício via `nodetool getlogginglevels` e `setlogginglevel`. Para detalhe exato no nível de query, `full_query_logging_options` no `cassandra.yaml` mais `nodetool enablefullquerylog`/`disablefullquerylog` capturam toda declaração CQL em um log binário projetado para "captura e replay de tráfego ao vivo", legível com o `tools/bin/fqltool dump` incluído.

### Book vs today

> **Tabelas virtuais cresceram bem além da linha de base de 17 tabelas da 4.0 do livro, e o crescimento continuou pelo Cassandra 5.0, em vez de parar.** O livro (visando a 4.0) lista `system_views` como 17 tabelas e sinaliza explicitamente que mais foram propostas na Jira: CASSANDRA-15254 (write-back de settings), CASSANDRA-14795 (metadado de hints), CASSANDRA-14572 (métricas de tabela adicionais), CASSANDRA-12367 (tamanhos de partição), CASSANDRA-15241 (queries em execução), CASSANDRA-15399 (status de repair), prevendo que "os dados disponíveis via tabelas virtuais eventualmente vão alcançar o JMX, e até superá-lo em algumas áreas." Segundo a [documentação atual do Apache Cassandra](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/virtualtables.html), `system_views` agora também inclui `cql_metrics`, `system_properties`, `system_logs`, e tabelas de filtragem CIDR (`cidr_filtering_metrics_counts`, `cidr_filtering_metrics_latencies`) adicionadas desde a 4.0. `system_logs` em particular é um salto de capacidade notável além do que o livro descreve: um appender Logback dedicado `CQLLOG` pode transmitir mensagens de log diretamente para uma tabela virtual consultável (limitado por padrão a 50.000 linhas, com limite rígido de 100.000, ajustável via a propriedade de sistema `cassandra.virtual.logs.max.rows`), significando que o histórico recente de log agora é consultável com CQL junto com métricas, não apenas acompanhado a partir de um arquivo. Tabelas virtuais continuam sendo locais ao nó, não persistentes, e somente leitura para propósitos de usuário exatamente como o livro descreve: essa restrição de design não mudou; mas a lacuna prática com JMX/`nodetool` que o livro previu que se fecharia, de fato, continuou se fechando.

## Trade-offs

- **`nodetool` é simples e sempre disponível, mas é fundamentalmente de nó único.** Todo comando se conecta a um nó de cada vez via `-h`; entender a saúde de todo o cluster significa ou scriptar `nodetool` através de cada nó, ou agregar as métricas subjacentes em outro lugar (Prometheus/Grafana). Para um cluster pequeno isso é um incômodo menor; para um cluster com dezenas de nós é a razão pela qual a agregação de métricas existe.
- **Tabelas virtuais são mais acessíveis do que JMX, mas ainda deliberadamente limitadas.** Podem ser consultadas com o mesmo driver CQL que sua aplicação já usa, sobre o protocolo nativo, sem uma porta JMX ou cliente separado: uma simplificação operacional real. Mas não podem ser definidas por usuários, têm escopo estritamente limitado ao nó conectado (então um load balancer ou driver poderia rotear sua query de monitoramento para um nó diferente toda vez, a menos que você fixe a conexão), e resetam ao reiniciar, então não podem substituir armazenamento durável de histórico de métricas.
- **JMX te dá operações de gerenciamento, não apenas visibilidade, que é exatamente por que precisa ser trancado.** MBeans como `StorageServiceMBean` e `HintsServiceMBean` expõem operações mutantes reais (`decommission()`, `assassinateEndpoint()`, `deleteAllHints()`), alcançáveis por qualquer cliente JMX com acesso. Acesso remoto JMX está desligado por padrão por essa razão; abri-lo significa abrir um canal que pode reconfigurar ou remover nós, não apenas ler seu estado.
- **Métricas de vida útil sem um reinício são honestas, mas operacionalmente incômodas.** Como métricas até a 4.0 acumulam desde o início do nó, em vez de resetar sob demanda, uma taxa que você calcula a partir do `tpstats` ou de um contador Dropwizard no meio de um incidente é diluída por quanto tempo o nó está rodando; ou você acompanha deltas você mesmo entre duas leituras, ou reinicia o nó para resetar, sendo a segunda uma forma disruptiva de obter uma base limpa.
- **Logging completo de query é projetado para ter baixo overhead, mas ainda é um custo sempre ativo enquanto habilitado.** É descrito como "extremamente rápido" especificamente porque é um log binário feito sob medida, em vez de reutilizar `system.log`, mas capturar toda declaração CQL para replay ainda é I/O e disco que uma tabela com volume pesado de query vai perceber; é pensado para ser ligado por uma janela de diagnóstico via `enablefullquerylog`/`disablefullquerylog`, não deixado rodando indefinidamente como padrão.
- **Limiares de WARN (`tombstone_warn_threshold`, `batch_size_warn_threshold_in_kb`, `gc_warn_threshold_in_ms`) são ajustáveis, o que significa que podem ser ajustados até a inutilidade.** Subir um limiar para silenciar avisos barulhentos em uma tabela que está genuinamente acumulando tombstones ou batches grandes demais remove o alerta antecipado baseado em log de que a seção de trade-offs de tombstone do conceito de motor de armazenamento depende: o limiar de aviso e o problema subjacente são duas coisas diferentes, e ajustar o primeiro não faz nada ao segundo.

## Documentation Links

- [Jeff Carpenter and Eben Hewitt, "Cassandra: The Definitive Guide", Revised 3rd Edition (O'Reilly, 2022), Chapter 11, "Monitoring" ("Monitoring Cassandra with JMX" through "Logging")](https://www.oreilly.com/library/view/cassandra-the-definitive/9781492097143/) - doc
- [Apache Cassandra Documentation, nodetool](https://cassandra.apache.org/doc/latest/cassandra/managing/tools/nodetool/nodetool.html) - doc
- [Apache Cassandra Documentation, Virtual Tables](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/virtualtables.html) - doc
- [Apache Cassandra Documentation, Monitoring (metrics, JMX, Dropwizard)](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/metrics.html) - doc
- [Apache Cassandra Documentation, logback.xml file and logging configuration](https://cassandra.apache.org/doc/latest/cassandra/managing/configuration/cass_logback_xml_file.html) - doc
- [Apache Cassandra Blog, Announcing Apache Cassandra 5.0](https://cassandra.apache.org/_/blog/Apache-Cassandra-5.0-Announcement.html) - doc
