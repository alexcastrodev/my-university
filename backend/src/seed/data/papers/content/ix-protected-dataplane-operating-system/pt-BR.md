---
title: "IX: um sistema operacional de plano de dados protegido para alta vazão e baixa latência"
summary: O IX divide o SO em um plano de controle Linux e planos de dados por aplicação, executados em um anel protegido com Dune, que processam lotes limitados de pacotes até o fim e não compartilham estado entre núcleos, superando Linux e mTCP em vazão e latência.
researchArea: Sistemas operacionais
keywords: sistema operacional de plano de dados, bypass de kernel, execução até a conclusão, lotes adaptativos, zero-copy, virtualização de hardware, latência de cauda, escalabilidade em múltiplos núcleos
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

A sabedoria convencional diz que requisitos agressivos de rede, como altas taxas de pacotes para mensagens pequenas e latência de cauda em escala de microssegundos, são mais bem atendidos fora do kernel, em uma pilha de rede em nível de usuário. Apresentamos o IX, um sistema operacional de plano de dados que oferece alto desempenho de E/S sem abrir mão da principal vantagem dos kernels atuais, a proteção forte. O IX usa virtualização de hardware para separar as funções de gerenciamento e escalonamento do kernel (plano de controle) do processamento de rede (plano de dados). A arquitetura do plano de dados parte de uma API nativa e zero-copy e otimiza largura de banda e latência ao dedicar threads de hardware e filas de rede às instâncias do plano de dados, processar lotes limitados de pacotes até a conclusão e eliminar tráfego de coerência e sincronização entre núcleos. Demonstramos que o IX supera significativamente o Linux e as pilhas de rede em espaço de usuário mais avançadas, tanto em vazão quanto em latência de ponta a ponta. Além disso, o IX aumenta em até 3,6x a vazão de um armazenamento chave-valor muito usado e reduz a latência de cauda em mais de 2x.

## Visão geral

Este artigo do OSDI 2014 (Stanford e EPFL) trata de serviços de datacenter que precisam de altas taxas de pacotes para mensagens pequenas, latência de cauda controlada, muitas conexões e isolamento entre inquilinos. Os kernels convencionais foram projetados para várias aplicações dividindo um núcleo e para intervalos entre pacotes muito maiores que a latência de uma interrupção, então pagam em latência e vazão pelo escalonamento de granularidade fina. A resposta popular, uma pilha em nível de usuário como o mTCP, elimina as travessias do kernel mas perde a proteção: uma aplicação com defeito pode corromper a pilha e, por exemplo, enviar pacotes brutos. O RDMA exige adaptadores especiais nas duas pontas.

O IX quer quebrar o que os autores chamam de compromisso de quatro vias entre vazão, latência, proteção e eficiência de recursos. Ele toma emprestado de middleboxes (firewalls, roteadores em software), que já executam cada pacote até o fim e evitam sincronização entre núcleos, mas estende a ideia a aplicações gerais não confiáveis. Cada plano de dados roda uma aplicação em um espaço de endereçamento, como no [Exokernel](/papers/exokernel-os-architecture-application-level-resource-management), mas com isolamento de memória fornecido pelo hardware de virtualização.

## Contribuição

O artigo enuncia quatro princípios de projeto.

- **Separação e proteção entre plano de controle e plano de dados.** O plano de controle (o kernel Linux completo mais um programa de usuário, o IXCP) configura, provisiona e escalona recursos entre planos de dados de forma grossa: núcleos inteiros, páginas de 2MB, filas da NIC. O Dune coloca o Linux em VMX root anel 0, os planos de dados em VMX non-root anel 0 e as aplicações no anel 3, o que dá isolamento em três vias.
- **Execução até a conclusão com lotes adaptativos.** Cada etapa de um lote de pacotes roda no kernel do plano de dados, depois a aplicação roda em modo usuário. O lote nunca espera e só se forma sob congestionamento, com um limite superior.
- **API nativa, zero-copy, com controle de fluxo explícito.** Chamadas de sistema em lote e condições de evento em arrays compartilhados, sem POSIX. Os mbufs recebidos são mapeados somente para leitura na aplicação.
- **Processamento coerente por fluxo e sem sincronização.** O receive-side scaling da NIC distribui fluxos em filas, cada uma de uma thread de hardware com seus próprios pools de memória, e a API é comutativa entre threads elásticas.

A biblioteca libix oferece uma interface parecida com a libevent, para portar aplicações existentes.

## Metodologia

O plano de dados tem 39K SLOC: 41% derivados da variante DPDK do driver de NIC da Intel, 26% do lwIP, 15% da biblioteca Dune e cerca de 7K de código novo. As estruturas do lwIP foram alteradas para escalabilidade em múltiplos núcleos e temporizadores de granularidade fina (até 16 microssegundos), mas o código não foi otimizado para velocidade. Exige Intel VT-x e NICs Intel 82599.

O banco de testes tem 24 clientes e um servidor (Xeon E5-2665, 256 GB) atrás de um switch 10GbE de 48 portas, com o servidor em uma porta de 10GbE ou em quatro portas agregadas (4x10GbE). As bases de comparação são Linux 3.16.1 e mTCP (sobre Linux 2.6.36, só em 10GbE, pois não suporta agregação de NICs). O IX usa lote máximo B = 64. Os experimentos são NetPIPE (fluxo único), o benchmark de eco do MegaPipe e do mTCP (núcleos, mensagens por conexão, tamanho da mensagem), uma varredura de número de conexões até 250.000 e o memcached 1.4.18 com o mutilate e as cargas ETC e USR do Facebook, comparando um Linux ajustado com 8 núcleos contra 6 no IX.

## Resultados

Todos os números são dos próprios autores, apenas com TCP.

- **Latência (NetPIPE, 10GbE).** A latência unidirecional para mensagens de 64B é de 5,7 microssegundos entre dois servidores IX contra 24 no Linux. O IX atinge 5 Gbps de goodput com mensagens de 20KB, o Linux precisa de 385KB. O mTCP tem latência maior que os dois.
- **Vazão.** O IX satura o 10GbE com 3 núcleos, o mTCP precisa de todos os 8. Com 1024 idas e voltas por conexão, o IX entrega 8,8 milhões de mensagens por segundo: 1,9x o mTCP e 8,8x o Linux. A introdução fala em até 10x sobre o Linux e 1,9x sobre o mTCP.
- **4x10GbE.** O IX escala linearmente até 3,8 milhões de conexões TCP por segundo, 2,3x a taxa em 10GbE com n = 1 e 1,3x com n = 1024. Entrega mensagens de 8KB com 34,5 Gbps de goodput (37,9 Gbps no fio, de 39,7 possíveis).
- **Conexões.** Até 250.000 conexões, quando o IX mantém 47% do seu pico, o que os autores atribuem a faltas na cache L3 (25 por mensagem contra 1,4 com 10.000 conexões).
- **memcached.** O tempo de kernel cai de cerca de 75% para menos de 10%. Com SLA de 500 microssegundos no percentil 99, a vazão é 1550K contra 550K requisições por segundo no ETC (2,8x) e 1800K contra 500K no USR (3,6x). A latência sem carga no percentil 99 é 45 contra 94 microssegundos (ETC) e 32 contra 85 (USR).
- **Lotes.** Com carga baixa, B não altera a latência de cauda, e subir B de 1 para 16 melhora a vazão em 29%.

## Análise crítica

O artigo não afirma que o IX é melhor que todo projeto em nível de usuário. Na Discussão, argumenta que execução até a conclusão, lotes adaptativos e zero-copy também poderiam ser feitos em uma pilha de usuário, e que as travessias de proteção do Dune custam algo como uma falta na cache L3. O argumento a favor do kernel é a proteção, não a velocidade bruta.

Limites declarados pelos autores ou visíveis no experimento:

- O protótipo não usa IOMMU, então o plano de dados é código confiável que enxerga endereços físicos do host nos descritores. Também não usa SR-IOV e suporta uma família de NICs. O código da aplicação continua isolado.
- Threads elásticas não devem bloquear, e um timeout (por exemplo, 10ms) apenas sinaliza ao plano de controle as aplicações sem resposta.
- As políticas do IXCP para alocação dinâmica de recursos não foram construídas. Só configurações estáticas foram testadas, então a meta de eficiência de recursos não é avaliada.
- O ganho no memcached foi limitado pela contenção de locks na própria aplicação, que deixa de escalar além de 6 núcleos. Os clientes eram Linux e todas as comparações são com a pilha de 2014 em 10GbE.
- Portar exige a nova API ou a camada de compatibilidade da libix, com a cópia extra.

Literatura posterior, não lida para esta análise além das entradas do catálogo: o próprio artigo descreve o Arrakis como o sistema concorrente mais próximo (usa Barrelfish como plano de controle e suporta IOMMU e SR-IOV). As entradas do catálogo sobre [Demikernel](/papers/demikernel-datapath-os-for-microsecond-datacenter-systems) (2021) e [Snap](/papers/snap-microkernel-approach-to-host-networking) (2019) buscam objetivos parecidos com estruturas diferentes. ZygOS e Shenango não são tratados aqui porque seus textos não foram lidos. O [Multikernel](/papers/multikernel-new-os-architecture-scalable-multicore-systems), que o artigo cita como plano de controle do Arrakis (Barrelfish), é o outro projeto de SO do catálogo construído em torno de estado por núcleo. Existe também uma versão mais longa na ACM TOCS (2016), que é outro item e não foi lida.

## Pesquisas futuras

- Políticas do plano de controle: rebalanceamento dinâmico de fluxos entre threads elásticas sob restrições de vazão e latência, e proporcionalidade de energia.
- Suporte a IOMMU e SR-IOV para reduzir a base de código confiável.
- Controle de congestionamento para implantações com pouco buffer (DCTCP, ECN) combinado com o IX.
- Protocolos que não sejam TCP e acesso a memória persistente sobre o mesmo desenho de plano de dados.
- Suporte em biblioteca a outras APIs (MegaPipe, threads cooperativas, modelos baseados em regras) sobre a interface de baixo nível.
