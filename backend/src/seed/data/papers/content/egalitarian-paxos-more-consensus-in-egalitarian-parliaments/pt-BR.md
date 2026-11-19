---
title: "Há mais consenso em parlamentos igualitários"
summary: O EPaxos é uma variante do Paxos sem líder em que qualquer réplica pode ordenar comandos, confirmando em uma única ida e volta os que não interferem entre si e registrando dependências para que todas as réplicas executem os comandos interferentes na mesma ordem.
researchArea: Sistemas distribuídos
keywords: epaxos, consenso sem líder, replicação de máquina de estados, interferência entre comandos, grafo de dependências, caminho rápido, replicação em área ampla
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Este artigo descreve o projeto e a implementação do Egalitarian Paxos (EPaxos), um novo algoritmo de consenso distribuído baseado no Paxos. O EPaxos atinge três objetivos: (1) latência de confirmação ótima em área ampla ao tolerar uma e duas falhas, em condições realistas; (2) balanceamento uniforme de carga entre todas as réplicas (e, portanto, alta vazão); e (3) degradação suave de desempenho quando réplicas ficam lentas ou falham. Até onde os autores sabem, o Egalitarian Paxos é o primeiro protocolo a atingir esses objetivos de forma eficiente, ou seja, exigindo apenas uma maioria simples de réplicas sem falha, usando um número de mensagens linear no número de réplicas para escolher um comando, e confirmando comandos após apenas uma rodada de comunicação (uma ida e volta) no caso comum ou após no máximo duas rodadas em qualquer caso. As propriedades são provadas teoricamente e as vantagens são demonstradas empiricamente por uma implementação executada na Amazon EC2.

## Visão geral

A maioria das máquinas de estados replicadas construídas sobre o Paxos ([Paxos Made Simple](/papers/paxos-made-simple), [The Part-Time Parliament](/papers/paxos-part-time-parliament)) depende de um líder estável, a otimização chamada "Multi-Paxos" usada em sistemas como o [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems) e, de forma parecida, no [ZooKeeper](/papers/zookeeper-wait-free-coordination-internet-scale-systems). O [Raft](/papers/raft-understandable-consensus-algorithm), que surgiu pouco depois deste artigo, também gira em torno de um líder. O artigo (SOSP 2013) argumenta que isso tem custos: o líder trata mais mensagens que as outras réplicas, clientes de outras regiões pagam o trajeto até um mestre distante, picos de carga no líder aumentam a latência e a falha do líder interrompe o serviço até que outro seja eleito. O Mencius reveza a liderança em rodízio, mas então cada réplica precisa ouvir todas as outras, e o sistema roda na velocidade da mais lenta.

O EPaxos não tem líder designado. O cliente envia o comando a qualquer réplica, que passa a ser o líder daquele comando. Em vez de fixar a ordem em um log pré-atribuído, cada comando é confirmado junto com atributos de ordenação (os comandos dos quais depende e um número de sequência), e as réplicas derivam a ordem de execução a partir deles. Isso se apoia na [replicação de máquina de estados](/papers/state-machine-approach-fault-tolerant-services-tutorial) e mira um comportamento [linearizável](/papers/linearizability-correctness-condition-concurrent-objects). A garantia de progresso é limitada pelo [resultado FLP](/papers/flp-impossibility-of-distributed-consensus). Trabalhos posteriores do catálogo que também atacam o custo do líder incluem o [NOPaxos](/papers/nopaxos-replacing-consensus-with-network-ordering) e o [QuePaxa](/papers/quepaxa-escaping-the-tyranny-of-timeouts-in-consensus).

Vale saber antes: quóruns do Paxos, a diferença entre confirmar (commit) e executar um comando, e o modelo de falhas não bizantino (réplicas podem parar, mas não mentem).

## Contribuição

- **Ordenação sem líder.** Cada réplica é dona da sua própria linha de instâncias (R.1, R.2, ...), e a ordem global é decidida dinamicamente por atributos anexados a cada comando, não por uma sequência fixa de posições nem por um líder.
- **Interferência entre comandos.** Dois comandos interferem se alguma sequência de comandos produz estados ou resultados de leitura diferentes quando eles são aplicados nas duas ordens. Só os comandos interferentes precisam de ordem consistente.
- **Caminho rápido de uma ida e volta.** O líder do comando envia PreAccept a um quórum de caminho rápido; se todas as respostas trazem os mesmos atributos, ele confirma. O protocolo básico precisa de 2F de N = 2F + 1 réplicas, e o otimizado apenas F + floor((F+1)/2), contando o líder.
- **Caminho lento de duas idas e voltas.** Se as respostas divergem, o líder une as dependências, toma o maior número de sequência e roda uma rodada de Paxos-Accept com F + 1 réplicas.
- **Algoritmo de execução.** Os comandos confirmados formam um grafo de dependências; os componentes fortemente conexos são executados em ordem topológica inversa, ordenados por número de sequência dentro de cada componente.
- **Recuperação, reconfiguração e argumentos de segurança.** Explicit Prepare para líderes que falharam, um protocolo de entrada com épocas, provas informais no artigo e formais, com uma especificação em TLA+, em um relatório técnico.

## Metodologia

O projeto é apresentado como um protocolo básico (Figura 2, com recuperação simplificada na Figura 3) seguido de otimizações, com esboços de prova informais para as garantias da Seção 4.2: não trivialidade, estabilidade, consistência, consistência de execução, linearizabilidade de execução e progresso com alta probabilidade.

A avaliação compara o EPaxos com Multi-Paxos, Mencius e Generalized Paxos, todos implementados pelos autores em Go 1.0.2 em um mesmo arcabouço para compartilhar código, na Amazon EC2 (instâncias grandes com dois núcleos virtuais e 7,5 GB, Ubuntu 11.10). A carga é um armazenamento chave-valor replicado com requisições de atualização. A interferência entre comandos varia (0%, 2%, 25% e 100%), e o artigo defende que 0% e 2% são as taxas mais realistas, citando o Chubby (renovações de lease são mais de 90% das requisições e não geram conflitos) e o F1 sobre o Spanner (menos de 0,3% das operações podem gerar conflito). Os testes em área ampla usam três réplicas (CA, VA, EU) e cinco (somando OR e JP), com dez clientes por réplica no mesmo local. Os testes em cluster cobrem vazão, log persistente em SSD, latência de execução, agrupamento em lotes e a falha de uma réplica.

## Resultados

- **Latência em área ampla.** Com três réplicas, uma réplica EPaxos confirma após uma ida e volta ao par mais próximo, mesmo quando os comandos interferem. O Generalized Paxos tem quórum rápido de três para N = 3 e mostrou mediana de 341 ms com 100% de interferência. Com cinco réplicas, o EPaxos evita as duas réplicas mais distantes para comandos sem interferência.
- **A execução pode ficar atrás da confirmação.** Com 100% de interferência, a latência mediana de execução foi de 125 ms a 139 ms com três réplicas e de 304 ms a 319 ms com cinco (274 ms a 296 ms no Mencius). O artigo observa que, para escritas, o que importa é a latência de confirmação.
- **Vazão.** O EPaxos supera o Multi-Paxos, cujo líder fica limitado pela CPU, e em geral o Mencius, por causa da otimização thrifty (enviar PreAccept e Accept apenas a um quórum). O Generalized Paxos rodou a menos de 1/4 da velocidade do EPaxos e foi retirado desses testes. O EPaxos executa uma rodada extra por comando com muitos conflitos e mais de três réplicas.
- **Réplica lenta e falhas.** O EPaxos lida melhor com um nó lento porque os pares monitoram a velocidade dos pings e excluem o mais lento dos quóruns; o Mencius roda na velocidade da réplica mais lenta. Em um teste de falha com três réplicas a cerca de 10.000 requisições por segundo, o Multi-Paxos para na falha do líder e o Mencius é perturbado por qualquer falha, enquanto o EPaxos continua confirmando.
- **Lotes.** O agrupamento elevou a vazão máxima em 5x no Multi-Paxos e em 9x no EPaxos, e com ele o EPaxos com 100% de interferência ficou praticamente tão rápido quanto sem interferência.
- **Log e execução.** Com log síncrono em SSD, o EPaxos superou o Mencius e o Multi-Paxos. Em um cluster de três réplicas, sua latência de execução foi menor que a dos dois, qualquer que fosse a interferência.

## Análise crítica

- **Três atrasos de mensagem, não dois.** O artigo admite que seu caminho rápido leva três atrasos de mensagem, contra dois do Fast Paxos e do Generalized Paxos, e argumenta que o primeiro atraso é desprezível em área ampla porque o cliente fica ao lado de uma réplica.
- **A interferência precisa ser conhecida.** O protocolo precisa decidir se há interferência antes de executar, de forma conservadora quando houver dúvida. Armazenamentos chave-valor tornam isso fácil; o artigo admite que transações gerais são mais difíceis e são tratadas como interferentes com tudo.
- **Garantias por objeto.** O EPaxos garante linearizabilidade por objeto. Para operações em que a interferência não é transitiva, a serializabilidade estrita exige uma variante que só notifica o cliente depois que todo o grafo de dependências foi confirmado, o que aumenta a latência do cliente sob conflito.
- **A avaliação favorece o caso comum.** A maioria dos resultados usa 0% e 2% de interferência, e o caso de 100% é descartado como improvável. A literatura posterior questiona isso (literatura posterior, não está no artigo): Tollman, Park e Ousterhout, "EPaxos Revisited" (NSDI 2021), relatam que o benchmark original não aciona todo o impacto dos conflitos e medem latência de cauda mais de 4x pior que a do Multi-Paxos, confirmando ao mesmo tempo a latência mediana de confirmação ótima.
- **Corretude da especificação (literatura posterior).** Pierre Sutra, "On the correctness of Egalitarian Paxos" (Information Processing Letters, 2020), identifica um problema tanto na especificação em TLA+ quanto na implementação, ligado a como as réplicas trocam de ballot ao calcular as dependências de um comando, o que pode quebrar a linearizabilidade. O texto de recuperação deste artigo deve ser lido junto com essa nota.
- **Go e coleta de lixo.** Os autores dizem que o EPaxos sofre mais com o GC que os demais porque suas mensagens carregam atributos, o que consideram justo para os outros protocolos.

## Pesquisas futuras

- Reduzir o custo dos conflitos, deixado como trabalho futuro pelo artigo: encaminhar PreAccepts entre membros do quórum rápido para cortar um atraso de mensagem no caminho lento, ou um modo de Multi-Paxos particionado para grupos de comandos.
- Usar relógios sincronizados para reduzir conflitos, como na reavaliação de Tollman e colegas.
- Recuperação corrigida e formalmente verificada, a partir dos achados de Sutra.
- Alternativas sem líder ou com pouco líder que usam ordenação pela rede ou aleatoriedade, como o [NOPaxos](/papers/nopaxos-replacing-consensus-with-network-ordering) e o [QuePaxa](/papers/quepaxa-escaping-the-tyranny-of-timeouts-in-consensus) do catálogo.
- Comparar o EPaxos com sistemas de produção que mantiveram um líder, como o [Spanner](/papers/spanner-globally-distributed-database), e com as lições de engenharia de [Paxos Made Live](/papers/paxos-made-live-engineering-perspective).
