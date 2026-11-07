---
title: "Rakaia: escalonamento escalável no kernel para RPCs sobre TCP"
summary: O Rakaia é um módulo do kernel Linux que extrai mensagens dos streams TCP no caminho de recepção e as escalona a partir de uma fila logicamente central, de modo que as threads de trabalho enxergam mensagens em vez de conexões e o head-of-line blocking desaparece, com o TCP intacto na rede.
researchArea: Sistemas operacionais
keywords: rpc, head-of-line blocking, escalonamento no kernel, tcp, conservação de trabalho, grpc, ktls
version: 1.0
updatedAt: 2026-11-07
---

## Visão geral

As aplicações em nuvem carregam RPCs principalmente sobre TCP e TLS, mas a API POSIX do TCP entrega ao userspace um stream de bytes por conexão, sem fronteiras de mensagem. Disso surgem dois tipos de head-of-line (HOL) blocking. O HOL blocking entre conexões acontece quando o tráfego é desigual entre elas, e alguns cores ficam ociosos enquanto outros acumulam fila. O HOL blocking dentro da conexão acontece quando uma RPC lenta atrasa todas as seguintes na mesma conexão. Frameworks como o gRPC reconstroem a semântica de mensagens no userspace com threads de I/O, filas de trabalho e pools de workers, e pagam por isso em trocas de contexto e sincronização.

Este artigo do OSDI 2026, da EPFL, pergunta se é possível ter RPCs sem HOL blocking sem essa maquinaria e sem abandonar o TCP, como fazem os transportes no estilo do Homa e as pilhas em userspace. A resposta é o Rakaia, um módulo do kernel Linux que expõe um socket puramente orientado a mensagens e escalona as mensagens dentro do kernel.

Quatro termos merecem atenção. Work-conserving significa que nenhum core fica ocioso enquanto houver mensagem esperando. Throughput-under-SLO é a maior carga que um servidor sustenta mantendo a latência p99 dentro de uma meta. O modelo MS é a fila FIFO ideal compartilhada entre mensagens, a régua do artigo. O KCM é o Kernel Connection Multiplexor, a API de mensagens sobre TCP que o Linux já tem no kernel.

Vale conhecer antes: o caminho de recepção do TCP no Linux (contexto de softirq) e como o enfileiramento governa a latência de cauda. Para contraste, o artigo cita o [Demikernel](/papers/demikernel-datapath-os-for-microsecond-datacenter-systems) entre os dataplanes em userspace que substituem a pilha TCP do Linux. Dois pareamentos meus, não do artigo: o [Snap](/papers/snap-microkernel-approach-to-host-networking) tira o networking do host do kernel, e o [ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling) delega a política de escalonamento ao userspace, enquanto o Rakaia leva o escalonamento de mensagens para o caminho de recepção do kernel.

## Contribuição

- **Duas ideias centrais.** Extrair e escalonar as mensagens no mesmo softirq que já executa o caminho de recepção do TCP, e separar as mensagens de suas conexões o mais cedo possível. O KCM segue a primeira ideia, mas prende cada mensagem à sua conexão, então escalona localmente e ainda sofre HOL blocking entre conexões. Com T threads e C conexões, ele ainda cria T vezes C sockets, o que os autores chamam de explosão quadrática.
- **Um socket que ignora conexões.** Cada thread de trabalho abre um socket `AF_RAKAIA` e anexa conexões TCP existentes com um único ioctl `rakaia_attach`, que escolhe um parser embutido (Memcached, ou protocolos baseados em HTTP/2 como o gRPC). Depois disso ela só chama `recvmsg` e `sendmsg`, e o epoll observa um file descriptor por thread em vez de um por conexão. O socket não guarda estado por conexão nem do peer remoto.
- **Caminho de recepção.** O `strparser` do kernel, que o KCM também usa, extrai as mensagens. Os autores o estendem para HTTP/2, guardando os frames por stream e juntando-os quando chega END_STREAM, e frames de controle como PING e WINDOW_UPDATE são respondidos no próprio kernel. Cada mensagem vai para uma das filas FIFO por socket, escolhida por power-of-two choices (sorteia dois sockets e fica com a fila mais curta). Se a fila escolhida está vazia, há entrega direta ao worker ocioso, e um worker de fila vazia rouba trabalho de outra, localizada por um bitmap de filas não vazias. A fila é logicamente centralizada e fisicamente distribuída.
- **Delegação na transmissão.** Pegar o lock do socket TCP em cada remetente serializaria as threads e poria algumas para dormir. Em vez disso, cada conexão tem uma fila de staging e uma flag. Um remetente que encontra a flag ligada enfileira sua mensagem e retorna. Caso contrário, ele vira o transmissor designado: pega o lock, move as mensagens da fila de staging para a fila de escrita do TCP, chama `tcp_push` e reverifica a fila de staging antes de soltar o lock. Cada mensagem é copiada para seu próprio skb, o que simplifica os caminhos de falha.
- **TLS e tamanho.** O Rakaia funciona sobre kTLS, em que o handshake fica no userspace e o processamento dos registros vai para o kernel. A decriptação roda a partir de uma workqueue do Linux, porque os autores consideram a decriptação em softirq do kTLS hoje pouco robusta. O módulo tem cerca de 3.000 linhas de C no Linux 6.8, mais cerca de 60 linhas no kernel para registrar o tipo de socket, e os autores modificaram o gRPC-Go e o gRPC-C++ para usá-lo.

## Metodologia

A avaliação tem duas camadas. Uma simulação de eventos discretos compara três modelos de filas em um servidor de 20 cores: FIFO particionada por conexão (CP), FIFO compartilhada entre conexões (CS) e FIFO compartilhada entre mensagens (MS). Ela usa carga Poisson em malha aberta e overhead de sistema zero, para separar os efeitos de enfileiramento dos custos de implementação.

Os experimentos reais rodam em nós xl170 do CloudLab (um Xeon E5-2640v4 de 10 cores com hyperthreading, Ubuntu 24.04, Linux 6.8), com o servidor usando 20 hyperthreads e um gerador de carga Lancet estendido, em malha aberta, que reporta a latência p99 contra a carga atingida. Os tempos de serviço são determinísticos, exponenciais ou bimodais (90% das requisições na metade da média, 10% em 5,5 vezes a média), para tarefas de 100 µs e 20 µs, com 20, 80 e 5.000 conexões, com e sem TLS. As bases de comparação são programas TCP-CP e TCP-CS, um Worker Pool em userspace (threads de I/O alimentando um ring compartilhado), o KCM com o mesmo parser, e os gRPC-Go v1.75.0 e gRPC-C++ v1.78.1 oficiais contra seus ports para o Rakaia. As aplicações são o Silo rodando TPC-C (garbage collection desligado, sem marshalling de SQL) e o OpenTelemetry Collector com um exporter no-op e outro com Jaeger.

## Resultados

Estes são os resultados relatados pelos autores.

- **Bate com a teoria.** Na simulação, o CP não equilibra a carga nem com 5.000 conexões, o CS sofre HOL blocking dentro da conexão que diminui conforme as conexões crescem, e o CS com 5.000 conexões quase iguala o MS. Nos experimentos de 100 µs o Rakaia fica perto da curva do MS em todos os números de conexões.
- **Contra o TCP simples.** Com 20 conexões e tempos bimodais, o Rakaia sustenta cerca de 160 KQPS enquanto o TCP-CS chega a cerca de 40 KQPS, aproximadamente 4×. Com 5.000 conexões a diferença cai para 7%, como esperado quando há conexões de sobra.
- **Contra o KCM.** O KCM chega a cerca de 30 KQPS no caso bimodal, 19% do throughput do Rakaia, e com tarefas de 20 µs vai pior que os dois modelos TCP simples. O resumo do artigo sintetiza isso como até 5× mais throughput-under-SLO.
- **Contra o Worker Pool.** Ele acompanha o Rakaia em 100 µs, mas fica para trás em 20 µs, onde os autores dizem que ele se degrada com tempos exponenciais e bimodais mesmo depois do ajuste.
- **gRPC-Go.** Com 80 conexões, o gRPC-Rakaia sustenta 39% mais carga que o gRPC-POSIX. De 80 para 5.000 conexões o gRPC-POSIX perde 11% e o gRPC-Rakaia fica quase estável, o que dá 1,56× com 5.000. A 170 KQPS o número de goroutines é 1.077 e 16.946 no POSIX com 80 e 5.000 conexões, contra 29 e 33 no Rakaia. Com 5.000 conexões, levar o trabalho para o kernel soma 1,8 ponto de tempo de CPU no kernel e tira 22,7 pontos de tempo no userspace.
- **gRPC-C++.** As APIs async e callback ganham 2× e 2,33× com 80 conexões, e 2,69× e 2,67× com 5.000. A API sync fica de fora porque seus handlers rodam em um pool de threads que cresce dinamicamente, e o gRPC-Rakaia oferece a mesma API para o usuário que a sync.
- **TLS.** Com tarefas de 100 µs o Rakaia-kTLS chega a cerca de 120 a 130 KQPS, contra 130 a 140 do TCP-CS-TLS e do Worker Pool com TLS. Com tarefas de 20 µs chega a 320 a 340, contra cerca de 380 do TCP-CS-TLS e 200 a 220 do Worker Pool com TLS. Os autores culpam a workqueue e dizem que o limite não é fundamental.
- **Aplicações.** No Silo com TPC-C, com latência de cauda de 500 µs o Rakaia sustenta 350 KQPS contra 309 do TCP-CS-80 e 299 do Worker Pool, e o gRPC-Rakaia melhora o gRPC-POSIX em 1,25× com 80 conexões e 1,39× com 5.000. No OpenTelemetry Collector o ganho é de 1,35× com o exporter no-op (192 contra 142 KQPS com SLO de p99 de 2 ms) e de 1,42× com o Jaeger (131 contra 92 KQPS).

## Análise crítica

O artigo é franco sobre o que custa continuar no TCP. Ele admite o seguinte.

- **Limites herdados do TCP.** Com a pilha intacta, um segmento perdido ou reordenado ainda trava sua conexão, e o controle de congestionamento dirigido pelo remetente ainda lida pior com incast do que transportes dirigidos pelo receptor, como o Homa. Os autores chamam isso de preço da compatibilidade na rede e do suporte a clientes sem modificação.
- **Cobertura estreita hoje.** Só há parsers para Memcached e protocolos baseados em HTTP/2, o gRPC funciona apenas em Go e C++, SmartNICs que fazem offload completo do TCP são incompatíveis, e políticas mais ricas, como filas de prioridade, ficam para depois. A workqueue do kTLS também limita o throughput por enquanto.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **Um único tipo de máquina.** Todo resultado real vem de um tipo de nó do CloudLab com uma CPU de 10 cores. A escalabilidade é mostrada no número de conexões (de 20 a 5.000), não em cores ou sockets, então filas entre sockets de CPU, roubo de trabalho e tráfego de cache com mais cores não são testados.
- **Sem dispersão reportada.** O texto não informa os tamanhos de payload das rodadas sintéticas nem contagens de repetição ou barras de erro, e muitas comparações são lidas em curvas de p99. Uma diferença de 7% com 5.000 conexões tem ruído entre execuções desconhecido.
- **Bases construídas e ajustadas pelos próprios autores.** TCP-CP, TCP-CS e Worker Pool são programas deles. O número de threads de I/O e de workers do Worker Pool foi varrido por tempo de serviço, mas em 20 µs foi ajustado só para tempos fixos, e com TLS manteve a configuração sem criptografia, o que os autores dizem explicar a queda. Um pool mais bem ajustado poderia estreitar essas diferenças.
- **Os ganhos de destaque no gRPC são máximos, e sem TLS.** Os 1,56× e 2,69× são com 5.000 conexões, e com 80 conexões são 1,39× no Go e de 2× a 2,33× no C++. Boa parte do ganho vem do gRPC-POSIX se degradando conforme as goroutines se multiplicam. O gRPC-Rakaia nunca rodou com TLS, já que o Go não suporta kTLS, embora o artigo diga que os protocolos de RPC quase sempre usam TLS, e o Rakaia-kTLS fica atrás do TCP-CS-TLS nos microbenchmarks.
- **As alternativas que motivam o trabalho não são medidas.** Homa, eRPC e desenhos parecidos justificam o trabalho, mas nenhum aparece como base de comparação, então o custo de ficar no TCP é argumentado, não quantificado. Perda de pacotes e incast, que o artigo cita como limites, também não são medidos.
- **A facilidade de implantação é parcial.** Os clientes ficam sem modificação, mas o servidor precisa de um kernel com patch (as 60 linhas de registro do socket) e de um gRPC modificado. O artigo não informa o tamanho da mudança no gRPC nem o estado de uma eventual integração ao upstream.
- **A superfície de ataque não é discutida.** O módulo faz parsing de HTTP/2 não confiável e trata controle de fluxo em contexto de softirq. O texto não discute hardening, fuzzing nem contenção de falhas para parsers dentro do kernel.

## Pesquisas futuras

- Corrigir o kTLS para decriptar com segurança em contexto de softirq, o que os autores planejam e que deve remover o gargalo da workqueue.
- Modelos de fila mais ricos, como filas de prioridade, outros protocolos de RPC por parsers no kernel ou em eBPF, gRPC para Java e Rust e io_uring, todos citados pelos autores.
- Uma avaliação com muitos cores e múltiplos sockets de CPU, com handlers limitados por I/O e perda ou incast injetados, para ver onde os limites herdados do TCP passam a dominar.
- Endurecer os parsers de mensagens no kernel contra entrada malformada, por exemplo com fuzzing ou movendo os parsers para eBPF.
