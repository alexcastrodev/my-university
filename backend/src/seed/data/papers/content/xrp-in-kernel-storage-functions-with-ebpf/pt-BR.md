---
title: "XRP: funções de armazenamento no kernel com eBPF"
summary: O XRP permite que uma aplicação registre uma função eBPF que o driver NVMe executa a cada leitura concluída, de modo que uma cadeia de leituras dependentes, como a travessia de uma árvore B, é reenviada de dentro do tratador de interrupção, sem atravessar a pilha de armazenamento do kernel nem voltar ao espaço de usuário.
researchArea: Sistemas operacionais
keywords: xrp, ebpf, nvme, pilha de armazenamento, resubmissão de E/S, kernel bypass, kernel linux
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Com o surgimento de dispositivos NVMe de armazenamento na escala de microssegundos, o custo da pilha de armazenamento do kernel Linux se tornou significativo, quase dobrando os tempos de acesso. Apresentamos o XRP, um framework que permite às aplicações executar funções de armazenamento definidas pelo usuário, como buscas em índices ou agregações, a partir de um hook eBPF no driver NVMe, contornando com segurança a maior parte da pilha de armazenamento do kernel. Para preservar a semântica do sistema de arquivos, o XRP propaga uma pequena quantidade de estado do kernel até o hook no driver NVMe, onde as funções eBPF registradas pelo usuário são chamadas. Mostramos como dois key-value stores, o BPF-KV, um store simples baseado em árvore B+, e o WiredTiger, um motor de armazenamento popular baseado em LSM tree, podem usar o XRP para melhorar de forma significativa a vazão e a latência.

## Visão geral

Em um Intel Optane P5800X, o artigo mede um `read()` aleatório de 512 B em 6,27 µs, dos quais 51,4% são do dispositivo e 48,6% de software: o ext4 custa 2006 ns (32,0%), a camada de bloco 379 ns, a travessia do kernel 351 ns, a syscall 199 ns e o driver NVMe 113 ns. Em dispositivos rápidos mais antigos, a fatia de software era de cerca de 15%. Uma busca em índice piora o quadro, porque cada nível de um índice B-tree ou LSM é uma leitura cujo resultado a aplicação só usa para calcular o próximo deslocamento, e então cada nível paga a pilha inteira.

Este artigo do OSDI 2022 (Carlsbad, julho de 2022), em sua maior parte da Columbia University, busca algo implantável em Linux comum, com ext4 e aplicações existentes. O kernel bypass com SPDK elimina o custo, mas obriga a ter um sistema de arquivos em espaço de usuário, abre mão de isolamento e exige polling, e os autores relatam uma perda de 3x de vazão quando há mais threads do que núcleos. O grupo de kernel bypass nos trabalhos relacionados cita o [Arrakis](/papers/arrakis-operating-system-is-the-control-plane), o [IX](/papers/ix-protected-dataplane-operating-system) e o [Demikernel](/papers/demikernel-datapath-os-for-microsecond-datacenter-systems) como sistemas que deixam o usuário falar direto com o dispositivo. O XRP faz o oposto: mantém o kernel no comando e leva para dentro dele um pedaço pequeno da lógica da aplicação, inspirado no XDP das redes.

O [io_uring](/papers/efficient-io-with-io-uring) não resolve, argumenta o artigo: ele agrupa submissões e economiza travessias, mas cada E/S ainda passa por todas as camadas, então é complementar. A Figura 3 mostra o hook no NVMe elevando a vazão do io_uring em até 1,5x com lotes pequenos e até 2,5x conforme os lotes crescem.

Termos para não confundir: resubmissão é emitir a próxima leitura de uma cadeia de dentro do kernel, o metadata digest é o pequeno estado do sistema de arquivos de que o driver precisa para traduzir deslocamentos, e o scratch é uma área de 4 KB por requisição, compartilhada entre a aplicação e a função eBPF.

Dois pareamentos meus, não do artigo. O [cache_ext](/papers/cache-ext-customizing-the-page-cache-with-ebpf) (SOSP 2025) divide dois autores com o XRP, Ioannis Zarkadas e Asaf Cidon, e estende o page cache com eBPF, a camada que o XRP deliberadamente não toca; a análise dele no catálogo não menciona o XRP. O [PeeR](/papers/peer-first-class-scheduling-for-latency-critical-ebpf-applications) (OSDI 2026) é literatura posterior, veja a Análise crítica.

## Contribuição

- **Um novo caminho de dados.** O hook fica no tratador de interrupção do NVMe, abaixo das camadas de syscall, sistema de arquivos e bloco. O experimento de motivação do artigo (Tabela 2, uma árvore B em disco de profundidade 10, tirado do artigo anterior dos autores no HotOS 2021) coloca a resubmissão na camada de syscall em 1,15x de latência e 1,2x de vazão, e no driver NVMe em 1,95x e 2,5x.
- **Um novo tipo de programa eBPF.** Programas `BPF_PROG_TYPE_XRP` recebem um contexto com `data` (o bloco recém-lido), `done`, `next_addr[16]` e `size[16]` (fanout de até 16, tamanho zero não emite E/S) e `scratch`. A aplicação chama `read_xrp()`, que é um `pread()` mais o descritor do programa e um ponteiro de scratch.
- **Reuso do caminho de despacho.** Na conclusão, o tratador chama a função, pede ao metadata digest a tradução do próximo endereço lógico, reescreve os endereços físicos no próprio `nvme_command` que acabou de completar e o coloca na fila de submissão do mesmo núcleo. Não há `kmalloc`. As mudanças no kernel somam cerca de 900 linhas, 500 no hook e no driver e 400 na tradução.
- **O metadata digest.** Duas funções: `update_mapping` (chamada pelo ext4 ao inserir ou remover extents) e `lookup_mapping` (chamada do tratador de interrupção). A versão para ext4 guarda uma cópia da extent status tree e usa RCU, com busca média de 96 ns. Um número de versão por extent é conferido de novo depois da leitura, e uma divergência aborta a cadeia. Isso também é o controle de acesso: um pedido fora do arquivo aberto volta ao espaço de usuário com erro.
- **Mudança no verifier.** `data` e `scratch` são `PTR_TO_MEM`, e `is_valid_access()` passa o tamanho deles ao verifier para checar limites. Os autores dizem que os mantenedores do eBPF acharam a mudança sensata.
- **Page cache e fallback.** O XRP não conversa com o page cache e pressupõe aplicações em `O_DIRECT` com cache próprio em espaço de usuário. É best effort: em qualquer falha, a aplicação tenta de novo ou cai para as syscalls normais.

## Metodologia

O hardware é um i5-8500 de 6 núcleos a 3 GHz com 16 GB de memória e um protótipo Intel Optane P5800X, Ubuntu 20.04 e Linux 5.12.0 (as medições da Seção 2 usam 5.8.0). Tudo roda com `O_DIRECT`, hyperthreading desligado, C-states e turbo boost desligados e KPTI ligado. As bases de comparação são XRP, SPDK, `read()` e io_uring.

O BPF-KV é um store feito sob medida, com índice B+ de nós de 512 B (fanout de 31) e um log não ordenado, chaves de 8 B e valores de 64 B, com funções BPF para busca, range queries e agregações (até 32 pares por syscall). Os testes de latência fazem um milhão de buscas aleatórias uniformes com cache desligado. O WiredTiger 4.4.0 (cerca de 500 linhas alteradas) roda YCSB com 1 bilhão de pares de 16 B (46 GB), caches de 512 MB a 4 GB, até 3 threads de cliente e páginas de 512 B. A função BPF dele porta o parser de páginas e devolve as páginas percorridas para que o WiredTiger as coloque no cache.

## Resultados

- **Latência de busca (Tabela 3).** Com 1 a 6 E/S de índice, o XRP leva de 10,7 a 29,3 µs, o `read()` de 13,4 a 48,8 µs, o io_uring de 13,6 a 49,3 µs e o SPDK de 5,2 a 20,2 µs. Cada nível extra soma de 3,5 a 3,9 µs no XRP, perto da latência do dispositivo. Com 6 níveis, o XRP é 45% mais lento que o SPDK e o `read()` é 142% mais lento.
- **Resultado principal do BPF-KV.** A introdução relata, com várias threads e índice de 3 níveis em disco, de 47% a 94% mais vazão e de 20% a 34% menos latência p99 que o `read()`. Com uma thread, p99 e p99,9 caem até 30% (laço fechado, então o XRP também roda com vazão maior). Leitura de gráfico da Figura 6a: a vazão com uma thread e profundidade 6 é cerca de 34 contra cerca de 20 kOps/s do `read()`.
- **Compartilhar núcleos.** A introdução dá p99 56% melhor que o SPDK com duas threads no mesmo núcleo. No teste de laço aberto, o XRP fica perto do limite do hardware quando as threads passam de 6 núcleos, enquanto o SPDK cai (leitura de gráfico da Figura 7a: cerca de 200 contra cerca de 680 kOps/s com 22 threads). Requisições de 1 ms ou mais são 0,03% no SPDK com 7 threads e 0,28% com 24, e menos de 0,01% nos demais.
- **Range queries.** Limitar a 32 objetos por syscall soma custo desprezível, e o ganho fica quase constante com o tamanho do intervalo (Figura 8).
- **WiredTiger.** O XRP acelera a maioria das cargas YCSB em até 1,25x e reduz o p99 em até 40%. Os ganhos diminuem com caches maiores e maior skew Zipfiano, e não são significativos em YCSB D e E. O WiredTiger gasta 63% do tempo em E/S, por isso o ganho é menor que no BPF-KV.

## Análise crítica

O próprio artigo declara estes limites.

- **Escopo.** Um arquivo por vez, estruturas de dados cujo layout fica estável por segundos ou mais, e nenhum suporte a operações que exigem locks. Só leituras são aceleradas; atualizações e inserções são absorvidas pelo buffer em memória do WiredTiger. Só o ext4 está implementado, e o f2fs aparece como esboço viável.
- **Onde o XRP não ajuda.** Leituras servidas pelo cache da aplicação, índices que cabem na DRAM e a primeira E/S de toda cadeia, que ainda atravessa a pilha inteira. Os scans do YCSB E ganham pouco porque o iterador lê um par por vez. Em `O_DIRECT`, o page cache fica fora do quadro.
- **Lacunas do protótipo.** Não há limite rígido de resubmissões (propõe-se um contador), uma requisição reenviada busca só tantos segmentos físicos quanto a primeira, e o escalonador de E/S é ignorado. As interrupções encadeadas pelo XRP podem esfomear um processo de CPU no mesmo núcleo, que no pior caso recebeu cerca de 34% de uma fatia justa, e os autores deixam isso em aberto.
- **Dispositivo local.** Tudo roda em um único dispositivo NVMe local; armazenamento em rede fica como trabalho futuro.

Minha leitura, não afirmações do artigo:

- **Uma máquina e um disco protótipo.** Não achei número de repetições nem barras de erro. A introdução diz "até 24%" para o WiredTiger enquanto a Seção 6.4 diz até 1,25x, e os 2,5x da lista de contribuições se parecem mais com o melhor caso da Tabela 2 do que com o texto do BPF-KV.
- **Store co-projetado.** O BPF-KV foi feito para o hook, e o colapso do SPDK vale para núcleos sobrecarregados, configuração que implantações de SPDK costumam evitar.
- **A segurança depende do digest.** Não achei experimento com função hostil nem com mudanças de extent concorrentes.
- **Literatura posterior, não lida por inteiro.** Li só as análises do catálogo. A do PeeR diz que o scan de blocos do XRP faz um laço de cerca de 100 instruções até 2.000 vezes sem chamar helper, o que limita a preempção, e que os autores dele não construíram o adaptador do XRP. A do cache_ext trata da política de evicção do page cache, a camada que o XRP deixa de lado.

## Pesquisas futuras

- Outras funções de armazenamento no mesmo hook: compactação, compressão e deduplicação, como os autores preveem.
- O XRP como interface comum para armazenamento programável ou offload em FPGA, e o encadeamento com XDP para contornar as pilhas de rede e de armazenamento.
- Outros sistemas de arquivos por meio de seu próprio metadata digest, um limite de resubmissões e uma solução para a interferência no escalonador.
- Cooperação com o page cache e com escritas, que o desenho deixa de fora.
