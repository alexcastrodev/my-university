---
title: "Unikernels: sistemas operacionais de biblioteca para a nuvem"
summary: Madhavapeddy e colegas de Cambridge propõem compilar a aplicação, o runtime da linguagem e as bibliotecas do SO em uma única imagem lacrada, de espaço de endereçamento único, que inicia direto no Xen, e constroem o protótipo Mirage em OCaml para mostrar servidores DNS, controlador OpenFlow e appliances web com imagens de quilobytes a poucas centenas de quilobytes e desempenho próximo ou acima de Linux, BIND e Apache.
researchArea: Sistemas operacionais
keywords: unikernel, sistema operacional de biblioteca, Mirage, OCaml, Xen, hipervisor, eliminação de código morto, espaço de endereçamento único
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

Apresentamos os unikernels, uma nova abordagem para implantar serviços de nuvem por meio de aplicações escritas em código-fonte de alto nível. Unikernels são appliances de propósito único, especializados em tempo de compilação em kernels autônomos e lacrados contra modificação quando implantados em uma plataforma de nuvem. Em troca, oferecem redução significativa no tamanho das imagens, mais eficiência e segurança, e devem reduzir os custos operacionais. Nosso protótipo Mirage compila código OCaml em unikernels que rodam em nuvens comuns e oferecem uma redução de uma ordem de grandeza no tamanho do código sem penalidade significativa de desempenho. A arquitetura combina tipagem estática segura com um layout de espaço de endereçamento único que pode se tornar imutável por meio de uma extensão do hipervisor. O Mirage contribui com um conjunto de bibliotecas de protocolos com tipos seguros, e nossos resultados mostram que o hipervisor é uma plataforma que supera os problemas de compatibilidade de hardware que tornaram os sistemas operacionais de biblioteca do passado impraticáveis no mundo real.

## Visão geral

Em uma nuvem de máquinas virtuais, cada VM costuma ser especializada em um papel (um banco de dados, um servidor web), mas a imagem ainda inicia um kernel de propósito geral e executa processos de aplicação sem modificação. Os autores dizem que há pouca especialização real no que é implantado, e que um appliance típico carrega centenas de milhares, se não milhões, de linhas de código ativo que executam a cada boot, além de serviços que uma configuração errada pode deixar expostos.

O artigo (ASPLOS '13, de Cambridge, Nottingham, Citrix e OCamlPro) pega a ideia de sistema operacional de biblioteca do [Exokernel](/papers/exokernel-os-architecture-application-level-resource-management) e a leva para um hipervisor. O argumento é que esses sistemas nunca se espalharam por causa do suporte a hardware, e que o [Xen](/papers/xen-and-the-art-of-virtualization) já oferece dispositivos virtuais, então os drivers do hipervisor podem ser reaproveitados. O artigo adota a filosofia do [Multikernel](/papers/multikernel-new-os-architecture-scalable-multicore-systems) de uma VM por núcleo e observa que o hipervisor ainda pode sobrecomprometer memória entre VMs (mecanismo que o [ESX Server](/papers/memory-resource-management-in-vmware-esx-server) descreve em detalhe).

Vale conhecer antes: o que é um hipervisor e um anel de dispositivo paravirtual, o que é um sistema operacional de biblioteca e um pouco de OCaml (tipos estáticos, threads cooperativas). As aproximações a seguir são minhas e o artigo não as cita: para o mesmo instinto de tirar o kernel do caminho de E/S, veja o [Arrakis](/papers/arrakis-operating-system-is-the-control-plane) e o [Demikernel](/papers/demikernel-datapath-os-for-microsecond-datacenter-systems); para VMs pequenas de boot rápido em produção, veja o [Firecracker](/papers/firecracker-lightweight-virtualization-for-serverless-applications).

## Contribuição

- **O unikernel.** Uma VM de SO de biblioteca especializada, lacrada e de propósito único, que roda direto no hipervisor. O escalonador, os drivers e a pilha de rede são bibliotecas ligadas à aplicação, e a configuração faz parte da compilação, de modo que o grafo de dependências de módulos pode ser verificado estaticamente para conter só os serviços desejados.
- **Mirage.** Um protótipo completo em OCaml: a biblioteca PVBoot de início do sistema, um runtime OCaml modificado, drivers Xen com tipos seguros e bibliotecas de protocolos (Tabela 1: Ethernet, ARP, DHCP, IPv4, ICMP, UDP, TCP, OpenFlow, DNS, SSH, HTTP, XMPP, SMTP, uma biblioteca FAT-32, uma B-tree de append e outras).
- **Lacre (sealing).** Um hypercall especial, adicionado por um patch do Xen 4.1 de menos de 50 linhas, que impede novas mudanças nas tabelas de páginas depois que a VM montou tabelas em que nenhuma página é ao mesmo tempo gravável e executável. É a única parte que exige mudança no hipervisor, e o Mirage roda em Xen sem modificação, sem essa camada.
- **Especialização em tempo de compilação.** Otimização do sistema inteiro e eliminação de código morto na compilação, e randomização do espaço de endereçamento gerando um linker script novo a cada compilação, em vez de em tempo de execução.
- **Avaliação** contra Linux, BIND, NSD, NOX, Maestro e Apache em microbenchmarks e quatro appliances.

## Metodologia

O Mirage liga código OCaml em uma imagem Xen inicializável. Também gera binários POSIX para testar em UNIX (Figura 15: um alvo de desenvolvimento, um alvo posix-direct e o alvo xen-direct). O runtime tem um único espaço de endereçamento de 64 bits, com o minor heap em uma única extensão de 2 MB e um major heap que cresce em superpáginas de 2 MB. Não há múltiplos processos nem threads preemptivas: as threads cooperativas do Lwt rodam em um laço que bloqueia nos canais de eventos do Xen. Cada unikernel tem uma CPU virtual, e multicore significa vários unikernels em um Xen, comunicando-se pelo transporte de memória compartilhada vchan. As páginas de E/S são compartilhadas com o backend por grant tables do Xen e entregues à aplicação sem cópia pela extensão cstruct.

Os microbenchmarks comparam o mesmo código OCaml como linux-native, linux-pv e xen-direct, e o tempo de boot é comparado com um kernel Linux mínimo e um convidado Debian rodando Apache2. Os appliances são comparados com Bind 9.9.0 e NSD 3.2.10 (DNS, queryperf, 10 rodadas), Maestro e o branch destiny-fast do NOX (OpenFlow, cbench em um servidor AMD de 16 núcleos), um serviço com nginx, fastCGI e web.py (um site dinâmico "tipo Twitter", httperf) e Apache2 com o backend mpm-worker (página estática). As linhas de código são contadas com cloc após o pré-processamento, e o artigo avisa que comparações de LoC raramente fazem sentido.

## Resultados

Os números abaixo são do artigo, tirados do texto, exceto quando marcados "leitura de gráfico".

- **Boot.** Com o toolstack padrão, o Mirage empata com o kernel Linux mínimo e inicia em pouco menos da metade do tempo do convidado Debian com Apache2. Com um toolstack de construção paralela de domínios que os autores modificaram, o Mirage inicia em menos de 50 ms.
- **Threads e E/S.** Criar milhões de threads é mais rápido no Xen do que no Linux (leitura de gráfico), e o jitter dos temporizadores é menor e mais previsível. Uma inundação de 10^6 pings custa ao Mirage de 4 a 10% mais latência que o Linux, e ambos sobreviveram a 72 horas de inundação. Com offload de hardware desligado, o TCP fica no mesmo nível: Linux para Mirage 1742 Mbps e Mirage para Linux 975 Mbps com um fluxo, contra 1590 de Linux para Linux. A leitura de blocos empata com o direct I/O do Linux, cujo buffer cache estaciona perto de 300 MB/s contra 1,6 GB/s sem ele.
- **DNS.** O BIND chega a 55 mil consultas/s e o NSD a cerca de 70 mil. O Mirage começa perto de 40 mil e chega a 75 a 80 mil depois de um patch de memoização de 20 linhas, que a introdução arredonda para 45% acima do BIND. A imagem tem 183,5 kB contra 462 MB da VM Linux, e os autores notam que o Mirage não implementa o conjunto completo de recursos.
- **OpenFlow.** O Mirage fica entre o NOX e o Maestro (leitura de gráfico), com o NOX mais rápido.
- **Web.** O appliance dinâmico escala linearmente até cerca de 80 sessões, enquanto a VM Linux estaciona perto de 20. A VM Linux servindo uma página estática via nginx chega a 5.000 requisições/s, o que os autores dizem ser substancialmente mais que o Mirage sem otimização. A memória é de 32 MB contra 256 MB. Em páginas estáticas, o Mirage supera o Apache2 nas três configurações Linux (sem números no texto).
- **Tamanho.** Após a eliminação de código morto, as imagens têm 0,184 MB (DNS), 0,172 (web), 0,164 (switch OpenFlow) e 0,168 (controlador), contra 0,449, 0,673, 0,393 e 0,392. Um appliance Linux tem pelo menos 4 a 5 vezes mais linhas de código ativo (Figura 14a, cerca de 570 mil para o Linux 3.2.2 contra 120 mil para o Mirage, leitura de gráfico).

## Análise crítica

O artigo declara vários limites. É só OCaml e abre mão conscientemente da compatibilidade de código-fonte: reescrever pilhas como o TCP é chamado de "desafio de engenharia assustador", viável para um protótipo de pesquisa. A memória é pré-alocada porque uma VM lacrada não pode aumentar o heap. O unikernel não tem multicore, e o artigo diz que o hipervisor e o dom0 continuam na base confiável e como código inseguro. O isolamento é o que o hipervisor oferece, e a thread cooperativa significa que um único bug pode travar o appliance inteiro. O artigo também diz que uma VM com configuração estática não pode ser clonada por snapshot copy-on-write.

O que o artigo não afirma, e que o leitor não deve inferir:

- Que o modelo serve para aplicações de uso geral. Ele mira appliances de propósito único voltados à rede e propõe VMs encapsuladas ligadas por Vchan para código legado só como ideia (seção 5.2).
- Que os números valem além de sistemas configurados pelos autores de modo conhecido. As bases Linux são imagens padrão ou Debian, e o ganho no DNS vem em boa parte de um patch de memoização na aplicação. O resultado baixo do BIND em zonas pequenas é relatado como sem causa conhecida, mas reproduzível.
- Que o caminho de libOS em C seja sólido. O artigo relata que NSD e BIND compilados com newlib, lwIP e MiniOS tiveram desempenho ruim, atribuído a uma interação entre select(2) e o netfront.

Literatura posterior, que não li por inteiro: a análise do [uFork](/papers/ufork-posix-fork-within-a-single-address-space-os) no catálogo descreve a lacuna do `fork` POSIX em SOs de espaço de endereçamento único, que é o mesmo custo que o artigo aceita ao abrir mão de fork e de processos. Usei só essa página do catálogo, não o PDF do uFork.

## Pesquisas futuras

- Os autores listam levar o unikernel para baixo do hipervisor e do dom0, que ainda são código inseguro, e suporte nativo a muitos núcleos.
- Orquestração de nuvem para VMs minúsculas: o artigo diz que OpenStack e Eucalyptus têm latência alta com VMs pequenas e que um único bug que trava tudo exige uma gestão mais ampla.
- Subir o nível de abstração com implementações de RFCs, sistemas de arquivos e criptografia verificadas ou extraídas em OCaml, e verificar o back end do compilador ou um microkernel.
- Encapsular componentes existentes (Map-Reduce, Hadoop, Dryad) como VMs com troca de mensagens, um caminho incremental para código legado.
