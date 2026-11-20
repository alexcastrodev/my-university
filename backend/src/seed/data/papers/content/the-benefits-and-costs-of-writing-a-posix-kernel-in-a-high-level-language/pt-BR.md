---
title: "Os benefícios e custos de escrever um kernel POSIX em uma linguagem de alto nível"
summary: Cutler, Kaashoek e Morris constroem o Biscuit, um kernel no estilo POSIX com quase 28 mil linhas de Go que roda NGINX e Redis, e medem o que a coleta de lixo e as verificações de segurança custam: até 13% do tempo de CPU do kernel, com caminhos de código equivalentes em Go de 5% a 15% mais lentos que em C.
researchArea: Sistemas operacionais
keywords: kernel em Go, linguagem de alto nível, coleta de lixo, esgotamento do heap, segurança de memória, desempenho de kernel, Biscuit
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

Este artigo avalia o uso de uma linguagem de alto nível (HLL) com coleta de lixo para implementar um kernel monolítico no estilo POSIX. O objetivo é explorar se é razoável usar uma HLL no lugar de C nesse tipo de kernel, examinando custos de desempenho, desafios de implementação e benefícios de programabilidade e segurança. O artigo contribui com o Biscuit, um kernel escrito em Go que implementa POSIX o bastante (memória virtual, mmap, sockets TCP/IP, um sistema de arquivos com log, poll etc.) para executar aplicações relevantes. O Biscuit faz uso liberal dos recursos de HLL do Go (closures, canais, maps, interfaces, alocação em heap com coleta de lixo), que subjetivamente tornaram a programação mais fácil. O quebra-cabeça mais difícil foi tratar a possibilidade de o heap do kernel se esgotar; o Biscuit se beneficiou da analisabilidade do código-fonte Go para resolver isso. Em um conjunto de benchmarks que exigem muito do kernel (incluindo NGINX e Redis), a fração do tempo de CPU do kernel que o Biscuit gasta com recursos de HLL (principalmente coleta de lixo e verificações de expansão da pilha de threads) chega a 13%. A maior pausa individual relacionada à coleta de lixo sofrida pelo NGINX foi de 115 microssegundos; a maior soma observada de atrasos de coleta em uma requisição completa de cliente do NGINX foi de 600 microssegundos. Em experimentos que comparam caminhos de código quase idênticos de chamada de sistema, falha de página e troca de contexto escritos em Go e em C, a versão em Go foi de 5% a 15% mais lenta.

## Visão geral

Os kernels do Linux, do macOS e do Windows são escritos em C porque a linguagem dá acesso flexível e de baixo nível à memória e controle sobre a alocação. O preço são os bugs de segurança de memória: o artigo cita pelo menos 50 vulnerabilidades de segurança do Linux em 2017 envolvendo estouro de buffer ou use-after-free em código C. Linguagens de alto nível com coleta de lixo eliminam essas classes, mas projetistas de kernel desconfiam de que o gerenciamento de memória delas seja compatível com um kernel de produção de alto desempenho, e ninguém tinha medido o custo mantendo todo o resto igual. Os autores dizem que a questão da escolha da linguagem, com o resto constante, não havia sido explorada.

Este artigo do OSDI 2018, do MIT CSAIL, responde com um sistema funcionando. O Biscuit mantém o projeto de um kernel Unix monolítico tradicional, a linhagem do [UNIX](/papers/unix-time-sharing-system), para que as diferenças em relação ao Linux venham o máximo possível da linguagem. O mesmo grupo já havia mostrado como remover gargalos de multicore do Linux ([escalabilidade do Linux](/papers/analysis-of-linux-scalability-to-many-cores)); o Biscuit explicitamente não é otimizado para muitos núcleos. O artigo discute o [slab allocator](/papers/slab-allocator-object-caching-kernel-memory-allocator) do Linux e levanta a hipótese de que o alocador de propósito geral único do Go e seu coletor bastam para uma ampla gama de objetos do kernel.

Vale conhecer antes: o que são um coletor de lixo por rastreamento e uma write barrier, a diferença entre pausa concorrente e pausa stop-the-world, e o que uma chamada de sistema precisa alocar no heap do kernel.

## Contribuição

O artigo lista cinco contribuições: o próprio Biscuit; um esquema para lidar com o esgotamento do heap do kernel; uma discussão qualitativa de onde uma HLL ajudou e onde não ajudou; medições do imposto de desempenho da HLL; e uma comparação direta entre Go e C com código equivalente.

- **Biscuit.** 27.583 linhas de Go, 1.546 linhas de assembly e nenhuma de C, com 58 chamadas de sistema, multicore, threads com suporte do kernel, futexes, mmap, fork com copy-on-write, um sistema de arquivos com log e sockets TCP/IP, além de drivers em Go para discos SATA AHCI e Ethernet baseada no Intel 82599.
- **Reservas de heap.** Uma ferramenta de análise estática, o MaxLive (1.299 linhas de Go), calcula quanto heap vivo cada chamada de sistema pode precisar. A chamada espera na entrada, sem segurar locks, até conseguir reservar esse tanto, e depois disso suas alocações não podem falhar. As aplicações veem atrasos em vez de erros. Quando o heap se aproxima do esgotamento, uma thread assassina coleta lixo, descarta entradas de cache e mata o processo com mais regiões mapeadas, descritores de arquivo e threads.
- **Um runtime do Go modificado.** Cerca de 3.200 linhas de Go e 1.000 de assembly, incluindo uma camada (shim) que fornece memória e contextos de execução, contagem de bytes alocados por goroutine para as reservas e mudanças no coletor para reduzir atrasos.

## Metodologia

Os testes rodaram em um Xeon X3460 de quatro núcleos a 2,8 GHz com 16 GB, com um enlace Ethernet de 10 gigabits até um cliente Linux. Os três benchmarks exigem muito do kernel: o CMailbench (uma carga estilo servidor de e-mail baseada em fork, exec e rename), o NGINX 1.11.5 servindo um arquivo de 612 bytes com 64 requisições em andamento, e o Redis 3.0.5 (modificado para usar poll) com requisições GET de valores de 2 bytes. A maioria das rodadas usa um sistema de arquivos em memória e dura um minuto, com média de três execuções e variação abaixo de 3%.

O custo da coleta de lixo é medido como (O_gc menos O_nogc) sobre O_gc, em que a execução sem coleta recebe heap suficiente para nunca coletar. Isso não remove o custo de verificar se as write barriers estão ligadas. Prólogos, write barriers e verificações de segurança inseridos pelo compilador são localizados no binário e cruzados com perfis de CPU. Para Go contra C, os autores modificam o Biscuit e o Linux 4.9.82 para que um ping-pong de pipes e um laço de falhas de página sigam caminhos de código quase idênticos. Para Biscuit contra Linux, ajustam o Linux desligando recursos caros e trocando a glibc pela musl. O estudo de CVEs lê à mão os patches de 65 bugs de execução de código do Linux de 2017.

## Resultados

Todos os números abaixo vêm do texto e das tabelas do artigo, salvo quando indicado.

- **Imposto da HLL (Figura 7).** A coleta de lixo toma 3% (CMailbench), 2% (NGINX) e 1% (Redis) da CPU, com 42, 32 e 30 coletas. Os prólogos de função custam 6%, 6% e 4%, as write barriers 0,9%, 0,7% e 0,2%, e as verificações de nil, limites, divisão e cast 3%, 2% e 2%. Os ciclos de alocador (8%, 9%, 7%) não são um custo específico de HLL. Os dados vivos do heap ficaram em média entre 18 e 48 MB.
- **Atrasos de GC no NGINX.** 0,7% das chamadas ao alocador são atrasadas, 2% das chamadas de sistema e 22% das requisições. O pior atraso de alocador é de 115 microssegundos (marcação de boa parte da tabela hash de conexões TCP), o pior de chamada de sistema é de 574 microssegundos (um poll) e o pior de requisição é de 582 microssegundos (o resumo arredonda para 600). Menos de 0,3% das requisições gastam mais de 100 microssegundos coletando.
- **Folga do heap (Figura 8).** No CMailbench com 640 MB de dados vivos, a fatia de GC é 34% com 960 MB de heap, 19% com 1.280 MB e 9% com 1.920 MB. Os autores aconselham um heap de 2 a 3 vezes o pico esperado de dados vivos.
- **Go contra C.** Falhas de página: 731 ns em Go e 695 ns em C (C 5% mais rápido). Ping-pong: 465.811 idas e voltas por segundo em Go e 536.193 em C (C 15% mais rápido), com 5.259 contra 4.540 instruções por ida e volta; prólogos, write barriers, limites e verificações de nil/tipo respondem por 250, 200, 144 e 112 instruções.
- **Biscuit contra Linux (Figura 9).** Linux sobre Biscuit: 1,07 no CMailbench em memória (17.034 contra 15.862 msg/s), 0,99 no CMailbench com SSD, 1,07 no NGINX e 1,09 no Redis.
- **CVEs.** Dos 65 bugs, o Go teria melhorado o resultado de 40 (8 use-after-free ou double-free e 32 acessos fora dos limites, contados a partir da Figura 6); 14 são bugs de lógica e 11 são incertos. Muitos casos fora dos limites virariam panics em vez de execução de código. O runtime e os pacotes do Go tiveram 14 CVEs de 2016 a 2018.
- **Esgotamento do heap.** Os dados vivos chegaram a cerca de 500 MB, 97% do heap de 512 MB, enquanto um processo bem-comportado não viu nenhuma chamada de sistema falhar, apesar de esperar por reservas centenas de milhares de vezes; a thread assassina agiu quatro vezes nos primeiros 35 segundos (lido do texto da Figura 10).
- **Buscas sem lock de leitura.** Um cache de diretórios sem lock de leitura dá 15.862 msg/s contra 14.259 com locks de leitura, 11% a mais.

## Análise crítica

O artigo é incomumente cuidadoso com as próprias afirmações. Ele não tira conclusão geral sobre C contra uma HLL e diz que a comparação com o Linux não ilumina a questão da linguagem, porque o Linux tem mais recursos e escolhas de compromisso diferentes.

- **Escopo.** As conclusões valem para o Go 1.10 e para estas três cargas em quatro núcleos, na maior parte com sistema de arquivos em memória. O Biscuit não tem prioridade de escalonamento (herda o escalonador do Go), swap, mapeamento reverso, usuários nem ASLR, e não é otimizado para muitos núcleos ou NUMA.
- **Custo de memória.** A coleta de lixo precisa de folga, então o uso eficiente de memória favorece o C, como os autores dizem. O Biscuit fixa o heap em 1/32 da RAM no boot, e o esquema de reservas supõe que o coletor rode com quase nenhuma memória livre. O coletor do Go pode precisar de memória para a pilha de trabalho (no máximo 0,8% da RAM do heap nos experimentos; o plano alternativo descrito pelos autores não foi implementado), e a fragmentação por classe de tamanho ainda não é tratada.
- **Comparações construídas.** O Linux foi ajustado (recursos desligados, musl no lugar da glibc) e os dois kernels foram modificados para que os caminhos Go e C coincidam, então não são resultados do Linux de fábrica. O artigo diz isso, e os caminhos comparados são pequenos (cerca de 480 a 650 linhas nas falhas de página, 1.200 a 1.786 no ping-pong).
- **Leitura minha, não afirmação do artigo.** O estudo de CVEs conta tipos de bug em patches; não dá densidade de bugs por linha, e um kernel em Go ainda precisaria de `unsafe` (90 usos no Biscuit) e manteria classes como erros de lógica e de contagem (o próprio Biscuit mantém contadores de referência para objetos que precisam de limpeza, e um [estudo de refcounting no Linux](/papers/refcounting-bugs-in-all-modern-linux-kernels) mostra como essa classe é comum). Bugs de ordenação do tipo que o [OZZ](/papers/ozz-kernel-out-of-order-concurrency-bugs) procura estão fora do escopo do artigo.
- **Literatura posterior (não relida para esta análise).** O catálogo tem kernels em Rust que seguem o outro caminho citado pelo artigo, o [Atmosphere](/papers/atmosphere-practical-verified-kernels-with-rust-and-verus) e o [CortenMM](/papers/cortenmm-efficient-memory-management-with-strong-correctness). A análise do catálogo sobre o [Hyperkernel](/papers/hyperkernel-push-button-verification-of-an-os-kernel) diz que a equipe abandonou um kernel em Rust por causa de ownership e do custo de formalizar Rust. Uso apenas esses resumos do catálogo.

## Pesquisas futuras

- A lista dos próprios autores: expandir e contrair o heap em tempo de execução, dar ao Biscuit controle da política de escalonamento, escalar para mais núcleos e testar se as reservas de heap poderiam simplificar kernels em C.
- Repetir a comparação Go contra C com um coletor compactador ou de menor custo, ou com Rust, que o artigo espera que possa ser mais rápido, mas mais difícil para código com threads.
- Sugestão minha, não do artigo: pôr esses custos ao lado do preço de provar um kernel correto, como no [seL4](/papers/sel4-formal-verification-of-an-os-kernel) e no [CertiKOS](/papers/certikos-extensible-architecture-for-certified-concurrent-os-kernels), e ao lado de um coletor mark-region como o [Immix](/papers/immix-mark-region-garbage-collector), já que o coletor do Go no Biscuit nunca move objetos.
