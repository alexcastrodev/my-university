---
title: "Sobre a construção de µ-kernels"
summary: Liedtke defende que o desempenho ruim e a rigidez dos µ-kernels do início dos anos 1990 (o Mach em especial) vinham de kernels sobrecarregados e de implementações fracas, não da ideia em si. Ele deriva um conjunto mínimo de conceitos do kernel (espaços de endereçamento com grant, map e flush, threads com IPC, identificadores únicos), mostra com contagem de ciclos e medições relidas que a entrada no kernel, a troca de espaço de endereçamento e o IPC podem custar várias vezes menos, e conclui que µ-kernels são inerentemente dependentes do processador.
researchArea: Sistemas operacionais
keywords: µ-kernel, minimalidade, espaços de endereçamento, IPC, L3, L4, Mach, não portabilidade
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Do ponto de vista da engenharia de software, o conceito de µ-kernel é superior ao de grandes kernels integrados. Por outro lado, acredita-se amplamente que (a) sistemas baseados em µ-kernel são inerentemente ineficientes e (b) não são suficientemente flexíveis. Ao contrário dessa crença, o artigo mostra, com evidência documentada, que a ineficiência e a inflexibilidade dos µ-kernels atuais não vêm da ideia básica, mas principalmente da sobrecarga do kernel e/ou de implementação inadequada.

Com base em razões funcionais, o autor descreve alguns conceitos que um µ-kernel deve implementar e ilustra sua flexibilidade. Em seguida, analisa os pontos críticos de desempenho: mostra que desempenho é alcançável, que a eficiência é suficiente em relação aos macro-kernels e por que algumas medições publicadas em sentido contrário não são conclusivas. Por fim, descreve algumas técnicas de implementação e explica por que µ-kernels são inerentemente não portáteis, embora melhorem a portabilidade do sistema como um todo.

## Visão geral

Jochen Liedtke escreveu este artigo no GMD (o centro alemão de pesquisa em tecnologia da informação) para o SOSP '95, em Copper Mountain, Colorado, em dezembro de 1995. É um artigo de posição com números. Nessa época a ideia de µ-kernel já era antiga (o texto cita Brinch Hansen 1970 e o Hydra), mas sistemas como o Mach a faziam parecer lenta, e o folclore culpava as trocas extras de modo usuário-kernel e de espaço de endereçamento. A resposta de Liedtke é que isso é uma afirmação sobre a construção de um kernel específico.

No catálogo há dois vizinhos próximos. O artigo do [Exokernel](/papers/exokernel-os-architecture-application-level-resource-management) (mesmos anais, mesmo mês) também quer um kernel minúsculo e dependente do hardware e se compara ao L3, e Liedtke o discute na seção 6. [The UNIX Time-Sharing System](/papers/unix-time-sharing-system) é a base monolítica de referência, em espírito, e [Hints for Computer System Design](/papers/hints-for-computer-system-design) compartilha o hábito de tratar desempenho como restrição de projeto desde o início. O [seL4](/papers/sel4-formal-verification-of-an-os-kernel) é um kernel posterior no estilo L4 (a seção Availability do artigo cita o L4 como sucessor do L3).

Vale saber antes: modo usuário e modo kernel, memória virtual e TLB (com e sem tags), quanto custa uma troca de contexto e a diferença entre um kernel monolítico e um kernel com servidores em nível de usuário.

## Contribuição

- **Um critério de minimalidade.** Um conceito só é tolerado dentro do µ-kernel se movê-lo para fora, isto é, permitir implementações concorrentes, impedisse a implementação da funcionalidade exigida do sistema. O critério é funcionalidade, não desempenho. A nota 3 admite que minimalidade, necessidade e completude não podem ser provadas.
- **Espaços de endereçamento com três operações.** A construção é recursiva fora do kernel, a partir do espaço 0 (a memória física). O kernel oferece grant, map e flush. Gerentes de memória, pagers e mapeamento de arquivos ficam por cima.
- **Threads e IPC.** As threads ficam no kernel porque a associação de uma thread a um espaço de endereçamento precisa ser controlada por ele. A comunicação entre espaços é IPC por mensagens. Interrupções de hardware viram mensagens de ids de thread especiais, e as portas de E/S fazem parte da abstração de espaço de endereçamento, de modo que drivers rodam como processos comuns.
- **Identificadores únicos.** O kernel fornece uids únicos no espaço e no tempo, porque cifrar mensagens locais é caro demais e capabilities fornecidas pelo usuário podem ser duplicadas sem o controle do receptor.
- **Uma defesa do conceito.** A seção 4 relê medições publicadas (Ousterhout, Chen e Bershad) e argumenta que os custos relatados vêm da construção do Mach.
- **Uma tese de não portabilidade.** µ-kernels são o elo entre as abstrações e o processador, portanto são tão dependentes de hardware quanto geradores de código otimizadores.

## Metodologia

O método é sobretudo analítico. A seção 2 deriva as primitivas de requisitos funcionais, e a seção 3 esboça (sem implementar aqui) como gerentes de memória, pagers, drivers, um servidor Unix e comunicação remota podem ser construídos sobre elas. A seção 4 contabiliza custos em ciclos num 486 de 50 MHz, escolhido porque a troca usuário-kernel é cara em x86. O autor toma o melhor número do Mach como referência e o compara com o kernel L3 como prova de existência.

A evidência é de três tipos: medição própria (18 µs por chamada `get_self_thread` do Mach; tempos do L4 num Pentium de 90 MHz repetidos 100.000 vezes), números publicados normalizados para unidades comuns (Tabela 2) e uma reanálise dos dados de memória de Chen e Bershad, que comparam o Ultrix com o Mach mais um servidor Unix. A seção 5 compara o Exokernel num R2000 com o L3 num 486, e o próprio autor diz que é como comparar maçãs com laranjas. O Apêndice A traz um modelo formal das três operações de espaço de endereçamento e uma implementação com árvores de mapeamento.

## Resultados

Todos os números vêm do artigo.

- **Entrada no kernel.** O Mach num 486 gasta 18 µs, cerca de 900 ciclos. A entrada e o retorno por hardware custam 71 e 36 ciclos (107 no total, cerca de 2 µs), então aproximadamente 800 ciclos são sobrecarga do kernel. O L3 tem sobrecarga mínima de 15 ciclos, e uma chamada completa ao kernel L3 custa de 123 a 180 ciclos, quase sempre abaixo de 3 µs. O artigo afirma que isso é de 6 a 10 vezes melhor que os kernels existentes.
- **Troca de espaço de endereçamento.** Com registradores de segmento, uma troca custa 39 ciclos no 486, 15 no Pentium e 29 no PowerPC 601. A conclusão é menos de 50 ciclos. Num Pentium de 90 MHz (Figura 2, com o L4), um RPC mais o restabelecimento do working set leva de 3,2 a 3,6 µs com troca por segmento, contra 6,3 a 12,7 µs com troca de tabela de páginas, para 2 a 64 páginas de dados.
- **IPC (Tabela 2).** O RPC de um byte, ida e volta, leva 10 µs no L3 (486, 50 MHz, 250 ciclos por IPC de ida) contra 230 µs no Mach na mesma CPU (5750 ciclos), cerca de 22 vezes mais rápido segundo a nota de rodapé. Outras linhas: QNX 76 µs, Mach num R2000 190 µs, Spin 102 µs num Alpha. Os ping-pongs de pipe do Unix ficavam em geral entre 400 e 800 µs, então 10 µs é de 40 a 80 vezes mais rápido. Os números de IPC são do L3, não do L4.
- **Efeitos de memória.** Os ciclos extras de memória por instrução do Mach em relação ao Ultrix (até 0,25 em alguns programas) vêm do maior consumo de cache do sistema, não de conflitos inerentes à estrutura. O L3 precisa de menos de 1 KB de cache para um IPC curto.
- **Técnicas de implementação citadas.** Concentrar tabelas e dados quentes do kernel numa página, blocos de controle e pilhas do kernel como objetos virtuais e lazy scheduling, que juntos economizam 11 faltas de TLB (ao menos 99 ciclos) e são tratados como inevitáveis. Blocos de controle de thread alinhados em 1K, e não 4K, para o cache do Pentium. Mensagens grandes por mapeamento em vez de cópia. Multiplexação de espaços de endereçamento de usuário por segmentos no Pentium.
- **Não portabilidade.** Passar do 486 ao Pentium muda algoritmos em cerca de metade dos módulos do µ-kernel e até a estrutura de bits dos uids de thread.

O que o artigo não afirma: que µ-kernels superam kernels monolíticos em aplicações completas (ele argumenta suficiência, e os benchmarks de aplicação não são dele), que suas primitivas foram provadas mínimas, que passagem de mensagens por registradores é o caminho para acelerar o IPC (o tema não é discutido) ou que Spin e Exokernel são piores (ele chama as questões de abertas).

## Análise crítica

O argumento central se sustenta bem: a contagem de ciclos separa custos conceituais de custos de implementação, e o L3 é uma prova de existência real. Limites a ter em mente:

- **A evidência é em grande parte indireta.** O ganho de IPC é o L3 contra números publicados de outros sistemas, em CPUs e unidades diferentes, e a comparação com o Exokernel se apoia em estimativas ("no máximo 30 ciclos adicionais") baseadas em experiência. Resultados de um sistema completo não estão no artigo.
- **Benchmarks estreitos.** RPC de um byte e uma chamada de kernel quase nula são casos ótimos. O artigo também esboça a flexibilidade na seção 3 sem medir esses servidores.
- **Hardware datado.** Tudo depende de TLBs e traps do 486, Pentium, R2000 e Alpha, e o próprio texto diz que um novo processador exige um novo projeto.
- **Premissas de confiança.** Preferir uids únicos a capabilities nas mãos do usuário é uma escolha de projeto, não um resultado.

Literatura posterior, marcada como tal: o [seL4](/papers/sel4-formal-verification-of-an-os-kernel), cuja nota no catálogo relata IPC de ida de 224 ciclos numa placa ARM contra 206 do caminho escrito à mão do OKL4, mostra a linha L4 ainda competitiva em IPC em 2009. O seguimento do próprio Liedtke, "Toward real microkernels" (CACM, setembro de 1996, conferido no Crossref, não lido aqui), volta ao tema. Para ideias de estilo microkernel em sistemas atuais, veja [Snap](/papers/snap-microkernel-approach-to-host-networking), [TreeSLS](/papers/treesls-whole-system-persistent-microkernel-with-tree-structured-checkpoint) e [Atmosphere](/papers/atmosphere-practical-verified-kernels-with-rust-and-verus). Esses pareamentos são meus, não do artigo.

## Pesquisas futuras

- Comparar µ-kernels bem construídos, baseados em abstrações e no estilo exo, nas mesmas duas plataformas de referência, como o artigo propõe.
- Verificar se um compilador de kernel (como no Spin) pode ser integrado a um projeto de µ-kernel puro, por exemplo para eliminar o redirecionamento aninhado de IPC (clans).
- Medir sistemas completos construídos sobre essas primitivas, e não apenas as primitivas.
- Reprojetar a troca de espaço de endereçamento e o IPC para processadores com TLBs maiores ou com tags.
