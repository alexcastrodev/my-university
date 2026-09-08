---
version: 1.0
updatedAt: 2026-08-20
title: "Manutenção do Cassandra: Repair, Operações de Nó e Backup"
summary: Cobre a manutenção conduzida pelo operador que mantém um cluster Cassandra saudável, anti-entropy repair via nodetool repair (completo versus incremental, sequencial versus paralelo, repair de intervalo primário e de sub-intervalo, árvores de Merkle e overstreaming), o ciclo de vida do nó (adicionar nós e data centers, diagnosticar e substituir nós que falharam, decommission/removenode/assassinate em ordem de preferência), e backup/restauração via snapshots e backups incrementais (SSTables com hard link, sstableloader, a ressalva de exclusão do schema).
---
## Objective

Entender a metade do operador na história de consistência do Cassandra: o **repair de anti-entropia periódico e disparado manualmente** (`nodetool repair`) que captura tudo o que os mecanismos por query deixam passar, as **operações de ciclo de vida do nó** (adicionar, substituir e remover nós) que mantêm o conjunto de réplicas de um cluster correto conforme o hardware vai e vem, e o ferramental de **backup e restauração** (`nodetool snapshot`, backups incrementais) que protege contra os modos de falha que a replicação não cobre: erro humano, corrupção, e desastre multi-datacenter. Onde o conceito irmão de níveis de consistência cobre hinted handoff e read repair como coisas que acontecem automaticamente *durante* uma requisição, este conceito cobre a manutenção que um operador agenda e roda *entre* requisições.

## Use Cases

- Agendar um job recorrente de `nodetool repair` (via cron, Reaper, ou um operador Kubernetes) e escolher uma cadência que mantenha todo nó reparado dentro do `gc_grace_seconds` de suas tabelas, para que uma réplica fora do ar nunca possa ressuscitar uma linha deletada.
- Decidir se um determinado repair precisa de `-pr` (apenas o intervalo primário, para varreduras de rotina), `-full` (para uma mudança de snitch, mudança de fator de replicação, ou recuperação de um nó que ficou fora do ar), ou uma restrição de escopo `-dc`/`-local`.
- Trazer um cluster de volta à capacidade total depois que um nó morre: escolher entre "substituí-lo" (`-Dcassandra.replace_address_first_boot`) e "apenas adicionar um nó novo e desativar o morto", e saber por que o livro chama a segunda opção de ineficiente.
- Retirar um nó ou um data center inteiro sem perda de dados: percorrer `decommission` → `removenode` → `assassinate` na ordem que o livro recomenda, e entender o que cada um de fato promete.
- Construir uma estratégia de backup que satisfaça tanto "precisamos nos recuperar de um `DROP TABLE` que alguém rodou por acidente" quanto "precisamos sobreviver à perda de um data center": snapshots para o primeiro, snapshots mais backups incrementais enviados para fora do cluster para o segundo.
- Explicar a um engenheiro de plantão por que o `nodetool status` mostrando um nó `DN` por dez minutos não é automaticamente um incidente, mas o mesmo nó fora do ar por mais tempo do que `max_hint_window` é um incidente do tipo "isso precisa de um repair ou de uma reconstrução."

## Deep Dive

### Anti-entropy repair: `nodetool repair`

O problema que o repair resolve é enunciado com precisão no livro: "escritas em níveis de consistência menores que `ALL` podem ter sucesso mesmo que alguns dos nós não respondam, especialmente quando um cluster está sob carga pesada. Também é possível que um nó perca mutações se estiver fora do ar ou inacessível por mais tempo do que a janela de tempo em que hints são armazenados. O resultado é que réplicas diferentes de uma partição diferente podem ter versões diferentes dos seus dados." Deleções pioram isso: "um nó que está fora do ar quando a deleção ocorre e permanece offline por mais tempo do que o `gc_grace_seconds` definido para a tabela em questão pode 'ressuscitar' o dado quando volta a ficar online." Hinted handoff e read repair (cobertos no conceito de níveis de consistência) estreitam essa janela por query; `nodetool repair` é a varredura que a fecha para dados que ninguém chegou a ler.

Um repair básico:

```
$ nodetool repair
[2019-12-09 17:53:01,741] Starting repair command #1 (6aa75460-...
...
[2019-12-09 17:53:06,213] Repair completed successfully
```

Por trás desse comando: o nó em que você o roda se torna o **coordenador do repair**, um papel diferente do coordenador por query descrito no conceito de níveis de consistência, mas a mesma ideia de "qualquer nó que você fale assume o comando dessa operação específica." `org.apache.cassandra.service.ActiveRepairService` roda uma **compaction de validação**: uma passagem somente leitura sobre dados locais que constrói árvores de Merkle (veja o conceito de níveis de consistência para o que é uma árvore de Merkle) para as tabelas em repair. O nó então troca árvores com réplicas vizinhas via uma troca `TreeRequest`/`TreeResponse`; onde as árvores discordam, os nós transmitem os intervalos discordantes um para o outro.

Esse passo de streaming tem um custo bem conhecido, chamado **overstreaming**: "se você tem muitos dados em uma tabela, a resolução das árvores de Merkle não vai chegar até a partição individual. Por exemplo, em um nó com um milhão de partições, cada nó folha da árvore de Merkle vai representar cerca de 30 partições. Cada uma dessas partições vai ter que ser transmitida junto, mesmo que apenas uma única partição precise de repair." Todo botão abaixo existe para encolher o espaço de busca ou o raio de impacto desse streaming.

**Repair completo versus incremental, e anti-compaction.** Antes da 2.1, todo repair era o que hoje se chama de **repair completo**: toda SSTable examinada, toda vez. O **repair incremental** (2.1+, padrão desde a 2.2) separa dados reparados de dados não reparados via **anti-compaction**, então todo repair subsequente só precisa buscar na fatia não reparada: menos SSTables, árvores de Merkle menores, menos overstreaming. O Cassandra marca isso no metadado da SSTable; `sstablemetadata` em uma SSTable nova mostra `Repaired at: 0` até que ela tenha passado por um repair. Para forçar um repair completo apesar do padrão, passe `-full`.

**Repair sequencial versus paralelo.** Sequencial (`-seq`, padrão até a 2.1) repara o coordenador contra uma réplica de cada vez, tirando um snapshot em cada nó para construir árvores de Merkle a partir dele; o snitch dinâmico mantém a performance favorecendo réplicas que não estão ocupadas com o repair no momento. Paralelo (`-par`, padrão desde a 2.2) repara todas as réplicas simultaneamente: carga mais pesada, conclusão mais rápida, sem necessidade de snapshots.

**Opções de escopo que encolhem o trabalho:**

| Opção | Efeito |
|---|---|
| `-pr` / `--partitioner-range` | Repara apenas o intervalo primário do nó, em vez de todo intervalo que ele replica. Rode `-pr` em todo nó e o anel inteiro é reparado exatamente uma vez cada, em vez de RF vezes. |
| `-st <token> -et <token>` | **Repair de sub-intervalo**: quebra o intervalo de um nó em um pedaço menor, tanto encolhendo o trabalho quanto afiando a resolução da árvore de Merkle o suficiente para identificar linhas individuais com precisão, cortando o overstreaming ainda mais. O livro observa que isso raramente é feito manualmente; ferramentas como o **Reaper** o automatizam. |
| `-local` / `-dc <name>` | Restringe o repair ao data center local, ou a um nomeado. |

O **Reaper**, criado pelo Spotify com uma UI web adicionada pela The Last Pickle, é a resposta recomendada pelo livro para "como eu de fato rodo repairs de sub-intervalo em escala": ele "orquestra repairs em um ou mais clusters, e permite pausar, retomar, ou cancelar repairs e rastrear o status do repair", usando repair de sub-intervalo mais um mecanismo de backpressure, com estado armazenado em memória, H2, Postgres, ou o próprio Cassandra.

**Boas práticas que o livro destaca explicitamente:**

- *Frequência* é uma função dos seus níveis de consistência, `gc_grace_seconds`, e estratégia de repair juntos: níveis de consistência mais frouxos exigem repair mais frequente.
- *Agendamento*: rode repairs fora do pico, ou espalhe a carga com repair de sub-intervalo ou horários de início escalonados por keyspace/tabela.
- *Operações que exigem um repair completo independentemente do agendamento*: mudar o snitch, mudar o fator de replicação de um keyspace, ou recuperar um nó que ficou fora do ar.
- *Conflitos*: "o Cassandra não permite múltiplos repairs simultâneos sobre um dado intervalo de token", então gerencie o agendamento de repair a partir de um local externo, em vez de deixar todo nó disparar o seu próprio.
- *Monitoramento em andamento*: `nodetool netstats`, até que (segundo o livro, citando a JIRA `CASSANDRA-10302`) "um mecanismo de status de repair mais robusto seja implementado."
- *Índices secundários não são cobertos pelo repair de forma alguma*: são tabelas apenas locais, então use `nodetool rebuild_index` depois de reparar a tabela base.

#### Book vs today

> **A cadência recomendada agora é um número concreto, não apenas "com frequência suficiente."** A orientação do livro é qualitativa: repare antes que o `gc_grace_seconds` expire em dados não reparados. A documentação de operações atual do Apache Cassandra coloca um número nisso: com o `gc_grace_seconds` padrão de 10 dias, "reparar todo nó no seu cluster pelo menos uma vez a cada 7 dias vai prevenir" a ressurreição de tombstones, e como ponto de partida para um cluster saudável, "rodar um repair incremental a cada 1-3 dias, e um repair completo a cada 1-3 semanas provavelmente é razoável." O mecanismo subjacente (árvores de Merkle, anti-compaction, overstreaming) permanece inalterado em relação ao livro; o que é novo é uma cadência operacionalmente concreta construída em cima disso.
> **A falha conhecida do repair incremental foi corrigida, não substituída.** O livro sinaliza, via uma referência ao "Incremental Repair Improvements in Cassandra 4" de Alex Dejanovski, que a anti-compaction sozinha não era suficiente para prevenir overstreaming em versões pré-4.0, sem dizer exatamente o que mudou. Ele ainda é o padrão no Cassandra atual, e a documentação atual ainda recomenda rodar repairs completos ocasionais mesmo assim, "porque repairs incrementais não protegem contra coisas como corrupção de disco, [ou] erro do operador", da forma que um repair completo do zero protege. A correção tornou o repair incremental mais eficiente; não tornou o repair completo obsoleto.
> **A `CASSANDRA-10302` ("rastrear estado de repair para um repair mais confiável"), que o livro cita como a razão de `netstats` ser o melhor que você consegue, ainda está aberta.** `nodetool netstats` continua sendo a forma prática de acompanhar um repair em andamento; nenhuma API de status de repair mais rica e nativa chegou ao Cassandra principal. Ferramentas como o Reaper preenchem essa lacuna com seu próprio rastreamento, o que é uma grande parte do motivo pelo qual o livro, e a prática atual, os recomendam em vez de scripts artesanais.

### Ciclo de vida do nó: adicionando, substituindo e removendo nós

**Adicionando um nó.** Além de instalar a mesma versão do Cassandra e igualar as configurações do `cassandra.yaml` (`cluster_name`, `dynamic_snitch`, `partitioner`, lista de seeds), o padrão operacionalmente importante é `autobootstrap: true`: um nó novo reivindica intervalos de token e transmite sua fatia dos dados automaticamente na inicialização. Acompanhe o progresso com `nodetool status` ou `nodetool bootstrap` (ou retome um bootstrap desabilitado sob demanda com `nodetool bootstrap resume`). **Depois de toda adição de nó, rode `nodetool cleanup` nos nós que já existiam**: o bootstrap reatribui intervalos de token, mas não deleta os dados agora sem dono que esses nós ainda estão guardando; `cleanup` é uma compaction de caso especial que os descarta. Pular esse passo é uma razão comum para um cluster "balanceado" ainda mostrar uso de disco desigual depois de escalar horizontalmente.

**Adicionar um data center** segue o mesmo procedimento nó por nó, mais: escolha seeds por DC de forma independente, configure o snitch (reparando primeiro se você estiver mudando ele em nós existentes), e só depois que todo nó no novo DC estiver de pé, altere a replicação do keyspace para incluí-lo, por exemplo `ALTER KEYSPACE reservation WITH REPLICATION = {'class': 'NetworkTopologyStrategy', 'DC1': 3, 'DC2': 3};`, e então rode `nodetool rebuild -- DC1` em cada nó do novo DC para transmitir seus dados. O box do livro avisa para não pular uma consequência do lado do cliente: times usando `QUORUM` vão de repente ter leituras e escritas cruzando o link WAN do novo data center, a menos que migrem para `LOCAL_QUORUM`, que é exatamente o trade-off `LOCAL_QUORUM` versus `EACH_QUORUM` descrito no conceito de níveis de consistência.

**Diagnosticar um nó que falhou** é uma árvore de decisão de três caminhos, definida por quanto tempo ele ficou fora do ar, em relação a duas janelas independentes:

1. Fora do ar por menos tempo do que a janela de entrega de hints (`max_hint_window`) → reinicie-o; o hinted handoff deve colocá-lo em dia.
2. Fora do ar por mais tempo do que a janela de hints, mas menos do que o menor `gc_grace_seconds` entre suas tabelas → reinicie-o, depois rode `nodetool repair`.
3. Fora do ar por mais tempo do que a janela de repair → **reconstrua ou substitua**, para evitar a ressurreição de tombstones.

Esse terceiro caso é a ligação direta com a ressalva do conceito irmão de arquitetura sobre hinted handoff: hints expiram, e um nó fora do ar além dessa expiração perdeu escritas permanentemente, que só um repair completo (ou uma reconstrução) pode restaurar.

**Substituir um nó**, em vez de remover-e-então-adicionar, é a recomendação explícita do livro, porque remover-e-adicionar "resulta em streaming excessivo de dados." O caminho eficiente é subir um nó novo com o IP do nó morto passado via `-Dcassandra.replace_address_first_boot=<address>` no `jvm.options`, e então seguir o procedimento normal de adicionar nó; `nodetool netstats` no substituto acompanha o progresso do bootstrap. Se o nó substituído era um seed, promova primeiro um nó não-seed existente para preencher esse papel, para que o próprio substituto possa fazer bootstrap normalmente como um não-seed.

**Remover um nó**: o livro dá três técnicas, "em ordem de preferência":

| Técnica | Quando | O que acontece |
|---|---|---|
| `nodetool decommission` | Nó está de pé | Chama `StorageService.decommission()`; o nó reatribui seus intervalos de token a outros nós e transmite seus dados para eles antes de sair: a imagem espelhada do bootstrap. Aparece como `UL` (up, leaving) no `nodetool status` enquanto roda. |
| `nodetool removenode <host-id>` | Nó está fora do ar | Rodado a partir de um nó *diferente*, mirando no morto pelo host ID (não pelo IP). O Cassandra recalcula os intervalos e transmite das réplicas sobreviventes para os novos donos. |
| `nodetool assassinate <ip>` | `removenode` (mesmo `-force`) falhou | Último recurso: remove o nó do estado de gossip **sem** retransmitir seus dados a lugar nenhum, "o que deixa seu cluster em um estado onde repair é necessário." Recebe um IP, não um host ID. |

Duas consequências fáceis de perder: decomissionar **não deleta os arquivos de dados do nó**: reintroduzir um nó decomissionado no anel depois exige limpar manualmente seus dados antigos primeiro; e remover um nó seed exige limpar manualmente seu endereço da lista de seeds do `cassandra.yaml` de todo nó restante.

**Remover um data center** reutiliza os mesmos blocos de construção: confirme que nenhum cliente ainda está se conectando (o livro aponta para consultar a tabela virtual `system_views.clients`), rode um repair completo para que nada nos intervalos do DC saindo seja perdido, `ALTER KEYSPACE` para reduzir o fator de replicação desse DC a zero para todo keyspace afetado, e então pare cada nó.

### Backup e restauração: snapshots e backups incrementais

Replicação não é uma estratégia de backup: ela protege contra um nó falhar, não contra "uma pessoa ou um bug deletando dados bons e essa deleção se replicando por toda parte antes que alguém perceba", corrupção de SSTable, ou uma interrupção multi-DC. A resposta do Cassandra é dois mecanismos complementares:

- **Snapshots** (`nodetool snapshot`): um backup completo. O Cassandra descarrega memtables primeiro, depois cria um **hard link** para todo arquivo SSTable, então a operação é quase instantânea e não custa espaço extra em disco *até* que a compaction depois remova o arquivo original e o hard link seja a única coisa mantendo o dado em disco.
- **Backups incrementais** (`nodetool enablebackup`): uma vez habilitado, todo flush de SSTable adicionalmente cria um hard link em um diretório `backups/` sob o diretório de dados da tabela, dando backups contínuos e pequenos entre os snapshots.

```
$ nodetool snapshot
Snapshot directory: 1576202815095
```

Snapshots por padrão cobrem todo keyspace, incluindo os próprios keyspaces de sistema do Cassandra; passe um keyspace (e opcionalmente `-cf <table>`) para restringir o escopo. `nodetool listsnapshots` inventaria o que existe; cada diretório de snapshot carrega um `manifest.json` listando as SSTables que contém, então uma restauração pode verificar completude. Como `nodetool snapshot` só toca o único nó em que roda, um snapshot verdadeiro de um ponto no tempo através de um cluster precisa de uma ferramenta de ssh paralelo para disparar o comando em todo nó simultaneamente. O Cassandra também tira um **snapshot automático** em todo `DROP KEYSPACE`, `DROP TABLE`, ou `TRUNCATE`, controlado por `auto_snapshot` (habilitado por padrão), especificamente como uma rede de segurança contra o caso de "alguém rodou uma declaração DDL destrutiva."

**Restaurar** começa a partir do snapshot mais recente mais quaisquer backups incrementais feitos desde então. Duas coisas que as pessoas erram na primeira tentativa:

1. **Schema não está incluído em um snapshot ou backup.** O livro é direto sobre isso: "o Cassandra não inclui o schema do banco de dados como parte de snapshots e backups. Você vai precisar garantir que o schema está no lugar antes de fazer qualquer operação de restauração": scriptar `DESCRIBE TABLES` de antemão é a salvaguarda sugerida pelo livro.
2. **O mecanismo de restauração depende de se a topologia do cluster mudou desde o backup.** Se intervalos de token e replicação não mudaram, `nodetool import` (ou, pré-4.0, `nodetool refresh`) carrega os arquivos SSTable copiados diretamente no diretório de dados de um nó em execução. Se topologia, tokens, ou replicação *mudaram*, você precisa do `sstableloader` em vez disso: ele fala gossip para aprender sobre o cluster e transmite as linhas de cada SSTable através do partitioner e da estratégia de replicação atuais, em vez de copiar arquivos nó por nó. `sstableloader` também é a ferramenta padrão para mover dados entre dois clusters completamente diferentes.

**Medusa**, construído pelo Spotify e pela The Last Pickle em cima de `nodetool snapshot`/`import`, envolve isso em uma ferramenta voltada para produção: backup e restauração por nó ou de cluster inteiro, restauração em um cluster *diferente* (normalmente difícil, porque nomes de cluster e nó diferem), e armazenamento em S3 ou Google Cloud Storage em vez de apenas disco local.

#### Book vs today

> **A mecânica central (SSTables com hard link, `nodetool snapshot`/`enablebackup`, schema excluído, `sstableloader` para restaurações entre topologias) permanece inalterada na documentação atual do Apache Cassandra.** O único detalhe sensível a versão que o próprio livro sinaliza já foi resolvido: `nodetool import` é a ferramenta atual para carregar SSTables em um nó em execução; `nodetool refresh` é o equivalente pré-4.0 que o livro menciona apenas para leitores em versões mais antigas.

## Trade-offs

- **Repair incremental é mais barato por execução, mas adiciona um custo de contabilidade que o repair completo não tem.** A anti-compaction separando reparado de não reparado encolhe o espaço de busca para todo repair subsequente, mas é mais uma peça móvel: rastreamento de estado de repair em metadado de SSTable, uma passagem de anti-compaction que ela mesma custa I/O, e ainda precisa de repairs completos por cima para os modos de falha que não consegue enxergar (corrupção, erro de operador). "Sempre rodar incremental" não é, pela própria admissão da documentação atual, uma estratégia completa sozinha.
- **`-pr` torna o repair de todo o cluster tratável, mas só se você de fato rodá-lo em todo nó.** Reparar apenas intervalos primários transforma uma quantidade O(RF) de trabalho redundante por varredura do anel em O(1), mas é uma propriedade tudo-ou-nada do *agendamento*, não do comando: perca a vez de um nó e aquele intervalo primário silenciosamente fica sem reparo além do `gc_grace_seconds`, sem erro algum vindo dos intervalos que foram reparados no prazo. É exatamente essa a lacuna que ferramentas como o Reaper existem para fechar.
- **Repair sequencial é mais suave com o cluster; repair paralelo é mais rápido, você não pode ter os dois.** A abordagem de snapshot-por-réplica do sequencial permite que o snitch dinâmico desvie carga de nós ocupados durante o processo; o paralelo repara toda réplica de uma vez, sem esse amortecimento. O paralelo se tornou o padrão na 2.2 precisamente porque a maioria dos operadores valoriza tempo de relógio sobre suavidade, mas um cluster já sob carga é exatamente o caso em que esse padrão pode piorar as coisas, não melhorar.
- **Substituir no lugar vence remover-e-adicionar em custo de rede, mas só porque assume que você consegue subir o substituto rapidamente.** `-Dcassandra.replace_address_first_boot` evita o "streaming excessivo" que o livro avisa que remover-e-adicionar causa, fazendo um nó herdar diretamente os intervalos do nó morto. Mas funciona mantendo o cluster com replicação efetiva reduzida durante toda a janela de bootstrap do substituto: a mesma exposição que `max_hint_window` e `gc_grace_seconds` governam para um reinício simples, só que aplicada a um nó totalmente novo em vez de um em recuperação.
- **`decommission` → `removenode` → `assassinate` é uma escala estritamente decrescente de segurança, nessa ordem por uma razão.** `decommission` retransmite tudo antes de sair: nenhum repair necessário depois. `removenode` reconstrói a mesma garantia do lado dos sobreviventes quando o nó não consegue cooperar. `assassinate` pula a retransmissão completamente e explicitamente deixa o cluster precisando de um repair: existe só porque às vezes o próprio `removenode` fica travado, e recorrer a ele primeiro (em vez de por último) troca uma transição limpa por uma dívida de consistência de dados que agora você deve a si mesmo.
- **Snapshots são quase de graça para tirar e nada triviais para de fato possuir.** O truque do hard link torna `nodetool snapshot` rápido e inicialmente barato em disco, mas essa economia é temporária e fácil de esquecer: snapshots acumulam espaço de disco retido conforme a compaction avança (cada hard link mantém viva uma SSTable de outra forma obsoleta), e copiá-los para fora do nó, mais limpá-los depois, fica inteiramente a cargo do operador ou de uma ferramenta de terceiros como o Medusa. "Nós tiramos snapshots" não é a mesma afirmação que "temos backups que verificamos que conseguimos restaurar a partir de um cluster diferente."
- **Excluir o schema dos snapshots mantém o mecanismo de backup simples, ao custo de um passo de restauração que todo mundo esquece até ele morder.** Como snapshots são hard links puros de SSTable, eles são agnósticos de topologia e schema por construção, o que também é exatamente por que não te protegem de um schema perdido. Qualquer runbook de restauração real precisa tratar "recriar as definições de keyspace e tabela" como seu próprio artefato rastreado, não uma suposição.

## Documentation Links

- [Jeff Carpenter and Eben Hewitt, "Cassandra: The Definitive Guide", Revised 3rd Edition (O'Reilly, 2022), Chapter 12, "Maintenance" (Repair through Backup and Recovery)](https://www.oreilly.com/library/view/cassandra-the-definitive/9781492097143/) - doc
- [Apache Cassandra Documentation, Repair](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/repair.html) - doc
- [Apache Cassandra Documentation, Adding, Replacing, Moving and Removing Nodes](https://cassandra.apache.org/doc/latest/cassandra/operating/topo_changes.html) - doc
- [Apache Cassandra Documentation, Backups](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/backups.html) - doc
- [Apache Cassandra Documentation, Bulk Loading (sstableloader)](https://cassandra.apache.org/doc/latest/cassandra/managing/tools/sstable/sstableloader.html) - doc
- [Apache Cassandra Documentation, cassandra.yaml Configuration Reference (max_hint_window, gc_grace_seconds, auto_snapshot, incremental_backups)](https://cassandra.apache.org/doc/latest/cassandra/managing/configuration/cass_yaml_file.html) - doc
- [CASSANDRA-10302, Track repair state for more reliable repair](https://issues.apache.org/jira/browse/CASSANDRA-10302) - doc
- [TLP / Cassandra Reaper](http://cassandra-reaper.io/) - doc
