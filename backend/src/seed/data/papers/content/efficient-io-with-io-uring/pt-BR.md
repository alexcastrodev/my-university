---
title: "E/S eficiente com io_uring"
summary: A nota técnica de Axboe apresenta o io_uring, uma interface de E/S do Linux construída sobre dois anéis compartilhados com o kernel, um de submissão e um de conclusão, para que pedidos e resultados cruzem a fronteira sem cópias e com poucas chamadas de sistema.
researchArea: Sistemas operacionais
keywords: io_uring, E/S assíncrona, anéis compartilhados, kernel Linux, fila de submissão, fila de conclusão, sondagem no kernel, liburing
version: 1.0
updatedAt: 2026-11-19
---

## Visão geral

Isto não é artigo de conferência nem de periódico. É uma nota técnica publicada no site do autor (kernel.dk), que no PDF aparece como "Version: 0.4, 2019-10-15". O PDF não traz linha de autoria; a atribuição a Jens Axboe se apoia no site, no texto em primeira pessoa e no endereço `axboe@kernel.dk` numa referência. A nota foi postada pela primeira vez em abril de 2019, e uma nota posterior do mesmo site diz que o documento introdutório foi "atualizado algumas vezes". É um tutorial, não um estudo de medição, e avisa que não vai repetir as man pages.

O Linux tem muitas chamadas de E/S de arquivo, mas a família síncrona (`read`, `write`, `pread`, `pwrite`, `preadv`, `pwritev`, `preadv2`, `pwritev2`) só retorna quando o dado está pronto. O `aio_read` e o `aio_write` do POSIX são, nas palavras do autor, em geral medíocres e de desempenho ruim, e o `aio` nativo do Linux (`io_setup`, `io_submit`, `io_getevents`) tem três limites. É assíncrono só com `O_DIRECT`, cujo desvio do cache e cujas regras de tamanho e alinhamento o tornam inviável para a maioria dos usos. Mesmo assim a submissão pode bloquear (por metadados, ou quando os slots fixos de requisição do dispositivo estão ocupados), então as aplicações ainda precisam delegá-la a outras threads. E cada submissão copia 64 + 8 bytes e cada conclusão 32, ou seja, 104 bytes para uma E/S supostamente sem cópia, com ao menos duas chamadas de sistema por E/S, "uma lentidão séria" depois do Spectre e do Meltdown.

Os artigos de kernel-bypass do catálogo atacam o mesmo custo por outro lado: [Arrakis](/papers/arrakis-operating-system-is-the-control-plane), [IX](/papers/ix-protected-dataplane-operating-system) e [Demikernel](/papers/demikernel-datapath-os-for-microsecond-datacenter-systems) tiram o kernel do caminho de dados, enquanto o io_uring mantém o kernel e barateia a travessia. A nota também dialoga com [Eliminating Receive Livelock](/papers/eliminating-receive-livelock-in-an-interrupt-driven-kernel), porque seus modos de sondagem trocam interrupções por polling em taxas altas.

Vale saber antes: filas circulares com um produtor e um consumidor, barreiras de memória, `mmap` de memória compartilhada e `O_DIRECT` versus E/S com buffer.

## Contribuição

- **Por que uma interface nova.** O autor tentou primeiro estender o `aio`, achou o resultado complexo e corrigindo só uma falha, e recomeçou do zero. Objetivos, em ordem crescente de importância: fácil de usar e difícil de usar errado, extensível além de E/S de bloco, rica em recursos (sem pools de threads de E/S privados), eficiente, escalável.
- **Dois anéis compartilhados.** Uma fila de submissão (SQ), em que a aplicação produz e o kernel consome, e uma fila de conclusão (CQ), com os papéis invertidos. O compartilhamento elimina cópias e travas compartilhadas, usando ordenação de memória no lugar de chamadas de sistema.
- **Entradas.** Um evento da fila de conclusão (CQE) tem `user_data`, `res` e `flags`. Uma entrada da fila de submissão (SQE) tem 64 bytes: `opcode`, `flags`, `ioprio`, `fd`, `off`, `addr`, `len`, uma união específica do opcode, `user_data` e `buf_index`. O kernel não toca no `user_data`, que é copiado para o CQE, normalmente como o ponteiro do pedido. O anel SQ guarda índices para um array de SQEs separado.
- **Três chamadas de sistema.** `io_uring_setup` devolve um descritor de arquivo e os deslocamentos para o `mmap` do anel SQ, do anel CQ e do array de SQEs. `io_uring_enter` submete e, na mesma chamada, espera conclusões. `io_uring_register` pré-registra arquivos e buffers.
- **Recursos opcionais.** SQEs encadeadas e com drenagem, timeouts, arquivos e buffers fixos, E/S por sondagem (`IORING_SETUP_IOPOLL`) e sondagem de submissão no kernel (`IORING_SETUP_SQPOLL`), além da biblioteca auxiliar `liburing`.

## Metodologia

Não há método experimental no sentido usual. A nota explica o desenho com definições de structs e trechos em C, trata de ordenação de memória, mostra código com `liburing` e termina com uma seção curta de desempenho que remete a uma postagem de série de patches (a referência [1] do texto) para os detalhes. Cita o motor `io_uring` do `fio` e o benchmark `t/io_uring.c`, de leituras aleatórias, como exemplos para estudar. Os números de desempenho vêm em prosa: o PDF não tem tabela nem figura e não dá o hardware nem a carga além de "my test box", "my laptop" e leituras aleatórias do dispositivo de bloco ou de um arquivo.

## Resultados

Mecânica que o texto afirma:

- **Anéis.** Os contadores são inteiros de 32 bits que dão a volta, então o anel inteiro é utilizável sem flag de "cheio" e seu tamanho precisa ser potência de 2. `entries` é uma potência de 2 de 1 a 4096, e o anel CQ tem por padrão o dobro do SQ. Uma SQE pode ser reutilizada assim que o kernel a consome, então os pedidos pendentes podem passar do tamanho do SQ, e a aplicação deve evitar estourar o anel CQ.
- **Ordem.** As conclusões podem chegar em qualquer ordem. `IOSQE_IO_DRAIN` trava o SQ inteiro até os pedidos anteriores terminarem. `IOSQE_IO_LINK` faz a SQE seguinte começar só depois que a anterior termina com sucesso completo; um erro ou uma leitura ou escrita curta cancela o resto com `-ECANCELED`. Cadeias de qualquer tamanho rodam de forma independente entre si.
- **Recursos registrados.** `IORING_REGISTER_FILES` evita pegar e soltar uma referência atômica ao arquivo a cada pedido. `IORING_REGISTER_BUFFERS` mapeia as páginas uma vez para `O_DIRECT`, usado com `IORING_OP_READ_FIXED` e `IORING_OP_WRITE_FIXED`.
- **Sondagem.** Com `IOPOLL`, as conclusões são achadas chamando `io_uring_enter` com `IORING_ENTER_GETEVENTS`, só opcodes de leitura e escrita são válidos (os demais dão `-EINVAL`), e a cauda do CQ sozinha deixa de sinalizar conclusão. Com `SQPOLL`, uma thread do kernel percebe novas SQEs sem chamada a `io_uring_enter`; ela dorme após um período ocioso (1 segundo por padrão), marca `IORING_SQ_NEED_WAKEUP`, e a aplicação precisa então acordá-la. O `SQPOLL` é privilegiado (`-EPERM` sem privilégio).
- **Rede.** Sockets funcionam sem cuidado especial e a interface pretende cobrir rede, mas a nota não descreve opcodes de rede. A única pista é o `msg_flags` na união da SQE.

Números que o texto traz, todos em prosa (não foi preciso ler gráfico):

- Leituras aleatórias de 4 KB: 1,7M IOPS com sondagem, contra um precipício em 608K do `aio`. Sem sondagem o io_uring leva cerca de 1,2M IOPS, perto do dobro do `aio` na mesma carga (o autor diz que a comparação com sondagem não é justa, pois o `aio` não sonda). Uma observação diz que trabalho posterior na camada de bloco levou o pico por núcleo a cerca de 1700K, "e não 1620K".
- O comando no-op: 12M mensagens por segundo no notebook, 20M na máquina de teste, limitado sobretudo pelas chamadas de sistema.
- E/S com buffer: a nota não dá número. Argumenta que dado já no cache de páginas é servido na hora, então já há uma conclusão esperando no anel CQ quando a submissão retorna, com a mesma eficiência das chamadas síncronas comuns.

## Análise crítica

A nota é o relato do próprio autor sobre o seu desenho, não um estudo revisado por pares.

- **Sem latência e sem tabelas.** Apesar da seção de desempenho, o texto não tem números de latência, nem arquivo de job do `fio`, nem descrição de hardware, nem comparação para E/S com buffer ou de rede. Ele remete a "os números da seção acima", que o PDF não contém. Trate 1,7M, 608K, 1,2M e 12M a 20M como valores relatados pelo autor, não como resultados reproduzíveis.
- **A comparação com o `aio` é parcial.** O autor admite que a comparação com sondagem não é justa; o dobro sem sondagem é o número melhor, e ainda assim vem de uma máquina e uma carga.
- **Segurança não é discutida.** A única frase próxima do tema é que o `SQPOLL` exige privilégio. Compartilhar memória com o kernel e a quantidade de opcodes que o kernel precisa tratar não são examinados.
- **A afirmação sobre o cache de páginas não tem medição.** O texto argumenta que servir na hora deixa o io_uring tão eficiente quanto as chamadas síncronas para dado em cache, e melhor que um pool de threads, sem número.
- **Um retrato do momento.** O texto ainda diz que um kernel com a interface "is in the -rc stages", embora a linha de versão seja de outubro de 2019 (a nota posterior diz que o v5.1 já tinha saído). Ele também é anterior ao crescimento seguinte: a nota posterior do mesmo site (que li) diz que E/S de socket era no início só `readv` e `writev`, e acrescenta `sendmsg`, `recvmsg` e `accept`.

Literatura posterior, que não faz parte da nota de 2019. A postagem "Learnings from kCTF VRP's 42 Linux kernel exploits submissions" do Google Online Security Blog (Tamás Koczka, junho de 2023), que li, relata que 60% das submissões do kCTF no último ano exploraram o io_uring, e que o Google o desabilitou no ChromeOS e nos servidores de produção, o bloqueia para apps Android com seccomp-bpf e estudava desabilitá-lo por padrão no GKE Autopilot. É o relato de um fornecedor, não um artigo. Não li o artigo do XRP, nem o texto do Demikernel sobre io_uring, nem política alguma de runtime de contêiner, então nada afirmo sobre eles aqui. As notas do catálogo sobre [Rakaia](/papers/rakaia-in-kernel-scheduling-for-tcp-rpcs) e [Skyloft](/papers/skyloft-general-scheduling-framework-in-user-space) citam o io_uring só como trabalho futuro ou proposta.

## Pesquisas futuras

- Qual dos custos da interface (chamadas de sistema, cópias, referências a arquivos, mapeamento de páginas, interrupções) pesa mais em cada latência de dispositivo, medido em hardware público.
- Como o io_uring se compara a uma pilha kernel-bypass como [Demikernel](/papers/demikernel-datapath-os-for-microsecond-datacenter-systems) ou [IX](/papers/ix-protected-dataplane-operating-system) em rede, com a mesma carga.
- O caminho do cache de páginas contra pools de threads, o que também toca trabalhos de política de cache como o [cache_ext](/papers/cache-ext-customizing-the-page-cache-with-ebpf).
- A superfície de ataque de anéis compartilhados e de uma lista crescente de opcodes, e como isolá-la, com fontes além da única postagem citada aqui.
