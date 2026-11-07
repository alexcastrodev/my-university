---
title: "CortenMM: gerenciamento de memória eficiente com fortes garantias de corretude"
summary: O CortenMM elimina a árvore de VMAs que normalmente fica acima da tabela de páginas e programa a MMU diretamente por uma interface transacional com dois protocolos de locking, o que escala até 384 cores e mantém o código de concorrência central pequeno o bastante para ser verificado com o Verus.
researchArea: Sistemas operacionais
keywords: gerenciamento de memória, memória virtual, tabelas de páginas, verificação formal, protocolos de locking, rust, escalabilidade
version: 1.0
updatedAt: 2026-11-07
---

## Visão geral

O subsistema de gerenciamento de memória (MM) de um SO programa a MMU (tabelas de páginas e TLBs) e precisa atender muitas threads ao mesmo tempo. No Linux e na maioria dos outros sistemas, ele se apoia em dois níveis de abstração: um nível de software, como a árvore de áreas de memória virtual (VMAs, uma maple tree no Linux atual), e o nível de hardware, as tabelas de páginas. Os autores atribuem dois problemas antigos a esse par, que remonta ao SunOS em 1986. Manter duas estruturas muito diferentes sincronizadas exige um locking complexo, que limita a escalabilidade e gera bugs de concorrência. Eles contam dez CVEs vindos do locking por VMA que o Linux introduziu em abril de 2023, e nove deles podem derrubar o sistema.

Este artigo do SOSP 2025 (Seul), da Peking University, Ant Group, CertiK, UCLA e Michigan Tech (alguns autores também são afiliados ao Zhongguancun Laboratory), apresenta o CortenMM, o MM do Asterinas, um SO em Rust que o grupo constrói como substituto compatível com o Linux. A aposta é que as ISAs principais (x86, ARM, RISC-V) usam todas tabelas de páginas radix de vários níveis, então o nível de software deixou de ser necessário.

Termos para não confundir: uma PT page é uma página da tabela de páginas; a PT page de cobertura (covering PT page) é a mais baixa cujo intervalo contém toda a região travada; um `RCursor` é o handle que uma transação usa; CortenMM-rw e CortenMM-adv são os dois protocolos de locking, um com readers-writer locks e outro com travessia sem locks usando RCU.

Vale conhecer antes: tabelas de páginas radix e o caminho de page fault do Linux, o que é uma VMA, RCU e two-phase locking. O [RustBelt](/papers/rustbelt-securing-foundations-of-rust) é o artigo da biblioteca sobre por que o Rust seguro elimina data races e o que o código unsafe precisa garantir. O CortenMM não o cita, mas proibir código unsafe fora do seu núcleo pequeno depende desse tipo de garantia.

## Contribuição

- **Um nível em vez de dois.** Cada PT page ganha um descritor de página, indexado pelo seu número de página física, com um lock, a PT page e um array de metadados por PTE, alocado sob demanda e liberado junto com a PT page. O array guarda o que o hardware não guarda: se a página é inválida, alocada virtualmente, mapeada ou em swap, além de permissões ou do dispositivo e deslocamento do swap. As diferenças entre ISAs são escondidas com traits do Rust, como o Linux as esconde com macros de C.
- **Uma interface transacional.** `AddrSpace::lock(range)` devolve um `RCursor` com `query`, `map`, `mark` e `unmap`, aplicados atomicamente e liberados no drop. Transações em intervalos que se sobrepõem são serializadas, e as disjuntas rodam em paralelo. O `mmap` é lock, query, mark. O tratador de page fault, inclusive o copy-on-write, roda inteiro sob um único cursor.
- **Dois protocolos de locking.** O CortenMM-rw desce da raiz pegando reader locks e depois pega o write lock da PT page de cobertura. O CortenMM-adv percorre a árvore sem locks dentro de uma seção crítica de leitura do RCU, pega o spin lock da PT page de cobertura e depois trava todos os descendentes por busca em profundidade. Para remover uma PT page, ele limpa a entrada do pai atomicamente, marca a página como stale e a libera por meio de um "RCU monitor". Uma thread que trava uma página stale tenta de novo. Os dois lembram o two-phase locking.
- **Verificação.** Com o Verus, os autores provam duas propriedades: exclusão mútua dos dois protocolos e correção funcional das quatro operações do `RCursor`, junto com uma árvore de tabela de páginas bem formada. A prova é uma hierarquia de refinamento de especificações (Atomic Spec, Atomic Tree Spec, WF Tree Spec) construída sobre uma máquina de estados tokenizada e simulação direta (forward simulation). O código fora desse núcleo precisa ser Rust seguro (`#![deny(unsafe_code)]`), então não consegue contornar a interface.
- **Base confiável e tamanho.** Os autores confiam no hardware, no Verus e em seu solver SMT, e no resto do SO (alocador de páginas físicas, código de DMA, primitivas de lock e RCU). O código tem 8.028 linhas de Rust seguro e 122 de unsafe, e a interface central tem 829 linhas (225 para o CortenMM-adv, 153 para o CortenMM-rw). As otimizações emprestadas de trabalhos anteriores incluem alocadores de endereço virtual por core e TLB shootdowns mais baratos (flushes em paralelo, confirmação antecipada, shootdown preguiçoso no `munmap`).

## Metodologia

A máquina é um AMD EPYC 9965 de dois sockets, com 384 cores e 1TB de DRAM, com hyper-threading e turbo desligados, rodando dentro de uma máquina virtual porque o SO dos autores (como o RadixVM e o NrOS) não tem drivers para inicializar nela diretamente. As bases de comparação são o Linux 6.13.8 com mitigações como o KPTI desligadas, o RadixVM e o NrOS, e tanto o Linux quanto o CortenMM rodam um userland Ubuntu 22.04.

Cinco microbenchmarks (`mmap`, `mmap-PF`, `unmap-virt`, `unmap`, `PF`) fazem cada thread repetir uma operação em uma região de 16KB, com uma thread ou até 384, com baixa contenção (região privada) ou alta contenção (região aleatória dentro de uma grande região compartilhada). As cargas reais são o PARSEC 3.0, o metis e o psearchy (ambos do MOSBENCH), a criação de threads na JVM com OpenJDK 21.0.6, que imita a inicialização de apps no Android, e o LMbench para `fork`. O dedup e o psearchy rodam com o alocador padrão e com o tcmalloc, já que alocadores modernos escondem o gargalo do Linux ao devolver memória raramente. Os autores também relatam um detalhamento de tempo com perf, uma ablação das duas otimizações, o overhead de memória no metis, o esforço de verificação e um port para RISC-V.

## Resultados

Estes são os resultados relatados pelos autores.

- **Uma thread.** O CortenMM-adv vence o Linux em quatro dos cinco microbenchmarks, de 7,8% a 46,8% segundo o texto, e perde 3,1% no `mmap`, porque alocar e inicializar PT pages custa mais que inicializar uma VMA. O `unmap-virt` o favorece porque o Linux precisa dividir nós da árvore de VMAs. O `fork` é 17,7% mais lento, já que o CortenMM precisa percorrer as tabelas de páginas para enumerar o espaço de endereços, enquanto `fork` mais `exec` é 23,0% mais rápido.
- **Escalabilidade com 384 cores.** Com baixa contenção, o CortenMM-adv escala quase linearmente e supera o Linux em 33× (PF) a 2270× (`unmap-virt`). Com alta contenção, ele para de escalar depois de 64 threads por causa da PT page do último nível, mas ainda vence por 3× (PF) a 1489× (`unmap`). O CortenMM-rw vence por 5,9× (`mmap-PF`) a 275× (`unmap`) sob alta contenção, mas o texto diz que o Linux fica 1,8× à frente no PF. O RadixVM supera o CortenMM-adv no PF com alta contenção graças às tabelas de páginas por core, ao custo de memória, e o NrOS fica perto do Linux.
- **Aplicações.** A criação de threads na JVM é 32% mais rápida que no Linux nos dois protocolos. O metis é 26× mais rápido com o CortenMM-adv (15× com o CortenMM-rw) e 1,24× mais rápido que o RadixVM com 128 cores, e o RadixVM trava além disso. O dedup com o alocador padrão ganha 2,69× com 64 threads, e o psearchy cerca de 2×. Com o tcmalloc o Linux melhora, mas continua atrás no psearchy, e os autores observam que o tcmalloc custa cerca de 2× de memória ali. Os programas do PARSEC que não estressam o MM não sofrem lentidão.
- **Overhead de memória.** O CortenMM e o Linux são parecidos no metis. O limite superior teórico, com todos os arrays de metadados totalmente preenchidos, dobra o overhead, mas fica dentro de 2%.
- **Esforço de verificação.** A Tabela 4 lista 4.868 linhas de especificações, 4.279 de prova e 1.769 de implementação, uma razão prova-código de 5,2:1. Levou cerca de 8 pessoas-mês, e o Verus confere tudo em menos de 20 segundos.
- **Portabilidade.** As linhas extras necessárias além do x86 são 252 para RISC-V, 82 para Intel MPK e 368 para Intel TDX, contra 699, 273 e 471 no Linux. Em uma VM RISC-V, as diferenças em relação ao Linux se parecem com as do x86.

## Análise crítica

O artigo é aberto sobre os limites da abordagem. Ele admite o seguinte.

- **Só tabelas de páginas radix.** O desenho não se aplica a MMUs que não sejam árvores radix de vários níveis, e o locking explora a estrutura da tabela de páginas. Adaptar o Linux exigiria abandonar essas ISAs, além de bastante trabalho de engenharia.
- **Prova com escopo limitado.** Só o código que programa a MMU é verificado. Hardware, Verus, alocadores e primitivas de lock e RCU são confiáveis, a página física que guarda uma tabela de páginas é modelada como um array linear sem modelo de máquina, e o modelo de memória é sequencial, então a memória relaxada do ARM fica para as técnicas do VRM. O código verificado é um port para Verus mantido separado do kernel, porque o kernel precisa do Rust nightly, e os autores dizem garantir que ele corresponde à implementação.
- **Lacunas e caminhos lentos.** Ainda não há políticas de NUMA nem port para ARM. `mmap`, `fork` e cargas de alta contenção ficam mais lentos ou param de escalar, como mostrado acima.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **"Verificado" é mais estreito do que o resumo sugere.** As propriedades P1 e P2 cobrem o locking e as quatro operações do `RCursor`. As decisões de copy-on-write, a lógica de swap e de arquivos mapeados, o reverse mapping e o TLB shootdown ficam acima ou ao lado desse núcleo, e o artigo não lista nenhuma propriedade sobre coerência de TLB.
- **O código verificado não é o código entregue.** A Tabela 4 conta 1.769 linhas de implementação, enquanto o texto conta 829 para a interface central do kernel. A Tabela 4 também conta componentes como MM Common e Glue/Helper, o que pode explicar parte da diferença, mas o artigo não reconcilia os dois números, e a equivalência é feita à mão, não por ferramenta.
- **Uma comparação entre SOs dentro de uma VM.** O CortenMM roda no Asterinas e a base de comparação é o Linux, então diferenças além do MM podem contribuir, e os detalhamentos de perf mostram para onde vai o tempo de kernel por operação sem isolar o desenho do MM do resto do SO. A afirmação de que a VM não afeta os resultados é apenas declarada, sem rodada em hardware real, embora o nested paging mude o custo dos page faults.
- **A faixa de destaque é um espalhamento de casos.** O resumo diz de 1,2× a 26×. O corpo traz 32% (JVM, ou seja, 1,32×), cerca de 2× (psearchy), 2,69× (dedup) e 26× (metis com 384 cores). Não encontrei 1,2× no texto, então ele pode vir de um gráfico.
- **Texto e tabelas discordam em alguns pontos.** A faixa de 7,8% a 46,8% em uma thread convive com anotações da figura de +53,6% (PF) e +76,9% (`unmap-virt`). O texto diz que o port para RISC-V e a adição do MPK custam cada um menos de 200 linhas, mas a Tabela 5 mostra 252 para RISC-V. Usei as figuras e tabelas.
- **Evidência fina sobre overhead e bases de comparação.** A memória é medida em uma única carga que aloca chunks de 8MB, então padrões de mapeamento esparsos não são testados. RadixVM e NrOS são protótipos de pesquisa compilados pelos autores, o RadixVM trava além de 128 cores e o NrOS não tem paginação sob demanda, então a maior parte da evidência é contra o Linux sozinho.

## Pesquisas futuras

- Ligar o código provado ao kernel compilado removendo a dependência do Rust nightly, no que os autores estão trabalhando, para que não seja preciso conferir a correspondência à mão.
- Estender as provas à memória relaxada do ARM, onde os autores apontam as técnicas do VRM, e à coerência de TLB e ao código acima do núcleo.
- Política de NUMA guardada nos metadados por PTE, e um port para ARM com seu bit contíguo e a regra break-before-make, ambos planejados pelos autores.
- Levantar o teto de alta contenção na PT page do último nível, acelerar a enumeração do espaço de endereços no `fork` e testar a ideia dentro do Linux.
