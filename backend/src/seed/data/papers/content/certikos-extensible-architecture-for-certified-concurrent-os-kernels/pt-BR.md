---
title: "CertiKOS: uma arquitetura extensível para construir kernels de SO concorrentes certificados"
summary: O CertiKOS monta um kernel multicore a partir de camadas de abstração certificadas e prova em Coq que cada função do kernel refina contextualmente a sua especificação sob qualquer intercalação, resultando no mC2, um kernel de 6.500 linhas com travas de granularidade fina e menos de 2 anos-pessoa de prova de concorrência.
researchArea: Sistemas operacionais
keywords: kernels certificados, refinamento contextual, camadas de abstração certificadas, verificação concorrente, contexto de ambiente, Coq, CompCertX, ausência de inanição
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

A verificação formal completa de um kernel de SO concorrente não trivial é amplamente considerada um grande desafio. Apresentamos uma abordagem composicional inédita para construir kernels de SO concorrentes certificados. A concorrência permite a execução intercalada de módulos de kernel e de usuário em diferentes camadas de abstração, e cada camada pode ter um conjunto diferente de eventos observáveis. Insistimos em especificar formalmente essas camadas e seus eventos observáveis, e em verificar cada módulo do kernel no seu nível de abstração adequado. Para permitir a ligação certificada com outras CPUs ou threads, provamos uma forte propriedade de refinamento contextual para toda função do kernel: a implementação de cada função se comporta como sua especificação em qualquer contexto de kernel e de usuário, com qualquer intercalação válida. Desenvolvemos com sucesso um kernel concorrente prático e verificamos em Coq a sua correção funcional (contextual). O kernel certificado tem 6.500 linhas de C e assembly x86 e roda em máquinas x86 multicore comuns. Até onde sabemos, esta é a primeira prova de correção funcional de um kernel concorrente completo e de uso geral com travas de granularidade fina.

## Visão geral

O [seL4](/papers/sel4-formal-verification-of-an-os-kernel) mostrou em 2009 que um microkernel inteiro pode ser provado correto, mas em um único núcleo. Este artigo do OSDI 2016, de Yale, faz a pergunta seguinte: e se o kernel rodar em várias CPUs ao mesmo tempo, com spinlocks de granularidade fina, yield, sleep e wakeup de threads e interrupções? Os autores citam pesquisadores que acreditavam que a combinação de concorrência com complexidade funcional torna a verificação intratável, ou muito mais cara que a do caso sequencial. Os kernels, sistemas de arquivos e drivers verificados até então não tratavam concorrência com memória compartilhada. O artigo revisita o seL4 (uma única big kernel lock, considerada suficiente para um microkernel por Peters et al. e von Tessin), o Hyper-V sob o VCC (cerca de 20% do código verificado, só contratos e invariantes de tipo) e um esforço com preempção em um único núcleo sobre o uC/OS-II.

O kernel construído e verificado se chama mC2 (o kernel sequencial anterior é o mCertiKOS). Ele também funciona como hypervisor e nasceu em um projeto da DARPA, rodando três guests Ubuntu em um veículo terrestre não tripulado com um Core i7.

Vale conhecer antes: refinamento (a implementação se comporta como a especificação), linearizabilidade, ausência de inanição (starvation-freedom: todo pedido é atendido em algum momento) e o assistente de provas Coq.

## Contribuição

- **Camadas de abstração certificadas.** Uma camada é uma tripla (L1, M, L2) mais uma prova verificada por máquina de que o módulo M, sobre a interface inferior L1, refina contextualmente a interface superior L2. A especificação profunda L2 captura tudo que é observável de M, então não é preciso ler M de novo.
- **Contextos de ambiente.** Cada camada é parametrizada por um conjunto de threads ou CPUs ativas, e o resto do sistema é uma função que responde com os eventos que as outras CPUs gerariam. A composição paralela é [[P]]L(A∪B) = [[P]]L(A) ∩ [[P]]L(B) para A e B disjuntos, então provas por CPU se compõem sob condições de rely compatíveis.
- **Técnicas sequenciais para código concorrente.** O kernel é escrito em ClightX, verificado no nível do código-fonte e compilado pelo CompCertX, uma versão do CompCert segura para threads. As primitivas concorrentes são tratadas como chamadas externas que o compilador não pode reordenar.
- **Progresso, não só segurança.** Invariantes temporais sobre o ambiente (escalonamento justo, tempo limitado de posse da trava) provam a ausência de inanição das travas ticket e MCS e das variáveis de condição.
- **Um kernel funcionando.** O mC2, com travas, filas, escalonador, memória física e virtual, containers com cotas, IPC por memória compartilhada, IPC síncrono, virtualização e drivers.

## Metodologia

A prova é uma cadeia de simulações em Coq, cada uma no estilo CompCert (simulação direta ascendente, Figura 5). O modelo multicore com intercalação arbitrária de instruções refina um modelo com escalonador de hardware (Lema 1), depois um modelo em que cada CPU tem uma cópia local da memória compartilhada movida pelas primitivas lógicas `pull` e `push` (Lema 2), depois uma máquina parcial com um conjunto de CPUs ativas (Lemas 3 e 4) e, por fim, um modelo local à CPU cujos pontos de troca só aparecem antes de operações atômicas ou de push/pull (Lema 5). Um programa com corrida de dados "dá errado" no modelo de cópia local, então a segurança nesse modelo garante ausência de corridas. Objetos atômicos mantêm um log lógico de eventos e recuperam o estado reexecutando o log. As travas são empilhadas em camadas de modo que uma trava definida numa camada inferior não pode ser tomada acima dela, o que, segundo o artigo, evita deadlocks.

## Resultados

- **O que é provado.** Refinamento contextual do mC2 contra uma especificação profunda de alto nível, que os autores dizem implicar que todas as system calls e traps seguem a especificação, executam com segurança e terminam, sem corrida de dados, injeção de código, estouro de buffer, acesso a ponteiro nulo ou estouro de inteiro. O que se prova sobre um programa de usuário P na especificação vale para o sistema ligado em x86.
- **Isolamento e liveness.** Invariantes dos mapas de páginas (páginas do kernel só para o kernel, memória de usuário não compartilhada isolada), cotas de páginas por thread que impedem negação de serviço por esgotamento de memória e ausência de inanição das travas ticket e MCS (no máximo n x m x k iterações do laço). O artigo não enuncia um teorema de noninterference para o próprio mC2 e remete a outro trabalho sobre segurança de fluxo de informação.
- **Esforço.** Cerca de 2 anos-pessoa para o arcabouço de concorrência e as funcionalidades. 943 linhas especificam o modelo de hardware e 450 a interface de system calls (a base confiável). Fora dela: 5.249 linhas de especificações do kernel, cerca de 40 mil de definições, lemas e invariantes e 50 mil de scripts de prova em Coq para as adições de concorrência. Pelo menos um terço é redundante e gerado de forma semiautomática.
- **Bugs.** Um laço de ticket lock escrito como `now<t` passou em todos os testes, mas violava a especificação quando o ticket estoura em 2^32 - 1, e foi corrigido com `now!=t`. A FIFOBBQ de um livro-texto conhecido pode travar, e os autores a corrigiram.
- **Desempenho.** Em um Core i7-2600S de 2,8 GHz, uma trava sem contenção custa 34 ciclos (ticket) e 74 (MCS). Com pares servidor/cliente, o mC2 de granularidade fina chega a 1,77x a 1,84x de speedup em 2 núcleos e 2,62x a 2,71x em 3, contra 1,45x a 1,66x e 1,64x a 2,07x de uma variante com big kernel lock. O IPC de ida e volta leva cerca de 3.800 ciclos, contra cerca de 1.200 (fastpath) e 1.800 (slowpath) de um seL4 não verificado e de um só núcleo. Como hypervisor, o overhead é moderado e comparável ao do KVM, pior em cargas com muitos arquivos, como descompactar o Linux e o Tomcat.

## Análise crítica

Os autores declaram os limites com clareza. As instruções atômicas assumem consistência sequencial; eles acreditam que a prova vale para o x86 TSO, mas dizem que falta formalização. A máquina não tem TLB, então o TLB shootdown não pode ser verificado, e só uma pequena parte do conjunto de instruções x86 é coberta. O montador do CompCertX, o verificador do Coq e a extração de código são confiados. O bootloader, o módulo PreInit e o ELF loader não são verificados, e não há sistema de armazenamento certificado. O código de gerenciamento de energia não é verificado, então o turbo boost foi desligado nos experimentos.

Os pontos a seguir são uma leitura da evidência, não afirmações do artigo.

- **A comparação de IPC é desigual.** O próprio artigo diz que a semântica de IPC do seL4 é diferente, e usa números de um seL4 não verificado e de um só núcleo, um custo Null de 158 ciclos dado pela equipe do seL4 e uma soma construída, (Call + ReplyWait) + Null x 2. A diferença é de cerca de 2x a 3x na métrica que mais importa a um microkernel; os autores a atribuem à otimização pesada e específica de hardware do IPC do seL4 e não dão um detalhamento.
- **A teoria formal está em outro lugar.** As definições dos contextos de ambiente e a justificativa das hipóteses de justiça estão em um relatório técnico separado, então este artigo sozinho não permite conferir esses pontos.
- **O escalamento só aparece até 3 dos 4 núcleos.** A causa é atribuída a processos de sistema e a dados não alinhados, sem medição.
- **Tamanho da prova.** Somando os números do artigo, dão cerca de 95 mil linhas fora da base confiável mais 1.393 dentro dela, por volta de 14,9 linhas por linha de código (conta minha). A nota do Atmosphere neste catálogo cita a mesma razão de 14,9:1 para o CertiKOS (veja o [Atmosphere](/papers/atmosphere-practical-verified-kernels-with-rust-and-verus)); isso é literatura posterior, e não li o artigo do Atmosphere, só essa nota do catálogo. Ela acrescenta que comparar razões entre ferramentas é uma medida grosseira.
- **Trabalho posterior, não lido.** O Crossref lista "Certified concurrent abstraction layers" (PLDI 2018) com uma lista de autores que se sobrepõe; conferi só título, autores e venue, e não li o artigo.

## Pesquisas futuras

- Formalizar o modelo TSO para poder abandonar a hipótese de consistência sequencial. Os bugs de memória fraca são o alvo de trabalhos de teste como o [OZZ](/papers/ozz-kernel-out-of-order-concurrency-bugs).
- Modelar a TLB e verificar o caminho de boot, os loaders e o montador. Outra verificação de gerência de memória concorrente é o [CortenMM](/papers/cortenmm-efficient-memory-management-with-strong-correctness), que usa outro verificador.
- Um sistema de arquivos certificado, que os autores planejam incorporar a partir de trabalhos recentes.
- Um cálculo de camadas que elimine as definições e provas redundantes, no qual os autores dizem estar trabalhando. O [Hyperkernel](/papers/hyperkernel-push-button-verification-of-an-os-kernel) vai pelo caminho oposto, com automação por SMT e sem suporte a multicore, então custo e concorrência ainda não aparecem combinados nos artigos do catálogo (leitura minha).
