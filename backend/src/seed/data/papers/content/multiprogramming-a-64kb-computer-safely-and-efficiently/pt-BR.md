---
title: "Multiprogramando um computador de 64 kB com segurança e eficiência"
summary: Levy e colegas apresentam o Tock, um sistema operacional embarcado em Rust para microcontroladores Cortex-M que isola os componentes do kernel (capsules) pela linguagem e as aplicações (processos) pela unidade de proteção de memória, e divide o heap do kernel entre os processos com grants, a um custo de cerca de 1 kB de RAM para um sistema mínimo.
researchArea: Sistemas operacionais
keywords: Tock, sistema operacional embarcado, Rust, capsules, unidade de proteção de memória, grants, microcontroladores
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

Microcontroladores de baixo consumo não têm alguns dos recursos de hardware e de memória que viabilizam sistemas multiprogramáveis. Por isso, os sistemas operacionais para microcontroladores não ofereceram recursos importantes como isolamento de falhas, alocação dinâmica de memória e concorrência flexível. No entanto, uma classe emergente de aplicações embarcadas são plataformas de software, e não dispositivos de propósito único, e precisa desses recursos de multiprogramação. O Tock, um novo sistema operacional para plataformas de baixo consumo, aproveita mecanismos limitados de proteção por hardware e os recursos de segurança de tipos da linguagem Rust para oferecer um ambiente de multiprogramação para microcontroladores. O Tock isola falhas de software, provê proteção de memória e gerencia a memória com eficiência para cargas dinâmicas de aplicações escritas em qualquer linguagem. Faz isso mantendo os requisitos de confiabilidade de aplicações de longa duração.

## Visão geral

Um processo de propósito geral depende do hardware: níveis de privilégio e uma MMU que dá a cada programa seu espaço de endereçamento. Um microcontrolador de baixo consumo normalmente não tem nenhum dos dois. O artigo diz que esses chips rodam a dezenas de megahertz com dezenas de kilobytes de RAM, e a Tabela 1 mostra a RAM crescendo de 10 kB (TelosB, 2004) para 64 kB (Signpost, 2017). Os Cortex-M de 32 bits mais novos têm uma unidade de proteção de memória (MPU) que protege regiões físicas, mas não têm endereçamento virtual. Por isso os sistemas operacionais embarcados tendem a fundir aplicação e SO em uma só imagem, alocar memória estaticamente e confiar em todo o código.

Os autores argumentam que uma nova classe de dispositivos precisa de mais: relógios esportivos, chaves USB de autenticação e nós de sensoriamento urbano rodam várias aplicações independentes e atualizáveis, algumas de terceiros. O artigo lista cinco necessidades (concorrência, confiabilidade, isolamento de falhas, eficiência de memória, aplicações carregáveis) e usa a Tabela 2 para afirmar que nenhum sistema anterior tinha as cinco. Uma leitura minha, que não é do artigo: ao contrário do [Exokernel](/papers/exokernel-os-architecture-application-level-resource-management), que mantém o kernel mínimo e leva o gerenciamento para bibliotecas de aplicação, o Tock mantém um kernel grande e extensível e isola as peças entre si. A seção de trabalhos relacionados contrasta o projeto com o [seL4](/papers/sel4-formal-verification-of-an-os-kernel), o SPIN, o Singularity e sistemas verificados como o [FSCQ](/papers/using-crash-hoare-logic-for-certifying-the-fscq-file-system).

Vale saber antes: o que uma MPU faz e não faz em comparação com uma MMU, como funcionam propriedade e lifetimes em Rust, e o modelo de eventos run-to-completion do TinyOS.

## Contribuição

A arquitetura do artigo tem duas classes de código, cada uma confiável para coisas diferentes.

- **Capsules.** Unidades de composição dentro do kernel, escritas em Rust. São isoladas em tempo de compilação pelo sistema de tipos e de módulos do Rust e escalonadas de forma cooperativa em uma única pilha. A maioria é não confiável: não acessa campos privados de outras capsules nem a memória dos processos. Só se confia nelas quanto à vivacidade: uma capsule pode monopolizar a CPU ou forçar uma reinicialização, mas não faz acessos não autorizados a periféricos.
- **Um núcleo confiável.** Poucas capsules precisam fazer coisas fora do sistema de tipos, como converter registradores mapeados em memória para structs tipadas ou manipular registradores da CPU no escalonador. Elas, junto com o núcleo do kernel, concentram o código `unsafe`.
- **Processos.** Escritos em qualquer linguagem, escalonados de forma preemptiva e isolados pela MPU, usam cinco chamadas de sistema (Tabela 3): `command`, `allow`, `subscribe`, `memop` e `yield`. As chamadas não bloqueiam, e `subscribe` registra um callback que o kernel enfileira para o processo (a Tabela 3 os chama de upcalls), atendido no próximo `yield`.
- **Grants.** Um heap do kernel particionado entre os processos, que fica dentro do bloco de memória de cada processo, mas é proibido a ele pela MPU. As capsules só acessam a memória de grant por `enter` e `each`, com closures e lifetimes do Rust para que as referências não escapem. Quando um processo morre, seus grants são liberados junto com seu bloco de memória.

## Metodologia

A implementação mira Cortex-M, principalmente o Atmel SAM4L (48 MHz, 512 kB de flash, 64 kB de SRAM) na placa imix. O núcleo do kernel tem 3.554 linhas de Rust e a camada do SAM4L 6.824 linhas, com 295 linhas de código majoritariamente assembly para detalhes do Cortex-M e 21 capsules não confiáveis em 12.925 linhas para sensores, rádios e multiplexadores. O kernel precisa de 8,4 kB de SRAM mais 4 kB de pilha, e de 87 kB de flash.

Os autores dizem que uma comparação quantitativa com sistemas existentes é difícil porque nenhuma suíte de benchmarks serve a este ponto do espaço de projeto. Oferecem dois estudos de caso (uma plataforma de sensoriamento urbano chamada Signpost e o protótipo de uma chave USB de segurança de uma grande empresa de software) e quatro perguntas: o custo do isolamento por capsules, capsules contra isolamento só por processos, a memória poupada pelos grants e o custo dos grants. As comparações usam TinyOS (numa placa anterior com o mesmo MCU), FreeRTOS e uma versão modificada do TOSThreads feita para isolar processos.

## Resultados

- **Latência (Tabela 5).** Tratar uma interrupção de pino: 0,87 us direto numa rotina de interrupção, 2,03 us numa capsule, 36,8 us num processo. Saindo do sono profundo, os três custam 2,29 ms, 2,29 ms e 2,34 ms, então o despertar domina.
- **Footprint do blink (Tabela 6).** RAM total de 916 B no Tock, 72 B no TinyOS e 2.984 B no FreeRTOS. O texto em flash é 3.208 B, 5.296 B e 4.848 B.
- **App de sensoriamento (Tabela 7).** RAM de 9.704 B no Tock e 10.460 B no TinyOS, ambos incluindo uma pilha de 4 kB; texto em flash de 41.744 B e 39.604 B.
- **Capsules contra processos.** Uma referência de capsule custa uma palavra (12 bytes no driver do sensor de luz da Figura 7). Uma chamada entre capsules custa de 0 a 4 ciclos, pessimisticamente 25 (0,5 us a 48 MHz); uma troca de contexto no Tock custa 340 ciclos (7 us). Para o kernel do sensor ambiental do Signpost, com 26 capsules, isolar só por processos exigiria de 13 kB (pilhas de 512 B, metadados de 14 bytes do RIOT) a 110 kB (pilhas de 4 kB, metadados de 164 bytes do Tock), contra 12 kB com capsules.
- **Grants contra alocação estática (Tabela 8).** Uma variante do TOSThreads com isolamento gasta de 710 a 712 bytes de RAM do kernel por thread, dos quais no máximo 158 bytes (22%) podem estar em uso, desperdiçando 554 bytes (78%). Com grants, o artigo diz que não há memória desperdiçada.
- **Custo dos grants.** Uma referência a grant tem 4 bytes, cada alocação acrescenta uma entrada de duas palavras na tabela hash, e um valor `Owned` acrescenta uma palavra. No driver de timer, um processo custa 387 ciclos (8 us) e cada timer adicional 44 ciclos, cerca de 900 processos antes de 1 ms. O driver otimizado é constante em 360 ciclos, e uma versão unsafe baseada em ponteiros custa 305 ciclos.

## Análise crítica

O artigo é aberto sobre seu escopo, e várias coisas que se poderia supor não estão nele.

- **Sem contagem de código unsafe.** O artigo não informa linhas de `unsafe` nem uma medida da base confiável, e nunca usa o termo TCB. Ele nomeia o que precisa ser confiável (o núcleo do kernel e as poucas capsules de hardware) e dá contagens de linhas só para as peças do kernel.
- **Sem comparação quantitativa com Contiki ou RIOT.** Os sistemas medidos são TinyOS, FreeRTOS e TOSThreads. Contiki e RIOT aparecem na Tabela 2 e nos trabalhos relacionados, e os 14 bytes de metadados do RIOT entram como insumo da estimativa de 13 kB.
- **O isolamento depende de confiança em ferramentas e pessoas.** O isolamento das capsules depende de o compilador de Rust estar correto e de as capsules confiáveis estarem certas. O artigo supõe que os integradores de placa auditam o código do kernel, diz que a auditoria não pega todos os bugs e não verifica nada formalmente. Chama a verificação de complementar e sugere verificar o núcleo confiável.
- **Capsules só são isoladas por tipo.** Uma capsule pode monopolizar a CPU, forçar uma reinicialização e atrasar outras capsules. O artigo não descreve mecanismo para limitar o uso de CPU de uma capsule, e a vivacidade do kernel depende de as capsules cederem a CPU.
- **Avaliação estreita.** Tudo roda em Cortex-M, principalmente numa placa SAM4L. As comparações são entre aplicações diferentes e um TOSThreads modificado. Os autores esperam menos de 10 processos, e o custo de iterar grants cresce com o número de processos. O texto diz que dois grants custam "dois bytes" enquanto uma entrada tem duas palavras, provavelmente um deslize. Os números da Figura 8 acima vêm do texto, não de leitura do gráfico.
- **Literatura posterior (só resumos do catálogo, não relida para esta nota).** [Atmosphere](/papers/atmosphere-practical-verified-kernels-with-rust-and-verus) e [CortenMM](/papers/cortenmm-efficient-memory-management-with-strong-correctness) usam Rust com provas em [Verus](/papers/verus-practical-foundation-for-systems-verification), e o [RustBelt](/papers/rustbelt-securing-foundations-of-rust) trata do que torna o código `unsafe` correto. O [Biscuit](/papers/the-benefits-and-costs-of-writing-a-posix-kernel-in-a-high-level-language) usa Go num kernel POSIX, e os [Unikernels](/papers/unikernels-library-operating-systems-for-the-cloud) também fundem aplicação e SO numa só imagem, mas sobre um hipervisor.

## Pesquisas futuras

- Verificar o núcleo confiável com métodos como o [Hyperkernel](/papers/hyperkernel-push-button-verification-of-an-os-kernel) ou o [CertiKOS](/papers/certikos-extensible-architecture-for-certified-concurrent-os-kernels), como sugerem os autores, mantendo capsules e processos para código não verificado.
- MPUs de granularidade mais fina ou interfaces de registradores de E/S, que segundo o artigo poderiam deixar os processos acessar periféricos diretamente sem canais laterais via DMA.
- Medir o código confiável no kernel e o efeito de limites de CPU nas capsules (sugestão minha, não do artigo).
