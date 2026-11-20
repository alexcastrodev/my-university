---
title: "HeMem: gerenciamento escalável de memória em camadas para aplicações de grandes dados e NVM real"
summary: O HeMem é uma biblioteca em espaço de usuário que gerencia DRAM mais NVM Intel Optane, amostrando os acessos à memória com PEBS em vez de varrer tabelas de páginas, separando as páginas em listas quentes e frias e migrando-as em segundo plano por DMA ou threads de cópia, medido em hardware Optane real contra o modo de memória do Optane, o Nimble do Linux e um X-Mem emulado.
researchArea: Sistemas operacionais
keywords: memória em camadas, nvm, intel optane, pebs, userfaultfd, migração de páginas, páginas quentes e frias, dma
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

A memória não volátil (NVM) de alta capacidade é um novo nível da memória principal. Servidores em camadas DRAM+NVM aumentam a capacidade total de memória em até 8x, mas podem reduzir a largura de banda em até 7x e inflar a latência em até 63% se mal gerenciados. Os autores estudam sistemas de hardware e de software de gerenciamento de memória em camadas no Intel Optane DC, recém-disponível, com aplicações de grandes dados, e concluem que nenhum sistema existente maximiza o desempenho da aplicação em NVM real. Eles apresentam o HeMem, um sistema de gerenciamento de memória em camadas projetado do zero para a NVM comercial. O HeMem gerencia as camadas de forma assíncrona, agrupando e amortizando o rastreamento de acessos, a migração e a sincronização de TLB, e monitora o uso de memória amostrando acessos por eventos da CPU em vez de tabelas de páginas. No Optane ele supera o gerenciamento por hardware, por SO e por linguagem, com até 50% menos tempo de execução no benchmark de grafos GAP, 13% mais vazão no TPC-C do Silo, 16% menos latência de cauda sob isolamento de desempenho em um armazenamento chave-valor e até 10x menos desgaste da NVM que a melhor alternativa, sem modificar a aplicação.

## Visão geral

A NVM Optane DC fica no barramento de memória ao lado da DRAM e oferece até 8x a capacidade por módulo, com até 7x menos largura de banda e até o dobro da latência (Tabela 1: DRAM com 82 ns e 107/80 GB/s de leitura/escrita, Optane com 175/94 ns e 32/11,2 GB/s). O problema é decidir quais páginas ficam na DRAM e quais na NVM, e movê-las com o menor custo de CPU, de TLB shootdowns e de largura de banda de memória. Este artigo do SOSP 2021 (Universidade do Texas em Austin, com Wei Zhang na Microsoft) argumenta que a resposta de hardware (o modo de memória do Optane, um cache de DRAM de mapeamento direto com blocos de 64 bytes) não enxerga dados quentes e frios nem a assimetria entre leitura e escrita, e que propostas anteriores de SO e de linguagem foram avaliadas apenas em NVM emulada.

Termos para não confundir: MM é o modo de memória do Optane, um modo de hardware e não um recurso do Linux. O Nimble é um conjunto de extensões do Linux que expõe a NVM como um nó NUMA e varre e migra páginas em sequência (na avaliação ele recebe 4 threads de migração). O X-Mem é um runtime de camadas baseado em linguagem, que os autores apenas emulam mapeando grandes intervalos do heap para a NVM. O PEBS (amostragem baseada em eventos do processador) faz a CPU registrar eventos amostrados, aqui com o endereço virtual alvo, em um buffer. O userfaultfd encaminha faltas de página a uma thread em espaço de usuário. O GUPS é um microbenchmark de leitura-modificação-escrita aleatória.

Vale saber antes: tabelas de páginas e o bit de acesso, TLB shootdowns, arquivos DAX e a migração NUMA do Linux. Seis ligações a seguir, nenhuma citada pelo artigo e todas minhas. O [ESX Server](/papers/memory-resource-management-in-vmware-esx-server) já estimava conjuntos de trabalho por amostragem aleatória. O [Exokernel](/papers/exokernel-os-architecture-application-level-resource-management) e o [ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling) (no mesmo SOSP) também tiram a política do kernel, e o [cache_ext](/papers/cache-ext-customizing-the-page-cache-with-ebpf) faz isso no page cache. O [CortenMM](/papers/cortenmm-efficient-memory-management-with-strong-correctness) redesenha a camada de tabelas de páginas que o HeMem evita varrer, e o [Slab allocator](/papers/slab-allocator-object-caching-kernel-memory-allocator) atende os pequenos objetos do kernel que o HeMem deixa na DRAM. O [Caladan](/papers/caladan-mitigating-interference-at-microsecond-timescales) trata largura de banda de memória e alocação de cores como interferência, o mesmo orçamento de que as threads de segundo plano do HeMem se servem.

## Contribuição

- **Um estudo de medição do Optane real.** Vazão por número de threads e por tamanho de acesso, e o custo de varrer tabelas de páginas conforme a memória cresce, o que gera os princípios de projeto.
- **Amostragem em vez de varredura.** Contadores PEBS dão rastreamento assíncrono em qualquer granularidade (o protótipo usa huge pages), com contagens separadas de leitura e escrita.
- **Migração assíncrona.** Uma thread de política move páginas por DMA I/OAT, ou por threads de cópia sem DMA, e a proteção de escrita do userfaultfd mantém as leituras andando durante a movimentação.
- **Políticas baseadas em escalabilidade dos dados e assimetria.** Alocações pequenas ficam na DRAM, páginas com muita escrita têm prioridade de migração, e a biblioteca por aplicação permite política por aplicação e um modo de prioridade.
- **Uma avaliação em hardware real** contra o MM, o Nimble e um X-Mem emulado, além do desgaste da NVM.

## Metodologia

- **Projeto.** A libHeMem (4.177 linhas de C) entra por LD_PRELOAD e intercepta mmap e madvise com libsyscall_intercept. Intervalos abaixo de 1 GB vão ao kernel, então objetos pequenos ficam na DRAM. Os maiores são registrados no userfaultfd e apoiados em arquivos DAX para a DRAM (reservada com memmap) e a NVM. As mudanças no kernel somam 1.337 linhas em userfaultfd, gerenciamento de memória e tratamento de DAX, no Linux 5.1.0 com um patch de proteção de escrita ainda fora da linha principal.
- **Classificação.** O PEBS amostra leituras da NVM, leituras da DRAM que erram o L3 e todas as escritas. Uma página é quente com 8 leituras ou 4 escritas amostradas, e com muita escrita acima do limiar de escritas. Quando alguma página chega a 18 amostras, todas as contagens são divididas por dois (cooling, feito de forma preguiçosa com um relógio). As páginas ficam em filas FIFO quente, fria e livre por camada. O período de amostragem é de cerca de 5.000 acessos.
- **Migração.** Uma thread de política roda a cada 10 ms, troca páginas frias da DRAM por quentes da NVM, põe as de muita escrita na frente, mantém 1 GB de DRAM livre e limita a migração a 10 GB/s. Com DMA, lotes de 4 em 2 canais foram os melhores. Sem DMA, 4 threads de cópia. Se o conjunto quente excede a DRAM, nada migra.
- **Plataforma.** Um socket de uma máquina Cascade Lake-SP com 24 cores a 2,2 GHz, 192 GB de DRAM e 768 GB de Optane, presa a um nó NUMA. As cargas são GUPS, Silo com TPC-C, FlexKVS e a centralidade de intermediação (BC) do GAP, com média de 3 execuções no GUPS.

## Resultados

- **Medições do Optane.** A largura de banda de escrita do Optane satura com quatro threads. Em escala, escritas aleatórias e sequenciais da DRAM são 10,7x e 16,5x mais rápidas, leituras aleatórias da DRAM 2,7x mais rápidas, e leituras sequenciais do Optane superam as aleatórias da DRAM em 14%. A granularidade da mídia é de 256 bytes, então acessos aleatórios pequenos sofrem. Varrer tabelas de páginas com páginas base leva da ordem de segundos em escala de terabytes (Figura 3, só no texto).
- **GUPS uniforme.** Com 128 GB de conjunto de trabalho, o HeMem faz 3,2x o GUPS do MM, e até 3,7x com 24 threads. O Nimble chega a no máximo 78% de qualquer um. Com 24 threads e menos de 32 GB, o HeMem fica 10% abaixo do MM porque suas threads disputam cores.
- **GUPS com conjunto quente e assimetria.** Com 512 GB de conjunto de trabalho, o HeMem é até 2x melhor que o MM conforme o conjunto quente cresce, e o Nimble tem 25% do GUPS do MM. Com 128 GB só de escrita dentro do conjunto quente, MM e Nimble ficam 14% e 64% piores que o HeMem.
- **Overheads.** O rastreamento por PEBS fica perto de um ótimo manual, e com migração a diferença é de 5,9%. A varredura de tabelas de páginas custa 18% frente ao PEBS e, com varredura e migração na mesma thread, só 18% do ótimo (43% com uma thread de varredura separada, que marca até 300 GB de 512 GB como quentes).
- **Silo (TPC-C).** Se os dados cabem na DRAM (até 864 armazéns), o HeMem supera o MM em até 13% e o Nimble em até 82%. Além da DRAM, o MM vence por 17%. Rodar o Silo todo na NVM chega a 32% do HeMem. A introdução fala em "400%" sobre o X-Mem, número que não bate com isso.
- **Armazenamento chave-valor (FlexKVS).** Com 700 GB (conjunto quente de 140 GB) a vazão é 1,06 Mops/s no HeMem contra 0,93 (MM), 0,92 (Nimble) e 0,90 (X-Mem). Na Tabela 3 a latência mediana é 20 contra 35 µs (HeMem e MM). Com uma instância prioritária na DRAM, a mediana prioritária do HeMem é 86 contra 127 µs e o p99 é 239 contra 278 (16% melhor), enquanto a instância regular tem p99,9 8% pior.
- **GAP e desgaste.** BC cabendo na DRAM (2^28 vértices): o HeMem supera o MM em 93% em média. Com 2^29 supera o MM em 58% e o Nimble em 36% em média. As escritas na NVM são 10x menores que no MM, e a variante com tabelas de páginas faz três ordens de grandeza a mais no início.

## Análise crítica

O artigo é franco sobre vários limites.

- **Exige um conjunto quente.** Acesso uniforme em um conjunto maior que a DRAM rende pouco, e quando o conjunto quente excede a DRAM o HeMem para de migrar. O Silo além da DRAM perde para o MM.
- **Amostragem é um compromisso.** Com períodos curtos até 30% das amostras são perdidas, e limiares acima de cerca de 20 prejudicam. Os limiares foram ajustados no GUPS com um só tamanho de conjunto quente.
- **Escopo.** Só a memória de heap em espaço de usuário é gerenciada, não objetos do kernel, texto de programa nem o page cache. A DRAM é reservada no boot, e efeitos NUMA ficam fora do escopo. Os patches do kernel, os nomes de eventos da Intel e o corte de 1 GB prendem o sistema a uma plataforma. O Nimble derrubou a pilha TAS, então não há resultado de latência dele.

Minha leitura, não afirmações do artigo.

- **Os números de destaque divergem.** O resumo diz 50% menos tempo no GAP, o corpo dá ganhos de 93% e 58% sobre o MM (93% mais rápido é cerca de 48% menos tempo, conta minha). As porcentagens de latência na introdução, no corpo e na Tabela 3 também diferem.
- **Baselines.** O X-Mem é emulado, e o artigo não quantifica quanto a emulação engana, citando outro trabalho para essa afirmação. A dispersão aparece só na Figura 10.
- **Optane, depois (fora do artigo).** O [Register](https://www.theregister.com/2022/07/29/intel_optane_memory_dead/) noticiou em julho de 2022 que a Intel estava abandonando o Optane, com uma perda de estoque de US$ 559 milhões no relatório do 2º trimestre. O artigo não pode mostrar que a política generaliza para outras mídias.
- **Literatura posterior, vista só pelas análises deste catálogo, não pelos artigos originais.** O [MEMTIS](/papers/memtis-efficient-memory-tiering-with-dynamic-page-classification) (2023) diz que os limiares estáticos do HeMem administram mal o conjunto quente e que sua thread de amostragem usa cerca de 100% de um core. O [Colloid](/papers/tiered-memory-management-access-latency-is-the-key) (2024) mostra que HeMem, TPP e MEMTIS compartilham uma regra de pôr o mais quente na camada padrão que falha sob contenção de banda.

## Pesquisas futuras

- Um daemon global do HeMem que coordene as instâncias por processo, e camadas dinâmicas compartilhadas com o kernel em vez da reserva DAX no boot, que o artigo só esboça.
- Camadas para objetos do kernel e para o page cache, que o artigo deixa para mecanismos separados.
- Swap como terceira camada, e memória em camadas compartilhada entre processos.
- Limiares e períodos de amostragem autoajustáveis, e testes além de um único socket e da plataforma Intel.
