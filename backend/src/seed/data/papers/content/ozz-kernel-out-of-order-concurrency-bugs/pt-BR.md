---
title: "OZZ: identificando bugs de concorrência por execução fora de ordem no kernel com reordenação de acessos à memória in-vivo"
summary: O OZZ emula a reordenação de stores e loads dentro de um kernel Linux em execução e faz fuzzing de pares de system calls supondo que uma barreira de memória está ausente, de modo que bugs de ordenação que normalmente exigem hardware da classe ARM podem ser achados em máquinas x86-64 comuns.
researchArea: Sistemas operacionais
keywords: barreiras de memória, execução fora de ordem, fuzzing de kernel, bugs de concorrência, memória fraca, lkmm, syzkaller
version: 1.0
updatedAt: 2026-11-07
---

## Visão geral

Os desenvolvedores de kernel recorrem a técnicas sem lock, como RCU, contadores de referência e estruturas lock-free, e com elas vêm as barreiras de memória: instruções que impedem o processador de reordenar acessos à memória que precisam permanecer em ordem. Uma barreira ausente ou mal posicionada gera um bug de execução fora de ordem (OoO), que só aparece quando dois eventos não determinísticos coincidem: o intercalamento de threads e a reordenação feita pelo processador. Os autores citam negação de serviço, travamentos, perda de dados e corrupção de memória como consequências. CPUs de memória fraca, como o Apple Silicon, reordenam stores com stores e loads com loads, enquanto o x86-64 não, então esses bugs se escondem principalmente nas máquinas x86-64 onde roda a maior parte do fuzzing de kernel.

O exemplo corrente do artigo (Figura 1) é um ring buffer do Linux no código de notificações. Uma thread preenche uma entrada e depois incrementa `head`, e o leitor verifica `head > tail` e depois lê a entrada. Sem uma barreira de escrita de um lado e uma barreira de leitura do outro, o leitor pode ver o novo `head` junto com um `buf->ops` não inicializado. O artigo simplifica a correção real, que usou operações de release e acquire.

Este artigo do SOSP 2024 (o 30º ACM Symposium on Operating Systems Principles, em Austin) vem do Georgia Tech, do KAIST, da Seoul National University e da Fluiz. Ele pergunta como testar bugs OoO de forma sistemática quando a reordenação acontece dentro do processador, onde nenhum breakpoint alcança.

Termos importantes: OEMU é a emulação in-vivo de execução fora de ordem, compilada dentro do kernel. OZZ é o fuzzer construído sobre o OEMU e sobre o Syzkaller. O teste da barreira de memória hipotética assume que uma barreira não existe e força a ordem que ela proibiria. LKMM é o Linux Kernel Memory Model.

Vale conhecer antes: a API de barreiras do Linux (`smp_wmb`, `smp_rmb`, acquire e release), o LKMM e o funcionamento de um fuzzer de kernel guiado por cobertura como o Syzkaller. Para outro caminho até testes repetíveis no kernel, veja o [kSTEP](/papers/kstep-deterministic-testing-of-linux-cpu-scheduler-bugs), que torna determinístico o comportamento do scheduler. É um artigo do OSDI 2026 que o OZZ não tem como citar, e o pareamento é meu.

## Contribuição

- **Emulação in-vivo.** Um pass do LLVM troca cada acesso à memória do kernel por um callback (`store_value`, `load_value`, Figura 2). Os callbacks rodam na ordem do programa, mas consultam o OEMU sobre quando um store se torna visível e qual valor um load retorna. As ferramentas "in-vitro" anteriores registram os acessos e os analisam offline, e por isso perdem o contexto de execução do kernel, como objetos liberados ou locks mantidos. O OEMU preserva esse contexto, então o KASAN, o lockdep e as assertions do kernel funcionam como oráculos de bugs.
- **Stores atrasados e loads versionados.** Cada thread tem um store buffer virtual. Os stores são efetivados na hora por padrão, e o userspace pode pedir o atraso de uma instrução por meio de uma system call própria (`delay_store_at`). Os stores atrasados são descarregados em uma barreira de store, completa ou de release, ou numa interrupção, e os loads seguintes da mesma thread leem do buffer. Isso emula a reordenação store-store e store-load. Para a reordenação load-load, um histórico global de stores guarda cada valor sobrescrito com um timestamp, e `read_old_value_at` permite que um load retorne um valor antigo. Uma janela de versionamento, da última barreira de load, completa ou de acquire até agora, impede que um load leia algo mais antigo que essa barreira.
- **Conformidade com o LKMM e escopo.** O OEMU segue as cinco regras de barreira e as duas regras de dependência do modelo, e trata `READ_ONCE` e as leituras atômicas como barreiras de load, porque o LKMM permite reordenar loads mesmo com dependência de endereço (uma herança do Alpha). A reordenação load-store fica de fora, pois os autores citam que só duas implementações antigas do ARMv8 a fazem e nenhum hardware Power a faz.
- **Teste da barreira de memória hipotética.** Para duas system calls, o OZZ assume que uma barreira falta em alguma posição e executa os acessos na ordem que ela proibiria. Para stores, ele atrasa os stores anteriores à posição, intercala logo antes da barreira real e deixa a outra thread ler. Para loads, ele primeiro executa a outra thread para montar o histórico de stores, e depois reordena o primeiro load de um grupo com os loads seguintes: o primeiro lê o valor atualizado e os demais leem valores antigos. O relatório aponta a posição da barreira ausente, mas não qual tipo de barreira corrige o bug, já que um `smp_mb()` esconderia o bug a um custo desnecessário.
- **Pipeline.** As entradas de thread única saem de templates em Syzlang, com cobertura do KCov e um perfil de todos os acessos e barreiras. Para cada par de chamadas, o Algoritmo 1 mantém só os acessos a posições compartilhadas, agrupa por barreira e move a barreira hipotética uma instrução por vez, ordenando as dicas pelo número de acessos que reordenam. O ponto de intercalamento vai para um scheduler customizado no QEMU, que usa breakpoints e vCPUs suspensas, e a reordenação vai para o OEMU.
- **Tamanho e disponibilidade.** O pass do LLVM 12.0.1 tem 834 linhas de C++ e os callbacks do kernel 1.797 linhas de C. O OZZ acrescenta ao Syzkaller 7.694 linhas de Go e 913 de C++, e o scheduler tem 2.167 linhas de C no QEMU. O código é público em github.com/casys-kaist/ozz.

## Metodologia

A avaliação tem quatro partes: achar bugs desconhecidos, reproduzir bugs conhecidos, medir o overhead e comparar com o OFence. O ambiente é uma máquina de dois sockets com Xeon E5-2683 v4 (32 cores físicos, 512 GB), com host em Linux 5.4.143 e um KVM modificado que aceita hypercalls do userspace. Os autores rodam 32 VMs com quatro vCPUs e 8 GB cada, usando as configurações de kernel e as sementes do Syzkaller, em kernels de 6.5-rc6 a 6.8, por seis semanas. Eles triam os crashes à mão para achar os causados por reordenação.

Não existe um benchmark público de bugs OoO, então os autores montaram um. Eles filtraram o histórico git do Linux com palavras-chave como "missing.*barrier" e "reordering", inspecionaram os patches à mão e mantiveram aqueles cuja posição de barreira o dashboard público do Syzkaller mostra como alcançável. Reverteram cada patch e entregaram ao OZZ, como entradas de thread única, as system calls do dashboard, o que resultou em nove bugs. O overhead vem do LMBench em kernels com e sem OEMU (média de cinco execuções) e do throughput de fuzzing contra o Syzkaller em um kernel separado, sem OEMU. Para o OFence, uma ferramenta estática que casa padrões de barreiras pareadas, eles reuniram patches creditados aos autores dele por tags Reported-by e contaram quais bugs do OZZ ficam fora de seus padrões.

## Resultados

Estes são os resultados relatados pelos autores.

- **Bugs novos.** O OZZ produziu 61 títulos de crash únicos, incluindo alguns que o Syzkaller também acha, e 11 foram identificados como bugs OoO. Eles estão em RDS, watchqueue, VMCI, XDP (dois), TLS (dois), BPF, SMC (dois) e GSM. A Tabela 3 lista 6 como Fixed, 3 como Confirmed e 2 como Reported.
- **Caso do TLS.** O `tls_init` grava `ctx->sk_proto` e depois troca `sk->sk_prot`, sem barreira de store entre os dois, então um `setsockopt` concorrente pode cair em um ponteiro NULL. Os desenvolvedores já tinham notado uma data race em `sk_prot` e adicionado `READ_ONCE` e `WRITE_ONCE`, que silenciam o detector de races mas não ordenam os demais acessos, então o bug sobreviveu a esse patch.
- **Caso do lock do RDS.** Um try-lock feito à mão libera com `clear_bit`, que não ordena os acessos anteriores, então a seção crítica pode vazar para depois da liberação. A correção é `clear_bit_unlock`. O lock não tem data race, então os detectores de race não o pegam, enquanto o OZZ reordena acessos dentro da seção crítica.
- **Bugs conhecidos.** O OEMU reproduziu 8 de 9 (cinco por reordenação store-store e três por load-load), após 12 a 342 testes por bug, o que os autores resumem como dezenas de execuções em média. Um caso (um bug do TLS) executou a reordenação do bug, mas retornou um valor errado em vez de derrubar o sistema. A falha é um bug do sbitmap que exige que uma thread migre entre CPUs, o que o OZZ impede ao fixar as threads. Depois de uma alteração manual no kernel, ele reproduziu.
- **Heurística de busca.** Dos 19 bugs do conjunto de avaliação, 11 foram disparados pela dica que reordena mais acessos e 6 pela segunda maior.
- **Overhead.** As lentidões no LMBench vão de 3,0x (troca de contexto) a 59,0x (mmap), com 24,9x na chamada nula (1,74 para 43,3 µs) e 19,2x no fork. O throughput de fuzzing é de 0,92 teste por segundo contra 7,33 do Syzkaller, 7,9x menor, o que os autores atribuem a cópias no userspace e a operações no hypervisor.
- **Comparações.** Todos os patches do OFence caíram em submódulos para os quais o OZZ não consegue gerar entradas, como os que dependem de hardware, então não foi possível um confronto direto. No sentido contrário, os autores avaliam que 8 dos 11 bugs do OZZ dificilmente seriam detectados pelos padrões do OFence. Contra o KCSAN, eles argumentam que o OZZ reordena vários acessos, entre fronteiras de função, de forma determinística. Um exemplo sintético em Rust com `Ordering::Relaxed` dispara sua assertion.

## Análise crítica

O artigo é franco sobre os limites do método. Ele admite o seguinte.

- **Casos cobertos.** A reordenação load-store fica de fora, e só uma barreira hipotética é testada por vez, então bugs que exigem reordenação entre duas ou mais threads ficam fora de alcance. Os autores não toparam com esses bugs e acham que são raros. Barreiras redundantes (bugs de desempenho) também não são cobertas, e o tipo exato de barreira fica a cargo dos desenvolvedores.
- **Custo e alcance.** O overhead é pesado, e drivers que precisam de hardware real são difíceis de testar. A falha do sbitmap mostra um comportamento (a migração) que o esquema de fixação de threads não reproduz. Bugs OoO do lado do hardware, como um patch de RDMA que os autores encontraram, exigiriam saber quais instruções são compartilhadas com um dispositivo.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **Resumo versus tabela.** O resumo e a introdução dizem que os bugs foram confirmados e corrigidos, mas a Tabela 3 marca só 6 como Fixed, 3 como Confirmed e 2 como Reported. Vale confiar nos números do corpo do texto.
- **Base de comparação não medida.** A afirmação de que o Syzkaller em x86-64 perderia esses bugs se apoia em raciocínio sobre a arquitetura (o texto cita uma coluna "Type" que a Tabela 3 não tem, então o tipo de reordenação de cada bug novo não é informado). Nenhuma execução do Syzkaller de mesma duração é relatada, e os 61 títulos de crash incluem alguns que o Syzkaller também acha.
- **Triagem manual.** Onze dos 61 crashes foram atribuídos à reordenação à mão, sem critérios declarados, e nada se diz sobre os outros 50. Não há taxa de falsos positivos, e nenhuma reprodução em hardware ARM real é relatada. A aceitação pelos mantenedores é a validação dos bugs confirmados e corrigidos.
- **Um benchmark montado pelos próprios autores.** Só foram mantidos bugs cuja barreira o Syzkaller já alcança, e as entradas vieram do dashboard dele, então o teste mede o controle da reordenação, não a geração de entradas. Nove bugs é uma amostra pequena. As contagens da tabela dão média de cerca de 65 testes por bug reproduzido (conta minha), puxada pelos 342 de um deles, então "dezenas" subestima.
- **Evidência da heurística.** O conjunto de 19 não é definido no texto, embora 8 reproduzidos mais 11 novos deem 19 (inferência minha). A heurística é validada nos mesmos bugs usados para avaliar a ferramenta, e os dois números cobrem 17 dos 19, então os outros dois precisaram de dicas de ranking mais baixo.
- **O OFence é um julgamento, não uma execução.** Os autores não conseguiram o código do OFence, então "8 de 11 dificilmente detectáveis" é a leitura deles dos padrões da ferramenta, e o teste no sentido inverso não achou bugs sobrepostos que o OZZ conseguisse testar. A comparação mostra escopos diferentes mais do que força relativa.
- **Argumento de custo.** A proposta é que o OZZ evita comprar frotas ARM, mas nenhuma comparação de custo é feita diante de uma perda de throughput de 7,9x. O ambiente roda 128 vCPUs em 32 cores físicos, sem discussão do efeito. O LMBench não traz variância, e a instrumentação seletiva é proposta, mas não avaliada.
- **O Rust é sintético.** Só um exemplo escrito à mão é testado, não um módulo de kernel real em Rust.

## Pesquisas futuras

- Reordenação load-store, reordenação com várias barreiras ou entre threads e detecção de barreiras redundantes, todas citadas pelos autores como trabalho futuro.
- Fuzzing de drivers junto com o hardware, o que exige um meio de saber quais instruções são compartilhadas com um dispositivo.
- Reduzir o overhead do OEMU, por exemplo instrumentando só os submódulos lockless como os autores sugerem, e medir quantos bugs isso custa.
- Inferir a barreira mais fraca que corrige um bug, e verificar os bugs relatados em máquinas ARM reais e em módulos reais em Rust.
