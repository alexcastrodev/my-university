---
title: "Dirigent: orquestração serverless leve"
summary: O Dirigent é um gerenciador de cluster feito do zero para plataformas de function as a service, que troca a orquestração no estilo Kubernetes por poucas abstrações pequenas, nenhuma escrita persistente no caminho do cold start e planos de controle e de dados monolíticos, o que, segundo os autores, permite criar sandboxes ordens de magnitude mais rápido que o Knative.
researchArea: Sistemas distribuídos
keywords: serverless, function as a service, gerenciador de cluster, cold start, escalonamento de sandboxes, kubernetes, plano de controle
version: 1.0
updatedAt: 2026-11-07
---

## Visão geral

Os workers de function as a service (FaaS) conseguem iniciar um sandbox em dezenas a centenas de milissegundos, mas em clusters reais a latência ponta a ponta para colocar uma função em execução costuma ser uma ou mais ordens de magnitude maior. Os autores localizam a diferença no gerenciador de cluster, que precisa escolher um worker para cada novo sandbox e depois encaixá-lo no cluster para que ele receba tráfego. Esse trabalho escala mal quando muitos sandboxes são criados ao mesmo tempo, algo rotineiro em FaaS: no trace do Azure Functions que os autores simulam, o gerenciador cria cerca de 300 sandboxes por segundo em média, com rajadas de milhares.

Este artigo do SOSP 2024 (Austin), de Lazar Cvetković, François Costa, Mihajlo Djokic, Michal Friedman e Ana Klimovic, da ETH Zurich (um dos autores também na IBM Research Europe), culpa o hábito de construir gerenciadores de FaaS sobre o Kubernetes (K8s), que foi projetado para aplicações de longa duração e com estado. A resposta é o Dirigent, um gerenciador de cluster novo que mantém a API de usuário do Lambda ou do Knative (registrar uma função, invocá-la) e reconstrói tudo o que fica por baixo.

Termos-chave: um **sandbox** é o ambiente isolado que executa uma instância de função, um **cold start** é uma invocação que precisa esperar por um novo sandbox, e um **warm start** reaproveita um sandbox existente. O **plano de controle** cria, posiciona e destrói sandboxes, e o **plano de dados** roteia, enfileira e limita as invocações. **Churn** é a taxa em que sandboxes são criados e removidos.

Vale conhecer antes: controllers e loops de reconciliação do K8s, o Knative como camada de autoscaling sobre o K8s, microVMs Firecracker, o [Raft](/papers/raft-understandable-consensus-algorithm), que o artigo cita para a eleição de líder do plano de controle, e o [Boki](/papers/boki-stateful-serverless-computing-with-shared-logs), um dos trabalhos que o artigo cita sobre garantias mais fortes no nível da requisição.

## Contribuição

- **Uma análise de causa raiz.** Com o Knative como caso representativo, os autores mostram que criar um sandbox exige dezenas de RPCs e atualizações sequenciais no banco, porque os controllers do K8s só trocam estado por operações de leitura, modificação e escrita no etcd, atrás do API server. Os objetos são grandes (pares chave-valor de 17 kB em média nos experimentos), então o API server gasta CPU em serialização, e toda atualização é persistida com consistência forte. O OpenWhisk, os Pods diretos e o K3s mostram problemas parecidos.
- **Abstrações simples.** Quatro objetos substituem Deployments, ReplicaSets e Endpoints: Function, Sandbox, DataPlane e WorkerNode. O estado de um sandbox ocupa 16 bytes, enquanto os autores constatam que a definição de um Pod do K8s pode chegar a 17 KB, e ele é guardado em formato binário compacto.
- **Nenhuma escrita persistente no caminho do cold start.** O plano de controle persiste só o que precisa para reiniciar: funções (com sua configuração de escalonamento), planos de dados e worker nodes, em um banco replicado. O estado dos sandboxes é reconstruído a partir dos workers, e as métricas de escalonamento a partir do tráfego dos planos de dados. O preço é deliberado: depois de uma falha, o Dirigent não precisa restaurar o mesmo número de sandboxes, os mesmos endereços IP nem o mesmo posicionamento, já que o FaaS esconde os três dos usuários.
- **Planos monolíticos.** Os módulos do plano de controle (gerenciador de estado, monitor de saúde, autoscaler, placer) conversam por canais em memória e primitivas atômicas, com uma réplica ativa e as demais em standby. As réplicas do plano de dados ficam todas ativas, enfileiram os cold starts em filas por função e limitam a concorrência, o que elimina o sidecar queue-proxy por sandbox do Knative. Um load balancer de entrada aplica hash ao ID da função para que um único plano de dados acompanhe as requisições em andamento de cada função. Os dois planos continuam separados para que a carga de warm starts escale por conta própria.
- **Regras de recuperação.** Um novo líder do plano de controle, eleito com o Raft, recarrega planos de dados, worker nodes e funções do banco e depois mescla as listas de sandboxes que os workers informam. Os sandboxes recuperados não sofrem downscale durante uma janela de autoscaling (60 s por padrão). Um plano de dados reiniciado busca as listas de funções e de sandboxes, e os workers são avaliados por heartbeats. Os planos de dados podem rotear para um sandbox que não existe mais, porque o Dirigent prefere disponibilidade a consistência.
- **Garantias limitadas no nível da requisição.** As invocações síncronas não têm nenhuma, como no Lambda ou no Knative, e as assíncronas recebem at-least-once por persistência das requisições e retentativas.

## Metodologia

O Dirigent tem cerca de 11,3 mil linhas de Go. Os componentes conversam por gRPC, o Raft elege o líder do plano de controle, o systemd reinicia processos que falham e o Redis (modo append-only, fsync a cada consulta, uma réplica ao lado de cada réplica do plano de controle) guarda o estado persistido. Os workers rodam containerd ou Firecracker, com ou sem snapshots de microVM, e mantêm um pool de configurações de rede pré-criadas para evitar contenção no kernel. O escalonamento reutiliza as políticas padrão do Knative de autoscaling, posicionamento e balanceamento de carga, para manter a comparação justa.

Os experimentos rodam em um cluster CloudLab xl170 de 100 nós (Xeons de 10 cores, 64 GB de DRAM), com 3 réplicas do plano de controle e 3 do plano de dados e imagens e snapshots pré-carregados. As bases de comparação são o Knative v1.13.1 e o OpenWhisk v1.0.1 sobre o K8s v1.29.1, além do AWS Lambda em us-east-1, invocado a partir do EC2. Os autores descartaram o OpenFaaS porque sua versão da comunidade suporta no máximo 15 funções. Os microbenchmarks usam funções hello-world em 93 workers. O macrobenchmark reproduz uma janela de 30 minutos do trace do Azure (500 funções, 168 mil invocações, com os primeiros 10 minutos descartados) com o gerador de carga InVitro, além de uma amostra maior de 4000 funções e 3,33 milhões de invocações. Componentes também são derrubados de propósito. O código é aberto, e os autores agradecem aos avaliadores de artefato por verificarem os resultados.

## Resultados

Estes são os resultados relatados pelos autores.

- **Throughput de cold starts.** O Dirigent chega ao pico de 1750 cold starts por segundo com containerd, limitado pela contenção de locks do kernel na criação de sandboxes, na configuração de rede e nas atualizações do iptables. Com snapshots do Firecracker chega a 2500, com a CPU do plano de controle em 55% e a contenção de locks nas estruturas de autoscaling como gargalo. O Knative e o OpenWhisk saturam abaixo de 2 por segundo, o que dá o 1250× de destaque do artigo.
- **Cold start sem carga.** O Dirigent é mais rápido mesmo com 1 cold start por segundo. O Knative leva cerca de 400 ms para subir o container do usuário e seu sidecar, criados um depois do outro, e depois cerca de 500 ms de readiness probes.
- **Warm starts.** O Dirigent sustenta 4000 invocações warm por segundo com p50 de 1,4 ms e p99 de 2,5 ms, até a máquina ficar sem portas. O Knative atinge o pico de 1200 por segundo com p50 de 7 ms.
- **Registro e escala.** Registrar uma função leva em média 2 ms no Dirigent contra cerca de 770 ms no Knative em um cluster vazio, e os autores relatam cerca de 18 minutos contra 1 segundo no experimento de registro (o trecho não informa o número de funções). Com workers emulados, o throughput acompanha as execuções reais até 2500 workers e chega a 2000 cold starts por segundo com 5000.
- **Ablação.** Persistir também o estado dos sandboxes reduz o pico para 1000 cold starts por segundo, e o p99 dispara aos 500. O Knative sobre o K3s, um K8s de processo único, ganha apenas marginalmente, então os autores concluem que o gerenciamento de estado importa mais que um plano de controle monolítico.
- **Trace do Azure, 500 funções.** O slowdown mediano por função é 1,38 no Dirigent, 1,87 no Lambda e 13,2 no Knative. A latência de escalonamento por função é 3,07× menor na mediana e 2,79× menor no p99 que a do Lambda, e 403× menor no p99 que a do Knative. O slowdown no p99 é 6,89× menor que o do Lambda. A latência de escalonamento por invocação é de 1,74 ms na mediana e 1,13 s no p99 no Dirigent, contra 4,67 ms e 59,59 s no Knative.
- **Recursos.** O Knative criou 2930 sandboxes para essa carga e o Dirigent 713, com o mesmo algoritmo de autoscaling, o que os autores atribuem ao scale-up lento do Knative, que deixa as filas continuarem crescendo. O nó do plano de controle do Dirigent usa 3% de CPU em média, contra mais de 75% no Knative.
- **Trace maior.** O Dirigent atinge slowdowns p50 e p99 de 2,14 e 15,4 com 70% da CPU dos workers, enquanto o Lambda chega a 70 e 11631 e 33% de suas invocações sofrem timeout.
- **Falhas.** O failover do plano de controle leva 10 ms para detectar, eleger, recarregar e ressincronizar, contra vários segundos no Knative. Depois de uma falha de plano de dados, as falhas de invocação cessam em até 2 s, contra 15 s no Knative. Com 47 de 93 daemons de worker derrubados, o slowdown máximo é 2,7, 10× menor que o do Knative.

## Análise crítica

O diagnóstico é convincente, e as ablações são diretas sobre quais escolhas sustentam o ganho. O artigo admite vários limites.

- **Não é um gerenciador de uso geral.** Ainda não há versionamento de funções com direcionamento de tráfego, nem suporte a QoS ou busca remota de logs, nem nomes e descoberta entre sandboxes, nem reconstrução estrita de estado. Os autores chamam o Dirigent de alternativa para FaaS, não de substituto do K8s.
- **Garantias fracas no nível da requisição.** As invocações síncronas em andamento quando um worker ou um plano de dados cai são perdidas, e a avaliação cobre apenas chamadas síncronas.
- **Tetos de escala.** Só uma réplica do plano de controle fica ativa, e os autores observam contenção de locks com 2500 cold starts por segundo e contenção de heartbeats com 5000 workers. Eles propõem sub-clusters, como as células do Borg, mas não os avaliam.
- **Caches desatualizados.** Se o plano de controle ficar fora do ar por muito tempo, os planos de dados podem enviar requisições a sandboxes que não existem mais.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **O número de destaque compara runtimes diferentes.** O 1250× compara o Dirigent sobre snapshots do Firecracker com o Knative sobre containerd. Com containerd, o Dirigent chega ao pico de 1750, o que pela minha conta dá cerca de 875× contra 2 por segundo, ainda grande, mas um número diferente. O lado do Knative também é um ponto de saturação ("abaixo de 2"), não um pico medido.
- **A conclusão contradiz o corpo do texto.** Ela atribui um slowdown no p99 6,89× menor à comparação com o Knative, enquanto o corpo dá 6,89× contra o Lambda e mais de três ordens de magnitude contra o Knative. Esta nota usa o corpo.
- **O Lambda é uma caixa-preta.** Os autores não enxergam seu gerenciador de cluster, hardware nem outros inquilinos, enquanto o Dirigent roda em um cluster dedicado de 100 nós com imagens pré-carregadas. O texto não diz se as latências do Lambda incluem tempo de front-end e de rede que as execuções do Dirigent, dentro do cluster, evitam, e o trace maior é comparado apenas com o Lambda. Os números mostram que o Dirigent pode superar um serviço de produção nesse cenário, não por que o Lambda é mais lento.
- **A ablação é parcial.** A persistência e o plano de controle monolítico são testados por experimento. O volume de estado e a remoção do sidecar são argumentados a partir da análise do K8s e dos resultados de warm start, mas não isolados, e o ganho do K3s é apenas chamado de marginal.
- **O teste de falhas é raso.** O texto descreve uma falha injetada por classe de componente, com uma única figura de failover do plano de controle e sem discussão de partições de rede nem de líder deposto. O estado persistido fica no Redis, descrito como replicado com consistência forte, mas o artigo não explica como essa garantia é obtida, por exemplo se as escritas esperam pelas réplicas.
- **As cargas são sintéticas.** As funções são hello-world ou um loop de instruções SQRTSD dimensionado pelos tempos de execução do trace, e imagens e snapshots são pré-carregados em todos os workers, então baixar imagens e restaurar snapshots do disco em escala, que o artigo lista como trabalho futuro, fica fora das medições. A amostra de 500 funções também é a maior que o Knative aguentou sem muitos timeouts.

## Pesquisas futuras

- Workflows: estender os componentes do plano de dados para que atuem como orquestradores de workflow, o que os autores estão explorando.
- O custo de garantias mais fortes no nível da requisição (at-least-once, exactly-once) em escala, possivelmente sobre um runtime de log compartilhado como o [Boki](/papers/boki-stateful-serverless-computing-with-shared-logs), que o artigo cita. O [FlexLog](/papers/flexlog-shared-log-for-stateful-serverless-computing) é um pareamento meu, não um trabalho que o artigo cite.
- Cache de imagens e snapshots em escala, mais runtimes de sandbox e as políticas Hermod e CH-RLU, que o Dirigent suporta mas deixa fora da avaliação.
- Lacunas que o artigo deixa em aberto: testes de partição e de líder deposto no plano de controle apoiado em Redis, e uma implantação medida com sub-clusters, além de um único plano de controle.
