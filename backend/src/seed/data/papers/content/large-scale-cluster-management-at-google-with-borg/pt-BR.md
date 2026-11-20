---
title: "Gerenciamento de clusters em larga escala no Google com o Borg"
summary: Verma e colegas descrevem o Borg, o gerenciador de clusters do Google que roda serviços de produção e jobs em lote juntos em células de até dezenas de milhares de máquinas, e mostram que compartilhar máquinas, pedidos de recursos de granularidade fina, células grandes e recuperação de recursos ociosos economizam máquinas, com a ressalva de que todos os dados são do próprio Google.
researchArea: Sistemas distribuídos
keywords: borg, gerenciamento de clusters, escalonamento, compactação de células, recuperação de recursos, preempção, quota, isolamento de desempenho, lições aprendidas
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

O Borg, do Google, é um gerenciador de clusters que executa centenas de milhares de jobs, de muitos milhares de aplicações diferentes, em vários clusters com até dezenas de milhares de máquinas cada. Ele alcança alta utilização combinando controle de admissão, empacotamento eficiente de tarefas, sobrecomprometimento de recursos e compartilhamento de máquinas com isolamento de desempenho por processo. Dá suporte a aplicações de alta disponibilidade com recursos de execução que minimizam o tempo de recuperação de falhas e com políticas de escalonamento que reduzem a probabilidade de falhas correlacionadas. O Borg simplifica a vida dos usuários com uma linguagem declarativa de especificação de jobs, integração com serviço de nomes, monitoramento de jobs em tempo real e ferramentas para analisar e simular o comportamento do sistema. O artigo apresenta um resumo da arquitetura e dos recursos do sistema, decisões de projeto importantes, uma análise quantitativa de algumas de suas políticas e um exame qualitativo das lições de uma década de operação.

## Visão geral

O artigo (EuroSys 2015, Bordeaux, 17 páginas) descreve o sistema que admite, escalona, inicia, reinicia e monitora toda a variedade de aplicações do Google. É uma descrição feita pelos próprios engenheiros depois de mais de uma década em produção, não um protótipo de pesquisa. A carga tem duas metades: serviços de longa duração que "nunca" deveriam cair e que respondem a requisições sensíveis à latência (Gmail, Google Docs, busca na web e infraestrutura como o BigTable), e jobs em lote que duram de segundos a dias. A célula mediana tem cerca de 10 mil máquinas. O Borg é a camada sob o [GFS](/papers/google-file-system), o [BigTable](/papers/bigtable-distributed-storage-system-structured-data) e o framework [MapReduce](/papers/mapreduce-simplified-data-processing-large-clusters), que o artigo diz rodarem nele.

A coordenação se apoia em papers já presentes no catálogo: o Borgmaster guarda o estado num armazenamento baseado em Paxos (o artigo cita [The Part-Time Parliament](/papers/paxos-part-time-parliament); veja também [Paxos Made Simple](/papers/paxos-made-simple)) e usa o [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems) para publicar o endereço das tarefas e o mestre eleito. A introspecção do Borg cobre páginas de saúde, logs e métricas por tarefa; o [Dapper](/papers/dapper-large-scale-distributed-systems-tracing-infrastructure) é um sistema irmão do Google que rastreia requisições entre serviços, assunto que o artigo do Borg não discute.

Vale saber antes: o que é um contêiner e um cgroup do Linux, e a diferença entre escalonador (colocar o trabalho) e controle de admissão (decidir o que pode entrar).

## Contribuição

- **O modelo.** Uma **célula** é um conjunto de máquinas gerenciado como uma unidade dentro de um cluster. Um **job** tem uma ou mais **tarefas** que rodam o mesmo binário, cada uma um conjunto de processos Linux num contêiner (a maior parte da carga não roda em VMs). Um **alloc** é um conjunto reservado de recursos numa máquina onde tarefas de jobs diferentes dividem o lugar (por exemplo, um servidor web e seu logsaver). Os jobs são escritos em BCL, uma linguagem declarativa, e ganham nomes estáveis pelo serviço de nomes do Borg (BNS), gravado no Chubby.
- **Prioridade, preempção e quota.** As prioridades formam faixas sem sobreposição (monitoramento, produção, lote, melhor esforço); tarefas de produção não podem preemptar umas às outras, para evitar cascatas de preempção. A quota é um vetor de recursos numa prioridade por um período (tipicamente meses), verificada na admissão e não no escalonamento. A quota de produção é limitada aos recursos reais da célula; a de prioridades menores é vendida em excesso (a prioridade zero é infinita).
- **Arquitetura.** O Borgmaster é logicamente um só processo, replicado cinco vezes, com um mestre eleito (Paxos) que também é o líder Paxos e altera o estado. O Borglet de cada máquina é consultado pelo mestre a cada poucos segundos. O escalonador é um processo separado que trabalha sobre uma cópia em cache do estado.
- **Escalonamento.** Uma checagem de viabilidade (restrições e recursos disponíveis, incluindo os que estão com tarefas de menor prioridade despejáveis) seguida de pontuação.
- **Técnicas de escala.** Cache de pontuações, classes de equivalência e aleatorização relaxada.
- **Utilização e isolamento.** Recuperação de recursos ociosos, contêineres baseados em cgroups e classes de aplicação (sensíveis à latência contra lote).

## Metodologia

A seção 5 introduz a **compactação de células**: pega-se uma carga e descobre-se em quão pequena uma célula ela cabe, removendo máquinas aleatórias até não caber mais e reempacotando do zero a cada vez. Os experimentos rodaram no Fauxmaster, um simulador que contém o código completo do Borgmaster de produção com Borglets simulados, sobre checkpoints de células reais tirados na quarta-feira 2014-10-01 às 14h PDT. Os autores escolheram 15 células, excluindo as de propósito especial, as de teste e as pequenas (menos de 5000 máquinas), e amostrando o restante ao longo da faixa de tamanhos. Cada experimento rodou 11 vezes por célula com sementes diferentes, e o resultado é o valor do percentil 90. Restrições rígidas viraram flexíveis para jobs maiores que metade da célula original, e até 0,2% das tarefas podiam ficar pendentes. Não foi possível experimentar em células vivas, exceto um teste de estimação de recursos em produção, semana a semana. O estudo de CPI (ciclos por instrução) usou cerca de 12 000 tarefas prod aleatórias durante uma semana. As lições qualitativas vêm da experiência, não de medição.

## Resultados

Todos os números são dos autores, conforme o texto.

- **Escala do escalonador.** Um Borgmaster ocupado usa de 10 a 14 núcleos e até 50 GiB de RAM; várias células veem mais de 10 000 chegadas de tarefas por minuto. Uma passada online pela fila de pendentes leva menos de meio segundo. Escalonar a carga inteira de uma célula do zero levou algumas centenas de segundos, mas não terminou depois de mais de 3 dias com cache de pontuações, classes de equivalência e aleatorização relaxada desligados. O artigo não separa o ganho de cada técnica.
- **Pontuação.** A variante original do E-PVM espalha a carga ("pior encaixe"), o que fragmenta; o melhor encaixe empacota apertado mas pune erros de estimativa, e 20% das tarefas não-prod pedem menos de 0,1 núcleo. O modelo híbrido atual reduz recursos encalhados e empacota 3 a 5% melhor que o melhor encaixe. A fórmula não é dada.
- **Disponibilidade.** Eleição e failover do mestre levam tipicamente cerca de 10 s, até um minuto numa célula grande. O artigo reporta 99,99% de disponibilidade do Borgmaster e que tarefas em execução continuam rodando se o Borgmaster ou um Borglet cair.
- **Compartilhamento.** 98% das máquinas em células compartilhadas rodam tarefas prod e não-prod ao mesmo tempo (83% em todas as máquinas que o Borg gerencia). Segregar prod de não-prod exige 20 a 30% mais máquinas na célula mediana. Dar células privadas a usuários grandes (limiares de 10 TiB ou 100 TiB de memória) exige de 2 a 16 vezes mais células e 20 a 150% mais máquinas. Dividir uma célula em menores exige mais máquinas (Figura 7, apenas gráfico).
- **Interferência.** O CPI sobe 0,3% por tarefa a mais na máquina e menos de 2% a cada 10% a mais de uso de CPU da máquina, mas isso explica só 5% da variância. O CPI médio é 1,58 em células compartilhadas e 1,53 nas dedicadas (cerca de 3% pior); o próprio Borglet roda 1,19 vez mais rápido em células dedicadas. Os autores chamam os resultados de "não conclusivos" e ainda assim concluem que compartilhar compensa.
- **Pedidos de granularidade fina e recuperação.** Arredondar pedidos para potências de dois exigiria de 30 a 50% mais recursos no caso mediano. Cerca de 20% da carga roda em recursos recuperados numa célula mediana. Uma semana de configuração agressiva de recuperação aumentou levemente os eventos de falta de memória; os autores adotaram a configuração média.
- **Isolamento.** 50% das máquinas rodam 9 ou mais tarefas; o percentil 90 tem cerca de 25 tarefas e 4500 threads. A mediana de início de tarefa é cerca de 25 s, 80% disso em instalação de pacotes.
- **Lições, as ruins.** Jobs são restritivos como único agrupamento; um IP por máquina obriga a gerenciar portas; recursos para usuários avançados (cerca de 230 parâmetros do BCL) pesam para os casuais.
- **Lições, as boas.** Allocs; gerenciar clusters é mais que gerenciar tarefas (nomes, balanceamento de carga); introspecção é vital; o mestre é o kernel de um ecossistema de serviços.

## Análise crítica

O que o artigo não afirma nem mede:

- **Não é independente.** Todos os números vêm de células do próprio Google, e os autores escreveram o sistema e a avaliação. A simulação é de um instante, não um replay de uma carga ao longo do tempo, e o artigo diz acreditar que os resultados não mudariam muito, o que é uma crença, não um resultado.
- **A compactação é um substituto.** Ela mede eficiência de empacotamento, não latência ou vazão vistas pelo usuário. Os resultados são valores do percentil 90 de 11 rodadas, com restrições abrandadas e 0,2% de tarefas pendentes.
- **Evidência parcial sobre interferência.** Os autores admitem que comparar desempenho em escala de armazém é delicado; as correlações de CPI são fracas e há possível viés de seleção.
- **Sem comparação com outros gerenciadores.** Os trabalhos relacionados (Mesos, YARN, Omega, Fuxi, Apollo) são discutidos só em prosa, sem medição lado a lado. O Kubernetes aparece apenas como sistema de código aberto em desenvolvimento por muitos dos mesmos engenheiros, e a seção de lições descreve intenção de projeto, não uma avaliação dele.
- **Detalhes não especificados.** A fórmula do score híbrido não é dada, nem quantas máquinas a aleatorização relaxada examina (o "bastante" de máquinas viáveis), nem o desempenho do armazenamento Paxos.

Literatura posterior, que não li para esta entrada: o próprio artigo diz que a separação do escalonador é parecida em espírito com a concorrência otimista do Omega (Schwarzkopf et al., EuroSys 2013) e que suas lições alimentam o Kubernetes. Uma ligação posterior no catálogo: o [Dirigent](/papers/dirigent-lightweight-serverless-orchestration) cita as células do Borg como forma de dividir um plano de controle. O Borg limita a taxa de reescalonamento de tarefas de máquinas inalcançáveis e consulta os Borglets para evitar tempestades de recuperação; isso se relaciona aos padrões de falha movidos a retentativas em [Metastable Failures in the Wild](/papers/metastable-failures-in-the-wild), uma conexão que eu faço, não que o artigo do Borg faz.

## Pesquisas futuras

- Interferência em escalas de tempo mais finas que o ajuste de cgroups e do CFS deixa em aberto, como largura de banda de memória e poluição do cache L3, que o artigo diz ainda ocorrerem ([Caladan](/papers/caladan-mitigating-interference-at-microsecond-timescales), [Shenango](/papers/shenango-achieving-high-cpu-efficiency-for-latency-sensitive-datacenter-workloads)).
- Efeitos de latência de cauda do compartilhamento de máquinas ([The Tail at Scale](/papers/the-tail-at-scale)).
- Comparar o escalonador centralizado do Borg com escalonadores de estado compartilhado ao estilo Omega e com o Kubernetes sob a mesma carga, o que o artigo não faz.
- Métricas de empacotamento que considerem carga variável no tempo, além da compactação de células num único instante.
