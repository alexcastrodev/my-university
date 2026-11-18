---
title: "TuxBot: ajuste online de SO com consciência semântica usando LLMs"
summary: O TuxBot ajusta knobs de scheduler, energia, memória e E/S do Linux num host em produção com modelos de linguagem que entendem o que os knobs e a telemetria significam, usando um laço rápido e um lento, memória de sessões anteriores e um validador tipado entre o modelo e o kernel, e evita as regiões degradadas em que tuners bayesianos e de aprendizado por reforço caem.
researchArea: Sistemas operacionais
keywords: ajuste de so, llm, kernel linux, otimização online, otimização bayesiana, telemetria, engenharia de desempenho
version: 1.0
updatedAt: 2026-11-18
---

## Visão geral

Um sistema operacional moderno expõe uma grande superfície de controle para scheduling, gerenciamento de energia, memória e E/S, e o melhor ajuste depende da carga, do hardware e do momento. Só o Linux expõe mais de 1.200 parâmetros ajustáveis. Ajustar à mão exige um engenheiro de desempenho para cada carga em cada servidor, então a automação comum é a otimização bayesiana ou o aprendizado por reforço (RL), que tratam cada knob como um número e buscam uma recompensa escalar melhor.

Os autores, da Columbia University e da IBM Research, estudam tuners que rodam fora do caminho crítico e em regime estável: um controlador no host que, enquanto o serviço continua rodando, ajusta knobs como a fatia de tempo do scheduler ou o orçamento de polling da rede em escalas de segundos a minutos. Eles argumentam que os tuners clássicos falham em sistemas em produção por uma razão, que é ignorarem o que os knobs significam. Usando o MLOS, a melhor linha de base clássica do artigo, como exemplo corrente, descrevem três falhas. O tuner faz mudanças semanticamente inválidas: para o Memcached sob carga alta ele repete o erro de pôr a frequência mínima acima da máxima, ou combina busy polling extremo, estados de ociosidade rasos e janelas de scheduler muito longas, com a latência de cauda até 47 vezes pior. Ele falha quando as métricas da aplicação não são expostas: no PostgreSQL rodando o benchmark Wikipedia, trocar a latência da aplicação por instruções por ciclo ou por cache misses dá latência p99 2 vezes pior. E piora conforme a superfície de controle cresce: no TPC-C, o p99 degrada bastante de 1 para 32 knobs.

Este artigo do SOSP 2026 (Praga) responde com o TuxBot, um framework que põe um modelo de linguagem dentro do laço de ajuste como um raciocinador semântico online, sob limites de custo, latência e autoridade.

Termos para não confundir: knob é um parâmetro ajustável do SO (um valor de sysctl, sysfs ou debugfs), janela de ajuste é um intervalo curto de medição seguido de no máximo uma decisão, semanticamente inválido cobre tanto ajustes contraditórios quanto combinações de aparência válida mas sem sentido para a carga, e regime metaestável é aquele em que o sistema continua degradado depois que o gatilho some.

Vale conhecer antes: otimização bayesiana com modelo substituto, como CFS, DVFS e estados de ociosidade interagem, e o que a latência p99 mede. Dois artigos da biblioteca se relacionam de perto. O [Xkernel](/papers/xkernel-principled-performance-tunability-of-os-kernels), que o TuxBot cita, defende transformar constantes fixas do kernel em knobs ajustáveis com segurança em tempo de execução, e [Metastable Failures in Distributed Systems](/papers/metastable-failures-in-distributed-systems) é a fonte do regime metaestável que prende as linhas de base no Xapian. Uma terceira ligação é minha e não do artigo: o [cache_ext](/papers/cache-ext-customizing-the-page-cache-with-ebpf) compartilha o autor Hubertus Franke e também é um trabalho da Columbia e da IBM sobre tornar a política do kernel personalizável.

## Contribuição

- **Visão semântica do sistema.** O modelo recebe nomes e metadados dos knobs, contexto dos subsistemas, a telemetria atual e o histórico recente, e assim consegue rejeitar combinações contraditórias antes de tentá-las, inferir o progresso da aplicação a partir de uma assinatura conjunta de telemetria (saturação de CPU, crescimento da fila de execução, pressão de memória, estado de energia, espera de E/S) quando falta a métrica real, e se concentrar nos knobs ligados ao gargalo atual.
- **Controle em laço duplo.** Um laço Instant, com um modelo rápido e barato, roda a cada intervalo de ajuste (1 a 5 segundos) para exploração local e correções. Um laço Reasoning, com um modelo mais forte, roda a cada dezenas de segundos sobre um histórico maior e revisa a estratégia. Os dois leem um contexto compartilhado com uma política de substituição: as entradas de raciocínio persistem e as instantâneas são descartadas quando o próximo resultado de raciocínio chega, então a parte ilimitada do contexto cresce com o número de chamadas de raciocínio e não com as instantâneas.
- **Atuação tipada e validada.** O modelo nunca recebe um shell. Sua resposta segue um esquema construído a partir do conjunto ativo de knobs, e um Parameter Validator no host só aceita knobs desse conjunto, confere os domínios numéricos e categóricos, expande ajustes por núcleo e escreve por sysctl, sysfs, debugfs, cpufreq e intel_pstate sob um lock. Uma escrita que falha mantém a configuração anterior, e os ajustes originais são restaurados quando a sessão termina. Os autores motivam isso com um agente com terminal que, nas execuções de TPC-C deles, desligou núcleos de CPU, gravou dirty ratios grandes, trocou perfis do tuned e reescreveu schedulers de bloco.
- **Memória em duas escalas de tempo.** Dentro de uma execução, um trace de ações, configurações e medições volta para os prompts. Entre execuções, cada sessão é guardada num armazenamento vetorial (Gemini Embedding e ChromaDB), e uma nova sessão recupera as 3 execuções anteriores mais próximas pela assinatura da primeira janela, que o modelo de raciocínio condensa num prior curto usado como dica leve. Eles acharam k=1 frágil e k maior diluindo a evidência relevante.
- **Modo opcional de poda.** A mesma estrutura pode primeiro reduzir os knobs e as faixas ativos durante algumas iterações ao vivo e depois entregar um espaço menor ao MLOS (TuxBot-Trim).
- **Implementação.** Um plano de controle em Python com 6.374 linhas para o laço principal, a telemetria e as sessões e 3.775 linhas para as linhas de base, metadados tipados para 41 knobs do Linux e backends para modelos da OpenAI, do OpenRouter e do Gemini. Anexar métricas de aplicação a uma carga nova costuma levar menos de 30 minutos, e as métricas de sistema não exigem mudança.

## Metodologia

Todas as execuções usam hosts bare-metal do CloudLab com dois processadores Intel Xeon Silver 4114 (40 threads de hardware), 192 GiB de memória, Ubuntu 22.04.2 e Linux 5.15, um benchmark por vez com a carga fixada nas CPUs 0 a 9. O conjunto de ajuste padrão tem oito knobs acoplados sobre o CFS (`min_granularity_ns`, `latency_ns`, `wakeup_granularity_ns`, `migration_cost_ns`), o estado de ociosidade (`cstate_max`), o polling do NAPI e os limites do DVFS (`min_perf_pct`, `max_perf_pct`). Os estudos de escala ampliam o conjunto até 41 knobs.

São 13 cargas de cinco suítes (Mutilate para o Memcached, BenchBase sobre o PostgreSQL 14, Tailbench, Sysbench e DCPerf): dez sensíveis à latência minimizando o p99 (incluindo TPC-C, Wikipedia, YCSB, Twitter, Masstree, Silo e Xapian) e três de vazão. O TuxBot usa o Gemini 2.5 Flash para o Reasoning e o Flash-Lite para o Instant, com temperatura 0,7. As linhas de base são a configuração padrão, o MLOS com SMAC3, um otimizador bayesiano, Q-learning tabular, DQN e a variante Trim, além de tuners de LLM de laço único. Uma janela tem 5 segundos de medição, uma sessão tem 30 janelas de ajuste seguidas de uma fase estável de 20 janelas, cada configuração roda cinco vezes, e o agregado é a média geométrica dos fatores de melhoria sobre o padrão com desvio padrão entre as repetições. Para o TuxBot a fase estável significa nenhuma mudança depois da última ação aceita, enquanto as linhas de base que buscam continuamente seguem ajustando nas janelas 31 a 50.

## Resultados

Estes são os resultados reportados pelos autores.

- **De ponta a ponta.** O TuxBot melhora o agregado sobre os parâmetros padrão em 59,36% durante o ajuste e 72,49% na fase estável. O MLOS fica em -33,79% e -31,91%, o TuxBot-Trim em -30,62% e -26,14%, o Bayesiano em -45,77% e -37,46%, o DQN em -40,41% e -44,49%. Os números de destaque são 72,5% sobre o padrão e 153,3% sobre o MLOS.
- **Execuções catastróficas.** No Xapian e no Memcached as linhas de base entram num regime metaestável dominado por fila de que não saem durante a sessão. Nas outras 11 cargas o TuxBot chega a +87,22% na fase estável, contra +50,52% do MLOS, +37,37% do Bayesiano e +33,68% do DQN, e o TuxBot-Trim chega a +63,93%.
- **Custo e desenho dos laços.** Uma sessão de 30 janelas custa cerca de US$ 0,20 para o TuxBot. Um laço único de Reasoning obtém +89,7% por US$ 0,42, um laço único Instant +25,4% por US$ 0,12 e o Trim +63,9% por US$ 0,15 (tudo no subconjunto de 11 cargas, em que o laço duplo é +87,2%).
- **Métricas ausentes.** Só com métricas de sistema o TuxBot chega a +21,7% durante o ajuste e +31,9% na fase estável, e só com IPC a +18,2% e +16,2%. No subconjunto de 11 cargas ele mantém +64,0% com métricas de sistema e +47,21% com IPC, enquanto o MLOS com métricas de aplicação obtém +50,5% e cai para -24,1% com IPC e -22,8% com cache misses. O resumo reporta 93,7 pontos de vantagem sobre linhas de base que recebem métricas diretas da aplicação.
- **Segurança.** Excluindo as execuções catastróficas, a fração mediana de janelas piores que o padrão é de 16,9% para o TuxBot contra 28,8% do MLOS e 29,7% do Trim, e a variabilidade é de 11,1% contra 25,1% e 24,7%. No Xapian a variabilidade é de 10,9% contra 39120,2% do MLOS.
- **Escala.** De 1 a 41 knobs no TPC-C, no Sysbench OLTP-RW e no Silo, o TuxBot continua positivo (+216,7% estável com 8 knobs, +213,4% com 16, +105% com 32, +155,9% com 41) enquanto o MLOS cai de +119,3% com 4 knobs para +19,6%, +28,3% e +13,0% com 16, 32 e 41 e fica negativo durante o ajuste. A latência mediana de decisão do MLOS sobe de 0,49 s para 5,73 s, o laço Instant do TuxBot leva de 1,01 a 2,55 s e o Reasoning de 8,08 a 15,80 s.
- **Memória.** Em três cargas reservadas, um prior das 3 melhores execuções eleva a média geométrica de +86,3% e +144,7% (ajuste e estável, métricas de aplicação) para +155,6% e +202,9% e reduz as barras de erro de 54,6 e 106,0 para 14,1 e 15,3. O Top-1 fica pior que não ter memória.

## Análise crítica

O artigo declara vários limites por conta própria.

- **Só regime estável.** O TuxBot serve a serviços de longa duração com demanda sustentada, não a jobs curtos, cargas em rajadas ou episódios de sobrecarga que exigem reação em menos de um segundo, e reinicia depois de uma grande deriva.
- **Uma aplicação por sessão.** Aplicações co-localizadas exigiriam raciocinar sobre interferência e domínios de controle particionados como cgroups, o que os autores deixam para trabalho futuro.
- **A poda não basta.** Reduzir o espaço ajuda o MLOS mas não torna o caminho online seguro, já que as taxas de janelas ruins ficam perto das do MLOS.

Os pontos a seguir são uma leitura da evidência, não afirmações do artigo.

- **Os números de destaque pedem cuidado.** "153,3% sobre o MLOS" é uma razão de fatores de média geométrica (1,725 contra 0,681), e o próprio MLOS fica 31,9% pior que não fazer nada, como todas as outras linhas de base, então a comparação é com tuners que perdem para o padrão. Os "93,7 pontos percentuais" do resumo batem com a razão 1,319 sobre 0,681 calculada a partir dos números do próprio artigo e não com uma diferença em pontos, que seria 63,8.
- **A fase estável favorece o TuxBot por construção.** O TuxBot para de mudar depois da última ação aceita enquanto as linhas de base seguem explorando nas janelas 31 a 50, e explorar custa desempenho. Uma linha de base congelada na melhor configuração seria uma comparação de estado final mais justa. Os autores também reportam os números da fase de ajuste, que mostram a mesma ordem.
- **As linhas de base não têm restrições.** O MLOS não recebe regras de validade, e os autores argumentam que restrições escritas à mão não generalizam, mas uma simples como `min <= max` eliminaria uma das duas falhas mostradas no exemplo corrente. O subconjunto de 11 cargas também exclui as cargas em que as linhas de base falham, uma escolha feita depois de ver os resultados, embora as duas visões sejam mostradas.
- **O validador é sintático.** Ele impõe conjuntos de knobs e domínios, então a proteção contra combinações numericamente válidas mas sem sentido, a falha do Memcached, vem do julgamento do modelo e não de uma checagem. O artigo mostra menos janelas ruins, não uma garantia.
- **Uma família de modelos e um ambiente de teste.** Os resultados usam o Gemini 2.5 Flash e Flash-Lite com temperatura 0,7 por uma API de fornecedor, cinco execuções por célula, uma geração de CPU e uma versão de kernel. Como os resultados mudam com outro modelo, com um modelo local ou quando a telemetria não pode sair do host não é testado, e a transferência de memória é mostrada em três cargas reservadas com memória construída a partir das sessões dos próprios autores.
- **O custo é só a conta do modelo.** Os US$ 0,20 por sessão contam chamadas de API, e a sobrecarga adicional no host do controlador e de decisões de 1 a 5 segundos não é reportada em separado.

## Pesquisas futuras

- Ajustar várias aplicações co-localizadas, com knobs no nível de cgroup e recompensas multiobjetivo.
- Detectar deriva da carga e decidir quando reiniciar ou retomar uma sessão, como os autores esboçam.
- Garantias de atuação mais fortes que checagens de domínio, por exemplo restrições aprendidas ou verificadas sobre as interações entre knobs.
- Testar outros modelos, inclusive locais, outros kernels e hardware, e compartilhar a memória entre execuções de máquinas diferentes.
