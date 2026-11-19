---
title: "Arrakis: o sistema operacional é o plano de controle"
summary: O Arrakis divide o papel do kernel em dois. O kernel fica com o plano de controle e configura placas de rede e controladores de armazenamento virtualizados, enquanto as aplicações chegam ao hardware direto por uma biblioteca em espaço de usuário, e os autores relatam latência 2-5x menor e vazão 9x maior no Redis do que um Linux bem ajustado.
researchArea: Sistemas operacionais
keywords: Arrakis, kernel bypass, plano de controle, plano de dados, SR-IOV, sistema operacional de biblioteca, áreas virtuais de armazenamento, Barrelfish
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Tendências recentes de hardware de dispositivos permitem uma nova abordagem para o projeto de sistemas operacionais de servidores de rede. Em um sistema operacional tradicional, o kernel intermedeia o acesso das aplicações servidoras ao hardware, para impor o isolamento entre processos e a segurança de rede e de disco. Projetamos e implementamos um novo sistema operacional, o Arrakis, que divide em dois o papel tradicional do kernel. As aplicações têm acesso direto a dispositivos de E/S virtualizados, o que permite que a maioria das operações de E/S ignore o kernel, enquanto o kernel é reprojetado para oferecer proteção de rede e de disco sem intermediar cada operação. Descrevemos as mudanças de hardware e de software necessárias para aproveitar essa abstração e ilustramos seu poder mostrando melhorias de 2-5x na latência e de 9x na vazão de um popular armazenamento NoSQL persistente, em relação a uma implementação de Linux bem ajustada.

## Visão geral

Em 2014, um servidor chave-valor gastava boa parte do tempo em código de kernel (interrupções, demultiplexação de pacotes, cópias, metadados do sistema de arquivos) para fazer uma busca que leva microssegundos. Décadas de trabalho em caminhos mais rápidos no kernel não tinham fechado a distância até o hardware cru. Este artigo do OSDI 2014, da Universidade de Washington e da ETH Zurique (recebeu o prêmio de melhor artigo da conferência, segundo a página da USENIX), pergunta o que acontece se o kernel sai do caminho de dados de quase toda a E/S mas mantém o modelo de proteção de um SO convencional.

Ele se encaixa numa linhagem que o catálogo já cobre. O [Exokernel](/papers/exokernel-os-architecture-application-level-resource-management) defendia a gerência de recursos no nível da aplicação, mas o artigo observa que o Exokernel, como o SPIN e o Nemesis, ainda intermediava a E/S no kernel. O Arrakis é construído sobre um fork do Barrelfish, o SO de [The Multikernel](/papers/multikernel-new-os-architecture-scalable-multicore-systems), porque o Barrelfish já oferece um SO de biblioteca e drivers em espaço de usuário. O [Xen](/papers/xen-and-the-art-of-virtualization) importa como origem do cenário de hardware: o SR-IOV foi criado para que máquinas virtuais compartilhem um dispositivo.

Vale saber antes: a separação entre plano de controle e plano de dados, anéis de descritores de DMA e o que faz uma IOMMU. O trabalho posterior [Demikernel](/papers/demikernel-datapath-os-for-microsecond-datacenter-systems) é discutido na Análise crítica.

## Contribuição

- **Uma divisão de trabalho.** O hardware multiplexa e protege, o kernel configura, e uma biblioteca em espaço de usuário implementa a pilha de E/S. Instalar filtros, limites de taxa e mapeamentos de armazenamento continua privilegiado e passa pelo kernel (o plano de controle); enviar, receber e gravar não passam.
- **Um modelo ideal de dispositivo.** Placas de interface virtuais (VNICs para rede, VSICs para armazenamento) com filas próprias, mais filtros de transmissão e de recepção, limitadores de taxa e áreas virtuais de armazenamento (VSAs). O modelo se limita de propósito ao que o hardware faz com eficiência, então os filtros são menos expressivos que regras OpenFlow e não têm correspondências sobrepostas por prioridade.
- **Emulação onde o hardware não chega.** Um núcleo dedicado emula o VSIC de um controlador RAID que não tem SR-IOV nem VSAs.
- **Duas interfaces.** O Arrakis/P mantém sockets e arquivos POSIX para aplicações sem modificação. O Arrakis/N é uma interface nativa assíncrona com E/S zero-copy de verdade.
- **Caladan**, uma biblioteca de logs e filas persistentes que guarda os metadados junto de cada entrada, de modo que um append precisa de uma única escrita no hardware. Não tem relação com o escalonador posterior de mesmo nome.

## Metodologia

O Arrakis soma 33.786 linhas ao Barrelfish: suporte a SR-IOV, drivers do adaptador Ethernet 10G Intel 82599 (função física e virtual), da IOMMU Intel e do controlador RAID Intel RS3, a pilha de usuário Extaris (em parte baseada no lwIP) e peças POSIX que faltavam, como threads e epoll. Os testes rodaram em seis máquinas Xeon E5-2430 com switch de 10Gb contra o Linux 3.8, ajustado com um driver ixgbe mais novo e RSS desligado nas execuções de um núcleo. As cargas: servidor de eco UDP com pacotes de 1KB, memcached 1.4.15 (90% de leituras, 10% de gravações, valores de 1KB), Redis 2.8.5 com cada SET persistido, haproxy 1.4.24 com ApacheBench, um middlebox de balanceamento com sockets IP brutos e um teste de limitação de taxa com cinco instâncias de memcached.

O modelo de proteção: filtros e mapeamentos de VSA são capabilities protegidas pelo kernel. O filtro de transmissão impede que uma aplicação forje endereços ou tags de VLAN, o filtro de recepção decide quais pacotes chegam a qual fila, e a IOMMU confina o DMA à memória da aplicação. Os nomes continuam globais: a aplicação exporta nomes de arquivos ao VFS do kernel, que os trata como pontos de montagem remotos. Outros programas leem os dados por um servidor de arquivos de biblioteca na aplicação dona, mapeando a VSA ou por uma exportação.

## Resultados

Estes são os resultados relatados pelos autores.

- **Onde o Linux gasta tempo.** Dos 3,36 microssegundos por pacote UDP, quase 70% vão para a pilha de rede. O Arrakis/P reduz a sobrecarga no servidor para 1,44 microssegundo (57% menos), e o Arrakis/N para 0,38.
- **Vazão do eco.** O Arrakis/P chega a 2,3x o Linux sem processamento na aplicação e o Arrakis/N a 3,9x, 94% de um servidor de eco embutido no driver. O benefício desaparece com 64 microssegundos de processamento por pacote.
- **Memcached.** Com um núcleo, o Arrakis/P tem 1,7x a vazão do Linux e chega perto da taxa da linha com 4 núcleos, enquanto o Linux quase estagna depois de dois. Mudar 74 linhas para o Arrakis/N soma 9% (recepção) e 10% (envio). O artigo relata vazão aqui, não latência.
- **Latência do Redis.** A Tabela 2 mostra leituras com acerto caindo de 8,67 para 4,07 microssegundos (2x) e gravações duráveis de 163,14 para 31,51 (cerca de 5x, percentil 99 de 188,67 para 35,76). A latência de gravação no Arrakis é dominada pelos 25 microssegundos de acesso ao armazenamento.
- **Vazão do Redis.** A vazão de gravação sobe 9x com o Caladan (109 linhas alteradas). Um dispositivo simulado de 15 microssegundos soma mais 1,6x. O Caladan sobre a pilha de rede do Linux chega a só 5x, então as duas virtualizações importam.
- **Outros servidores.** O haproxy ganha 2,2x (2x contra o epoll especulativo do Linux), e o middlebox 2,6x, com o Linux sem escalar nada.
- **Isolamento.** Especificadores de taxa limitaram uma de cinco instâncias de memcached a 100Mb/s, como fizeram as disciplinas de fila do Linux.

## Análise crítica

O próprio artigo declara ressalvas. A base Linux não tem recursos que o Arrakis ainda não suporta (acesso direto ao cache, offloads de segmentação e de recepção), então ele diz que a comparação favorece o Linux. O controlador RAID não protege os discos lógicos por capabilities, e o 82599 filtra só por MAC e VLAN, de modo que filtragem em software completa o serviço. Só havia 64 interfaces virtuais, e os pontos de seis núcleos sofrem com atividade de fundo do Barrelfish.

O que segue é leitura da evidência, não afirmação do artigo.

- **O texto e a Tabela 2 discordam.** A seção 4.4 diz que a latência de gravação do Redis melhora 63%, enquanto o resumo e a Tabela 2 dão cerca de 5x. Tratei a tabela como a medição.
- **Nem toda manchete foi medida.** Não há experimento com convidado virtualizado nem com IPIs virtualizadas (só discussão), nem curva de latência do memcached. Um servidor de arquivos de biblioteca é descrito, mas nenhum benchmark o avalia.
- **Hipóteses de hardware pesam.** Os melhores números dependem do modelo ideal de dispositivo, de um caminho de armazenamento emulado e de uma carga modificada para usar o Caladan.

Literatura posterior, marcada como tal. O artigo do [Demikernel](/papers/demikernel-datapath-os-for-microsecond-datacenter-systems) (SOSP 2021, lido) chama o Arrakis e o IX de arquiteturas de kernel bypass não portáteis, sobretudo para ambientes virtualizados, porque dependem de SR-IOV, e diz que a arquitetura do Arrakis não acomoda com flexibilidade dispositivos heterogêneos. Essa é a caracterização do Demikernel. Não li o IX, o DPDK, o SPDK nem trabalhos posteriores de bypass.

## Pesquisas futuras

- Filtros de hardware sobre propriedades da camada de aplicação, que o artigo aponta como questão em aberto.
- Controle de acesso em hardware para interrupções entre núcleos de uma mesma aplicação.
- Rodar o Arrakis como convidado, movendo o plano de controle para o VMM.
- Se os ganhos da interface nativa valem para aplicações com padrões de E/S mais complexos que o memcached.
- Uma página do catálogo sobre o [Trio](/papers/trio-high-performance-and-secure-userspace-nvm-file-systems) diz que ele toma acesso direto seguro do Exokernel e do Arrakis (tirei isso dessa página, não do texto do Trio).
