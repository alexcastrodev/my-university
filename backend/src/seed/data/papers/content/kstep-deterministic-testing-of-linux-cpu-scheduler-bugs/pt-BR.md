---
title: "kSTEP: caracterização e testes determinísticos de bugs do scheduler de CPU do Linux"
summary: Um estudo de 232 correções de bugs do scheduler do Linux mostra que a maioria dos bugs é silenciosa e raramente reproduzida, e o kSTEP responde com um framework que reexecuta sequências de eventos escritas à mão em CPUs isoladas com relógios simulados, tornando o comportamento do scheduler repetível e testável com fuzzing.
researchArea: Sistemas operacionais
keywords: scheduler do linux, bugs de scheduler, testes determinísticos, fuzzing, eevdf, cfs, bugs de política
version: 1.0
updatedAt: 2026-11-07
---

## Visão geral

O scheduler de CPU do Linux decide qual thread pronta cada CPU executa em seguida, e passou de cerca de 15 mil para 50 mil linhas de código em 15 anos. Este artigo do OSDI 2026 (o 20º USENIX Symposium on Operating Systems Design and Implementation, em Seattle), da University of Wisconsin-Madison e da Purdue University, pergunta por que os bugs do scheduler sobrevivem tanto tempo e como testá-los melhor.

Os autores separam dois tipos de defeito. Bugs de funcionalidade quebram garantias estritas (uma tarefa roda numa CPU fora da sua afinidade, uma tarefa sofre starvation, o kernel entra em pânico). Bugs de política deixam o scheduler funcionando, mas desalinhado da política pretendida, prejudicando justiça, balanceamento, localidade ou consumo de energia sem nenhum erro. Os bugs de política são difíceis até de reconhecer por fora, porque um wakeup lento pode ser um defeito ou uma troca deliberada.

Termos principais: eventos que invocam o scheduler (fork, wakeup, mudanças de cgroup, ticks, atributos de CPU), o driver program que os lista, `tick_until` (injetar ticks até que um predicado sobre o estado do scheduler seja verdadeiro) e o módulo de determinismo que remove o ruído.

Vale conhecer antes: classes de scheduling e cgroups do Linux, além do EEVDF e de sua funcionalidade de delayed dequeue, que aparece em vários bugs. O [ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling) move a política de scheduling para agentes em userspace, enquanto o kSTEP testa as políticas que vivem no kernel, e o estudo exclui o sched_ext.

## Contribuição

- **Um estudo de caracterização.** Os autores coletaram commits de correção de bugs que mexem em kernel/sched/ desde 2020, nos ramos mainline e stable, chegando a 232 bugs, e relatam doze achados sobre observabilidade, consequências, descoberta, causas-raiz e gatilhos.
- **Execução controlada.** Um driver é uma função em C num módulo de kernel que emite eventos para tarefas de userspace, cgroups, kthreads, qualquer função exportada do kernel, atributos de CPU (topologia, capacidade, frequência) e ticks explícitos. O driver não edita o estado do scheduler diretamente, só chega a ele por caminhos normais de código.
- **Execução determinística.** O kernel roda sem modificação. O kSTEP simula `sched_clock` e `jiffies`, avançando os dois depois de cada tick em todas as CPUs controladas. Ele manda interrupções, callbacks de RCU e workers de workqueue para a CPU 0, roda um init mínimo como PID 1 e reinicia o estado do scheduler que depende do boot.
- **Ferramentas por cima.** Um tracer registra os program counters que cada evento aciona, separados por tarefa participante. Um fuzzer usa cobertura de arestas, acompanha os estados das tarefas para gerar eventos válidos, reexecuta um prefixo até um ponto que deu cobertura nova e muta o que vem depois.
- **Implementação.** Cerca de 1,5 mil linhas de módulo de kernel e 150 linhas de código em userspace, executadas no QEMU em x86_64 e arm64. Os autores testam em kernels LTS v5.15, v6.1, v6.6, v6.12 e v6.18, e na v7.0. É código aberto.

## Metodologia

No estudo, cada commit foi classificado como correção de bug por um trailer `Fixes:` ou por palavras-chave de defeito, e cada bug foi examinado e classificado por um dos autores. Os limites declarados por eles são que bugs não relatados ou não corrigidos ficam de fora, que o resultado descreve o Linux e não schedulers em geral, e que a classificação envolve julgamento.

Na avaliação, os autores amostraram sete bugs que cobrem componentes, observabilidade e gatilhos diferentes. Para cada um, fizeram checkout do commit anterior à correção, rodaram um driver escrito à mão numa instância nova do QEMU e repetiram no commit da correção. A máquina tinha duas CPUs Intel Xeon Silver de 10 núcleos e rodava Ubuntu 24.04.

O fuzzer rodou por 24 horas por bug, com um invariante codificado para cada um (por exemplo, só uma CPU designada por grupo de scheduling invoca o balanceamento de carga), e cada violação foi inspecionada à mão. Depois, quatro bugs novos foram buscados no kernel mais recente.

## Resultados

Estes são os resultados relatados pelos autores.

- **Os bugs são silenciosos.** 15% causam crashes ou travamentos, enquanto 73% são falhas funcionais silenciosas ou desalinhamentos de política sem nenhum aviso. 75% das causas-raiz são atualizações de estado erradas ou lógica errada, e a classe Fair tem 70% de bugs de política.
- **Os bugs vivem muito e não são reproduzidos.** 45% ficam escondidos por anos e 5% por mais de uma década. 61% dos bugs expostos em execução não têm sequência de gatilho, só 22% das correções enviadas por usuários incluem validação de desenvolvedor, e as correções raramente adicionam testes, avisos ou tracepoints.
- **Os gatilhos vão além do userspace.** 90% exigem um comportamento específico de workload e 54% dependem de atributos do scheduler. Cerca de 19% precisam de eventos do kernel, como hotplug ou kthreads, e 88% podem ser disparados numa máquina multicore com SMT, enquanto o restante exige NUMA (5%), núcleos assimétricos (5%) ou outro hardware.
- **Os reprodutores são curtos.** Nos sete bugs estudados, levam no máximo 20 eventos e 47 linhas, usam no máximo cinco tarefas (exceto um caso, com 20 mil) e rodam em segundos. Três precisam de `tick_until`.
- **O fuzzing encontra a maioria.** Os Bugs #3, #4, #5 e #7 foram disparados em menos de uma hora, o Bug #1 em 2,13 horas e o Bug #2 em 8,68 horas. O Bug #6 exige 20 mil threads e ficou fora de alcance.
- **Os traces são repetíveis.** Na Figura 16, as execuções com e sem o bug mostram comportamento idêntico até o gatilho e divergência depois dele.
- **Quatro bugs novos.** Relatados aos desenvolvedores: uma correção incompleta no upstream do Bug #1 (o `select_idle_sibling` ainda contava tarefas em delayed dequeue), uma fórmula de desbalanceamento de CPUs ociosas que arredonda para 0, um grupo de scheduling rotulado como sobrecarregado em vez de desbalanceado e uma estimativa de tempo ocioso que não é escalada pela capacidade da CPU. Os dois últimos vieram do fuzzer, depois de 5,32 e 0,13 hora.

## Análise crítica

O artigo admite três limites. Os eventos do driver são serializados, então o kSTEP não expõe bugs de concorrência dentro do scheduler, que são 12% do estudo. O fuzzer não alcançou o Bug #6. E o estudo pode não representar bugs que nunca foram relatados ou corrigidos.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **Os reprodutores foram escritos já sabendo a resposta.** Os drivers foram montados a partir do bug e do commit da correção, então "no máximo 20 eventos" mede o custo de expressar um gatilho conhecido, não de descobri-lo. O fuzzer trata da descoberta, mas seus invariantes também codificam o bug conhecido.
- **A amostra pende para código recente.** Os Bugs #1, #2 e #3 envolvem o delayed dequeue do EEVDF, e o #8 é um resto do #1. Sete de 232 bugs foram reproduzidos, e o artigo não diz quantos dos 232 o modelo de eventos consegue expressar além de excluir a concorrência.
- **As bases de comparação citadas não são executadas.** A comparação "20 eventos em vez de benchmarks de horas" não é medida, nenhum benchmark ou outra ferramenta (por exemplo o LinSched, ou um fuzzer sem o determinismo do kSTEP) roda nos mesmos bugs, e o benefício da cobertura sem ruído é afirmado sem ablação.
- **Os resultados do fuzzing são execuções únicas.** Cada tempo até o gatilho é um número de uma rodada de 24 horas, sem dispersão entre sementes. O determinismo é mostrado comparando traces de sete reprodutores, e o número de repetições não é informado.
- **O impacto vem de evidências diferentes.** O artigo mede alguns impactos (Figura 2, o custo de rebalanceamento do Bug #6) e descreve ou estima outros. O kSTEP mostra que uma decisão está errada, e o custo para um workload real é outra pergunta.
- **Viés de sobrevivência nos tempos de vida.** Os 45% cobrem só bugs corrigidos desde 2020, então bugs recentes ainda não podem ser antigos e os não descobertos não aparecem. O baixo esforço de manutenção também é afirmado sem números.

## Pesquisas futuras

- Combinar o kSTEP com testes de concorrência controlada, que os autores chamam de ortogonais, para cobrir os 12% de bugs que exigem corridas dentro do scheduler.
- Oráculos que detectem comportamento anormal sem um invariante escrito à mão por bug, que o artigo lista como detecção de anomalias, junto com agentes de LLM que escrevem drivers e comparações de política entre kernels.
- Transformar os drivers em testes de regressão, já que o estudo mostra que as correções raramente adicionam algum.
- Se o mesmo modelo de eventos consegue testar políticas carregadas via sched_ext (excluído aqui) ou delegadas a agentes em userspace como no ghOSt, uma lacuna que o artigo não discute.
