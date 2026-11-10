---
title: "Mitigando a sobrecarga de recursos de aplicações com cancelamento direcionado de tarefas"
summary: O Atropos trata a sobrecarga causada por contenção em recursos internos, como locks, buffer pools e filas, como um problema de achar o culpado, rastreando o que cada tarefa cancelável segura, estimando qual delas liberaria mais capacidade contendida e cancelando-a pelo gancho de cancelamento da própria aplicação em vez de descartar as vítimas.
researchArea: Sistemas distribuídos
keywords: controle de sobrecarga, cancelamento de tarefas, contenção de recursos, latência de cauda, slo, isolamento de desempenho
version: 1.0
updatedAt: 2026-11-07
---

## Visão geral

Servidores rodam perto do pico de throughput, então uma alta breve de demanda pode causar muitas violações de objetivos de nível de serviço (SLO). Além do clássico receive livelock, a sobrecarga pode vir de contenção em recursos no nível da aplicação, como locks de tabela ou o buffer pool de um banco de dados. Uma requisição pode segurar um recurso desses por muito tempo e bloquear todas as que precisam dele, e o estrago depende de como ela interage com as outras. Os autores contrastam um update de uma linha que trava uma tabela por cerca de 2 ms com uma escrita agrupada longa que pode segurar locks em várias tabelas por centenas de segundos, de modo que uma escrita longa pode prejudicar mais do que centenas de requisições curtas juntas.

Este artigo do SOSP 2025 (Seul), da Boston University, da Johns Hopkins University, da University of Michigan, da UCLA e da University of Washington, argumenta que as duas famílias usuais de defesa não cobrem esse caso. O controle de admissão olha para sinais globais, como o atraso de fila, e descarta requisições que são vítimas, muitas vezes antes de serem atendidas. O isolamento de desempenho dá cotas de recursos às requisições: partições estáticas não se adaptam a cargas variáveis, e mesmo as dinâmicas, como o pBox, não conseguem remover uma requisição que já segura o recurso contendido. O Atropos é a alternativa deles: deixar as requisições rodarem, observar o que consomem e cancelar o culpado.

Seis termos sustentam o artigo. Uma **tarefa cancelável** é uma unidade de trabalho que pode ser cancelada, como uma requisição, todas as requisições de uma conexão de usuário ou um job em segundo plano. Um **recurso da aplicação** é um recurso lógico definido pela própria aplicação (um lock, uma fila, um pool de memória) e não pelo SO. O **nível de contenção** mede o quanto um recurso está disputado, e o **ganho de recurso** estima quanto dele seria liberado se uma dada tarefa fosse cancelada. Um **culpado** é uma tarefa que monopoliza um recurso, e uma **vítima** é uma tarefa bloqueada por ele.

Vale conhecer antes: SLOs e latência de cauda, como funcionam o load shedding e o controle de admissão, e os recursos de cancelamento que as linguagens já oferecem (contexts do Go, interrupção de threads em Java). A biblioteca tem [Metastable Failures in Distributed Systems](/papers/metastable-failures-in-distributed-systems), que este artigo não cita. Sua lista de respostas à sobrecarga inclui load shedding e circuit breakers, a família que o Atropos diz atingir as requisições erradas. O modo de falha é outro, porém: uma falha metaestável sobrevive ao seu gatilho, enquanto aqui a causa é uma requisição que ainda está rodando.

## Contribuição

- **Cancelar o culpado, não a vítima.** Os autores dizem que o Breakwater limita a carga pelo atraso de fila sem saber qual recurso está contendido, e que o Protego descarta requisições cujas esperas por lock se aproximam de uma violação de SLO, que são vítimas da contenção. O pBox realoca recursos, mas não derruba uma requisição em execução. O Atropos não faz controle de admissão por conta própria e age sobre requisições que já estão executando.
- **Cancelamento seguro por reaproveitamento.** Matar uma tarefa às cegas poderia deixar o estado inconsistente, por exemplo um backup que cobre só algumas tabelas. Os autores estudaram 151 aplicações populares de código aberto e viram que 115 (76%) implementam cancelamento de tarefas, e 109 delas (95%) expõem uma função iniciadora. O Atropos registra essa função com `setCancelAction` (o `sql_kill` do MySQL no exemplo) e deixa a aplicação decidir como parar com segurança. Existe um recurso de reserva no nível da biblioteca, como `pthread_cancel`, mas ele vem desligado por padrão.
- **Uma API de integração pequena.** `createCancel` e `freeCancel` marcam o escopo de uma tarefa, e os desenvolvedores escolhem a granularidade. Três chamadas, `getResource`, `freeResource` e `slowByResource`, informam a aquisição, a liberação e a espera por um recurso do tipo LOCK, MEMORY ou QUEUE. Os timestamps são amostrados em intervalos fixos e passam à precisão por evento quando uma possível sobrecarga é detectada.
- **Detecção e métricas.** Seguindo o método do Breakwater, suspeita-se de sobrecarga de recurso quando a latência passa do SLO com o throughput estável, e então o estimador verifica se algum recurso específico é o gargalo. Se não for, é uma sobrecarga comum, deixada a outros mecanismos. A contenção é a taxa de evicção para memória, o tempo de espera sobre o tempo de uso para locks e o tempo de espera sobre o tempo de execução para filas, depois normalizada como a fração do tempo de execução perdida. O ganho de recurso é o uso futuro da tarefa: seu uso atual escalado pelo trabalho restante sobre o trabalho concluído, com o progresso vindo do modelo GetNext (linhas processadas sobre linhas esperadas). Por exemplo, uma escrita que segura um lock de tabela há 1 segundo e está 40% concluída tem ganho de 1,5 segundo.
- **Política multiobjetivo.** O Atropos mantém as tarefas não dominadas por nenhuma outra em todos os recursos e escolhe a de maior soma de ganhos ponderada pelo nível de contenção. Com contenção de 0,6 para memória e 0,4 para um lock, uma tarefa que ganha 3 e 1 pontua 2,2 e vence uma que ganha 2 e 2, que pontua 2,0. Só entram na conta as tarefas registradas como canceláveis.
- **Justiça e tamanho.** Uma tarefa é cancelada no máximo uma vez, reexecutada depois que os recursos ficam disponíveis e então marcada como não cancelável. Uma requisição cancelada que estoura o SLO enquanto espera é descartada, e as tarefas em segundo plano têm um tempo máximo de espera. A implementação tem 4.002 linhas de C/C++ (uma biblioteca), 3.534 de Java (uma classe `CancellableTask`) e 2.106 de Go (dentro do runtime do Go).

## Metodologia

Os autores integraram o Atropos a seis aplicações: MySQL, PostgreSQL, Apache, Elasticsearch, Solr e etcd. As linhas acrescentadas foram 74, 59, 30, 65, 47 e 22, e o MySQL tem cerca de 20 recursos da aplicação. Eles relatam que achar os recursos levou bem mais tempo do que editar o código: cerca de sete dias para um estudante de pós-graduação no MySQL, dois dias cada no Apache e no etcd e de quatro a cinco dias cada nos demais, ajudados por uma heurística sobre variáveis globais e pela análise estática dos seus usos.

O benchmark são 16 casos reais de sobrecarga, reunidos de bug trackers, fóruns e posts de blog e mantidos quando os passos de reprodução eram claros: oito sobre recursos de sincronização, três sobre thread pools, três sobre memória e dois sobre recursos de sistema (CPU e I/O). Ferramentas de benchmark padrão (Sysbench, ApacheBench, Rally, Solrbench, etcdbench) foram modificadas para emitir as sequências de requisições que disparam os problemas. As execuções usaram VMs da Azure com 16 vCPUs, 64 GB de memória e Ubuntu 20.04. As bases de comparação são Protego, pBox, DARC e PARTIES, que os próprios autores integraram às aplicações. Dois experimentos com o MySQL motivam o trabalho: um buffer pool de 512 MB sobre 2 GB de dados com raras consultas de dump de 2 GB, e varreduras mais uma consulta de backup que esticam os locks de tabela.

## Resultados

Estes são os resultados relatados pelos autores.

- **Os casos motivadores.** Consultas de dump em 0,001% da carga reduziram o throughput máximo do MySQL de cerca de 25 K QPS para cerca de 18 K, e em 0,01% para cerca de 12 K. Com consultas de varredura e uma consulta de backup, o throughput caiu para cerca de 11 K QPS, contra cerca de 25 K sem nenhuma das duas.
- **Mitigação.** Nos 16 casos o Atropos tem em média 96% do throughput de referência e um p99 normalizado de 1,16. Os outros quatro sistemas têm em média 50,7% (Protego), 53,9% (pBox), 36,3% (DARC) e 37,8% (PARTIES).
- **Onde o Protego fica devendo.** Seu p99 normalizado médio é de 1,88 nos casos de sincronização e de recursos de sistema, e ele não trata a contenção em recursos que não monitora.
- **Descartes.** O Atropos tem taxa média de descarte abaixo de 0,01%, enquanto o Protego tem cerca de 25%, porque descarta vítimas.
- **Cumprimento do SLO.** Com um SLO que tolera 20% de aumento de latência, o Atropos o cumpre em 14 casos, com aumento médio de 10,2%. Os casos 3 e 12 terminam em 23% e 26%. Os autores atribuem isso a uma pausa deliberada entre cancelamentos e às muitas tarefas ruidosas nesses casos. Com limites de 10%, 20%, 40% e 60% em seis casos, o SLO é cumprido todas as vezes, com mais cancelamentos à medida que ele aperta.
- **Ablação da política.** A política multiobjetivo vence uma heurística que mira o maior ganho no único recurso mais contendido em 8 dos 16 casos, e vence a variante que usa o uso atual em vez do futuro em 6.
- **Overhead.** Sob carga normal o throughput cai no máximo 1,95% (0,59% em média) e o p99 sobe 0,21% em média (1,55% no máximo). Sob sobrecarga, com o cancelamento desligado para isolar o custo do rastreamento, o throughput cai 7,09% em média (8,12% no máximo) e o p99 sobe 8,12% em média (16,14% no máximo).
- **Apache.** As requisições ruidosas executam scripts PHP que o mecanismo do próprio Apache não consegue parar, então os autores ativam o `pthread_cancel` e argumentam que é seguro porque os scripts rodam fora da lógica central e as escritas não persistidas são simplesmente descartadas.

## Análise crítica

O artigo é franco sobre vários limites.

- **Uma suposição forte de previsão.** O uso futuro é suposto proporcional ao trabalho restante. Os autores a chamam de forte e possivelmente imprecisa, e a defendem pela rapidez, pelo fato de requisições pesadas dominarem um recurso na maior parte da vida e pelo custo baixo de um palpite errado, já que o Atropos pode cancelar de novo.
- **A cobertura é limitada pelo registro.** Só tarefas marcadas como canceláveis entram na conta, então a melhor vítima global pode escapar. O cancelamento no nível de thread é grosseiro e possivelmente inseguro.
- **Um único nó.** O desenho mira um nó. Propagar o cancelamento a tarefas filhas e sobreviver a crashes, timeouts e partições fica como trabalho futuro.
- **Velocidade contra recuperação.** Os dois casos em que o SLO não foi cumprido mostram o custo de espaçar os cancelamentos, e achar todos os recursos continua sendo manual.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **O benchmark favorece a ideia.** Os 16 casos foram mantidos porque se reproduzem bem, e as ferramentas foram modificadas para dispará-los. A maioria é de poucas requisições pesadas entre leves, o formato a que o Atropos melhor se adequa. Os casos 3 e 12, em que várias tarefas ruidosas participam, são justamente os dois que ficam aquém.
- **Bases de comparação e dispersão.** As quatro bases foram portadas ou estendidas pelos autores (o algoritmo do Protego foi levado ao framework do Atropos para Java, o DARC aprendeu os tipos de requisição, o PARTIES foi alterado para funcionar por cliente). Não aparecem no texto contagens de repetição nem barras de erro, e a introdução cita três bases enquanto a avaliação usa quatro.
- **Figuras e texto não batem.** O texto tira médias sobre 16 casos, mas a Figura 9 e o painel de latência da Figura 10 rotulam só de c1 a c15, e a Figura 11 mostra dez casos. O artigo não diz quais casos entram em cada média. A configuração cita VMs da Azure, enquanto os agradecimentos citam o CloudLab como plataforma de experimentos.
- **O preço de cancelar não é detalhado.** O texto não informa quantas tarefas canceladas foram reexecutadas, quanto esperaram nem quanto trabalho foi desperdiçado. A afirmação de que a reexecução é correta depende de a lógica de cancelamento da aplicação desfazer tudo limpamente e de as requisições poderem ser rodadas de novo, o que é argumentado, não testado com requisições não idempotentes.
- **A estimativa é pouco testada.** O progresso exige um sinal como as linhas examinadas, e aplicações sem ele precisam de código do desenvolvedor. A política é comparada com apenas duas variantes, e nada investiga como estimativas de progresso erradas mudam as decisões.
- **Culpados que voltam são tolerados.** Uma tarefa reexecutada é não cancelável, então um culpado que retorna precisa ser suportado. Muitas requisições pesadas distintas, cada uma cancelada uma vez e depois deixada em paz, é um caso que o artigo não discute.

## Pesquisas futuras

- Cancelamento distribuído, como os autores o descrevem: associar tarefas filhas a uma requisição raiz, propagar o cancelamento e tratar crashes, timeouts e partições.
- Estimativas de uso futuro melhores que o modelo proporcional, com um estudo de sensibilidade de como sinais de progresso ruins afetam qual tarefa é cancelada.
- Automatizar a descoberta dos recursos da aplicação, que levou dias por sistema, por exemplo estendendo a heurística de variáveis globais e análise estática.
- Testar se o cancelamento direcionado também ajuda quando um laço de realimentação como as retentativas sustenta a sobrecarga, o cenário de [Metastable Failures in Distributed Systems](/papers/metastable-failures-in-distributed-systems), que este artigo não estuda.
