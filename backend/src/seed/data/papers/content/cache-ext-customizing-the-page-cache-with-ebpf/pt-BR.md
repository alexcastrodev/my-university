---
title: "cache_ext: personalizando o page cache com eBPF"
summary: O cache_ext permite que cada cgroup carregue sua própria política de evicção no page cache do Linux como código eBPF, usando listas de evicção gerenciadas pelo kernel e um registro de folios válidos, de modo que políticas da literatura de caching rodem no kernel sem um patch de kernel por política e sem atrapalhar outras aplicações.
researchArea: Sistemas operacionais
keywords: page cache, ebpf, política de evicção, cgroups, struct_ops, kfuncs, kernel linux
version: 1.0
updatedAt: 2026-11-07
---

## Visão geral

O page cache do Linux mantém dados de arquivos na memória e os remove com uma única política aproximada de LRU, construída com uma lista ativa e uma inativa. Essa política funciona para muitas cargas e mal para outras, por exemplo scans grandes que expulsam as páginas úteis. As aplicações podem enviar dicas com `fadvise()`, mas o kernel pode ignorá-las e elas continuam dentro da mesma estrutura de LRU. Mudar a política exige alterar código de gerenciamento de memória, e subir a mudança para o upstream é difícil, porque ela precisa servir a todas as cargas que rodam no Linux. Os autores lembram que o Multi-Generational LRU (MGLRU) do Google levou anos para ser integrado e ainda não vem habilitado por padrão no upstream.

Este artigo do SOSP 2025 (Seul), da Columbia University e da IBM Research, se inspira no sched_ext, o scheduler extensível baseado em eBPF, e pergunta se o page cache pode ser estendido do mesmo jeito. O resultado é o cache_ext, um framework em que a aplicação carrega programas eBPF que decidem quais páginas admitir e remover, sem mexer de novo no kernel.

Termos para não confundir: folio é a unidade de memória em cache do kernel (uma página em todas as cargas do artigo), função de política é um dos callbacks eBPF que o kernel chama a cada evento de caching, lista de evicção é uma lista encadeada de ponteiros para folios pertencente à política, e kfunc é uma função do kernel exposta a programas eBPF sem interface estável.

Vale conhecer antes: LRU e por que scans o prejudicam, cgroups como unidade de contabilidade de memória e o verifier do eBPF. O artigo cita o [ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling) como um framework de scheduling que ameniza o problema do privilégio de root com um carregador de políticas privilegiado. Ele também argumenta que o dispatch em userspace, uma opção do sched_ext, serve melhor ao scheduling do que à evicção, porque os eventos de página são muito mais frequentes que os de scheduling, e essa é a ideia de delegação por trás do ghOSt (essa ligação é minha). Um segundo pareamento meu, que não é do artigo: o [PeeR](/papers/peer-first-class-scheduling-for-latency-critical-ebpf-applications) (OSDI 2026) compartilha um autor, Jeremy Carin, e também se apoia em eBPF e sched_ext. Este artigo não o cita, já que ele veio depois.

## Contribuição

- **As políticas rodam no kernel.** Os autores começam estimando o melhor caso de um desenho em userspace: programas eBPF em tracepoints existentes enviam cada evento de folio por um ring buffer até o userspace, que não faz nada com eles. Só isso custa até 20,6% nas cargas deles (YCSB, uma carga uniforme de chave-valor e uma busca com ripgrep), então o cache_ext mantém o código da política no kernel.
- **Cinco eventos via `struct_ops`.** Uma política implementa callbacks para inicialização, pedido de candidatos à evicção, admissão de folio, acesso a folio e remoção de folio. Evicção e remoção são separadas porque um folio pode sair do cache por outros caminhos (um arquivo apagado) e porque um candidato proposto pode não ser removível (o kernel está usando). Os hooks exigiram cerca de 200 linhas no código central do page cache.
- **Listas de evicção gerenciadas pelo kernel.** Os mapas eBPF oferecem ordem ou acesso aleatório, não os dois, e as estruturas de dados mais novas do eBPF não estavam maduras o bastante para os autores. As políticas então chamam kfuncs (`list_create`, `list_add`, `list_move`, `list_del`, `list_iterate`) sobre listas cujos nós apontam para folios, com o locking feito dentro do kernel. O `list_iterate` executa um callback por nó e escolhe folios para remover ou, no modo de pontuação em lote, pontua N folios e remove os C de menor pontuação, o que serve ao LFU. Os candidatos vão ao kernel em lotes de até 32, e o kernel verifica cada um.
- **Isolamento por cgroup.** Cada cgroup pode carregar sua própria política, e os autores estendem o carregamento do `struct_ops` com um file descriptor de cgroup (cerca de 220 linhas no kernel e 75 na libbpf). Os processos ainda podem ler páginas de outro cgroup, então o compartilhamento de memória continua.
- **Segurança.** Um registro de folios válidos, uma tabela hash com locks por bucket que também mapeia cada folio ao seu nó de lista, permite ao kernel rejeitar ponteiros inválidos devolvidos por uma política. Se uma política propõe candidatos de menos, o kernel recorre à política padrão dele, e um folio removido sai de todas as listas por obra do kernel. As kfuncs verificam entradas, limites e término de laços, e carregar uma política exige root.
- **Um conjunto de políticas.** Os autores implementam LFU, MRU, FIFO, S3-FIFO, LHD (com inteiros escalados porque o eBPF não tem ponto flutuante, e reconfiguração periódica por um programa `BPF_PROG_TYPE_SYSCALL`), um port do MGLRU, uma política GET-SCAN ciente da aplicação, com duas listas e um mapa com os PIDs das threads de SCAN, e um filtro de admissão que mantém as threads de compaction em segundo plano fora do cache (15 linhas extras no verifier).
- **Tamanho.** O patch inteiro soma cerca de 2000 linhas no kernel. Dessas, 210 estão no page cache, 80 no verifier e 80 no código de cgroup, e o restante implementa o cache_ext em si, incluindo 750 linhas para as kfuncs de lista e 580 para o registro.

## Metodologia

Os experimentos rodam em nós CloudLab c6525-25g (AMD Rome de 16 núcleos, 128 GB de memória, SSD de 480 GB) com Ubuntu 22.04 e Linux 6.6.8, com CPU pinning e SMT, swap e randomização de endereços desabilitados. O page cache é descartado antes de cada teste. As bases de comparação são a política padrão do kernel, o MGLRU e as opções do `fadvise()` (NOREUSE, DONTNEED, SEQUENTIAL).

As cargas são o LevelDB, alterado para usar `pread()` no lugar de `mmap()`, sob YCSB com um banco de 100 GiB em um cgroup de 10 GiB, mais variantes uniformes e uniformes de leitura e escrita. O LevelDB também é guiado por traces de produção de cache do Twitter, de cinco clusters, cada um com um cgroup de 10% dos dados do cluster. As outras cargas são 10 buscas com ripgrep nos fontes do Linux 6.6 em um cgroup de 1 GiB, uma carga mista GET/SCAN no LevelDB (99,95% GET e 0,05% SCAN, com pools de threads separados) e o RocksDB com leituras e escritas uniformes para o filtro de admissão. O isolamento usa dois cgroups ao mesmo tempo (YCSB C e busca de arquivos), com quatro combinações de política. O overhead é medido como memória do registro, como CPU por operação de I/O com fio em uma política no-op e comparando o port do MGLRU com o MGLRU do kernel no YCSB.

## Resultados

Estes são os resultados relatados pelos autores.

- **YCSB.** O LFU vence em todas as cargas, exceto no YCSB D, que cabe na memória, com até 37% mais throughput que a política padrão e uma margem maior sobre o MGLRU. Os autores chamam o LFU de escolha natural para uma distribuição Zipfian fixa. O LHD fica perto do LFU e o S3-FIFO também supera as políticas do Linux, enquanto o MRU fica abaixo da base e o FIFO fica um pouco acima do MGLRU, mas não da política padrão. A latência P99 de leitura é até 55% menor que a da padrão. O throughput varia de forma inversa ao total de I/O em disco, mostrado para YCSB A e C.
- **Traces do Twitter.** Nenhuma política vence em tudo. O LHD supera a padrão e o MGLRU em 13% e 30% no cluster 34, e o LFU em 13% e 34% no cluster 52. O MGLRU domina os clusters 17 e 18, a padrão é a melhor no cluster 24 (onde o MGLRU ficou consistentemente sem memória) e o S3-FIFO iguala ou supera a base nos clusters 34 e 52, mas não as outras políticas do cache_ext.
- **Busca de arquivos.** O MRU é quase 2× mais rápido que a política padrão e o MGLRU.
- **GET-SCAN.** A política ciente da aplicação dá 70% mais throughput de GET e 57% menos latência P99 de GET, enquanto o throughput de SCAN cai 18%. As opções do `fadvise()` ajudam pouco, e o MGLRU vai pior que a padrão.
- **Filtro de admissão.** A latência P99 do RocksDB melhora 17% (de 2,61 ms para 2,16 ms), sem mudança significativa de throughput.
- **Isolamento.** Com LFU para o YCSB e MRU para a busca de arquivos em cgroups separados, o YCSB ganha 49,8% e a busca de arquivos 79,4% sobre a base. Uma única política global de LFU ou MRU ajuda a própria carga e prejudica bastante a outra.
- **Esforço e overhead.** O código eBPF varia de 35 linhas (filtro de admissão) a 689 (MGLRU), com 101 a 262 linhas de carregador em userspace. O registro custa de 0,4% a 1,2% da memória do cgroup. Uma política no-op acrescenta no máximo 1,7% de CPU por operação de I/O (0,72%, 1,66% e 0,17% com 5, 10 e 30 GiB), e o port do MGLRU tem em média 1% menos throughput (média harmônica de 0,99).

## Análise crítica

O artigo é aberto sobre vários limites. Ele admite o seguinte.

- **O isolamento é parcial.** Se a política do cgroup B remove uma página de que o cgroup A depende, A sofre, como no Linux original. Os autores argumentam que aplicações com padrões de acesso muito diferentes raramente compartilham os mesmos arquivos.
- **Privilégio e maturidade do eBPF.** Carregar exige root, e os autores só imaginam um carregador privilegiado como no sched_ext e no ghOSt. A checagem do registro, as listas no lado do kernel e a falta de ponto flutuante existem porque o eBPF ainda não consegue fazer essas coisas com segurança, e eles esperam que recursos novos do eBPF reduzam o overhead.
- **Escopo.** O estudo foca na evicção para acessos baseados em arquivo, e não para páginas mapeadas em memória. O prefetching fica para trabalhos como o FetchBPF, que, segundo os autores, poderia ser acrescentado como outro hook.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **Sem número de repetições nem dispersão.** O texto não traz número de repetições nem barras de erro. Diferenças como 13% em um cluster do Twitter, o ganho de 17% de latência no RocksDB ou o custo de 1% do MGLRU têm ruído desconhecido, e as razões por carga do port do MGLRU vão de 0,96 a 1,06.
- **Os pares são escolhidos por construção.** LFU em um benchmark Zipfian, MRU em scans repetidos e uma política GET-SCAN alimentada com os PIDs de uma carga desenhada pelos autores mostram a folga da interface, não que essas políticas se generalizam. Os traces do Twitter, em que o vencedor muda por cluster, são o resultado mais revelador, e os próprios autores tiram essa lição.
- **Sistemas relacionados não são comparados em benchmark.** O P2Cache e o PageFlex são comparados só em prosa, e nenhuma base com cache em userspace é executada, embora o artigo argumente contra caches em userspace. O único desenho em userspace medido é a estimativa com ring buffer e política no-op.
- **Testbed estreito.** Um tipo de máquina, um kernel e um SSD, com LevelDB, RocksDB e ripgrep como aplicações. PostgreSQL e MySQL são citados como usuários do page cache, mas não são testados. O teste de overhead de CPU usa 8 threads, então "escalável" é argumentado, não medido com muitos núcleos, e o isolamento é mostrado para um único par de cgroups.
- **A segurança é descrita, não submetida a estresse.** O fallback e o registro são explicados, mas nenhum experimento roda uma política com bug ou hostil, nem mede quanto um callback lento de `list_iterate` atrasa a evicção.
- **Os números divergem um pouco.** A introdução e o resumo dão até 38% (políticas genéricas) e 58% menos latência de cauda, enquanto o corpo dá 37% e 57%. O texto diz que as políticas precisam de "no máximo algumas centenas de linhas", mas o port do MGLRU tem 689 linhas de eBPF. Os 70% de destaque também vêm com a perda de 18% no SCAN.
- **A manutenção não é discutida.** O patch tem cerca de 2000 linhas no kernel contra a versão 6.6.8, apoiadas em kfuncs sem interface estável. O artigo nada diz sobre upstreaming ou sobre portar entre versões do kernel.

## Pesquisas futuras

- Políticas baseadas em ML e políticas mais ricas cientes da aplicação, que os autores apontam como próximo passo, junto com usar o conjunto aberto de políticas deles como bancada de testes para novas pesquisas de caching.
- Incorporar hooks de prefetching como o FetchBPF ao mesmo framework e usar o rastreamento de ponteiros confiáveis do eBPF para eliminar a checagem do registro e seu custo de memória.
- Avaliar políticas hostis ou com bugs, limitar o tempo que uma política pode gastar no caminho de evicção e dar proteção mais forte a páginas compartilhadas entre cgroups.
- Escolher a política por carga de forma automática, já que nenhuma vence em todos os traces do Twitter, e testar em cargas com mmap, máquinas com muitos núcleos e bancos como PostgreSQL.
