---
title: "O escalonador do Linux: uma década de núcleos desperdiçados"
summary: Os autores encontraram quatro bugs no balanceador de carga do CFS do Linux que deixam núcleos ociosos por longos períodos enquanto threads esperam nas runqueues, criaram um verificador de sanidade e um visualizador de traços para pegá-los, e mediram lentidões de 13% no kernel make até 138× em um benchmark NAS com muitas barreiras.
researchArea: Sistemas operacionais
keywords: escalonador do linux, cfs, balanceamento de carga, numa, conservação de trabalho, bugs de desempenho, domínios de escalonamento
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Como parte central do gerenciamento de recursos, o escalonador de threads do SO precisa manter o seguinte invariante simples: garantir que threads prontas sejam escalonadas em núcleos disponíveis. Por mais simples que pareça, descobrimos que esse invariante é frequentemente quebrado no Linux. Núcleos podem ficar ociosos por segundos enquanto threads prontas esperam nas runqueues. Em nossos experimentos, esses bugs de desempenho causaram degradação de muitas vezes em aplicações científicas com muita sincronização, 13% de latência a mais no kernel make e uma queda de 14 a 23% no throughput do TPC-H em um banco de dados comercial amplamente usado. A principal contribuição deste trabalho é a descoberta e a análise desses bugs, junto com as correções. Técnicas convencionais de teste e ferramentas de depuração são ineficazes para confirmar ou entender esse tipo de bug, porque seus sintomas costumam ser evasivos. Para conduzir a investigação, construímos novas ferramentas que verificam a violação do invariante em tempo de execução e visualizam a atividade de escalonamento. Elas são simples, fáceis de portar entre versões do kernel e rodam com overhead desprezível. Acreditamos que incluir essas ferramentas no conjunto de instrumentos dos desenvolvedores do kernel ajuda a manter esse tipo de bug sob controle.

## Visão geral

O escalonador do Linux decide qual thread pronta cada núcleo executa. Sua política padrão, o Completely Fair Scheduler (CFS), é simples em um único núcleo: as threads ficam numa árvore rubro-negra ordenada por vruntime (tempo de execução dividido pelo peso) e a mais à esquerda roda. Em uma máquina multicore cada núcleo tem sua própria runqueue, então um balanceador de carga periódico precisa manter as filas equilibradas, e é aí que moram a complexidade e os bugs.

Este artigo do EuroSys 2016, de autores da Nice Sophia-Antipolis, EPFL, University of British Columbia, Coho Data e Grenoble INP, mostra que o Linux frequentemente viola o dever mais básico de um escalonador: nunca deixar um núcleo ocioso enquanto outro tem threads esperando. O tema conversa com outros artigos de escalonamento e de kernel desta biblioteca. O [kSTEP](/papers/kstep-deterministic-testing-of-linux-cpu-scheduler-bugs) estuda depois 232 correções de bugs do escalonador e as testa de forma determinística, o [ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling) e o [Skyloft](/papers/skyloft-general-scheduling-framework-in-user-space) tiram a política de escalonamento do kernel, e o [Analysis of Linux Scalability to Many Cores](/papers/analysis-of-linux-scalability-to-many-cores), citado aqui por bugs de escalabilidade anteriores, é um trabalho anterior sobre Linux multicore.

Vale conhecer antes: runqueue, nó NUMA, escalonador que conserva trabalho (núcleos ociosos devem pegar trabalho disponível) e cgroups, que permitem ao kernel dividir a carga de uma thread pelo tamanho do seu grupo.

## Contribuição

- **Quatro bugs de desempenho no CFS.** Group Imbalance, Scheduling Group Construction, Overload-on-Wakeup e Missing Scheduling Domains, cada um com causa raiz no código e uma correção. Nenhum derruba o sistema: eles deixam núcleos ociosos em silêncio.
- **O invariante.** "Nenhum núcleo fica ocioso enquanto outro está sobrecarregado." É a propriedade de conservar trabalho, e os autores a usam como teste para cada bug.
- **Um verificador de sanidade online.** Ao contrário de uma assertiva, ele tolera violações curtas e só sinaliza as que persistem.
- **Um visualizador do escalonador.** Registra o tamanho e a carga das runqueues e os núcleos considerados em cada decisão de balanceamento ou de despertar, e os plota ao longo do tempo.
- **Um argumento de projeto.** Otimizações para o hardware moderno transformaram uma política simples em uma complexa, e por isso os autores propõem um módulo central que mantém o invariante mais módulos de otimização que apenas dão sugestões.

## Metodologia

Os experimentos rodaram em um servidor NUMA de 64 núcleos e 8 nós, com oito CPUs Opteron 6272 a 2,1 GHz, 512 GB de DDR-3 e links HyperTransport 3.0, no qual alguns nós ficam a dois saltos de distância. Os autores primeiro notaram lentidão inexplicada ao rodar TPC-H em um banco de dados comercial muito usado (nunca nomeado) e depois usaram o visualizador em uma carga multiusuário: um make do kernel com 64 threads mais processos R lançados de ttys diferentes, benchmarks NAS e TPC-H. Cada bug foi diagnosticado por traços, corrigido no kernel e comparado antes e depois. As ferramentas foram construídas no Linux 3.17 e portadas para o 4.3.

O verificador roda a cada S = 1 s. Ao ver um núcleo ocioso e outro sobrecarregado do qual ele poderia roubar trabalho, observa migração, criação e saída de threads por M = 100 ms, e só se o estado persistir faz profiling com SystemTap por 20 ms. O visualizador exige menos de 150 linhas de mudanças no kernel e guarda eventos de 20 bytes em um vetor estático.

## Resultados

Todos os números abaixo são reportados pelos autores, na máquina de 64 núcleos.

- **Group Imbalance** (desde o 2.6.38). Os núcleos comparam a carga média dos grupos de escalonamento, e com autogroups uma thread de um make de 64 threads tem cerca de 64 vezes menos carga que uma única thread do R. A correção compara a carga mínima. O make terminou 13% mais rápido, e o lu do NAS com 60 threads mais quatro processos R rodou 13× mais rápido.
- **Scheduling Group Construction** (desde o 3.9). Os grupos são construídos do ponto de vista do núcleo 0, então dois nós a dois saltos de distância aparecem juntos em todos os grupos e nunca se equilibram. Com `taskset` nos nós 1 e 2, os ganhos da correção foram de 1,33× (is) a 3,63× (ua), e 27× no lu (de 1040 s para 38 s).
- **Overload-on-Wakeup** (desde o 2.6.32). Uma thread acordada só considera os núcleos do nó de quem a acordou, e pode cair num núcleo ocupado enquanto outros nós ficam ociosos. A correção a acorda no núcleo anterior se estiver ocioso, senão no núcleo ocioso há mais tempo, mas só quando a política de energia proíbe estados de baixo consumo. No TPC-H, a consulta 18 foi de 55,9 s para 43,5 s (22,2%) e o benchmark completo de 542,9 s para 471,1 s (13,2%). Somando a correção do Group Imbalance, 22,6% e 14,2%.
- **Missing Scheduling Domains** (desde o 3.19). Depois de desligar e religar um núcleo pelo /proc, a chamada que reconstrói os domínios entre nós NUMA se perdeu em uma refatoração, e todas as threads novas ficam em um só nó. Com 64 threads, os ganhos da correção foram de 4× (ep) a 24,9× (cg), 64,27× (ua) e 137,59× (lu, de 2196 s para 16 s, os "138×").
- **Ferramentas.** O verificador custa menos de 0,5% com até 10.000 threads, e o profiling com SystemTap cerca de 7% enquanto ativo. Portar do 3.17 para o 4.3 mudou uma linha. A carga mais intensa gerou cerca de 186.200 eventos por segundo, ou 3,6 MB de traço por segundo.

## Análise crítica

O artigo é franco sobre seus limites, e as lentidões superlineares são explicadas, não escondidas: spinlocks e spin-barriers punem o detentor do lock que foi retirado do núcleo.

- **O Linux 4.3 não resolveu.** Os autores confirmaram que a nova métrica de carga do 4.3 manteve o Group Imbalance, então uma métrica mais limpa sozinha não bastou.
- **As correções ainda não estavam no upstream.** O artigo diz que elas "serão submetidas" aos desenvolvedores do kernel, portanto não afirma que foram aceitas.

Os pontos a seguir são uma leitura da evidência, não afirmações do artigo.

- **Uma máquina, um fabricante.** Todos os números vêm de um Opteron de 8 nós, e os maiores efeitos exigem nós a dois saltos, um layout específico de cgroups ou um núcleo desligado e religado. O artigo não mostra com que frequência servidores típicos esbarram neles.
- **Os piores casos dominam a manchete.** Os 138× e 27× vêm do lu, um benchmark em pipeline que os autores chamam de exemplo extremo. Os ganhos realistas ficam na faixa de 13% a 24%.
- **Pouco detalhe estatístico.** A Tabela 2 é uma média de cinco execuções, mas não há variância, o banco não é nomeado e a configuração do TPC-H não é descrita.
- **Energia é afirmada, não medida.** "O desperdício de energia é proporcional" aparece na introdução, e a correção do Overload-on-Wakeup é desligada quando os núcleos podem entrar em estados de baixo consumo.
- **O verificador acha um sintoma.** Ele detecta núcleos ociosos ao lado de sobrecarregados, então outros erros de escalonamento, como má colocação NUMA, passariam.
- **Livro vs hoje (literatura posterior, fora do artigo).** A documentação do kernel Linux diz que o escalonador passou do CFS para o EEVDF na versão 6.6, então o código estudado aqui já foi substituído, e a mesma documentação descreve o sched_ext, uma classe de escalonamento definida por programas BPF. Se cada um desses quatro bugs está corrigido nos kernels atuais não é afirmado aqui. O kSTEP, nesta biblioteca, responde à lacuna de testes que o artigo apontou.

## Pesquisas futuras

- O escalonador modular imaginado pelos autores: como combinar sugestões conflitantes de módulos de afinidade de cache, contenção e balanceamento de carga?
- Visualização de traços grandes quando o usuário não sabe o que procurar, o que o artigo chama de problema em aberto.
- Métodos formais e de verificação de modelos capazes de raciocinar sobre tempo, já que violações transitórias são aceitáveis e só as longas são bugs.
- Se a ideia do verificador de sanidade se generaliza para outros invariantes de conservação de trabalho, por exemplo entre contêineres ou núcleos heterogêneos.
